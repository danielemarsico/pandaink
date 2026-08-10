# PandaInk Rulebook

Single source of truth for **features, tasks, and how things are supposed to work**.
When behavior is unclear or documentation conflicts, this file wins. Update it whenever
a feature is planned, changed, or completed.

- Task/TODO details live in `TASKS.md`; this file tracks the feature landscape and intended behavior.
- Architecture and code layout live in `.claude/CLAUDE.md`.

---

## Connection Methods to the Wacom Device (Bamboo Folio)

Four ways to connect to the tablet are planned; three exist today.

| # | Method | Entry point | Platform | Status |
|---|--------|-------------|----------|--------|
| 1 | Python CLI | `src/tuhi_cli.py` (list / search / listen / fetch / live) | Windows | ✅ Implemented |
| 2 | Windows GUI app | `src/tuhi_gui.py` (Tkinter — Normal + Live modes) | Windows | ✅ Implemented |
| 3 | Web app | `docs/app.html` via Web Bluetooth (GitHub Pages) | Any Chromium browser | ✅ Implemented — under active hardware testing |
| 4 | ESP32 | — | Embedded (standalone bridge) | 🔵 Planned only — no code yet |

### 1. Python CLI (Windows)
- BLE via `bleak`; shares the core library `src/tuhi/` with the GUI.
- Commands: `list`, `search`, `listen` (sync offline drawings), `fetch` (reload from disk), `live`.
- Drawings stored as JSON in `%APPDATA%\pandaink\`.

### 2. Windows GUI app
- Tkinter app (`src/tuhi_gui.py`), same core library and storage as the CLI.
- Normal mode: Register / Listen / Fetch, drawing tabs with export (SVG / PNG / PDF) and delete.
- Live mode: real-time pen strokes on a fullscreen canvas.
- Distributed as portable EXE and installer (built by CI).

### 3. Web app
- Fully static frontend on GitHub Pages using the Web Bluetooth API (`docs/ble/`).
- Auth via Supabase (email/password, Google, GitHub); device registration stored in Supabase.
- Drawings live locally (IndexedDB, always on) plus one **tiered** cloud provider:
  **Supabase Storage** (free, max 10 drawings) or **Google Drive** / **Dropbox** (paid).
  See "Web App — Cloud Storage" for the tier and sync rules.
- Feature parity target with the desktop app: register, sync offline drawings, live mode, export (SVG / PNG / PDF).
- Currently being validated against real Bamboo Folio hardware.

### 4. ESP32 (planned)
- Idea: a standalone ESP32 acting as a BLE bridge to the tablet, so drawings can be
  synced without a PC or browser.
- No design, tasks, or code exist yet — placeholder for future planning.

---

## Device Communication Protocol (Wacom SmartPad BLE)

How every client (CLI, GUI, web app, future ESP32) talks to the tablet. Reference
implementations: `src/tuhi/protocol.py` + `src/tuhi/wacom_win.py` (Python, source of
truth) and `docs/ble/` (JavaScript port). The Bamboo Folio is a **Slate-protocol**
device; Spark and Intuos Pro differ where noted.

### Transport — BLE GATT layout

All commands go over a Nordic UART service; bulk pen data arrives on dedicated
characteristics of separate services.

| Service / Characteristic | UUID | Role |
|---|---|---|
| Nordic UART service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | command channel |
| — TX characteristic | `6e400002-…` | client → device commands (write without response) |
| — RX characteristic | `6e400003-…` | device → client replies (notifications) |
| Offline data service | `ffee0001-bbaa-9988-7766-554433221100` | offline drawing transfer |
| — pen data characteristic | `ffee0003-…` | bulk stroke-file chunks (notifications) |
| Live service | `00001523-1212-efde-1523-785feabcd123` | real-time mode |
| — live pen data | `00001524-…` | real-time pen packets (notifications) |
| SysEvent service | `3a340720-c572-11e5-86c5-0002a5d5c51b` | presence distinguishes Slate/Intuos Pro from Spark |

In pairing mode the device advertises Wacom manufacturer-data company IDs
(`0x4755`, `0x4157`, `0x424d`) rather than service UUIDs.

### Packet framing

Every command written to TX is: `[opcode (1 byte)] [payload length (1 byte)] [payload]`.
Replies on RX use the same shape.

**Generic ACK**: most commands are answered with opcode `0xb3` (`REPLY_ACK`) whose
payload's first byte (packet offset 2) is a status code — `0x00` = success, otherwise
one of the device error codes:

| Code | Meaning |
|---|---|
| `0x01` | general error (also returned for a wrong/unregistered UUID on connect) |
| `0x02` | invalid state (e.g. device LED not blue — press the device button to recover) |
| `0x03` | read-only parameter |
| `0x04` | command not supported |
| `0x07` | authorization error |

**Timestamps are BCD-encoded**: 6 bytes, each byte's two hex digits are two decimal
digits of `YYMMDDHHMMSS` in UTC (e.g. `0x26 0x07 0x07 …` = year 26, month 07, day 07).
They are *not* little-endian integers.

**Command/reply discipline**: subscribe to RX notifications *before* writing the
command, or the reply can be missed. One command in flight at a time.

### Key opcodes

| Sent (TX) | Reply | Purpose |
|---|---|---|
| `0xe6` CONNECT (+6-byte UUID) | ACK, or raw `0x50` OK / `0x51` fail (Intuos Pro) | authenticate with registered UUID |
| `0xe7` REGISTER_PRESS (+UUID) | ACK, then `0xe4` REGISTER_WAIT | start registration (Slate); Spark uses `0xe3` |
| `0xe5` REGISTER_COMPLETE | ACK | finish registration (Spark only) |
| `0xb6` SET_TIME (+6 BCD bytes) | ACK | set device clock (UTC) |
| `0xb9` GET_BATTERY | `0xba` | battery %, charging flag |
| `0xea` GET_DIMENSIONS (+selector) | `0xeb` | selector `0x03`=width, `0x04`=height; u32 LE at offset 4, × point size (10 µm hardcoded for Spark/Slate/Folio) |
| `0xb7` GET_FIRMWARE (+selector 0/1) | `0xb8` | firmware version, two halves |
| `0xec` SET_FILE_TRANSFER (`06 00 00 00 00 00`) | ACK | route offline data to `ffee0003` |
| `0xb1` SET_MODE (+mode) | ACK | `0x00` live, `0x01` paper, `0x02` idle |
| `0xc1` AVAILABLE_FILES | `0xc2` | u16 LE file count at offset 2 |
| `0xcc` GET_STROKES (Slate) | `0xcd` | oldest file: u32 stroke count at offset 2, BCD timestamp at offset 6; Spark uses `0xc5`/`0xc7` |
| `0xc3` DOWNLOAD_OLDEST | `0xc8`, then data + `0xc9` CRC | stream oldest file over `ffee0003` |
| `0xca` DELETE_OLDEST | ACK | remove oldest file from device |

### Registration (one-time pairing)

The client generates a random **6-byte UUID** which becomes the shared credential;
the device only accepts future CONNECTs bearing it. Stored per user: Supabase
`devices` table (web app) or `settings.ini` (Windows app).

1. Detect family: no SysEvent service ⇒ Spark; otherwise Slate/Intuos Pro.
2. **Slate/Folio**: send `REGISTER_PRESS 0xe7` with the UUID. (**Spark**: first send
   CONNECT — the expected auth error is ignored — then `0xe3`.)
3. Device ACKs, then waits for the user to **press the physical button** (30 s window).
4. On button press the device sends `0xe4` REGISTER_WAIT (Slate/Spark) or `0x53`
   (Intuos Pro) — this also identifies the protocol version to store.
5. **Spark only**: send `REGISTER_COMPLETE 0xe5`, expect ACK.

### Connection / authentication (every session)

Send `CONNECT 0xe6` with the registered 6-byte UUID. Replies:

- ACK `0xb3` with status `0x00` — success (Spark/Slate/Folio).
- ACK with status `0x01` — wrong/unregistered UUID (re-register needed).
- ACK with status `0x02` — device in invalid state; the LED must be **blue**.
  Pressing the device button switches it back from green. This state also occurs
  after an aborted sync.
- Raw `0x50` OK / `0x51` fail — Intuos Pro only (fail reason byte follows the
  echoed UUID; `0x00` = invalid state, `0x01`/`0x02` = incorrect UUID).

Web Bluetooth caveat: GATT characteristic references are scoped to a single GATT
session — on reconnect all cached characteristics/notification handlers must be
discarded and re-fetched, or calls fail with `InvalidStateError`.

### Offline sync (fetching stored drawings)

The device rejects file operations unless this exact handshake runs first
(ports `WacomDeviceSlate.retrieve_data()`):

1. CONNECT with UUID (above).
2. SET_TIME — current UTC as 6 BCD bytes.
3. GET_BATTERY (result unused, but required by the device's command sequence).
4. GET_DIMENSIONS ×2 (width selector `0x03`, height `0x04`) → tablet size in µm.
5. GET_FIRMWARE ×2 (selectors 0 and 1).
6. SET_FILE_TRANSFER — routes stroke data to the `ffee0003` characteristic.
7. SET_MODE paper (`0x01`).
8. AVAILABLE_FILES → number of stored drawings (may be 0).
9. Per file, oldest first:
   a. GET_STROKES → stroke count + BCD creation timestamp of the oldest file.
   b. Subscribe to `ffee0003` *and* RX, then send DOWNLOAD_OLDEST. The device
      first acks it on RX with `0xc8` payload `[0xbe]` ("download starting") —
      this is NOT the end marker.
   c. Accumulate binary chunks from `ffee0003` until the end-of-download reply
      arrives on RX, then concatenate. **Slate/Folio**: `0xc8` with payload
      `[0xed, <CRC32 little-endian>]`. **Spark/Intuos Pro**: `0xc9` with the
      CRC32 as payload, big-endian. Either way, verify the CRC against
      `crc32(concatenated pen data)` and fail the sync on mismatch.
   d. Parse the stroke file (format below).
   e. DELETE_OLDEST (so the next GET_STROKES sees the following file).
10. Deliberately do **not** SET_MODE idle after sync — leave the device in the
    paper mode set in step 7. Idle mode may stop the tablet from recording new
    offline drawings until the next connection re-authorizes it.

### Stroke file binary format

Concatenated download chunks form one file per drawing:

- **Header**: 4-byte magic `62 38 62 74` ('b8bt', Spark/Slate — 4-byte header) or
  `67 82 69 65` (Intuos Pro — 16-byte header including a u32 timestamp).
- **Body**: a stream of variable-length packets, each starting with a 1-byte
  header. Packet size = 1 + popcount(header) (except delta packets, whose size
  follows from their axis mask). A packet is classified by header **and**
  payload (payload = the popcount(header) bytes after it), checked in this
  exact order (ports `StrokeDataType.identify`):
  1. file magic (`62 38 62 74` / `67 82 69 65`) — file header; mid-stream = desync.
  2. `0xfc` + 6×`0xff` — end of stroke.
  3. header `0xff` with all 8 payload bytes `0xff` — end of file. (A full
     point `[0xff][0xff 0xff][x y p]` is NOT EOF — its coordinate bytes differ.)
  4. header with low two bits `00` — delta packet: the header's upper 6 bits
     are 2-bit fields for the X, Y, pressure axes: `00` = unchanged, `10` =
     signed 1-byte delta, `11` = absolute u16 little-endian.
  5. payload starting `0xfa` (Intuos Pro; may be followed by a 9-byte pen-ID
     packet) or `0xff 0xee 0xee` (Slate/Folio) — start of a new stroke; resets
     the delta accumulators.
  6. payload starting `0xff 0xff` — "point" packet: a delta packet whose axis
     mask is the header with the low two bits cleared (headers other than
     `0xff`, e.g. `0xbf`, occur) and whose payload follows the `0xff 0xff` prefix.
  7. payload starting `0xdd 0xdd` — lost points marker (skip, emit nothing).
  8. anything else — unknown; skip 1 + popcount(header) bytes.
- Coordinates are device units; multiply by point size (10 µm) for physical size.
  Deltas accumulate cumulatively per axis (P2 = P0 + 2·d1 + d2); an absolute
  value resets that axis's accumulator.

### Live mode (real-time streaming)

1. CONNECT with UUID.
2. SET_MODE live (`0x00`).
3. Subscribe to the live pen data characteristic (`00001524-…`). Packet types:
   - `0xa1` — coordinate stream: `[0xa1] [len] [6 bytes per point: x u16 LE, y u16 LE, pressure u16 LE]`; a point of six `0xff` bytes = pen left proximity.
   - `0xa2` — pen entered proximity (timestamp header, ignored by clients).
   - `0x10` — raw pressure/button events (ignored).
4. To stop: unsubscribe, SET_MODE idle.

---

## Web App — Cloud Storage

Where synced drawings live after they leave the device. Three cloud providers behind a
**free/paid tier model**; the user picks **exactly one** at a time (local IndexedDB is
always on underneath — see below).

| Provider | Tier | Location | Limit | Status |
|---|---|---|---|---|
| Supabase Storage | **Free** | app-owned Supabase project, private bucket `drawings`, path `<user_id>/<timestamp>.json` | **max 10 drawings per user** | ✅ Code done (`docs/storage/supabase_store.js`); needs migration `004_storage.sql` run |
| Google Drive | **Pro (paid)** | user's own Drive, `appDataFolder` (hidden, app-private), one `drawing_<timestamp>.json` per drawing | none (user's Drive quota) | ✅ Code done (`docs/storage/gdrive_store.js`); token exchange routes through the Worker |
| Dropbox | **Pro (paid)** | user's own Dropbox, app folder | none (user's Dropbox quota) | ✅ Code done (`docs/storage/dropbox_store.js`); secretless PKCE, no Worker needed |

All three implement one interface behind `docs/storage/cloud_store.js`, which picks the active
provider from `profiles.storage_provider` and gates the paid ones on `profiles.plan`.

### Tier / entitlement rules

- Each user has a plan stored in `profiles.plan` = `free` | `pro` (default `free`).
- **Free** users may only select **Supabase Storage** (10-drawing cap).
- **Pro** users may select **Supabase Storage, Google Drive, or Dropbox**.
- Gating is an **entitlement flag** — `profiles.plan = 'pro'` unlocks the paid providers.
  Payments run through **Ko-fi** (`https://ko-fi.com/dan1elsan`); see "Pro unlock via Ko-fi".
