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
- Normal mode: Register / Listen / Fetch, drawing tabs with SVG export and delete.
- Live mode: real-time pen strokes on a fullscreen canvas.
- Distributed as portable EXE and installer (built by CI).

### 3. Web app
- Fully static frontend on GitHub Pages using the Web Bluetooth API (`docs/ble/`).
- Auth via Supabase (email/password, Google, GitHub); drawings stored in the user's
  Google Drive `appDataFolder`; device registration stored in Supabase.
- Feature parity target with the desktop app: register, sync offline drawings, live mode, SVG export.
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
10. SET_MODE idle (`0x02`).

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

Where synced drawings live after they leave the device. Two providers; the user
picks **exactly one** at a time.

| Provider | Location | Limit | Status |
|---|---|---|---|
| Google Drive | user's own Drive, `appDataFolder` (hidden, app-private), one `drawing_<timestamp>.json` per drawing | none (user's Drive quota) | ✅ Implemented (`docs/storage/gdrive_store.js`) |
| Supabase Storage | app-owned Supabase project, per-user bucket/folder | **max 10 drawings per user** | 🔵 Planned — no code yet |

### Provider selection rules

- The user chooses their storage provider in Profile → Cloud Storage.
- **Only one provider can be active at a time.** The choice is stored in
  `profiles.storage_provider` (Supabase) and can be changed later.
- Switching providers does not automatically migrate existing drawings; drawings
  stay where they were saved. (Migration on switch is a possible future feature —
  decide before implementing Supabase Storage.)
- Supabase Storage enforces the 10-drawing cap per user: when the cap is reached,
  saving a new drawing must fail with a clear message telling the user to delete
  old drawings (or switch to Google Drive) — it must never silently drop a drawing.

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
  `_cmdSync` / `_loadStoredDrawings` / `_deleteDrawing`). Not yet done: a
  per-drawing "pending upload" badge in the UI (status text only for now), and
  cross-device reconciliation of cloud-only drawings back into the local list.

---

## Web Development Phases

### Phase 1 — Static (current)

- Frontend: static HTML/JS on **GitHub Pages** (`docs/` on `master`), no build step.
- No backend of our own: browser talks directly to Supabase (auth + DB) and Google
  Drive (storage). All logic — BLE protocol, stroke parsing, OAuth, uploads — runs
  in the browser.
- Consequence of having no backend: the Google Drive `client_secret` ships in the
  frontend source (documented tradeoff in README.md).

### Phase 2 — Frontend + Python backend (planned)

| Layer | Service | Role |
|---|---|---|
| Frontend | **Vercel** | web app UI (moves off GitHub Pages); BLE stays here — Web Bluetooth only works in the browser |
| Backend | **Render** (Python) | server-side logic: OAuth token exchange (secrets stay server-side), cloud-storage uploads, heavy processing (e.g. stroke parsing / SVG generation reusing the existing `src/tuhi/` Python code) |
| Database | **Supabase** | unchanged: auth, profiles, devices; plus Supabase Storage provider |

Division of responsibilities:

- **Browser keeps everything that must touch the device**: Web Bluetooth connect,
  register, sync, live mode. A backend can never do BLE.
- **Backend takes everything that needs secrets or trust**: Google OAuth
  token exchange/refresh (removes the shipped `client_secret` — supersedes part of
  `.claude/plans/gdrive-secretless-auth.md`), enforcing the Supabase Storage
  10-drawing cap server-side, any future rate limiting.
- **Backend may also take shared logic**: the stroke-file parser exists twice today
  (Python `src/tuhi/protocol.py` + JS `docs/ble/sync.js`) and the JS port has been a
  bug source — Phase 2 allows the browser to send raw pen data to the backend and
  reuse the proven Python parser. Open decision: parse in browser (offline-capable)
  vs backend (single implementation) vs both.

Constraints / notes:

- Free tiers: Vercel hobby + Render free web service + Supabase free tier.
- **Render spin-down (free tier) — design constraints.** The service stops after
  ~15 min without requests and takes ~30-60 s to cold-start on the next one. Since
  PandaInk usage is "open once, sync, leave", nearly every session hits a cold
  backend. Rules that follow:
  - **Keep the backend out of the critical sync path.** BLE sync, stroke parsing
    (if browser-side), and cloud upload must work without waiting on Render; the
    backend handles auth/token work only. Then a cold start costs one small delay
    per session instead of stalling a sync mid-flight.
  - **Warm it opportunistically**: on app mount, fire a fire-and-forget
    `GET /health` so the backend wakes while the user logs in and connects BLE —
    usually awake by the time they hit Sync.
  - **Expect timeouts in the frontend**: backend calls need generous timeouts and
    a retry, with an honest "waking up the server (~30 s)…" message — never a
    generic network error or a spinner that looks hung.
  - **The backend must be fully stateless**: spin-down wipes RAM (caches, queues,
    rate-limit counters). All state lives in Supabase.
  - **No background work on the backend**: a spun-down service can't run retry
    queues or scheduled jobs — upload retry stays in the frontend (IndexedDB
    buffer, see Cloud Storage section).
  - If the backend ever does end up in the critical path: Render's paid starter
    tier (~$7/month) doesn't spin down. External pingers to keep it warm are
    fragile and burn free instance-hours — not a long-term plan.
  - This weighs on the open parse-in-browser-vs-backend decision above: backend
    parsing puts Render in the critical sync path and inherits all of the above.
- GitHub Pages (`docs/`) stays as the project/landing/download site; only the app
  moves to Vercel. Decide whether `app.html` redirects or is removed.
- The local IndexedDB loss-protection buffer (Cloud Storage section above) remains
  a frontend responsibility in both phases.
- Status: 🔵 Planned — no accounts, config, or code yet. Phase 1 bugs (BLE critical
  fixes) and Cloud Storage tasks come first; see TASKS.md.

---

## Feature Tracking

Add new features here as they are planned, with enough "how it should work" detail
that behavior questions can be answered from this file.
