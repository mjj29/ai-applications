/**
 * library.js — Convention library: fetch predefined conventions from static JSON files.
 */
'use strict';

const LIBRARY_BASE = './library/';

/**
 * Fetch the library index — an array of { id, name, description, tags } entries.
 * @returns {Promise<Array>}
 */
export async function fetchLibraryIndex() {
  const r = await fetch(`${LIBRARY_BASE}index.json`);
  if (!r.ok) throw new Error(`Library index could not be loaded (HTTP ${r.status})`);
  return r.json();
}

/**
 * Fetch a single convention definition by its id.
 * Returns the full convention object with id, name, description, tags, nodes[].
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function fetchLibraryConvention(id) {
  const r = await fetch(`${LIBRARY_BASE}${id}.json`);
  if (!r.ok) throw new Error(`Convention "${id}" could not be loaded (HTTP ${r.status})`);
  return r.json();
}
