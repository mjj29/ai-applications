/**
 * ai-proxy — Supabase Edge Function
 *
 * Proxies AI requests to Anthropic or Gemini using server-side secrets.
 * Deployed with --no-verify-jwt so the Supabase gateway does not pre-validate
 * the JWT; this function validates it itself via supabase.auth.getUser().
 * That avoids gateway "invalid JWT" rejections for valid user access tokens.
 *
 * POST /functions/v1/ai-proxy
 * Body: { provider: 'anthropic'|'gemini', model: string, body: object }
 *
 * Set secrets via Supabase CLI:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase secrets set GEMINI_API_KEY=AIza...
 *
 * Or via the Supabase Dashboard → Project Settings → Edge Functions → Secrets.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  // Pre-flight
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  // ── Auth: require a valid Supabase JWT ─────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  // ── Parse request ──────────────────────────────────────────────────────────
  let payload: { provider?: string; model?: string; body?: unknown };
  try { payload = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400, headers: CORS }); }

  const { provider = 'anthropic', body: apiBody } = payload;
  if (!apiBody) return new Response('Missing body', { status: 400, headers: CORS });

  // ── Route to provider ──────────────────────────────────────────────────────
  if (provider === 'anthropic') {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return new Response(JSON.stringify({ error: 'Anthropic key not configured on server' }),
      { status: 503, headers: { ...CORS, 'content-type': 'application/json' } });

    // Force non-streaming — SSE piped through an edge function gets buffered by the
    // Supabase infrastructure and the body arrives empty on the client.
    const body = Object.assign({}, apiBody as Record<string, unknown>, { stream: false });
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':        'application/json',
        'x-api-key':           key,
        'anthropic-version':   '2023-06-01',
        ...(payload.model && /claude-3-7|claude-opus-4|claude-sonnet-4/i.test(payload.model)
          ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await upstream.json().catch(() => ({}));
    return new Response(JSON.stringify(result), {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  if (provider === 'gemini') {
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return new Response(JSON.stringify({ error: 'Gemini key not configured on server' }),
      { status: 503, headers: { ...CORS, 'content-type': 'application/json' } });

    const model = payload.model ?? 'gemini-2.0-flash';
    // Use generateContent (non-streaming) — SSE piped through an edge function gets
    // buffered by the Supabase infrastructure and the body arrives empty on the client.
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${
      encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(apiBody),
    });
    const result = await upstream.json().catch(() => ({}));
    return new Response(JSON.stringify(result), {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }),
    { status: 400, headers: { ...CORS, 'content-type': 'application/json' } });
});
