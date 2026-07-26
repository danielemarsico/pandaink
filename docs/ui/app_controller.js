// W11 — UI state machine: Normal / Live modes.
// Wires BLE, Supabase auth, cloud storage, rendering and export together.

import { BleManager }     from '../ble/ble_manager.js';
import { registerDevice }  from '../ble/register.js';
import { syncDrawings }    from '../ble/sync.js';
import { startLive }       from '../ble/live.js';
import { publishLiveSession, subscribeLiveSession, newSessionId } from '../ble/live_share.js';
import { hasWorker }       from '../config.js';
import { DrawingCanvas }   from './drawing_canvas.js';
import { LiveCanvas }      from './live_canvas.js';
import { drawingToSvg, downloadSvg, drawingToPngBlob, drawingToPdfBlob, downloadBlob } from '../export/svg_export.js';
import { ProfilePanel }    from './profile_panel.js';

import {
    getUser, onAuthStateChange, onPasswordRecovery,
    signUpWithEmail, signInWithEmail, signInWithGoogle, signInWithGitHub,
    resetPasswordForEmail, updatePassword,
    signOut, loadDevice, saveDevice, deleteDevice,
} from '../auth/auth_manager.js';

import { handleGDriveCallback }   from '../auth/storage_oauth.js';
import { handleDropboxCallback }  from '../auth/dropbox_oauth.js';

// Local IndexedDB store — always available, the source of truth for the UI.
import * as localStore from '../storage/idb_store.js';
// Cloud abstraction — the active tier-gated provider (Supabase / Drive / Dropbox).
import * as cloudStore  from '../storage/cloud_store.js';

