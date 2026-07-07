// W11 — UI state machine: Normal / Live modes.
// Wires BLE, Supabase auth, cloud storage, rendering and export together.

import { BleManager }     from '../ble/ble_manager.js';
import { registerDevice }  from '../ble/register.js';
import { syncDrawings }    from '../ble/sync.js';
import { startLive }       from '../ble/live.js';
import { DrawingCanvas }   from './drawing_canvas.js';
import { LiveCanvas }      from './live_canvas.js';
import { drawingToSvg, downloadSvg } from '../export/svg_export.js';
import { ProfilePanel }    from './profile_panel.js';

import {
    getUser, onAuthStateChange,
    signUpWithEmail, signInWithEmail, signInWithGoogle, signInWithGitHub,
    signOut, loadDevice, saveDevice, deleteDevice,
} from '../auth/auth_manager.js';

import {
    handleGDriveCallback, isDriveConnected,
} from '../auth/storage_oauth.js';

import {
    saveDrawing, getDrawingsByDevice, deleteDrawing,
} from '../storage/gdrive_store.js';

// ─────────────────────────────────────────────────────────────────────────────
// AppController
// ─────────────────────────────────────────────────────────────────────────────

export class AppController {
    constructor() {
        this._ble         = new BleManager();
        this._user        = null;
        this._deviceInfo  = null;
        this._mode        = 'normal';
        this._orientation = 'portrait';
        this._liveSession = null;
        this._drawings    = [];
        this._activeDrawingIndex = -1;
        this._liveCanvas  = null;
        this._profilePanel = null;

        this._ble.ondisconnect = () => this._onDisconnect();
    }

    // ── Entry point ──────────────────────────────────────────────────────────

    async mount(rootEl) {
        this._root = rootEl;

        // Handle Google Drive OAuth callback before rendering anything
        try {
            const wasDriveCallback = await handleGDriveCallback();
            if (wasDriveCallback) {
                // URL has been cleaned; fall through to normal render
            }
        } catch (e) {
            console.error('Drive callback error:', e);
        }

        // Check current auth state
        this._user = await getUser();

        // Subscribe to future auth changes (login / logout in another tab, etc.)
        onAuthStateChange((user) => {
            this._user = user;
            this._renderRoot();
        });

        await this._renderRoot();
    }

    async _renderRoot() {
        if (!this._user) {
            this._root.innerHTML = '';
            this._root.appendChild(this._buildAuthPanel());
        } else {
            await this._mountApp();
        }
    }

    // ── Auth panel ───────────────────────────────────────────────────────────

    _buildAuthPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'auth-overlay';
        overlay.innerHTML = `
<div class="auth-card">
  <h2>PandaInk</h2>
  <div id="auth-msg" class="auth-msg"></div>
  <div id="auth-form-login">
    <div style="display:flex;flex-direction:column;gap:0.6rem">
      <input id="auth-email"    type="email"    placeholder="Email address" autocomplete="email">
      <input id="auth-password" type="password" placeholder="Password"      autocomplete="current-password">
    </div>
    <button id="auth-btn-signin"  class="auth-btn-primary" style="margin-top:0.75rem">Sign in</button>
    <div class="auth-divider" style="margin:0.75rem 0">or</div>
    <div style="display:flex;flex-direction:column;gap:0.5rem">
      <button id="auth-btn-google" class="auth-btn-social">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </button>
      <button id="auth-btn-github" class="auth-btn-social">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a1a1a"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.11.82-.26.82-.58v-2.17c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
        Continue with GitHub
      </button>
    </div>
    <p class="auth-switch">No account? <a id="auth-to-register">Register</a></p>
  </div>

  <div id="auth-form-register" style="display:none">
    <div style="display:flex;flex-direction:column;gap:0.6rem">
      <input id="auth-reg-name"     type="text"     placeholder="Display name">
      <input id="auth-reg-email"    type="email"    placeholder="Email address" autocomplete="email">
      <input id="auth-reg-password" type="password" placeholder="Password (min 8 chars)" autocomplete="new-password">
    </div>
    <button id="auth-btn-register" class="auth-btn-primary" style="margin-top:0.75rem">Create account</button>
    <p class="auth-switch" style="margin-top:0.75rem">Already have an account? <a id="auth-to-login">Sign in</a></p>
  </div>
</div>`;

