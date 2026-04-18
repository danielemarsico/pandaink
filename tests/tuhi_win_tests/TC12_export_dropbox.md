# TC12 — Export a drawing to Dropbox

**Goal:** Verify that the Dropbox export option authenticates via PKCE and uploads the SVG.

**Preconditions:**
- `DROPBOX_APP_KEY` is set in `src/tuhi/cloud_export.py`.
- The Dropbox app is configured with App Folder access.
- At least one drawing is visible in the Notebook.
- Internet access is available.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click on a drawing tab to select it.
3. Click the **Save SVG ▾** dropdown button.
4. Select **Dropbox** from the menu.
5. Observe a browser tab opens to the Dropbox authorisation page.
6. Click **Allow** on the Dropbox page.
7. Observe a code is shown on the page.
8. Observe a dialog appears in the app asking you to paste the code.
9. Copy the code from the browser and paste it into the dialog, then click **OK**.
10. Observe the status bar shows "Uploading to Dropbox…".
11. After a few seconds, observe the status bar shows "Uploaded to Dropbox: drawing_….svg".
12. Open Dropbox and navigate to **Apps → PandaInk** (or the app folder name); verify the file.

## Expected result

The SVG file is created inside the Dropbox App Folder under `/PandaInk/`. Re-running the export does not prompt again (token cached).

## Edge cases

- **No app key configured:** an error dialog explains how to register an app.
- **User cancels the code dialog:** status bar returns to idle; no file is created.
- **Wrong code pasted:** Dropbox returns an error; error dialog shown.
