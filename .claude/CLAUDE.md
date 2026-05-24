## Commit Rules

Before every `git commit` (and before pushing), update `CHANGELOG.md`:
- Add an entry under the `## Unreleased` section describing what changed and why.
- Format: `- <type>: <short description>` (types: `feat`, `fix`, `chore`, `docs`, `refactor`).
- Keep entries user-facing where possible; skip internal-only reformats.
- On a version tag (`v*`), move all `## Unreleased` entries under a new `## <version> — <date>` heading.

## Autonomous Mode
- TODO list lives in `.claude/tasks/current.md`

## Project Layout

```
pandaink/
├── src/                        # Python application (Windows GUI + CLI)
│   ├── tuhi_gui.py             # Main entry point — Tkinter GUI (TuhiGUIApp)
│   ├── tuhi_cli.py             # CLI: list / search / listen / fetch / live
│   ├── tuhi_windows.py         # Legacy stub — redirects to tuhi_cli.py
│   ├── help_dialog.py          # Help Toplevel window (4-tab ttk.Notebook)
│   ├── help_content.py         # Static text for all Help tabs
│   └── tuhi/                   # Core library (ported from Linux Tuhi)
│       ├── app.py              # TuhiApp orchestrator — single-process, no IPC
│       ├── base_win.py         # TuhiDevice — BLE device lifecycle
│       ├── ble_bleak.py        # BleakBLEDevice — async BLE via bleak
│       ├── config_win.py       # TuhiConfig — settings.ini + drawing JSON in %APPDATA%\pandaink\
│       ├── drawing_win.py      # Drawing / Stroke data model
│       ├── export_win.py       # SVG export (JsonSvg)
│       ├── gobject_compat.py   # Minimal GObject signal shim (no GLib dependency)
│       ├── protocol.py         # Wacom protocol constants + base parsing
│       ├── uhid_win.py         # No-op UHID stub (pen injection not needed on Windows)
│       ├── util.py             # Logging helpers
│       └── wacom_win.py        # WacomProtocolBase + WacomDevice — full BLE protocol
│
├── docs/                       # GitHub Pages website (served at danielemarsico.github.io/pandaink)
│   ├── index.html              # Landing page — hero, features overview, download CTA
│   ├── features.html           # Feature screenshots (placeholder boxes — replace with real shots)
│   ├── download.html           # Download page — portable EXE, installer, run-from-source
│   ├── app.html                # Web BLE app shell — Connect / Register / Listen UI
│   ├── app.js                  # Web app entry point — wires UI events to ble/ modules
│   ├── style.css               # Shared stylesheet for all pages
│   ├── _config.yml             # Jekyll config (sets theme: none, keeps HTML as-is)
│   └── ble/                    # Web BLE modules (W1–W4 done; W5–W12 pending)
│       ├── ble_manager.js      # Web Bluetooth wrapper — connect / read / write / notify
│       ├── protocol_constants.js  # GATT UUIDs, opcodes (port of protocol.py)
│       └── register.js         # Registration flow (port of WacomProtocolBase.register_device)
│
├── build/                      # Build scripts (not build output — output goes to dist/)
│   ├── PandaInk.spec           # PyInstaller spec — produces dist/PandaInk.exe (portable)
│   ├── PandaInk.iss            # Inno Setup script — produces dist/PandaInk-setup.exe
│   └── README.md               # Build instructions
│
├── tests/
│   └── tuhi_win_tests/         # Manual test cases TC01–TC10 (markdown checklists)
│       ├── TC01_first_registration.md
│       ├── TC02_sync_drawings.md
│       └── ...TC10
│
├── .github/
│   ├── FUNDING.yml             # ko_fi: danielemarsico — shows Sponsor button on GitHub
│   └── workflows/
│       └── build.yml           # CI: push to master or v* tag → portable EXE + installer → GitHub Release
│
├── requirements.txt            # bleak>=0.21, svgwrite, Pillow
├── COPYING                     # GPLv2 license (unchanged from upstream Tuhi)
├── NOTICE.md                   # Credits upstream Tuhi project and authors
└── README.md                   # User-facing: install, usage, screenshots
```

### Key paths at runtime
- Drawings and config: `%APPDATA%\pandaink\` (`settings.ini` + `<timestamp>.json` per drawing)
- CI artifacts: `dist/PandaInk.exe` (portable), `dist/PandaInk-setup.exe` (installer)
- GitHub Pages source: `master` branch, `/docs` folder

## GUI Layout (`tuhi_win/tuhi_gui.py` and `pandaink/src/tuhi_gui.py`)

```
┌──────────────────────────────────────────────────────────┐
│  daniele bamboo  F4:21:DE:4D:26:BF                       │
│  ● Normal  ○ Live    ○ Landscape  ● Portrait    [Help]   │
│  [status bar]                                            │
├──────────────────────────────────────────────────────────┤
│  Normal:  [Register]  [Listen]  [Fetch]                  │
│           ┌──Notebook───────────────────────────────┐   │
│           │ 2024-01-15 10:30 × │ 2024-01-16 × │      │   │
│           │  [Save SVG] [Delete]                    │   │
│           │  <DrawingCanvas>                        │   │
│           └─────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  Live:    [Start Live]                                   │
│           ┌──LiveCanvas──────────────────────────────┐  │
│           │  (strokes appear here in realtime)        │  │
│           └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- Mode selector (`Normal | Live`) is always visible; switching stops any active session.
- Orientation selector (`Landscape | Portrait`) is always visible. Default is **Portrait**.
  Changing orientation does NOT redraw existing tabs — each drawing tab keeps the
  orientation it was opened with. The selector sets the default for new tabs and
  redraws the LiveCanvas. Portrait rotates coordinates 90° CW (swap W/H).
