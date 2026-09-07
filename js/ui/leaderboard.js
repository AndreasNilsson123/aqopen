/**
 * ui/leaderboard.js – renders the leaderboard tab.
 */
import { ROUND_IDS, HOLES } from '../constants.js';
import { fmt, el, esc } from '../utils.js';
import { store } from '../store.js';
import {
  compute, gm, ruleEnabled, roundStable,
  handicapModeLabel, gamemodeLines, arr, holePoints,
  computeTeams, playerStats
} from '../scoring.js';

function prizeLeaders(res, pick) {
  const vals = store.S.players.map(p => ({ p, v: pick(res[p.id]) })).filter(x => x.v > 0);
  const best = vals.length ? Math.max(...vals.map(x => x.v)) : 0;
  return { best, who: vals.filter(x => x.v === best).map(x => x.p.name) };
}

/** Sort players: by total descending, then tiebreak descending. */
function sortedPlayers(res) {
  return [...store.S.players].sort((a, b) => {
    const dt = res[b.id].total - res[a.id].total;
    if (dt !== 0) return dt;
    return res[b.id].tb - res[a.id].tb;
  });
}

function scoreSegments(r = {}) {
  const hcp = Number(r.hcp ?? 0);
  return [
    { cls: 's-stable', label: 'Stableford', value: Math.max(0, (r.stableBana ?? 0) + (r.stableSim ?? 0)) },
    { cls: 's-ctp',    label: 'CTP',        value: Math.max(0, r.ctp ?? 0) },
    { cls: 's-ld',     label: 'Drive',      value: Math.max(0, r.ld ?? 0) },
    { cls: 's-tri',    label: 'Bonus',      value: Math.max(0, r.tri ?? 0) },
    { cls: 's-cb',     label: 'Comeback',   value: Math.max(0, r.cb ?? 0) },
    { cls: 's-hcp',    label: 'Handicap',   value: Math.max(0, hcp) },
    { cls: 's-neg',    label: 'Avdrag',     value: Math.max(0, -hcp) }
  ].filter(s => s.value > 0);
}

function scoreScale(players, res) {
  return Math.max(1, ...players.map(p =>
    scoreSegments(res[p.id] || {}).reduce((sum, s) => sum + s.value, 0)
  ));
}

function renderScoreViz(r, max) {
  const segments = scoreSegments(r);
  if (!segments.length) return '<div class="bar empty"></div>';
  const bar = '<div class="bar">' + segments.map(s =>
    '<i class="' + s.cls + '" style="width:' + (s.value / max * 100) + '%" title="' + esc(s.label) + ': ' + fmt(s.value) + ' p"></i>'
  ).join('') + '</div>';
  const pills = '<div class="bar-pills">' + segments.map(s =>
    '<span class="bar-pill"><i class="swatch ' + s.cls + '"></i>' + esc(s.label) + ' <b>' + fmt(s.value) + '</b></span>'
  ).join('') + '</div>';
  return bar + pills;
}

/** Render leaderboard standings using an arbitrary (possibly archived) result map & player list. */
export function renderStandings(players, res, opts = {}) {
  const { readOnly = false, showStats = true } = opts;
  const sorted = [...players].sort((a, b) => {
    const dt = (res[b.id]?.total ?? 0) - (res[a.id]?.total ?? 0);
    if (dt !== 0) return dt;
    return (res[b.id]?.tb ?? 0) - (res[a.id]?.tb ?? 0);
  });
  const max  = scoreScale(players, res);
  const frag = document.createDocumentFragment();

  sorted.forEach((p, i) => {
    const r   = res[p.id] || {};
    const banaStats = r.stableBana != null ? { filled: HOLES } : { filled: 0 };
    const simStats  = r.stableSim  != null ? { filled: HOLES } : { filled: 0 };
    // Get actual filled counts if available.
    try {
      const bs = roundStable('bana', p.id);
      const ss = roundStable('sim', p.id);
      banaStats.filled = bs.filled;
      simStats.filled  = ss.filled;
    } catch (_) {}

    const total = r.total ?? 0;
    const badges = [];
    if (i === 0 && total > 0) badges.push('Leder');
    if (r.delta != null && r.delta > 0) badges.push('+' + fmt(r.delta) + ' simform');
    badges.push(...(r.badges || []).slice(0, 2));

    const tiedNext = sorted[i + 1] && (res[sorted[i + 1].id]?.total ?? 0) === total;
    const tiedPrev = i > 0 && (res[sorted[i - 1].id]?.total ?? 0) === total;
    const showTb   = (tiedNext || tiedPrev) && r.tb && r.tb !== 0;
    if (showTb) badges.push('TB: ' + fmt(r.tb));

    frag.appendChild(el(
      '<div class="lb-row' + (i === 0 && total > 0 ? ' lead' : '') + '">' +
        '<div class="rank">' + (i + 1) + '</div>' +
        '<div class="lb-main">' +
          '<div class="lb-top">' +
            '<div>' +
              '<div class="lb-name">' + esc(p.name) + '</div>' +
              '<div class="legend" style="margin-top:5px">' + badges.map(b => '<span class="tag" style="font-size:10px">' + esc(b) + '</span>').join('') + '</div>' +
            '</div>' +
            '<div class="lb-pts">' + fmt(total) + '<small>p</small></div>' +
          '</div>' +
          renderScoreViz(r, max) +
          '<div class="lb-break">' +
            '<span>Klart <b>' + (banaStats.filled + simStats.filled) + '/36</b></span>' +
            '<span>Bana <b>' + fmt(r.stableBana ?? 0) + '</b></span>' +
            '<span>Sim <b>'  + fmt(r.stableSim  ?? 0) + '</b></span>' +
            '<span>CTP <b>'  + fmt(r.ctp ?? 0)         + '</b></span>' +
            '<span>Drive <b>'+ fmt(r.ld ?? 0)           + '</b></span>' +
            '<span>Bonus <b>'+ fmt((r.tri ?? 0) + (r.cb ?? 0))   + '</b></span>' +
            '<span>Handicap <b>' + fmt(r.hcp ?? 0)      + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div>'
    ));
  });
  return frag;
}

