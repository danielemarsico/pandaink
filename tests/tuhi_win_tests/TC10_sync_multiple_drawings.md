# TC10 — Sync multiple drawings in one session

**Goal:** Verify that several drawings stored on the device are all downloaded and shown correctly.

**Preconditions:**
- A device is registered.
- Three or more separate drawings have been made on the device (draw, put pen down, wait for LED to save, repeat).
- The drawings have NOT been synced yet (or the device was reset between syncs).

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Note the number of tabs shown at startup (drawings already on disk).
3. Click **Listen**.
4. Press the physical button on the device to start transfer.
5. Observe the LED blinks repeatedly as each drawing is transferred.
6. Observe new tabs appear in the Notebook as each drawing arrives, without waiting for the full transfer to complete.
7. Observe the status bar updates for each new drawing.
8. Wait for the LED to return to steady green (transfer complete).
9. Click **Stop**.
10. Verify the number of new tabs equals the number of drawings made on the device.
11. Click each new tab in turn and verify the drawing content is correct and not corrupted.
12. Close the application and relaunch.
13. Observe all synced drawings are still present at startup (persisted to disk).

## Expected result

All drawings are transferred, each appears as its own tab, and all are saved to disk correctly.
