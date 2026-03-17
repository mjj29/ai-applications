/**
 * Editor view — add/edit openings, responses, and continuations.
 */
'use strict';

import { callToHTML, callToString, parseCall, parseSequence, makeBidNode,
         makeMeaning, makeVariant, makeCondition, PASS,
         sortNodes, variantBadgeText } from './model.js';
import { getActiveSystem, saveSystem } from './store.js';
import { flash }  from './ui.js';
import { fetchLibraryIndex, fetchLibraryConvention } from './library.js';

// ─── State ───────────────────────────────────────────────────────────────────

let selectedPath  = [];   // array of node ids from root to current selection
let editingNode   = null; // id of node currently in the editor form
let _justDragged  = false; // suppresses the click that browsers fire after dragend
let expandedNodes = new Set(); // node IDs whose children are currently visible

// ─── Call/clone helpers ───────────────────────────────────────────────────────

const STRAIN_SEQ = ['C', 'D', 'H', 'S', 'N'];
const SUIT_SYMS  = { C: '♣', D: '♦', H: '♥', S: '♠', N: 'NT' };

function nextCall(call) {
  if (!call || call.type !== 'bid') return null;
  const idx = STRAIN_SEQ.indexOf(call.strain);
  if (idx < 4) return { type: 'bid', level: call.level, strain: STRAIN_SEQ[idx + 1] };
  if (call.level < 7) return { type: 'bid', level: call.level + 1, strain: 'C' };
  return null;
}

function deepCloneNode(node) {
  const cloned = {
    ...node,
    id:          crypto.randomUUID(),
    variants:    (node.variants    ?? []).map(v => ({ ...v })),
    competitive: (node.competitive ?? []).map(b => ({ ...b })),
  };
  if (node.continuations?.type === 'nodes') {
    cloned.continuations = { type: 'nodes', nodes: node.continuations.nodes.map(deepCloneNode) };
  }
  return cloned;
}

function findParentArray(sys, nodeId) {
  function search(nodes) {
    if (nodes.some(n => n.id === nodeId)) return nodes;
    for (const n of nodes) {
      if (n.continuations?.type === 'nodes') {
        const r = search(n.continuations.nodes);
        if (r) return r;
      }
    }
    return null;
  }
  return search(sys.openings)
      ?? search(sys.overcalls ?? [])
      ?? Object.values(sys.conventions ?? {}).reduce((acc, c) => acc ?? search(c.nodes ?? []), null);
}

/**
 * Shift all suit references in a text string by `delta` steps up the suit order.
 * Handles both symbols (♣ ♦ ♥ ♠ NT) and standalone letters (C D H S N).
 * Uses a single-pass regex so e.g. "C or D" becomes "D or H", not "D or D".
 */
function shiftSuitsInText(text, delta) {
  if (!text || !delta) return text;
  const SYM = ['♣', '♦', '♥', '♠', 'NT'];
  const LET = ['C', 'D', 'H', 'S', 'N'];
  // NT must be matched before N; symbols before letters
  return text.replace(/NT|♣|♦|♥|♠|\b(C|D|H|S|N)\b/g, m => {
    const si = SYM.indexOf(m);
    if (si >= 0) return SYM[(si + delta) % 5];
    const li = LET.indexOf(m);
    if (li >= 0) return LET[(li + delta) % 5];
    return m;
  });
}

function cloneNodeDown(node, sys) {
  const next = nextCall(node.call);
  if (!next) { flash('Already at 7NT — cannot clone further', 'err'); return; }
  const parentArr = findParentArray(sys, node.id);
  if (!parentArr) { flash('Cannot locate node in tree', 'err'); return; }

  const cloned = deepCloneNode(node);
  cloned.call = next;

  // Shift all suit references (symbols + letters) in all text fields
  const oldIdx = STRAIN_SEQ.indexOf(node.call.strain);
  const newIdx = STRAIN_SEQ.indexOf(next.strain);
  const delta  = (newIdx - oldIdx + 5) % 5;

  if (delta > 0) {
    const shiftMeaning = m => {
      if (!m) return m;
      return {
        ...m,
        ...(m.description && { description: shiftSuitsInText(m.description, delta) }),
        ...(m.shape       && { shape:       shiftSuitsInText(m.shape,       delta) }),
        ...(m.notes       && { notes:       shiftSuitsInText(m.notes,       delta) }),
      };
    };
    cloned.meaning = shiftMeaning(cloned.meaning);
    if (cloned.variants?.length) {
      cloned.variants = cloned.variants.map(v => ({
        ...v,
        meaningOverride: shiftMeaning(v.meaningOverride),
        ...(v.notes && { notes: shiftSuitsInText(v.notes, delta) }),
      }));
    }
  }

  const idx = parentArr.findIndex(n => n.id === node.id);
  parentArr.splice(idx + 1, 0, cloned);
  saveSystem(sys);
  refreshAllTrees();
  flash(`Cloned → ${callToString(cloned.call)}`, 'ok');
}

function refreshAllTrees() {
  renderTree();
  renderOvercallsTree();
  renderConventionsSection();
}

/**
 * Make a container element a root-level drop zone.
 * Dropping a node here copies it into rootArray (top-level bids).
 */
