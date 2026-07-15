// Profile settings panel — account info, cloud storage, device.
// Mounts as a slide-in drawer on top of the app.

import {
    getProfile, updateProfile, updatePassword, signOut, deleteDevice,
} from '../auth/auth_manager.js';
import {
    startGDriveAuth, isDriveConnected, disconnectDrive,
} from '../auth/storage_oauth.js';
import {
    isSyncTraceEnabled, setSyncTraceEnabled, getSyncTraceLog, clearSyncTraceLog,
} from '../ble/sync.js';

export class ProfilePanel {
    constructor(user, onClose, onForgetDevice) {
        this._user          = user;
        this._onClose       = onClose;       // called when panel is dismissed
        this._onForgetDevice = onForgetDevice; // called after device is forgotten
        this._el            = null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async open() {
        if (this._el) return;
        this._el = document.createElement('div');
        this._el.className = 'profile-panel-overlay';
        this._el.innerHTML = this._buildHTML();
        document.body.appendChild(this._el);

        this._el.querySelector('.profile-overlay-bg')
            .addEventListener('click', () => this.close());
        this._el.querySelector('#pp-close')
            .addEventListener('click', () => this.close());

        await this._bindEvents();
        await this._refresh();
    }

    close() {
        if (!this._el) return;
        this._el.remove();
        this._el = null;
        if (this._onClose) this._onClose();
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    _buildHTML() {
        const email    = this._user.email ?? '';
        const provider = this._user.app_metadata?.provider ?? 'email';
        const isEmail  = provider === 'email';

        return `
<div class="profile-overlay-bg"></div>
<div class="profile-panel" role="dialog" aria-label="Profile settings">
  <div class="profile-panel-header">
    <span class="profile-panel-title">Profile</span>
    <button id="pp-close" class="pp-close-btn" aria-label="Close">✕</button>
  </div>

  <section class="pp-section">
    <h3 class="pp-section-title">Account</h3>
    <div class="pp-field">
      <label>Display name</label>
      <div class="pp-inline">
        <input id="pp-name" type="text" placeholder="Your name">
        <button id="pp-save-name" class="btn-small">Save</button>
      </div>
    </div>
    <div class="pp-field">
      <label>Email</label>
      <span class="pp-value">${email}</span>
    </div>
    ${isEmail ? `
    <div class="pp-field">
      <label>New password</label>
      <div class="pp-inline">
        <input id="pp-password" type="password" placeholder="New password" autocomplete="new-password">
        <button id="pp-save-password" class="btn-small">Change</button>
      </div>
    </div>` : `
    <div class="pp-field">
      <label>Login method</label>
      <span class="pp-value pp-capitalize">${provider}</span>
    </div>`}
    <div id="pp-account-msg" class="pp-msg" style="display:none"></div>
  </section>

  <section class="pp-section">
    <h3 class="pp-section-title">Cloud Storage</h3>
    <div id="pp-storage-row" class="pp-storage-row">
      <span class="pp-loading">Checking…</span>
    </div>
    <div id="pp-storage-msg" class="pp-msg" style="display:none"></div>
  </section>

  <section class="pp-section">
    <h3 class="pp-section-title">Device</h3>
    <div id="pp-device-row" class="pp-device-row">
      <span class="pp-loading">Loading…</span>
    </div>
  </section>

  <section class="pp-section">
    <h3 class="pp-section-title">Diagnostics</h3>
    <label class="pp-toggle">
      <input type="checkbox" id="pp-trace-toggle">
      <span>Verbose sync log</span>
    </label>
    <p class="pp-muted pp-hint">Records the device sync conversation so it can be shared for debugging.
       Turn it on, run Sync, then Copy the log below and send it over.</p>
    <div class="pp-inline pp-trace-actions">
      <button id="pp-trace-copy"    class="btn-small">Copy log</button>
      <button id="pp-trace-refresh" class="btn-small">Refresh</button>
      <button id="pp-trace-clear"   class="btn-small">Clear</button>
    </div>
    <textarea id="pp-trace-log" class="pp-trace-log" readonly rows="10"
              placeholder="(no log yet — enable the switch, then run Sync)"></textarea>
    <div id="pp-trace-msg" class="pp-msg" style="display:none"></div>
  </section>

  <section class="pp-section pp-danger-zone">
    <button id="pp-signout" class="btn-danger-outline">Sign out</button>
  </section>
</div>`;
    }

    // ── Binding + Refresh ─────────────────────────────────────────────────────

    async _bindEvents() {
        const q = (id) => this._el.querySelector(id);

        // Account
        q('#pp-save-name')?.addEventListener('click', () => this._saveName());
        q('#pp-save-password')?.addEventListener('click', () => this._savePassword());
        q('#pp-signout').addEventListener('click', async () => {
            await signOut();
            this.close();
        });

        // Diagnostics — verbose sync log
        const toggle = q('#pp-trace-toggle');
        if (toggle) {
            toggle.checked = isSyncTraceEnabled();
            toggle.addEventListener('change', () => {
                setSyncTraceEnabled(toggle.checked);
                this._showMsg('pp-trace-msg',
                    toggle.checked ? 'Verbose log ON — run Sync, then Copy the log.'
                                   : 'Verbose log off.', false);
            });
        }
        q('#pp-trace-refresh')?.addEventListener('click', () => this._renderTraceLog());
        q('#pp-trace-clear')?.addEventListener('click', () => {
            clearSyncTraceLog();
            this._renderTraceLog();
        });
        q('#pp-trace-copy')?.addEventListener('click', () => this._copyTraceLog());
        this._renderTraceLog();
    }

    _renderTraceLog() {
        const ta = this._el?.querySelector('#pp-trace-log');
        if (ta) ta.value = getSyncTraceLog();
    }

    async _copyTraceLog() {
        const text = getSyncTraceLog();
        if (!text) { this._showMsg('pp-trace-msg', 'Log is empty — enable it and run Sync first.', true); return; }
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch {
            // Fallback for browsers/contexts without the async clipboard API:
            // select the textarea contents and use execCommand.
            const ta = this._el?.querySelector('#pp-trace-log');
            if (ta) {
                ta.focus();
                ta.select();
                try { ok = document.execCommand('copy'); } catch { ok = false; }
                ta.setSelectionRange(0, 0);
                ta.blur();
            }
        }
        this._showMsg('pp-trace-msg',
            ok ? 'Log copied to clipboard.'
               : 'Could not copy automatically — long-press the log box and Select All → Copy.',
            !ok);
    }

    async _refresh() {
        await Promise.all([
            this._refreshAccount(),
            this._refreshStorage(),
            this._refreshDevice(),
        ]);
    }

    async _refreshAccount() {
        const { data } = await getProfile(this._user.id);
        const nameInput = this._el?.querySelector('#pp-name');
        if (nameInput && data?.display_name) nameInput.value = data.display_name;
    }

    async _refreshStorage() {
        const row = this._el?.querySelector('#pp-storage-row');
        if (!row) return;

        const connected = await isDriveConnected();
        if (connected) {
            row.innerHTML = `
<div class="pp-provider-connected">
  <span class="pp-provider-icon">📁</span>
  <span class="pp-provider-name">Google Drive connected</span>
  <button id="pp-disconnect-drive" class="btn-danger-outline btn-small">Disconnect</button>
</div>`;
            row.querySelector('#pp-disconnect-drive')
                .addEventListener('click', () => this._disconnectDrive());
        } else {
            row.innerHTML = `
<div class="pp-provider-empty">
  <span>No storage connected</span>
  <button id="pp-connect-drive" class="btn-primary btn-small">Connect Google Drive</button>
</div>`;
            row.querySelector('#pp-connect-drive')
                .addEventListener('click', () => startGDriveAuth());
        }
    }

    async _refreshDevice() {
        const row = this._el?.querySelector('#pp-device-row');
        if (!row) return;

        const { data } = await import('../auth/auth_manager.js').then(m =>
            m.loadDevice(this._user.id)
        );

        if (data) {
            const protocols = { 1: 'Spark', 2: 'Slate', 3: 'Intuos Pro' };
            row.innerHTML = `
<div class="pp-device-info">
  <span class="pp-device-name">${data.device_name ?? 'Wacom device'}</span>
  <span class="pp-device-proto">${protocols[data.protocol] ?? 'Unknown'} protocol</span>
  <button id="pp-forget-device" class="btn-danger-outline btn-small">Forget device</button>
</div>`;
            row.querySelector('#pp-forget-device')
                .addEventListener('click', () => this._forgetDevice());
        } else {
            row.innerHTML = `<span class="pp-muted">No device registered.</span>`;
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    async _saveName() {
        const name = this._el.querySelector('#pp-name')?.value.trim();
        if (!name) return;
        const { error } = await updateProfile(this._user.id, { display_name: name });
        this._showMsg('pp-account-msg', error ? 'Error: ' + error.message : 'Name saved.', !!error);
    }

    async _savePassword() {
        const pw = this._el.querySelector('#pp-password')?.value;
        if (!pw || pw.length < 8) {
            this._showMsg('pp-account-msg', 'Password must be at least 8 characters.', true);
            return;
        }
        const { error } = await updatePassword(pw);
        this._showMsg('pp-account-msg', error ? 'Error: ' + error.message : 'Password updated.', !!error);
        if (!error && this._el.querySelector('#pp-password'))
            this._el.querySelector('#pp-password').value = '';
    }

    async _disconnectDrive() {
        if (!confirm('Disconnect Google Drive? You will lose access to cloud drawings.')) return;
        await disconnectDrive();
        this._showMsg('pp-storage-msg', 'Google Drive disconnected.', false);
        await this._refreshStorage();
    }

    async _forgetDevice() {
        if (!confirm('Forget this device? Your cloud drawings will not be deleted.')) return;
        const row = this._el?.querySelector('#pp-device-row');
        if (row) row.innerHTML = '<span class="pp-loading">Removing…</span>';
        try {
            await deleteDevice(this._user.id);
            if (this._onForgetDevice) this._onForgetDevice();
            await this._refreshDevice();
        } catch (e) {
            if (row) row.innerHTML = `<span class="pp-error">Error: ${e.message}</span>`;
        }
    }

    _showMsg(id, text, isError) {
        const el = this._el?.querySelector('#' + id);
        if (!el) return;
        el.textContent  = text;
        el.className    = 'pp-msg ' + (isError ? 'pp-msg-error' : 'pp-msg-ok');
        el.style.display = '';
        setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
    }
}
