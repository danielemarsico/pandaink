# PandaInk — Secretless Google Drive Auth Redesign

**Context**: While testing the deployed web app's Google Drive integration, we discovered that
Google requires `client_secret` on the OAuth token/refresh exchange for "Web application" clients
*even when using PKCE* — PKCE is additive there, not a substitute. The current implementation
(`docs/auth/storage_oauth.js`) does a manual authorization-code+PKCE dance by hand, which meant
hardcoding a real Client ID **and** Client Secret into a statically-served, public JS file.
GitHub's push-protection flagged it as a real leaked secret; the user allowed a one-time exception
to unblock testing, but wants a proper redesign — a **reusable, secretless** module for Google
login + Drive authorization, since a static site (GitHub Pages, no backend) can never truly hold a
confidential secret.

Note: the "Continue with Google" **login** button (`docs/auth/auth_manager.js` →
`signInWithGoogle()`) is a separate, already-fine flow — Supabase's dashboard holds that OAuth
client's secret server-side, never in our code. It is **out of scope** for this redesign; only the
Drive-access flow needs to change.

---

## Chosen approach: Google Identity Services token client

Replace the manual PKCE+secret flow with **`google.accounts.oauth2.initTokenClient()`** (loaded
from `https://accounts.google.com/gsi/client`) — Google's current, actively-maintained library and
the official replacement for the deprecated Google Sign-In JS platform.

This is genuinely secretless: GIS's own hosted JS performs the whole exchange internally via a
popup and hands our callback a short-lived `access_token` directly. No `code`, no `client_secret`,
no `redirect_uri` round-trip ever touches our origin or our code — and no full-page navigation away
from the app either, which eliminates the entire class of bugs hit this session (sessionStorage
surviving a redirect, exact-match `redirect_uri`, `state` param matching).

**Tradeoff accepted**: no long-lived refresh token. Access tokens expire in ~1hr; re-requesting via
`requestAccessToken({prompt: ''})` performs a silent (no popup) reissue as long as the user's Google
session is active and consent hasn't been revoked. This fits PandaInk's actual usage pattern — Drive
is only touched on-demand while the user is actively in the tab clicking "Sync," never in the
background — so losing offline/background refresh isn't a real regression.

**Why not a Supabase Edge Function proxy** (the alternative that would preserve a true refresh
token): rejected — this repo has zero Deno/Node/Supabase-CLI tooling, no `supabase/config.toml`, no
Edge Functions, and no CI secret-injection pipeline. Standing that up from scratch is disproportionate
to a usage pattern that never needs background sync. GIS eliminates the secret rather than hiding
it, needs zero new infrastructure, and keeps PandaInk fully static — its core architectural identity.

### Real gotchas to design around

1. **Popup blockers / user-gesture consumption** — `requestAccessToken()` opens a real popup and
   needs "user activation." If token acquisition happens deep inside `_cmdSync()` *after* a
   multi-second BLE operation, the original click's gesture may have expired and the popup gets
   silently blocked. **Fix**: acquire the token eagerly, at the very top of `_cmdSync()`, before any
   BLE I/O — fail fast with a clear message rather than failing deep inside `saveDrawing()`.
2. **Concurrency** — `gdrive_store.js` fires up to 6 parallel downloads, each calling
   `getValidAccessToken()`. The wrapper must serialize concurrent callers into one shared in-flight
   promise rather than firing multiple simultaneous `requestAccessToken()` calls.
3. **No guaranteed silent failure** — GIS only supports `prompt` values of `''` (silent-if-possible),
   `'consent'`, `'select_account'`; there's no "never show UI" guarantee. Acceptable since Drive
   access here is always user-interactive anyway.
4. **Redirect URI becomes unnecessary** — the popup posts a message to the opener; no
   `redirect_uri` round-trip. Safe to leave stale entries in Google Cloud Console or clean them up.
5. **Manual action item (not code)**: reset/delete the currently-exposed `GDRIVE_CLIENT_SECRET` in
   Google Cloud Console (Credentials → the Drive OAuth client → Reset Secret) once migrated off it —
   it's baked into this repo's git history and no longer needed.

---

## New reusable module: `docs/auth/google_token_client.js`

Generic, Drive-agnostic wrapper — no Supabase import, no Drive-specific knowledge, reusable for any
future Google API scope in this or other projects.

