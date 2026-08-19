/**
 * ui/leaderboard.js – renders the leaderboard tab.
 */
import { ROUND_IDS } from '../constants.js';
import { fmt, el, esc } from '../utils.js';
import { store } from '../store.js';
import {
  compute, gm, ruleEnabled, roundStable,
  handicapModeLabel, gamemodeLines, arr, holePoints
} from '../scoring.js';

function prizeLeaders(res, pick) {
  const vals = store.S.players.map(p => ({ p, v: pick(res[p.id]) })).filter(x => x.v > 0);
  const best = vals.length ? Math.max(...vals.map(x => x.v)) : 0;
  return { best, who: vals.filter(x => x.v === best).map(x => x.p.name) };
}

export function renderLeaderboard() {
  const res    = compute();
  const sorted = [...store.S.players].sort((a, b) => res[b.id].total - res[a.id].total);
  const max    = Math.max(1, ...store.S.players.map(p => res[p.id].total));
  const box    = el('<div></div>');
  const mode   = gm();

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
    const seg = (cls, val) => val > 0 ? '<i class="' + cls + '" style="width:' + (val / max * 100) + '%"></i>' : '';
    const badges = [];
    if (i === 0 && r.total > 0) badges.push('Leder');
    if (r.delta != null && r.delta > 0) badges.push('+' + fmt(r.delta) + ' simform');
    badges.push(...r.badges.slice(0, 2));

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
          '<div class="bar">' +
            seg('s-stable', r.stableBana + r.stableSim) +
            seg('s-ctp', r.ctp) + seg('s-ld', r.ld) +
            seg('s-tri', r.tri) + seg('s-cb', r.cb) +
            seg('s-hcp', r.hcp) +
          '</div>' +
          '<div class="lb-break">' +
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
    '</div>'
  ));
  box.appendChild(card);

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
