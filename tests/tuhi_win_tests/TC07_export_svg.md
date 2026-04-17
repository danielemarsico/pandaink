# TC07 — Export a drawing as SVG

**Goal:** Verify that the Save SVG button exports the drawing to a file.

**Preconditions:**
- At least one drawing is visible in the Notebook.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click on a drawing tab to select it.
3. Observe the drawing is rendered on the canvas.
4. Click the **Save SVG** button in the tab toolbar.
5. Observe a Save As dialog opens with a suggested filename like `drawing_2024-01-15_10-30.svg`.
6. Note or change the destination folder.
7. Click **Save**.
8. Observe the status bar shows "Saved: drawing_….svg".
9. Open the saved SVG file in a browser or SVG viewer.
10. Verify the strokes match what is shown in the canvas.
11. Click **Save SVG** again on the same tab.
12. Click **Cancel** in the dialog.
13. Observe no file is written and no error is shown.

## Expected result

The SVG file is written correctly; cancelling the dialog does nothing.
