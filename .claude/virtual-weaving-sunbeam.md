# Plan: Three Strategic Directions for Tuhi Windows Port

## Context

The Tuhi Windows Port (`tuhi_win/`) is a working tkinter GUI that syncs Wacom SmartPad drawings on Windows via BLE (bleak). It is derived from the GPLv2-licensed Tuhi Linux project. The current state: registration, sync, live mode, SVG export, per-drawing tabs, portrait/landscape orientation all work. The three directions below take the project from a working port to a distributable, feature-rich, cross-platform product.

---

## Direction 1 — Standalone Repository & Publishing

### Goal
Publish the Windows port as its own independent project with a new name (TBD), respecting GPLv2 obligations.

### GPLv2 Compliance (non-negotiable)
- Preserve all existing copyright notices from tuhi/ source files
- Include `COPYING` (GPLv2) in the new repo
- Add a `NOTICE.md` crediting the original Tuhi project and its authors
- New code is also GPLv2 (derivative work)
- README must link to the upstream tuhi repo

### Repository Structure (new repo)

```
<new-name>/
├── COPYING                    (GPLv2 — unchanged)
├── NOTICE.md                  (credits upstream tuhi, lists copyright holders)
├── README.md                  (new — focused on Windows users)
├── requirements.txt           (bleak, svgwrite, Pillow)
├── .github/
│   ├── FUNDING.yml            (donation links)
│   └── workflows/
│       └── build.yml          (PyInstaller CI — see Direction 2)
├── src/
│   ├── tuhi_gui.py            (main entry point)
│   ├── tuhi_cli.py
│   └── tuhi/                  (all tuhi_win/tuhi/ contents)
│       ├── app.py
│       ├── base_win.py
│       ├── ble_bleak.py
│       ├── config_win.py
│       ├── export_win.py
│       ├── gobject_compat.py
│       ├── wacom_win.py
│       ├── drawing.py
│       ├── protocol.py
│       └── ...
└── tests/                     (tuhi_win_tests/ + new TC11–TC20)
```

### What NOT to bring from the original repo
- `tuhi/` (Linux-only: BlueZ, D-Bus, UHID, GTK) — these are NOT needed on Windows; only our `tuhi_win/tuhi/` overrides are used
- `data/` (GTK UI assets, translations)
- `po/` (localization)
- `tools/` (Linux debug utilities)
- `meson.build`, Flatpak manifests

### Donation Button (GitHub Sponsors / FUNDING.yml)
File: `.github/FUNDING.yml`
```yaml
ko_fi: <username>          # easiest to set up
github: <github-username>  # requires GitHub Sponsors enrollment
```
GitHub shows a "Sponsor" button automatically when `FUNDING.yml` exists.
Ko-fi requires creating an account; GitHub Sponsors requires enrollment (takes days).

### App Rename
- Name is TBD — placeholder `<AppName>` used throughout
- Files to update once name is chosen:
  - `tuhi_gui.py` window title (`root.title(...)`)
  - `config_win.py` APPDATA subdirectory name (currently `tuhi`)
  - `README.md`
  - PyInstaller `.spec` file (Direction 2)
  - Website domain/title (Direction 2)

### Tasks
1. Create new GitHub repo under user's account
2. Copy `tuhi_win/` contents into `src/`, copy `COPYING`, write `NOTICE.md`
3. Write `README.md` (Windows install, usage, screenshots placeholder)
4. Add `.github/FUNDING.yml`
5. Set up GitHub Sponsors or Ko-fi (manual step by user)
6. Tag first release `v0.1.0-alpha`

---

## Direction 2 — GUI Improvements, Packaging & Website

### 2a — Cloud Export (Google Drive, Dropbox, OneDrive)

**Approach:** Add an "Export to…" dropdown/menu per drawing tab, alongside the existing "Save SVG" button.

**Implementation in `tuhi_gui.py`:**
- Replace or augment the `[Save SVG]` button with a split button or a small "▾" menu:
  `[Save SVG ▾]` → dropdown: `Save locally…`, `Upload to Google Drive`, `Upload to Dropbox`, `Upload to OneDrive`
