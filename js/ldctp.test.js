import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateState } from './state.js';
import { ldCtpEligibleHoles } from './scoring.js';
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
