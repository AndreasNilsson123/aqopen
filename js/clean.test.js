import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateState } from './state.js';
import { computeFromRaw } from './scoring.js';

function filled(strokes, fill = 4) {
  return Array.from({ length: 18 }, (_, i) => strokes[i] ?? fill);
}

test('clean bonus defaults to full 18 holes when segment size is missing', () => {
  const state = migrateState({
    gamemode: {
      bonuses: {
        clean: { enabled: true, points: 5, rounds: { bana: true, sim: true } }
      }
    }
  });

  assert.equal(state.gamemode.bonuses.clean.segmentHoles, 18);
});

test('clean bonus can be awarded for each 9-hole segment', () => {
  const state = migrateState({
    players: [{ id: 'p1', name: 'Player 1', handicap: 0 }],
    gamemode: {
      bonuses: {
        clean: { enabled: true, points: 5, rounds: { bana: true, sim: false }, segmentHoles: 9 },
        ldctp: { enabled: false },
        comeback: { enabled: false }
      }
    },
    strokes: {
      bana: { p1: filled([]) },
      sim: { p1: [] }
    }
  });
  const res = computeFromRaw(state);

  assert.equal(res.p1.cleanBana, 2);
  assert.equal(res.p1.tri, 10);
});

test('clean bonus uses consecutive clean holes instead of requiring holes 1-9', () => {
  const state = migrateState({
    players: [{ id: 'p1', name: 'Player 1', handicap: 0 }],
    gamemode: {
      bonuses: {
        clean: { enabled: true, points: 5, rounds: { bana: true, sim: false }, segmentHoles: 9 },
        ldctp: { enabled: false },
        comeback: { enabled: false }
      }
    },
    strokes: {
      bana: {
        p1: [7, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, null, null, null, null, null, null]
      },
      sim: { p1: [] }
    }
  });
  const res = computeFromRaw(state);

  assert.equal(res.p1.cleanBana, 1);
  assert.equal(res.p1.tri, 5);
});