function addRootDropZone(containerEl, getRootArray, label) {
  containerEl.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    if (e.target.closest('.bid-node-header')) return; // node handles its own
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    containerEl.classList.add('drag-over-zone');
  });
  containerEl.addEventListener('dragleave', (e) => {
    if (!containerEl.contains(e.relatedTarget)) containerEl.classList.remove('drag-over-zone');
  });
  containerEl.addEventListener('drop', (e) => {
    if (e.target.closest('.bid-node-header')) return;
    e.preventDefault();
    containerEl.classList.remove('drag-over-zone');
    const fromId = e.dataTransfer.getData('text/plain');
    if (!fromId) return;
    const s = getActiveSystem();
    if (!s) return;
    const src = findNode(s, fromId);
    if (!src) return;
    getRootArray(s).push(deepCloneNode(src));
    saveSystem(s);
    refreshAllTrees();
    flash(`Copied ${callToString(src.call)} to ${label}`, 'ok');
  });
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function renderEditor(container) {
  const sys = getActiveSystem();
  if (!sys) {
    container.innerHTML = `<div class="empty-state"><div class="big">📋</div>No system open. Create or open a system first.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;gap:1rem;height:100%;overflow:hidden">
      <div id="editor-tree-col" style="flex:1;overflow-y:auto">

        <!-- Opening Bids -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
          <h2 style="font-size:1rem;margin:0">Opening Bids</h2>
          <button class="btn btn-sm btn-primary" id="btn-add-opening">+ Opening</button>
        </div>
        <div id="editor-tree" class="bid-tree"></div>

        <!-- Overcalls -->
        <div style="border-top:1px solid var(--border);margin-top:1.25rem;padding-top:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
            <h2 style="font-size:1rem;margin:0">Overcalls</h2>
            <button class="btn btn-sm btn-primary" id="btn-add-overcall">+ Overcall</button>
          </div>
          <div id="editor-overcalls-tree" class="bid-tree"></div>
        </div>

        <!-- Carding -->
        <div style="border-top:1px solid var(--border);margin-top:1.25rem;padding-top:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
            <h2 style="font-size:1rem;margin:0">Carding</h2>
          </div>
          <div id="editor-carding"></div>
        </div>

        <!-- Convention Library -->
        <div style="border-top:1px solid var(--border);margin-top:1.25rem;padding-top:1rem;padding-bottom:2rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
            <h2 style="font-size:1rem;margin:0">Convention Library</h2>
            <div style="display:flex;gap:0.4rem">
              <button class="btn btn-sm" id="btn-browse-library">📚 Library</button>
              <button class="btn btn-sm btn-primary" id="btn-add-convention">+ Convention</button>
            </div>
          </div>
          <div id="editor-conventions"></div>
        </div>

      </div>
      <div id="editor-form-col" style="width:360px;min-width:260px;border-left:1px solid var(--border);padding-left:1rem;overflow-y:auto">
        <div id="editor-form">
          <div class="empty-state" style="padding:2rem 0">
            <div class="big">←</div>Select a bid or rule to edit it.
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-add-opening').addEventListener('click',  () => showAddBidModal(null, 'openings'));
  document.getElementById('btn-add-overcall').addEventListener('click', () => showAddBidModal(null, 'overcalls'));
  document.getElementById('btn-browse-library').addEventListener('click', () => {
    showLibraryModal();
  });

  document.getElementById('btn-add-convention').addEventListener('click', () => {
    const name = prompt('Convention name:')?.trim();
    if (!name) return;
    const s = getActiveSystem();
    if (!s) return;
    if (!s.conventions) s.conventions = {};
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || crypto.randomUUID().slice(0, 8);
    if (s.conventions[id]) { flash(`Convention id "${id}" already exists — rename to avoid clash`, 'err'); return; }
    s.conventions[id] = { id, name, description: '', tags: [], nodes: [] };
    saveSystem(s);
    renderConventionsSection();
    flash(`Convention "${name}" created (id: ${id})`, 'ok');
  });
  renderTree();
  renderOvercallsTree();
  renderCardingSection();
  renderConventionsSection();
}

function renderTree() {
  const sys = getActiveSystem();
  if (!sys) return;
  const container = document.getElementById('editor-tree');
  if (!container) return;
  container.innerHTML = '';
  if (sys.openings.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:1rem 0">No openings yet.</div>`;
    return;
  }
  for (const node of sortNodes(sys.openings)) {
    container.appendChild(buildNodeElement(node, sys, []));
  }
  addRootDropZone(container, s => s.openings, 'Openings');
}

function renderOvercallsTree() {
  const sys = getActiveSystem();
  if (!sys) return;
  const container = document.getElementById('editor-overcalls-tree');
  if (!container) return;
  container.innerHTML = '';
  const overcalls = sys.overcalls ?? [];
  if (overcalls.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:1rem 0">No overcalls yet.</div>`;
    return;
  }
  for (const node of sortNodes(overcalls)) {
    container.appendChild(buildNodeElement(node, sys, []));
  }
  addRootDropZone(container, s => (s.overcalls ?? (s.overcalls = [])), 'Overcalls');
}

// ─── Carding section ─────────────────────────────────────────────────────────

function renderCardingSection() {
  const sys = getActiveSystem();
  if (!sys) return;
  const container = document.getElementById('editor-carding');
  if (!container) return;

  const carding = sys.carding ?? { signals: [], discards: [], leads: [] };
  container.innerHTML = [
    renderCardingCategory('Signals',  'signals',  carding.signals  ?? []),
    renderCardingCategory('Discards', 'discards', carding.discards ?? []),
    renderCardingCategory('Leads',    'leads',    carding.leads    ?? []),
  ].join('');

  container.querySelectorAll('[data-carding-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      showCardingForm(btn.dataset.cardingEdit, parseInt(btn.dataset.idx));
    });
  });
  container.querySelectorAll('[data-carding-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = getActiveSystem();
      (s.carding ?? {})[btn.dataset.cardingDelete]?.splice(parseInt(btn.dataset.idx), 1);
      saveSystem(s);
      renderCardingSection();
    });
  });
  container.querySelectorAll('[data-carding-add]').forEach(btn => {
    btn.addEventListener('click', () => showCardingForm(btn.dataset.cardingAdd, -1));
  });
}

function renderCardingCategory(label, key, rules) {
  const rows = rules.length === 0
    ? `<div style="color:var(--text-muted);font-size:0.82rem;padding:0.25rem 0">None yet.</div>`
    : rules.map((r, i) => `
      <div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <span style="color:var(--text-muted);font-size:0.76rem">${r.context || 'General'}</span>
          <div style="font-size:0.88rem">${r.method || '—'}</div>
          ${r.notes ? `<div style="font-size:0.76rem;color:var(--text-muted)">${r.notes}</div>` : ''}
        </div>
        <button class="btn btn-sm" data-carding-edit="${key}" data-idx="${i}">Edit</button>
        <button class="btn btn-sm btn-danger" data-carding-delete="${key}" data-idx="${i}">✕</button>
      </div>`).join('');

  return `
    <div style="margin-bottom:1.1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
        <span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">${label}</span>
        <button class="btn btn-sm" data-carding-add="${key}">+ Add</button>
      </div>
      ${rows}
    </div>`;
}

function showCardingForm(category, index) {
  const sys = getActiveSystem();
  if (!sys) return;
  if (!sys.carding) sys.carding = { signals: [], discards: [], leads: [] };
  const rule = index >= 0 ? (sys.carding[category] ?? [])[index] : null;
  const catLabel = { signals: 'Signal', discards: 'Discard', leads: 'Lead' }[category] || category;

  const formCol = document.getElementById('editor-form');
  if (!formCol) return;

  formCol.innerHTML = `
    <h3 style="margin-bottom:0.75rem;font-size:0.95rem">${index >= 0 ? 'Edit' : 'Add'} ${catLabel} Rule</h3>
    <div class="form-group">
      <label>Context</label>
      <input type="text" id="carding-context" value="${rule?.context ?? ''}" placeholder="vs NT, vs suits, partner's lead…">
    </div>
    <div class="form-group">
      <label>Method</label>
      <input type="text" id="carding-method" value="${rule?.method ?? ''}" placeholder="Standard, Upside-Down, Odd-Even, MUD…">
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="carding-notes" style="min-height:60px">${rule?.notes ?? ''}</textarea>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button class="btn btn-primary" id="btn-save-carding">Save</button>
      ${index >= 0 ? `<button class="btn btn-danger" id="btn-delete-carding">Delete</button>` : ''}
    </div>`;

  document.getElementById('btn-save-carding').addEventListener('click', () => {
    const s = getActiveSystem();
    if (!s.carding) s.carding = { signals: [], discards: [], leads: [] };
    if (!s.carding[category]) s.carding[category] = [];
    const r = {
      id:      rule?.id ?? crypto.randomUUID(),
      context: document.getElementById('carding-context').value.trim(),
      method:  document.getElementById('carding-method').value.trim(),
      notes:   document.getElementById('carding-notes').value.trim(),
    };
    if (index >= 0) s.carding[category][index] = r;
    else            s.carding[category].push(r);
    saveSystem(s);
    flash('Saved', 'ok');
    renderCardingSection();
    formCol.innerHTML = `<div class="empty-state" style="padding:2rem 0"><div class="big">←</div>Select a bid or rule to edit it.</div>`;
  });

  if (index >= 0) {
    document.getElementById('btn-delete-carding').addEventListener('click', () => {
      const s = getActiveSystem();
      s.carding[category].splice(index, 1);
      saveSystem(s);
      flash('Deleted', 'ok');
      renderCardingSection();
      formCol.innerHTML = `<div class="empty-state" style="padding:2rem 0"><div class="big">←</div>Select a bid or rule to edit it.</div>`;
    });
  }
}

