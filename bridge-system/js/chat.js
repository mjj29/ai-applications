/**
 * chat.js — AI chat tab.
 * Default: shared Gemini AI via Supabase Edge Function proxy (sign-in required).
 * Override: user can provide their own Anthropic or Gemini API key in Settings.
 * Layout: chat pane (left) + live read-only system tree (right).
 */
'use strict';

import { getActiveSystem, saveSystem } from './store.js';
import { callToHTML, sortNodes, renderText } from './model.js';
import { flash } from './ui.js';
import { supabase, onAuthChange } from './supabase.js';
import { SUPABASE_URL } from './config.js';

const SETTINGS_KEY         = 'bridge_ai_settings';
const DEFAULT_PROXY_MODEL  = 'gemini-2.5-flash';          // fixed model for the shared server key
const DEFAULT_MODEL        = 'claude-3-5-sonnet-20241022'; // BYOK Anthropic default
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';           // BYOK Gemini default

let chatMessages   = [];   // Anthropic messages array (in-memory, per session)
let _chatSystemId  = null; // system ID for which the chat DOM was last built
let _chatAuthUnsub = null; // cleanup fn for the auth-state listener

function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
    // Backwards-compat: old saves only had 'apiKey' (Anthropic)
    if (!s.provider && s.apiKey) { s.provider = 'anthropic'; s.anthropicKey = s.apiKey; }
    return s;
  } catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

/**
 * Determine which provider and key to use.
 * Anthropic BYOK takes highest precedence, then Gemini BYOK, then shared proxy (Gemini).
 * Returns { provider, key, isProxy }.
 */
function resolveProvider(s) {
  if (s.anthropicKey) return { provider: 'anthropic', key: s.anthropicKey, isProxy: false };
  if (s.geminiKey)    return { provider: 'gemini',    key: s.geminiKey,    isProxy: false };
  return                     { provider: 'gemini',    key: null,           isProxy: true  };
}

/**
 * Model to use for this call.
 * Proxy calls always use DEFAULT_PROXY_MODEL (cannot be overridden).
 * BYOK calls use the user's saved model, falling back to the provider default.
 */
function resolveModel(s, provider) {
  if (!s.anthropicKey && !s.geminiKey) return DEFAULT_PROXY_MODEL;
  if (s.model) return s.model;
  return provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_MODEL;
}

function countNodes(sys) {
  let n = 0;
  function walk(nodes) {
    for (const nd of (nodes ?? [])) {
      n++;
      if (nd.continuations?.type === 'nodes') walk(nd.continuations.nodes);
    }
  }
  walk(sys.openings ?? []);
  walk(sys.overcalls ?? []);
  return n;
}

// ─── Public ───────────────────────────────────────────────────────────────────

