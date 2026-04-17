# TC03 — Reload drawings from disk (Fetch)

**Goal:** Load previously synced drawings from disk without connecting to the device.

**Preconditions:**
- A device is registered and at least one drawing has been synced (TC02 completed).
- The device does NOT need to be powered on or nearby.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Observe drawings are loaded automatically and tabs appear in the Notebook at startup.
3. Note the number of tabs currently shown.
4. Close one tab by clicking its **×** label.
5. Observe the tab disappears.
6. Click **Fetch**.
7. Observe all tabs are cleared and then reloaded from disk.
8. Observe the number of tabs matches the number before closing.
9. Observe the status bar shows "Loaded N drawing(s)."
10. Click **Fetch** again with no device powered on.
11. Observe the same drawings are shown (no BLE connection was needed).

## Expected result

Fetch reloads all drawings from disk regardless of device availability.
