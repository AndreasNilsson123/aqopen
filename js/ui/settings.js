/**
 * ui/settings.js – renders the Inställningar (settings) tab.
 *
 * Settings are organised into collapsible <details> panels so users can focus
 * on the section they need without being overwhelmed by the full flat list.
 */
import { HOLES, ROUND_IDS, ROUND_LABELS, TIEBREAK_OPTIONS } from '../constants.js';
import { clamp, num, fmt, el, esc, clone } from '../utils.js';
import { makePlayer, presetConfig, fixHoleChoicesState, migrateState } from '../state.js';
import {
  allCourses, canEdit, clearResetBackup, loadResetBackup,
  persistLocalPrefs, saveResetBackup, store
} from '../store.js';
import {
  gm, ruleEnabled, ruleCfg, gamemodeLines, stablefordSummary,
  handicapModeLabel, handicapAppliesLabel, tiebreakLabel
} from '../scoring.js';
import { save, setStatus, syncedNote } from '../sync.js';

/* ---- helpers ---- */

function rerender() {
  import('../app.js').then(m => m.render());
}

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
  const R      = store.S.rounds[rid];
  R.pars       = [...course.pars];
  R.courseName = course.name;
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

function warnings() {
  const out = [];
  if (store.S.players.length < 2) out.push('Lägg till minst två spelare för att få en riktig ställning.');
  if (store.authRequired && !store.local.editKey.trim()) out.push('Redigeringsnyckel saknas på den här enheten, så sidan är just nu bara läsbar.');
  ROUND_IDS.forEach(rid => {
    const round = store.S.rounds[rid];
    if (!round.courseName.trim()) out.push(round.label + ' saknar valt ban-namn.');
    if (ruleEnabled('ctp', rid) && !round.ctp.length) out.push(round.label + ' har CTP aktiverat men inga CTP-hål valda.');
  });
  if (ruleEnabled('ld', 'sim') && !store.S.rounds.sim.ld.length) out.push('Simulatorn har längsta drive aktiverat men inga drivehål valda.');
  return out;
}

function readonlyMessage(body, text = 'Aktivera redigering för att ändra delad data.') {
  body.appendChild(el('<p class="notice warn" style="margin:0">' + esc(text) + '</p>'));
}

function resetExport(area) {
  area.value = JSON.stringify({ state: store.S }, null, 2);
}

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function playerDbHeaders(jsonBody = false) {
  const headers = {};
  if (jsonBody) headers['Content-Type'] = 'application/json';
  const key = store.local.editKey.trim();
  if (key) headers['x-aqopen-key'] = key;
  return headers;
}

function hasRecordedScores() {
  return ROUND_IDS.some(rid =>
    Object.values(store.S.strokes?.[rid] || {}).some(arr => Array.isArray(arr) && arr.some(v => v != null))
  );
}

function withPlayers(players) {
  return migrateState({
    ...store.S,
    players,
    live: null,
    snapshots: [],
    teams: { enabled: false, groups: [], names: [], scoring: 'sum' }
  });
}

async function fetchPlayerDatabase() {
  const r = await fetch('/api/players', { cache: 'no-store', headers: playerDbHeaders() });
  if (!r.ok) throw new Error('Kunde inte läsa spelardatabasen (' + r.status + ')');
  const data = await r.json();
  return Array.isArray(data?.players) ? data.players : [];
}

async function savePlayerDatabase(players) {
  const r = await fetch('/api/players', {
    method: 'PUT',
    headers: playerDbHeaders(true),
    body: JSON.stringify({ players })
  });
  if (!r.ok) throw new Error('Kunde inte spara spelardatabasen (' + r.status + ')');
  return r.json();
}

/* ====================================================================== */
/* Section builders                                                        */
/* ====================================================================== */

