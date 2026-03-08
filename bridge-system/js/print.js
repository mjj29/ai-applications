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
  // ACBL Convention Card: two-column, categorised by opening type (Minors / Majors / NT / 2-level)
  // Right column: Competitive, Conventions, Carding
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const date=sys.metadata?.modified?.slice(0,10)??'';
  const f = (lv,st) => findBid(op,lv,st);
  const hcpStr = nd => { const h=nd?.meaning?.hcp; return h?`${h[0]??''}–${h[1]??''}`:''; };

  // Bordered ACBL-style section with dark-blue header bar
  const box = (title, content) =>
    `<div style="border:1px solid #999;margin-bottom:5px">
      <div style="background:#223366;color:#fff;font-size:7pt;font-weight:700;padding:2px 5px;letter-spacing:.07em;text-transform:uppercase">${title}</div>
      <div style="padding:3px 5px">${content}</div>
    </div>`;

  // Key–value field row
  const fl = (label, value) =>
    `<div style="display:flex;gap:4px;padding:1px 0;border-bottom:1px dotted #e4e4e4;min-height:13px">
      <span style="color:#555;font-size:7pt;min-width:90px;flex-shrink:0">${label}</span>
      <span style="font-size:8pt;flex:1">${value||''}</span>
    </div>`;

  // Opening bid table row: bid | description (+ variants) | HCP | shape
  const opRow = (nd, label) => {
    const m = nd?.meaning??{};
    const hcp = hcpStr(nd);
    const vline = nd?.variants?.length
      ? `<div style="font-size:6.5pt;color:#666;font-style:italic;margin-top:1px">${variantInline(nd.variants)}</div>` : '';
    return `<tr>
      <td style="white-space:nowrap;font-weight:700;width:26px">${label}</td>
      <td>${m.description??'—'}${m.alert?` <b style="color:#c00">!</b>`:''}${m.announce?` <i style="color:#555">"${m.announce}"</i>`:''}${vline}</td>
      <td style="white-space:nowrap;font-size:7pt;width:50px;color:#333">${hcp}</td>
      <td style="font-size:7pt;color:#555;width:70px">${m.shape??''}</td>
    </tr>`;
  };

  // Compact carding line list
  const sigLines = arr => arr?.length
    ? arr.map(s=>`<div style="display:flex;gap:4px;border-bottom:1px dotted #eee;padding:1px 0">
        <span style="color:#555;font-size:7pt;min-width:85px;flex-shrink:0">${s.context||''}</span>
        <span style="font-size:8pt;font-weight:600">${s.method||''}</span>
        ${s.notes?`<span style="font-size:6.5pt;color:#777;font-style:italic"> — ${s.notes}</span>`:''}
      </div>`).join('')
    : '<span style="color:#999;font-style:italic;font-size:7.5pt">None defined</span>';

  const n1 = f(1,'N'), c2 = f(2,'C');

  const leftCol = `
    ${box('Overview', `
      ${fl('General Approach', sys.metadata?.description ?? sys.name)}
      ${fl('Notes', sys.metadata?.notes ?? '')}
      ${fl('1NT Opening', n1 ? `${hcpStr(n1)} HCP${n1.meaning?.shape?' · '+n1.meaning.shape:''}` : '')}
      ${fl('Strong Opening', c2 ? `2♣ — ${c2.meaning?.description??'Strong, artificial'}` : '')}
    `)}
    ${box('Minors', `
      <table style="margin:0"><tbody>
        ${opRow(f(1,'C'),'1♣')}
        ${opRow(f(1,'D'),'1♦')}
      </tbody></table>
    `)}
    ${box('Majors', `
      <table style="margin:0"><tbody>
        ${opRow(f(1,'H'),'1♥')}
        ${opRow(f(1,'S'),'1♠')}
      </tbody></table>
    `)}
    ${box('NoTrump Opening', n1 ? `
      ${fl('Range', hcpStr(n1)+' HCP')}
      ${fl('Shape', n1.meaning?.shape??'Balanced')}
      ${fl('Announce', n1.meaning?.announce??'')}
      <div style="font-size:7.5pt;font-weight:700;margin:3px 0 2px">Responses:</div>
      ${respTable(n1,sys)}
    ` : '<p class="none">No 1NT defined.</p>')}
    ${box('2-Level Openings', `
      <table style="margin:0"><tbody>
        ${['C','D','H','S','N'].map(st=>opRow(f(2,st),`2${ps(st)}`)).join('')}
      </tbody></table>
      ${c2 ? `<div style="font-size:7.5pt;font-weight:700;margin:3px 0 2px">2♣ Responses:</div>${respTable(c2,sys)}` : ''}
    `)}
    ${op.filter(n=>n.call?.type==='bid'&&n.call.level>=3).length ? box('Preempts', `
      <table style="margin:0"><tbody>
        ${op.filter(n=>n.call?.type==='bid'&&n.call.level>=3).map(nd=>opRow(nd,pc(nd.call))).join('')}
      </tbody></table>
    `) : ''}
  `;

  const rightCol = `
    ${ov.length ? box('Overcalls &amp; Competitive', treeHtml(ov,sys,0,new Set(),true)) : ''}
    ${convSections(sys,true) ? box('Conventions', convSections(sys,true)) : ''}
    ${box('Opening Leads', sigLines(c.leads))}
    ${box('Signals', sigLines(c.signals))}
    ${c.discards?.length ? box('Discards', sigLines(c.discards)) : ''}
  `;

  const body = `
    <div style="font-size:11pt;font-weight:700;border-bottom:2px solid #223366;padding-bottom:3px;margin-bottom:7px;color:#223366">
      ACBL Convention Card
      <span style="font-size:9pt;font-weight:400;color:#333;margin-left:10px">— ${sys.name}</span>
      <span style="font-size:8pt;font-weight:400;color:#888;margin-left:8px">${date}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;align-items:start">
      <div>${leftCol}</div>
      <div>${rightCol}</div>
    </div>`;
  const extraCss = `@page{size:letter;margin:10mm 12mm}body{font-size:8.5pt}
    table th{background:#dde4f0} .bc{min-width:24px}`;
  return wrap(`${sys.name} — ACBL`, extraCss, body);
}

