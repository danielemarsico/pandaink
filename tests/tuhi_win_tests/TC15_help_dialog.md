# TC15 — Help dialog opens and navigates tabs

**Goal:** Verify that the Help dialog opens correctly and all tabs are navigable.

**Preconditions:**
- Application is running.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click the **Help** button (top-right of the mode/orientation row).
3. Observe a non-resizable dialog (600×400) opens with the title "PandaInk Help".
4. Verify the default tab shown is **Getting Started**.
5. Read the Getting Started content; verify it describes Register → Listen → Fetch → Export.
6. Click the **Live Mode** tab.
7. Verify the Live Mode tab content describes how to use Start Live.
8. Click the **Shortcuts & Tips** tab.
9. Verify it lists keyboard shortcuts and mentions `%APPDATA%\pandaink\` for file locations.
10. Click the **About** tab.
11. Verify it shows the version string, GPLv2 licence notice, upstream Tuhi credit, and a GitHub link.
12. Click the window's close button (×).
13. Verify the dialog closes and the main window remains functional.
14. Re-open Help by clicking the **Help** button again.
15. Verify the dialog opens fresh on the Getting Started tab.

## Expected result

All four tabs display the correct content. The dialog is non-resizable. Closing and re-opening works correctly.
