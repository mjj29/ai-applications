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

// The daily index is keyed by Scryfall card name, which splits some cards:
//   - reversible printings are named "A // A" (or "A // B // A" for an
//     Omen/Adventure/two-faced card), so e.g. Bloomvine Regent's TDM #381 sits
//     apart from #136 / #136p;
//   - the front-face key ("bloomvine regent") can point only at that odd printing.
// Pricing "cheapest printing" needs every printing of the card, so lookups go
// through one merged view: repeated faces are collapsed into the card's own
// name, and a front-face key that only holds that card's printings becomes an
// alias of the full name. Entries legal nowhere (art series, tokens) are kept
// out of a legal card so they can't undercut its price.
const dedupeFaces = k => [...new Set(k.split(' // '))].join(' // ');
const legalNowhere = e => !/[lbr]/.test(e.l || '');

function cardLookup(data) {
  if (data.look) return data.look;
  const cards = data.index.cards;
  const merged = new Map();                       // canonical name -> { p: Map(id -> printing), l }
  for (const k in cards) {
    const c = dedupeFaces(k), e = cards[k], base = cards[c];
    if (c !== k && base && legalNowhere(e) && !legalNowhere(base)) continue;
    let m = merged.get(c);
    if (!m) merged.set(c, m = { p: new Map(), l: (base || e).l });
    for (const pr of e.p) m.p.set(pr[0], pr);
  }
  const alias = new Map();
  for (const [c, m] of merged) {
    if (!c.includes(' // ')) continue;
    const front = merged.get(c.split(' // ')[0]);
    if (front && [...front.p.keys()].every(id => m.p.has(id))) alias.set(c.split(' // ')[0], c);
  }
  const resolve = name => {
    const c = dedupeFaces(norm(name));
    return alias.get(c) ?? (merged.has(c) ? c : null);
  };
  return (data.look = { resolve, entry: c => merged.get(c) });
}

/** Stable identity for a card name: its merged index name, or the name itself if unknown. */
const canonicalName = (name, data) => cardLookup(data).resolve(name) ?? dedupeFaces(norm(name));

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

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a builder share link from pasted decklist text (any format the
 * builder's parser accepts: plain, MTGA, MTGO, Moxfield, "Sideboard"/"SB:").
 * This is a v1 link — plain text, no card tokens — which the builder opens
 * as-is. It carries our budgets/format so the builder shows the same rules.
 */
export function buildShareLink({ main, side = '', name = '' }, settings) {
  const state = {
    d: String(main || ''), s: String(side || ''), n: String(name || '').slice(0, 80),
    bm: String(Number(settings.budget_main)), bs: String(Number(settings.budget_side)),
    f: settings.format, c: 1, ib: 1, cc: 1,
  };
  return `${BUILDER_URL}#d=${b64urlEncode(JSON.stringify(state))}`;
}

// ─── ManaBox share links ─────────────────────────────────────────────────────
// manabox.app/decks/<id> is server-rendered (Astro): the deck is in the page as
// the props of an <astro-island>, in Astro's [type, value] serialization.
// There's no CORS header, so this has to run server-side.

const MANABOX_RE = /^https?:\/\/(?:www\.)?manabox\.app\/decks\/([A-Za-z0-9_-]+)/i;
export const isManaBoxLink = url => MANABOX_RE.test(String(url || '').trim());

// ManaBox board categories: 0 commander, 1 oathbreaker, 2 signature spell
// (ManaBox counts those as main), 3 main, 4 sideboard, 5 maybeboard (ignored).
const MB_MAIN = new Set([0, 1, 2, 3]), MB_SIDE = 4;

function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos|#39);/gi, (_, e) => {
    const l = e.toLowerCase();
    if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    return { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" }[l];
  });
}

// Astro serializes props as [0, value] / [1, array] (other tags: dates, maps… not used here).
function astroValue(v) {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    const [t, x] = v;
    if (t === 1) return x.map(astroValue);
    if (t === 0) return x && typeof x === 'object' && !Array.isArray(x) ? astroObject(x) : x;
    return x;
  }
  return v;
}
const astroObject = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, astroValue(v)]));

/** Deck from a ManaBox deck page's HTML: { name, format, editedAt, main, side } as decklist text. */
export function parseManaBoxPage(html) {
  let deck = null;
  for (const m of String(html).matchAll(/<astro-island\b[^>]*\bprops="([^"]*)"/g)) {
    let props;
    try { props = JSON.parse(unescapeHtml(m[1])); } catch { continue; }
    if (props?.deck) { deck = astroValue(props.deck); break; }
  }
  if (!deck || !Array.isArray(deck.cards)) throw new DeckError('Could not read the deck from that ManaBox page — is the deck shared publicly?');
  const lines = pred => deck.cards.filter(c => pred(c.boardCategory) && c.quantity > 0 && c.name)
    .map(c => `${c.quantity} ${c.name}`).join('\n');
  const main = lines(b => MB_MAIN.has(b)), side = lines(b => b === MB_SIDE);
  if (!main) throw new DeckError('That ManaBox deck has no main-deck cards.');
  return {
    name: String(deck.name || '').trim().slice(0, 80),
    format: deck.format || null,
    editedAt: Number.isFinite(deck.editDate) ? new Date(deck.editDate).toISOString() : null,
    main, side,
  };
}

