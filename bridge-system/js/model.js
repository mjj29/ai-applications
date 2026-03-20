/**
 * Core data model for the bridge bidding system.
 * All types documented as JSDoc. Internal representation uses ASCII (CDHS, N).
 */

'use strict';

// ─── Factories ────────────────────────────────────────────────────────────────

export function makeBid(level, strain) {
  return { type: 'bid', level, strain }; // strain: C D H S N
}
export const PASS     = { type: 'pass' };
export const DOUBLE   = { type: 'double' };
export const REDOUBLE = { type: 'redouble' };

export function makeIntervention(type, opts = {}) {
  // type: 'pass'|'double'|'redouble'|'suit'|'notrump'|'any-suit'|'any-double'|'any'
  return { type, ...opts };
}

export function makeMeaning(description, opts = {}) {
  return { description, ...opts };
}

export function makeCondition({ seats, vul } = {}) {
  const c = {};
  if (seats) c.seats = seats;
  if (vul)   c.vul   = vul;
  return c;
}

export function makeVariant(condition, opts = {}) {
  return { condition, ...opts };
}

export function makeBidNode(id, call, opts = {}) {
  return {
    id,
    call,
    meaning:       opts.meaning       ?? null,
    variants:      opts.variants      ?? [],
    continuations: opts.continuations ?? { type: 'tbd' },
    competitive:   opts.competitive   ?? [],
  };
}

export function makeConvention(id, name, nodes = [], opts = {}) {
  return { id, name, description: opts.description ?? '', tags: opts.tags ?? [], source: opts.source ?? null, params: opts.params ?? [], nodes };
}

export function makeSystem(id, name) {
  return {
    id,
    name,
    metadata: { authors: [], notes: '', modified: new Date().toISOString(), format: 'v1' },
    conventions: {},
    openings:  [],
    overcalls: [],
    carding:   { signals: [], discards: [], leads: [] },
  };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠', N: 'NT' };
const SUIT_CLASSES = { C: 'suit-club', D: 'suit-diamond', H: 'suit-heart', S: 'suit-spade', N: 'suit-nt' };

/**
 * Render free text with suit symbols: !S !H !D !C !N (case-insensitive) →
 * coloured suit-symbol spans, matching the style used in bid calls.
 * HTML-escapes all other content first.
 */
export function renderText(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!(s|h|d|c|n)/gi, (_, s) => {
      const k = s.toUpperCase();
      return `<span class="${SUIT_CLASSES[k]}">${SUIT_SYMBOLS[k]}</span>`;
    });
}

export function callToString(call) {
  if (!call) return '';
  switch (call.type) {
    case 'pass':     return 'P';
    case 'double':   return 'X';
    case 'redouble': return 'XX';
    case 'bid': {
      const lvl = call.levelParam ? `{${call.levelParam}}` : call.level;
      if (call.strainParam) return `${lvl}{${call.strainParam}}`;
      return `${lvl}${SUIT_SYMBOLS[call.strain] ?? call.strain}`;
    }
    default:         return '?';
  }
}

export function callToHTML(call) {
  if (!call) return '';
  switch (call.type) {
    case 'pass':     return '<span class="call-pass">P</span>';
    case 'double':   return '<span class="call-double">X</span>';
    case 'redouble': return '<span class="call-redouble">XX</span>';
    case 'bid': {
      const lvlHtml = call.levelParam
        ? `<span class="call-param">{${call.levelParam}}</span>`
        : `<span class="call-level">${call.level}</span>`;
      if (call.strainParam)
        return `<span class="call-bid">${lvlHtml}<span class="call-param">{${call.strainParam}}</span></span>`;
      const sym   = SUIT_SYMBOLS[call.strain] ?? call.strain;
      const cls   = SUIT_CLASSES[call.strain] ?? '';
      return `<span class="call-bid">${lvlHtml}<span class="${cls}">${sym}</span></span>`;
    }
    default: return '?';
  }
}

/** Render a node's call as HTML, adding parens for opponent-call (isOpponentCall) nodes. */
export function nodeCallToHTML(node) {
  if (!node?.call) return '';
  const inner = callToHTML(node.call);
  return node.isOpponentCall ? `(${inner})` : inner;
}

export function interventionToString(iv) {
  if (!iv || iv.type === 'pass') return '(P)';
  switch (iv.type) {
    case 'double':   return `(X${iv.nature ? ':' + iv.nature : ''})`;
    case 'redouble': return '(XX)';
    case 'suit':     return `(${iv.level}${SUIT_SYMBOLS[iv.strain] ?? iv.strain}${iv.nature === 'art' ? '*' : ''})`;
    case 'notrump':  return `(${iv.level}NT)`;
    case 'any-suit': return '(any suit)';
    case 'any-double': return '(any X)';
    case 'any':      return '(any)';
    default:         return '(?)';
  }
}

/**
 * Format the opener's bid that prompted an overcall, e.g. "(1♥)".
 * openerBid is { level, strain } — strain 'N' means notrump.
 * Also supports { level, strainParam } for schematic entries, e.g. "(1{minor})".
 */
