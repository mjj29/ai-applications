/**
 * print.js — Print / export tab.
 */
'use strict';

import { callToString, sortNodes } from './model.js';
import { getActiveSystem } from './store.js';

let currentFormat = 'booklet';

export function renderPrint(container) {
  const sys = getActiveSystem();
  if (!sys) {
    container.innerHTML = `<div class="empty-state"><div class="big">📄</div>No system open.</div>`;
    return;
  }
  // Only set properties that the CSS class doesn't already handle.
  // Do NOT set display here — inline display:flex would override the class's display:none
  // on other tabs, causing the iframe to bleed through everywhere.
  container.style.overflow = 'hidden';
  container.style.padding  = '0.6rem 1rem 0.6rem';
  container.innerHTML = `
    <div style="display:flex;gap:0.6rem;align-items:center;padding-bottom:0.55rem;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #555">
      <label style="font-size:0.85rem">Format:</label>
      <select id="print-format" style="font-size:0.85rem">
        <option value="booklet">System Booklet (A4)</option>
        <option value="acbl">ACBL Convention Card</option>
        <option value="ebu">EBU Convention Card (A4)</option>
        <option value="wbf">WBF System Card (A4 landscape)</option>
      </select>
      <span style="font-size:0.75rem;color:#888">Use Print → Save as PDF for a reference card.</span>
      <button class="btn btn-primary" id="btn-print" style="margin-left:auto">🖨 Print / Save as PDF</button>
    </div>
    <iframe id="print-preview"
      style="flex:1;min-height:0;margin-top:0.5rem;border:1px solid var(--border);border-radius:4px;background:#fff">
    </iframe>`;
  document.getElementById('print-format').value = currentFormat;
  document.getElementById('print-format').addEventListener('change', e => {
    currentFormat = e.target.value; updatePreview(sys);
  });
  document.getElementById('btn-print').addEventListener('click', () =>
    document.getElementById('print-preview')?.contentWindow?.print());
  updatePreview(sys);
}

function updatePreview(sys) {
  const iframe = document.getElementById('print-preview');
  if (!iframe) return;
  const gen = { booklet: generateBooklet, acbl: generateACBL, ebu: generateEBU, wbf: generateWBF }[currentFormat];
  if (gen) iframe.srcdoc = gen(sys);
}

// ─── Call formatting ──────────────────────────────────────────────────────────
const SYM = { C:'♣', D:'♦', H:'♥', S:'♠', N:'NT' };
const COL = { C:'#111', D:'#b00', H:'#b00', S:'#111', N:'#111' };

function pc(call) {
  if (!call) return '';
  if (call.type === 'pass')     return 'Pass';
  if (call.type === 'double')   return 'Dbl';
  if (call.type === 'redouble') return 'Rdbl';
  if (call.type === 'bid') {
    const c = COL[call.strain] ?? '#111';
    return `${call.level}<span style="color:${c};font-weight:bold">${SYM[call.strain]??call.strain}</span>`;
  }
  return callToString(call);
}
function ps(st) {
  return `<span style="color:${COL[st]??'#111'};font-weight:bold">${SYM[st]??st}</span>`;
}

// ─── Variant helpers ──────────────────────────────────────────────────────────
function condLabel(cond) {
  const p = [];
  if (cond?.seats?.length) p.push(`Seat${cond.seats.length>1?'s':''} ${cond.seats.join(',')}`);
  if (cond?.vul?.length)   p.push(cond.vul.map(v=>v.toUpperCase()).join('/'));
  return p.join(' · ') || 'Default';
}

function extr(m) {
  return [
    m?.hcp     ? `[${m.hcp[0]??''}–${m.hcp[1]??''}]` : '',
    m?.shape   ?? '',
    m?.forcing ? `<i>${m.forcing}</i>` : '',
    m?.announce? `<i>"${m.announce}"</i>` : '',
    m?.alert   ? '<b style="color:#b00">!</b>' : '',
  ].filter(Boolean).join(' · ');
}

function variantInline(variants) {
  if (!variants?.length) return '';
  return variants.map(v => {
    const vm = v.meaningOverride ?? {};
    const label = condLabel(v.condition);
    const desc = [vm.description??'', vm.hcp?`[${vm.hcp[0]??''}–${vm.hcp[1]??''}]`:'', vm.shape??''].filter(Boolean).join(' ');
    return `${label}: ${desc||'—'}`;
  }).join('  /  ');
}

