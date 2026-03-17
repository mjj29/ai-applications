/**
 * Sequence lookup — type a sequence, see the resolved meaning and next possible calls.
 */
'use strict';

import { callToHTML, callToString, interventionToString, parseSequence, sortNodes, renderText } from './model.js';
import { getActiveSystem } from './store.js';
import { resolveSequence } from './resolver.js';

let lookupCtx = { seat: 1, vul: 'nv', intervention: null };

export function setLookupContext(ctx) {
  lookupCtx = ctx;
}

export function renderLookup(container) {
  container.innerHTML = `
    <div style="overflow-y:auto;height:100%;padding:0 0.25rem">
      <div style="padding:0.25rem 0 0.85rem">
        <div style="display:flex;gap:1rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.85rem">Seat
            <select id="lookup-seat">
              <option value="1" ${lookupCtx.seat===1?'selected':''}>1st</option>
              <option value="2" ${lookupCtx.seat===2?'selected':''}>2nd</option>
              <option value="3" ${lookupCtx.seat===3?'selected':''}>3rd</option>
              <option value="4" ${lookupCtx.seat===4?'selected':''}>4th</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.85rem">Vulnerability
            <select id="lookup-vul">
              <option value="nv"    ${lookupCtx.vul==='nv'   ?'selected':''}>NV</option>
              <option value="vul"   ${lookupCtx.vul==='vul'  ?'selected':''}>Vul</option>
              <option value="fav"   ${lookupCtx.vul==='fav'  ?'selected':''}>Fav (we NV)</option>
              <option value="unfav" ${lookupCtx.vul==='unfav'?'selected':''}>Unfav (they NV)</option>
            </select>
          </label>
        </div>
        <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 0.6rem">
          Separate calls with <code>-</code>; wrap opponent calls in <code>()</code>. &nbsp;
          <span style="color:var(--accent)">e.g.</span>
          <code>1C - 1H - 1N</code> &nbsp;·&nbsp; <code>1H - (2S) - X</code>
        </p>
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="lookup-input"
            style="flex:1;font-family:monospace;font-size:1rem"
            placeholder="1C - 1H - 1N"
            autocomplete="off" spellcheck="false">
          <button class="btn btn-primary" id="btn-lookup">Look up</button>
        </div>
      </div>
      <div id="lookup-result"></div>
    </div>`;

  const input  = document.getElementById('lookup-input');
  const btn    = document.getElementById('btn-lookup');
  const result = document.getElementById('lookup-result');

  document.getElementById('lookup-seat').addEventListener('change', (e) => {
    lookupCtx = { ...lookupCtx, seat: +e.target.value };
  });
  document.getElementById('lookup-vul').addEventListener('change', (e) => {
    lookupCtx = { ...lookupCtx, vul: e.target.value };
  });

  function doLookup() {
    const str = input.value.trim();
    if (!str) { result.innerHTML = ''; return; }

    const steps = parseSequence(str);
    if (!steps) {
      result.innerHTML = `<div style="color:#f99;font-size:0.88rem">Could not parse sequence — check format.</div>`;
      return;
    }

    const sys = getActiveSystem();
    if (!sys) {
      result.innerHTML = `<div style="color:#f99;font-size:0.88rem">No system open.</div>`;
      return;
    }

    const res = resolveSequence(sys, steps, lookupCtx);
    result.innerHTML = '';
    result.appendChild(renderResult(res));
  }

  let _debounce = null;
  function doLookup() {
    clearTimeout(_debounce);
    _debounce = setTimeout(_runLookup, 180);
  }
  function _runLookup() {
    const str = input.value.trim();
    if (!str) { result.innerHTML = ''; return; }

    const steps = parseSequence(str);
    if (!steps) {
      result.innerHTML = `<div style="color:#f99;font-size:0.88rem">Could not parse sequence — check format.</div>`;
      return;
    }

    const sys = getActiveSystem();
    if (!sys) {
      result.innerHTML = `<div style="color:#f99;font-size:0.88rem">No system open.</div>`;
      return;
    }

    const res = resolveSequence(sys, steps, lookupCtx);
    result.innerHTML = '';
    result.appendChild(renderResult(res));
  }

  btn.addEventListener('click', () => { clearTimeout(_debounce); _runLookup(); });
  input.addEventListener('input', doLookup);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(_debounce); _runLookup(); } });
}