export function openerBidToString(openerBid) {
  if (!openerBid) return '(any)';
  const lvl = openerBid.level ?? openerBid.levelParam ?? '?';
  if (openerBid.strainParam) return `(${lvl}{${openerBid.strainParam}})`;
  if (openerBid.strain === 'N') return `(${lvl}NT)`;
  const sym = SUIT_SYMBOLS[openerBid.strain] ?? openerBid.strain;
  return `(${lvl}${sym})`;
}

// ─── Call parsing (keyboard input) ────────────────────────────────────────────

/**
 * Parse a call string like "1C", "2H", "3N", "P", "X", "XX"
 * Returns a Call object or null.
 */
export function parseCall(str) {
  const raw = str.trim();
  const PARAM = '[a-zA-Z][a-zA-Z0-9_]*';
  const STRAIN_RE = '[CDHSN]|NT';
  // {levelParam}{strainParam}
  const ppMatch = raw.match(new RegExp(`^\\{(${PARAM})\\}\\{(${PARAM})\\}$`));
  if (ppMatch)
    return { type: 'bid', level: null, strain: null, levelParam: ppMatch[1], strainParam: ppMatch[2] };
  // {levelParam}STRAIN  e.g. {game}S or {game}NT
  const psMatch = raw.match(new RegExp(`^\\{(${PARAM})\\}(${STRAIN_RE})$`, 'i'));
  if (psMatch) {
    const strain = psMatch[2].toUpperCase() === 'NT' ? 'N' : psMatch[2].toUpperCase();
    return { type: 'bid', level: null, strain, levelParam: psMatch[1] };
  }
  // LEVEL{strainParam}  e.g. 4{suit}
  const lpMatch = raw.match(new RegExp(`^([1-7])\\{(${PARAM})\\}$`));
  if (lpMatch)
    return { type: 'bid', level: parseInt(lpMatch[1]), strain: null, strainParam: lpMatch[2] };
  const s = raw.toUpperCase();
  if (s === 'P' || s === 'PASS')    return PASS;
  if (s === 'X' || s === 'DBL')     return DOUBLE;
  if (s === 'XX' || s === 'RDBL')   return REDOUBLE;
  const m = s.match(/^([1-7])([CDHSN]|NT)$/);
  if (m) {
    const strain = m[2] === 'NT' ? 'N' : m[2];
    return makeBid(parseInt(m[1]), strain);
  }
  return null;
}

/**
 * Parse a sequence string like "1C - 1H - 1N" or "1C - (2H) - X"
 * Returns array of { call, intervention } steps, or null on error.
 */
export function parseSequence(str) {
  const parts = str.split(/\s*-\s*/);
  const steps = [];
  for (const part of parts) {
    const p = part.trim();
    const ivMatch = p.match(/^\((.+)\)$/);
    if (ivMatch) {
      const inner = ivMatch[1].trim().toUpperCase();
      if (inner === 'P') {
        steps.push({ intervention: { type: 'pass' } });
      } else if (inner === 'X') {
        steps.push({ intervention: { type: 'double', nature: '?' } });
      } else {
        const m = inner.match(/^([1-7])([CDHSN]|NT)\*?$/);
        if (m) {
          const strain = m[2] === 'NT' ? 'N' : m[2];
          const nature = p.includes('*') ? 'art' : 'nat';
          steps.push({ intervention: { type: 'suit', level: parseInt(m[1]), strain, nature } });
        } else {
          return null;
        }
      }
    } else {
      const call = parseCall(p);
      if (!call) return null;
      steps.push({ call });
    }
  }
  return steps;
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

const STRAIN_ORDER = { C: 0, D: 1, H: 2, S: 3, N: 4 };

export function callSortKey(call) {
  if (!call) return 999;
  switch (call.type) {
    case 'pass':     return -3;
    case 'double':   return -2;
    case 'redouble': return -1;
    case 'bid':
      if (call.levelParam) return 80 + (call.strainParam ? 9 : STRAIN_ORDER[call.strain] ?? 5);
      if (call.strainParam) return call.level * 10 + 9;
      return call.level * 10 + (STRAIN_ORDER[call.strain] ?? 5);
    default:         return 998;
  }
}

export function sortNodes(nodes) {
  if (!nodes) return [];
  return [...nodes].sort((a, b) => callSortKey(a.call) - callSortKey(b.call));
}

// ─── Variant badge text (compact condition + key override) ───────────────────

export function variantBadgeText(variant) {
  const cParts = [];
  if (variant.condition?.seats) cParts.push(`s${variant.condition.seats.join(',')}`);
  if (variant.condition?.vul)   cParts.push(variant.condition.vul.map(v => v.toUpperCase()).join('/'));
  const cond = cParts.join(' ') || '?';

  const m = variant.meaningOverride;
  let val = '';
  if (m?.hcp)         val = `${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''}`;
  else if (m?.description) val = m.description.length > 22 ? m.description.slice(0, 20) + '…' : m.description;
  else if (m?.announce)    val = m.announce;
  if (!val && variant.continuationOverride) val = 'alt tree';
  if (!val && variant.continuationDiff?.length) val = 'tree mod';

  return cond + (val ? ': ' + val : '');
}
