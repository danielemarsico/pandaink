# TC18 — Portable EXE runs without installation

**Goal:** Verify that the portable `PandaInk.exe` runs correctly without any installation step.

**Preconditions:**
- `dist/PandaInk.exe` is available (built by CI or locally via `build/PandaInk.spec`).
- No PandaInk installation exists on the test machine.

## Steps

1. Copy `PandaInk.exe` to a folder of your choice (e.g. Desktop or a USB drive).
2. Double-click `PandaInk.exe`.
3. Observe the GUI opens correctly within a few seconds.
4. Verify the title bar / About tab shows the correct version.
5. Click **Help** and verify the dialog opens with all four tabs.
6. Verify the config directory `%APPDATA%\pandaink\` is created automatically (may be new or existing).
7. Close the application.
8. Delete `PandaInk.exe`.
9. Verify no registry entries or Start Menu shortcuts were created.

## Expected result

The portable EXE runs self-contained from any directory without requiring installation or administrator rights. User data in `%APPDATA%\pandaink\` is preserved across runs.
