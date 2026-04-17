import { BleManager } from './ble/ble_manager.js';
import { registerDevice } from './ble/register.js';

const STORAGE_KEY = 'pandaink_device';

const statusEl   = document.getElementById('status');
const logEl      = document.getElementById('log');
const connectBtn = document.getElementById('connect-btn');
const forgetBtn  = document.getElementById('forget-btn');

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
    setStatus('Disconnected — click Connect to reconnect');
    log('Device disconnected');
    connectBtn.disabled = false;
};

const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
    const d = JSON.parse(saved);
    setStatus(`Known device: ${d.name} — click Connect to reconnect`);
    forgetBtn.style.display = '';
}

forgetBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('pandaink_uuid');
    setStatus('Not connected');
    forgetBtn.style.display = 'none';
    log('Device registration cleared');
});

connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    setStatus('Connecting...');
    log('Requesting BLE device...');

    try {
        const { name, address } = await bleManager.connect();
        log(`Connected to "${name}" (id: ${address})`);

        const existing = localStorage.getItem(STORAGE_KEY);
        if (existing) {
            const device = JSON.parse(existing);
            setStatus(`Connected to ${device.name}`);
            log(`Already registered as "${device.name}"`);
        } else {
            setStatus('Registering — press the button on your device when prompted...');
            log('Starting registration handshake...');
            const device = await registerDevice(bleManager);
            setStatus(`Registered: ${device.name}`);
            log(`Registration complete. Protocol: ${device.protocol}`);
            forgetBtn.style.display = '';
        }
    } catch (err) {
        // NotFoundError = user cancelled the BLE picker; not an error worth surfacing
        if (err.name === 'NotFoundError') {
            setStatus('Not connected');
        } else {
            setStatus('Error: ' + err.message);
            log('Error: ' + err.message);
        }
        connectBtn.disabled = false;
    }
});
