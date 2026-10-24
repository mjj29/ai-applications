# Budget Decks — context for future work

Public registry of Magic decklists validated against a budget (default $25 main /
$7.50 side, Modern, valid 6 months; all admin-configurable). Decks are built in
Toskicologist's [Budget Deckbuilder](https://toskicologist.github.io/MTG-draft-sets-infographics/budgetdeckbuilder.html);
we store their share links and link back out rather than rendering decks here.

## Pieces

| File | Role |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | The page: deck list (public), submit form (signed in), admin panel |
| `js/supabase.js`, `js/config.js` | Supabase client, auth, table access, call to the edge function |
| `supabase/functions/mtg-submit/deck.js` | Decodes share links and prices decks. Plain JS so the browser test page can import it too |
| `supabase/functions/mtg-submit/index.ts` | Edge function: auth, settings, validity dates, duplicate check, insert |
| `mtg-setup.sql` | Tables `mtg_settings` (one row), `mtg_admins`, `mtg_submissions`, plus RLS |
| `test/deck-test.html` | Manual harness: price a link with `deck.js` in the browser |

## Rules

- **Trust:** the totals inside a share link (`x.mt`/`x.sd`) are plain base64 JSON and
  can be edited, so they're ignored. The edge function re-prices every deck.
  Only the service role writes `mtg_submissions`. The public can read it, and
  admins can delete from it.
- **Pricing** is ported from the builder and uses its daily data
  (`price-data` branch via jsDelivr: `tcg-prices.json`, `cards-index.json`, `data-meta.json`):
  - Each card's price is its cheapest printing: the lower of the non-foil and foil
    TCGplayer Mid across every printing.
  - Cards the index doesn't know about fall back to a Scryfall prints search.
  - **Differs from the builder:** snow-covered basics are *not* free. The builder
    counts them as basics.
  - Budgets, format and options stored in the link are ignored. Ours apply.
- **Share links:** v2 links encode cards as `#tcgplayerId` or `*SET CN` tokens,
  which are decoded through a reverse index. Tokens the index doesn't contain are
  looked up on Scryfall. `#c=` confirmation links are rejected.
- **Pasted decklists** (`decklist: {main, side}` in the request) are turned into a
  v1 builder link (plain text, no tokens) by `buildShareLink`, carrying our
  budgets/format and any name found in the text, then checked exactly like a
  pasted link. The builder opens these links as-is.
- **ManaBox links** (`manabox.app/decks/<id>`): the edge function fetches the page
  (no CORS, so server-side only) and reads the deck from the `<astro-island>`
  props (Astro `[type, value]` serialization; `parseManaBoxPage` in deck.js).
  Board categories: 0–2 commander/oathbreaker/signature spell and 3 main → main
  deck, 4 → sideboard, 5 maybeboard → ignored. It's then handled like a pasted
  decklist and the *builder* link is stored. ManaBox's `editDate` stands in for
  the export date for admin imports. ManaBox's displayed TCGplayer prices are
  lower than TCG Mid, so its totals don't match ours. This relies on ManaBox's
  page structure, which may change.
- **Private lists:** `mtg_settings.private_by_default` makes new submissions
  `is_public = false`. RLS lets a row be read only if it's public, it's yours, or
  you're an admin, so a private deck's existence and contents are hidden from
  everyone else. Changing visibility goes through `mtg_set_public`: owners can
  publish their own deck, and can hide it again only while the setting is on;
  admins can do either. `mtg_publish_all` lets admins publish everything (e.g.
  after an event). Duplicate/refresh matching only considers listings the
  submitter can see, so submitting the same 75 as someone's private deck makes
  a separate listing rather than revealing or refreshing theirs. Turning the
  setting on or off doesn't change existing decks.
- **Validity:** a deck that is legal and within budget on the day it is submitted
  is valid from that day for `validity_months`, clamped to month end. It stays
  valid even if prices rise later.
- **Admin import:** an admin enters an approved-on date, or uses the date the link was exported (`x.t` in the link; editable by whoever made it, so admin-only). The budget, legality and
  unpriced checks are skipped, validity runs from that date, and the deck is
  flagged `imported`.
- **Same 75:** `deck_hash` is the SHA-256 of the sorted, lower-cased
  `qty name` lines for main and side.
  - Resubmitting a deck that is still valid and passes today refreshes the
    existing entry (new window from today, totals re-priced, `refresh_count`
    bumped) rather than adding a row. Submitters can do this in one click from
    "My decks" (`refreshId` in the request).
  - Once that entry expires, the deck can be submitted again and gets a new row.
    Old rows are kept as history.
- **Colours:** `deckColours` in deck.js, from main-deck mana costs (hybrid only adds a colour the deck can't already pay; Phyrexian ignored; colours no land/mana source makes are dropped; any-colour sources ignored). Card data from
  Scryfall `/cards/collection`, looked up by front-face name.
- **Featured card:** the priciest non-land card, with its Scryfall art crop.
- **Key cards:** the most-played non-land cards.

## Not done (possible follow-ups)

- There is no 4-copy-limit check, matching the builder.
- Admins can only delete submissions, not edit them.
