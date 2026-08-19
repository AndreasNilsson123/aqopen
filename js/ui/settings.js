/**
 * ui/settings.js – renders the Inställningar (settings) tab.
 *
 * Settings are organised into collapsible <details> panels so users can focus
 * on the section they need without being overwhelmed by the full flat list.
 *
 * Sections:
 *   1. Tävling      – event name
 *   2. Spelformat   – preset picker + active-rules summary
 *   3. Poängscale   – Stableford point values (advanced, closed by default)
 *   4. Bonusar      – CTP / LD / Clean round / Comeback toggles & values
 *   5. Handicap     – handicap model (advanced, closed by default)
 *   6. Spelare      – player list
 *   7. Bana (ute)   – course, par grid, CTP holes
 *   8. Simulator    – course, par grid, CTP / LD holes
 *   9. Nollställ    – danger zone
 */
import { HOLES, ROUND_IDS, ROUND_LABELS, PRESET_LIBRARY } from '../constants.js';
import { clamp, num, fmt, el, esc } from '../utils.js';
import { makePlayer, presetConfig, fixHoleChoicesState } from '../state.js';
import { store, allCourses } from '../store.js';
import {
  gm, ruleEnabled, ruleCfg, gamemodeLines, stablefordSummary,
  handicapModeLabel, handicapAppliesLabel
} from '../scoring.js';
import { save } from '../sync.js';

/* ---- helpers ---- */

/** Marks the gamemode as "custom" before any mutation. */
function touchGamemode() {
  if (!store.S.gamemode) store.S.gamemode = presetConfig('aqopen');
  if (store.S.gamemode.presetId !== 'custom') {
    store.S.gamemode.presetId = 'custom';
    store.S.gamemode.name     = store.S.gamemode.name || 'Eget upplägg';
  }
}

function fixHoleChoices(rid) {
  fixHoleChoicesState(store.S, rid);
}

function applyCourse(rid, course) {
  if (!course) return;
  const R        = store.S.rounds[rid];
  R.pars         = [...course.pars];
  R.courseName   = course.name;
  fixHoleChoices(rid);
  save();
}

/** Creates a <details class="cfg-section"> panel. */
function section(title, preview, bodyFn, { open = false } = {}) {
  const d = el('<details class="cfg-section"' + (open ? ' open' : '') + '></details>');
  const s = el(
    '<summary>' +
      '<span>' + title + '</span>' +
      '<span class="cfg-preview">' + esc(preview) + '</span>' +
      '<span class="cfg-chevron">▾</span>' +
    '</summary>'
  );
  d.appendChild(s);
  const body = el('<div class="cfg-body"></div>');
  bodyFn(body);
  d.appendChild(body);
  return d;
}

/* ====================================================================== */
/* Section builders                                                         */
/* ====================================================================== */

function buildEventSection(box) {
  const preview = store.S.event || 'AqOpen Sweden';
  box.appendChild(section('Tävling', preview, body => {
    const row   = el('<div class="field"><label>Namn</label><input type="text" value="' + esc(store.S.event) + '"></div>');
    const input = row.querySelector('input');
    input.onblur    = () => { store.S.event = input.value.trim() || 'AqOpen Sweden'; save(); import('../app.js').then(m => m.render()); };
    input.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    body.appendChild(row);
    body.appendChild(el('<p class="empty-note" style="margin:4px 0 0">Visas i appens rubrik.</p>'));
  }, { open: true }));
}

