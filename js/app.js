/**
 * app.js – application bootstrap and tab router.
 *
 * This is the ES-module entry point loaded from index.html.
 * It wires the tab buttons, defines the top-level `render()` function, and
 * kicks off the initial data load.
 */
import { canEdit, store } from './store.js';
import { load } from './sync.js';
import { renderLeaderboard, renderHistory, renderStandings } from './ui/leaderboard.js';
import { renderRound }       from './ui/round.js';
import { renderGame }        from './ui/game.js';
import { renderConfig }      from './ui/settings.js';

/* ---- history API client ---- */

let historyCache = null; // list items (no full state)

export async function fetchHistoryList() {
  try {
    const r = await fetch('/api/history', { cache: 'no-store' });
    if (!r.ok) return [];
    const d = await r.json();
    historyCache = d.events || [];
    return historyCache;
  } catch {
    return historyCache || [];
  }
}

export async function fetchHistoryItem(id) {
  try {
    const r = await fetch('/api/history/' + id, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function archiveEvent(editKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (editKey) headers['x-aqopen-key'] = editKey;
  const r = await fetch('/api/history', {
    method:  'POST',
    headers,
    body: JSON.stringify({
      name:  store.S.event,
      date:  new Date().toISOString().slice(0, 10),
      state: store.S
    })
  });
  if (!r.ok) throw new Error(await r.text());
  historyCache = null;
  return r.json();
}

export async function deleteHistoryItem(index, editKey) {
  const headers = {};
  if (editKey) headers['x-aqopen-key'] = editKey;
  const r = await fetch('/api/history?index=' + index, { method: 'DELETE', headers });
  if (!r.ok) throw new Error(await r.text());
  historyCache = null;
  return r.json();
}

/* ---- archived event viewer state ---- */
let viewingArchived = null; // { event, players, res, index } when browsing history

export function render() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  document.querySelector('.brand-note').textContent = store.S.event || 'Resultat & poängräkning';
  document.title = (store.S.event || 'AqOpen Sweden') + ' – Scoring';
  if (!canEdit() && store.tab === 'spel') store.tab = 'lb';
  document.querySelectorAll('.tab').forEach(t => {
    const visible = t.dataset.tab !== 'spel' || canEdit();
    t.hidden = !visible;
    t.setAttribute('aria-selected', String(visible && t.dataset.tab === store.tab));
  });

  if      (store.tab === 'lb')       view.appendChild(renderLeaderboard());
  else if (store.tab === 'historik') renderHistoryTab(view);
  else if (store.tab === 'spel')     view.appendChild(renderGame());
  else if (store.tab === 'cfg')      view.appendChild(renderConfig());
  else                               view.appendChild(renderRound(store.tab));

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderHistoryTab(view) {
  if (viewingArchived) {
    const { event, players, res, index } = viewingArchived;
    const box = document.createElement('div');

    const backBtn = document.createElement('button');
    backBtn.className = 'btn ghost';
    backBtn.style.cssText = 'margin-bottom:14px;width:100%';
    backBtn.textContent = '← Tillbaka till listan';
    backBtn.onclick = () => { viewingArchived = null; render(); };
    box.appendChild(backBtn);

    const header = document.createElement('section');
    header.className = 'card';
    header.innerHTML =
      '<div class="card-head">' + esc(event.name || 'Arkiverat event') + '</div>' +
      '<div class="card-body"><p class="empty-note" style="margin:0">' +
        esc((event.date || '') + (event.archivedAt ? ' · arkiverat ' + new Date(event.archivedAt).toLocaleDateString('sv-SE') : '')) +
      '</p></div>';
    box.appendChild(header);

    // Standings using the pre-computed result map.
    const standingsCard = document.createElement('section');
    standingsCard.className = 'card';
    standingsCard.innerHTML = '<div class="card-head">Totalställning</div><div class="card-body" id="ahb"></div>';
    const ahb = standingsCard.querySelector('#ahb');
    ahb.appendChild(renderStandings(players, res, { readOnly: true }));
    box.appendChild(standingsCard);

    if (canEdit() && index != null) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger';
      delBtn.style.cssText = 'margin-top:10px;width:100%';
      delBtn.textContent = 'Ta bort från historiken';
      delBtn.onclick = async () => {
        delBtn.disabled = true;
        delBtn.textContent = 'Tar bort…';
        try {
          await deleteHistoryItem(index, store.local.editKey);
          viewingArchived = null;
          render();
        } catch (e) {
          delBtn.textContent = 'Fel: ' + e.message;
          delBtn.disabled = false;
        }
      };
      box.appendChild(delBtn);
    }

    view.appendChild(box);
    return;
  }

  // List view – load asynchronously then inject.
  const placeholder = document.createElement('div');
  placeholder.innerHTML = '<section class="card"><div class="card-body"><p class="empty-note">Laddar historik…</p></div></section>';
  view.appendChild(placeholder);

  fetchHistoryList().then(events => {
    // Remove placeholder only if we're still on the history tab.
    if (store.tab !== 'historik') return;
    view.innerHTML = '';
    const box = renderHistory(events, async idx => {
      const evt = events[idx];
      if (!evt?.id) return;
      const full = await fetchHistoryItem(evt.id);
      if (!full) return;
      // Compute standings from archived state without touching live store.S.
      const { migrateState } = await import('./state.js');
      const { compute: computeArchived } = await import('./scoring.js');
      const realS = store.S;
      store.S = migrateState(full.state || {});
      const res     = computeArchived();
      const players = store.S.players;
      store.S = realS;
      viewingArchived = { event: full, players, res, index: idx };
      render();
    });
    view.appendChild(box);
  });
}

/* Wire tab buttons */
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => { store.tab = t.dataset.tab; render(); };
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

/* Start */
load();
