/**
 * supabase.js — thin wrapper around the Supabase JS client.
 * Loaded via ESM import map (see index.html). No bundler required.
 */
'use strict';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    // The default Web Locks implementation can deadlock in non-React ESM apps.
    // This no-op lock is safe for a single-user SPA (no competing tabs issue).
    lock: (_name, _acquireTimeout, fn) => fn(),
  },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Kick off GitHub OAuth — browser is redirected to GitHub then back to the current page. */
export async function signInWithGitHub() {
  // Use the current page URL (without hash/query) so the OAuth callback lands on
  // whichever origin the user is on — localhost in dev, GitHub Pages in prod.
  // Both must be in the Supabase redirect URL allowlist (see SETUP.md).
  const redirectTo = window.location.href.split(/[#?]/)[0];
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo },
  });
  if (error) throw error;
}

/** Kick off Google OAuth — same redirect pattern as GitHub. */
export async function signInWithGoogle() {
  const redirectTo = window.location.href.split(/[#?]/)[0];
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
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
