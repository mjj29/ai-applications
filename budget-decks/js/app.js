/**
 * app.js — Budget Decks UI: public deck list, submission, admin panel.
 */
'use strict';

import {
  signIn, signOut, getUser, onAuthChange,
  loadSettings, saveSettings, loadSubmissions, deleteSubmission,
  isAdmin, listAdmins, addAdmin, removeAdmin, submitDeck, setPublic, publishAll,
} from './supabase.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => n == null ? '—' : '$' + Number(n).toFixed(2);
const todayUTC = () => new Date().toISOString().slice(0, 10);
const fmtDate = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const daysUntil = ymd => Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(todayUTC() + 'T00:00:00Z')) / 86400000);
const pip = c => `<img class="pip" src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}" title="${c}">`;
const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];

const state = {
  user: null, admin: false, settings: null, decks: [],
  colorFilter: new Set(),
};

// ─── Flash ────────────────────────────────────────────────────────────────────

let flashTimer;
function flash(msg, kind = 'ok') {
  const el = $('flash');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = ''; }, 4000);
}

// ─── Auth bar ─────────────────────────────────────────────────────────────────

async function refreshUser() {
  state.user = await getUser();
  state.admin = await isAdmin(state.user?.id).catch(() => false);
  renderAuthBar();
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !state.admin));
  $('btn-submit').disabled = !state.user;
  $('signin-hint').classList.toggle('hidden', !!state.user);
  if (state.admin) { renderSettingsForm(); renderAdmins(); }
  renderDecks();
}

function renderAuthBar() {
  const bar = $('auth-bar');
  if (!state.user) {
    bar.innerHTML = `
      <span class="muted">Sign in:</span>
      <button class="btn btn-sm" data-provider="google">Google</button>
      <button class="btn btn-sm" data-provider="github">GitHub</button>`;
    bar.querySelectorAll('[data-provider]').forEach(b => b.addEventListener('click', async () => {
      try { await signIn(b.dataset.provider); } catch (e) { flash(`Sign-in failed: ${e.message}`, 'err'); }
    }));
    return;
  }
  const m = state.user.user_metadata ?? {};
  const name = m.full_name ?? m.name ?? m.preferred_username ?? state.user.email;
  bar.innerHTML = `
    <span class="auth-user">
      ${m.avatar_url ? `<img class="auth-avatar" src="${esc(m.avatar_url)}" alt="">` : ''}
      <span>${esc(name)}</span>${state.admin ? ' <span class="badge">admin</span>' : ''}
    </span>
    <button class="btn btn-sm" id="btn-signout">Sign out</button>`;
  $('btn-signout').addEventListener('click', async () => {
    await signOut().catch(e => flash(e.message, 'err'));
    // Don't rely on onAuthChange alone with the no-op lock.
    await refreshUser();
  });
}

// ─── Rules / settings ─────────────────────────────────────────────────────────

function renderRules() {
  const s = state.settings;
  if (!s) return;
  $('rules').textContent =
    `${money(s.budget_main)} main · ${money(s.budget_side)} side · ${s.format[0].toUpperCase()}${s.format.slice(1)} · valid ${s.validity_months} months` +
    (s.private_by_default ? ' · new decks private until published' : '');
  document.querySelectorAll('.validity-months').forEach(el => { el.textContent = s.validity_months; });
}

function renderSettingsForm() {
  const s = state.settings;
  if (!s) return;
  $('s-bm').value = s.budget_main; $('s-bs').value = s.budget_side; $('s-fmt').value = s.format;
  $('s-vm').value = s.validity_months; $('s-min').value = s.min_main; $('s-max').value = s.max_side;
  $('s-private').checked = !!s.private_by_default;
}

$('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    state.settings = await saveSettings({
      budget_main: Number($('s-bm').value), budget_side: Number($('s-bs').value), format: $('s-fmt').value,
      validity_months: Number($('s-vm').value), min_main: Number($('s-min').value), max_side: Number($('s-max').value),
      private_by_default: $('s-private').checked,
    });
    renderRules();
    flash('Settings saved');
  } catch (err) { flash(`Could not save: ${err.message}`, 'err'); }
});

