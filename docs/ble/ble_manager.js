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
        this._quietDisconnect = false;
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
            // Disconnects we initiate (or that happen while reconnecting) are
            // not a lost connection the UI should report.
            if (this._quietDisconnect) return;
            if (this.ondisconnect) this.ondisconnect();
        };
        this._device.addEventListener('gattserverdisconnected', this._disconnectHandler);

        await this._openLink();

        return {
            name: this._device.name,
            // Web Bluetooth does not expose MAC addresses directly; use id as proxy
            address: this._device.id,
        };
    }

    // True when a device was picked earlier on this page, so reconnect() can
    // reopen it without showing the browser's device picker again.
    hasDevice() {
        return !!this._device;
    }

    // The Folio only accepts a new sync after the BLE link has really dropped
    // (a second CONNECT on the same link is refused with INVALID_STATE), so
    // callers close the link when a sync finishes, as base_win.py does after
    // every fetch. Waits for the disconnect to actually complete.
    async closeLink() {
        if (!this._device || !this._device.gatt.connected) return;
        this._quietDisconnect = true;
        try {
            await new Promise((resolve) => {
                let timer;
                const done = () => {
                    clearTimeout(timer);
                    this._device.removeEventListener('gattserverdisconnected', done);
                    resolve();
                };
                timer = setTimeout(done, 3000);
                this._device.addEventListener('gattserverdisconnected', done);
                this._device.gatt.disconnect();
            });
        } finally {
            this._quietDisconnect = false;
        }
        this._resetLinkState();
    }

    // Reopen the link to the already-picked device. Right after reconnecting,
    // the Folio can drop the link again while services are being discovered,
    // so retry the whole connect until it holds or `timeoutMs` runs out.
    async reconnect({ timeoutMs = 20000, onRetry } = {}) {
        if (!this._device) return this.connect();
        const deadline = Date.now() + timeoutMs;
        this._quietDisconnect = true;
        try {
            for (let attempt = 1; ; attempt++) {
                try {
                    await this._openLink();
                    if (this._device.gatt.connected) return;
                    throw new Error('link dropped right after connecting');
                } catch (err) {
                    this._resetLinkState();
                    if (Date.now() >= deadline) {
                        throw new Error(`Could not reconnect to the device (${err.message}). `
                            + 'Press the device button and try again.');
                    }
                    if (onRetry) onRetry(attempt, err);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
        } finally {
            this._quietDisconnect = false;
        }
    }

    _resetLinkState() {
        this._server = null;
        this._service = null;
        this._services = [];
        this._characteristics.clear();
        this._notifyHandlers.clear();
    }

    async _openLink() {
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
        let commandService = null;
        let lastErr;
        for (const svcUuid of [
            NORDIC_UART_SERVICE_UUID,
            WACOM_OFFLINE_SERVICE_UUID,
            WACOM_LIVE_SERVICE_UUID,
            SYSEVENT_NOTIFICATION_SERVICE_UUID,
        ]) {
            try {
                const service = await this._server.getPrimaryService(svcUuid);
                this._services.push(service);
                if (svcUuid === NORDIC_UART_SERVICE_UUID) commandService = service;
            } catch (e) { lastErr = e; /* device doesn't expose this service — skip it */ }
        }
        // Every command goes through the Nordic UART service; without it the
        // link is unusable (typically it dropped during discovery).
        if (!commandService) {
            throw new Error(`command service unavailable (${lastErr?.message ?? 'not found'})`);
        }
        this._service = commandService;
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
        this._resetLinkState();
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
