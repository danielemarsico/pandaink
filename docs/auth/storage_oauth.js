// Google Drive OAuth flow (authorization code + PKCE) + token persistence in Supabase.
//
// This app requires the Cloudflare Worker backend (see worker/README.md).
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET live only as Worker secrets
// (`wrangler secret put ...`) — neither ever ships in this public JS bundle.
// The Worker builds the Google authorize URL server-side (`/oauth/google/authorize`)
// and does the token exchange/refresh (`/oauth/google/token`, `/oauth/google/refresh`).
//
// Setup required in Google Cloud Console:
//   1. Enable the Google Drive API.
//   2. Create an OAuth 2.0 Web application client.
//   3. Add authorized redirect URI: https://danielemarsico.github.io/pandaink/app.html
//   4. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI as Worker secrets.

import { supabase } from './supabase_client.js';
import { WORKER_BASE_URL, hasWorker } from '../config.js';

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
    if (!hasWorker()) throw new Error('Google Drive requires the Worker backend (WORKER_BASE_URL not configured).');

    const verifier   = generateCodeVerifier();
    const challenge  = await generateCodeChallenge(verifier);
    const state      = base64url(crypto.getRandomValues(new Uint8Array(16)));

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(GDRIVE_STATE_KEY, state);

    const params = new URLSearchParams({
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        redirect_uri:          REDIRECT_URI,
        state,
    });

    window.location.href = `${WORKER_BASE_URL}/oauth/google/authorize?${params.toString()}`;
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

    if (!hasWorker()) throw new Error('Google Drive requires the Worker backend (WORKER_BASE_URL not configured).');

    // The Worker holds the client_secret and does the exchange server-side.
    const res = await fetch(`${WORKER_BASE_URL}/oauth/google/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
    });
    if (!res.ok) throw new Error(`Drive token exchange failed: ${await res.text()}`);
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
        if (!hasWorker()) throw new Error('Google Drive requires the Worker backend (WORKER_BASE_URL not configured).');

        const res = await fetch(`${WORKER_BASE_URL}/oauth/google/refresh`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ refresh_token: data.refresh_token }),
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
