# PandaInk — ESP32 Port Plan

**Target**: Standalone ESP32 device that connects to a Wacom Bamboo/Slate/Spark
via BLE, displays drawings on a TFT screen, and optionally syncs to the cloud over Wi-Fi.
Conceptually: the web app (`docs/`) re-implemented in C++ on embedded hardware,
with the screen replacing the browser canvas.

---

## Recommended Hardware

| Component | Choice | Notes |
|-----------|--------|-------|
| MCU | **ESP32-S3** | Dual-core, 512 KB SRAM, 8 MB PSRAM (WROVER), BLE 5.0, Wi-Fi |
| Display | **3.5" ILI9341 SPI TFT (320×480)** | Enough canvas area; supported by TFT_eSPI and LovyanGFX |
| Storage | SD card (SPI) | Drawings stored as JSON; ~2 GB card holds thousands |
| Input | 2–3 tactile buttons | Register / Sync / Menu; no touch screen needed |
| Power | LiPo + TP4056 charger | USB-C charging while desktop use |
| Dev board | **LilyGO T7-S3** or **ESP32-S3-DevKitC-1** | Easy PSRAM, SD, USB UART |

Alternative compact option: **LilyGO T-Display-S3** (integrated 1.9" 170×320 screen,
battery connector) — sacrifices canvas size but ships as one unit.

---

## Software Stack

| Layer | Library | Why |
|-------|---------|-----|
| Framework | **PlatformIO + Arduino** | Fastest iteration; large ecosystem |
| BLE (central/client) | **NimBLE-Arduino** | Much lighter than ESP32 Arduino BLE; supports BLE Central role |
| Display | **LovyanGFX** | Hardware-accelerated; supports ILI9341, ST7789, ST7796 with one config change |
| JSON | **ArduinoJson v7** | Deserialize stroke files; serialize drawing metadata |
| HTTP / REST | **ESP-IDF HttpClient** (via Arduino `HTTPClient`) | Wi-Fi upload to Google Drive / Supabase |
| Storage | **LittleFS** (SPIFFS successor) | Device registration + settings on-chip; SD for drawings |
| OTA | **ArduinoOTA** | Update firmware over Wi-Fi without USB |

---

## Project Layout (new folder `esp32/`)

```
pandaink/
└── esp32/
    ├── platformio.ini               # board, libs, build flags
    ├── src/
    │   ├── main.cpp                 # setup() / loop() — state machine
    │   ├── ui/
    │   │   ├── display_manager.h/cpp  # LovyanGFX init, orientation, backlight
    │   │   ├── drawing_canvas.h/cpp   # Stroke → pixel rendering (port of drawing_canvas.js)
    │   │   ├── live_canvas.h/cpp      # Real-time pen data rendering
    │   │   └── status_bar.h/cpp       # Top bar: device name, battery, Wi-Fi, sync state
    │   ├── ble/
    │   │   ├── ble_manager.h/cpp      # NimBLE central: scan, connect, GATT R/W/notify
    │   │   ├── protocol_constants.h   # UUIDs + opcodes (port of protocol_constants.js)
    │   │   ├── register.h/cpp         # Registration flow (port of register.js)
    │   │   ├── sync.h/cpp             # Offline sync (port of sync.js)
    │   │   └── live.h/cpp             # Live pen streaming (port of live.js)
    │   ├── storage/
    │   │   ├── local_store.h/cpp      # SD card: save/load drawing_<ts>.json
    │   │   └── config_store.h/cpp     # LittleFS: settings.ini equivalent (device UUID, Wi-Fi creds)
    │   ├── cloud/
    │   │   ├── wifi_manager.h/cpp     # Connect, retry, captive-portal config (WiFiManager lib)
    │   │   ├── gdrive_store.h/cpp     # Google Drive REST upload (port of gdrive_store.js)
    │   │   └── supabase_client.h/cpp  # Supabase auth + device table (optional; REST only)
    │   └── export/
    │       └── svg_export.h/cpp       # Build SVG string from strokes; write to SD (port of svg_export.js)
    ├── data/                          # LittleFS filesystem image (settings defaults)
    └── test/
        └── test_stroke_parser/        # Unity tests for the binary stroke parser
```

---

## Architecture