        const msg = (text, isErr) => {
            const el = overlay.querySelector('#auth-msg');
            el.textContent  = text;
            el.className    = 'auth-msg ' + (isErr ? 'auth-msg-error' : 'auth-msg-ok');
            el.style.display = text ? '' : 'none';
        };

        overlay.querySelector('#auth-to-register').addEventListener('click', () => {
            overlay.querySelector('#auth-form-login').style.display    = 'none';
            overlay.querySelector('#auth-form-register').style.display = '';
            msg('', false);
        });
        overlay.querySelector('#auth-to-login').addEventListener('click', () => {
            overlay.querySelector('#auth-form-register').style.display = 'none';
            overlay.querySelector('#auth-form-login').style.display    = '';
            msg('', false);
        });

        overlay.querySelector('#auth-btn-signin').addEventListener('click', async () => {
            const email = overlay.querySelector('#auth-email').value.trim();
            const pw    = overlay.querySelector('#auth-password').value;
            if (!email || !pw) { msg('Enter email and password.', true); return; }
            const { error } = await signInWithEmail(email, pw);
            if (error) msg(error.message, true);
        });

        overlay.querySelector('#auth-btn-google').addEventListener('click', async () => {
            const { error } = await signInWithGoogle();
            if (error) msg(error.message, true);
        });

        overlay.querySelector('#auth-btn-github').addEventListener('click', async () => {
            const { error } = await signInWithGitHub();
            if (error) msg(error.message, true);
        });

        overlay.querySelector('#auth-btn-register').addEventListener('click', async () => {
            const name  = overlay.querySelector('#auth-reg-name').value.trim();
            const email = overlay.querySelector('#auth-reg-email').value.trim();
            const pw    = overlay.querySelector('#auth-reg-password').value;
            if (!email || !pw) { msg('Enter email and password.', true); return; }
            if (pw.length < 8) { msg('Password must be at least 8 characters.', true); return; }
            const { error } = await signUpWithEmail(email, pw, name);
            if (error) msg(error.message, true);
            else msg('Account created! Check your email to confirm.', false);
        });

