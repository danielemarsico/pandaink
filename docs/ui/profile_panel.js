// Profile settings panel — account info, cloud storage, device.
// Mounts as a slide-in drawer on top of the app.

import {
    getProfile, updateProfile, updatePassword, signOut, deleteDevice, deleteAccount,
} from '../auth/auth_manager.js';
import {
    startGDriveAuth, disconnectDrive,
} from '../auth/storage_oauth.js';
import {
    startDropboxAuth, disconnectDropbox,
} from '../auth/dropbox_oauth.js';
import * as cloudStore from '../storage/cloud_store.js';
import { KOFI_PRO_URL } from '../config.js';
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

  <section class="pp-section">
    <h3 class="pp-section-title">Support PandaInk</h3>
    <p class="pp-muted pp-hint">PandaInk is free and open source. A coffee helps fund the
       cloud-sync hosting and keeps development going.</p>
    <a class="btn-kofi btn-small" href="https://ko-fi.com/dan1elsan" target="_blank" rel="noopener"
       style="display:inline-block;text-decoration:none;">☕ Buy me a coffee</a>
  </section>

  <section class="pp-section pp-danger-zone">
    <button id="pp-signout" class="btn-danger-outline">Sign out</button>
    <button id="pp-delete-account" class="btn-danger-outline">Delete account</button>
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
        q('#pp-delete-account')?.addEventListener('click', () => this._deleteAccount());

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
        row.innerHTML = '<span class="pp-loading">Checking…</span>';

        const profile = await cloudStore.loadProfile(this._user.id, true);
        const isPro    = profile.plan === 'pro';
        const active   = profile.storage_provider;

        // Connection state of the OAuth providers (Supabase needs no connect).
        const conn = {};
        for (const id of Object.keys(cloudStore.PROVIDERS)) {
            try { conn[id] = await cloudStore.PROVIDERS[id].isConnected(); }
            catch { conn[id] = false; }
        }

        const planTag = isPro
            ? '<span class="pp-plan pp-plan-pro">Pro</span>'
            : '<span class="pp-plan pp-plan-free">Free</span>';

        const rowFor = (p) => {
            const locked   = p.paid && !isPro;
            const isActive = active === p.id;
            const connected = conn[p.id];
            let action = '';
            if (locked) {
                action = '<span class="pp-muted">🔒 Pro</span>';
            } else if (p.needsOAuth) {
                action = connected
                    ? `<button data-disc="${p.id}" class="btn-danger-outline btn-small">Disconnect</button>`
                    : `<button data-conn="${p.id}" class="btn-small">Connect</button>`;
            } else {
                action = '<span class="pp-muted">No connect needed</span>';
            }
            const tier = p.paid ? 'Pro' : 'Free · max 10';
            return `
<label class="pp-provider-opt ${locked ? 'pp-locked' : ''}">
  <input type="radio" name="pp-provider" value="${p.id}" ${isActive ? 'checked' : ''} ${locked ? 'disabled' : ''}>
  <span class="pp-provider-name">${p.name}</span>
  <span class="pp-provider-tier">${tier}</span>
  <span class="pp-provider-action">${action}</span>
</label>`;
        };

        const upgrade = isPro ? '' : `
<div class="pp-upgrade">
  <span>Unlock Google Drive &amp; Dropbox with Pro — one-time $5.</span>
  ${KOFI_PRO_URL
      ? `<a class="btn-kofi btn-small" href="${KOFI_PRO_URL}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">☕ Upgrade to Pro</a>`
      : '<span class="pp-muted">(upgrade link not set up yet)</span>'}
</div>`;

        row.innerHTML = `
<div class="pp-plan-line">Plan: ${planTag}</div>
<div class="pp-provider-list">
  ${rowFor(cloudStore.PROVIDERS.supabase)}
  ${rowFor(cloudStore.PROVIDERS.google_drive)}
  ${rowFor(cloudStore.PROVIDERS.dropbox)}
</div>
${upgrade}
<p class="pp-muted pp-hint">One provider is active at a time. Switching does not move existing
   drawings; the list shows the active provider's cloud drawings plus everything on this device.</p>`;

        // Wire selection + connect/disconnect.
        row.querySelectorAll('input[name="pp-provider"]').forEach((radio) => {
            radio.addEventListener('change', () => this._selectProvider(radio.value));
        });
        row.querySelectorAll('[data-conn]').forEach((b) =>
            b.addEventListener('click', () => this._connectProvider(b.dataset.conn)));
        row.querySelectorAll('[data-disc]').forEach((b) =>
            b.addEventListener('click', () => this._disconnectProvider(b.dataset.disc)));
    }

    async _selectProvider(id) {
        try {
            await cloudStore.setProvider(this._user.id, id);
            this._showMsg('pp-storage-msg', `Storage provider set to ${cloudStore.PROVIDERS[id].name}.`, false);
        } catch (e) {
            this._showMsg('pp-storage-msg', e.message, true);
        }
        await this._refreshStorage();
    }

    async _connectProvider(id) {
        // Make it the active provider first, then start its OAuth flow (a redirect).
        try { await cloudStore.setProvider(this._user.id, id); } catch (e) {
            this._showMsg('pp-storage-msg', e.message, true); return;
        }
        if (id === 'google_drive') return startGDriveAuth();
        if (id === 'dropbox')      return startDropboxAuth();
    }

    async _disconnectProvider(id) {
        if (!confirm('Disconnect this provider? You will lose access to its cloud drawings until you reconnect.')) return;
        if (id === 'google_drive') await disconnectDrive();
        if (id === 'dropbox')      await disconnectDropbox();
        this._showMsg('pp-storage-msg', 'Provider disconnected.', false);
        await this._refreshStorage();
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

    async _deleteAccount() {
        if (!confirm('Permanently delete your PandaInk account? This removes your profile, device registration and cloud tokens. This cannot be undone.')) return;
        this._showMsg('pp-account-msg', 'Deleting account…', false);
        const { error } = await deleteAccount();
        if (error) {
            this._showMsg('pp-account-msg', 'Error: ' + error.message, true);
            return;
        }
        this.close();  // signed out by deleteAccount(); auth state change re-renders login
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
