# Changelog

All notable changes to PandaInk are documented here.
Format: `## Unreleased` for pending changes; `## <version> — <date>` for releases.

---

## Unreleased

- feat: show build commit + timestamp in web app footer (auto-stamped by CI)
- fix: web BLE device picker now uses `acceptAllDevices` so registered devices appear regardless of advertised services
- fix: web BLE registration skips intermediate ACK (0xb3) when waiting for REGISTER_WAIT reply
- fix: web BLE write uses `writeValueWithoutResponse` to match Python bleak `response=False`
- fix: `isSpark()` now checks for the SYSEVENT *service* (not a characteristic in the wrong service), correctly identifying Slate/Bamboo Folio devices
- fix: device record stored with `id` field to satisfy IndexedDB keyPath requirement
- chore: save web app plan and task list under `.claude/`
- chore: add CHANGELOG rule to CLAUDE.md

---

## 0.1.1 — 2024-12-01

- feat: Windows installer (Inno Setup) produced by CI alongside portable EXE
- feat: Help dialog with 4-tab Notebook (Getting Started, Live Mode, Shortcuts, About)
- feat: Live mode — real-time pen streaming to canvas
- feat: Stop Live auto-saves session as a drawing tab
- feat: device button press surfaced as toast in GUI and stdout in CLI
- feat: GitHub Pages website (index, features, download, web app pages)
- feat: Web BLE app — connect, register, sync drawings, live mode, SVG export
- fix: live mode orientation and canvas rendering
- chore: CI build for portable EXE and installer on push to master and v* tags

## 0.1.0 — 2024-10-01

- feat: initial Windows port of Tuhi (BLE via bleak, no BlueZ dependency)
- feat: Tkinter GUI with Normal and Live modes
- feat: CLI commands: list, search, listen, fetch, live
- feat: SVG export with cloud upload (Google Drive, Dropbox, OneDrive)
- feat: drawings stored in `%APPDATA%\pandaink\`
