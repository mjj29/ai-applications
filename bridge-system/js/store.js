/**
 * store.js — System storage with localStorage (local/offline) and Supabase (cloud).
 *
 * Strategy:
 *  - Not logged in  → localStorage only, identical to the old behaviour.
 *  - Logged in      → write-through to Supabase; localStorage used as a fast read cache.
 *
 * Each system stored in Supabase has:
 *   id          uuid (PK)
 *   owner_id    uuid → auth.users
 *   name        text
 *   data        jsonb  (the full sys object)
 *   visibility  text   'private' | 'shared' | 'public'
 *   slug        text   unique, nullable — short public URL key
 *
 * Collaborators table:
 *   system_id   uuid
 *   user_id     uuid
 *   role        text  'editor' | 'viewer'
 */

'use strict';

import { makeSystem } from './model.js';
import { supabase, getUser } from './supabase.js';

const SYSTEMS_KEY     = 'bridge:systems';
const ACTIVE_KEY      = 'bridge:active';
const CONVENTIONS_KEY = 'bridge:conventions';

// ─── Local (localStorage) helpers — always available ─────────────────────────

function localList() {
  try { return JSON.parse(localStorage.getItem(SYSTEMS_KEY) || '[]'); } catch { return []; }
}
function localSave(sys) {
  const all = localList().filter(s => s.id !== sys.id);
  all.push(sys);
  localStorage.setItem(SYSTEMS_KEY, JSON.stringify(all));
}
function localDelete(id) {
  localStorage.setItem(SYSTEMS_KEY, JSON.stringify(localList().filter(s => s.id !== id)));
}

// ─── Active system ID ─────────────────────────────────────────────────────────