- The Supabase Storage **10-drawing cap** is enforced when saving: at the cap, saving a new
  drawing must fail with a clear message telling the user to delete old drawings (or upgrade
  to a paid provider) — it must **never silently drop a drawing**. Enforced in two layers:
  `supabase_store.js` blocks the 11th drawing client-side (for a fast, friendly error message),
  and migration `005_storage_cap.sql` adds a `BEFORE INSERT` trigger on `storage.objects` that
  authoritatively rejects it server-side for `plan = 'free'` users even if the client check is
  bypassed. Overwriting an existing drawing (same object name) never counts against the cap.
  Only an explicit `profiles.plan = 'pro'` lifts the cap — a user with **no** `profiles` row is
  treated as free, not as unlimited.
- The cap counts objects **in Supabase Storage**, not drawings on the device. The local
  IndexedDB store is deliberately uncapped (it is the source of truth and must never drop a
  drawing), so at the cap the app can legitimately show more than 10 drawings locally with the
  extras badged as "not yet in cloud". The Profile panel shows `N / 10 drawings used` so the
  remaining allowance is visible before a sync hits it.
- Client-side saves to Supabase Storage are **serialized within a tab** (`supabase_store.js`):
  the cap check is a list-then-upload sequence, and two overlapping saves could otherwise both
  read the same pre-cap count and land an 11th object. Concurrent uploads from *different*
  tabs or devices are caught by the trigger.

