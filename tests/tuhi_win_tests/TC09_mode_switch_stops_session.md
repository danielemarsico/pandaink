# TC09 — Mode switch stops active session

**Goal:** Verify that switching mode automatically stops any running Listen or Live session.

**Preconditions:**
- A device is registered and powered on.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click **Listen**.
3. Observe the button shows **Stop** and the status bar shows "Listening on …".
4. Without clicking Stop, select **Live** from the mode radio buttons.
5. Observe the Listen session is stopped automatically (no manual Stop needed).
6. Observe the Normal panel is hidden and the Live panel appears.
7. Observe no error is reported in the console.
8. Click **Start Live**.
9. Draw something on the device.
10. Observe strokes appear in the Live canvas.
11. Without clicking Stop Live, select **Normal** from the mode radio buttons.
12. Observe the Live session is stopped automatically.
13. Observe the Normal panel reappears.
14. Observe the Live canvas is cleared (no leftover strokes visible).
15. Click **Listen** to confirm Normal mode is fully operational again.
16. Click **Stop**.

## Expected result

Switching mode always cleans up the previous session without errors or manual intervention.
