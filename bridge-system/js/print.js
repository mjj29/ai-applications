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
  // EBU Convention Card 20B — table-based layout matching the official EBU 20B form
  const op = sys.openings ?? [], ov = sys.overcalls ?? [], c = sys.carding ?? {};
  const f = (lv, st) => findBid(op, lv, st);
  const hcpStr = nd => { const h = nd?.meaning?.hcp; return h ? `${h[0] ?? ''}–${h[1] ?? ''}` : ''; };
  const n1 = f(1, 'N');
  const convs = sys.conventions ?? {};

  // ── Overflow note system ──────────────────────────────────────────────────
  const extraNotes = [];
  let noteNum = 0;
  const addNote = (label, fullText) => {
    noteNum++;
    extraNotes.push(`[${noteNum}] ${label}: ${fullText}`);
    return ` [${noteNum}]`;
  };
  const trunc = (text, label, maxCh = 65) => {
    if (!text) return '';
    const s = String(text);
    return s.length <= maxCh ? s : s.slice(0, maxCh - 3).trimEnd() + '\u2026' + addNote(label, s);
  };

  // ── Helper: find bid in continuation tree ─────────────────────────────────
  const findInCont = (cont, lv, st) => {
    if (!cont) return null;
    if (cont.type === 'nodes') {
      const d = (cont.nodes ?? []).find(n => n.call?.type === 'bid' && n.call.level === lv && n.call.strain === st);
      if (d) return d;
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        if (!cv) continue;
        const found = (cv.nodes ?? []).find(n => n.call?.type === 'bid' && n.call.level === lv && n.call.strain === st);
        if (found) return found;
      }
    }
    if (cont.type === 'ref') {
      const cv = convs[cont.conventionId];
      return cv ? (cv.nodes ?? []).find(n => n.call?.type === 'bid' && n.call.level === lv && n.call.strain === st) : null;
    }
    return null;
  };

  // ── 1NT response for a 2-level strain ─────────────────────────────────────
  const nt1Resp = st => {
    const cont = n1?.continuations;
    if (st === 'C' && cont?.type === 'nodes') {
      for (const ref of (cont.refs ?? [])) {
        const cv = convs[ref.conventionId];
        if (!cv) continue;
        const fn = cv.nodes?.[0];
        if (fn?.call?.type === 'bid' && fn.call.level === 2 && fn.call.strain === 'C')
          return cv.name ?? fn.meaning?.description ?? '';
      }
    }
    const nd = findInCont(cont, 2, st);
    return nd?.meaning?.description ?? '';
  };

  // ── 3+ level 1NT responses ─────────────────────────────────────────────────
  const nt1OtherResps = () => {
    const cont = n1?.continuations, results = [];
    const collect = nodes => { for (const n of nodes ?? []) if (n.call?.type === 'bid' && n.call.level >= 3) results.push(`${pc(n.call)}: ${n.meaning?.description ?? ''}`); };
    if (cont?.type === 'nodes') { collect(cont.nodes); for (const r of (cont.refs ?? [])) collect(convs[r.conventionId]?.nodes); }
    if (cont?.type === 'ref') collect(convs[cont.conventionId]?.nodes);
    return results.slice(0, 6).join('; ');
  };

  // ── 1NT after double / after interference ─────────────────────────────────
  const nt1AfterDbl = () => {
    for (const [id, cv] of Object.entries(convs))
      if (/^1nt.*(doubled?|dbl)/i.test(id) || /1nt.*doubled?/i.test(cv.name ?? '')) return cv.name ?? '';
    return '';
  };
  const nt1AfterInterf = () => {
    for (const [id, cv] of Object.entries(convs))
      if (/leb[ae]n/i.test(id + ' ' + (cv.name ?? ''))) return cv.name ?? '';
    return '';
  };

  // ── 1NT strength ──────────────────────────────────────────────────────────
  const nt1Strength = () => {
    if (!n1) return '';
    const h = n1.meaning?.hcp, base = h ? `${h[0]}\u2013${h[1]} HCP` : '';
    return n1.variants?.length ? (base ? `${base} (varies)` : 'Varies') : base;
  };

  // ── General description ───────────────────────────────────────────────────
  const buildGenDesc = () => {
    if (sys.metadata?.description) return sys.metadata.description;
    if (sys.metadata?.notes) return sys.metadata.notes;
    const parts = [];
    const c1 = f(1, 'C'), d1 = f(1, 'D');
    if (c1?.meaning?.description) parts.push(`1${SYM.C}: ${c1.meaning.description.split('.')[0]}`);
    if (d1?.meaning?.description) parts.push(`1${SYM.D}: ${d1.meaning.description.split('.')[0]}`);
    if (n1) {
      const vars = n1.variants ?? [];
      if (vars.length) {
        const ranges = [...new Set(vars.map(v => { const h = v.meaningOverride?.hcp; return h ? `${h[0]}\u2013${h[1]}` : ''; }).filter(Boolean))];
        parts.push(ranges.length ? `Variable NT (${ranges.join(', ')})` : 'Variable NT');
      } else parts.push(`NT: ${hcpStr(n1)} HCP`);
    }
    return parts.join('; ');
  };

  // ── Other aspects (called after all trunc() have executed) ─────────────────
  const buildOtherAspects = () => {
    const lines = [];
    if (sys.metadata?.otherAspects) lines.push(sys.metadata.otherAspects);
    if (n1?.variants?.length) {
      lines.push('1NT range varies: ' + n1.variants.map(v => {
        const mo = v.meaningOverride ?? {}, hcp = mo.hcp ? `${mo.hcp[0]}\u2013${mo.hcp[1]}` : '';
        return `${condLabel(v.condition)}: ${hcp ? hcp + ' HCP' : ''} ${mo.description || ''}`.trim();
      }).join('; '));
    }
    for (const bid of ['1C', '1D', '1H', '1S', '2C', '2D', '2H', '2S', '2N']) {
      const n = f(Number(bid[0]), bid[1]); if (!n?.meaning?.alert) continue;
      lines.push(`${bid}: ${(n.meaning?.description ?? '').split('.')[0]}`);
    }
    if (extraNotes.length) lines.push(...extraNotes);
    return lines.join('<br>') || '&nbsp;';
  };

  // ── Convention filters ────────────────────────────────────────────────────
  const slamConvRe = /slam|blackwood|gerber|keycard|rkcb|rkqg|viscount|general.?swiss/i;
  const respTableRe = /-resp(-|$)|\/resp(-|$)|-continuations?(-|$)/i;
  const isSlamConv = (id, cv) => slamConvRe.test(id) || slamConvRe.test(cv.name ?? '');
  const slamConvs = Object.entries(convs).filter(([id, cv]) => isSlamConv(id, cv)).map(([, cv]) => cv);
  const otherConvs = Object.entries(convs).filter(([id, cv]) => !isSlamConv(id, cv) && !respTableRe.test(id)).map(([, cv]) => cv);

  // ── Opening bid helpers ───────────────────────────────────────────────────
  const op3 = op.filter(n => n.call?.type === 'bid' && n.call.level === 3);
  const op4 = op.filter(n => n.call?.type === 'bid' && n.call.level === 4);

  // Response text — bid responses only (no doubles, passes, or opponent actions)
  const respText = nd => {
    if (!nd) return '';
    const cont = nd.continuations;
    if (!cont || cont.type === 'tbd' || cont.type === 'end') return '';
    if (cont.type === 'ref') { const cv = convs[cont.conventionId]; return cv ? `\u2192 ${cv.name}` : ''; }
    if (cont.type === 'nodes') {
      const bids = sortNodes(cont.nodes).filter(n => n.call?.type === 'bid');
      return bids.slice(0, 4).map(n => `${pc(n.call)}: ${n.meaning?.description ?? ''}`).join('; ');
    }
    return '';
  };

  // ── Carding ───────────────────────────────────────────────────────────────
  const leadsVsSuit = (c.leads ?? []).filter(r => !r.context || /suit|trump/i.test(r.context));
  const leadsVsNT   = (c.leads ?? []).filter(r => r.context && /nt|notrump/i.test(r.context));
  const suitSig  = (c.signals ?? []).find(r => !r.context || /suit/i.test(r.context))?.method ?? '';
  const ntSig    = (c.signals ?? []).find(r => r.context && /nt/i.test(r.context))?.method ?? suitSig;
  const suitDisc = (c.discards ?? []).find(r => !r.context || /suit/i.test(r.context))?.method ?? '';
  const ntDisc   = (c.discards ?? []).find(r => r.context && /nt/i.test(r.context))?.method ?? suitDisc;

  // ── Border constants and table builder ────────────────────────────────────
  const O = '2.25pt solid #000'; // outer border (thick)
  const I = '1px solid #000';    // inner border (thin)
  // Full-width table, no fixed layout — each section is its own table
  const tbl = rows => `<table style="width:100%;border-collapse:collapse">${rows}</table>`;

  // Section header row
  // isFirst=true: this section needs its own border-top (very first section on the page)
  // isFirst=false: previous section's border-bottom already provides the separator
  const secHdr = (txt, isFirst = false) =>
    `<tr><td colspan="99" style="border-top:${isFirst ? O : 'none'};border-left:${O};border-right:${O};border-bottom:${O};padding:3px 5px;text-align:center;font-weight:bold;text-transform:uppercase;font-size:10pt">${txt}</td></tr>`;

  // Sub-section separator (thick top border within a section)
  const subHdr = txt =>
    `<tr><td colspan="99" style="border-top:${O};border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px;font-weight:bold">${txt}</td></tr>`;

  // Lined blank rows (last row has thick bottom border to close section)
  const blankRows = n => Array(n).fill(0).map((_, i) =>
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${i === n - 1 ? O : I};padding:0 5px;height:16px">&nbsp;</td></tr>`
  ).join('');

  // ── PAGE 1 ────────────────────────────────────────────────────────────────

  // Header table (no outer borders — just Name/Partner/EBU No labels)
  const headerTable = tbl(
    `<tr>
      <td style="border:none;padding:3px 5px;font-size:14pt;font-weight:bold;width:15%">Name</td>
      <td style="border:none;padding:3px 5px">&nbsp;</td>
      <td style="border:none;padding:3px 5px;font-size:14pt;font-weight:bold;text-align:right;white-space:nowrap">EBU No.</td>
    </tr>
    <tr>
      <td style="border:none;padding:3px 5px;font-size:14pt;font-weight:bold">Partner</td>
      <td style="border:none;padding:3px 5px">&nbsp;</td>
      <td style="border:none;padding:3px 5px;font-size:14pt;font-weight:bold;text-align:right;white-space:nowrap">EBU No.</td>
    </tr>`
  );

  // General Description section (single-column, 4 ruled blank lines)
  const genDescTable = tbl(
    secHdr('GENERAL DESCRIPTION OF BIDDING METHODS', true) +
    blankRows(4)
  );

  // 1NT section — 2 columns: ~30% label | ~70% value
  const nt1Table = tbl(
    secHdr('1NT OPENINGS AND RESPONSES') +
    `<tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;width:30%;font-weight:bold">Strength</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px">${nt1Strength()}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;font-weight:bold">Shape constraints</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px">${n1?.meaning?.shape ?? '(semi-)balanced'}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px;font-weight:bold">Responses</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">2${ps('C')}&nbsp;${trunc(nt1Resp('C'), '1NT 2C', 55)}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">2${ps('D')}</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1Resp('D'), '1NT 2D', 55)}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">2${ps('H')}</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1Resp('H'), '1NT 2H', 55)}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">2${ps('S')}</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1Resp('S'), '1NT 2S', 55)}</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">2NT</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1Resp('N'), '1NT 2NT', 55)}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">Others</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1OtherResps(), '1NT other resps', 80)}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px">Action after opponents double</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(nt1AfterDbl(), 'After dbl', 65)}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:2px 5px">Action after other interference</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:2px 5px">${trunc(nt1AfterInterf(), 'After interference', 65)}</td>
    </tr>`
  );

  // Two-level openings — 4 columns: bid(8%) | meaning(auto) | responses(38%) | notes(8%)
  const twoLvlTable = tbl(
    secHdr('TWO-LEVEL OPENINGS AND RESPONSES') +
    `<tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;width:8%">&nbsp;</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;font-weight:bold">Meaning</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;font-weight:bold;width:38%">Responses</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;width:8%;text-align:center;font-weight:bold">Notes</td>
    </tr>` +
    ['C', 'D', 'H', 'S', 'N'].map((st, i) => {
      const nd = f(2, st), m = nd?.meaning ?? {};
      const vline = nd?.variants?.length ? ` [${variantInline(nd.variants)}]` : '';
      const meaning = trunc((m.description ?? '') + vline, `2${ps(st)} meaning`, 70);
      const resp = trunc(respText(nd), `2${ps(st)} resp`, 55);
      const isLast = i === 4;
      return `<tr>
        <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${isLast ? O : 'none'};padding:2px 5px">2${ps(st)}</td>
        <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${isLast ? O : 'none'};padding:2px 5px">${meaning}</td>
        <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${isLast ? O : 'none'};padding:2px 5px">${resp}</td>
        <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${isLast ? O : 'none'};padding:2px 5px">&nbsp;</td>
      </tr>`;
    }).join('')
  );

  // ── PAGE 2 ────────────────────────────────────────────────────────────────
  // 7-col: bid(12%) | hcp(9%) | note*(3%) | minLen(5%) | meaning(auto) | responses(27%) | notes(7%)
  const opBidRow = (nd, label) => {
    const m = nd?.meaning ?? {}, hcp = hcpStr(nd);
    const art = m.alert || m.announce ? '*' : '';
    let minLen = ''; if (m.shape) { const nm = m.shape.match(/\d+/); if (nm) minLen = nm[0]; }
    const vline = nd?.variants?.length ? ` [${variantInline(nd.variants)}]` : '';
    const meaning = trunc((m.description ?? '') + vline, `${label} meaning`, 65);
    const resp = trunc(respText(nd), `${label} resp`, 50);
    return `<tr>
      <td style="border-top:${I};border-left:${O};border-right:none;border-bottom:${I};padding:2px 5px">${label}</td>
      <td style="border:${I};padding:2px 4px;text-align:center">${hcp}</td>
      <td style="border:${I};padding:2px 2px;text-align:center">${art}</td>
      <td style="border:${I};padding:2px 4px;text-align:center">${minLen}</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px">${meaning}</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px">${resp}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">&nbsp;</td>
    </tr>`;
  };

  // Defensive row: label spans cols 1-4, then meaning, responses, notes
  const defRow = (lbl, val = '') =>
    `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px">${lbl}</td>
      <td style="border:${I};padding:2px 5px">${val}</td>
      <td style="border:${I};padding:2px 5px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">&nbsp;</td>
    </tr>`;

  // Defensive row for NT overcalls (with Direct/Protective labels)
  const defRow2 = (lbl, meaning = '', resp = '') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:none;border-bottom:${I};padding:2px 5px;vertical-align:middle">${lbl}</td>
      <td colspan="3" style="border-top:${I};border-left:${I};border-right:${I};border-bottom:${I};padding:2px 5px;font-size:8pt">&nbsp;</td>
      <td style="border:${I};padding:2px 5px;font-size:8pt">${meaning}</td>
      <td style="border:${I};padding:2px 5px;font-size:8pt">${resp}</td>
      <td style="border-top:${I};border-right:${O};border-bottom:${I};padding:2px 5px">&nbsp;</td>
    </tr>`;

  const page2Table = tbl(
    secHdr('OTHER OPENING BIDS', true) +
    `<tr>
      <td style="border-top:none;border-left:${O};border-right:none;border-bottom:none;padding:2px 5px;width:12%">&nbsp;</td>
      <td style="border:${I};padding:2px 4px;text-align:center;font-size:7.5pt;width:9%">HCP</td>
      <td style="border:${I};padding:1px 2px;text-align:center;font-size:6pt;width:3%">see<br>Note*</td>
      <td style="border:${I};padding:2px 4px;text-align:center;font-size:7.5pt;width:5%">Min<br>len</td>
      <td style="border-top:none;border-left:none;border-right:none;border-bottom:none;padding:2px 5px;text-align:center">CONVENTIONAL MEANING</td>
      <td style="border-top:none;border-left:none;border-right:none;border-bottom:none;padding:2px 5px;text-align:center;width:27%">SPECIAL RESPONSES</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px;text-align:center;width:7%">Notes</td>
    </tr>` +
    opBidRow(f(1, 'C'), `1${ps('C')}`) +
    opBidRow(f(1, 'D'), `1${ps('D')}`) +
    opBidRow(f(1, 'H'), `1${ps('H')}`) +
    opBidRow(f(1, 'S'), `1${ps('S')}`) +
    (op3.length ? op3 : [null]).map(nd => opBidRow(nd, nd ? pc(nd.call) : '3 bids')).join('') +
    (op4.length ? op4 : [null]).map(nd => opBidRow(nd, nd ? pc(nd.call) : '4 bids')).join('') +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:2px 5px;font-size:6.5pt">*(Please enter your normal HCP range in the HCP column. Please tick box if you have any special agreements involving different values in particular positions (e.g. light openings in third seat) and include further details under Supplementary Details).</td></tr>`
  );

  const defensiveTable = tbl(
    secHdr('DEFENSIVE METHODS AFTER OPPONENTS OPEN') +
    `<tr>
      <td colspan="4" style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">OPPONENTS OPEN A NATURAL ONE OF A SUIT</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">CONVENTIONAL MEANING</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">SPECIAL RESPONSES</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">Notes</td>
    </tr>` +
    defRow('Simple overcall', ov.find(n => n.call?.type === 'bid' && n.call?.level === 1 && n.call?.strain !== 'N')?.meaning?.description ?? '') +
    defRow('Jump overcall') +
    defRow('Cue bid') +
    defRow2('1NT', `Direct: ${ov.find(n => n.call?.type === 'bid' && n.call?.level === 1 && n.call?.strain === 'N')?.meaning?.description ?? ''}`) +
    defRow2('2NT', `Direct: ${ov.find(n => n.call?.type === 'bid' && n.call?.level === 2 && n.call?.strain === 'N')?.meaning?.description ?? ''}`) +
    `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">OPPONENTS OPEN WITH</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">DEFENSIVE METHODS</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">SPECIAL RESPONSES</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">Notes</td>
    </tr>` +
    defRow('Strong 1\u2663') +
    defRow('Short 1\u2663/1\u2666') +
    defRow('Weak 1NT') +
    defRow('Strong 1NT') +
    defRow('Weak 2') +
    defRow('Weak 3') +
    defRow('4 bids') +
    `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:2px 5px">Multi 2\u2666</td>
      <td style="border:${I};border-bottom:${O};padding:2px 5px">&nbsp;</td>
      <td style="border:${I};border-bottom:${O};padding:2px 5px">&nbsp;</td>
      <td style="border-top:${I};border-right:${O};border-bottom:${O};padding:2px 5px">&nbsp;</td>
    </tr>`
  );

  const slamTable = tbl(
    secHdr('SLAM CONVENTIONS') +
    `<tr>
      <td colspan="4" style="border-top:none;border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px;font-weight:bold">Name</td>
      <td colspan="2" style="border-top:none;border-left:none;border-right:${I};border-bottom:none;padding:2px 5px;font-weight:bold">Meaning of Responses</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px;font-weight:bold">Action over interference</td>
    </tr>` +
    (slamConvs.length ? slamConvs : [{}]).map(cv => `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px;height:16px">${cv.name ?? ''}</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:none;padding:2px 5px">${trunc(cv.description ?? '', `${cv.name ?? 'slam'} desc`, 65)}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">&nbsp;</td>
    </tr>`).join('') +
    `<tr>
      <td colspan="4" style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:2px 5px;height:16px">&nbsp;</td>
      <td colspan="2" style="border-top:${I};border-left:none;border-right:${I};border-bottom:${O};padding:2px 5px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:2px 5px">&nbsp;</td>
    </tr>`
  );

  // ── PAGE 3 ────────────────────────────────────────────────────────────────
  // 2-column: label(38%) | value(62%)
  const fRow = (lbl, val = '') =>
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px;width:38%">${lbl}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${val}</td>
    </tr>`;

  const competitiveTable = tbl(
    secHdr('COMPETITIVE AUCTIONS', true) +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${I};padding:2px 5px">Agreements after opening of one of a suit and overcall by opponents</td></tr>` +
    fRow('Level to which negative doubles apply') +
    fRow('Special meaning of bids') +
    fRow('Exceptions / other agreements') +
    subHdr('Agreements after opponents double for takeout') +
    fRow('Redouble') +
    fRow('New suit') +
    fRow('Jump in new suit') +
    fRow('Jump raise') +
    fRow('2NT') +
    `<tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${O};padding:2px 5px;width:38%">Other</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${O};padding:2px 5px">&nbsp;</td>
    </tr>` +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px">Other agreements concerning doubles and redoubles</td></tr>` +
    blankRows(3)
  );

  const otherConvsTable = tbl(
    secHdr('OTHER CONVENTIONS') +
    (otherConvs.length
      ? otherConvs.map(cv =>
          `<tr>
            <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:none;padding:2px 5px;width:38%;font-weight:bold">${cv.name ?? ''}</td>
            <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:none;padding:2px 5px">${trunc(cv.description ?? '', `${cv.name ?? 'conv'} desc`, 80)}</td>
          </tr>`
        ).join('') +
        `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:2px 5px;height:16px">&nbsp;</td></tr>`
      : blankRows(4)
    )
  );

  const suppTable = tbl(
    secHdr('SUPPLEMENTARY DETAILS') +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px;font-size:7pt">(Please cross-reference where appropriate to the relevant part of card, and continue on back if needed).</td></tr>` +
    blankRows(5)
  );

  // ── PAGE 4 ────────────────────────────────────────────────────────────────
  const suitCombos = ['A <u>K</u>', '<u>A</u> K x', '<u>K</u> Q 10', '<u>K</u> Q x', 'K <u>J</u> 10', 'K <u>10</u> 9',
    '<u>Q</u> J 10', '<u>Q</u> J x', '<u>J</u> 10 x', '10 x <u>x</u>', '<u>10</u> 9 x', '9 <u>8</u> 7 x',
    '10 x x <u>x</u>', 'H x <u>x</u>', 'H x x <u>x</u>', 'H x x <u>x</u> x', 'H x x <u>x</u> x x',
    '<u>x</u> x', 'x <u>x</u> x', 'x <u>x</u> x x', 'x <u>x</u> x x x'];
  const ntCombos = ['<u>A</u> K x (<u>x</u>)', 'A <u>J</u> 10 x', '<u>K</u> Q 10', '<u>K</u> Q x', 'K <u>J</u> 10', 'K <u>10</u> 9',
    '<u>Q</u> J 10', '<u>Q</u> J x', '<u>J</u> 10 x', '10 x <u>x</u>', '<u>10</u> 9 x', '9 <u>8</u> 7 x',
    '10 x x <u>x</u>', 'H x <u>x</u>', 'H x x <u>x</u>', 'H x x <u>x</u> x', 'H x x <u>x</u> x x',
    '<u>x</u> x', 'x <u>x</u> x', 'x <u>x</u> x x', 'x <u>x</u> x x x'];

  // Opening leads inner table: 3 rows of 7 combos + write rows, with label spanning all rows
  const leadsInnerTbl = (combos, label) => {
    const g = i => combos.slice(i * 7, i * 7 + 7);
    const cRow = group => group.map(cx => `<td style="padding:1px 3px;font-size:7pt;white-space:nowrap;border:none">${cx}</td>`).join('');
    const wRow = () => Array(7).fill(`<td style="border-bottom:1px solid #ccc;height:14px;border-top:none;border-left:none;border-right:none;padding:0">&nbsp;</td>`).join('');
    return `<table style="width:100%;border-collapse:collapse">
      <tr>
        <td rowspan="6" style="width:65px;border-right:${I};border-top:none;border-left:none;border-bottom:none;padding:3px 4px;text-align:center;vertical-align:middle;font-size:8pt">${label}</td>
        ${cRow(g(0))}
      </tr>
      <tr>${wRow()}</tr>
      <tr>${cRow(g(1))}</tr>
      <tr>${wRow()}</tr>
      <tr>${cRow(g(2))}</tr>
      <tr>${wRow()}</tr>
    </table>`;
  };

  const openingLeadsTable = tbl(
    secHdr('OPENING LEADS', true) +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:${I};padding:3px 5px;font-size:7.5pt">For all the card combinations shown, clearly mark the card normally led if different from the underlined card. &emsp;<span style="border:${O};padding:1px 5px;font-size:7.5pt">Hatch over or shade this box if using non-standard leads.</span></td></tr>` +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:0">${leadsInnerTbl(suitCombos, 'v.&nbsp;suit<br>contracts')}</td></tr>` +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:0">${leadsInnerTbl(ntCombos, 'v.&nbsp;NT<br>contracts')}</td></tr>` +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px">Other agreements in leading, e.g. high level contracts, partnership suits:&ndash;</td></tr>` +
    blankRows(2)
  );

  const cardingTable = tbl(
    secHdr('CARDING METHODS') +
    `<tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px;width:30%">&nbsp;</td>
      <td style="border-top:none;border-left:none;border-right:${I};border-bottom:none;padding:2px 5px;text-align:center">Primary method v. suit contracts</td>
      <td style="border-top:none;border-left:none;border-right:${O};border-bottom:none;padding:2px 5px;text-align:center">Primary method v. NT contracts</td>
    </tr>
    <tr>
      <td style="border-top:none;border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px">On Partner&apos;s lead</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">${suitSig}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">${ntSig}</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px">On Declarer&apos;s lead</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px">&nbsp;</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px">&nbsp;</td>
    </tr>
    <tr>
      <td style="border-top:${I};border-left:${O};border-right:${I};border-bottom:${I};padding:2px 5px">When discarding</td>
      <td style="border-top:${I};border-left:none;border-right:${I};border-bottom:${I};padding:2px 5px;text-align:center">${suitDisc}</td>
      <td style="border-top:${I};border-left:none;border-right:${O};border-bottom:${I};padding:2px 5px;text-align:center">${ntDisc}</td>
    </tr>` +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px">Other carding agreements, including secondary methods (state when applicable) and exceptions to above</td></tr>` +
    blankRows(3)
  );

  const suppContTable = tbl(
    secHdr('SUPPLEMENTARY DETAILS (continued)') +
    blankRows(8)
  );

  // ── Build notes-dependent sections LAST ───────────────────────────────────
  // All trunc() calls above have now executed, extraNotes is fully populated
  const otherAspectsTable = tbl(
    secHdr('OTHER ASPECTS OF SYSTEM WHICH OPPONENTS SHOULD NOTE') +
    `<tr><td colspan="99" style="border-top:none;border-left:${O};border-right:${O};border-bottom:none;padding:2px 5px;font-size:7pt">(Please include details of any agreements involving bidding on significantly less than traditional values).</td></tr>` +
    `<tr><td colspan="99" style="border-top:${I};border-left:${O};border-right:${O};border-bottom:${O};padding:4px 5px;min-height:50px">${buildOtherAspects()}</td></tr>`
  );

  // ── Assemble pages ────────────────────────────────────────────────────────
  const page1 = `${headerTable}${genDescTable}${nt1Table}${twoLvlTable}${otherAspectsTable}`;
  const page2 = `${page2Table}${defensiveTable}${slamTable}`;
  const page3 = `${competitiveTable}${otherConvsTable}${suppTable}`;
  const page4 = `${openingLeadsTable}${cardingTable}${suppContTable}`;

  const body = `<div style="max-width:720px;margin:0 auto;font-family:Arial,sans-serif;font-size:9pt">
    <div style="margin-bottom:20px">${page1}</div>
    <div style="margin-bottom:20px">${page2}</div>
    <div style="margin-bottom:20px">${page3}</div>
    <div style="margin-bottom:20px">${page4}</div>
    <div style="font-size:7pt;color:#444;border-top:1px solid #aaa;padding:4px 0;margin-top:4px">
      Both players of a partnership must have identically completed convention cards. Cards must be exchanged with opponents for each round.
      <span style="float:right">Jan 2016 &nbsp; <b>EBU 20B</b></span>
    </div>
  </div>`;

  const extraCss = `
    @page { size: A4; margin: 10mm 12mm }
    body { font-family: Arial, sans-serif; font-size: 9pt; background: #fff; }
    table { border-collapse: collapse; }
    u { text-decoration: underline; }
  `;
  return wrap(`${sys.name} — EBU 20B`, extraCss, body);
}


