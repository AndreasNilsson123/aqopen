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
      bana: { label: 'Bana (ute)',  courseName: '', pars: [...pars] },
      sim:  { label: 'Simulator',   courseName: '', pars: [...pars] }
    },
    gamemode: presetConfig('aqopen'),
    live: null,
    customCourses: [],
    strokes:  { bana: {}, sim: {} },
    ldCtpWins: { bana: {}, sim: {} },
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
    pars:       Array.from({ length: HOLES }, (_, i) => clamp(num(pars[i], fallback.pars[i] || 4), 3, 6))
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

function mergeWinnerMaps(...maps) {
  const out = {};
  maps.forEach(map => {
    Object.entries(map || {}).forEach(([hole, ids]) => {
      const merged = [...new Set([...(out[hole] || []), ...(ids || [])])];
      if (merged.length) out[hole] = merged;
    });
  });
  return out;
}

function combinedWinnerMaps(src, players) {
  const direct = {
    bana: sanitizeWinnerMap(src.ldCtpWins?.bana, players),
    sim:  sanitizeWinnerMap(src.ldCtpWins?.sim,  players)
  };
  const legacyCtp = {
    bana: sanitizeWinnerMap(src.ctpWins?.bana, players),
    sim:  sanitizeWinnerMap(src.ctpWins?.sim,  players)
  };
  const legacyLd = {
    bana: {},
    sim: sanitizeWinnerMap(src.ldWins?.sim, players)
  };
  return {
    bana: mergeWinnerMaps(direct.bana, legacyCtp.bana),
    sim:  mergeWinnerMaps(direct.sim, legacyCtp.sim, legacyLd.sim)
  };
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
  const ldCtp = bonuses.ldctp || {};
  const legacyCtp = bonuses.ctp || {};
  const legacyLd  = bonuses.ld  || {};
  gm.bonuses.ldctp.enabled = ldCtp.enabled != null
    ? !!ldCtp.enabled
    : (legacyCtp.enabled != null ? !!legacyCtp.enabled : (legacyLd.enabled != null ? !!legacyLd.enabled : gm.bonuses.ldctp.enabled));
  gm.bonuses.ldctp.points = 1;
  gm.bonuses.ldctp.rounds = { bana: true, sim: true };

  ['clean'].forEach(key => {
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

  gm.tiebreak = VALID_TIEBREAKS.has(src.tiebreak) ? src.tiebreak : 'none';

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
  const wins = state.ldCtpWins?.[rid] || {};
  Object.keys(wins).forEach(h => {
    if (!(+h >= 1 && +h <= HOLES)) delete wins[h];
  });
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
    ldCtpWins: combinedWinnerMaps(src, players.length ? players : base.players),
    teams:     sanitizeTeams(src.teams, players.length ? players : base.players),
    snapshots: sanitizeSnapshots(src.snapshots)
  };
  fixHoleChoicesState(state, 'bana');
  fixHoleChoicesState(state, 'sim');
  return state;
}
