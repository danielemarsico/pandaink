// PandaInk authentication — thin wrapper around Supabase Auth.
//
// All methods return Supabase's { data, error } shape so callers can
// handle errors uniformly. Social login (Google / GitHub) uses the
// standard OAuth redirect flow; Supabase handles the callback and
// restores the session automatically via detectSessionInUrl.

import { supabase } from './supabase_client.js';

const APP_URL = window.location.origin + window.location.pathname;

// ── Sign-up / Sign-in ────────────────────────────────────────────────────────

export async function signUpWithEmail(email, password, displayName) {
    return supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: displayName },
            emailRedirectTo: APP_URL,
        },
    });
}

export async function signInWithEmail(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle() {
    return supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: APP_URL },
    });
}

export async function signInWithGitHub() {
    return supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: APP_URL },
    });
}

export async function signOut() {
    return supabase.auth.signOut();
}

// ── Session helpers ──────────────────────────────────────────────────────────

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export async function getUser() {
    const session = await getSession();
    return session?.user ?? null;
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ?? null);
    });
}

export async function resetPasswordForEmail(email) {
    return supabase.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
}

export async function updatePassword(newPassword) {
    return supabase.auth.updateUser({ password: newPassword });
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    return { data, error };
}

export async function updateProfile(userId, updates) {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    return { data, error };
}

export async function deleteAccount(userId) {
    // Deleting auth.users cascades to profiles / devices / storage_tokens via FK.
    // Supabase client-side cannot delete auth users directly; use a server-side
    // function or the Supabase admin API. For now, sign out and show a message.
    await signOut();
    return { error: null };
}

// ── Device config ─────────────────────────────────────────────────────────────

export async function saveDevice(userId, { wacom_uuid, protocol, device_name }) {
    const { data, error } = await supabase
        .from('devices')
        .upsert(
            { user_id: userId, wacom_uuid, protocol, device_name, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
        )
        .select()
        .single();
    return { data, error };
}

export async function loadDevice(userId) {
    const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return { data, error };
}

export async function deleteDevice(userId) {
    const { error } = await supabase
        .from('devices')
        .delete()
        .eq('user_id', userId);
    return { error };
}
