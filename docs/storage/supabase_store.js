// Supabase Storage implementation of the cloud drawing store (free tier).
//
// Layout: private bucket 'drawings', one object per drawing at
//   <user_id>/<timestamp>.json
// Access is scoped to the user's own folder by Storage RLS (migration 004).
// Free-tier cap: MAX_DRAWINGS per user, enforced here (client pre-check) and,
// authoritatively, by the BEFORE INSERT trigger from migration 005_storage_cap.sql
// (uploads go straight from the browser to Supabase Storage — the Worker is not in
// that path and cannot enforce anything).
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

// Serializes saveDrawing() calls within this tab. The cap check is a
// list-then-upload sequence, so two overlapping saves (a BLE sync uploading a
// freshly-synced drawing while "Sync now" retries pending uploads, say) could
// both read the same pre-cap count and both upload, landing MAX_DRAWINGS + 1
// objects. Queuing them means the second save always re-lists after the first
// upload has finished. Cross-tab / cross-device races stay possible — the DB
// trigger from migration 005 is what catches those.
let _saveChain = Promise.resolve();

function _serialize(fn) {
    const run = _saveChain.then(fn, fn);   // run regardless of the previous outcome
    _saveChain = run.catch(() => {});      // never let a rejection break the chain
    return run;
}

// A cap rejection raised by the 005 trigger comes back as a generic Storage
// error; recognise it so callers get the same CAP_REACHED contract as the
// client-side pre-check instead of a raw database message.
function _capError(message) {
    const err = new Error(
        `Free plan is limited to ${MAX_DRAWINGS} drawings. Delete an old drawing or upgrade to Pro (Google Drive / Dropbox).`
    );
    err.code = 'CAP_REACHED';
    err.cause = message;
    return err;
}

function _isServerCapRejection(message) {
    return /limited to \d+ drawings/i.test(message ?? '');
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
    return _serialize(() => _saveDrawing(drawing));
}

async function _saveDrawing(drawing) {
    const userId = await _userId();
    const path   = _path(userId, drawing.timestamp);

    // Cap check: only blocks NEW drawings, not overwrites of an existing one.
    const existing = await _list(userId);
    const already  = existing.some((o) => o.name === `${drawing.timestamp}.json`);
    if (!already && existing.length >= MAX_DRAWINGS) {
        throw _capError('client pre-check');
    }

    const body = new Blob([JSON.stringify(drawing)], { type: 'application/json' });
    const { error } = await supabase
        .storage.from(BUCKET)
        .upload(path, body, { upsert: true, contentType: 'application/json' });
    if (error) {
        if (_isServerCapRejection(error.message)) throw _capError(error.message);
        throw new Error('Supabase Storage upload failed: ' + error.message);
    }

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