function buildNodeElement(node, sys, path) {
  const newPath = [...path, node.id];
  const el = document.createElement('div');
  el.className = 'bid-node';
  el.dataset.id = node.id;

  const header = document.createElement('div');
  header.className = 'bid-node-header' + (selectedPath.at(-1) === node.id ? ' selected' : '');
  const baseHcp = node.meaning?.hcp;
  const hcpDisplay = baseHcp
    ? `<span class="node-hcp">[${baseHcp[0] ?? ''}–${baseHcp[1] ?? ''}]</span>` : '';
  const variantBadges = (node.variants ?? [])
    .map(v => `<span class="variant-badge">${variantBadgeText(v)}</span>`).join('');
  const cloneBtn = node.call?.type === 'bid'
    ? `<button class="btn-icon clone-down-btn" data-id="${node.id}" title="Clone → next call">⬇</button>` : '';

  header.innerHTML = `
    <span class="call-badge">${callToHTML(node.call)}</span>
    <span class="bid-meaning">${node.meaning?.description ?? ''}</span>
    ${hcpDisplay}
    ${variantBadges}
    ${node.meaning?.alert ? '<span class="tag tag-alert">Alert</span>' : ''}
    ${node.meaning?.forcing ? `<span class="tag tag-forcing">${node.meaning.forcing}</span>` : ''}
    ${node.continuations?.type === 'tbd' || (node.continuations?.type === 'nodes' && !node.continuations.nodes?.length && !node.continuations.refs?.length) ? '<span class="tag tag-tbd">TBD</span>' : ''}
    ${cloneBtn}
    <button class="btn-icon add-child-btn" data-id="${node.id}" title="Add response">＋</button>`;

  header.addEventListener('click', (e) => {
    if (_justDragged) return;
    if (e.target.classList.contains('add-child-btn')) return;
    // Toggle children collapse
    const kids = el.querySelector(':scope > .bid-node-children');
    if (kids) {
      kids.classList.toggle('collapsed');
      if (kids.classList.contains('collapsed')) expandedNodes.delete(node.id);
      else expandedNodes.add(node.id);
    }
    // Select and show form
    selectedPath = newPath;
    document.querySelectorAll('.bid-node-header.selected').forEach(h => h.classList.remove('selected'));
    header.classList.add('selected');
    showEditForm(node, sys);
  });

  header.querySelector('.add-child-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showAddBidModal(node.id);
  });

  const cloneDownBtn = header.querySelector('.clone-down-btn');
  if (cloneDownBtn) {
    cloneDownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = getActiveSystem();
      if (s) cloneNodeDown(node, s);
    });
  }

  // ── Drag to copy ────────────────────────────────────────────────────────
  header.draggable = true;

  header.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'BUTTON') { e.preventDefault(); return; }
    _justDragged = true;
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'copy';
    header.classList.add('dragging');
  });
  header.addEventListener('dragend', () => {
    header.classList.remove('dragging');
    // click fires right after dragend on many browsers — skip it
    setTimeout(() => { _justDragged = false; }, 0);
  });

  header.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    header.classList.add('drag-over');
  });
  header.addEventListener('dragleave', (e) => {
    if (!header.contains(e.relatedTarget)) header.classList.remove('drag-over');
  });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.remove('drag-over');
    const fromId = e.dataTransfer.getData('text/plain');
    if (!fromId || fromId === node.id) return;
    const s = getActiveSystem();
    if (!s) return;
    const src = findNode(s, fromId);
    if (!src) return;
    // Prevent dropping into a descendant
    const desc = new Set();
    (function collect(n) {
      desc.add(n.id);
      if (n.continuations?.type === 'nodes') n.continuations.nodes.forEach(collect);
    })(src);
    if (desc.has(node.id)) { flash('Cannot copy into a descendant', 'err'); return; }
    const target = findNode(s, node.id);
    if (!target) return;
    if (!target.continuations || target.continuations.type !== 'nodes')
      target.continuations = { type: 'nodes', nodes: [] };
    target.continuations.nodes.push(deepCloneNode(src));
    expandedNodes.add(node.id); // show the new child immediately
    saveSystem(s);
    refreshAllTrees();
    flash(`Copied ${callToString(src.call)} → under ${callToString(node.call)}`, 'ok');
  });

  el.appendChild(header);

  // Children
  const children = document.createElement('div');
  children.className = 'bid-node-children' + (expandedNodes.has(node.id) ? '' : ' collapsed');

  if (node.continuations?.type === 'nodes') {
    for (const child of sortNodes(node.continuations.nodes)) {
      children.appendChild(buildNodeElement(child, sys, newPath));
    }
    for (const ref of node.continuations.refs ?? []) {
      const conv = sys.conventions?.[ref.conventionId];
      const badge = document.createElement('div');
      badge.style.cssText = 'padding:0.3rem 0.5rem;font-size:0.8rem;color:var(--accent)';
      badge.textContent = `→ ${conv?.name ?? ref.conventionId}`;
      children.appendChild(badge);
    }
  } else if (node.continuations?.type === 'ref') {
    const ref = sys.conventions[node.continuations.conventionId];
    if (ref) {
      const badge = document.createElement('div');
      badge.style.cssText = 'padding:0.3rem 0.5rem;font-size:0.8rem;color:var(--accent)';
      badge.textContent = `→ ${ref.name}`;
      children.appendChild(badge);
    }
  }

  // Variant sub-trees (only shown when the variant changes continuations)
  for (const variant of node.variants ?? []) {
    if (!variant.continuationOverride && !variant.continuationDiff?.length) continue;
    children.appendChild(buildVariantSubTree(variant, sys, newPath));
  }

  // Competitive branches
  if (node.competitive?.length) {
    for (const branch of node.competitive) {
      const bel = document.createElement('div');
      bel.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--yellow);cursor:pointer';
      bel.textContent = `After ${interventionLabel(branch.after)}`;
      bel.addEventListener('click', () => showEditCompetitive(node, branch, sys));
      children.appendChild(bel);
    }
  }

  el.appendChild(children);
  return el;
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function showEditForm(node, sys) {
  editingNode = node.id;
  const formCol = document.getElementById('editor-form');
  if (!formCol) return;

  const m = node.meaning ?? {};
  const forcingOpts = ['', 'gf', '1r', 'inv', 'passable', 'relay', 'to-sign-off']
    .map(f => `<option value="${f}" ${m.forcing === f ? 'selected' : ''}>${f || '—'}</option>`).join('');

  formCol.innerHTML = `
    <h3 style="margin-bottom:0.75rem;font-size:0.95rem">${callToHTML(node.call)} <span style="color:var(--text-muted);font-size:0.8rem">${node.id.slice(0,8)}</span></h3>
    <div class="form-group">
      <label>Description</label>
      <textarea id="f-desc">${m.description ?? ''}</textarea>
    </div>
    <div style="display:flex;gap:0.5rem">
      <div class="form-group" style="flex:1">
        <label>HCP min</label>
        <input type="number" id="f-hcp-min" value="${m.hcp?.[0] ?? ''}" min="0" max="37" placeholder="0">
      </div>
      <div class="form-group" style="flex:1">
        <label>HCP max</label>
        <input type="number" id="f-hcp-max" value="${m.hcp?.[1] ?? ''}" min="0" max="37" placeholder="37">
      </div>
    </div>
    <div class="form-group">
      <label>Shape</label>
      <input type="text" id="f-shape" value="${m.shape ?? ''}" placeholder="e.g. 5+H, balanced, 4-4 minors">
    </div>
    <div style="display:flex;gap:0.5rem">
      <div class="form-group" style="flex:1">
        <label>Forcing</label>
        <select id="f-forcing">${forcingOpts}</select>
      </div>
      <div class="form-group" style="flex:1;justify-content:flex-end">
        <label>Alert <input type="checkbox" id="f-alert" ${m.alert ? 'checked' : ''}></label>
      </div>
    </div>
    <div class="form-group">
      <label>Announce (text)</label>
      <input type="text" id="f-announce" value="${m.announce ?? ''}" placeholder="e.g. 15-17">
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="f-notes" style="min-height:60px">${m.notes ?? ''}</textarea>
    </div>

    <div style="margin-top:0.5rem;border-top:1px solid var(--border);padding-top:0.75rem">
      <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;
                  letter-spacing:.05em;margin-bottom:0.5rem">Conventions</div>
      <div id="f-cont-refs-list"></div>
      <div style="display:flex;gap:0.4rem;margin-top:0.35rem;align-items:center">
        <select id="f-cont-refs-picker" style="flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;
                  background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
          <option value="">— include a convention —</option>
          ${Object.values(sys.conventions ?? {}).map(c =>
            `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="f-cont-refs-add-btn">＋ Add</button>
      </div>
    </div>

    <div id="f-variants-section" style="margin-top:0.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;border-top:1px solid var(--border);padding-top:0.75rem">
        <span style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Variants</span>
        <button class="btn btn-sm" id="btn-add-variant">+ Add</button>
      </div>
      <div id="f-variants-list">
        ${renderVariantsList(node.variants ?? [])}
      </div>
    </div>

    <div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap">
      <button class="btn btn-primary" id="btn-save-node">Save</button>
      <button class="btn" id="btn-copy-to-node" title="Copy this bid (with all responses) to another parent">Copy to…</button>
      <button class="btn btn-danger"  id="btn-delete-node">Delete</button>
    </div>`;

  // Continuation type toggle
  document.getElementById('f-cont-type').addEventListener('change', (e) => {
    document.getElementById('f-cont-ref-row').classList.toggle('hidden', e.target.value !== 'ref');
    document.getElementById('f-cont-refs-row').classList.toggle('hidden', e.target.value !== 'nodes');
    _updateRefParams();
  });

  // Convention reference param bindings
  const _refInitialParams = node.continuations?.type === 'ref' ? (node.continuations.params ?? {}) : {};
  const _updateRefParams = () => {
    const convId = document.getElementById('f-cont-ref')?.value;
    const s = getActiveSystem();
    const conv = convId ? s?.conventions?.[convId] : null;
    const ps   = conv?.params ?? [];
    const container = document.getElementById('f-cont-ref-params');
    if (!container) return;
    if (!ps.length) { container.innerHTML = ''; return; }
    container.innerHTML = ps.map(p => {
      const val = _refInitialParams[p.name] ?? '';
      const input = p.type === 'strain'
        ? `<select data-param-binding="${p.name}"
                   style="font-size:0.8rem;padding:0.15rem 0.3rem;background:var(--surface);
                          border:1px solid var(--border);color:var(--text);border-radius:3px">
             <option value="">— unset —</option>
             <option value="C" ${val==='C'?'selected':''}>\u2663 Clubs</option>
             <option value="D" ${val==='D'?'selected':''}>\u2666 Diamonds</option>
             <option value="H" ${val==='H'?'selected':''}>\u2665 Hearts</option>
             <option value="S" ${val==='S'?'selected':''}>\u2660 Spades</option>
             <option value="N" ${val==='N'?'selected':''}>NT</option>
           </select>`
        : p.type === 'level'
        ? `<input type="number" min="1" max="7" data-param-binding="${p.name}" value="${val}"
                  style="width:50px;font-size:0.8rem;background:var(--surface);border:1px solid var(--border);
                         color:var(--text);border-radius:3px;padding:0.15rem 0.3rem">`
        : `<input type="text" data-param-binding="${p.name}" value="${val}"
                  style="width:90px;font-size:0.8rem;background:var(--surface);border:1px solid var(--border);
                         color:var(--text);border-radius:3px;padding:0.15rem 0.3rem" placeholder="—">`;
      return `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.3rem">
        <code style="font-size:0.78rem;color:var(--accent);min-width:5rem">{${p.name}}</code>
        <span style="font-size:0.78rem;color:var(--text-muted);flex:1">${p.label || p.name}</span>
        ${input}
      </div>`;
    }).join('');
  };
  document.getElementById('f-cont-ref').addEventListener('change', _updateRefParams);
  _updateRefParams();

  // ── Multi-convention refs (type = nodes) ────────────────────────────────
  const _convOptions = Object.values(getActiveSystem()?.conventions ?? {});

  function _makeParamBindingHtml(param, boundVal) {
    if (param.type === 'strain')
      return `<select data-param-binding="${param.name}"
                style="font-size:0.78rem;padding:0.1rem 0.25rem;background:var(--surface);
                       border:1px solid var(--border);color:var(--text);border-radius:3px">
               <option value="">—</option>
               <option value="C" ${boundVal==='C'?'selected':''}>&#9827;</option>
               <option value="D" ${boundVal==='D'?'selected':''}>&#9830;</option>
               <option value="H" ${boundVal==='H'?'selected':''}>&#9829;</option>
               <option value="S" ${boundVal==='S'?'selected':''}>&#9824;</option>
               <option value="N" ${boundVal==='N'?'selected':''}>NT</option>
             </select>`;
    if (param.type === 'level')
      return `<input type="number" min="1" max="7" data-param-binding="${param.name}" value="${boundVal??''}"
               style="width:40px;font-size:0.78rem;padding:0.1rem 0.25rem;background:var(--surface);
                      border:1px solid var(--border);color:var(--text);border-radius:3px">`;
    return `<input type="text" data-param-binding="${param.name}" value="${boundVal??''}"
             placeholder="—" style="width:70px;font-size:0.78rem;padding:0.1rem 0.25rem;background:var(--surface);
                      border:1px solid var(--border);color:var(--text);border-radius:3px">`;
  }

  function _appendConvRefItem(convId, boundParams) {
    const conv = _convOptions.find(c => c.id === convId);
    if (!conv) return;
    const item = document.createElement('div');
    item.className = 'conv-ref-item';
    item.dataset.refConvId = convId;
    item.style.cssText = 'display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.45rem;'
      + 'background:rgba(74,158,255,0.06);border:1px solid var(--border);border-radius:4px;margin-bottom:0.3rem';
    const paramHtml = (conv.params ?? []).map(p =>
      `<span style="font-size:0.75rem;color:var(--text-muted);">{${p.name}}</span>
       ${_makeParamBindingHtml(p, boundParams?.[p.name])}`
    ).join(' ');
    item.innerHTML = `
      <span style="flex:1;font-size:0.83rem;color:var(--accent);font-weight:500">${conv.name}</span>
      <span style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap">${paramHtml}</span>
      <button class="btn btn-sm btn-danger" data-remove-conv-ref title="Remove">✕</button>`;
    item.querySelector('[data-remove-conv-ref]').addEventListener('click', () => item.remove());
    document.getElementById('f-cont-refs-list').appendChild(item);
  }

  // Pre-populate existing refs
  for (const ref of (node.continuations?.type === 'nodes' ? node.continuations.refs ?? [] : []))
    _appendConvRefItem(ref.conventionId, ref.params ?? {});

  document.getElementById('f-cont-refs-add-btn').addEventListener('click', () => {
    const picker = document.getElementById('f-cont-refs-picker');
    if (!picker.value) return;
    _appendConvRefItem(picker.value, {});
    picker.value = '';
  });

  document.getElementById('btn-save-node').addEventListener('click',   () => saveNode(node));
  document.getElementById('btn-delete-node').addEventListener('click', () => deleteNode(node));
  document.getElementById('btn-add-variant').addEventListener('click', () => showAddVariantModal(node));
  document.getElementById('btn-copy-to-node').addEventListener('click', () => showCopyToModal(node));

  // Variant edit / delete
  document.getElementById('f-variants-list').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-variant-edit]');
    const delBtn  = e.target.closest('[data-variant-delete]');
    if (editBtn) {
      showAddVariantModal(node, +editBtn.dataset.variantEdit);
    } else if (delBtn) {
      const idx = +delBtn.dataset.variantDelete;
      if (!confirm('Delete this variant?')) return;
      const sys = getActiveSystem();
      if (!sys) return;
      const live = findNode(sys, node.id);
      if (!live) return;
      live.variants.splice(idx, 1);
      saveSystem(sys);
      flash('Variant deleted', 'ok');
      refreshAllTrees();
      const updated = findNode(getActiveSystem(), node.id);
      if (updated) showEditForm(updated, getActiveSystem());
    }
  });
}

