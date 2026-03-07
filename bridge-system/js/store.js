/**
 * localStorage-backed store for bridge systems and conventions.
 */

'use strict';

import { makeSystem } from './model.js';

const SYSTEMS_KEY     = 'bridge:systems';
const ACTIVE_KEY      = 'bridge:active';
const CONVENTIONS_KEY = 'bridge:conventions'; // library of importable conventions

// ─── Systems ─────────────────────────────────────────────────────────────────

export function listSystems() {
  try {
    return JSON.parse(localStorage.getItem(SYSTEMS_KEY) || '[]');
  } catch { return []; }
}

export function loadSystem(id) {
  const all = listSystems();
  return all.find(s => s.id === id) ?? null;
}

export function saveSystem(system) {
  system.metadata.modified = new Date().toISOString();
  const all = listSystems().filter(s => s.id !== system.id);
  all.push(system);
  localStorage.setItem(SYSTEMS_KEY, JSON.stringify(all));
}

export function deleteSystem(id) {
  const all = listSystems().filter(s => s.id !== id);
  localStorage.setItem(SYSTEMS_KEY, JSON.stringify(all));
  if (getActiveId() === id) setActiveId(null);
}

export function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) ?? null;
}

export function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else    localStorage.removeItem(ACTIVE_KEY);
}

export function getActiveSystem() {
  const id = getActiveId();
  return id ? loadSystem(id) : null;
}

export function createSystem(name) {
  const id = crypto.randomUUID();
  const sys = makeSystem(id, name);
  saveSystem(sys);
  return sys;
}

// ─── Convention library ───────────────────────────────────────────────────────

export function listLibraryConventions() {
  try {
    return JSON.parse(localStorage.getItem(CONVENTIONS_KEY) || '[]');
  } catch { return []; }
}

export function saveLibraryConvention(conv) {
  const all = listLibraryConventions().filter(c => c.id !== conv.id);
  all.push(conv);
  localStorage.setItem(CONVENTIONS_KEY, JSON.stringify(all));
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export function exportSystem(system) {
  const json = JSON.stringify(system, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${system.name.replace(/\s+/g, '_')}.bridge.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importSystemFromJSON(json) {
  const sys = JSON.parse(json);
  if (!sys.id || !sys.name || !sys.metadata) throw new Error('Invalid system file');
  // Give it a new ID to avoid collisions unless user explicitly merges
  sys.id = crypto.randomUUID();
  sys.metadata.modified = new Date().toISOString();
  saveSystem(sys);
  return sys;
}
