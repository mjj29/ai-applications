/**
 * app.js — top-level wiring: navigation, system management, context bar.
 */
'use strict';

import { listSystems, createSystem, getActiveSystem, setActiveId,
         deleteSystem, exportSystem, importSystemFromJSON } from './store.js';
import { renderEditor, initAddBidModal, initAddVariantModal, initCopyToModal } from './editor.js';
import { renderPosition } from './position.js';
import { renderLookup }   from './lookup.js';
import { renderPrint }    from './print.js';
import { renderChat }    from './chat.js';
import { flash } from './ui.js';

// ─── Navigation ───────────────────────────────────────────────────────────────

const VIEWS = ['view-editor', 'view-systems'];

const SUBTABS = ['subtab-edit', 'subtab-position', 'subtab-lookup', 'subtab-print', 'subtab-chat'];

function setSubtab(id) {
  SUBTABS.forEach(t => document.getElementById(t).classList.toggle('active', t === id));
  document.querySelectorAll('.editor-subtab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subtab === id));
  renderSubtab(id);
}

function renderSubtab(id) {
  if (id === 'subtab-edit')     renderEditor(document.getElementById('subtab-edit'));
  if (id === 'subtab-position') renderPosition(document.getElementById('subtab-position'));
  if (id === 'subtab-lookup')   renderLookup(document.getElementById('subtab-lookup'));
  if (id === 'subtab-print')    renderPrint(document.getElementById('subtab-print'));
  if (id === 'subtab-chat')     renderChat(document.getElementById('subtab-chat'));
}

function activeSubtab() {
  return document.querySelector('.editor-subtab.active')?.id ?? 'subtab-edit';
}

function setView(id) {
  VIEWS.forEach(v => {
    document.getElementById(v).classList.toggle('active', v === id);
  });
  document.querySelectorAll('#nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === id);
  });
  refreshCurrentView(id);
}

function refreshCurrentView(id) {
  const sys = getActiveSystem();
  document.getElementById('system-name-display').textContent = sys?.name ?? '(no system)';

  if (id === 'view-editor')  renderSubtab(activeSubtab());
  if (id === 'view-systems') renderSystemsList();
}

// ─── Systems list ─────────────────────────────────────────────────────────────

function renderSystemsList() {
  const container = document.getElementById('systems-list');
  const systems   = listSystems();

  if (!systems.length) {
    container.innerHTML = `<div class="empty-state"><div class="big">📋</div>No systems yet. Create one below.</div>`;
    return;
  }

  const active = getActiveSystem();
  container.innerHTML = systems.map(s => `
    <div class="system-item ${active?.id === s.id ? 'system-item-active' : ''}" data-id="${s.id}">
      <div style="display:flex;align-items:center;gap:0.75rem">
        <div style="flex:1">
          <div style="font-weight:500">${s.name}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${s.metadata.modified?.slice(0,10) ?? ''} · ${countNodes(s)} nodes</div>
        </div>
        <button class="btn btn-sm" data-action="open"   data-id="${s.id}">Open</button>
        <button class="btn btn-sm" data-action="export" data-id="${s.id}">Export</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">Delete</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      const sys    = listSystems().find(s => s.id === id);
      if (action === 'open') {
        setActiveId(id);
        setView('view-editor');
      } else if (action === 'export' && sys) {
        exportSystem(sys);
      } else if (action === 'delete') {
        if (confirm(`Delete "${sys?.name}"? This cannot be undone.`)) {
          deleteSystem(id);
          renderSystemsList();
          flash('Deleted', 'ok');
        }
      }
    });
  });
}

function countNodes(sys) {
  let n = 0;
  function walk(nodes) { for (const node of nodes) { n++; if (node.continuations?.nodes) walk(node.continuations.nodes); } }
  walk(sys.openings);
  return n;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nav buttons
  document.querySelectorAll('#nav button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Sub-tab buttons
  document.querySelectorAll('.editor-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
  });

  // New system
  document.getElementById('btn-new-system').addEventListener('click', () => {
    const name = prompt('System name:')?.trim();
    if (!name) return;
    const sys = createSystem(name);
    setActiveId(sys.id);
    flash(`Created "${name}"`, 'ok');
    setView('view-editor');
  });

  // Import
  document.getElementById('btn-import-system').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.json,.bridge.json';
    input.addEventListener('change', async () => {
      try {
        const text = await input.files[0].text();
        const sys  = importSystemFromJSON(text);
        setActiveId(sys.id);
        flash(`Imported "${sys.name}"`, 'ok');
        setView('view-editor');
      } catch (e) {
        flash(`Import failed: ${e.message}`, 'err');
      }
    });
    input.click();
  });

  // Modals
  initAddBidModal();
  initAddVariantModal();
  initCopyToModal();

  // Start on systems page if nothing active, else editor
  const active = getActiveSystem();
  setView(active ? 'view-editor' : 'view-systems');
});
