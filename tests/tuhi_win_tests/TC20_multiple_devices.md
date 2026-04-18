# TC20 — Multiple devices registered and selectable

**Goal:** Verify that the app handles multiple registered Wacom devices and allows selecting between them.

**Preconditions:**
- Two or more Wacom SmartPad devices are available.
- Both devices are registered (run through TC01 for each).
- `%APPDATA%\pandaink\settings.ini` lists at least two `[Device:<address>]` sections.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Verify the device label in the title row shows the address / name of one registered device.
3. Close the application.
4. Open `%APPDATA%\pandaink\settings.ini` and confirm both device sections are present.
5. Launch again; note which device is shown first (alphabetical by address, or most recently used).
6. Click **Listen** with the displayed device powered on and in range.
7. Verify drawings from that specific device are synced.
8. Stop listening.

   *(If the app supports a device picker UI, continue with steps 9–12; otherwise note as future work.)*

9. Use any device-selection mechanism in the app to switch to the second device.
10. Verify the device label updates to show the second device's address/name.
11. Click **Listen** with the second device powered on.
12. Verify drawings from the second device appear in new tabs alongside the first device's drawings.

## Expected result

Drawings from each device are stored and displayed independently. Switching devices does not corrupt or mix drawing data.
