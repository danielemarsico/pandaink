# Task Progress

---

## PandaInk — Session 2026-04-18

### Completed this session

| Area | What |
|---|---|
| **Housekeeping** | Both tasks already done: `web/` deleted, CI branch already `master`, installer already built. |
| **Direction 2a — Cloud Export** | `src/tuhi/cloud_export.py` — Google Drive (google-auth-oauthlib + google-api-python-client), Dropbox (SDK PKCE + code dialog), OneDrive (MSAL interactive). Tokens in `%APPDATA%\pandaink\cloud_tokens.json`. |
| **Direction 2a — GUI** | `src/tuhi_gui.py` — `[Save SVG]` replaced with `ttk.Menubutton` "Save SVG ▾" dropdown: Save locally / Google Drive / Dropbox / OneDrive. Cloud uploads run in background threads. |
| **Direction 2a — requirements.txt** | Added: `google-api-python-client>=2.0`, `google-auth-oauthlib>=1.0`, `dropbox>=11.0`, `msal>=1.20`. |
| **Direction 2c — TC11–TC20** | Created all 10 test case markdown files: TC11 Google Drive, TC12 Dropbox, TC13 OneDrive, TC14 Re-auth, TC15 Help dialog, TC16 About version, TC17 Installer, TC18 Portable EXE, TC19 Upgrade, TC20 Multiple devices. |
| **Direction 3 W5** | `docs/ble/sync.js` — full offline sync: connect, SET_FILE_TRANSFER, SET_MODE PAPER, AVAILABLE_FILES, loop GET_STROKES→DOWNLOAD→CRC→DELETE, binary stroke parser (ports StrokeFile from protocol.py). |
| **Direction 3 W6** | `docs/ble/live.js` — `startLive()` / `_on_pen_data_changed()` port; handles 0xa1 coordinate packets, pen-lift (ff ff ff ff ff ff), returns session.stop(). |
| **Direction 3 W7** | `docs/storage/idb_store.js` — IndexedDB CRUD: `drawings` (by_device index) + `devices` stores; saveDrawing, getDrawingsByDevice, deleteDrawing, saveDevice, getDevice. |
| **Direction 3 W8** | `docs/ui/drawing_canvas.js` — `DrawingCanvas` class; letterbox transform, portrait/landscape/reverse-* orientations, pressure → line width. |
| **Direction 3 W9** | `docs/ui/live_canvas.js` — `LiveCanvas` class; incremental rendering, orientation transform, resize handling. |
| **Direction 3 W10** | `docs/export/svg_export.js` — `drawingToSvg()` (ports JsonSvg from export_win.py) + `downloadSvg()` Blob download trigger. |
| **Direction 3 W11** | `docs/ui/app_controller.js` — Full UI state machine: Normal/Live modes, Connect/Register, Sync, drawing tabs (render + Save SVG + Delete), Live canvas wiring. `docs/app.js` and `docs/app.html` updated to use AppController. CSS added to `docs/style.css`. |

### Pending

- **Direction 2e** — Replace grey placeholder boxes in `docs/features.html` with real screenshots (manual).
- **Direction 3 W12** — Hardware smoke-test on real device (manual, needs Bamboo Folio F4:21:DE:4D:26:BF).
- **Hardware smoke-tests** — CLI `live` command, GUI Live mode (manual, needs hardware).
- **Manual items** — Ko-fi account, GitHub Sponsors enrollment, Lightning donations link, real screenshots.

---

## PandaInk — Session 2026-04-17 (alignment pass)
**Issues identified:** (1) `web/` dir is a stale duplicate of `docs/` — must be deleted.
(2) CI `build.yml` triggers on `branches: [main]` but repo uses `master` — CI never fires on push.
(3) No installer yet (2d pending) — `download.html` correctly shows only portable EXE.
(4) `FUNDING.yml` already exists with `ko_fi: danielemarsico`. User still needs to activate Ko-fi account and enrol in GitHub Sponsors.
**Tasks updated:** `web/` → `docs/` path correction for W5–W12; CI branch fix and installer card added to current.md.

---

## PandaInk — Session 2026-04-17
**Status: Phase 1 + Phase 2 (partial) DONE. Phase 3 W1–W4 DONE.**

