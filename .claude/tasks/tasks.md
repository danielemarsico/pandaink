# PandaInk Web App — Auth + Cloud Storage Tasks

Plan: `.claude/webapp-auth-plan.md`

---

## External Setup (manual — must be done before Phase 1)

- [ ] Create Supabase project at supabase.com — note URL and anon key
- [ ] Create Google Cloud project "PandaInk"
  - [ ] Enable Google Drive API
  - [ ] Configure OAuth consent screen (scope: drive.appdata, test users)
  - [ ] Create OAuth client for "Sign in with Google" identity (Web app type) → for Supabase Auth
  - [ ] Create OAuth client for Google Drive PKCE (Web app type, no secret) → for Drive storage
  - [ ] Set authorized JS origin: https://danielemarsico.github.io
  - [ ] Set redirect URI: https://danielemarsico.github.io/pandaink/app.html
- [ ] Create GitHub OAuth App at github.com/settings/developers → for Supabase Auth
- [ ] Configure Supabase Auth providers: enable Google + GitHub with above credentials

---

## Phase 1 — Supabase Auth

### 1.1 Database schema
- [ ] Create `supabase/migrations/001_init.sql`
  - [ ] `profiles` table (id, display_name, storage_provider)
  - [ ] `devices` table (id, user_id, wacom_uuid, protocol, device_name, updated_at)
  - [ ] `storage_tokens` table (user_id, provider, access_token, refresh_token, expires_at)
  - [ ] RLS policies on all three tables (users access own rows only)
  - [ ] Trigger: auto-insert into profiles on auth.users insert
- [ ] Run migration in Supabase dashboard

### 1.2 Supabase client module
- [ ] Create `docs/auth/supabase_client.js`
  - [ ] Init Supabase JS client with SUPABASE_URL + SUPABASE_ANON_KEY constants
  - [ ] Export singleton `supabase` instance
- [ ] Add Supabase JS SDK to `docs/app.html` via CDN importmap or script tag

### 1.3 Auth manager module
- [ ] Create `docs/auth/auth_manager.js`
  - [ ] `signUpWithEmail(email, password)` → supabase.auth.signUp
  - [ ] `signInWithEmail(email, password)` → supabase.auth.signInWithPassword
  - [ ] `signInWithGoogle()` → supabase.auth.signInWithOAuth provider=google
  - [ ] `signInWithGitHub()` → supabase.auth.signInWithOAuth provider=github
  - [ ] `signOut()` → supabase.auth.signOut
  - [ ] `getSession()` → supabase.auth.getSession
  - [ ] `onAuthStateChange(callback)` → supabase.auth.onAuthStateChange
  - [ ] Handle OAuth redirect on page load (detect session from URL hash)

### 1.4 Auth UI in app_controller.js
- [ ] Add auth check at mount: if no session → show auth panel, return
- [ ] Build auth panel HTML (email+password form + Google + GitHub buttons)
- [ ] Register button: toggle to registration form (confirm password field)
- [ ] After sign-in: destroy auth panel, continue normal mount
- [ ] Add auth toolbar row (avatar initial + email + Profile button + Sign out)
- [ ] Wire Sign out button → auth_manager.signOut() + reload auth panel

### 1.5 Auth styles
- [ ] Add to `docs/style.css`:
  - [ ] `.auth-panel` — centered card, max-width 380px
  - [ ] `.auth-panel input`, `.auth-panel button` — form styles
  - [ ] `.auth-divider` — "or" divider between email and social buttons
  - [ ] `.btn-social` — Google/GitHub buttons with logos
  - [ ] `.auth-toolbar-row` — avatar chip, email, profile + signout buttons

---

## Phase 2 — Profile Settings + Google Drive Connection

### 2.1 Google Drive OAuth module
- [ ] Create `docs/auth/storage_oauth.js`
  - [ ] `GDRIVE_CLIENT_ID` constant
  - [ ] `GDRIVE_SCOPE` = 'https://www.googleapis.com/auth/drive.appdata'
  - [ ] `generateCodeVerifier()` — 96 random bytes, base64url
  - [ ] `generateCodeChallenge(verifier)` — SHA-256 via SubtleCrypto, base64url
  - [ ] `startGDriveAuth()` — save verifier to sessionStorage, redirect to Google
  - [ ] `handleGDriveCallback(code)` — exchange code for tokens via POST to oauth2.googleapis.com/token
  - [ ] `saveTokensToSupabase(tokens)` — upsert into storage_tokens table
  - [ ] `loadTokensFromSupabase(provider)` — read from storage_tokens
  - [ ] `getValidAccessToken(provider)` — refresh if expiry < 60s, save updated token
  - [ ] `disconnectProvider(provider)` — delete row from storage_tokens, update profiles

### 2.2 Profile panel UI
- [ ] Create `docs/ui/profile_panel.js`
  - [ ] `ProfilePanel(supabase, authManager, storageOAuth)` class
  - [ ] `open()` / `close()` methods (slides in from right or modal)
  - [ ] **Account section**: display name (editable + save), email, change password button, delete account button
  - [ ] **Cloud Storage section**: show connected provider or connect button; connect triggers `startGDriveAuth()`; disconnect triggers `disconnectProvider()`
  - [ ] **Device section**: show device name + protocol label; Forget device button
  - [ ] On open: detect `?gdrive_code=` in URL (post-OAuth redirect), call `handleGDriveCallback`, clean URL