export async function fetchManaBoxDeck(url) {
  const id = MANABOX_RE.exec(String(url).trim())?.[1];
  if (!id) throw new DeckError('That does not look like a ManaBox deck link.');
  const r = await fetch(`https://manabox.app/decks/${id}`, {
    headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; mjj29-budget-decks/1.0)' },
  });
  if (r.status === 404) throw new DeckError('ManaBox says that deck does not exist (or is private).');
  if (!r.ok) throw new Error(`ManaBox HTTP ${r.status}`);
  return parseManaBoxPage(await r.text());
}

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

// Deck name from pasted text: a title line, MTGA's "Name …", or a "// comment" above the list.
function extractDeckName(raw, isKnownCard) {
  const title = deckTitle(raw, isKnownCard);
  if (title) return title.slice(0, 80);
  for (const rawLine of (raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const nm = line.replace(/^[\s/#*=_~>|-]+/, '').match(/^name\s+(.+)$/i);
    if (nm) return nm[1].trim().slice(0, 80);
    if (sectionHeader(line) || /^sb:\s*$/i.test(line)) continue;
    const cm = line.match(/^(?:\/\/+|#+)\s*(\S.*)$/);
    if (cm) return cm[1].trim().slice(0, 80);
    return '';
  }
  return '';
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
  const look = cardLookup(data);
  const key = look.resolve(name);
  if (!key) return null;
  const e = look.entry(key);
  let best = null;
  for (const [id, set, cn] of e.p.values()) {
    const pp = productPrice(id, data);
    if (pp && (best == null || pp.price < best.price))
      best = { ...pp, set: (set || '').toUpperCase(), cn };
  }
  const legal = {};
  (data.index.fmt || []).forEach((f, k) => { legal[f] = LEGWORD[e.l[k]] ?? null; });
  // Keep the name as written unless it resolved to a different card name
  // ("Bloomvine Regent" -> "bloomvine regent // claim territory", title-cased later).
  return { name: norm(name) === key ? name : key, found: true, price: best?.price ?? null, foil: !!best?.foil,
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
    // Hyphenated parts are capitalised too: "Mirror-Breaker", "Kiki-Jiki", "First-Year".
    const out = (!firstOfFace && SMALL_WORDS.has(tok.toLowerCase())) ? tok.toLowerCase()
              : tok.replace(/(^|-)([a-z])/g, (_, h, c) => h + c.toUpperCase());
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
  const isKnown = n => !!cardLookup(data).resolve(n);
  const parsed = parseDecklist(d, isKnown);
  for (const [n, q] of parseSideboardBox(s)) addTo(parsed.side, n, q);
  if (!parsed.main.size) throw new DeckError('The link contains no main-deck cards.');

  const format = settings.format;
  const main = await priceBoard(parsed.main, data, format);
  const side = await priceBoard(parsed.side, data, format);

  return {
    link,
    deckName: String(state.n || extractDeckName(d, isKnown) || '').trim().slice(0, 80),
    // When the builder exported the link (user-editable, so only trusted for admin imports).
    exportedAt: (state.x && typeof state.x.t === 'string' && !isNaN(Date.parse(state.x.t))) ? state.x.t : null,
    format,
    priceDate: data.meta.generatedAt,
    main, side,
    hash: await deckHash(main.rows, side.rows, n => canonicalName(n, data)),
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

// Identity of "this exact 75": order- and case-insensitive, and by canonical card
// name, so "Bloomvine Regent" and "Bloomvine Regent // Claim Territory" match.
async function deckHash(mainRows, sideRows, canon = norm) {
  const board = rows => {
    const m = new Map();
    for (const r of rows) m.set(canon(r.name), (m.get(canon(r.name)) || 0) + r.qty);
    return [...m].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([n, q]) => `${q} ${n}`).join('\n');
  };
  const text = board(mainRows) + '\n--side--\n' + board(sideRows);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Re-derive a stored listing's deck_hash from its cards ({ main:[[qty,name,…]], side }). */
export async function storedDeckHash(cards) {
  const data = await loadPriceData();
  const rows = b => (cards?.[b] ?? []).map(([qty, name]) => ({ qty, name }));
  return deckHash(rows('main'), rows('side'), n => canonicalName(n, data));
}

// ─── Colours & featured card (Scryfall) ──────────────────────────────────────

const BASIC_COLOUR = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
const BASIC_TYPE = /\b(Plains|Island|Swamp|Mountain|Forest)\b/g;

/**
 * Colours the deck actually needs, from mana costs rather than card colour:
 *   - plain coloured symbols ({R}) are required;
 *   - two-colour hybrid ({G/W}) only adds a colour if the deck can't already
 *     pay it, choosing whichever colour covers the most unpaid hybrid symbols;
 *   - Phyrexian ({U/P}) and {2/W} symbols never add a colour (payable without it);
 *   - colours the deck's mana sources can't make are dropped: those spells are
 *     cast for free or never cast (Hollow One, Street Wraith, Archon reanimation).
 *     Sources of every colour don't count, so a Treasure maker doesn't add colours.
 * entries: [{ qty, name, card }] for every main-deck card, card = Scryfall object or null.
 */
export function deckColours(entries) {
  const required = new Set(), producible = new Set(), hybrids = [];
  for (const { qty, name, card } of entries) {
    const basic = BASIC_COLOUR[norm(name).replace(/^snow-covered\s+/, '')];
    if (basic) { producible.add(basic); continue; }
    if (!card) continue;
    // Any-colour sources (Treasure makers, Mirrex, City of Brass) are fixing, not the deck's colours.
    const made = card.produced_mana ?? [];
    if (!COLOR_ORDER.every(c => made.includes(c))) made.forEach(m => producible.add(m));
    const faces = card.card_faces ?? [card];
    const isLand = /\bLand\b/.test(faces[0].type_line ?? card.type_line ?? '');
    if (isLand) {
      // Fetch lands produce nothing themselves: credit the basic types they can find.
      if (!card.produced_mana?.length) {
        const text = faces.map(f => f.oracle_text ?? '').join('\n');
        const types = [...text.matchAll(BASIC_TYPE)].map(m => BASIC_COLOUR[m[1].toLowerCase()]);
        if (types.length) types.forEach(c => producible.add(c));
        else if (/basic land/i.test(text)) COLOR_ORDER.forEach(c => producible.add(c));
      }
      continue;
    }
    const symbols = faces.flatMap(f => [...(f.mana_cost ?? '').matchAll(/\{([^}]+)\}/g)].map(m => m[1]));
    if (!symbols.length && !(card.mana_cost ?? faces[0].mana_cost)) {
      (card.colors ?? faces.flatMap(f => f.colors ?? [])).forEach(c => required.add(c));  // no cost: Living End etc.
      continue;
    }
    for (const s of symbols) {
      if (COLOR_ORDER.includes(s)) required.add(s);
      else if (/^[WUBRG]\/[WUBRG]$/.test(s)) hybrids.push({ opts: s.split('/'), qty });
    }
  }
  // Nothing known about the mana (lookups failed): don't filter.
  const canMake = c => !producible.size || producible.has(c);
  const colours = new Set([...required].filter(canMake));
  for (;;) {
    const unpaid = hybrids.filter(h => !h.opts.some(c => colours.has(c)) && h.opts.some(canMake));
    if (!unpaid.length) break;
    const score = c => unpaid.reduce((n, h) => n + (h.opts.includes(c) ? h.qty : 0), 0);
    colours.add(COLOR_ORDER.filter(canMake).reduce((best, c) => score(c) > score(best) ? c : best));
  }
  return COLOR_ORDER.filter(c => colours.has(c)).join('');
}

/**
 * Deck colours (see deckColours), in WUBRG order ('' for colourless). Also
 * picks a featured card (priciest non-land spell, else the most-played one)
 * with its art crop for the listing.
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

  const spells = [];
  for (const r of mainRows) {
    const c = lookup(r.name);
    if (!c) continue;
    const frontType = c.card_faces?.[0]?.type_line ?? c.type_line ?? '';
    if (/\bLand\b/.test(frontType)) continue;
    spells.push({ r, c });
  }
  spells.sort((a, b) => (b.r.unit ?? 0) - (a.r.unit ?? 0) || b.r.qty - a.r.qty);
  const pick = spells[0];
  const art = pick && (pick.c.image_uris?.art_crop ?? pick.c.card_faces?.[0]?.image_uris?.art_crop);
  return {
    colors: deckColours(mainRows.map(r => ({ qty: r.qty, name: r.name, card: lookup(r.name) ?? null }))),
    featured: pick ? { name: pick.c.name, art: art || null, uri: pick.c.scryfall_uri } : null,
    keyCards: [...spells].sort((a, b) => b.r.qty - a.r.qty || (b.r.unit ?? 0) - (a.r.unit ?? 0))
      .slice(0, 4).map(s => s.c.name),
  };
}
