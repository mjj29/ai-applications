/**
 * app.js — top-level wiring: navigation, system management, auth, context bar.
 */
'use strict';

import { listSystems, createSystem, getActiveSystem, setActiveId,
         deleteSystem, exportSystem, importSystemFromJSON, saveSystem,
         syncFromCloud, currentUser,
         publishSystem, unpublishSystem, cloneSystem,
         listCollaborators, addCollaborator, removeCollaborator,
         findUserByEmail } from './store.js';
import { signInWithGitHub, signOut, onAuthChange } from './supabase.js';
import { renderEditor, initAddBidModal, initAddVariantModal, initCopyToModal } from './editor.js';
import { renderPosition } from './position.js';
import { renderLookup }   from './lookup.js';
import { renderPrint }    from './print.js';
import { renderChat }    from './chat.js';
import { flash } from './ui.js';
import { SITE_URL } from './config.js';

// ─── Navigation ───────────────────────────────────────────────────────────────

const VIEWS   = ['view-editor', 'view-systems'];
const SUBTABS = ['subtab-edit', 'subtab-position', 'subtab-lookup', 'subtab-print', 'subtab-chat'];

function setSubtab(id) {
  SUBTABS.forEach(t => document.getElementById(t).classList.toggle('active', t === id));
  document.querySelectorAll('.editor-subtab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subtab === id));
  renderSubtab(id);
}

function renderSubtab(id) {
  if (id === 'subtab-edit')     renderEditor(document.getElementById('subtab-edit'));
  if (id === 'subtab-position') renderPosition(document.getElementById('subtab-position'));
  if (id === 'subtab-lookup')   renderLookup(document.getElementById('subtab-lookup'));
  if (id === 'subtab-print')    renderPrint(document.getElementById('subtab-print'));
  if (id === 'subtab-chat')     renderChat(document.getElementById('subtab-chat'));
}

function activeSubtab() {
  return document.querySelector('.editor-subtab.active')?.id ?? 'subtab-edit';
}

function setView(id) {
  VIEWS.forEach(v => document.getElementById(v).classList.toggle('active', v === id));
  document.querySelectorAll('#nav button[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === id));
  refreshCurrentView(id);
}

function refreshCurrentView(id) {
  const sys = getActiveSystem();
  document.getElementById('system-name-display').textContent = sys?.name ?? '(no system)';
  if (id === 'view-editor')  renderSubtab(activeSubtab());
  if (id === 'view-systems') renderSystemsList();
}

// ─── Auth bar ─────────────────────────────────────────────────────────────────

async function renderAuthBar() {
  const bar = document.getElementById('auth-bar');
  if (!bar) return;
  const user = await currentUser();
  if (!user) {
    bar.innerHTML = `<button class="btn btn-sm btn-primary" id="btn-signin">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:text-bottom;margin-right:4px">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>Sign in with GitHub</button>`;
    document.getElementById('btn-signin').addEventListener('click', async () => {
      try { await signInWithGitHub(); }
      catch (e) { flash(`Sign-in failed: ${e.message}`, 'err'); }
    });
  } else {
    const name   = user.user_metadata?.preferred_username ?? user.user_metadata?.name ?? user.email;
    const avatar = user.user_metadata?.avatar_url;
    bar.innerHTML = `
      <span class="auth-user">
        ${avatar ? `<img class="auth-avatar" src="${avatar}" alt="">` : ''}
        <span class="auth-name">${name}</span>
      </span>
      <button class="btn btn-sm" id="btn-signout">Sign out</button>`;
    document.getElementById('btn-signout').addEventListener('click', async () => {
      await signOut();
    });
  }
}

// ─── Systems list ─────────────────────────────────────────────────────────────

function visibilityBadge(sys, userId) {
  if (!sys._cloud) return `<span class="sys-badge sys-badge-local" title="Local only — not synced">local</span>`;
  if (sys._visibility === 'public') return `<span class="sys-badge sys-badge-public" title="Public — anyone can view">public</span>`;
  if (!sys._isOwner) return `<span class="sys-badge sys-badge-shared" title="Shared with you">shared</span>`;
  if (sys._visibility === 'shared') return `<span class="sys-badge sys-badge-shared" title="Shared with collaborators">shared</span>`;
  return `<span class="sys-badge sys-badge-private" title="Private — only you">private</span>`;
}

async function uploadLocalSystems() {
  const locals = listSystems().filter(s => !s._cloud);
  if (!locals.length) { flash('No local-only systems to upload', 'ok'); return; }
  let ok = 0;
  for (const sys of locals) {
    try { await saveSystem(sys); ok++; }
    catch (e) { console.warn('Upload failed for', sys.name, e); }
  }
  flash(`Uploaded ${ok} of ${locals.length} system(s) to cloud`, 'ok');
  renderSystemsList();
}

async function renderSystemsList() {
  const container = document.getElementById('systems-list');
  const user = await currentUser();

  // Show sync banner if logged in
  let syncBanner = '';
  if (user) {
    syncBanner = `<div id="sync-status" style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.75rem">⟳ Syncing with cloud…</div>`;
  }

  const systems = listSystems();

  if (!systems.length && !user) {
    container.innerHTML = `<div class="empty-state"><div class="big">📋</div>No systems yet. Create one below.</div>`;
    return;
  }

  const active = getActiveSystem();

  const renderList = (sysList, currentUser) => {
    if (!sysList.length) return `<div class="empty-state" style="padding:1rem 0">No systems yet. Create one below.</div>`;
    return sysList.map(s => {
      const badge   = visibilityBadge(s, currentUser?.id);
      const pubLink = s._slug
        ? `<a class="sys-pub-link" href="${SITE_URL}?s=${s._slug}" target="_blank" title="Public link">🔗</a>`
        : '';
      const canEdit = s._isOwner || !s._cloud;
      return `
        <div class="system-item ${active?.id === s.id ? 'system-item-active' : ''}" data-id="${s.id}">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
                <span style="font-weight:500">${s.name}</span>
                ${badge} ${pubLink}
              </div>
              <div style="font-size:0.78rem;color:var(--text-muted)">${s.metadata?.modified?.slice(0,10) ?? ''} · ${countNodes(s)} nodes</div>
            </div>
            <button class="btn btn-sm" data-action="open"   data-id="${s.id}">Open</button>
            <button class="btn btn-sm" data-action="export" data-id="${s.id}">Export</button>
            ${canEdit && s._cloud ? `<button class="btn btn-sm" data-action="share" data-id="${s.id}" title="Share / Publish">Share</button>` : ''}
            ${!s._isOwner && s._cloud ? `<button class="btn btn-sm btn-primary" data-action="clone" data-id="${s.id}" title="Clone to my account">Clone</button>` : ''}
            ${canEdit ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">Delete</button>` : ''}
          </div>
        </div>`;
    }).join('');
  };

  const localOnly = systems.filter(s => !s._cloud);
  const uploadBanner = (user && localOnly.length)
    ? `<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.35);border-radius:var(--radius);padding:0.6rem 0.85rem;margin-bottom:0.75rem;font-size:0.82rem;display:flex;align-items:center;gap:0.75rem">
        <span>⚠ ${localOnly.length} system(s) exist only in this browser.</span>
        <button class="btn btn-sm btn-primary" id="btn-upload-all">☁ Upload all to cloud</button>
       </div>`
    : '';

  container.innerHTML = syncBanner + uploadBanner + renderList(systems, user);

  document.getElementById('btn-upload-all')?.addEventListener('click', uploadLocalSystems);

  // Async sync if logged in — refresh the list after
  if (user) {
    syncFromCloud().then(synced => {
      const statusEl = document.getElementById('sync-status');
      if (statusEl) statusEl.textContent = `✓ Cloud sync complete · ${synced.length} system(s)`;
      const stillLocal = synced.filter(s => !s._cloud);
      const newBanner = (stillLocal.length)
        ? `<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.35);border-radius:var(--radius);padding:0.6rem 0.85rem;margin-bottom:0.75rem;font-size:0.82rem;display:flex;align-items:center;gap:0.75rem">
            <span>⚠ ${stillLocal.length} system(s) exist only in this browser.</span>
            <button class="btn btn-sm btn-primary" id="btn-upload-all">☁ Upload all to cloud</button>
           </div>`
        : '';
      container.innerHTML = newBanner + renderList(synced, user);
      document.getElementById('btn-upload-all')?.addEventListener('click', uploadLocalSystems);
      attachSystemActions(container, user);
    }).catch(e => {
      const statusEl = document.getElementById('sync-status');
      if (statusEl) statusEl.textContent = `⚠ Cloud sync failed: ${e.message}`;
    });
  }

  attachSystemActions(container, user);
}

function attachSystemActions(container, user) {
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      const sys    = listSystems().find(s => s.id === id);
      if (action === 'open') {
        setActiveId(id);
        setView('view-editor');
      } else if (action === 'export' && sys) {
        exportSystem(sys);
      } else if (action === 'delete' && sys) {
        if (confirm(`Delete "${sys.name}"? This cannot be undone.`)) {
          await deleteSystem(id);
          renderSystemsList();
          flash('Deleted', 'ok');
        }
      } else if (action === 'share' && sys) {
        showShareModal(sys);
      } else if (action === 'clone' && sys) {
        try {
          const cloned = await cloneSystem(sys);
          setActiveId(cloned.id);
          flash(`Cloned "${cloned.name}"`, 'ok');
          setView('view-editor');
        } catch (e) { flash(e.message, 'err'); }
      }
    });
  });
}

// ─── Share / Publish modal ────────────────────────────────────────────────────

async function showShareModal(sys) {
  const modal = document.getElementById('modal-share');
  if (!modal) return;
  modal.classList.remove('hidden');

  const pubUrl = sys._slug ? `${SITE_URL}?s=${sys._slug}` : null;

  document.getElementById('share-system-name').textContent = sys.name;
  document.getElementById('share-pub-section').innerHTML = sys._visibility === 'public'
    ? `<div style="margin-bottom:0.5rem">
         <span class="sys-badge sys-badge-public">Public</span>
         Public link: <a class="sys-pub-link" href="${pubUrl}" target="_blank">${pubUrl}</a>
       </div>
       <button class="btn btn-sm btn-danger" id="btn-unpublish">Unpublish</button>`
    : `<button class="btn btn-sm btn-primary" id="btn-publish">🌐 Make Public</button>
       <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem">Anyone with the link can view and clone this system.</div>`;

  // Collaborators
  const collabList = document.getElementById('share-collabs');
  collabList.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem">Loading…</div>`;
  try {
    const collabs = await listCollaborators(sys.id);
    collabList.innerHTML = collabs.length
      ? collabs.map(c => `
          <div class="collab-row" data-uid="${c.user_id}">
            <span style="flex:1">${c.profiles?.display_name ?? c.profiles?.email ?? c.user_id}</span>
            <span class="sys-badge sys-badge-shared">${c.role}</span>
            <button class="btn btn-sm btn-danger" data-remove="${c.user_id}">✕</button>
          </div>`).join('')
      : `<div style="color:var(--text-muted);font-size:0.82rem">No collaborators yet.</div>`;

    collabList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await removeCollaborator(sys.id, btn.dataset.remove);
        showShareModal(sys);
      });
    });
  } catch { collabList.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem">Could not load collaborators.</div>`; }

  // Wire buttons
  const btnClose = document.getElementById('btn-share-close');
  btnClose.onclick = () => modal.classList.add('hidden');
  modal.querySelector('.modal-backdrop-inner')?.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  document.getElementById('btn-share-close').onclick = () => modal.classList.add('hidden');

  document.getElementById('btn-add-collab')?.addEventListener('click', async () => {
    const email = document.getElementById('collab-email').value.trim();
    const role  = document.getElementById('collab-role').value;
    if (!email) return;
    try {
      const found = await findUserByEmail(email);
      if (!found) { flash(`No account found for ${email}`, 'err'); return; }
      await addCollaborator(sys.id, found.id, role);
      flash(`Added ${email}`, 'ok');
      document.getElementById('collab-email').value = '';
      showShareModal(sys);
    } catch (e) { flash(e.message, 'err'); }
  });

  document.getElementById('btn-publish')?.addEventListener('click', async () => {
    try {
      const updated = await publishSystem(sys.id);
      flash('Published!', 'ok');
      showShareModal(updated);
    } catch (e) { flash(e.message, 'err'); }
  });

  document.getElementById('btn-unpublish')?.addEventListener('click', async () => {
    try {
      await unpublishSystem(sys.id);
      flash('Unpublished', 'ok');
      const refreshed = listSystems().find(s => s.id === sys.id) ?? sys;
      showShareModal(refreshed);
    } catch (e) { flash(e.message, 'err'); }
  });
}

