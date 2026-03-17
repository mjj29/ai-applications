/**
 * Position view — shows the system tree resolved for the current opening seat/vul.
 * Clean read: variant conditions are applied silently; no badge noise.
 */
'use strict';

import { callToHTML, interventionToString, sortNodes, renderText } from './model.js';
import { getActiveSystem } from './store.js';
import { resolve } from './resolver.js';

let posCtx = { seat: 1, vul: 'nv', intervention: null };

export function setPositionContext(ctx) {
  posCtx = ctx;
  renderPositionTree();
}

export function renderPosition(container) {
  const sys = getActiveSystem();
  if (!sys) {
    container.innerHTML = `<div class="empty-state"><div class="big">📋</div>No system open.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="overflow-y:auto;height:100%;padding:0 0.25rem">
      <div style="display:flex;gap:1rem;align-items:center;padding:0.25rem 0 0.85rem;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.85rem">Seat
          <select id="pos-seat">
            <option value="1" ${posCtx.seat===1?'selected':''}>1st</option>
            <option value="2" ${posCtx.seat===2?'selected':''}>2nd</option>
            <option value="3" ${posCtx.seat===3?'selected':''}>3rd</option>
            <option value="4" ${posCtx.seat===4?'selected':''}>4th</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.85rem">Vulnerability
          <select id="pos-vul">
            <option value="nv"    ${posCtx.vul==='nv'   ?'selected':''}>NV</option>
            <option value="vul"   ${posCtx.vul==='vul'  ?'selected':''}>Vul</option>
            <option value="fav"   ${posCtx.vul==='fav'  ?'selected':''}>Fav (we NV)</option>
            <option value="unfav" ${posCtx.vul==='unfav'?'selected':''}>Unfav (they NV)</option>
          </select>
        </label>
        <span style="font-size:0.78rem;color:var(--text-muted)">variants applied silently</span>
      </div>
      <div id="position-tree" class="bid-tree" style="padding-bottom:2rem"></div>
    </div>`;

  document.getElementById('pos-seat').addEventListener('change', (e) => {
    posCtx = { ...posCtx, seat: +e.target.value };
    renderPositionTree();
  });
  document.getElementById('pos-vul').addEventListener('change', (e) => {
    posCtx = { ...posCtx, vul: e.target.value };
    renderPositionTree();
  });

  renderPositionTree();
}

function renderPositionTree() {
  const sys = getActiveSystem();
  if (!sys) return;
  const treeEl = document.getElementById('position-tree');
  if (!treeEl) return;
  treeEl.innerHTML = '';

  const openings = sortNodes(sys.openings ?? []);
  if (openings.length) {
    appendSectionHeader(treeEl, 'Opening Bids', false);
    for (const node of openings) treeEl.appendChild(buildPositionNode(node, sys));
  }

  const overcalls = sortNodes(sys.overcalls ?? []);
  if (overcalls.length) {
    appendSectionHeader(treeEl, 'Overcalls', true);
    for (const node of overcalls) treeEl.appendChild(buildPositionNode(node, sys));
  }

  const carding = sys.carding;
  if (carding && (carding.signals?.length || carding.discards?.length || carding.leads?.length)) {
    appendSectionHeader(treeEl, 'Carding', true);
    treeEl.appendChild(buildCardingDisplay(carding));
  }
}

function appendSectionHeader(parent, text, addMargin) {
  const h = document.createElement('div');
  h.style.cssText = `font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:0.4rem${addMargin ? ';margin-top:1.25rem' : ''}`;
  h.textContent = text;
  parent.appendChild(h);
}

function buildPositionNode(node, sys) {
  const el = document.createElement('div');
  el.className = 'bid-node';

  const resolved = resolve(node, posCtx, sys.conventions);
  const m = resolved.meaning;

  const header = document.createElement('div');
  header.className = 'bid-node-header';
  header.innerHTML = `
    <span class="call-badge">${callToHTML(node.call)}</span>
    <span class="bid-meaning">${renderText(m?.description ?? '')}</span>
    ${m?.hcp     ? `<span class="node-hcp">[${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''}]</span>` : ''}
    ${m?.announce ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3rem">"${m.announce}"</span>` : ''}
    ${m?.alert    ? '<span class="tag tag-alert">Alert</span>' : ''}
    ${m?.forcing  ? `<span class="tag tag-forcing">${m.forcing}</span>` : ''}
    ${node.continuations?.type === 'tbd' ? '<span class="tag tag-tbd">TBD</span>' : ''}`;

  const children = document.createElement('div');
  children.className = 'bid-node-children collapsed';

  header.addEventListener('click', () => children.classList.toggle('collapsed'));

  const childNodes = sortNodes(
    resolved.nodes
      .filter(r => r.status !== 'removed')
      .map(r => r.node ?? r)
  );
  for (const child of childNodes) {
    children.appendChild(buildPositionNode(child, sys));
  }

  // Competitive branch indicators (click to resolve)
  for (const branch of node.competitive ?? []) {
    const bel = document.createElement('div');
    bel.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--yellow);cursor:pointer;margin:0.1rem 0';
    bel.textContent = `After ${interventionToString(branch.after)}`;
    bel.addEventListener('click', (e) => {
      e.stopPropagation();
      const compCtx = { ...posCtx, intervention: branch.after };
      const compRes  = resolve(node, compCtx, sys.conventions);
      // Replace children with competitive view temporarily
      children.innerHTML = '';
      children.classList.remove('collapsed');
      const compNodes = sortNodes(
        compRes.nodes.filter(r => r.status !== 'removed').map(r => r.node ?? r)
      );
      for (const c of compNodes) children.appendChild(buildPositionNode(c, sys));
    });
    children.appendChild(bel);
  }

  el.appendChild(header);
  el.appendChild(children);
  return el;
}

function buildCardingDisplay(carding) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:0.25rem 0 1rem';
  const cats = [
    { key: 'signals',  label: 'Signals'  },
    { key: 'discards', label: 'Discards' },
    { key: 'leads',    label: 'Leads'    },
  ];
  for (const { key, label } of cats) {
    const rules = carding[key] ?? [];
    if (!rules.length) continue;
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:0.75rem';
    section.innerHTML = `
      <div style="font-size:0.72rem;color:var(--accent);text-transform:uppercase;letter-spacing:.04em;margin-bottom:0.3rem">${label}</div>
      ${rules.map(r => `
        <div style="display:flex;gap:0.75rem;padding:0.25rem 0.1rem;border-bottom:1px solid var(--border);font-size:0.85rem">
          <span style="color:var(--text-muted);min-width:110px;flex-shrink:0">${r.context || 'General'}</span>
          <span style="flex:1">${r.method || '—'}</span>
          ${r.notes ? `<span style="color:var(--text-muted);font-size:0.78rem">${r.notes}</span>` : ''}
        </div>`).join('')}`;
    wrap.appendChild(section);
  }
  return wrap;
}
