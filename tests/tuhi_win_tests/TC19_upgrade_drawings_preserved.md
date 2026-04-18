# TC19 — Upgrade: existing drawings are preserved

**Goal:** Verify that upgrading to a newer version does not delete or corrupt existing drawings.

**Preconditions:**
- An older version of PandaInk is installed (or portable EXE was used).
- At least two drawing JSON files exist in `%APPDATA%\pandaink\`.
- A newer `PandaInk-setup.exe` or `PandaInk.exe` is available.

## Steps

1. Note the filenames and modification dates of files in `%APPDATA%\pandaink\`.
2. Launch the current version, open a drawing, verify it renders correctly.
3. Close the application.
4. Install the newer version over the existing one (installer) or replace the EXE (portable).
5. Launch the new version.
6. Verify the drawing tabs load automatically at startup with the same drawings.
7. Click on a drawing tab; verify the strokes render correctly.
8. Verify `%APPDATA%\pandaink\settings.ini` still contains the registered device address.
9. Verify no drawing JSON files were deleted or modified.

## Expected result

All drawings and the device registration survive the upgrade unchanged. The new version reads the same `%APPDATA%\pandaink\` data without migration steps.
