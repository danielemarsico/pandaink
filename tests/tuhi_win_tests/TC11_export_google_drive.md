# TC11 — Export a drawing to Google Drive

**Goal:** Verify that the Google Drive export option authenticates via OAuth2 and uploads the SVG.

**Preconditions:**
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `src/tuhi/cloud_export.py`.
- Google Drive API is enabled in the corresponding Google Cloud project.
- At least one drawing is visible in the Notebook.
- Internet access is available.

## Steps

1. Launch the application: `python tuhi_gui.py`
2. Click on a drawing tab to select it.
3. Click the **Save SVG ▾** dropdown button.
4. Select **Google Drive** from the menu.
5. Observe a browser tab opens to the Google OAuth2 consent screen.
6. Sign in with a Google account and click **Allow**.
7. Observe the browser shows "Authorised! You can close this window."
8. Observe the status bar shows "Uploading to Google Drive…".
9. After a few seconds, observe the status bar shows "Uploaded to Google Drive: drawing_….svg".
10. Open Google Drive in a browser and verify the file appears.

## Expected result

The SVG file is created in the user's Google Drive root. Re-running the export on the same tab does not prompt for OAuth again (token is cached in `%APPDATA%\pandaink\cloud_tokens.json`).

## Edge cases

- **No credentials configured:** an error dialog explains how to register an app.
- **User cancels OAuth:** status bar returns to idle; no file is created.
- **Expired token:** re-authenticates automatically on next export.
