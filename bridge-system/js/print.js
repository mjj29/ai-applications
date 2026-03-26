/**
 * print.js — Print / export tab.
 */
'use strict';

import { callToString, sortNodes, renderText } from './model.js';
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
function pcNode(nd) {
  const h = pc(nd.call);
  return nd.isOpponentCall ? `(${h})` : h;
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
  if (cont.type==='nodes') {
    const pl = depth * 13;
    let html = treeHtml(cont.nodes, sys, depth, visited, compact);
    for (const ref of (cont.refs ?? [])) {
      const id = ref.conventionId;
      const cv = (sys.conventions??{})[id];
      if (!cv) continue;
      if (visited.has(id)) {
        html += `<div style="padding-left:${pl}px;color:#069;font-size:7.5pt;font-style:italic">↩ ${renderText(cv.name)} (see above)</div>`;
        continue;
      }
      const sub = new Set(visited); sub.add(id);
      html += `<div style="padding-left:${pl}px;margin:3px 0;border-left:2px solid #9bd">
        <div style="padding-left:5px;font-size:7.5pt;color:#069;font-weight:600;margin-bottom:1px">▶ ${renderText(cv.name)}</div>
        <div style="padding-left:5px">${treeHtml(cv.nodes??[], sys, depth, sub, compact)||'<span style="color:#aaa;font-style:italic">Empty</span>'}</div>
      </div>`;
    }
    return html;
  }
  if (cont.type==='ref') {
    const id = cont.conventionId;
    const cv = (sys.conventions??{})[id];
    if (!cv) return '';
    const pl = depth * 13;
    if (visited.has(id))
      return `<div style="padding-left:${pl}px;color:#069;font-size:7.5pt;font-style:italic">↩ ${renderText(cv.name)} (see above)</div>`;
    const sub = new Set(visited); sub.add(id);
    return `<div style="padding-left:${pl}px;margin:3px 0;border-left:2px solid #9bd">
      <div style="padding-left:5px;font-size:7.5pt;color:#069;font-weight:600;margin-bottom:1px">▶ ${renderText(cv.name)}</div>
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
      `<span class="bc">${pcNode(nd)}</span> ` +
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
  let refLabels = [];
  if (node.continuations?.type==='nodes') {
    kids = sortNodes(node.continuations.nodes);
    for (const ref of (node.continuations.refs ?? [])) {
      const cv = (sys.conventions??{})[ref.conventionId];
      if (cv) {
        kids = kids.concat(sortNodes(cv.nodes??[]));
        refLabels.push(cv.name);
      }
    }
  } else if (node.continuations?.type==='ref') {
    const cv = (sys.conventions??{})[node.continuations.conventionId];
    kids = cv ? sortNodes(cv.nodes??[]) : [];
    if (cv) refLabels.push(cv.name);
  }
  if (!kids.length) {
    if (refLabels.length) {
      return `<p class="none" style="font-style:italic;color:#069">→ ${refLabels.join(', ')}</p>`;
    }
    return '<p class="none">—</p>';
  }
  return `<table><tbody>${kids.map(n => {
    const nm = n.meaning??{};
    const hcp = nm.hcp?`${nm.hcp[0]??''}–${nm.hcp[1]??''}`:' ';
    const vline = n.variants?.length ? variantInline(n.variants) : '';
    return `<tr>
      <td class="bc" style="white-space:nowrap">${pcNode(n)}</td>
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
  // ACBL Convention Card — faithful single-page reproduction of official form (letter, portrait)
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const f = (lv,st) => findBid(op,lv,st);
  const hcpStr = nd => { const h=nd?.meaning?.hcp; return h?`${h[0]??''}–${h[1]??''}`:''; };
  const descOf = nd => nd?.meaning?.description ?? '';

  const n1=f(1,'N'), n2=f(2,'N'), n3=f(3,'N');
  const c1=f(1,'C'), d1=f(1,'D'), h1=f(1,'H'), s1=f(1,'S');
  const c2=f(2,'C'), d2=f(2,'D'), h2=f(2,'H'), s2=f(2,'S');

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Navy section header + bordered box
  const box = (title, parts) =>
    `<div class="abox"><div class="ash">${title}</div><div class="abody">${parts.join('')}</div></div>`;
  // Labelled field row (label left, underlined area right)
  const fr = (lbl, val='') =>
    `<div class="afr"><span class="afl">${lbl}</span><span class="afv">${val}</span></div>`;
  // Circled/box option (for "circle one" choices)
  const ck = txt => `<span class="ack">${txt}</span>`;
  // Underlined inline field
  const uf = (val='', w=28) => `<span class="auf" style="min-width:${w}px">${val}</span>`;
  // Option row (flex line of circled choices + inline text)
  const cr = html => `<div class="acr">${html}</div>`;
  // Range ___to___
  const rng = (lo='',hi='') => `${uf(lo,18)}&thinsp;to&thinsp;${uf(hi,18)}`;
  const rngNode = nd => { const h=nd?.meaning?.hcp; return h?rng(h[0]??'',h[1]??''):rng(); };
  // Divider
  const div = () => `<div class="adiv"></div>`;
  // Sub-label bar (light blue)
  const subh = html => `<div class="asubh">${html}</div>`;

  // 1NT continuation description for a 2-level response
  const nt1Resp = st => {
    const cont=n1?.continuations;
    if (!cont||cont.type!=='nodes') return '';
    return (cont.nodes??[]).find(n=>n.call?.type==='bid'&&n.call.level===2&&n.call.strain===st)?.meaning?.description??'';
  };
  // 2♣ continuation description for a 2-level response
  const c2Resp = st => {
    const cont=c2?.continuations;
    if (!cont||cont.type!=='nodes') return '';
    return (cont.nodes??[]).find(n=>n.call?.type==='bid'&&n.call.level===2&&n.call.strain===st)?.meaning?.description??'';
  };

  // ── CSS ──────────────────────────────────────────────────────────────────────
  const css = `
    @page { size: letter portrait; margin: 7mm 9mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; margin: 0;
           color: #111; line-height: 1.3; }
    .acols { display: grid; grid-template-columns: 56% 44%; gap: 0 5px; }
    /* Bordered section box */
    .abox { border: 1px solid #999; margin-bottom: 3px; }
    /* Dark navy section header */
    .ash  { background: #1e3872; color: #fff; font-size: 6.5pt; font-weight: bold;
            text-transform: uppercase; letter-spacing: .05em; padding: 1.5px 4px; }
    /* Light-blue sub-header bar */
    .asubh { background: #d0d8ee; color: #1e3872; font-size: 6pt; font-weight: bold;
              padding: 1px 3px; margin: 1px -4px 1px; }
    .abody { padding: 2px 4px; }
    /* Field row */
    .afr { display: flex; align-items: flex-end; gap: 2px; min-height: 11px;
           border-bottom: 1px solid #ddd; padding: 0.5px 0; }
    .afr:last-child { border-bottom: none; }
    .afl { font-size: 6pt; color: #444; white-space: nowrap; flex-shrink: 0;
           padding-bottom: 1px; padding-right: 2px; }
    .afv { flex: 1; border-bottom: 1px solid #888; font-size: 7pt; min-height: 9px; }
    /* Inline underlined blank */
    .auf { display: inline-block; border-bottom: 1px solid #888; min-width: 25px;
           font-size: 7pt; vertical-align: text-bottom; }
    /* Circled option (like circling a choice on the official card) */
    .ack { display: inline-block; font-size: 6.5pt; white-space: nowrap;
           margin: 0 1.5px; border: 1px solid #777; border-radius: 3px;
           padding: 0 1.5px; line-height: 1.4; }
    /* Option row */
    .acr { font-size: 6.5pt; padding: 1px 0; line-height: 1.65;
           border-bottom: 1px solid #e8e8e8; }
    .acr:last-child { border-bottom: none; }
    /* Thin divider */
    .adiv { border-top: 1px dashed #ccc; margin: 1px 0; }
    /* Names bar */
    .anames { border: 1.5px solid #1e3872; padding: 2px 6px; margin-bottom: 4px;
               font-size: 7pt; }
    /* Leads holding table */
    .altbl { width: 100%; border-collapse: collapse; }
    .altbl th, .altbl td { border: 1px solid #bbb; padding: 1px; text-align: center;
                            font-size: 5.5pt; height: 13px; }
    .altbl th { background: #dce3f4; font-weight: bold; }
    /* Signal grid table */
    .asig { width: 100%; border-collapse: collapse; margin: 2px 0; }
    .asig th, .asig td { border: 1px solid #bbb; padding: 1px 2px;
                          font-size: 5.5pt; text-align: center; }
    .asig th { background: #dce3f4; }
    .asig .asr { text-align: left; font-weight: bold; background: #f0f2fa; }
  `;

  // ── LEFT COLUMN ──────────────────────────────────────────────────────────────
  const leftCol = [

    box('OVERVIEW', [
      fr('General Approach', sys.metadata?.description ?? sys.name ?? ''),
      cr(`Min Expected HCP when Balanced: Opening ${uf()} &emsp; Responding ${uf()}`),
      cr(`Forcing Open: ${ck('1♣')} ${ck('2♣')} ${ck('Other')} ${uf('',45)}` +
         `&emsp;1NT Open: ${ck('Str')} ${ck('Wk')} ${ck('Variable')}`),
      fr('Bids That May Require Preparation', sys.metadata?.notes ?? ''),
    ]),

    box('NOTRUMP', [
      cr(`<b>1NT</b> (Seat/Vul ${uf()}) ${rngNode(n1)} &emsp;` +
         `Same Resp: ${ck('Y')} ${ck('N')} &emsp; 5-Card Major Sys On vs ${uf()}`),
      `<div style="display:grid;grid-template-columns:58% 42%;gap:0 3px">
        <div>
          ${fr('2♣', [ck('Stayman'), ck('Puppet'), ck('Other'), uf(nt1Resp('C'),50)].join(' '))}
          ${fr('2♦', [ck('Nat'), ck('Tfr'), ck('Other'), uf(nt1Resp('D'),50)].join(' '))}
          ${fr('2♥', [ck('Nat'), ck('Tfr'), ck('Other'), uf(nt1Resp('H'),50)].join(' '))}
          ${fr('2♠', [ck('Nat'), ck('Tfr'), ck('Other'), uf(nt1Resp('S'),50)].join(' '))}
          ${fr('2NT', [ck('Nat'), ck('Tfr'), ck('Other'), uf('',50)].join(' '))}
          ${fr('Other', '')}
          ${cr(`Smolen &emsp; Tfr: ${ck('4♣')} ${ck('4♦')} ${ck('4♥')}`)}
          ${cr(`Dbl: ${ck('Neg')} ${uf()} ${ck('Pen')} ${ck('Other')} ${uf()} &emsp; Lebensohl: ${uf()}`)}
        </div>
        <div>
          ${fr('3♣', '')}${fr('3♦', '')}${fr('3♥', '')}${fr('3♠', '')}
        </div>
      </div>`,
      cr(`<b>2NT</b> ${rngNode(n2)} ${ck('Puppet')} ${ck('Conv')} ${uf(descOf(n2),60)} &ensp; Tfr: 3Lvl`),
      cr(`<b>3NT</b> ${rngNode(n3)} ${ck('One Suit')} ${ck('Conv')}`),
    ]),

    box('MAJORS', [
      cr(`<b>1♥/♠</b> &emsp; Art Raises: ${ck('2NT')} ${ck('3NT')} ${ck('Splinter')} Other ${uf()}`),
      cr(`1st/2nd Length: ${ck('4')} ${ck('5')} &emsp; 3rd/4th Length: ${ck('4')} ${ck('5')}`),
      fr('1NT', [ck('F'), ck('Semi-F'), ck('Bypass ♠')].join(' ')),
      cr(`Jump Raise: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')} &emsp; After Overcall: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')}`),
      cr(`Drury: ${ck('2♣')} ${ck('2♦')} In Comp ${uf()}`),
      (h1||s1) ? fr('Notes', descOf(h1??s1)) : '',
    ]),

    box('MINORS', [
      subh(`1♣ &thinsp; ${uf(descOf(c1),80)}`),
      cr(`${ck('NF 2 (4432)')} ${ck('NF 1')} ${ck('NF 0')} ${ck('Art F')} &emsp; Min Length: ${ck('5')} ${ck('4')} ${ck('3')}`),
      fr('Resp', ''),
      fr('Transfer Resp', ''),
      cr(`Raises — Single: ${ck('NF')} ${ck('Inv+')} ${ck('GF')}`),
      cr(`1NT ${rng()} &emsp; Jump: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')}`),
      cr(`2NT ${rng()} &emsp; Inv &emsp; After Overcall: ${ck('Wk')} ${ck('Mixed')} ${ck('Art F')}`),
      div(),
      subh(`1♦ &thinsp; ${uf(descOf(d1),70)} ${ck('Bypass 5+')}`),
      cr(`Min Length: ${ck('5')} ${ck('4')} ${ck('3')} ${ck('Unbal')} &emsp; ${ck('NF 2')} ${ck('NF 1')} ${ck('NF 0')}`),
      fr('Resp', ''),
      cr(`Raises — Single: ${ck('NF')} ${ck('Inv+')} ${ck('GF')} &emsp; ${ck('Same as over 1♣')}`),
      cr(`1NT ${rng()} &emsp; Jump: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')}`),
      cr(`2NT ${rng()} &emsp; After Overcall: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')}`),
    ]),

    box('2 LEVEL', [
      cr(`<b>2♣</b> ${rngNode(c2)} ${ck('Art')} ${ck('Quasi')} &emsp; ♣♦ ${ck('')} ${ck('')} ${ck('')}`),
      cr(`&emsp; 2♦: ${ck('Neg')} ${ck('Waiting')} Steps ${uf()} &ensp; 2♥ ${ck('Neg')}`),
      fr('&emsp; Other', c2Resp('N') || c2Resp('C') || ''),
      div(),
      cr(`<b>2♦</b> ${rngNode(d2)} ${uf(descOf(d2),80)} New Suit ${ck('NF')}`),
      cr(`&emsp; ${ck('Int')} &emsp; Rebids over 2NT: ${uf('',55)} Other ${uf()}`),
      div(),
      cr(`<b>2♥</b> ${rngNode(h2)} ${uf(descOf(h2),80)} New Suit ${ck('NF')}`),
      cr(`&emsp; ${ck('Wk')} ${ck('Int')} ${ck('Str')} ${ck('2 Suits')} &emsp; Rebids over 2NT: ${uf('',45)} Other ${uf()}`),
      div(),
      cr(`<b>2♠</b> ${rngNode(s2)} ${uf(descOf(s2),80)} New Suit ${ck('NF')}`),
      cr(`&emsp; ${ck('Wk')} ${ck('Int')} ${ck('Str')} ${ck('2 Suits')} &emsp; Rebids over 2NT: ${uf('',45)} Other ${uf()}`),
      div(),
      fr('Jump Shift Resp', ''),
      cr(`Vs (Very)Str Open ${uf('',40)} &emsp; ${ck('NMF')} ${ck('2Way NMF')} ${ck('XYZ')} &emsp; 4thSF: ${ck('1Rnd')} ${ck('GF')}`),
    ]),

    box('PREEMPTS', [
      fr('3-Level Style (Seat/Vul)', ''),
      fr('Resp', ''),
      fr('4-Level Style', ''),
      fr('Resp', ''),
      cr(`4♣/4♦ ${ck('Tfr')} Other ${uf()}`),
      cr(`Vs: ${ck('Dbl')} ${ck('2♣')} ${ck('2♦')} ${ck('2♥')} ${ck('2♠')} ${ck('2NT')} Other ${uf('',40)}`),
      cr(`New Suit: ${ck('F')} ${ck('2 Lvl Tfr')} &emsp; Jump Shift: ${ck('Wk')} ${ck('Inv')} ${ck('F')} ${ck('Fit')}`),
      cr(`Rdbl: ${ck('10+')} ${ck('Conv')} ${uf('',50)}`),
      cr(`2NT Over: ${ck('Nat')} ${ck('Raise')} Range ${rng()} &emsp; ${ck('♣♦')} ${ck('♥♠')} ${rng()}`),
      fr('Other', ''),
      fr('2NT Overcall', ''),
      cr(`T/O Dbl Thru ${uf()} Penalty`),
    ]),

    box('SLAMS', [
      cr(`4♣ Gerber: ${ck('Directly Over NT')} ${ck('Over NT Seq')}`),
      cr(`4NT: ${ck('Blackwood')} ${ck('RKC 0314')} ${ck('RKC 1430')}`),
      cr(`${ck('Control Bids')} &emsp; ${ck('Vs Interference')}`),
      fr('Other', ''),
    ]),

  ].join('');

  // ── RIGHT COLUMN ──────────────────────────────────────────────────────────────
  const rightCol = [

    box('OVERCALLS', [
      cr(`Support Thru ${uf()} ${ck('Rdbl')} &emsp; T/O Style ${uf('',40)}`),
      fr('Other', ''),
      cr(`1-Lvl ${rng()} ${ck('Often 4 Cards')}`),
      cr(`2-Lvl ${rng()} &emsp; Jump Overcalls: ${ck('Wk')} ${ck('Int')} ${ck('Str')}`),
      fr('Conv', ''),
      subh('Responses'),
      cr(`New Suit: ${ck('F')} ${ck('NFConst')} ${ck('NF')} ${ck('Tfr')}`),
      cr(`Jump Raise: ${ck('Wk')} ${ck('Mixed')} ${ck('Inv')}`),
      fr('Cuebids', uf() + ' Support'),
      fr('Other', ''),
    ]),

    box('DIRECT CUEBIDS', [
      cr(`${ck('Michaels')} ${ck('Natural')} ${ck('Other')}`),
      fr('Describe', ''),
      fr('3-Level Style (Seat/Vul)', ''),
      fr('Resp', ''),
      fr('4-Level Style', ''),
      fr('Resp', ''),
      cr(`4♣/4♦ ${ck('Tfr')} Other ${uf()}`),
      cr(`${ck('Nat')} ${ck('Conv')} ${uf('',55)} &emsp; Jump to 2NT: ${ck('2 Lowest Unbid')}`),
      cr(`♣♦ ${rng()} &emsp; ♥♠ ${rng()} &emsp; Other ${uf()}`),
    ]),

    box('vs 1NT OPENING', [
      cr(`Direct 1NT ${rng()} ${ck('Systems On')}`),
      cr(`Balance 1NT ${rng()} ${ck('Systems On')}`),
      cr(`${ck('Very Str')} ${ck('Str')} ${ck('Nat')} ${ck('Wk')} ${ck('Str')} ${ck('Conv')} ${ck('Conv')}`),
    ]),

    box('DOUBLES', [
      cr(`<b>Negative</b> Thru ${uf('',35)}`),
      cr(`<b>T/O Dbl</b> Thru ${uf('',28)} Penalty &emsp; Thru ${uf('',25)} Maximal`),
      cr(`<b>vs TAKEOUT DBL</b> &emsp; ${ck('Responsive')} Thru ${uf()} ${ck('Penalty')}`),
      cr(`<b>vs PREEMPTS</b> &emsp; ${ck('Responsive')} Thru ${uf()} ${ck('Penalty')}`),
      fr('Other', ''),
    ]),

    box('LEADS vs SUITS', [
      `<div style="font-size:5.5pt;font-weight:bold;padding:1px 0">CIRCLE CARD LED (if not bold):</div>`,
      cr(`Length Leads: ${ck('4th')} ${ck('3rd/5th')} ${ck('3rd/Low')} &emsp; ${ck('Attitude')} &emsp; 2nd from xxxx(+)`),
      `<table class="altbl"><thead><tr>
        <th>xx</th><th>xxx</th><th>xxxx</th><th>xxxxx</th><th>Hxx</th><th>Hxxx</th><th>Hxxxx</th>
      </tr></thead><tbody><tr>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr></tbody></table>`,
      fr('After 1st Trick', ''),
      cr(`Honor Leads: A K x x (+) ${ck('Varies')} ${uf()}`),
      `<div style="font-size:5.5pt;padding:1px 0">K Q J x &ensp; KQT9 &ensp; QJTx &ensp; JT9x</div>`,
      `<div style="font-size:5.5pt;padding:1px 0">Interior Seq: AQJx &ensp; AJTx &ensp; KT9x &ensp; QT9x</div>`,
      fr('Exceptions', ''),
    ]),

    box('LEADS vs NT', [
      `<div style="font-size:5.5pt;font-weight:bold;padding:1px 0">CIRCLE CARD LED (if not bold):</div>`,
      cr(`Length Leads: ${ck('4th')} ${ck('3rd/5th')} ${ck('3rd/Low')} &emsp; ${ck('Attitude')} &emsp; Small from xx`),
      `<table class="altbl"><thead><tr>
        <th>xx</th><th>xxx</th><th>xxxx</th><th>xxxxx</th><th>Hxx</th><th>Hxxx</th><th>Hxxxx</th>
      </tr></thead><tbody><tr>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr></tbody></table>`,
      fr('After 1st Trick', ''),
      cr(`Honor Leads: A K x (+) ${ck('Varies')} ${uf()}`),
      `<div style="font-size:5.5pt;padding:1px 0">KQx &ensp; QJx &ensp; JTx &ensp; T9x</div>`,
      `<div style="font-size:5.5pt;padding:1px 0">Interior Seq: KJTx &ensp; KT9x &ensp; QT9x</div>`,
      fr('Exceptions', ''),
    ]),

    box('SIGNALS', [
      `<table class="asig"><thead><tr>
        <th style="width:40%"></th><th>Declarer's Lead</th><th>Partner's Lead</th>
      </tr></thead><tbody>
        <tr><td class="asr">Attitude</td><td>${ck('Std')} ${ck('Rev')}</td><td>${ck('Std')} ${ck('Rev')}</td></tr>
        <tr><td class="asr">Count</td><td>${ck('Std')} ${ck('Rev')}</td><td>${ck('Std')} ${ck('Rev')}</td></tr>
        <tr><td class="asr">Suit Pref</td><td>${ck('Std')} ${ck('Rev')}</td><td>${ck('Std')} ${ck('Rev')}</td></tr>
      </tbody></table>`,
      cr(`Primary Signals to Declarer: ${ck('Attitude')} ${ck('Count')} ${ck('Suit Pref')}`),
      cr(`Primary Signals to Partner: ${ck('Attitude')} ${ck('Count')} ${ck('Suit Pref')}`),
      fr('Exceptions', ''),
      cr(`First Discard: ${ck('Std')} ${ck('Upside Down')} ${ck('Lavinthal')} ${ck('Odd/Even')} ${ck('Other')}`),
      cr(`Smith Echo: ${ck('Suits')} ${ck('NT')} ${ck('Reverse')}`),
      fr('Trump Signals', ''),
    ]),

  ].join('');

  const body = `
    <div class="anames"><b>Names</b>&emsp;${uf(sys.name ?? '', 320)}</div>
    <div class="acols"><div>${leftCol}</div><div>${rightCol}</div></div>`;
  return wrap(`${sys.name} — ACBL Convention Card`, css, body);
}

function generateEBU(sys) {
  // EBU Convention Card 20B — 4 × A5 pages, each exactly 148mm × 210mm
  const op = sys.openings ?? [], ov = sys.overcalls ?? [], c = sys.carding ?? {};
  const f  = (lv, st) => findBid(op, lv, st);
  const hcpStr = nd => { const h = nd?.meaning?.hcp; return h ? `${h[0]??''}–${h[1]??''}` : ''; };
  const n1   = f(1, 'N');
  const convs = sys.conventions ?? {};

  // ── Suit-symbol rendering (!C !D !H !S !N) ───────────────────────────────
  const rt = t => renderText(t ?? '');   // safe wrapper

  // ── Note system (overflow goes to Supplementary Details on page 3) ────────
  const suppNotes = [];
  let noteNum = 0;
  // Strip HTML tags so note labels don't contain raw span markup
  const addNote = (label, fullText) => {
    noteNum++;
    suppNotes.push(`[${noteNum}] ${String(label).replace(/<[^>]+>/g, '')}: ${fullText}`);
    return noteNum;
  };
  // Inline trunc: …[N] in nobr so ref can't orphan onto next line
  const trunc = (text, label, maxCh = 55) => {
    if (!text) return '';
    const s = String(text);
    if (s.length <= maxCh) return rt(s);
    const n = addNote(label, s);
    return rt(s.slice(0, maxCh - 1).trimEnd()) + `<span style="white-space:nowrap">\u2026[${n}]</span>`;
  };
  // For rows with a dedicated Notes column — returns [displayHtml, noteRefText]
  const truncCell = (text, label, maxCh = 55) => {
    if (!text) return ['', '\u00a0'];
    const s = String(text);
    if (s.length <= maxCh) return [rt(s), '\u00a0'];
    const n = addNote(label, s);
    return [rt(s.slice(0, maxCh - 1).trimEnd()) + '\u2026', `[${n}]`];
  };
  // Clamp cell to exactly one line — prevents long descriptions from expanding row height
  const cl1 = html => `<div style="overflow:hidden;height:1.35em">${html}</div>`;

  // ── Find a bid in a continuation tree ────────────────────────────────────
  const findInCont = (cont, lv, st) => {
    if (!cont) return null;
    if (cont.type === 'nodes') {
      const d = (cont.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
      if (d) return d;
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        const found = cv && (cv.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
        if (found) return found;
      }
    }
    if (cont.type === 'ref') {
      const cv = convs[cont.conventionId];
      return cv ? (cv.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st) : null;
    }
    return null;
  };

  // ── 1NT responses ─────────────────────────────────────────────────────────
  const nt1Resp = st => {
    const cont = n1?.continuations;
    if (st === 'C' && cont?.type === 'nodes') {
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId]; if (!cv) continue;
        const fn = cv.nodes?.[0];
        if (fn?.call?.type==='bid' && fn.call.level===2 && fn.call.strain==='C')
          return cv.name ?? fn.meaning?.description ?? '';
      }
    }
    const nd = findInCont(cont, 2, st);
    return nd?.meaning?.description ?? '';
  };
  const nt1OtherResps = () => {
    const cont = n1?.continuations, results = [];
    const collect = nodes => { for (const n of nodes ?? []) if (n.call?.type==='bid' && n.call.level>=3 && !n.isOpponentCall) results.push(`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`); };
    if (cont?.type==='nodes') { collect(cont.nodes); for (const r of (cont.refs??[])) collect(convs[r.conventionId]?.nodes); }
    if (cont?.type==='ref')   collect(convs[cont.conventionId]?.nodes);
    return results.slice(0, 6).join('; ');
  };
  const nt1AfterDbl = () => {
    for (const [id, cv] of Object.entries(convs))
      if (/^1nt.*(doubled?|dbl)/i.test(id) || /1nt.*doubled?/i.test(cv.name??'')) return cv.name??'';
    return '';
  };
  const nt1AfterInterf = () => {
    for (const [id, cv] of Object.entries(convs))
      if (/leb[ae]n/i.test(id+' '+(cv.name??''))) return cv.name??'';
    return '';
  };
  const nt1Strength = () => {
    if (!n1) return '';
    const h = n1.meaning?.hcp, base = h ? `${h[0]}\u2013${h[1]} HCP` : '';
    if (!n1.variants?.length) return base;
    const baseKey = h ? `${h[0]}-${h[1]}` : '';
    const allKeys = new Set([baseKey, ...n1.variants.map(v => { const vh=v.meaningOverride?.hcp; return vh?`${vh[0]}-${vh[1]}`:baseKey; })]);
    return allKeys.size > 1 ? (base ? `${base} (varies)` : 'Varies') : base;
  };

  // ── General description ───────────────────────────────────────────────────
  const buildGenDesc = () => {
    if (sys.metadata?.description) return rt(sys.metadata.description);
    if (sys.metadata?.notes)       return rt(sys.metadata.notes);
    const parts = [];
    const c1 = f(1,'C'), d1 = f(1,'D');
    if (c1?.meaning?.description) parts.push(`1${SYM.C}: ${c1.meaning.description.split('.')[0]}`);
    if (d1?.meaning?.description) parts.push(`1${SYM.D}: ${d1.meaning.description.split('.')[0]}`);
    if (n1) {
      const baseH = n1.meaning?.hcp;
      const baseKey = baseH ? `${baseH[0]}-${baseH[1]}` : '';
      const varKeys = new Set([baseKey, ...(n1.variants??[]).map(v => { const vh=v.meaningOverride?.hcp; return vh?`${vh[0]}-${vh[1]}`:baseKey; })]);
      if (varKeys.size > 1) {
        const ranges = [...new Set((n1.variants??[]).map(v => { const h=v.meaningOverride?.hcp; return h?`${h[0]}\u2013${h[1]}`:''; }).filter(Boolean))];
        parts.push(ranges.length ? `Variable NT (${ranges.join(', ')})` : 'Variable NT');
      } else parts.push(`NT: ${hcpStr(n1)} HCP`);
    }
    return rt(parts.join('; '));
  };

  // ── Other aspects / overflow notes ───────────────────────────────────────
  // Called AFTER all trunc() calls so suppNotes is populated
  const buildOtherAspects = () => {
    const lines = [];
    if (sys.metadata?.otherAspects) lines.push(rt(sys.metadata.otherAspects));
    if (n1?.variants?.length && (() => { const bh=n1.meaning?.hcp, bk=bh?`${bh[0]}-${bh[1]}`:''; return new Set([bk,...n1.variants.map(v=>{const vh=v.meaningOverride?.hcp;return vh?`${vh[0]}-${vh[1]}`:bk;})]).size>1; })()) {
      lines.push('1NT range varies: ' + n1.variants.map(v => {
        const mo=v.meaningOverride??{}, hcp=mo.hcp?`${mo.hcp[0]}\u2013${mo.hcp[1]}`:'';
        return `${condLabel(v.condition)}: ${hcp?hcp+' HCP':''} ${mo.description||''}`.trim();
      }).join('; '));
    }
    for (const bid of ['1C','1D','1H','1S','2C','2D','2H','2S','2N']) {
      const n = f(Number(bid[0]), bid[1]); if (!n?.meaning?.alert) continue;
      lines.push(`${bid}: ${rt((n.meaning?.description??'').split('.')[0])}`);
    }
    return lines.join('<br>') || '&nbsp;';
  };

  const buildSuppDetails = () => {
    if (!suppNotes.length) return '';
    return suppNotes.map(n => rt(n)).join('<br>');
  };

  // ── Convention filters ────────────────────────────────────────────────────
  const slamConvRe  = /slam|blackwood|gerber|keycard|rkcb|rkqg|viscount|general.?swiss/i;
  const respTableRe = /-resp(-|$)|\/resp(-|$)|-continuations?(-|$)/i;
  const isSlamConv  = (id, cv) => slamConvRe.test(id) || slamConvRe.test(cv.name??'');
  const slamConvs   = Object.entries(convs).filter(([id,cv]) => isSlamConv(id,cv)).map(([,cv]) => cv);
  const otherConvs  = Object.entries(convs).filter(([id,cv]) => !isSlamConv(id,cv) && !respTableRe.test(id)).map(([,cv]) => cv);

  // ── Response text — bid nodes from direct nodes + refs ───────────────────
  const respText = nd => {
    if (!nd) return '';
    const cont = nd.continuations;
    if (!cont || cont.type==='tbd' || cont.type==='end') return '';
    if (cont.type==='ref') {
      const cv = convs[cont.conventionId];
      if (!cv) return '';
      const bids = sortNodes(cv.nodes ?? []).filter(n => n.call?.type==='bid' && !n.isOpponentCall);
      if (bids.length) return bids.slice(0,4).map(n=>`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`).join('; ');
      return `→ ${cv.name}`;
    }
    if (cont.type==='nodes') {
      const allBids = [];
      for (const n of sortNodes(cont.nodes ?? [])) if (n.call?.type==='bid' && !n.isOpponentCall) allBids.push(n);
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        for (const n of sortNodes(cv?.nodes ?? [])) if (n.call?.type==='bid' && !n.isOpponentCall) allBids.push(n);
      }
      return allBids.slice(0,4).map(n=>`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`).join('; ');
    }
    return '';
  };

  // ── Carding ───────────────────────────────────────────────────────────────
  const leadsVsSuit = (c.leads??[]).filter(r => !r.context||/suit|trump/i.test(r.context));
  const leadsVsNT   = (c.leads??[]).filter(r =>  r.context&&/nt|notrump/i.test(r.context));
  const suitSig  = (c.signals??[]).find(r => !r.context||/suit/i.test(r.context));
  const ntSig    = (c.signals??[]).find(r =>  r.context&&/nt/i.test(r.context)) ?? suitSig;
  const suitDisc = (c.discards??[]).find(r => !r.context||/suit/i.test(r.context)) ?? (c.discards??[])[0];
  const ntDisc   = (c.discards??[]).find(r =>  r.context&&/nt/i.test(r.context)) ?? suitDisc;
  const cardingNotes = () => {
    const parts = [];
    for (const r of [...(c.signals??[]), ...(c.discards??[]), ...(c.leads??[])]) {
      if (r.notes) parts.push(rt(r.notes));
    }
    if (c.notes) parts.push(rt(c.notes));
    return parts.join('<br>');
  };

  // ── Border / layout constants ─────────────────────────────────────────────
  const O = '2.25pt solid #000';
  const I = '1px solid #000';

  // Each page is a fixed-size A5 block. overflow:hidden enforces the boundary.
  // Content is clipped — nothing can push pages to grow.
  const PAGE_STYLE = 'width:148mm;height:210mm;overflow:hidden;box-sizing:border-box;padding:4mm;font-family:Arial,sans-serif;font-size:8pt;position:relative;page-break-after:always';

  // Table spanning full width, auto layout
  const tbl = rows => `<table style="width:100%;border-collapse:collapse">${rows}</table>`;

  // Section header (thick all-around)
  const secHdr = txt =>
    `<tr><td colspan="99" style="border:${O};padding:2px 4px;text-align:center;font-weight:bold;text-transform:uppercase;font-size:9pt;line-height:1.3">${txt}</td></tr>`;
  // Sub-section bar (thick top only, continues to right of a section)
  const subHdr = txt =>
    `<tr><td colspan="99" style="border-top:${O};border-left:${O};border-right:${O};border-bottom:none;padding:2px 4px;font-weight:bold;font-size:8pt">${txt}</td></tr>`;

  // Lined blank rows: n rows, each 14px tall, last row gets thick bottom border
  const blankRows = n => Array(n).fill(0).map((_,i) =>
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${i===n-1?O:I};height:14px;padding:0 3px">&nbsp;</td></tr>`
  ).join('');

  // A text row inside a section (no top border — continues from secHdr's bottom)
  const noteRow = txt =>
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:1px 4px;font-size:7pt">${txt}</td></tr>`;

  // Close a section with a thick bottom border
  const closeRow = (txt='&nbsp;', h='auto') =>
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${O};padding:1px 4px;height:${h}">${txt}</td></tr>`;

  // 2-column label | value row
  const fRow = (lbl, val='', lw='36%') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:1px 4px;width:${lw};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lbl}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:1px 4px">${val}</td>
    </tr>`;
  const fRowLast = (lbl, val='', lw='36%') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:1px 4px;width:${lw};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lbl}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:1px 4px">${val}</td>
    </tr>`;

  // ── PAGE 1 ────────────────────────────────────────────────────────────────

  const page1 = `<div style="${PAGE_STYLE}">` +

  // Header row: Name | [blank] | EBU No.
  `<table style="width:100%;border-collapse:collapse;margin-bottom:2px">
    <tr>
      <td style="border:none;padding:1px 4px;font-size:12pt;font-weight:bold;width:20%">Name</td>
      <td style="border:none;padding:1px 4px">&nbsp;</td>
      <td style="border:none;padding:1px 4px;font-size:10pt;font-weight:bold;text-align:right;white-space:nowrap;width:22%">EBU No.</td>
    </tr>
    <tr>
      <td style="border:none;padding:1px 4px;font-size:12pt;font-weight:bold">Partner</td>
      <td style="border:none;padding:1px 4px">&nbsp;</td>
      <td style="border:none;padding:1px 4px;font-size:10pt;font-weight:bold;text-align:right;white-space:nowrap">EBU No.</td>
    </tr>
  </table>` +

  // General Description — single content row with actual data
  tbl(secHdr('GENERAL DESCRIPTION OF BIDDING METHODS') +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${O};padding:2px 4px;height:28px;vertical-align:top;overflow:hidden">${buildGenDesc()}</td></tr>`
  ) +

  // 1NT
  tbl(secHdr('1NT OPENINGS AND RESPONSES') +
    fRow('<b>Strength</b>', nt1Strength()) +
    fRow('<b>Shape constraints</b>', rt(n1?.meaning?.shape ?? '(semi-)balanced')) +
    fRow('<b>Responses</b> 2'+ps('C'), trunc(nt1Resp('C'),'1NT 2C'), '36%') +
    fRow('2'+ps('D'), trunc(nt1Resp('D'),'1NT 2D')) +
    fRow('2'+ps('H'), trunc(nt1Resp('H'),'1NT 2H')) +
    fRow('2'+ps('S'), trunc(nt1Resp('S'),'1NT 2S')) +
    fRow('2NT', trunc(nt1Resp('N'),'1NT 2NT')) +
    fRow('Others', trunc(nt1OtherResps(),'1NT others', 80)) +
    fRow('After opponents double', trunc(nt1AfterDbl(),'After dbl')) +
    fRowLast('After other interference', trunc(nt1AfterInterf(),'After interf'))
  ) +

  // Two-level — 4 cols: bid | meaning | responses | notes
  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('TWO-LEVEL OPENINGS AND RESPONSES')}
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:1px 3px;width:7%">&nbsp;</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;font-weight:bold">Meaning</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;font-weight:bold;width:35%">Responses</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:1px 3px;width:7%;text-align:center;font-weight:bold">Notes</td>
    </tr>
    ${['C','D','H','S','N'].map((st,i) => {
      const nd=f(2,st), m=nd?.meaning??{};
      const vline = nd?.variants?.length ? ` [${variantInline(nd.variants)}]` : '';
      const isLast = i===4;
      const [mHtml, mNote] = truncCell((m.description??'')+vline, '2'+SYM[st]+' meaning', 55);
      const [rHtml, rNote] = truncCell(respText(nd), '2'+SYM[st]+' resp', 45);
      const nc2 = [mNote, rNote].filter(s => s !== '\u00a0').join(' ') || '\u00a0';
      return `<tr>
        <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${isLast?O:'none'};padding:1px 3px">2${ps(st)}</td>
        <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${isLast?O:'none'};padding:1px 3px">${cl1(mHtml)}</td>
        <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${isLast?O:'none'};padding:1px 3px">${cl1(rHtml)}</td>
        <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${isLast?O:'none'};padding:1px 3px;text-align:center;font-size:7pt">${nc2}</td>
      </tr>`;
    }).join('')}
  </table>` +

  // Other aspects
  tbl(secHdr('OTHER ASPECTS OF SYSTEM WHICH OPPONENTS SHOULD NOTE') +
    noteRow('(Please include details of any agreements involving bidding on significantly less than traditional values).') +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:2px 4px;height:30px;vertical-align:top;overflow:hidden">${buildOtherAspects()}</td></tr>`
  ) +

  `</div>`;

  // ── PAGE 2 ────────────────────────────────────────────────────────────────
  // Other opening bids table — 7 cols: bid | hcp | * | minLen | meaning | responses | notes
  const opBidRow = (nd, label) => {
    const m=nd?.meaning??{}, hcp=hcpStr(nd);
    const art=m.alert||m.announce?'*':'';
    let minLen=''; if(m.shape){const nm=m.shape.match(/\d+/);if(nm)minLen=nm[0];}
    const vline=nd?.variants?.length?` [${variantInline(nd.variants)}]`:'';
    const [mHtml, mNote] = truncCell((m.description??'')+vline, label+' meaning', 50);
    const [rHtml, rNote] = truncCell(respText(nd), label+' resp', 40);
    const nc = [mNote, rNote].filter(s => s !== '\u00a0').join(' ') || '\u00a0';
    return `<tr>
      <td style="border-top:${I};border-left:${O};border-right:none;border-bottom:${I};padding:1px 3px;width:8%">${label}</td>
      <td style="border:${I};padding:1px 2px;text-align:center;width:8%">${hcp}</td>
      <td style="border:${I};padding:1px 2px;text-align:center;width:3%">${art}</td>
      <td style="border:${I};padding:1px 2px;text-align:center;width:5%">${minLen}</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px">${cl1(mHtml)}</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px">${cl1(rHtml)}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 3px;text-align:center;width:6%;font-size:7pt">${nc}</td>
    </tr>`;
  };

  // 3-level bids: one summary row (like the template)
  const op3 = op.filter(n => n.call?.type==='bid' && n.call.level===3);
  const op4 = op.filter(n => n.call?.type==='bid' && n.call.level===4);
  const op3desc = op3.map(nd => `${nd.call.level}${SYM[nd.call.strain]??nd.call.strain}: ${nd.meaning?.description??''}`).join('; ') || '';
  const op4desc = op4.map(nd => `${nd.call.level}${SYM[nd.call.strain]??nd.call.strain}: ${nd.meaning?.description??''}`).join('; ') || '';
  const [op3Html, op3Note] = truncCell(op3desc, '3 level bids', 90);
  const [op4Html, op4Note] = truncCell(op4desc, '4 level bids', 90);

  const defRow = (lbl, val='') =>
    `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:1px 3px;overflow:hidden;white-space:nowrap">${lbl}</td>
      <td style="border:${I};padding:1px 3px">${val ? cl1(val) : '\u00a0'}</td>
      <td style="border:${I};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 3px">&nbsp;</td>
    </tr>`;

  const page2 = `<div style="${PAGE_STYLE}">` +

  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('OTHER OPENING BIDS')}
    <tr>
      <td style="border-top:none;border-left:${O};border-right:none;border-bottom:none;padding:1px 3px;width:8%">&nbsp;</td>
      <td style="border:${I};padding:1px 2px;text-align:center;font-size:7pt;width:8%">HCP</td>
      <td style="border:${I};padding:1px 1px;text-align:center;font-size:6pt;width:3%">see<br>Note*</td>
      <td style="border:${I};padding:1px 2px;text-align:center;font-size:7pt;width:5%">Min<br>len</td>
      <td style="border-top:none;border-left:none;border-right:none;border-bottom:none;padding:1px 3px;text-align:center;font-size:7.5pt">CONVENTIONAL MEANING</td>
      <td style="border-top:none;border-left:none;border-right:none;border-bottom:none;padding:1px 3px;text-align:center;font-size:7.5pt;width:28%">SPECIAL RESPONSES</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:1px 3px;text-align:center;font-size:7.5pt;width:6%">Notes</td>
    </tr>
    ${opBidRow(f(1,'C'), '1'+ps('C'))}
    ${opBidRow(f(1,'D'), '1'+ps('D'))}
    ${opBidRow(f(1,'H'), '1'+ps('H'))}
    ${opBidRow(f(1,'S'), '1'+ps('S'))}
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:none;border-bottom:${I};padding:1px 3px">3 bids</td>
      <td colspan="3" style="border:${I};padding:1px 2px;text-align:center">&nbsp;</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px">${cl1(op3Html)}</td>
      <td style="border-top:${I};border-right:${O};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7pt">${op3Note}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:none;border-bottom:${I};padding:1px 3px">4 bids</td>
      <td colspan="3" style="border:${I};padding:1px 2px;text-align:center">&nbsp;</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px">${cl1(op4Html)}</td>
      <td style="border-top:${I};border-right:${O};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7pt">${op4Note}</td>
    </tr>
    <tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:1px 3px;font-size:6pt">*(Please enter your normal HCP range. Please tick box if you have special agreements involving different values in particular positions and include further details under Supplementary Details).</td></tr>
  </table>` +

  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('DEFENSIVE METHODS AFTER OPPONENTS OPEN')}
    <tr>
      <td colspan="4" style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">OPPONENTS OPEN A NATURAL ONE OF A SUIT</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">CONVENTIONAL MEANING</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">SPECIAL RESPONSES</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">Notes</td>
    </tr>
    ${defRow('Simple overcall', rt(ov.find(n=>n.call?.type==='bid'&&n.call?.level===1&&n.call?.strain!=='N')?.meaning?.description??''))}
    ${defRow('Jump overcall')}
    ${defRow('Cue bid')}
    ${defRow('1NT', rt(ov.find(n=>n.call?.type==='bid'&&n.call?.level===1&&n.call?.strain==='N')?.meaning?.description??''))}
    ${defRow('2NT', rt(ov.find(n=>n.call?.type==='bid'&&n.call?.level===2&&n.call?.strain==='N')?.meaning?.description??''))}
    <tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">OPPONENTS OPEN WITH</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">DEFENSIVE METHODS</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">SPECIAL RESPONSES</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 3px;text-align:center;font-size:7.5pt">Notes</td>
    </tr>
    ${defRow('Strong 1\u2663')}
    ${defRow('Short 1\u2663/1\u2666')}
    ${defRow('Weak 1NT')}
    ${defRow('Strong 1NT')}
    ${defRow('Weak 2')}
    ${defRow('Weak 3')}
    ${defRow('4 bids')}
    <tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:1px 3px">Multi 2\u2666</td>
      <td style="border:${I};border-bottom:${O};padding:1px 3px">&nbsp;</td>
      <td style="border:${I};border-bottom:${O};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${I};border-right:${O};border-bottom:${O};padding:1px 3px">&nbsp;</td>
    </tr>
  </table>` +

  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('SLAM CONVENTIONS')}
    <tr>
      <td colspan="4" style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:1px 3px;font-weight:bold;width:36%">Name</td>
      <td colspan="2" style="border-top:none;border-left:none;border-right:${I};border-bottom:none;padding:1px 3px;font-weight:bold">Meaning of Responses</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:1px 3px;font-weight:bold;width:18%">Over interference</td>
    </tr>
    ${(slamConvs.length?slamConvs:[{}]).map(cv=>`<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:1px 3px">${cl1(rt(cv.name??''))}</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:none;padding:1px 3px">${cl1(rt(cv.description??''))}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:1px 3px">&nbsp;</td>
    </tr>`).join('')}
    <tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:1px 3px;height:12px">&nbsp;</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:${O};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:1px 3px">&nbsp;</td>
    </tr>
  </table>` +

  `</div>`;

  // ── PAGE 3 ────────────────────────────────────────────────────────────────
  const fRow3 = (lbl, val='') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:1px 4px;width:36%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${lbl}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:1px 4px">${val}</td>
    </tr>`;
  const fRow3Last = (lbl, val='') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:1px 4px;width:36%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${lbl}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:1px 4px">${val}</td>
    </tr>`;

  const page3 = `<div style="${PAGE_STYLE}">` +

  tbl(secHdr('COMPETITIVE AUCTIONS') +
    noteRow('Agreements after opening of one of a suit and overcall by opponents') +
    fRow3('Level to which negative doubles apply') +
    fRow3('Special meaning of bids') +
    fRow3('Exceptions / other agreements') +
    subHdr('Agreements after opponents double for takeout') +
    fRow3('Redouble') +
    fRow3('New suit') +
    fRow3('Jump in new suit') +
    fRow3('Jump raise') +
    fRow3('2NT') +
    fRow3Last('Other') +
    noteRow('Other agreements concerning doubles and redoubles') +
    blankRows(3)
  ) +

  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('OTHER CONVENTIONS')}
    ${otherConvs.length
      ? otherConvs.map(cv =>
          `<tr>
            <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:1px 4px;width:38%;font-weight:bold;overflow:hidden">${rt(cv.name??'')}</td>
            <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:1px 4px">${rt(cv.description??'')}</td>
          </tr>`
        ).join('') +
        `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:1px 4px;height:12px">&nbsp;</td></tr>`
      : blankRows(4)
    }
  </table>` +

  // Supplementary details — notes first, then blank writing lines; continues on page 4
  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('SUPPLEMENTARY DETAILS')}
    ${noteRow('(Please cross-reference where appropriate to the relevant part of card, and continue on back if needed).')}
    ${suppNotes.length
      ? `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:2px 4px;vertical-align:top;font-size:7.5pt">${buildSuppDetails()}</td></tr>`
      : blankRows(4)
    }
    <tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};height:12px;padding:0 3px">&nbsp;</td></tr>
  </table>` +

  `</div>`;

  // ── PAGE 4 ────────────────────────────────────────────────────────────────
  const suitCombos = ['A <u>K</u>','<u>A</u> K x','<u>K</u> Q 10','<u>K</u> Q x','K <u>J</u> 10','K <u>10</u> 9',
    '<u>Q</u> J 10','<u>Q</u> J x','<u>J</u> 10 x','10 x <u>x</u>','<u>10</u> 9 x','9 <u>8</u> 7 x',
    '10 x x <u>x</u>','H x <u>x</u>','H x x <u>x</u>','H x x <u>x</u> x','H x x <u>x</u> x x',
    '<u>x</u> x','x <u>x</u> x','x <u>x</u> x x','x <u>x</u> x x x'];
  const ntCombos = ['<u>A</u> K x (<u>x</u>)','A <u>J</u> 10 x','<u>K</u> Q 10','<u>K</u> Q x','K <u>J</u> 10','K <u>10</u> 9',
    '<u>Q</u> J 10','<u>Q</u> J x','<u>J</u> 10 x','10 x <u>x</u>','<u>10</u> 9 x','9 <u>8</u> 7 x',
    '10 x x <u>x</u>','H x <u>x</u>','H x x <u>x</u>','H x x <u>x</u> x','H x x <u>x</u> x x',
    '<u>x</u> x','x <u>x</u> x','x <u>x</u> x x','x <u>x</u> x x x'];

  const leadsInnerTbl = (combos, label) => {
    const g = i => combos.slice(i*7, i*7+7);
    const cRow = grp => grp.map(cx => `<td style="padding:0 2px;font-size:6.5pt;white-space:nowrap;border:none;line-height:1.3">${cx}</td>`).join('');
    const wRow = () => Array(7).fill(`<td style="border-bottom:1px solid #ccc;height:11px;padding:0;border-top:none;border-left:none;border-right:none">&nbsp;</td>`).join('');
    return `<table style="width:100%;border-collapse:collapse">
      <tr>
        <td rowspan="6" style="width:52px;border-right:${I};padding:2px 3px;text-align:center;vertical-align:middle;font-size:7pt">${label}</td>
        ${cRow(g(0))}
      </tr>
      <tr>${wRow()}</tr>
      <tr>${cRow(g(1))}</tr>
      <tr>${wRow()}</tr>
      <tr>${cRow(g(2))}</tr>
      <tr>${wRow()}</tr>
    </table>`;
  };

  const page4 = `<div style="${PAGE_STYLE}">` +

  tbl(secHdr('OPENING LEADS') +
    noteRow('For all the card combinations shown, clearly mark the card normally led if different from the underlined card.') +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:0">${leadsInnerTbl(suitCombos,'v.&nbsp;suit<br>contracts')}</td></tr>` +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:0">${leadsInnerTbl(ntCombos,'v.&nbsp;NT<br>contracts')}</td></tr>` +
    noteRow('Other agreements in leading, e.g. high level contracts, partnership suits:&ndash;') +
    blankRows(2)
  ) +

  `<table style="width:100%;border-collapse:collapse">
    ${secHdr('CARDING METHODS')}
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:1px 4px;width:32%">&nbsp;</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:none;padding:1px 4px;text-align:center;font-size:7.5pt">v. suit contracts</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:1px 4px;text-align:center;font-size:7.5pt">v. NT contracts</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:1px 4px">On Partner's lead</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 4px;text-align:center">${rt(suitSig?.method??'')}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 4px;text-align:center">${rt(ntSig?.method??'')}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:1px 4px">On Declarer's lead</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 4px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 4px">&nbsp;</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:1px 4px">When discarding</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:1px 4px;text-align:center">${rt(suitDisc?.method??'')}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:1px 4px;text-align:center">${rt(ntDisc?.method??'')}</td>
    </tr>
    <tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:1px 4px;font-size:7.5pt">Other carding agreements, secondary methods, and exceptions:</td></tr>
    <tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:2px 4px;vertical-align:top;overflow:hidden">${cardingNotes() || '&nbsp;'}</td></tr>
    <tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};height:12px;padding:0 3px">&nbsp;</td></tr>
  </table>` +

  tbl(secHdr('SUPPLEMENTARY DETAILS (continued)') +
    (suppNotes.length
      ? `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:2px 4px;vertical-align:top;font-size:7.5pt">${buildSuppDetails()}</td></tr>` +
        blankRows(3)
      : blankRows(5)
    ) +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${O};height:10px;padding:0 3px">&nbsp;</td></tr>`
  ) +

  `</div>`;

  const body = page1 + page2 + page3 + page4 +
    `<div style="font-size:7pt;color:#444;text-align:right;padding:2px 0">Both players must have identically completed convention cards. Cards must be exchanged with opponents for each round. &nbsp;<b>EBU 20B</b></div>`;

  const extraCss = `
    @page { size: A5; margin: 0 }
    body { font-family: Arial, sans-serif; font-size: 8pt; background: #fff; margin: 0; padding: 0; }
    table { border-collapse: collapse; margin: 0; }
    th, td { border: none; padding: 0; }
    u { text-decoration: underline; }
    .suit-club    { color: #111; font-weight: bold; }
    .suit-diamond { color: #c00; font-weight: bold; }
    .suit-heart   { color: #c00; font-weight: bold; }
    .suit-spade   { color: #111; font-weight: bold; }
    .suit-nt      { color: #111; }
  `;
  return wrap(`${sys.name} — EBU 20B`, extraCss, body);
}