### 2.3 app_controller.js — profile panel wiring
- [ ] Import ProfilePanel
- [ ] Wire Profile button → `profilePanel.open()`
- [ ] After OAuth callback handled in ProfilePanel, refresh auth toolbar state

### 2.4 Profile panel styles
- [ ] `.profile-panel` — slide-in drawer or modal overlay
- [ ] `.profile-section` — section heading + content
- [ ] `.storage-provider-row` — icon + name + connect/disconnect button
- [ ] `.btn-danger` — delete/forget/disconnect destructive actions

---

## Phase 3 — Device Config in Supabase

### 3.1 Device CRUD helpers
- [ ] Add to `docs/auth/auth_manager.js` (or new `docs/storage/device_store.js`):
  - [ ] `saveDevice(userId, { wacom_uuid, protocol, device_name })` → upsert devices table
  - [ ] `loadDevice(userId)` → select from devices where user_id = userId, return first
  - [ ] `deleteDevice(userId)` → delete from devices where user_id = userId

### 3.2 register.js — save to Supabase after BLE registration
- [ ] After `registerDevice()` succeeds, call `saveDevice(userId, info)` instead of `localStorage.setItem`
- [ ] Remove `localStorage.getItem/setItem(STORAGE_KEY)` early-return in `registerDevice`
  (cloud is now the source of truth; UUID generation still happens on first run)

### 3.3 app_controller.js — load device from Supabase on login
- [ ] In `mount()`, after session confirmed: call `loadDevice(userId)`
- [ ] If device found: set `this._deviceInfo`, call `_updateDeviceLabel()`, set status "Device loaded — click Connect"
- [ ] Remove `localStorage.getItem(DEVICE_STORAGE_KEY)` device restore

### 3.4 Forget device
- [ ] `_cmdForget()` → call `deleteDevice(userId)` (+ Phase 4: deleteAllDrawings from Drive)
- [ ] Remove `localStorage.removeItem(DEVICE_STORAGE_KEY)`

---

## Phase 4 — Drawings in Google Drive

### 4.1 Abstract cloud store interface
- [ ] Create `docs/storage/cloud_store.js`
  - [ ] `CloudStore(storageOAuth)` class
  - [ ] `saveDrawing(drawing)` → upload `drawing_<timestamp>.json` to appDataFolder
  - [ ] `getDrawingsByDevice(deviceId)` → list + download all `drawing_*.json`, filter by deviceId
  - [ ] `deleteDrawing(driveFileId)` → Drive DELETE
  - [ ] `deleteAllDrawings()` → list all, delete all

### 4.2 Google Drive implementation
- [ ] Create `docs/storage/gdrive_store.js` implementing CloudStore interface
  - [ ] `_upload(name, content)` — POST /upload/drive/v3/files multipart
  - [ ] `_listFiles(prefix)` — GET /drive/v3/files?spaces=appDataFolder
  - [ ] `_download(fileId)` — GET /drive/v3/files/<id>?alt=media
  - [ ] `_delete(fileId)` — DELETE /drive/v3/files/<id>
  - [ ] All methods call `storageOAuth.getValidAccessToken('google_drive')` first

### 4.3 app_controller.js — swap IDB for Drive
- [ ] `_cmdSync()`: replace `saveDrawing(record)` (IDB) with `cloudStore.saveDrawing(record)`
  - [ ] Add dedup check: skip if `drawing_<timestamp>.json` already exists in Drive
- [ ] `_loadStoredDrawings()`: replace `getDrawingsByDevice(deviceId)` with `cloudStore.getDrawingsByDevice(deviceId)`
  - [ ] Show loading indicator during Drive fetch
- [ ] `_deleteDrawing()`: replace `deleteDrawing(drawing.id)` with `cloudStore.deleteDrawing(drawing.driveFileId)`
- [ ] `_cmdForget()`: add `cloudStore.deleteAllDrawings()`
- [ ] Remove `import { saveDrawing, getDrawingsByDevice, deleteDrawing, saveDevice, getDevice } from '../storage/idb_store.js'`

### 4.4 Cleanup
- [ ] Remove `docs/storage/idb_store.js` (or keep but mark as unused)
- [ ] Remove IndexedDB open/upgrade code if idb_store.js is deleted

---

## Phase 5 — Polish

- [ ] Loading spinner / skeleton while Drive drawings are fetching
- [ ] Offline message: if `getValidAccessToken` fails due to network error, show "Offline — connect to load drawings"
- [ ] Profile panel: show Google Drive storage quota (GET /drive/v3/about?fields=storageQuota)
- [ ] Profile panel: show Drive account email (from token info or userinfo endpoint)
- [ ] Privacy policy page `docs/privacy.html` (needed for Google app verification)
- [ ] Submit Google OAuth consent screen for verification (required for >100 users)
