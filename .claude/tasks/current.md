# PandaInk — Remaining Tasks

All completed tasks have been removed. See `PROGRESS.md` for history.

---

## Windows App

### Manual / User Steps

- [ ] **Screenshots** — Replace grey placeholder boxes in `docs/features.html` with real screenshots once app is stable
- [ ] **Ko-fi** — Create account at ko-fi.com with username `danielemarsico` (GitHub Sponsor button links to it automatically via `FUNDING.yml`)
- [ ] **GitHub Sponsors** — Enrol at github.com/sponsors; once approved, uncomment `github: danielemarsico` in `.github/FUNDING.yml`
- [ ] **Lightning donations** — Create a Lightning Address (e.g. via Wallet of Satoshi or Alby) and add donate links to `docs/index.html` and `docs/download.html`

### Hardware Smoke-Tests (need real Bamboo Folio F4:21:DE:4D:26:BF)

- [ ] **GUI Live mode** — Start Live → draw → strokes appear in real time → Stop Live → drawing saved as new tab

### Research (no implementation)

- [ ] **S2-3 Stroke segmentation in live mode** — Decide how to detect when a stroke is finished in the browser. Options: pen-left-proximity event (0xff×6 packet, already handled, most reliable), pressure-drop timeout (~200 ms fallback), velocity/direction heuristic (complex). Recommendation: rely on existing proximity event as primary; add 200 ms pressure-drop timeout as fallback for devices that don't reliably send 0xff packets.

---

## Web App

### External Setup (manual — must be done before the web app works)

These steps require access to external dashboards. Instructions are also in `README.md`.

- [x] **Supabase** — Create project at supabase.com → run `supabase/migrations/001_init.sql` in SQL editor → paste URL and anon key into `docs/auth/supabase_client.js` lines 12–13
- [x] **Google Cloud — Drive API** — Create project "PandaInk" → enable Google Drive API → configure OAuth consent screen (scope: `drive.appdata`, add test users) → create Web Application OAuth client (no secret, PKCE) → paste Client ID into `docs/auth/storage_oauth.js` line 14
- [x] **Google Cloud — Sign in with Google** — Create a second Web Application OAuth client (with secret) → add Supabase callback URL (`https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`) as authorized redirect URI → configure in Supabase Authentication → Providers → Google
- [ ] **GitHub OAuth App** — Create at github.com/settings/developers → callback URL: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback` → configure in Supabase Authentication → Providers → GitHub
- [ ] **Publish OAuth consent screen** — Move Google app out of "Testing" mode so any user can log in (required for >100 users)

### Phase 5 — Polish

- [ ] **Loading spinner** — Show skeleton or spinner in the drawings list while Google Drive files are being fetched
- [ ] **Offline message** — If `getValidAccessToken()` fails due to network error, show "Offline — connect to load drawings" instead of an unhandled error
- [ ] **Drive quota in profile** — Show Google Drive storage used/available in the Profile panel (GET `/drive/v3/about?fields=storageQuota`)
- [ ] **Drive account email in profile** — Show the connected Google account email in the Profile panel (from token userinfo endpoint)
- [ ] **Privacy policy** — Create `docs/privacy.html` (required for Google OAuth app verification)
- [ ] **Submit for Google verification** — Once privacy policy is live and app is stable, submit OAuth consent screen for Google verification (unlocks >100 users without manual test-user whitelisting)
