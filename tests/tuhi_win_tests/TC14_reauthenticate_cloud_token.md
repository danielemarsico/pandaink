# TC14 — Re-authenticate an expired cloud token

**Goal:** Verify that the app gracefully handles an expired or missing token and re-authenticates.

**Preconditions:**
- Cloud credentials are configured (any provider).
- `%APPDATA%\pandaink\cloud_tokens.json` exists with a stale token.

## Steps

1. Open `%APPDATA%\pandaink\cloud_tokens.json` in a text editor.
2. For the provider under test (e.g. `"google"`), delete the `refresh_token` field or replace the access token with an invalid string, then save.
3. Launch the application: `python tuhi_gui.py`
4. Open a drawing tab.
5. Use **Save SVG ▾** → select the affected cloud provider.
6. Observe the app detects the invalid / missing token.
7. For **Google Drive** and **OneDrive**: observe a browser tab opens for re-authentication. Complete the sign-in.
8. For **Dropbox**: observe a browser tab opens and a code dialog appears. Paste the code.
9. Observe the upload completes and the status bar confirms success.
10. Verify `cloud_tokens.json` is updated with a fresh token.

## Expected result

The app re-authenticates seamlessly and completes the upload without crashing. The old token is replaced in `cloud_tokens.json`.
