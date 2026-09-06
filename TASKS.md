# PandaInk — Remaining Tasks

The web-app auth / tiered-storage / Cloudflare-Worker / live-sharing **code is
implemented**, and the Worker is **deployed and live**. What remains is
external account setup, end-to-end testing of paths never exercised, and
hardware tests that need the real Folio.

**Status of the shared backend** (verified 2026-09-06):

| Thing | State |
|---|---|
| Cloudflare Worker | ✅ Deployed — `https://pandaink-api.marsicod.workers.dev`, `/health` returns `{"ok":true}` |
| `WORKER_BASE_URL` | ✅ Set in `docs/config.js` |
| `KOFI_PRO_URL` | ✅ Set |
| `DROPBOX_CLIENT_ID` | ❌ **Empty** — the one remaining config gap |

> **What the Worker is for**, since none of it is on the email-login +
> Supabase-Storage path that already works: Google Drive OAuth token exchange
> (needs a client secret), account deletion (needs the Supabase service-role
> key), the Ko-fi purchase webhook (Ko-fi POSTs to a server), and the live-share
> WebSocket relay (`LiveSession` Durable Object). Free-tier usage bypasses it
> entirely by design.

---

## Manual Actions — Daniele (Admin)

These need external dashboards and can only be done by the project owner.
Each is independent unless noted.

### Dropbox — the only thing still blocking code paths
- [ ] **Create a Dropbox app** (App Console → Scoped access → App folder),
      permissions `files.content.write/read`, `files.metadata.read`; add
      redirect URI `https://danielemarsico.github.io/pandaink/app.html`.
      Copy the **App key** into `docs/config.js` → `DROPBOX_CLIENT_ID`.
      (The app *secret* is not needed in the frontend — Dropbox uses
      secretless PKCE, see `docs/auth/dropbox_oauth.js`.)

### GitHub OAuth App
- [ ] **Create a GitHub OAuth App** and enable the GitHub provider in the
      Supabase dashboard. The frontend already calls
      `signInWithOAuth({ provider: 'github' })`
      (`docs/auth/auth_manager.js:39`), so the button exists and will fail
      until this is configured. Google sign-in is already enabled and working.

### Google OAuth consent screen — verification
- [ ] **Submit for verification** — required to remove the "unverified app"
      warning users see when connecting **Google Drive** (the app requests the
      sensitive `drive.appdata` scope). **Not required for Google sign-in
      itself** — that uses only non-sensitive scopes and is unaffected. Steps:
      1. **Google Cloud Console → APIs & Services → OAuth consent screen**
         (project "PandaInk").
      2. Confirm branding is complete: app name, logo, support email, developer
         contact email, **Application home page**
         (`https://danielemarsico.github.io/pandaink/`), and **privacy policy
         link** — use `https://danielemarsico.github.io/pandaink/privacy.html`
         (already live, see `docs/privacy.html`).
      3. Under **Authorized domains**, ensure `github.io` (or your custom
         domain) is listed; verify ownership via Google Search Console if
         prompted.
      4. On the **Scopes** step, confirm `.../auth/drive.appdata` is listed as
         a requested sensitive scope.
      5. Click **"Submit for verification"**. The form asks for:
         - A **justification** for `drive.appdata` — it stores only the user's
           own drawing backups in their private, app-only Drive folder; the app
           never reads or shares anything else in their Drive.
         - A **demo video** (plain screen recording): sign in → Profile → Cloud
           Storage → "Connect Google Drive" → complete the Google consent
           screen → a drawing saving/restoring afterward.
      6. Wait — typically a few days, up to ~2 weeks. Google may email
         follow-ups via the same verification form.
      7. Until approved, Drive-connect still works, but users must click
         **Advanced → Go to PandaInk (unsafe)**. Warn early testers.

### Ko-fi (Pro = one-time $5)
- [ ] **Configure the Ko-fi Shop item's webhook** to point at
      `https://pandaink-api.marsicod.workers.dev/kofi/webhook`, then send a
      test webhook (or make a real $5 purchase) and confirm the Worker sets
      `profiles.plan = 'pro'` for the matching Supabase account.
      `KOFI_PRO_URL` is already set in `docs/config.js`.

---

## Ready to Test — Worker is live, these just haven't been exercised

Previously listed as blocked on Worker deployment. That's done; these are
now simply untested paths.

- [ ] **Google Drive** — connect works with no secret in the frontend (token
      exchange via the Worker); sync + reconcile round-trips. *Note: expect the
      "unverified app" warning until Google verification completes.*
- [ ] **Delete account** — removes the auth user (profile/devices/tokens
      cascade) and logs out.
- [ ] **Live sharing** — enable "Share this session", open the `?watch=` link
      in a second signed-in browser, confirm strokes mirror in real time.
      (Covers the previously-separate "test live sharing end-to-end" item.)

**After `DROPBOX_CLIENT_ID` is set (and a Pro account):**
- [ ] **Dropbox** — connect, sync a drawing, confirm `drawing_<ts>.json` lands
      in the app folder and re-appears after reload / in another browser
      (reconciliation).

**After the Ko-fi webhook is configured:**
- [ ] **Pro purchase** — buy the $5 item with the account email →
      `profiles.plan` flips to `pro` → Drive & Dropbox unlock in the picker.
      Verify a mismatched email is handled (manual reconcile).

---

## Hardware Smoke-Tests — need the real Bamboo Folio (F4:21:DE:4D:26:BF)

The BLE fixes below are **implemented and verified against the Python
reference offline**; only hardware confirmation remains. Found by diffing
`docs/ble/sync.js` against `src/tuhi/protocol.py` + `src/tuhi/wacom_win.py`.
The Folio speaks the **Slate** protocol and both bugs were Slate-specific, so
sync would fail on real hardware even after the GATT/notify fixes.

- [ ] **C1 — end-of-download detection** (`sync.js` `readOfflinePenData()`):
      sync 1 drawing, sync several in one session, sync with 0 drawings on
      device.
- [ ] **C2 — Slate stroke-file parser** (`sync.js` `parseStrokeData()`): sync a
      real Folio drawing and compare visually against the same drawing synced
      by the Python GUI — stroke count, shape, no corner spikes at 65535.
- [ ] **GUI Live mode** (Windows app): Start Live → draw → strokes appear in
      real time → Stop Live → drawing saved as a new tab.
- [ ] **Port `register_device_finish()`** into the web registration flow
      (Slate: set time, transfer-GATT select, name, dimensions, firmware,
      battery). Non-blocking follow-up from the same audit.

---

## Decisions & Research (no implementation)

- [ ] **S2-3 — stroke segmentation in live mode.** Decide how to detect a
      finished stroke in the browser. Options: pen-left-proximity event
      (`0xff`×6 packet, already handled, most reliable), pressure-drop timeout
      (~200 ms fallback), velocity/direction heuristic (complex).
      **Recommendation:** proximity event as primary, 200 ms pressure-drop
      timeout as fallback for devices that don't reliably send `0xff` packets.
- [ ] **Migration-on-switch between cloud providers** — decide with user what
      happens to existing drawings when the active provider changes.

---

## Cosmetic / Optional

- [ ] **Screenshots** — replace the grey placeholder boxes in
      `docs/features.html` with real screenshots once the app is stable.
- [ ] **GitHub Sponsors** — enrol at github.com/sponsors; once approved,
      uncomment `github: danielemarsico` in `.github/FUNDING.yml`.
- [ ] **Lightning donations** — create a Lightning Address (Wallet of Satoshi,
      Alby, …) and add donate links to `docs/index.html` and
      `docs/download.html`.
