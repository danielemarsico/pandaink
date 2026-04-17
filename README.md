# PandaInk

Sync and export drawings from your Wacom SmartPad on **Windows** (and any platform with Bluetooth LE support).

PandaInk is a Windows port of the Linux-only [Tuhi](https://github.com/tuhiproject/tuhi) project. It replaces BlueZ, D-Bus, and GTK with cross-platform alternatives (bleak, tkinter) so you can use your Bamboo Spark, Slate, Folio, or Intuos Paper on Windows without a Linux machine.

## Supported devices

- Bamboo Spark
- Bamboo Slate
- Bamboo Folio (A4)
- Intuos Pro Paper (Medium)

## Requirements

- Windows 10 / 11 with Bluetooth LE (BLE) adapter
- Python 3.12+
- Chrome or Edge (for the Web BLE interface — coming soon)

## Installation

### Option A — Portable EXE (no Python required)

Download `PandaInk-portable.exe` from the [latest release](https://github.com/danielemarsico/pandaink/releases/latest) and run it directly.

### Option B — From source

```
git clone https://github.com/danielemarsico/pandaink.git
cd pandaink
pip install -r requirements.txt
python src/tuhi_gui.py
```

## Usage

1. **Register** — click Register to search for and pair your device over BLE.
2. **Listen** — click Listen to sync offline drawings from the device to your PC.
3. **Fetch** — reload drawings from disk (also runs automatically at startup).
4. **Save SVG** — export any drawing as a scalable SVG file.
5. **Live mode** — stream pen strokes to screen in real time while you draw.

Drawings are stored in `%APPDATA%\pandaink\<device-address>\`.

## License

PandaInk is a derivative work of Tuhi and is distributed under the
**GNU General Public License v2.0**. See `COPYING` for the full license text
and `NOTICE.md` for upstream credits.