function buildAccessSection(box) {
  const preview = canEdit()
    ? 'Redigering aktiv'
    : (store.local.spectator ? 'Visningsläge' : 'Läsbar tills nyckel läggs in');

  box.appendChild(section('Åtkomst & visningsläge', preview, body => {
    body.appendChild(el(
      '<p class="empty-note" style="margin:0 0 10px">' +
        (store.authRequired
          ? 'API:t är låst med redigeringsnyckel. Spara nyckeln lokalt på den här enheten för att kunna ändra resultat.'
          : 'API:t är öppet för redigering. Du kan ändå slå på visningsläge lokalt för att undvika misstag på den här enheten.') +
      '</p>'
    ));

    const keyRow = el('<div class="field"><label>Nyckel</label><input type="password" placeholder="Valfri redigeringsnyckel" value="' + esc(store.local.editKey) + '"></div>');
    const keyInp = keyRow.querySelector('input');
    keyInp.onblur = () => {
      store.local.editKey = keyInp.value.trim();
      persistLocalPrefs();
      setStatus(syncedNote(), true);
      rerender();
    };
    keyInp.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    body.appendChild(keyRow);

    const localMode = el('<div class="subcard"><h4>Den här enheten</h4><p>Visningsläge döljer score-inmatning och hindrar lokala försök att spara ändringar.</p><div class="chips"></div></div>');
    const chips = localMode.querySelector('.chips');
    const editChip = el('<button class="chip" aria-pressed="' + (!store.local.spectator) + '">Redigering</button>');
    const viewChip = el('<button class="chip blue" aria-pressed="' + store.local.spectator + '">Visningsläge</button>');
    editChip.onclick = () => {
      store.local.spectator = false;
      persistLocalPrefs();
      setStatus(syncedNote(), true);
      rerender();
    };
    viewChip.onclick = () => {
      store.local.spectator = true;
      persistLocalPrefs();
      setStatus(syncedNote(), true);
      rerender();
    };
    chips.appendChild(editChip);
    chips.appendChild(viewChip);
    body.appendChild(localMode);

    if (store.authRequired && !store.local.editKey.trim()) {
      readonlyMessage(body, 'Lägg in redigeringsnyckeln ovan för att låsa upp score-inmatning och återställning.');
    } else if (store.local.spectator) {
      readonlyMessage(body, 'Visningsläge är aktivt på den här enheten. Växla tillbaka till Redigering för att ändra resultat.');
    }
  }, { open: true }));
}