async function renderAdmins() {
  const ul = $('admins');
  try {
    const admins = await listAdmins();
    ul.innerHTML = admins.map(a => `
      <li>${esc(a.display_name || a.email || a.user_id)} ${a.email ? `<span class="muted">${esc(a.email)}</span>` : ''}
        ${a.user_id === state.user?.id ? '<span class="muted">(you)</span>' :
          `<button class="btn btn-sm btn-danger" data-remove="${esc(a.user_id)}">Remove</button>`}</li>`).join('');
    ul.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this admin?')) return;
      try { await removeAdmin(b.dataset.remove); renderAdmins(); }
      catch (err) { flash(err.message, 'err'); }
    }));
  } catch (err) { ul.innerHTML = `<li class="err">${esc(err.message)}</li>`; }
}

$('admin-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await addAdmin($('a-email').value); $('a-email').value = ''; renderAdmins(); flash('Admin added'); }
  catch (err) { flash(err.message, 'err'); }
});

$('btn-recolor').addEventListener('click', async () => {
  const btn = $('btn-recolor');
  btn.disabled = true;
  btn.textContent = 'Recomputing…';
  try {
    const res = await submitDeck({ action: 'recolor' });
    const parts = [];
    if (res.changed.length)
      parts.push(`colours updated on ${res.changed.length}: ` + res.changed.map(c => `${c.deck_name || 'untitled'} ${c.from || 'C'}→${c.to || 'C'}`).join(', '));
    if (res.rehashed) parts.push(`fingerprints updated on ${res.rehashed}`);
    flash(parts.length ? `Checked ${res.checked} decks — ${parts.join('; ')}` : `All ${res.checked} decks already correct`);
    await refreshDecks();
  } catch (err) { flash(err.message, 'err'); }
  btn.disabled = false;
  btn.textContent = 'Recompute colours & fingerprints';
});

// ─── Submit ───────────────────────────────────────────────────────────────────

$('f-import').addEventListener('change', () => {
  $('import-detail').classList.toggle('hidden', !$('f-import').checked);
});
const importWhen = () => document.querySelector('[name=f-when]:checked')?.value ?? 'link';
document.querySelectorAll('[name=f-when]').forEach(r => r.addEventListener('change', () => {
  $('f-date').disabled = importWhen() !== 'date';
}));

const submitMode = () => document.querySelector('[name=f-mode]:checked')?.value ?? 'link';
document.querySelectorAll('[name=f-mode]').forEach(r => r.addEventListener('change', () => {
  const list = submitMode() === 'list';
  $('f-link').classList.toggle('hidden', list);
  $('list-fields').classList.toggle('hidden', !list);
}));

async function send(dryRun) {
  const importing = state.admin && $('f-import').checked;
  const fromLink = importWhen() === 'link';
  const pasting = submitMode() === 'list';
  if (pasting ? !$('f-main').value.trim() : !$('f-link').value.trim()) {
    flash(pasting ? 'Paste a decklist first' : 'Paste a share link first', 'err'); return;
  }
  if (importing && !fromLink && !$('f-date').value) { flash('Choose the date it was approved on', 'err'); return; }
  if (importing && fromLink && pasting) { flash('A pasted decklist has no export date — choose the approval date', 'err'); return; }
  const box = $('result');
  box.className = 'result pending';
  box.innerHTML = 'Checking against today\'s prices…';
  $('btn-check').disabled = $('btn-submit').disabled = true;
  try {
    const res = await submitDeck({
      link: pasting ? undefined : $('f-link').value.trim(),
      decklist: pasting ? { main: $('f-main').value, side: $('f-side').value } : undefined,
      deckName: $('f-name').value.trim() || undefined,
      dryRun,
      approvedOn: importing ? (fromLink ? 'link' : $('f-date').value) : undefined,
      notes: importing ? $('f-notes').value.trim() || undefined : undefined,
    });
    renderResult($('result'), res);
    if (res.status === 'accepted' || res.status === 'refreshed') {
      $('submit-form').reset();
      $('import-detail').classList.add('hidden');
      $('f-link').classList.remove('hidden');
      $('list-fields').classList.add('hidden');
      await refreshDecks();
    }
  } catch (err) {
    box.className = 'result bad';
    box.textContent = err.message;
  } finally {
    $('btn-check').disabled = false;
    $('btn-submit').disabled = !state.user;
  }
}

