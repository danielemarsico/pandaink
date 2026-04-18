#!/usr/bin/env python3
#
# Cloud export for PandaInk — Google Drive, Dropbox, OneDrive.
# OAuth2 tokens are stored in %APPDATA%\pandaink\cloud_tokens.json.
#
# To enable cloud export, register your app at each provider and fill in the
# credential constants below:
#
#   Google Drive  — https://console.cloud.google.com/ → APIs & Services →
#                   Credentials → Create OAuth 2.0 Client ID (Desktop app).
#                   Enable the "Google Drive API" in the project.
#
#   Dropbox       — https://www.dropbox.com/developers/apps → Create App
#                   (Scoped access, App folder). Copy the App key.
#
#   OneDrive      — https://portal.azure.com → App registrations → New
#                   registration (Accounts in any org + personal accounts;
#                   redirect URI: http://localhost). Copy the Application ID.

import json
import logging
import os
import webbrowser

logger = logging.getLogger('tuhi.cloud')

# ─────────────────────────────────────────────────────────────────────────────
# Credentials — fill these in after registering your app at each provider.
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID = ''
GOOGLE_CLIENT_SECRET = ''

DROPBOX_APP_KEY = ''

ONEDRIVE_CLIENT_ID = ''


# ─────────────────────────────────────────────────────────────────────────────
# Token storage
# ─────────────────────────────────────────────────────────────────────────────

def _config_dir():
    return os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'pandaink')


def _token_path():
    return os.path.join(_config_dir(), 'cloud_tokens.json')


