export const HOLES = 18;
export const SCHEMA_VERSION = 3;
export const ROUND_IDS = ['bana', 'sim'];
export const ROUND_LABELS = { bana: 'Bana (ute)', sim: 'Simulator' };

export const TIEBREAK_OPTIONS = [
  { value: 'none',        label: 'Ingen' },
  { value: 'back9',       label: 'Sista 9 hålen' },
  { value: 'last6',       label: 'Sista 6 hålen' },
  { value: 'last3',       label: 'Sista 3 hålen' },
  { value: 'last1',       label: 'Sista hålet' },
  { value: 'suddenDeath', label: 'Sudden death (markera manuellt)' },
];

export const PRESET_LIBRARY = {
  aqopen: {
    presetId: 'aqopen',
    name: 'AqOpen Classic',
    stableford: { eaglePlus: 12, birdie: 6, par: 3, bogey: 2, double: 1, triple: 0 },
    bonuses: {
      ctp:      { enabled: true,  points: 5,  rounds: { bana: true,  sim: true  } },
      ld:       { enabled: true,  points: 5,  rounds: { bana: false, sim: true  } },
      clean:    { enabled: true,  points: 5,  rounds: { bana: true,  sim: true  } },
      comeback: { enabled: true,  points: 10 }
    },
    handicap: { mode: 'none', allowance: 100, pointValue: 1, appliesTo: 'event' },
    tiebreak: 'none'
  },
  stableford: {
    presetId: 'stableford',
    name: 'Enkel Stableford',
    stableford: { eaglePlus: 5, birdie: 4, par: 3, bogey: 2, double: 1, triple: 0 },
    bonuses: {
      ctp:      { enabled: false, points: 3, rounds: { bana: true,  sim: false } },
      ld:       { enabled: false, points: 3, rounds: { bana: false, sim: true  } },
      clean:    { enabled: false, points: 3, rounds: { bana: true,  sim: true  } },
      comeback: { enabled: false, points: 5 }
    },
    handicap: { mode: 'none', allowance: 100, pointValue: 1, appliesTo: 'event' },
    tiebreak: 'none'
  }
};

export const BUILTIN_COURSES = [
  { name: 'Standard par 72', pars: [4,4,3,5,4,4,3,4,5,4,3,4,5,4,4,3,4,5] },
  { name: 'Standard par 71', pars: [4,4,3,5,4,4,3,4,4,4,3,4,5,4,4,3,4,5] },
  { name: 'Standard par 70', pars: [4,4,3,5,4,4,3,4,4,4,3,4,4,4,4,3,4,5] }
];