function buildVariantSubTree(variant, sys, parentPath) {
  const cParts = [];
  if (variant.condition?.seats) cParts.push(`Opening seat ${variant.condition.seats.join(',')}`);
  if (variant.condition?.vul)   cParts.push(variant.condition.vul.join('/'));
  const condLabel = cParts.join(' · ') || 'Variant';

  const section = document.createElement('div');
  section.className = 'variant-tree-section';

  const label = document.createElement('div');
  label.className = 'variant-tree-label';
  label.textContent = condLabel + (variant.notes ? ' — ' + variant.notes : '');
  section.appendChild(label);

  const cont = variant.continuationOverride;
  if (cont?.type === 'nodes') {
    for (const child of sortNodes(cont.nodes)) {
      section.appendChild(buildNodeElement(child, sys, parentPath));
    }
  } else if (cont?.type === 'ref') {
    const ref = sys.conventions[cont.conventionId];
    const b = document.createElement('div');
    b.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.8rem;color:var(--accent)';
    b.textContent = `→ ${ref?.name ?? cont.conventionId}`;
    section.appendChild(b);
  } else if (cont?.type === 'tbd') {
    const b = document.createElement('div');
    b.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--yellow)';
    b.textContent = 'TBD';
    section.appendChild(b);
  } else if (cont?.type === 'end') {
    const b = document.createElement('div');
    b.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--text-muted)';
    b.textContent = 'Sign-off';
    section.appendChild(b);
  }
  if (!cont && variant.continuationDiff?.length) {
    const b = document.createElement('div');
    b.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--text-muted)';
    b.textContent = `${variant.continuationDiff.length} modification(s) to base tree`;
    section.appendChild(b);
  }
  return section;
}