function generateWBF(sys) {
  // WBF Convention Card — 2 × A4 landscape pages
  // Page 1: three-column (Defensive & Competitive | Leads & Signals | System Summary)
  // Page 2: Opening Bid Descriptions table
  const op = sys.openings ?? [], ov = sys.overcalls ?? [], c = sys.carding ?? {};
  const f  = (lv, st) => findBid(op, lv, st);
  const hcpStr = nd => { const h = nd?.meaning?.hcp; return h ? `${h[0]??''}–${h[1]??''}` : ''; };
  const n1 = f(1, 'N');
  const convs = sys.conventions ?? {};

  // ── Suit-symbol rendering ─────────────────────────────────────────────────
  const rt  = t => renderText(t ?? '');
  const cl1 = html => `<div style="overflow:hidden;height:1.35em">${html}</div>`;

  // ── Note system ──────────────────────────────────────────────────────────
  const suppNotes = [];
  let noteNum = 0;
  const addNote = (label, fullText) => {
    noteNum++;
    suppNotes.push(`[${noteNum}] ${String(label).replace(/<[^>]+>/g, '')}: ${fullText}`);
    return noteNum;
  };
  const trunc = (text, label, maxCh = 60) => {
    if (!text) return '';
    const s = String(text);
    if (s.length <= maxCh) return rt(s);
    const n = addNote(label, s);
    return rt(s.slice(0, maxCh - 1).trimEnd()) + `<span style="white-space:nowrap">\u2026[${n}]</span>`;
  };

  // ── Content helpers ───────────────────────────────────────────────────────
  const ovDesc = (lv, st) =>
    ov.find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st)?.meaning?.description ?? '';
  const leadsVsSuit = (c.leads??[]).filter(r => !r.context || /suit|trump/i.test(r.context));
  const leadsVsNT   = (c.leads??[]).filter(r =>  r.context && /nt|notrump/i.test(r.context));
  const suitSig  = (c.signals??[]).find(r => !r.context || /suit/i.test(r.context));
  const ntSig    = (c.signals??[]).find(r =>  r.context && /nt/i.test(r.context)) ?? suitSig;
  const suitDisc = (c.discards??[]).find(r => !r.context || /suit/i.test(r.context)) ?? (c.discards??[])[0];
  const ntDisc   = (c.discards??[]).find(r =>  r.context && /nt/i.test(r.context)) ?? suitDisc;

  // ── Find a bid in a continuation tree (checks cont.refs too) ─────────────
  const findInCont = (cont, lv, st) => {
    if (!cont) return null;
    if (cont.type === 'nodes') {
      const d = (cont.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
      if (d) return d;
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        const found = cv && (cv.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
        if (found) return found;
      }
    }
    if (cont.type === 'ref') {
      const cv = convs[cont.conventionId];
      return cv ? (cv.nodes ?? []).find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st) : null;
    }
    return null;
  };

  // ── 1NT strength ─────────────────────────────────────────────────────────
  const nt1Strength = () => {
    if (!n1) return '';
    const h = n1.meaning?.hcp, base = h ? `${h[0]}\u2013${h[1]} HCP` : '';
    if (!n1.variants?.length) return base;
    const baseKey = h ? `${h[0]}-${h[1]}` : '';
    const allKeys = new Set([baseKey, ...n1.variants.map(v => { const vh=v.meaningOverride?.hcp; return vh?`${vh[0]}-${vh[1]}`:baseKey; })]);
    return allKeys.size > 1 ? (base ? `${base} (varies)` : 'Varies') : base;
  };

  // ── Response text ─────────────────────────────────────────────────────────
  const respText = nd => {
    if (!nd) return '';
    const cont = nd.continuations;
    if (!cont || cont.type==='tbd' || cont.type==='end') return '';
    if (cont.type==='ref') {
      const cv = convs[cont.conventionId];
      if (!cv) return '';
      const bids = sortNodes(cv.nodes ?? []).filter(n => n.call?.type==='bid' && !n.isOpponentCall);
      if (bids.length) return bids.slice(0,6).map(n=>`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`).join('; ');
      return `\u2192 ${cv.name}`;
    }
    if (cont.type==='nodes') {
      const allBids = [];
      for (const n of sortNodes(cont.nodes ?? [])) if (n.call?.type==='bid' && !n.isOpponentCall) allBids.push(n);
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        for (const n of sortNodes(cv?.nodes ?? [])) if (n.call?.type==='bid' && !n.isOpponentCall) allBids.push(n);
      }
      return allBids.slice(0,6).map(n=>`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`).join('; ');
    }
    return '';
  };

  // ── General description ───────────────────────────────────────────────────
  const buildGenDesc = () => {
    if (sys.metadata?.description) return rt(sys.metadata.description);
    const parts = [];
    const c1 = f(1,'C'), d1 = f(1,'D');
    if (c1?.meaning?.description) parts.push(`1${SYM.C}: ${c1.meaning.description.split('.')[0]}`);
    if (d1?.meaning?.description) parts.push(`1${SYM.D}: ${d1.meaning.description.split('.')[0]}`);
    if (n1) {
      const baseH = n1.meaning?.hcp, baseKey = baseH ? `${baseH[0]}-${baseH[1]}` : '';
      const varKeys = new Set([baseKey, ...(n1.variants??[]).map(v => { const vh=v.meaningOverride?.hcp; return vh?`${vh[0]}-${vh[1]}`:baseKey; })]);
      if (varKeys.size > 1) {
        const ranges = [...new Set((n1.variants??[]).map(v => { const h=v.meaningOverride?.hcp; return h?`${h[0]}\u2013${h[1]}`:''; }).filter(Boolean))];
        parts.push(ranges.length ? `Variable NT (${ranges.join(', ')})` : 'Variable NT');
      } else parts.push(baseH ? `NT: ${baseH[0]}\u2013${baseH[1]} HCP` : '');
    }
    return rt(parts.filter(Boolean).join('; '));
  };

  const buildSuppDetails = () => suppNotes.map(n => rt(n)).join('<br>');

  // ── Border shorthands matching the reference exactly ──────────────────────
  const O = '1.50pt solid #000000';   // thick outer
  const I = '1px solid #000000';      // thin inner
  const G = '#e5e5e5';                // gray header background
  const P = 'padding:0 0.05cm';       // standard cell padding

  // ── Cell style builder ────────────────────────────────────────────────────
  // Each side is: 'O' (thick), 'I' (thin), 'N' (none)
  const cs = (t, b, l, r, extra='') => {
    const side = s => s==='O'?O : s==='I'?I : 'none';
    return `border-top:${side(t)};border-bottom:${side(b)};border-left:${side(l)};border-right:${side(r)};${P}${extra?';'+extra:''}`;
  };

  // ── Page 1: single flat table — 10 columns matching wbf.html exactly ──────
  // col1=332 | col2=10(spacer) | col3=46 | col4=34 | col5=62 | col6=72 | col7=34 | col8=104 | col9=8(spacer) | col10=315
  // Middle section spans cols 3-8 (colspan="6", effective width 352px).
  // Signals section splits: col3=46(num), col3-4(100px, partner's lead), col5-6(106px, declarer), col8=104(discarding)

  // Helper: one row of the flat table
  // left=html for col1, mid=html for cols3-8, right=html for col10
  // leftStyle / midStyle / rightStyle = inline style strings (use cs())
  const row = (leftHtml, leftStyle, midHtml, midColspan, midStyle, rightHtml, rightStyle) =>
    `<tr valign="top">
      <td style="${leftStyle}">${leftHtml}</td>
      <td colspan="${midColspan}" style="${midStyle}">${midHtml}</td>
      <td style="${rightStyle}">${rightHtml}</td>
    </tr>`;

  // For rows where the middle is split into the signals 4-part sub-columns:
  // cols 3(46), 3-4(100), 5-6(106+3=109), 8(104)
  const sigRow = (numHtml, partnerHtml, declarerHtml, discardHtml, numT, numB, dataT, dataB) =>
    `<tr valign="top">
      <td style="${cs(numT,numB,'O','I')}">${numHtml}</td>
      <td colspan="2" style="${cs(dataT,dataB,'I','I')}">${partnerHtml}</td>
      <td colspan="2" style="${cs(dataT,dataB,'I','I')}">${declarerHtml}</td>
      <td style="${cs(dataT,dataB,'I','O')}">${discardHtml}</td>
    </tr>`;

  // Wrap middle-section rows that are completely blank in all 6 middle cols
  const blankMid = (t,b) => `<td colspan="6" style="${cs(t,b,'O','O')}">&nbsp;</td>`;

  // bold section header text
  const bld = s => `<b>${s}</b>`;

  // ─── Build all 43 rows ────────────────────────────────────────────────────
  // The table has 10 physical columns:
  //   col1(332px) | col2(10px,spacer,rowspan43) | col3-8(middle,352px) | col9(8px,spacer,rowspan43) | col10(315px)
  // Row 1 must emit all 10 cells including the two rowspan="43" spacers.
  // All subsequent rows only need 3 cells: col1, colspan6 (cols3-8), col10.
  const rows = [];

  // Row 1: section headers + two spacer columns (rowspan="43" each)
  rows.push(`<tr valign="top">
    <td style="${cs('O','N','O','O')};background:${G};text-align:center"><b>DEFENSIVE AND COMPETITIVE BIDDING</b></td>
    <td rowspan="43" style="border:none;padding:0">&nbsp;</td>
    <td colspan="6" style="${cs('O','N','O','O')};background:${G};text-align:center"><b>LEADS AND SIGNALS</b></td>
    <td rowspan="43" style="border:none;padding:0">&nbsp;</td>
    <td style="${cs('O','O','O','O')};background:${G};text-align:center"><b>W B F CONVENTION CARD</b></td>
  </tr>`);

  // Row 2: OVERCALLS | OPENING LEADS STYLE | (blank - WBF box continues)
  rows.push(row(
    bld('OVERCALLS (Style: Responses: 1 / 2 Level; Reopening)'), cs('O','O','O','O'),
    bld('OPENING LEADS STYLE'), 6, cs('O','O','O','O'),
    '', cs('N','N','O','O')
  ));

  // Row 3: (blank) | [blank] Lead | In Partner's Suit | CATEGORY
  rows.push(`<tr valign="top">
    <td style="${cs('N','I','O','O')}">&nbsp;</td>
    <td colspan="2" style="${cs('N','I','O','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('N','I','I','I')}">Lead</td>
    <td colspan="2" style="${cs('N','I','I','O')}">In Partner's Suit</td>
    <td style="${cs('N','N','O','O')}"><b>CATEGORY:</b> <small>i.e. Green / Blue / Red / HUM / Brown Sticker</small></td>
  </tr>`);

  // Row 4: (blank) | Suit | (blank) | (blank) | NCBO
  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','O','I')}">Suit</td>
    <td colspan="2" style="${cs('I','I','I','I')}">${trunc(leadsVsSuit[0]?.method??'','Lead vs suit')}</td>
    <td colspan="2" style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('N','N','O','O')}"><b>NCBO:</b></td>
  </tr>`);

  // Row 5: (blank) | NT | (blank) | (blank) | PLAYERS
  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','O','I')}">NT</td>
    <td colspan="2" style="${cs('I','I','I','I')}">${trunc(leadsVsNT[0]?.method??'','Lead vs NT')}</td>
    <td colspan="2" style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('N','N','O','O')}"><b>PLAYERS:</b> ${rt(sys.name??'')}</td>
  </tr>`);

  // Row 6: (blank) | Subseq | (blank) | (blank) | EVENT
  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','O','I')}">Subseq</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('N','N','O','O')}">EVENT (Open/Women/Senior/Transnational)</td>
  </tr>`);

  // Row 7: (blank) | Other: (full 6-col mid) | (blank right)
  rows.push(row(
    '&nbsp;', cs('I','I','O','O'),
    'Other:', 6, cs('I','I','O','O'),
    '&nbsp;', cs('N','N','O','O')
  ));

  // Row 8: (blank overcall content) | (blank mid) | (blank right)
  rows.push(row(
    '&nbsp;', cs('N','N','O','O'),
    '&nbsp;', 6, cs('N','N','O','O'),
    '&nbsp;', cs('N','N','O','O')
  ));

  // Row 9: 1NT OVERCALL | LEADS (header) | SYSTEM SUMMARY (rowspan=2)
  rows.push(`<tr valign="top">
    <td style="${cs('O','O','O','O')}">${bld('1NT OVERCALL (2nd/4th Live; Responses; Reopening)')}</td>
    <td colspan="6" style="${cs('O','O','O','O')}">${bld('LEADS')}</td>
    <td rowspan="2" style="${cs('O','I','O','O')};background:${G};text-align:center"><b>SYSTEM SUMMARY</b></td>
  </tr>`);

  // Row 10: (blank) | Lead | Vs. Suit | Vs. NT sub-headers (no right col — consumed by rowspan)
  rows.push(`<tr valign="top">
    <td style="${cs('N','I','O','O')}">&nbsp;</td>
    <td colspan="2" style="${cs('N','I','O','I')}">Lead</td>
    <td colspan="2" style="${cs('N','I','I','I')}">Vs. Suit</td>
    <td colspan="2" style="${cs('N','I','I','O')}">Vs. NT</td>
  </tr>`);

  // Rows 11-18: leads table rows (Ace/King/Queen/Jack/10/9/Hi-X/Lo-X) + right col content
  const leadLabels = ['Ace','King','Queen','Jack','10','9','Hi-X','Lo-X'];
  const rightLeadsContent = [
    `GENERAL APPROACH AND STYLE`,
    rt(sys.metadata?.description ? sys.metadata.description.slice(0,80) : buildGenDesc().replace(/<[^>]+>/g,'')),
    '&nbsp;','&nbsp;','&nbsp;','&nbsp;','&nbsp;','&nbsp;'
  ];
  leadLabels.forEach((lbl, i) => {
    const isFirst = i === 0;
    const isLast  = i === 7;
    rows.push(`<tr valign="top">
      <td style="${cs('I','I','O','O')}">&nbsp;</td>
      <td colspan="2" style="${cs(isFirst?'I':'I', isLast?'N':'I','O','I')}">${lbl}</td>
      <td colspan="2" style="${cs('I',isLast?'N':'I','I','I')}">&nbsp;</td>
      <td colspan="2" style="${cs('I',isLast?'N':'I','I','O')}">&nbsp;</td>
      <td style="${cs(isFirst?'I':'I','I','O','O')}">${rightLeadsContent[i]}</td>
    </tr>`);
  });

  // Row 19: "Reopen:" | SIGNALS IN ORDER OF PRIORITY | (blank right)
  rows.push(row(
    'Reopen:', cs('I','N','O','O'),
    bld('SIGNALS IN ORDER OF PRIORITY'), 6, cs('O','O','O','O'),
    '&nbsp;', cs('I','N','O','O')
  ));

  // Row 20: DIRECT & JUMP CUE BIDS | signals col headers (Partner's Lead | Declarer's Lead | Discarding) | SPECIAL BIDS THAT MAY REQUIRE DEFENSE
  rows.push(`<tr valign="top">
    <td style="${cs('O','O','O','O')}">${bld('DIRECT &amp; JUMP CUE BIDS (Style; Response; Reopen)')}</td>
    <td style="${cs('N','I','O','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('N','I','I','I')}">Partner's Lead</td>
    <td colspan="2" style="${cs('N','I','I','I')}">Declarer's Lead</td>
    <td style="${cs('N','I','I','O')}">Discarding</td>
    <td style="${cs('O','O','O','O')}">${bld('SPECIAL BIDS THAT MAY REQUIRE DEFENSE')}</td>
  </tr>`);

  // Rows 21-23: signals priority rows — Suit 1,2,3 (with left col content on first)
  // Row 21: (blank cue bid) | 1 | (blank) | (blank) | (blank) | special bids content
  const sig1s  = trunc(suitSig?.method??'', 'Suit signal 1');
  const sig1nt = trunc(ntSig?.method??'',   'NT signal 1');
  const dis1s  = trunc(suitDisc?.method??'','Suit discard 1');
  const dis1nt = trunc(ntDisc?.method??'',  'NT discard 1');

  rows.push(`<tr valign="top">
    <td style="${cs('N','I','O','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','I')}" align="right">1</td>
    <td colspan="2" style="${cs('I','I','I','I')}">${sig1s}</td>
    <td colspan="2" style="${cs('N','I','I','I')}">&nbsp;</td>
    <td style="${cs('N','I','I','O')}">${dis1s}</td>
    <td style="${cs('N','I','O','O')}">&nbsp;</td>
  </tr>`);

  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','I')}" align="right">Suit 2</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','I')}" align="right">3</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  // Row 24: (blank) | NT 1 row
  rows.push(`<tr valign="top">
    <td style="${cs('N','N','O','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','I')}" align="right">1</td>
    <td colspan="2" style="${cs('I','I','I','I')}">${sig1nt}</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td style="${cs('I','I','I','O')}">${dis1nt}</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  rows.push(`<tr valign="top">
    <td style="${cs('O','O','O','O')}"><b>VS. NT (vs. Strong/Weak; Reopening; PH)</b></td>
    <td style="${cs('I','I','O','I')}" align="right">NT 2</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','I','I','I')}">&nbsp;</td>
    <td style="${cs('I','I','I','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  rows.push(`<tr valign="top">
    <td style="${cs('N','I','O','O')}">&nbsp;</td>
    <td style="${cs('N','N','O','I')}" align="right">3</td>
    <td colspan="2" style="${cs('I','N','I','I')}">&nbsp;</td>
    <td colspan="2" style="${cs('I','N','I','I')}">&nbsp;</td>
    <td style="${cs('I','N','I','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  // Row 27: (blank) | Signals (including Trumps): | (right)
  rows.push(row(
    '&nbsp;', cs('I','I','O','O'),
    'Signals (including Trumps):', 6, cs('O','N','O','O'),
    '&nbsp;', cs('I','I','O','O')
  ));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('O','I','O','O'), '&nbsp;', cs('I','I','O','O')));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('I','N','O','O'), '&nbsp;', cs('I','I','O','O')));

  // Row 30: (blank) | DOUBLES (gray, rowspan=2) | (blank right)
  rows.push(`<tr valign="top">
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
    <td rowspan="2" colspan="6" style="${cs('O','O','O','O')};background:${G};text-align:center"><b>DOUBLES</b></td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);
  rows.push(`<tr valign="top">
    <td style="${cs('I','N','O','O')}">&nbsp;</td>
    <td style="${cs('I','I','O','O')}">&nbsp;</td>
  </tr>`);

  // Row 32: VS. PREEMTS | TAKEOUT DOUBLES | (right blank)
  const vsPremptsDesc = trunc(ov.filter(n=>n.call?.type==='bid'&&n.call.level>=3).map(n=>`${n.call.level}${SYM[n.call.strain]??n.call.strain}: ${n.meaning?.description??''}`).join('; '),'VS preempts',80);
  rows.push(row(
    bld('VS.PREEMTS (Doubles; Cue-bids; Jumps; NT Bids)'), cs('O','N','O','O'),
    bld('TAKEOUT DOUBLES (Style; Responses; Reopening)'), 6, cs('O','N','O','O'),
    '&nbsp;', cs('I','I','O','O')
  ));
  rows.push(row(
    vsPremptsDesc||'&nbsp;', cs('N','I','O','O'),
    '&nbsp;', 6, cs('N','I','O','O'),
    '&nbsp;', cs('I','I','O','O')
  ));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('I','I','O','O'), '&nbsp;', cs('I','I','O','O')));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('I','I','O','O'), '&nbsp;', cs('I','I','O','O')));

  // Row 36: VS. ARTIFICIAL STRONG OPENINGS | SPECIAL, ARTIFICIAL & COMPETITIVE DBLS/RDLS | SPECIAL FORCING PASS SEQUENCES
  rows.push(row(
    bld('VS. ARTIFICIAL STRONG OPENINGS — i.e. 1♣ or 2♣'), cs('O','N','O','O'),
    '&nbsp;', 6, cs('I','N','O','O'),
    bld('SPECIAL FORCING PASS SEQUENCES'), cs('I','N','O','O')
  ));
  rows.push(row('&nbsp;', cs('N','I','O','O'), bld('SPECIAL, ARTIFICIAL &amp; COMPETITIVE DBLS/RDLS'), 6, cs('O','N','O','O'), '&nbsp;', cs('N','I','O','O')));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('O','I','O','O'), '&nbsp;', cs('I','I','O','O')));
  rows.push(row('&nbsp;', cs('N','I','O','O'), '&nbsp;', 6, cs('I','I','O','O'), '&nbsp;', cs('I','I','O','O')));

  // Row 40: OVER OPPONENTS' TAKEOUT DOUBLE | (right continues) | IMPORTANT NOTES
  rows.push(row(
    bld("OVER OPPONENTS' TAKEOUT DOUBLE"), cs('O','N','O','O'),
    '&nbsp;', 6, cs('I','I','O','O'),
    bld('IMPORTANT NOTES'), cs('I','N','O','O')
  ));
  rows.push(row('&nbsp;', cs('N','N','O','O'), '&nbsp;', 6, cs('I','I','O','O'), '&nbsp;', cs('N','I','O','O')));
  rows.push(row('&nbsp;', cs('I','I','O','O'), '&nbsp;', 6, cs('I','I','O','O'), '&nbsp;', cs('I','I','O','O')));

  // Row 43: last row — thick bottom
  rows.push(row('&nbsp;', cs('N','O','O','O'), '&nbsp;', 6, cs('I','O','O','O'), '<b>PSYCHICS:</b>', cs('I','O','O','O')));

  // ─── Page 1 ────────────────────────────────────────────────────────────────
  const page1 = `<div style="page-break-after:always">
    <table cellpadding="2" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:9pt;font-family:Arial,sans-serif">
      <col style="width:31.3%"/>
      <col style="width:0.9%"/>
      <col style="width:4.3%"/>
      <col style="width:3.2%"/>
      <col style="width:5.8%"/>
      <col style="width:6.8%"/>
      <col style="width:3.2%"/>
      <col style="width:9.8%"/>
      <col style="width:0.8%"/>
      <col style="width:29.7%"/>
      ${rows.join('\n')}
    </table>
  </div>`;

  // ─── Page 2: OPENING BID DESCRIPTIONS ─────────────────────────────────────
  // Columns: Opening(48) | Tick-if-artificial(34) | Min.cards(42) | Neg.Dbl.Thru(42) | Description(156) | Responses(251) | Subsequent Action(222) | Competitive & Passed Hand(164)
  const O2 = O, I2 = I;
  const hdrCell = (w,txt,extra='') =>
    `<td style="background:${G};border:${O2};padding:2px 3px;${extra}"><b>${txt}</b></td>`;

  const opRow = (nd, label) => {
    if (!nd) return `<tr valign="top">
      <td style="border-top:${O2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">${label}</td>
      <td style="border:${I2};padding:1px 2px">&nbsp;</td>
      <td style="border:${I2};padding:1px 2px">&nbsp;</td>
      <td style="border:${I2};padding:1px 2px">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${O2};border-left:${I2};border-right:${O2};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
      <td style="border:none;padding:0"></td>
      <td style="border-top:${O2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
    </tr>`;
    const m = nd.meaning ?? {};
    const art = (m.alert || m.announce) ? '✓' : '';
    let minLen = '';
    if (m.shape) { const nm = m.shape.match(/\d+/); if (nm) minLen = nm[0]; }
    const vline = nd.variants?.length ? ` [${variantInline(nd.variants)}]` : '';
    const desc = trunc((m.description??'') + vline, label + ' desc', 80);
    const resp = trunc(respText(nd), label + ' resp', 150);
    return `<tr valign="top">
      <td style="border-top:${O2};border-left:${O2};border-right:${O2};border-bottom:none;padding:1px 3px">${label}</td>
      <td style="border-top:${I2};border-bottom:${O2};border-right:${O2};padding:1px 2px;text-align:center">${art}</td>
      <td style="border-top:${I2};border-bottom:${O2};border-right:${O2};padding:1px 2px;text-align:center">${minLen}</td>
      <td style="border:${O2};padding:1px 2px;text-align:center">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${I2};border-left:none;border-right:${O2};padding:1px 3px">${desc}</td>
      <td style="border-top:${O2};border-bottom:${I2};border-left:${O2};border-right:${O2};padding:1px 3px">${resp}</td>
      <td style="border-top:${O2};border-bottom:${I2};border-left:none;border-right:none;padding:0">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${I2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
    </tr>
    <tr valign="top">
      <td style="border-top:none;border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${O2};border-right:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${O2};border-right:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border-top:${I2};border-bottom:${O2};border-left:none;border-right:${O2};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${I2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
      <td style="border-top:${I2};border-bottom:${O2};border-left:none;border-right:none;padding:0">&nbsp;</td>
      <td style="border-top:${I2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
    </tr>`;
  };

  // 3/4/5-level openings — one summary row per level group
  const op3 = op.filter(n => n.call?.type==='bid' && n.call.level===3);
  const op4 = op.filter(n => n.call?.type==='bid' && n.call.level===4);
  const op5 = op.filter(n => n.call?.type==='bid' && n.call.level>=5);
  const multiRow = (lbl, nds) => {
    if (!nds.length) return '';
    const desc = trunc(nds.map(nd=>`${nd.call.level}${SYM[nd.call.strain]??nd.call.strain}: ${nd.meaning?.description??''}`).join('; '), lbl+' desc', 220);
    const resp = trunc(nds.map(nd=>respText(nd)).filter(Boolean).join(' | '), lbl+' resp', 150);
    return `<tr valign="top">
      <td style="border-top:${O2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">${lbl}</td>
      <td style="border:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border:${O2};padding:1px 2px">&nbsp;</td>
      <td style="border-top:${O2};border-bottom:${O2};border-left:none;border-right:${O2};padding:1px 3px">${desc}</td>
      <td style="border-top:${O2};border-bottom:${O2};border-left:${O2};border-right:${O2};padding:1px 3px">${resp}</td>
      <td style="border:none;padding:0">&nbsp;</td>
      <td style="border:${O2};padding:1px 3px">&nbsp;</td>
    </tr>`;
  };

  // "Higher" row — thick, full width per sample
  const higherRow = `<tr valign="top">
    <td style="border:${O2};padding:1px 3px">&nbsp;</td>
    <td style="border:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border-top:${O2};border-bottom:${O2};border-left:none;border-right:${I2};padding:1px 3px">&nbsp;</td>
    <td style="border-top:${O2};border-bottom:${O2};border-left:${I2};border-right:${I2};padding:1px 3px">&nbsp;</td>
    <td colspan="2" style="background:${G};border-top:${O2};border-bottom:${O2};border-left:${I2};border-right:${O2};padding:1px 3px;text-align:center"><b>HIGH LEVEL BIDDING</b></td>
  </tr>`;

  const highLevelBlankRows = Array(7).fill(0).map((_,i) => `<tr valign="top">
    <td style="border-top:none;border-bottom:${i===6?O2:I2};border-left:${O2};border-right:${O2};padding:1px 3px">&nbsp;</td>
    <td style="border-top:${i===0?'none':I2};border-bottom:${I2};border-right:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border-top:${i===0?'none':I2};border-bottom:${I2};border-right:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border-top:${i===0?'none':I2};border-bottom:${I2};border-right:${O2};padding:1px 2px">&nbsp;</td>
    <td style="border-top:${i===0?I2:'none'};border-bottom:${i===6?O2:I2};border-left:none;border-right:${i<6?I2:I2};padding:1px 3px">&nbsp;</td>
    <td style="border-top:${i===0?I2:'none'};border-bottom:${i===6?O2:I2};border-left:${i===0?O2:I2};border-right:${i<6?I2:I2};padding:1px 3px">&nbsp;</td>
    <td colspan="2" style="border-top:${i===0?'none':I2};border-bottom:${i===6?O2:I2};border-left:${i===0?'none':I2};border-right:${O2};padding:1px 3px">&nbsp;</td>
  </tr>`).join('');

  const page2 = `<div style="page-break-before:always">
    <table cellpadding="2" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:8pt;font-family:Arial,sans-serif">
      <col style="width:5.5%"/>
      <col style="width:4%"/>
      <col style="width:5%"/>
      <col style="width:5%"/>
      <col style="width:18%"/>
      <col style="width:29%"/>
      <col style="width:26%"/>
      <col style="width:19%"/>
      <tr>
        ${hdrCell('','OPENING','text-align:center')}
        ${hdrCell('','TICK IF ARTIFICIAL','text-align:center')}
        ${hdrCell('','MIN. NO. OF CARDS','text-align:center')}
        ${hdrCell('','NEG. DBL THRU','text-align:center')}
        ${hdrCell('','DESCRIPTION','text-align:center')}
        ${hdrCell('','RESPONSES','text-align:center')}
        ${hdrCell('','SUBSEQUENT ACTION','text-align:center')}
        ${hdrCell('','COMPETITIVE &amp; PASSED HAND BIDDING','text-align:center')}
      </tr>
      ${opRow(f(1,'C'), '1♣')}
      ${opRow(f(1,'D'), '1♦')}
      ${opRow(f(1,'H'), '1♥')}
      ${opRow(f(1,'S'), '1♠')}
      ${opRow(f(1,'N'), '1NT')}
      ${opRow(f(2,'C'), '2♣')}
      ${opRow(f(2,'D'), '2♦')}
      ${opRow(f(2,'H'), '2♥')}
      ${opRow(f(2,'S'), '2♠')}
      ${opRow(f(2,'N'), '2NT')}
      ${opRow(f(3,'N'), '3NT')}
      ${multiRow('3 bids', op3)}
      ${multiRow('4 bids', op4)}
      ${multiRow('5 bids', op5)}
      ${higherRow}
      ${highLevelBlankRows}
    </table>
  </div>`;

  // ─── Supplementary notes (page 3 if any) ──────────────────────────────────
  const page3 = suppNotes.length ? `<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:8pt;padding:6mm">
    <b>WBF NOTES — ${rt(sys.name??'')}</b><br><br>
    ${buildSuppDetails()}
  </div>` : '';

  const body = page1 + page2 + page3;

  const extraCss = `
    @page { size: 29.7cm 21cm; margin-left:0.75cm; margin-right:0.44cm; margin-top:0.42cm; margin-bottom:0.43cm }
    body { font-family: Arial, sans-serif; font-size: 9pt; background: #fff; margin: 0; padding: 0; }
    table { border-collapse: collapse; margin: 0; }
    th, td { border: none; padding: 0; }
    .suit-club    { color: #111; font-weight: bold; }
    .suit-diamond { color: #b00; font-weight: bold; }
    .suit-heart   { color: #b00; font-weight: bold; }
    .suit-spade   { color: #111; font-weight: bold; }
    .suit-nt      { color: #111; }
  `;
  return wrap(`${sys.name} — WBF`, extraCss, body);
}
