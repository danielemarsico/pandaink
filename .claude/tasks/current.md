## Tasks
Complete these in order. After each task, append status to PROGRESS.md. Stop and write "LIMIT REACHED" to PROGRESS.md if you hit token/context limits.

All previous tuhi_win tasks (A1–A6, B1–B4, refactor, bug fixes) are DONE.
Direction 1 (repo publish), 2b (Help dialog), 2e (website) are DONE.
Direction 2a (cloud export), 2c (TC11–TC20), 2d (installer), 3 W1–W11 are DONE.
Direction 3 W1–W4 (Web BLE connect + register) are DONE.
See PROGRESS.md for history.

---

# PandaInk — Remaining Work
Repo: `C:\Users\Daniele\Repos\pandaink`
Plan: `.claude/virtual-weaving-sunbeam.md`

## Housekeeping (do first)

- [X] **Delete `web/` directory** — already done (b6c48ef).
- [X] **Fix CI branch trigger** — already uses `master`.

## Direction 2a — Cloud Export

- [X] Create `src/tuhi/cloud_export.py` with OAuth2 + upload handlers for Google Drive, Dropbox, OneDrive
- [X] Replace `[Save SVG]` in `src/tuhi_gui.py` with split button `[Save SVG ▾]` → dropdown: Save locally / Google Drive / Dropbox / OneDrive
- [X] Google Drive: `google-api-python-client`, `google-auth-oauthlib`, OAuth2 browser popup, tokens in `%APPDATA%\pandaink\cloud_tokens.json`
- [X] Dropbox: `dropbox` SDK, OAuth2 browser popup
- [X] OneDrive: `msal` + PKCE, OAuth2 browser popup
- [X] Update `requirements.txt` with new deps

## Direction 2c — Test Cases TC11–TC20

- [X] TC11 Export to Google Drive
- [X] TC12 Export to Dropbox
- [X] TC13 Export to OneDrive
- [X] TC14 Re-authenticate expired cloud token
- [X] TC15 Help section opens and navigates tabs
- [X] TC16 About dialog shows correct version + license
- [X] TC17 Install from installer (first-run)
- [X] TC18 Portable EXE runs without installation
- [X] TC19 Upgrade: existing drawings preserved
- [X] TC20 Multiple devices registered and selectable

## Direction 2d — Installer

- [X] NSIS or Inno Setup script wrapping the PyInstaller EXE
- [X] Add NSIS build step to `.github/workflows/build.yml`
- [X] Attach `PandaInk-setup.exe` to GitHub Release alongside portable EXE
- [X] Add second download card to `docs/download.html` for the installer

## Direction 2e — Website Screenshots

- [ ] Replace grey placeholder boxes in `docs/features.html` with real screenshots once app is stable

## Direction 3 — Web BLE Remaining (W5–W12)

All work goes in `docs/` (not `web/` — that directory should be deleted, see Housekeeping).

- [X] **W5** `docs/ble/sync.js` — port `retrieve_data` / `delete_oldest_file`
- [X] **W6** `docs/ble/live.js` — port `start_live` / `_on_pen_data_changed`
- [X] **W7** `docs/storage/idb_store.js` — IndexedDB CRUD for drawings + device configs
- [X] **W8** `docs/ui/drawing_canvas.js` — Canvas 2D rendering with orientation transforms
- [X] **W9** `docs/ui/live_canvas.js` — real-time stroke rendering on Canvas 2D
- [X] **W10** `docs/export/svg_export.js` — SVG string generation + download trigger
- [X] **W11** `docs/ui/app_controller.js` — UI state machine: Normal/Live modes
- [ ] **W12** Smoke-test on real hardware (Bamboo Folio F4:21:DE:4D:26:BF)

## Hardware Smoke-Tests (pending)

- [X] CLI: `python tuhi_cli.py live F4:21:DE:4D:26:BF --svg` → draw → Ctrl+C → verify output files
- [ ] GUI Live mode: Start Live → draw → strokes appear in real time → Stop Live

## Manual / User Steps (must be done by you, cannot be automated)

- [X] GitHub repo Settings → Pages → source: `master`, folder `/docs` → activate GitHub Pages
- [ ] Ko-fi: create account at ko-fi.com with username `danielemarsico` — GitHub Sponsor button will link to it automatically via FUNDING.yml
- [ ] GitHub Sponsors: enrol at github.com/sponsors; once approved uncomment `github: danielemarsico` in `.github/FUNDING.yml`
- [ ] Lightning donations: create a Lightning Address (e.g. via Wallet of Satoshi or Alby) and add it to `docs/index.html` and `docs/download.html` as a donate link
- [ ] Upload real screenshots to `docs/` once app is stable
- [X] Verify v0.1.1 CI run produced `PandaInk.exe` in GitHub Releases (check Actions tab)

## Sprint 2 ##

- [X] **S2-1 Live → Save as Drawing tab**: When the user clicks Stop Live, if strokes were recorded, automatically save the live session as a drawing and open it as a new tab in Normal mode (same tab UI as synced drawings, with Save SVG / Delete). Clicking Start Live again opens a fresh canvas. If no strokes, just stop silently.

- [X] **S2-2 Device button intercept in live mode**: When the device button is pressed during live streaming, surface it to the user. GUI: show a non-blocking alert/toast ("Device button pressed!"). CLI: print "click!" to stdout. The raw signal already arrives via the `0x10` packet in `_on_pen_data_changed` (buttons byte at value[10]); wire it up to a new `live-button-press` signal on `WacomProtocolBase` and propagate through `WacomDevice` → `AppDevice` → GUI/CLI callback.

- [ ] **S2-3 (Research only — no implementation) Stroke segmentation in live mode**: Decide how to detect when a stroke is finished. Options:
  - **Pen-left-proximity event** (0xff×6 packet): device already sends this when pen lifts far enough — most reliable, zero latency, already handled (`in_proximity=False`). Current code already seals strokes on this. Works well for normal writing.
  - **Pressure-drop timeout**: start a timer when pressure falls below threshold; seal the stroke if no new point arrives within ~150 ms. Handles cases where the device doesn't fire a proximity event (pen hovering just above paper). Adds latency equal to the timeout.
  - **Velocity / direction change**: detect sharp angle changes or deceleration as stroke-end heuristic. Complex to tune, device-dependent.
  - **Recommendation**: rely on the existing proximity event as the primary signal; add a 200 ms pressure-drop timeout as a fallback for devices that don't reliably send 0xff packets.

  - [X] **S2-4 make web search on he discontiuation of wacom cloud and sdk for bamboo folio and slate. add in the project web page a sort of discalimer, sayin we are the solution for the orphans of wacom cloud and sdk for bamboo!

  - [X] **S2-5 provide details on how to add windows app icon, and icons to the gui application. the same for the web app!
   