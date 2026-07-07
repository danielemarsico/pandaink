# Changelog

All notable changes to PandaInk are documented here.
Format: `## Unreleased` for pending changes; `## <version> — <date>` for releases.

---

## Unreleased

- fix: reconnecting to a device (e.g. after a page reload or a dropped connection) and then syncing crashed with `InvalidStateError: Characteristic ... is no longer valid` — `BleManager` cached GATT characteristic objects across reconnects, but those references are tied to the specific GATT session they were retrieved from and go stale once it drops, even when reconnecting to the same device. `connect()` now clears the characteristic/notify-handler caches before establishing the new session
- fix: back-to-back BLE commands (introduced by the new pre-sync handshake) could time out unpredictably — `exchange()`'s cleanup (`stopNotify()`) ran fire-and-forget and could still be in flight when the next command's `startNotify()` re-subscribed; `ble_manager.js`'s stale cleanup would then delete the new handler and silently turn notifications back off mid-wait. Replies now only resolve after their cleanup actually finishes, so the next command can't start until the previous one's unsubscribe has settled. Also gives a clear, actionable message when the device rejects a connection with `INVALID_STATE` (the documented "make sure the LED is blue, press the button" condition) instead of a bare error code
- fix: sync crashed with `RangeError: Offset is outside the bounds of the DataView` querying the available-file count — the device was rejecting that query with a generic ACK error because `syncDrawings()` was missing an entire required pre-sync handshake (set time, query battery, query dimensions, query firmware, and properly ACK-checked file-transfer/paper-mode setup) that `wacom_win.py`'s Slate-family `retrieve_data()` always performs first. Also fixed a latent bug in the very next step: the per-file stroke-count reply's timestamp is BCD-encoded, not a raw little-endian integer, so it was silently producing garbage dates. `syncDrawings()` now also returns real queried tablet dimensions instead of a hardcoded Spark-family guess
- fix: connect always failed with `Device rejected connection (opcode 0xb3)` for Spark/Slate/Folio devices — `syncDrawings()` only accepted a raw `0x50` (`REPLY_CONNECT_OK`) reply opcode, but these devices reply with the generic ACK opcode (`0xb3`) whose payload's first byte indicates success/failure instead, per `protocol.py`'s `Msg.execute()` dispatch. Now checks the ACK payload byte for these devices, falling back to raw `0x50`/`0x51` handling for Intuos Pro
- fix: every device sync always failed with `Timeout waiting for reply to 0xe6` — `sync.js`'s `exchange()` helper awaited the reply promise *before* writing the command that would trigger a reply, so the command was never actually sent until the wait had already started, guaranteeing a timeout on every exchange. Also fixed the same subscribe-after-trigger ordering bug in `readOfflinePenData()`, which could miss offline pen data that arrived before its notification listeners were subscribed
- fix: Sync/Start Live crashed with `Cannot read properties of null (reading 'getCharacteristic')` when clicked right after a page reload — a registered device loads from Supabase and enables those buttons immediately, but the BLE GATT connection doesn't survive a reload, so `this._ble._service` was still null. Both now reconnect first via a shared `_ensureBleConnected()` before touching any GATT characteristic
- fix: "Forget device" (toolbar button and profile panel) no longer deletes cloud drawings — it now only unlinks the device registration; drawings are only ever removed via the explicit per-drawing Delete button. Previously it deleted every cloud drawing outright, and briefly (in an intermediate fix) could still unlink the device even if that deletion failed, orphaning files in Drive under an unreachable device id — this replaces both with "unlink only, never touch Drive"; removed the now-unused `deleteAllDrawings()` from `gdrive_store.js`
- feat: add a live connection-status dot next to the device name in the web app toolbar — previously a registered-but-not-BLE-connected device looked identical to a connected one, since the label was always styled green regardless of actual GATT connection state
- fix: `app_controller.js` built `_deviceInfo` with a `wacom_uuid` key (matching the Supabase column name) but `sync.js`/`live.js` read `deviceInfo.uuid`, causing `Cannot read properties of undefined (reading 'length')` in `hexBytes()` on every Sync/Live attempt — renamed to `uuid` to match what the BLE modules expect
- docs: add explicit security-tradeoff callout in README explaining what the publicly-shipped Drive client_secret does and doesn't expose, plus mitigation options
- fix: Google requires client_secret on the token/refresh exchange for Web application OAuth clients even with PKCE — add `GDRIVE_CLIENT_SECRET` to `storage_oauth.js`'s token and refresh requests, fixing `invalid_request: client_secret is missing` on Drive connect
- docs: correct README's claim that the Drive OAuth client needs no secret; document the client_secret + PKCE tradeoff for static sites with no backend
- fix: README incorrectly told readers to add only the origin (no path) to the Drive client's Authorized redirect URIs, causing `redirect_uri_mismatch` — now specifies the full page URL as required by `REDIRECT_URI` in `storage_oauth.js`
- docs: document Supabase's default `localhost:3000` OAuth redirect and how to fix it via Site URL / Redirect URLs in README setup steps
- docs: explain the two separate Google OAuth clients required (Drive access vs Supabase login) in README, with a comparison table and split setup steps (2b/2c) — the two were previously conflated
- docs: fix stale line-number references in README Web App Setup, add migration 002 to the Supabase setup steps, and clarify that Google Drive test users and Supabase login users are separate whitelists
- chore: fill in live Google Drive OAuth client ID in `docs/auth/storage_oauth.js`, enabling cloud storage connection on the deployed web app
- fix: add missing unique constraint on `devices.user_id` (migration 002) — `saveDevice()`'s `upsert(..., { onConflict: 'user_id' })` was failing with a 400 because no such constraint existed
- chore: fill in live Supabase project URL and anon key in `docs/auth/supabase_client.js`, enabling auth on the deployed web app
- docs: document `docs/storage/idb_store.js` as unused/legacy in CLAUDE.md architecture; fix stale `idb_store` reference in a `drawing_canvas.js` comment
- docs: update README with web app features, auth/cloud architecture, and full external setup instructions (Supabase, Google Cloud, GitHub OAuth)
- chore: consolidate remaining tasks into single .claude/tasks/current.md (Windows App + Web App sections); remove completed/stale plan files
- chore: move CLAUDE.md to .claude/CLAUDE.md; add Windows App and Web App architecture sections

