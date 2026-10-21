/**
 * deck.js — decode a Budget Deckbuilder share link and price the 75 in it.
 *
 * The parsing, v2 link detokenizing and cheapest-printing TCG Mid pricing are
 * ported from Toskicologist's budgetdeckbuilder.html, against the same daily
 * data it uses (the price-data branch of their repo, via jsDelivr), so totals
 * match what the builder shows. Deliberate differences:
 *   - only true basics are free: snow-covered basics are priced
 *   - budgets / format / options in the link are ignored; ours are used
 *
 * Plain ES module with no dependencies so it runs both in the Deno edge
 * function (index.ts) and in a browser (test/deck-test.html).
 */
'use strict';

export const CDN         = 'https://cdn.jsdelivr.net/gh/Toskicologist/MTG-draft-sets-infographics@price-data';
export const BUILDER_URL = 'https://toskicologist.github.io/MTG-draft-sets-infographics/budgetdeckbuilder.html';
const SCRYFALL = 'https://api.scryfall.com';
const SCRYFALL_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'mjj29-budget-decks/1.0' };
const LEGWORD = { l: 'legal', n: 'not_legal', b: 'banned', r: 'restricted', '-': null };
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/** An error whose message is fit to show the submitter. */
export class DeckError extends Error {}

const norm  = s => String(s || '').toLowerCase().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const round2 = n => Math.round(n * 100) / 100;

/** True basics only — snow-covered basics cost money. */
export const isFreeBasic = n => /^(plains|island|swamp|mountain|forest|wastes)$/i.test(String(n).trim());

// ─── Daily price data ────────────────────────────────────────────────────────
// Cached across calls (warm edge-function instances) and keyed by the data's
// own build times, re-checking data-meta.json at most every few minutes.

let _data = null;          // { key, meta, prices, foil, index, rev }
let _metaCheckedAt = 0;
const META_RECHECK_MS = 5 * 60 * 1000;

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}

export async function loadPriceData() {
  if (_data && Date.now() - _metaCheckedAt < META_RECHECK_MS) return _data;
  const meta = await getJSON(`${CDN}/data-meta.json?t=${Math.floor(Date.now() / 60000)}`);
  _metaCheckedAt = Date.now();
  const key = `${meta.generatedAt}|${meta.indexGeneratedAt}`;
  if (_data && _data.key === key) return _data;
  const [prices, index] = await Promise.all([
    getJSON(`${CDN}/tcg-prices.json?v=${encodeURIComponent(meta.generatedAt || '0')}`),
    getJSON(`${CDN}/cards-index.json?v=${encodeURIComponent(meta.indexGeneratedAt || '0')}`),
  ]);
  if (!prices?.prices || !index?.cards) throw new Error('Price data malformed');
  _data = { key, meta, prices: prices.prices, foil: prices.foil || null, index, rev: null };
  return _data;
}

// tcgplayer id / "set/cn" -> card name, for v2 link tokens. Longest name wins
// (a DFC's full "A // B" name over its front face), as in the builder.
function reverseIndex(data) {
  if (data.rev) return data.rev;
  const id = new Map(), setcn = new Map();
  for (const name in data.index.cards) {
    const e = data.index.cards[name];
    if (!e?.p) continue;
    for (const pr of e.p) {
      if (!id.has(pr[0]) || name.length > id.get(pr[0]).length) id.set(pr[0], name);
      const key = (pr[1] || '') + '/' + (pr[2] || '');
      if (!setcn.has(key) || name.length > setcn.get(key).length) setcn.set(key, name);
    }
  }
  data.rev = { id, setcn };
  return data.rev;
}

// ─── Share link ──────────────────────────────────────────────────────────────

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/**
 * Pull the #d= payload out of a pasted link.
 * Returns { state, payload, link } where link is the canonical builder URL —
 * we never store or link out to whatever host the user pasted.
 */