$('btn-check').addEventListener('click', () => send(true));
$('submit-form').addEventListener('submit', e => { e.preventDefault(); send(false); });

function boardSummary(label, b) {
  if (!b) return '';
  const over = b.total > b.budget;
  return `<div class="board"><b>${label}</b> ${b.count} cards ·
    <span class="${over ? 'over' : 'under'}">${money(b.total)}</span> of ${money(b.budget)}</div>`;
}

function cardTable(rows) {
  if (!rows?.length) return '';
  return `<table class="cards"><tbody>${rows.map(r => `
    <tr class="${r.legal && r.legal !== 'legal' ? 'illegal' : ''}">
      <td class="num">${r.qty}</td><td>${esc(r.name)}</td>
      <td class="muted">${r.free ? 'basic' : r.set ? esc(r.set) + (r.foil ? ' foil' : '') : ''}</td>
      <td class="num">${r.free ? '$0' : money(r.unit)}</td><td class="num">${money(r.lineT)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function renderResult(box, res) {
  const list = (items, cls) => items?.length ? `<ul class="${cls}">${items.map(p => `<li>${esc(p.text)}</li>`).join('')}</ul>` : '';
  const heads = {
    accepted:  ['ok',   `Accepted — valid until ${res.submission ? fmtDate(res.submission.valid_until) : ''}.` +
                        (res.submission?.is_public === false ? ' It\'s private: only you and the admins can see it until you publish it (under My decks).' : '')],
    refreshed: ['ok',   `Refreshed${res.submission?.deck_name ? ` “${esc(res.submission.deck_name)}”` : ''} — now valid until ${res.submission ? fmtDate(res.submission.valid_until) : ''}` +
                        (res.previousUntil ? ` (was ${fmtDate(res.previousUntil)}).` : '.')],
    ok:        ['ok',   res.wouldRefresh
                        ? `Passes. It's already listed${res.wouldRefresh.deck_name ? ` as “${esc(res.wouldRefresh.deck_name)}”` : ''}; submitting would extend it from ${fmtDate(res.wouldRefresh.valid_until)} to ${fmtDate(res.validUntil)}.`
                        : `Passes. If submitted now it would be valid until ${res.validUntil ? fmtDate(res.validUntil) : ''}.`],
    duplicate: ['warn', res.existing ? `This exact 75 is already listed${res.existing.deck_name ? ` as “${esc(res.existing.deck_name)}”` : ''}, valid until ${fmtDate(res.existing.valid_until)} — nothing to extend yet.` : 'Already listed.'],
    rejected:  ['bad',  'Not accepted:'],
  };
  const [cls, head] = heads[res.status] ?? ['bad', esc(res.status)];
  const priced = res.priceDate ? `<p class="muted">Priced with data from ${new Date(res.priceDate).toLocaleString()} · ${esc(res.format ?? '')}</p>` : '';
  box.className = `result ${cls}`;
  box.innerHTML = `
    <p><b>${head}</b></p>
    ${list(res.problems, 'problems')}
    ${res.warnings?.length ? `<p class="muted">Overridden for import:</p>${list(res.warnings, 'warnings')}` : ''}
    ${boardSummary('Main', res.main)}${boardSummary('Sideboard', res.side)}
    ${priced}
    ${res.link ? `<p><a href="${esc(res.link)}" target="_blank" rel="noopener">Open in the Budget Deckbuilder</a></p>` : ''}
    ${res.main ? `<details><summary>Card prices</summary>
      <h4>Main</h4>${cardTable(res.main.rows)}<h4>Sideboard</h4>${cardTable(res.side.rows)}</details>` : ''}`;
}

// ─── Deck list ────────────────────────────────────────────────────────────────

async function refreshDecks() {
  try { state.decks = await loadSubmissions(); }
  catch (err) { $('decks').innerHTML = `<p class="err">Could not load decks: ${esc(err.message)}</p>`; return; }
  renderDecks();
}

function renderColorFilter() {
  const el = $('color-filter');
  el.innerHTML = COLORS.map(c =>
    `<button type="button" class="pipbtn${state.colorFilter.has(c) ? ' on' : ''}" data-c="${c}">${pip(c)}</button>`).join('');
  el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.c;
    state.colorFilter.has(c) ? state.colorFilter.delete(c) : state.colorFilter.add(c);
    renderColorFilter(); renderDecks();
  }));
}

