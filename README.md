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
2. In the SQL editor, run the migration file:
   ```
   supabase/migrations/001_init.sql
   ```
   This creates the `profiles`, `devices`, and `storage_tokens` tables with Row Level Security policies.
3. Copy your project credentials from **Project Settings → API**:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — long JWT string
4. Paste them into `docs/auth/supabase_client.js`:
   ```js
   const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';   // ← line 12
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                          // ← line 13
   ```

### 2. Create a Google Cloud project (Google Drive + OAuth)

#### Enable the Drive API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (e.g. "PandaInk").
2. Navigate to **APIs & Services → Library** and enable **Google Drive API**.

#### Create an OAuth 2.0 client for Drive (PKCE — browser-side)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Add the domain where the app is hosted to **Authorized JavaScript origins**, e.g.:
   - `https://danielemarsico.github.io`
   - `http://localhost:8080` (for local development)
4. Add the same URL(s) to **Authorized redirect URIs** (the app redirects back to itself after OAuth).
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).
6. Paste it into `docs/auth/storage_oauth.js`:
   ```js
   export const GDRIVE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';  // ← line 14
   ```

#### Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External** (or Internal if you have a Google Workspace org).
3. Fill in App name, support email, developer contact.
4. Add scope: `https://www.googleapis.com/auth/drive.appdata`
5. Add any test users while the app is in "Testing" mode.
6. Publish the app when ready (moves out of Testing mode so any user can log in).

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
2. Paste the **Client ID** and **Client Secret** from the Google Cloud OAuth client you created in step 2.
   - Note: for the Supabase Google provider you need a **Web application** OAuth client (not the PKCE client used for Drive). You can reuse the same client or create a second one.
3. Set the callback URL in your Google Cloud OAuth client's **Authorized redirect URIs**:
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```

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
