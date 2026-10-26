# Budget Decks: groups with their own rules

Status: **proposal, not built**. This document specifies how Budget Decks would
support several playgroups (starting with **Cambridge**, the current group, and
**London**), each with its own budget rules, validity period and admins. It
also covers decks moving between groups and London-style sideboard swaps.

## 1. Goals

- One site and one sign-in, with any number of groups. Each group has its own
  rules, admins and deck list, so each group's metagame is shown separately.
- Rules vary per group in every respect we know of today, and in ones we can
  imagine: split budgets (Cambridge and London), a combined main + side budget
  (Value Vintage), validity length, format, card counts, free basics, privacy,
  and whether sideboard swaps are allowed.
- A player can see which decks from other groups are valid in a group they're
  visiting, and can **port** an eligible deck into that group without
  re-pricing it.
- Groups that allow it support **sideboard swaps**: a new sideboard is priced
  on its own, and the main deck keeps its original pricing and validity.

All groups use the same price source as today: the Budget Deckbuilder's daily
TCGplayer Mid data, cheapest printing, in USD. A different price source is out
of scope (see §10).

## 2. Concepts

| Term | Meaning |
|---|---|
| **Group** | A playgroup with a rule set, e.g. `cambridge`, `london`. |
| **Listing** | One row in `mtg_submissions`: a specific 75 that is valid in one group for a window of time. |
| **Validity anchor** | `valid_from`: the date a listing's validity window counts from. |
| **Pricing basis** | The totals and dates a listing was priced at. Main and side can now have different dates (see sideboard swaps). |
| **Verified basis** | Main-deck totals that *we* priced on the anchor date. False for admin imports, whose stored totals are from the import day, not the approval date. |
| **Eligible** | A listing from group A satisfies group B's rules on its pricing basis (§5). |
| **Port** | Create a listing in group B from an eligible listing in group A. |
| **Sideboard swap** | Create a new listing in the same group with the same main deck, a newly priced sideboard, and the same validity window. |

## 3. Rules per group

Today's single-row `mtg_settings` becomes one row per group in `mtg_groups`.

| Column | Type | Notes | Cambridge | London |
|---|---|---|---|---|
| `id` | uuid pk | | | |
| `slug` | text unique | used in the URL (`?g=london`), `[a-z0-9-]` | `cambridge` | `london` |
| `name` | text | display name | Cambridge | London |
| `budget_main` | numeric, **nullable** | main-deck cap; null = no cap | 25 | 25 |
| `budget_side` | numeric, **nullable** | sideboard cap; null = no cap | 7.50 | 10 |
| `budget_total` | numeric, **nullable** | main + side cap; null = no cap | — | — |
| `format` | text | as today | modern | modern |
| `validity_months` | int | | 6 | 12 |
| `min_main`, `max_side` | int | | 60 / 15 | 60 / 15 |
| `free_basics` | text: `none` \| `basic` \| `basic_and_snow` | `basic` = today's rule (snow-covered basics are paid) | basic | basic |
| `sideboard_swaps` | boolean | §7 | false | true |
| `private_by_default` | boolean | as today, per group | (current value) | false |
| `created_at`, `updated_at`, `updated_by` | | | | |

**Every cap that is set is enforced.** So:
- Cambridge and London set main and side caps.
- Value Vintage would set only `budget_total`.
- A group could set all three.

At least one cap must be set (enforced with a check constraint).

`free_basics` needs a small change to `isFreeBasic` in `deck.js`, which becomes
a function of the group setting.

## 4. Data model changes

### New tables

```sql
mtg_groups        -- §3
mtg_group_admins (group_id uuid → mtg_groups, user_id uuid → auth.users, added_at, pk(group_id, user_id))
```

`mtg_admins` stays, as **overall admins**. They can:
- create groups and edit any group;
- appoint and remove group admins;
- do anything a group admin can do, in any group.

Group admins manage only their own group:
- its settings and its admins;
- imports, publishing, hiding, publish-all, deleting and colour recomputes, all
  within that group.

### `mtg_submissions` gains

| Column | Purpose |
|---|---|
| `group_id uuid not null → mtg_groups` | owning group |
| `main_hash text not null` | SHA-256 of the sorted main deck only; identifies "same main" for swaps |
| `main_price_date timestamptz` | price-data time for `main_total` (replaces `price_date`, which becomes the alias for back-compat) |
| `side_price_date timestamptz` | price-data time for `side_total`; differs from the main date after a swap |
| `basis_verified boolean not null` | main totals were priced by us on the validity anchor date. False for imports, and inherited through ports and swaps |
| `ported_from uuid → mtg_submissions` | source listing of a port |
| `swapped_from uuid → mtg_submissions` | source listing of a sideboard swap |
| `budget_total numeric` | combined cap it was validated under (alongside the existing `budget_main`/`budget_side`) |

`budget_main` and `budget_side` become nullable to match the group caps.

### Migration (one SQL script, safe to re-run)