### Completed this session

| Commit | What |
|---|---|
| `1549ac6` `v0.1.0-alpha` | New repo created: source copied from tuhi_win, GPLv2/NOTICE/README, CI skeleton, config dir renamed to `pandaink` |
| `fa0361c` | PyInstaller spec (`build/PandaInk.spec`) with `collect_all('bleak')`; CI uses spec file |
| `d45077f` | Help dialog — 4 tabs (Getting Started, Live Mode, Tips, About) in `src/help_dialog.py` + `src/help_content.py` |
| `84cde8a` | GitHub Pages website — landing, features, download pages in `docs/` |
| `29908f4` | Web BLE W1–W4: Connect + Register in browser (`web/ble/`) |
| `b6c48ef` | Web BLE integrated into docs/ (HTTPS) — `docs/app.html` with Connect/Forget UI, nav updated |
| `608f0bc` | Fixed bleak spec: `collect_all` instead of hidden imports; tagged `v0.1.1` to trigger CI EXE build |
| `c97ffe6` | BLE code review fixes: disconnect listener leak, duplicate DOM listeners, NotFoundError suppression |

### Pending
- Direction 2a (cloud export), 2c (test cases), 2d (NSIS installer), 2e (screenshots)
- Direction 3 W5–W12 (sync, live, storage, canvas rendering, SVG export, full UI)
- Hardware smoke-test B5
- Manual: activate GitHub Pages, GitHub Sponsors enrollment

---

## Macro-activity A: Simple GUI
**Status: DONE — merged in PR #3 (commit 06695b7)**

All A1–A5 tasks implemented in `tuhi_win/tuhi_gui.py` (557 lines).

### What was built
- **A1 — Window skeleton:** `TuhiGUIApp(tk.Tk)` with device label (address + friendly
  name from config), mode selector (`Normal | Live`), orientation selector
  (`Landscape | Portrait`), status bar, and Normal-mode action bar (`[Register]`
  `[Listen]` `[Fetch]`). Device label populated at startup from `TuhiConfig`.
- **A2 — DrawingCanvas:** `DrawingCanvas(tk.Canvas)` — letterboxed rendering of
  `Drawing.strokes` as `create_line` polylines. Pressure → line width:
  `pressure / 0x10000 * 2 + 0.5 px`. Pen-lift gaps break the polyline.
  Orientation transform: landscape = identity; portrait = 90° CCW
  (`x' = y`, `y' = W − x`, canvas W↔H swapped).
- **A2b — Orientation selector:** shared `tk.StringVar`; on change calls
  `redraw(orientation)` on every open `DrawingCanvas` tab and on `LiveCanvas`
  if in Live mode. Persisted in-session only (not to disk).
- **A3 — Register flow:** background `threading.Thread` calls `TuhiApp.search()`;
  status updates via `root.after(0, ...)`. On device found: `tk.Toplevel` dialog
  "Press the button on your device", then `TuhiApp.register()`. Buttons disabled
  while running.
- **A4 — Listen flow:** background thread calls `TuhiApp.start_listening()`;
  `[Listen]` toggles to `[Stop]`. New drawings added as Notebook tabs via
  `root.after(0, ...)` callback. `[Stop]` calls `TuhiApp.stop_listening()`.
- **A5 — Fetch flow:** `[Fetch]` calls `TuhiApp.config.load_drawings()` (disk,
  no BLE); clears existing tabs; adds one tab per drawing with human-readable
  timestamp label. Shows `messagebox` if no drawings found.

---

## Macro-activity B: Live mode
**Status: DONE (B1–B4) — merged in PR #3 (commit 06695b7). B5 (smoke-test) pending.**

### What was built

**B1 — Live-pen-data signal (`tuhi/wacom_win.py`)**
- Added `'live-pen-data'` to `WacomProtocolBase.__gsignals__` and
  `WacomDevice.__gsignals__`.
- `WacomProtocolBase._on_pen_data_changed()`: `0xa1` in-proximity packets emit
  `('live-pen-data', x, y, pressure, True)`; pen-lift (`\xff\xff\xff\xff\xff\xff`)
  emits `('live-pen-data', 0, 0, 0, False)`. Existing UHID call kept → Linux unchanged.
