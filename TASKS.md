# PandaInk — Remaining Tasks

All completed tasks have been removed. See `PROGRESS.md` for history.

---

## Windows App

### Manual / User Steps

- [ ] **Screenshots** — Replace grey placeholder boxes in `docs/features.html` with real screenshots once app is stable
- [ ] **Ko-fi** — Create account at ko-fi.com with username `danielemarsico` (GitHub Sponsor button links to it automatically via `FUNDING.yml`)
- [ ] **GitHub Sponsors** — Enrol at github.com/sponsors; once approved, uncomment `github: danielemarsico` in `.github/FUNDING.yml`
- [ ] **Lightning donations** — Create a Lightning Address (e.g. via Wallet of Satoshi or Alby) and add donate links to `docs/index.html` and `docs/download.html`

### Hardware Smoke-Tests (need real Bamboo Folio F4:21:DE:4D:26:BF)

- [ ] **GUI Live mode** — Start Live → draw → strokes appear in real time → Stop Live → drawing saved as new tab

### Research (no implementation)

- [ ] **S2-3 Stroke segmentation in live mode** — Decide how to detect when a stroke is finished in the browser. Options: pen-left-proximity event (0xff×6 packet, already handled, most reliable), pressure-drop timeout (~200 ms fallback), velocity/direction heuristic (complex). Recommendation: rely on existing proximity event as primary; add 200 ms pressure-drop timeout as fallback for devices that don't reliably send 0xff packets.

---

## Web App

### BLE Protocol — Critical Fixes (blocker for Folio sync)

Found by diffing `docs/ble/sync.js` against the working Python reference
(`src/tuhi/protocol.py`, `src/tuhi/wacom_win.py`). The Bamboo Folio speaks the
**Slate** protocol; both bugs are in Slate-specific behavior, so sync will fail on
real hardware even now that the BLE-layer (GATT/notify) bugs are fixed.

- [x] **C1 — End-of-download detection is wrong for Slate/Folio** (`sync.js` `readOfflinePenData()`)
      — implemented; only the hardware smoke-test remains (below)
  - Problem: waits only for opcode `0xc9` (`REPLY_CRC`), which is the **Spark** flow.
    A Slate/Folio signals end-of-download with a single **`0xc8`** reply whose payload
    is `[0xed, <CRC bytes, reversed>]` (`MsgWaitForEndReadSlate`, protocol.py:1252).
    Result: pen data arrives, then sync hangs 30 s → "Timeout waiting for pen data CRC packet".
  - [x] Accept both end markers in the RX handler: `0xc9` (Spark/Intuos Pro) **and**
        `0xc8` with payload byte 0 == `0xed` (Slate/Folio)
  - [x] Ignore-but-validate the *first* `0xc8` that arrives right after
        `DOWNLOAD_OLDEST`: payload `[0xbe]` = "download starting" ack
        (`MsgDownloadOldestFile`, protocol.py:1213). Don't treat it as end-of-download
  - [x] Extract the CRC from the Slate `0xc8 [0xed, …]` payload (bytes after `0xed`,
        reverse byte order → u32) and **verify it against CRC32 of the merged pen data**
        (Python: `binascii.crc32`, wacom_win.py `wait_for_end_read()`); throw on mismatch
  - [ ] Test on hardware: sync 1 drawing, sync several drawings in one session,
        sync with 0 drawings on device

