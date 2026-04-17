# TC04 — Portrait and Landscape orientation

**Goal:** Verify that the orientation selector correctly rotates drawings.

**Preconditions:**
- At least one drawing is visible in the Notebook (startup auto-load or TC02/TC03 completed).
- The drawing was made holding the tablet in portrait orientation.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Observe the orientation selector shows **Portrait** selected by default.
3. Observe the drawing in the active tab is rendered upright (portrait).
4. Note the approximate layout of strokes on the canvas.
5. Select **Landscape** from the orientation radio buttons.
6. Observe the existing tabs do NOT change (orientation is frozen per tab at load time).
7. Click **Fetch** to reload all drawings.
8. Observe all tabs are re-created with Landscape orientation.
9. Observe the drawing now appears rotated compared to step 3.
10. Select **Portrait** from the orientation radio buttons.
11. Click **Fetch** again.
12. Observe all tabs are re-created with Portrait orientation and match the original view.

## Expected result

The orientation selector sets the default for newly loaded tabs; switching orientation and
reloading via Fetch applies the new orientation to all tabs.
