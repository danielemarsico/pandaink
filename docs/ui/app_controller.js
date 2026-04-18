// W11 — UI state machine: Normal / Live modes.
// Wires all BLE, storage, rendering and export modules together.
//
// Consumed by app.js:
//   import { AppController } from './ui/app_controller.js';
//   const app = new AppController();
//   app.mount(document.getElementById('app-root'));

import { BleManager }     from '../ble/ble_manager.js';
import { registerDevice }  from '../ble/register.js';
import { syncDrawings }    from '../ble/sync.js';
import { startLive }       from '../ble/live.js';
import { saveDrawing, getDrawingsByDevice, deleteDrawing, saveDevice, getDevice }
    from '../storage/idb_store.js';
import { DrawingCanvas }   from './drawing_canvas.js';
import { LiveCanvas }      from './live_canvas.js';
import { drawingToSvg, downloadSvg } from '../export/svg_export.js';

const DEVICE_STORAGE_KEY = 'pandaink_device';

// ─────────────────────────────────────────────────────────────────────────────
// AppController
// ─────────────────────────────────────────────────────────────────────────────

export class AppController {
    constructor() {
        this._ble         = new BleManager();
        this._deviceInfo  = null;   // { id, name, uuid, protocol }
        this._mode        = 'normal';          // 'normal' | 'live'
        this._orientation = 'portrait';
        this._liveSession = null;   // { stop() } returned by startLive()
        this._drawings    = [];     // loaded drawing records
        this._activeDrawingIndex = -1;
        this._liveCanvas  = null;

        this._ble.ondisconnect = () => this._onDisconnect();

        // Restore saved device info from localStorage
        const saved = localStorage.getItem(DEVICE_STORAGE_KEY);
        if (saved) {
            try { this._deviceInfo = JSON.parse(saved); } catch {}
        }
    }

    // ── Mounting ────────────────────────────────────────────────────────────

    /**
     * Render the full app UI into rootEl and load any stored drawings.
     * @param {HTMLElement} rootEl
     */
    async mount(rootEl) {
        this._root = rootEl;
        rootEl.innerHTML = this._buildHTML();
        this._bindEvents();

        if (this._deviceInfo) {
            this._updateDeviceLabel();
            await this._loadStoredDrawings();
        }
    }

    // ── HTML skeleton ────────────────────────────────────────────────────────

    _buildHTML() {
        return `
<div class="app-toolbar">
  <span id="device-label" class="device-label">No device</span>
  <div class="mode-selector">
    <label><input type="radio" name="mode" value="normal" checked> Normal</label>
    <label><input type="radio" name="mode" value="live"> Live</label>
  </div>
  <div class="orientation-selector">
    <label><input type="radio" name="orientation" value="landscape"> Landscape</label>
    <label><input type="radio" name="orientation" value="portrait" checked> Portrait</label>
  </div>
</div>

<div id="normal-panel" class="panel">
  <div class="action-bar">
    <button id="btn-connect">Connect / Register</button>
    <button id="btn-sync" disabled>Sync drawings</button>
    <button id="btn-forget" style="display:none">Forget device</button>
  </div>
  <div id="status-bar" class="status-bar">Not connected</div>
  <div id="drawing-tabs" class="drawing-tabs">
    <div id="tab-list" class="tab-list"></div>
    <div id="tab-content" class="tab-content">
      <p class="placeholder">No drawings — connect your device and click Sync.</p>
    </div>
  </div>
</div>

<div id="live-panel" class="panel" style="display:none">
  <div class="action-bar">
    <button id="btn-start-live" disabled>Start Live</button>
  </div>
  <div id="live-status" class="status-bar">Idle</div>
  <canvas id="live-canvas" class="live-canvas"></canvas>
</div>
`;
    }

    // ── Event binding ────────────────────────────────────────────────────────

    _bindEvents() {
        const r = (id) => this._root.querySelector(id);

        r('#btn-connect').addEventListener('click', () => this._cmdConnect());
        r('#btn-sync').addEventListener('click',    () => this._cmdSync());
        r('#btn-forget').addEventListener('click',  () => this._cmdForget());
        r('#btn-start-live').addEventListener('click', () => this._cmdToggleLive());

        this._root.querySelectorAll('input[name="mode"]').forEach((radio) => {
            radio.addEventListener('change', (e) => this._setMode(e.target.value));
        });

        this._root.querySelectorAll('input[name="orientation"]').forEach((radio) => {
            radio.addEventListener('change', (e) => this._setOrientation(e.target.value));
        });

        const liveEl = r('#live-canvas');
        this._liveCanvas = new LiveCanvas(liveEl, { orientation: this._orientation });
    }

