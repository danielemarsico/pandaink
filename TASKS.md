# PandaInk — Remaining Tasks

All completed tasks have been removed. See `PROGRESS.md` for history.

---

## Manual Actions — Daniele (Admin)

The web-app auth / tiered-storage / Cloudflare-Worker / live-sharing **code is implemented**.
These steps need external dashboards and accounts and can only be done by the project owner.
Do them at your own pace; each is independent unless noted.

### Supabase
- [ ] **Run migration `003_plan.sql`** in the Supabase SQL editor (adds `profiles.plan`,
      widens `storage_provider`, tightens RLS so users can't self-upgrade).
- [ ] **Run migration `004_storage.sql`** (creates the private `drawings` bucket + owner-only
      RLS for the free Supabase Storage tier).
- [ ] **Enable GitHub login** — create a GitHub OAuth App
      (github.com/settings/developers → callback `https://qqsbcovjvhmpypzglbyq.supabase.co/auth/v1/callback`),
      then Supabase → Authentication → Providers → GitHub (paste client id/secret).
- [ ] **Publish the Google OAuth consent screen** (move out of "Testing") for >100 users.

### Ko-fi (Pro = one-time $5)
- [ ] **Create a Ko-fi Shop item** priced **$5** named e.g. "PandaInk Pro" (one-time, lifetime
      Pro). Copy its share link into `docs/config.js` → `KOFI_PRO_URL`.
- [ ] After the Worker is deployed: **set the Ko-fi webhook URL** (Ko-fi → Settings → API /
      Webhooks) to `<WORKER_URL>/kofi/webhook`, and copy the **Verification Token** into the
      Worker secret `KOFI_VERIFICATION_TOKEN`.

### Dropbox (paid provider)
- [ ] **Create a Dropbox app** (App Console → Scoped access → App folder), permissions
      `files.content.write/read`, `files.metadata.read`; add redirect URI
      `https://danielemarsico.github.io/pandaink/app.html`. Copy the **App key** into
      `docs/config.js` → `DROPBOX_CLIENT_ID`.

### Cloudflare Worker (backend)
- [ ] **Create a Cloudflare account** and deploy `worker/` (`wrangler deploy`). Full steps in
      `worker/README.md`.
- [ ] **Set Worker secrets**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
      `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `KOFI_VERIFICATION_TOKEN`.
- [ ] **Set `WORKER_BASE_URL`** in `docs/config.js` to the deployed Worker URL. (Once set, the
      frontend routes Google token exchange, account deletion, and live sharing through it.)
- [ ] **Add the Google Drive redirect** for the Worker flow: in Google Cloud, the Drive OAuth
      client's authorized redirect URI stays `.../pandaink/app.html`; no change unless the URL
      differs. Paste the Drive **Client ID** into `docs/auth/storage_oauth.js` if not already.

> After each item, no code change is needed on my side — the frontend already reads these
> config values and endpoints. When `WORKER_BASE_URL`, `DROPBOX_CLIENT_ID`, and `KOFI_PRO_URL`
> are filled in and the migrations are run, everything below in "Blocked" becomes testable.

---

## Blocked — Complete After Daniele's Manual Actions

These need the admin steps above finished first. Grouped by which admin action unblocks them.

**After the Supabase migrations (003 + 004):**
- [ ] Verify free plan: a new account defaults to `plan='free'` and can only pick Supabase
      Storage; the 11th drawing fails with the cap message; deleting one lets a new save through.
- [ ] Verify a user cannot change their own `plan` from the client (RLS blocks it).

**After `DROPBOX_CLIENT_ID` is set (and a Pro account):**
- [ ] Connect Dropbox, sync a drawing, confirm `drawing_<ts>.json` lands in the app folder and
      re-appears after reload / on another browser (reconciliation).

**After the Worker is deployed + `WORKER_BASE_URL` set:**
- [ ] Google Drive connect now works without any secret in the frontend (token exchange via
      Worker); sync + reconcile round-trips.
- [ ] "Delete account" removes the auth user (profile/devices/tokens cascade) and logs out.
- [ ] Live sharing: enable "Share this session", open the `?watch=` link in a second signed-in
      browser, confirm strokes mirror in real time.

**After the Ko-fi Shop item + webhook are configured:**
- [ ] Buy the $5 Pro item with the account email → `profiles.plan` flips to `pro` → Drive &
      Dropbox unlock in the picker. Verify a mismatched email is handled (manual reconcile).

**Hardware (needs the Bamboo Folio):**
- [ ] Full device sync → each drawing gets a ☁↑ badge with no cloud, flips to ☁✓ once a
      provider is connected.

---

## Windows App

### Manual / User Steps

- [ ] **Screenshots** — Replace grey placeholder boxes in `docs/features.html` with real screenshots once app is stable
- [x] **Ko-fi** — Account created (`https://ko-fi.com/dan1elsan`); wired into `FUNDING.yml`,
      all page footers, the landing-page support section, and the web-app Profile panel.
      Still to set up a **Pro membership/shop tier** on Ko-fi for the paid unlock (see W-BE6)
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
  - [x] Per-drawing cloud badge in the UI (☁✓ / ☁↑ / ● local) — done in S4
  - [ ] Test on hardware: sync with no cloud → drawings appear and persist across
        reload; then connect Drive → pending drawings upload
  - [x] Verified in a headless browser (stubbed Supabase, Drive off): seeded local
        drawings render as tabs, canvas draws, delete removes from UI + IndexedDB

Tiered model (RULEBOOK.md → "Web App — Cloud Storage"): Supabase Storage = free
(max 10 drawings); Google Drive + Dropbox = paid (`profiles.plan = 'pro'`). Gating is an
entitlement flag; Pro is a one-time $5 Ko-fi purchase. **Code is now implemented** — the
remaining unchecked items are Daniele's admin setup (see "Manual Actions") and end-to-end
testing (see "Blocked on Daniele's manual actions").

- [x] **S0 — `profiles.plan` entitlement flag** — migration `003_plan.sql` (adds `plan`,
      widens `storage_provider`, RLS blocks self-upgrade); `cloud_store.js` reads plan and
      gates paid providers. (Admin: run the migration.)
- [x] **S2 — Supabase Storage provider (free tier, 10-drawing cap)** — `supabase_store.js`
      (upload/list/download/delete via the session token) + migration `004_storage.sql`
      (private `drawings` bucket, owner-only RLS). Client-side cap check throws `CAP_REACHED`
      at 10. (Admin: run the migration. Follow-up: authoritative Worker-side cap.)
- [x] **S2b — Dropbox provider (paid tier)** — `dropbox_store.js` + `dropbox_oauth.js`
      (secretless PKCE, no Worker needed); tokens in `storage_tokens` (`provider='dropbox'`).
      (Admin: create the Dropbox app + set `DROPBOX_CLIENT_ID`.)
- [x] **S3 — Provider selection UI (tier-gated)** — `profile_panel.js` provider picker: pick
      Supabase / Drive / Dropbox, paid ones locked on the free plan with an "☕ Upgrade to Pro"
      button (`KOFI_PRO_URL`). All cloud calls route through `cloud_store.js` (active provider).
- [x] **S4 — Auto background + manual sync, and cloud/local badges** — auto-upload after
      device sync; on load, retry pending + reconcile cloud-only drawings into the local list;
      manual "Sync now" button; per-drawing badge (☁✓ synced / ☁↑ pending / ● local).
- [ ] Follow-up: authoritative Worker-side 10-drawing cap enforcement (client check today).
- [ ] Follow-up: lazy "cloud-only, not cached" (☁↓) state — reconciliation caches eagerly now.
- [ ] Follow-up (decide with user): migration-on-switch between providers.

### Authentication — finish (rules in RULEBOOK.md → "Feature Tracking")

- [x] **Password-reset UI** — "Forgot password?" on the login form (`resetPasswordForEmail`)
      + a set-new-password recovery panel (`onPasswordRecovery` → `updatePassword`).
- [x] **Account deletion** — `deleteAccount()` now calls the Worker `/account/delete`
      (service-role `admin.deleteUser`); "Delete account" action added in Profile.
      (Admin: deploy the Worker for this to function.)
- [ ] **GitHub OAuth App** — admin task, see "Manual Actions".

### Backend — Cloudflare Worker (Phase 2, rules in RULEBOOK.md → "Web Development Phases")

Code implemented in `worker/` (`wrangler.toml` + `src/index.js`). Replaces the Render plan.

- [x] **W-BE1 — Scaffold** — `worker/wrangler.toml` + `worker/src/index.js` + `worker/README.md`.
- [x] **W-BE2 — Google OAuth token exchange/refresh** — `/oauth/google/token` + `/refresh`;
      frontend (`storage_oauth.js`) routes through the Worker when `WORKER_BASE_URL` is set,
      keeping the secret server-side. (Dropbox is secretless PKCE — no Worker route needed.)
- [x] **W-BE4 — Account deletion endpoint** — `/account/delete` (verifies the caller's token,
      then service-role delete).
- [x] **W-BE5 — Live-session broadcast (Durable Object)** — `LiveSession` DO + `/live/<id>`
      WebSocket relay (token-gated).
- [x] **W-BE6 — Ko-fi webhook → Pro unlock** — `/kofi/webhook` verifies the token, matches the
      payer email to a Supabase user, sets `profiles.plan='pro'`.
- [ ] **W-BE3 — Authoritative Supabase-Storage cap** — enforce the 10-cap server-side (client
      pre-check exists). Follow-up.

### Live-session sharing (frontend)

- [x] `docs/ble/live_share.js` (WebSocket transport) + host publish wired into `_startLive`
      (a "Share this session" toggle shows a `?watch=<id>` link) + viewer mode
      (`_maybeStartViewer` subscribes and renders into the live canvas).
- [ ] Test end-to-end once the Worker is deployed (see "Blocked on Daniele's manual actions").

### Phase 5 — Polish

- [ ] **Loading spinner** — Show skeleton or spinner in the drawings list while Google Drive files are being fetched
- [ ] **Offline message** — If `getValidAccessToken()` fails due to network error, show "Offline — connect to load drawings" instead of an unhandled error
- [ ] **Drive quota in profile** — Show Google Drive storage used/available in the Profile panel (GET `/drive/v3/about?fields=storageQuota`)
- [ ] **Drive account email in profile** — Show the connected Google account email in the Profile panel (from token userinfo endpoint)
- [x] **Privacy policy** — `docs/privacy.html` created (covers data collected, third-party
      services, Google Limited Use disclosure, retention/deletion, contact) and linked from
      every page footer. Admin: paste its URL
      (`https://danielemarsico.github.io/pandaink/privacy.html`) into the Google OAuth consent
      screen, and update the contact email if `marsicod@gmail.com` isn't the one you want public
- [ ] **Submit for Google verification** — Once privacy policy is live and app is stable, submit OAuth consent screen for Google verification (unlocks >100 users without manual test-user whitelisting)
