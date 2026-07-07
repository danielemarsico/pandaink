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
    if (status !== 0x00) {
        throw new Error(`Device rejected ${label} (error code 0x${status.toString(16)})`);
    }
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
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
            resolveReply(dv);
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

// Subscribes to both notification sources, THEN triggers the download —
// subscribing after the trigger risks missing data that arrives before we're
// listening (the same ordering bug as exchange(), above).
async function readOfflinePenData(bleManager, timeoutMs = 30000) {
    const chunks = [];

    let resolveData, rejectData;
    const dataPromise = new Promise((resolve, reject) => {
        resolveData = resolve;
        rejectData  = reject;
    });
    const timer = setTimeout(() => {
        bleManager.stopNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID).catch(() => {});
        bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
        rejectData(new Error('Timeout waiting for pen data CRC packet'));
    }, timeoutMs);

    try {
        // The device sends a CRC confirmation on the Nordic UART RX channel after
        // all pen data chunks have been delivered on FFEE0003.
        await bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            const opcode = dv.getUint8(0);
            if (opcode === REPLY_CRC) {
                clearTimeout(timer);
                bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
                bleManager.stopNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID).catch(() => {});
                resolveData(mergeChunks(chunks));
            }
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

function parseStrokeFile(data) {
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

function parseStrokeData(data) {
    const strokes = [];
    let points = [];

    let lastX = 0, lastY = 0, lastP = 0;
    let dx = 0, dy = 0, dp = 0;

    let i = 0;
    while (i < data.length) {
        const hdr = data[i];

        // EOF packet: 0xff repeated
        if (hdr === 0xff && i + 1 < data.length && data[i + 1] === 0xff) {
            if (points.length) { strokes.push(points); points = []; }
            break;
        }

        // End-of-stroke: header 0xfc or 0xff with payload all 0xff
        if ((hdr & 0x3) === 0x3 && _isEndOfStroke(data, i)) {
            if (points.length) { strokes.push(points); points = []; }
            i += _packetSize(hdr);
            dx = 0; dy = 0; dp = 0;
            continue;
        }

        // StrokeHeader 0xfa: new stroke start
        if (hdr === 0xfa) {
            if (points.length) { strokes.push(points); points = []; }
            dx = 0; dy = 0; dp = 0;
            i += 2;
            continue;
        }

        // Delta / Point packet
        if ((hdr & 0x3) === 0) {
            // StrokeDelta
            const result = parseDelta(data, i, lastX, lastY, lastP, dx, dy, dp);
            lastX = result.x; lastY = result.y; lastP = result.p;
            dx = result.dx; dy = result.dy; dp = result.dp;
            points.push({ x: lastX, y: lastY, p: lastP });
            i += result.size;
        } else if ((hdr & 0x3) === 0x3) {
            // StrokePoint (0xff 0xff prefix + delta payload)
            i += 2; // skip 0xff 0xff
            const result = parseDelta(data, i, lastX, lastY, lastP, dx, dy, dp);
            lastX = result.x; lastY = result.y; lastP = result.p;
            dx = result.dx; dy = result.dy; dp = result.dp;
            points.push({ x: lastX, y: lastY, p: lastP });
            i += result.size;
        } else {
            // Unknown — skip 1 + popcount(hdr) bytes
            const skip = 1 + popcount(hdr);
            i += skip;
        }
    }

    if (points.length) strokes.push(points);
    return strokes;
}

function _isEndOfStroke(data, i) {
    const hdr = data[i];
    const size = _packetSize(hdr);
    for (let j = i + 1; j < i + size && j < data.length; j++) {
        if (data[j] !== 0xff) return false;
    }
    return true;
}

function _packetSize(hdr) {
    return 1 + popcount(hdr);
}

function popcount(v) {
    let c = 0;
    while (v) { c += v & 1; v >>= 1; }
    return c;
}

// Parse a StrokeDelta from data[i..]. Returns updated coordinates and packet size.
function parseDelta(data, i, x, y, p, dx, dy, dp) {
    const hdr = data[i];
    const bitmask = hdr >> 2;
    let pos = i + 1;
    let size = 1;

    // Each pair of bits in bitmask describes one axis: 00=unchanged, 01=abs, 10=delta
    function readAxis(curAbs, curDelta) {
        const bits = bitmask & 0x3;
        bitmask >>= 2; // conceptually — JS doesn't mutate vars, so we inline below
        if (bits === 0x3) {
            // absolute 2-byte little-endian
            const v = data[pos] | (data[pos + 1] << 8);
            pos += 2; size += 2;
            return { abs: v, delta: 0 };
        } else if (bits === 0x2) {
            // signed 1-byte delta
            const v = signedByte(data[pos]);
            pos += 1; size += 1;
            curDelta += v;
            return { abs: curAbs, delta: curDelta };
        }
        return { abs: curAbs, delta: curDelta };
    }

    // Re-implement with explicit bit extraction since JS closures don't share mutation
    let b = hdr >> 2;

    const bitsX = b & 0x3; b >>= 2;
    const bitsY = b & 0x3; b >>= 2;
    const bitsP = b & 0x3;

    let newX = x, newY = y, newP = p;
    let newDx = dx, newDy = dy, newDp = dp;

    if (bitsX === 0x3) {
        newX = data[pos] | (data[pos + 1] << 8); newDx = 0; pos += 2; size += 2;
    } else if (bitsX === 0x2) {
        newDx += signedByte(data[pos]); pos += 1; size += 1;
    }

    if (bitsY === 0x3) {
        newY = data[pos] | (data[pos + 1] << 8); newDy = 0; pos += 2; size += 2;
    } else if (bitsY === 0x2) {
        newDy += signedByte(data[pos]); pos += 1; size += 1;
    }

    if (bitsP === 0x3) {
        newP = data[pos] | (data[pos + 1] << 8); newDp = 0; pos += 2; size += 2;
    } else if (bitsP === 0x2) {
        newDp += signedByte(data[pos]); pos += 1; size += 1;
    }

    return {
        x: newX + newDx, y: newY + newDy, p: newP + newDp,
        dx: newDx, dy: newDy, dp: newDp,
        size,
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
        if (status !== 0x00) {
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
    // call as part of the handshake before it will honor file operations)
    const batteryReply = await exchange(bleManager, OPCODE_GET_BATTERY, []);
    if (batteryReply.getUint8(0) !== REPLY_GET_BATTERY) {
        throw new Error(`Unexpected battery reply (opcode 0x${batteryReply.getUint8(0).toString(16)})`);
    }

    // 4. Query tablet dimensions (width=selector 3, height=selector 4);
    // point size has no real getter on this device family, so it's hardcoded
    // (matches protocol.py's MsgGetPointSizeSpark).
    const widthReply  = await exchange(bleManager, OPCODE_GET_DIMENSIONS, [0x03, 0x00]);
    const heightReply = await exchange(bleManager, OPCODE_GET_DIMENSIONS, [0x04, 0x00]);
    for (const [reply, label] of [[widthReply, 'width'], [heightReply, 'height']]) {
        if (reply.getUint8(0) !== REPLY_GET_DIMENSIONS) {
            throw new Error(`Unexpected ${label} reply (opcode 0x${reply.getUint8(0).toString(16)})`);
        }
    }
    const rawWidth  = u32le(new DataView(widthReply.buffer, widthReply.byteOffset), 4);
    const rawHeight = u32le(new DataView(heightReply.buffer, heightReply.byteOffset), 4);
    const dimensions = [rawWidth * POINT_SIZE_UM, rawHeight * POINT_SIZE_UM];

    // 5. Query firmware version (two requests with different selectors;
    // result currently unused, same handshake-order requirement as above)
    for (const selector of [0, 1]) {
        const fwReply = await exchange(bleManager, OPCODE_GET_FIRMWARE, [selector]);
        if (fwReply.getUint8(0) !== REPLY_GET_FIRMWARE) {
            throw new Error(`Unexpected firmware reply (opcode 0x${fwReply.getUint8(0).toString(16)})`);
        }
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
        // pen data chunks until the CRC packet arrives (readOfflinePenData
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
