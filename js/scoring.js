/**
 * scoring.js – pure scoring / business-logic helpers.
 *
 * All functions are side-effect free except `arr()`, which lazily initialises
 * the stroke array inside `store.S.strokes` the first time it is called for a
 * given player/round combination.
 */
import { HOLES, ROUND_IDS, ROUND_LABELS } from './constants.js';
import { clamp, num, fmt } from './utils.js';
import { presetConfig } from './state.js';
import { store } from './store.js';

/* ---------- gamemode helpers ---------- */

export function gm() {
  return store.S.gamemode || presetConfig('aqopen');
}

export function ruleCfg(key) {
  return gm().bonuses[key];
}

export function ruleEnabled(key, rid) {
  const rule = ruleCfg(key);
  if (!rule || !rule.enabled) return false;
  if (rid == null) return true;
  if (!rule.rounds) return true;
  return !!rule.rounds[rid];
}

export function handicapModeLabel(mode) {
  return ({ none: 'Ingen', flat: 'Fast bonus', allowance: 'Procentuell' }[mode] || 'Ingen');
}

export function handicapAppliesLabel(appliesTo) {
  return ({ event: 'Totalt', both: 'Båda ronderna', bana: 'Bana', sim: 'Simulator' }[appliesTo] || 'Totalt');
}

export function rulePrizeLabel(key) {
  return ({ ctp: 'Closest to pin', ld: 'Längsta drive', clean: 'Ren rond', comeback: 'Comeback' }[key] || key);
}

export function stablefordSummary(mode = gm()) {
  const m = mode.stableford;
  return [
    'Eagle+ '   + fmt(m.eaglePlus),
    'Birdie '   + fmt(m.birdie),
    'Par '      + fmt(m.par),
    'Bogey '    + fmt(m.bogey),
    'Dubbel '   + fmt(m.double),
    'Trippel+ ' + fmt(m.triple)
  ].join(' · ');
}

export function gamemodeLines(mode = gm()) {
  const lines = ['Stableford: ' + stablefordSummary(mode) + '.'];

  if (ruleEnabled('ctp')) {
    const c      = ruleCfg('ctp');
    const rounds = ROUND_IDS.filter(rid => c.rounds[rid]).map(rid => ROUND_LABELS[rid]).join(', ');
    lines.push('Closest to pin: ' + fmt(c.points) + ' poäng på ' + rounds.toLowerCase() + '.');
  }
  if (ruleEnabled('ld')) {
    const l = ruleCfg('ld');
    lines.push('Längsta drive: ' + fmt(l.points) + ' poäng på simulatorhål.');
  }
  if (ruleEnabled('clean')) {
    const cl     = ruleCfg('clean');
    const rounds = ROUND_IDS.filter(rid => cl.rounds[rid]).map(rid => ROUND_LABELS[rid]).join(', ');
    lines.push('Ren rond: ' + fmt(cl.points) + ' poäng på ' + rounds.toLowerCase() + '.');
  }
  if (ruleEnabled('comeback')) {
    lines.push('Comeback: ' + fmt(ruleCfg('comeback').points) + ' poäng till största förbättringen.');
  }

  const hc = mode.handicap;
  if (hc.mode !== 'none') {
    const detail = hc.mode === 'flat'
      ? 'handicap × ' + fmt(hc.pointValue)
      : 'handicap × ' + fmt(hc.allowance / 100).replace('.', ',') + ' × ' + fmt(hc.pointValue);
    lines.push('Handicap: ' + detail + ' på ' + handicapAppliesLabel(hc.appliesTo).toLowerCase() + '.');
  } else {
    lines.push('Handicap: avstängt.');
  }
  return lines;
}

/* ---------- hole scoring ---------- */

export function holePoints(strokes, par, mode = gm()) {
  if (strokes == null) return null;
  const d = strokes - par;
  if (d <= -2) return mode.stableford.eaglePlus;
  if (d === -1) return mode.stableford.birdie;
  if (d === 0)  return mode.stableford.par;
  if (d === 1)  return mode.stableford.bogey;
  if (d === 2)  return mode.stableford.double;
  return mode.stableford.triple;
}

export function holeLabel(strokes, par) {
  if (strokes == null) return '';
  const d = strokes - par;
  if (d <= -2) return 'Eagle+';
  if (d === -1) return 'Birdie';
  if (d === 0)  return 'Par';
  if (d === 1)  return 'Bogey';
  if (d === 2)  return 'Dubbel';
  return 'Trippel+';
}

/** Returns (and lazily initialises) the stroke array for a player in a round. */
export function arr(roundId, pid) {
  const r = store.S.strokes[roundId] || (store.S.strokes[roundId] = {});
  if (!r[pid]) r[pid] = new Array(HOLES).fill(null);
  if (r[pid].length !== HOLES)
    r[pid] = r[pid].concat(new Array(HOLES).fill(null)).slice(0, HOLES);
  return r[pid];
}

export function roundStable(roundId, pid) {
  const a = arr(roundId, pid), pars = store.S.rounds[roundId].pars;
  let sum = 0, filled = 0, clean = true;
  for (let i = 0; i < HOLES; i++) {
    if (a[i] == null) continue;
    filled++;
    sum += holePoints(a[i], pars[i]);
    if (a[i] - pars[i] >= 3) clean = false;
  }
  return { sum, filled, complete: filled === HOLES, clean };
}