### Provider selection rules

- The user chooses their storage provider in Profile → Cloud Storage (paid providers are
  shown but locked for free-plan users).
- **Only one provider can be active at a time.** The choice is stored in
  `profiles.storage_provider` (allowed values: `supabase` | `google_drive` | `dropbox` | null)
  and can be changed later.
- Switching providers does not automatically migrate existing drawings; drawings stay where
  they were saved, and the drawing list shows only the active provider's cloud contents (plus
  everything in local IndexedDB). Migration-on-switch is a possible future feature.

### Pro unlock via Ko-fi

Support and the paid tier both run through Ko-fi (`https://ko-fi.com/dan1elsan`):

- **Support (donations)** — a "☕ Support on Ko-fi" link in every page footer (`docs/`), a
  support section on the landing page, and a support link in the web app's Profile panel.
  Pure tips; no account effect. Mirrored in `.github/FUNDING.yml` (`ko_fi: dan1elsan`) for the
  GitHub Sponsor button.
- **Pro upgrade** — a **one-time $5** purchase via a Ko-fi **Shop item** grants lifetime Pro.
  The "☕ Upgrade to Pro" button in Profile → Cloud Storage links to that Shop item
  (`KOFI_PRO_URL` in `docs/config.js`). One-time (not recurring), so there is no lapse/renewal
  to track — Pro stays on once granted.
