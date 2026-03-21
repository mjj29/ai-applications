/**
 * auction.js — AI-driven auction simulator tab.
 *
 * Deals two random hands (one pair), then drives an auction by:
 *   1. Collecting the available bids from the resolver at each step.
 *   2. Calling Claude with the current hand + bid list.
 *   3. Applying the chosen bid and advancing the sequence.
 *   4. Alternating between the two hands (opener / responder).
 * Stops on three consecutive passes after at least one real bid,
 * or when four passes open the auction.
 * Renders the deal diagram and the annotated bidding box.
 */
'use strict';

import { getActiveSystem } from './store.js';
import { callToString, callToHTML, nodeCallToHTML, sortNodes, renderText } from './model.js';
import { resolve, resolveSequence } from './resolver.js';
import { flash } from './ui.js';

// Reuse the API key stored by the chat tab.
const SETTINGS_KEY = 'bridge_ai_settings';

function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}

// ─── Card / hand utilities ────────────────────────────────────────────────────

const RANKS   = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const SUITS   = ['S','H','D','C'];
const SUIT_SYM = { S:'♠', H:'♥', D:'♦', C:'♣' };
const SUIT_CLASS = { S:'suit-s', H:'suit-h', D:'suit-d', C:'suit-c' };

/** Deal 52 cards randomly and return four 13-card hands as suit arrays. */
function dealHands() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = [[], [], [], []];
  deck.forEach((c, i) => hands[i % 4].push(c));
  // Sort each hand by suit then rank
  const rankOrder = Object.fromEntries(RANKS.map((r, i) => [r, i]));
  const suitOrder = Object.fromEntries(SUITS.map((s, i) => [s, i]));
  for (const h of hands) h.sort((a, b) =>
    suitOrder[a.suit] - suitOrder[b.suit] || rankOrder[a.rank] - rankOrder[b.rank]);
  return hands;
}

/** Return HCP for a hand. */
function hcp(hand) {
  const pts = { A: 4, K: 3, Q: 2, J: 1 };
  return hand.reduce((s, c) => s + (pts[c.rank] ?? 0), 0);
}

/** Return suit lengths as { S, H, D, C }. */
function suitLengths(hand) {
  const len = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) len[c.suit]++;
  return len;
}

/** Distribution points (short-suit: void=3, singleton=2, doubleton=1). */
function distributionPoints(hand) {
  const len = suitLengths(hand);
  return Object.values(len).reduce((s, l) => s + (l === 0 ? 3 : l === 1 ? 2 : l === 2 ? 1 : 0), 0);
}

/** Is the hand balanced (4333, 4432, 5332)? */
function isBalanced(len) {
  const vals = Object.values(len).sort((a, b) => b - a);
  if (vals[0] > 5) return false;
  if (vals[3] === 0) return false;          // void
  if (vals[0] === 5 && vals[1] >= 4) return false; // 5-4-x-x
  return true;
}

/** HCP broken down by suit. */
function hcpBySuit(hand) {
  const pts = { A: 4, K: 3, Q: 2, J: 1 };
  const h = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) h[c.suit] += pts[c.rank] ?? 0;
  return h;
}

/** Brief stopper/holding label for one suit's cards. */
function suitHolding(cards) {
  if (cards.length === 0) return 'void';
  if (cards.length === 1) return `singleton ${cards[0].rank}`;
  const r = new Set(cards.map(c => c.rank));
  if (r.has('A'))                         return 'A (solid stopper)';
  if (r.has('K') && cards.length >= 2)   return 'Kx (stopper)';
  if (r.has('Q') && cards.length >= 3)   return 'Qxx (stopper)';
  if (r.has('K'))                         return 'K (partial — no second)';
  if (r.has('Q') && cards.length === 2)  return 'Qx (partial)';
  if (r.has('J') && cards.length >= 4)   return 'Jxxx (partial)';
  return '';
}

/** Format a hand as plain text for the AI prompt — one suit per line with length, cards, HCP and holding. */
function handToText(hand) {
  const len  = suitLengths(hand);
  const hbys = hcpBySuit(hand);
  return SUITS.map(s => {
    const cards = hand.filter(c => c.suit === s);
    const cardStr  = cards.map(c => c.rank).join('') || '—';
    const hcpStr   = hbys[s] > 0 ? ` (${hbys[s]} HCP)` : '';
    const holding  = suitHolding(cards);
    const holdStr  = holding ? ` [${holding}]` : '';
    return `  ${SUIT_SYM[s]}${len[s]}  ${cardStr.padEnd(13)}${hcpStr}${holdStr}`;
  }).join('\n');
}