function generateWBF(sys) {
  // WBF System Card — faithful reproduction of official WBF Convention Card form
  // Page 1 landscape: LEFT = Defensive/Competitive Bidding + Leads & Signals + Doubles
  //                   RIGHT = WBF title box + System Summary + Opening Bid Descriptions + Slam
  // Pages 2-3: Supplementary Sheets
  const op=sys.openings??[], ov=sys.overcalls??[], c=sys.carding??{};
  const f = (lv,st) => findBid(op,lv,st);
  const hcpStr = nd => { const h=nd?.meaning?.hcp; return h?`${h[0]??''}–${h[1]??''}`:''; };
  const n1=f(1,'N'), c2=f(2,'C');

  // Section header (dark red)
  const sh = txt => `<div class="wsh">${txt}</div>`;
  // Sub-section label row
  const subh = txt => `<div class="wsub">${txt}</div>`;
  // Field row: bold label + lined value area
  const fr = (label, value='') =>
    `<div class="wfr"><span class="wfl">${label}:</span><div class="wfv">${value}</div></div>`;
  // Small free text block with ruled lines
  const ruled = (minH=40, txt='') =>
    `<div class="ruled" style="min-height:${minH}px">${txt}</div>`;

  // Overcall lookup helpers
  const ovFind = (lv, st) => ov.find(n => n.call?.type==='bid' && n.call.level===lv && n.call.strain===st);
  const ovDesc = (lv, st) => ovFind(lv,st)?.meaning?.description ?? '';
  const leadsVsSuit = (c.leads??[]).filter(r => !r.context || /suit|trump/i.test(r.context));
  const leadsVsNT   = (c.leads??[]).filter(r => r.context && /nt|notrump/i.test(r.context));
  const suitSig1 = (c.signals??[]).find(r => !r.context || /suit/i.test(r.context));
  const ntSig1   = (c.signals??[]).find(r => r.context && /nt/i.test(r.context)) ?? suitSig1;
  const suitDisc = (c.discards??[]).find(r => !r.context || /suit/i.test(r.context));
  const ntDisc   = (c.discards??[]).find(r => r.context && /nt/i.test(r.context)) ?? suitDisc;

  // Opening bid descriptions table (7 columns: Opening | Artif | Min | Neg Dbl | Description | Responses | Subsequent)
  const openingDescTable = () => {
    if (!op.length) return '<p class="none">No openings defined.</p>';
    return `<table class="wtbl"><thead><tr>
      <th style="width:26px">Opening</th>
      <th style="width:16px;text-align:center;font-size:5.5pt">Artif<br>RED</th>
      <th style="width:18px;text-align:center">Min</th>
      <th style="width:28px;text-align:center">Neg Dbl</th>
      <th style="width:28%">Description</th>
      <th style="width:30%">Responses</th>
      <th>Subsequent Auction</th>
    </tr></thead><tbody>${op.map(nd => {
      const m = nd.meaning??{};
      const isArt = m.alert||m.announce;
      const hcp = hcpStr(nd);
      let minLen = '';
      if (m.shape) { const nm=m.shape.match(/\d+/); if (nm) minLen=nm[0]; }
      if (!minLen && nd.call?.type==='bid') minLen = nd.call.level===1 ? '' : String(nd.call.level);
      const resp = (() => {
        const cont=nd.continuations;
        if (!cont||cont.type==='tbd'||cont.type==='end') return '';
        if (cont.type==='ref') { const cv=(sys.conventions??{})[cont.conventionId]; return cv?`\u2192 ${cv.name}`:''; }
        if (cont.type==='nodes') return sortNodes(cont.nodes).slice(0,4).map(n=>`${pc(n.call)}: ${n.meaning?.description??''}`).join(', ');
        return '';
      })();
      const vline = nd.variants?.length ? `<span style="font-size:6pt;color:#777;font-style:italic"> [${variantInline(nd.variants)}]</span>` : '';
      const desc = `${m.description??''}${hcp?` <span style="color:#555">[${hcp}]</span>`:''}${m.shape?` <i style="color:#555;font-size:6.5pt">${m.shape}</i>`:''}${vline}`;
      return `<tr>
        <td class="bc">${pc(nd.call)}</td>
        <td style="text-align:center">${isArt ? '<b style="color:#c00">\u2020</b>' : ''}</td>
        <td style="text-align:center">${minLen}</td>
        <td style="text-align:center;font-size:7pt">${nd.call?.type==='bid'&&nd.call.level===1?'3'+SYM.S:''}</td>
        <td style="font-size:7pt">${desc||'—'}</td>
        <td style="font-size:6.5pt">${resp}</td>
        <td style="font-size:6.5pt;color:#555"></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  };

  // Signals priority table (WBF 3×3: partner's lead / declarer's lead / discards × 1st/2nd/3rd priority)
  const signalsPriorityTable = () => {
    const sig1s = suitSig1?.method ?? '';
    const sig1nt = ntSig1?.method ?? sig1s;
    const disc1s = suitDisc?.method ?? '';
    const disc1nt = ntDisc?.method ?? disc1s;
    const rows = (ctx, s1, d1) => `
      <tr><td class="wpri-ctx" rowspan="3">${ctx}</td><td class="wpri-n">1st</td><td>${s1}</td><td></td><td>${d1}</td></tr>
      <tr><td class="wpri-n">2nd</td><td></td><td></td><td></td></tr>
      <tr><td class="wpri-n">3rd</td><td></td><td></td><td></td></tr>`;
    return `<table class="wtbl wpri"><thead><tr>
      <th colspan="2"></th>
      <th>Partner's lead</th>
      <th>Declarer's lead</th>
      <th>Discards</th>
    </tr></thead><tbody>
      ${rows('Suit', sig1s, disc1s)}
      ${rows('NT', sig1nt, disc1nt)}
    </tbody></table>`;
  };

  // ─── LEFT column ────────────────────────────────────────────────────────────
  const leftCol = `
  <div class="wsec">
    ${sh('DEFENSIVE AND COMPETITIVE BIDDING')}
    ${subh('OVERCALLS (Style; Responses; 1/2-level; reopening)')}
    ${ruled(38, ov.filter(n=>n.call?.type==='bid'&&n.call.level===1).map(n=>`${pc(n.call)}: ${n.meaning?.description??''}`).join('; '))}
    ${subh('1NT OVERCALL (2nd; 4th live; responses; reopening)')}
    ${ruled(28, ovDesc(1,'N'))}
    ${subh('JUMP OVERCALLS (Style; responses; unusual NT)')}
    ${ruled(28)}
    ${subh('REOPEN: Double; 1NT; 2NT')}
    ${ruled(20)}
    ${subh('DIRECT &amp; JUMP CUE-BIDS (Style; response; reopen)')}
    ${ruled(24)}
    ${subh('VS. NT (vs. strong; weak; responses; runouts)')}
    ${ruled(24)}
    ${subh('VS. PREEMPTS (Doubles; Cue-bids; Jumps; NT bids)')}
    ${ruled(20)}
    ${subh('VS. ARTIFICIAL STRONG OPENINGS (i.e. 1♣ or 2♣)')}
    ${ruled(20)}
    ${subh('OVER OPPONENTS\' TAKEOUT DOUBLE')}
    ${ruled(20)}
  </div>
  <div class="wsec">
    ${sh('LEADS AND SIGNALS')}
    ${subh('OPENING LEADS STYLE')}
    <table class="wtbl"><thead><tr>
      <th></th><th>Lead</th><th>In partner's suit</th><th>Subsequent</th><th>Other</th>
    </tr></thead><tbody>
      <tr><td>Suit</td><td style="font-size:7pt">${leadsVsSuit.map(l=>l.method).join('; ')}</td><td></td><td></td><td></td></tr>
      <tr><td>NT</td><td style="font-size:7pt">${leadsVsNT.map(l=>l.method).join('; ')}</td><td></td><td></td><td></td></tr>
      <tr><td>Subseq</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Other</td><td></td><td></td><td></td><td></td></tr>
    </tbody></table>
    ${subh('LEADS')}
    <table class="wtbl wleads"><thead><tr>
      <th></th><th>vs Suit</th><th>vs NT</th>
    </tr></thead><tbody>
      <tr><td>Ace</td><td></td><td></td></tr>
      <tr><td>King</td><td></td><td></td></tr>
      <tr><td>Queen</td><td></td><td></td></tr>
      <tr><td>Jack</td><td></td><td></td></tr>
      <tr><td>10</td><td></td><td></td></tr>
      <tr><td>9</td><td></td><td></td></tr>
      <tr><td>Hi-x</td><td></td><td></td></tr>
      <tr><td>Lo-x</td><td></td><td></td></tr>
    </tbody></table>
    ${subh('SIGNALS IN ORDER OF PRIORITY')}
    ${signalsPriorityTable()}
  </div>
  <div class="wsec">
    ${sh('DOUBLES')}
    ${subh('TAKEOUT DOUBLES (Style; Responses; Reopening)')}
    ${ruled(28)}
    ${subh('SPECIAL, ARTIFICIAL &amp; COMPETITIVE (RE)DOUBLES')}
    ${ruled(36)}
  </div>`;

  // ─── RIGHT column ───────────────────────────────────────────────────────────
  const rightCol = `
  <div class="wsec whdr-box">
    <div class="wbig">WBF Convention Card</div>
    <table class="wtbl wmeta"><tbody>
      <tr><td class="wml">Category:</td><td class="wmv"></td><td class="wml">Country:</td><td class="wmv"></td></tr>
      <tr><td class="wml">Event:</td><td class="wmv"></td><td class="wml">Players:</td><td class="wmv"><b>${sys.name??''}</b></td></tr>
    </tbody></table>
  </div>
  <div class="wsec">
    ${sh('SYSTEM SUMMARY')}
    ${subh('GENERAL APPROACH AND STYLE')}
    ${ruled(50, sys.metadata?.description??'')}
    ${subh('SPECIAL BIDS THAT MAY REQUIRE DEFENCE')}
    ${ruled(70)}
    ${subh('IMPORTANT NOTES THAT DON\'T FIT ELSEWHERE')}
    ${ruled(30, sys.metadata?.notes??'')}
    ${subh('PSYCHICS')}
    ${ruled(18)}
  </div>
  <div class="wsec">
    ${sh('OPENING BID DESCRIPTIONS')}
    ${openingDescTable()}
  </div>
  <div class="wsec">
    ${sh('HIGH LEVEL BIDDING')}
    ${ruled(22)}
  </div>
  <div class="wsec">
    ${sh('SLAM BIDDING')}
    ${ruled(30)}
  </div>
  <div class="wsec">
    ${subh('Passed Hand Bidding')}
    ${ruled(18)}
  </div>`;

  // ─── Page 1 ─────────────────────────────────────────────────────────────────
  const page1 = `<div class="page">
    <div style="display:grid;grid-template-columns:42% 58%;gap:0 10px;align-items:start">
      <div>${leftCol}</div>
      <div>${rightCol}</div>
    </div>
  </div>`;

  // ─── Page 2 (Supplementary Sheet 1) ─────────────────────────────────────────
  const suppHeader = (n) =>
    `<div style="border-bottom:1.5px solid #660000;padding-bottom:2px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:10pt;font-weight:700;color:#660000">WBF SUPPLEMENTARY SHEET ${n}</span>
      <span style="font-size:8pt;color:#555">${sys.name??''}</span>
    </div>`;
  const suppConvBlock = (cv) =>
    `<div style="margin-bottom:6px;border:1px solid #ddd">
      <div class="wsub" style="font-weight:700">${cv.name??''}</div>
      <div class="ruled" style="min-height:36px;font-size:7.5pt">${cv.description??''}</div>
    </div>`;

  const convList = Object.values(sys.conventions??{});
  const half = Math.ceil(convList.length/2);
  const page2convs = convList.slice(0,half);
  const page3convs = convList.slice(half);

  const page2 = `<div class="page pb">
    ${suppHeader(1)}
    ${page2convs.length
      ? page2convs.map(suppConvBlock).join('')
      : '<div class="ruled" style="min-height:200px"></div>'}
  </div>`;

  const page3 = `<div class="page pb">
    ${suppHeader(2)}
    ${page3convs.length
      ? page3convs.map(suppConvBlock).join('')
      : '<div class="ruled" style="min-height:200px"></div>'}
  </div>`;

  const body = page1 + page2 + page3;

  const extraCss = `
    @page { size: A4 landscape; margin: 7mm 9mm }
    body { font-size: 7.5pt; }
    .page { max-width: 277mm; }
    .pb { page-break-before: always; }
    .wsh { background: #660000; color: #fff; font-size: 6.5pt; font-weight: 700; padding: 1px 4px; letter-spacing: .06em; text-transform: uppercase; }
    .wsub { font-size: 6.5pt; font-weight: 700; background: #f5e0e0; padding: 1px 4px; border-top: 1px solid #ccc; }
    .wsec { border: 1px solid #aaa; margin-bottom: 4px; }
    .wfr { display: flex; gap: 4px; padding: 1px 4px; border-bottom: 1px dotted #ccc; min-height: 13px; align-items: flex-end; }
    .wfl { font-size: 6pt; color: #444; min-width: 90px; flex-shrink: 0; }
    .wfv { font-size: 7.5pt; flex: 1; border-bottom: 1px solid #999; min-height: 12px; padding: 0 2px; }
    .ruled { padding: 2px 4px; font-size: 7pt; line-height: 16px; background-image: repeating-linear-gradient(to bottom, transparent 0px, transparent 15px, #ddd 15px, #ddd 16px); }
    .wtbl { width: 100%; border-collapse: collapse; font-size: 7pt; }
    .wtbl th, .wtbl td { border: 1px solid #aaa; padding: 1px 3px; vertical-align: top; text-align: left; }
    .wtbl th { background: #f5e0e0; font-size: 6.5pt; font-weight: 700; }
    .wleads td:first-child { white-space: nowrap; font-size: 7pt; }
    .wpri .wpri-ctx { font-weight: 700; font-size: 6.5pt; text-align: center; }
    .wpri .wpri-n { font-size: 6pt; color: #666; text-align: center; white-space: nowrap; }
    .whdr-box { padding: 3px 5px; }
    .wbig { font-size: 11pt; font-weight: 700; color: #660000; border-bottom: 1.5px solid #660000; margin-bottom: 3px; padding-bottom: 2px; }
    .wmeta { border: none; }
    .wmeta td { border: none; padding: 1px 3px; }
    .wml { font-size: 6.5pt; color: #555; white-space: nowrap; }
    .wmv { border-bottom: 1px solid #999 !important; min-width: 80px; }
  `;
  return wrap(`${sys.name} — WBF`, extraCss, body);
}
