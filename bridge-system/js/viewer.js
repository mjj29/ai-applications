/**
 * Viewer panel — shows the system tree in read-only mode with context-aware resolution.
 */
'use strict';

import { callToHTML, callToString, interventionToString, sortNodes } from './model.js';
import { getActiveSystem } from './store.js';
import { resolve } from './resolver.js';

let viewCtx = { seat: 1, vul: 'nv', intervention: null };

export function renderViewer(container) {
  const sys = getActiveSystem();
  if (!sys) {
    container.innerHTML = `<div class="empty-state"><div class="big">📋</div>No system open.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;gap:1rem;height:100%;overflow:hidden">
      <div id="viewer-tree-col" style="flex:1;overflow-y:auto">
        <h2 style="font-size:1rem;margin-bottom:0.75rem">System Tree</h2>
        <div id="viewer-tree" class="bid-tree"></div>
      </div>
      <div id="viewer-detail" style="width:360px;min-width:260px;border-left:1px solid var(--border);padding-left:1rem;overflow-y:auto">
        <div class="empty-state" style="padding:2rem 0">
          <div class="big">←</div>Click a bid to see details.
        </div>
      </div>
    </div>`;

  renderViewerTree();
}

function renderViewerTree() {
  const sys = getActiveSystem();
  if (!sys) return;
  const treeEl = document.getElementById('viewer-tree');
  if (!treeEl) return;
  treeEl.innerHTML = '';

  // ── Opening Bids ────────────────────────────────────────────────────────────
  const openings = sortNodes(sys.openings ?? []);
  if (openings.length) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:0.4rem';
    h.textContent = 'Opening Bids';
    treeEl.appendChild(h);
    for (const node of openings) treeEl.appendChild(buildViewNode(node, sys));
  }

  // ── Overcalls ───────────────────────────────────────────────────────────────
  const overcalls = sortNodes(sys.overcalls ?? []);
  if (overcalls.length) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:1rem 0 0.4rem';
    h.textContent = 'Overcalls';
    treeEl.appendChild(h);
    for (const node of overcalls) treeEl.appendChild(buildViewNode(node, sys));
  }

  // ── Carding ─────────────────────────────────────────────────────────────────
  const carding = sys.carding;
  if (carding && (carding.signals?.length || carding.discards?.length || carding.leads?.length)) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:1rem 0 0.4rem';
    h.textContent = 'Carding';
    treeEl.appendChild(h);
    treeEl.appendChild(buildCardingView(carding));
  }
}

function buildViewNode(node, sys) {
  const el = document.createElement('div');
  el.className = 'bid-node';

  const resolved = resolve(node, viewCtx, sys.conventions);

  const header = document.createElement('div');
  header.className = 'bid-node-header';

  const m = resolved.meaning;
  const hcpDisplay = m?.hcp
    ? `<span class="node-hcp">[${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''}]</span>` : '';
  // Show all variant badges so user can see which conditions differ
  const variantBadges = (node.variants ?? [])
    .map(v => {
      const cParts = [];
      if (v.condition?.seats) cParts.push(`s${v.condition.seats.join(',')}`);
      if (v.condition?.vul)   cParts.push(v.condition.vul.map(x => x.toUpperCase()).join('/'));
      const vm = v.meaningOverride;
      let val = '';
      if (vm?.hcp) val = `${vm.hcp[0] ?? ''}–${vm.hcp[1] ?? ''}`;
      else if (vm?.description) val = vm.description.slice(0, 18);
      else if (vm?.announce)    val = vm.announce;
      if (!val && v.continuationOverride) val = 'alt tree';
      const active = resolved.trace.appliedVariant === v ? ' variant-badge-active' : '';
      return `<span class="variant-badge${active}">${cParts.join(' ')}${val ? ': '+val : ''}</span>`;
    }).join('');
  header.innerHTML = `
    <span class="call-badge">${callToHTML(node.call)}</span>
    <span class="bid-meaning">${m?.description ?? ''}</span>
    ${hcpDisplay}
    ${variantBadges}
    ${m?.alert    ? '<span class="tag tag-alert">Alert</span>'      : ''}
    ${m?.forcing  ? `<span class="tag tag-forcing">${m.forcing}</span>` : ''}
    ${node.continuations?.type==='tbd' ? '<span class="tag tag-tbd">TBD</span>' : ''}`;

  header.addEventListener('click', () => {
    document.querySelectorAll('#viewer-tree .bid-node-header.selected').forEach(h => h.classList.remove('selected'));
    header.classList.add('selected');
    showViewDetail(node, resolved, sys);
    // Toggle children
    const kids = el.querySelector('.bid-node-children');
    if (kids) kids.classList.toggle('collapsed');
  });

  el.appendChild(header);

  const children = document.createElement('div');
  children.className = 'bid-node-children collapsed';

  const childNodes = sortNodes(
    resolved.nodes
      .filter(r => r.status !== 'removed')
      .map(r => r.node ?? r)
  );

  for (const child of childNodes) {
    children.appendChild(buildViewNode(child, sys));
  }

  // Competitive branches
  for (const branch of node.competitive ?? []) {
    const bel = document.createElement('div');
    bel.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.78rem;color:var(--yellow);cursor:pointer;margin:0.1rem 0';
    bel.textContent = `After ${interventionToString(branch.after)}`;
    bel.addEventListener('click', (e) => {
      e.stopPropagation();
      const compCtx = { ...viewCtx, intervention: branch.after };
      const compResolved = resolve(node, compCtx, sys.conventions);
      showViewDetail(node, compResolved, sys, branch.after);
    });
    children.appendChild(bel);
  }

  el.appendChild(children);
  return el;
}