- **Automated unlock (Cloudflare Worker)** — Ko-fi's **webhook** POSTs to `POST /kofi/webhook`
  on the Worker. The Worker: (1) verifies the Ko-fi `verification_token`; (2) claims the payload's
  `kofi_transaction_id` (see "Replay protection" below); (3) reads the payer `email`; (4) finds
  the Supabase user with that email and sets `profiles.plan = 'pro'` (service-role, bypassing
  RLS). Implemented in `worker/src/index.js`.
  - **Email-match caveat**: Ko-fi reports the payer's Ko-fi email; unlock only works if it
    matches the PandaInk account email. The upgrade UI tells the user to pay with their account
    email, and the owner keeps a manual reconciliation path for mismatches (a webhook with no
    matching account returns 200 so Ko-fi does not retry forever) — see README.md "Ko-fi Pro
    unlock (admin)". A buyer whose webhook fails outright (e.g. a transient network error between
    Ko-fi and the Worker) has no way to retrigger it themselves; the same manual path covers that
    too — they email the owner, who confirms the purchase in the Ko-fi dashboard and grants Pro.
  - **Replay protection**: `KOFI_VERIFICATION_TOKEN` is a single static secret, not a per-request
    signature, so anyone who obtained it could otherwise forge unlimited fake "payments". Migration
    `006_kofi_events.sql` adds a `kofi_events` table (`kofi_transaction_id` primary key); the Worker
    atomically inserts the incoming transaction id before granting anything, and a unique-constraint
    conflict (already processed — a genuine Ko-fi retry, a replayed capture, or a forged request
    reusing an old id) makes it a no-op that still returns 200 (so Ko-fi doesn't keep retrying).
- **Interim (before the Worker is deployed)** — the owner manually flips `profiles.plan` to
  `pro` in Supabase after a Ko-fi payment. Gating, buttons, and the free-tier experience all
  work regardless; only the automatic unlock waits on the Worker deploy.

### Cloud sync model — auto background + manual

Cloud sync is **automatic in the background**, with a manual "Sync now" control as a backstop:

- **After each device sync**, every newly downloaded drawing is uploaded to the active
  provider (best-effort; a failure leaves it local-only and pending — see loss protection).
- **On app load**, pending (not-yet-uploaded) drawings are retried, and **cloud-only drawings
  are reconciled into the local list** (drawings saved from another device/browser are pulled
  down so the list is complete across devices).
- A manual **"Sync now"** button forces the same push-pending + pull-cloud pass on demand.
- Device → browser sync itself stays **manual** (the user presses Sync) — it needs Web
  Bluetooth, which only runs in the browser.

### Distinguishing local-only vs cloud-synced drawings

Each drawing tab carries a **cloud badge** so the user can tell at a glance where a drawing
lives, plus a one-line legend:

- **☁︎✓ synced** — saved locally and confirmed in the active cloud provider.
- **☁︎↑ pending** — saved locally, not yet uploaded (upload failed or no provider connected);
  will retry on next sync/load.
- **☁︎↓ cloud-only** — present in the cloud (e.g. from another device) and not yet cached
  locally; downloaded on demand when opened.

Badge state derives from the existing IndexedDB record fields (`uploaded`, `driveFileId` /
provider file id) — see loss protection below.

### Local storage (IndexedDB) — always on, cloud is optional

Device sync and cloud upload happen at **two different moments**, and the device
**deletes each drawing from its own memory during sync** (`DELETE_OLDEST`, step 9e
of the sync flow above). So between "taken from the device" and "confirmed saved in
the cloud", the browser holds the only copy. Any remote failure in that window
(Drive/Supabase outage, expired token, network drop, closed tab) would lose the
drawing permanently — and if **no cloud provider is configured at all**, there is
no remote step to reach in the first place.

Rule: the local IndexedDB store (`docs/storage/idb_store.js`) is the **source of
truth** for the drawings the app displays. Every synced drawing is written there
**first**, before any cloud call, and stays there. Cloud upload is layered on top
and is entirely optional:

```
device sync → save to IndexedDB (immediately, before anything remote)   ← always
            → cloud provider connected?
                 no  → done; drawing lives locally and is shown from IndexedDB
                 yes → upload to the active provider (best-effort)
                        → success → mark record uploaded (keep the local copy)
                        → failure → leave it pending; retry on next load / sync
```

- The app works with **no cloud configuration** — sync, save, view, export, and
  delete all function against IndexedDB alone.
- Drawings (and their pending/uploaded state) survive a page reload — the drawing
  list is rendered from IndexedDB on mount, before any BLE reconnect.
- On app start, if a cloud provider is connected, pending (not-yet-uploaded)
  drawings are retried in the background; a failed retry stays pending, never lost.
- Local copies are retained even after a successful cloud upload, so the local
  view keeps working offline and never depends on a remote round-trip.
- Deleting a drawing removes the local copy (and the cloud copy too, if one exists
  and the provider is connected).
- Status: ✅ Implemented (`docs/storage/idb_store.js` + `app_controller.js`
  `_cmdSync` / `_loadStoredDrawings` / `_deleteDrawing`). Planned on top of it (see the
  cloud sync + badge rules above): the per-drawing cloud badge (☁︎✓/☁︎↑/☁︎↓ — status text
  only today), cross-device reconciliation of cloud-only drawings into the local list, and
  the Supabase / Dropbox providers behind the same local-first flow.

---

## Web Development Phases

### Phase 1 — Static (current)

- Frontend: static HTML/JS on **GitHub Pages** (`docs/` on `master`), no build step.
- No backend of our own: browser talks directly to Supabase (auth + DB) and Google
  Drive (storage). All logic — BLE protocol, stroke parsing, OAuth, uploads — runs
  in the browser.
- Consequence of having no backend: the Google Drive `client_secret` would ship in the
  frontend source. This is a **temporary** tradeoff — Phase 2 (Cloudflare Worker) moves the
  secret server-side; it is not the intended end state.

### Phase 2 — Frontend + Cloudflare Worker backend (planned)

The backend is a **Cloudflare Worker** (chosen over the earlier Render/Vercel idea — see
"Why Cloudflare" below). The frontend stays on GitHub Pages; BLE never leaves the browser.

| Layer | Service | Role |
|---|---|---|
| Frontend | **GitHub Pages** (`docs/`) | web app UI + all Web Bluetooth (connect, register, sync, live capture) — unchanged location |
| Backend | **Cloudflare Worker** | holds Google + Dropbox OAuth **client secrets**; does token **exchange/refresh**; performs account deletion (Supabase service-role); **broadcasts live sessions** to viewers via a Durable Object |
| Database | **Supabase** | unchanged: auth, profiles (incl. `plan`), devices, `storage_tokens`; plus the Supabase Storage provider |

Division of responsibilities:

- **Browser keeps everything that must touch the device**: Web Bluetooth connect, register,
  sync, and **live pen capture**. A backend can never do BLE — Web Bluetooth is browser-only.
- **Worker takes everything that needs secrets or trust**: **Google** OAuth token
  exchange/refresh (holds the `client_secret` — supersedes both the Render plan and the
  Google-Identity-Services approach in `.claude/plans/gdrive-secretless-auth.md`), account
  deletion (Supabase service-role), and the **Ko-fi Pro-unlock webhook**. **Dropbox** uses
  secretless PKCE and stays fully in the browser — no Worker endpoint. Supabase Storage cap
  enforcement is client-side (fast UX) **and** authoritative server-side via a Postgres
  trigger (migration `005_storage_cap.sql`, not the Worker — uploads go straight from the
  browser to Supabase Storage, so the database itself is the right enforcement point).
- **Worker owns live-session broadcast**: a **Durable Object** per live session holds the
  WebSocket connections; the drawing user's browser publishes captured strokes to it and the
  Worker fans them out to authenticated viewers in real time. (Capture is always browser-side;
  the Worker only relays — it never talks to the tablet.)

Why Cloudflare (vs the earlier Render/Vercel plan):

- **No spin-down.** Render's free web service sleeps after ~15 min idle and cold-starts in
  ~30–60 s; since PandaInk usage is "open once, sync, leave", nearly every session would hit a
  cold backend. Cloudflare Workers have no spin-down and start in ~milliseconds.
- **Cheaper / simpler free tier**: 100k requests/day, no server to keep warm, deploy with
  `wrangler` — no separate frontend host (GitHub Pages stays).
- Workers are **stateless** per request; durable per-session state (live broadcast) lives in
  **Durable Objects**, and all persistent state lives in **Supabase**.

Constraints / notes:

- **Keep the Worker off the critical device-sync path.** BLE sync, stroke parsing, local
  IndexedDB save, and viewing all work without the Worker; only cloud **token** operations and
  live broadcast need it. A Worker outage never blocks capturing or locally saving a drawing.
- The local IndexedDB loss-protection buffer (Cloud Storage section above) remains a frontend
  responsibility.
- Status: ✅ Worker code implemented in `worker/` (`wrangler.toml` + `src/index.js`: Google
  token exchange/refresh, account deletion, Ko-fi webhook, `LiveSession` Durable Object).
  Pending admin actions: create the Cloudflare account, set secrets, `wrangler deploy`, and
  paste the Worker URL into `docs/config.js`. Until then the frontend falls back gracefully
  (Supabase + Dropbox + local work without it). See TASKS.md → admin section.

---

## Feature Tracking

Add new features here as they are planned, with enough "how it should work" detail
that behavior questions can be answered from this file.

### Authentication & account lifecycle

Auth runs on **Supabase Auth**, client-side (no custom auth server). Methods, all wired in
`docs/auth/auth_manager.js`:

- **Email/password** — sign up (with `full_name` metadata + email-confirmation redirect) and
  sign in. A DB trigger creates the `profiles` row on signup.
- **Google** and **GitHub** — Supabase social login (`signInWithOAuth`). Each requires the
  provider enabled in the Supabase dashboard; the GitHub OAuth App is still to be configured.
- **Password reset** — `resetPasswordForEmail` exists in code; needs a UI entry point
  ("Forgot password?" on the login form + a recovery handler).
- **Account deletion** — currently a stub (only signs out). Real deletion needs a privileged
  call (`auth.admin.deleteUser`) and so must run on the **Cloudflare Worker** with the Supabase
  service-role key; the frontend calls that Worker endpoint.

The Google **Drive** OAuth in `docs/auth/storage_oauth.js` is separate from Supabase social
login (it grants Drive `appdata` access, not app login). Its `client_secret` moves to the
Worker in Phase 2.

### Drawing export formats (SVG / PNG / PDF)

Every drawing can be exported in three formats from both the **desktop GUI** and the **web app**.
All three share the same coordinate/orientation transform (device units → output units, with the
portrait/landscape swap and pressure-driven stroke width) so a drawing looks identical across formats.

- **SVG** — the source-of-truth vector output. Pressure is preserved as per-segment `stroke-width`;
  black strokes on a transparent background. Desktop: `JsonSvg` (`src/tuhi/export_win.py`, `svgwrite`).
  Web: `drawingToSvg` (`docs/export/svg_export.js`).
- **PNG** — raster image with a **transparent** background, black strokes.
  Desktop: `JsonPng` renders with Pillow (`ImageDraw.line`, RGBA). Web: `drawingToPngBlob` rasterizes
  the generated SVG onto an offscreen `<canvas>` and calls `canvas.toBlob('image/png')`.
- **PDF** — a **single raster page** on a **white** background (PDF has no alpha, so strokes are
  flattened onto white). Desktop: `JsonPdf` renders the same Pillow image, converts to RGB, and saves
  via `Image.save(..., 'PDF')`. Web: `drawingToPdfBlob` rasterizes to a JPEG and embeds it in a
  minimal, hand-built PDF (single `DCTDecode` image XObject). The hand-built PDF avoids any external
  library so it works under the static site's strict CSP; page size is derived from the drawing's
  millimetre dimensions.

Shared implementation notes:
- **No new dependencies.** Desktop reuses Pillow (already required for PNG); web uses only built-in
  browser APIs (`<canvas>`, `toBlob`/`toDataURL`, `TextEncoder`).
- **UI.** Desktop: each drawing tab has an **`Export ▾`** menu (`Save as SVG… / PNG… / PDF…`).
  Web: each tab toolbar has **`Save SVG` / `Save PNG` / `Save PDF`** buttons; the PNG/PDF buttons
  disable themselves while rendering. Default filename is `drawing_<timestamp>.<ext>`.
- **Cloud upload** (desktop Google Drive / Dropbox / OneDrive) still uploads **SVG** only.

### Drawing management — rename, merge, automerge

Three drawing-organisation features, implemented identically in the **desktop GUI**
(`src/tuhi_gui.py` + `src/tuhi/config_win.py`) and the **web app** (`docs/ui/app_controller.js`
+ `docs/storage/idb_store.js` and the cloud stores). Drawings keep a per-drawing user
label alongside their timestamp identity.

- **Rename.** Drawings are identified by their creation timestamp, but each drawing now
  also carries an optional user-set label (`title` in the desktop JSON, `name` in the web
  record). A `Rename` button in each drawing's toolbar prompts for a name; when set, the
  tab shows the name instead of the timestamp, and it becomes the default export filename.
  Clearing the name reverts to the timestamp. The timestamp (and the on-disk / cloud file
  name) never changes — rename only edits the label. Web renames also re-upload the record
  so the name follows the drawing across devices (best-effort).

- **Merge.** A `Select` toggle in the action bar enters selection mode: a checkbox appears
  for each drawing. The user ticks two or more, clicks `Merge`, and confirms a warning that
  the operation is **irreversible**. The selected drawings' strokes are concatenated (in
  timestamp order) into a single **new** drawing (fresh, non-colliding timestamp; dimensions
  taken from the first selected drawing) and the **originals are permanently deleted** —
  locally and, when a cloud provider is connected, in the cloud too.