- **`[Help]`** button is packed to the far right of the mode/orientation row.
  Opens a non-resizable `tk.Toplevel` (600×400) with a `ttk.Notebook` containing:
  - **Getting Started** — register, listen, fetch, export walkthrough
  - **Live Mode** — live streaming instructions
  - **Shortcuts & Tips** — keyboard hints, `%APPDATA%\pandaink\` file locations
  - **About** — version, GPLv2 license, upstream Tuhi credit, GitHub link
  Content lives in `src/help_content.py`; dialog class in `src/help_dialog.py`.
- **Normal mode**: Register → search + register new device. Listen → sync offline
  drawings from device (BLE). Fetch → reload drawings from disk. Drawings are also
  loaded automatically at startup.
- **Tab close**: each tab label ends with `×`; clicking it closes the tab without
  deleting the file from disk.
- **Per-tab toolbar**: two buttons inside each drawing tab:
  - `[Save SVG]` — export the drawing as SVG (file save dialog).
  - `[Delete]` — permanently delete the drawing file from disk and close the tab.
- **Live mode**: Start Live → streams real-time pen strokes into LiveCanvas.
  One fullscreen canvas, no tabs.

---

## Architecture — Windows App

Single-process Python application. No daemon, no IPC sockets.

```
tuhi_gui.py / tuhi_cli.py
        │
        ▼
   TuhiApp (src/tuhi/app.py)          — orchestrator; owns config + BLE loop
        │
        ├── TuhiConfig (config_win.py) — settings.ini + drawing JSON in %APPDATA%\pandaink\
        ├── TuhiDevice (base_win.py)   — BLE device lifecycle, signals
        │       └── BleakBLEDevice (ble_bleak.py)  — async BLE via bleak
        │               └── WacomDevice (wacom_win.py) — full Wacom BLE protocol
        └── AppDevice (app.py)         — in-process device state (signals, drawing accumulator)

Drawing flow:
  BLE notify → WacomDevice._on_pen_data_changed()
             → AppDevice.emit('drawing-finished' | 'live-pen-data')
             → TuhiGUIApp callback → DrawingCanvas / LiveCanvas
             → TuhiConfig.save_drawing() → %APPDATA%\pandaink\<timestamp>.json

Export flow:
  DrawingCanvas → [Save SVG] → JsonSvg (export_win.py) → file dialog → .svg
               → [Save SVG ▾] → cloud_export.py → Google Drive / Dropbox / OneDrive (OAuth2)
```

Key design decisions:
- Asyncio event loop runs in a background thread; GUI callbacks post back via `root.after(0, ...)`.
- `gobject_compat.py` provides a minimal GObject signal shim so protocol code from Linux Tuhi works unchanged.
- Cloud export tokens stored in `%APPDATA%\pandaink\cloud_tokens.json` (separate from drawings).

---

## Architecture — Web App

Fully static frontend (GitHub Pages) + managed backend services. No custom server.

```
Browser
  │
  ├── docs/app.html + docs/style.css      — app shell, importmap for Supabase JS SDK
  ├── docs/app.js                         — entry point, mounts AppController
  │
  ├── docs/ui/app_controller.js           — UI state machine (auth gate, Normal/Live modes)
  ├── docs/ui/profile_panel.js            — slide-in drawer: account, Drive, device
  ├── docs/ui/drawing_canvas.js           — Canvas 2D rendering, orientation transforms
  ├── docs/ui/live_canvas.js              — real-time stroke rendering
  │
  ├── docs/ble/
  │   ├── ble_manager.js                  — Web Bluetooth API wrapper (connect/read/write/notify)
  │   ├── protocol_constants.js           — GATT UUIDs, opcodes (port of protocol.py)
  │   ├── register.js                     — BLE registration flow (PKCE-style challenge/reply)
  │   ├── sync.js                         — offline drawing sync (retrieve_data port)
  │   └── live.js                         — live pen streaming (start_live port)
  │
  ├── docs/auth/
  │   ├── supabase_client.js              — Supabase JS singleton (SUPABASE_URL + SUPABASE_ANON_KEY)
  │   ├── auth_manager.js                 — sign up/in/out, profile CRUD, device CRUD
  │   └── storage_oauth.js               — Google Drive PKCE OAuth (GDRIVE_CLIENT_ID)
  │
  ├── docs/storage/
  │   └── gdrive_store.js                 — Google Drive REST API v3 (appDataFolder)
  │
  └── docs/export/
      └── svg_export.js                   — SVG string generation + Blob download

External services:
  ├── Supabase (supabase.com)
  │   ├── Auth — email/password, Google OAuth, GitHub OAuth
  │   ├── profiles table — display_name, storage_provider
  │   ├── devices table  — wacom_uuid, protocol, device_name per user
  │   └── storage_tokens table — Google Drive access/refresh tokens per user
  │
  └── Google Drive (googleapis.com)
      └── appDataFolder — drawing_<timestamp>.json files (hidden, app-private)
```

Auth flow:
```
page load → supabase.auth.getSession()
          → no session: show auth panel (email form + Google + GitHub buttons)
          → session found: loadDevice(userId) from Supabase → mount app
```

Drawing save flow:
```
BLE sync → stroke data → gdrive_store.saveDrawing()
         → getValidAccessToken() (refresh via Supabase storage_tokens if needed)
         → POST /upload/drive/v3/files (multipart, appDataFolder)
         → drawing_<timestamp>.json stored in user's Drive
```

Key credentials (must be filled in by developer/owner):
- `docs/auth/supabase_client.js` lines 12–13 — `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `docs/auth/storage_oauth.js` line 14 — `GDRIVE_CLIENT_ID`