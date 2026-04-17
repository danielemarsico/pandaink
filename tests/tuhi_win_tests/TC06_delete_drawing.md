# TC06 — Delete a drawing permanently

**Goal:** Verify that the Delete button removes the drawing file from disk.

**Preconditions:**
- At least two drawings are visible in the Notebook.
- Note the total number of drawings shown.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Observe two or more tabs are shown.
3. Note the timestamp label of the tab to be deleted.
4. Click on the tab to select it.
5. Click the **Delete** button in the tab toolbar.
6. Observe a confirmation dialog appears: "Permanently delete drawing from …?"
7. Click **No** (cancel).
8. Observe the tab is still present.
9. Click **Delete** again on the same tab.
10. Click **Yes** to confirm.
11. Observe the tab closes.
12. Observe the status bar shows "Deleted drawing from …"
13. Click **Fetch**.
14. Observe the deleted drawing does NOT reappear.
15. Verify the total number of tabs is one less than before.

## Expected result

The drawing JSON file is deleted from disk; it does not come back on Fetch.