- **Automerge.** A switch in the action bar (persisted: `[App] Automerge` in
  `app_settings.ini` on desktop; `localStorage['pandaink.automerge']` on web). While **on**,
  every newly saved drawing — offline sync on both platforms, plus live-session save on
  desktop — has its strokes **appended to a single "target" canvas** instead of creating a
  new file. The first drawing after the switch is enabled becomes the target; each later one
  appends to it (the cloud copy is overwritten in place, keyed by the target's timestamp).
  While **off**, every new drawing is saved to its own file as before. Toggling the switch
  (either direction) **resets the target**, so a fresh merged canvas starts each time
  automerge is enabled. The target id/timestamp is tracked per device (desktop: `[Automerge]`
  section keyed by BT address; web: `localStorage['pandaink.automergeTarget.<deviceId>']`).

### Web app — installable PWA

The web app is a **Progressive Web App** and can be installed to the home screen / app
launcher. This works on GitHub Pages because Pages serves over HTTPS (a hard requirement
for service workers) and can host the manifest, service worker, and icons as ordinary
static files. Everything uses **relative paths** so it works under the project sub-path
(`danielemarsico.github.io/pandaink/`).

- **Manifest** (`docs/manifest.webmanifest`): `start_url` `./app.html`, `scope` `./`,
  `display: standalone`, theme `#1e3a5f`, and 192/512 plus a 512 **maskable** icon
  (`docs/icons/`, rasterised from `favicon.svg`).
- **Service worker** (`docs/sw.js`, scope `/pandaink/`): registered from `app.html`. It
  **only touches same-origin GET requests** — cross-origin traffic (Supabase, Google Drive,
  Dropbox, the Worker, the jsDelivr CDN) always goes straight to the network and is never
  cached or blocked, so auth/API/BLE flows are unaffected. Navigations are network-first (new
  deploys win; the cached shell is the offline fallback); other static assets are cache-first
  with runtime population; `version.json` is always fetched fresh. A cache version tag
  (`pandaink-shell-v1`) lets `activate` purge old caches.
- **Install UX** (`app.html`): standard `<link rel="manifest">` + theme-color +
  apple-touch-icon/meta tags make the browser offer its native install. An **"Install as app"**
  button also appears when Chromium fires `beforeinstallprompt`, triggering the install dialog
  on demand. On iOS (no `beforeinstallprompt`) users install via Share → Add to Home Screen —
  note Web Bluetooth itself is still unsupported there, so an installed iOS copy can view but
  not sync.

### Live-session sharing (planned)

Real-time spectating of a live drawing session. The drawing user's browser captures pen data
over Web Bluetooth (as live mode does today) and, in addition to rendering it locally,
publishes each stroke packet to a **Cloudflare Durable Object** (one per session). Other
**authenticated** users open the same session and subscribe over WebSocket, seeing strokes
appear in real time. Capture is always browser-side; the Worker/Durable Object only relays —
it never connects to the tablet. Depends on the Phase 2 Worker.
