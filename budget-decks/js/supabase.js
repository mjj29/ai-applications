/**
 * supabase.js — Supabase client, auth helpers and data access.
 */
'use strict';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    // The default Web Locks implementation can deadlock in non-React ESM apps.
    lock: (_name, _acquireTimeout, fn) => fn(),
  },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** OAuth redirect back to this page — localhost in dev, GitHub Pages in prod (both allowlisted). */
export async function signIn(provider) {
  const redirectTo = window.location.href.split(/[#?]/)[0];
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const check = ({ data, error }) => { if (error) throw error; return data; };

export async function loadSettings() {
  return check(await supabase.from('mtg_settings').select('*').eq('id', 1).single());
}

export async function saveSettings(s) {
  return check(await supabase.from('mtg_settings').update(s).eq('id', 1).select().single());
}

export async function loadSubmissions() {
  return check(await supabase.from('mtg_submissions').select('*').order('valid_until', { ascending: false }));
}

export async function setPublic(id, makePublic) {
  return check(await supabase.rpc('mtg_set_public', { submission_id: id, make_public: makePublic }));
}

export async function publishAll() {
  return check(await supabase.rpc('mtg_publish_all'));
}

export async function deleteSubmission(id) {
  check(await supabase.from('mtg_submissions').delete().eq('id', id));
}

export async function isAdmin(userId) {
  if (!userId) return false;
  const rows = check(await supabase.from('mtg_admins').select('user_id').eq('user_id', userId));
  return rows.length > 0;
}

export async function listAdmins() {
  return check(await supabase.rpc('mtg_admin_list'));
}

export async function addAdmin(email) {
  return check(await supabase.rpc('mtg_add_admin', { admin_email: email }));
}

export async function removeAdmin(userId) {
  check(await supabase.from('mtg_admins').delete().eq('user_id', userId));
}

/**
 * Call the mtg-submit edge function. Returns its JSON body for both success
 * and rejection; throws only when there's an error message and no status.
 */
export async function submitDeck(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mtg-submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({ error: `Server returned ${r.status}` }));
  if (!body.status) throw new Error(body.error || `Server returned ${r.status}`);
  return body;
}
