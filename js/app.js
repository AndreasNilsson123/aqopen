/**
 * app.js – application bootstrap and tab router.
 *
 * This is the ES-module entry point loaded from index.html.
 * It wires the tab buttons, defines the top-level `render()` function, and
 * kicks off the initial data load.
 */
import { canEdit, store } from './store.js';
import { load } from './sync.js';
import { renderLeaderboard } from './ui/leaderboard.js';
import { renderRound }       from './ui/round.js';
import { renderGame }        from './ui/game.js';
import { renderConfig }      from './ui/settings.js';

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

  if      (store.tab === 'lb')   view.appendChild(renderLeaderboard());
  else if (store.tab === 'spel') view.appendChild(renderGame());
  else if (store.tab === 'cfg')  view.appendChild(renderConfig());
  else                           view.appendChild(renderRound(store.tab));

  window.scrollTo({ top: 0, behavior: 'instant' });
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