export function renderLeaderboard() {
  const res    = compute();
  const sorted = sortedPlayers(res);
  const max    = scoreScale(store.S.players, res);
  const box    = el('<div></div>');
  const mode   = gm();
  const totalHoles = store.S.players.length * ROUND_IDS.length * 18;
  const doneHoles  = store.S.players.reduce((sum, p) =>
    sum + roundStable('bana', p.id).filled + roundStable('sim', p.id).filled, 0
  );

  box.appendChild(el(
    '<section class="card">' +
      '<div class="card-head light">Läget just nu</div>' +
      '<div class="card-body">' +
        '<div class="legend" style="margin-top:0">' +
          '<span><b>' + store.S.players.length + '</b> spelare</span>' +
          '<span><b>' + doneHoles + '/' + Math.max(totalHoles, 1) + '</b> registrerade hål</span>' +
          '<span><b>' + (store.S.live ? store.S.rounds[store.S.live.round].label + ' hål ' + store.S.live.hole : 'ingen live-rond') + '</b></span>' +
        '</div>' +
        '<div style="margin-top:10px">' +
          '<a href="results.html" target="_blank" rel="noopener" class="btn ghost" style="font-size:12px;padding:7px 12px">Dela resultat ↗</a>' +
        '</div>' +
      '</div>' +
    '</section>'
  ));

  /* Leader banner */
  if (sorted.length && res[sorted[0].id].total > 0) {
    const leader    = sorted[0];
    const leadScore = res[leader.id].total;
    const edge      = sorted[1] ? leadScore - res[sorted[1].id].total : leadScore;
    box.appendChild(el(
      '<section class="card"><div class="card-body">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
          '<div>' +
            '<div style="font-family:\'Barlow Condensed\',sans-serif;letter-spacing:.14em;text-transform:uppercase;font-size:13px;color:var(--muted)">Ledarboll</div>' +
            '<div style="font-size:24px;font-weight:700;color:var(--navy);margin-top:2px">' + esc(leader.name) + '</div>' +
            '<div class="empty-note" style="margin-top:4px">' + esc(mode.name) + ' · ' + (edge > 0 ? 'leder med ' + fmt(edge) + ' p' : 'delad ledning') + '</div>' +
          '</div>' +
          '<div class="tag" style="padding:5px 8px;font-size:11px">' + fmt(leadScore) + ' p</div>' +
        '</div>' +
      '</div></section>'
    ));
  }

  /* Main standings */
  const card = el(
    '<section class="card">' +
      '<div class="card-head">Totalställning' +
        '<span style="font-family:Inter;letter-spacing:0;text-transform:none;font-size:12px;font-weight:400;opacity:.75">Flest poäng vinner</span>' +
      '</div>' +
      '<div class="card-body" id="lbb"></div>' +
    '</section>'
  );
  const body = card.querySelector('#lbb');

  if (!store.S.players.length) {
    body.appendChild(el('<p class="empty-note">Lägg till spelare under Inställningar för att börja.</p>'));
  }

  sorted.forEach((p, i) => {
    const r   = res[p.id];
    const banaStats = roundStable('bana', p.id);
    const simStats  = roundStable('sim', p.id);
    const badges = [];
    if (i === 0 && r.total > 0) badges.push('Leder');
    if (r.delta != null && r.delta > 0) badges.push('+' + fmt(r.delta) + ' simform');
    badges.push(...r.badges.slice(0, 2));

    const tiedNext = sorted[i + 1] && res[sorted[i + 1].id].total === r.total;
    const tiedPrev = i > 0 && res[sorted[i - 1].id].total === r.total;
    if ((tiedNext || tiedPrev) && r.tb !== 0) badges.push('TB: ' + fmt(r.tb));

    body.appendChild(el(
      '<div class="lb-row' + (i === 0 && r.total > 0 ? ' lead' : '') + '">' +
        '<div class="rank">' + (i + 1) + '</div>' +
        '<div class="lb-main">' +
          '<div class="lb-top">' +
            '<div>' +
              '<div class="lb-name">' + esc(p.name) + '</div>' +
              '<div class="legend" style="margin-top:5px">' + badges.map(b => '<span class="tag" style="font-size:10px">' + esc(b) + '</span>').join('') + '</div>' +
            '</div>' +
            '<div class="lb-pts">' + fmt(r.total) + '<small>p</small></div>' +
          '</div>' +
          renderScoreViz(r, max) +
          '<div class="lb-break">' +
            '<span>Klart <b>' + (banaStats.filled + simStats.filled) + '/36</b></span>' +
            '<span>Bana <b>' + fmt(r.stableBana) + '</b></span>' +
            '<span>Sim <b>'  + fmt(r.stableSim)  + '</b></span>' +
            '<span>CTP <b>'  + fmt(r.ctp)         + '</b></span>' +
            '<span>Drive <b>'+ fmt(r.ld)           + '</b></span>' +
            '<span>Bonus <b>'+ fmt(r.tri + r.cb)   + '</b></span>' +
            '<span>Handicap <b>' + fmt(r.hcp)      + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div>'
    ));
  });

  body.appendChild(el(
    '<div class="legend" style="margin-top:14px">' +
      '<span><i class="swatch s-stable"></i>Stableford</span>' +
      '<span><i class="swatch s-ctp"></i>Closest to pin</span>' +
      '<span><i class="swatch s-ld"></i>Längsta drive</span>' +
      '<span><i class="swatch s-tri"></i>Bonusar</span>' +
      '<span><i class="swatch s-cb"></i>Comeback</span>' +
      '<span><i class="swatch s-hcp"></i>Handicap</span>' +
      '<span><i class="swatch s-neg"></i>Avdrag</span>' +
    '</div>'
  ));
  box.appendChild(card);

  /* Leaderboard movement (snapshots) */
  const snaps = store.S.snapshots || [];
  if (snaps.length > 1 && store.S.players.length > 1) {
    const first = snaps[0].rankings;
    const last  = snaps[snaps.length - 1].rankings;
    const mv = el('<section class="card"><div class="card-head light">Rörelser i ställningen<span style="font-family:Inter;letter-spacing:0;text-transform:none;font-size:12px;font-weight:400">' + snaps.length + ' ögonblicksbilder</span></div><div class="card-body" id="mvb"></div></section>');
    const mvb = mv.querySelector('#mvb');
    mvb.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Positionsförändring sedan första registrerade hålet i den pågående tävlingen.</p>'));
    sorted.forEach(p => {
      const nowPos   = last.indexOf(p.id);
      const thenPos  = first.indexOf(p.id);
      const delta    = thenPos === -1 || nowPos === -1 ? null : thenPos - nowPos; // positive = improved
      const arrow    = delta === null ? '–' : (delta > 0 ? '▲' + delta : (delta < 0 ? '▼' + Math.abs(delta) : '='));
      const color    = delta === null || delta === 0 ? 'var(--muted)' : (delta > 0 ? 'var(--blue)' : 'var(--warn)');
      mvb.appendChild(el(
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line)">' +
          '<span>' + esc(p.name) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-weight:600;color:' + color + '">' + esc(arrow) + '</span>' +
        '</div>'
      ));
    });
    box.appendChild(mv);
  }

  /* Team standings */
  const teams = computeTeams(res);
  if (teams.length > 0) {
    const tc = el('<section class="card"><div class="card-head light">Lagställning</div><div class="card-body" id="tbs"></div></section>');
    const tbs = tc.querySelector('#tbs');
    tbs.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Poängmodell: ' + esc(teams[0].mode === 'bestball' ? 'Best-ball (bäste spelare per lag)' : 'Summering') + '</p>'));
    const teamsSorted = [...teams].sort((a, b) => b.total - a.total);
    const teamMax = Math.max(1, ...teamsSorted.map(t => t.total));
    teamsSorted.forEach((t, i) => {
      tbs.appendChild(el(
        '<div class="lb-row' + (i === 0 && t.total > 0 ? ' lead' : '') + '">' +
          '<div class="rank">' + (i + 1) + '</div>' +
          '<div class="lb-main">' +
            '<div class="lb-top">' +
              '<div>' +
                '<div class="lb-name">' + esc(t.name) + '</div>' +
                '<div class="empty-note" style="font-size:11px;margin-top:2px">' + esc(t.members.join(', ')) + '</div>' +
              '</div>' +
              '<div class="lb-pts">' + fmt(t.total) + '<small>p</small></div>' +
            '</div>' +
            '<div class="bar"><i class="s-stable" style="width:' + (t.total / teamMax * 100) + '%"></i></div>' +
          '</div>' +
        '</div>'
      ));
    });
    box.appendChild(tc);
  }

  /* Prizes */
  const dp   = el('<section class="card"><div class="card-head light">Priser &amp; push</div><div class="card-body" id="dp"></div></section>');
  const d    = dp.querySelector('#dp');
  const rows = [];
  if (ruleEnabled('ctp'))      rows.push(['Closest to pin', r => r.ctp]);
  if (ruleEnabled('ld'))       rows.push(['Längsta drive',  r => r.ld]);
  if (ruleEnabled('clean'))    rows.push(['Ren rond',       r => r.tri]);
  if (ruleEnabled('comeback')) rows.push(['Comeback',       r => r.cb]);

  rows.forEach(([label, pick]) => {
    const lead = prizeLeaders(res, pick);
    d.appendChild(el(
      '<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line)">' +
        '<span style="color:var(--muted);font-size:13px">' + label + '</span>' +
        '<span style="text-align:right;font-size:13.5px">' +
          (lead.who.length
            ? esc(lead.who.join(', ')) + ' <b style="font-family:\'IBM Plex Mono\',monospace">' + fmt(lead.best) + 'p</b>'
            : '<span style="color:#B7C2D0">Ej avgjort</span>') +
        '</span>' +
      '</div>'
    ));
  });
  d.appendChild(el('<p class="empty-note" style="margin:12px 0 0">Preset: ' + esc(mode.name) + ' · Handicap: ' + esc(handicapModeLabel(mode.handicap.mode)) + '</p>'));
  box.appendChild(dp);

  /* Live comeback tracker */
  const liveMax = Math.max(0, ...store.S.players.map(p => res[p.id].live.holes));
  if (liveMax > 0 && ruleEnabled('comeback')) {
    const done = store.S.players.every(p => roundStable('sim', p.id).complete);
    const cbc  = el(
      '<section class="card">' +
        '<div class="card-head light">Comeback just nu' +
          '<span style="font-family:Inter;letter-spacing:0;text-transform:none;font-size:12px;font-weight:400">' + (done ? 'Slutresultat' : 'Preliminärt') + '</span>' +
        '</div>' +
        '<div class="card-body" id="cbl"></div>' +
      '</section>'
    );
    const cbl = cbc.querySelector('#cbl');
    cbl.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Simulator minus bana på de hål som är ifyllda i båda ronderna. ' + (done ? '' : 'Ändras medan ronden pågår.') + '</p>'));

    const ranked = [...store.S.players]
      .filter(p => res[p.id].live.holes > 0)
      .sort((a, b) => res[b.id].live.delta - res[a.id].live.delta);
    const top = ranked.length ? res[ranked[0].id].live.delta : 0;

    ranked.forEach(p => {
      const L    = res[p.id].live;
      const lead = L.delta === top && L.delta > 0;
      cbl.appendChild(el(
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 0;border-top:1px solid var(--line)">' +
          '<span style="font-weight:' + (lead ? '600' : '400') + '">' + esc(p.name) +
            (lead ? ' <span class="tag" style="background:#F5EBC8;color:#8A6D10">Leder</span>' : '') +
          '</span>' +
          '<span style="text-align:right;white-space:nowrap">' +
            '<b style="font-family:\'IBM Plex Mono\',monospace;color:' + (L.delta > 0 ? 'var(--blue)' : 'var(--muted)') + '">' +
              (L.delta > 0 ? '+' : '') + L.delta +
            '</b>' +
            '<span class="empty-note" style="margin-left:8px">' + L.bana + '→' + L.sim + ' p · ' + L.holes + ' hål</span>' +
          '</span>' +
        '</div>'
      ));
    });
    box.appendChild(cbc);
  }

  /* Player stats */
  if (store.S.players.length > 0) {
    const statsCard = el(
      '<section class="card">' +
        '<div class="card-head light">Spelstatistik</div>' +
        '<div class="card-body" id="psc"></div>' +
      '</section>'
    );
    const psc = statsCard.querySelector('#psc');
    psc.appendChild(el('<p class="empty-note" style="margin:0 0 12px">Fördelning per spelare. Visar bara hål som är inmatade.</p>'));

    sorted.forEach(p => {
      const st = playerStats(p.id);
      const banaFilled = roundStable('bana', p.id).filled;
      const simFilled  = roundStable('sim',  p.id).filled;
      if (!banaFilled && !simFilled) return;

      const statRow = (label, bv, sv) =>
        '<tr><td class="stat-lbl">' + label + '</td>' +
          '<td class="stat-val">' + (bv ?? '–') + '</td>' +
          '<td class="stat-val">' + (sv ?? '–') + '</td>' +
        '</tr>';

      const fmtAvg = v => v != null ? (Math.round(v * 10) / 10).toString().replace('.', ',') : '–';
      const fmtDiff = v => v === null ? '–' : (v > 0 ? '+' + v : String(v));

      const sc = el(
        '<div class="subcard" style="margin-bottom:8px">' +
          '<h4>' + esc(p.name) + '</h4>' +
          '<table class="stat-table">' +
            '<thead><tr><th></th><th>Bana</th><th>Sim</th></tr></thead>' +
            '<tbody>' +
              statRow('Slag/hål', fmtAvg(st.bana.avg), fmtAvg(st.sim.avg)) +
              statRow('Eagle+',   st.bana.eagles,        st.sim.eagles) +
              statRow('Birdie',   st.bana.birdies,       st.sim.birdies) +
              statRow('Par',      st.bana.pars,          st.sim.pars) +
              statRow('Bogey',    st.bana.bogeys,        st.sim.bogeys) +
              statRow('Dubbel+',  st.bana.doubles + st.bana.triples, st.sim.doubles + st.sim.triples) +
              statRow('Bästa hål', fmtDiff(st.bana.best),  fmtDiff(st.sim.best)) +
              statRow('Sämsta hål', fmtDiff(st.bana.worst), fmtDiff(st.sim.worst)) +
            '</tbody>' +
          '</table>' +
        '</div>'
      );
      psc.appendChild(sc);
    });

    box.appendChild(statsCard);
  }

  /* Active rules */
  box.appendChild(el(
    '<section class="card">' +
      '<div class="card-head light">Aktivt spelformat</div>' +
      '<div class="card-body"><ul class="rules" style="margin:0;padding-left:18px">' +
        gamemodeLines().map(line => '<li>' + esc(line) + '</li>').join('') +
      '</ul></div>' +
    '</section>'
  ));

  return box;
}