function generateEBU(sys) {
  // EBU Convention Card 20B — faithful four-page reproduction of official form
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const f = (lv,st) => findBid(op,lv,st);
  const hcpStr = nd => { const h=nd?.meaning?.hcp; return h?`${h[0]??''}–${h[1]??''}`:''; };
  const n1=f(1,'N');

  // Section header bar (dark green)
  const sh = txt => `<div class="sh">${txt}</div>`;
  // Sub-section header (light green)
  const subh = txt => `<div class="sub-hdr">${txt}</div>`;
  // Labelled field row: label left, underlined value area right
  const fr = (label, value='') =>
    `<div class="fr"><span class="fl">${label}</span><div class="fv">${value}</div></div>`;
  // Labelled field row with checkbox
  const frc = label =>
    `<div class="fr"><span class="fl"><span class="cb"></span>&thinsp;${label}</span><div class="fv"></div></div>`;

  // Get 1NT response description for a given 2-level strain
  const nt1Resp = st => {
    const cont = n1?.continuations;
    if (!cont || cont.type !== 'nodes') return '';
    const nd = (cont.nodes??[]).find(n => n.call?.type==='bid' && n.call?.level===2 && n.call?.strain===st);
    return nd?.meaning?.description ?? '';
  };

  // Two-level opening table row
  const twoLvlRow = st => {
    const nd = f(2,st), m=nd?.meaning??{};
    const hcp = hcpStr(nd);
    const resp = (() => {
      const cont = nd?.continuations;
      if (!cont||cont.type==='tbd'||cont.type==='end') return '';
      if (cont.type==='ref') { const cv=(sys.conventions??{})[cont.conventionId]; return cv?`\u2192 ${cv.name}`:''; }
      if (cont.type==='nodes') return sortNodes(cont.nodes).slice(0,3).map(n=>`${pc(n.call)}: ${n.meaning?.description??''}`).join('; ');
      return '';
    })();
    const vline = nd?.variants?.length ? ` [${variantInline(nd.variants)}]` : '';
    const notes = [hcp?`${hcp} HCP`:'', m.shape].filter(Boolean).join(' ');
    return `<tr><td class="bc" style="width:30px">2${ps(st)}</td><td>${(m.description??'')+vline}</td><td style="font-size:7.5pt">${resp}</td><td class="mu" style="font-size:7pt">${notes}</td></tr>`;
  };

  // Other opening bid row (page 2)
  const otherOpRow = (nd, label) => {
    const m = nd?.meaning??{};
    const hcp = hcpStr(nd);
    const art = m.alert||m.announce ? `<b style="color:#c00">*</b>` : '';
    let minLen = '';
    if (m.shape) { const nm=m.shape.match(/\d+/); if (nm) minLen=nm[0]; }
    const resp = nd ? (() => {
      const cont = nd.continuations;
      if (!cont||cont.type==='tbd'||cont.type==='end') return '';
      if (cont.type==='ref') { const cv=(sys.conventions??{})[cont.conventionId]; return cv?`\u2192 ${cv.name}`:''; }
      if (cont.type==='nodes') return sortNodes(cont.nodes).slice(0,3).map(n=>`${pc(n.call)}: ${n.meaning?.description??''}`).join('; ');
      return '';
    })() : '';
    const vline = nd?.variants?.length ? `<span style="font-size:6.5pt;color:#555;font-style:italic"> [${variantInline(nd.variants)}]</span>` : '';
    return `<tr>
      <td class="bc">${label}</td>
      <td style="text-align:center;white-space:nowrap">${hcp}</td>
      <td style="text-align:center"></td>
      <td style="text-align:center">${minLen}</td>
      <td>${art}${m.description??''}${vline}</td>
      <td style="font-size:7.5pt">${resp}</td>
      <td></td>
    </tr>`;
  };

  const slamConvs = Object.values(sys.conventions??{}).filter(cv => /slam|blackwood|gerber|keycard|rkcb/i.test((cv.name??'')+(cv.description??'')));
  const otherConvs = Object.values(sys.conventions??{}).filter(cv => !/slam|blackwood|gerber|keycard|rkcb/i.test((cv.name??'')+(cv.description??'')));
  const op3 = op.filter(n => n.call?.type==='bid' && n.call.level===3);
  const op4 = op.filter(n => n.call?.type==='bid' && n.call.level===4);

  const leadsVsSuit = (c.leads??[]).filter(r => !r.context || /suit|trump/i.test(r.context));
  const leadsVsNT   = (c.leads??[]).filter(r => r.context && /nt|notrump/i.test(r.context));
  const suitSig  = (c.signals??[]).find(r => !r.context || /suit/i.test(r.context))?.method ?? '';
  const ntSig    = (c.signals??[]).find(r => r.context && /nt/i.test(r.context))?.method ?? suitSig;
  const suitDisc = (c.discards??[]).find(r => !r.context || /suit/i.test(r.context))?.method ?? '';
  const ntDisc   = (c.discards??[]).find(r => r.context && /nt/i.test(r.context))?.method ?? suitDisc;
  const combos = ['AK','AKx','KQ10','KQx','KJ10','K109','QJ10','QJx','J10x','10xx','109x','987x','10xxx','Hxx','Hxxx','Hxxxx','Hxxxxx','xx','xxx','xxxx','xxxxx'];

  // ─── Page 1 ─────────────────────────────────────────────────────────────────
  const page1 = `<div class="page">
  <table class="hdr-tbl"><tbody><tr>
    <td>Name:&thinsp;<b>${sys.name??''}</b></td>
    <td>EBU No:</td>
    <td>Partner:</td>
    <td>EBU No:</td>
  </tr></tbody></table>
  <div class="sec">
    ${sh('GENERAL DESCRIPTION OF BIDDING METHODS')}
    <div class="gen-area">${sys.metadata?.description??sys.name??''}${sys.metadata?.notes?`<br><span class="mu" style="font-style:italic">${sys.metadata.notes}</span>`:''}</div>
  </div>
  <div class="sec">
    ${sh('1NT OPENINGS AND RESPONSES')}
    ${frc('Tick if artificial and provide details below')}
    ${fr('Strength', hcpStr(n1)+' HCP')}
    ${frc('Tick if may have singleton')}
    ${fr('Shape constraints', n1?.meaning?.shape??'')}
    ${subh('Responses')}
    ${fr('2\u2663', nt1Resp('C'))}
    ${fr('2\u2666', nt1Resp('D'))}
    ${fr('2\u2665', nt1Resp('H'))}
    ${fr('2\u2660', nt1Resp('S'))}
    ${fr('2NT', nt1Resp('N'))}
    ${fr('Others', '')}
    ${fr('Action after opponents double', '')}
    ${fr('Action after other interference', '')}
  </div>
  <div class="sec">
    ${sh('TWO-LEVEL OPENINGS AND RESPONSES')}
    <table class="form-tbl"><thead><tr>
      <th style="width:30px"></th><th>Meaning</th><th>Responses</th><th style="width:70px">Notes</th>
    </tr></thead><tbody>
      ${['C','D','H','S','N'].map(twoLvlRow).join('')}
    </tbody></table>
  </div>
  <div class="sec">
    ${sh('OTHER ASPECTS OF SYSTEM WHICH OPPONENTS SHOULD NOTE')}
    <div class="gen-area sm">${sys.metadata?.otherAspects??''}</div>
    <div class="mu" style="font-size:6pt;padding:2px 5px">(Please include details of any agreements involving bidding on significantly less than traditional values).</div>
  </div>
  <div class="footer-bar">
    Both players of a partnership must have identically completed convention cards.
    Cards must be exchanged with opponents for each round.
    <span style="float:right">Jan 2016 &nbsp; <b>EBU 20B</b></span>
  </div>
</div>`;

  // ─── Page 2 ─────────────────────────────────────────────────────────────────
  const page2 = `<div class="page pb">
  <div class="sec">
    ${sh('OTHER OPENING BIDS')}
    <table class="form-tbl"><thead><tr>
      <th style="width:30px">Bid</th>
      <th style="width:55px;text-align:center">HCP*</th>
      <th style="width:18px;text-align:center;font-size:5.5pt">see<br>Note</th>
      <th style="width:28px;text-align:center">Min<br>length</th>
      <th>CONVENTIONAL MEANING</th>
      <th>SPECIAL RESPONSES</th>
      <th style="width:35px">Notes</th>
    </tr></thead><tbody>
      ${otherOpRow(f(1,'C'), `1${ps('C')}`)}
      ${otherOpRow(f(1,'D'), `1${ps('D')}`)}
      ${otherOpRow(f(1,'H'), `1${ps('H')}`)}
      ${otherOpRow(f(1,'S'), `1${ps('S')}`)}
      ${op3.length ? op3.map(nd=>otherOpRow(nd,pc(nd.call))).join('') : `<tr><td class="mu" style="font-size:7pt;font-style:italic">3 bids</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`}
      ${op4.length ? op4.map(nd=>otherOpRow(nd,pc(nd.call))).join('') : `<tr><td class="mu" style="font-size:7pt;font-style:italic">4 bids</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`}
    </tbody></table>
    <div class="mu" style="font-size:5.5pt;padding:2px 5px">* Please enter your normal HCP range in the HCP column. Please tick box if you have any special agreements involving different values in particular positions (e.g. light openings in third seat) and include further details under Supplementary Details.</div>
  </div>
  <div class="sec">
    ${sh('DEFENSIVE METHODS AFTER OPPONENTS OPEN')}
    ${subh('OPPONENTS OPEN A NATURAL ONE OF A SUIT')}
    <table class="form-tbl"><thead><tr>
      <th style="width:110px"></th>
      <th>CONVENTIONAL MEANING</th>
      <th>SPECIAL RESPONSES</th>
      <th style="width:40px">Notes</th>
    </tr></thead><tbody>
      <tr><td>Simple overcall</td><td>${ov.find(n=>n.call?.type==='bid'&&n.call?.level===1&&n.call?.strain!=='N')?.meaning?.description??''}</td><td></td><td></td></tr>
      <tr><td>Jump overcall</td><td></td><td></td><td></td></tr>
      <tr><td>Cue bid</td><td></td><td></td><td></td></tr>
      <tr><td>1NT Direct:</td><td>${ov.find(n=>n.call?.type==='bid'&&n.call?.level===1&&n.call?.strain==='N')?.meaning?.description??''}</td><td></td><td></td></tr>
      <tr><td>&nbsp;&nbsp;&nbsp;Protective:</td><td></td><td></td><td></td></tr>
      <tr><td>2NT Direct:</td><td>${ov.find(n=>n.call?.type==='bid'&&n.call?.level===2&&n.call?.strain==='N')?.meaning?.description??''}</td><td></td><td></td></tr>
      <tr><td>&nbsp;&nbsp;&nbsp;Protective:</td><td></td><td></td><td></td></tr>
    </tbody></table>
    ${subh('OPPONENTS OPEN WITH')}
    <table class="form-tbl"><thead><tr>
      <th style="width:110px">Opponents open</th>
      <th>DEFENSIVE METHODS</th>
      <th>SPECIAL RESPONSES</th>
      <th style="width:40px">Notes</th>
    </tr></thead><tbody>
      <tr><td>Strong 1\u2663</td><td></td><td></td><td></td></tr>
      <tr><td>Short 1\u2663/1\u2666</td><td></td><td></td><td></td></tr>
      <tr><td>Weak 1NT</td><td></td><td></td><td></td></tr>
      <tr><td>Strong 1NT</td><td></td><td></td><td></td></tr>
      <tr><td>Weak 2</td><td></td><td></td><td></td></tr>
      <tr><td>Weak 3</td><td></td><td></td><td></td></tr>
      <tr><td>4 bids</td><td></td><td></td><td></td></tr>
      <tr><td>Multi 2\u2666</td><td></td><td></td><td></td></tr>
    </tbody></table>
  </div>
  <div class="sec">
    ${sh('SLAM CONVENTIONS')}
    <table class="form-tbl"><thead><tr>
      <th>Name</th><th>Meaning of Responses</th><th>Action over interference</th>
    </tr></thead><tbody>
      ${slamConvs.length ? slamConvs.map(cv=>`<tr>
        <td style="white-space:nowrap">${cv.name??''}</td>
        <td style="font-size:7.5pt">${cv.description??''}</td>
        <td></td>
      </tr>`).join('') : ''}
      <tr><td style="height:18px"></td><td></td><td></td></tr>
      <tr><td style="height:18px"></td><td></td><td></td></tr>
    </tbody></table>
  </div>
</div>`;

  // ─── Page 3 ─────────────────────────────────────────────────────────────────
  const page3 = `<div class="page pb">
  <div class="sec">
    ${sh('COMPETITIVE AUCTIONS')}
    ${subh('Agreements after opening of one of a suit and overcall by opponents')}
    ${fr('Level to which negative doubles apply', '')}
    ${fr('Special meaning of bids', '')}
    ${fr('Exceptions / other agreements', '')}
    ${subh('Agreements after opponents double for takeout')}
    <table class="form-tbl"><thead><tr>
      <th>Redouble</th><th>New suit</th><th>Jump in new suit</th><th>Jump raise</th><th>2NT</th><th>Other</th>
    </tr></thead><tbody>
      <tr><td style="height:20px"></td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody></table>
    ${fr('Other agreements concerning doubles and redoubles', '')}
  </div>
  <div class="sec">
    ${sh('OTHER CONVENTIONS')}
    ${otherConvs.length
      ? otherConvs.map(cv => fr(cv.name??'', cv.description??'')).join('')
      : '<div class="gen-area sm"></div>'}
  </div>
  <div class="sec">
    ${sh('SUPPLEMENTARY DETAILS')}
    <div class="gen-area">${sys.metadata?.supplementary??''}</div>
    <div class="mu" style="font-size:6pt;padding:2px 5px">(Please cross-reference where appropriate to the relevant part of card, and continue on back if needed).</div>
  </div>
</div>`;

  // ─── Page 4 ─────────────────────────────────────────────────────────────────
  const page4 = `<div class="page pb">
  <div class="sec">
    ${sh('OPENING LEADS')}
    <div class="mu" style="font-size:6pt;padding:2px 5px 1px">For all the card combinations shown, clearly mark the card normally led if different from the underlined card.</div>
    ${subh('v. suit contracts')}
    <div style="overflow-x:auto"><table class="leads-tbl"><thead><tr>
      ${combos.map(cx=>`<th>${cx}</th>`).join('')}
    </tr></thead><tbody>
      <tr>${combos.map(()=>`<td></td>`).join('')}</tr>
    </tbody></table></div>
    ${leadsVsSuit.length ? `<div class="mu" style="font-size:7pt;padding:1px 5px">Method: ${leadsVsSuit.map(l=>l.method).join(' \u00b7 ')}</div>` : ''}
    ${subh('v. NT contracts')}
    <div style="overflow-x:auto"><table class="leads-tbl"><thead><tr>
      ${combos.map(cx=>`<th>${cx}</th>`).join('')}
    </tr></thead><tbody>
      <tr>${combos.map(()=>`<td></td>`).join('')}</tr>
    </tbody></table></div>
    ${leadsVsNT.length ? `<div class="mu" style="font-size:7pt;padding:1px 5px">Method: ${leadsVsNT.map(l=>l.method).join(' \u00b7 ')}</div>` : ''}
    ${fr('Other agreements in leading, e.g. high level contracts, partnership suits', '')}
  </div>
  <div class="sec">
    ${sh('CARDING METHODS')}
    <table class="form-tbl"><thead><tr>
      <th style="width:160px"></th>
      <th>Primary method v. suit contracts</th>
      <th>Primary method v. NT contracts</th>
    </tr></thead><tbody>
      <tr><td>On Partner's lead</td><td>${suitSig}</td><td>${ntSig}</td></tr>
      <tr><td>On Declarer's lead</td><td></td><td></td></tr>
      <tr><td>When discarding</td><td>${suitDisc}</td><td>${ntDisc}</td></tr>
    </tbody></table>
    ${fr('Other carding agreements, including secondary methods (state when applicable) and exceptions to above', '')}
  </div>
  <div class="sec">
    ${sh('SUPPLEMENTARY DETAILS (continued)')}
    <div class="gen-area"></div>
  </div>
</div>`;

  const body = page1 + page2 + page3 + page4;

  const extraCss = `
    @page { size: A4; margin: 8mm 10mm }
    body { font-size: 8pt; }
    .page { max-width: 190mm; }
    .pb { page-break-before: always; }
    .hdr-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .hdr-tbl td { border: 1px solid #555; padding: 2px 6px; font-size: 8pt; }
    .sec { border: 1px solid #555; margin-bottom: 4px; }
    .sh { background: #005030; color: #fff; font-size: 7.5pt; font-weight: 700; padding: 2px 5px; letter-spacing: .06em; text-transform: uppercase; }
    .sub-hdr { font-size: 7pt; font-weight: 700; background: #d4ead8; padding: 1px 5px; border-top: 1px solid #bbb; }
    .fr { display: flex; gap: 6px; padding: 1px 5px; border-bottom: 1px dotted #ccc; min-height: 15px; align-items: flex-end; }
    .fl { font-size: 7pt; color: #444; min-width: 130px; flex-shrink: 0; padding-bottom: 1px; }
    .fv { font-size: 8pt; flex: 1; border-bottom: 1px solid #999; min-height: 13px; padding: 0 2px; }
    .cb { display: inline-block; width: 9px; height: 9px; border: 1px solid #555; text-align: center; font-size: 7pt; line-height: 9px; vertical-align: middle; }
    .gen-area { min-height: 55px; padding: 4px 5px; font-size: 8pt; line-height: 18px; background-image: repeating-linear-gradient(to bottom, transparent 0px, transparent 17px, #ddd 17px, #ddd 18px); }
    .gen-area.sm { min-height: 30px; }
    .form-tbl { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .form-tbl th, .form-tbl td { border: 1px solid #888; padding: 2px 4px; vertical-align: top; text-align: left; }
    .form-tbl th { background: #d4ead8; font-size: 7pt; font-weight: 700; }
    .form-tbl td { min-height: 18px; }
    .leads-tbl { width: 100%; border-collapse: collapse; font-size: 6pt; table-layout: fixed; }
    .leads-tbl th { border: 1px solid #888; padding: 1px; background: #d4ead8; text-align: center; font-weight: 600; font-size: 5.5pt; }
    .leads-tbl td { border: 1px solid #888; padding: 0; height: 18px; text-align: center; }
    .footer-bar { font-size: 6.5pt; color: #444; border-top: 1px solid #aaa; padding: 3px 5px; margin-top: 4px; }
  `;
  return wrap(`${sys.name} — EBU 20B`, extraCss, body);
}

