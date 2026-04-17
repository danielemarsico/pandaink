# TC02 — Sync drawings from device (Listen)

**Goal:** Connect to the device via Bluetooth and download drawings stored on it.

**Preconditions:**
- A device is already registered (TC01 completed).
- At least one drawing has been made on the device (draw something on paper).
- The device is powered on, LED is green (idle mode).

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Verify the registered device name and address are shown in the top label.
3. Click **Listen**.
4. Observe the Listen button label changes to **Stop**.
5. Observe the status bar shows "Listening on …".
6. Pick up the pen and press the physical button on the device to trigger synchronisation.
7. Observe the LED on the device blinks during transfer.
8. Wait for the transfer to complete (LED returns to green).
9. Observe one or more new tabs appear in the Notebook, each labelled with a timestamp.
10. Click on a tab to select it.
11. Observe the drawing is rendered correctly in the canvas area.
12. Click **Stop**.
13. Observe the button label returns to **Listen**.
14. Observe the status bar shows "Stopped listening."

## Expected result

All drawings stored on the device are downloaded, saved to disk, and shown as tabs.