// ─── Convention-ref expansion ─────────────────────────────────────────────────
function contsHtml(cont, sys, depth, visited, compact) {
  if (!cont || cont.type==='tbd' || cont.type==='end') return '';
  if (cont.type==='nodes') return treeHtml(cont.nodes, sys, depth, visited, compact);
  if (cont.type==='ref') {
    const id = cont.conventionId;
    const cv = (sys.conventions??{})[id];
    if (!cv) return '';
    const pl = depth * 13;
    if (visited.has(id))
      return `<div style="padding-left:${pl}px;color:#069;font-size:7.5pt;font-style:italic">↩ ${cv.name} (see above)</div>`;
    const sub = new Set(visited); sub.add(id);
    return `<div style="padding-left:${pl}px;margin:3px 0;border-left:2px solid #9bd">
      <div style="padding-left:5px;font-size:7.5pt;color:#069;font-weight:600;margin-bottom:1px">▶ ${cv.name}</div>
      <div style="padding-left:5px">${treeHtml(cv.nodes??[], sys, depth, sub, compact)||'<span style="color:#aaa;font-style:italic">Empty</span>'}</div>
    </div>`;
  }
  return '';
}

// ─── Tree → HTML ──────────────────────────────────────────────────────────────
// compact=false (booklet): variants as full peer blocks with their own continuations
// compact=true  (cards):   variants as a single italic sub-line, tighter layout
function treeHtml(nodes, sys, depth=0, visited=new Set(), compact=false) {
  if (!nodes?.length) return '';
  const pl = depth * 13;
  return sortNodes(nodes).map(nd => {
    const m = nd.meaning ?? {};
    const ex = extr(m);
    const note = m.notes && !compact
      ? `<div style="padding-left:${pl+13}px;color:#666;font-size:7.5pt;font-style:italic">${m.notes}</div>` : '';

    const mainRow =
      `<div style="padding-left:${pl}px;line-height:1.5;page-break-inside:avoid">` +
      `<span class="bc">${pc(nd.call)}</span> ` +
      `<span class="bd">${m.description??''}</span>` +
      (ex ? ` <span class="be">${ex}</span>` : '') +
      `</div>`;

    let varHtml = '';
    if (nd.variants?.length) {
      if (compact) {
        const line = variantInline(nd.variants);
        if (line) varHtml = `<div style="padding-left:${pl+13}px;font-size:7pt;color:#777;font-style:italic">${line}</div>`;
      } else {
        varHtml = nd.variants.map(v => {
          const vm = v.meaningOverride ?? {};
          const vex = extr(vm);
          const vnote = v.notes ? `<span style="color:#888;font-style:italic"> — ${v.notes}</span>` : '';
          let vConts = '';
          if (v.continuationOverride) {
            vConts = contsHtml(v.continuationOverride, sys, depth+2, visited, false);
          } else if (v.continuationDiff?.length) {
            vConts = `<div style="padding-left:${(depth+2)*13}px;color:#888;font-size:7.5pt;font-style:italic">${v.continuationDiff.length} modification(s) to base responses</div>`;
          }
          return `<div style="padding-left:${pl+4}px;margin:2px 0 4px;border-left:2.5px solid #c80">
            <div style="padding-left:6px;line-height:1.4">
              <span style="font-size:7.5pt;color:#c60;font-weight:700">[${condLabel(v.condition)}]</span>
              ${vm.description ? `<span class="bd"> ${vm.description}</span>` : ''}
              ${vex ? `<span class="be"> ${vex}</span>` : ''}${vnote}
            </div>
            ${vConts ? `<div style="padding-left:6px">${vConts}</div>` : ''}
          </div>`;
        }).join('');
      }
    }

    const kids = contsHtml(nd.continuations, sys, depth+1, visited, compact);
    return mainRow + note + varHtml + kids;
  }).join('');
}

// ─── Carding table ────────────────────────────────────────────────────────────
function ctable(rules) {
  if (!rules?.length) return '<p class="none">None defined.</p>';
  return `<table><thead><tr><th>Context</th><th>Method</th><th>Notes</th></tr></thead><tbody>
    ${rules.map(r=>`<tr><td>${r.context||'—'}</td><td>${r.method||'—'}</td><td class="mu">${r.notes||''}</td></tr>`).join('')}
  </tbody></table>`;
}

function convSections(sys, compact=false) {
  const convs = Object.values(sys.conventions??{});
  if (!convs.length) return '';
  return convs.map(cv =>
    `<h3>${cv.name}${cv.description?` <span style="font-weight:normal;color:#666"> — ${cv.description}</span>`:''}</h3>
     ${treeHtml(cv.nodes??[], sys, 0, new Set([cv.id]), compact)||'<p class="none">Empty.</p>'}`
  ).join('');
}

