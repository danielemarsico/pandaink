// Google Drive OAuth flow (authorization code + PKCE) + token persistence in Supabase.
//
// Setup required in Google Cloud Console:
//   1. Enable the Google Drive API.
//   2. Create an OAuth 2.0 Web application client.
//   3. Add authorized JS origin:  https://danielemarsico.github.io
//   4. Add authorized redirect URI: https://danielemarsico.github.io/pandaink/app.html
//   5. Paste the client_id and client_secret below.
//
// Note: Google requires client_secret on the token/refresh requests for Web
// application clients even when PKCE is used — PKCE is an addition here, not
// a replacement for the secret. This secret ships in the public JS bundle
// (same tradeoff as the Supabase anon key); PKCE still binds it to a specific
// consent + single-use code, which is the standard accepted tradeoff for a
// static site with no backend to hold a true confidential secret.

import { supabase } from './supabase_client.js';

export const GDRIVE_CLIENT_ID     = '';
export const GDRIVE_CLIENT_SECRET = '';

const GDRIVE_SCOPE        = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_ENDPOINT      = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT       = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI        = window.location.origin + window.location.pathname;
const PROVIDER            = 'google_drive';
const VERIFIER_KEY        = 'pandaink_gdrive_verifier';
const GDRIVE_STATE_KEY    = 'pandaink_gdrive_state';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(96));
    return base64url(bytes);
}

async function generateCodeChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const digest  = await crypto.subtle.digest('SHA-256', encoded);
    return base64url(digest);
}

// ── OAuth redirect ────────────────────────────────────────────────────────────

export async function startGDriveAuth() {
    const verifier   = generateCodeVerifier();
    const challenge  = await generateCodeChallenge(verifier);
    const state      = base64url(crypto.getRandomValues(new Uint8Array(16)));

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(GDRIVE_STATE_KEY, state);

    const params = new URLSearchParams({
        client_id:             GDRIVE_CLIENT_ID,
        redirect_uri:          REDIRECT_URI,
        response_type:         'code',
        scope:                 GDRIVE_SCOPE,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        access_type:           'offline',
        prompt:                'consent',
        state,
    });

    window.location.href = AUTH_ENDPOINT + '?' + params.toString();
}

// ── Callback handler ──────────────────────────────────────────────────────────

// Call this on page load when ?code= is present in the URL.
// Returns true if a Drive code was handled, false otherwise.
export async function handleGDriveCallback() {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const state    = params.get('state');
    const storedState = sessionStorage.getItem(GDRIVE_STATE_KEY);

    if (!code || !storedState || state !== storedState) return false;

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier) throw new Error('PKCE verifier missing from sessionStorage');

    // Exchange code for tokens
    const body = new URLSearchParams({
        client_id:     GDRIVE_CLIENT_ID,
        client_secret: GDRIVE_CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
        code,
        code_verifier: verifier,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive token exchange failed: ${text}`);
    }

    const tokens = await res.json();
    await _saveTokens(tokens);

    // Clean up URL and session
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(GDRIVE_STATE_KEY);
    const clean = window.location.origin + window.location.pathname;
    history.replaceState(null, '', clean);

    return true;
}

// ── Token management ──────────────────────────────────────────────────────────

async function _saveTokens(tokens) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in to PandaInk');

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const record = {
        user_id:       user.id,
        provider:      PROVIDER,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at:    expiresAt,
    };

    const { error } = await supabase
        .from('storage_tokens')
        .upsert(record, { onConflict: 'user_id,provider' });

    if (error) throw new Error('Failed to save Drive tokens: ' + error.message);
}

export async function getValidAccessToken() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in to PandaInk');

    const { data, error } = await supabase
        .from('storage_tokens')
        .select('*')
        .eq('user_id', user.id)
        .eq('provider', PROVIDER)
        .single();

    if (error || !data) throw new Error('Google Drive not connected. Go to Profile → Cloud Storage.');

    // Refresh if expiring within 60 seconds
    if (new Date(data.expires_at).getTime() - Date.now() < 60_000) {
        if (!data.refresh_token) throw new Error('Drive access expired. Please reconnect Google Drive.');

        const body = new URLSearchParams({
            client_id:     GDRIVE_CLIENT_ID,
            client_secret: GDRIVE_CLIENT_SECRET,
            grant_type:    'refresh_token',
            refresh_token: data.refresh_token,
        });

        const res = await fetch(TOKEN_ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    body.toString(),
        });

        if (!res.ok) throw new Error('Drive token refresh failed. Please reconnect Google Drive.');

        const refreshed = await res.json();
        await _saveTokens({ ...refreshed, refresh_token: data.refresh_token });
        return refreshed.access_token;
    }

    return data.access_token;
}

export async function isDriveConnected() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
        .from('storage_tokens')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('provider', PROVIDER)
        .maybeSingle();
    return !!data;
}

export async function disconnectDrive() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
        .from('storage_tokens')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', PROVIDER);
    await supabase
        .from('profiles')
        .update({ storage_provider: null })
        .eq('id', user.id);
}