function showViewDetail(node, resolved, sys, intervention) {
  const detail = document.getElementById('viewer-detail');
  if (!detail) return;

  const m     = resolved.meaning;
  const hcp   = m?.hcp ? `${m.hcp[0]??''}–${m.hcp[1]??''}` : '';
  const trace = resolved.trace;

  const variantBadge = trace.appliedVariant
    ? `<span class="tag" style="margin-left:0.5rem">
        ${conditionLabel(trace.appliedVariant.condition)}
       </span>` : '';

  detail.innerHTML = `
    <div class="detail-section">
      <h3>${callToHTML(node.call)} ${intervention ? `<span class="intervention-label">after ${interventionToString(intervention)}</span>` : ''}${variantBadge}</h3>
      ${m?.announce ? `<div style="font-size:0.82rem;color:var(--accent)">Announce: "${m.announce}"</div>` : ''}
      ${m?.alert    ? '<div style="font-size:0.82rem;color:#f99">⚠ Alert</div>' : ''}
    </div>

    ${hcp ? `<div class="detail-section"><h3>HCP Range</h3><div class="hcp-range">${hcp}</div></div>` : ''}

    ${m?.shape    ? `<div class="detail-section"><h3>Shape</h3><div>${m.shape}</div></div>` : ''}
    ${m?.forcing  ? `<div class="detail-section"><h3>Forcing</h3><div>${m.forcing}</div></div>` : ''}
    ${m?.description ? `<div class="detail-section"><h3>Description</h3><div style="font-size:0.88rem">${m.description}</div></div>` : ''}
    ${m?.notes    ? `<div class="detail-section"><h3>Notes</h3><div style="font-size:0.82rem;color:var(--text-muted)">${m.notes}</div></div>` : ''}

    ${resolved.notes.length ? `
      <div class="detail-section">
        <h3>System Notes</h3>
        ${resolved.notes.map(n => `<div style="font-size:0.82rem;color:var(--text-muted)">${n}</div>`).join('')}
      </div>` : ''}

    ${renderVariantsDetail(node.variants ?? [])}

    ${renderResponsesTable(resolved.nodes, !!intervention)}

    ${node.competitive?.length ? `
      <div class="detail-section">
        <h3>Competitive Branches</h3>
        <div class="competitive-list">
          ${node.competitive.map(b => `
            <div class="competitive-item" data-branch-id="${b.after?.type}">
              <span class="intervention-label">${interventionToString(b.after)}</span>
              ${b.notes ? `<span style="color:var(--text-muted);font-size:0.78rem;margin-left:0.5rem">${b.notes}</span>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}`;

  // Wire competitive item clicks
  detail.querySelectorAll('.competitive-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      const branch    = node.competitive[i];
      const compCtx   = { ...viewCtx, intervention: branch.after };
      const compRes   = resolve(node, compCtx, sys.conventions);
      showViewDetail(node, compRes, sys, branch.after);
    });
  });
}

function renderVariantsDetail(variants) {
  if (!variants.length) return '';
  return `<div class="detail-section">
    <h3>Variants</h3>
    <div class="variants-list">
      ${variants.map(v => {
        const cond = conditionLabel(v.condition);
        const hcp  = v.meaningOverride?.hcp ? `${v.meaningOverride.hcp[0]??''}–${v.meaningOverride.hcp[1]??''}` : '';
        return `<div class="variant-item">
          <div class="variant-condition">${cond}</div>
          ${v.meaningOverride?.description ? `<div>${v.meaningOverride.description}</div>` : ''}
          ${hcp ? `<div class="hcp-range" style="font-size:1rem">${hcp}</div>` : ''}
          ${v.meaningOverride?.announce ? `<div style="color:var(--accent);font-size:0.82rem">Announce: "${v.meaningOverride.announce}"</div>` : ''}
          ${v.notes ? `<div style="color:var(--text-muted);font-size:0.78rem">${v.notes}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderResponsesTable(resolvedNodes, isCompetitive) {
  if (!resolvedNodes.length) return '';

  const rows = resolvedNodes.map(r => {
    const n = r.node ?? r;
    const m = n?.meaning;
    const status = r.status ?? 'inherited';
    const hcp = m?.hcp ? ` [${m.hcp[0]??''}–${m.hcp[1]??''}]` : '';
    const inherited = status === 'inherited' ? ' status-inherited' : '';

    let oldMeaning = '';
    if (status === 'overridden' && r.replaces?.meaning?.description) {
      oldMeaning = `<div class="old-meaning">${r.replaces.meaning.description}</div>`;
    }
    const removedStyle = status === 'removed' ? 'text-decoration:line-through;opacity:0.4' : '';

    return `<tr class="status-${status}">
      <td style="${removedStyle}">${callToHTML(n?.call)}</td>
      <td style="${removedStyle}">
        ${oldMeaning}
        ${m?.description ?? ''}${hcp}
        ${m?.forcing ? `<span class="tag tag-forcing" style="font-size:0.7rem">${m.forcing}</span>` : ''}
      </td>
      <td>${status !== 'inherited' ? `<span class="tag">${status}</span>` : ''}</td>
    </tr>`;
  }).join('');

  return `<div class="detail-section">
    <h3>Responses${isCompetitive ? ' (competitive)' : ''}</h3>
    <table class="resolved-table">
      <thead><tr><th>Bid</th><th>Meaning</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function conditionLabel(condition) {
  const parts = [];
  if (condition.seats) parts.push(`Opening seat${condition.seats.length > 1 ? 's' : ''} ${condition.seats.join(',')}`);
  if (condition.vul)   parts.push(condition.vul.join('/'));
  return parts.join(' · ') || 'Default';
}

function buildCardingView(carding) {
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

// Called when context bar changes
export function setViewContext(ctx) {
  viewCtx = ctx;
  renderViewerTree();
}