1. Back up the `mtg_*` tables, as already done once (a REST export to JSON).
2. Create `mtg_groups` and insert `cambridge` from the current `mtg_settings`
   row, with `free_basics = 'basic'` and `sideboard_swaps = false`.
3. Add the new `mtg_submissions` columns and backfill:
   - `group_id` = cambridge;
   - `main_hash` (computed by an admin "recompute" action in the edge function,
     the same pattern as recolour);
   - `main_price_date` and `side_price_date` = `price_date`;
   - `basis_verified = not imported`.
   Then make `group_id` not null.
4. Copy the current `mtg_admins` into `mtg_group_admins` for cambridge. They also
   stay overall admins.
5. Keep `mtg_settings` read-only for one release, then drop it.

## 5. Eligibility (the core rule)

Listing **L** (from any group) is **eligible in group B today** when all of the
following hold:

1. L is currently valid in its own group (`L.valid_until >= today`) and is
   visible to the viewer (privacy rules unchanged).
2. `L.format = B.format`. Re-checking legality in another format is out of
   scope (§10).
3. The card counts satisfy B: `L.main_count >= B.min_main` and `L.side_count <= B.max_side`.
4. On L's pricing basis, every cap B sets is met. If L was priced under
   different free-basics rules from B's, its stored per-card prices in `cards`
   are re-summed under B's rule (no network access needed). This needs `cards`
   to store each basic's real price plus a "counted as free" flag. Today a free
   basic is stored as `unit = 0`, so for existing listings, when the free-basics
   rules differ and B charges for basics L got free, L is **not eligible**.
   Cambridge and London share the same rule, so this doesn't affect them.
   The caps:
   - `main_total(B) <= B.budget_main`
   - `side_total(B) <= B.budget_side`
   - `main_total(B) + side_total(B) <= B.budget_total`
5. `L.valid_from + B.validity_months >= today`. That is, B's window, counted
   from L's anchor, hasn't ended.
6. `L.basis_verified` is true, **or** the viewer is an admin of B (see §6).

The eligible window in B is `L.valid_from` to `L.valid_from + B.validity_months`.

**Example:** a Cambridge deck priced at $24.80 / $7.40 on 1 June 2026:
- valid in Cambridge until 1 Dec 2026;
- eligible in London ($25 / $10, 12 months) until 1 June 2027, however its
  price has moved since.

Implement this once, as a pure function `eligibility(listing, group) →
{ eligible, until, reasons[] }` in `deck.js`. The server function uses it for
porting, and the page uses it for the "valid here" view. The page has all the
data it needs from the listings and groups it has already loaded.

## 6. Porting

- **Who:** the listing's submitter, or an admin of the target group.
- **When:** the listing is eligible in the target group (§5). It's automatic,
  with no approval step: groups don't approve in-budget decks today either.
  The target group's admins can hide or delete a ported deck like any other.
- **What it creates:** a new listing in the target group that copies the deck
  (link, cards, hashes, colours, featured card, pricing basis and
  `basis_verified`), with:
  - `valid_from` = source `valid_from`; `valid_until` = `valid_from + target.validity_months`;
  - the budgets recorded are the **target group's** caps;
  - `ported_from` = source id; submitter = the source's submitter;
  - `is_public` = the target group's `private_by_default` rule.
- **Duplicates:** if the target group already has a valid listing of the same
  75 that the porter can see, porting is refused and the existing one is
  linked instead.
- **Imported listings** (`basis_verified = false`) can't be ported by their
  owner. Their stored totals don't show they were within budget on the
  approval date. An admin of the target group can port them, vouching for them
  as they did for the original import.
- **Not re-priced.** A deck that is over budget today can still be ported if it
  was within the target's caps when it was priced. That's the point of porting.

## 7. Sideboard swaps (groups with `sideboard_swaps = true`)

A swap creates a **new listing**, and the original stays as it is and still
valid. Swapping never extends validity: only re-pricing the main deck does that.

- **Who:** the listing's submitter, or a group admin.
- **Input:** a new builder link, decklist or ManaBox link, as for a normal
  submission, plus the source listing id.
- **Checks:**
  1. the source listing is currently valid in its group, and that group allows swaps;
  2. the new main deck is identical to the source's (`main_hash` match);
  3. the new sideboard is priced **today** and meets `budget_side`, and also
     `budget_total`, using the *stored* main total plus today's side total;
  4. the side count is no more than `max_side`; legality is checked for the new sideboard cards.
- **Creates:** a listing with:
  - main pricing copied from the source (`main_total`, `main_price_date`,
    `basis_verified`) and side pricing from today (`side_total`, `side_price_date = now`);
  - **the same `valid_from` / `valid_until` as the source**;
  - `swapped_from` = source id, and new `deck_hash` / `link` / `cards.side`;
  - `imported` copied from the source. This works for imported decks too:
    validity is fixed by the source and only the sideboard is being priced now.
- **Duplicates:** if that exact 75 already has a valid listing in the group, the
  swap is refused and that listing is linked instead.
- **Refreshing a swapped listing** re-prices the whole 75 today and gives a new
  window, exactly like refreshing any listing.