/** One-line hand summary for the prompt header. */
function handSummary(hand) {
  const h   = hcp(hand);
  const len = suitLengths(hand);
  const dp  = distributionPoints(hand);
  const bal = isBalanced(len) ? 'balanced' : 'unbalanced';
  const shape = `${len.S}=${len.H}=${len.D}=${len.C}`;
  const maxLen = Math.max(...Object.values(len));
  const longest = SUITS.filter(s => len[s] === maxLen).map(s => `${SUIT_SYM[s]}${len[s]}`).join('/');
  const specials = [
    SUITS.filter(s => len[s] === 0).map(s => `${SUIT_SYM[s]} void`).join(', '),
    SUITS.filter(s => len[s] === 1).map(s => `${SUIT_SYM[s]} singleton`).join(', '),
    SUITS.filter(s => len[s] === 2).map(s => `${SUIT_SYM[s]} doubleton`).join(', '),
  ].filter(Boolean).join('; ');
  return `${h} HCP  shape ${shape} (${bal})  longest: ${longest}  dist pts: ${dp}${specials ? '  [' + specials + ']' : ''}`;
}

/** Format a hand as HTML for display, with suit lengths. */
function handToHTML(hand) {
  const len = suitLengths(hand);
  return SUITS.map(s => {
    const cards = hand.filter(c => c.suit === s).map(c => c.rank);
    const cls   = SUIT_CLASS[s];
    return `<div><span class="${cls}">${SUIT_SYM[s]}</span><sup style="font-size:0.65em;color:var(--text-muted);margin-right:0.15em">${len[s]}</sup> ${cards.join('') || '—'}</div>`;
  }).join('');
}

// ─── Call text helpers ────────────────────────────────────────────────────────

/** Convert a bid node call to the text the AI should return (and we can parse back). */
function callNodeToAIString(node) {
  const c = node.call;
  if (!c) return '?';
  if (c.type === 'pass')     return 'P';
  if (c.type === 'double')   return 'X';
  if (c.type === 'redouble') return 'XX';
  if (c.type === 'bid')      return `${c.level}${c.strain}`;
  return '?';
}

/** Try to parse one token as a call object (null on failure). */
function parseCallToken(tok) {
  const s = tok.trim().toUpperCase().replace(/[.,;:!?]$/, '');
  if (s === 'P' || s === 'PASS') return { type: 'pass' };
  if (s === 'X' || s === 'DBL' || s === 'DOUBLE') return { type: 'double' };
  if (s === 'XX' || s === 'RDBL' || s === 'REDOUBLE') return { type: 'redouble' };
  const m = s.match(/^([1-7])([CDHSN])T?$/);
  if (m) return { type: 'bid', level: +m[1], strain: m[2] };
  return null;
}

/**
 * Parse an AI reply to a call object.
 * 1. Try exact match on the whole string.
 * 2. Try the last non-empty line (prompt asks AI to end with bid code).
 * 3. Scan all whitespace-separated tokens and return the last valid bid found.
 * This handles responses like "Looking at my hand… I will bid\n1C".
 */
function parseAICall(str) {
  if (!str) return null;
  const direct = parseCallToken(str.trim());
  if (direct) return direct;
  // Try last non-empty line first
  const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const fromLastLine = parseCallToken(lines[lines.length - 1]);
    if (fromLastLine) return fromLastLine;
  }
  // Scan all tokens — return last valid bid found
  const tokens = str.trim().split(/\s+/);
  let last = null;
  for (const tok of tokens) {
    const c = parseCallToken(tok);
    if (c) last = c;
  }
  return last;
}

/** True if a call matches a node call (ignores isOpponentCall). */
function callsMatch(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'bid') return a.level === b.level && a.strain === b.strain;
  return true;
}

// ─── Sequence string builder (for resolver) ──────────────────────────────────

/**
 * Build a sequence string from an array of auction steps:
 *   { call, isOpponent }
 * Opponent calls are wrapped in parens.
 */
