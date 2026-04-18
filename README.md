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

### GUI

```
python src/tuhi_gui.py
```

1. **Register** — click Register to search for and pair your device over BLE.
2. **Listen** — click Listen to sync offline drawings from the device to your PC.
3. **Fetch** — reload drawings from disk (also runs automatically at startup).
4. **Save SVG ▾** — export any drawing locally or to Google Drive, Dropbox, or OneDrive.
5. **Live mode** — stream pen strokes to screen in real time while you draw.

### CLI

All commands are run from the `src/` directory:

```
cd src
```

#### Register a device

Put the device into pairing mode (hold the button ~6 seconds until the LED flashes), then:

```
python tuhi_cli.py search --register
```

Press the button on the device when prompted. Registration is saved to `%APPDATA%\pandaink\settings.ini`.

#### List registered devices

```
python tuhi_cli.py list
```

#### Sync drawings (offline mode)

Press the button on the device to push drawings over BLE, then:

```
python tuhi_cli.py listen F4:21:DE:4D:26:BF
```

Press `Ctrl+C` to stop. Drawings are saved as JSON in `%APPDATA%\pandaink\`.

#### Export drawings to SVG

```
python tuhi_cli.py fetch F4:21:DE:4D:26:BF --svg --orientation portrait --output C:\Users\Daniele\Drawings
```

Writes `drawing_<timestamp>.json` and `drawing_<timestamp>.svg` in the current directory.

Orientation options: `landscape` (default), `portrait`, `reverse-landscape`, `reverse-portrait`.

#### Live pen streaming

```
python tuhi_cli.py live F4:21:DE:4D:26:BF --svg --orientation portrait --output C:\Users\Daniele\Drawings
```

Streams pen strokes in real time. Press `Ctrl+C` to stop — saves `live_<timestamp>.json` (and optionally `.svg`) in the output directory.

| Flag | Description |
|---|---|
| `--svg` | Also export an SVG file when stopped |
| `--orientation` | `portrait` (default), `landscape`, `reverse-portrait`, `reverse-landscape` |
| `--output DIR` / `-o DIR` | Output directory (default: current directory) |

#### Global options

| Flag | Description |
|---|---|
| `-v` / `--verbose` | Show debug logging |
| `--config-dir PATH` | Use a custom config directory instead of `%APPDATA%\pandaink\` |

---

Drawings are stored in `%APPDATA%\pandaink\`.

## License

PandaInk is a derivative work of Tuhi and is distributed under the
**GNU General Public License v2.0**. See `COPYING` for the full license text
and `NOTICE.md` for upstream credits.