- `WacomDevice._init_protocol()`: forwards the signal from inner protocol object.

**B2 — Signal wiring (`tuhi/app.py`, `tuhi/base_win.py`)**
- `AppDevice.__gsignals__` extended with `'live-pen-data'`.
- `TuhiDevice._on_bluez_device_connected` LIVE branch: connects
  `wacom_device.live-pen-data → app_dev.emit('live-pen-data', ...)`.
- `TuhiApp.start_live(address, on_pen_point)`: sets `app_dev.live = True`,
  connects callback, starts BLE discovery.
- `TuhiApp.stop_live(address)`: sets `app_dev.live = False`.

**B3 — CLI `live` command (`tuhi_cli.py`)**
- New `live` subparser: `python tuhi_cli.py live <addr> [--svg] [--output PATH]`.
- Accumulates `(x, y, pressure, in_proximity)` events into a `Drawing`; pen-lift
  seals stroke. On `Ctrl+C`: writes `live_<timestamp>.json` (and optionally `.svg`).
- Prints stroke count + output filenames on exit.

**B4 — GUI mode switch + LiveCanvas (`tuhi_gui.py`)**
- `Normal | Live` radio buttons in top bar; switching stops any active session.
- `LiveCanvas(tk.Canvas)`: fills window; receives `on_pen_point` via
  `root.after(0, ...)`; in-proximity appends to current segment, pen-lift seals it.
  Coordinates normalised with same letterbox + landscape/portrait transform as
  `DrawingCanvas`. Orientation selector change re-maps all accumulated segments.
- `[Start Live]` / `[Stop Live]` toggle calls `TuhiApp.start_live()` /
  `TuhiApp.stop_live()`.

**B5 — Smoke-test:** not yet run — needs real hardware session.

---

## Task 1: Fix registration lost after server restart
**Status: DONE**

**Root cause:** In `_add_device` (base_win.py:320), the REGISTER mode condition did not check
whether the device already had a UUID in config. Wacom devices routinely advertise with
4-byte manufacturer_data regardless of pairing state, so every restart would force the
already-registered device back into REGISTER mode, losing the saved config.

**Fix:** Added `uuid is None` guard to the condition:
```python
# Before
if from_live_update and len(bluez_device.manufacturer_data or []) == 4:
# After
if uuid is None and from_live_update and len(bluez_device.manufacturer_data or []) == 4:
```

---

## Task 3: Single-process refactor
**Status: DONE**

### Changes made

**`tuhi_win/tuhi/app.py`** (new file)
- `AppDevice(Object)` — lightweight in-process device state; satisfies the
  same interface that `TuhiDevice` expects from its `dbus_device` slot
  (signals `register-requested`, `notify::listening`, `notify::live`;
  methods `add_drawing()`, `notify_button_press_required()`; property `uhid_fd`).
- `TuhiApp` — orchestrates `BleakDeviceManager` + `TuhiConfig` without any
  TCP socket.  Public API: `start()`, `stop()`, `list_devices()`, `search()`,
  `register()`, `start_listening()`, `stop_listening()`.
  `AppDevice` objects are created eagerly in `start_listening()` so that
  a pre-created device state is available when BLE discovery fires.

**`tuhi_win/tuhi_cli.py`** (rewritten)
- Each command (`list`, `search`, `listen`, `fetch`) creates a `TuhiApp`,
  calls `start()`, uses the public API, then calls `stop()`.
- No `TuhiIPCClientManager`, `IPCConnection`, or TCP socket anywhere.

**`tuhi_win/tuhi/base_win.py`** (simplified)
- Removed: `Tuhi` class (replaced by `TuhiApp`), IPC imports, battery timer
  (`BATTERY_UPDATE_MIN_INTERVAL`, `_battery_timer_source`,
  `_last_battery_update_time`, `_on_battery_timeout`).
- Kept: `TuhiDevice`, `setup_logging`.
- `_on_battery_status` now just sets state/percent on connect — no timer.

**Deleted**: `tuhi_win/tuhi/ipc_server.py`, `tuhi_win/tuhi/ipc_client.py`

**`tuhi_win/tuhi_windows.py`** (stub)
- No longer a server daemon; prints a redirect message to `tuhi_cli.py`.