function generateWBF(sys) {
  // WBF System Card: landscape, two columns
  // Left: Lead style, Leads table, Signals table, Doubles/competitive
  // Right: System summary (General Approach), Opening Bid Descriptions table, Slam/conventions
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const date=sys.metadata?.modified?.slice(0,10)??'';
  const f = (lv,st) => findBid(op,lv,st);
  const hcpStr = nd => { const h=nd?.meaning?.hcp; return h?`${h[0]??''}–${h[1]??''}`:''; };

  const box = (title, content) =>
    `<div style="border:1px solid #999;margin-bottom:5px">
      <div style="background:#660000;color:#fff;font-size:7pt;font-weight:700;padding:2px 5px;letter-spacing:.06em;text-transform:uppercase">${title}</div>
      <div style="padding:3px 5px">${content}</div>
    </div>`;

  const fl = (label, value) =>
    `<div style="display:flex;gap:4px;padding:1px 0;border-bottom:1px dotted #e4e4e4;min-height:13px">
      <span style="color:#555;font-size:7pt;min-width:90px;flex-shrink:0">${label}</span>
      <span style="font-size:7.5pt;flex:1">${value||''}</span>
    </div>`;

  const sigLines = arr => arr?.length
    ? arr.map(s=>`<div style="display:flex;gap:4px;border-bottom:1px dotted #eee;padding:1px 0">
        <span style="color:#666;font-size:6.5pt;min-width:75px;flex-shrink:0">${s.context||''}</span>
        <span style="font-size:7.5pt;font-weight:600">${s.method||''}</span>
        ${s.notes?`<span style="font-size:6.5pt;color:#777;font-style:italic"> — ${s.notes}</span>`:''}
      </div>`).join('')
    : '<span class="none">None defined</span>';

  // WBF Opening Bid Descriptions table
  // Columns: Opening | Artif | Min | Neg Dbl | Description | Responses | Subsequent Auction
  const openingDescTable = () => {
    if (!op.length) return '<p class="none">No openings defined.</p>';
    return `<table style="font-size:7.5pt"><thead><tr>
      <th style="width:28px">Bid</th>
      <th style="width:18px;text-align:center">Art</th>
      <th style="width:22px;text-align:center">Min</th>
      <th style="width:30px;text-align:center">Neg Dbl</th>
      <th>Description</th>
      <th>Responses</th>
      <th>Subsequent / Notes</th>
    </tr></thead><tbody>${op.map(nd => {
      const m = nd.meaning??{};
      const isArt = m.alert||m.announce;
      const hcp = hcpStr(nd);
      let minLen = '';
      if (m.shape) { const nm=m.shape.match(/\d+/); if (nm) minLen=nm[0]; }
      // Responses summary
      const resp = (() => {
        const cont=nd.continuations;
        if (!cont||cont.type==='tbd'||cont.type==='end') return '';
        if (cont.type==='ref') {
          const cv=(sys.conventions??{})[cont.conventionId];
          return cv?`<i style="color:#069">→ ${cv.name}</i>`:'';
        }
        if (cont.type==='nodes')
          return sortNodes(cont.nodes).slice(0,5)
            .map(n=>`${pc(n.call)}: ${n.meaning?.description??''}`)
            .join('<br>');
        return '';
      })();
      const vline = nd.variants?.length
        ? `<span style="font-size:6pt;color:#777;font-style:italic"> [${variantInline(nd.variants)}]</span>` : '';
      return `<tr>
        <td class="bc">${pc(nd.call)}</td>
        <td style="text-align:center">${isArt?'✓':''}</td>
        <td style="text-align:center">${minLen}</td>
        <td style="text-align:center;font-size:7pt">${nd.call?.type==='bid'&&nd.call.level===1?'3'+SYM.S:''}</td>
        <td>${m.description??'—'}${hcp?` <span style="color:#555;font-size:7pt">[${hcp}]</span>`:''}${m.shape?` <i style="color:#555">${m.shape}</i>`:''}${vline}</td>
        <td style="font-size:7pt">${resp}</td>
        <td style="font-size:7pt;color:#555">${nd.continuations?.notes??m.notes??''}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  };

  // Signals priority table (WBF style: partner's lead / declarer's lead / discards by priority)
  const signalsPriorityTable = () => {
    const sigs = c.signals??[], discs = c.discards??[];
    const all = [...sigs, ...discs];
    if (!all.length) return '<p class="none">None defined.</p>';
    // Group by context for suit/NT rows
    const suitSigs = all.filter(s => !/nt|notrump/i.test(s.context??''));
    const ntSigs   = all.filter(s => /nt|notrump/i.test(s.context??''));
    const row = (label, arr) => arr.length
      ? `<tr><td style="font-size:7pt;width:30px">${label}</td>
           <td style="font-size:7.5pt">${arr.map(s=>s.method).join(' · ')}</td></tr>`
      : '';
    return `<table><thead><tr><th></th><th>Method</th></tr></thead><tbody>
      ${row('Suit', suitSigs)}${row('NT', ntSigs)}
    </tbody></table>`;
  };

  const n1=f(1,'N'), c2=f(2,'C');
  const leadsVsSuit = (c.leads??[]).filter(r=>/suit|trump/i.test(r.context??'')||!r.context);
  const leadsVsNT   = (c.leads??[]).filter(r=>/nt|notrump/i.test(r.context??''));

  const leftCol = `
    ${box('System Summary — General Approach', `
      ${fl('System', sys.metadata?.description??sys.name)}
      ${fl('1NT Opening', n1 ? `${hcpStr(n1)} HCP${n1.meaning?.shape?' · '+n1.meaning.shape:''}` : '—')}
      ${fl('Strong Opening', c2 ? `2♣ — ${c2.meaning?.description??'Strong, artificial'}` : '—')}
      ${fl('5-Card Majors', f(1,'H')&&f(1,'S') ? 'Yes' : '')}
      ${sys.metadata?.notes?fl('Notes',sys.metadata.notes):''}
    `)}
    ${box('Opening Lead Style', `
      <table style="font-size:7.5pt"><thead><tr>
        <th></th><th>Lead</th><th>In partner's suit</th>
      </tr></thead><tbody>
        <tr><td>Suit</td><td>${leadsVsSuit.map(l=>l.method).join(' · ')||'—'}</td><td></td></tr>
        <tr><td>NT</td><td>${leadsVsNT.map(l=>l.method).join(' · ')||'—'}</td><td></td></tr>
      </tbody></table>
    `)}
    ${ctable(c.leads)!=='<p class="none">None defined.</p>' ? box('Opening Leads', ctable(c.leads)) : ''}
    ${box('Signals (Priority Order)', signalsPriorityTable())}
    ${ov.length ? box('Doubles &amp; Competitive', treeHtml(ov,sys,0,new Set(),true)) : ''}
  `;

  const rightCol = `
    ${box('Opening Bid Descriptions', openingDescTable())}
    ${convSections(sys,true) ? box('Conventions', convSections(sys,true)) : ''}
    ${box('Slam Bidding', `
      ${fl('Key-card ask', '')}
      ${fl('Cue-bid style', '')}
      ${fl('Vs interference', '')}
    `)}
  `;

  const body = `
    <div style="font-size:10pt;font-weight:700;border-bottom:2px solid #660000;padding-bottom:3px;margin-bottom:6px;color:#660000">
      WBF System Card
      <span style="font-size:9pt;font-weight:400;color:#333;margin-left:10px">— ${sys.name}</span>
      <span style="font-size:7.5pt;font-weight:400;color:#888;margin-left:8px">${date}</span>
    </div>
    <div style="display:grid;grid-template-columns:40% 60%;gap:0 14px;align-items:start">
      <div>${leftCol}</div>
      <div>${rightCol}</div>
    </div>`;
  const extraCss = `@page{size:A4 landscape;margin:8mm 10mm}body{font-size:8pt}
    table th{background:#f0dada}`;
  return wrap(`${sys.name} — WBF`, extraCss, body);
}
