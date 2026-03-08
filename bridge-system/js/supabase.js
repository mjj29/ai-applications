/**
 * supabase.js — thin wrapper around the Supabase JS client.
 * Loaded via ESM import map (see index.html). No bundler required.
 */
'use strict';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist session in localStorage automatically
    persistSession: true,
    // After GitHub OAuth redirect, Supabase reads the fragment and restores the session
    detectSessionInUrl: true,
  },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Kick off GitHub OAuth — browser is redirected to GitHub then back to SITE_URL */
export async function signInWithGitHub() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: SITE_URL },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Returns the current session object, or null if not logged in. */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/** Returns the current user object, or null. */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Subscribe to auth state changes.
 * callback(event, session) — event is 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' etc.
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}