```
Wacom device (BLE peripheral)
        │
        │ Nordic UART (BLE)
        ▼
  BleManager (NimBLE central)
        │
        ├── register.cpp    — challenge/reply registration (same PKCE-style flow as register.js)
        ├── sync.cpp        — retrieve_data: AVAILABLE_FILES → DOWNLOAD_OLDEST → CRC → DELETE
        └── live.cpp        — WACOM_CHRC_LIVE_PEN_DATA notify loop
                │
                ▼
         StrokeParser (sync.cpp)    — binary format → std::vector<Stroke>
                │
        ┌───────┴───────────────┐
        ▼                       ▼
  DrawingCanvas            LiveCanvas
  (LovyanGFX)              (LovyanGFX)
  stroke → pixel           real-time pixel
        │
        ▼
   LocalStore (SD)          ConfigStore (LittleFS)
   drawing_<ts>.json        device_uuid, wifi_ssid/pass
        │
        ▼  (Wi-Fi available)
   GDriveStore / SupabaseClient
   upload JSON + optional SVG
```

**Main state machine** (`main.cpp`):

```
BOOT → LOAD_CONFIG → WIFI_CONNECT → BLE_SCAN
  └─ no config ──→ SETUP_WIZARD (captive portal for Wi-Fi + Wacom registration)
BLE_SCAN → BLE_CONNECT → IDLE
IDLE:
  btn_A → SYNC    (retrieve offline drawings → render → save → upload)
  btn_B → LIVE    (start live streaming)
  btn_C → MENU    (brightness, orientation, cloud settings)
SYNC → IDLE
LIVE → IDLE (on pen lift or button press)
```

---

## Phase Breakdown

### Phase E1 — Hardware bringup (1–2 days)
- PlatformIO project scaffold (`esp32/platformio.ini`)
- LovyanGFX config for chosen display (SPI pins, orientation)
- Status bar: show "PandaInk booting…" + Wi-Fi RSSI + clock
- Buttons wired to GPIO with debounce
- **Done when**: screen shows status bar and button presses log to serial

### Phase E2 — BLE central (2–3 days)
- NimBLE as Central; scan for Nordic UART service UUID
- `BleManager::connect(mac)` → discovers GATT services/characteristics
- `writeCharacteristic(uuid, data)` and `startNotify(uuid, callback)`
- Pair/bond with Wacom device (NimBLE handles this transparently)
- **Done when**: raw Nordic UART RX notifications log to serial on button press

### Phase E3 — Wacom protocol port (3–4 days)
- `protocol_constants.h` — UUIDs + opcodes verbatim from `protocol_constants.js`
- `register.cpp` — port of `docs/ble/register.js`; device UUID saved to LittleFS
- `sync.cpp` — port of `docs/ble/sync.js`; stroke binary parser in C++
- `live.cpp` — port of `docs/ble/live.js`; LIVE_PEN_DATA notify → callback
- **Done when**: `syncDrawings()` returns a `std::vector<Drawing>` with parsed strokes

### Phase E4 — Display rendering (2–3 days)
- `DrawingCanvas::render(Drawing&)` — iterate strokes, draw anti-aliased lines with
  pressure-mapped width (LovyanGFX `drawLine` + alpha blending via PSRAM sprite)
- Coordinate transform: device dimensions → screen pixels (same math as `drawing_canvas.js`)
- Portrait / landscape toggle (LovyanGFX `setRotation()`)
- Swipe left/right (or buttons) to page through drawings
- **Done when**: a synced drawing renders correctly at full screen size

### Phase E5 — Local storage (1 day)
- SD card init; `LocalStore::save(timestamp, strokes)` → `drawing_<ts>.json` (ArduinoJson)
- `LocalStore::list()` → sorted list of timestamps
- `LocalStore::load(timestamp)` → Drawing object
- `ConfigStore` (LittleFS) persists device UUID, display orientation, Wi-Fi credentials
- **Done when**: drawings survive power cycle; all tabs browsable from SD

### Phase E6 — Wi-Fi + cloud upload (2–3 days)
- `WiFiManager` captive-portal first-run setup (no hardcoded credentials)
- `GDriveStore::upload(timestamp, json)` — multipart POST to Drive REST v3
  (`appDataFolder`), same logic as `gdrive_store.js`