- feat: Supabase auth — email+password, Google login, GitHub login; auth panel shown when logged out
- feat: profile settings panel — account info, cloud storage connection, device management
- feat: Google Drive PKCE OAuth — connect Drive in Profile Settings, tokens stored in Supabase
- feat: drawings stored in Google Drive appDataFolder (one JSON file per drawing)
- feat: device config (wacom_uuid + protocol) stored in Supabase — enables cross-computer reconnect
- feat: auth toolbar row — avatar, email, Profile button, Sign out
- refactor: register.js removes localStorage dependency; Supabase is now authoritative for device config
- chore: Supabase migration SQL (001_init.sql) with profiles, devices, storage_tokens tables + RLS
- feat: show build commit + timestamp in web app footer (auto-stamped by CI)
- fix: web BLE device picker now uses `acceptAllDevices` so registered devices appear regardless of advertised services
- fix: web BLE registration skips intermediate ACK (0xb3) when waiting for REGISTER_WAIT reply
- fix: web BLE write uses `writeValueWithoutResponse` to match Python bleak `response=False`
- fix: `isSpark()` now checks for the SYSEVENT *service* (not a characteristic in the wrong service), correctly identifying Slate/Bamboo Folio devices
- fix: device record stored with `id` field to satisfy IndexedDB keyPath requirement
- chore: save web app plan and task list under `.claude/`
- chore: add CHANGELOG rule to CLAUDE.md

---

## 0.1.1 — 2024-12-01

- feat: Windows installer (Inno Setup) produced by CI alongside portable EXE
- feat: Help dialog with 4-tab Notebook (Getting Started, Live Mode, Shortcuts, About)
- feat: Live mode — real-time pen streaming to canvas
- feat: Stop Live auto-saves session as a drawing tab
- feat: device button press surfaced as toast in GUI and stdout in CLI
- feat: GitHub Pages website (index, features, download, web app pages)
- feat: Web BLE app — connect, register, sync drawings, live mode, SVG export
- fix: live mode orientation and canvas rendering
- chore: CI build for portable EXE and installer on push to master and v* tags

## 0.1.0 — 2024-10-01

- feat: initial Windows port of Tuhi (BLE via bleak, no BlueZ dependency)
- feat: Tkinter GUI with Normal and Live modes
- feat: CLI commands: list, search, listen, fetch, live
- feat: SVG export with cloud upload (Google Drive, Dropbox, OneDrive)
- feat: drawings stored in `%APPDATA%\pandaink\`
