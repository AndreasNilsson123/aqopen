/**
 * ui/round.js – renders the Bana / Simulator scorecard tabs.
 */
import { HOLES } from '../constants.js';
import { fmt, el, esc } from '../utils.js';
import { canEdit, store, allCourses } from '../store.js';
import {
  arr, roundStable, holePoints, holeLabel, ruleEnabled, ruleCfg,
  handicapRoundBonus, compute, recordSnapshot
} from '../scoring.js';
import { save } from '../sync.js';

function rerender() {
  import('../app.js').then(m => m.render());
}

function winnerNames(ids = []) {
  return ids
    .map(id => store.S.players.find(p => p.id === id)?.name)
    .filter(Boolean)
    .join(', ');
}

export function renderRound(rid) {
  const R   = store.S.rounds[rid];
  const box = el('<div></div>');

  if (!store.S.players.length) {
    box.appendChild(el('<section class="card"><div class="card-body"><p class="empty-note">Lägg till spelare under Inställningar först.</p></div></section>'));
    return box;
  }

  if (!store.activePlayer[rid] || !store.S.players.some(p => p.id === store.activePlayer[rid])) {
    store.activePlayer[rid] = store.S.players[0].id;
  }

  const pid    = store.activePlayer[rid];
  const player = store.S.players.find(p => p.id === pid);

  const pick = el(
    '<section class="card">' +
      '<div class="card-head">' + esc(R.label) + '</div>' +
      '<div class="card-body"><h3 class="sec">Spelare</h3><div class="chips" id="pp"></div></div>' +
    '</section>'
  );
  const pp = pick.querySelector('#pp');
  store.S.players.forEach(p => {
    const c = el('<button class="chip" aria-pressed="' + (p.id === pid) + '">' + esc(p.name) + (p.handicap ? ' · HCP ' + fmt(p.handicap) : '') + '</button>');
    c.onclick = () => { store.activePlayer[rid] = p.id; rerender(); };
    pp.appendChild(c);
  });
  box.appendChild(pick);

  const st       = roundStable(rid, pid);
  const hcpRound = handicapRoundBonus(player, rid, st);
  const sc = el(
    '<section class="card">' +
      '<div class="card-head light">Scorekort' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px">' + st.filled + '/18 hål · ' + fmt(st.sum + hcpRound) + ' p' + (hcpRound ? ' · HCP ' + fmt(hcpRound) : '') + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        (canEdit() ? '' : '<p class="notice" style="margin:0 0 10px">Visningsläge: scorekortet går att läsa men inte ändra på den här enheten.</p>') +
        '<table class="holes"><thead><tr>' +
          '<th>Hål</th><th>Par</th><th></th><th style="text-align:right">' + (canEdit() ? 'Slag' : 'Score') + '</th><th style="text-align:right">Resultat</th>' +
        '</tr></thead><tbody id="tb"></tbody></table>' +
      '</div>' +
    '</section>'
  );
  const tb = sc.querySelector('#tb');
  const a  = arr(rid, pid);

  // Resolve rich course metadata (hole names, stroke index) if available.
  const richCourse  = allCourses().find(c => c.name === R.courseName) || null;
  const holeNames   = richCourse?.holeNames   || [];
  const strokeIndex = richCourse?.strokeIndex  || [];
  let strokeSum = 0;

  for (let i = 0; i < HOLES; i++) {
    const par = R.pars[i], v = a[i];
    if (v != null) strokeSum += v;
    const pts   = holePoints(v, par);
    const lab   = holeLabel(v, par);
    const isTri = v != null && (v - par) >= 3;
    const hn    = holeNames[i]   ? '<span style="font-size:10px;color:var(--muted);display:block;line-height:1.2">' + esc(holeNames[i]) + '</span>' : '';
    const si    = strokeIndex[i] ? '<span class="tag" style="background:#F0F4F8;color:var(--muted)">SI ' + strokeIndex[i] + '</span>' : '';
    const tags  =
      (ruleEnabled('ctp', rid) && R.ctp.includes(i + 1) ? '<span class="tag">CTP</span>' : '') +
      (ruleEnabled('ld', 'sim') && rid === 'sim' && R.ld.includes(i + 1) ? '<span class="tag">LD</span>' : '') +
      si;

    const scoreCell = canEdit()
      ? '<div class="stepper">' +
          '<button aria-label="Ett slag mindre">−</button>' +
          '<input class="strokes' + (v == null ? ' empty' : '') + '" inputmode="numeric" value="' + (v == null ? '–' : v) + '">' +
          '<button aria-label="Ett slag mer">+</button>' +
        '</div>'
      : '<span class="readonly-score">' + (v == null ? '–' : v) + '</span>';

    const tr = el(
      '<tr' + (v != null ? ' class="done"' : '') + '>' +
        '<td class="hno">' + (i + 1) + hn + '</td>' +
        '<td class="par">Par ' + par + '</td>' +
        '<td class="tags">' + tags + '</td>' +
        '<td>' + scoreCell + '</td>' +
        '<td class="res' + (isTri ? ' tri' : '') + '">' + (v == null ? '<span style="color:#B7C2D0">–</span>' : lab + ' <b>' + pts + '</b>') + '</td>' +
      '</tr>'
    );

    if (canEdit()) {
      const [minus, plus] = tr.querySelectorAll('.stepper button');
      const input         = tr.querySelector('.strokes');
      const setVal        = nv => {
        a[i] = nv;
        // Record a leaderboard snapshot synchronously before saving.
        const res = compute();
        recordSnapshot(rid, i + 1, res);
        save(); rerender();
      };

      minus.onclick   = () => setVal(a[i] == null ? par : Math.max(1, a[i] - 1));
      plus.onclick    = () => setVal(a[i] == null ? par : Math.min(20, a[i] + 1));
      input.onfocus   = e  => { if (a[i] == null) e.target.value = ''; e.target.select(); };
      input.onblur    = e  => {
        const raw = e.target.value.trim();
        if (raw === '' || raw === '–') { setVal(null); return; }
        const n = parseInt(raw, 10);
        setVal(isNaN(n) ? null : Math.min(20, Math.max(1, n)));
      };
      input.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    }
    tb.appendChild(tr);
  }

  tb.appendChild(el(
    '<tr class="totrow">' +
      '<td colspan="3">Totalt</td>' +
      '<td style="text-align:right;font-family:\'IBM Plex Mono\',monospace">' + (strokeSum || '–') + '</td>' +
      '<td class="res"><b>' + fmt(st.sum + hcpRound) + ' p</b></td>' +
    '</tr>'
  ));

  const cleanText = ruleEnabled('clean', rid)
    ? (st.clean
        ? 'Ronden klar utan trippelbogey: +' + fmt(ruleCfg('clean').points) + ' poäng.'
        : 'Ronden klar. Trippelbogey eller sämre noterad, ingen bonus.')
    : 'Ronden klar.';
  const cleanNote = st.complete
    ? '<p class="empty-note" style="margin:10px 0 0' + (st.clean && ruleEnabled('clean', rid) ? ';color:var(--blue)' : '') + '">' + cleanText + '</p>'
    : '<p class="empty-note" style="margin:10px 0 0">' + st.filled + ' av 18 hål ifyllda.</p>';
  sc.querySelector('.card-body').appendChild(el(cleanNote));
  if (hcpRound) sc.querySelector('.card-body').appendChild(el('<p class="empty-note" style="margin:8px 0 0">Handicap i den här ronden: ' + fmt(hcpRound) + ' p.</p>'));
  box.appendChild(sc);

  if (ruleEnabled('ctp', rid)) {
    const ctp = el('<section class="card"><div class="card-head light">Closest to pin</div><div class="card-body" id="cb"></div></section>');
    const cb  = ctp.querySelector('#cb');
    cb.appendChild(el('<p class="empty-note" style="margin:0 0 10px">' + (canEdit() ? 'Markera den som ligger närmast hål. Flera markerade delar på ' + fmt(ruleCfg('ctp').points) + ' poäng.' : 'Visar vem som just nu är markerad som närmast hål.') + '</p>'));
    if (!R.ctp.length) cb.appendChild(el('<p class="empty-note">Inga CTP-hål valda för den här ronden. Välj dem under Inställningar.</p>'));

    R.ctp.forEach(h => {
      const wrap = el('<div class="subcard"><h4>Hål ' + h + ' <span style="font-weight:400;color:var(--muted);font-size:12.5px">· par ' + R.pars[h - 1] + '</span></h4><div class="chips" id="c' + h + '"></div></div>');
      const row  = wrap.querySelector('#c' + h);
      const cur  = store.S.ctpWins[rid][h] || [];
      if (canEdit()) {
        store.S.players.forEach(p => {
          const on = cur.includes(p.id);
          const c  = el('<button class="chip blue" aria-pressed="' + on + '">' + esc(p.name) + '</button>');
          c.onclick = () => {
            const list = new Set(store.S.ctpWins[rid][h] || []);
            list.has(p.id) ? list.delete(p.id) : list.add(p.id);
            store.S.ctpWins[rid][h] = [...list];
            if (!store.S.ctpWins[rid][h].length) delete store.S.ctpWins[rid][h];
            save(); rerender();
          };
          row.appendChild(c);
        });
      } else {
        row.appendChild(el('<span class="empty-note">' + esc(winnerNames(cur) || 'Ingen vinnare markerad ännu') + '</span>'));
      }
      if (cur.length) wrap.appendChild(el('<p class="empty-note" style="margin:8px 0 0">' + fmt(ruleCfg('ctp').points / cur.length) + ' poäng var.</p>'));
      cb.appendChild(wrap);
    });
    box.appendChild(ctp);
  }

  if (rid === 'sim' && ruleEnabled('ld', 'sim')) {
    const ld  = el('<section class="card"><div class="card-head light">Längsta drive</div><div class="card-body" id="ldb"></div></section>');
    const ldb = ld.querySelector('#ldb');
    ldb.appendChild(el('<p class="empty-note" style="margin:0 0 10px">' + (canEdit() ? 'Slaget måste landa på fairway. ' + fmt(ruleCfg('ld').points) + ' poäng per hål, delas vid lika.' : 'Visar vem som just nu är markerad som längsta drive.') + '</p>'));
    if (!R.ld.length) ldb.appendChild(el('<p class="empty-note">Inga drivehål valda. Välj dem under Inställningar.</p>'));

    R.ld.forEach(h => {
      const wrap = el('<div class="subcard"><h4>Hål ' + h + '</h4><div class="chips" id="ld' + h + '"></div></div>');
      const row  = wrap.querySelector('#ld' + h);
      const cur  = store.S.ldWins.sim[h] || [];
      if (canEdit()) {
        store.S.players.forEach(p => {
          const on = cur.includes(p.id);
          const c  = el('<button class="chip blue" aria-pressed="' + on + '">' + esc(p.name) + '</button>');
          c.onclick = () => {
            const list = new Set(store.S.ldWins.sim[h] || []);
            list.has(p.id) ? list.delete(p.id) : list.add(p.id);
            store.S.ldWins.sim[h] = [...list];
            if (!store.S.ldWins.sim[h].length) delete store.S.ldWins.sim[h];
            save(); rerender();
          };
          row.appendChild(c);
        });
      } else {
        row.appendChild(el('<span class="empty-note">' + esc(winnerNames(cur) || 'Ingen vinnare markerad ännu') + '</span>'));
      }
      if (cur.length) wrap.appendChild(el('<p class="empty-note" style="margin:8px 0 0">' + fmt(ruleCfg('ld').points / cur.length) + ' poäng var.</p>'));
      ldb.appendChild(wrap);
    });
    box.appendChild(ld);
  }

  return box;
}