function renderVariantsList(variants) {
  if (!variants.length) return '<div style="color:var(--text-muted);font-size:0.82rem">None</div>';
  return variants.map((v, i) => {
    const cond = [
      v.condition.seats ? `Opening seat${v.condition.seats.length > 1 ? 's' : ''} ${v.condition.seats.join(',')}` : '',
      v.condition.vul   ? v.condition.vul.join('/') : '',
    ].filter(Boolean).join(' · ');
    const hcp = v.meaningOverride?.hcp ? `${v.meaningOverride.hcp[0]??''}–${v.meaningOverride.hcp[1]??''}` : '';
    return `<div class="variant-item" style="display:flex;align-items:flex-start;gap:0.4rem;margin-bottom:0.3rem">
      <div style="flex:1">
        <div class="variant-condition">${cond || 'Always'}</div>
        <div>${v.meaningOverride?.description ?? ''} ${hcp ? `<strong>${hcp}</strong>` : ''}</div>
        ${v.notes ? `<div style="font-size:0.78rem;color:var(--text-muted)">${v.notes}</div>` : ''}
      </div>
      <button class="btn btn-sm" data-variant-edit="${i}" title="Edit">✎</button>
      <button class="btn btn-sm btn-danger" data-variant-delete="${i}" title="Delete">✕</button>
    </div>`;
  }).join('');
}

// ─── Save / delete node ───────────────────────────────────────────────────────

function saveNode(node) {
  const sys = getActiveSystem();
  if (!sys) return;

  const desc    = document.getElementById('f-desc').value.trim();
  const hcpMin  = document.getElementById('f-hcp-min').value;
  const hcpMax  = document.getElementById('f-hcp-max').value;
  const shape   = document.getElementById('f-shape').value.trim();
  const forcing = document.getElementById('f-forcing').value;
  const alert   = document.getElementById('f-alert').checked;
  const announce= document.getElementById('f-announce').value.trim();
  const notes   = document.getElementById('f-notes').value.trim();

  // Always nodes
  if (desc)    meaning.description = desc;
  if (hcpMin || hcpMax) meaning.hcp = [hcpMin ? +hcpMin : undefined, hcpMax ? +hcpMax : undefined];
  if (shape)   meaning.shape    = shape;
  if (forcing) meaning.forcing  = forcing;
  if (alert)   meaning.alert    = true;
  if (announce)meaning.announce = announce;
  if (notes)   meaning.notes    = notes;

  // Always nodes — preserve existing inline nodes, collect convention refs from the list
  const baseNodes = node.continuations?.type === 'nodes' ? node.continuations.nodes : [];
  const refs = [...document.querySelectorAll('#f-cont-refs-list .conv-ref-item')].map(row => {
    const bindings = {};
    row.querySelectorAll('[data-param-binding]').forEach(el => {
      if (el.value) bindings[el.dataset.paramBinding] = el.value;
    });
    return { conventionId: row.dataset.refConvId,
      ...(Object.keys(bindings).length ? { params: bindings } : {}) };
  });
  const continuations = { type: 'nodes', nodes: baseNodes, ...(refs.length ? { refs } : {}) };

  updateNodeInSystem(sys, node.id, { meaning, continuations });
  saveSystem(sys);
  flash('Saved', 'ok');
  refreshAllTrees();
  // re-show form with updated node
  const updated = findNode(sys, node.id);
  if (updated) showEditForm(updated, sys);
}

function deleteNode(node) {
  if (!confirm(`Delete ${callToString(node.call)}? This will also delete all children.`)) return;
  const sys = getActiveSystem();
  if (!sys) return;
  removeNodeFromSystem(sys, node.id);
  saveSystem(sys);
  flash('Deleted', 'ok');
  document.getElementById('editor-form').innerHTML = '<div class="empty-state" style="padding:2rem 0"><div class="big">←</div>Select a bid to edit it.</div>';
  refreshAllTrees();
}

