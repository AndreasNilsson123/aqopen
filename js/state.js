import { HOLES, SCHEMA_VERSION, ROUND_IDS, PRESET_LIBRARY, TIEBREAK_OPTIONS } from './constants.js';
import { clone, uid, clamp, num } from './utils.js';

export function makePlayer(name) {
  return { id: uid(), name, handicap: 0 };
}

export function presetConfig(id = 'aqopen') {
  return clone(PRESET_LIBRARY[id] || PRESET_LIBRARY.aqopen);
}

export function defaultState() {
  const pars  = [4,4,3,5,4,4,3,4,5,4,3,4,5,4,4,3,4,5];
  const names = ['Spelare 1','Spelare 2','Spelare 3','Spelare 4'];
  return {
    v: SCHEMA_VERSION,
    event: 'AqOpen Sweden',
    players: names.map(makePlayer),
    rounds: {
      bana: { label: 'Bana (ute)',  courseName: '', pars: [...pars], ctp: [3,12], ld: []    },
      sim:  { label: 'Simulator',   courseName: '', pars: [...pars], ctp: [7,16], ld: [5,14] }
    },
    gamemode: presetConfig('aqopen'),
    live: null,
    customCourses: [],
    strokes:  { bana: {}, sim: {} },
    ctpWins:  { bana: {}, sim: {} },
    ldWins:   { sim: {} },
    teams:     { enabled: false, groups: [], names: [] },
    snapshots: []
  };
}

export function sanitizePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.map((p, i) => ({
    id:       typeof p?.id === 'string' && p.id ? p.id : uid(),
    name:     typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : 'Spelare ' + (i + 1),
    handicap: clamp(num(p?.handicap, 0), -36, 54)
  }));
}

export function sanitizeRound(round, fallback) {
  const src  = round && typeof round === 'object' ? round : {};
  const pars = Array.isArray(src.pars) ? src.pars : fallback.pars;
  return {
    label:      typeof src.label === 'string' && src.label.trim() ? src.label.trim() : fallback.label,
    courseName: typeof src.courseName === 'string' ? src.courseName : '',
    pars:       Array.from({ length: HOLES }, (_, i) => clamp(num(pars[i], fallback.pars[i] || 4), 3, 6)),
    ctp: Array.isArray(src.ctp) ? src.ctp.map(v => clamp(parseInt(v, 10) || 0, 1, HOLES)).filter(Boolean) : [...fallback.ctp],
    ld:  Array.isArray(src.ld)  ? src.ld.map(v  => clamp(parseInt(v, 10) || 0, 1, HOLES)).filter(Boolean) : [...fallback.ld]
  };
}

export function sanitizeStrokeBucket(bucket, players) {
  const out = {};
  players.forEach(p => {
    const src = Array.isArray(bucket?.[p.id]) ? bucket[p.id] : [];
    out[p.id] = Array.from({ length: HOLES }, (_, i) => {
      const v = parseInt(src[i], 10);
      return Number.isFinite(v) ? clamp(v, 1, 20) : null;
    });
  });
  return out;
}

export function sanitizeWinnerMap(map, players) {
  const valid = new Set(players.map(p => p.id));
  const out   = {};
  Object.entries(map || {}).forEach(([hole, ids]) => {
    const h     = parseInt(hole, 10);
    if (!(h >= 1 && h <= HOLES)) return;
    const clean = [...new Set((Array.isArray(ids) ? ids : []).filter(id => valid.has(id)))];
    if (clean.length) out[h] = clean;
  });
  return out;
}

const VALID_TIEBREAKS = new Set(TIEBREAK_OPTIONS.map(o => o.value));

export function normalizeGamemode(raw) {
  const src      = raw && typeof raw === 'object' ? raw : {};
  const presetId = typeof src.presetId === 'string' && PRESET_LIBRARY[src.presetId] ? src.presetId : 'aqopen';
  const gm       = presetConfig(presetId);

  if (typeof src.name === 'string' && src.name.trim()) gm.name = src.name.trim();

  const table = src.stableford || {};
  Object.keys(gm.stableford).forEach(k => {
    gm.stableford[k] = clamp(num(table[k], gm.stableford[k]), -20, 50);
  });

  const bonuses = src.bonuses || {};
  ['ctp', 'ld', 'clean'].forEach(key => {
    const current = bonuses[key] || {};
    gm.bonuses[key].enabled = current.enabled == null ? gm.bonuses[key].enabled : !!current.enabled;
    gm.bonuses[key].points  = clamp(num(current.points, gm.bonuses[key].points), -50, 50);
    const rounds            = current.rounds || {};
    gm.bonuses[key].rounds  = {
      bana: rounds.bana == null ? gm.bonuses[key].rounds.bana : !!rounds.bana,
      sim:  rounds.sim  == null ? gm.bonuses[key].rounds.sim  : !!rounds.sim
    };
  });
  gm.bonuses.comeback.enabled = bonuses.comeback?.enabled == null ? gm.bonuses.comeback.enabled : !!bonuses.comeback.enabled;
  gm.bonuses.comeback.points  = clamp(num(bonuses.comeback?.points, gm.bonuses.comeback.points), -50, 50);

  const handicap  = src.handicap || {};
  const mode      = ['none','flat','allowance'].includes(handicap.mode) ? handicap.mode : gm.handicap.mode;
  const appliesTo = ['event','bana','sim','both'].includes(handicap.appliesTo) ? handicap.appliesTo : gm.handicap.appliesTo;
  gm.handicap = {
    mode,
    allowance:  clamp(num(handicap.allowance,  gm.handicap.allowance),  0,   200),
    pointValue: clamp(num(handicap.pointValue, gm.handicap.pointValue), -10, 10),
    appliesTo
  };

  gm.tiebreak = VALID_TIEBREAKS.has(src.tiebreak) ? src.tiebreak : (gm.tiebreak || 'none');

  if (src.presetId === 'custom' || !PRESET_LIBRARY[src.presetId]) gm.presetId = 'custom';
  return gm;
}

