import {
    NORDIC_UART_CHRC_TX_UUID,
    NORDIC_UART_CHRC_RX_UUID,
    OPCODE_CONNECT,
    OPCODE_REGISTER_PRESS,
    OPCODE_REGISTER_PRESS_SPARK,
    OPCODE_REGISTER_COMPLETE,
    REPLY_CONNECT_OK,
    REPLY_CONNECT_FAIL,
    REPLY_REGISTER_WAIT,
    REPLY_REGISTER_INTUOS_PRO,
    REPLY_ACK,
    PROTOCOL_SPARK,
    PROTOCOL_SLATE,
    PROTOCOL_INTUOS_PRO,
    SYSEVENT_NOTIFICATION_SERVICE_UUID,
} from './protocol_constants.js';

function buildNordicPacket(opcode, args) {
    const data = new Uint8Array(2 + args.length);
    data[0] = opcode;
    data[1] = args.length;
    data.set(args, 2);
    return data;
}

function generateUuid() {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return new Uint8Array(bytes);
}

// accept: optional predicate (DataView) => bool. When provided, intermediate
// notifications that fail the predicate are silently skipped so callers can
// filter out ACKs without losing the real reply.
function waitForNotification(bleManager, timeoutMs = 15000, accept = null) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
            reject(new Error('Timed out waiting for device reply'));
        }, timeoutMs);
        bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dataView) => {
            if (accept && !accept(dataView)) return; // skip, keep listening
            clearTimeout(timer);
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
            resolve(dataView);
        });
    });
}

// Determines if device is Spark (no SYSEVENT service) or Slate/IntuosPro.
// Spark devices lack the SYSEVENT_NOTIFICATION_SERVICE entirely.
async function isSpark(bleManager) {
    return !(await bleManager.hasService(SYSEVENT_NOTIFICATION_SERVICE_UUID));
}

export async function registerDevice(bleManager) {
    const uuid = generateUuid();
    const uuidBytes = hexToBytes(uuid);

    const spark = await isSpark(bleManager);

    if (spark) {
        // Spark: send CONNECT first (may fail with auth error — that's expected), then REGISTER_PRESS
        const connectPkt = buildNordicPacket(OPCODE_CONNECT, uuidBytes);
        await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, connectPkt);
        // Consume the (expected error) reply
        try {
            const reply = await waitForNotification(bleManager, 5000);
            // opcode 0xb3 with data[0] != 0 is a DeviceError — ignore for Spark registration
        } catch { /* timeout is also acceptable here */ }

        const pressPkt = buildNordicPacket(OPCODE_REGISTER_PRESS_SPARK, new Uint8Array([0x01]));
        await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pressPkt);
    } else {
        // Slate / IntuosPro: send REGISTER_PRESS with UUID
        const pressPkt = buildNordicPacket(OPCODE_REGISTER_PRESS, uuidBytes);
        await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, pressPkt);
    }

    // Wait for the user to press the physical button on the device (up to 30 s).
    // The device sends an ACK (0xb3) first to confirm receipt of REGISTER_PRESS;
    // skip it and keep waiting for the real registration reply.
    const buttonReply = await waitForNotification(bleManager, 30000, (dv) => {
        const op = dv.getUint8(0);
        return op === REPLY_REGISTER_WAIT || op === REPLY_REGISTER_INTUOS_PRO;
    });
    const replyOpcode = buttonReply.getUint8(0);

    let protocolVersion;
    if (replyOpcode === REPLY_REGISTER_WAIT) {
        protocolVersion = spark ? PROTOCOL_SPARK : PROTOCOL_SLATE;
    } else if (replyOpcode === REPLY_REGISTER_INTUOS_PRO) {
        protocolVersion = PROTOCOL_INTUOS_PRO;
    } else {
        throw new Error(`Unexpected registration reply opcode: 0x${replyOpcode.toString(16)}`);
    }

    // Complete registration (only needed for Spark)
    if (spark) {
        const completePkt = buildNordicPacket(OPCODE_REGISTER_COMPLETE, new Uint8Array([0x00]));
        await bleManager.writeCharacteristic(NORDIC_UART_CHRC_TX_UUID, completePkt);
        const ackReply = await waitForNotification(bleManager, 5000);
        const ackOpcode = ackReply.getUint8(0);
        if (ackOpcode !== REPLY_ACK) {
            throw new Error(`Expected ACK (0xb3), got 0x${ackOpcode.toString(16)}`);
        }
    }

    // Return raw BLE info; caller (app_controller) persists to Supabase.
    return {
        name:     bleManager._device.name,
        uuid,
        protocol: protocolVersion,
    };
}
