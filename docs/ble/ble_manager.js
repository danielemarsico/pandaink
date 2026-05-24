import {
    NORDIC_UART_SERVICE_UUID,
    WACOM_OFFLINE_SERVICE_UUID,
    WACOM_LIVE_SERVICE_UUID,
    SYSEVENT_NOTIFICATION_SERVICE_UUID,
} from './protocol_constants.js';

// Wacom manufacturer company IDs (matches WACOM_COMPANY_IDS in app.py).
// The device advertises these in pairing mode instead of service UUIDs.
const WACOM_COMPANY_IDS = [0x4755, 0x4157, 0x424d];

export class BleManager {
    constructor() {
        this._device = null;
        this._server = null;
        this._service = null;
        this._characteristics = new Map();
        this._notifyHandlers = new Map();
        this._disconnectHandler = null;
        this.ondisconnect = null;
    }

    async connect() {
        this._device = await navigator.bluetooth.requestDevice({
            // acceptAllDevices shows every device the browser can see so the
            // user can pick their tablet regardless of which service UUIDs it
            // happens to be advertising at connection time.
            acceptAllDevices: true,
            optionalServices: [
                NORDIC_UART_SERVICE_UUID,
                WACOM_OFFLINE_SERVICE_UUID,
                WACOM_LIVE_SERVICE_UUID,
                SYSEVENT_NOTIFICATION_SERVICE_UUID,
            ],
        });

        this._disconnectHandler = () => {
            if (this.ondisconnect) this.ondisconnect();
        };
        this._device.addEventListener('gattserverdisconnected', this._disconnectHandler);

        this._server = await this._device.gatt.connect();
        this._service = await this._server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

        return {
            name: this._device.name,
            // Web Bluetooth does not expose MAC addresses directly; use id as proxy
            address: this._device.id,
        };
    }

    async disconnect() {
        if (this._device) {
            if (this._disconnectHandler) {
                this._device.removeEventListener('gattserverdisconnected', this._disconnectHandler);
                this._disconnectHandler = null;
            }
            if (this._device.gatt.connected) {
                this._device.gatt.disconnect();
            }
        }
        this._server = null;
        this._service = null;
        this._characteristics.clear();
        this._notifyHandlers.clear();
    }

    async _getCharacteristic(uuid) {
        if (this._characteristics.has(uuid)) {
            return this._characteristics.get(uuid);
        }
        const char = await this._service.getCharacteristic(uuid);
        this._characteristics.set(uuid, char);
        return char;
    }

    async readCharacteristic(uuid) {
        const char = await this._getCharacteristic(uuid);
        return char.readValue();
    }

    async writeCharacteristic(uuid, data) {
        const char = await this._getCharacteristic(uuid);
        // Python bleak uses response=False (write-without-response); match that.
        // Fall back to write-with-response if the characteristic requires it.
        if (char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(data);
        } else {
            await char.writeValueWithResponse(data);
        }
    }

    // Returns true if the connected device exposes the given GATT service UUID.
    async hasService(serviceUuid) {
        try {
            await this._server.getPrimaryService(serviceUuid);
            return true;
        } catch {
            return false;
        }
    }

    async startNotify(uuid, callback) {
        const char = await this._getCharacteristic(uuid);

        // Remove any stale handler for this UUID before adding a new one.
        // Without this, rapid startNotify calls stack duplicate DOM listeners.
        const existing = this._notifyHandlers.get(uuid);
        if (existing) {
            char.removeEventListener('characteristicvaluechanged', existing);
        }

        const handler = (event) => callback(event.target.value);
        this._notifyHandlers.set(uuid, handler);
        char.addEventListener('characteristicvaluechanged', handler);
        await char.startNotifications();
    }

    async stopNotify(uuid) {
        const handler = this._notifyHandlers.get(uuid);
        if (!handler) return;

        const char = await this._getCharacteristic(uuid);
        char.removeEventListener('characteristicvaluechanged', handler);
        this._notifyHandlers.delete(uuid);
        await char.stopNotifications();
    }
}