export function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) ?? null;
}
export function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else    localStorage.removeItem(ACTIVE_KEY);
}
export function getActiveSystem() {
  const id = getActiveId();
  return id ? localList().find(s => s.id === id) ?? null : null;
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

/** Returns the current user, or null if not logged in. */
export async function currentUser() {
  return getUser();
}

/** Helper: comma-separated system IDs where user is a collaborator. */
async function collaboratorSystemIds(userId) {
  const { data } = await supabase
    .from('collaborators')
    .select('system_id')
    .eq('user_id', userId);
  return (data ?? []).map(r => r.system_id).join(',') || 'null';
}

/**
 * Fetch all systems the logged-in user can see (owns + shared),
 * write them into the local cache, and return the merged list.
 */
export async function syncFromCloud() {
  const user = await getUser();
  if (!user) return localList();

  const collabIds = await collaboratorSystemIds(user.id);
  const orFilter = collabIds === 'null'
    ? `owner_id.eq.${user.id}`
    : `owner_id.eq.${user.id},id.in.(${collabIds})`;

  const { data: rows, error } = await supabase
    .from('systems')
    .select('id, name, data, visibility, slug, owner_id')
    .or(orFilter);

  if (error) { console.warn('Cloud sync error:', error.message); return localList(); }

  const cloudSystems = (rows ?? []).map(row => ({
    ...row.data,
    id:          row.id,
    name:        row.name,
    _cloud:      true,
    _ownerId:    row.owner_id,
    _isOwner:    row.owner_id === user.id,
    _visibility: row.visibility,
    _slug:       row.slug,
  }));

  // Keep local-only (never synced) records alongside cloud records
  const localOnly = localList().filter(s => !s._cloud);
  const merged = [...localOnly, ...cloudSystems];
  localStorage.setItem(SYSTEMS_KEY, JSON.stringify(merged));
  return merged;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listSystems() {
  return localList();
}

export function loadSystem(id) {
  return localList().find(s => s.id === id) ?? null;
}

export async function saveSystem(system) {
  system.metadata.modified = new Date().toISOString();
  localSave(system);

  const user = await getUser();
  if (!user) return system;

  if (system._cloud) {
    const { error } = await supabase
      .from('systems')
      .update({ name: system.name, data: system, updated_at: system.metadata.modified })
      .eq('id', system.id);
    if (error) console.warn('Cloud save error:', error.message);
  } else {
    const { error } = await supabase
      .from('systems')
      .insert({ id: system.id, owner_id: user.id, name: system.name,
                data: system, visibility: 'private' });
    if (error) {
      console.warn('Cloud insert error:', error.message);
    } else {
      system._cloud      = true;
      system._ownerId    = user.id;
      system._isOwner    = true;
      system._visibility = 'private';
      localSave(system);
    }
  }
  return system;
}

export async function deleteSystem(id) {
  const sys = loadSystem(id);
  localDelete(id);
  if (getActiveId() === id) setActiveId(null);

  const user = await getUser();
  if (!user || !sys?._cloud) return;

  const { error } = await supabase.from('systems').delete().eq('id', id);
  if (error) console.warn('Cloud delete error:', error.message);
}

export async function createSystem(name) {
  const id  = crypto.randomUUID();
  const sys = makeSystem(id, name);
  return saveSystem(sys);
}

// ─── Collaboration ────────────────────────────────────────────────────────────

/** Look up a user by email via a DB RPC (see setup SQL). */
export async function findUserByEmail(email) {
  const { data, error } = await supabase
    .rpc('find_user_by_email', { search_email: email.toLowerCase() });
  if (error || !data?.length) return null;
  return data[0];
}

export async function listCollaborators(systemId) {
  const { data, error } = await supabase
    .from('collaborators')
    .select('user_id, role, profiles(display_name, avatar_url, email)')
    .eq('system_id', systemId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addCollaborator(systemId, userId, role = 'editor') {
  const { error } = await supabase
    .from('collaborators')
    .upsert({ system_id: systemId, user_id: userId, role });
  if (error) throw new Error(error.message);
}

export async function removeCollaborator(systemId, userId) {
  const { error } = await supabase
    .from('collaborators')
    .delete()
    .eq('system_id', systemId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// ─── Publishing ───────────────────────────────────────────────────────────────

/** Make a system publicly readable. Returns the updated system. */
export async function publishSystem(systemId) {
  const sys = loadSystem(systemId);
  if (!sys?._cloud) throw new Error('Save to cloud first before publishing');

  const slug = sys._slug ?? systemId.slice(0, 8);
  const { error } = await supabase
    .from('systems')
    .update({ visibility: 'public', slug })
    .eq('id', systemId);
  if (error) throw new Error(error.message);

  sys._visibility = 'public';
  sys._slug = slug;
  localSave(sys);
  return sys;
}

export async function unpublishSystem(systemId) {
  const { error } = await supabase
    .from('systems')
    .update({ visibility: 'private', slug: null })
    .eq('id', systemId);
  if (error) throw new Error(error.message);

  const sys = loadSystem(systemId);
  if (sys) { sys._visibility = 'private'; sys._slug = null; localSave(sys); }
}

/** Load a public system by its slug — no auth required. */
export async function loadPublicSystem(slug) {
  const { data, error } = await supabase
    .from('systems')
    .select('id, name, data, owner_id')
    .eq('slug', slug)
    .eq('visibility', 'public')
    .single();
  if (error) throw new Error('System not found or not public');
  return { ...data.data, id: data.id, name: data.name, _ownerId: data.owner_id };
}

/** Clone a public system into the logged-in user's account. */
export async function cloneSystem(sourceSystemOrSlug) {
  const user = await getUser();
  if (!user) throw new Error('Must be logged in to clone');

  const source = typeof sourceSystemOrSlug === 'string'
    ? await loadPublicSystem(sourceSystemOrSlug)
    : sourceSystemOrSlug;

  const cloned = {
    ...source,
    id:       crypto.randomUUID(),
    name:     `${source.name} (copy)`,
    metadata: { ...source.metadata, modified: new Date().toISOString() },
  };
  delete cloned._cloud; delete cloned._ownerId; delete cloned._isOwner;
  delete cloned._visibility; delete cloned._slug;

  return saveSystem(cloned);
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export function exportSystem(system) {
  const exportable = { ...system };
  delete exportable._cloud; delete exportable._ownerId; delete exportable._isOwner;
  delete exportable._visibility; delete exportable._slug;

  const json = JSON.stringify(exportable, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${system.name.replace(/\s+/g, '_')}.bridge.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSystemFromJSON(json) {
  const sys = JSON.parse(json);
  if (!sys.id || !sys.name || !sys.metadata) throw new Error('Invalid system file');
  sys.id = crypto.randomUUID();
  sys.metadata.modified = new Date().toISOString();
  delete sys._cloud; delete sys._ownerId; delete sys._isOwner;
  delete sys._visibility; delete sys._slug;
  return saveSystem(sys);
}

// ─── Convention library (localStorage only) ───────────────────────────────────

export function listLibraryConventions() {
  try { return JSON.parse(localStorage.getItem(CONVENTIONS_KEY) || '[]'); } catch { return []; }
}
export function saveLibraryConvention(conv) {
  const all = listLibraryConventions().filter(c => c.id !== conv.id);
  all.push(conv);
  localStorage.setItem(CONVENTIONS_KEY, JSON.stringify(all));
}