- Each cloud handler lives in a new module `src/tuhi/cloud_export.py`

**Per-provider implementation:**

| Provider | Library | Auth flow | Scope needed |
|---|---|---|---|
| Google Drive | `google-api-python-client`, `google-auth-oauthlib` | OAuth2 + browser popup | `drive.file` |
| Dropbox | `dropbox` SDK | OAuth2 + browser popup | files.content.write |
| OneDrive | `msal`, `requests` | OAuth2 PKCE + browser popup | Files.ReadWrite |

**OAuth flow pattern (same for all three):**
1. Open browser to provider auth URL
2. Start a local HTTP server on `localhost:PORT` to receive callback
3. Exchange auth code for tokens; store tokens in `%APPDATA%\<appname>\cloud_tokens.json`
4. On subsequent uploads, reuse stored refresh token (prompt re-auth if expired)

**Upload sequence:**
1. Generate SVG in memory (no temp file needed — `export_win.py` can return SVG string)
2. Upload SVG bytes to provider root folder or `/Apps/<AppName>/`
3. Show status bar message: "Uploaded to Google Drive: drawing_2024-01-15.svg"

**New dependencies:** `google-api-python-client`, `google-auth-oauthlib`, `dropbox`, `msal`

### 2b — Help Section

**Approach:** Add a `[Help]` button in the toolbar (top-right of main window).

- Opens a `tk.Toplevel` window with a `ttk.Notebook` with tabs:
  - **Getting Started** — step-by-step: register, sync, view, export
  - **Live Mode** — how to use live streaming
  - **Shortcuts & Tips** — keyboard hints, file locations
  - **About** — version, license (GPLv2), upstream credit, GitHub link
- Content stored as plain text strings in a new `help_content.py` module
- No external help engine needed (tkinter is sufficient)

### 2c — 10 New Test Cases (TC11–TC20)

New test cases to cover the new features:

| ID | Title |
|---|---|
| TC11 | Export drawing to Google Drive |
| TC12 | Export drawing to Dropbox |
| TC13 | Export drawing to OneDrive |
| TC14 | Re-authenticate cloud provider (token expired) |
| TC15 | Help section opens and navigates correctly |
| TC16 | About dialog shows correct version and license |
| TC17 | Install from installer (first-run experience) |
| TC18 | Portable EXE runs without installation |
| TC19 | Upgrade: existing drawings preserved after update |
| TC20 | Multiple devices registered and selectable in GUI |

### 2d — Installer & Portable EXE

**Tool:** PyInstaller (cross-compiles to `.exe` on Windows)

**Two artifacts:**
1. **Portable EXE** (`<AppName>-portable.exe`): single-file, no install needed
   ```
   pyinstaller --onefile --windowed --name <AppName> src/tuhi_gui.py
   ```
2. **Installer** (`<AppName>-setup.exe`): NSIS or Inno Setup wrapping the PyInstaller output
   - Creates Start Menu shortcut
   - Optionally installs desktop shortcut
   - Uninstaller included

**PyInstaller `.spec` file:** `build/<AppName>.spec`
- Includes hidden imports: `bleak`, `asyncio`, `tkinter`
- Bundles any resource files (icons)

**GitHub Actions CI (`.github/workflows/build.yml`):**
- Trigger: push to `main` or tag `v*`
- Runner: `windows-latest`
- Steps: checkout → Python 3.12 → pip install → pyinstaller → NSIS → upload artifacts to GitHub Release
- Artifacts attached to GitHub Release automatically

### 2e — Promotional Website

**Approach:** GitHub Pages static site (free, no server needed)

**Repo:** Either in the same repo under `docs/` branch, or a separate `<appname>.github.io` repo

**Stack:** Plain HTML + CSS (no framework) — keeps it simple and fast