function stepsToSequenceString(steps) {
  return steps.map(s => {
    const str = callToString(s.call);
    return s.isOpponent ? `(${str})` : str;
  }).join(' - ');
}

// ─── Main renderer ────────────────────────────────────────────────────────────

let _auctionState = null; // persists across tab switches

export function renderAuction(container) {
  container.style.overflow = 'hidden';
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">

      <!-- Header bar -->
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;
                  border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg2)">
        <span style="font-weight:600;font-size:0.9rem">🃏 Auction Simulator</span>

        <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.83rem;margin-left:0.5rem">
          <label>Opener seat
            <select id="auc-seat" style="margin-left:0.3rem">
              <option value="1">1st</option>
              <option value="2">2nd</option>
              <option value="3">3rd</option>
              <option value="4">4th</option>
            </select>
          </label>
          <label style="margin-left:0.5rem">Vulnerability
            <select id="auc-vul" style="margin-left:0.3rem">
              <option value="nv">NV</option>
              <option value="vul">Vul</option>
              <option value="fav">Fav (we NV)</option>
              <option value="unfav">Unfav (they NV)</option>
            </select>
          </label>
        </div>

        <button class="btn btn-primary" id="btn-auc-deal" style="margin-left:auto">🎲 New deal &amp; bid</button>
        <button class="btn" id="btn-auc-redeal" title="Re-run auction with same hands" disabled>↺ Re-bid</button>
        <div id="auc-spinner" style="display:none;font-size:0.82rem;color:var(--text-muted)">⏳ thinking…</div>
      </div>

      <!-- Body: deal on left, auction on right -->
      <div style="display:flex;flex:1;min-height:0;overflow:hidden;gap:0">

        <!-- Left: deal -->
        <div id="auc-deal-panel"
             style="width:320px;min-width:220px;flex-shrink:0;overflow-y:auto;
                    padding:1rem;border-right:1px solid var(--border)">
          <div style="color:var(--text-muted);font-size:0.85rem">Deal a hand to start.</div>
        </div>

        <!-- Right: auction log -->
        <div id="auc-auction-panel"
             style="flex:1;min-width:0;overflow-y:auto;padding:1rem">
          <div style="color:var(--text-muted);font-size:0.85rem">Auction will appear here.</div>
        </div>

      </div>
    </div>`;

  // Restore seat/vul from last state
  if (_auctionState) {
    document.getElementById('auc-seat').value = _auctionState.seat;
    document.getElementById('auc-vul').value  = _auctionState.vul;
  }

  document.getElementById('btn-auc-deal').addEventListener('click', () => {
    const seat = +document.getElementById('auc-seat').value;
    const vul  = document.getElementById('auc-vul').value;
    const sys  = getActiveSystem();
    if (!sys) { flash('Open a system first', 'err'); return; }
    const s = getSettings();
    if (!s.apiKey) { flash('Add your Anthropic API key in the AI Chat ⚙ Settings tab first', 'err'); return; }
    const hands = dealHands();
    runAuction(container, sys, hands, seat, vul, s);
  });

  document.getElementById('btn-auc-redeal').addEventListener('click', () => {
    if (!_auctionState) return;
    const sys = getActiveSystem();
    if (!sys) { flash('Open a system first', 'err'); return; }
    const s = getSettings();
    if (!s.apiKey) { flash('Add your Anthropic API key in the AI Chat ⚙ Settings tab first', 'err'); return; }
    runAuction(container, sys, _auctionState.hands, _auctionState.seat, _auctionState.vul, s);
  });

  // Re-render deal if we have a prior state
  if (_auctionState?.result) {
    renderDeal(container, _auctionState.hands, _auctionState.seat);
    renderAuctionResult(container, _auctionState.result);
    document.getElementById('btn-auc-redeal').disabled = false;
  }
}

// ─── Auction engine ───────────────────────────────────────────────────────────

async function runAuction(container, sys, hands, seat, vul, settings) {
  _auctionState = { hands, seat, vul, result: null };

  renderDeal(container, hands, seat);

  const dealPanel    = container.querySelector('#auc-deal-panel');
  const auctionPanel = container.querySelector('#auc-auction-panel');
  const spinner      = container.querySelector('#auc-spinner');
  const dealBtn      = container.querySelector('#btn-auc-deal');
  const redealBtn    = container.querySelector('#btn-auc-redeal');

  auctionPanel.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Running auction…</div>';
  spinner.style.display = '';
  dealBtn.disabled  = true;
  redealBtn.disabled = true;

  // hand[0] = opener/south (seat N), hand[1] = responder/north (seat N+2)
  // Seats: opener = seat, responder = (seat % 4) + 2 equivalent  (we just track whose turn)
  const openerHand    = hands[0];
  const responderHand = hands[1];

  // auction steps: { call, isOpponent:false, meaning, node } (we only bid our pair)
  // Opponents always pass silently for simplicity
  const auctionSteps = []; // our pair's calls only, for sequence lookup
  const displayLog   = []; // all 4 seats in order: { seat, call, callStr, meaning, isOpp }

  const SEATS = ['N','E','S','W'];
  // Map: opener is at index (seat-1), responder is (seat+1)%4
  const openerSeatIdx    = (seat - 1) % 4;
  const responderSeatIdx = (openerSeatIdx + 2) % 4;

  let currentSeatIdx = openerSeatIdx; // first to speak is the opener
  let passCount = 0;
  let anyRealBid = false;
  const MAX_ROUNDS = 20; // safety cap

  // Sequence context: both our calls interleaved. Opponent passes are invisible to resolver.
  // We track "our sequence" = the calls our pair have made (not the opponent passes).
  const ourSequenceSteps = []; // { call, isOpponent:false } for sequence lookup

  let error = null;

  outer: for (let round = 0; round < MAX_ROUNDS; round++) {
    // Four seats per round
    for (let turn = 0; turn < 4; turn++) {
      const idx = (openerSeatIdx + round * 4 + turn) % 4;
      const isOurs = idx === openerSeatIdx || idx === responderSeatIdx;
      const isOpener = idx === openerSeatIdx;

      if (!isOurs) {
        // Opponent passes silently
        displayLog.push({ seatIdx: idx, call: { type: 'pass' }, callStr: 'P', meaning: null, isOpp: true });
        passCount++;
        // Check termination after opponent pass
        if (anyRealBid && passCount >= 3) break outer;
        if (!anyRealBid && passCount >= 4) break outer;
        continue;
      }

      // Our seat — ask AI
      const hand    = isOpener ? openerHand : responderHand;
      const handHCP = hcp(hand);

      // Get available bids from resolver, resolved for current seat/vul context
      const ctx = { seat, vul };
      const conventions = sys.conventions ?? {};
      let availableNodes = [];
      let resolvedPath   = [];   // for populating prior-bid meanings
      if (ourSequenceSteps.length === 0) {
        // Opening bid — raw openings list (will be resolved per-node below)
        availableNodes = sys.openings ?? [];
      } else {
        const seqResult = resolveSequence(sys, parseSeqSteps(ourSequenceSteps), ctx);
        availableNodes = seqResult.nextNodes ?? [];
        resolvedPath   = seqResult.path ?? [];
      }

      // Filter out opponent-call nodes (we wouldn't bid them)
      const ourNodes = availableNodes.filter(n => !n.isOpponentCall);

      // Detect whether the system tree has run out of defined continuations
      // (empty, or only a TBD/end node with no real bids)
      const nonPassNodes = ourNodes.filter(n => n.call?.type !== 'pass');
      const systemExhausted = nonPassNodes.length === 0;

      // Always include pass as an option
      const passNode = ourNodes.find(n => n.call?.type === 'pass')
        ?? { call: { type: 'pass' }, meaning: { description: 'Pass' }, variants: [], competitive: [], continuations: { type: 'end' } };
      const bidOptions = [
        ...nonPassNodes,
        passNode,
      ];

      // Resolve each bid's meaning through seat/vul variants
      const bidOptionsResolved = bidOptions.map(n => ({
        node:    n,
        callStr: callNodeToAIString(n),
        meaning: resolve(n, ctx, conventions).meaning ?? n.meaning ?? {},
      }));

      // Build bid list — include all resolved system information
      const bidListLines = bidOptionsResolved.map(({ callStr, meaning: m }) => {
        const parts = [];
        if (m.description) parts.push(m.description);
        if (m.hcp && (m.hcp[0] != null || m.hcp[1] != null)) {
          const lo = m.hcp[0] ?? 0;
          const hi = m.hcp[1] ?? 40;
          parts.push(`${lo}–${hi} HCP`);
        }
        if (m.shape)    parts.push(`shape: ${m.shape}`);
        if (m.forcing)  parts.push(`${m.forcing} forcing`);
        if (m.announce) parts.push(`announced: "${m.announce}"`);
        if (m.alert)    parts.push('alert');
        if (m.notes)    parts.push(m.notes);
        return `  ${callStr}: ${parts.join(' | ') || '—'}`;
      });
      const bidList = bidListLines.join('\n');

      // Build prior-auction section with resolved meanings
      let priorAuctionText;
      if (displayLog.length === 0) {
        priorAuctionText = '(none — you are opening)';
      } else {
        const lines = displayLog.map(entry => {
          if (entry.isOpp) return `  ${SEATS[entry.seatIdx]}: ${entry.callStr}  (opponent)`;
          const m = entry.resolvedMeaning ?? entry.meaning ?? {};
          const mParts = [];
          if (m.description) mParts.push(m.description);
          if (m.hcp && (m.hcp[0] != null || m.hcp[1] != null)) {
            mParts.push(`${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''} HCP`);
          }
          if (m.shape)    mParts.push(`shape: ${m.shape}`);
          if (m.forcing)  mParts.push(`${m.forcing} forcing`);
          if (m.announce) mParts.push(`announced: "${m.announce}"`);
          const mStr = mParts.length ? `  [${mParts.join(' | ')}]` : '';
          return `  ${SEATS[entry.seatIdx]}: ${entry.callStr}${mStr}`;
        });
        priorAuctionText = lines.join('\n');
      }

      // Build the bid instruction section depending on whether the system tree has continuations
      let bidInstruction;
      if (systemExhausted) {
        bidInstruction =
`The system notes do not define continuations from this point.
Use your expert bridge judgment to choose the best natural bid.
You may bid any legal call (e.g. 4S, 3N, 5C, P, X).`;
      } else {
        bidInstruction =
`SYSTEM BIDS AVAILABLE AT THIS POINT (resolved for seat ${seat}, ${vul.toUpperCase()}):
${bidList}