- Token storage: access + refresh tokens in LittleFS (encrypted with device-unique key)
- Auto-upload after each sync if Wi-Fi connected; queue and retry otherwise
- **Done when**: after sync, drawing appears in user's Google Drive `appDataFolder`

### Phase E7 — Polish + OTA (1–2 days)
- `ArduinoOTA` for firmware updates over Wi-Fi
- Low-battery warning (ADC on VBAT pin)
- Screen sleep after 60 s idle; wake on button
- Build flag `PANDAINK_VERSION` shown in status bar
- **Done when**: device is self-updatable and battery-safe for daily use

---

## Key Porting Notes

### BLE Central on ESP32
Unlike the browser Web Bluetooth API (which always acts as Central), ESP32 Arduino BLE
defaults to Peripheral. **NimBLE-Arduino** must be explicitly configured as Central:
```cpp
NimBLEDevice::init("");
NimBLEScan* pScan = NimBLEDevice::getScan();
pScan->setActiveScan(true);
```
The scan filters on `NORDIC_UART_SERVICE_UUID` to find only Wacom devices.

### Stroke Binary Parser (C++ port of `sync.js:parseStrokeData`)
The delta/point packet format is identical; port the JS function to C++ using
`uint8_t*` + `size_t`. Use `int8_t` cast for signed deltas (replaces `signedByte()`).
Strokes stored as `std::vector<std::vector<Point>>` where `Point = {uint16_t x, y, p}`.

### Memory Budget
| Item | Size |
|------|------|
| ESP32-S3 SRAM | 512 KB |
| PSRAM (WROVER) | 8 MB |
| One drawing (2000 strokes × 50 pts) | ~800 KB uncompressed |
| LovyanGFX sprite (480×320×2 bpp) | 300 KB |

All drawing data and the framebuffer sprite must live in **PSRAM** (`ps_malloc`).
Use `DRAM_ATTR` only for ISR-called code and time-critical BLE callbacks.

### Nordic UART Packet Format
Identical to `sync.js:buildPacket`:
```cpp
uint8_t pkt[2 + args_len];
pkt[0] = opcode;
pkt[1] = args_len;
memcpy(pkt + 2, args, args_len);
pCharTX->writeValue(pkt, sizeof(pkt), false);
```
Reply arrives on RX notify; use a `SemaphoreHandle_t` or `xQueueSend` to hand data
from the BLE notify callback (runs on BLE task) to the main loop.

### Google Drive Auth on ESP32
The browser uses PKCE + redirect URI; the ESP32 cannot open a browser tab.
Use **Device Authorization Grant** (RFC 8628) instead:
1. POST `/oauth2/device/code` → get `device_code` + `user_code`
2. Display `user_code` on screen + QR code to `verification_url`
3. Poll `/oauth2/token` until user approves on their phone/PC
4. Store `access_token` + `refresh_token` in LittleFS; refresh automatically

This is a one-time pairing step, same as Google Home / Chromecast setup.

---

## File Naming Conventions

- Header guards: `PANDAINK_BLE_SYNC_H`
- C++ classes: `PascalCase` (e.g., `BleManager`, `DrawingCanvas`)
- Free functions: `camelCase` (matching JS originals for easy diff)
- Constants: `UPPER_SNAKE_CASE` in `protocol_constants.h`

---

## Out of Scope (v1)

- Supabase auth on-device (Device Authorization Grant for Google Drive is sufficient;
  Supabase is web-app only for now)
- Dropbox / OneDrive storage backends
- Touchscreen UI (buttons are simpler and more reliable for embedded)
- Multi-device support (one registered Wacom device per ESP32 unit)
- SVG export to SD (nice-to-have; deprioritised; PSRAM sprite → BMP to SD is easier)

---

## Open Questions

1. **Display size trade-off**: 3.5" ILI9341 (320×480) gives more canvas but requires
   a custom enclosure. LilyGO T-Display-S3 ships ready to go but at 170×320.
   Decide before ordering PCBs.

2. **Power source**: USB-only (desk device) vs. LiPo (portable). Affects BOM and
   whether battery gauge IC (MAX17048) is worth adding.

3. **Enclosure**: 3D-printed vs. off-the-shelf project box. Could share dims with
   Raspberry Pi Zero enclosures.

4. **Registration UX**: Does the ESP32 screen show the Wacom button-press prompt
   clearly enough? May need a larger font / beep.
