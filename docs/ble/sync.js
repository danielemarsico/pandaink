// W5 — Offline drawing sync.
// Ports WacomProtocolBase.retrieve_data() / read_offline_data() from wacom_win.py.
//
// Usage:
//   const { drawings, dimensions } = await syncDrawings(bleManager, deviceInfo);
//   // drawings:   array of { timestamp, strokes }
//   // dimensions: [width, height] in µm
//   // strokes:    array of arrays of { x, y, p } (absolute device units)

import {
    NORDIC_UART_CHRC_TX_UUID,
    NORDIC_UART_CHRC_RX_UUID,
    WACOM_OFFLINE_CHRC_PEN_DATA_UUID,
    OPCODE_SET_MODE,
    OPCODE_CONNECT,
    OPCODE_SET_TIME,
    OPCODE_GET_FIRMWARE,
    OPCODE_AVAILABLE_FILES,
    OPCODE_GET_STROKES,
    OPCODE_DOWNLOAD_OLDEST,
    OPCODE_DELETE_OLDEST,
    OPCODE_SET_FILE_TRANSFER,
    OPCODE_GET_BATTERY,
    OPCODE_GET_DIMENSIONS,
    REPLY_AVAILABLE_FILES,
    REPLY_GET_STROKES_COUNT,
    REPLY_GET_STROKES_TS,
    REPLY_GET_STROKES,
    REPLY_GET_BATTERY,
    REPLY_GET_FIRMWARE,
    REPLY_GET_DIMENSIONS,
    REPLY_CRC,
    REPLY_DOWNLOAD_OLDEST,
    REPLY_ACK,
    REPLY_CONNECT_OK,
    REPLY_CONNECT_FAIL,
    MODE_PAPER,
    MODE_IDLE,
    FILE_TRANSFER_ARGS,
    PROTOCOL_SPARK,
} from './protocol_constants.js';

// Hardcoded on Spark/Slate/Folio devices -- there's no real getter for point
// size on this family (protocol.py's MsgGetPointSizeSpark), only Intuos Pro
// queries it for real.
const POINT_SIZE_UM = 10;

// Slate/Folio tablet dimensions in points, used only as a fallback when the
// device answers the dimension query with a bare ACK instead of the data reply
// (ports the class defaults on WacomProtocolSlate in wacom_win.py).
const SLATE_DEFAULT_WIDTH_PTS  = 21600;
const SLATE_DEFAULT_HEIGHT_PTS = 14800;

// Shown when the device genuinely rejects a command with INVALID_STATE (0x02).
// Wording follows wacom_win.py's live_mode() message (solid green = ready) --
// NOT the older, contradictory retrieve_data() text that said "blue".
const DEVICE_NOT_READY_MSG =
    'The device is not in sync mode. Press the button on the device until the ' +
    'LED is solid green, then click Sync again.';

const ERR_INVALID_STATE = 0x02;

// ─────────────────────────────────────────────────────────────────────────────
// Nordic UART packet helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPacket(opcode, args) {
    const data = new Uint8Array(2 + args.length);
    data[0] = opcode;
    data[1] = args.length;
    data.set(args, 2);
    return data;
}

function hexBytes(hex) {
    const out = [];
    for (let i = 0; i < hex.length; i += 2) {
        out.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return new Uint8Array(out);
}

function u16le(dv, offset) {
    return dv.getUint8(offset) | (dv.getUint8(offset + 1) << 8);
}

function u32le(dv, offset) {
    return (dv.getUint8(offset)
        | (dv.getUint8(offset + 1) << 8)
        | (dv.getUint8(offset + 2) << 16)
        | (dv.getUint8(offset + 3) << 24)) >>> 0;
}

// Device timestamps are BCD-encoded: each byte's hex digits are two decimal
// digits of "YYMMDDHHMMSS" (UTC), ports protocol.py's
// f'{d:02x}' + time.strptime + calendar.timegm pattern.
function bcdTimeBytes(date) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const str = pad2(date.getUTCFullYear() % 100) + pad2(date.getUTCMonth() + 1)
        + pad2(date.getUTCDate()) + pad2(date.getUTCHours())
        + pad2(date.getUTCMinutes()) + pad2(date.getUTCSeconds());
    return hexBytes(str);
}