/* ---------- History tab renderer ---------- */

export function renderHistory(archivedEvents, onView) {
  const box = el('<div></div>');

  box.appendChild(el(
    '<section class="card">' +
      '<div class="card-head">Tävlingshistorik</div>' +
      '<div class="card-body">' +
        '<p class="empty-note" style="margin:0 0 10px">Arkiverade tävlingar visas nedan. Klicka för att se ställningen från det eventet.</p>' +
      '</div>' +
    '</section>'
  ));

  if (!archivedEvents.length) {
    box.appendChild(el('<section class="card"><div class="card-body"><p class="empty-note">Inga arkiverade tävlingar än. Arkivera en tävling via Inställningar → Arkivera.</p></div></section>'));
    return box;
  }

  archivedEvents.forEach((evt, idx) => {
    const c = el(
      '<section class="card">' +
        '<div class="card-body">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
            '<div>' +
              '<div style="font-weight:600;font-size:15px">' + esc(evt.name || 'Tävling ' + (idx + 1)) + '</div>' +
              '<div class="empty-note" style="margin-top:2px">' + esc(evt.date || '') + (evt.archivedAt ? ' · arkiverat ' + new Date(evt.archivedAt).toLocaleDateString('sv-SE') : '') + '</div>' +
            '</div>' +
            '<button class="btn ghost" data-idx="' + idx + '">Visa ›</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
    c.querySelector('button').onclick = () => onView(idx);
    box.appendChild(c);
  });

  return box;
}
