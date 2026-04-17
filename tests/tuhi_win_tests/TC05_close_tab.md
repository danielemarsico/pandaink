# TC05 — Close a drawing tab without deleting

**Goal:** Verify that clicking × on a tab label closes the tab but does not delete the file.

**Preconditions:**
- At least two drawings are visible in the Notebook.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Observe two or more tabs are shown in the Notebook.
3. Note the timestamp label of the first tab.
4. Click the **×** character at the end of the first tab label.
5. Observe the tab closes immediately with no confirmation dialog.
6. Observe the remaining tabs are still present.
7. Click **Fetch**.
8. Observe the closed tab reappears (file was not deleted from disk).
9. Verify the tab timestamp matches the one noted in step 3.

## Expected result

× closes the tab from the UI only; the drawing file on disk is untouched.