**Pages:**
1. **Landing page (`index.html`):** hero image/screenshot, one-line description, Download button
2. **Features page:** screenshots of Normal mode, Live mode, SVG export, cloud upload
3. **Download page:** links to latest GitHub Release assets (portable + installer)
4. **Changelog page:** auto-generated from git tags or manually maintained

**Download links** point directly to GitHub Releases assets:
```
https://github.com/<user>/<repo>/releases/latest/download/<AppName>-setup.exe
https://github.com/<user>/<repo>/releases/latest/download/<AppName>-portable.exe
```

---

## Direction 3 — Web BLE Port (Feasibility + Plan)

### Feasibility Assessment

**Web Bluetooth API support (as of 2026):**
| Browser | Windows | macOS | Android | iOS | Linux |
|---|---|---|---|---|---|
| Chrome/Chromium | ✅ | ✅ | ✅ | ❌ | ✅ |
| Edge | ✅ | ✅ | — | ❌ | — |
| Firefox | ❌ | ❌ | ❌ | ❌ | ❌ |
| Safari | ❌ | ❌ | ❌ | ❌ | — |

**Verdict: Feasible for Chrome/Edge on Windows, macOS, Android.** Not possible on iOS or Firefox without a native bridge.

**What Web Bluetooth can do:**
- `navigator.bluetooth.requestDevice()` — device picker (user must interact)
- `device.gatt.connect()` — GATT connection
- `characteristic.readValue()` / `characteristic.writeValue()` — read/write
- `characteristic.startNotifications()` + `addEventListener('characteristicvaluechanged', ...)` — equivalent to bleak's `start_notify`

**What it cannot do:**
- Background scanning without user gesture
- Auto-reconnect (requires user gesture to re-connect)
- System pen injection (no UHID — same limitation as Windows port)

**Wacom Protocol Portability:**
All protocol logic is pure byte manipulation (no OS calls). Fully portable to JavaScript.
The BLE UUIDs and byte sequences are the same regardless of platform.

**Storage:**
- Registered device: `localStorage` (address + UUID)
- Drawings: `IndexedDB` (structured storage, supports binary/JSON, persists across sessions)
- Export: generate SVG string → download via `<a href="blob:...">` or upload to cloud APIs

### Web Port Architecture

```
Browser tab (HTTPS or localhost)
├── index.html + app.js
├── ble/
│   ├── wacom_protocol.js     (port of wacom_win.py protocol logic)
│   ├── ble_manager.js        (Web Bluetooth wrapper)
│   └── protocol_constants.js (GATT UUIDs, opcodes)
├── storage/
│   ├── idb_store.js          (IndexedDB: drawings, device registrations)
│   └── config.js             (localStorage: device address/UUID/name)
├── ui/
│   ├── drawing_canvas.js     (Canvas 2D rendering — same transform logic as tkinter)
│   ├── live_canvas.js        (real-time stroke rendering)
│   └── app_controller.js     (UI state machine: Normal/Live modes)
└── export/
    └── svg_export.js         (port of export_win.py JsonSvg)
```

### Web Port Tasks

| ID | Task | Notes |
|---|---|---|
| W1 | Set up project (Vite or plain HTML, HTTPS via `localhost`) | Vite dev server handles HTTPS for Web BLE |
| W2 | Port `protocol_constants.py` → `protocol_constants.js` | GATT UUIDs, opcode enums |
| W3 | Port `ble_bleak.py` connect/read/write/notify → `ble_manager.js` | Web Bluetooth API |
| W4 | Port registration flow (`WacomProtocolBase.register_device`) → JS | Same byte sequences |
| W5 | Port sync/listen flow (`retrieve_data`, `delete_oldest_file`) → JS | |
| W6 | Port live mode (`start_live`, `_on_pen_data_changed`) → JS | |
| W7 | `idb_store.js` — IndexedDB CRUD for drawings (JSON) and device configs | |
| W8 | `drawing_canvas.js` — Canvas 2D rendering with orientation transforms | |
| W9 | `live_canvas.js` — real-time stroke rendering on Canvas 2D | |
| W10 | `svg_export.js` — generate SVG string and trigger download | |
| W11 | `app_controller.js` — UI state machine (mirrors TuhiGUIApp) | |
| W12 | Build & deploy to GitHub Pages | |