function findBid(nodes, lv, st) {
  return (nodes??[]).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
}

function bidRow(node, label, sys) {
  const m = node?.meaning ?? {};
  const hcp = m.hcp ? `${m.hcp[0]??''}–${m.hcp[1]??''}` : '';
  const vline = node?.variants?.length ? variantInline(node.variants) : '';
  return `<tr>
    <td style="font-weight:700;white-space:nowrap">${label}</td>
    <td>${m.description??'—'}${vline?`<div style="font-size:7pt;color:#777;font-style:italic">${vline}</div>`:''}</td>
    <td class="mu">${[hcp,m.shape].filter(Boolean).join(' · ')}</td>
  </tr>`;
}

function respTable(node, sys) {
  if (!node) return '<p class="none">—</p>';
  let kids = [];
  if (node.continuations?.type==='nodes') {
    kids = sortNodes(node.continuations.nodes);
  } else if (node.continuations?.type==='ref') {
    const cv = (sys.conventions??{})[node.continuations.conventionId];
    kids = cv ? sortNodes(cv.nodes??[]) : [];
  }
  if (!kids.length) {
    if (node.continuations?.type==='ref') {
      const cv = (sys.conventions??{})[node.continuations.conventionId];
      return `<p class="none" style="font-style:italic;color:#069">→ ${cv?.name??'Convention reference'}</p>`;
    }
    return '<p class="none">—</p>';
  }
  return `<table><tbody>${kids.map(n => {
    const nm = n.meaning??{};
    const hcp = nm.hcp?`${nm.hcp[0]??''}–${nm.hcp[1]??''}`:' ';
    const vline = n.variants?.length ? variantInline(n.variants) : '';
    return `<tr>
      <td class="bc" style="white-space:nowrap">${pc(n.call)}</td>
      <td class="bd">${nm.description??''}${vline?`<div style="font-size:6.5pt;color:#777;font-style:italic">${vline}</div>`:''}</td>
      <td class="mu">${[hcp,nm.shape,nm.forcing].filter(Boolean).join(' · ')}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

// ─── Shared CSS ───────────────────────────────────────────────────────────────
const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111;line-height:1.35}
  h1{font-size:15pt;font-weight:700}
  h2{font-size:10pt;font-weight:700;border-bottom:1.5px solid #444;padding-bottom:2px;margin:10px 0 4px;color:#222}
  h3{font-size:8.5pt;margin:7px 0 2px;color:#333;font-weight:600}
  .bc{font-weight:700;display:inline-block;min-width:28px}
  .bd{font-size:8.5pt}
  .be{font-size:7.5pt;color:#555}
  .mu{color:#666;font-size:7.5pt}
  .none{color:#888;font-style:italic;font-size:7.5pt;padding:1px 0}
  table{border-collapse:collapse;width:100%;font-size:8pt;margin:3px 0}
  th,td{border:1px solid #bbb;padding:2px 5px;vertical-align:top;text-align:left}
  th{background:#e6e6e6;font-weight:600}
`;
function wrap(title, pageStyle, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>${CSS}${pageStyle}</style></head><body>${body}</body></html>`;
}

// ─── Generators ───────────────────────────────────────────────────────────────
function generateBooklet(sys) {
  const c = sys.carding ?? {};
  const date = sys.metadata?.modified?.slice(0,10) ?? '';
  const body = `
    <div style="text-align:center;padding:55px 0 28px;border-bottom:2px solid #444;margin-bottom:14px">
      <h1>${sys.name}</h1>
      <p style="color:#666;margin-top:8px;font-size:10pt">System Booklet · ${date}</p>
    </div>
    <h2>Opening Bids</h2>
    ${treeHtml(sys.openings??[], sys, 0, new Set(), false)||'<p class="none">None defined.</p>'}
    ${(sys.overcalls??[]).length?`<h2>Overcalls &amp; Defensive Bids</h2>${treeHtml(sys.overcalls, sys, 0, new Set(), false)}`:''}
    ${convSections(sys,false)?`<h2>Convention Library</h2>${convSections(sys,false)}`:''}
    <h2>Carding</h2>
    <h3>Signals</h3>${ctable(c.signals)}
    <h3>Discards</h3>${ctable(c.discards)}
    <h3>Leads</h3>${ctable(c.leads)}`;
  return wrap(sys.name, `@page{size:A4;margin:16mm 18mm}`, body);
}

function generateACBL(sys) {
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const date=sys.metadata?.modified?.slice(0,10)??'';
  const op1=['C','D','H','S','N'].map(st=>findBid(op,1,st));
  const op2=['C','D','H','S','N'].map(st=>findBid(op,2,st));
  const body = `
    <div style="font-size:12pt;font-weight:700;margin-bottom:2px">ACBL Convention Card — ${sys.name}</div>
    <div class="mu" style="margin-bottom:8px">${date}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">
      <div>
        <h2>Opening Bids</h2>
        <table><thead><tr><th>Bid</th><th>Meaning &amp; variants</th><th>HCP · Shape</th></tr></thead><tbody>
          ${['C','D','H','S','N'].map((st,i)=>bidRow(op1[i],`1${ps(st)}`,sys)).join('')}
          ${['C','D','H','S','N'].map((st,i)=>bidRow(op2[i],`2${ps(st)}`,sys)).join('')}
          ${bidRow(findBid(op,3,'N'),`3${ps('N')}`,sys)}
        </tbody></table>
        <h2>1${ps('N')} Responses</h2>${respTable(findBid(op,1,'N'),sys)}
        <h2>2${ps('C')} Responses</h2>${respTable(findBid(op,2,'C'),sys)}
        ${ov.length?`<h2>Overcalls / Competitive</h2>${treeHtml(ov,sys,0,new Set(),true)}`:''}
      </div>
      <div>
        <h2>Leads vs Suit</h2>${ctable((c.leads??[]).filter(r=>/suit|trump|color/i.test(r.context??'')))||ctable([])}
        <h2>Leads vs NT</h2>${ctable((c.leads??[]).filter(r=>/nt|notrump/i.test(r.context??'')))||ctable([])}
        <h2>All Leads</h2>${ctable(c.leads)}
        <h2>Signals</h2>${ctable(c.signals)}
        <h2>Discards</h2>${ctable(c.discards)}
        ${convSections(sys,true)?`<h2>Conventions</h2>${convSections(sys,true)}`:''}
      </div>
    </div>`;
  return wrap(`${sys.name} — ACBL`, `@page{size:letter;margin:10mm 13mm}body{font-size:8.5pt}`, body);
}

function generateEBU(sys) {
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const date=sys.metadata?.modified?.slice(0,10)??'';
  const op1=op.filter(n=>n.call?.type==='bid'&&n.call.level===1);
  const op2plus=op.filter(n=>n.call?.type==='bid'&&n.call.level>=2);
  const body = `
    <div style="font-size:12pt;font-weight:700;margin-bottom:2px">EBU Convention Card — ${sys.name}</div>
    <div class="mu" style="margin-bottom:8px">${date}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">
      <div>
        <h2>1-Level Openings</h2>
        ${treeHtml(op1,sys,0,new Set(),true)||'<p class="none">None.</p>'}
        ${op2plus.length?`<h2>2+ Level Openings</h2>${treeHtml(op2plus,sys,0,new Set(),true)}`:''}
        ${ov.length?`<h2>Competitive Bidding</h2>${treeHtml(ov,sys,0,new Set(),true)}`:''}
      </div>
      <div>
        <h2>Opening Leads</h2>${ctable(c.leads)}
        <h2>Signals</h2>${ctable(c.signals)}
        <h2>Discards</h2>${ctable(c.discards)}
        ${convSections(sys,true)?`<h2>Conventions</h2>${convSections(sys,true)}`:''}
      </div>
    </div>`;
  return wrap(`${sys.name} — EBU`, `@page{size:A4;margin:12mm 14mm}body{font-size:8.5pt}`, body);
}

function generateWBF(sys) {
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const date=sys.metadata?.modified?.slice(0,10)??'';
  const body = `
    <div style="font-size:12pt;font-weight:700;margin-bottom:2px">WBF System Card — ${sys.name}</div>
    <div class="mu" style="margin-bottom:6px">${date}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px">
      <div>
        <h2>Opening Bids</h2>
        ${treeHtml(op,sys,0,new Set(),true)||'<p class="none">None defined.</p>'}
      </div>
      <div>
        ${ov.length?`<h2>Competitive / Overcalls</h2>${treeHtml(ov,sys,0,new Set(),true)}`:''}
        ${convSections(sys,true)?`<h2>Conventions</h2>${convSections(sys,true)}`:''}
      </div>
      <div>
        <h2>Opening Leads</h2>${ctable(c.leads)}
        <h2>Signals</h2>${ctable(c.signals)}
        <h2>Discards</h2>${ctable(c.discards)}
      </div>
    </div>`;
  return wrap(`${sys.name} — WBF`, `@page{size:A4 landscape;margin:9mm 12mm}body{font-size:8pt}`, body);
}