function buildValidationSection(box) {
  const items   = warnings();
  const preview = items.length ? items.length + ' behöver ses över' : 'Redo att spela';
  box.appendChild(section('Snabbcheck', preview, body => {
    if (!items.length) {
      body.appendChild(el('<p class="notice good" style="margin:0">Grundinställningarna ser bra ut: spelare, bonushål och åtkomst är redo.</p>'));
      return;
    }
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Fixa gärna det här innan ni börjar eller delar sidan brett.</p>'));
    body.appendChild(el('<ul class="rules" style="margin:0;padding-left:18px">' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>'));
  }, { open: items.length > 0 }));
}

function buildBackupSection(box) {
  const backup = loadResetBackup();
  const preview = backup ? 'Export, import & återställning finns sparat' : 'Export & import';

  box.appendChild(section('Backup & import', preview, body => {
    const exportCard = el(
      '<div class="subcard">' +
        '<h4>Exportera tävlingen</h4>' +
        '<p>Skapa en JSON-backup innan ni ändrar format, nollställer eller byter bana.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn ghost" data-act="fill">Visa JSON</button>' +
          '<button class="btn ghost" data-act="download">Ladda ner backup</button>' +
        '</div>' +
        '<textarea class="bulk" readonly placeholder="JSON-backup visas här"></textarea>' +
      '</div>'
    );
    const exportArea = exportCard.querySelector('textarea');
    exportCard.querySelector('[data-act="fill"]').onclick = () => resetExport(exportArea);
    exportCard.querySelector('[data-act="download"]').onclick = () => {
      const content = JSON.stringify({ state: store.S }, null, 2);
      triggerDownload('aqopen-backup-' + new Date().toISOString().slice(0, 10) + '.json', content);
    };
    body.appendChild(exportCard);

    // Archive to history
    if (canEdit()) {
      const archiveCard = el(
        '<div class="subcard">' +
          '<h4>Arkivera tävlingen</h4>' +
          '<p>Sparar en kopia av hela tävlingen i historiken (nås via Historik-fliken) utan att påverka pågående tävling.</p>' +
          '<button class="btn ghost">Arkivera nu</button>' +
          '<p class="empty-note archive-msg" style="margin:8px 0 0"></p>' +
        '</div>'
      );
      const archiveMsg = archiveCard.querySelector('.archive-msg');
      archiveCard.querySelector('button').onclick = async () => {
        archiveMsg.textContent = 'Arkiverar…';
        try {
          const { archiveEvent } = await import('../app.js');
          await archiveEvent(store.local.editKey);
          archiveMsg.textContent = '✓ Tävlingen är arkiverad och syns nu under Historik.';
        } catch (e) {
          archiveMsg.textContent = 'Fel: ' + e.message;
        }
      };
      body.appendChild(archiveCard);
    }

    if (!canEdit()) {
      body.appendChild(el('<p class="notice" style="margin:12px 0 0">Import och återställning visas först när den här enheten är i redigeringsläge.</p>'));
      return;
    }

    const importCard = el(
      '<div class="subcard">' +
        '<h4>Importera tävling</h4>' +
        '<p>Klistra in en tidigare export. Om servern redan har data ersätter importen den delade tävlingen vid nästa sparning.</p>' +
        '<textarea class="bulk" placeholder="Klistra in { state: ... } eller bara state-objektet här"></textarea>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost">Importera JSON</button></div>' +
        '<p class="empty-note import-msg" style="margin:8px 0 0"></p>' +
      '</div>'
    );
    const importArea = importCard.querySelector('textarea');
    const importMsg  = importCard.querySelector('.import-msg');
    importCard.querySelector('button').onclick = () => {
      try {
        const raw = JSON.parse(importArea.value);
        store.S = migrateState(raw?.state ?? (typeof raw === 'object' && raw !== null ? raw : {}));
        store.tab = 'lb';
        save();
        rerender();
        importMsg.textContent = 'Importen är inläst och sparas till delat läge.';
      } catch {
        importMsg.textContent = 'Kunde inte läsa JSON-innehållet.';
      }
    };
    body.appendChild(importCard);

    const restoreCard = el(
      '<div class="subcard">' +
        '<h4>Återställ senaste nollställning</h4>' +
        '<p>Appen sparar den senaste tävlingsbilden lokalt innan du nollställer resultat.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn ghost">Återställ senaste backup</button>' +
          '<button class="btn danger">Rensa backup</button>' +
        '</div>' +
        '<p class="empty-note restore-msg" style="margin:8px 0 0">' + (backup ? 'En lokal reset-backup finns sparad på den här enheten.' : 'Ingen reset-backup sparad ännu.') + '</p>' +
      '</div>'
    );
    const restoreMsg = restoreCard.querySelector('.restore-msg');
    const [restoreBtn, clearBtn] = restoreCard.querySelectorAll('button');
    restoreBtn.onclick = () => {
      const latest = loadResetBackup();
      if (!latest) { restoreMsg.textContent = 'Ingen backup finns att återställa.'; return; }
      store.S = migrateState(clone(latest));
      store.tab = 'lb';
      save();
      rerender();
      restoreMsg.textContent = 'Senaste reset-backupen är återställd.';
    };
    clearBtn.onclick = () => {
      clearResetBackup();
      restoreMsg.textContent = 'Backupen är rensad från den här enheten.';
    };
    body.appendChild(restoreCard);
  }));
}

function buildEventSection(box) {
  const preview = store.S.event || 'AqOpen Sweden';
  box.appendChild(section('Tävling', preview, body => {
    const row   = el('<div class="field"><label>Namn</label><input type="text" value="' + esc(store.S.event) + '"></div>');
    const input = row.querySelector('input');
    input.onblur    = () => { store.S.event = input.value.trim() || 'AqOpen Sweden'; save(); rerender(); };
    input.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    body.appendChild(row);
    body.appendChild(el('<p class="empty-note" style="margin:4px 0 0">Visas i appens rubrik och i PWA-installationen.</p>'));
  }, { open: true }));
}

function buildFormatSection(box) {
  const mode = gm();
  box.appendChild(section('Spelformat', mode.name, body => {
    body.appendChild(el(
      '<div class="subcard"><h4>Preset-hjälp</h4><p>' +
        'AqOpen Classic använder bonusar och comeback. Enkel Stableford stänger av extra bonusar. Eget upplägg låter dig justera allt själv.' +
      '</p></div>'
    ));

    const presetRow = el('<div class="field"><label>Preset</label><select></select></div>');
    const sel       = presetRow.querySelector('select');
    [['aqopen', 'AqOpen Classic'], ['stableford', 'Enkel Stableford'], ['custom', 'Eget upplägg']].forEach(([id, name]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = name;
      if ((store.S.gamemode?.presetId || 'aqopen') === id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      if (sel.value === 'custom') touchGamemode();
      else                        store.S.gamemode = presetConfig(sel.value);
      save(); rerender();
    };
    body.appendChild(presetRow);

    const nameRow   = el('<div class="field"><label>Namn</label><input type="text" value="' + esc(store.S.gamemode.name) + '"></div>');
    const nameInput = nameRow.querySelector('input');
    nameInput.onblur    = () => { touchGamemode(); store.S.gamemode.name = nameInput.value.trim() || 'Eget upplägg'; save(); rerender(); };
    nameInput.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    body.appendChild(nameRow);

    // Tiebreak
    const tbRow = el('<div class="field"><label>Playoff</label><select></select></div>');
    const tbSel = tbRow.querySelector('select');
    TIEBREAK_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if ((store.S.gamemode.tiebreak || 'none') === opt.value) o.selected = true;
      tbSel.appendChild(o);
    });
    tbSel.onchange = () => { touchGamemode(); store.S.gamemode.tiebreak = tbSel.value; save(); rerender(); };
    body.appendChild(tbRow);
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Playoff avgör lika total poäng automatiskt (utom sudden death som markeras manuellt).</p>'));

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
        save(); rerender();
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
      card.querySelector('button').onclick = () => { touchGamemode(); rule.enabled = !rule.enabled; save(); rerender(); };
      card.querySelector('input').onchange = e => { touchGamemode(); rule.points = clamp(num(e.target.value, 0), -50, 50); save(); rerender(); };
      const chips = card.querySelector('.bonus-rounds');
      if (rounds.length) {
        rounds.forEach(rid => {
          const chip = el('<button class="chip" aria-pressed="' + rule.rounds[rid] + '">' + ROUND_LABELS[rid] + '</button>');
          chip.onclick = () => {
            touchGamemode();
            store.S.gamemode.bonuses[key].rounds[rid] = !rule.rounds[rid];
            save(); rerender();
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
    hcMode.onchange = e => { touchGamemode(); store.S.gamemode.handicap.mode = e.target.value; save(); rerender(); };
    body.appendChild(modeRow);

    const applyRow = el('<div class="field"><label>Gäller</label><select><option value="event">Totalt</option><option value="both">Båda ronderna</option><option value="bana">Bana</option><option value="sim">Simulator</option></select></div>');
    const hcApply  = applyRow.querySelector('select');
    hcApply.value    = hc.appliesTo;
    hcApply.onchange = e => { touchGamemode(); store.S.gamemode.handicap.appliesTo = e.target.value; save(); rerender(); };
    body.appendChild(applyRow);

    const allowRow = el('<div class="field"><label>Allowance %</label><input type="number" value="' + hc.allowance + '"></div>');
    allowRow.querySelector('input').onchange = e => { touchGamemode(); store.S.gamemode.handicap.allowance = clamp(num(e.target.value, 100), 0, 200); save(); rerender(); };
    body.appendChild(allowRow);

    const valueRow = el('<div class="field"><label>Värde / pt</label><input type="number" step="0.5" value="' + hc.pointValue + '"></div>');
    valueRow.querySelector('input').onchange = e => { touchGamemode(); store.S.gamemode.handicap.pointValue = clamp(num(e.target.value, 1), -10, 10); save(); rerender(); };
    body.appendChild(valueRow);
  }));
}

function buildPlayersSection(box) {
  const preview = store.S.players.length + ' spelare';
  box.appendChild(section('Spelare', preview, body => {
    const db = el(
      '<div class="subcard" style="margin-top:0;margin-bottom:8px">' +
        '<h4>Spelardatabas</h4>' +
        '<p style="margin:0 0 8px">Ladda spelare från delat register eller spara nuvarande uppställning dit.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn ghost" data-db-load>Ladda från databas</button>' +
          '<button class="btn ghost" data-db-save>Spara nuvarande spelare</button>' +
        '</div>' +
        '<p class="empty-note" data-db-msg style="margin:8px 0 0"></p>' +
      '</div>'
    );
    const loadBtn = db.querySelector('[data-db-load]');
    const saveBtn = db.querySelector('[data-db-save]');
    const dbMsg   = db.querySelector('[data-db-msg]');
    const lockButtons = on => { loadBtn.disabled = on; saveBtn.disabled = on; };

    loadBtn.onclick = async () => {
      lockButtons(true);
      dbMsg.textContent = 'Laddar spelare…';
      try {
        const list = await fetchPlayerDatabase();
        if (!list.length) {
          dbMsg.textContent = 'Spelardatabasen är tom.';
          return;
        }
        if (hasRecordedScores() && !window.confirm('Det finns registrerade slag. Ladda från databasen och ersätta nuvarande spelare?')) {
          dbMsg.textContent = 'Avbrutet.';
          return;
        }
        const players = list.map((p, i) => {
          const out = makePlayer(p?.name || ('Spelare ' + (i + 1)));
          out.handicap = clamp(num(p?.handicap, 0), -36, 54);
          return out;
        });
        store.S = withPlayers(players);
        save();
        dbMsg.textContent = 'Laddade ' + players.length + ' spelare från databasen.';
        setStatus(syncedNote());
        rerender();
      } catch (e) {
        dbMsg.textContent = e.message || 'Kunde inte ladda databasen.';
      } finally {
        lockButtons(false);
      }
    };

    saveBtn.onclick = async () => {
      lockButtons(true);
      dbMsg.textContent = 'Sparar spelardatabas…';
      try {
        const payload = store.S.players.map(p => ({
          name: String(p.name || '').trim(),
          handicap: clamp(num(p.handicap, 0), -36, 54)
        })).filter(p => p.name);
        const res = await savePlayerDatabase(payload);
        dbMsg.textContent = 'Sparade ' + (res?.count ?? payload.length) + ' spelare i databasen.';
      } catch (e) {
        dbMsg.textContent = e.message || 'Kunde inte spara databasen.';
      } finally {
        lockButtons(false);
      }
    };
    body.appendChild(db);

    store.S.players.forEach((p, i) => {
      const f = el(
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
      inp.onblur    = () => { p.name = inp.value.trim() || 'Spelare ' + (i + 1); save(); rerender(); };
      inp.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
      hcp.onchange  = () => { p.handicap = clamp(num(hcp.value, 0), -36, 54); save(); rerender(); };
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
        save(); rerender();
      };
      body.appendChild(f);
    });

    const add = el('<button class="btn ghost">+ Lägg till spelare</button>');
    add.onclick = () => {
      store.S.players.push(makePlayer('Spelare ' + (store.S.players.length + 1)));
      save(); rerender();
    };
    body.appendChild(add);
  }, { open: true }));
}

function buildRoundSection(rid, box) {
  const R       = store.S.rounds[rid];
  const total   = R.pars.reduce((a, b) => a + b, 0);
  const preview = (R.courseName || 'ingen bana vald') + ' · par ' + total;

  box.appendChild(section(R.label, preview, body => {
    body.appendChild(el('<h3 class="sec">Bana</h3>'));
    const list = allCourses();
    const sel  = el('<select><option value="">Välj bana…</option></select>');
    list.forEach((course, ix) => {
      const o       = document.createElement('option');
      o.value       = String(ix);
      o.textContent = course.name + (course.own ? ' (egen)' : '') + ' · par ' + course.pars.reduce((a, b) => a + b, 0);
      if (course.name === R.courseName) o.selected = true;
      sel.appendChild(o);
    });
    const applyRow = el('<div class="field" style="align-items:stretch"></div>');
    applyRow.appendChild(sel);
    const useBtn = el('<button class="btn" style="white-space:nowrap">Använd</button>');
    useBtn.onclick = () => {
      if (sel.value === '') return;
      applyCourse(rid, list[+sel.value]);
      rerender();
    };
    applyRow.appendChild(useBtn);
    body.appendChild(applyRow);
    if (R.courseName) body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">Vald bana: ' + esc(R.courseName) + '</p>'));
    const chosen = list[+sel.value];
    if (chosen && chosen.note)     body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">' + esc(chosen.note) + '</p>'));
    if (chosen && chosen.location) body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">📍 ' + esc(chosen.location) + (chosen.website ? ' · <a href="' + esc(chosen.website) + '" target="_blank" rel="noopener">Webbplats</a>' : '') + '</p>'));
    const ratingInfo = [];
    if (chosen?.rating) ratingInfo.push('Bansläng: ' + chosen.rating);
    if (chosen?.slope)  ratingInfo.push('Slope: '    + chosen.slope);
    if (ratingInfo.length) body.appendChild(el('<p class="empty-note" style="margin:0 0 6px">' + esc(ratingInfo.join(' · ')) + '</p>'));

    const paste = el(
      '<div class="subcard">' +
        '<h4>Klistra in par från scorekortet</h4>' +
        '<p>18 siffror, hål 1 först. Mellanslag, komma eller radbrytning spelar ingen roll.</p>' +
        '<input type="text" placeholder="4 4 3 5 4 4 3 4 5 4 3 4 5 4 4 3 4 5">' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost">Läs in par</button></div>' +
        '<p class="empty-note paste-msg" style="margin:8px 0 0"></p>' +
      '</div>'
    );
    const pInput = paste.querySelector('input'), pMsg = paste.querySelector('.paste-msg');
    paste.querySelector('button').onclick = () => {
      const nums = (pInput.value.match(/\d+/g) || []).map(Number);
      if (nums.length !== HOLES)           { pMsg.textContent = 'Hittade ' + nums.length + ' siffror, behöver 18.'; return; }
      if (nums.some(n => n < 3 || n > 6)) { pMsg.textContent = 'Par ska ligga mellan 3 och 6.'; return; }
      R.pars       = nums;
      R.courseName = R.courseName || 'Inklistrad bana';
      fixHoleChoices(rid);
      save(); rerender();
    };
    body.appendChild(paste);

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
      save(); rerender();
    };
    body.appendChild(saveC);

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
          save(); rerender();
        };
        line.appendChild(del);
        own.appendChild(line);
      });
      body.appendChild(own);
    }

    body.appendChild(el('<h3 class="sec" style="margin-top:18px">Par per hål</h3>'));
    const grid = el('<div class="parGrid"></div>');
    R.pars.forEach((p, i) => {
      const cell = el('<div class="parCell"><span>Hål ' + (i + 1) + '</span><input type="number" min="3" max="6" value="' + p + '"></div>');
      const inp  = cell.querySelector('input');
      inp.onchange = () => {
        R.pars[i] = Math.min(6, Math.max(3, parseInt(inp.value, 10) || 4));
        fixHoleChoices(rid);
        save(); rerender();
      };
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    const par3 = R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p === 3).map(x => x.h);
    body.appendChild(el('<h3 class="sec" style="margin-top:18px">Closest to pin – välj hål</h3>'));
    const ctpRow = el('<div class="chips"></div>');
    (par3.length ? par3 : R.pars.map((_, i) => i + 1)).forEach(h => {
      const b = el('<button class="chip blue" aria-pressed="' + R.ctp.includes(h) + '">Hål ' + h + '</button>');
      b.onclick = () => {
        const on = R.ctp.includes(h);
        R.ctp = on ? R.ctp.filter(x => x !== h) : [...R.ctp, h].sort((a, b) => a - b);
        save(); rerender();
      };
      ctpRow.appendChild(b);
    });
    body.appendChild(ctpRow);
    body.appendChild(el('<p class="empty-note" style="margin:8px 0 0">' + (par3.length ? 'Visar bara par 3-hål.' : 'Inga par 3-hål inlagda ännu – välj par först.') + '</p>'));

    if (rid === 'sim') {
      body.appendChild(el('<h3 class="sec" style="margin-top:18px">Längsta drive – välj hål</h3>'));
      const ldRow = el('<div class="chips"></div>');
      R.pars.map((p, i) => ({ p, h: i + 1 })).filter(x => x.p >= 4).forEach(x => {
        const b = el('<button class="chip blue" aria-pressed="' + R.ld.includes(x.h) + '">Hål ' + x.h + '</button>');
        b.onclick = () => {
          const on = R.ld.includes(x.h);
          R.ld = on ? R.ld.filter(y => y !== x.h) : [...R.ld, x.h].sort((a, b) => a - b);
          save(); rerender();
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
        '<p class="empty-note" style="margin:0 0 10px">Tar bort alla slag, CTP- och drivemarkeringar. Spelare, handicap och spelformat behålls. En lokal reset-backup sparas först.</p>' +
        '<button class="btn danger">Nollställ alla resultat</button>' +
      '</div>' +
    '</div>'
  );
  const btn = rc.querySelector('button');
  btn.onclick = () => {
    btn.textContent = 'Tryck igen för att bekräfta';
    btn.onclick     = () => {
      saveResetBackup(clone(store.S));
      store.S.strokes   = { bana: {}, sim: {} };
      store.S.ctpWins   = { bana: {}, sim: {} };
      store.S.ldWins    = { sim: {} };
      store.S.live      = null;
      store.S.snapshots = [];
      save(); rerender();
    };
  };
  box.appendChild(rc);
}

function buildTeamsSection(box) {
  const teams   = store.S.teams || { enabled: false, groups: [], names: [] };
  const preview = teams.enabled ? teams.groups.length + ' lag' : 'Av';

  box.appendChild(section('Lagformat', preview, body => {
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">Samla spelare i lag och se lagställning på resultattavlan.</p>'));

    const enableRow = el('<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px"><strong>Lagformat</strong></div>');
    const toggleBtn = el('<button class="chip blue" aria-pressed="' + !!teams.enabled + '">' + (teams.enabled ? 'På' : 'Av') + '</button>');
    toggleBtn.onclick = () => {
      if (!store.S.teams) store.S.teams = { enabled: false, groups: [], names: [], scoring: 'sum' };
      store.S.teams.enabled = !store.S.teams.enabled;
      save(); rerender();
    };
    enableRow.appendChild(toggleBtn);
    body.appendChild(enableRow);

    if (!teams.enabled) return;

    // Scoring mode
    const scoreRow = el('<div class="field"><label>Poäng</label><select><option value="sum">Summering</option><option value="bestball">Best-ball</option></select></div>');
    const scoreSel = scoreRow.querySelector('select');
    scoreSel.value    = teams.scoring || 'sum';
    scoreSel.onchange = () => { store.S.teams.scoring = scoreSel.value; save(); rerender(); };
    body.appendChild(scoreRow);

    // Groups
    body.appendChild(el('<h3 class="sec" style="margin-top:14px">Lag</h3>'));
    (teams.groups || []).forEach((group, gi) => {
      const nm = teams.names[gi] || 'Lag ' + (gi + 1);
      const gc = el(
        '<div class="subcard" style="margin-bottom:8px">' +
          '<div class="field"><label>Lagnamn</label><input type="text" value="' + esc(nm) + '"></div>' +
          '<div class="chips" id="tg' + gi + '"></div>' +
          '<button class="btn danger" style="margin-top:8px;padding:6px 10px">Ta bort lag</button>' +
        '</div>'
      );
      const nmInp = gc.querySelector('input');
      nmInp.onblur = () => {
        if (!store.S.teams.names) store.S.teams.names = [];
        store.S.teams.names[gi] = nmInp.value.trim() || 'Lag ' + (gi + 1);
        save(); rerender();
      };
      nmInp.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };

      const chips = gc.querySelector('#tg' + gi);
      store.S.players.forEach(p => {
        const on = group.includes(p.id);
        const c  = el('<button class="chip' + (on ? ' blue' : '') + '" aria-pressed="' + on + '">' + esc(p.name) + '</button>');
        c.onclick = () => {
          const list = new Set(store.S.teams.groups[gi] || []);
          list.has(p.id) ? list.delete(p.id) : list.add(p.id);
          store.S.teams.groups[gi] = [...list];
          save(); rerender();
        };
        chips.appendChild(c);
      });

      gc.querySelector('button.btn.danger').onclick = () => {
        store.S.teams.groups.splice(gi, 1);
        store.S.teams.names.splice(gi, 1);
        save(); rerender();
      };
      body.appendChild(gc);
    });

    const addBtn = el('<button class="btn ghost">+ Lägg till lag</button>');
    addBtn.onclick = () => {
      if (!store.S.teams.groups) store.S.teams.groups = [];
      if (!store.S.teams.names)  store.S.teams.names  = [];
      store.S.teams.groups.push([]);
      store.S.teams.names.push('Lag ' + (store.S.teams.groups.length));
      save(); rerender();
    };
    body.appendChild(addBtn);
  }));
}

function buildAuditSection(box) {
  // Only show to editors.
  if (!canEdit()) return;

  box.appendChild(section('Ändringslogg', 'Vem ändrade vad', body => {
    body.appendChild(el('<p class="empty-note" style="margin:0 0 10px">De senaste sparningarna på servern. Kräver redigeringsnyckel.</p>'));

    const logArea = el('<div id="audit-list"><p class="empty-note">Laddar…</p></div>');
    body.appendChild(logArea);

    const loadBtn = el('<button class="btn ghost" style="margin-top:8px">Ladda logg</button>');
    loadBtn.onclick = async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Laddar…';
      try {
        const headers = {};
        if (store.local.editKey) headers['x-aqopen-key'] = store.local.editKey;
        const r = await fetch('/api/audit?limit=50', { headers, cache: 'no-store' });
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        const data = await r.json();
        const entries = data.entries || [];
        logArea.innerHTML = '';
        if (!entries.length) {
          logArea.innerHTML = '<p class="empty-note">Inga poster i loggen ännu.</p>';
        } else {
          const t = document.createElement('table');
          t.className = 'stat-table';
          t.innerHTML = '<thead><tr><th>Tid</th><th>Rev</th><th>Ändrade nycklar</th><th>Anropare</th></tr></thead>';
          const tb = document.createElement('tbody');
          entries.forEach(e => {
            const tr = document.createElement('tr');
            tr.innerHTML =
              '<td class="stat-lbl">' + esc(new Date(e.at).toLocaleString('sv-SE', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })) + '</td>' +
              '<td class="stat-val">' + esc(String(e.rev)) + '</td>' +
              '<td class="stat-val" style="font-size:11px">' + esc((e.changedKeys || []).join(', ')) + '</td>' +
              '<td class="stat-val" style="font-family:monospace;font-size:11px">' + esc(e.callerHash || '–') + '</td>';
            tb.appendChild(tr);
          });
          t.appendChild(tb);
          logArea.appendChild(t);
          logArea.appendChild(el('<p class="empty-note" style="margin:8px 0 0">Totalt ' + data.total + ' poster (visar de 50 senaste).</p>'));
        }
      } catch (e) {
        logArea.innerHTML = '<p class="empty-note" style="color:var(--warn)">Kunde inte ladda loggen: ' + esc(e.message) + '</p>';
      }
      loadBtn.textContent = 'Uppdatera logg';
      loadBtn.disabled = false;
    };
    body.appendChild(loadBtn);
  }));
}

/* ====================================================================== */
/* Main export                                                             */
/* ====================================================================== */

export function renderConfig() {
  const box = el('<div></div>');

  buildAccessSection(box);
  buildValidationSection(box);
  buildBackupSection(box);

  if (!canEdit()) return box;

  buildEventSection(box);
  buildFormatSection(box);
  buildStablefordSection(box);
  buildBonusSection(box);
  buildHandicapSection(box);
  buildPlayersSection(box);
  buildTeamsSection(box);
  ROUND_IDS.forEach(rid => buildRoundSection(rid, box));
  buildResetSection(box);
  buildAuditSection(box);

  return box;
}
