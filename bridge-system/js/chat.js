/**
 * chat.js — AI chat tab (Anthropic Claude, BYOK).
 * Sends the full system JSON as context; Claude can call update_system to apply changes.
 * Layout: chat pane (left) + live read-only system tree (right).
 */
'use strict';

import { getActiveSystem, saveSystem } from './store.js';
import { callToHTML, sortNodes } from './model.js';
import { flash } from './ui.js';

const SETTINGS_KEY  = 'bridge_ai_settings';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

let chatMessages = [];   // Anthropic messages array (in-memory, per session)

function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

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
  chatMessages = [];
  // Do NOT set display inline — the CSS class controls display:flex/none for tab switching.
  container.style.overflow = 'hidden';

  const sys = getActiveSystem();
  const s   = getSettings();

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
            placeholder="${sys ? 'Ask Claude… (Enter to send, Shift+Enter for newline)' : 'Open a system first'}"
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
                padding:1rem;width:340px;box-shadow:0 4px 20px rgba(0,0,0,0.5)">
      <div style="font-weight:600;margin-bottom:0.75rem;font-size:0.9rem">API Settings</div>
      <div class="form-group">
        <label>Anthropic API Key</label>
        <input type="password" id="chat-apikey" value="${escAttr(s.apiKey ?? '')}" placeholder="sk-ant-…">
      </div>
      <div class="form-group">
        <label>Model</label>
        <input type="text" id="chat-model" value="${escAttr(s.model ?? DEFAULT_MODEL)}" placeholder="${DEFAULT_MODEL}">
        <small style="color:var(--text-muted);font-size:0.72rem">
          e.g. claude-3-5-sonnet-20241022 · claude-3-5-haiku-20241022
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
  container.querySelector('#chat-settings-save').addEventListener('click', () => {
    saveSettings({
      apiKey: container.querySelector('#chat-apikey').value.trim(),
      model:  container.querySelector('#chat-model').value.trim() || DEFAULT_MODEL,
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

  // ── Initial greeting ────────────────────────────────────────────────────────
  if (!sys) {
    addBubble('assistant', 'No system is open. Create or open a system first.');
  } else if (!s.apiKey) {
    addBubble('assistant', `Loaded <strong>${escHtml(sys.name)}</strong>. Click ⚙&nbsp;Settings to add your Anthropic API key, then ask me to make changes.`);
  } else {
    addBubble('assistant', `Loaded <strong>${escHtml(sys.name)}</strong> (${countNodes(sys)} bid nodes). What would you like to change?`);
  }

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
  const desc = m.description ? `<span style="color:var(--text-muted);margin-left:0.4em">${escHtml(m.description)}</span>` : '';
  const hcp  = m.hcp ? `<span style="color:var(--accent);font-size:0.78rem;margin-left:0.3em;font-family:var(--font-mono)">[${m.hcp[0]??''}–${m.hcp[1]??''}]</span>` : '';
  const shape= m.shape ? `<span style="color:var(--text-muted);font-size:0.78rem;margin-left:0.3em">${escHtml(m.shape)}</span>` : '';
  const vars = (nd.variants?.length)
    ? `<span style="font-size:0.72rem;margin-left:0.3em;color:var(--yellow);
                    border:1px solid rgba(243,156,18,.3);border-radius:99px;
                    padding:0 0.3em;background:rgba(243,156,18,.08)">${nd.variants.length}v</span>`
    : '';

  let kids = '';
  if (nd.continuations?.type === 'nodes' && nd.continuations.nodes.length) {
    kids = `<div style="padding-left:${pl + 16}px;border-left:1px solid var(--border);margin-left:${pl + 6}px;padding-top:1px">
      ${renderNodes(sortNodes(nd.continuations.nodes), sys, 0)}
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

function showThinking() {
  if (!document.getElementById('chat-thinking'))
    addBubble('assistant', '<em style="color:var(--text-muted)">Thinking…</em>', 'chat-thinking');
}
function hideThinking() { document.getElementById('chat-thinking')?.remove(); }

// ─── Send / API ───────────────────────────────────────────────────────────────

async function sendMessage(container) {
  const input   = container.querySelector('#chat-input');
  const sendBtn = container.querySelector('#chat-send');
  const text    = input?.value.trim();
  if (!text) return;

  const s   = getSettings();
  const sys = getActiveSystem();

  if (!s.apiKey) { addBubble('assistant', '⚠ No API key set — click ⚙&nbsp;Settings.'); return; }
  if (!sys)      { addBubble('assistant', '⚠ No system open.'); return; }

  input.value      = '';
  input.disabled   = true;
  sendBtn.disabled = true;

  addBubble('user', escHtml(text));
  chatMessages.push({ role: 'user', content: text });
  showThinking();

  try {
    const result = await callClaude(sys, s, chatMessages, text);
    hideThinking();

    if (result.reply) {
      addBubble('assistant', escHtml(result.reply));
      chatMessages.push({ role: 'assistant', content: result.reply });
    }

    if (result.system) {
      result.system.id       = sys.id;
      result.system.metadata = { ...sys.metadata, ...result.system.metadata };
      saveSystem(result.system);
      addBubble('assistant', '✅ System updated.');
      chatMessages.push({ role: 'assistant', content: 'System updated.' });
      refreshTree(result.system);   // live update the right pane
    }

    if (!result.reply && !result.system) {
      addBubble('assistant', '(No response — check your API key and model name)');
    }
  } catch (err) {
    hideThinking();
    addBubble('assistant', `⚠ ${escHtml(err.message)}`);
  } finally {
    input.disabled   = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

// Fixed — sent as the Anthropic `system` field on every call. No data here.
const SYSTEM_PROMPT =
`You are an expert bridge bidding system editor. Help the user build and refine their bridge bidding system.

You will receive the current system JSON as a grounding message immediately before each user request.
Use it as the authoritative current state.

When the user asks you to make changes, call the update_system tool with the complete updated system.

Rules:
- Preserve ALL existing node \`id\` fields exactly (they are UUIDs used as references).
- Preserve the system \`id\` field exactly.
- For new bid nodes generate a new UUID.
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
async function callClaude(sys, settings, history, userText) {
  const model = settings.model || DEFAULT_MODEL;

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
      max_tokens: 8192,
      system:     SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  let reply  = null;
  let system = null;

  for (const block of data.content ?? []) {
    if (block.type === 'text')                                        reply  = block.text;
    if (block.type === 'tool_use' && block.name === 'update_system') system = block.input?.system ?? null;
  }

  return { reply, system };
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }

