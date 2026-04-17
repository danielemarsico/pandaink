## Autonomous Mode 
- TODO list lives in `.claude/tasks/current.md` 
- Log progress to `.claude/tasks/PROGRESS.md`
- Strategic plan: `.claude/virtual-weaving-sunbeam.md`

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