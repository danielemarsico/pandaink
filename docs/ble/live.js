// W6 — Live pen-data streaming.
// Ports WacomProtocolBase.start_live() / _on_pen_data_changed() from wacom_win.py.
//
// Usage:
//   const session = await startLive(bleManager, deviceInfo, onPenPoint);
//   // onPenPoint(x, y, pressure, inProximity) called for each data packet
//   // ...
//   await session.stop();

import {
    NORDIC_UART_CHRC_TX_UUID,
    NORDIC_UART_CHRC_RX_UUID,
    WACOM_CHRC_LIVE_PEN_DATA_UUID,
    OPCODE_CONNECT,
    OPCODE_SET_MODE,
    REPLY_CONNECT_OK,
    REPLY_CONNECT_FAIL,
    REPLY_ACK,
    MODE_LIVE,
    MODE_IDLE,
} from './protocol_constants.js';

const ERR_INVALID_STATE = 0x02;

// Send a command and wait for the next notification on RX (ports sync.js's
// exchange() so CONNECT/SET_MODE failures surface instead of being sent
// fire-and-forget). Must subscribe before writing, and stopNotify() must
// finish before resolving, or a still-in-flight cleanup from this command can
// race the next exchange()'s startNotify() -- see the matching comment in
// sync.js for why.
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
        await bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dv) => {
            clearTimeout(timer);
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

const NOT_READY_MSG =
    'The device is not ready for live mode. Press the button on the device until the ' +
    'LED is solid green, then try again.';

// CONNECT may reply with the dedicated 0x50/0x51 opcodes (Intuos Pro) or the
// generic ACK (0xb3) used by Spark/Slate/Folio -- ports sync.js's connectAuthorized.
function checkConnectReply(reply) {
    const opcode = reply.getUint8(0);
    if (opcode === REPLY_CONNECT_OK) return;
    if (opcode === REPLY_ACK) {
        const status = reply.getUint8(2);
        if (status === 0x00) return;
        if (status === ERR_INVALID_STATE) throw new Error(NOT_READY_MSG);
        throw new Error(`Device rejected connection (error code 0x${status.toString(16)})`);
    }
    if (opcode === REPLY_CONNECT_FAIL) {
        const reason = reply.getUint8(2 + 6); // after the 6-byte echoed uuid
        throw new Error(`Device rejected connection (reason 0x${reason.toString(16)})`);
    }
    throw new Error(`Unexpected connect reply (opcode 0x${opcode.toString(16)})`);
}

function checkAckReply(reply, label) {
    const opcode = reply.getUint8(0);
    if (opcode !== REPLY_ACK) {
        throw new Error(`Unexpected reply to ${label} (opcode 0x${opcode.toString(16)})`);
    }
    const status = reply.getUint8(2);
    if (status === ERR_INVALID_STATE) throw new Error(NOT_READY_MSG);
    if (status !== 0x00) {
        throw new Error(`Device rejected ${label} (error code 0x${status.toString(16)})`);
    }
}

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

function u16le(data, offset) {
    return data[offset] | (data[offset + 1] << 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Live pen-data packet parser (ports _on_pen_data_changed)
// ─────────────────────────────────────────────────────────────────────────────

// The device sends three types of notifications on WACOM_CHRC_LIVE_PEN_DATA_UUID:
//   0x10 — pressure + buttons (ignored here; raw pressure not useful for drawing)
//   0xa2 — pen entered proximity (timestamp header)
//   0xa1 — coordinate stream, 6 bytes per point
//          ff ff ff ff ff ff = pen left proximity

function parseLivePenData(dv, onPenPoint) {
    if (dv.byteLength === 0) return;

    const type = dv.getUint8(0);

    if (type === 0xa1) {
        const len = dv.getUint8(1);
        if (len % 6 !== 0) return;
        for (let i = 0; i < len; i += 6) {
            const offset = 2 + i;
            const b0 = dv.getUint8(offset);
            const b1 = dv.getUint8(offset + 1);
            const b2 = dv.getUint8(offset + 2);
            const b3 = dv.getUint8(offset + 3);
            const b4 = dv.getUint8(offset + 4);
            const b5 = dv.getUint8(offset + 5);

            if (b0 === 0xff && b1 === 0xff && b2 === 0xff &&
                b3 === 0xff && b4 === 0xff && b5 === 0xff) {
                onPenPoint(0, 0, 0, false);
            } else {
                const x        = b0 | (b1 << 8);
                const y        = b2 | (b3 << 8);
                const pressure = b4 | (b5 << 8);
                onPenPoint(x, y, pressure, true);
            }
        }
    }
    // 0xa2 (pen entered proximity) and 0x10 (pressure/buttons) are silently ignored.
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start a live streaming session.
 *
 * @param {BleManager} bleManager - Connected BleManager instance.
 * @param {object}     deviceInfo - { uuid } from registration.
 * @param {function}   onPenPoint - Called as onPenPoint(x, y, pressure, inProximity).
 *                                  inProximity=false signals pen-lift.
 * @returns {Promise<{stop: function}>} Session handle with a stop() method.
 */
export async function startLive(bleManager, deviceInfo, onPenPoint) {
    const { uuid } = deviceInfo;
    const uuidBytes = hexBytes(uuid);

    // Authenticate with the device
    const connectReply = await exchange(bleManager, OPCODE_CONNECT, uuidBytes);
    checkConnectReply(connectReply);

    // Switch device to live mode
    const modeReply = await exchange(bleManager, OPCODE_SET_MODE, [MODE_LIVE]);
    checkAckReply(modeReply, 'live mode');

    // Subscribe to live pen-data notifications
    await bleManager.startNotify(WACOM_CHRC_LIVE_PEN_DATA_UUID, (dv) => {
        parseLivePenData(dv, onPenPoint);
    });

    return {
        async stop() {
            await bleManager.stopNotify(WACOM_CHRC_LIVE_PEN_DATA_UUID);
            // Best-effort: stopping a live session shouldn't throw even if the
            // device doesn't ACK cleanly on the way out.
            try {
                const idleReply = await exchange(bleManager, OPCODE_SET_MODE, [MODE_IDLE]);
                checkAckReply(idleReply, 'idle mode');
            } catch { /* ignore */ }
        },
    };
}
