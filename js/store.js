/**
 * store.js – shared mutable application state.
 *
 * All mutable values live on the `store` object so any module can read/write
 * them without import-cycle issues.  The canonical state document is
 * `store.S`; sync metadata lives alongside it.
 */
import { migrateState, defaultState } from './state.js';
import { BUILTIN_COURSES } from './constants.js';

const PREFS_KEY      = 'aqopen-local-prefs-v1';
const RESET_BACKUP_KEY = 'aqopen-reset-backup-v1';

function hasLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function readJson(key, fallback) {
  if (!hasLocalStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

function loadLocalPrefs() {
  const raw = readJson(PREFS_KEY, {});
  return {
    editKey: typeof raw?.editKey === 'string' ? raw.editKey : '',
    spectator: !!raw?.spectator
  };
}

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
  lastError: '',
  authRequired: false,
  lastSyncedAt: '',

  /* ---- browser-local preferences ---- */
  local: loadLocalPrefs()
};

/* ---- course library ---- */
export let COURSES = BUILTIN_COURSES.slice();

export function setCourses(list) {
  COURSES = list;
}

export function allCourses() {
  return COURSES.concat((store.S.customCourses || []).map(c => ({ ...c, own: true })));
}

export function persistLocalPrefs() {
  writeJson(PREFS_KEY, {
    editKey: store.local.editKey,
    spectator: store.local.spectator
  });
}

export function canEdit() {
  if (store.local.spectator) return false;
  if (!store.authRequired) return true;
  return !!store.local.editKey.trim();
}

export function saveResetBackup(state) {
  writeJson(RESET_BACKUP_KEY, state);
}

export function loadResetBackup() {
  return readJson(RESET_BACKUP_KEY, null);
}

export function clearResetBackup() {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(RESET_BACKUP_KEY);
}