**Recommended tech stack:**
- **No framework** (or minimal — plain JS or Preact/Lit for reactivity) to keep bundle small and avoid framework churn
- **Vite** for dev server (provides HTTPS via `--https` flag — required for Web Bluetooth in Chrome)
- **idb** npm package (thin IndexedDB wrapper — avoids raw IDB callback hell)
- **No backend needed** — fully client-side

**Key risk:** Web Bluetooth requires a user gesture (click) before every `requestDevice()` call. Auto-reconnect on page load is not possible without re-prompting the user. Workaround: store device address in `localStorage` and filter by known address on reconnect — but user still must click a "Reconnect" button.

### Expected User Experience (Web BLE Session)

**On each page load**, the user must explicitly connect once — this is a hard Web Bluetooth constraint (user gesture required for `requestDevice()`). This is acceptable.

**Within a session** (after the initial connect), the GATT connection stays live until the page is closed or the device disconnects. Operations like **Listen** (sync offline drawings) and **Fetch** (reload drawings from storage) do NOT require a new connection prompt — they reuse the already-open GATT channel. The user clicks Connect once, then freely uses Register, Listen, and Fetch without interruption.

**Session flow:**
1. Page loads → user clicks **Connect** (or **Register** on first use, which also connects)
2. The device is now paired for the session; status bar shows device name + address
3. **Listen** → reads drawings off the device over the existing connection
4. **Fetch** → reloads drawings from IndexedDB (no BLE needed at all)
5. **Live** → starts notifications on the existing connection (no reconnect)
6. If the device physically disconnects mid-session (e.g. goes to sleep), a banner offers a **Reconnect** button — one click re-establishes without the full picker

**No reconnection is required between Listen, Fetch, or Live** as long as the tab stays open. The only mandatory connect-click is the first one per page load.

---

## Sequencing Recommendation

**Phase 1 (now):** Direction 1 tasks — create the new repo, set up structure, donation, tag v0.1.0-alpha. Unblocked, no new code needed.

**Phase 2 (parallel):**
- Direction 2a–2b: cloud export + help section (new Python code)
- Direction 2d: PyInstaller + GitHub Actions (build pipeline)
- Direction 2e: Website (static HTML, can start with one page)

**Phase 3:** Direction 3 — Web port. This is the most exploratory work; start with W1–W4 (BLE connect + register in browser) to validate feasibility before investing in the full UI.

**App name chosen: PandaInk** — trademark search returned no conflicts. Rename pass completed in Direction 1 tasks.

---

## App Name Proposals

Theme anchors: **bamboo** (the pen material, the plant), **tuhi** (Māori: "to write"), **panda** (the bamboo creature), **return to life / revival** (the app breathes life back into forgotten drawings).

| Name | Angle | Notes |
|---|---|---|
| **BambooRevive** | bamboo + return to life | Clear meaning, easy to say, `.com` likely available |
| **TuhiPanda** | tuhi + panda mascot | Cute, memorable, acknowledges upstream project |
| **PandaInk** | panda + ink/writing | Short, visual, works as logo (panda holding a brush) |
| **BamboAlive** | bamboo + alive | "Your drawings, alive again" — strong tagline hook |
| **TuhiReborn** | tuhi + reborn | Direct "return to life" message, honours the Māori origin |
| **PandaScript** | panda + script/writing | Playful, domain-friendly, works for both app and website |
| **BambooWake** | bamboo + wake (awaken) | Poetic — bamboo wakes your drawings; also rhymes with "Wacom" |
| **ZhuWrite** | Zhu (竹, bamboo in Chinese) + write | Multicultural nod; short; unusual enough to be memorable |

**Recommended shortlist:** `PandaInk`, `BambooWake`, `TuhiReborn` — each is short, domain-squatter-resistant, and tells the revival story without being literal.