// ─── Result rendering ─────────────────────────────────────────────────────────

function renderResult(res) {
  const wrap = document.createElement('div');

  // Error notice
  if (res.error) {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'color:#f99;padding:0.6rem 0.75rem;background:rgba(255,100,100,0.08);border-radius:4px;font-size:0.88rem;margin-bottom:0.75rem';
    errDiv.textContent = res.error;
    wrap.appendChild(errDiv);
    // Still fall through to show any partial path + available bids
  }

  // Per-step meaning table
  if (res.path.length) {
    const section = document.createElement('div');
    section.className = 'detail-section';

    const table = document.createElement('table');
    table.className = 'resolved-table';
    table.innerHTML = '<thead><tr><th>Bid</th><th>Meaning</th><th>HCP</th><th>Shape</th><th>Forcing</th></tr></thead>';
    const tbody = document.createElement('tbody');

    for (const step of res.path) {
      const m = step.resolved?.meaning;
      const tr = document.createElement('tr');
      const intervention = step.intervention
        ? `<span style="color:var(--yellow);font-size:0.8rem;margin-right:0.3rem">(${interventionToString(step.intervention)})</span>` : '';
      tr.innerHTML = `
        <td style="white-space:nowrap">${intervention}${callToHTML(step.call)}</td>
        <td>${m?.description ? `<span>${renderText(m.description)}</span>` : '<span style="color:var(--text-muted)">—</span>'}
            ${m?.announce ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3rem">"${m.announce}"</span>` : ''}
            ${m?.alert    ? '<span class="tag tag-alert" style="margin-left:0.25rem">Alert</span>' : ''}
            ${m?.notes    ? `<div style="color:var(--text-muted);font-size:0.78rem;margin-top:0.15rem">${m.notes}</div>` : ''}</td>
        <td style="font-family:monospace;font-size:0.82rem;white-space:nowrap">${m?.hcp ? `${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''}` : ''}</td>
        <td style="font-size:0.82rem">${m?.shape ?? ''}</td>
        <td>${m?.forcing ? `<span class="tag tag-forcing">${m.forcing}</span>` : ''}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    wrap.appendChild(section);
  }

  // Continuations
  const nextNodes = res.nextNodes ?? [];
  if (nextNodes.length) {
    const section = document.createElement('div');
    section.className = 'detail-section';
    section.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:0.4rem">Next bids</div>`;

    const table = document.createElement('table');
    table.className = 'resolved-table';
    table.innerHTML = '<thead><tr><th>Bid</th><th>Meaning</th><th>HCP</th><th>Shape</th><th>Forcing</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const node of sortNodes(nextNodes)) {
      const nm = node.meaning;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${callToHTML(node.call)}</td>
        <td>${nm?.description ? renderText(nm.description) : '<span style="color:var(--text-muted)">—</span>'}
            ${nm?.announce ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3rem">"${nm.announce}"</span>` : ''}
            ${nm?.alert    ? '<span class="tag tag-alert" style="margin-left:0.25rem">Alert</span>' : ''}</td>
        <td style="font-family:monospace;font-size:0.82rem;white-space:nowrap">${nm?.hcp ? `${nm.hcp[0] ?? ''}–${nm.hcp[1] ?? ''}` : ''}</td>
        <td style="font-size:0.82rem">${nm?.shape ?? ''}</td>
        <td>${nm?.forcing ? `<span class="tag tag-forcing">${nm.forcing}</span>` : ''}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    wrap.appendChild(section);
  } else if (res.path.length && !res.error) {
    const endDiv = document.createElement('div');
    endDiv.style.cssText = 'color:var(--text-muted);font-size:0.82rem;margin-top:0.5rem';
    endDiv.textContent = 'No continuations defined.';
    wrap.appendChild(endDiv);
  }

  return wrap;
}