function bcdToTimestamp(bytes) {
    let str = '';
    for (const b of bytes) str += b.toString(16).padStart(2, '0');
    const yy = 2000 + parseInt(str.slice(0, 2), 10);
    const mm = parseInt(str.slice(2, 4), 10) - 1; // JS months are 0-indexed
    const dd = parseInt(str.slice(4, 6), 10);
    const hh = parseInt(str.slice(6, 8), 10);
    const mi = parseInt(str.slice(8, 10), 10);
    const ss = parseInt(str.slice(10, 12), 10);
    return Math.floor(Date.UTC(yy, mm, dd, hh, mi, ss) / 1000);
}

// Checks a reply that's expected to use the generic ACK format (opcode 0xb3,
// payload byte 0 is 0x00 on success or a device error code otherwise) --
// ports protocol.py's Msg.execute() default 0xb3 dispatch.
function checkAckReply(reply, label) {
    const opcode = reply.getUint8(0);
    if (opcode !== REPLY_ACK) {
        throw new Error(`Unexpected reply to ${label} (opcode 0x${opcode.toString(16)})`);
    }
    const status = reply.getUint8(2);
    if (status === ERR_INVALID_STATE) throw new Error(DEVICE_NOT_READY_MSG);
    if (status !== 0x00) {
        throw new Error(`Device rejected ${label} (error code 0x${status.toString(16)})`);
    }
}