export function sanitizeCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses
    .filter(c => c && typeof c.name === 'string' && c.name.trim() && Array.isArray(c.pars) && c.pars.length === HOLES)
    .map(c => {
      const out = {
        name: c.name.trim(),
        pars: c.pars.map(v => clamp(num(v, 4), 3, 6))
      };
      // Preserve optional rich metadata.
      if (typeof c.slope    === 'number') out.slope    = clamp(c.slope, 55, 155);
      if (typeof c.rating   === 'number') out.rating   = c.rating;
      if (typeof c.location === 'string') out.location = c.location.slice(0, 120);
      if (typeof c.website  === 'string') out.website  = c.website.slice(0, 200);
      if (Array.isArray(c.holeNames) && c.holeNames.length === HOLES) {
        out.holeNames = c.holeNames.map(n => String(n || '').slice(0, 40));
      }
      if (Array.isArray(c.strokeIndex) && c.strokeIndex.length === HOLES) {
        out.strokeIndex = c.strokeIndex.map(v => clamp(parseInt(v, 10) || 1, 1, HOLES));
      }
      if (typeof c.note === 'string') out.note = c.note.slice(0, 200);
      if (c.own) out.own = true;
      return out;
    });
}

export function sanitizeTeams(teams, players) {
  const validIds = new Set(players.map(p => p.id));
  if (!teams || typeof teams !== 'object' || !teams.enabled) {
    return { enabled: false, groups: [], names: [], scoring: 'sum' };
  }
  const groups = Array.isArray(teams.groups)
    ? teams.groups.map(g => (Array.isArray(g) ? g.filter(id => validIds.has(id)) : []))
    : [];
  const names = Array.isArray(teams.names)
    ? teams.names.map(n => String(n || '').slice(0, 60))
    : [];
  const scoring = teams.scoring === 'bestball' ? 'bestball' : 'sum';
  return { enabled: true, groups, names, scoring };
}

export function sanitizeSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .filter(s => s && typeof s.hole === 'number' && typeof s.rid === 'string' && Array.isArray(s.rankings))
    .slice(-200)
    .map(s => ({ hole: s.hole, rid: s.rid, rankings: s.rankings.filter(id => typeof id === 'string') }));
}

export function fixHoleChoicesState(state, rid) {
  const R    = state.rounds[rid];
  const par3 = R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p === 3).map(x => x.h);
  R.ctp = [...new Set(R.ctp.filter(h => par3.includes(h)))];
  par3.forEach(h => { if (R.ctp.length < 2 && !R.ctp.includes(h)) R.ctp.push(h); });
  R.ctp.sort((a, b) => a - b);

  if (rid === 'sim') {
    const long = R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p >= 4);
    R.ld = [...new Set(R.ld.filter(h => long.some(x => x.h === h)))];
    long.filter(x => x.p === 5).forEach(x => { if (R.ld.length < 2 && !R.ld.includes(x.h)) R.ld.push(x.h); });
    R.ld.sort((a, b) => a - b);
  }

  Object.keys(state.ctpWins[rid]).forEach(h => { if (!R.ctp.includes(+h)) delete state.ctpWins[rid][h]; });
  if (rid === 'sim') Object.keys(state.ldWins.sim).forEach(h => { if (!R.ld.includes(+h)) delete state.ldWins.sim[h]; });
}

export function migrateState(raw) {
  const base    = defaultState();
  const src     = raw && typeof raw === 'object' ? raw : {};
  const players = sanitizePlayers(src.players);
  const state   = {
    v:       SCHEMA_VERSION,
    event:   typeof src.event === 'string' && src.event.trim() ? src.event.trim() : base.event,
    players: players.length ? players : base.players,
    rounds: {
      bana: sanitizeRound(src.rounds?.bana, base.rounds.bana),
      sim:  sanitizeRound(src.rounds?.sim,  base.rounds.sim)
    },
    gamemode: normalizeGamemode(src.gamemode),
    live: src.live && ROUND_IDS.includes(src.live.round)
      ? { round: src.live.round, hole: clamp(parseInt(src.live.hole, 10) || 1, 1, HOLES) }
      : null,
    customCourses: sanitizeCourses(src.customCourses),
    strokes: {
      bana: sanitizeStrokeBucket(src.strokes?.bana, players.length ? players : base.players),
      sim:  sanitizeStrokeBucket(src.strokes?.sim,  players.length ? players : base.players)
    },
    ctpWins: {
      bana: sanitizeWinnerMap(src.ctpWins?.bana, players.length ? players : base.players),
      sim:  sanitizeWinnerMap(src.ctpWins?.sim,  players.length ? players : base.players)
    },
    ldWins: {
      sim: sanitizeWinnerMap(src.ldWins?.sim, players.length ? players : base.players)
    },
    teams:     sanitizeTeams(src.teams, players.length ? players : base.players),
    snapshots: sanitizeSnapshots(src.snapshots)
  };
  fixHoleChoicesState(state, 'bana');
  fixHoleChoicesState(state, 'sim');
  return state;
}
