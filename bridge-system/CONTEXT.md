# Bridge System Editor — Project Context

> This file is intended to bring a new agent up to speed without requiring the full conversation history.
> Last updated: 2026-03-07

---

## What This Project Is

A single-page web application for bridge players to write down, manage, and view their bidding system conventions. It runs entirely in the browser (no backend yet), using `localStorage` for persistence. The UI is pure JavaScript ES modules — no build step, no framework.

The app is served from `index.html` and can be previewed with `python3 -m http.server <port>` from the project root.

---

## Key Design Decisions (settled in conversation)

### 1. The tree structure

Bridge systems form a tree of auction sequences. Each **BidNode** represents a single call (1C, 2H, P, X, XX, etc.) and carries:
- Its **meaning** (description, HCP range, shape, forcing level, alert, announce)
- **Variants** — seat/vulnerability overrides to that meaning and/or its continuations
- **Continuations** — the default (uncontested) sub-tree of responses
- **Competitive branches** — what happens after each type of opponent intervention

### 2. Inheritance / prototype chain

This is the most important design decision. The resolution order is:

```
1. BidNode.continuations               (base, uncontested, any seat/vul)
       ↓ Variant.continuationDiff/Override patches this
2. Variant-effective continuation      (what competitive branches inherit from)
       ↓ CompetitiveBranch.continuation applies on top
3a. { type: 'inherit', diffs: [...] }  (inherit step 2, then apply diffs)
3b. { type: 'ref', conventionId }      (replace with named convention)
3c. { type: 'nodes', nodes: [...] }    (full inline replacement)
       ↓ Competitive-level variant patches (rare)
4. Final effective continuation
```

This means: a competitive branch writes its diffs once, and automatically inherits from whichever variant is active for the current seat/vul. For example, "after (X)" inherits the full NT structure in seats 1–2, but inherits the "system off" version in seat 3 NV, without duplicating anything.

### 3. Shared sub-trees (Conventions)

A **Convention** is a named, reusable sub-tree. Example: the NT response structure (Stayman, transfers, etc.) is defined once as a Convention and referenced via `{ type: 'ref', conventionId: 'nt-structure' }` from both the 1NT opening and any 1NT overcall. Editing the Convention updates all references.

Conventions are stored in `system.conventions` (a `Record<string, Convention>`).

### 4. Competitive branching — three categories

Opponent interventions are typed:
```
'pass' | 'double' (with nature: 'to'|'pen'|'?') | 'redouble' |
'suit' (with level, strain, nature: 'nat'|'art') | 'notrump' (with level) |
'any-suit' | 'any-double' | 'any'
```

Priority when matching: **exact bid > any-suit/any-double > any**.

A natural suit overcall (`nature: 'nat'`) and an artificial bid (`nature: 'art'`) are separate branches because the double of each has different meaning (TO vs showing the suit).

Unlisted competitive positions should display as **"undocumented"** in the UI — not silently inherited — so the user knows what they haven't written down.

### 5. Vulnerability

Relative to the partnership: `'nv' | 'vul' | 'fav' | 'unfav'`
- `fav` = we are NV, they are Vul (favourable)
- `unfav` = we are Vul, they are NV (unfavourable)

### 6. Seat-specific openings

The same opening bid may have different meaning by seat (e.g. 1NT = 9–11 seats 1–2 NV, 14–16 seats 1–2 Vul, 9–15 seat 3 NV, 12–15 seat 3 Vul or seat 4 always). This is handled by `Variant[]` on the BidNode, not by separate system definitions.

Full-tree variation (e.g. playing natural in 4th seat after 1NT opening) is handled by `continuationOverride` on the variant — an escape hatch that replaces the whole continuation rather than diffing it.

### 7. Input and display

- Internal representation: ASCII — `C D H S N` for strains, `P X XX` for pass/double/redouble
- Keyboard input: user types `1C`, `2H`, `3N`, `X`, `XX`, `P`
- Display: rendered as `1♣ 2♥ 3NT X XX P` with suit symbols coloured (red for ♥♦, white for ♣♠)
- Sequences with opponent bids use parentheses: `1C - (2H) - X`

### 8. Rendering model

The resolver returns a **ResolutionTrace** alongside the resolved nodes. Each node carries a `status`: `'inherited' | 'overridden' | 'added' | 'removed'`.

Rendering rules:
- **Single bid / full response table**: show all resolved nodes; badge by status. Added = ✦, overridden = old meaning struck through, removed = greyed out.
- **Tree view (parent already shown)**: show only nodes where status ≠ 'inherited' — just the diff relative to what's above. Link back: "all other bids as uncontested".
- **System booklet**: flatten to fully resolved nodes, suppress trace, show notes inline.

---

## Complete Data Model