```js
// Generic wrapper around Google Identity Services' OAuth2 token client.
// Secretless: GIS's own hosted JS does the whole exchange internally via a
// popup and hands back a short-lived access_token — no code, no client_secret,
// no redirect_uri round-trip ever touches our origin or our code.
//
// Usage:
//   const gdriveAuth = createGoogleTokenClient({
//       clientId: 'xxxx.apps.googleusercontent.com',
//       scope: 'https://www.googleapis.com/auth/drive.appdata',
//   });
//   const token = await gdriveAuth.getToken();   // popup on first call, silent after
//   gdriveAuth.revoke();                          // full de-authorization

export function createGoogleTokenClient({ clientId, scope }) { ... }
```

Returned surface:
- `getToken({ forcePrompt } = {})` → `Promise<string>` — resolves to `access_token`; caches
  in-memory, reuses if >60s from expiry; serializes concurrent calls into one shared in-flight
  `requestAccessToken()`; rejects with a clear `Error` on `popup_failed_to_open` /
  `popup_closed` / `access_denied`.
- `revoke()` → `void` — revokes token + consent via `google.accounts.oauth2.revoke`, clears cache.
- `isTokenCached()` → `boolean` — sync, in-memory check, no network; lets UI check "is this tab
  currently authorized" without triggering a popup.

Internally: lazy-injects the GIS `<script>` tag on first use (no static tag needed in `app.html` —
keeps the module fully self-contained/portable), memoizes one `initTokenClient(...)` instance per
`createGoogleTokenClient()` call, sets `tokenClient.callback` fresh per request batch.

---

## File-by-file changes

**`docs/auth/google_token_client.js`** (new) — generic wrapper, as above.

**`docs/auth/storage_oauth.js`** (rewritten — thin Drive-specific layer over the new module):
- Delete `GDRIVE_CLIENT_SECRET`, `TOKEN_ENDPOINT`, `AUTH_ENDPOINT`, `REDIRECT_URI`, all PKCE
  helpers (`base64url`, `generateCodeVerifier`, `generateCodeChallenge`), the sessionStorage
  verifier/state constants, and `handleGDriveCallback()` entirely.
- Keep `GDRIVE_CLIENT_ID` (still valid — no secret attached to it anymore).
- Module-level singleton: `const gdriveAuth = createGoogleTokenClient({ clientId: GDRIVE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.appdata' });`
- Rename `startGDriveAuth()` → `connectGoogleDrive()`: now `async`, resolves on success / rejects
  with a real `Error` (no more full-page redirect). On success, sets
  `supabase.from('profiles').update({ storage_provider: 'google_drive' }).eq('id', user.id)` as a
  lightweight "has connected before" UI hint (repurposing the already-existing-but-dead
  `profiles.storage_provider` column).
- `getValidAccessToken()`: first checks `isDriveConnected()` (the profiles flag) and throws the
  existing friendly "Go to Profile → Cloud Storage" error if false, without touching GIS at all;
  otherwise delegates to `gdriveAuth.getToken()`.
- `isDriveConnected()`: reads `profiles.storage_provider === 'google_drive'` instead of querying
  the (now dropped) `storage_tokens` table.
- `disconnectDrive()`: calls `gdriveAuth.revoke()` in addition to the existing
  `profiles.storage_provider = null` update; drop the `storage_tokens` delete (table no longer
  exists).
- Update the file's top comment block to describe the GIS flow and in-memory-only token model.

**`docs/storage/gdrive_store.js`** — no change needed; only imports `getValidAccessToken`, whose
contract (`async () => string`) is preserved.

**`docs/ui/profile_panel.js`**:
- Import `connectGoogleDrive` instead of `startGDriveAuth`.
- Change the "Connect Google Drive" click handler from fire-and-forget to an awaited call with
  error handling, since the flow can now reject synchronously (popup blocked/closed/denied)
  instead of navigating away:
  ```js
  row.querySelector('#pp-connect-drive').addEventListener('click', async () => {
      try {
          await connectGoogleDrive();
          this._showMsg('pp-storage-msg', 'Google Drive connected.', false);
      } catch (e) {
          this._showMsg('pp-storage-msg', 'Error: ' + e.message, true);
      }
      await this._refreshStorage();
  });
  ```
