/**
 * ui/game.js – renders the "Spela" (game mode) tab.
 */
import { HOLES, ROUND_LABELS } from '../constants.js';
import { clamp, fmt, el, esc } from '../utils.js';
import { store } from '../store.js';
import {
  arr, roundStable, holePoints, holeLabel, ruleEnabled, ruleCfg,
  handicapRoundBonus, stablefordSummary, handicapModeLabel, gm
} from '../scoring.js';
import { save } from '../sync.js';

function firstOpenHole(rid) {
  for (let i = 0; i < HOLES; i++) {
    if (store.S.players.some(p => arr(rid, p.id)[i] == null)) return i + 1;
  }
  return HOLES;
}

function winnerChips(list, onToggle, points) {
  const row = el('<div class="chips"></div>');
  store.S.players.forEach(p => {
    const on = list.includes(p.id);
    const c  = el('<button class="chip blue" aria-pressed="' + on + '">' + esc(p.name) + '</button>');
    c.onclick = () => onToggle(p.id);
    row.appendChild(c);
  });
  if (list.length > 1) row.appendChild(el('<span class="empty-note" style="align-self:center">' + fmt(points / list.length) + ' p var</span>'));
  return row;
}

export function renderGame() {
  const box = el('<div></div>');

  if (!store.S.players.length) {
    box.appendChild(el('<section class="card"><div class="card-body"><p class="empty-note">Lägg till spelare under Inställningar först.</p></div></section>'));
    return box;
  }

  /* — Round picker — */
  if (!store.S.live) {
    const c  = el('<section class="card"><div class="card-head">Spelläge</div><div class="card-body" id="gs"></div></section>');
    const gs = c.querySelector('#gs');
    gs.appendChild(el('<p class="empty-note" style="margin:0 0 12px">Ett hål i taget, alla spelarna på samma skärm. Alla telefoner följer samma hål. Aktivt format: ' + esc(gm().name) + '.</p>'));

    ['bana', 'sim'].forEach(rid => {
      const R       = store.S.rounds[rid];
      const filled  = store.S.players.reduce((n, p) => n + arr(rid, p.id).filter(v => v != null).length, 0);
      const of      = store.S.players.length * HOLES;
      const started = filled > 0;
      const activeBonuses = [];
      if (ruleEnabled('ctp', rid)) activeBonuses.push('CTP');
      if (rid === 'sim' && ruleEnabled('ld', 'sim')) activeBonuses.push('LD');
      if (ruleEnabled('clean', rid)) activeBonuses.push('Ren rond');

      const b = el(
        '<button class="btn" style="width:100%;margin-bottom:10px;padding:16px;text-align:left">' +
          (started ? 'Fortsätt ' : 'Starta ') + esc(R.label) +
          '<span style="display:block;font-family:Inter;letter-spacing:0;text-transform:none;font-size:12px;font-weight:400;opacity:.8;margin-top:4px">' +
            (R.courseName ? esc(R.courseName) + ' · ' : '') + 'par ' + R.pars.reduce((a, b) => a + b, 0) +
            ' · ' + filled + '/' + of + ' noteringar' +
            (activeBonuses.length ? ' · ' + activeBonuses.join(', ') : '') +
          '</span>' +
        '</button>'
      );
      b.onclick = () => {
        store.S.live = { round: rid, hole: firstOpenHole(rid) };
        save();
        import('../app.js').then(m => m.render());
      };
      gs.appendChild(b);
    });

    box.appendChild(c);
    return box;
  }

  /* — Active hole — */
  const rid  = store.S.live.round;
  const R    = store.S.rounds[rid];
  const h    = clamp(store.S.live.hole, 1, HOLES);
  const par  = R.pars[h - 1];
  const isCtp = ruleEnabled('ctp', rid) && R.ctp.includes(h);
  const isLd  = ruleEnabled('ld', 'sim') && rid === 'sim' && R.ld.includes(h);

  const head = el(
    '<section class="card">' +
      '<div class="card-head">' + esc(R.label) +
        '<span style="font-family:Inter;letter-spacing:0;text-transform:none;font-size:12px;font-weight:400;opacity:.8">Hål ' + h + ' av ' + HOLES + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="gm-hole">' +
          '<div class="gm-num">' + h + '</div>' +
          '<div><div class="gm-par">Par ' + par + '</div>' +
            (isCtp ? '<span class="tag">CLOSEST TO PIN</span>' : '') +
            (isLd  ? '<span class="tag">LÄNGSTA DRIVE</span>'  : '') +
          '</div>' +
        '</div>' +
        '<div id="gp"></div>' +
      '</div>' +
    '</section>'
  );
  const gp = head.querySelector('#gp');

  store.S.players.forEach(p => {
    const a = arr(rid, p.id), v = a[h - 1];
    const row = el(
      '<div class="gm-row">' +
        '<span class="gm-name">' + esc(p.name) + (p.handicap ? ' <span class="empty-note">HCP ' + fmt(p.handicap) + '</span>' : '') + '</span>' +
        '<span class="gm-pts">' + (v == null ? '–' : holeLabel(v, par) + ' ' + holePoints(v, par) + 'p') + '</span>' +
        '<span class="stepper">' +
          '<button aria-label="Ett slag mindre">−</button>' +
          '<input class="strokes' + (v == null ? ' empty' : '') + '" inputmode="numeric" value="' + (v == null ? '–' : v) + '">' +
          '<button aria-label="Ett slag mer">+</button>' +
        '</span>' +
      '</div>'
    );
    const [minus, plus] = row.querySelectorAll('.stepper button');
    const input         = row.querySelector('.strokes');
    const set           = nv => { a[h - 1] = nv; save(); import('../app.js').then(m => m.render()); };
    minus.onclick  = () => set(a[h - 1] == null ? par : Math.max(1, a[h - 1] - 1));
    plus.onclick   = () => set(a[h - 1] == null ? par : Math.min(20, a[h - 1] + 1));
    input.onfocus  = e => { if (a[h - 1] == null) e.target.value = ''; e.target.select(); };
    input.onblur   = e => {
      const raw = e.target.value.trim();
      if (raw === '' || raw === '–') return set(null);
      const n = parseInt(raw, 10);
      set(isNaN(n) ? null : Math.min(20, Math.max(1, n)));
    };
    input.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    gp.appendChild(row);
  });

  /* Stakes summary */
  const stakes    = el('<div class="subcard"><h4>Vad står på spel?</h4><p>' + esc(stablefordSummary()) + '</p><div class="chips" id="stakes"></div></div>');
  const stakeRow  = stakes.querySelector('#stakes');
  if (isCtp) stakeRow.appendChild(el('<span class="tag">CTP +' + fmt(ruleCfg('ctp').points) + ' p</span>'));
  if (isLd)  stakeRow.appendChild(el('<span class="tag">LD +'  + fmt(ruleCfg('ld').points)  + ' p</span>'));
  if (ruleEnabled('clean', rid)) stakeRow.appendChild(el('<span class="tag">Ren rond +' + fmt(ruleCfg('clean').points) + ' p</span>'));
  const hcfg = gm().handicap;
  if (hcfg.mode !== 'none' && (hcfg.appliesTo === 'event' || hcfg.appliesTo === 'both' || hcfg.appliesTo === rid)) {
    stakeRow.appendChild(el('<span class="tag">Handicap ' + esc(handicapModeLabel(hcfg.mode)) + '</span>'));
  }
  head.querySelector('.card-body').appendChild(stakes);

  /* CTP winner */
  if (isCtp) {
    const cur = store.S.ctpWins[rid][h] || [];
    const w   = el('<div class="subcard"><h4>Närmast hål</h4><p>' + fmt(ruleCfg('ctp').points) + ' poäng, delas vid lika.</p></div>');
    w.appendChild(winnerChips(cur, pid => {
      const l = new Set(store.S.ctpWins[rid][h] || []);
      l.has(pid) ? l.delete(pid) : l.add(pid);
      store.S.ctpWins[rid][h] = [...l];
      if (!store.S.ctpWins[rid][h].length) delete store.S.ctpWins[rid][h];
      save(); import('../app.js').then(m => m.render());
    }, ruleCfg('ctp').points));
    head.querySelector('.card-body').appendChild(w);
  }

  /* LD winner */
  if (isLd) {
    const cur = store.S.ldWins.sim[h] || [];
    const w   = el('<div class="subcard"><h4>Längsta drive</h4><p>Måste landa på fairway. ' + fmt(ruleCfg('ld').points) + ' poäng, delas vid lika.</p></div>');
    w.appendChild(winnerChips(cur, pid => {
      const l = new Set(store.S.ldWins.sim[h] || []);
      l.has(pid) ? l.delete(pid) : l.add(pid);
      store.S.ldWins.sim[h] = [...l];
      if (!store.S.ldWins.sim[h].length) delete store.S.ldWins.sim[h];
      save(); import('../app.js').then(m => m.render());
    }, ruleCfg('ld').points));
    head.querySelector('.card-body').appendChild(w);
  }

  /* Navigation */
  const nav  = el('<div class="gm-nav"></div>');
  const prev = el('<button class="btn ghost"' + (h === 1 ? ' disabled style="opacity:.4"' : '') + '>← Hål ' + (h - 1) + '</button>');
  prev.onclick = () => { if (h > 1) { store.S.live.hole = h - 1; save(); import('../app.js').then(m => m.render()); } };

  const next = el('<button class="btn">' + (h === HOLES ? 'Avsluta ronden' : 'Nästa hål →') + '</button>');
  next.onclick = () => {
    if (h === HOLES) { store.S.live = null; store.tab = 'lb'; save(); }
    else             { store.S.live.hole = h + 1; save(); }
    import('../app.js').then(m => m.render());
  };
  nav.appendChild(prev);
  nav.appendChild(next);
  head.querySelector('.card-body').appendChild(nav);

  const openHoles = store.S.players.some(p => arr(rid, p.id)[h - 1] == null);
  if (openHoles) head.querySelector('.card-body').appendChild(el('<p class="empty-note" style="margin:10px 0 0">Alla spelare är inte ifyllda på det här hålet.</p>'));
  box.appendChild(head);

  /* Hole navigator dots */
  const dots = el('<section class="card"><div class="card-body"><h3 class="sec">Hoppa till hål</h3><div class="gm-dots" id="gd"></div></div></section>');
  const gd   = dots.querySelector('#gd');
  for (let i = 1; i <= HOLES; i++) {
    const full = store.S.players.every(p => arr(rid, p.id)[i - 1] != null);
    const d    = el('<button class="gm-dot' + (full ? ' filled' : '') + (i === h ? ' now' : '') + '">' + i + '</button>');
    d.onclick  = () => { store.S.live.hole = i; save(); import('../app.js').then(m => m.render()); };
    gd.appendChild(d);
  }
  const stop = el('<button class="btn ghost" style="width:100%;margin-top:12px">Lämna spelläget</button>');
  stop.onclick = () => { store.S.live = null; save(); import('../app.js').then(m => m.render()); };
  dots.querySelector('.card-body').appendChild(stop);
  box.appendChild(dots);

  /* Round standings */
  const st  = el('<section class="card"><div class="card-head light">Ställning i ronden</div><div class="card-body" id="gst"></div></section>');
  const gst = st.querySelector('#gst');
  [...store.S.players]
    .map(p => ({ p, r: roundStable(rid, p.id) }))
    .sort((a, b) => {
      const av = a.r.sum + handicapRoundBonus(a.p, rid, a.r);
      const bv = b.r.sum + handicapRoundBonus(b.p, rid, b.r);
      return bv - av;
    })
    .forEach(x => {
      const hcp = handicapRoundBonus(x.p, rid, x.r);
      gst.appendChild(el(
        '<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line)">' +
          '<span>' + esc(x.p.name) + '</span>' +
          '<span>' +
            '<b style="font-family:\'IBM Plex Mono\',monospace">' + fmt(x.r.sum + hcp) + ' p</b>' +
            '<span class="empty-note" style="margin-left:8px">' + x.r.filled + ' hål' + (hcp ? ' · HCP ' + fmt(hcp) : '') + '</span>' +
          '</span>' +
        '</div>'
      ));
    });
  box.appendChild(st);

  return box;
}
