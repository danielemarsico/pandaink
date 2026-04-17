# PandaInk Web

Web Bluetooth port of PandaInk for Chrome/Edge.

## Requirements

- Google Chrome or Microsoft Edge (Web Bluetooth is not supported in Firefox or Safari)
- A Wacom SmartPad device (Spark, Slate, or Intuos Pro) with Bluetooth enabled

## How to run

Web Bluetooth requires a secure context (`https://` or `localhost`). Serve the files with a simple HTTP server:

```
cd /path/to/pandaink
python -m http.server 8080
```

Then open **http://localhost:8080/web/** in Chrome or Edge.

## Usage

1. Click **Connect** — the browser shows the Bluetooth device picker.
2. Select your Wacom device from the list.
3. If the device has never been registered, follow the on-screen prompt to press the physical button on the device to confirm pairing.
4. Registration is saved in `localStorage` — subsequent connects skip the registration step.

## Structure

```
web/
  index.html                 — app shell
  style.css                  — styling
  app.js                     — entry point
  ble/
    protocol_constants.js    — GATT UUIDs and opcode constants
    ble_manager.js           — Web Bluetooth wrapper (BleManager class)
    register.js              — registration handshake (registerDevice)
```
