/**
 * mtg-submit — Supabase Edge Function
 *
 * Validates a Budget Deckbuilder share link against today's prices and the
 * admin-configured rules, and (if it passes) records it in mtg_submissions.
 * This is the only writer of that table: it uses the service role, so users
 * can't insert decks the server hasn't priced itself.
 *
 * POST /functions/v1/mtg-submit
 * Body: { link: string, deckName?: string, dryRun?: boolean,
 *         approvedOn?: 'YYYY-MM-DD',   // admins only: import a past approval,
 *         notes?: string }             //   skipping the budget/legality check
 *
 * dryRun just checks the deck and needs no login; saving needs a signed-in user.
 *
 * Deploy (from the budget-decks folder):
 *   supabase functions deploy mtg-submit --no-verify-jwt --project-ref nltiszypgoidzsgsqjdi
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analyseLink, describeDeck, DeckError } from './deck.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

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

  let body: { link?: string; deckName?: string; dryRun?: boolean; approvedOn?: string; notes?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (!body.link) return json({ error: 'Paste a share link first.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── Who is asking ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!body.dryRun && !user) return json({ error: 'Please sign in to submit a deck.' }, 401);

  let isAdmin = false;
  if (user) {
    const { data } = await admin.from('mtg_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    isAdmin = !!data;
  }
  const importing = !!body.approvedOn;
  if (importing && !isAdmin) return json({ error: 'Only admins can import past approvals.' }, 403);

  const { data: settings, error: setErr } = await admin.from('mtg_settings').select('*').eq('id', 1).single();
  if (setErr || !settings) return json({ error: 'Settings missing — has mtg-setup.sql been run?' }, 500);

  // ── Price it ───────────────────────────────────────────────────────────────
  let a;
  try { a = await analyseLink(body.link, settings); }
  catch (e) {
    if (e instanceof DeckError) return json({ status: 'rejected', problems: [{ kind: 'link', text: e.message }] });
    console.error(e);
    return json({ error: `Could not check the deck: ${(e as Error).message}` }, 502);
  }

  const blocking = a.problems.filter(p => !(importing && IMPORT_OVERRIDABLE.has(p.kind)));
  const warnings = a.problems.filter(p => importing && IMPORT_OVERRIDABLE.has(p.kind));
  const summary = {
    deckName: a.deckName, format: a.format, priceDate: a.priceDate, link: a.link,
    main: { total: a.main.total, count: a.main.count, budget: Number(settings.budget_main), rows: a.main.rows },
    side: { total: a.side.total, count: a.side.count, budget: Number(settings.budget_side), rows: a.side.rows },
  };
  if (blocking.length) return json({ status: 'rejected', problems: blocking, warnings, ...summary });

  // ── Dates ──────────────────────────────────────────────────────────────────
  const today = todayUTC();
  let validFrom = today;
  if (importing) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.approvedOn!) || isNaN(Date.parse(body.approvedOn!)))
      return json({ error: 'Approved-on date must be YYYY-MM-DD.' }, 400);
    if (body.approvedOn! > today) return json({ error: 'Approved-on date is in the future.' }, 400);
    validFrom = body.approvedOn!;
  }
  const validUntil = addMonths(validFrom, settings.validity_months);
  if (validUntil < today)
    return json({ status: 'rejected', problems: [{ kind: 'expired', text: `An approval from ${validFrom} would have expired on ${validUntil}.` }], ...summary });

  // ── Already listed? ────────────────────────────────────────────────────────
  const { data: existing } = await admin.from('mtg_submissions')
    .select('id, deck_name, submitter_name, valid_from, valid_until')
    .eq('deck_hash', a.hash).gte('valid_until', today)
    .order('valid_until', { ascending: false }).limit(1).maybeSingle();
  if (existing) return json({ status: 'duplicate', existing, warnings, ...summary });

  if (body.dryRun) return json({ status: 'ok', dryRun: true, validFrom, validUntil, warnings, ...summary });

  // ── Save ───────────────────────────────────────────────────────────────────
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
    notes:       body.notes ? String(body.notes).slice(0, 500) : null,
  };
  const { data: saved, error: insErr } = await admin.from('mtg_submissions').insert(row).select().single();
  if (insErr) { console.error(insErr); return json({ error: `Could not save: ${insErr.message}` }, 500); }
  return json({ status: 'accepted', submission: saved, warnings, ...summary });
});
