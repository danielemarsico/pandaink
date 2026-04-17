import { BleManager } from './ble/ble_manager.js';
import { registerDevice } from './ble/register.js';

const STORAGE_KEY = 'pandaink_device';

const statusEl = document.getElementById('status');
const logEl    = document.getElementById('log');
const connectBtn = document.getElementById('connect-btn');

function setStatus(text) {
    statusEl.textContent = text;
}

function log(text) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logEl.prepend(line);
}

const bleManager = new BleManager();

bleManager.ondisconnect = () => {
    setStatus('Disconnected');
    log('Device disconnected');
    connectBtn.disabled = false;
};

connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    setStatus('Connecting...');
    log('Requesting BLE device...');

    try {
        const { name, address } = await bleManager.connect();
        log(`Connected to "${name}" (id: ${address})`);

        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const device = JSON.parse(saved);
            setStatus(`Connected to ${device.name}`);
            log(`Already registered as "${device.name}"`);
        } else {
            setStatus('Registering device — press button on device when prompted...');
            log('Starting registration handshake...');
            const device = await registerDevice(bleManager);
            setStatus(`Registered and connected to ${device.name}`);
            log(`Registration complete. Protocol version: ${device.protocol}`);
        }
    } catch (err) {
        setStatus('Error: ' + err.message);
        log('Error: ' + err.message);
        connectBtn.disabled = false;
    }
});
