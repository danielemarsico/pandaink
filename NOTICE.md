# NOTICE

PandaInk is a derivative work of the [Tuhi](https://github.com/tuhiproject/tuhi) project.

## Upstream project

**Tuhi** — Sync controller for Wacom SmartPad devices
- Repository: https://github.com/tuhiproject/tuhi
- License: GNU General Public License v2.0 (GPLv2)
- Description: GTK application for Linux that fetches drawings from Wacom ink range devices (Spark, Slate, Folio, Intuos Paper) and exports them as SVGs.

All original source files from the Tuhi project are distributed under the terms of the GPLv2. PandaInk, as a derivative work, is also licensed under the GPLv2. See the `COPYING` file for the full license text.

## What PandaInk changes

PandaInk replaces or rewrites the following Linux-specific components:
- BlueZ BLE stack → **bleak** (cross-platform Python BLE library)
- GTK 3 / GLib GUI → **tkinter** (Python standard library GUI)
- D-Bus IPC → direct in-process method calls
- UHID pen injection → stub (not supported outside Linux)
- XDG config paths → `%APPDATA%\pandaink` on Windows

All new and modified code is copyright © 2024–2026 Daniele Marsico and is
also licensed under the GPLv2.