// True for network-level failures (offline, DNS, CORS-preflight) as opposed to
// auth/API errors returned by the provider itself -- fetch() rejects with a
// TypeError in this case (exact message varies by browser: "Failed to fetch",
// "NetworkError when attempting to fetch resource.", "Load failed").
function isNetworkError(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return e instanceof TypeError;
}

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
        this._liveShare   = null;   // active publisher, when sharing is on
        this._viewer      = null;   // active viewer subscription, when watching
        this._drawings    = [];
        this._cloudOn     = false;   // active provider connected? (for tab badges)
        this._selectMode  = false;   // merge-selection mode active?
        this._selected    = new Set();   // selected drawing timestamps (stable key)
        this._automerge   = localStorage.getItem('pandaink.automerge') === '1';
        this._activeDrawingIndex = -1;
        this._liveCanvas  = null;
        this._profilePanel = null;

        this._ble.ondisconnect = () => this._onDisconnect();
    }

    // ── Entry point ──────────────────────────────────────────────────────────

    async mount(rootEl) {
        this._root = rootEl;

        // Handle cloud OAuth callbacks (Google Drive / Dropbox) before rendering.
        try { await handleGDriveCallback(); }   catch (e) { console.error('Drive callback error:', e); }
        try { await handleDropboxCallback(); }  catch (e) { console.error('Dropbox callback error:', e); }

        // Check current auth state
        this._user = await getUser();

        // Subscribe to future auth changes (login / logout in another tab, etc.)
        onAuthStateChange((user) => {
            this._user = user;
            cloudStore.clearProfileCache();
            this._renderRoot();
        });

        // Show a set-new-password panel when the user returns via a reset email.
        onPasswordRecovery(() => this._showRecoveryPanel());

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
    <p class="auth-switch"><a id="auth-forgot">Forgot password?</a></p>
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
            // Use an explicit 'block' rather than '' — clearing the inline style
            // would fall back to the stylesheet's `.auth-msg { display: none }`,
            // leaving errors and the "Account created" confirmation invisible.
            el.style.display = text ? 'block' : 'none';
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

        overlay.querySelector('#auth-forgot').addEventListener('click', async () => {
            const email = overlay.querySelector('#auth-email').value.trim();
            if (!email) { msg('Enter your email above first, then click "Forgot password?".', true); return; }
            const { error } = await resetPasswordForEmail(email);
            msg(error ? error.message : 'Password reset email sent — check your inbox.', !!error);
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

    // Shown when the user follows a password-reset email link (recovery session).
    _showRecoveryPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'auth-overlay';
        overlay.innerHTML = `
<div class="auth-card">
  <h2>Set a new password</h2>
  <div id="rec-msg" class="auth-msg"></div>
  <input id="rec-password" type="password" placeholder="New password (min 8 chars)" autocomplete="new-password">
  <button id="rec-save" class="auth-btn-primary" style="margin-top:0.75rem">Update password</button>
</div>`;
        this._root.innerHTML = '';
        this._root.appendChild(overlay);

        const msg = (t, err) => {
            const el = overlay.querySelector('#rec-msg');
            el.textContent = t;
            el.className = 'auth-msg ' + (err ? 'auth-msg-error' : 'auth-msg-ok');
            el.style.display = t ? 'block' : 'none';
        };
        overlay.querySelector('#rec-save').addEventListener('click', async () => {
            const pw = overlay.querySelector('#rec-password').value;
            if (!pw || pw.length < 8) { msg('Password must be at least 8 characters.', true); return; }
            const { error } = await updatePassword(pw);
            if (error) { msg(error.message, true); return; }
            msg('Password updated. Loading your app…', false);
            this._user = await getUser();
            await this._renderRoot();
        });
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

        // If opened via a share link (?watch=<id>), join as a viewer.
        await this._maybeStartViewer();
    }

    async _maybeStartViewer() {
        const sessionId = new URLSearchParams(window.location.search).get('watch');
        if (!sessionId) return;
        this._setMode('live');
        const liveRadio = this._root.querySelector('input[name="mode"][value="live"]');
        if (liveRadio) liveRadio.checked = true;
        this._root.querySelector('#btn-start-live').style.display = 'none';
        this._root.querySelector('#live-status').textContent = 'Connecting to live session…';
        try {
            this._liveCanvas.clear();
            this._viewer = await subscribeLiveSession(sessionId, (x, y, p, inProx) =>
                this._liveCanvas.onPenPoint(x, y, p, inProx));
            this._root.querySelector('#live-status').textContent = 'Watching a live session';
        } catch (e) {
            this._root.querySelector('#live-status').textContent = 'Could not join session: ' + e.message;
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
    <button id="btn-cloud-sync" style="display:none">Sync now (cloud)</button>
    <button id="btn-forget" style="display:none">Forget device</button>
    <span class="action-bar-sep"></span>
    <button id="btn-select">Select</button>
    <button id="btn-merge" style="display:none">Merge</button>
    <label class="automerge-toggle" title="Save all new drawings into one canvas">
      <input type="checkbox" id="automerge"> Automerge
    </label>
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
    <label id="live-share-wrap" class="live-share-toggle" style="display:none">
      <input type="checkbox" id="live-share"> Share this session
    </label>
  </div>
  <div id="live-share-link" class="live-share-link" style="display:none"></div>
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
        r('#btn-cloud-sync').addEventListener('click', () => this._cmdCloudSync());
        r('#btn-forget').addEventListener('click',  () => this._cmdForget());
        r('#btn-start-live').addEventListener('click', () => this._cmdToggleLive());
        r('#btn-select').addEventListener('click',  () => this._toggleSelectMode());
        r('#btn-merge').addEventListener('click',   () => this._cmdMerge());

        const automergeEl = r('#automerge');
        automergeEl.checked = this._automerge;
        automergeEl.addEventListener('change', (e) => this._setAutomerge(e.target.checked));

        this._root.querySelectorAll('input[name="mode"]').forEach((radio) => {
            radio.addEventListener('change', (e) => this._setMode(e.target.value));
        });
        this._root.querySelectorAll('input[name="orientation"]').forEach((radio) => {
            radio.addEventListener('change', (e) => this._setOrientation(e.target.value));
        });

        const liveEl = r('#live-canvas');
        this._liveCanvas = new LiveCanvas(liveEl, { orientation: this._orientation });

        // Live sharing is only offered when a backend (Worker) is configured.
        if (hasWorker()) r('#live-share-wrap').style.display = '';
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

    // BLE GATT connections don't survive a page reload — a device loaded from
    // Supabase looks "registered" but this._ble has no live connection yet.
    // Sync/Live must reconnect (which reopens the device picker) before using
    // any GATT characteristic, or they crash deep inside sync.js/live.js.
    async _ensureBleConnected() {
        if (this._ble.isConnected()) return;
        await this._ble.connect();
        this._updateConnDot();
    }

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
            await this._ensureBleConnected();

            const cloudOn      = await this._isCloudOn();
            const providerName = cloudOn ? await cloudStore.activeProviderName(this._user.id) : null;
            let saved = 0;
            let uploaded = 0;
            let pending  = 0;
            let capHit   = false;

            // Persist each drawing the instant it's parsed — inside the sync loop,
            // BEFORE the device is told to delete it. The device only exposes the
            // oldest file and deleting it is the only way to advance, so saving
            // after the whole sync would risk losing every downloaded-but-unsaved
            // drawing if anything failed partway. If saveDrawing throws, the error
            // propagates and syncDrawings stops without deleting that file.
            const { drawings } = await syncDrawings(this._ble, this._deviceInfo, {
                onProgress: (done, total) => this._setStatus(`Syncing ${done}/${total}…`),
                onConnectWait: (secondsLeft) =>
                    this._setStatus(`Press the button on the device (LED solid green) to start sync… (${secondsLeft}s)`),
                onDrawing: async (d) => {
                    const record = {
                        deviceId:    this._deviceInfo.id,
                        timestamp:   d.timestamp,
                        dimensions:  d.dimensions,
                        strokes:     d.strokes,
                        uploaded:    false,
                        driveFileId: null,
                        name:        null,
                    };
                    // Automerge folds strokes into one canvas; otherwise each
                    // drawing is its own record. Local save always happens first
                    // (before the device deletes the file), then cloud upload.
                    const res = await this._persistSyncedDrawing(record, cloudOn);
                    saved++;
                    this._setStatus(`Saved ${saved} drawing(s)…`);
                    if (cloudOn) {
                        if (res.uploaded) uploaded++; else pending++;
                        if (res.capHit) capHit = true;
                    }
                },
            });

            let status = `Synced ${drawings.length} drawing(s) — saved locally`;
            if (cloudOn) {
                status += `; ${uploaded} uploaded to ${providerName}`;
                if (pending) status += `, ${pending} pending (kept locally)`;
                if (capHit) status += ' — free-plan limit reached; delete old drawings or upgrade to Pro';
            }
            this._setStatus(status);
            await this._loadStoredDrawings();

        } catch (err) {
            if (err.code === 'DEVICE_NOT_READY') {
                // Expected, recoverable state — present as guidance, not a crash.
                this._setStatus(err.message);
            } else {
                this._setStatus('Sync error: ' + err.message);
                console.error(err);
            }
        } finally {
            btn.disabled = false;
        }
    }

    // ── Automerge ──────────────────────────────────────────────────────────────

    _automergeKey() { return `pandaink.automergeTarget.${this._deviceInfo?.id}`; }

    _getAutomergeTarget() {
        const v = localStorage.getItem(this._automergeKey());
        return v ? Number(v) : null;
    }

    _setAutomergeTarget(id) {
        if (id == null) localStorage.removeItem(this._automergeKey());
        else localStorage.setItem(this._automergeKey(), String(id));
    }

    _setAutomerge(on) {
        this._automerge = on;
        localStorage.setItem('pandaink.automerge', on ? '1' : '0');
        // Starting (or stopping) automerge begins a fresh merged canvas: forget
        // the current target so the next synced drawing starts a new record.
        this._setAutomergeTarget(null);
        this._setStatus(on
            ? 'Automerge on — new drawings append to one canvas.'
            : 'Automerge off — new drawings save separately.');
    }

    // Persist one freshly-synced drawing. With automerge on, its strokes are
    // appended to the current target record (created lazily from the first
    // drawing after the switch is enabled); otherwise it becomes its own record.
    // Returns { uploaded, pending, capHit } describing the cloud outcome.
    async _persistSyncedDrawing(record, cloudOn) {
        const out = { uploaded: false, pending: false, capHit: false };

        let target = null;
        if (this._automerge) {
            const targetId = this._getAutomergeTarget();
            if (targetId != null) {
                const existing = await localStore.getDrawing(targetId);
                if (existing && existing.deviceId === record.deviceId) target = existing;
            }
        }

        let toUpload;
        if (target) {
            target.strokes  = target.strokes.concat(record.strokes);
            target.uploaded = false;   // strokes changed — cloud copy is now stale
            await localStore.updateDrawing(target);
            toUpload = target;
        } else {
            const id = await localStore.saveDrawing(record);
            record.id = id;
            if (this._automerge) this._setAutomergeTarget(id);
            toUpload = record;
        }

        if (cloudOn) {
            try {
                const up = await cloudStore.saveDrawing(this._user.id, toUpload);
                await localStore.updateDrawing({ ...toUpload, uploaded: true, driveFileId: up.driveFileId });
                out.uploaded = true;
            } catch (e) {
                if (e.code === 'CAP_REACHED') out.capHit = true;
                console.warn('Cloud upload failed, kept locally:', e);
                out.pending = true;
            }
        }
        return out;
    }

    // ── Drawing tabs ─────────────────────────────────────────────────────────

    async _loadStoredDrawings() {
        if (!this._deviceInfo) return;
        this._cloudOffline = false;
        this._uploadError  = null;
        try {
            this._setStatus('Loading drawings…');
            // Local store is the source of truth — always works, cloud or not.
            this._drawings = await localStore.getDrawingsByDevice(this._deviceInfo.id);
            this._renderDrawingList();

            const cloudOn = await this._isCloudOn();
            this._cloudOn = cloudOn;
            this._renderDrawingList();
            const cloudBtn = this._root.querySelector('#btn-cloud-sync');
            if (cloudBtn) cloudBtn.style.display = cloudOn ? '' : 'none';

            // With a provider connected: pull cloud-only drawings into the local
            // list (cross-device), then retry any local pending uploads.
            if (cloudOn) {
                const prevLabel = cloudBtn?.textContent;
                if (cloudBtn) { cloudBtn.disabled = true; cloudBtn.textContent = 'Checking cloud…'; }
                this._setStatus(`${this._drawings.length} drawing(s) loaded locally — checking cloud for others…`);
                try {
                    await this._reconcileCloud();
                    await this._retryPendingUploads();
                } finally {
                    if (cloudBtn) { cloudBtn.disabled = false; cloudBtn.textContent = prevLabel; }
                }
                // _retryPendingUploads() flips d.uploaded on drawings already in
                // this._drawings without re-rendering -- refresh the tab badges
                // (☁↑ -> ☁✓) now that uploads may have completed.
                this._renderDrawingList();
            }

            const total = this._drawings.length;
            if (total === 0) {
                this._setStatus(this._cloudOffline
                    ? 'Offline — connect to load drawings from the cloud.'
                    : 'No drawings yet.');
                return;
            }

            const pending = this._drawings.filter((d) => !d.uploaded).length;
            if (this._cloudOffline) {
                this._setStatus(`${total} drawing(s) loaded locally (offline — cloud drawings unavailable).`);
            } else if (this._uploadError) {
                this._setStatus(`${total} drawing(s) loaded (${pending} not yet in cloud — ${this._uploadError}).`);
            } else if (pending && cloudOn) {
                this._setStatus(`${total} drawing(s) loaded (${pending} not yet in cloud).`);
            } else {
                this._setStatus(`${total} drawing(s) loaded.`);
            }
        } catch (e) {
            this._setStatus('Could not load drawings: ' + e.message);
        }
    }

    // Manual "Sync now": force a cloud pull + pending push, then reload.
    async _cmdCloudSync() {
        if (!this._deviceInfo) return;
        if (!await this._isCloudOn()) { this._setStatus('No cloud provider connected.'); return; }
        const btn = this._root.querySelector('#btn-cloud-sync');
        btn.disabled = true;
        this._setStatus('Syncing with cloud…');
        try {
            await this._loadStoredDrawings();
            // Don't stomp a more specific status (offline / upload error) that
            // _loadStoredDrawings() already set -- only claim success when
            // nothing actually went wrong.
            if (!this._cloudOffline && !this._uploadError) {
                this._setStatus('Cloud sync complete.');
            }
        } catch (e) {
            this._setStatus('Cloud sync failed: ' + e.message);
        } finally {
            btn.disabled = false;
        }
    }

    // Download cloud drawings with no local copy (synced from another device) and
    // cache them in IndexedDB as already-uploaded. Local stays the render source.
    async _reconcileCloud() {
        try {
            const cloud = await cloudStore.getDrawingsByDevice(this._user.id, this._deviceInfo.id);
            const known = new Set(this._drawings.map((d) => d.timestamp));
            let added = 0;
            for (const c of cloud) {
                if (known.has(c.timestamp)) continue;
                await localStore.saveDrawing({
                    deviceId:    this._deviceInfo.id,
                    timestamp:   c.timestamp,
                    dimensions:  c.dimensions,
                    strokes:     c.strokes,
                    uploaded:    true,
                    driveFileId: c.driveFileId ?? null,
                });
                added++;
            }
            if (added) {
                this._drawings = await localStore.getDrawingsByDevice(this._deviceInfo.id);
                this._renderDrawingList();
            }
        } catch (e) {
            console.warn('Cloud reconciliation failed:', e);
            if (isNetworkError(e)) this._cloudOffline = true;
        }
    }

    // Upload any locally-saved drawings that never made it to the cloud. Runs only
    // when a provider is connected. A free-tier cap error or a network error stops
    // the loop early (every remaining item would fail the same way); any other
    // per-drawing failure is logged, left pending, and recorded in this._uploadError
    // so the caller can surface it instead of falsely reporting success.
    async _retryPendingUploads() {
        let failed = 0;
        for (const d of this._drawings) {
            if (d.uploaded) continue;
            try {
                const saved = await cloudStore.saveDrawing(this._user.id, d);
                await localStore.updateDrawing({ ...d, uploaded: true, driveFileId: saved.driveFileId });
                d.uploaded    = true;
                d.driveFileId = saved.driveFileId;
            } catch (e) {
                console.warn('Pending upload retry failed:', e);
                if (e.code === 'CAP_REACHED') { this._uploadError = e.message; break; }
                if (isNetworkError(e)) { this._cloudOffline = true; break; }
                failed++;
                this._uploadError = e.message;
            }
        }
        if (failed > 1) this._uploadError = `${failed} uploads failed, last error: ${this._uploadError}`;
    }

    // Whether the active cloud provider is connected. Any error (offline, no
    // session, provider gated) is treated as "not connected" so local keeps working.
    async _isCloudOn() {
        try {
            return await cloudStore.isCloudConnected(this._user.id);
        } catch {
            return false;
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
            const tab = document.createElement('div');
            tab.className   = 'tab-btn';
            tab.dataset.idx = idx;

            // Merge-selection checkbox — only shown while in Select mode.
            if (this._selectMode) {
                const check = document.createElement('input');
                check.type    = 'checkbox';
                check.className = 'tab-check';
                check.checked = this._selected.has(d.timestamp);
                check.title   = 'Select for merge';
                check.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (check.checked) this._selected.add(d.timestamp);
                    else               this._selected.delete(d.timestamp);
                });
                tab.appendChild(check);
            }

            // Selecting and closing are separate targets: a single button whose
            // whole label ended with "×" made every tap close the tab.
            const badge = document.createElement('span');
            const b = this._badgeFor(d);
            badge.className   = 'tab-badge ' + b.cls;
            badge.textContent = b.icon;
            badge.title       = b.title;

            const label = document.createElement('span');
            label.className   = 'tab-label';
            label.textContent = this._drawingLabel(d);
            label.addEventListener('click', () => this._selectTab(idx));

            const close = document.createElement('span');
            close.className   = 'tab-close';
            close.textContent = '×';
            close.title       = 'Close tab';
            close.addEventListener('click', (e) => {
                e.stopPropagation();
                this._closeTab(idx);
            });

            tab.appendChild(badge);
            tab.appendChild(label);
            tab.appendChild(close);
            tabList.appendChild(tab);
        });

        this._selectTab(0);
    }

    // A drawing's display label: its user-set name, or a formatted timestamp.
    _drawingLabel(d) {
        if (d.name && d.name.trim()) return d.name;
        return new Date(d.timestamp * 1000).toLocaleString();
    }

    // Cloud sync badge for a drawing tab.
    _badgeFor(d) {
        if (d.uploaded)     return { icon: '☁✓', cls: 'badge-synced',  title: 'Synced to cloud' };
        if (this._cloudOn)  return { icon: '☁↑', cls: 'badge-pending', title: 'Pending upload to cloud' };
        return                     { icon: '●',  cls: 'badge-local',   title: 'Saved on this device only' };
    }

    _selectTab(idx) {
        this._activeDrawingIndex = idx;
        const drawing = this._drawings[idx];
        const content = this._root.querySelector('#tab-content');
        content.innerHTML = '';

        const toolbar = document.createElement('div');
        toolbar.className = 'tab-toolbar';

        const baseName = () =>
            `drawing_${this._drawingLabel(drawing).replace(/[/:\\?%*|"<>]/g, '-')}`;

        const svgBtn = document.createElement('button');
        svgBtn.textContent = 'Save SVG';
        svgBtn.addEventListener('click', () => {
            downloadSvg(drawingToSvg(drawing, this._orientation), `${baseName()}.svg`);
        });

        const pngBtn = document.createElement('button');
        pngBtn.textContent = 'Save PNG';
        pngBtn.addEventListener('click', async () => {
            pngBtn.disabled = true;
            try {
                const blob = await drawingToPngBlob(drawing, this._orientation);
                downloadBlob(blob, `${baseName()}.png`);
            } catch (e) {
                alert('PNG export failed: ' + (e && e.message ? e.message : e));
            } finally {
                pngBtn.disabled = false;
            }
        });

        const pdfBtn = document.createElement('button');
        pdfBtn.textContent = 'Save PDF';
        pdfBtn.addEventListener('click', async () => {
            pdfBtn.disabled = true;
            try {
                const blob = await drawingToPdfBlob(drawing, this._orientation);
                downloadBlob(blob, `${baseName()}.pdf`);
            } catch (e) {
                alert('PDF export failed: ' + (e && e.message ? e.message : e));
            } finally {
                pdfBtn.disabled = false;
            }
        });

        const renameBtn = document.createElement('button');
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => this._renameDrawing(idx));

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => this._deleteDrawing(idx));

        toolbar.appendChild(svgBtn);
        toolbar.appendChild(pngBtn);
        toolbar.appendChild(pdfBtn);
        toolbar.appendChild(renameBtn);
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
        if (!confirm('Permanently delete this drawing?')) return;
        const drawing = this._drawings[idx];
        try {
            if (drawing.id != null) await localStore.deleteDrawing(drawing.id);
            // Also remove the cloud copy if there is one and a provider is connected.
            if (drawing.driveFileId && await this._isCloudOn()) {
                try {
                    await cloudStore.deleteDrawing(this._user.id, drawing.driveFileId);
                } catch (e) {
                    console.warn('Cloud delete failed (local copy removed):', e);
                }
            }
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

    // ── Rename ─────────────────────────────────────────────────────────────────

    async _renameDrawing(idx) {
        const drawing = this._drawings[idx];
        const current = drawing.name ?? '';
        const input = prompt('New name (leave blank to use the timestamp):', current);
        if (input === null) return;   // cancelled
        const name = input.trim() || null;
        try {
            drawing.name = name;
            await localStore.updateDrawing(drawing);
            // Keep the cloud copy in sync (best-effort) so the name follows the
            // drawing across devices.
            if (drawing.driveFileId && await this._isCloudOn()) {
                try {
                    const up = await cloudStore.saveDrawing(this._user.id, drawing);
                    await localStore.updateDrawing({ ...drawing, driveFileId: up.driveFileId });
                } catch (e) {
                    console.warn('Cloud rename sync failed (local name saved):', e);
                }
            }
            this._renderDrawingList();
            this._selectTab(idx);
            this._setStatus(`Renamed to "${this._drawingLabel(drawing)}".`);
        } catch (e) {
            this._setStatus('Rename failed: ' + e.message);
        }
    }

    // ── Merge selection ────────────────────────────────────────────────────────

    _toggleSelectMode() {
        this._selectMode = !this._selectMode;
        if (!this._selectMode) this._selected.clear();
        this._root.querySelector('#btn-select').textContent = this._selectMode ? 'Cancel' : 'Select';
        this._root.querySelector('#btn-merge').style.display = this._selectMode ? '' : 'none';
        this._renderDrawingList();
        if (this._selectMode) this._setStatus('Select drawings to merge, then click Merge.');
    }

    async _cmdMerge() {
        const selected = this._drawings
            .filter((d) => this._selected.has(d.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);

        if (selected.length < 2) {
            alert('Select at least two drawings to merge.');
            return;
        }
        if (!confirm(
                `Merge ${selected.length} drawings into a single drawing?\n\n` +
                'The originals will be permanently deleted. This cannot be undone.')) {
            return;
        }

        try {
            // Fresh, non-colliding timestamp for the merged drawing.
            const existing = new Set(this._drawings.map((d) => d.timestamp));
            let newTs = Math.floor(Date.now() / 1000);
            while (existing.has(newTs)) newTs++;

            const merged = {
                deviceId:    this._deviceInfo.id,
                timestamp:   newTs,
                dimensions:  selected[0].dimensions,
                strokes:     selected.flatMap((d) => d.strokes),
                uploaded:    false,
                driveFileId: null,
                name:        null,
            };

            const id = await localStore.saveDrawing(merged);
            merged.id = id;

            const cloudOn = await this._isCloudOn();
            if (cloudOn) {
                try {
                    const up = await cloudStore.saveDrawing(this._user.id, merged);
                    await localStore.updateDrawing({ ...merged, uploaded: true, driveFileId: up.driveFileId });
                } catch (e) {
                    console.warn('Cloud upload of merged drawing failed (kept locally):', e);
                }
            }

            // Delete the originals (local + cloud) now the merged copy is saved.
            for (const d of selected) {
                if (d.id != null) await localStore.deleteDrawing(d.id);
                if (d.driveFileId && cloudOn) {
                    try { await cloudStore.deleteDrawing(this._user.id, d.driveFileId); }
                    catch (e) { console.warn('Cloud delete failed during merge:', e); }
                }
                if (this._getAutomergeTarget() === d.id) this._setAutomergeTarget(null);
            }

            this._selectMode = false;
            this._selected.clear();
            this._root.querySelector('#btn-select').textContent = 'Select';
            this._root.querySelector('#btn-merge').style.display = 'none';
            await this._loadStoredDrawings();
            this._setStatus(`Merged ${selected.length} drawings into one.`);
        } catch (e) {
            this._setStatus('Merge failed: ' + e.message);
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
            await this._ensureBleConnected();

            this._liveCanvas.clear();

            // Optionally publish this session to viewers via the Worker.
            const shareOn = hasWorker() && this._root.querySelector('#live-share')?.checked;
            if (shareOn) {
                const sessionId = newSessionId();
                try {
                    this._liveShare = await publishLiveSession(sessionId);
                    this._showShareLink(sessionId);
                } catch (e) {
                    this._liveShare = null;
                    this._showShareError(e.message);
                }
            }

            this._liveSession = await startLive(
                this._ble,
                this._deviceInfo,
                (x, y, p, inProx) => {
                    this._liveCanvas.onPenPoint(x, y, p, inProx);
                    if (this._liveShare) this._liveShare.send(x, y, p, inProx);
                },
            );
            btn.textContent = 'Stop Live';
            btn.disabled    = false;
            this._root.querySelector('#live-status').textContent =
                this._liveShare ? 'Live mode active — sharing' : 'Live mode active';
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
        if (this._liveShare) { this._liveShare.close(); this._liveShare = null; }
        const link = this._root.querySelector('#live-share-link');
        if (link) link.style.display = 'none';
        const btn = this._root.querySelector('#btn-start-live');
        btn.textContent = 'Start Live';
        this._root.querySelector('#live-status').textContent = 'Idle';
    }

    _showShareLink(sessionId) {
        const el = this._root.querySelector('#live-share-link');
        if (!el) return;
        const url = `${window.location.origin}${window.location.pathname}?watch=${encodeURIComponent(sessionId)}`;
        el.innerHTML = `Share this link (viewers must be signed in): <input class="live-share-url" readonly value="${url}">`;
        el.style.display = '';
        const input = el.querySelector('.live-share-url');
        input.addEventListener('click', () => { input.select(); });
    }

    _showShareError(message) {
        const el = this._root.querySelector('#live-share-link');
        if (!el) return;
        el.textContent = 'Could not start sharing: ' + message;
        el.style.display = '';
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
