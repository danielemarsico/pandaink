// Supabase JS client singleton.
//
// Fill in SUPABASE_URL and SUPABASE_ANON_KEY from your project's
// Settings → API page at supabase.com after creating the project.
//
// These values are safe to commit — the anon key is a public JWT that
// only grants access subject to Row Level Security policies.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        // Store session in localStorage so it survives page reloads.
        persistSession: true,
        // Automatically refresh the access token before it expires.
        autoRefreshToken: true,
        // Read the initial session from the URL hash after OAuth redirects.
        detectSessionInUrl: true,
    },
});
