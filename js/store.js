/**
 * store.js – shared mutable application state.
 *
 * All mutable values live on the `store` object so any module can read/write
 * them without import-cycle issues.  The canonical state document is
 * `store.S`; sync metadata lives alongside it.
 */
import { migrateState, defaultState } from './state.js';
import { HOLES, BUILTIN_COURSES } from './constants.js';
import { clamp, num } from './utils.js';

export const store = {
  /** Main application state document */
  S: migrateState(defaultState()),

  /** Currently visible tab */
  tab: 'lb',

  /** Active player per round in the scorecard view */
  activePlayer: { bana: null, sim: null },

  /* ---- sync metadata ---- */
  rev:       0,
  base:      null,
  offline:   false,
  saveTimer: null,
  inFlight:  false,
  dirty:     false,
  lastError: ''
};

/* ---- course library ---- */
export let COURSES = BUILTIN_COURSES.slice();

export function setCourses(list) {
  COURSES = list;
}

export function allCourses() {
  return COURSES.concat((store.S.customCourses || []).map(c => ({ ...c, own: true })));
}
