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
    WACOM_CHRC_LIVE_PEN_DATA_UUID,
    OPCODE_CONNECT,
    OPCODE_SET_MODE,
    REPLY_CONNECT_OK,
    MODE_LIVE,
    MODE_IDLE,
} from './protocol_constants.js';

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
    const connectPkt = buildPacket(OPCODE_CONNECT, uuidBytes);
    await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, connectPkt);

    // Switch device to live mode
    const modePkt = buildPacket(OPCODE_SET_MODE, new Uint8Array([MODE_LIVE]));
    await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, modePkt);

    // Subscribe to live pen-data notifications
    await bleManager.startNotify(WACOM_CHRC_LIVE_PEN_DATA_UUID, (dv) => {
        parseLivePenData(dv, onPenPoint);
    });

    return {
        async stop() {
            await bleManager.stopNotify(WACOM_CHRC_LIVE_PEN_DATA_UUID);
            const idlePkt = buildPacket(OPCODE_SET_MODE, new Uint8Array([MODE_IDLE]));
            await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, idlePkt)
                .catch(() => {});
        },
    };
}