export function decodeShareLink(url) {
  const s = String(url || '').trim();
  if (/[#&]c=/.test(s))
    throw new DeckError('That is a confirmation (#c=) link. Please paste the normal share link (the one containing #d=).');
  const m = /[#&]d=([A-Za-z0-9_-]+)/.exec(s);
  if (!m) throw new DeckError('That does not look like a Budget Deckbuilder share link (no #d= section).');
  let state;
  try { state = JSON.parse(b64urlDecode(m[1])); }
  catch { throw new DeckError('The share link could not be decoded — was it copied in full?'); }
  if (!state || typeof state !== 'object') throw new DeckError('The share link is empty.');
  return { state, payload: m[1], link: `${BUILDER_URL}#d=${m[1]}` };
}

// v2 links replace names with "#tcgplayerId" or "*SET CN". Index misses (cards
// newer than the index) are looked up on Scryfall.
async function detokenizeBoard(text, rev) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(\d+)\s+([#*])(.+)$/);
    if (!m) { out.push(line); continue; }
    const [, qty, sigil, raw] = m;
    const val = raw.trim();
    let name = null, sp = -1;
    if (sigil === '#') name = rev.id.get(Number(val));
    else if ((sp = val.lastIndexOf(' ')) > 0)
      name = rev.setcn.get(val.slice(0, sp).toLowerCase() + '/' + val.slice(sp + 1));
    if (!name) {
      const path = sigil === '#'
        ? `/cards/tcgplayer/${encodeURIComponent(val)}`
        : (sp > 0 ? `/cards/${encodeURIComponent(val.slice(0, sp).toLowerCase())}/${encodeURIComponent(val.slice(sp + 1))}` : null);
      const c = path ? await scryfall(path).catch(() => null) : null;
      if (!c?.name) throw new DeckError(`Could not identify the card "${sigil}${val}" in the link.`);
      name = c.name;
    }
    out.push(`${qty} ${name}`);
  }
  return out.join('\n');
}

// ─── Decklist parsing (ported verbatim in behaviour) ─────────────────────────

const MANA_TAIL = /\s*(?:\/\/|[-–—:|])?\s*\{[^{}\s]{1,6}\}(?:\s*(?:\/\/|[-–—:|])?\s*\{[^{}\s]{1,6}\})*\s*$/;

function sectionHeader(line) {
  const bare = (line || '').trim()
    .replace(/^[\s/#*=_~>|–—-]+/, '')
    .replace(/[\s*=_~|–—-]+$/, '')
    .trim();
  if (!bare) return null;
  if (/^about:?$/i.test(bare) || /^name\s+\S/i.test(bare)) return 'meta';
  const t = bare
    .replace(/\s*[:–—-]?\s*[([]?\s*\d+\s*[)\]]?\s*(?:cards?)?$/i, '')
    .replace(/[\s:.–—-]+$/, '')
    .trim();
  if (!t) return null;
  if (/^(side\s?board|sb)$/i.test(t)) return 'side';
  if (/^(deck|main|main\s?deck|maindeck|main\s?board|mainboard|commanders?|edh|companion)$/i.test(t)) return 'main';
  return null;
}

function parseCardLine(line) {
  const t = (line || '').trim();
  if (/^\d+\s*cards?$/i.test(t)) return null;
  let qty = null, name = null, m;
  if ((m = t.match(/^(\d+)\s*[xX]?\s+(.+?)\s*$/))) { qty = parseInt(m[1], 10); name = m[2]; }
  else if ((m = t.match(/^(.+?)\s+[xX](\d+)$/))) { qty = parseInt(m[2], 10); name = m[1]; }
  else if (/[A-Za-z]/.test(t) && !/\b\d+\s*cards?$/i.test(t)) { qty = 1; name = t; }
  if (name == null) return null;
  let prev;
  do {
    prev = name;
    name = name
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .replace(/\s+\*[A-Za-z]\*\s*$/, '')
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?\s*$/, '')
      .replace(MANA_TAIL, '')
      .trim();
  } while (name !== prev);
  name = name.replace(/\s*\/+\s*/g, ' // ').trim();
  if (!name || !qty) return null;
  return { qty, name };
}

const addTo = (map, name, qty) => map.set(name, (map.get(name) || 0) + qty);

// First line is a deck title (not a card) when it has no quantity, isn't a
// known card, and has a blank line under it.
function deckTitle(raw, isKnownCard) {
  const lines = (raw || '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const t = (lines[i] || '').trim();
  if (!t || /^\d/.test(t)) return null;
  if (/^(\/\/|#)/.test(t) || sectionHeader(t)) return null;
  if (i + 1 >= lines.length || lines[i + 1].trim()) return null;
  const c = parseCardLine(t);
  return (c && isKnownCard(c.name)) ? null : t;
}

function parseDecklist(raw, isKnownCard) {
  const main = new Map(), side = new Map();
  let board = main, first = true;
  const title = deckTitle(raw, isKnownCard);
  for (const rawLine of (raw || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (first) { first = false; if (title !== null && line === title) continue; }
    const hdr = sectionHeader(line);
    if (hdr) { if (hdr !== 'meta') board = hdr === 'side' ? side : main; continue; }
    if (/^(\/\/|#)/.test(line)) continue;
    let sb = false;
    if (/^sb:\s*/i.test(line)) { sb = true; line = line.replace(/^sb:\s*/i, ''); }
    const c = parseCardLine(line);
    if (c) addTo(sb ? side : board, c.name, c.qty);
  }
  return { main, side, title };
}

function parseSideboardBox(raw) {
  const side = new Map();
  for (const rawLine of (raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(\/\/|#)/.test(line) || sectionHeader(line)) continue;
    const c = parseCardLine(line.replace(/^sb:\s*/i, ''));
    if (c) addTo(side, c.name, c.qty);
  }
  return side;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

// Cheaper of non-foil / foil Mid for one TCGplayer product, or null.
function productPrice(id, data) {
  const n = data.prices[id], f = data.foil ? data.foil[id] : undefined;
  const nOk = typeof n === 'number' && n > 0, fOk = typeof f === 'number' && f > 0;
  if (nOk && fOk) return f < n ? { price: f, foil: true } : { price: n, foil: false };
  if (nOk) return { price: n, foil: false };
  if (fOk) return { price: f, foil: true };
  return null;
}

function priceFromIndex(name, data) {
  const e = data.index.cards[norm(name)];
  if (!e) return null;
  let best = null;
  for (const [id, set, cn] of e.p) {
    const pp = productPrice(id, data);
    if (pp && (best == null || pp.price < best.price))
      best = { ...pp, set: (set || '').toUpperCase(), cn };
  }
  const legal = {};
  (data.index.fmt || []).forEach((f, k) => { legal[f] = LEGWORD[e.l[k]] ?? null; });
  return { name, found: true, price: best?.price ?? null, foil: !!best?.foil,
           set: best?.set ?? null, cn: best?.cn ?? null, legal };
}

// Builder's Scryfall fallback for cards the daily index doesn't have yet:
// every paper printing, priced against the same TCGplayer Mid map.
async function priceFromScryfall(name, data) {
  let url = `/cards/search?unique=prints&q=${encodeURIComponent(`!"${name}" game:paper`)}`;
  let best = null, legal = null, found = false, canonical = name;
  while (url) {
    const res = await scryfall(url).catch(() => null);
    if (!res?.data) break;
    found = true;
    for (const c of res.data) {
      if (legal == null && c.legalities) { legal = c.legalities; canonical = c.name; }
      for (const id of [c.tcgplayer_id, c.tcgplayer_etched_id]) {
        const pp = id != null ? productPrice(id, data) : null;
        if (pp && (best == null || pp.price < best.price))
          best = { ...pp, set: c.set.toUpperCase(), cn: c.collector_number };
      }
    }
    url = res.has_more ? res.next_page.replace(SCRYFALL, '') : null;
    if (url) await sleep(100);
  }
  if (!found) return { name, found: false, price: null, legal: null };
  return { name: canonical, found: true, price: best?.price ?? null, foil: !!best?.foil,
           set: best?.set ?? null, cn: best?.cn ?? null, legal };
}

async function scryfall(path, opts = {}) {
  const r = await fetch(SCRYFALL + path, { ...opts, headers: { ...SCRYFALL_HEADERS, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Scryfall ${r.status}`);
  return r.json();
}

async function priceBoard(map, data, format) {
  const rows = [];
  let total = 0, count = 0;
  for (const [name, qty] of map) {
    let p = priceFromIndex(name, data);
    if (!p) { p = await priceFromScryfall(name, data); await sleep(100); }
    const free = isFreeBasic(name);
    const unit = free ? 0 : p.price;
    const lineT = unit != null ? round2(unit * qty) : null;
    if (lineT != null) total += unit * qty;
    count += qty;
    rows.push({ name: p.found ? titleCase(p.name) : name, qty, unit, lineT, free, found: p.found,
                set: p.set ?? null, cn: p.cn ?? null, foil: !!p.foil,
                legal: p.legal ? (p.legal[format] ?? null) : null });
  }
  rows.sort((a, b) => (b.lineT ?? Infinity) - (a.lineT ?? Infinity));
  return { rows, total: round2(total), count };
}

const SMALL_WORDS = new Set(['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','onto','or','over','the','to','vs','with']);
function titleCase(s) {
  if (/[A-Z]/.test(s)) return s;            // already has real casing
  let firstOfFace = true;
  return String(s).split(/(\s+)/).map(tok => {
    if (/^\s*$/.test(tok)) return tok;
    if (tok === '//') { firstOfFace = true; return tok; }
    const out = (!firstOfFace && SMALL_WORDS.has(tok.toLowerCase())) ? tok.toLowerCase()
              : tok.charAt(0).toUpperCase() + tok.slice(1);
    firstOfFace = false;
    return out;
  }).join('');
}

// ─── Whole deck ──────────────────────────────────────────────────────────────

/**
 * Decode, rebuild and price the deck in a share link against today's data.
 * settings: { format, budget_main, budget_side, min_main, max_side }
 */
export async function analyseLink(url, settings) {
  const { state, link } = decodeShareLink(url);
  const data = await loadPriceData();
  let d = String(state.d || ''), s = String(state.s || '');
  if (state.v === 2) {
    const rev = reverseIndex(data);
    d = await detokenizeBoard(d, rev);
    s = await detokenizeBoard(s, rev);
  }
  const isKnown = n => !!data.index.cards[norm(n)];
  const parsed = parseDecklist(d, isKnown);
  for (const [n, q] of parseSideboardBox(s)) addTo(parsed.side, n, q);
  if (!parsed.main.size) throw new DeckError('The link contains no main-deck cards.');

  const format = settings.format;
  const main = await priceBoard(parsed.main, data, format);
  const side = await priceBoard(parsed.side, data, format);

  return {
    link,
    deckName: String(state.n || parsed.title || '').trim().slice(0, 80),
    // When the builder exported the link (user-editable, so only trusted for admin imports).
    exportedAt: (state.x && typeof state.x.t === 'string' && !isNaN(Date.parse(state.x.t))) ? state.x.t : null,
    format,
    priceDate: data.meta.generatedAt,
    main, side,
    hash: await deckHash(main.rows, side.rows),
    problems: findProblems(main, side, settings),
  };
}

/** Everything that stops a deck being legal today. Each: { kind, text }. */
export function findProblems(main, side, settings) {
  const out = [];
  const all = [...main.rows, ...side.rows];
  for (const r of all.filter(r => !r.found))
    out.push({ kind: 'unknown', text: `Card not recognised: "${r.name}"` });
  for (const r of all.filter(r => r.found && r.unit == null))
    out.push({ kind: 'unpriced', text: `No TCGplayer Mid price for ${r.name}` });

  // Combine copies across main + side for legality (a restricted card counts once in total).
  const seen = new Map();
  for (const r of all) if (r.found) seen.set(norm(r.name), { r, qty: (seen.get(norm(r.name))?.qty || 0) + r.qty });
  for (const { r, qty } of seen.values()) {
    if (r.legal === 'legal') continue;
    if (r.legal === 'restricted' && qty <= 1) continue;
    const why = r.legal === 'banned' ? 'banned' : r.legal === 'restricted' ? 'restricted (max 1)' : 'not legal';
    out.push({ kind: 'legality', text: `${r.name} is ${why} in ${settings.format}` });
  }

  if (main.count < settings.min_main)
    out.push({ kind: 'count', text: `Main deck has ${main.count} cards (minimum ${settings.min_main})` });
  if (side.count > settings.max_side)
    out.push({ kind: 'count', text: `Sideboard has ${side.count} cards (maximum ${settings.max_side})` });
  if (main.total > Number(settings.budget_main) + 1e-9)
    out.push({ kind: 'budget', text: `Main deck costs $${main.total.toFixed(2)} — over the $${Number(settings.budget_main).toFixed(2)} budget by $${(main.total - settings.budget_main).toFixed(2)}` });
  if (side.total > Number(settings.budget_side) + 1e-9)
    out.push({ kind: 'budget', text: `Sideboard costs $${side.total.toFixed(2)} — over the $${Number(settings.budget_side).toFixed(2)} budget by $${(side.total - settings.budget_side).toFixed(2)}` });
  return out;
}

// Identity of "this exact 75": order- and case-insensitive.
async function deckHash(mainRows, sideRows) {
  const board = rows => {
    const m = new Map();
    for (const r of rows) m.set(norm(r.name), (m.get(norm(r.name)) || 0) + r.qty);
    return [...m].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([n, q]) => `${q} ${n}`).join('\n');
  };
  const text = board(mainRows) + '\n--side--\n' + board(sideRows);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Colours & featured card (Scryfall) ──────────────────────────────────────

/**
 * Deck colours = colours of its non-land main-deck cards, in WUBRG order
 * ('' for colourless). Also picks a featured card (priciest non-land spell,
 * else the most-played one) with its art crop for the listing.
 */
export async function describeDeck(mainRows) {
  // Look up by front face: index names for some multi-face cards don't match Scryfall's.
  const front = n => norm(String(n).split(' // ')[0]);
  const names = [...new Set(mainRows.filter(r => r.found && !isFreeBasic(r.name)).map(r => front(r.name)))];
  const cards = new Map();
  for (let i = 0; i < names.length; i += 75) {
    const res = await scryfall('/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map(name => ({ name })) }),
    }).catch(() => null);
    for (const c of res?.data || []) cards.set(front(c.name), c);
    if (i + 75 < names.length) await sleep(100);
  }
  const lookup = n => cards.get(front(n));

  const colours = new Set();
  const spells = [];
  for (const r of mainRows) {
    const c = lookup(r.name);
    if (!c) continue;
    const frontType = c.card_faces?.[0]?.type_line ?? c.type_line ?? '';
    if (/\bLand\b/.test(frontType)) continue;
    for (const col of c.colors ?? c.card_faces?.flatMap(f => f.colors || []) ?? []) colours.add(col);
    spells.push({ r, c });
  }
  spells.sort((a, b) => (b.r.unit ?? 0) - (a.r.unit ?? 0) || b.r.qty - a.r.qty);
  const pick = spells[0];
  const art = pick && (pick.c.image_uris?.art_crop ?? pick.c.card_faces?.[0]?.image_uris?.art_crop);
  return {
    colors: COLOR_ORDER.filter(c => colours.has(c)).join(''),
    featured: pick ? { name: pick.c.name, art: art || null, uri: pick.c.scryfall_uri } : null,
    keyCards: [...spells].sort((a, b) => b.r.qty - a.r.qty || (b.r.unit ?? 0) - (a.r.unit ?? 0))
      .slice(0, 4).map(s => s.c.name),
  };
}