// ─── Add bid modal ────────────────────────────────────────────────────────────

function showAddBidModal(parentId, section = 'openings') {
  const modal = document.getElementById('modal-add-bid');
  document.getElementById('add-bid-call').value        = '';
  document.getElementById('add-bid-desc').value        = '';
  document.getElementById('add-bid-hcp-min').value     = '';
  document.getElementById('add-bid-hcp-max').value     = '';
  document.getElementById('add-bid-parent-id').value   = parentId ?? '';
  document.getElementById('add-bid-section').value     = section;
  modal.classList.remove('hidden');
  document.getElementById('add-bid-call').focus();
}

export function initAddBidModal() {
  const modal = document.getElementById('modal-add-bid');
  document.getElementById('btn-add-bid-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('btn-add-bid-confirm').addEventListener('click', () => {
    const callStr  = document.getElementById('add-bid-call').value.trim();
    const desc     = document.getElementById('add-bid-desc').value.trim();
    const hcpMin   = document.getElementById('add-bid-hcp-min').value;
    const hcpMax   = document.getElementById('add-bid-hcp-max').value;
    const parentId = document.getElementById('add-bid-parent-id').value || null;
    const section  = document.getElementById('add-bid-section').value || 'openings';

    const call = parseCall(callStr);
    if (!call) { flash('Invalid call: use e.g. 1C, 2H, 3N, P, X, XX', 'err'); return; }

    const sys = getActiveSystem();
    if (!sys) return;

    const meaning = {};
    if (desc)             meaning.description = desc;
    if (hcpMin || hcpMax) meaning.hcp = [hcpMin ? +hcpMin : undefined, hcpMax ? +hcpMax : undefined];

    const newNode = makeBidNode(crypto.randomUUID(), call, {
      meaning: Object.keys(meaning).length ? meaning : null,
      continuations: { type: 'tbd' },
    });

    if (!parentId) {
      if (section === 'overcalls') {
        if (!sys.overcalls) sys.overcalls = [];
        sys.overcalls.push(newNode);
      } else if (section.startsWith('convention:')) {
        const convId = section.slice('convention:'.length);
        const conv = sys.conventions?.[convId];
        if (!conv) { flash('Convention not found', 'err'); return; }
        conv.nodes = conv.nodes ?? [];
        conv.nodes.push(newNode);
      } else {
        sys.openings.push(newNode);
      }
    } else {
      const parent = findNode(sys, parentId);
      if (!parent) { flash('Parent not found', 'err'); return; }
      if (!parent.continuations || parent.continuations.type !== 'nodes') {
        parent.continuations = { type: 'nodes', nodes: [] };
      }
      parent.continuations.nodes.push(newNode);
    }

    saveSystem(sys);
    modal.classList.add('hidden');
    refreshAllTrees();
    flash('Added', 'ok');
  });
}

// ─── Add variant modal ────────────────────────────────────────────────────────

function showAddVariantModal(node, editIndex = -1) {
  const modal = document.getElementById('modal-add-variant');
  document.getElementById('var-node-id').value      = node.id;
  document.getElementById('var-variant-index').value = editIndex;
  const v = editIndex >= 0 ? (node.variants ?? [])[editIndex] : null;
  document.getElementById('var-seats').value    = v?.condition?.seats?.join(',') ?? '';
  document.getElementById('var-vul').value      = v?.condition?.vul?.join(',')   ?? '';
  document.getElementById('var-hcp-min').value  = v?.meaningOverride?.hcp?.[0]   ?? '';
  document.getElementById('var-hcp-max').value  = v?.meaningOverride?.hcp?.[1]   ?? '';
  document.getElementById('var-announce').value = v?.meaningOverride?.announce   ?? '';
  document.getElementById('var-desc').value     = v?.meaningOverride?.description ?? '';
  document.getElementById('var-notes').value    = v?.notes ?? '';
  modal.querySelector('h2').textContent = editIndex >= 0 ? 'Edit Variant' : 'Add Variant';
  document.getElementById('btn-add-variant-confirm').textContent = editIndex >= 0 ? 'Save Variant' : 'Add Variant';
  modal.classList.remove('hidden');
}

export function initAddVariantModal() {
  const modal = document.getElementById('modal-add-variant');
  document.getElementById('btn-add-variant-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('btn-add-variant-confirm').addEventListener('click', () => {
    const nodeId    = document.getElementById('var-node-id').value;
    const editIndex = +document.getElementById('var-variant-index').value;
    const seatsStr  = document.getElementById('var-seats').value.trim();
    const vulStr   = document.getElementById('var-vul').value;
    const hcpMin   = document.getElementById('var-hcp-min').value;
    const hcpMax   = document.getElementById('var-hcp-max').value;
    const announce = document.getElementById('var-announce').value.trim();
    const desc     = document.getElementById('var-desc').value.trim();
    const notes    = document.getElementById('var-notes').value.trim();

    const condition = {};
    if (seatsStr) condition.seats = seatsStr.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= 4);
    if (vulStr)   condition.vul   = vulStr.split(',').map(s => s.trim()).filter(Boolean);

    const meaningOverride = {};
    if (hcpMin || hcpMax) meaningOverride.hcp = [hcpMin ? +hcpMin : undefined, hcpMax ? +hcpMax : undefined];
    if (announce) meaningOverride.announce = announce;
    if (desc)     meaningOverride.description = desc;

    const variant = { condition };
    if (Object.keys(meaningOverride).length) variant.meaningOverride = meaningOverride;
    if (notes) variant.notes = notes;

    const sys = getActiveSystem();
    if (!sys) return;
    const node = findNode(sys, nodeId);
    if (!node) return;
    node.variants = node.variants ?? [];
    if (editIndex >= 0) {
      node.variants[editIndex] = variant;
      flash('Variant updated', 'ok');
    } else {
      node.variants.push(variant);
      flash('Variant added', 'ok');
    }
    saveSystem(sys);
    modal.classList.add('hidden');
    refreshAllTrees();
    showEditForm(node, sys);
  });
}

// ─── Copy-to modal ────────────────────────────────────────────────────────────

function showCopyToModal(node) {
  const modal = document.getElementById('modal-copy-to');
  const list  = document.getElementById('copy-to-list');
  const sys   = getActiveSystem();
  if (!sys) return;

  document.getElementById('copy-from-id').value = node.id;

  // Collect IDs of node and all its descendants (can't copy into self)
  const excludeIds = new Set();
  function collectIds(n) {
    excludeIds.add(n.id);
    if (n.continuations?.type === 'nodes') n.continuations.nodes.forEach(collectIds);
  }
  collectIds(node);

  list.innerHTML = '';
  let selectedDestId = null;

  function makeItem(id, html, depth, isSection) {
    const item = document.createElement('div');
    item.dataset.destId = id;
    item.style.cssText = `padding:0.28rem 0.5rem 0.28rem ${0.4 + depth * 1.1}rem;cursor:pointer;font-size:0.84rem;border-radius:3px;${isSection ? 'color:var(--accent);font-weight:500;' : ''}`;
    item.innerHTML = html;
    item.addEventListener('click', () => {
      list.querySelectorAll('[data-dest-id]').forEach(el => el.style.background = '');
      item.style.background = 'rgba(74,158,255,0.15)';
      selectedDestId = id;
    });
    list.appendChild(item);
  }

  makeItem('__root_openings__', '📂 Root — Openings', 0, true);
  makeItem('__root_overcalls__', '📂 Root — Overcalls', 0, true);

  function flatNodes(nodes, depth) {
    for (const n of sortNodes(nodes)) {
      if (excludeIds.has(n.id)) continue;
      const m = n.meaning?.description ?? '';
      makeItem(n.id, `${callToHTML(n.call)} <span style="color:var(--text-muted)">${m.slice(0, 45)}</span>`, depth, false);
      if (n.continuations?.type === 'nodes') flatNodes(n.continuations.nodes, depth + 1);
    }
  }

  flatNodes(sys.openings, 1);
  flatNodes(sys.overcalls ?? [], 1);

  for (const conv of Object.values(sys.conventions ?? {})) {
    makeItem(`__conv_root__${conv.id}`, `📂 Convention: ${conv.name}`, 0, true);
    flatNodes(conv.nodes ?? [], 1);
  }

  modal._getSelectedDest = () => selectedDestId;
  modal.classList.remove('hidden');
}