- [x] **C2 — Stroke-file parser can't parse Slate data** (`sync.js` `parseStrokeData()`)
      — implemented and verified byte-for-byte against the Python reference parser
      (50 randomized stroke streams + directed cases produce identical output);
      only the hardware smoke-test remains (below)
  - Problem: the JS parser classifies packets by the raw header byte; the Python
    reference (protocol.py `StrokeDataType.identify`, line 1398) classifies by
    **header byte + payload** (payload length = popcount(header)). Five concrete bugs:
    1. EOF check `hdr==0xff && data[i+1]==0xff` matches every full StrokePoint
       (`[0xff][0xff 0xff][x y p]`) → parsing stops at the first absolute point →
       drawings come out empty. Real EOF = all payload bytes `0xff` (header `0xff`, 8 bytes)
    2. Slate stroke headers (payload `[0xff 0xee 0xee, time-offset…]`) are not
       recognized at all; JS only looks for a bare `0xfa` header (and in Python
       `0xfa` is `payload[0]`, not the header byte)
    3. `[0xfc ff ff ff ff ff ff]` end-of-stroke has low bits `00` → falls into the
       delta branch → injects a garbage point (65535, 65535) instead of closing the stroke
    4. StrokePoints with header ≠ `0xff` (e.g. `0xbf`, documented in protocol.py)
       are parsed with the wrong axis mask → byte desync → garbage after that
    5. Lost-point packets (payload `[0xdd 0xdd]`) unhandled → misparsed as points
  - [x] Rewrite the classification loop to mirror `StrokeDataType.identify` order:
        FILE_HEADER → STROKE_END (`0xfc` + 6×`0xff`) → EOF (payload all `0xff`) →
        DELTA (`header & 0x3 == 0`) → STROKE_HEADER (payload `0xfa` or `0xff 0xee 0xee`)
        → POINT (payload `0xff 0xff`) → LOST_POINT (payload `0xdd 0xdd`) → UNKNOWN (skip)
  - [x] Compute packet size uniformly as `1 + popcount(header)` for header-classified
        packets (matches Python `StrokePacket` subclasses)
  - [x] Fix StrokePoint parsing: use the **original header with low 2 bits cleared**
        as the axis mask (Python `StrokePoint.__init__`: `header &= ~0x3`), payload =
        bytes after the `0xff 0xff` prefix; do not re-read the mask from the prefix bytes
  - [x] Keep the delta-accumulation math as is (it already matches Python)
  - [x] Skip lost-point packets without emitting a point
  - [ ] Test: sync a real Folio drawing and visually compare against the same drawing
        synced by the Python GUI (stroke count, shape, no corner spikes at 65535)

- [ ] **Follow-ups from the same audit (non-blocking)**
  - [x] Validate reply opcodes for AVAILABLE_FILES (`0xc2`) and GET_STROKES (`0xcf`)
        before parsing fields; raise a clear error on mismatch (done in
        `parseFileCount` / `parseGetStrokesReply` — also bounds-guards every field
        read so a short "no drawings" ACK no longer crashes with a DataView error)
  - [ ] Don't send `SET_MODE idle` after sync — Python leaves the device in paper mode;
        idle may stop the tablet recording new offline drawings
  - [ ] Port `register_device_finish()` (Slate: set time, transfer-GATT select, name,
        dimensions, firmware, battery) into the web registration flow
  - [ ] Make live.js ACK-check CONNECT and SET_MODE instead of fire-and-forget
  - [ ] Fix the fire-and-forget `stopNotify()` race in register.js `waitForNotification()`
        (same bug already fixed in sync.js `exchange()`)
  - [x] Audit units: Python multiplies coords by point size (10 µm) and normalizes
        pressure to 16-bit; JS returned raw device units — fixed in `sync.js`
        `scaleStrokes()` (coords × point size → µm to match `dimensions`, pressure
        → 16-bit). Without it, synced drawings rendered as an invisible speck

### External Setup (manual — must be done before the web app works)

These steps require access to external dashboards. Instructions are also in `README.md`.