function matches(d, q) {
  if (!q) return true;
  const hay = [d.deck_name, d.submitter_name, d.notes, ...(d.cards?.main ?? []).map(c => c[1]), ...(d.cards?.side ?? []).map(c => c[1])]
    .join('\n').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function renderDecks() {
  const today = todayUTC();
  const showExpired = $('show-expired').checked;
  const q = $('q').value.trim().toLowerCase();
  const want = state.colorFilter;
  let decks = state.decks.filter(d =>
    (showExpired || d.valid_until >= today) &&
    [...want].every(c => c === 'C' ? d.colors === '' : d.colors.includes(c)) &&
    matches(d, q));

  const sorts = {
    expiry:   (a, b) => b.valid_until.localeCompare(a.valid_until),
    newest:   (a, b) => b.created_at.localeCompare(a.created_at),
    cheapest: (a, b) => (Number(a.main_total) + Number(a.side_total)) - (Number(b.main_total) + Number(b.side_total)),
    name:     (a, b) => (a.deck_name || '').localeCompare(b.deck_name || ''),
  };
  decks.sort(sorts[$('sort').value]);

  renderMine(today);
  const live = state.decks.filter(d => d.valid_until >= today).length;
  const hidden = state.decks.filter(d => d.is_public === false).length;
  $('count').textContent = `${live} currently valid${state.decks.length > live ? ` · ${state.decks.length - live} expired` : ''}` +
    (hidden ? ` · ${hidden} private` : '');

  if (!decks.length) {
    $('decks').innerHTML = `<p class="muted">${state.decks.length ? 'No decks match.' : 'No decks submitted yet.'}</p>`;
    return;
  }
  $('decks').innerHTML = decks.map(d => deckCard(d, today)).join('');
  bindVisibility($('decks'));
  $('decks').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this submission permanently?')) return;
    try { await deleteSubmission(b.dataset.del); await refreshDecks(); flash('Deleted'); }
    catch (err) { flash(err.message, 'err'); }
  }));
}

function renderMine(today) {
  const mine = state.user ? state.decks.filter(d => d.submitted_by === state.user.id) : [];
  $('mine').classList.toggle('hidden', !mine.length);
  if (!mine.length) return;
  mine.sort((a, b) => b.valid_until.localeCompare(a.valid_until));
  $('mine-list').innerHTML = mine.map(d => {
    const expired = d.valid_until < today;
    return `
      <div class="mine-row${expired ? ' expired' : ''}">
        <span class="pips">${d.colors ? [...d.colors].map(pip).join('') : pip('C')}</span>
        <a href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.deck_name || (d.featured ? `${d.featured.name} deck` : 'Untitled deck'))}</a>
        <span class="muted small">${expired ? 'expired' : 'valid until'} ${fmtDate(d.valid_until)}${d.refreshed_at ? ` · refreshed ${fmtDate(d.refreshed_at.slice(0, 10))}` : ''}</span>
        ${d.is_public !== false ? '' : '<span class="badge warn" title="Only you and the admins can see this deck">private</span>'}
        <span class="mine-actions">
          ${visibilityButton(d)}
          ${expired ? '' : `<button class="btn btn-sm" data-refresh="${esc(d.id)}">Refresh</button>`}
        </span>
        <div class="mine-result hidden" id="mr-${esc(d.id)}"></div>
      </div>`;
  }).join('');
  $('mine-list').querySelectorAll('[data-refresh]').forEach(b => b.addEventListener('click', () => refreshMine(b)));
  bindVisibility($('mine-list'));
}

// Publish / Hide: owners can publish their own decks, one-way; admins can
// publish or hide any deck. The database function mtg_set_public enforces this.
function visibilityButton(d) {
  const mine = state.user && d.submitted_by === state.user.id;
  if (d.is_public === false && (state.admin || mine))
    return `<button class="btn btn-sm" data-vis="${esc(d.id)}" data-pub="1" title="Make this deck visible to everyone">Publish</button>`;
  if (d.is_public !== false && state.admin)
    return `<button class="btn btn-sm" data-vis="${esc(d.id)}" data-pub="0" title="Hide this deck from everyone but its submitter and the admins">Hide</button>`;
  return '';
}