```typescript
type Suit     = 'C' | 'D' | 'H' | 'S';
type Level    = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Seat     = 1 | 2 | 3 | 4;
type Vul      = 'nv' | 'vul' | 'fav' | 'unfav';

type Call =
  | { type: 'bid';      level: Level; strain: Suit | 'N' }
  | { type: 'pass' }
  | { type: 'double' }
  | { type: 'redouble' };

type Intervention =
  | { type: 'pass' }
  | { type: 'double';    nature: 'to' | 'pen' | '?' }
  | { type: 'redouble' }
  | { type: 'suit';      level: Level; strain: Suit; nature: 'nat' | 'art' }
  | { type: 'notrump';   level: Level }
  | { type: 'any-suit' }
  | { type: 'any-double' }
  | { type: 'any' };

type Meaning = {
  description: string;
  hcp?:     [number?, number?];   // [min, max]
  shape?:   string;               // e.g. "5+H", "balanced", "4-4 minors"
  forcing?: 'gf' | '1r' | 'inv' | 'passable' | 'relay' | 'to-sign-off';
  alert?:   boolean;
  announce?: string;              // text to announce, e.g. "15-17"
  notes?:   string;
};

type Condition = {
  seats?: Seat[];    // absent = any seat
  vul?:   Vul[];    // absent = any vulnerability
};

type BidNodeDiff =
  | { op: 'add';      node: BidNode }
  | { op: 'override'; call: Call; meaning?: Partial<Meaning>; continuations?: Continuation }
  | { op: 'remove';   call: Call }
  | { op: 'note';     text: string };

type Continuation =
  | { type: 'nodes';   nodes: BidNode[] }
  | { type: 'ref';     conventionId: string; notes?: string }
  | { type: 'inherit'; diffs: BidNodeDiff[] }   // competitive only: inherit parent + apply diffs
  | { type: 'tbd' }
  | { type: 'end' };

type Variant = {
  condition:             Condition;
  meaningOverride?:      Partial<Meaning>;
  continuationDiff?:     BidNodeDiff[];       // patches base continuation
  continuationOverride?: Continuation;        // full replacement (escape hatch)
  notes?:                string;
};

type CompetitiveBranch = {
  after:         Intervention;
  notes?:        string;          // e.g. "system off", "negative doubles to 3S"
  continuation:  Continuation;
  variants?:     {
    condition:             Condition;
    continuationDiff?:     BidNodeDiff[];
    continuationOverride?: Continuation;
    notes?:                string;
  }[];
};

type BidNode = {
  id:            string;         // crypto.randomUUID()
  call:          Call;
  meaning?:      Meaning;
  variants?:     Variant[];
  continuations: Continuation;   // uncontested / default
  competitive?:  CompetitiveBranch[];
};

type Convention = {
  id:          string;
  name:        string;
  description: string;
  tags?:       string[];         // "stayman", "transfers", "defence", etc.
  source?:     string;           // "SAYC", "Precision", etc.
  nodes:       BidNode[];        // the responses/continuations
};

type System = {
  id:       string;
  name:     string;
  metadata: {
    authors:  string[];
    notes:    string;
    modified: string;       // ISO date string
    format:   'v1';
  };
  conventions: Record<string, Convention>;
  openings:    BidNode[];   // root: all opening bids
};
```

---

## File Structure

```
bridge-system/
├── index.html          # App shell, all panels and modals inline
├── css/
│   └── style.css       # Dark theme; suit symbol colours; all component styles
└── js/
    ├── model.js        # Types, factories, callToHTML(), callToString(), parseCall(), parseSequence()
    ├── store.js        # localStorage CRUD for Systems and Convention library; import/export JSON
    ├── resolver.js     # Resolution engine: variant matching, intervention priority, diff application
    ├── editor.js       # Edit panel: tree with add/edit/delete nodes, variant modal
    ├── viewer.js       # View panel: resolved tree with context-aware meaning and response tables
    ├── app.js          # Navigation, context bar (seat+vul), systems list, modal init
    └── ui.js           # flash() helper, shared UI utilities
```

---

## What Works Right Now

- **Systems list**: create, open, delete, export as JSON, import from JSON
- **Editor**: 
  - Add opening bids by typing call strings (`1C`, `2H`, `3N`, `P`, `X`, `XX`)
  - Add responses/continuations down the tree (the `＋` button on each node)
  - Edit description, HCP range, shape, forcing, alert, announce, notes on any node
  - Set continuation type: TBD / End / Inline responses / Convention reference
  - Add seat+vul variants (meaning overrides: HCP range, announce, description)
  - Delete nodes (with children)
- **Viewer**:
  - Read-only tree, collapsible nodes
  - Clicking a node shows full detail panel (resolved meaning, HCP, shape, forcing, variants list, response table, competitive branches)
  - Response table shows inherited/overridden/added/removed status per row
  - Competitive branch buttons show detail for that intervention context
- **Context bar**: seat (1–4) and vulnerability (NV/Vul/Fav/Unfav) pickers; changing these re-resolves the whole viewer tree
- **Resolution engine**: full variant specificity scoring, intervention priority (exact > any-suit/any-double > any), diff application, trace output

---

## What Is NOT Yet Built (priority order)

### 1. Competitive branch editor (HIGH)
The viewer shows competitive branches and you can click them to see the resolved responses, but **there is no UI to create or edit competitive branches**. In `editor.js`, `showEditCompetitive()` just shows a flash message "coming soon".

