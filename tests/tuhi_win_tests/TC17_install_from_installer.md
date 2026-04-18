# TC17 — Install from installer (first-run)

**Goal:** Verify that the Inno Setup installer installs PandaInk correctly on a clean system.

**Preconditions:**
- `dist/PandaInk-setup.exe` is available (built by CI or locally via `build/PandaInk.iss`).
- The test machine does not have PandaInk installed.

## Steps

1. Double-click `PandaInk-setup.exe`.
2. Follow the installer wizard: accept the licence, choose the installation folder (default is fine), click **Install**.
3. Observe installation completes without errors.
4. Verify a **PandaInk** shortcut is created in the Start Menu.
5. Launch PandaInk from the Start Menu.
6. Verify the GUI opens correctly with the expected layout (device label, mode selector, status bar, Normal mode buttons).
7. Verify the title bar or About tab shows the correct version.
8. Close the application.
9. Open **Apps & Features** (or Programs and Features) and verify PandaInk is listed.
10. Uninstall PandaInk via Apps & Features or the Start Menu uninstaller.
11. Verify the application and Start Menu shortcut are removed.
12. Verify `%APPDATA%\pandaink\` (drawings and config) is **not** deleted by the uninstaller.

## Expected result

The installer installs PandaInk to Program Files, creates a Start Menu shortcut, and the uninstaller cleanly removes it without touching user data.