// For a query that normally returns a dedicated data opcode but MAY instead be
// answered with the generic ACK: in protocol.py's Msg.execute(), a 0xb3 reply
// is ALWAYS accepted (success if payload byte 0 == 0x00, DeviceError otherwise)
// and the command-specific handler only runs for non-0xb3 replies. Some devices
// (e.g. a Bamboo Folio that has no real battery getter) just ACK these queries.
// Returns true if `reply` carries the dedicated data payload (caller should
// parse it), false if it was a bare ACK (success, no data). Throws on an ACK
// error status or an unrecognized opcode.
function checkDataOrAckReply(reply, dataOpcode, label) {
    const opcode = reply.getUint8(0);
    if (opcode === REPLY_ACK) {
        const status = reply.getUint8(2);
        if (status === ERR_INVALID_STATE) throw new Error(DEVICE_NOT_READY_MSG);
        if (status !== 0x00) {
            throw new Error(`Device rejected ${label} (error code 0x${status.toString(16)})`);
        }
        return false;
    }
    if (opcode === dataOpcode) return true;
    throw new Error(`Unexpected reply to ${label} (opcode 0x${opcode.toString(16)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nordic UART request/reply exchange
// ─────────────────────────────────────────────────────────────────────────────

// Send a command and wait for the next notification on RX.
async function exchange(bleManager, opcode, args = [], timeoutMs = 8000) {
    const pkt = buildPacket(opcode, new Uint8Array(args));

    let resolveReply, rejectReply;
    const replyPromise = new Promise((resolve, reject) => {
        resolveReply = resolve;
        rejectReply  = reject;
    });
    const timer = setTimeout(
        () => rejectReply(new Error(`Timeout waiting for reply to 0x${opcode.toString(16)}`)),
        timeoutMs
    );

    try {
        // Must be subscribed before writing, or the device's reply can arrive
        // before we're listening for it.
        await bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            clearTimeout(timer);
            // stopNotify() must finish before resolving, or a still-in-flight
            // cleanup from THIS command can race the next exchange()'s
            // startNotify() -- ble_manager.js's stopNotify() captures the
            // handler and un-registers it based on stale state if a new
            // handler was already installed by then, silently turning
            // notifications back off right as the next command starts
            // waiting for its reply (manifests as a mysterious timeout on
            // the command immediately following a successful one).
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID)
                .catch(() => {})
                .then(() => resolveReply(dv));
        });
        await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pkt);
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }

    return replyPromise;
}

// Send without waiting for a reply.
async function send(bleManager, opcode, args = []) {
    const pkt = buildPacket(opcode, new Uint8Array(args));
    await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pkt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline pen data accumulation (FFEE0003 GATT characteristic)
// ─────────────────────────────────────────────────────────────────────────────

// CRC-32 (IEEE 802.3, reflected, same polynomial/parameters as Python's
// binascii.crc32) -- used to verify the downloaded pen data against the
// checksum the device sends in its end-of-download reply.
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = (CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
}

// Subscribes to both notification sources, THEN triggers the download —
// subscribing after the trigger risks missing data that arrives before we're
// listening (the same ordering bug as exchange(), above).
//
// End-of-download signalling differs by protocol generation (ports
// MsgWaitForEndRead / MsgWaitForEndReadSlate from protocol.py):
//   - Spark / Intuos Pro: a 0xc9 reply whose payload is the CRC, big-endian.
//   - Slate / Folio: a 0xc8 reply with payload [0xed, <CRC little-endian>].
// In addition, the device acks the DOWNLOAD_OLDEST command itself with an
// initial 0xc8 [0xbe] "download starting" reply (MsgDownloadOldestFile,
// protocol.py) which must NOT be mistaken for the end marker.
export async function readOfflinePenData(bleManager, timeoutMs = 30000) {
    const chunks = [];
    let sawStartAck = false;

    let resolveData, rejectData;
    const dataPromise = new Promise((resolve, reject) => {
        resolveData = resolve;
        rejectData  = reject;
    });
    // Both stopNotify() calls must finish before settling -- see the matching
    // comment in exchange(), above, for why.
    const finish = (settle, value) => {
        clearTimeout(timer);
        Promise.all([
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {}),
            bleManager.stopNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID).catch(() => {}),
        ]).then(() => settle(value));
    };
    const timer = setTimeout(
        () => finish(rejectData, new Error('Timeout waiting for end-of-download reply')),
        timeoutMs
    );

    try {
        // The device sends the end-of-download confirmation on the Nordic UART
        // RX channel after all pen data chunks have been delivered on FFEE0003.
        await bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            const opcode = dv.getUint8(0);
            const length = dv.getUint8(1);
            const payload = new Uint8Array(
                dv.buffer, dv.byteOffset + 2, Math.min(length, dv.byteLength - 2)
            );

            let expectedCrc;
            if (opcode === REPLY_DOWNLOAD_OLDEST) {
                if (payload[0] === 0xbe) {
                    // Ack for the DOWNLOAD_OLDEST command: download starting.
                    if (!sawStartAck) {
                        sawStartAck = true;
                        return;
                    }
                    finish(rejectData, new Error('Unexpected repeated download-start ack (0xc8 be)'));
                    return;
                }
                if (payload[0] !== 0xed) {
                    finish(rejectData, new Error(
                        `Unexpected 0xc8 payload while downloading pen data (0x${(payload[0] ?? 0).toString(16)}, expected 0xed)`
                    ));
                    return;
                }
                // Slate/Folio end marker: CRC bytes follow 0xed in reverse
                // (little-endian) byte order.
                expectedCrc = 0;
                for (let k = payload.length - 1; k >= 1; k--) {
                    expectedCrc = expectedCrc * 256 + payload[k];
                }
            } else if (opcode === REPLY_CRC) {
                // Spark/Intuos Pro end marker: payload is the CRC, big-endian.
                expectedCrc = 0;
                for (let k = 0; k < payload.length; k++) {
                    expectedCrc = expectedCrc * 256 + payload[k];
                }
            } else {
                finish(rejectData, new Error(
                    `Unexpected reply while downloading pen data (opcode 0x${opcode.toString(16)})`
                ));
                return;
            }

            const penData = mergeChunks(chunks);
            const actualCrc = crc32(penData);
            if (actualCrc !== expectedCrc) {
                finish(rejectData, new Error(
                    `Pen data CRC mismatch (device 0x${expectedCrc.toString(16)}, computed 0x${actualCrc.toString(16)})`
                ));
                return;
            }
            finish(resolveData, penData);
        });
        await bleManager.startNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID, (dv) => {
            chunks.push(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
        });

        await send(bleManager, OPCODE_DOWNLOAD_OLDEST, []);
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }

    return dataPromise;
}

function mergeChunks(chunks) {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stroke binary format parser (ports StrokeFile from protocol.py)
// ─────────────────────────────────────────────────────────────────────────────

const FILE_MAGIC_SPARK = 0x74623862;     // 'b8bt' little-endian
const FILE_MAGIC_INTUOS = 0x65698267;    // 'g8ie' little-endian

export function parseStrokeFile(data) {
    const dv = new DataView(data.buffer, data.byteOffset);
    const magic = u32le(dv, 0);

    let headerSize, timestamp;
    if (magic === FILE_MAGIC_SPARK) {
        headerSize = 4;
        timestamp = null;
    } else if (magic === FILE_MAGIC_INTUOS) {
        timestamp = u32le(dv, 4);
        headerSize = 16;
    } else {
        throw new Error(`Unknown stroke file magic: 0x${magic.toString(16)}`);
    }

    const strokes = parseStrokeData(data.subarray(headerSize));
    return { timestamp, strokes };
}

function signedByte(v) {
    return v >= 128 ? v - 256 : v;
}

// Packet types, ports StrokeDataType from protocol.py. A packet is
// classified by its header byte AND its payload (payload length =
// popcount(header)); the check order matters and mirrors
// StrokeDataType.identify exactly.
const PKT_UNKNOWN       = 0;
const PKT_FILE_HEADER   = 1;
const PKT_STROKE_HEADER = 2;
const PKT_STROKE_END    = 3;
const PKT_POINT         = 4;
const PKT_DELTA         = 5;
const PKT_EOF           = 6;
const PKT_LOST_POINT    = 7;

function identifyPacket(data, i) {
    const header = data[i];
    const nbytes = popcount(header);

    // Known file format headers
    if (i + 4 <= data.length) {
        const magic = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16)
            | (data[i + 3] << 24)) >>> 0;
        if (magic === FILE_MAGIC_SPARK || magic === FILE_MAGIC_INTUOS) {
            return PKT_FILE_HEADER;
        }
    }

    // End of stroke: exactly [0xfc, ff ff ff ff ff ff]
    if (header === 0xfc && i + 7 <= data.length) {
        let allFF = true;
        for (let j = 1; j <= 6; j++) {
            if (data[i + j] !== 0xff) { allFF = false; break; }
        }
        if (allFF) return PKT_STROKE_END;
    }

    // EOF: all 8 payload bytes are 0xff (only header 0xff has an
    // 8-byte payload)
    if (nbytes === 8 && i + 9 <= data.length) {
        let allFF = true;
        for (let j = 1; j <= 8; j++) {
            if (data[i + j] !== 0xff) { allFF = false; break; }
        }
        if (allFF) return PKT_EOF;
    }

    // All special headers have the lowest two bits set
    if ((header & 0x3) === 0) return PKT_DELTA;

    if (nbytes === 0 || i + 1 >= data.length) return PKT_UNKNOWN;

    const p0 = data[i + 1];
    // Stroke header: Intuos-Pro-style [0xfa …] payload or Slate-style
    // [0xff 0xee 0xee …] payload
    if (p0 === 0xfa) return PKT_STROKE_HEADER;
    if (nbytes >= 3 && i + 3 < data.length
        && p0 === 0xff && data[i + 2] === 0xee && data[i + 3] === 0xee) {
        return PKT_STROKE_HEADER;
    }
    if (nbytes >= 2 && i + 2 < data.length && p0 === 0xff && data[i + 2] === 0xff) {
        return PKT_POINT;
    }
    if (nbytes >= 2 && i + 2 < data.length && p0 === 0xdd && data[i + 2] === 0xdd) {
        return PKT_LOST_POINT;
    }

    return PKT_UNKNOWN;
}

// Byte size of a stroke-header packet, including the optional pen-ID
// extension packet used by Intuos-Pro-style headers (ports StrokeHeader
// from protocol.py; Slate headers are always just 1 + popcount(header)).
function strokeHeaderSize(data, i) {
    const header = data[i];
    let size = 1 + popcount(header);
    if (data[i + 1] === 0xfa && (data[i + 2] & 0x80)) {
        // Pen ID follows in an extra packet: 0xff header + 8 payload bytes
        const penHeader = data[i + size];
        if (penHeader !== 0xff) {
            throw new Error(`Unexpected pen id packet header 0x${(penHeader ?? 0).toString(16)}`);
        }
        size += 1 + popcount(penHeader);
    }
    return size;
}

export function parseStrokeData(data) {
    const strokes = [];
    let points = [];

    // Cumulative-delta decompression state -- the device keeps a running
    // per-axis delta so that P2 = P0 + 2*d1 + d2 etc.; an absolute
    // coordinate resets that axis's delta. See the long comment in
    // protocol.py's StrokeFile._parse_data.
    let lastX = 0, lastY = 0, lastP = 0;    // abs coords of most recent point
    let dx = 0, dy = 0, dp = 0;             // accumulated per-axis deltas

    let i = 0;
    while (i < data.length) {
        const header = data[i];
        const type = identifyPacket(data, i);

        if (type === PKT_FILE_HEADER) {
            // File headers are handled outside this function; hitting one
            // mid-stream means the parser lost sync.
            console.error(`Unexpected file header at byte ${i}`);
            break;
        }

        if (type === PKT_EOF) {
            if (points.length) { strokes.push(points); points = []; }
            break;
        }

        if (type === PKT_STROKE_END) {
            if (points.length) { strokes.push(points); points = []; }
            i += 1 + popcount(header);
            continue;
        }

        if (type === PKT_STROKE_HEADER) {
            // New stroke: store the finished stroke, reset the delta
            // accumulator (but keep the last absolute position as baseline)
            if (points.length) { strokes.push(points); points = []; }
            dx = 0; dy = 0; dp = 0;
            i += strokeHeaderSize(data, i);
            continue;
        }

        if (type === PKT_LOST_POINT) {
            // Firmware couldn't record some points; nothing to emit
            i += 1 + popcount(header);
            continue;
        }

        if (type === PKT_UNKNOWN) {
            i += 1 + popcount(header);
            continue;
        }

        // POINT or DELTA. A POINT is just a delta whose payload is prefixed
        // with [0xff 0xff] and whose axis mask is the header byte with the
        // low two bits cleared -- headers other than 0xff (e.g. 0xbf) do
        // occur (ports StrokePoint from protocol.py).
        let result;
        if (type === PKT_POINT) {
            result = parseDelta(data, i + 3, header & ~0x3, lastX, lastY, lastP, dx, dy, dp);
            i += 3 + result.consumed;
        } else {
            result = parseDelta(data, i + 1, header, lastX, lastY, lastP, dx, dy, dp);
            i += 1 + result.consumed;
        }
        lastX = result.x; lastY = result.y; lastP = result.p;
        dx = result.dx; dy = result.dy; dp = result.dp;
        points.push({ x: lastX, y: lastY, p: lastP });
    }

    if (points.length) strokes.push(points);
    return strokes;
}

function popcount(v) {
    let c = 0;
    while (v) { c += v & 1; v >>= 1; }
    return c;
}

// Parse the per-axis payload at data[pos..] described by maskByte (a header
// byte whose low two bits are clear). Each 2-bit field describes one axis:
// 00 = unchanged, 10 = signed 1-byte delta, 11 = absolute u16 little-endian.
// Returns the new coordinates, the new delta accumulators, and the number of
// payload bytes consumed.
function parseDelta(data, pos, maskByte, x, y, p, dx, dy, dp) {
    const bitsX = (maskByte >> 2) & 0x3;
    const bitsY = (maskByte >> 4) & 0x3;
    const bitsP = (maskByte >> 6) & 0x3;

    let consumed = 0;

    function readAxis(bits, abs, delta) {
        if (bits === 0x3) {
            // absolute 2-byte little-endian; resets this axis's delta
            const v = data[pos + consumed] | (data[pos + consumed + 1] << 8);
            consumed += 2;
            return [v, 0];
        }
        if (bits === 0x2) {
            // signed 1-byte delta, accumulates
            const v = signedByte(data[pos + consumed]);
            consumed += 1;
            return [abs, delta + v];
        }
        if (bits === 0x1) {
            // Not implemented by any device; the payload size would be
            // ambiguous, so fail loudly instead of desyncing.
            throw new Error('Invalid axis mask 0x1 in stroke delta');
        }
        return [abs, delta];
    }

    let newX, newY, newP, newDx, newDy, newDp;
    [newX, newDx] = readAxis(bitsX, x, dx);
    [newY, newDy] = readAxis(bitsY, y, dy);
    [newP, newDp] = readAxis(bitsP, p, dp);

    return {
        x: newX + newDx, y: newY + newDy, p: newP + newDp,
        dx: newDx, dy: newDy, dp: newDp,
        consumed,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level sync flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync all offline drawings from the device.
 *
 * @param {BleManager} bleManager - Connected BleManager instance.
 * @param {object}     deviceInfo - { uuid, protocol } from registration.
 * @param {object}     [opts]
 * @param {boolean}    [opts.deleteAfterSync=true] - Delete each file from device after download.
 * @param {function}   [opts.onProgress]           - Called with (downloadedCount, totalCount).
 * @returns {Promise<{drawings: Array, dimensions: [number, number]}>}
 *          drawings: array of { timestamp, strokes }; dimensions: [width, height] in µm.
 */
export async function syncDrawings(bleManager, deviceInfo, opts = {}) {
    const { deleteAfterSync = true, onProgress } = opts;
    const { uuid } = deviceInfo;
    const uuidBytes = hexBytes(uuid);

    // The device rejects the file-count query below (and everything after)
    // with a generic ACK error unless this whole handshake runs first, in
    // this order -- ports WacomDeviceSlate.retrieve_data() from wacom_win.py.

    // 1. Connect / authenticate
    // Most devices (Spark/Slate/Folio) reply with the generic ACK opcode
    // (0xb3), where the payload's first byte is 0x00 on success or a device
    // error code otherwise -- ports protocol.py's Msg.execute() 0xb3
    // dispatch. Only Intuos Pro devices reply with raw 0x50/0x51 instead.
    const connectReply = await exchange(bleManager, OPCODE_CONNECT, Array.from(uuidBytes));
    const connectOpcode = connectReply.getUint8(0);
    if (connectOpcode === REPLY_ACK) {
        const status = connectReply.getUint8(2);
        if (status === ERR_INVALID_STATE) {
            // The device frequently reports INVALID_STATE on this initial
            // connect even when it has drawings and is perfectly able to sync.
            // wacom_win.py's live_mode() ignores exactly this and proceeds, so
            // do the same here rather than aborting the whole sync: continue the
            // handshake, and if the device really isn't ready a later step will
            // surface DEVICE_NOT_READY_MSG.
            console.warn('CONNECT returned INVALID_STATE; proceeding with sync anyway');
        } else if (status !== 0x00) {
            throw new Error(`Device rejected connection (error code 0x${status.toString(16)})`);
        }
    } else if (connectOpcode === REPLY_CONNECT_OK) {
        // success
    } else if (connectOpcode === REPLY_CONNECT_FAIL) {
        const reason = connectReply.getUint8(2 + 6); // after the 6-byte echoed uuid
        throw new Error(`Device rejected connection (reason 0x${reason.toString(16)})`);
    } else {
        throw new Error(`Unexpected connect reply (opcode 0x${connectOpcode.toString(16)})`);
    }

    // 2. Set device clock to current UTC time
    const setTimeReply = await exchange(bleManager, OPCODE_SET_TIME, Array.from(bcdTimeBytes(new Date())));
    checkAckReply(setTimeReply, 'set time');

    // 3. Query battery (result currently unused, but the device expects this
    // call as part of the handshake before it will honor file operations). The
    // battery getter isn't real on every device in this family -- some (e.g.
    // Bamboo Folio) just answer with the generic 0xb3 ACK instead of the 0xba
    // battery reply, which protocol.py accepts as success. Don't reject it.
    const batteryReply = await exchange(bleManager, OPCODE_GET_BATTERY, []);
    checkDataOrAckReply(batteryReply, REPLY_GET_BATTERY, 'battery');

    // 4. Query tablet dimensions (width=selector 3, height=selector 4);
    // point size has no real getter on this device family, so it's hardcoded
    // (matches protocol.py's MsgGetPointSizeSpark). If the device answers with a
    // bare ACK instead of the 0xeb data reply, fall back to the Slate defaults.
    const widthReply  = await exchange(bleManager, OPCODE_GET_DIMENSIONS, [0x03, 0x00]);
    const heightReply = await exchange(bleManager, OPCODE_GET_DIMENSIONS, [0x04, 0x00]);
    const widthHasData  = checkDataOrAckReply(widthReply,  REPLY_GET_DIMENSIONS, 'width');
    const heightHasData = checkDataOrAckReply(heightReply, REPLY_GET_DIMENSIONS, 'height');
    let dimensions;
    if (widthHasData && heightHasData) {
        const rawWidth  = u32le(new DataView(widthReply.buffer, widthReply.byteOffset), 4);
        const rawHeight = u32le(new DataView(heightReply.buffer, heightReply.byteOffset), 4);
        dimensions = [rawWidth * POINT_SIZE_UM, rawHeight * POINT_SIZE_UM];
    } else {
        console.warn('Device did not report dimensions; using Slate defaults');
        dimensions = [SLATE_DEFAULT_WIDTH_PTS * POINT_SIZE_UM, SLATE_DEFAULT_HEIGHT_PTS * POINT_SIZE_UM];
    }

    // 5. Query firmware version (two requests with different selectors;
    // result currently unused, same handshake-order requirement as above, and
    // the same generic-ACK tolerance as the battery query).
    for (const selector of [0, 1]) {
        const fwReply = await exchange(bleManager, OPCODE_GET_FIRMWARE, [selector]);
        checkDataOrAckReply(fwReply, REPLY_GET_FIRMWARE, 'firmware');
    }

    // 6. Route offline data to the FFEE0003 GATT characteristic
    const fileTransferReply = await exchange(bleManager, OPCODE_SET_FILE_TRANSFER, FILE_TRANSFER_ARGS);
    checkAckReply(fileTransferReply, 'file transfer setup');

    // 7. Switch device to paper mode
    const paperModeReply = await exchange(bleManager, OPCODE_SET_MODE, [MODE_PAPER]);
    checkAckReply(paperModeReply, 'paper mode');

    // 8. Query available file count
    const countReply = await exchange(bleManager, OPCODE_AVAILABLE_FILES, []);
    const fileCount = countReply.getUint8(2) | (countReply.getUint8(3) << 8);

    const drawings = [];

    for (let n = 0; n < fileCount; n++) {
        if (onProgress) onProgress(n, fileCount);

        // 9. Get stroke count + timestamp for oldest file. The timestamp is
        // BCD-encoded (not a raw little-endian integer) -- ports protocol.py's
        // MsgGetStrokesSlate._handle_reply.
        const strokesReply = await exchange(bleManager, OPCODE_GET_STROKES, []);
        const strokesDv    = new DataView(strokesReply.buffer, strokesReply.byteOffset);
        const strokeCount  = u32le(strokesDv, 2);
        const timestamp    = bcdToTimestamp(
            new Uint8Array(strokesReply.buffer, strokesReply.byteOffset + 6, 6)
        );

        // 10-11. Subscribe, request download of oldest file, and accumulate
        // pen data chunks until the CRC-carrying end-of-download reply
        // arrives -- 0xc8 [0xed …] on Slate/Folio, 0xc9 on Spark
        // (readOfflinePenData
        // sends the trigger itself, after subscribing).
        const penData = await readOfflinePenData(bleManager);

        // 12. Parse binary stroke data
        try {
            const { strokes } = parseStrokeFile(penData);
            drawings.push({ timestamp, strokes });
        } catch (e) {
            console.warn('Failed to parse drawing:', e);
        }

        // 13. Delete file from device
        if (deleteAfterSync) {
            const deleteReply = await exchange(bleManager, OPCODE_DELETE_OLDEST, []);
            checkAckReply(deleteReply, 'delete file');
        }
    }

    if (onProgress) onProgress(fileCount, fileCount);

    // 14. Return device to idle
    const idleReply = await exchange(bleManager, OPCODE_SET_MODE, [MODE_IDLE]);
    checkAckReply(idleReply, 'idle mode');

    return { drawings, dimensions };
}