function buildFormatSection(box) {
  const mode = gm();
  box.appendChild(section('Spelformat', mode.name, body => {
    /* Preset selector */
    const presetRow = el('<div class="field"><label>Preset</label><select></select></div>');
    const sel       = presetRow.querySelector('select');
    [['aqopen', 'AqOpen Classic'], ['stableford', 'Enkel Stableford'], ['custom', 'Eget upplägg']].forEach(([id, name]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = name;
      if ((store.S.gamemode?.presetId || 'aqopen') === id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      if (sel.value === 'custom') { touchGamemode(); }
      else                        { store.S.gamemode = presetConfig(sel.value); }
      save(); import('../app.js').then(m => m.render());
    };
    body.appendChild(presetRow);

    /* Format name (only relevant when custom) */
    const nameRow   = el('<div class="field"><label>Namn</label><input type="text" value="' + esc(store.S.gamemode.name) + '"></div>');
    const nameInput = nameRow.querySelector('input');
    nameInput.onblur    = () => { touchGamemode(); store.S.gamemode.name = nameInput.value.trim() || 'Eget upplägg'; save(); import('../app.js').then(m => m.render()); };
    nameInput.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    body.appendChild(nameRow);

    /* Active rules summary */
    body.appendChild(el(
      '<div class="subcard"><h4>Aktiva regler</h4>' +
        '<ul class="rules" style="margin:0;padding-left:18px">' +
          gamemodeLines().map(line => '<li>' + esc(line) + '</li>').join('') +
        '</ul>' +
      '</div>'
    ));
  }, { open: true }));
}

function buildStablefordSection(box) {
  const preview = stablefordSummary();
  box.appendChild(section('Poängscale (Stableford)', preview, body => {
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Poäng per resultat relativt par. Standardvärden för AqOpen Classic: Eagle+ 12, Birdie 6, Par 3, Bogey 2, Dubbel 1, Trippel+ 0.</p>'));
    const grid = el('<div class="parGrid"></div>');
    [['eaglePlus', 'Eagle+'], ['birdie', 'Birdie'], ['par', 'Par'], ['bogey', 'Bogey'], ['double', 'Dubbel'], ['triple', 'Trippel+']].forEach(([key, label]) => {
      const cell = el('<div class="parCell"><span>' + label + '</span><input type="number" value="' + store.S.gamemode.stableford[key] + '"></div>');
      cell.querySelector('input').onchange = e => {
        touchGamemode();
        store.S.gamemode.stableford[key] = clamp(num(e.target.value, 0), -20, 50);
        save(); import('../app.js').then(m => m.render());
      };
      grid.appendChild(cell);
    });
    body.appendChild(grid);
  }));
}

function buildBonusSection(box) {
  const bonusDefs = [
    ['ctp',      'Closest to pin', ['bana', 'sim']],
    ['ld',       'Längsta drive',  ['sim']],
    ['clean',    'Ren rond',       ['bana', 'sim']],
    ['comeback', 'Comeback',       []]
  ];
  const activeCount = bonusDefs.filter(([key]) => ruleEnabled(key)).length;
  const preview     = activeCount + ' av ' + bonusDefs.length + ' aktiva';

  box.appendChild(section('Bonusar', preview, body => {
    bonusDefs.forEach(([key, label, rounds]) => {
      const rule = store.S.gamemode.bonuses[key];
      const card = el(
        '<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
            '<strong style="font-size:14px">' + label + '</strong>' +
            '<button class="chip blue" aria-pressed="' + rule.enabled + '">' + (rule.enabled ? 'På' : 'Av') + '</button>' +
          '</div>' +
          '<div class="field" style="margin-top:8px"><label>Poäng</label><input type="number" value="' + rule.points + '"></div>' +
          '<div class="chips bonus-rounds"></div>' +
        '</div>'
      );
      card.querySelector('button').onclick       = () => { touchGamemode(); rule.enabled = !rule.enabled; save(); import('../app.js').then(m => m.render()); };
      card.querySelector('input').onchange       = e => { touchGamemode(); rule.points = clamp(num(e.target.value, 0), -50, 50); save(); import('../app.js').then(m => m.render()); };
      const chips = card.querySelector('.bonus-rounds');
      if (rounds.length) {
        rounds.forEach(rid => {
          const chip = el('<button class="chip" aria-pressed="' + rule.rounds[rid] + '">' + ROUND_LABELS[rid] + '</button>');
          chip.onclick = () => {
            touchGamemode();
            store.S.gamemode.bonuses[key].rounds[rid] = !rule.rounds[rid];
            save(); import('../app.js').then(m => m.render());
          };
          chips.appendChild(chip);
        });
      } else {
        chips.appendChild(el('<span class="empty-note">Jämför alltid bana mot simulator.</span>'));
      }
      body.appendChild(card);
    });
  }, { open: true }));
}

function buildHandicapSection(box) {
  const hc      = gm().handicap;
  const preview = handicapModeLabel(hc.mode) + (hc.mode !== 'none' ? ' · gäller ' + handicapAppliesLabel(hc.appliesTo).toLowerCase() : '');

  box.appendChild(section('Handicap', preview, body => {
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Fast bonus: handicap × värde. Procentuell: handicap × allowance × värde.</p>'));

    const modeRow = el('<div class="field"><label>Modell</label><select><option value="none">Ingen</option><option value="flat">Fast bonus</option><option value="allowance">Procentuell</option></select></div>');
    const hcMode  = modeRow.querySelector('select');
    hcMode.value    = hc.mode;
    hcMode.onchange = e => { touchGamemode(); store.S.gamemode.handicap.mode = e.target.value; save(); import('../app.js').then(m => m.render()); };
    body.appendChild(modeRow);

    const applyRow = el('<div class="field"><label>Gäller</label><select><option value="event">Totalt</option><option value="both">Båda ronderna</option><option value="bana">Bana</option><option value="sim">Simulator</option></select></div>');
    const hcApply  = applyRow.querySelector('select');
    hcApply.value    = hc.appliesTo;
    hcApply.onchange = e => { touchGamemode(); store.S.gamemode.handicap.appliesTo = e.target.value; save(); import('../app.js').then(m => m.render()); };
    body.appendChild(applyRow);

    const allowRow  = el('<div class="field"><label>Allowance %</label><input type="number" value="' + hc.allowance + '"></div>');
    allowRow.querySelector('input').onchange = e => { touchGamemode(); store.S.gamemode.handicap.allowance = clamp(num(e.target.value, 100), 0, 200); save(); import('../app.js').then(m => m.render()); };
    body.appendChild(allowRow);

    const valueRow  = el('<div class="field"><label>Värde / pt</label><input type="number" step="0.5" value="' + hc.pointValue + '"></div>');
    valueRow.querySelector('input').onchange = e => { touchGamemode(); store.S.gamemode.handicap.pointValue = clamp(num(e.target.value, 1), -10, 10); save(); import('../app.js').then(m => m.render()); };
    body.appendChild(valueRow);
  }));
}

function buildPlayersSection(box) {
  const preview = store.S.players.length + ' spelare';
  box.appendChild(section('Spelare', preview, body => {
    store.S.players.forEach((p, i) => {
      const f   = el(
        '<div class="subcard" style="margin-top:0;margin-bottom:8px">' +
          '<div class="field"><label>Namn</label><input type="text" value="' + esc(p.name) + '"></div>' +
          '<div class="field"><label>Handicap</label><input type="number" step="0.5" value="' + p.handicap + '">' +
            '<button class="btn danger" style="padding:8px 12px;white-space:nowrap">Ta bort</button>' +
          '</div>' +
        '</div>'
      );
      const inp = f.querySelector('input[type=text]');
      const hcp = f.querySelector('input[type=number]');
      const del = f.querySelector('button');
      inp.onblur    = () => { p.name = inp.value.trim() || 'Spelare ' + (i + 1); save(); import('../app.js').then(m => m.render()); };
      inp.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
      hcp.onchange  = () => { p.handicap = clamp(num(hcp.value, 0), -36, 54); save(); import('../app.js').then(m => m.render()); };
      del.onclick   = () => {
        store.S.players = store.S.players.filter(x => x.id !== p.id);
        ['bana', 'sim'].forEach(r => {
          delete (store.S.strokes[r] || {})[p.id];
          Object.keys(store.S.ctpWins[r]).forEach(h => {
            store.S.ctpWins[r][h] = store.S.ctpWins[r][h].filter(id => id !== p.id);
            if (!store.S.ctpWins[r][h].length) delete store.S.ctpWins[r][h];
          });
        });
        Object.keys(store.S.ldWins.sim).forEach(h => {
          store.S.ldWins.sim[h] = store.S.ldWins.sim[h].filter(id => id !== p.id);
          if (!store.S.ldWins.sim[h].length) delete store.S.ldWins.sim[h];
        });
        save(); import('../app.js').then(m => m.render());
      };
      body.appendChild(f);
    });

    const add   = el('<button class="btn ghost">+ Lägg till spelare</button>');
    add.onclick = () => {
      store.S.players.push(makePlayer('Spelare ' + (store.S.players.length + 1)));
      save(); import('../app.js').then(m => m.render());
    };
    body.appendChild(add);
  }, { open: true }));
}

function buildRoundSection(rid, box) {
  const R       = store.S.rounds[rid];
  const total   = R.pars.reduce((a, b) => a + b, 0);
  const preview = (R.courseName || 'ingen bana vald') + ' · par ' + total;

  box.appendChild(section(R.label, preview, body => {
    /* Course picker */
    body.appendChild(el('<h3 class="sec">Bana</h3>'));
    const list     = allCourses();
    const sel      = el('<select><option value="">Välj bana…</option></select>');
    list.forEach((course, ix) => {
      const o     = document.createElement('option');
      o.value     = String(ix);
      o.textContent = course.name + (course.own ? ' (egen)' : '') + ' · par ' + course.pars.reduce((a, b) => a + b, 0);
      if (course.name === R.courseName) o.selected = true;
      sel.appendChild(o);
    });
    const applyRow = el('<div class="field" style="align-items:stretch"></div>');
    applyRow.appendChild(sel);
    const useBtn   = el('<button class="btn" style="white-space:nowrap">Använd</button>');
    useBtn.onclick = () => {
      if (sel.value === '') return;
      applyCourse(rid, list[+sel.value]);
      import('../app.js').then(m => m.render());
    };
    applyRow.appendChild(useBtn);
    body.appendChild(applyRow);
    if (R.courseName) body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">Vald bana: ' + esc(R.courseName) + '</p>'));
    const chosen = list[+sel.value];
    if (chosen && chosen.note) body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">' + esc(chosen.note) + '</p>'));

    /* Paste pars */
    const paste = el(
      '<div class="subcard">' +
        '<h4>Klistra in par från scorekortet</h4>' +
        '<p>18 siffror, hål 1 först. Mellanslag, komma eller radbrytning spelar ingen roll.</p>' +
        '<input type="text" placeholder="4 4 3 5 4 4 3 4 5 4 3 4 5 4 4 3 4 5">' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost">Läs in par</button></div>' +
        '<p class="empty-note" id="pmsg" style="margin:8px 0 0"></p>' +
      '</div>'
    );
    const pInput = paste.querySelector('input'), pMsg = paste.querySelector('#pmsg');
    paste.querySelector('button').onclick = () => {
      const nums = (pInput.value.match(/\d+/g) || []).map(Number);
      if (nums.length !== HOLES)             { pMsg.textContent = 'Hittade ' + nums.length + ' siffror, behöver 18.'; return; }
      if (nums.some(n => n < 3 || n > 6))   { pMsg.textContent = 'Par ska ligga mellan 3 och 6.'; return; }
      R.pars       = nums;
      R.courseName = R.courseName || 'Inklistrad bana';
      fixHoleChoices(rid);
      save(); import('../app.js').then(m => m.render());
    };
    body.appendChild(paste);

    /* Save custom course */
    const saveC = el(
      '<div class="subcard">' +
        '<h4>Spara som egen bana</h4>' +
        '<p>Hamnar i listan ovan för alla som använder sidan.</p>' +
        '<input type="text" placeholder="Namn, t.ex. Bro Hof – Stadium">' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost">Spara bana</button></div>' +
      '</div>'
    );
    const cName = saveC.querySelector('input');
    saveC.querySelector('button').onclick = () => {
      const nm = cName.value.trim();
      if (!nm) return;
      store.S.customCourses = (store.S.customCourses || []).filter(c => c.name !== nm);
      store.S.customCourses.push({ name: nm, pars: [...R.pars] });
      R.courseName = nm;
      save(); import('../app.js').then(m => m.render());
    };
    body.appendChild(saveC);

    /* Custom course list */
    if ((store.S.customCourses || []).length) {
      const own = el('<div style="margin-top:12px"><h3 class="sec">Egna banor</h3></div>');
      store.S.customCourses.forEach(course => {
        const line = el(
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line)">' +
            '<span style="font-size:13.5px">' + esc(course.name) + ' <span class="empty-note">par ' + course.pars.reduce((a, b) => a + b, 0) + '</span></span>' +
          '</div>'
        );
        const del = el('<button class="btn danger" style="padding:6px 10px">Ta bort</button>');
        del.onclick = () => {
          store.S.customCourses = store.S.customCourses.filter(x => x.name !== course.name);
          save(); import('../app.js').then(m => m.render());
        };
        line.appendChild(del);
        own.appendChild(line);
      });
      body.appendChild(own);
    }

    /* Par grid */
    body.appendChild(el('<h3 class="sec" style="margin-top:18px">Par per hål</h3>'));
    const grid = el('<div class="parGrid"></div>');
    R.pars.forEach((p, i) => {
      const cell = el('<div class="parCell"><span>Hål ' + (i + 1) + '</span><input type="number" min="3" max="6" value="' + p + '"></div>');
      const inp  = cell.querySelector('input');
      inp.onchange = () => {
        R.pars[i] = Math.min(6, Math.max(3, parseInt(inp.value, 10) || 4));
        fixHoleChoices(rid);
        save(); import('../app.js').then(m => m.render());
      };
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    /* CTP holes */
    const par3 = R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p === 3).map(x => x.h);
    body.appendChild(el('<h3 class="sec" style="margin-top:18px">Closest to pin – välj hål</h3>'));
    const ctpRow = el('<div class="chips"></div>');
    (par3.length ? par3 : R.pars.map((_, i) => i + 1)).forEach(h => {
      const on = R.ctp.includes(h);
      const b  = el('<button class="chip blue" aria-pressed="' + on + '">Hål ' + h + '</button>');
      b.onclick = () => {
        R.ctp = on ? R.ctp.filter(x => x !== h) : [...R.ctp, h].sort((a, b) => a - b);
        save(); import('../app.js').then(m => m.render());
      };
      ctpRow.appendChild(b);
    });
    body.appendChild(ctpRow);
    body.appendChild(el('<p class="empty-note" style="margin:8px 0 0">' + (par3.length ? 'Visar bara par 3-hål.' : 'Inga par 3-hål inlagda ännu – välj par först.') + '</p>'));

    /* LD holes (simulator only) */
    if (rid === 'sim') {
      body.appendChild(el('<h3 class="sec" style="margin-top:18px">Längsta drive – välj hål</h3>'));
      const ldRow = el('<div class="chips"></div>');
      R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p >= 4).forEach(x => {
        const on = R.ld.includes(x.h);
        const b  = el('<button class="chip blue" aria-pressed="' + on + '">Hål ' + x.h + '</button>');
        b.onclick = () => {
          R.ld = on ? R.ld.filter(y => y !== x.h) : [...R.ld, x.h].sort((a, b) => a - b);
          save(); import('../app.js').then(m => m.render());
        };
        ldRow.appendChild(b);
      });
      body.appendChild(ldRow);
    }
  }));
}

function buildResetSection(box) {
  const rc = el(
    '<div class="card" style="border-color:#C48B7A">' +
      '<div class="card-body">' +
        '<h3 class="sec" style="color:var(--warn)">Nollställ</h3>' +
        '<p class="empty-note" style="margin:0 0 10px">Tar bort alla slag, CTP- och drivemarkeringar. Spelare, handicap och spelformat behålls.</p>' +
        '<button class="btn danger">Nollställ alla resultat</button>' +
      '</div>' +
    '</div>'
  );
  const btn = rc.querySelector('button');
  btn.onclick = () => {
    btn.textContent = 'Tryck igen för att bekräfta';
    btn.onclick     = () => {
      store.S.strokes  = { bana: {}, sim: {} };
      store.S.ctpWins  = { bana: {}, sim: {} };
      store.S.ldWins   = { sim: {} };
      store.S.live     = null;
      save(); import('../app.js').then(m => m.render());
    };
  };
  box.appendChild(rc);
}

/* ====================================================================== */
/* Main export                                                              */
/* ====================================================================== */

export function renderConfig() {
  const box = el('<div></div>');

  buildEventSection(box);
  buildFormatSection(box);
  buildStablefordSection(box);
  buildBonusSection(box);
  buildHandicapSection(box);
  buildPlayersSection(box);

  /* One section per round */
  ROUND_IDS.forEach(rid => buildRoundSection(rid, box));

  buildResetSection(box);

  return box;
}
