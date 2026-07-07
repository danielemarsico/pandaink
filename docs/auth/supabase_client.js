// Supabase JS client singleton.
//
// Fill in SUPABASE_URL and SUPABASE_ANON_KEY from your project's
// Settings → API page at supabase.com after creating the project.
//
// These values are safe to commit — the anon key is a public JWT that
// only grants access subject to Row Level Security policies.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://qqsbcovjvhmpypzglbyq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxc2Jjb3ZqdmhtcHlwemdsYnlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MzY0NDMsImV4cCI6MjA5OTAxMjQ0M30.I7AaGbxXH0J3UiBulyw6hVRGnY4Jcg6H2QY_BKl-ySI';

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
