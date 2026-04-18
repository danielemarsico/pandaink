// W5 — Offline drawing sync.
// Ports WacomProtocolBase.retrieve_data() / read_offline_data() from wacom_win.py.
//
// Usage:
//   const drawings = await syncDrawings(bleManager, deviceInfo);
//   // drawings: array of { timestamp, dimensions, strokes }
//   // strokes:  array of arrays of { x, y, p } (absolute device units)

import {
    NORDIC_UART_CHRC_TX_UUID,
    NORDIC_UART_CHRC_RX_UUID,
    WACOM_OFFLINE_CHRC_PEN_DATA_UUID,
    OPCODE_SET_MODE,
    OPCODE_CONNECT,
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
    REPLY_CRC,
    REPLY_ACK,
    REPLY_CONNECT_OK,
    MODE_PAPER,
    MODE_IDLE,
    FILE_TRANSFER_ARGS,
    PROTOCOL_SPARK,
} from './protocol_constants.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Nordic UART request/reply exchange
// ─────────────────────────────────────────────────────────────────────────────

// Send a command and wait for the next notification on RX.
async function exchange(bleManager, opcode, args = [], timeoutMs = 8000) {
    const pkt = buildPacket(opcode, new Uint8Array(args));
    const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for reply to 0x${opcode.toString(16)}`)),
            timeoutMs
        );
        bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            clearTimeout(timer);
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
            resolve(dv);
        });
    });
    await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pkt);
    return reply;
}

// Send without waiting for a reply.
async function send(bleManager, opcode, args = []) {
    const pkt = buildPacket(opcode, new Uint8Array(args));
    await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pkt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline pen data accumulation (FFEE0003 GATT characteristic)
// ─────────────────────────────────────────────────────────────────────────────

async function readOfflinePenData(bleManager, expectedCrc, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let lastDataTime = Date.now();

        const timer = setTimeout(() => {
            bleManager.stopNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID).catch(() => {});
            reject(new Error('Timeout waiting for pen data CRC packet'));
        }, timeoutMs);

        // The device sends a CRC confirmation on the Nordic UART RX channel after
        // all pen data chunks have been delivered on FFEE0003.
        bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            const opcode = dv.getUint8(0);
            if (opcode === REPLY_CRC) {
                clearTimeout(timer);
                bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
                bleManager.stopNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID).catch(() => {});
                const allBytes = mergeChunks(chunks);
                resolve(allBytes);
            }
        });

        bleManager.startNotify(WACOM_OFFLINE_CHRC_PEN_DATA_UUID, (dv) => {
            const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
            chunks.push(bytes);
            lastDataTime = Date.now();
        });
    });
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
 * @returns {Promise<Array>} Array of drawing objects { timestamp, strokes }.
 */
export async function syncDrawings(bleManager, deviceInfo, opts = {}) {
    const { deleteAfterSync = true, onProgress } = opts;
    const { uuid } = deviceInfo;
    const uuidBytes = hexBytes(uuid);

    // 1. Connect / authenticate
    const connectReply = await exchange(bleManager, OPCODE_CONNECT, Array.from(uuidBytes));
    const connectOk = connectReply.getUint8(0);
    if (connectOk !== 0x50 /* REPLY_CONNECT_OK */) {
        throw new Error(`Device rejected connection (opcode 0x${connectOk.toString(16)})`);
    }

    // 2. Route offline data to the FFEE0003 GATT characteristic
    await send(bleManager, OPCODE_SET_FILE_TRANSFER, FILE_TRANSFER_ARGS);

    // 3. Switch device to paper mode
    await send(bleManager, OPCODE_SET_MODE, [MODE_PAPER]);

    // 4. Query available file count
    const countReply = await exchange(bleManager, OPCODE_AVAILABLE_FILES, []);
    const fileCount = countReply.getUint8(2) | (countReply.getUint8(3) << 8);

    const drawings = [];

    for (let n = 0; n < fileCount; n++) {
        if (onProgress) onProgress(n, fileCount);

        // 5. Get stroke count + timestamp for oldest file
        const strokesReply = await exchange(bleManager, OPCODE_GET_STROKES, []);
        const strokeCount = u32le(new DataView(strokesReply.buffer, strokesReply.byteOffset), 2);
        const timestamp   = u32le(new DataView(strokesReply.buffer, strokesReply.byteOffset), 6);

        // 6. Request download of oldest file
        await send(bleManager, OPCODE_DOWNLOAD_OLDEST, []);

        // 7. Accumulate pen data chunks until CRC packet arrives
        const penData = await readOfflinePenData(bleManager);

        // 8. Parse binary stroke data
        try {
            const { strokes } = parseStrokeFile(penData);
            drawings.push({ timestamp, strokes });
        } catch (e) {
            console.warn('Failed to parse drawing:', e);
        }

        // 9. Delete file from device
        if (deleteAfterSync) {
            await send(bleManager, OPCODE_DELETE_OLDEST, []);
        }
    }

    if (onProgress) onProgress(fileCount, fileCount);

    // 10. Return device to idle
    await send(bleManager, OPCODE_SET_MODE, [MODE_IDLE]);

    return drawings;
}
