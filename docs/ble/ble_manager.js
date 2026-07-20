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
        this._service = null;      // Nordic UART service (kept for convenience)
        this._services = [];       // every discovered service we resolve chars against
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

        // Characteristic/notify-handler references are tied to the GATT
        // session they were retrieved from -- they go stale on reconnect
        // (even to the same device) and must not be reused, or later calls
        // fail with "Characteristic ... is no longer valid".
        this._characteristics.clear();
        this._notifyHandlers.clear();

        this._server = await this._device.gatt.connect();

        // Characteristics live across MULTIPLE services: the command channel is
        // in the Nordic UART service (6e400001), but the offline pen-data
        // characteristic (ffee0003) is in the Wacom offline service (ffee0001),
        // and live data is in yet another. Resolving every characteristic
        // against a single service fails with "No Characteristics matching UUID
        // … found in Service …". Discover each service the device exposes and
        // resolve characteristics against all of them.
        this._services = [];
        for (const svcUuid of [
            NORDIC_UART_SERVICE_UUID,
            WACOM_OFFLINE_SERVICE_UUID,
            WACOM_LIVE_SERVICE_UUID,
            SYSEVENT_NOTIFICATION_SERVICE_UUID,
        ]) {
            try {
                this._services.push(await this._server.getPrimaryService(svcUuid));
            } catch { /* device doesn't expose this service — skip it */ }
        }
        // Keep the Nordic UART service reference for callers that expect it.
        this._service = this._services[0] ?? null;

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
        this._services = [];
        this._characteristics.clear();
        this._notifyHandlers.clear();
    }

    async _getCharacteristic(uuid) {
        if (this._characteristics.has(uuid)) {
            return this._characteristics.get(uuid);
        }
        // The characteristic may live in any of the discovered services, so try
        // each until one has it (getCharacteristic throws when it doesn't).
        let lastErr;
        for (const service of this._services) {
            try {
                const char = await service.getCharacteristic(uuid);
                this._characteristics.set(uuid, char);
                return char;
            } catch (e) {
                lastErr = e;
            }
        }
        throw new Error(
            `Characteristic ${uuid} not found in any discovered service`
            + (lastErr ? ` (${lastErr.message})` : '')
        );
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

    // True only while the GATT link is actually open (not just "registered").
    isConnected() {
        return !!(this._device && this._device.gatt && this._device.gatt.connected);
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
