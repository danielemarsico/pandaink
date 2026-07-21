// Supabase Storage implementation of the cloud drawing store (free tier).
//
// Layout: private bucket 'drawings', one object per drawing at
//   <user_id>/<timestamp>.json
// Access is scoped to the user's own folder by Storage RLS (migration 004).
// Free-tier cap: MAX_DRAWINGS per user, enforced here (client pre-check) and,
// authoritatively, in the Cloudflare Worker.
//
// Same interface as gdrive_store.js:
//   saveDrawing(drawing) -> { ...drawing, driveFileId }   (driveFileId = object path)
//   getDrawingsByDevice(deviceId) -> [ { ...record, driveFileId } ]
//   deleteDrawing(path)
//   isConnected() -> boolean

import { supabase } from '../auth/supabase_client.js';

const BUCKET       = 'drawings';
export const MAX_DRAWINGS = 10;

async function _userId() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in to PandaInk');
    return user.id;
}

function _path(userId, timestamp) {
    return `${userId}/${timestamp}.json`;
}

async function _list(userId) {
    const { data, error } = await supabase
        .storage.from(BUCKET)
        .list(userId, { limit: 1000 });
    if (error) throw new Error('Supabase Storage list failed: ' + error.message);
    // Only real drawing objects (skip folder placeholders).
    return (data ?? []).filter((o) => o.name.endsWith('.json'));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Number of drawings the user currently has in Supabase Storage. */
export async function countDrawings() {
    const userId = await _userId();
    return (await _list(userId)).length;
}

export async function saveDrawing(drawing) {
    const userId = await _userId();
    const path   = _path(userId, drawing.timestamp);

    // Cap check: only blocks NEW drawings, not overwrites of an existing one.
    const existing = await _list(userId);
    const already  = existing.some((o) => o.name === `${drawing.timestamp}.json`);
    if (!already && existing.length >= MAX_DRAWINGS) {
        const err = new Error(
            `Free plan is limited to ${MAX_DRAWINGS} drawings. Delete an old drawing or upgrade to Pro (Google Drive / Dropbox).`
        );
        err.code = 'CAP_REACHED';
        throw err;
    }

    const body = new Blob([JSON.stringify(drawing)], { type: 'application/json' });
    const { error } = await supabase
        .storage.from(BUCKET)
        .upload(path, body, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error('Supabase Storage upload failed: ' + error.message);

    return { ...drawing, driveFileId: path };
}

export async function getDrawingsByDevice(deviceId) {
    const userId  = await _userId();
    const objects = await _list(userId);
    const out     = [];

    // Download in small parallel batches to stay friendly to the API.
    for (let i = 0; i < objects.length; i += 6) {
        const batch = objects.slice(i, i + 6);
        const results = await Promise.all(batch.map(async (o) => {
            const path = `${userId}/${o.name}`;
            const { data, error } = await supabase.storage.from(BUCKET).download(path);
            if (error || !data) return null;
            try {
                const rec = JSON.parse(await data.text());
                return { ...rec, driveFileId: path };
            } catch { return null; }
        }));
        out.push(...results.filter(Boolean));
    }

    return out
        .filter((d) => d.deviceId === deviceId)
        .sort((a, b) => a.timestamp - b.timestamp);
}

export async function deleteDrawing(path) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error('Supabase Storage delete failed: ' + error.message);
}

/** Supabase Storage is available whenever the user has an active session. */
export async function isConnected() {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
}