- [x] **Supabase** — Create project at supabase.com → run `supabase/migrations/001_init.sql` in SQL editor → paste URL and anon key into `docs/auth/supabase_client.js` lines 12–13
- [x] **Google Cloud — Drive API** — Create project "PandaInk" → enable Google Drive API → configure OAuth consent screen (scope: `drive.appdata`, add test users) → create Web Application OAuth client (no secret, PKCE) → paste Client ID into `docs/auth/storage_oauth.js` line 14
- [x] **Google Cloud — Sign in with Google** — Create a second Web Application OAuth client (with secret) → add Supabase callback URL (`https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`) as authorized redirect URI → configure in Supabase Authentication → Providers → Google
- [ ] **GitHub OAuth App** — Create at github.com/settings/developers → callback URL: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback` → configure in Supabase Authentication → Providers → GitHub
- [ ] **Publish OAuth consent screen** — Move Google app out of "Testing" mode so any user can log in (required for >100 users)

### Cloud Storage (rules in RULEBOOK.md → "Web App — Cloud Storage")

Do these **after** the BLE Protocol Critical Fixes above — nothing reaches storage
until sync works.

- [x] **S1 — Local storage (works with no cloud) + loss protection** — per RULEBOOK.md.
  The device deletes each drawing during sync (`DELETE_OLDEST`), so the browser must
  hold the drawing regardless of whether a cloud provider is configured. Local
  IndexedDB is now the always-on source of truth; cloud is optional on top.
  - [x] Revive `docs/storage/idb_store.js` (was unused legacy) as the local store;
        added `updateDrawing()` (mark uploaded); records carry `uploaded` /
        `driveFileId`, keyed by auto-id + `by_device` index, survive page reloads
  - [x] Change the sync flow so each drawing is saved to IndexedDB **inside the
        sync loop, immediately after parsing and BEFORE the device delete**
        (`syncDrawings` `onDrawing` callback → `app_controller._cmdSync`), not after
        the whole sync; upload to Drive only when connected; on success mark the
        local record uploaded (local copy retained for offline viewing). A failed
        local save stops the sync before deleting that file, so a multi-drawing
        sync can't lose downloaded-but-unsaved files
  - [x] Removed the hard `isDriveConnected()` gate that made sync/load bail with
        "Connect Google Drive first" when no cloud was configured
  - [x] `_loadStoredDrawings()` renders the drawing list from IndexedDB on mount
        (before BLE reconnect), so drawings are visible with no cloud at all
  - [x] On upload failure: keep the local copy, leave it pending (status text);
        `_retryPendingUploads()` retries on next load/sync when Drive is connected
  - [ ] Per-drawing "pending upload" badge/toast in the UI (currently status text only)
  - [ ] Test on hardware: sync with no cloud → drawings appear and persist across
        reload; then connect Drive → pending drawings upload
  - [x] Verified in a headless browser (stubbed Supabase, Drive off): seeded local
        drawings render as tabs, canvas draws, delete removes from UI + IndexedDB

Tiered model (RULEBOOK.md → "Web App — Cloud Storage"): Supabase Storage = free
(max 10 drawings); Google Drive + Dropbox = paid (`profiles.plan = 'pro'`). Gating is an
entitlement flag now; real payments are deferred.

- [ ] **S0 — `profiles.plan` entitlement flag**
  - [ ] Migration `003_plan.sql`: add `plan text not null default 'free'` to `profiles`
        (values `free` | `pro`); document `storage_provider` allowed values as
        `supabase` | `google_drive` | `dropbox` | null
  - [ ] Read `plan` on mount; expose it to the provider picker (gates paid providers)
  - [ ] (Deferred, separate task) wire a payment provider (Stripe/Ko-fi) to set `plan`

- [ ] **S2 — Supabase Storage provider (free tier, 10-drawing cap)**
  - [ ] Migration `004_storage.sql`: private bucket `drawings`, path
        `<user_id>/<timestamp>.json`, owner-only RLS (read/write own folder)
  - [ ] New `docs/storage/supabase_store.js` with the same interface as
        `gdrive_store.js` (`saveDrawing`, `listDrawings`, `loadDrawing`, `deleteDrawing`)
        so `app_controller.js` can swap providers behind one interface
  - [ ] Enforce the cap (Worker-side authoritative + client pre-check): at 10, fail
        with a clear message ("delete old drawings or upgrade to a paid provider") —
        never silently drop (RULEBOOK.md rule)
  - [ ] Test: save 10 drawings → 11th fails with the message; delete one → save works

- [ ] **S2b — Dropbox provider (paid tier)**
  - [ ] New `docs/storage/dropbox_store.js`, same interface as `gdrive_store.js`
  - [ ] Dropbox OAuth (PKCE) via the Cloudflare Worker (token exchange/refresh); store
        tokens in `storage_tokens` with `provider = 'dropbox'`
  - [ ] Test: connect Dropbox (pro plan), sync a drawing, confirm it lands in the app folder

- [ ] **S3 — Provider selection UI (one active provider, changeable, tier-gated)**
  - [ ] Profile → Cloud Storage: pick Supabase / Google Drive / Dropbox; persist to
        `profiles.storage_provider`. Paid providers are shown but **locked** for
        `plan = 'free'` (with an upgrade hint)
  - [ ] Route all storage calls in `app_controller.js` through the active provider
        (single storage interface chosen at mount + on change)
  - [ ] Supabase Storage needs no OAuth (session token suffices) — Drive/Dropbox keep
        their connect flow; UI only requires the connect step for the chosen provider
  - [ ] Switching providers does NOT migrate drawings (RULEBOOK.md); drawings list
        shows the active provider's cloud contents + local IndexedDB — make that clear
  - [ ] (Deferred, decide with user) migration-on-switch as a separate task

- [ ] **S4 — Auto background + manual sync, and cloud/local badges**
  - [ ] After device sync: auto-upload each new drawing to the active provider (already
        the pattern for Drive; generalize to the active provider)
  - [ ] On load: retry pending uploads + **reconcile cloud-only drawings into the local
        list** (pull drawings saved from other devices) — new behavior
  - [ ] Add a manual **"Sync now"** button (push pending + pull cloud)
  - [ ] Per-drawing **cloud badge** on each tab (☁︎✓ synced / ☁︎↑ pending / ☁︎↓ cloud-only)
        + a one-line legend — extend `_renderDrawingList` (`app_controller.js:529-569`)
        using the existing `uploaded` / provider-file-id fields in `idb_store.js`
  - [ ] Test: sync with no cloud → ☁︎↑ badges; connect provider → uploads flip to ☁︎✓;
        open on a second device → cloud-only drawings appear as ☁︎↓ and cache on open

### Authentication — finish (rules in RULEBOOK.md → "Feature Tracking")

Auth is ~90% built (email/password + Google + GitHub wired in `docs/auth/auth_manager.js`).
Remaining:

- [ ] **Password-reset UI** — `resetPasswordForEmail` already exists; add a "Forgot
      password?" link on the login form + a recovery-callback handler (update password)
- [ ] **Account deletion** — replace the `deleteAccount` stub (`auth_manager.js:94-100`,
      only signs out) with a call to a Worker endpoint that runs `auth.admin.deleteUser`
      (service-role key). Add a "Delete account" action in Profile
- [ ] **GitHub OAuth App** — create at github.com/settings/developers → callback
      `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback` → enable in Supabase (also
      tracked under External Setup above)

### Backend — Cloudflare Worker (Phase 2, rules in RULEBOOK.md → "Web Development Phases")

Replaces the earlier Render plan. Frontend stays on GitHub Pages; BLE stays in the browser.

- [ ] **W-BE1 — Scaffold** — new top-level `worker/` with `wrangler.toml` + `src/index.js`;
      secrets as Worker env vars (Google + Dropbox client secrets, Supabase service-role)
- [ ] **W-BE2 — OAuth token exchange/refresh** — routes for Google Drive + Dropbox code
      exchange and refresh; frontend calls the Worker instead of the provider token
      endpoints directly. Remove `GDRIVE_CLIENT_SECRET` from `docs/auth/storage_oauth.js`
      (line 20) and route through the Worker
- [ ] **W-BE3 — Supabase Storage cap enforcement** — authoritative 10-drawing check on save
- [ ] **W-BE4 — Account deletion endpoint** — service-role `auth.admin.deleteUser` (used by
      the Auth-finish task above)
- [ ] **W-BE5 — Live-session broadcast (Durable Object)** — one DO per session; the drawing
      user's browser publishes captured strokes, authenticated viewers subscribe over
      WebSocket. Depends on live capture staying browser-side
- [ ] Keep the Worker **off the critical device-sync path** — sync + local save must work if
      the Worker is unreachable (RULEBOOK.md constraint)

### Live-session sharing (frontend, depends on W-BE5)

- [ ] Extend `docs/ble/live.js` to publish captured strokes to the Worker's session DO
- [ ] Add a viewer mode in `docs/ui/live_canvas.js` that subscribes to a session and renders
      incoming strokes in real time

### Phase 5 — Polish

- [ ] **Loading spinner** — Show skeleton or spinner in the drawings list while Google Drive files are being fetched
- [ ] **Offline message** — If `getValidAccessToken()` fails due to network error, show "Offline — connect to load drawings" instead of an unhandled error
- [ ] **Drive quota in profile** — Show Google Drive storage used/available in the Profile panel (GET `/drive/v3/about?fields=storageQuota`)
- [ ] **Drive account email in profile** — Show the connected Google account email in the Profile panel (from token userinfo endpoint)
- [ ] **Privacy policy** — Create `docs/privacy.html` (required for Google OAuth app verification)
- [ ] **Submit for Google verification** — Once privacy policy is live and app is stable, submit OAuth consent screen for Google verification (unlocks >100 users without manual test-user whitelisting)