export function renderChat(container) {
  // Do NOT set display inline — the CSS class controls display:flex/none for tab switching.
  container.style.overflow = 'hidden';

  const sys = getActiveSystem();
  const s   = getSettings();

  // If the DOM is already built for this system, just refresh the tree and return.
  // This preserves chat history and scroll position across tab switches.
  if (container.querySelector('#chat-messages') && _chatSystemId === (sys?.id ?? null)) {
    refreshTree(sys);
    return;
  }

  // New system (or first render) — reset history and rebuild DOM.
  if (_chatAuthUnsub) { _chatAuthUnsub(); _chatAuthUnsub = null; }
  chatMessages  = [];
  _chatSystemId = sys?.id ?? null;

  // Wrap in a full-height inner div so the flex layout doesn't depend on the
  // container itself being a flex parent (which can't be set inline safely).
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;position:relative">

    <!-- Top header bar -->
    <div id="chat-header"
         style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 1rem;
                border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg2)">
      <span style="font-weight:600;font-size:0.9rem">🤖 AI Assistant</span>
      ${sys ? `<span style="color:var(--text-muted);font-size:0.82rem">— ${escHtml(sys.name)}</span>` : ''}
      <button id="chat-settings-btn" class="btn btn-sm" style="margin-left:auto" title="API settings">⚙ Settings</button>
    </div>

    <!-- Split body -->
    <div style="display:flex;flex:1;min-height:0;overflow:hidden">

      <!-- LEFT: chat -->
      <div style="display:flex;flex-direction:column;width:42%;min-width:280px;
                  border-right:1px solid var(--border)">
        <div id="chat-messages"
             style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;
                    gap:0.4rem;padding:0.6rem 0.8rem"></div>
        <div style="flex-shrink:0;padding:0.5rem 0.8rem;border-top:1px solid var(--border);
                    display:flex;gap:0.5rem;align-items:flex-end">
          <textarea id="chat-input" rows="2"
            placeholder="${sys ? 'Ask the AI… (Enter to send, Shift+Enter for newline)' : 'Open a system first'}"
            ${!sys ? 'disabled' : ''}
            style="flex:1;resize:none;font-size:0.85rem;font-family:var(--font);
                   background:var(--surface);border:1px solid var(--border);color:var(--text);
                   border-radius:var(--radius);padding:0.4rem 0.6rem"></textarea>
          <button id="chat-send" class="btn btn-primary" ${!sys ? 'disabled' : ''}>Send</button>
        </div>
      </div>

      <!-- RIGHT: live system tree -->
      <div style="flex:1;min-width:0;overflow-y:auto;padding:0.6rem 0.9rem;font-size:0.85rem">
        <div id="chat-tree-view"></div>
      </div>
    </div>

    <!-- Settings popover (position:absolute relative to the wrapper div) -->
    <div id="chat-settings-panel"
         style="display:none;position:absolute;top:3rem;right:1rem;z-index:50;
                background:var(--bg2);border:1px solid var(--border);border-radius:8px;
                padding:1rem;width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.5)">
      <div style="font-weight:600;margin-bottom:0.75rem;font-size:0.9rem">API Settings</div>
      <div class="form-group">
        <label>Anthropic API Key <small style="color:var(--text-muted);font-weight:400">optional</small></label>
        <input type="password" id="chat-anthropic-key" value="${escAttr(s.anthropicKey??'')}" placeholder="sk-ant-…">
      </div>
      <div class="form-group">
        <label>Gemini API Key <small style="color:var(--text-muted);font-weight:400">optional</small></label>
        <input type="password" id="chat-gemini-key" value="${escAttr(s.geminiKey??'')}" placeholder="AIza…">
        <small style="color:var(--text-muted);font-size:0.72rem">
          Leave both blank to use the shared Gemini AI (sign-in required).
          Anthropic key takes priority if both are set.
        </small>
      </div>
      <div class="form-group" id="chat-model-group" style="${(s.anthropicKey||s.geminiKey)?'':'display:none'}">
        <label>Model</label>
        <input type="text" id="chat-model" value="${escAttr(s.model??'')}" placeholder="(default for selected provider)">
        <small id="chat-model-hint" style="color:var(--text-muted);font-size:0.72rem">
          ${s.anthropicKey
            ?'e.g. claude-3-5-sonnet-20241022 &middot; claude-3-7-sonnet-20250219 &middot; claude-opus-4-5'
            :'e.g. gemini-2.0-flash &middot; gemini-1.5-pro &middot; gemini-2.5-pro-exp-03-25'}
        </small>
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">
        <button class="btn btn-sm" id="chat-settings-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="chat-settings-save">Save</button>
      </div>
    </div>

    </div>`; /* end wrapper */

  // The CSS class .editor-subtab.active already provides display:flex + flex-direction:column.

  // ── Settings panel ──────────────────────────────────────────────────────────
  const panel = container.querySelector('#chat-settings-panel');
  // Stop all clicks inside the panel reaching the document-level close handler.
  panel.addEventListener('click', e => e.stopPropagation());
  container.querySelector('#chat-settings-btn').addEventListener('click', e => {
    e.stopPropagation();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelector('#chat-settings-cancel').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  // Show/hide model group and update hint as user types in either key field
  const updateModelGroup = () => {
    const anthKey = container.querySelector('#chat-anthropic-key').value.trim();
    const gemKey  = container.querySelector('#chat-gemini-key').value.trim();
    container.querySelector('#chat-model-group').style.display = (anthKey || gemKey) ? '' : 'none';
    container.querySelector('#chat-model-hint').innerHTML = anthKey
      ? 'e.g. claude-3-5-sonnet-20241022 &middot; claude-3-7-sonnet-20250219 &middot; claude-opus-4-5'
      : 'e.g. gemini-2.0-flash &middot; gemini-1.5-pro &middot; gemini-2.5-pro-exp-03-25';
  };
  container.querySelector('#chat-anthropic-key').addEventListener('input', updateModelGroup);
  container.querySelector('#chat-gemini-key').addEventListener('input', updateModelGroup);
  container.querySelector('#chat-settings-save').addEventListener('click', () => {
    saveSettings({
      anthropicKey: container.querySelector('#chat-anthropic-key').value.trim(),
      geminiKey:    container.querySelector('#chat-gemini-key').value.trim(),
      model:        container.querySelector('#chat-model').value.trim(),
    });
    panel.style.display = 'none';
    flash('API settings saved', 'ok');
  });
  document.addEventListener('click', () => { panel.style.display = 'none'; });

  // ── Send wiring ─────────────────────────────────────────────────────────────
  container.querySelector('#chat-send').addEventListener('click', () => sendMessage(container));
  container.querySelector('#chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(container); }
  });

  // ── Greeting — shown on load and updated live when auth state changes ───────
  // showGreeting() is async (needs getSession) but idempotent: it updates the
  // existing #chat-greeting bubble in-place rather than appending a new one.
  async function showGreeting() {
    const { provider, isProxy } = resolveProvider(getSettings());
    let html;
    if (!sys) {
      html = 'No system is open. Create or open a system first.';
    } else if (isProxy) {
      const { data: { session } } = await supabase.auth.getSession();
      html = session
        ? `Loaded <strong>${escHtml(sys.name)}</strong> (${countNodes(sys)} bid nodes) — using shared Gemini AI. What would you like to change?`
        : `Loaded <strong>${escHtml(sys.name)}</strong>. Please <strong>sign in</strong> to access the shared AI assistant, or add your own API key in ⚙️ Settings.`;
    } else {
      const provLabel = provider === 'gemini' ? 'Gemini' : 'Claude';
      html = `Loaded <strong>${escHtml(sys.name)}</strong> (${countNodes(sys)} bid nodes) — using ${provLabel} (your key). What would you like to change?`;
    }
    const existing = document.getElementById('chat-greeting');
    if (existing) existing.innerHTML = html;
    else addBubble('assistant', html, 'chat-greeting');
  }
  showGreeting();

  // Re-run greeting whenever the user signs in or out (covers the OAuth redirect
  // case where detectSessionInUrl fires SIGNED_IN after the initial render).
  _chatAuthUnsub = onAuthChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') showGreeting();
  });

  // ── Initial tree render ──────────────────────────────────────────────────────
  refreshTree(sys);
}

// ─── Live tree (read-only) ────────────────────────────────────────────────────

function refreshTree(sys) {
  const pane = document.getElementById('chat-tree-view');
  if (!pane) return;
  if (!sys) { pane.innerHTML = '<div style="color:var(--text-muted);padding:1rem">No system open.</div>'; return; }

  const sections = [];

  if ((sys.openings ?? []).length) {
    sections.push(treeSection('Opening Bids', sys.openings, sys));
  }
  if ((sys.overcalls ?? []).length) {
    sections.push(treeSection('Overcalls', sys.overcalls, sys));
  }
  const convs = Object.values(sys.conventions ?? {});
  if (convs.length) {
    const inner = convs.map(cv =>
      `<div style="margin-bottom:0.6rem">
        <div style="font-size:0.78rem;font-weight:600;color:var(--accent);margin-bottom:2px">${escHtml(cv.name)}</div>
        ${renderNodes(cv.nodes ?? [], sys, 1)}
      </div>`
    ).join('');
    sections.push(section('Convention Library', inner));
  }

  pane.innerHTML = sections.join('') || '<div style="color:var(--text-muted);padding:1rem">No bids yet.</div>';
}

function treeSection(title, nodes, sys) {
  return section(title, renderNodes(sortNodes(nodes), sys, 0));
}

function section(title, inner) {
  return `
    <div style="margin-bottom:1rem">
      <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
                  color:var(--text-muted);border-bottom:1px solid var(--border);
                  padding-bottom:3px;margin-bottom:5px">${title}</div>
      ${inner || '<div style="color:var(--text-muted);font-style:italic;font-size:0.8rem;padding:2px 0">Empty</div>'}
    </div>`;
}

function renderNodes(nodes, sys, depth) {
  return (nodes ?? []).map(nd => renderNode(nd, sys, depth)).join('');
}

function renderNode(nd, sys, depth) {
  const m    = nd.meaning ?? {};
  const pl   = depth * 16;
  const call = callToHTML(nd.call);
  const desc = m.description ? `<span style="color:var(--text-muted);margin-left:0.4em">${renderText(m.description)}</span>` : '';
  const hcp  = m.hcp ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3em;font-family:var(--font-mono)">[${m.hcp[0]??''}–${m.hcp[1]??''}]</span>` : '';
  const shape= m.shape ? `<span style="color:var(--text-muted);font-size:0.78rem;margin-left:0.3em">${renderText(m.shape)}</span>` : '';
  const vars = (nd.variants?.length)
    ? `<span style="font-size:0.72rem;margin-left:0.3em;color:var(--yellow);
                    border:1px solid rgba(243,156,18,.3);border-radius:99px;
                    padding:0 0.3em;background:rgba(243,156,18,.08)">${nd.variants.length}v</span>`
    : '';

  let kids = '';
  if (nd.continuations?.type === 'nodes' &&
      (nd.continuations.nodes.length || nd.continuations.refs?.length)) {
    const refBadges = (nd.continuations.refs ?? []).map(r => {
      const cv = (sys.conventions ?? {})[r.conventionId];
      return cv ? `<div style="padding-left:${pl + 20}px;color:var(--accent);font-size:0.78rem;font-style:italic">→ ${escHtml(cv.name)}</div>` : '';
    }).join('');
    kids = `<div style="padding-left:${pl + 16}px;border-left:1px solid var(--border);margin-left:${pl + 6}px;padding-top:1px">
      ${renderNodes(sortNodes(nd.continuations.nodes), sys, 0)}
      ${refBadges}
    </div>`;
  } else if (nd.continuations?.type === 'ref') {
    const cv = (sys.conventions ?? {})[nd.continuations.conventionId];
    if (cv) {
      kids = `<div style="padding-left:${pl + 20}px;color:var(--accent);font-size:0.78rem;font-style:italic">→ ${escHtml(cv.name)}</div>`;
    }
  }

  return `<div>
    <div style="padding-left:${pl}px;line-height:1.6;display:flex;align-items:baseline;flex-wrap:wrap">
      <span style="font-weight:600;min-width:2.8em">${call}</span>${desc}${hcp}${shape}${vars}
    </div>
    ${kids}
  </div>`;
}

