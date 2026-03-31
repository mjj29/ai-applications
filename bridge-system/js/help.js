/**
 * help.js — In-app documentation page.
 */
'use strict';

export function renderHelp(container) {
  container.style.overflow = 'hidden';
  container.innerHTML = `
<div id="help-root" style="display:flex;height:100%;overflow:hidden">

  <!-- Sidebar nav -->
  <nav id="help-nav"
       style="width:200px;min-width:160px;flex-shrink:0;overflow-y:auto;
              border-right:1px solid var(--border);padding:0.75rem 0;background:var(--bg2)">
    ${NAV_ITEMS.map(([id, label]) => `
      <a class="help-nav-link" data-section="${id}"
         style="display:block;padding:0.3rem 1rem;font-size:0.84rem;color:var(--text-muted);
                text-decoration:none;cursor:pointer;border-left:2px solid transparent;
                transition:color .12s,border-color .12s">${label}</a>`).join('')}
  </nav>

  <!-- Content -->
  <div id="help-content"
       style="flex:1;min-width:0;overflow-y:auto;padding:1.5rem 2rem 3rem;
              font-size:0.87rem;line-height:1.65">
    ${SECTIONS.map(s => `
      <section id="help-${s.id}"
               style="display:none;max-width:740px">
        <h2 style="margin:0 0 1rem;font-size:1.15rem;color:var(--accent)">${s.title}</h2>
        ${s.html}
      </section>`).join('')}
  </div>
</div>

<style>
  .help-nav-link:hover          { color:var(--text); }
  .help-nav-link.active         { color:var(--accent); border-left-color:var(--accent); background:rgba(74,158,255,.07); }
  #help-content h3              { font-size:0.97rem; margin:1.5rem 0 0.4rem; color:var(--text); }
  #help-content h4              { font-size:0.88rem; margin:1.1rem 0 0.25rem; color:var(--text-muted); font-weight:600; }
  #help-content p               { margin:0.45rem 0; }
  #help-content ul,
  #help-content ol              { margin:0.4rem 0 0.4rem 1.4rem; }
  #help-content li              { margin-bottom:0.3rem; }
  #help-content code            { background:rgba(255,255,255,.08); border-radius:3px;
                                  padding:.1rem .3rem; font-size:.83rem; font-family:monospace; }
  #help-content pre             { background:rgba(255,255,255,.05); border:1px solid var(--border);
                                  border-radius:5px; padding:.6rem .85rem; overflow-x:auto;
                                  font-size:.8rem; line-height:1.5; margin:.5rem 0; }
  .help-table                   { width:100%; border-collapse:collapse; margin:.5rem 0; font-size:.83rem; }
  .help-table th                { text-align:left; padding:.25rem .5rem; color:var(--text-muted);
                                  border-bottom:1px solid var(--border); font-weight:600; }
  .help-table td                { padding:.28rem .5rem; border-bottom:1px solid rgba(255,255,255,.05); vertical-align:top; }
  .help-table tr:last-child td  { border-bottom:none; }
  .help-tip                     { background:rgba(74,158,255,.08); border-left:3px solid var(--accent);
                                  border-radius:0 4px 4px 0; padding:.4rem .7rem; margin:.5rem 0; }
  .help-warn                    { background:rgba(243,156,18,.08); border-left:3px solid var(--yellow,#f39c12);
                                  border-radius:0 4px 4px 0; padding:.4rem .7rem; margin:.5rem 0; }
  .help-badge                   { display:inline-block; font-size:.74rem; padding:.08rem .35rem;
                                  border-radius:99px; vertical-align:middle; font-family:monospace; }
  .help-badge-tbd               { background:rgba(243,156,18,.12); color:var(--yellow,#f39c12); border:1px solid rgba(243,156,18,.3); }
  .help-badge-alert             { background:rgba(231,76,60,.12); color:#e74c3c; border:1px solid rgba(231,76,60,.3); }
  .help-badge-forcing           { background:rgba(52,152,219,.12); color:#3498db; border:1px solid rgba(52,152,219,.3); }
  .help-badge-var               { background:rgba(243,156,18,.1); color:var(--yellow,#f39c12); border:1px solid rgba(243,156,18,.3); }
  .help-call                    { display:inline-block; font-family:monospace; font-weight:700; font-size:.88rem; }
  .help-s                       { color:#1a1a2e; }
  .help-h,.help-d               { color:#c0392b; }
  .help-c                       { color:#1a1a2e; }
  .help-example                 { background:rgba(255,255,255,.04); border:1px solid var(--border);
                                  border-radius:5px; padding:.5rem .8rem; margin:.4rem 0; font-size:.82rem; }
</style>`;

  // Nav logic — show first section by default
  const links = container.querySelectorAll('.help-nav-link');
  const sections = container.querySelectorAll('#help-content section');

  function show(id) {
    sections.forEach(s => s.style.display = s.id === 'help-' + id ? '' : 'none');
    links.forEach(l => l.classList.toggle('active', l.dataset.section === id));
  }

  links.forEach(l => l.addEventListener('click', () => show(l.dataset.section)));
  if (links.length) show(links[0].dataset.section);
}

// ─── Navigation items ─────────────────────────────────────────────────────────

const NAV_ITEMS = [
  ['overview',    '🗺 Overview'],
  ['systems',     '📂 Systems'],
  ['edit',        '✏️ Edit tab'],
  ['tree',        '🌲 Bid tree'],
  ['node-form',   '📋 Node editor'],
  ['variants',    '🔀 Variants'],
  ['conventions', '📚 Conventions'],
  ['position',    '📍 Position tab'],
  ['lookup',      '🔍 Lookup tab'],
  ['print',       '🖨 Print tab'],
  ['chat',        '🤖 AI Chat'],
  ['auction',     '🃏 Auction tab'],
  ['data-format', '⚙ Data format'],
];

// ─── Section content ──────────────────────────────────────────────────────────

const SECTIONS = [

// ── Overview ──────────────────────────────────────────────────────────────────
{ id: 'overview', title: '🗺 Overview', html: `
<p>The <strong>Bridge System Editor</strong> lets you build, annotate, and share a complete bridge system — every opening bid, response, rebid, and competitive sequence — with full seat/vulnerability conditioning.</p>

<h3>The five main tabs</h3>
<table class="help-table">
  <thead><tr><th>Tab</th><th>What it does</th></tr></thead>
  <tbody>
    <tr><td><strong>Edit</strong></td><td>Build and maintain the bid tree, manage conventions, overcalls, and carding rules.</td></tr>
    <tr><td><strong>Position</strong></td><td>View the system as it looks in a specific opening seat and vulnerability — all variant conditions are applied silently.</td></tr>
    <tr><td><strong>Lookup</strong></td><td>Type any sequence (e.g. <code>1C - 1H - 1N</code>) to see the resolved meaning and all available continuations.</td></tr>
    <tr><td><strong>Print</strong></td><td>Generate a printable system booklet, ACBL, EBU, or WBF convention card as a PDF.</td></tr>
    <tr><td><strong>AI Chat</strong></td><td>Ask Claude to explain, critique, or edit the system for you.</td></tr>
    <tr><td><strong>🃏 Auction</strong></td><td>Deal two random hands and watch Claude bid them through your system.</td></tr>
  </tbody>
</table>

<h3>Quick-start</h3>
<ol>
  <li>Click <strong>Systems</strong> in the top bar, then <strong>+ New System</strong> (or import a JSON file).</li>
  <li>Click the system name to open it — the top bar shows its name.</li>
  <li>Switch to the <strong>Edit</strong> tab and add your opening bids.</li>
  <li>Click any bid to expand its children and edit its details in the right panel.</li>
</ol>

<div class="help-tip">
  <strong>Auto-save</strong> — every change is saved immediately to your browser (localStorage) or to the cloud if you are signed in. There is no Save button.
</div>
` },

// ── Systems ───────────────────────────────────────────────────────────────────
{ id: 'systems', title: '📂 Systems', html: `
<h3>Creating &amp; importing</h3>
<ul>
  <li><strong>+ New System</strong> — creates a blank system and opens it.</li>
  <li><strong>Import JSON</strong> — loads a <code>.bridge.json</code> file you exported previously, or any compatible system file.</li>
</ul>

<h3>The systems list</h3>
<p>Each row shows the system name and a status badge:</p>
<table class="help-table">
  <thead><tr><th>Badge</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td><span class="help-badge" style="background:rgba(255,255,255,.07);color:#aaa;border:1px solid rgba(255,255,255,.12)">local</span></td><td>Stored only in this browser; not signed in.</td></tr>
    <tr><td><span class="help-badge" style="background:rgba(120,120,120,.12);color:#999;border:1px solid rgba(120,120,120,.25)">private</span></td><td>Synced to the cloud; visible only to you.</td></tr>
    <tr><td><span class="help-badge" style="background:rgba(243,156,18,.12);color:#f39c12;border:1px solid rgba(243,156,18,.3)">shared</span></td><td>You have been added as a collaborator on someone else's system.</td></tr>
    <tr><td><span class="help-badge" style="background:rgba(46,204,113,.12);color:#2ecc71;border:1px solid rgba(46,204,113,.3)">public</span></td><td>Publicly accessible via a shareable link.</td></tr>
  </tbody>
</table>

<h3>Actions in each row</h3>
<ul>
  <li><strong>Open</strong> — make this the active system (loads it into Edit/Position/Lookup).</li>
  <li><strong>Export</strong> — download the system as a <code>.bridge.json</code> file.</li>
  <li><strong>Share</strong> <em>(cloud only)</em> — open the Share &amp; Publish modal.</li>
  <li><strong>Delete</strong> — permanently removes the system.</li>
</ul>

<h3>Sharing &amp; collaboration</h3>
<p>In the Share modal you can:</p>
<ul>
  <li>Make the system <strong>public</strong> and copy a <code>?s=slug</code> link to share with anyone.</li>
  <li>Add a collaborator by email address; choose <strong>Editor</strong> (can edit) or <strong>Viewer</strong> (read-only).</li>
  <li>Anyone visiting a public link sees a preview and can <strong>Clone</strong> it into their own account.</li>
</ul>
` },

// ── Edit tab ──────────────────────────────────────────────────────────────────
{ id: 'edit', title: '✏️ Edit tab', html: `
<p>The Edit tab is split into two columns: the <strong>bid tree</strong> on the left, and the <strong>node editor form</strong> on the right. Sections within the left column are separated by collapsible headers.</p>

<h3>Left-column sections</h3>
<table class="help-table">
  <thead><tr><th>Section</th><th>Contents</th></tr></thead>
  <tbody>
    <tr><td><strong>Opening Bids</strong></td><td>All bids your side can make to open the auction.</td></tr>
    <tr><td><strong>Overcalls</strong></td><td>Your bids after the opponents open; each entry is tagged with the opener's bid it applies to.</td></tr>
    <tr><td><strong>Conventions</strong></td><td>Named sub-systems (Stayman, Transfers, etc.) that can be referenced from multiple points in the tree.</td></tr>
    <tr><td><strong>Carding</strong></td><td>Leads, signals, and discards rules (Opening Lead, Signals, Discards sub-sections).</td></tr>
  </tbody>
</table>

<h3>Adding an opening bid</h3>
<p>Click <strong>+ Add opening</strong> at the top of the Opening Bids section. In the modal:</p>
<ul>
  <li><strong>Call</strong> — type the bid: <code>1C</code>, <code>1N</code>, <code>2H</code>, <code>P</code>, <code>X</code>, <code>XX</code>.</li>
  <li>Wrap opponent bids in parentheses: <code>(X)</code>, <code>(2H)</code>, <code>(P)</code> — these become <em>opponent-call nodes</em> (shown in yellow in the tree) that let you define continuations after interference.</li>
  <li><strong>Description</strong> and <strong>HCP min/max</strong> are optional quick-fills; you can always edit them later.</li>
</ul>

<h3>Conventions panel</h3>
<ul>
  <li>Click <strong>+ New convention</strong> to create a named sub-system (e.g. "Stayman responses").</li>
  <li>Click <strong>📚 Library</strong> to import a ready-made convention (Stayman, Blackwood, Jacoby Transfers, etc.) and then edit it freely.</li>
  <li>Conventions are referenced from bid nodes using <strong>→ refs</strong> in the node editor — this inserts the convention's bids as continuations without duplicating the data.</li>
</ul>

<h3>Carding rules</h3>
<p>Each rule has a <strong>context</strong> (e.g. "Partner's suit"), a <strong>method</strong> (e.g. "Top of sequence"), and an optional <strong>notes</strong> field. Click any row to edit it; click <strong>+ Add rule</strong> to add a new one.</p>
` },

// ── Bid tree ──────────────────────────────────────────────────────────────────
{ id: 'tree', title: '🌲 Bid tree', html: `
<h3>Reading the tree</h3>
<p>Each row in the tree is a bid node. Here is what the elements mean:</p>

<div class="help-example">
  <span style="font-family:monospace;font-weight:700;color:var(--accent)">1♠</span>&nbsp;
  <em>Natural, 5+ spades</em>&nbsp;
  <span style="font-family:monospace;color:var(--accent)">[10–15]</span>&nbsp;
  <span class="help-badge help-badge-var">Seat 3,4</span>&nbsp;
  <span class="help-badge help-badge-alert">Alert</span>&nbsp;
  <span class="help-badge help-badge-forcing">GF</span>&nbsp;
  <span class="help-badge help-badge-tbd">TBD</span>&nbsp;
  ⬇ ＋ 🗑
</div>

<table class="help-table">
  <thead><tr><th>Element</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td><strong>Call badge</strong></td><td>The bid itself (coloured suit symbols). Shown in parentheses <em>(X)</em> with a yellow background if it is an opponent's call.</td></tr>
    <tr><td><em>Italic text</em></td><td>The bid's description / meaning.</td></tr>
    <tr><td><code>[10–15]</code></td><td>The base HCP range (blue monospace).</td></tr>
    <tr><td><span class="help-badge help-badge-var">Seat 3,4</span></td><td>A <strong>variant badge</strong> — this bid has a condition-specific override for seats 3 &amp; 4 (or NV, or Vul, etc.). The currently-active variant is brighter.</td></tr>
    <tr><td><span class="help-badge help-badge-alert">Alert</span></td><td>The bid requires an alert.</td></tr>
    <tr><td><span class="help-badge help-badge-forcing">GF</span></td><td>Forcing level: <em>GF</em> = game force, <em>1 round</em> = forcing for one round, <em>NF</em> = non-forcing.</td></tr>
    <tr><td><span class="help-badge help-badge-tbd">TBD</span></td><td>Continuations are <em>to be defined</em> — the branch is not yet filled in.</td></tr>
    <tr><td><strong>⬇</strong></td><td>Clone this node down to the next call (e.g. 1♣ → 1♦). See below.</td></tr>
    <tr><td><strong>＋</strong></td><td>Add a child response under this node.</td></tr>
    <tr><td><strong>🗑</strong></td><td>Delete this node (and all its children). Asks for confirmation.</td></tr>
    <tr><td><strong>→ Convention name</strong></td><td>A convention reference — clicking expands the named convention's nodes inline.</td></tr>
  </tbody>
</table>

<h3>Expanding / collapsing</h3>
<p>Click anywhere on a node row (not on a button) to:</p>
<ul>
  <li>Toggle its children open/closed.</li>
  <li>Load the node's details into the right-panel editor form.</li>
</ul>

<h3>⬇ Clone-down (copy to next call)</h3>
<p>The <strong>⬇</strong> button on any suit-bid node duplicates it to the next bid in sequence (e.g. <code>1♣ → 1♦</code>, or <code>2♠ → 2NT</code>). All text fields are automatically updated — suit symbols and letters in descriptions, shapes, and notes are shifted by one step. This is a fast way to build parallel responses.</p>

<div class="help-example">
  <strong>Example:</strong> You have <code>1♣ — 1♥</code> meaning "4+ hearts". Pressing ⬇ on <code>1♥</code> creates <code>1♠ — 4+ spades</code> (suit shifted) with all its children copied and suit-shifted too.
</div>

<h3>Drag-and-drop copy</h3>
<p>You can <strong>drag any bid node</strong> from anywhere in the tree and <strong>drop it onto another bid node</strong> to copy it (and all its children) as a response under the target.</p>
<ul>
  <li>The dragged node turns semi-transparent while dragging.</li>
  <li>The drop target gains a blue highlight outline when you hover over it.</li>
  <li>Dropping creates a <em>deep copy</em> — the original is unchanged.</li>
  <li>You cannot drop a node into one of its own descendants.</li>
</ul>
<div class="help-tip">Drag-and-drop is a copy, not a move. To reorganise, copy then delete the original.</div>

<h3>Copy-to modal</h3>
<p>As an alternative to drag-and-drop, click a node to select it, then use the <strong>Copy to…</strong> button in the editor form. A modal shows the whole tree; click the target node and confirm.</p>
` },

// ── Node editor ───────────────────────────────────────────────────────────────
{ id: 'node-form', title: '📋 Node editor', html: `
<p>When you click a bid node, the right panel shows a form with all its details. Fields are:</p>

<h3>Meaning fields</h3>
<table class="help-table">
  <thead><tr><th>Field</th><th>Usage</th></tr></thead>
  <tbody>
    <tr><td><strong>Description</strong></td><td>Plain-text meaning shown in the tree and all lookups. You can use <code>!s !h !d !c</code> for suit symbols (rendered as ♠ ♥ ♦ ♣).</td></tr>
    <tr><td><strong>HCP min / max</strong></td><td>Point range for the bid. Shown as <code>[min–max]</code> in the tree header.</td></tr>
    <tr><td><strong>Shape</strong></td><td>Distribution description, e.g. <code>5+!s 4+!h</code> or <code>4333</code>.</td></tr>
    <tr><td><strong>Forcing</strong></td><td>Dropdown: None / 1 round / Game force / Non-forcing.</td></tr>
    <tr><td><strong>Alert</strong></td><td>Checkbox — marks the bid as alertable; shows the <span class="help-badge help-badge-alert">Alert</span> tag.</td></tr>
    <tr><td><strong>Announce</strong></td><td>Text announced to opponents (e.g. <em>"15-17"</em> for a strong NT); shown in blue in lookups.</td></tr>
    <tr><td><strong>Notes</strong></td><td>Private notes (exceptions, memory aids). Shown in a smaller muted font.</td></tr>
  </tbody>
</table>

<h3>Continuations section</h3>
<p>Controls how the tree continues after this bid:</p>
<ul>
  <li><strong>Inline nodes</strong> are the children you add with ＋ — they appear as indented child rows.</li>
  <li><strong>→ Add convention ref</strong> — pick a named convention from the dropdown and click Add. Its bids are included as continuations at lookup-time without duplicating them. You can add parameter bindings (e.g. which level a transfer lands on).</li>
  <li>Refs are shown as <em>→ Convention name</em> links beneath the node's children in the tree.</li>
</ul>

<h3>Competitive branches</h3>
<p>Use the <strong>+ Add competitive branch</strong> button to define what happens after an opponent intervenes over this bid:</p>
<ul>
  <li>Choose the intervention type: Double, Redouble, Suit overcall, NT overcall, Any suit, Any double, Any.</li>
  <li>For suit overcalls you can specify a particular level and strain, or leave them "Any".</li>
  <li>Each branch has its own continuation type (inline nodes, convention ref, or TBD).</li>
  <li>The branch with the most specific match wins at lookup time.</li>
</ul>
<div class="help-example">
  <strong>Example:</strong> After <code>1NT</code>, add a competitive branch "After Double" → ref "1NT-Doubled-escapes" convention. Now <code>1N - (X)</code> resolves through that convention instead of the normal responses.
</div>

<h3>Saving</h3>
<p>Click <strong>Save</strong> at the bottom of the form. Changes take effect immediately in the tree and in all lookups.</p>
` },

// ── Variants ──────────────────────────────────────────────────────────────────
{ id: 'variants', title: '🔀 Variants', html: `
<p>A <strong>variant</strong> overrides part of a bid's meaning or continuations when a specific condition is met — for example, 1NT showing 12–14 NV but 15–17 Vul, or a different convention in 3rd/4th seat.</p>

<div class="help-warn">
  <strong>Important:</strong> Conditions refer to the <em>opening position</em> — the seat and vulnerability when the auction started — not the position of whoever made this particular bid. Opener's seat is always "1st" in terms of when the auction began.
</div>

<h3>Adding a variant</h3>
<ol>
  <li>Select the bid node in the tree.</li>
  <li>In the editor form, click <strong>+ Add Variant</strong>.</li>
  <li>Set the condition: <strong>Opening seat</strong> (e.g. <code>3,4</code> for 3rd or 4th seat) and/or <strong>Opening vulnerability</strong>.</li>
  <li>Override any fields you want to change: description, HCP, announce, notes.</li>
  <li>Optionally, override the <strong>continuation</strong>: choose a different convention, or replace the refs.</li>
</ol>

<h3>Variant badge</h3>
<p>The tree shows a small badge for each variant on a node: <span class="help-badge help-badge-var">NV</span> <span class="help-badge help-badge-var">Seat 3,4</span>. When you are viewing the Position tab, the active variant is highlighted brighter and all others are hidden — you only see the relevant bid.</p>

<h3>Variant specificity</h3>
<p>When multiple variants could match, the <em>most specific</em> one wins:</p>
<ul>
  <li>Single seat beats seat range.</li>
  <li>Single vulnerability beats broader range.</li>
  <li>Seat + vulnerability beats seat alone.</li>
</ul>

<h3>Continuation override</h3>
<p>Within a variant you can override the <em>continuations</em> that follow the bid in two ways:</p>
<table class="help-table">
  <thead><tr><th>Option</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td><strong>Replace entire continuation → convention</strong></td><td>All responses come from the named convention; inline child nodes are ignored.</td></tr>
    <tr><td><strong>Replace refs only (keep inline nodes)</strong></td><td>The inline child nodes are kept; only the convention references are replaced.</td></tr>
  </tbody>
</table>

<div class="help-example">
  <strong>Example:</strong> 1NT opening. Base: 15–17 HCP, responses ref "1NT-strong". Variant (NV, seats 3,4): HCP 10–12, responses ref "1NT-weak". When you switch the Position tab to NV / Seat 3, the tree shows 10–12 and uses the weak-NT convention.
</div>
` },

// ── Conventions ───────────────────────────────────────────────────────────────
{ id: 'conventions', title: '📚 Conventions', html: `
<p>Conventions are named sub-trees that can be <em>referenced</em> from multiple points in the system without duplicating data. Any change to the convention is reflected everywhere it is referenced.</p>

<h3>Creating a convention</h3>
<ol>
  <li>In the Edit tab, scroll to the <strong>Conventions</strong> section.</li>
  <li>Click <strong>+ New convention</strong>; give it a name (e.g. "Stayman responses") and an ID (e.g. <code>stayman</code>).</li>
  <li>Add bids inside it the same way you add openings.</li>
</ol>

<h3>Importing from the library</h3>
<p>Click <strong>📚 Library</strong> to browse the built-in convention library. Each entry shows tags and a description. Click <strong>Import</strong> to copy it into your system's local conventions; it is then fully editable.</p>
<p>Available conventions include: Stayman, Blackwood, Gerber, Jacoby 2NT, Jacoby Transfers, Negative Doubles, and more.</p>

<h3>Referencing a convention</h3>
<ol>
  <li>Select the bid node whose continuations you want to delegate.</li>
  <li>In the <strong>Continuations</strong> section of the editor, use <strong>→ Add convention ref</strong>.</li>
  <li>Select the convention from the dropdown and click <strong>Add</strong>.</li>
</ol>
<p>The ref shows as <em>→ Convention name</em> in the tree. In the Lookup tab, the convention's bids appear as continuations automatically.</p>

<h3>Parametric conventions</h3>
<p>Some conventions take parameters — for example, a Jacoby Transfer convention might take a <code>strain</code> parameter to know which suit to transfer into. When you add a ref, parameter input boxes appear. You can also bind a parameter to another parameter of the outer convention (for nesting).</p>

<h3>Editing a convention</h3>
<p>Click the convention's header to expand it. Its bids are edited exactly like opening bids — click to select, use ＋ to add children, ⬇ to clone-down, drag-and-drop to copy.</p>
` },

// ── Position tab ──────────────────────────────────────────────────────────────
{ id: 'position', title: '📍 Position tab', html: `
<p>The Position tab shows your system <em>as it looks from a specific seat and vulnerability</em>. All variant conditions are evaluated and applied silently — you see only the effective bid, with no badge clutter.</p>

<h3>Controls</h3>
<ul>
  <li><strong>Seat</strong> — 1st through 4th.</li>
  <li><strong>Vulnerability</strong> — NV, Vul, Fav (we NV, they Vul), Unfav (we Vul, they NV).</li>
</ul>
<p>The tree updates instantly as you change these.</p>

<h3>Example</h3>
<div class="help-example">
  You play a 1NT showing 15–17 in 1st/2nd seat and 12–14 in 3rd/4th seat. In the Edit tab, both variants show on the 1NT node. In Position tab set to <em>Seat 3</em>, you see only <em>1NT: 12–14</em>.
</div>

<div class="help-tip">Use the Position tab to double-check that your variants are wired correctly before a tournament.</div>
` },

// ── Lookup tab ────────────────────────────────────────────────────────────────
{ id: 'lookup', title: '🔍 Lookup tab', html: `
<p>Type a bidding sequence to see the resolved meaning of each step and the available continuations.</p>

<h3>Sequence syntax</h3>
<ul>
  <li>Separate calls with <code> - </code> (space-dash-space, or just a dash).</li>
  <li>Your bids: <code>1C</code>, <code>2H</code>, <code>3N</code>, <code>P</code>, <code>X</code>, <code>XX</code>.</li>
  <li>Opponent bids: wrap in parentheses: <code>(2S)</code>, <code>(X)</code>, <code>(P)</code>.</li>
</ul>

<h3>Examples</h3>
<pre>1C - 1H - 1N           Opener's 1♣, responder's 1♥, opener rebids 1NT
1H - (2S) - X          1♥ opening, overcall of 2♠, negative double
2C - 2D - 2H - 3N      Precision 2♣ relay sequence</pre>

<h3>Output</h3>
<p>The table shows each bid in the sequence with its resolved meaning (description, HCP, shape, forcing status, announcements, alerts). Below that is a list of all <em>next available bids</em> — these are the continuations defined for the final bid of the sequence, resolved for the current seat/vul.</p>

<h3>Seat and vulnerability</h3>
<p>Use the <strong>Seat</strong> and <strong>Vulnerability</strong> dropdowns at the top of the tab to change the resolution context. This affects which variant is applied to each bid in the sequence.</p>

<div class="help-tip">The lookup updates as you type — no need to press Enter (though you can).</div>
` },

// ── Print tab ─────────────────────────────────────────────────────────────────
{ id: 'print', title: '🖨 Print tab', html: `
<p>Generate a formatted document from your system for printing or saving as PDF.</p>

<h3>Formats</h3>
<table class="help-table">
  <thead><tr><th>Format</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>System Booklet (A4)</strong></td><td>A detailed multi-page document with all openings, conventions, overcalls, and carding rules. Best for a complete reference.</td></tr>
    <tr><td><strong>ACBL Convention Card</strong></td><td>The standard ACBL 2-sided card layout (US format).</td></tr>
    <tr><td><strong>EBU Convention Card (A4)</strong></td><td>English Bridge Union A4 layout.</td></tr>
    <tr><td><strong>WBF System Card (A4 landscape)</strong></td><td>World Bridge Federation card, A4 landscape.</td></tr>
  </tbody>
</table>

<h3>How to print / save as PDF</h3>
<ol>
  <li>Choose a format from the dropdown.</li>
  <li>The preview updates in the iframe below.</li>
  <li>Click <strong>🖨 Print / Save as PDF</strong>.</li>
  <li>In the browser print dialog, choose <em>Save as PDF</em> (or your printer).</li>
</ol>
<div class="help-tip">For ACBL / EBU / WBF cards, set the browser print margins to "None" for the best fit.</div>
` },

// ── AI Chat ───────────────────────────────────────────────────────────────────
{ id: 'chat', title: '🤖 AI Chat', html: `
<p>The AI Chat tab connects to Anthropic Claude with your system JSON automatically attached as context. Claude can read the whole system and — with your permission — edit it directly.</p>

<h3>Setting up</h3>
<ol>
  <li>Click <strong>⚙ Settings</strong> in the chat header.</li>
  <li>Paste your <strong>Anthropic API key</strong> (starts with <code>sk-ant-</code>).</li>
  <li>Choose a model (default: Claude 3.5 Sonnet). Claude 3.5 Haiku is faster and cheaper for quick questions. Extended thinking models (e.g. <code>claude-3-7-sonnet-20250219</code>) reason more deeply but are slower.</li>
  <li>Click <strong>Save</strong>.</li>
</ol>
<div class="help-warn">Your API key is stored only in your browser's localStorage — it is never sent to any server other than Anthropic's.</div>

<h3>What you can ask</h3>
<ul>
  <li><em>"Explain how the 1♣ opening works in this system."</em></li>
  <li><em>"What does opener rebid after 1♣ - 1♥ - ?"</em></li>
  <li><em>"Add a Drury convention after a 3rd-seat 1♠ opening."</em></li>
  <li><em>"The 1NT responses look incomplete — fill in the relay structure."</em></li>
  <li><em>"Change 2♣ to show 11–15 HCP instead of 11–13."</em></li>
</ul>

<h3>How edits work</h3>
<p>Claude has access to an <code>update_system</code> tool. When it wants to make a change, it calls this tool with a patch. The app applies the patch and saves. You can see the updated tree in the right panel immediately.</p>
<p>The full system JSON is sent with every message — Claude always has up-to-date context. For large systems (200+ nodes) responses may be slower.</p>

<h3>Live tree panel</h3>
<p>The right half of the Chat tab shows the current system tree in read-only mode. It refreshes after every AI-applied change so you can see what was modified.</p>

<h3>Tips</h3>
<ul>
  <li>Be specific about seat/vulnerability when asking about range differences (e.g. "in 3rd seat NV").</li>
  <li>If Claude makes a wrong change, just ask it to undo or correct it — it can read the current state and fix it.</li>
  <li>Chat history is reset each time you switch to a different system.</li>
</ul>
` },

// ── Auction simulator ─────────────────────────────────────────────────────────
{ id: 'auction', title: '🃏 Auction tab', html: `
<p>The Auction tab deals two random hands for North and South and drives a full auction using Claude, guided by your system.</p>

<h3>Controls</h3>
<table class="help-table">
  <thead><tr><th>Control</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><strong>North seat</strong></td><td>Whether North is in 1st or 2nd seat (affects 3rd/4th seat variants for South if North passes).</td></tr>
    <tr><td><strong>Vulnerability</strong></td><td>NV / Vul / Fav / Unfav — passed to the resolver so seat/vul variants are applied correctly.</td></tr>
    <tr><td><strong>🎲 New deal &amp; bid</strong></td><td>Deal fresh hands and run the auction from scratch.</td></tr>
    <tr><td><strong>↺ Re-bid</strong></td><td>Re-run the auction on the <em>same hands</em> — useful for seeing how small system changes affect the auction.</td></tr>
  </tbody>
</table>

<h3>How the auction runs</h3>
<ol>
  <li>North and South are dealt 13 cards each (East and West always pass silently).</li>
  <li>North bids first. Claude receives North's hand, the resolved meanings of all available bids at this point, and the auction so far.</li>
  <li>Claude chooses the best bid from the system list (or uses bridge judgment if the system tree runs out).</li>
  <li>South responds, and so on, until three consecutive passes after a real bid, or four passes to open.</li>
</ol>

<h3>3rd/4th seat handling</h3>
<p>If North passes and South has yet to bid, South is treated as opening in <em>3rd seat</em> (if North was 1st) or <em>4th seat</em> (if North was 2nd). The full openings list is shown to Claude, resolved for the correct seat. Claude is told it is "Opener (partner passed — in 3rd seat)".</p>

<h3>Reading the results</h3>
<p>As the auction runs, three sections fill in progressively:</p>
<ul>
  <li><strong>Auction</strong> — a 4-column bidding box (N / E / S / W). Opponent passes are greyed out.</li>
  <li><strong>Bid meanings</strong> — each of our pair's bids with its resolved description, HCP, shape, and forcing status.</li>
  <li><strong>AI reasoning</strong> — Claude's full reasoning text for each of our bids. Click a row to expand it.</li>
</ul>

<h3>Bridge judgment mode</h3>
<p>If the auction reaches a point where the system tree has no defined continuations (no non-pass bids), Claude switches to free "bridge judgment" mode and can choose any legal call. These bids are marked <em>(bridge judgment)</em> in the meanings table.</p>

<h3>Card display</h3>
<p>The left panel shows both hands as card fans — four rows of playing cards, one per suit, highest card on the left. The hand summary (shape, HCP, balanced/unbalanced) is shown above each hand.</p>

<h3>Requirements</h3>
<p>The Auction tab uses the same AI provider as AI Chat. Sign in to use the shared Gemini AI, or set your own API key in <strong>AI Chat → ⚙ Settings</strong>.</p>
` },

// ── Data format ───────────────────────────────────────────────────────────────
{ id: 'data-format', title: '⚙ Data format', html: `
<p>Systems are stored as <code>.bridge.json</code> files. Understanding the format helps when importing, bulk-editing, or writing conventions by hand.</p>

<h3>Top-level structure</h3>
<pre>{
  "id":          "uuid",
  "name":        "Pascal",
  "description": "2/1 based system",
  "openings":    [ /* bid nodes */ ],
  "overcalls":   [ /* bid nodes with openerBid */ ],
  "conventions": { "stayman": { "name": "Stayman", "nodes": [] } },
  "carding":     { "opening-lead": [], "signals": [], "discards": [] }
}</pre>

<h3>Bid node</h3>
<pre>{
  "id":   "uuid",
  "call": { "type": "bid", "level": 1, "strain": "C" },
  "meaning": {
    "description": "Natural, 3+ clubs",
    "hcp":     [11, 21],
    "shape":   "3+!c",
    "forcing": "1 round",
    "alert":   true,
    "announce": "15-17"
  },
  "variants":    [ /* Variant objects */ ],
  "competitive": [ /* CompetitiveBranch objects */ ],
  "continuations": {
    "type": "nodes",
    "nodes": [ /* child bid nodes */ ],
    "refs":  [ { "conventionId": "stayman" } ]
  }
}</pre>

<h3>Call types</h3>
<table class="help-table">
  <thead><tr><th>JSON</th><th>Bid</th></tr></thead>
  <tbody>
    <tr><td><code>{ "type": "bid", "level": 1, "strain": "C" }</code></td><td>1♣</td></tr>
    <tr><td><code>{ "type": "pass" }</code></td><td>Pass</td></tr>
    <tr><td><code>{ "type": "double" }</code></td><td>Double (X)</td></tr>
    <tr><td><code>{ "type": "redouble" }</code></td><td>Redouble (XX)</td></tr>
  </tbody>
</table>
<p>Strains: <code>C</code> ♣ · <code>D</code> ♦ · <code>H</code> ♥ · <code>S</code> ♠ · <code>N</code> NT.</p>

<h3>Variant object</h3>
<pre>{
  "condition": { "seats": [3, 4], "vul": ["nv"] },
  "meaningOverride": { "hcp": [10, 12], "description": "Weak NT" },
  "notes": "System off in 3rd seat NV"
}</pre>
<p>All fields in <code>meaningOverride</code> are optional. Omitted fields fall back to the base meaning.</p>

<h3>Opponent-call nodes</h3>
<p>When a node has <code>"isOpponentCall": true</code>, it represents an opponent's intervention (shown in yellow in the tree). Add a child node with <code>"isOpponentCall": true</code> using <code>(X)</code> syntax in the Add Bid modal.</p>

<h3>Text markup</h3>
<p>In any description, shape, or notes field, use <code>!s !h !d !c</code> to insert ♠ ♥ ♦ ♣. These are rendered as coloured suit symbols in the tree, Position view, and Lookup results.</p>
` },

]; // end SECTIONS