- **Display:** the swapped listing shows "sideboard swap of ‹source deck›". The
  list can collapse a source and its swaps into one row with a "3 sideboards"
  indicator. That's optional in the first version.

## 8. Pages and user flows

- **Group selection:** `…/budget-decks/?g=london`. With no `g`, the site shows the
  last group used (`localStorage`), or else Cambridge. A switcher in the header
  lists the groups.
- **Header:** the group's rules, e.g.
  `London · $25 main · $10 side · Modern · valid 12 months · sideboard swaps allowed`.
  A combined cap shows as `$X total`.
- **Deck list:** the group's own listings by default (its meta). A toggle,
  **"Include decks valid here from other groups"**, adds eligible listings from
  other groups (§5), each with a badge for its origin group and its eligible-until
  date. Eligible decks show a **Port here** button for their owner, or for a
  target-group admin.
- **Submit:** submits to the current group.
  - **Check only** reports the result against **every** group at once, e.g.
    "Cambridge ✓ until 26 Apr · London ✓ until 26 Oct · Value Vintage ✗ total
    $34.10 > $30". The deck is priced once, so this is cheap.
  - **Submit** creates a listing in the current group only.
- **My decks:** listings across all groups, grouped by group, with:
  - Refresh (as today);
  - **Port to…** for each group the listing is eligible in;
  - **Swap sideboard** where the group allows it;
  - Publish, under the existing privacy rules.
- **Admin panel:** scoped to the current group: its settings, admins,
  publish-all and maintenance. Overall admins also get **Groups**: create a
  group, rename it, appoint its first admin.

## 9. Server and database changes

### `mtg-submit` edge function

- All requests take `group` (a slug). Settings come from `mtg_groups`, and
  admin checks become "admin of this group, or overall admin".
- `dryRun` with no group returns per-group results (§8).
- New actions:
  - `action: 'port', sourceId, group`: §6.
  - `action: 'swap', sourceId, link | decklist`: §7.
- Duplicate and refresh matching becomes per-group (still restricted to
  listings the caller can see).
- `recolor` and `rehash` (backfills `main_hash`) are admin maintenance actions.

### SQL

- RLS on `mtg_submissions`: read is `is_public OR own OR admin of its group`;
  delete is group admin. Insert and update stay service-role only.
- `mtg_groups`: anyone can read; group admins can update their own group;
  overall admins can insert.
- `mtg_group_admins`: anyone can read; group admins and overall admins can
  insert and delete in their group.
- `mtg_set_public` and `mtg_publish_all` take a group and check group admin
  rights. Publishing stays one-way for non-admins.
- `is_mtg_admin()` gains `is_mtg_group_admin(group_id)`, which is also true for
  overall admins.

### `deck.js`

- `findProblems(main, side, group)` handles nullable caps and `budget_total`.
- `isFreeBasic(name, freeBasics)`.
- `mainHash(rows)`, alongside `deckHash`.
- `eligibility(listing, group)`, as described in §5.

## 10. Out of scope, and open questions

- **Different price sources or currencies per group** (Cardmarket, TCGplayer
  Market, GBP). That would need our own daily price build and our own deck
  view, because the builder only shows TCG Mid. Not needed for London.
- **Porting across formats.** Eligibility requires the same format. Supporting
  different formats would mean re-checking legality in the target format,
  and deciding whether to use today's banlist or the one on the pricing date.
- **Bans after pricing.** A deck that is eligible and ported keeps its listing
  even if a card has since been banned. This is the same as today's behaviour
  within a group.
- **Swap lineage display.** Does the list collapse a deck and its sideboard
  variants into one row, or show them separately? Proposed: separate in the
  first version, collapsing later.
- **Group-specific notes or links.** For example, a link to the group's event
  page. This is a free-text `about` column, which is trivial to add.

## 11. Delivery plan

Each stage is usable on its own:

1. **Groups:** `mtg_groups` / `mtg_group_admins`, the migration, per-group
   settings, caps, `free_basics`, the URL and switcher, per-group admin panel,
   and RLS. London can start immediately with its own list and rules.
2. **Cross-group:** `eligibility()`, the "valid here" toggle, **Port**, and
   **Check only** against all groups.
3. **Sideboard swaps:** `main_hash` backfill, the swap action and UI, and
   lineage display.

## 12. Testing

- **Unit-style checks of `eligibility()` in the browser test harness**:
  - split, total and mixed caps;
  - a free-basics mismatch between groups;
  - boundary dates;
  - an imported (`basis_verified = false`) listing;
  - a format mismatch.
- **Swap checks**:
  - same main with a new side that fits;
  - the side over its cap;
  - the total cap exceeded by stored main plus new side;
  - a different main (rejected);
  - a swap of an imported deck;
  - a swap that duplicates an existing 75.
- **RLS probes with the publishable key**, as done for the current release:
  - anonymous users and non-admins can't write anything;
  - a London admin can't change Cambridge settings or delete Cambridge decks;
  - private decks stay invisible across groups.
- **Mocked page tests** for the switcher, the toggle and the Port and Swap
  buttons, as done for private decks.