// ─── Bubble helpers ───────────────────────────────────────────────────────────

function addBubble(role, html, id) {
  const box = document.getElementById('chat-messages');
  if (!box) return null;
  const isUser = role === 'user';
  const div    = document.createElement('div');
  if (id) div.id = id;
  div.style.cssText = `
    align-self:${isUser ? 'flex-end' : 'flex-start'};
    max-width:92%;
    background:${isUser ? 'var(--bg3)' : 'var(--surface)'};
    border:1px solid var(--border);
    border-radius:8px;
    padding:0.4rem 0.65rem;
    font-size:0.83rem;
    line-height:1.5;
    white-space:pre-wrap;
    word-break:break-word;
  `;
  div.innerHTML = html;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

// ─── Send / API ───────────────────────────────────────────────────────────────

async function sendMessage(container) {
  const input   = container.querySelector('#chat-input');
  const sendBtn = container.querySelector('#chat-send');
  const text    = input?.value.trim();
  if (!text) return;

  const s   = getSettings();
  const sys = getActiveSystem();
  if (!sys) { addBubble('assistant', '⚠ No system open.'); return; }

  const { provider, key, isProxy } = resolveProvider(s);
  const model = resolveModel(s, provider);

  // For proxy calls, verify the user is signed in before doing any work
  if (isProxy) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      addBubble('assistant',
        '⚠ Please <strong>sign in</strong> to use the shared AI assistant, ' +
        'or add your own API key in ⚙️ Settings.');
      return;
    }
  }

  input.value      = '';
  input.disabled   = true;
  sendBtn.disabled = true;

  addBubble('user', escHtml(text));
  chatMessages.push({ role: 'user', content: text });

  // Create a live-streaming assistant bubble
  const bubble       = createStreamingBubble();
  const thinkDetails = bubble.querySelector('.chat-think-details');
  const thinkContent = bubble.querySelector('.chat-think-content');
  const thinkSummary = bubble.querySelector('.chat-think-summary');
  const textEl       = bubble.querySelector('.chat-response-text');
  const box          = document.getElementById('chat-messages');
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;

  let hasThinking = false;
  let hasText     = false;

  try {
    const apiFn = (provider === 'gemini') ? callGeminiStream : callClaudeStream;
    const result = await apiFn(sys, { ...s, _key: key, _model: model }, chatMessages, text, {
      onThinkingChunk(chunk) {
        if (!hasThinking) {
          hasThinking = true;
          textEl.innerHTML = '';           // remove "Thinking…" placeholder
          thinkDetails.style.display = '';
          thinkDetails.open = true;
        }
        thinkContent.textContent += chunk;
        box.scrollTop = box.scrollHeight;
      },
      onTextChunk(chunk) {
        if (!hasText) {
          hasText = true;
          textEl.innerHTML = '';           // remove "Thinking…" placeholder
        }
        textEl.textContent += chunk;
        box.scrollTop = box.scrollHeight;
      },
    });

    // Collapse thinking section and update its label when streaming is done
    if (hasThinking) {
      thinkDetails.open = false;
      thinkSummary.innerHTML =
        '🧠 Thoughts <small style="font-weight:400;opacity:0.7">(click to expand)</small>';
    }

    if (result.reply) {
      if (!hasText) textEl.textContent = result.reply;  // fallback if no chunks fired
      chatMessages.push({ role: 'assistant', content: result.reply });
    }

    if (result.system) {
      if (!hasText) textEl.innerHTML = '';  // clear placeholder when only a tool call was made
      result.system.id       = sys.id;
      result.system.metadata = { ...sys.metadata, ...result.system.metadata };
      saveSystem(result.system);
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:0.35rem;color:var(--green,#4caf50);font-size:0.8rem;font-weight:500';
      note.textContent = '✅ System updated.';
      bubble.appendChild(note);
      chatMessages.push({ role: 'assistant', content: 'System updated.' });
      refreshTree(result.system);
    }

    if (!result.reply && !result.system) {
      textEl.innerHTML = '<em style="color:var(--text-muted)">(No response — check API key and model)</em>';
    }
  } catch (err) {
    textEl.innerHTML = `<span style="color:#e74c3c">⚠ ${escHtml(err.message)}</span>`;
  } finally {
    input.disabled   = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function createStreamingBubble() {
  const div = document.createElement('div');
  div.style.cssText = `
    align-self:flex-start;
    max-width:92%;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:8px;
    padding:0.4rem 0.65rem;
    font-size:0.83rem;
    line-height:1.5;
    word-break:break-word;
  `;
  div.innerHTML = `
    <details class="chat-think-details"
             style="display:none;margin-bottom:0.4rem;font-size:0.78rem;
                    border-left:2px solid var(--accent);padding-left:0.5rem">
      <summary class="chat-think-summary"
               style="cursor:pointer;list-style:none;font-weight:600;color:var(--accent)">
        🧠 Thinking…
      </summary>
      <div class="chat-think-content"
           style="white-space:pre-wrap;margin-top:0.3rem;max-height:200px;
                  overflow-y:auto;font-size:0.75rem;color:var(--text-muted)"></div>
    </details>
    <div class="chat-response-text" style="white-space:pre-wrap">
      <em style="color:var(--text-muted)">Thinking…</em>
    </div>
  `;
  return div;
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

// Fixed — sent as the Anthropic `system` field on every call. No data here.
const SYSTEM_PROMPT =
`You are an expert bridge bidding system editor. Help the user build and refine their bridge bidding system.

You will receive the current system JSON as a grounding message immediately before each user request.
Use it as the authoritative current state.

When the user asks you to make changes, call the update_system tool with the complete updated system.

## Exact JSON schema

A system object:
{
  "id": "<uuid>",
  "name": "System name",
  "metadata": { "authors": [], "notes": "", "modified": "<iso date>", "format": "v1" },
  "openings":    [ ...bid nodes ],
  "overcalls":   [ ...bid nodes ],
  "conventions": { "<uuid>": { "id": "<uuid>", "name": "Stayman", "description": "", "tags": [], "nodes": [ ...bid nodes ] } },
  "carding": {
    "signals":  [ { "context": "Partner leads", "method": "Attitude: high=enc", "notes": "" } ],
    "discards": [ ...same shape ],
    "leads":    [ ...same shape ]
  }
}

A bid node:
{
  "id": "<uuid — MUST be unique, generate with crypto.randomUUID()>",
  "call": one of:
    { "type": "bid", "level": 1, "strain": "C" }   strains: C D H S N (notrump)
    { "type": "pass" }
    { "type": "double" }
    { "type": "redouble" },
  "meaning": {
    "description": "Natural, 12-14 HCP",
    "hcp": [12, 14],          // or null
    "shape": "4441",          // or null/omit
    "forcing": "game",        // "game" | "one round" | null
    "announce": "12-14",      // announced bid text, or null
    "alert": false,
    "notes": ""
  },
  "variants": [],             // seat/vul condition overrides — usually []
  "continuations": one of:
    { "type": "tbd" }                                    no responses defined yet
    { "type": "end" }                                    sign-off, no continuations
    { "type": "nodes", "nodes": [ ...bid nodes ] }       inline responses
    { "type": "ref", "conventionId": "<uuid>" }          delegates to a convention
  "competitive": []
}

## Rules
- Every node MUST have a unique \`id\` (UUID). Generate new ones for new nodes; preserve existing ones exactly.
- Preserve the system \`id\` exactly.
- Bids in a continuations.nodes array represent responses to the parent bid.
- Only change what the user explicitly requests; leave everything else intact.
- If a request is ambiguous, ask a clarifying question rather than guessing.`;

// Injected fresh before every user turn — never stored in chatMessages.
function groundingMessage(sys) {
  return {
    role: 'user',
    content:
`<current_system>
${JSON.stringify(sys, null, 2)}
</current_system>

The above is the current state of the system. Please use it as context for the request that follows.`,
  };
}

// Synthetic assistant acknowledgement that must follow the grounding user message
// (Anthropic requires messages to strictly alternate user/assistant).
const GROUNDING_ACK = {
  role: 'assistant',
  content: 'Understood — I have the current system state. What would you like to change?',
};

const TOOLS = [{
  name: 'update_system',
  description: 'Apply the requested changes to the bridge system. Provide the complete updated system object.',
  input_schema: {
    type: 'object',
    required: ['system'],
    properties: {
      system: {
        type: 'object',
        description: 'The complete updated system JSON with all changes applied.',
      },
    },
  },
}];

// history = stored chatMessages (real exchanges only, no grounding)
// userText = the new user message (already added to history by caller)
// Callbacks: onThinkingChunk(text), onTextChunk(text) — called as SSE deltas arrive.
async function callClaudeStream(sys, settings, history, userText,
                                { onThinkingChunk = ()=>{}, onTextChunk = ()=>{} } = {}) {
  const model = settings._model ?? settings.model ?? DEFAULT_MODEL;

  // Extended thinking is supported on claude-3-7+ / claude-opus-4 / claude-sonnet-4
  const supportsThinking = /claude-3-7|claude-opus-4|claude-sonnet-4/i.test(model);

  // Build: [past exchanges...] [fresh grounding] [ack] [latest user message]
  // The last item in history is the userText we just pushed — exclude it here
  // so we can place it after the grounding pair.
  const priorHistory = history.slice(0, -1);
  const messages = [
    ...priorHistory,
    groundingMessage(sys),
    GROUNDING_ACK,
    { role: 'user', content: userText },
  ];

  const reqHeaders = {
    'content-type':                              'application/json',
    'x-api-key':                                 settings._key,
    'anthropic-version':                         '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (supportsThinking) reqHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-14';

  const reqBody = {
    model,
    max_tokens: supportsThinking ? 16000 : 8192,
    system:     SYSTEM_PROMPT,
    messages,
    tools:      TOOLS,
    stream:     true,
  };
  if (supportsThinking) reqBody.thinking = { type: 'enabled', budget_tokens: 8000 };

  let resp;
  if (settings._key) {
    // BYOK — call Anthropic directly from the browser
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: reqHeaders,
      body:    JSON.stringify(reqBody),
    });
  } else {
    // No BYOK key — route through Supabase Edge Function proxy
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Please sign in (or add an API key in ⚙️ Settings) to use the AI assistant.');
    resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ provider: 'anthropic', model, body: reqBody }),
    });
  }

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const msg  = body?.error?.message ?? `HTTP ${resp.status}`;
    if (resp.status === 429 || /rate.?limit|quota|resource.?exhaust/i.test(msg)) {
      throw new Error(settings._key
        ? 'Rate limit reached on your API key — wait a moment and try again.'
        : 'Rate limit reached on the shared AI key. Add your own API key in ⚙️ Settings for higher limits.');
    }
    throw new Error(msg);
  }

  // ── Parse SSE stream ────────────────────────────────────────────────────────
  // blocks[index] = { type, name, text, inputJson }
  const blocks  = {};
  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';

  const handleEvent = (data) => {
    if (data.type === 'content_block_start') {
      blocks[data.index] = {
        type:      data.content_block.type,
        name:      data.content_block.name ?? null,
        text:      '',
        inputJson: '',
      };
    } else if (data.type === 'content_block_delta') {
      const bl = blocks[data.index];
      if (!bl) return;
      const d = data.delta;
      if (d.type === 'text_delta') {
        bl.text += d.text;
        onTextChunk(d.text);
      } else if (d.type === 'thinking_delta') {
        bl.text += d.thinking;
        onThinkingChunk(d.thinking);
      } else if (d.type === 'input_json_delta') {
        bl.inputJson += d.partial_json;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines (\n\n)
    const rawEvents = buf.split('\n\n');
    buf = rawEvents.pop();  // keep any trailing incomplete event

    for (const raw of rawEvents) {
      if (!raw.trim()) continue;
      let dataStr = null;
      for (const line of raw.split('\n')) {
        if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (!dataStr || dataStr === '[DONE]') continue;
      try { handleEvent(JSON.parse(dataStr)); } catch { /* ignore parse errors */ }
    }
  }

  // ── Extract results ─────────────────────────────────────────────────────────
  let reply  = null;
  let system = null;

  // Sort by numeric index so multi-block interleaved text is concatenated in order
  for (const bl of Object.values(blocks)) {
    if (bl.type === 'text' && bl.text)
      reply = reply ? reply + bl.text : bl.text;
    if (bl.type === 'tool_use' && bl.name === 'update_system') {
      try { system = JSON.parse(bl.inputJson)?.system ?? null; } catch { /* malformed */ }
    }
  }

  return { reply, system };
}

// ─── Google Gemini API call ──────────────────────────────────────────────────────

async function callGeminiStream(sys, settings, history, userText,
                                { onThinkingChunk = ()=>{}, onTextChunk = ()=>{} } = {}) {
  const model = settings._model ?? settings.model ?? DEFAULT_GEMINI_MODEL;

  // Convert stored messages (Anthropic format) to Gemini `contents` format.
  // assistant -> model, content: string -> parts: [{text}]
  const toGemini = msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  });

  // Grounding: inject current system state before the live user turn.
  const groundingText =
    `<current_system>\n${JSON.stringify(sys, null, 2)}\n</current_system>\n\n` +
    'The above is the current state of the system. Please use it as context for the request that follows.';

  const priorHistory = history.slice(0, -1);
  const contents = [
    ...priorHistory.map(toGemini),
    { role: 'user',  parts: [{ text: groundingText }] },
    { role: 'model', parts: [{ text: 'Understood — I have the current system state. What would you like to change?' }] },
    { role: 'user',  parts: [{ text: userText }] },
  ];

  const reqBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    tools: [{
      functionDeclarations: [{
        name: 'update_system',
        description: 'Apply the requested changes to the bridge system. Provide the complete updated system object.',
        parameters: {
          type: 'OBJECT',
          properties: {
            system: { type: 'OBJECT', description: 'The complete updated system JSON with all changes applied.' },
          },
          required: ['system'],
        },
      }],
    }],
    generationConfig: { maxOutputTokens: 8192 },
  };

  let resp;
  if (settings._key) {
    // BYOK — call Gemini directly from the browser
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${
      encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings._key)}`;
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(reqBody),
    });
  } else {
    // No BYOK key — route through Supabase Edge Function proxy
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Please sign in (or add an API key in ⚙️ Settings) to use the AI assistant.');
    resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ provider: 'gemini', model, body: reqBody }),
    });
  }

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const msg  = body?.error?.message ?? `HTTP ${resp.status}`;
    if (resp.status === 429 || /rate.?limit|quota|resource.?exhaust/i.test(msg)) {
      throw new Error(settings._key
        ? 'Rate limit reached on your API key — wait a moment and try again.'
        : 'Rate limit reached on the shared AI key. Add your own API key in ⚙️ Settings for higher limits.');
    }
    throw new Error(msg);
  }

  // ── Parse SSE stream ───────────────────────────────────────────────────────
  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';
  let   reply   = null;
  let   system  = null;

  const handleData = (data) => {
    for (const cand of (data?.candidates ?? [])) {
      for (const part of (cand?.content?.parts ?? [])) {
        if (part.text != null) {
          if (reply === null) reply = '';
          reply += part.text;
          onTextChunk(part.text);
        }
        if (part.functionCall?.name === 'update_system') {
          try {
            const args = part.functionCall.args;
            system = (typeof args === 'string' ? JSON.parse(args) : args)?.system ?? null;
          } catch { /* malformed */ }
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const rawEvents = buf.split('\n\n');
    buf = rawEvents.pop();
    for (const raw of rawEvents) {
      if (!raw.trim()) continue;
      let dataStr = null;
      for (const line of raw.split('\n')) {
        if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (!dataStr || dataStr === '[DONE]') continue;
      try { handleData(JSON.parse(dataStr)); } catch { /* ignore */ }
    }
  }

  return { reply, system };
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }

