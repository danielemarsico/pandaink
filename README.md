# PandaInk

Sync and export drawings from your Wacom SmartPad on **Windows** (and any platform with Bluetooth LE support).

PandaInk is a Windows port of the Linux-only [Tuhi](https://github.com/tuhiproject/tuhi) project. It replaces BlueZ, D-Bus, and GTK with cross-platform alternatives (bleak, tkinter) so you can use your Bamboo Spark, Slate, Folio, or Intuos Paper on Windows without a Linux machine.

There is also a **cross-platform Web BLE app** hosted on GitHub Pages — no installation required, works from any computer with Chrome or Edge.

## Supported devices

- Bamboo Spark
- Bamboo Slate
- Bamboo Folio (A4)
- Intuos Pro Paper (Medium)

---

## Web App

**[Open Web App →](https://danielemarsico.github.io/pandaink/app.html)**

The web app runs entirely in the browser using the Web Bluetooth API. It requires no installation and works on any device with Chrome or Edge.

### Features

- **Register** your Wacom device over BLE directly from the browser
- **Sync** drawings offline (device push mode)
- **Live mode** — stream pen strokes to screen in real time
- **User accounts** — sign up / log in with email+password, Google, or GitHub
- **Cloud storage** — drawings are saved to your personal Google Drive (`appDataFolder`)
- **Cross-computer** — connect from any machine and your device registration and drawings follow you
- **Profile panel** — manage your account, change password, connect/disconnect Google Drive, forget device

### Supported browsers

Chrome 89+ and Edge 89+ (Web Bluetooth API required). Firefox and Safari are not supported.

---

## Web App Setup (self-hosting / development)

The live app at `danielemarsico.github.io/pandaink` uses pre-configured Supabase and Google Cloud credentials. If you fork this repo or want to run your own instance you need to set up the external services below.

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In the SQL editor, run the migration files **in order**:
   ```
   supabase/migrations/001_init.sql
   supabase/migrations/002_devices_unique_user_id.sql
   ```
   `001_init.sql` creates the `profiles`, `devices`, and `storage_tokens` tables with Row Level
   Security policies. `002_devices_unique_user_id.sql` adds a unique constraint on
   `devices.user_id` — without it, device registration fails with a 400
   (`saveDevice()` upserts on that column).
3. Copy your project credentials from **Project Settings → API**:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — long JWT string
4. Paste them into `docs/auth/supabase_client.js`:
   ```js
   const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';   // ← line 11
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                          // ← line 12
   ```
5. (Optional, for testing without email verification) **Authentication → Users → Add user**,
   enter an email/password, and check **Auto Confirm User** to skip the confirmation email.
6. **Authentication → URL Configuration** — new Supabase projects default to `http://localhost:3000`,
   which is where OAuth logins (Google/GitHub) will redirect back to instead of your real app if
   left unchanged:
   - **Site URL** → `https://danielemarsico.github.io/pandaink/app.html` (or your own domain)
   - **Redirect URLs** → add the same URL (and e.g. `http://localhost:8080/app.html` if you also
     test locally). OAuth only redirects to URLs on this allow-list — the `redirectTo` value the
     code passes (`auth_manager.js`) is ignored if it isn't listed here.

### 2. Create a Google Cloud project (Google Drive + OAuth)

**You need two separate Google OAuth clients here — they don't share credentials.** Google is
used for two unrelated things in this app, and each needs its own client:

| | Drive access client (2b) | Login client (2c) |
|---|---|---|
| What it's for | "Connect Google Drive" in the profile panel — your browser reads/writes the signed-in user's own Drive files. Nothing to do with logging into PandaInk; you're already logged in by the time you click this. | The "Continue with Google" button — just an alternative way to create/enter your PandaInk account. Supabase's servers talk to Google here, not your browser. |
| Client type | Web application (PKCE + client_secret — see note below) | Web application, secret held server-side |
| Where the credential goes | Both Client ID **and** Client Secret pasted into `docs/auth/storage_oauth.js` (this repo's public code) | Client ID + Secret pasted into Supabase dashboard → Authentication → Providers → Google (never shipped to the browser) |

**Note on the Drive client's secret:** Google requires `client_secret` on the token/refresh
requests for *every* "Web application" OAuth client, even when using PKCE — PKCE is an addition
here, not a replacement for the secret like it is with some other providers. So the Drive
client's secret ends up shipped in the public JS bundle (`storage_oauth.js`), same tradeoff as the
Supabase anon key.

You still need two separate clients — the credentials go to different places (your code vs.
Supabase's dashboard) and serve unrelated flows — but don't be surprised that both end up having a
secret.

> **⚠ Security tradeoff: the Drive client_secret is public.**
> Anyone can view-source `storage_oauth.js` and read `GDRIVE_CLIENT_ID` +
> `GDRIVE_CLIENT_SECRET`. What that does and doesn't allow:
> - **Not exposed:** any actual Drive data. The secret alone is useless without a valid,
>   single-use authorization `code` (only produced by a real user completing real consent) and
>   the matching PKCE `code_verifier` (generated fresh per attempt, never leaves the browser).
>   The scope is also `drive.appdata` — a hidden per-app folder, not general Drive access.
> - **What it does allow:** someone could use the leaked ID/secret to stand up a fake login
>   page impersonating this app's OAuth identity, and if they tricked a victim into approving
>   it, intercept that victim's authorization code to get a token for *that victim's* Drive.
>   This is a phishing/impersonation risk, not a direct data-access risk.
> - **Why it's accepted here:** this is the standard, Google-acknowledged tradeoff for a
>   browser-only app with no backend server to hold a true confidential secret. Keeping the
>   OAuth consent screen in "Testing" mode with an explicit test-user allow-list (see the
>   consent screen steps below) limits who can even reach the flow.
> - **To eliminate this risk entirely later:** either move the token exchange behind a small
>   serverless function (e.g. a Supabase Edge Function) so the secret never reaches the
>   browser, or switch to Google Identity Services' `initTokenClient()` flow, which is
>   genuinely secretless (tradeoff: no refresh token, access tokens expire in ~1hr and must be
>   silently reissued instead).

#### 2a. Enable the Drive API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (e.g. "PandaInk").
2. Navigate to **APIs & Services → Library** and enable **Google Drive API**.

#### 2b. OAuth client for Drive access (PKCE + client_secret)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name it something like "PandaInk Drive access" so it's not confused with 2c.
3. Add the domain where the app is hosted to **Authorized JavaScript origins** — **origin only, no path**:
   - `https://danielemarsico.github.io`
   - `http://localhost:8080` (for local development)
4. Add the **full page URL, including path**, to **Authorized redirect URIs** — this must exactly
   match `window.location.origin + window.location.pathname` (computed in `storage_oauth.js`'s
   `REDIRECT_URI`), not just the origin from step 3, or you'll get `Error 400: redirect_uri_mismatch`:
   - `https://danielemarsico.github.io/pandaink/app.html`
   - `http://localhost:8080/app.html` (for local development)
5. Click **Create** — copy both the **Client ID** (ends in `.apps.googleusercontent.com`) and the
   **Client Secret** shown in the popup (or find them later under Credentials → this client).
6. Paste both into `docs/auth/storage_oauth.js`:
   ```js
   export const GDRIVE_CLIENT_ID     = 'YOUR_CLIENT_ID.apps.googleusercontent.com';  // ← line 12
   export const GDRIVE_CLIENT_SECRET = 'YOUR_CLIENT_SECRET';                          // ← line 13
   ```

#### 2c. OAuth client for "Sign in with Google" login (has a secret)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name it something like "PandaInk Supabase login".
3. Under **Authorized redirect URIs**, add exactly your Supabase project's callback:
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
4. Click **Create** — a popup shows both a **Client ID** and a **Client Secret** this time. Copy both;
   you'll paste them into the Supabase dashboard in step 4, not into any file in this repo.

#### Configure the OAuth consent screen

This screen is shared by both clients above.

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External** (or Internal if you have a Google Workspace org).
3. Fill in App name, support email, developer contact.
4. Add scope: `https://www.googleapis.com/auth/drive.appdata`
5. **Add test users** — while the consent screen is in "Testing" mode, only whitelisted Google
   accounts can complete *either* OAuth flow: **OAuth consent screen → Test users → + Add users**,
   enter the real Google account(s) you'll test with, save. This is separate from Supabase's own
   user list (step 1.5 above) — a Supabase login account and a Google test user are two different
   whitelists, and both need to be set up independently.
6. Publish the app when ready (moves out of Testing mode so any user can log in — see
   "Submit for Google verification" in the task list).

### 3. Create a GitHub OAuth App (optional — for "Sign in with GitHub")

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Homepage URL** to your app's URL (e.g. `https://danielemarsico.github.io/pandaink`).
3. Set **Authorization callback URL** to your Supabase project's auth callback:
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
4. Copy the **Client ID** and generate a **Client Secret**.

### 4. Configure Supabase Auth providers

In your Supabase project, go to **Authentication → Providers**:

#### Google

1. Enable the **Google** provider.
2. Paste the **Client ID** and **Client Secret** from the **login client (step 2c)** — not the
   Drive access client from 2b, which has no secret to paste here.
3. Save. No code change or redeploy needed — this lives entirely in the Supabase dashboard.

#### GitHub

1. Enable the **GitHub** provider.
2. Paste the **Client ID** and **Client Secret** from step 3.

### 5. Verify

After completing the setup:

1. Open `docs/app.html` locally (e.g. via `npx serve docs`) or push to GitHub Pages.
2. Sign up with email+password — you should see a new row in the Supabase `profiles` table.
3. Click **Profile → Connect Google Drive** — you should be redirected to Google's OAuth consent screen, then redirected back with Drive connected.
4. Register your Wacom device — you should see a new row in the `devices` table.
5. Sync a drawing — a file `drawing_<timestamp>.json` should appear in your Google Drive appDataFolder.

### 6. Ko-fi Pro unlock (admin)

Pro is a one-time $5 Ko-fi purchase. The Cloudflare Worker's `/kofi/webhook` unlocks it
automatically by matching the **Ko-fi payer's email** to a Supabase Auth user and setting
`profiles.plan = 'pro'` (see `worker/src/index.js`). If someone pays with a different email than
their PandaInk account, the webhook finds no match and does nothing — no error is shown to them
or to you, so you won't notice unless you compare Ko-fi's payment history against `profiles.plan`.

To manually grant Pro in that case:

**Table Editor:**
1. Supabase dashboard → **Authentication → Users** → find the buyer's `id` from their email.
2. **Table Editor → `profiles`** → find the row with that `id` → edit `plan` to `pro` → save.

**Or SQL Editor** (faster if you already have the email):
```sql
update public.profiles
set plan = 'pro'
where id = (select id from auth.users where email = 'the-buyers-email@example.com');
```

This works from the dashboard because it runs with a privileged connection that bypasses the RLS
policy in `003_plan.sql` — that policy only blocks a **user's own** JWT from self-upgrading, not
an admin using the SQL editor or service-role key.

---

## Windows App

### Requirements

- Windows 10 / 11 with Bluetooth LE (BLE) adapter
- Python 3.12+

### Installation

#### Option A — Portable EXE (no Python required)

Download `PandaInk-portable.exe` from the [latest release](https://github.com/danielemarsico/pandaink/releases/latest) and run it directly.

#### Option B — From source

```
git clone https://github.com/danielemarsico/pandaink.git
cd pandaink
pip install -r requirements.txt
python src/tuhi_gui.py
```

### GUI

```
python src/tuhi_gui.py
```

1. **Register** — click Register to search for and pair your device over BLE.
2. **Listen** — click Listen to sync offline drawings from the device to your PC.
3. **Fetch** — reload drawings from disk (also runs automatically at startup).
4. **Save SVG** — export any drawing as an SVG file.
5. **Live mode** — stream pen strokes to screen in real time while you draw.

### CLI

All commands are run from the `src/` directory:

```
cd src
```

#### Register a device

Put the device into pairing mode (hold the button ~6 seconds until the LED flashes), then:

```
python tuhi_cli.py search --register
```

Press the button on the device when prompted. Registration is saved to `%APPDATA%\pandaink\settings.ini`.

#### List registered devices

```
python tuhi_cli.py list
```

#### Sync drawings (offline mode)

Press the button on the device to push drawings over BLE, then:

```
python tuhi_cli.py listen F4:21:DE:4D:26:BF
```

Press `Ctrl+C` to stop. Drawings are saved as JSON in `%APPDATA%\pandaink\`.

#### Export drawings to SVG

```
python tuhi_cli.py fetch F4:21:DE:4D:26:BF --svg --orientation portrait --output C:\Users\Daniele\Drawings
```

Writes `drawing_<timestamp>.json` and `drawing_<timestamp>.svg` in the output directory.

Orientation options: `landscape` (default), `portrait`, `reverse-landscape`, `reverse-portrait`.

#### Live pen streaming

```
python tuhi_cli.py live F4:21:DE:4D:26:BF --svg --orientation portrait --output C:\Users\Daniele\Drawings
```

Streams pen strokes in real time. Press `Ctrl+C` to stop.

| Flag | Description |
|---|---|
| `--svg` | Also export an SVG file when stopped |
| `--orientation` | `portrait` (default), `landscape`, `reverse-portrait`, `reverse-landscape` |
| `--output DIR` / `-o DIR` | Output directory (default: current directory) |

#### Global options

| Flag | Description |
|---|---|
| `-v` / `--verbose` | Show debug logging |
| `--config-dir PATH` | Use a custom config directory instead of `%APPDATA%\pandaink\` |

---

Drawings are stored in `%APPDATA%\pandaink\`.

## License

PandaInk is a derivative work of Tuhi and is distributed under the
**GNU General Public License v2.0**. See `COPYING` for the full license text
and `NOTICE.md` for upstream credits.
