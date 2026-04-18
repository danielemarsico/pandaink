# TC13 — Export a drawing to OneDrive

**Goal:** Verify that the OneDrive export option authenticates via MSAL and uploads the SVG.

**Preconditions:**
- `ONEDRIVE_CLIENT_ID` is set in `src/tuhi/cloud_export.py`.
- The Azure app registration has the `Files.ReadWrite.AppFolder` scope and is a public client.
- At least one drawing is visible in the Notebook.
- Internet access is available.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click on a drawing tab to select it.
3. Click the **Save SVG ▾** dropdown button.
4. Select **OneDrive** from the menu.
5. Observe a browser tab opens to the Microsoft sign-in page (MSAL interactive flow).
6. Sign in with a Microsoft / personal account and click **Accept** on the permissions page.
7. Observe the browser closes / redirects back automatically.
8. Observe the status bar shows "Uploading to OneDrive…".
9. After a few seconds, observe the status bar shows "Uploaded to OneDrive: drawing_….svg".
10. Open OneDrive in a browser and navigate to **Apps → PandaInk**; verify the file.

## Expected result

The SVG file is created in the OneDrive App Folder. Re-running the export does not prompt again (refresh token cached).

## Edge cases

- **No client ID configured:** an error dialog explains how to register an app.
- **User cancels sign-in:** MSAL returns an error; error dialog shown.
- **Expired refresh token:** re-authenticates automatically via `acquire_token_by_refresh_token`.
