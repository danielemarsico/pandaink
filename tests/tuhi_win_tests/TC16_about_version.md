# TC16 — About tab shows correct version and licence

**Goal:** Verify that the About tab in the Help dialog displays accurate metadata.

**Preconditions:**
- Application is running.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click **Help** to open the Help dialog.
3. Click the **About** tab.
4. Verify the version string matches the current release tag (e.g. `v0.1.1`).
5. Verify "GNU General Public Licence v2" (or similar) is mentioned.
6. Verify "Based on Tuhi" (upstream credit) is present with a link or reference.
7. Verify a GitHub link to `danielemarsico/pandaink` is shown.

## Expected result

The About tab accurately reflects the current version and includes the required attribution and licence notice.