        return overlay;
    }

    // ── App shell ────────────────────────────────────────────────────────────

    async _mountApp() {
        this._root.innerHTML = this._buildAppHTML();
        this._bindAppEvents();

        // Auth toolbar
        this._renderAuthToolbar();

        // Load device config from Supabase
        const { data: device } = await loadDevice(this._user.id);
        if (device) {
            this._deviceInfo = {
                id:       device.id,
                name:     device.device_name ?? 'Wacom device',
                uuid:     device.wacom_uuid,
                protocol: device.protocol,
            };
            this._updateDeviceLabel();
            this._setStatus('Device loaded — click Connect to reconnect');
            this._root.querySelector('#btn-sync').disabled      = false;
            this._root.querySelector('#btn-start-live').disabled = false;
            this._root.querySelector('#btn-forget').style.display = '';
            await this._loadStoredDrawings();
        }
    }

    _buildAppHTML() {
        return `
<div id="auth-toolbar" class="auth-toolbar"></div>

<div class="app-toolbar">
  <span id="device-conn-dot" class="conn-dot conn-dot-off" title="Not connected"></span>
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
</div>`;
    }

    _renderAuthToolbar() {
        const bar = this._root.querySelector('#auth-toolbar');
        if (!bar || !this._user) return;
        const initial = (this._user.email ?? '?')[0].toUpperCase();
        bar.innerHTML = `
<div class="auth-avatar">${initial}</div>
<span class="auth-email">${this._user.email ?? ''}</span>
<button id="btn-profile">⚙ Profile</button>
<button id="btn-signout">Sign out</button>`;
        bar.querySelector('#btn-profile').addEventListener('click', () => this._openProfile());
        bar.querySelector('#btn-signout').addEventListener('click', async () => {
            await signOut();
        });
    }

    // ── Event binding ────────────────────────────────────────────────────────

    _bindAppEvents() {
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
        this._rerenderActiveDrawing();
    }

    // ── Profile panel ────────────────────────────────────────────────────────

    _openProfile() {
        this._profilePanel = new ProfilePanel(
            this._user,
            () => { this._profilePanel = null; },
            () => {
                // Device forgotten from profile panel
                this._deviceInfo = null;
                this._drawings   = [];
                this._renderDrawingList();
                this._updateDeviceLabel();
                this._root.querySelector('#btn-sync').disabled      = true;
                this._root.querySelector('#btn-start-live').disabled = true;
                this._root.querySelector('#btn-forget').style.display = 'none';
                this._setStatus('Device forgotten');
            },
        );
        this._profilePanel.open();
    }

    // ── Connection / registration ────────────────────────────────────────────

    async _cmdConnect() {
        this._setStatus('Connecting…');
        try {
            await this._ble.connect();

            if (this._deviceInfo) {
                // Already registered — just reconnect
                this._setStatus(`Connected to ${this._deviceInfo.name}`);
            } else {
                this._setStatus('Registering — press the button on your device…');
                const info = await registerDevice(this._ble);
                // Save to Supabase
                const { data, error } = await saveDevice(this._user.id, {
                    wacom_uuid:  info.uuid,
                    protocol:    info.protocol,
                    device_name: info.name,
                });
                if (error) throw new Error('Failed to save device: ' + error.message);
                this._deviceInfo = {
                    id:       data.id,
                    name:     data.device_name ?? info.name,
                    uuid:     data.wacom_uuid,
                    protocol: data.protocol,
                };
                this._setStatus(`Registered: ${this._deviceInfo.name}`);
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
        if (!confirm('Forget this device? Your cloud drawings will not be deleted.')) return;
        await deleteDevice(this._user.id);

        this._deviceInfo = null;
        this._drawings   = [];
        this._renderDrawingList();
        this._updateDeviceLabel();
        this._root.querySelector('#btn-sync').disabled      = true;
        this._root.querySelector('#btn-start-live').disabled = true;
        this._root.querySelector('#btn-forget').style.display = 'none';
        this._setStatus('Device forgotten');
    }

    _onDisconnect() {
        this._setStatus('Disconnected — click Connect to reconnect');
        this._updateConnDot();
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
            const connected = await isDriveConnected();
            if (!connected) {
                this._setStatus('Connect Google Drive in Profile → Cloud Storage first.');
                return;
            }

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
        try {
            const connected = await isDriveConnected();
            if (!connected) return;
            this._setStatus('Loading drawings…');
            this._drawings = await getDrawingsByDevice(this._deviceInfo.id);
            this._renderDrawingList();
            if (this._drawings.length === 0) this._setStatus('No drawings yet.');
            else this._setStatus(`${this._drawings.length} drawing(s) loaded.`);
        } catch (e) {
            this._setStatus('Could not load drawings: ' + e.message);
        }
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
                if (e.target.textContent.endsWith('×')) this._closeTab(idx);
                else this._selectTab(idx);
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

        const canvas = document.createElement('canvas');
        canvas.className = 'drawing-canvas';
        content.appendChild(canvas);

        const dc = new DrawingCanvas(canvas, drawing, this._orientation);
        dc.render();
        this._activeDrawingCanvas = dc;

        this._root.querySelectorAll('.tab-btn').forEach((b, i) => {
            b.classList.toggle('active', i === idx);
        });
    }

    _closeTab(idx) {
        this._drawings.splice(idx, 1);
        this._renderDrawingList();
    }

    async _deleteDrawing(idx) {
        if (!confirm('Permanently delete this drawing from Google Drive?')) return;
        const drawing = this._drawings[idx];
        try {
            await deleteDrawing(drawing.driveFileId);
            this._drawings.splice(idx, 1);
            this._renderDrawingList();
        } catch (e) {
            this._setStatus('Delete failed: ' + e.message);
        }
    }

    _rerenderActiveDrawing() {
        if (this._activeDrawingCanvas) {
            this._activeDrawingCanvas.setOrientation(this._orientation);
        }
    }

    // ── Live mode ────────────────────────────────────────────────────────────

    async _cmdToggleLive() {
        if (this._liveSession) await this._stopLive();
        else await this._startLive();
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
        if (el) el.textContent = this._deviceInfo?.name ?? 'No device';
        this._updateConnDot();
    }

    _updateConnDot() {
        const dot = this._root.querySelector('#device-conn-dot');
        if (!dot) return;
        const connected = this._ble.isConnected();
        dot.classList.toggle('conn-dot-on', connected);
        dot.classList.toggle('conn-dot-off', !connected);
        dot.title = connected ? 'Connected' : 'Not connected';
    }
}