function bindVisibility(root) {
  root.querySelectorAll('[data-vis]').forEach(b => b.addEventListener('click', async () => {
    const pub = b.dataset.pub === '1';
    if (pub && !state.admin && !confirm('Publish this deck? Everyone will be able to see it, and you won’t be able to hide it again.')) return;
    b.disabled = true;
    try { await setPublic(b.dataset.vis, pub); flash(pub ? 'Published' : 'Hidden'); await refreshDecks(); }
    catch (err) { flash(err.message, 'err'); b.disabled = false; }
  }));
}

$('btn-publish-all').addEventListener('click', async () => {
  const n = state.decks.filter(d => d.is_public === false).length;
  if (!n) { flash('There are no hidden decks'); return; }
  if (!confirm(`Publish all ${n} hidden deck${n === 1 ? '' : 's'}? Everyone will be able to see them.`)) return;
  try { const done = await publishAll(); flash(`Published ${done} deck${done === 1 ? '' : 's'}`); await refreshDecks(); }
  catch (err) { flash(err.message, 'err'); }
});

async function refreshMine(btn) {
  const id = btn.dataset.refresh;
  const box = $(`mr-${id}`);
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const res = await submitDeck({ refreshId: id });
    if (res.status === 'refreshed') { flash(`Valid until ${fmtDate(res.submission.valid_until)}`); await refreshDecks(); return; }
    renderResult(box, res);
    box.classList.add('mine-result');
  } catch (err) {
    box.className = 'mine-result result bad';
    box.textContent = err.message;
  }
  btn.disabled = false;
  btn.textContent = 'Refresh';
}

function deckCard(d, today) {
  const expired = d.valid_until < today;
  const left = daysUntil(d.valid_until);
  const status = expired ? `<span class="badge bad">expired ${fmtDate(d.valid_until)}</span>`
    : `<span class="badge ${left <= 30 ? 'warn' : 'ok'}" title="Valid ${fmtDate(d.valid_from)} – ${fmtDate(d.valid_until)}">valid until ${fmtDate(d.valid_until)}</span>`;
  const pips = d.colors ? [...d.colors].map(pip).join('') : pip('C');
  const art = d.featured?.art ? `style="background-image:url('${esc(d.featured.art)}')"` : '';
  const name = d.deck_name || (d.featured ? `${d.featured.name} deck` : 'Untitled deck');
  return `
    <article class="deck${expired ? ' expired' : ''}">
      <a class="art" href="${esc(d.link)}" target="_blank" rel="noopener" ${art} title="${esc(d.featured?.name ?? '')}"></a>
      <div class="body">
        <div class="title">
          <span class="pips">${pips}</span>
          <a href="${esc(d.link)}" target="_blank" rel="noopener">${esc(name)}</a>
          ${d.imported ? '<span class="badge" title="Imported by an admin from an earlier approval">imported</span>' : ''}
          ${d.is_public !== false ? '' : '<span class="badge warn" title="Only the submitter and the admins can see this deck">private</span>'}
        </div>
        <div class="muted small">
          ${esc(d.submitter_name || 'Anonymous')} · ${esc(d.format)} · ${d.main_count}+${d.side_count} cards ·
          ${money(d.main_total)} / ${money(d.side_total)}
          <span title="Budget when validated">(of ${money(d.budget_main)} / ${money(d.budget_side)})</span>
        </div>
        ${d.key_cards?.length ? `<div class="small key">${d.key_cards.map(esc).join(' · ')}</div>` : ''}
        ${d.notes ? `<div class="small muted">${esc(d.notes)}</div>` : ''}
      </div>
      <div class="side">
        ${status}
        <span class="deck-actions">
          ${visibilityButton(d)}
          ${state.admin ? `<button class="btn btn-sm btn-danger" data-del="${esc(d.id)}">Delete</button>` : ''}
        </span>
      </div>
    </article>`;
}

['q', 'sort', 'show-expired'].forEach(id => $(id).addEventListener('input', renderDecks));

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  renderColorFilter();
  loadSettings().then(s => { state.settings = s; renderRules(); if (state.admin) renderSettingsForm(); })
    .catch(err => { $('rules').textContent = `Settings unavailable: ${err.message}`; });
  await refreshUser();
  await refreshDecks();
  onAuthChange(event => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') refreshUser(); });
}

boot();
