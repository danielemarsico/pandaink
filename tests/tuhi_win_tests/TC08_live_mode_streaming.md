# TC08 — Live mode pen streaming

**Goal:** Verify that pen strokes drawn on the device appear in real time in the Live canvas.

**Preconditions:**
- A device is registered and powered on with LED green.
- The application is in Normal mode.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Select **Live** from the mode radio buttons.
3. Observe the Normal-mode panel (Register / Listen / Fetch / Notebook) is hidden.
4. Observe the Live panel appears with a **Start Live** button and an empty white canvas.
5. Click **Start Live**.
6. Observe the button label changes to **Stop Live**.
7. Observe the status bar shows "Live mode active…"
8. Pick up the pen and draw a line or shape on the paper on the device.
9. Observe strokes appear on the Live canvas in real time as you draw.
10. Lift the pen off the paper.
11. Observe the stroke segment ends (pen lift handled correctly).
12. Draw a second shape.
13. Observe the second shape is added to the canvas.
14. Click **Stop Live**.
15. Observe the button label returns to **Start Live**.
16. Observe the status bar shows "Live mode stopped."
17. Select **Normal** mode.
18. Observe the Normal-mode panel reappears with no errors.

## Expected result

Pen strokes stream in real time into the canvas; stopping live mode returns to Normal cleanly.