def _load_tokens():
    try:
        with open(_token_path()) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_tokens(tokens):
    os.makedirs(_config_dir(), exist_ok=True)
    with open(_token_path(), 'w') as f:
        json.dump(tokens, f, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# Google Drive
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file']


def _google_credentials():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise RuntimeError(
            'Google Drive is not configured.\n\n'
            'Register a Desktop app at https://console.cloud.google.com/ '
            'and set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in cloud_export.py.'
        )

    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow

    tokens = _load_tokens()
    google = tokens.get('google', {})

    creds = None
    if google.get('refresh_token'):
        creds = Credentials(
            token=google.get('access_token'),
            refresh_token=google['refresh_token'],
            token_uri='https://oauth2.googleapis.com/token',
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            scopes=GOOGLE_SCOPES,
        )
        if creds.expired:
            try:
                creds.refresh(Request())
                tokens['google']['access_token'] = creds.token
                _save_tokens(tokens)
            except Exception:
                creds = None  # fall through to full re-auth

    if creds is None or not creds.valid:
        client_config = {
            'installed': {
                'client_id': GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'redirect_uris': ['http://localhost'],
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
            }
        }
        flow = InstalledAppFlow.from_client_config(client_config, GOOGLE_SCOPES)
        creds = flow.run_local_server(port=8765, open_browser=True)
        tokens['google'] = {
            'access_token': creds.token,
            'refresh_token': creds.refresh_token,
        }
        _save_tokens(tokens)

    return creds


def upload_google_drive(svg_bytes, filename):
    """Upload svg_bytes to the user's Google Drive root as filename."""
    import io
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload

    creds = _google_credentials()
    service = build('drive', 'v3', credentials=creds)
    media = MediaIoBaseUpload(io.BytesIO(svg_bytes), mimetype='image/svg+xml')
    result = service.files().create(
        body={'name': filename},
        media_body=media,
        fields='id,name',
    ).execute()
    logger.info(f'Google Drive: uploaded {result.get("name")} (id={result.get("id")})')
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Dropbox
# ─────────────────────────────────────────────────────────────────────────────

def _dropbox_client(parent_widget=None):
    if not DROPBOX_APP_KEY:
        raise RuntimeError(
            'Dropbox is not configured.\n\n'
            'Register an App Folder app at https://www.dropbox.com/developers/apps '
            'and set DROPBOX_APP_KEY in cloud_export.py.'
        )

    import dropbox
    from dropbox import DropboxOAuth2FlowNoRedirect

    tokens = _load_tokens()
    dbx = tokens.get('dropbox', {})

    if dbx.get('refresh_token'):
        return dropbox.Dropbox(
            oauth2_refresh_token=dbx['refresh_token'],
            app_key=DROPBOX_APP_KEY,
        )

    auth_flow = DropboxOAuth2FlowNoRedirect(
        DROPBOX_APP_KEY, use_pkce=True, token_access_type='offline'
    )
    auth_url = auth_flow.start()
    webbrowser.open(auth_url)

    # Ask the user to paste the authorisation code via a Tkinter dialog.
    import tkinter as tk
    from tkinter import simpledialog
    root = parent_widget or tk._default_root
    code = simpledialog.askstring(
        'Dropbox Authorisation',
        'A browser tab has opened.\n\n'
        '1. Click "Allow" on the Dropbox page.\n'
        '2. Copy the code shown.\n'
        '3. Paste it here and click OK.',
        parent=root,
    )
    if not code:
        raise RuntimeError('Dropbox authorisation cancelled.')

    result = auth_flow.finish(code.strip())
    tokens['dropbox'] = {'refresh_token': result.refresh_token}
    _save_tokens(tokens)
    return dropbox.Dropbox(
        oauth2_refresh_token=result.refresh_token,
        app_key=DROPBOX_APP_KEY,
    )


def upload_dropbox(svg_bytes, filename, parent_widget=None):
    """Upload svg_bytes to /PandaInk/<filename> in the user's Dropbox App Folder."""
    import dropbox as dbx_module

    client = _dropbox_client(parent_widget)
    dest = f'/PandaInk/{filename}'
    client.files_upload(
        svg_bytes, dest,
        mode=dbx_module.files.WriteMode.add,
        autorename=True,
    )
    logger.info(f'Dropbox: uploaded to {dest}')


# ─────────────────────────────────────────────────────────────────────────────
# OneDrive (Microsoft Graph via MSAL)
# ─────────────────────────────────────────────────────────────────────────────

ONEDRIVE_SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access']


def _onedrive_access_token():
    if not ONEDRIVE_CLIENT_ID:
        raise RuntimeError(
            'OneDrive is not configured.\n\n'
            'Register a public-client app at https://portal.azure.com → '
            'App registrations and set ONEDRIVE_CLIENT_ID in cloud_export.py.'
        )

    import msal

    tokens = _load_tokens()
    od = tokens.get('onedrive', {})

    app = msal.PublicClientApplication(
        ONEDRIVE_CLIENT_ID,
        authority='https://login.microsoftonline.com/common',
    )

    if od.get('refresh_token'):
        result = app.acquire_token_by_refresh_token(
            od['refresh_token'], scopes=ONEDRIVE_SCOPES
        )
        if 'access_token' in result:
            od['access_token'] = result['access_token']
            if 'refresh_token' in result:
                od['refresh_token'] = result['refresh_token']
            tokens['onedrive'] = od
            _save_tokens(tokens)
            return od['access_token']

    # Full interactive auth — opens the browser, handles the redirect locally.
    result = app.acquire_token_interactive(scopes=ONEDRIVE_SCOPES, port=8766)
    if 'error' in result:
        raise RuntimeError(
            f'OneDrive auth failed: {result.get("error_description", result["error"])}'
        )

    tokens['onedrive'] = {
        'access_token': result['access_token'],
        'refresh_token': result.get('refresh_token', ''),
    }
    _save_tokens(tokens)
    return result['access_token']


def upload_onedrive(svg_bytes, filename):
    """Upload svg_bytes to the OneDrive App Folder as filename."""
    import urllib.request
    import urllib.error

    access_token = _onedrive_access_token()
    url = (
        f'https://graph.microsoft.com/v1.0/me/drive/special/approot:/{filename}:/content'
    )
    req = urllib.request.Request(url, data=svg_bytes, method='PUT')
    req.add_header('Authorization', f'Bearer {access_token}')
    req.add_header('Content-Type', 'image/svg+xml')
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            logger.info(f'OneDrive: uploaded {result.get("name")}')
            return result
    except urllib.error.HTTPError as e:
        if e.code == 401:
            tokens = _load_tokens()
            tokens.pop('onedrive', None)
            _save_tokens(tokens)
            raise RuntimeError('OneDrive token expired. Export again to re-authenticate.')
        raise