- `_disconnectDrive()` unchanged (already awaits `disconnectDrive()`).

**`docs/ui/app_controller.js`**:
- Remove the `handleGDriveCallback` import and the try/catch block at the top of `mount()` — no
  redirect to catch anymore.
- Reliability fix: in `_cmdSync()`, acquire the Drive token (`getValidAccessToken()` or a thin
  `ensureDriveReady()` wrapper) at the very top, before `syncDrawings(...)` runs, so the
  popup/silent-reissue happens while the click's user-gesture window is still open.
- No other changes.

**`supabase/migrations/003_drop_storage_tokens.sql`** (new — never edit already-applied files):
```sql
-- storage_tokens is no longer needed: Google Drive access tokens are now
-- obtained client-side via Google Identity Services' token client
-- (docs/auth/google_token_client.js) and kept in-memory only, for the
-- lifetime of the current tab. Nothing OAuth-related is persisted server-side.
drop policy if exists "storage_tokens: owner access" on public.storage_tokens;
drop table if exists public.storage_tokens;

comment on column public.profiles.storage_provider is
  'UI hint only, not a live token: last cloud provider the user successfully authorized. Currently ''google_drive'' | null.';
```

**`README.md`** — rewrite the Google Drive half of "2. Create a Google Cloud project":
- Update the two-client comparison table's Drive-access row: client type → "Web application (no
  secret needed — Google Identity Services token client)"; only `GDRIVE_CLIENT_ID` gets pasted
  into `docs/auth/storage_oauth.js` now.
- Delete the "Note on the Drive client's secret" paragraph and the "⚠ Security tradeoff" callout
  block — no longer applicable.
- Rewrite step 2b: drop the "Authorized redirect URIs" sub-step (not needed for the popup-based
  flow — only "Authorized JavaScript origins" still matters); paste only the Client ID.
- Keep 2c (login client, Supabase-side secret) and the consent-screen section unchanged.
- Update the "Verify" step wording: a Google popup should appear and self-close, not "redirected /
  redirected back."
- Update the migration list in step 1 to include `003_drop_storage_tokens.sql` and drop
  `storage_tokens` from the description of what `001_init.sql` creates.
- Add a one-line callout recommending the user reset/delete the now-unused
  `GDRIVE_CLIENT_SECRET` at Google Cloud Console since it was previously committed to git history.

**Also update once implemented** (follow existing conventions, not detailed here):
`CHANGELOG.md` (new `## Unreleased` entry per repo convention) and `.claude/CLAUDE.md`'s Web App
architecture section (references to `storage_tokens`/PKCE/line numbers will go stale).

---

## Critical files
- `docs/auth/google_token_client.js` (new — generic GIS token-client wrapper)
- `docs/auth/storage_oauth.js` (rewritten Drive-specific layer, drops secret/PKCE/callback)
- `docs/ui/app_controller.js` (drop `handleGDriveCallback`/mount() redirect-catch, move token
  acquisition earlier in `_cmdSync()`)
- `docs/ui/profile_panel.js` (awaited connect flow with error handling)
- `supabase/migrations/003_drop_storage_tokens.sql` (new)
- `README.md`, `CHANGELOG.md`, `.claude/CLAUDE.md` (docs updates)

## Verification
1. Run `supabase/migrations/003_drop_storage_tokens.sql` in the Supabase SQL editor.
2. Serve `docs/` locally (`python -m http.server 8080` from `docs/`) or push to GitHub Pages.
3. Sign in as the test user, open Profile → Cloud Storage → **Connect Google Drive** — a Google
   popup should appear (not a full-page redirect), and close itself on consent.
4. Confirm `profiles.storage_provider` is now `'google_drive'` for that user (REST check or
   Supabase table editor), and `storage_tokens` table no longer exists.
5. Click **Sync** — token acquisition should happen immediately (fast popup/silent reissue), then
   BLE sync proceeds; drawings should upload to Drive's `appDataFolder` as before.
6. Reload the page, click Sync again — should NOT show a popup (silent reissue), confirming the
   in-memory/silent-reauth path works within a browser session.
7. Click **Disconnect** in the profile panel — confirm `profiles.storage_provider` clears and a
   subsequent Sync attempt correctly prompts to reconnect.
