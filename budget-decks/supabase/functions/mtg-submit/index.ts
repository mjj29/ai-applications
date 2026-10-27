/**
 * mtg-submit — Supabase Edge Function
 *
 * Validates a Budget Deckbuilder share link against today's prices and the
 * admin-configured rules, and (if it passes) records it in mtg_submissions.
 * This is the only writer of that table: it uses the service role, so users
 * can't insert decks the server hasn't priced itself.
 *
 * POST /functions/v1/mtg-submit
 * Body: { link?: string,             // a builder share link or manabox.app/decks/… link, or
 *         decklist?: { main, side? }, // pasted decklist text (built into a share link), or
 *         refreshId?: uuid,          // re-check one of your listed decks and bump its validity
 *         deckName?: string, dryRun?: boolean,
 *         approvedOn?: 'YYYY-MM-DD' | 'link',  // admins only: import a past approval
 *         notes?: string }                     //   (skips budget/legality); 'link' = the link's export date
 *
 * Submitting the same 75 as a still-valid listing refreshes that listing
 * (new validity window from today) instead of adding a second one.
 * dryRun just checks the deck and needs no login; saving needs a signed-in user.
 *
 * Deploy (from the budget-decks folder):
 *   supabase functions deploy mtg-submit --no-verify-jwt --project-ref nltiszypgoidzsgsqjdi
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analyseLink, buildShareLink, describeDeck, fetchManaBoxDeck, isManaBoxLink, storedDeckHash, DeckError } from './deck.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const rejected = (text: string, kind = 'link', extra = {}) =>
  json({ status: 'rejected', problems: [{ kind, text }], ...extra });

// Problems an admin import may override (it was approved under the prices of the day).
const IMPORT_OVERRIDABLE = new Set(['budget', 'legality', 'unpriced']);

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** YYYY-MM-DD plus n months, clamped to the end of the month (31 Aug + 6 → 28/29 Feb). */
function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  let body: { link?: string; decklist?: { main?: string; side?: string }; refreshId?: string;
              deckName?: string; dryRun?: boolean; approvedOn?: string; notes?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const pasted = !body.link && body.decklist && String(body.decklist.main ?? '').trim();
  if (!body.link && !pasted && !body.refreshId && !body.action)
    return json({ error: 'Paste a share link or a decklist first.' }, 400);
  if (pasted && String(body.decklist!.main ?? '').length + String(body.decklist!.side ?? '').length > 20000)
    return json({ error: 'That decklist is too long.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = todayUTC();

  // ── Who is asking ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if ((!body.dryRun || body.refreshId) && !user) return json({ error: 'Please sign in to submit a deck.' }, 401);

  let isAdmin = false;
  if (user) {
    const { data } = await admin.from('mtg_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    isAdmin = !!data;
  }
  // ── Admin: recompute colours and deck fingerprints of every listing
  //    (after a change to deckColours or to how card names are matched)
  if (body.action === 'recolor') {
    if (!isAdmin) return json({ error: 'Only admins can recompute colours.' }, 403);
    const { data: rows, error } = await admin.from('mtg_submissions').select('id, deck_name, colors, deck_hash, cards');
    if (error) return json({ error: error.message }, 500);
    const changed = [];
    let rehashed = 0;
    for (const r of rows ?? []) {
      const main = (r.cards?.main ?? []).map(([qty, name, unit]: [number, string, number | null]) =>
        ({ qty, name, unit, found: true }));
      const d = await describeDeck(main).catch(() => null);
      await new Promise(s => setTimeout(s, 100));            // Scryfall rate limit
      const hash = await storedDeckHash(r.cards).catch(() => r.deck_hash);
      const update: Record<string, string> = {};
      if (d && d.colors !== r.colors) update.colors = d.colors;
      if (hash !== r.deck_hash) update.deck_hash = hash;
      if (!Object.keys(update).length) continue;
      await admin.from('mtg_submissions').update(update).eq('id', r.id);
      if (update.colors !== undefined) changed.push({ deck_name: r.deck_name, from: r.colors, to: d!.colors });
      if (update.deck_hash) rehashed++;
    }
    return json({ status: 'recolored', checked: rows?.length ?? 0, changed, rehashed });
  }

  const importing = !!body.approvedOn && !body.refreshId;
  if (importing && !isAdmin) return json({ error: 'Only admins can import past approvals.' }, 403);

  const { data: settings, error: setErr } = await admin.from('mtg_settings').select('*').eq('id', 1).single();
  if (setErr || !settings) return json({ error: 'Settings missing — has mtg-setup.sql been run?' }, 500);

  // ── Refreshing a listed deck: it must be yours (or you're an admin) and still valid
  let target: Record<string, any> | null = null;
  if (body.refreshId) {
    const { data } = await admin.from('mtg_submissions').select('*').eq('id', body.refreshId).maybeSingle();
    if (!data) return json({ error: 'That deck is not in the list.' }, 404);
    if (data.submitted_by !== user!.id && !isAdmin) return json({ error: 'You can only refresh decks you submitted.' }, 403);
    if (data.valid_until < today) return rejected('This listing has expired — submit the link again instead.', 'expired');
    target = data;
  }

  // ── Price it ───────────────────────────────────────────────────────────────
  // A pasted decklist or a ManaBox deck becomes a builder link, then goes
  // through exactly the same check; the builder link is what gets stored.
  let a;
  try {
    let list: { main: string; side: string; name: string; editedAt?: string | null } | null = null;
    if (!target && pasted) list = { main: body.decklist!.main!, side: body.decklist!.side ?? '', name: body.deckName ?? '' };
    if (!target && !pasted && isManaBoxLink(body.link)) {
      const mb = await fetchManaBoxDeck(body.link!);
      list = { main: mb.main, side: mb.side, name: body.deckName || mb.name, editedAt: mb.editedAt };
    }
    const link = target ? target.link : list ? buildShareLink(list, settings) : body.link;
    a = await analyseLink(link, settings);
    if (list) {
      // Carry a name found in the text ("Name …" / title line) into the link the builder opens.
      if (!list.name && a.deckName) a.link = buildShareLink({ ...list, name: a.deckName }, settings);
      // ManaBox's last-edited time stands in for the builder's export time (admin "date from link").
      if (list.editedAt) a.exportedAt = list.editedAt;
    }
  }
  catch (e) {
    if (e instanceof DeckError) return rejected(e.message);
    console.error(e);
    return json({ error: `Could not check the deck: ${(e as Error).message}` }, 502);
  }

  const blocking = a.problems.filter(p => !(importing && IMPORT_OVERRIDABLE.has(p.kind)));
  const warnings = a.problems.filter(p => importing && IMPORT_OVERRIDABLE.has(p.kind));
  const summary = {
    deckName: a.deckName, format: a.format, priceDate: a.priceDate, link: a.link, exportedAt: a.exportedAt,
    main: { total: a.main.total, count: a.main.count, budget: Number(settings.budget_main), rows: a.main.rows },
    side: { total: a.side.total, count: a.side.count, budget: Number(settings.budget_side), rows: a.side.rows },
  };
  if (blocking.length) return json({ status: 'rejected', problems: blocking, warnings, ...summary });

  // ── Dates ──────────────────────────────────────────────────────────────────
  let validFrom = today;
  if (importing) {
    let approved = body.approvedOn!;
    if (approved === 'link') {
      if (!a.exportedAt) return rejected('This link has no export date in it — enter the approval date instead.', 'link', summary);
      approved = a.exportedAt.slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(approved) || isNaN(Date.parse(approved)))
      return json({ error: 'Approved-on date must be YYYY-MM-DD.' }, 400);
    if (approved > today) return json({ error: 'Approved-on date is in the future.' }, 400);
    validFrom = approved;
  }
  const validUntil = addMonths(validFrom, settings.validity_months);
  if (validUntil < today)
    return rejected(`An approval from ${validFrom} would have expired on ${validUntil}.`, 'expired', summary);

  // ── Same 75 already listed and valid? Refresh it rather than duplicate it ──
  // Only match listings this person can see: someone else's private deck must not
  // be revealed (or refreshed) because you happen to submit the same 75.
  let existing = target;
  if (!existing) {
    let q = admin.from('mtg_submissions').select('*')
      .eq('deck_hash', a.hash).gte('valid_until', today);
    if (!isAdmin) q = user ? q.or(`is_public.eq.true,submitted_by.eq.${user.id}`) : q.eq('is_public', true);
    const { data } = await q.order('valid_until', { ascending: false }).limit(1).maybeSingle();
    existing = data;
  }
  const result = { validFrom, validUntil, warnings, ...summary };

  if (existing) {
    const pick = ({ id, deck_name, submitter_name, valid_from, valid_until }: Record<string, any>) =>
      ({ id, deck_name, submitter_name, valid_from, valid_until });
    if (validUntil <= existing.valid_until)
      return json({ status: 'duplicate', existing: pick(existing), ...result });
    if (body.dryRun) return json({ status: 'ok', dryRun: true, wouldRefresh: pick(existing), ...result });
    const { data: saved, error: updErr } = await admin.from('mtg_submissions').update({
      valid_from:    validFrom,
      valid_until:   validUntil,
      main_total:    a.main.total,
      side_total:    a.side.total,
      budget_main:   settings.budget_main,
      budget_side:   settings.budget_side,
      format:        a.format,
      price_date:    a.priceDate,
      refreshed_at:  new Date().toISOString(),
      refresh_count: (existing.refresh_count ?? 0) + 1,
    }).eq('id', existing.id).select().single();
    if (updErr) { console.error(updErr); return json({ error: `Could not save: ${updErr.message}` }, 500); }
    return json({ status: 'refreshed', submission: saved, previousUntil: existing.valid_until, ...result });
  }

  if (body.dryRun) return json({ status: 'ok', dryRun: true, ...result });

  // ── Save a new listing ─────────────────────────────────────────────────────
  const d = await describeDeck(a.main.rows).catch(() => ({ colors: '', featured: null, keyCards: [] }));
  const meta = user!.user_metadata ?? {};
  const row = {
    submitted_by:   user!.id,
    submitter_name: meta.full_name ?? meta.name ?? meta.preferred_username ?? 'Anonymous',
    deck_name:      String(body.deckName ?? '').trim().slice(0, 80) || a.deckName || null,
    link:           a.link,
    deck_hash:      a.hash,
    colors:         d.colors,
    featured:       d.featured,
    key_cards:      d.keyCards,
    cards: {
      main: a.main.rows.map(r => [r.qty, r.name, r.unit]),
      side: a.side.rows.map(r => [r.qty, r.name, r.unit]),
    },
    main_count:  a.main.count,
    side_count:  a.side.count,
    main_total:  a.main.total,
    side_total:  a.side.total,
    budget_main: settings.budget_main,
    budget_side: settings.budget_side,
    format:      a.format,
    price_date:  a.priceDate,
    valid_from:  validFrom,
    valid_until: validUntil,
    imported:    importing,
    is_public:   !settings.private_by_default,
    notes:       body.notes ? String(body.notes).slice(0, 500) : null,
  };
  const { data: saved, error: insErr } = await admin.from('mtg_submissions').insert(row).select().single();
  if (insErr) { console.error(insErr); return json({ error: `Could not save: ${insErr.message}` }, 500); }
  return json({ status: 'accepted', submission: saved, ...result });
});