**`tuhi_win/WINDOWS_PORT.md`** — updated to describe single-process architecture.

---

## Bug fix: BLE connection race condition
**Status: DONE — verified on real hardware (Wacom Bamboo F4:21:DE:4D:26:BF)**

**Root cause:** `BleakBLEDevice.connect_device()` started a new OS thread on every
call. BLE advertisement events (`device-updated`) fire ~10× per second during scanning,
so each scan update triggered another thread. Each thread overwrote the shared
`self._bleak_client` attribute with a freshly-created (not yet connected) `BleakClient`.
The first thread's `_async_connect` then read back the replacement client, which had not
had `connect()` called on it, causing bleak to raise
`"Service Discovery has not been performed yet"`.

**Symptom:** rapid repeated `ERROR: Connection failed: Service Discovery has not been
performed yet` and no drawings synced.

**Fix (`tuhi_win/tuhi/ble_bleak.py`):**
- Added `self._connecting = False` flag to `BleakBLEDevice.__init__`.
- `connect_device()` returns immediately if `_connecting` is already True.
- The `BleakClient` instance is now a local variable inside the connection thread —
  it is never written to `self._bleak_client` until after `_async_connect` succeeds.
- `_async_connect(client)` now receives the client as an explicit parameter, sets
  `self._bleak_client = client` only after service discovery completes, then clears
  `_connecting`.

---

## Bug fix: device name not persisted
**Status: DONE**

**Root cause:** `TuhiConfig.new_device()` only saved Address, UUID, Protocol to
`settings.ini`. The friendly name (e.g. "daniele bamboo") came from the BLE
advertisement and was lost after registration.

**Fix:**
- `config_win.py`: added optional `name` parameter to `new_device()`; written to
  `settings.ini` when present.
- `base_win.py` `_on_uuid_updated`: passes `bluez_device.name` to `new_device()`.
- `app.py` `list_devices()`: reads `name` key from config (with `Name` fallback).

---

## Task 2: Analyse single-process feasibility
**Status: DONE — feasible, plan below**

### Findings

The client/server split exists for operational convenience (keep a daemon running, issue
short-lived CLI commands), not for any hard technical reason. All state is either transient
or already persisted to disk (`%APPDATA%\tuhi`).

**What the server maintains across CLI invocations:**
- Device metadata (address, UUID, protocol) — already on disk in `settings.ini`
- Drawings — already on disk as `<timestamp>.json`
- Battery state — transient, refetched on each BLE connection
- Active BLE connections / asyncio event loop

**No technical blocker** prevents collapsing to a single process. The Bleak asyncio loop
can run in a background thread within the CLI process, exactly as it already does in the
server. The IPC layer (TCP JSON-RPC, ~500 lines across `ipc_server.py` + `ipc_client.py`)
becomes unnecessary.

### Plan

Add the following tasks to current.md for the single-process refactor:

1. **Create `tuhi/app.py`** — a `TuhiApp` singleton class (wrapping the current `Tuhi`
   orchestrator) that each CLI command can instantiate. It initialises the BLE event loop
   and loads config from disk. No TCP socket.

2. **Rewrite `tuhi_cli.py`** to import `TuhiApp` directly instead of
   `TuhiIPCClientManager`. Each command calls app methods and hooks into signals directly.
   Remove all `IPCConnection` / `TuhiIPCClient*` usage.

3. **Remove `ipc_server.py` and `ipc_client.py`** once CLI is ported.

4. **Remove the daemon socket / server thread** from `base_win.py` (`TuhiIPCServer`
   instantiation).

5. **Battery polling:** simplify to a single fetch-on-connect (drop
   `_battery_timer_source` cross-invocation persistence).

6. **Async lifecycle:** each CLI command calls `app.start()` (spins up BLE loop) and
   `app.stop()` on exit.

**Estimated scope:** ~1 000–1 500 lines changed. The protocol, BLE, config, and export
code remain untouched.

**Trade-offs:**
- Pro: no daemon to manage, simpler deployment, fewer threads/sockets
- Con: slightly longer startup per command (BLE init ~200 ms); cannot run two CLI
  commands simultaneously (shared asyncio loop — mitigatable with a lock or by
  running the loop for the duration of the command only)
