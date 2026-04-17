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
    SYSEVENT_NOTIFICATION_CHRC_UUID,
} from './protocol_constants.js';

const STORAGE_KEY = 'pandaink_device';

function buildNordicPacket(opcode, args) {
    const data = new Uint8Array(2 + args.length);
    data[0] = opcode;
    data[1] = args.length;
    data.set(args, 2);
    return data;
}

function generateUuid() {
    const stored = localStorage.getItem('pandaink_uuid');
    if (stored && stored.length === 12) return stored;
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    localStorage.setItem('pandaink_uuid', hex);
    return hex;
}

function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return new Uint8Array(bytes);
}

function waitForNotification(bleManager, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for device reply')), timeoutMs);
        bleManager.startNotify(NORDIC_UART_CHRC_RX_UUID, (dataView) => {
            clearTimeout(timer);
            bleManager.stopNotify(NORDIC_UART_CHRC_RX_UUID).catch(() => {});
            resolve(dataView);
        });
    });
}

// Determines if device is Spark (no SYSEVENT characteristic) or Slate/IntuosPro.
// Web Bluetooth doesn't enumerate all characteristics upfront, so we attempt
// to get the SYSEVENT characteristic and treat failure as Spark.
async function isSpark(bleManager) {
    try {
        await bleManager._getCharacteristic(SYSEVENT_NOTIFICATION_CHRC_UUID);
        return false;
    } catch {
        return true;
    }
}

export async function registerDevice(bleManager) {
    const existingRaw = localStorage.getItem(STORAGE_KEY);
    if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        return existing;
    }

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

    // Wait for the user to press the physical button on the device (up to 30 s)
    const buttonReply = await waitForNotification(bleManager, 30000);
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

    const result = {
        address: bleManager._device.id,
        name: bleManager._device.name,
        uuid,
        protocol: protocolVersion,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    return result;
}
