import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateState } from './state.js';
import { computeFromRaw, ldCtpEligibleHoles } from './scoring.js';
import { ldCtpRoundNote } from './ui/settings.js';

test('fresh state enables combined LD/CTP on every hole', () => {
  const state = migrateState({});
  assert.deepEqual(ldCtpEligibleHoles(state.rounds.bana), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.match(ldCtpRoundNote(state.rounds.bana), /alla 18 hål/);
});

test('legacy state preserves previous combined bonus holes per round', () => {
  const state = migrateState({
    v: 3,
    players: [{ id: 'p1', name: 'Player 1', handicap: 0 }],
    rounds: {
      bana: { label: 'Bana (ute)', courseName: '', pars: new Array(18).fill(4), ctp: [3, 12], ld: [9] },
      sim:  { label: 'Simulator', courseName: '', pars: new Array(18).fill(4), ctp: [7, 16], ld: [5, 14] }
    },
    strokes: { bana: { p1: [] }, sim: { p1: [] } },
    ctpWins: { bana: {}, sim: {} },
    ldWins: { sim: {} }
  });

  assert.deepEqual(ldCtpEligibleHoles(state.rounds.bana), [3, 12]);
  assert.deepEqual(ldCtpEligibleHoles(state.rounds.sim), [5, 7, 14, 16]);
  assert.match(ldCtpRoundNote(state.rounds.sim), /tidigare bonushål/);
});

test('legacy winner maps migrate into one combined per-hole winner list', () => {
  const state = migrateState({
    v: 3,
    players: [
      { id: 'a', name: 'Alice', handicap: 0 },
      { id: 'b', name: 'Bob', handicap: 0 }
    ],
    rounds: {
      bana: { label: 'Bana (ute)', courseName: '', pars: new Array(18).fill(4), ctp: [3, 12] },
      sim:  { label: 'Simulator', courseName: '', pars: new Array(18).fill(4), ctp: [7, 16], ld: [7, 14] }
    },
    strokes: { bana: { a: [], b: [] }, sim: { a: [], b: [] } },
    ctpWins: { bana: { 3: ['a'] }, sim: { 7: ['b'] } },
    ldWins: { sim: { 7: ['a'], 14: ['a', 'b'] } }
  });
  const res = computeFromRaw(state);

  assert.deepEqual(state.ldCtpWins.bana['3'], ['a']);
  assert.deepEqual([...state.ldCtpWins.sim['7']].sort(), ['a', 'b']);
  assert.deepEqual(state.ldCtpWins.sim['14'], ['a', 'b']);
  assert.equal(res.a.ldctp, 2);
  assert.equal(res.b.ldctp, 1);
});