export function splitPoints(winners, total) {
  const out = {};
  if (!winners || !winners.length) return out;
  const each = total / winners.length;
  winners.forEach(p => { out[p] = (out[p] || 0) + each; });
  return out;
}

export function playerHandicap(player) {
  return clamp(num(player?.handicap, 0), -36, 54);
}

export function handicapRoundBonus(player, rid, stats) {
  const cfg = gm().handicap;
  if (cfg.mode === 'none') return 0;
  if (cfg.appliesTo === 'event') return 0;
  if (cfg.appliesTo !== 'both' && cfg.appliesTo !== rid) return 0;
  if (!stats?.filled) return 0;
  const hcp = playerHandicap(player);
  if (!hcp) return 0;
  const basePoints = cfg.mode === 'flat' ? hcp : hcp * (cfg.allowance / 100);
  return basePoints * cfg.pointValue;
}

export function handicapEventBonus(player, roundStats) {
  const cfg = gm().handicap;
  if (cfg.mode === 'none' || cfg.appliesTo !== 'event') return 0;
  const totalFilled = ROUND_IDS.reduce((n, rid) => n + (roundStats[rid]?.filled || 0), 0);
  if (!totalFilled) return 0;
  const hcp = playerHandicap(player);
  if (!hcp) return 0;
  const basePoints = cfg.mode === 'flat' ? hcp : hcp * (cfg.allowance / 100);
  return basePoints * cfg.pointValue;
}

/* ---------- full event compute ---------- */

export function compute() {
  const res   = {};
  const stats = { bana: {}, sim: {} };

  store.S.players.forEach(p => {
    stats.bana[p.id] = roundStable('bana', p.id);
    stats.sim[p.id]  = roundStable('sim',  p.id);
    res[p.id] = {
      stableBana: stats.bana[p.id].sum,
      stableSim:  stats.sim[p.id].sum,
      ctp: 0, ld: 0, tri: 0, cb: 0,
      hcpBana: 0, hcpSim: 0, hcpEvent: 0, hcp: 0, total: 0,
      cleanBana: false, cleanSim: false, delta: null, badges: []
    };
  });

  store.S.players.forEach(p => {
    const b = stats.bana[p.id], s = stats.sim[p.id], r = res[p.id];
    if (ruleEnabled('clean', 'bana') && b.complete && b.clean) { r.tri += ruleCfg('clean').points; r.cleanBana = true; }
    if (ruleEnabled('clean', 'sim')  && s.complete && s.clean) { r.tri += ruleCfg('clean').points; r.cleanSim  = true; }
    if (b.complete && s.complete) r.delta = s.sum - b.sum;
    r.hcpBana  = handicapRoundBonus(p, 'bana', b);
    r.hcpSim   = handicapRoundBonus(p, 'sim',  s);
    r.hcpEvent = handicapEventBonus(p, { bana: b, sim: s });
    r.hcp      = r.hcpBana + r.hcpSim + r.hcpEvent;
  });

  if (ruleEnabled('ctp')) {
    ['bana', 'sim'].forEach(rid => {
      if (!ruleEnabled('ctp', rid)) return;
      const wins = store.S.ctpWins[rid] || {};
      Object.keys(wins).forEach(h => {
        const add = splitPoints(wins[h], ruleCfg('ctp').points);
        Object.keys(add).forEach(pid => { if (res[pid]) res[pid].ctp += add[pid]; });
      });
    });
  }

  if (ruleEnabled('ld', 'sim')) {
    const wins = store.S.ldWins.sim || {};
    Object.keys(wins).forEach(h => {
      const add = splitPoints(wins[h], ruleCfg('ld').points);
      Object.keys(add).forEach(pid => { if (res[pid]) res[pid].ld += add[pid]; });
    });
  }

  if (ruleEnabled('comeback')) {
    const eligible = store.S.players.filter(p => res[p.id].delta != null && res[p.id].delta > 0);
    if (eligible.length) {
      const best    = Math.max(...eligible.map(p => res[p.id].delta));
      const winners = eligible.filter(p => res[p.id].delta === best).map(p => p.id);
      const add     = splitPoints(winners, ruleCfg('comeback').points);
      Object.keys(add).forEach(pid => { res[pid].cb += add[pid]; });
    }
  }

  store.S.players.forEach(p => {
    const b = arr('bana', p.id), sm = arr('sim', p.id);
    let db = 0, ds = 0, n = 0;
    for (let i = 0; i < HOLES; i++) {
      if (b[i] != null && sm[i] != null) {
        db += holePoints(b[i], store.S.rounds.bana.pars[i]);
        ds += holePoints(sm[i], store.S.rounds.sim.pars[i]);
        n++;
      }
    }
    res[p.id].live  = { holes: n, delta: n ? ds - db : null, bana: db, sim: ds };
    res[p.id].total = res[p.id].stableBana + res[p.id].stableSim +
                      res[p.id].ctp + res[p.id].ld + res[p.id].tri +
                      res[p.id].cb + res[p.id].hcp;
  });

  const comebackLead = Math.max(0, ...store.S.players.map(p => res[p.id].cb));
  store.S.players.forEach(p => {
    const r = res[p.id];
    if (r.cleanBana || r.cleanSim) r.badges.push('Ren rond');
    if (r.hcp) r.badges.push('HCP ' + (r.hcp > 0 ? '+' : '') + fmt(r.hcp));
    if (comebackLead > 0 && r.cb === comebackLead) r.badges.push('Comeback-ledare');
  });

  return res;
}
