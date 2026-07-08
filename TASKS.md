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
  - [ ] Validate reply opcodes for AVAILABLE_FILES (`0xc2`) and GET_STROKES (`0xcf`)
        before parsing fields; raise a clear error on mismatch
  - [ ] Don't send `SET_MODE idle` after sync — Python leaves the device in paper mode;
        idle may stop the tablet recording new offline drawings
  - [ ] Port `register_device_finish()` (Slate: set time, transfer-GATT select, name,
        dimensions, firmware, battery) into the web registration flow
  - [ ] Make live.js ACK-check CONNECT and SET_MODE instead of fire-and-forget
  - [ ] Fix the fire-and-forget `stopNotify()` race in register.js `waitForNotification()`
        (same bug already fixed in sync.js `exchange()`)
  - [ ] Audit units: Python multiplies coords by point size (10 µm) and normalizes
        pressure to 16-bit; JS returns raw device units — check drawing_canvas.js /
        svg_export.js scaling

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

- [ ] **S1 — Local temporary storage (loss protection)** — REQUIRED per RULEBOOK.md.
  The device deletes each drawing during sync (`DELETE_OLDEST`), so until the cloud
  upload is confirmed the browser holds the only copy.
  - [ ] Revive `docs/storage/idb_store.js` (currently unused legacy) as the local
        pending-upload buffer: `savePending(drawing)`, `listPending()`,
        `removePending(id)` — keyed by drawing timestamp, must survive page reloads
  - [ ] Change the sync flow in `app_controller.js` `_cmdSync()`: save each drawing
        to IndexedDB **immediately after parsing, before any cloud call**; upload to
        the active provider; remove the local copy only after the upload is confirmed
  - [ ] On upload failure: keep the local copy, show a "pending upload" state in the
        UI (per-drawing badge or toast), don't throw away the sync result
  - [ ] On app start (`_mountApp`): check `listPending()` and retry uploading any
        pending drawings; surface a visible indicator while retries are pending
  - [ ] Manual retry affordance (button or automatic on Sync click)
  - [ ] Test: simulate upload failure (revoke Drive token / go offline mid-sync) →
        reload page → drawing still present and retried

- [ ] **S2 — Supabase Storage provider (10-drawing cap)**
  - [ ] Decide bucket layout: private bucket `drawings`, path `<user_id>/<timestamp>.json`,
        RLS policy so users can only read/write their own folder
  - [ ] Migration `00X_storage.sql`: create bucket + storage RLS policies
  - [ ] New `docs/storage/supabase_store.js` with the same interface as
        `gdrive_store.js` (`saveDrawing`, `listDrawings`, `loadDrawing`, `deleteDrawing`)
        so `app_controller.js` can swap providers behind one interface
  - [ ] Enforce the cap: before save, count the user's stored drawings; at 10, fail
        with a clear message ("delete old drawings or switch to Google Drive") —
        never silently drop (RULEBOOK.md rule)
  - [ ] Test: save 10 drawings → 11th fails with the message; delete one → save works

- [ ] **S3 — Provider selection UI (one active provider, changeable)**
  - [ ] Profile → Cloud Storage: radio/toggle between Google Drive and Supabase
        Storage; persist choice to `profiles.storage_provider`
  - [ ] Route all storage calls in `app_controller.js` through the active provider
        (single storage interface chosen at mount + on change)
  - [ ] Supabase Storage needs no OAuth (session token suffices) — Drive keeps its
        existing connect flow; UI must only require the Drive connect step when
        Drive is the chosen provider
  - [ ] Switching providers does NOT migrate drawings (RULEBOOK.md); drawings list
        shows only the active provider's contents — make that explicit in the UI copy
  - [ ] Decide (with user) whether migration-on-switch is wanted later; if yes, add
        a separate task

### Phase 5 — Polish

- [ ] **Loading spinner** — Show skeleton or spinner in the drawings list while Google Drive files are being fetched
- [ ] **Offline message** — If `getValidAccessToken()` fails due to network error, show "Offline — connect to load drawings" instead of an unhandled error
- [ ] **Drive quota in profile** — Show Google Drive storage used/available in the Profile panel (GET `/drive/v3/about?fields=storageQuota`)
- [ ] **Drive account email in profile** — Show the connected Google account email in the Profile panel (from token userinfo endpoint)
- [ ] **Privacy policy** — Create `docs/privacy.html` (required for Google OAuth app verification)
- [ ] **Submit for Google verification** — Once privacy policy is live and app is stable, submit OAuth consent screen for Google verification (unlocks >100 users without manual test-user whitelisting)
