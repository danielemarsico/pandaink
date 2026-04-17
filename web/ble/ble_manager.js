import { NORDIC_UART_SERVICE_UUID } from './protocol_constants.js';

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
            filters: [{ services: [NORDIC_UART_SERVICE_UUID] }],
            optionalServices: [
                '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
                'ffee0001-bbaa-9988-7766-554433221100',
                '00001523-1212-efde-1523-785feabcd123',
                '3a340720-c572-11e5-86c5-0002a5d5c51b',
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
        await char.writeValue(data);
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
