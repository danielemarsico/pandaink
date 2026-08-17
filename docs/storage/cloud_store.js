// Cloud storage abstraction — one active provider at a time, tier-gated.
//
// The active provider comes from profiles.storage_provider; paid providers
// (Google Drive, Dropbox) require profiles.plan === 'pro'. Every provider module
// implements the same interface (saveDrawing / fetchDrawings / deleteDrawing
// / isConnected), so app_controller.js talks only to this abstraction.

import { getProfile, updateProfile } from '../auth/auth_manager.js';
import * as driveStore    from './gdrive_store.js';
import * as dropboxStore  from './dropbox_store.js';
import * as supabaseStore from './supabase_store.js';
import { isDriveConnected }   from '../auth/storage_oauth.js';
import { isDropboxConnected } from '../auth/dropbox_oauth.js';

export const PROVIDERS = {
    supabase:     { id: 'supabase',     name: 'Supabase Storage', paid: false, module: supabaseStore, isConnected: supabaseStore.isConnected, needsOAuth: false },
    google_drive: { id: 'google_drive', name: 'Google Drive',     paid: true,  module: driveStore,    isConnected: isDriveConnected,          needsOAuth: true  },
    dropbox:      { id: 'dropbox',      name: 'Dropbox',          paid: true,  module: dropboxStore,  isConnected: isDropboxConnected,        needsOAuth: true  },
};

let _profile = null;   // { plan, storage_provider, ... }

export async function loadProfile(userId, force = false) {
    if (_profile && !force) return _profile;
    const { data } = await getProfile(userId);
    _profile = data ?? { plan: 'free', storage_provider: null };
    return _profile;
}

export function clearProfileCache() { _profile = null; }

export async function isPro(userId) {
    return (await loadProfile(userId)).plan === 'pro';
}

// The active provider entry, or null if none chosen / a paid one is chosen while
// on the free plan (gated).
export async function getActiveProvider(userId) {
    const p  = await loadProfile(userId);
    const id = p.storage_provider;
    if (!id || !PROVIDERS[id]) return null;
    const prov = PROVIDERS[id];
    if (prov.paid && p.plan !== 'pro') return null;
    return prov;
}

export async function setProvider(userId, id) {
    const p = await loadProfile(userId);
    if (id && PROVIDERS[id]?.paid && p.plan !== 'pro') {
        throw new Error('Google Drive and Dropbox require Pro. Upgrade to unlock them.');
    }
    const { error } = await updateProfile(userId, { storage_provider: id });
    if (error) throw new Error(error.message);
    _profile = { ...p, storage_provider: id };
}

export async function activeProviderName(userId) {
    const prov = await getActiveProvider(userId);
    return prov ? prov.name : null;
}

// Id of the active provider ('supabase' / 'google_drive' / 'dropbox'), or null.
// Stored on each local record as `cloudProvider` so reconciliation can tell a
// drawing deleted remotely from one that simply lives in a provider the user
// has since switched away from.
export async function activeProviderId(userId) {
    const prov = await getActiveProvider(userId);
    return prov ? prov.id : null;
}

// Whether the active provider is currently usable (chosen, unlocked, connected).
export async function isCloudConnected(userId) {
    const prov = await getActiveProvider(userId);
    if (!prov) return false;
    try { return await prov.isConnected(); } catch { return false; }
}

// ── Delegated CRUD (no-ops when no provider is active) ─────────────────────────

export async function saveDrawing(userId, drawing) {
    const prov = await getActiveProvider(userId);
    if (!prov) throw new Error('No cloud provider connected');
    return prov.module.saveDrawing(drawing);
}

// Returns { drawings, incomplete } — see the provider modules. `incomplete` is
// true when part of the cloud listing could not be read, in which case the
// caller must treat the result as a partial view.
export async function fetchDrawings(userId, deviceId) {
    const prov = await getActiveProvider(userId);
    if (!prov) return { drawings: [], incomplete: true };
    return prov.module.fetchDrawings(deviceId);
}

export async function deleteDrawing(userId, fileId) {
    const prov = await getActiveProvider(userId);
    if (!prov) return;
    return prov.module.deleteDrawing(fileId);
}