export function initCopyToModal() {
  const modal = document.getElementById('modal-copy-to');
  document.getElementById('btn-copy-to-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('btn-copy-to-confirm').addEventListener('click', () => {
    const destId = modal._getSelectedDest?.();
    if (!destId) { flash('Select a destination first', 'err'); return; }
    const fromId = document.getElementById('copy-from-id').value;
    const sys = getActiveSystem();
    if (!sys) return;
    const sourceNode = findNode(sys, fromId);
    if (!sourceNode) { flash('Source node not found', 'err'); return; }

    const cloned = deepCloneNode(sourceNode);

    if (destId === '__root_openings__') {
      sys.openings.push(cloned);
    } else if (destId === '__root_overcalls__') {
      if (!sys.overcalls) sys.overcalls = [];
      sys.overcalls.push(cloned);
    } else if (destId.startsWith('__conv_root__')) {
      const convId = destId.slice('__conv_root__'.length);
      const conv = sys.conventions[convId];
      if (!conv) { flash('Convention not found', 'err'); return; }
      conv.nodes = conv.nodes ?? [];
      conv.nodes.push(cloned);
    } else {
      const destNode = findNode(sys, destId);
      if (!destNode) { flash('Destination not found', 'err'); return; }
      if (!destNode.continuations || destNode.continuations.type !== 'nodes') {
        destNode.continuations = { type: 'nodes', nodes: [] };
      }
      destNode.continuations.nodes.push(cloned);
    }

    saveSystem(sys);
    modal.classList.add('hidden');
    refreshAllTrees();
    flash(`Copied ${callToString(sourceNode.call)} → destination`, 'ok');
  });
}

// ─── Convention library section ───────────────────────────────────────────────

function renderConventionsSection() {
  const sys = getActiveSystem();
  if (!sys) return;
  const container = document.getElementById('editor-conventions');
  if (!container) return;
  container.innerHTML = '';

  const convs = Object.values(sys.conventions ?? {});
  if (!convs.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:0.25rem 0">No conventions yet. Conventions can be referenced in bid continuations.</div>`;
    return;
  }

  for (const conv of convs) {
    const section = document.createElement('div');
    section.style.cssText = 'border:1px solid var(--border);border-radius:4px;margin-bottom:0.6rem;overflow:hidden';

    const convHeader = document.createElement('div');
    convHeader.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.6rem;background:rgba(74,158,255,0.07);cursor:pointer;user-select:none';
    convHeader.innerHTML = `
      <span style="flex:1;font-size:0.88rem;font-weight:500;color:var(--accent)">${conv.name}</span>
      ${conv.params?.length
        ? `<span style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono)">{${conv.params.map(p => p.name).join(', ')}}</span>`
        : ''}
      <span style="font-size:0.72rem;color:var(--text-muted);font-family:monospace">${conv.id}</span>
      <button class="btn btn-sm" data-conv-edit="${conv.id}" title="Edit metadata">✎</button>
      <button class="btn btn-sm btn-primary" data-conv-add="${conv.id}" title="Add response to convention">＋</button>
      <button class="btn btn-sm btn-danger" data-conv-del="${conv.id}" title="Delete convention">✕</button>`;

    const convBody = document.createElement('div');
    convBody.style.cssText = 'padding:0.4rem 0.6rem;display:none';

    const convTree = document.createElement('div');
    convTree.className = 'bid-tree';
    convTree.id = `conv-tree-${conv.id}`;
    const nodes = conv.nodes ?? [];
    if (!nodes.length) {
      convTree.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;padding:0.2rem 0">No responses yet — use ＋ to add.</div>`;
    } else {
      for (const n of sortNodes(nodes)) convTree.appendChild(buildNodeElement(n, sys, []));
    }
    const _convId = conv.id;
    addRootDropZone(convTree,
      s => (s.conventions[_convId].nodes ?? (s.conventions[_convId].nodes = [])),
      `Convention: ${conv.name}`);
    convBody.appendChild(convTree);
    section.appendChild(convHeader);
    section.appendChild(convBody);
    container.appendChild(section);

    // Toggle expand
    convHeader.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      convBody.style.display = convBody.style.display === 'none' ? 'block' : 'none';
    });

    convHeader.querySelector('[data-conv-edit]').addEventListener('click', (e) => {
      e.stopPropagation();
      showConventionForm(conv);
    });
    convHeader.querySelector('[data-conv-add]').addEventListener('click', (e) => {
      e.stopPropagation();
      showAddBidModal(null, `convention:${conv.id}`);
    });
    convHeader.querySelector('[data-conv-del]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete convention "${conv.name}"? This cannot be undone.`)) return;
      const s = getActiveSystem();
      delete s.conventions[conv.id];
      saveSystem(s);
      renderConventionsSection();
      flash('Convention deleted', 'ok');
    });
  }
}

function createParamRow(p = { name: '', label: '', type: 'strain' }) {
  const row = document.createElement('div');
  row.className = 'conv-param-row';
  row.style.cssText = 'display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem';
  row.innerHTML = `
    <input type="text" data-param-name placeholder="name" value="${p.name}"
           title="Identifier used in bid calls as {name}"
           style="width:90px;font-family:var(--font-mono);font-size:0.8rem;padding:0.2rem 0.4rem;
                  background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
    <input type="text" data-param-label placeholder="label" value="${p.label ?? ''}"
           style="flex:1;font-size:0.8rem;padding:0.2rem 0.4rem;
                  background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
    <select data-param-type
            style="width:70px;font-size:0.8rem;padding:0.2rem;
                   background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
      <option value="strain" ${!p.type || p.type==='strain' ? 'selected' : ''}>strain</option>
      <option value="level"  ${p.type==='level'             ? 'selected' : ''}>level</option>
      <option value="text"   ${p.type==='text'              ? 'selected' : ''}>text</option>
    </select>
    <button class="btn btn-sm btn-danger" data-remove-param title="Remove">✕</button>`;
  row.querySelector('[data-remove-param]').addEventListener('click', () => row.remove());
  return row;
}