Needed:
- Modal or inline form to add a `CompetitiveBranch` to a node: pick intervention type (double/suit/NT/etc.), set notes, set continuation type (inherit/nodes/ref)
- If `type: 'inherit'`, a diff editor: list the inherited nodes (greyed out) with buttons to add/override/remove specific calls, plus a free-text note field
- Wire into `renderTree()` so competitive branches show under each node

### 2. Convention library editor (HIGH)
Conventions (shared sub-trees like NT responses, Stayman, transfers) are referenced but cannot be created or edited yet.

Needed:
- Conventions panel (new nav tab or within editor)
- Create/edit/delete conventions by ID and name
- A convention is just a list of BidNodes — reuse the same node editor
- When editing a node's continuations and type = 'ref', show a picker for existing convention IDs
- Pre-loaded built-in conventions (see below)

### 3. Sequence lookup (MEDIUM)
"What does 1C–1H–1NT mean?" view.

Needed:
- Input box accepting a sequence string: `1C - 1H - 1N` or `1C - (2H) - X`
- `parseSequence()` already exists in `model.js` and returns `[{ call } | { intervention }]` steps
- Walk the system tree following the sequence, resolving variants at each step for the current context
- Display the final node's full detail (meaning, continuations, etc.)
- If path not found, show where it diverged

### 4. Pre-loaded common conventions (MEDIUM)
A library of importable convention definitions. Should be a static JSON file `conventions/library.json` that gets loaded on first run.

Suggested initial entries:
- `stayman` — 2♣ Stayman after 1NT (including responses 2♦/2♥/2♠, with invitational and GF continuations)
- `red-transfers` — 2♦→♥, 2♥→♠ Jacoby transfers after 1NT  
- `minor-stayman` — 2♠ minor suit Stayman after 1NT
- `texas-transfers` — 4♦→♥, 4♥→♠
- `fourth-suit-forcing` — generic FSF marker
- `lebensohl` — after 1NT and (2x) overcall

### 5. System booklet view (MEDIUM)
A printable/readable full system document.

Needed:
- New panel "Booklet" 
- Renders the whole tree flattened into sections, one section per opening bid
- Each section shows the full resolved response table (no trace, just meaning)
- Competitive sections indented under each opening
- `window.print()` button with print-specific CSS (white background, no sidebar)

### 6. Convention card export (LOW — deferred by user)
ACBL, WBF, EBU formats. The user said don't worry about this for now.

---

## Storage Schema (localStorage keys)

| Key | Value |
|-----|-------|
| `bridge:systems` | `JSON.stringify(System[])` — array of all systems |
| `bridge:active` | string — ID of the active system |
| `bridge:conventions` | `JSON.stringify(Convention[])` — user's convention library |

---

## Resolver API

```javascript
import { resolve } from './js/resolver.js';

const result = resolve(node, ctx, system.conventions);
// ctx = { seat: 1|2|3|4, vul: 'nv'|'vul'|'fav'|'unfav', intervention?: Intervention }

// result = {
//   meaning: Meaning,              // fully resolved (base + variant overrides)
//   nodes: ResolvedNode[],         // array of { node, status, origin, replaces? }
//   notes: string[],               // collected from all applied layers
//   trace: {
//     appliedVariant: Variant|null,
//     appliedBranch: CompetitiveBranch|null,
//   },
//   ref: string|null,              // convention ID if continuation is a ref
// }
```

`ResolvedNode.status` values: `'inherited' | 'overridden' | 'added' | 'removed'`

---

## Known Issues / TODOs in Existing Code

1. **`editor.js` `showEditCompetitive()`** — stub only, shows a flash message
2. **Convention ref picker** — when cont type = 'ref', the field is a free-text input; should be a dropdown of known convention IDs
3. **Variant `continuationDiff` editor** — currently only `meaningOverride` fields are exposed in the add-variant modal. `continuationDiff` and `continuationOverride` are in the data model and resolver but not yet editable in the UI
4. **Competitive variant layer** — `CompetitiveBranch.variants[]` is in the model and resolver but not in the UI
5. **`parseSequence()` in `model.js`** — implemented but not yet wired to any view
6. **Tree node ordering** — ✅ FIXED: `sortNodes()` in `model.js` sorts by P < X < XX < 1C < 1D < 1H < 1S < 1N < 2C … applied everywhere
7. **`viewer.js` `buildViewNode()` resolved node rendering** — ✅ FIXED: viewer tree now uses `sortNodes(resolved.nodes…)` for children

---

## Style Notes

- Dark theme, deep navy palette. CSS variables defined in `:root` in `style.css`.
- Suit symbols: ♣ `color: var(--club)` (white), ♦ `color: var(--diamond)` (red), ♥ `color: var(--heart)` (red), ♠ `color: var(--spade)` (white), NT `color: var(--accent)` (blue)
- All components use the same CSS classes: `.bid-node`, `.bid-node-header`, `.call-badge`, `.tag`, `.variant-item`, `.resolved-table`, etc.
- No external dependencies — zero npm, zero bundler. Pure ES modules loaded directly by the browser.

---

## How to Run

```bash
cd /home/matj/work/ai-applications/bridge-system
python3 -m http.server 7432
# open http://localhost:7432
```