    // ── Mode / orientation ───────────────────────────────────────────────────

    _setMode(mode) {
        if (mode === this._mode) return;
        if (this._liveSession) this._stopLive();
        this._mode = mode;
        this._root.querySelector('#normal-panel').style.display = mode === 'normal' ? '' : 'none';
        this._root.querySelector('#live-panel').style.display   = mode === 'live'   ? '' : 'none';
    }

    _setOrientation(ori) {
        this._orientation = ori;
        this._liveCanvas.setOrientation(ori);
        // Re-render active drawing tab if any
        this._rerenderActiveDrawing();
    }

    // ── Connection / registration ────────────────────────────────────────────

    async _cmdConnect() {
        this._setStatus('Connecting…');
        try {
            const { name, address } = await this._ble.connect();

            const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
            if (existing) {
                this._deviceInfo = JSON.parse(existing);
                this._setStatus(`Connected to ${this._deviceInfo.name}`);
            } else {
                this._setStatus('Registering — press the button on your device…');
                const info = await registerDevice(this._ble);
                this._deviceInfo = info;
                await saveDevice(info);
                localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(info));
                this._setStatus(`Registered: ${info.name}`);
                this._root.querySelector('#btn-forget').style.display = '';
            }

            this._updateDeviceLabel();
            this._root.querySelector('#btn-sync').disabled      = false;
            this._root.querySelector('#btn-start-live').disabled = false;
            this._root.querySelector('#btn-forget').style.display = '';
            await this._loadStoredDrawings();

        } catch (err) {
            if (err.name === 'NotFoundError') {
                this._setStatus('Not connected');
            } else {
                this._setStatus('Error: ' + err.message);
                console.error(err);
            }
        }
    }

    async _cmdForget() {
        if (!confirm('Forget device and clear all local drawings?')) return;
        localStorage.removeItem(DEVICE_STORAGE_KEY);
        localStorage.removeItem('pandaink_uuid');
        this._deviceInfo = null;
        this._drawings   = [];
        this._renderDrawingList();
        this._root.querySelector('#device-label').textContent      = 'No device';
        this._root.querySelector('#btn-sync').disabled             = true;
        this._root.querySelector('#btn-start-live').disabled       = true;
        this._root.querySelector('#btn-forget').style.display      = 'none';
        this._setStatus('Device forgotten');
    }

    _onDisconnect() {
        this._setStatus('Disconnected — click Connect to reconnect');
        if (this._liveSession) {
            this._liveSession.stop().catch(() => {});
            this._liveSession = null;
            this._root.querySelector('#btn-start-live').textContent = 'Start Live';
        }
    }

    // ── Sync ─────────────────────────────────────────────────────────────────

    async _cmdSync() {
        if (!this._deviceInfo) return;
        this._setStatus('Syncing…');
        const btn = this._root.querySelector('#btn-sync');
        btn.disabled = true;

        try {
            const drawings = await syncDrawings(this._ble, this._deviceInfo, {
                onProgress: (done, total) => this._setStatus(`Syncing ${done}/${total}…`),
            });

            for (const d of drawings) {
                const record = {
                    deviceId:   this._deviceInfo.id,
                    timestamp:  d.timestamp,
                    dimensions: this._deviceInfo.dimensions || [21000, 14800],
                    strokes:    d.strokes,
                };
                await saveDrawing(record);
            }

            this._setStatus(`Synced ${drawings.length} drawing(s)`);
            await this._loadStoredDrawings();

        } catch (err) {
            this._setStatus('Sync error: ' + err.message);
            console.error(err);
        } finally {
            btn.disabled = false;
        }
    }

    // ── Drawing tabs ─────────────────────────────────────────────────────────

    async _loadStoredDrawings() {
        if (!this._deviceInfo) return;
        this._drawings = await getDrawingsByDevice(this._deviceInfo.id);
        this._renderDrawingList();
    }

    _renderDrawingList() {
        const tabList    = this._root.querySelector('#tab-list');
        const tabContent = this._root.querySelector('#tab-content');

        tabList.innerHTML    = '';
        tabContent.innerHTML = '';

        if (this._drawings.length === 0) {
            tabContent.innerHTML =
                '<p class="placeholder">No drawings — connect your device and click Sync.</p>';
            return;
        }

        this._drawings.forEach((d, idx) => {
            const ts  = new Date(d.timestamp * 1000).toLocaleString();
            const tab = document.createElement('button');
            tab.className   = 'tab-btn';
            tab.textContent = ts + ' ×';
            tab.dataset.idx = idx;

            tab.addEventListener('click', (e) => {
                if (e.target.textContent.endsWith('×')) {
                    this._closeTab(idx);
                } else {
                    this._selectTab(idx);
                }
            });

            tabList.appendChild(tab);
        });

        this._selectTab(0);
    }

    _selectTab(idx) {
        this._activeDrawingIndex = idx;
        const drawing = this._drawings[idx];
        const content = this._root.querySelector('#tab-content');
        content.innerHTML = '';

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'tab-toolbar';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save SVG';
        saveBtn.addEventListener('click', () => {
            const ts  = new Date(drawing.timestamp * 1000).toLocaleString().replace(/[/:]/g, '-');
            const svg = drawingToSvg(drawing, this._orientation);
            downloadSvg(svg, `drawing_${ts}.svg`);
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => this._deleteDrawing(idx));

        toolbar.appendChild(saveBtn);
        toolbar.appendChild(delBtn);
        content.appendChild(toolbar);

        // Canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'drawing-canvas';
        content.appendChild(canvas);

        const dc = new DrawingCanvas(canvas, drawing, this._orientation);
        dc.render();
        this._activeDrawingCanvas = dc;

        // Highlight active tab
        this._root.querySelectorAll('.tab-btn').forEach((b, i) => {
            b.classList.toggle('active', i === idx);
        });
    }

    _closeTab(idx) {
        this._drawings.splice(idx, 1);
        this._renderDrawingList();
    }

    async _deleteDrawing(idx) {
        if (!confirm('Permanently delete this drawing?')) return;
        const drawing = this._drawings[idx];
        await deleteDrawing(drawing.id);
        this._drawings.splice(idx, 1);
        this._renderDrawingList();
    }

    _rerenderActiveDrawing() {
        if (this._activeDrawingCanvas) {
            this._activeDrawingCanvas.setOrientation(this._orientation);
        }
    }

    // ── Live mode ────────────────────────────────────────────────────────────

    async _cmdToggleLive() {
        if (this._liveSession) {
            await this._stopLive();
        } else {
            await this._startLive();
        }
    }

    async _startLive() {
        if (!this._deviceInfo) return;
        const btn = this._root.querySelector('#btn-start-live');
        btn.disabled = true;
        this._root.querySelector('#live-status').textContent = 'Starting…';

        try {
            this._liveCanvas.clear();
            this._liveSession = await startLive(
                this._ble,
                this._deviceInfo,
                (x, y, p, inProx) => this._liveCanvas.onPenPoint(x, y, p, inProx),
            );
            btn.textContent = 'Stop Live';
            btn.disabled    = false;
            this._root.querySelector('#live-status').textContent = 'Live mode active';
        } catch (err) {
            this._root.querySelector('#live-status').textContent = 'Error: ' + err.message;
            btn.disabled = false;
            console.error(err);
        }
    }

    async _stopLive() {
        if (!this._liveSession) return;
        await this._liveSession.stop().catch(() => {});
        this._liveSession = null;
        const btn = this._root.querySelector('#btn-start-live');
        btn.textContent = 'Start Live';
        this._root.querySelector('#live-status').textContent = 'Idle';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _setStatus(msg) {
        const el = this._root.querySelector('#status-bar');
        if (el) el.textContent = msg;
    }

    _updateDeviceLabel() {
        const el = this._root.querySelector('#device-label');
        if (el && this._deviceInfo) {
            el.textContent = `${this._deviceInfo.name || 'Unknown'}  ${this._deviceInfo.id}`;
        }
    }
}