function showConventionForm(conv) {
  const formCol = document.getElementById('editor-form');
  if (!formCol) return;
  formCol.innerHTML = `
    <h3 style="margin-bottom:0.75rem;font-size:0.95rem">Convention: <span style="color:var(--accent)">${conv.name}</span></h3>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="conv-name" value="${conv.name ?? ''}">
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="conv-desc" style="min-height:60px">${conv.description ?? ''}</textarea>
    </div>
    <div class="form-group">
      <label>Tags (comma-separated)</label>
      <input type="text" id="conv-tags" value="${(conv.tags ?? []).join(', ')}">
    </div>
    <div class="form-group">
      <label>ID <small style="color:var(--text-muted)">(used in convention references, cannot change)</small></label>
      <input type="text" value="${conv.id}" readonly style="opacity:0.55;cursor:default">
    </div>
    <div style="margin-top:0.75rem;border-top:1px solid var(--border);padding-top:0.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem">
        <span style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Parameters</span>
        <button class="btn btn-sm" id="btn-add-conv-param">＋ Add</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
        Use <code style="font-size:0.73rem;color:var(--accent)">{name}</code> as a bid call inside this convention,
        e.g. <code style="font-size:0.73rem;color:var(--accent)">4{suit}</code> for a parameterised sign-off.
        When linking to this convention you can optionally bind the parameter; leave it unset to show the placeholder.
      </div>
      <div id="conv-params-list"></div>
    </div>
    <div style="margin-top:1rem">
      <button class="btn btn-primary" id="btn-save-conv">Save</button>
    </div>`;

  const paramsList = formCol.querySelector('#conv-params-list');
  for (const p of conv.params ?? []) paramsList.appendChild(createParamRow(p));

  formCol.querySelector('#btn-add-conv-param').addEventListener('click', () => {
    paramsList.appendChild(createParamRow());
  });

  document.getElementById('btn-save-conv').addEventListener('click', () => {
    const s = getActiveSystem();
    if (!s) return;
    const c = s.conventions[conv.id];
    if (!c) return;
    c.name        = document.getElementById('conv-name').value.trim() || c.name;
    c.description = document.getElementById('conv-desc').value.trim();
    c.tags        = document.getElementById('conv-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    c.params      = [...formCol.querySelectorAll('.conv-param-row')].map(row => ({
      name:  row.querySelector('[data-param-name]').value.trim().replace(/[^a-zA-Z0-9_]/g, ''),
      label: row.querySelector('[data-param-label]').value.trim(),
      type:  row.querySelector('[data-param-type]').value,
    })).filter(p => p.name);
    saveSystem(s);
    flash('Saved', 'ok');
    renderConventionsSection();
    formCol.innerHTML = `<div class="empty-state" style="padding:2rem 0"><div class="big">←</div>Select a bid or rule to edit it.</div>`;
  });
}

// ─── Convention Library modal ─────────────────────────────────────────────────

function showLibraryModal() {
  const backdrop = document.getElementById('modal-conv-library');
  if (!backdrop) return;
  backdrop.classList.remove('hidden');
  document.getElementById('btn-conv-library-close').onclick = () => backdrop.classList.add('hidden');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.add('hidden'); }, { once: true });
  renderLibraryList();
}

async function renderLibraryList() {
  const container = document.getElementById('conv-library-list');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Loading…</div>`;

  let entries;
  try {
    entries = await fetchLibraryIndex();
  } catch (e) {
    container.innerHTML = `<div style="color:var(--danger,#e55);padding:0.75rem">${e.message}</div>`;
    return;
  }

  const sys = getActiveSystem();
  const existing = new Set(Object.keys(sys?.conventions ?? {}));

  container.innerHTML = entries.map(entry => {
    const alreadyIn = existing.has(entry.id);
    const tags = (entry.tags ?? [])
      .map(t => `<span class="lib-tag">${t}</span>`).join('');
    return `
      <div class="lib-entry${alreadyIn ? ' lib-entry-imported' : ''}" data-lib-entry="${entry.id}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;margin-bottom:0.2rem">${entry.name}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.3rem">${entry.description ?? ''}</div>
          <div>${tags}</div>
        </div>
        <div style="flex-shrink:0;margin-left:0.75rem;text-align:center">
          <button class="btn btn-sm${alreadyIn ? '' : ' btn-primary'}"
            data-lib-import="${entry.id}" data-lib-name="${entry.name}">
            ${alreadyIn ? '↺ Re-import' : 'Import'}
          </button>
          ${alreadyIn ? `<span class="lib-imported-badge">✓ in library</span>` : ''}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-lib-import]').forEach(btn => {
    btn.addEventListener('click', () =>
      importConventionFromLibrary(btn.dataset.libImport, btn.dataset.libName));
  });
}

async function importConventionFromLibrary(id, name) {
  const sys = getActiveSystem();
  if (!sys) return;

  if (!sys.conventions) sys.conventions = {};
  if (sys.conventions[id]) {
    if (!confirm(`"${name}" is already in your library. Re-import and overwrite it?`)) return;
  }

  let conv;
  try {
    conv = await fetchLibraryConvention(id);
  } catch (e) {
    flash(`Import failed: ${e.message}`, 'err');
    return;
  }

  sys.conventions[conv.id] = conv;
  saveSystem(sys);
  flash(`Imported "${name}" into Convention Library`, 'ok');
  renderConventionsSection();
  // Refresh the modal list to update the "in library" badges
  renderLibraryList();
}

// ─── Competitive ──────────────────────────────────────────────────────────────

function showEditCompetitive(node, branch, sys) {
  // TODO: full competitive editor — for now show notes in flash
  flash(`Competitive branch: after ${interventionLabel(branch.after)} — full editor coming soon`, 'ok');
}

function interventionLabel(iv) {
  if (!iv) return '(P)';
  switch (iv.type) {
    case 'double':   return `(X${iv.nature ? ':'+iv.nature:''})`;
    case 'suit':     return `(${iv.level}${iv.strain}${iv.nature==='art'?'*':''})`;
    case 'notrump':  return `(${iv.level}N)`;
    case 'any-suit': return '(any suit)';
    case 'any-double': return '(any X)';
    case 'any':      return '(any)';
    default:         return '(P)';
  }
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

export function findNode(sys, id) {
  function search(nodes) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.continuations?.type === 'nodes') {
        const found = search(n.continuations.nodes);
        if (found) return found;
      }
    }
    return null;
  }
  const fromMain = search(sys.openings) ?? search(sys.overcalls ?? []);
  if (fromMain) return fromMain;
  for (const conv of Object.values(sys.conventions ?? {})) {
    const found = search(conv.nodes ?? []);
    if (found) return found;
  }
  return null;
}

function updateNodeInSystem(sys, id, changes) {
  function update(nodes) {
    for (const n of nodes) {
      if (n.id === id) { Object.assign(n, changes); return true; }
      if (n.continuations?.type === 'nodes' && update(n.continuations.nodes)) return true;
    }
    return false;
  }
  if (update(sys.openings) || update(sys.overcalls ?? [])) return;
  for (const conv of Object.values(sys.conventions ?? {})) {
    if (update(conv.nodes ?? [])) return;
  }
}

function removeNodeFromSystem(sys, id) {
  function remove(nodes) {
    const idx = nodes.findIndex(n => n.id === id);
    if (idx !== -1) { nodes.splice(idx, 1); return true; }
    for (const n of nodes) {
      if (n.continuations?.type === 'nodes' && remove(n.continuations.nodes)) return true;
    }
    return false;
  }
  if (remove(sys.openings) || remove(sys.overcalls ?? [])) return;
  for (const conv of Object.values(sys.conventions ?? {})) {
    if (remove(conv.nodes ?? [])) return;
  }
}