Choose the best bid from the system list above. If none fits, bid P.`;
      }

      const prompt =
`You are an expert bridge player using the "${sys.name}" system.

YOUR HAND (${handHCP} HCP):
${handToText(hand)}
Summary: ${handSummary(hand)}

Auction so far (seat: bid [system meaning]):
${priorAuctionText}

You are: ${isOpener ? 'Opener' : 'Responder'} (seat ${SEATS[idx]}, vulnerability: ${vul.toUpperCase()})

${bidInstruction}

End your reply with just the bid code alone on the last line (e.g. 1N, 4S, P, X).`;

      let chosenCallStr = null;
      try {
        chosenCallStr = await callClaudeOnce(settings, prompt);
      } catch (e) {
        error = `AI error at step ${displayLog.length + 1}: ${e.message}`;
        break outer;
      }

      // Parse the AI's reply — match against available options
      const aiCall = parseAICall(chosenCallStr ?? '');
      let matchedNode = null;
      if (aiCall) {
        matchedNode = bidOptions.find(n => callsMatch(n.call, aiCall));
        // When system is exhausted the AI may freely choose any legal call —
        // build a synthetic node for it rather than falling back to pass
        if (!matchedNode && systemExhausted) {
          matchedNode = {
            call: aiCall,
            meaning: { description: '(bridge judgment)' },
            variants: [], competitive: [], continuations: { type: 'tbd' },
          };
        }
      }
      // Final fallback: pass
      if (!matchedNode) matchedNode = passNode;

      const finalCall = matchedNode.call;
      const callStr   = callNodeToAIString(matchedNode);
      const resolvedMeaning = resolve(matchedNode, ctx, conventions).meaning ?? matchedNode.meaning ?? null;

      displayLog.push({
        seatIdx: idx,
        call:    finalCall,
        callStr,
        meaning:         matchedNode.meaning ?? null,
        resolvedMeaning,
        isOpp:   false,
      });

      ourSequenceSteps.push({ call: finalCall, isOpponent: false });

      if (finalCall.type === 'pass') {
        passCount++;
      } else {
        passCount  = 0;
        anyRealBid = true;
      }

      // Check termination
      if (anyRealBid && passCount >= 3) break outer;
      if (!anyRealBid && passCount >= 4) break outer;
    }
  }

  spinner.style.display = 'none';
  dealBtn.disabled   = false;
  redealBtn.disabled = false;

  // Resolve the full sequence for annotation
  const finalCtx  = { seat, vul };
  const finalSeq  = parseSeqSteps(ourSequenceSteps);
  const finalResolved = finalSeq.length
    ? resolveSequence(sys, finalSeq, finalCtx)
    : { path: [], nextNodes: [], error: null };

  const result = { displayLog, ourSequenceSteps, finalResolved, error };
  _auctionState.result = result;

  renderAuctionResult(container, result);
}

/**
 * Convert ourSequenceSteps (array of {call, isOpponent}) into the format
 * resolveSequence expects (parseSequence output format).
 */
function parseSeqSteps(steps) {
  return steps.map(s => ({
    call:         s.isOpponent ? null : s.call,
    intervention: s.isOpponent ? callToIntervention(s.call) : null,
  })).filter(s => s.call || s.intervention);
}

function callToIntervention(call) {
  if (!call) return null;
  switch (call.type) {
    case 'pass':     return { type: 'pass' };
    case 'double':   return { type: 'double', nature: 'pen' };
    case 'redouble': return { type: 'redouble' };
    case 'bid':      return { type: 'suit', level: call.level, strain: call.strain };
    default:         return null;
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderDeal(container, hands, seat) {
  const dealPanel = container.querySelector('#auc-deal-panel');
  const openerHand    = hands[0];
  const responderHand = hands[1];
  const openerSeatIdx    = (seat - 1) % 4;
  const responderSeatIdx = (openerSeatIdx + 2) % 4;
  const SEATS = ['N','E','S','W'];
  const openerHCP    = hcp(openerHand);
  const responderHCP = hcp(responderHand);

  dealPanel.innerHTML = `
    <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
                color:var(--text-muted);margin-bottom:0.75rem">Deal</div>

    <div style="margin-bottom:1rem">
      <div style="font-weight:600;font-size:0.88rem;margin-bottom:0.15rem">
        Opener (${SEATS[openerSeatIdx]})
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.3rem">
        ${handSummary(openerHand)}
      </div>
      <div style="font-family:monospace;font-size:0.9rem;line-height:1.7">
        ${handToHTML(openerHand)}
      </div>
    </div>

    <div>
      <div style="font-weight:600;font-size:0.88rem;margin-bottom:0.15rem">
        Responder (${SEATS[responderSeatIdx]})
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.3rem">
        ${handSummary(responderHand)}
      </div>
      <div style="font-family:monospace;font-size:0.9rem;line-height:1.7">
        ${handToHTML(responderHand)}
      </div>
    </div>`;
}

function renderAuctionResult(container, result) {
  const auctionPanel = container.querySelector('#auc-auction-panel');
  const { displayLog, finalResolved, error } = result;

  let html = '';

  if (error) {
    html += `<div style="color:#f99;padding:0.5rem 0.75rem;background:rgba(255,100,100,0.08);
                          border-radius:4px;font-size:0.88rem;margin-bottom:0.75rem">${escHtml(error)}</div>`;
  }

  // ── Bidding box ──────────────────────────────────────────────────────────
  const SEATS = ['N','E','S','W'];
  const SEAT_COLORS = { N: 'var(--accent)', E: '#e67e22', S: '#27ae60', W: '#9b59b6' };

  // Find the opener seat index for column ordering
  const firstSeatIdx = displayLog[0]?.seatIdx ?? 0;

  // Header row: seats in auction order starting from first bidder
  const headerCols = [0,1,2,3].map(i => {
    const idx = (firstSeatIdx + i) % 4;
    const label = SEATS[idx];
    return `<th style="text-align:center;padding:0.3rem 0.6rem;color:${SEAT_COLORS[label]};
                        font-size:0.8rem;font-weight:700;min-width:52px">${label}</th>`;
  }).join('');

  // Group displayLog into rows of 4 (one per round)
  // Fill blanks at the start if the first bid isn't at seat index 0
  const padded = [...displayLog];
  // Pad to multiple of 4
  while (padded.length % 4 !== 0) padded.push(null);

  let tableRows = '';
  for (let r = 0; r < padded.length; r += 4) {
    let row = '<tr>';
    for (let c = 0; c < 4; c++) {
      const entry = padded[r + c];
      if (!entry) {
        row += '<td></td>';
        continue;
      }
      const { callStr, isOpp, call } = entry;
      let cellHtml = '';
      if (call.type === 'pass') {
        cellHtml = `<span class="call-pass" style="font-size:0.9rem">P</span>`;
      } else if (call.type === 'double') {
        cellHtml = `<span class="call-double" style="font-size:0.9rem">X</span>`;
      } else if (call.type === 'redouble') {
        cellHtml = `<span class="call-redouble" style="font-size:0.9rem">XX</span>`;
      } else {
        const level = call.level;
        const strain = call.strain;
        const strainHTML = `<span class="${getSuitClass(strain)}">${getSuitSym(strain)}</span>`;
        cellHtml = `<span class="call-bid"><span class="call-level">${level}</span>${strainHTML}</span>`;
      }
      const oppStyle = isOpp ? 'opacity:0.45' : '';
      row += `<td style="text-align:center;padding:0.28rem 0.4rem;${oppStyle}">${cellHtml}</td>`;
    }
    row += '</tr>';
    tableRows += row;
  }

  html += `
    <div style="margin-bottom:1.25rem">
      <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
                  color:var(--text-muted);margin-bottom:0.5rem">Auction</div>
      <table style="border-collapse:collapse">
        <thead><tr>${headerCols}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  // ── Per-bid annotations ──────────────────────────────────────────────────
  const path = finalResolved?.path ?? [];
  if (path.length) {
    html += `
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
                    color:var(--text-muted);margin-bottom:0.5rem">Bid meanings</div>
        <table class="resolved-table">
          <thead>
            <tr>
              <th>Bid</th><th>Meaning</th><th>HCP</th><th>Shape</th><th>Forcing</th>
            </tr>
          </thead>
          <tbody>`;
    for (const step of path) {
      const m = step.resolved?.meaning;
      const callHtml = callToHTML(step.call);
      html += `<tr>
        <td style="white-space:nowrap">${callHtml}</td>
        <td>${m?.description ? renderText(m.description) : '<span style="color:var(--text-muted)">—</span>'}
            ${m?.announce ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3rem">"${m.announce}"</span>` : ''}
            ${m?.alert    ? '<span class="tag tag-alert" style="margin-left:0.25rem">Alert</span>' : ''}
            ${m?.notes    ? `<div style="color:var(--text-muted);font-size:0.78rem;margin-top:0.15rem">${escHtml(m.notes)}</div>` : ''}
        </td>
        <td style="font-family:monospace;font-size:0.82rem;white-space:nowrap">
          ${m?.hcp ? `${m.hcp[0] ?? ''}–${m.hcp[1] ?? ''}` : ''}
        </td>
        <td style="font-size:0.82rem">${m?.shape ?? ''}</td>
        <td>${m?.forcing ? `<span class="tag tag-forcing">${m.forcing}</span>` : ''}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  if (finalResolved?.error) {
    html += `<div style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">
      (sequence lookup: ${escHtml(finalResolved.error)})</div>`;
  }

  auctionPanel.innerHTML = html;
}

function getSuitClass(strain) {
  return { S:'suit-s', H:'suit-h', D:'suit-d', C:'suit-c', N:'' }[strain] ?? '';
}
function getSuitSym(strain) {
  return { S:'♠', H:'♥', D:'♦', C:'♣', N:'NT' }[strain] ?? strain;
}

// ─── Single Claude call for a single bid decision ────────────────────────────

async function callClaudeOnce(settings, userPrompt) {
  const model = settings.model || 'claude-3-5-haiku-20241022';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':                              'application/json',
      'x-api-key':                                 settings.apiKey,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      // High enough for a thinking model to think + produce a short text reply
      max_tokens: 8000,
      system: 'You are an expert bridge player. Given a hand and the available system bids with their meanings, choose the single best bid. End your reply with just the bid code alone on the last line (e.g. 1N, 2H, P, X, XX).',
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  // Thinking models return multiple content blocks; only look at text blocks
  const textBlocks = (data.content ?? []).filter(b => b.type === 'text');
  const fullText = textBlocks.map(b => b.text).join('\n').trim();
  return fullText || null;
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