// ─── Public system loading (?s=slug) ─────────────────────────────────────────

async function handlePublicSlug() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('s');
  if (!slug) return false;

  try {
    const { loadPublicSystem } = await import('./store.js');
    const sys = await loadPublicSystem(slug);
    // Show the system in a read-only preview — offer Clone if logged in
    showPublicPreview(sys);
    return true;
  } catch { return false; }
}

async function showPublicPreview(sys) {
  const user = await currentUser();
  const modal = document.getElementById('modal-public-preview');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('preview-system-name').textContent = sys.name;
  document.getElementById('preview-desc').textContent =
    sys.metadata?.description ?? sys.metadata?.notes ?? '';

  const cloneBtn = document.getElementById('btn-preview-clone');
  if (user) {
    cloneBtn.textContent = '📋 Clone to my account';
    cloneBtn.disabled = false;
    cloneBtn.onclick = async () => {
      try {
        const cloned = await cloneSystem(sys);
        setActiveId(cloned.id);
        modal.classList.add('hidden');
        flash(`Cloned "${cloned.name}"`, 'ok');
        setView('view-editor');
      } catch (e) { flash(e.message, 'err'); }
    };
  } else {
    cloneBtn.textContent = 'Sign in to clone';
    cloneBtn.disabled = false;
    cloneBtn.onclick = () => signInWithGitHub();
  }
  document.getElementById('btn-preview-close').onclick = () => {
    modal.classList.add('hidden');
    // Clear the ?s= from the URL without reload
    history.replaceState({}, '', window.location.pathname);
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countNodes(sys) {
  let n = 0;
  function walk(nodes) { for (const node of (nodes||[])) { n++; if (node.continuations?.nodes) walk(node.continuations.nodes); } }
  walk(sys.openings);
  return n;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Auth state changes (sign in / sign out) → refresh UI
  onAuthChange(async (event) => {
    await renderAuthBar();
    if (event === 'SIGNED_IN') {
      flash('Signed in', 'ok');
      renderSystemsList();
    } else if (event === 'SIGNED_OUT') {
      renderSystemsList();
    }
  });

  // Initial auth bar render
  await renderAuthBar();

  // Nav buttons
  document.querySelectorAll('#nav button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Sub-tab buttons
  document.querySelectorAll('.editor-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
  });

  // New system
  document.getElementById('btn-new-system').addEventListener('click', async () => {
    const name = prompt('System name:')?.trim();
    if (!name) return;
    const sys = await createSystem(name);
    setActiveId(sys.id);
    flash(`Created "${name}"`, 'ok');
    setView('view-editor');
  });

  // Import
  document.getElementById('btn-import-system').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,.bridge.json';
    input.addEventListener('change', async () => {
      try {
        const text = await input.files[0].text();
        const sys  = await importSystemFromJSON(text);
        setActiveId(sys.id);
        flash(`Imported "${sys.name}"`, 'ok');
        setView('view-editor');
      } catch (e) { flash(`Import failed: ${e.message}`, 'err'); }
    });
    input.click();
  });

  // Modals
  initAddBidModal();
  initAddVariantModal();
  initCopyToModal();

  // Share modal close on backdrop click
  document.getElementById('modal-share')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-share'))
      document.getElementById('modal-share').classList.add('hidden');
  });

  // Handle ?s=slug for public system preview
  const wasPublic = await handlePublicSlug();
  if (!wasPublic) {
    const active = getActiveSystem();
    setView(active ? 'view-editor' : 'view-systems');
  }
});
