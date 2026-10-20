'use strict';
/* =====================================================================
   DC Traction Power Model — page logic
   Inputs (cfg) are the same JSON the Python model reads.
   The simulation runs in a Web Worker built from the embedded engine.
   ===================================================================== */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const STORE = 'tps_model_inputs_v1';
const STD_RECT = [1000, 1500, 2000, 2500, 3000, 3300, 3500, 4000, 4500, 5000, 6000, 7000, 8000];
const STD_XFMR = [1250, 1600, 2000, 2500, 3150, 3300, 4000, 4500, 5000, 6300, 8000];
let cfg, curTrain = 0, R = null, F = null, ST = null, DC = null, scenOutage = [], dirty = true, runTimer = null, worker = null, runId = 0, designBusy = false;
const charts = {};
const inIframe = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

/* ---------------- utilities ---------------- */
const num = TPS.num;
function fmt(v, d) { if (v === null || v === undefined || !isFinite(v)) return '–'; d = d || 0; return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function mmss(s) { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return m + ':' + String(r).padStart(2, '0'); }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function getPath(o, p) { return p.split('.').reduce((a, k) => a === undefined || a === null ? undefined : a[k], o); }
function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] === undefined) a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; }
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 3200); }
function parseVal(type, el) {
  if (type === 'check') return el.checked;
  if (type === 'num') { if (el.value === '') return ''; const x = parseFloat(el.value); return isFinite(x) ? x : ''; }
  return el.value;
}
function fillDefaults(c) {
  const d = TPS.defaults();
  for (const k in d) if (c[k] === undefined) c[k] = d[k];
  for (const k of ['electrical', 'limits', 'sim', 'project', 'track_gen', 'tss_gen', 'scenarios', 'ac', 'sc', 'harm', 'emc'])
    for (const kk in d[k]) if (c[k][kk] === undefined) c[k][kk] = d[k][kk];
  for (const kk in d.alignment) if (c.alignment[kk] === undefined) c.alignment[kk] = d.alignment[kk];
  if (!c.limits.std_rect_kW) c.limits.std_rect_kW = STD_RECT.join(', ');
  if (!c.limits.std_xfmr_kVA) c.limits.std_xfmr_kVA = STD_XFMR.join(', ');
  if (!Array.isArray(c.extra_details)) c.extra_details = [];
  return c;
}
function loadCfg() { try { const s = localStorage.getItem(STORE); if (s) return fillDefaults(JSON.parse(s)); } catch (e) { /* storage blocked */ } return fillDefaults(TPS.defaults()); }
function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }

/* ---------------- status ---------------- */
function setStatus(kind, txt) { $('#statDot').className = 'dot ' + (kind || ''); $('#statTxt').textContent = txt; }
function changed(rerenderPlan) {
  save(); dirty = true;
  setStatus('', 'Inputs changed' + ($('#autoRun').checked ? ', re-running…' : ', press Run'));
  if (rerenderPlan !== false) { renderPlan(); renderLong(); }
  if ($('#autoRun').checked && !designBusy) { clearTimeout(runTimer); runTimer = setTimeout(runSim, 700); }
}

/* ---------------- tabs ---------------- */
function initTabs() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => {
    $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('.tabpane').forEach(p => { p.hidden = p.id !== b.dataset.tab; });
    try { localStorage.setItem(STORE + '_tab', b.dataset.tab); } catch (e) { }
  }));
  try { const t = localStorage.getItem(STORE + '_tab'); if (t) { const b = $$('#tabs button').find(x => x.dataset.tab === t); if (b) b.click(); } } catch (e) { }
}

/* ---------------- field groups ---------------- */
function fieldsInto(el, specs, base) {
  el.innerHTML = '';
  for (const s of specs) {
    const [path, label, unit, o] = s; const opt = o || {};
    const full = (base || '') + path;
    const id = 'f_' + full.replace(/\./g, '_');
    const wrap = document.createElement('div'); wrap.className = 'field';
    const v = getPath(cfg, full);
    let input;
    if (opt.type === 'select') {
      input = document.createElement('select');
      for (const [val, lab] of opt.options) { const op = document.createElement('option'); op.value = val; op.textContent = lab; input.appendChild(op); }
      input.value = v === undefined ? '' : v;
    } else if (opt.type === 'check') {
      input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!v;
    } else {
      input = document.createElement('input'); input.type = opt.type === 'text' ? 'text' : 'number';
      if (opt.step) input.step = opt.step; else if (input.type === 'number') input.step = 'any';
      input.value = v === undefined || v === null ? '' : v;
      if (opt.ph) input.placeholder = opt.ph;
    }
    input.id = id;
    input.addEventListener('change', () => {
      const t = opt.type === 'select' ? 'text' : (opt.type || 'num');
      setPath(cfg, full, t === 'text' && opt.type === 'select' && opt.numeric ? parseFloat(input.value) : parseVal(t, input));
      if (opt.after) opt.after();
      if (opt.noRun) save(); else changed(opt.plan);
    });
    wrap.innerHTML = '<label for="' + id + '">' + esc(label) + '</label>';
    const row = document.createElement('div'); row.className = 'in'; row.appendChild(input);
    if (unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = unit; row.appendChild(u); }
    wrap.appendChild(row);
    if (opt.help) { const h = document.createElement('small'); h.className = 'muted'; h.style.fontSize = '11px'; h.textContent = opt.help; wrap.appendChild(h); }
    el.appendChild(wrap);
  }
}

/* ---------------- editable tables ---------------- */
function editTable(tbl, rows, cols, opt) {
  opt = opt || {};
  let h = '<thead><tr>' + (opt.index ? '<th class="n">#</th>' : '') + cols.map(c => '<th' + (c.type === 'num' ? ' class="n"' : '') + '>' + esc(c.label) + (c.unit ? ' <span style="text-transform:none">(' + esc(c.unit) + ')</span>' : '') + '</th>').join('') + (opt.del !== false ? '<th></th>' : '') + '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    h += '<tr>' + (opt.index ? '<td class="n muted">' + (i + 1) + '</td>' : '');
    cols.forEach((c, j) => {
      const v = r[c.k];
      const id = tbl.id + '_' + i + '_' + j;
      if (c.ro) { h += '<td class="n">' + (c.ro(r, i)) + '</td>'; return; }
      if (c.type === 'select') h += '<td><select id="' + id + '" data-i="' + i + '" data-j="' + j + '" aria-label="' + esc(c.label) + '">' + c.options().map(([val, lab]) => '<option value="' + esc(val) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + esc(lab) + '</option>').join('') + '</select></td>';
      else if (c.type === 'check') h += '<td style="text-align:center"><input type="checkbox" id="' + id + '" data-i="' + i + '" data-j="' + j + '" aria-label="' + esc(c.label) + '"' + (v !== false && v !== 'false' ? ' checked' : '') + '></td>';
      else h += '<td><input id="' + id + '" data-i="' + i + '" data-j="' + j + '" aria-label="' + esc(c.label) + '" type="' + (c.type === 'num' ? 'number' : 'text') + '" step="any"' + (c.cls ? ' class="' + c.cls + '"' : '') + ' value="' + esc(v === undefined || v === null ? '' : v) + '"' + (c.ph ? ' placeholder="' + esc(typeof c.ph === 'function' ? c.ph(r, i) : c.ph) + '"' : '') + '></td>';
    });
    if (opt.del !== false) h += '<td><button class="icon sm" data-del="' + i + '" aria-label="Delete row ' + (i + 1) + '" title="Delete row">✕</button></td>';
    h += '</tr>';
  });
  if (!rows.length) h += '<tr><td colspan="' + (cols.length + 2) + '" class="muted" style="padding:10px">No rows</td></tr>';
  tbl.innerHTML = h + '</tbody>';
  $$('input,select', tbl).forEach(el => el.addEventListener('change', () => {
    const i = +el.dataset.i, c = cols[+el.dataset.j];
    let val = parseVal(c.type === 'select' ? 'text' : (c.type || 'text'), el);
    if (c.type === 'select' && c.numeric) val = parseFloat(val);
    rows[i][c.k] = val;
    if (opt.onChange) opt.onChange(i, c.k); else changed();
  }));
  $$('button[data-del]', tbl).forEach(b => b.addEventListener('click', () => {
    rows.splice(+b.dataset.del, 1);
    editTable(tbl, rows, cols, opt);
    if (opt.onDelete) opt.onDelete(); else changed();
  }));
}

/* ---------------- render inputs ---------------- */
function renderTitle() {
  $('#p_name').value = cfg.project.name || ''; $('#p_system').value = cfg.project.system || ''; $('#p_ref').value = cfg.project.ref || '';
  $('#projNotes').value = cfg.project.notes || '';
}
function trainOptions() { return cfg.trains.map((t, i) => [i, (i + 1) + ' · ' + (t.name || 'train')]); }
function renderTracks() {
  $('#n_up').value = cfg.track_gen.n_up; $('#n_dn').value = cfg.track_gen.n_down;
  const trip = (tr) => { if (!R) return '–'; const x = R.tracks.find(t => t.name === tr.name); return x ? (x.trip / 60).toFixed(1) : '–'; };
  const inSvc = (tr) => { if (!R) return '–'; const x = R.tracks.find(t => t.name === tr.name); return x ? x.inService : '–'; };
  editTable($('#tblTracks'), cfg.tracks, [
    { k: 'name', label: 'Track', type: 'text', cls: 'w-name' },
    { k: 'dir', label: 'Direction', type: 'select', options: () => [['UP', 'UP (ch ↑)'], ['DN', 'DOWN (ch ↓)']] },
    { k: 'headway', label: 'Headway', unit: 's', type: 'num' },
    { k: 'offset', label: 'First departure offset', unit: 's', type: 'num' },
    { k: 'train', label: 'Train type', type: 'select', numeric: true, options: trainOptions },
    { k: 'skip', label: 'Skip stations', type: 'text', ph: 'e.g. ST03, ST07' },
    { k: 'enabled', label: 'Run', type: 'check' },
    { k: '_tph', label: 'Trains / h', ro: r => fmt(3600 / Math.max(1, num(r.headway, 150)), 1) },
    { k: '_trip', label: 'Trip (min)', ro: trip },
    { k: '_n', label: 'Trains on track', ro: inSvc }
  ], { onDelete: () => { cfg.track_gen.n_up = cfg.tracks.filter(t => t.dir === 'UP').length; cfg.track_gen.n_down = cfg.tracks.filter(t => t.dir === 'DN').length; renderTracks(); changed(); } });
}
function tssPlaceholders() { try { const tp = cfg.tss.map(t => { const Ir = num(t.rect_kW, 3000) * 1000 / num(cfg.electrical.V_nom, 750); return (num(cfg.electrical.regulation_pct, 6) / 100 * num(cfg.electrical.V_nom, 750) / Math.max(Ir, 1) * 1000).toFixed(2); }); return tp; } catch (e) { return []; } }
function renderTss() {
  fieldsInto($('#f_tssgen'), [
    ['tss_gen.count', 'Number of TSS', '', { step: 1, noRun: true }], ['tss_gen.first_ch', 'Chainage of first TSS', 'm', { noRun: true }],
    ['tss_gen.spacing', 'Distance between TSS', 'm', { noRun: true }], ['tss_gen.rect_kW', 'Rectifier rating (each)', 'kW', { noRun: true }],
    ['tss_gen.xfmr_kVA', 'Transformer rating (each)', 'kVA', { noRun: true }]]);
  const ph = tssPlaceholders();
  editTable($('#tblTss'), cfg.tss, [
    { k: 'name', label: 'Name', type: 'text', cls: 'w-name' }, { k: 'ch', label: 'Chainage', unit: 'm', type: 'num' },
    { k: 'rect_kW', label: 'Rectifier', unit: 'kW', type: 'num' }, { k: 'xfmr_kVA', label: 'Transformer', unit: 'kVA', type: 'num' },
    { k: 'V0', label: 'No-load V', unit: 'V', type: 'num', ph: () => String(cfg.electrical.V0) },
    { k: 'Req_mohm', label: 'Source R', unit: 'mΩ', type: 'num', ph: (r, i) => ph[i] || 'auto' },
    { k: 'inv_kW', label: 'Inverter', unit: 'kW', type: 'num' }, { k: 'in_service', label: 'In service', type: 'check' },
    { k: '_d', label: 'Spacing to previous', ro: (r, i) => i ? fmt(num(r.ch, 0) - num(cfg.tss[i - 1].ch, 0)) + ' m' : '–' }
  ], { index: true, onChange: () => { renderScenarioSel(); changed(); }, onDelete: () => { renderTss(); renderScenarioSel(); changed(); } });
}
const TRAIN_FIELDS = [
  ['name', 'Name', '', { type: 'text' }], ['cars', 'Cars', '', { step: 1 }], ['n_motors', 'Traction motors', '', { step: 1 }],
  ['mass_t', 'Simulation mass', 't'], ['rot_factor', 'Rotating mass factor', '–', { help: '0.08 = +8 %' }], ['length_m', 'Train length', 'm'],
  ['vmax', 'Maximum speed', 'km/h'], ['acc', 'Acceleration (max)', 'm/s²'], ['dec', 'Service braking', 'm/s²'],
  ['aux_kW_car', 'Auxiliary load per car', 'kW'], ['davis.A', 'Davis A', 'kN'], ['davis.B', 'Davis B', 'kN/(km/h)'], ['davis.C', 'Davis C', 'kN/(km/h)²'],
  ['te_basis', 'Effort curves are given', '', { type: 'select', options: [['train', 'per train'], ['motor', 'per motor (× motors)']] }],
  ['power_mode', 'Traction power from', '', { type: 'select', options: [['efficiency', 'effort × speed ÷ efficiency'], ['line_current', 'line current curve × V nom']] }],
  ['regen_eff_factor', 'Regeneration efficiency factor', '×'], ['regen_max_kW', 'Maximum regenerative power', 'kW'],
  ['source', 'Data source', '', { type: 'text' }]
];
const CURVES = [
  ['te_curve', 'Tractive effort', 'kN'], ['be_curve', 'Electric braking effort', 'kN'], ['eff_curve', 'Drive efficiency', '0–1'], ['line_current', 'Line current (motoring, full effort)', 'A']
];
function renderTrain() {
  curTrain = Math.min(curTrain, cfg.trains.length - 1);
  const sel = $('#trainSel'); sel.innerHTML = trainOptions().map(([v, l]) => '<option value="' + v + '">' + esc(l) + '</option>').join(''); sel.value = curTrain;
  const T = cfg.trains[curTrain];
  if (!T.davis) T.davis = { A: 0, B: 0, C: 0 };
  fieldsInto($('#f_train'), TRAIN_FIELDS.map(f => [f[0], f[1], f[2], Object.assign({ after: f[0] === 'name' ? () => { renderTrain(); renderTracks(); } : null }, f[3] || {})]), 'trains.' + curTrain + '.');
  const box = $('#curveEditors'); box.innerHTML = '';
  for (const [key, label, unit] of CURVES) {
    if (!Array.isArray(T[key])) T[key] = [];
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = '<h3>' + esc(label) + ' <small>' + esc(unit) + '</small><span class="row"><button class="sm" data-act="add">Add row</button><button class="sm" data-act="paste">Paste</button><button class="sm" data-act="clear">Clear</button></span></h3>' +
      '<div class="pastebox" hidden><textarea aria-label="Paste two columns" placeholder="Paste two columns from Excel: speed (km/h) and value"></textarea><div class="row"><button class="sm primary" data-act="usepaste">Use pasted values</button></div></div>' +
      '<div class="tw scroll" style="max-height:230px"><table class="et" id="cv_' + key + '"></table></div>';
    box.appendChild(g);
    const draw = () => editTable($('#cv_' + key), T[key], [{ k: 0, label: 'Speed', unit: 'km/h', type: 'num' }, { k: 1, label: label, unit: unit, type: 'num' }], { onChange: () => { drawCurvePreview(); changed(false); }, onDelete: () => { drawCurvePreview(); changed(false); } });
    draw();
    g.addEventListener('click', (e) => {
      const a = e.target.dataset.act; if (!a) return;
      if (a === 'add') { const last = T[key][T[key].length - 1]; T[key].push([last ? last[0] + 10 : 0, last ? last[1] : 0]); draw(); changed(false); }
      if (a === 'clear') { T[key] = []; draw(); drawCurvePreview(); changed(false); }
      if (a === 'paste') { $('.pastebox', g).hidden = !$('.pastebox', g).hidden; }
      if (a === 'usepaste') {
        const rows = $('textarea', g).value.split(/\r?\n/).map(l => l.trim().split(/[\t,; ]+/).map(TPSReaders.firstNumber)).filter(r => r.length >= 2 && r[0] !== null && r[1] !== null).map(r => [r[0], r[1]]);
        if (rows.length < 2) { toast('Need at least two rows of two numbers'); return; }
        T[key] = rows.sort((a, b) => a[0] - b[0]); draw(); drawCurvePreview(); $('.pastebox', g).hidden = true; changed(false); toast(rows.length + ' rows pasted into ' + label);
      }
    });
  }
  const pv = document.createElement('div'); pv.className = 'group'; pv.style.gridColumn = '1/-1';
  pv.innerHTML = '<h3>Curves of the selected train</h3><div class="chartbox"><canvas id="chCurves" aria-label="Train curves"></canvas></div>';
  box.appendChild(pv);
  drawCurvePreview();
}
function renderAlign() {
  const A = cfg.alignment;
  fieldsInto($('#f_align'), [
    ['alignment.start', 'Line start chainage', 'm'], ['alignment.end', 'Line end chainage', 'm'], ['alignment.base_level', 'Level at line start', 'm'],
    ['alignment.curve_res.k1', 'Curve resistance k (R ≥ split)', 'N/kN·m'], ['alignment.curve_res.c1', 'Curve resistance c (R ≥ split)', 'm'],
    ['alignment.curve_res.k2', 'Curve resistance k (R < split)', 'N/kN·m'], ['alignment.curve_res.c2', 'Curve resistance c (R < split)', 'm'], ['alignment.curve_res.R_split', 'Radius split', 'm'],
    ['alignment.auto_curve_speed', 'Limit speed on curves from radius', '', { type: 'check' }], ['alignment.cant_plus_def_mm', 'Cant + cant deficiency', 'mm'],
    ['alignment.gauge_const', 'Gauge constant (11.82 SG, 13.76 BG)', ''], ['alignment.source', 'Data source', '', { type: 'text' }]]);
  const tbl = (id, key, cols) => editTable($(id), A[key], cols, { index: true, onDelete: () => changed() });
  tbl('#tblStations', 'stations', [{ k: 'name', label: 'Station', type: 'text', cls: 'w-name' }, { k: 'ch', label: 'Chainage', unit: 'm', type: 'num' }, { k: 'dwell', label: 'Dwell', unit: 's', type: 'num' }]);
  tbl('#tblGrad', 'gradients', [{ k: 'from', label: 'From', unit: 'm', type: 'num' }, { k: 'to', label: 'To', unit: 'm', type: 'num' }, { k: 'g', label: 'Gradient', unit: '‰', type: 'num' }]);
  tbl('#tblCurves', 'curves', [{ k: 'from', label: 'From', unit: 'm', type: 'num' }, { k: 'to', label: 'To', unit: 'm', type: 'num' }, { k: 'R', label: 'Radius', unit: 'm', type: 'num' }]);
  tbl('#tblSpeed', 'speed', [{ k: 'from', label: 'From', unit: 'm', type: 'num' }, { k: 'to', label: 'To', unit: 'm', type: 'num' }, { k: 'up', label: 'UP', unit: 'km/h', type: 'num' }, { k: 'dn', label: 'DOWN', unit: 'km/h', type: 'num' }]);
  if (!Array.isArray(A.elevations)) A.elevations = [];
  tbl('#tblLevels', 'elevations', [{ k: 'ch', label: 'Chainage', unit: 'm', type: 'num' }, { k: 'z', label: 'Rail level', unit: 'm', type: 'num' }]);
}
function renderElec() {
  fieldsInto($('#f_elec'), [
    ['electrical.V_nom', 'Nominal voltage', 'V'], ['electrical.V0', 'TSS no-load voltage', 'V'], ['electrical.regulation_pct', 'Rectifier regulation at rated load', '%', { help: 'sets source resistance when not given per TSS' }],
    ['electrical.r_pos', 'Conductor rail resistance (per track)', 'Ω/km'], ['electrical.r_ret', 'Return rail resistance (per track)', 'Ω/km'],
    ['electrical.R_feeder', 'Feeder resistance (+ and − cables)', 'Ω'], ['electrical.V_inv_on', 'Inverter switch-on voltage', 'V'], ['electrical.R_inv', 'Inverter source resistance', 'Ω'],
    ['electrical.pf', 'Power factor at transformer', ''], ['electrical.rect_eff', 'Rectifier efficiency', '']]);
  fieldsInto($('#f_trainV'), [
    ['electrical.V_regen_start', 'Regeneration limit starts', 'V'], ['electrical.V_regen_max', 'Regeneration zero at', 'V'],
    ['electrical.V_cut_start', 'Traction cut-back starts', 'V'], ['electrical.V_cut_zero', 'Traction zero at', 'V']]);
  fieldsInto($('#f_limits'), [
    ['limits.V_min', 'Minimum train voltage', 'V', { help: 'EN 50163 Umin1 for 750 V: 500 V' }], ['limits.V_max', 'Maximum train voltage', 'V'], ['limits.U_mean_useful', 'Mean useful voltage, minimum', 'V'],
    ['limits.conductor_A', 'Conductor rail continuous rating', 'A'], ['limits.feeder_A', 'Feeder cable rating', 'A'], ['limits.breaker_trip_A', 'Feeder breaker trip setting', 'A'],
    ['limits.breaking_kA', 'Breaker breaking capacity', 'kA'], ['limits.fault_margin', 'Min fault ÷ trip setting', '×'],
    ['limits.std_rect_kW', 'Standard rectifier sizes', 'kW', { type: 'text' }], ['limits.std_xfmr_kVA', 'Standard transformer sizes', 'kVA', { type: 'text' }]]);
  fieldsInto($('#f_duty'), [
    ['limits.normal.h1', 'Normal: 1-hour', '×'], ['limits.normal.m15', 'Normal: 15-min', '×'], ['limits.normal.m1', 'Normal: 1-min', '×'],
    ['limits.contingency.h1', 'Outage: 1-hour', '×'], ['limits.contingency.m15', 'Outage: 15-min', '×'], ['limits.contingency.m1', 'Outage: 1-min', '×']]);
}
function renderSimTab() {
  fieldsInto($('#f_sim'), [
    ['sim.period', 'Simulated period', 's', { help: '3600 = one peak hour' }], ['sim.dt', 'Time step', 's'], ['sim.dx', 'Train run distance step', 'm'],
    ['sim.bin_m', 'Voltage envelope bin', 'm'], ['sim.fault_step', 'Fault scan step', 'm'], ['sim.R_fault', 'Fault resistance', 'Ω'],
    ['sim.iter_max', 'Max iterations per step', ''], ['sim.tol_V', 'Convergence tolerance', 'V']]);
  $('#extraCases').value = (cfg.scenarios.extra || []).join('\n');
}
function renderExtra() {
  editTable($('#tblExtra'), cfg.extra_details, [{ k: 'key', label: 'Item', type: 'text', cls: 'w-name' }, { k: 'value', label: 'Value', type: 'text' }, { k: 'unit', label: 'Unit', type: 'text' }, { k: 'note', label: 'Note / source', type: 'text' }],
    { index: true, onChange: () => save(), onDelete: () => save() });
}
function renderInputs() { renderTitle(); renderTracks(); renderTss(); renderTrain(); renderAlign(); renderElec(); renderSimTab(); renderStudiesInputs(); renderExtra(); renderScenarioSel(); }

/* ---------------- scenarios ---------------- */
function scenarioOptions() {
  const o = [['', 'Normal service']];
  for (const t of cfg.tss) if (t.in_service !== false) o.push([t.name, t.name + ' out']);
  for (const x of cfg.scenarios.extra || []) { const n = String(x).split(/[+,;]+/).map(s => s.trim()).filter(Boolean); if (n.length) o.push([n.join('+'), n.join(' + ') + ' out']); }
  return o;
}
function renderScenarioSel() {
  const sel = $('#scenSel'); const o = scenarioOptions(); const cur = scenOutage.join('+');
  if (cur && !o.some(x => x[0] === cur)) o.push([cur, 'Custom: ' + scenOutage.join(' + ') + ' out']);
  sel.innerHTML = o.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('');
  sel.value = cur;
}

/* ---------------- worker ---------------- */
const WORKER_BODY = `
self.onmessage = function (e) {
  var d = e.data;
  try {
    if (d.cmd === 'run') {
      var r = TPS.simulate(d.cfg, { outage: d.outage });
      var f = TPS.faultScan(d.cfg, { outage: d.outage });
      var st = TPS.studies(d.cfg, r, f);
      r.checks = st.checks;
      self.postMessage({ cmd: 'run', id: d.id, r: r, f: f, st: { harm: st.harm, emc: st.emc } });
    } else if (d.cmd === 'design') {
      var out = TPS.designCheck(d.cfg, function (i, n, nm) { self.postMessage({ cmd: 'progress', i: i, n: n, name: nm }); });
      self.postMessage({ cmd: 'design', out: out });
    }
  } catch (err) { self.postMessage({ cmd: 'error', id: d.id, msg: String(err && err.message || err) }); }
};`;
function makeWorker() {
  try {
    const src = document.getElementById('engine-js').textContent + '\n' + WORKER_BODY;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = onWorker;
    w.onerror = (e) => { console.warn('worker error', e); };
    return w;
  } catch (e) { return null; }
}
function onWorker(e) {
  const d = e.data;
  if (d.cmd === 'run') {
    if (d.id !== runId) return;
    R = d.r; F = d.f; ST = d.st; dirty = false;
    const fails = R.checks.filter(c => !c.pass).length;
    setStatus(fails ? 'bad' : 'ok', (fails ? fails + ' check' + (fails > 1 ? 's' : '') + ' failing' : 'All checks pass') + ' · ' + R.scenario);
    renderResults();
  } else if (d.cmd === 'progress') {
    $('#dcProg').hidden = false; $('#dcProg i').style.width = (d.i / d.n * 100) + '%';
    setStatus('busy', 'Design check ' + d.i + ' / ' + d.n + ': ' + d.name);
  } else if (d.cmd === 'design') {
    DC = d.out; designBusy = false; $('#dcProg').hidden = true;
    $('#btnDesign').disabled = false; $('#btnDesign2').disabled = false;
    const nf = DC.filter(x => x.nFail).length;
    setStatus(nf ? 'bad' : 'ok', 'Design check: ' + (nf ? nf + ' of ' + DC.length + ' cases fail' : 'all ' + DC.length + ' cases pass'));
    renderDC(); location.hash = '#r_dc';
  } else if (d.cmd === 'error') {
    designBusy = false; $('#btnDesign').disabled = false; $('#btnDesign2').disabled = false;
    setStatus('bad', 'Calculation error: ' + d.msg);
  }
}
function syncTextInputs() {
  cfg.scenarios.extra = $('#extraCases').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
function runSim() {
  clearTimeout(runTimer);
  if (designBusy) { toast('Design check is running; the scenario runs when it finishes'); return; }
  syncTextInputs();
  const id = ++runId;
  setStatus('busy', 'Simulating ' + (scenOutage.length ? scenOutage.join(' + ') + ' out' : 'normal service') + '…');
  const msg = { cmd: 'run', id: id, cfg: JSON.parse(JSON.stringify(cfg)), outage: scenOutage.slice() };
  if (worker) { worker.terminate(); }
  worker = makeWorker();
  if (worker) worker.postMessage(msg);
  else setTimeout(() => { try { const r = TPS.simulate(msg.cfg, { outage: msg.outage }); const f = TPS.faultScan(msg.cfg, { outage: msg.outage }); const st = TPS.studies(msg.cfg, r, f); r.checks = st.checks; onWorker({ data: { cmd: 'run', id: id, r: r, f: f, st: { harm: st.harm, emc: st.emc } } }); } catch (err) { onWorker({ data: { cmd: 'error', msg: String(err.message || err) } }); } }, 30);
}
function runDesign() {
  syncTextInputs(); save();
  designBusy = true; $('#btnDesign').disabled = true; $('#btnDesign2').disabled = true;
  $('#dcProg').hidden = false; $('#dcProg i').style.width = '0';
  setStatus('busy', 'Design check starting…');
  if (worker) worker.terminate();
  worker = makeWorker();
  const c = JSON.parse(JSON.stringify(cfg));
  if (worker) worker.postMessage({ cmd: 'design', cfg: c });
  else setTimeout(() => { const out = TPS.designCheck(c); onWorker({ data: { cmd: 'design', out: out } }); }, 30);
}

/* ---------------- uploads: Word train data ---------------- */
let digiImages = [];
async function handleDocx(file) {
  if (!file) return;
  if (typeof JSZip === 'undefined') { toast('The Word reader library did not load; check the internet connection'); return; }
  try {
    setStatus('busy', 'Reading ' + file.name + '…');
    const buf = await file.arrayBuffer();
    const d = await TPSReaders.readDocx(buf, JSZip);
    const res = TPSReaders.trainFromBlocks(d.blocks, d.charts, cfg.trains[curTrain]);
    const T = res.train; T.source = file.name;
    if (!T.name || T.name === cfg.trains[curTrain].name) T.name = file.name.replace(/\.docx$/i, '');
    cfg.trains[curTrain] = T;
    digiImages = d.images.filter(im => im.data);
    const rep = res.report;
    const kinds = rep.curves.map(c => c[0]);
    let h = '<div class="group"><h3>Read from ' + esc(file.name) + ' <small>' + rep.params.length + ' parameters, ' + rep.curves.length + ' curves, ' + d.charts.length + ' Word charts, ' + d.images.length + ' images</small></h3>';
    if (rep.params.length) h += '<div class="tw scroll" style="max-height:220px"><table><thead><tr><th>Field</th><th class="n">Value used</th><th>Text in the document</th></tr></thead><tbody>' + rep.params.map(p => '<tr><td>' + esc(p[0]) + '</td><td class="n">' + esc(typeof p[1] === 'object' ? JSON.stringify(p[1]) : p[1]) + '</td><td class="muted">' + esc(p[2]) + '</td></tr>').join('') + '</tbody></table></div>';
    if (rep.curves.length) h += '<div class="log">' + rep.curves.map(c => '<span class="o">curve ' + esc(c[0]) + '</span>: ' + c[1] + ' points from ' + esc(c[3]) + ' (' + esc(c[2]) + ')').join('\n') + '</div>';
    if (rep.log.length) h += '<div class="log">' + rep.log.map(l => '<span class="w">' + esc(l) + '</span>').join('\n') + '</div>';
    if (d.images.length) {
      h += '<div><div class="note" style="margin-bottom:6px">' + (kinds.indexOf('te') < 0 ? '<b>No tractive effort table or chart was found.</b> Digitise the graph image to read the curve: ' : 'Graph images in the document (digitise one to replace a curve): ') + '</div><div class="thumbs">' +
        d.images.map((im, i) => im.data ? '<button data-img="' + i + '"><img alt="' + esc(im.name) + '" src="data:' + im.mime + ';base64,' + im.data + '"><span>' + esc(im.name) + ' · digitise</span></button>' : '<span class="chip warn">' + esc(im.name) + ': format not readable, save as PNG</span>').join('') + '</div></div>';
    }
    h += '</div>';
    const box = $('#docxReport'); box.innerHTML = h; box.hidden = false;
    $$('button[data-img]', box).forEach(b => b.addEventListener('click', () => { const im = d.images[+b.dataset.img]; openDigitiser('data:' + im.mime + ';base64,' + im.data, im.name); }));
    renderTrain(); renderTracks(); changed(false);
    toast('Train data read: ' + rep.params.length + ' parameters, ' + rep.curves.length + ' curves');
  } catch (err) { setStatus('bad', 'Could not read ' + file.name + ': ' + (err.message || err)); }
}
/* ---------------- uploads: Excel alignment ---------------- */
async function handleXlsx(file) {
  if (!file) return;
  if (typeof XLSX === 'undefined') { toast('The Excel reader library did not load; check the internet connection'); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheets = {};
    for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    const res = TPSReaders.alignmentFromSheets(sheets);
    TPSReaders.mergeAlignment(cfg, res.part);
    cfg.alignment.source = file.name;
    const p = res.part;
    const box = $('#xlsxReport');
    box.innerHTML = '<div class="group"><h3>Read from ' + esc(file.name) + ' <small>' + p.stations.length + ' stations, ' + p.gradients.length + ' gradients, ' + p.curves.length + ' curves, ' + p.speed.length + ' speed limits, ' + p.elevations.length + ' levels</small></h3><div class="log">' +
      res.log.map(l => /not recognised|no header/.test(l) ? '<span class="w">' + esc(l) + '</span>' : esc(l)).join('\n') + '</div>' +
      (p.stations.length ? '' : '<p class="note"><b>No station sheet found;</b> the previous stations are kept. Add a sheet with Station and Chainage columns.</p>') + '</div>';
    box.hidden = false;
    renderAlign(); changed();
    toast('Alignment read from ' + file.name);
  } catch (err) { setStatus('bad', 'Could not read ' + file.name + ': ' + (err.message || err)); }
}
function initDrop(zone, input, fn) {
  input.addEventListener('change', () => { fn(input.files[0]); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) fn(f); });
}

/* ---------------- digitiser ---------------- */
const DG = { img: null, data: null, box: null, color: null, pts: [], mode: 'color', frameClick: 0, name: '' };
function openDigitiser(src, name) {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
    DG.img = c; DG.data = x.getImageData(0, 0, c.width, c.height); DG.pts = []; DG.color = null; DG.name = name || 'image';
    DG.box = TPSReaders.detectPlotBox(DG.data);
    if (DG.box.R - DG.box.L < 20 || DG.box.B - DG.box.T < 20) DG.box = { L: Math.round(c.width * 0.1), T: Math.round(c.height * 0.08), R: Math.round(c.width * 0.95), B: Math.round(c.height * 0.88) };
    const cv = $('#digiCanvas'); cv.width = c.width; cv.height = c.height;
    $('#digiTitle').textContent = 'Graph digitiser · ' + DG.name;
    $('#digiModal').hidden = false; setDigiMode('color'); drawDigi(); renderDigiTbl();
  };
  im.src = src;
}
function setDigiMode(m) { DG.mode = m; DG.frameClick = 0; ['Frame', 'Color', 'Add', 'Del'].forEach(k => $('#dm' + k).setAttribute('aria-pressed', String(('dm' + k).toLowerCase() === ('dm' + m).toLowerCase()))); $('#digiHint').textContent = { frame: 'Click the top-left corner of the plot frame, then the bottom-right corner.', color: 'Click on the curve to pick its colour, then press Trace curve.', add: 'Click on the curve to add points by hand.', del: 'Click a point to remove it.' }[m]; }
function axes() { return { x0: parseFloat($('#axX0').value), x1: parseFloat($('#axX1').value), y0: parseFloat($('#axY0').value), y1: parseFloat($('#axY1').value) }; }
function px2val(px, py) { const a = axes(), b = DG.box; return [a.x0 + (px - b.L) / (b.R - b.L) * (a.x1 - a.x0), a.y0 + (b.B - py) / (b.B - b.T) * (a.y1 - a.y0)]; }
function val2px(x, y) { const a = axes(), b = DG.box; return [b.L + (x - a.x0) / (a.x1 - a.x0) * (b.R - b.L), b.B - (y - a.y0) / (a.y1 - a.y0) * (b.B - b.T)]; }
function drawDigi() {
  const cv = $('#digiCanvas'), x = cv.getContext('2d');
  x.drawImage(DG.img, 0, 0);
  const b = DG.box, lw = Math.max(1.5, cv.width / 600);
  x.strokeStyle = '#d0208f'; x.lineWidth = lw; x.setLineDash([6, 4]); x.strokeRect(b.L, b.T, b.R - b.L, b.B - b.T); x.setLineDash([]);
  if (DG.pts.length) {
    x.strokeStyle = '#111'; x.lineWidth = lw; x.beginPath();
    DG.pts.forEach((p, i) => { const q = val2px(p[0], p[1]); if (i) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); }); x.stroke();
    for (const p of DG.pts) { const q = val2px(p[0], p[1]); x.fillStyle = '#ffd400'; x.strokeStyle = '#111'; x.beginPath(); x.arc(q[0], q[1], 3.5 * lw, 0, 6.3); x.fill(); x.stroke(); }
  }
  $('#digiSw').style.background = DG.color ? 'rgb(' + DG.color.join(',') + ')' : 'transparent';
  $('#digiCol').textContent = DG.color ? 'rgb(' + DG.color.join(', ') + ')' : 'auto (most frequent colour)';
}
function renderDigiTbl() {
  $('#digiTbl').innerHTML = '<thead><tr><th class="n">X</th><th class="n">Y</th></tr></thead><tbody>' + (DG.pts.length ? DG.pts.map(p => '<tr><td class="n">' + fmt(p[0], 2) + '</td><td class="n">' + fmt(p[1], 2) + '</td></tr>').join('') : '<tr><td colspan="2" class="muted">No points yet</td></tr>') + '</tbody>';
}
function digiClick(e) {
  const cv = $('#digiCanvas'), r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * cv.width, py = (e.clientY - r.top) / r.height * cv.height;
  if (DG.mode === 'frame') {
    if (DG.frameClick === 0) { DG.box = { L: Math.round(px), T: Math.round(py), R: DG.box.R, B: DG.box.B }; DG.frameClick = 1; $('#digiHint').textContent = 'Now click the bottom-right corner of the plot frame.'; }
    else { DG.box.R = Math.round(px); DG.box.B = Math.round(py); DG.frameClick = 0; setDigiMode('color'); }
  } else if (DG.mode === 'color') {
    const d = DG.data, cx = Math.round(px), cy = Math.round(py); let best = null, bs = -1;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= d.width || Y >= d.height) continue;
      const i = 4 * (Y * d.width + X), c = [d.data[i], d.data[i + 1], d.data[i + 2]];
      const s = Math.max.apply(null, c) - Math.min.apply(null, c) + (255 - (c[0] + c[1] + c[2]) / 3) * 0.3;
      if (s > bs) { bs = s; best = c; }
    }
    DG.color = best;
  } else if (DG.mode === 'add') {
    DG.pts.push(px2val(px, py).map(v => Math.round(v * 1000) / 1000)); DG.pts.sort((a, b) => a[0] - b[0]); renderDigiTbl();
  } else if (DG.mode === 'del') {
    let bi = -1, bd = 1e9; DG.pts.forEach((p, i) => { const q = val2px(p[0], p[1]); const dd = Math.hypot(q[0] - px, q[1] - py); if (dd < bd) { bd = dd; bi = i; } });
    if (bi >= 0 && bd < 20 * cv.width / r.width) { DG.pts.splice(bi, 1); renderDigiTbl(); }
  }
  drawDigi();
}
function initDigitiser() {
  $('#digiClose').addEventListener('click', () => { $('#digiModal').hidden = true; });
  $('#digiModal').addEventListener('click', e => { if (e.target.id === 'digiModal') $('#digiModal').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#digiModal').hidden = true; });
  $('#dmFrame').addEventListener('click', () => setDigiMode('frame')); $('#dmColor').addEventListener('click', () => setDigiMode('color'));
  $('#dmAdd').addEventListener('click', () => setDigiMode('add')); $('#dmDel').addEventListener('click', () => setDigiMode('del'));
  $('#digiCanvas').addEventListener('click', digiClick);
  $('#digiAuto').addEventListener('click', () => { DG.box = TPSReaders.detectPlotBox(DG.data); drawDigi(); });
  $('#digiClear').addEventListener('click', () => { DG.pts = []; drawDigi(); renderDigiTbl(); });
  ['#axX0', '#axX1', '#axY0', '#axY1'].forEach(s => $(s).addEventListener('change', () => { drawDigi(); }));
  $('#digiUse').addEventListener('change', () => { const u = $('#digiUse').value; if (u === 'eff_curve') { $('#axY1').value = 100; } else if (u === 'line_current') { $('#axY1').value = 6000; } });
  $('#digiTrace').addEventListener('click', () => {
    const a = axes(); if (![a.x0, a.x1, a.y0, a.y1].every(isFinite) || a.x1 === a.x0 || a.y1 === a.y0) { toast('Enter the four axis values first'); return; }
    const r = TPSReaders.digitize(DG.data, DG.box, a, DG.color, Math.max(5, Math.min(200, parseInt($('#digiN').value, 10) || 25)));
    if (!r) { toast('No curve found inside the frame. Pick the curve colour or check the frame.'); return; }
    DG.pts = r.data; if (!DG.color && r.color) DG.color = r.color; drawDigi(); renderDigiTbl();
  });
  $('#digiApply').addEventListener('click', () => {
    if (DG.pts.length < 2) { toast('Trace the curve or add at least two points first'); return; }
    const use = $('#digiUse').value; const T = cfg.trains[curTrain];
    let pts = DG.pts.map(p => [Math.max(0, p[0]), p[1]]);
    if (use === 'eff_curve' && Math.max.apply(null, pts.map(p => p[1])) > 1.5) pts = pts.map(p => [p[0], p[1] / 100]);
    T[use] = pts; if (use === 'line_current') T.power_mode = 'line_current';
    $('#digiModal').hidden = true; renderTrain(); changed(false);
    toast(pts.length + ' points applied to ' + (T.name || 'train') + ' · ' + $('#digiUse').selectedOptions[0].textContent);
  });
}

/* ---------------- charts ---------------- */
const vlinePlugin = {
  id: 'vlines',
  afterDatasetsDraw(ch, a, opts) {
    const L = (opts && opts.lines) || []; if (!L.length) return;
    const { ctx, chartArea: ca, scales: { x } } = ch;
    ctx.save();
    for (const l of L) {
      const px = x.getPixelForValue(l.x); if (px < ca.left || px > ca.right) continue;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1; ctx.setLineDash(l.dash || []); ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke();
      if (l.label) { ctx.setLineDash([]); ctx.fillStyle = l.color; ctx.font = '10px ' + css('--f-mono'); ctx.textAlign = 'center'; ctx.fillText(l.label, px, ca.top - 3); }
    }
    ctx.restore();
  }
};
function baseOpts(xTitle, yTitle, extra) {
  const ink2 = css('--ink2'), grid = css('--grid');
  const o = {
    animation: false, responsive: true, maintainAspectRatio: false, parsing: false, normalized: true,
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    layout: { padding: { top: 14 } },
    plugins: {
      legend: { labels: { color: ink2, boxWidth: 14, boxHeight: 2, font: { family: css('--f-body'), size: 11 } } },
      tooltip: { callbacks: {} }, decimation: { enabled: true, algorithm: 'lttb', samples: 700 }, vlines: { lines: [] }
    },
    scales: {
      x: { type: 'linear', title: { display: !!xTitle, text: xTitle, color: ink2 }, ticks: { color: ink2, font: { family: css('--f-mono'), size: 10 } }, grid: { color: grid } },
      y: { title: { display: !!yTitle, text: yTitle, color: ink2 }, ticks: { color: ink2, font: { family: css('--f-mono'), size: 10 } }, grid: { color: grid } }
    }
  };
  return Object.assign(o, extra || {});
}
function mkChart(id, type, data, options) {
  if (typeof Chart === 'undefined') return null;
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id); if (!el) return null;
  charts[id] = new Chart(el, { type: type, data: data, options: options, plugins: [vlinePlugin] });
  return charts[id];
}
const PAL = () => [css('--up'), css('--dn'), css('--accent'), css('--pass'), css('--warn'), '#5b6f8a', '#b04a7a', '#3d8f8a', '#8a6d3b', '#6b4fb5', '#c2185b', '#00897b'];
function drawCurvePreview() {
  const T = cfg.trains[curTrain]; if (!T) return;
  const ds = [];
  const ser = (k, lab, col, axis, dash, sc) => { const t = TPS.cleanTable(T[k] || []); if (t.length) ds.push({ label: lab, data: t.map(r => ({ x: r[0], y: r[1] * (sc || 1) })), borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 2, borderDash: dash || [], yAxisID: axis, tension: 0 }); };
  const m = T.te_basis === 'motor' ? Math.max(1, num(T.n_motors, 1)) : 1;
  ser('te_curve', 'Tractive effort (kN' + (m > 1 ? ', per train' : '') + ')', css('--up'), 'y', null, m);
  ser('be_curve', 'Electric brake effort (kN' + (m > 1 ? ', per train' : '') + ')', css('--dn'), 'y', [5, 3], m);
  ser('eff_curve', 'Efficiency (%)', css('--pass'), 'y2', [2, 2], 100);
  ser('line_current', 'Line current (A)', css('--accent'), 'y3');
  const o = baseOpts('Speed (km/h)', 'Effort (kN)');
  o.scales.y2 = { position: 'right', min: 0, max: 100, title: { display: true, text: '%', color: css('--ink2') }, ticks: { color: css('--ink2') }, grid: { display: false } };
  o.scales.y3 = { position: 'right', display: !!(T.line_current || []).length, title: { display: true, text: 'A', color: css('--ink2') }, ticks: { color: css('--ink2') }, grid: { display: false } };
  mkChart('chCurves', 'line', { datasets: ds }, o);
}

/* ---------------- drawings: line schematic ---------------- */
function svgEl(w, h, inner, label) { return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(label) + '" style="font-family:' + esc(css('--f-body')) + '">' + inner + '</svg>'; }
function niceStep(range, n) { const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
function tssStatus(name) {
  if (!R) return 'none';
  const rows = R.checks.filter(c => c.where === name && (c.group === 'Rectifier' || c.group === 'Transformer'));
  if (!rows.length) return 'none';
  if (rows.some(c => !c.pass)) return 'fail';
  if (rows.some(c => c.ratio > 0.9)) return 'warn';
  return 'pass';
}
function renderPlan() {
  let ext; try { ext = TPS.lineExtent(cfg); } catch (e) { return; }
  const W = 1400, ml = 92, mr = 36;
  const X = c => ml + (c - ext[0]) / Math.max(1, ext[1] - ext[0]) * (W - ml - mr);
  const tracks = cfg.tracks.filter(t => t.enabled !== false);
  const ups = tracks.filter(t => t.dir === 'UP'), dns = tracks.filter(t => t.dir === 'DN');
  const order = ups.slice().reverse().concat(dns);
  const stS = cfg.alignment.stations.slice().sort((a, b) => a.ch - b.ch);
  const stRow = []; { let last = -1e9; let lastRow = 1; for (const p of stS) { const x = X(+p.ch); const r = (x - last < 64 && lastRow === 0) ? 1 : 0; stRow.push(r); if (r === 0) last = x; lastRow = r; } }
  const anyStRow = stRow.some(r => r === 1) && stS.length <= 18;
  const top = anyStRow ? 120 : 92, gap = 26;
  const tsS = cfg.tss.map((t, i) => [X(+t.ch), i]).sort((a, b) => a[0] - b[0]);
  const tRow = new Array(cfg.tss.length).fill(0); { let last = -1e9; for (const [x, i] of tsS) { if (x - last < 84) { tRow[i] = 1; } else last = x; } }
  const anyTRow = tRow.some(r => r === 1);
  const ty = {}; order.forEach((t, i) => { ty[t.name] = top + i * gap; });
  const lastY = top + Math.max(0, order.length - 1) * gap;
  const tssY0 = lastY + 58, H = tssY0 + 118 + (anyTRow ? 76 : 0);
  const ink = css('--ink'), ink2 = css('--ink2'), ink3 = css('--ink3'), rule = css('--rule'), grid = css('--grid'), panel = css('--panel');
  let s = '';
  // chainage scale
  const step = niceStep(ext[1] - ext[0], 12);
  for (let c = Math.ceil(ext[0] / step) * step; c <= ext[1]; c += step) {
    s += '<line x1="' + X(c) + '" y1="' + (H - 34) + '" x2="' + X(c) + '" y2="' + (H - 28) + '" stroke="' + ink3 + '"/><text x="' + X(c) + '" y="' + (H - 16) + '" fill="' + ink3 + '" font-size="11" text-anchor="middle" font-family="' + esc(css('--f-mono')) + '">' + (c / 1000).toFixed(step < 1000 ? 1 : 0) + ' km</text>';
  }
  s += '<line x1="' + ml + '" y1="' + (H - 34) + '" x2="' + (W - mr) + '" y2="' + (H - 34) + '" stroke="' + ink3 + '"/>';
  // stations
  const st = stS;
  const crowded = st.length > 18;
  for (let si = 0; si < st.length; si++) {
    const p = st[si], x = X(+p.ch), dy = stRow[si] ? -28 : 0;
    s += '<rect x="' + (x - 5) + '" y="' + (top - 12) + '" width="10" height="' + (lastY - top + 24) + '" fill="' + grid + '" stroke="' + rule + '"/>';
    if (crowded) s += '<text transform="translate(' + (x + 3) + ',' + (top - 18) + ') rotate(-45)" fill="' + ink2 + '" font-size="11">' + esc(p.name) + '</text>';
    else s += '<text x="' + x + '" y="' + (top - 34 + dy) + '" fill="' + ink + '" font-size="12" font-weight="600" text-anchor="middle">' + esc(p.name) + '</text><text x="' + x + '" y="' + (top - 20 + dy) + '" fill="' + ink3 + '" font-size="10" text-anchor="middle" font-family="' + esc(css('--f-mono')) + '">' + fmt(+p.ch) + '</text>';
  }
  // tracks
  for (const t of order) {
    const y = ty[t.name], col = t.dir === 'UP' ? css('--up') : css('--dn');
    s += '<line x1="' + ml + '" y1="' + y + '" x2="' + (W - mr) + '" y2="' + y + '" stroke="' + col + '" stroke-width="3"/>';
    s += '<text x="' + (ml - 10) + '" y="' + (y + 4) + '" fill="' + col + '" font-size="12" font-weight="600" text-anchor="end">' + esc(t.name) + (t.dir === 'UP' ? ' →' : ' ←') + '</text>';
  }
  // TSS
  const outSet = new Set(scenOutage);
  cfg.tss.forEach((t, i) => {
    const tssY = tssY0 + tRow[i] * 76;
    const x = X(+t.ch), off = t.in_service === false || outSet.has(String(t.name));
    const stt = off ? 'off' : tssStatus(t.name);
    const col = off ? ink3 : stt === 'fail' ? css('--fail') : stt === 'warn' ? css('--warn') : stt === 'pass' ? css('--pass') : css('--tss');
    const res = R ? R.tss.find(z => z.name === t.name) : null;
    let g = '<g class="tssg" data-tss="' + esc(t.name) + '" style="cursor:pointer" tabindex="0" role="button" aria-label="' + esc(t.name) + (off ? ' out of service' : '') + ', toggle outage">';
    g += '<rect x="' + (x - 34) + '" y="' + (tssY - 18) + '" width="68" height="94" fill="transparent"/><rect x="' + (x - 9) + '" y="' + (top - 8) + '" width="18" height="' + (tssY - top) + '" fill="transparent"/>';
    for (const tr of order) g += '<line x1="' + x + '" y1="' + ty[tr.name] + '" x2="' + x + '" y2="' + (tssY - 14) + '" stroke="' + col + '" stroke-width="1.6"' + (off ? ' stroke-dasharray="4 3"' : '') + '/><circle cx="' + x + '" cy="' + ty[tr.name] + '" r="3.5" fill="' + col + '"/>';
    g += '<rect x="' + (x - 15) + '" y="' + (tssY - 14) + '" width="30" height="28" fill="' + panel + '" stroke="' + col + '" stroke-width="2"' + (off ? ' stroke-dasharray="4 3"' : '') + '/>';
    g += '<path d="M' + (x - 7) + ' ' + (tssY - 5) + ' l7 9 l7 -9 z M' + (x - 7) + ' ' + (tssY + 5) + ' h14" stroke="' + col + '" stroke-width="1.6" fill="none"/>';
    g += '<text x="' + x + '" y="' + (tssY + 30) + '" fill="' + ink + '" font-size="12" font-weight="600" text-anchor="middle">' + esc(t.name) + '</text>';
    g += '<text x="' + x + '" y="' + (tssY + 44) + '" fill="' + ink3 + '" font-size="10" text-anchor="middle" font-family="' + esc(css('--f-mono')) + '">' + fmt(+t.ch) + ' m</text>';
    g += '<text x="' + x + '" y="' + (tssY + 57) + '" fill="' + ink2 + '" font-size="10" text-anchor="middle" font-family="' + esc(css('--f-mono')) + '">' + fmt(+t.rect_kW) + ' kW</text>';
    if (off) g += '<text x="' + x + '" y="' + (tssY + 71) + '" fill="' + ink3 + '" font-size="10" font-weight="600" text-anchor="middle">OUT</text>';
    else if (res && res.active) { const lim = (R.contingency ? cfg.limits.contingency.h1 : cfg.limits.normal.h1) || 1; g += '<text x="' + x + '" y="' + (tssY + 71) + '" fill="' + col + '" font-size="10" font-weight="600" text-anchor="middle" font-family="' + esc(css('--f-mono')) + '">' + fmt(res.I1h / (res.Ir * lim) * 100) + ' % 1-h</text>'; }
    s += g + '</g>';
  });
  const legend = '<g font-size="11" fill="' + ink2 + '"><text x="' + ml + '" y="18">TSS colour: rating check of the current result — </text><rect x="' + (ml + 268) + '" y="9" width="10" height="10" fill="' + css('--pass') + '"/><text x="' + (ml + 284) + '" y="18">pass</text><rect x="' + (ml + 320) + '" y="9" width="10" height="10" fill="' + css('--warn') + '"/><text x="' + (ml + 336) + '" y="18">over 90 %</text><rect x="' + (ml + 400) + '" y="9" width="10" height="10" fill="' + css('--fail') + '"/><text x="' + (ml + 416) + '" y="18">fail</text><rect x="' + (ml + 448) + '" y="9" width="10" height="10" fill="none" stroke="' + ink3 + '" stroke-dasharray="3 2"/><text x="' + (ml + 464) + '" y="18">out of service</text></g>';
  $('#planSvg').innerHTML = svgEl(W, H, legend + s, 'Line schematic with tracks, stations and traction substations');
  $$('#planSvg .tssg').forEach(g => {
    const act = () => {
      const n = g.dataset.tss; const t = cfg.tss.find(z => String(z.name) === n);
      if (t && t.in_service === false) { toast(n + ' is out of service permanently; tick "In service" on the TSS tab'); return; }
      const i = scenOutage.indexOf(n); if (i >= 0) scenOutage.splice(i, 1); else scenOutage.push(n);
      renderScenarioSel(); renderPlan(); runSim();
    };
    g.addEventListener('click', act); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  });
}

/* ---------------- drawings: long section ---------------- */
function renderLong() {
  let ext, el; try { ext = TPS.lineExtent(cfg); el = TPS.elevationProfile(cfg, Math.max(10, (ext[1] - ext[0]) / 700)); } catch (e) { return; }
  const W = 1400, ml = 110, mr = 36;
  const X = c => ml + (c - ext[0]) / Math.max(1, ext[1] - ext[0]) * (W - ml - mr);
  const ink = css('--ink'), ink2 = css('--ink2'), ink3 = css('--ink3'), rule = css('--rule'), grid = css('--grid'), mono = esc(css('--f-mono'));
  const A = cfg.alignment;
  const lanes = [['Level (m)', 170], ['Gradient ‰', 50], ['Curves', 50], ['Speed (km/h)', 110], ['Stations', 46]];
  let y = 12; const L = {};
  let s = '';
  for (const [n, h] of lanes) { L[n] = { y: y, h: h }; s += '<rect x="' + ml + '" y="' + y + '" width="' + (W - ml - mr) + '" height="' + h + '" fill="none" stroke="' + rule + '"/><text x="' + (ml - 8) + '" y="' + (y + h / 2 + 4) + '" fill="' + ink2 + '" font-size="11" font-weight="600" text-anchor="end">' + n + '</text>'; y += h + 6; }
  const H = y + 22;
  // level
  const zl = L['Level (m)'];
  const zmin = Math.min.apply(null, el.z), zmax = Math.max.apply(null, el.z), zr = Math.max(1, zmax - zmin);
  const Z = z => zl.y + zl.h - 14 - (z - zmin) / zr * (zl.h - 30);
  for (const z of [zmin, (zmin + zmax) / 2, zmax]) s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Z(z) + '" y2="' + Z(z) + '" stroke="' + grid + '"/><text x="' + (ml + 4) + '" y="' + (Z(z) - 3) + '" fill="' + ink3 + '" font-size="10" font-family="' + mono + '">' + z.toFixed(1) + '</text>';
  s += '<path d="' + el.x.map((x, i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Z(el.z[i]).toFixed(1)).join(' ') + ' L' + X(el.x[el.x.length - 1]) + ' ' + (zl.y + zl.h) + ' L' + X(el.x[0]) + ' ' + (zl.y + zl.h) + ' Z" fill="' + css('--accent-soft') + '" stroke="none"/>';
  s += '<path d="' + el.x.map((x, i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Z(el.z[i]).toFixed(1)).join(' ') + '" fill="none" stroke="' + ink + '" stroke-width="1.6"/>';
  for (const t of cfg.tss) s += '<path d="M' + X(+t.ch) + ' ' + (zl.y + zl.h - 2) + ' l-5 -9 h10 z" fill="' + css('--tss') + '"/>';
  // gradient lane
  const gl = L['Gradient ‰'], gm = gl.y + gl.h / 2;
  s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + gm + '" y2="' + gm + '" stroke="' + grid + '"/>';
  const gmax = Math.max(1, Math.max.apply(null, A.gradients.map(g => Math.abs(+g.g)).concat([1])));
  for (const g of A.gradients) {
    const x1 = X(+g.from), x2 = X(+g.to), d = -(+g.g) / gmax * (gl.h / 2 - 6);
    s += '<line x1="' + x1 + '" x2="' + x1 + '" y1="' + (gl.y + 4) + '" y2="' + (gl.y + gl.h - 4) + '" stroke="' + rule + '"/>';
    s += '<line x1="' + x1 + '" y1="' + (gm - d) + '" x2="' + x2 + '" y2="' + (gm + d) + '" stroke="' + ink + '" stroke-width="1.3"/>';
    if (x2 - x1 > 34) s += '<text x="' + ((x1 + x2) / 2) + '" y="' + (+g.g >= 0 ? gl.y + gl.h - 5 : gl.y + 12) + '" fill="' + ink2 + '" font-size="10" text-anchor="middle" font-family="' + mono + '">' + (+g.g > 0 ? '+' : '') + (+g.g).toFixed(1) + '</text>';
  }
  // curves lane
  const cl = L['Curves'], cm = cl.y + cl.h / 2;
  s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + cm + '" y2="' + cm + '" stroke="' + ink3 + '"/>';
  for (const c of A.curves) {
    const x1 = X(+c.from), x2 = X(+c.to);
    s += '<rect x="' + x1 + '" y="' + (cm - 12) + '" width="' + Math.max(2, x2 - x1) + '" height="12" fill="' + css('--dn') + '" fill-opacity=".3" stroke="' + css('--dn') + '"/>';
    s += '<text x="' + ((x1 + x2) / 2) + '" y="' + (cm + 15) + '" fill="' + ink2 + '" font-size="10" text-anchor="middle" font-family="' + mono + '">R' + fmt(+c.R) + '</text>';
  }
  // speed lane
  const sl = L['Speed (km/h)'];
  const tm = cfg.trains[0] || {}; const vmax = num(tm.vmax, 80);
  const vtop = Math.max(vmax, Math.max.apply(null, A.speed.map(z => Math.max(num(z.up, 0), num(z.dn, 0))).concat([vmax]))) * 1.1;
  const V = v => sl.y + sl.h - 8 - v / vtop * (sl.h - 16);
  const step = Math.max(5, (ext[1] - ext[0]) / 900);
  for (const [dir, col, dash] of [[1, css('--up'), ''], [-1, css('--dn'), '5 3']]) {
    let d = '';
    for (let x = ext[0]; x <= ext[1]; x += step) d += (d ? 'L' : 'M') + X(x).toFixed(1) + ' ' + V(TPS.speedLimitAt(cfg, 0, vmax, x, dir)).toFixed(1) + ' ';
    s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
  }
  for (const v of [0, Math.round(vmax / 2), vmax]) s += '<text x="' + (ml + 4) + '" y="' + (V(v) - 2) + '" fill="' + ink3 + '" font-size="10" font-family="' + mono + '">' + v + '</text>';
  if (R) { // simulated speed of first runs
    let k = 0;
    for (const key of Object.keys(R.runs).slice(0, 2)) {
      const run = R.runs[key]; let d = '';
      for (let i = 0; i < run.n; i += 2) d += (d ? 'L' : 'M') + X(run.x[i]).toFixed(1) + ' ' + V(run.v[i]).toFixed(1) + ' ';
      s += '<path d="' + d + '" fill="none" stroke="' + (k ? css('--dn') : css('--up')) + '" stroke-opacity=".45" stroke-width="1"/>'; k++;
    }
  }
  s += '<text x="' + (W - mr - 4) + '" y="' + (sl.y + 12) + '" fill="' + ink3 + '" font-size="10" text-anchor="end">line limit UP solid, DOWN dashed' + (R ? ' · simulated speed faint' : '') + '</text>';
  // stations lane
  const stl = L['Stations'];
  const st = A.stations.slice().sort((a, b) => a.ch - b.ch);
  st.forEach((p, i) => {
    const x = X(+p.ch);
    s += '<line x1="' + x + '" x2="' + x + '" y1="' + zl.y + '" y2="' + (stl.y + 8) + '" stroke="' + ink3 + '" stroke-dasharray="2 3" stroke-opacity=".6"/>';
    s += '<text x="' + x + '" y="' + (stl.y + (i % 2 ? 36 : 22)) + '" fill="' + ink + '" font-size="11" font-weight="600" text-anchor="middle">' + esc(p.name) + '</text>';
  });
  const tstep = niceStep(ext[1] - ext[0], 12);
  for (let c = Math.ceil(ext[0] / tstep) * tstep; c <= ext[1]; c += tstep) s += '<text x="' + X(c) + '" y="' + (H - 6) + '" fill="' + ink3 + '" font-size="10" text-anchor="middle" font-family="' + mono + '">' + (c / 1000).toFixed(tstep < 1000 ? 1 : 0) + ' km</text>';
  $('#longSvg').innerHTML = svgEl(W, H, s, 'Long section: levels, gradients, curves, speed limits and stations');
}

/* ---------------- results ---------------- */
function dutyNow() { return R && R.contingency ? cfg.limits.contingency : cfg.limits.normal; }
function card(cls, label, v, unit, sub) { return '<div class="card ' + cls + '"><div class="lbl">' + esc(label) + '</div><div class="v">' + v + (unit ? ' <small>' + esc(unit) + '</small>' : '') + '</div><div class="s">' + sub + '</div></div>'; }
function renderCards() {
  if (!R) { $('#cards').innerHTML = '<p class="note">Run the simulation to see results.</p>'; return; }
  const ch = R.checks, fails = ch.filter(c => !c.pass).length, Lm = cfg.limits, d = dutyNow();
  const act = R.tss.filter(t => t.active);
  const wr = act.reduce((m, t) => { const r = Math.max(t.I1h / (t.Ir * d.h1), t.I15 / (t.Ir * d.m15), t.I1 / (t.Ir * d.m1)); return r > m.r ? { r: r, t: t } : m; }, { r: 0, t: null });
  const wx = act.reduce((m, t) => { const r = Math.max(t.S1h / (t.xfmr_kVA * d.h1), t.S15 / (t.xfmr_kVA * d.m15)); return r > m.r ? { r: r, t: t } : m; }, { r: 0, t: null });
  const wc = R.conductor.reduce((m, c) => c.I1h > m.I1h ? c : m, { I1h: 0 });
  const st = (r) => r > 1 ? 'bad' : r > 0.9 ? 'warn' : 'ok';
  const E = R.energy;
  const fmax = F ? Math.max.apply(null, F.tracks.map(t => t.max)) : null, fminF = F ? Math.min.apply(null, F.tracks.map(t => t.minFeeder)) : null;
  $('#cards').innerHTML = [
    card(fails ? 'bad' : 'ok', 'Result check', (ch.length - fails) + '<small> / ' + ch.length + ' pass</small>', '', fails ? '<b style="color:var(--fail)">' + fails + ' failing</b> · ' + esc(ch[0].group + ': ' + ch[0].item) : 'all ratings and limits met'),
    card(R.trainV.min < Lm.V_min ? 'bad' : 'ok', 'Minimum train voltage', fmt(R.trainV.min), 'V', 'limit ' + fmt(Lm.V_min) + ' V' + (R.trainV.minAt ? ' · ' + esc(R.trainV.minAt.track) + ' at ' + fmt(R.trainV.minAt.x) + ' m' : '')),
    card(R.trainV.max > Lm.V_max ? 'bad' : 'ok', 'Maximum train voltage', fmt(R.trainV.max), 'V', 'limit ' + fmt(Lm.V_max) + ' V (regeneration)'),
    card(R.contingency ? '' : (R.trainV.mean_useful < Lm.U_mean_useful ? 'bad' : 'ok'), 'Mean useful voltage', fmt(R.trainV.mean_useful), 'V', R.contingency ? 'not checked in outage cases' : 'limit ' + fmt(Lm.U_mean_useful) + ' V (motoring trains)'),
    card(st(wr.r), 'Worst rectifier loading', fmt(wr.r * 100), '%', wr.t ? esc(wr.t.name) + ' · 1-h ' + fmt(wr.t.I1h) + ' A of ' + fmt(wr.t.Ir) + ' A rated' : ''),
    card(st(wx.r), 'Worst transformer loading', fmt(wx.r * 100), '%', wx.t ? esc(wx.t.name) + ' · ' + fmt(wx.t.S1h) + ' of ' + fmt(wx.t.xfmr_kVA) + ' kVA' : ''),
    card(st(wc.I1h / Lm.conductor_A), 'Conductor rail, 1-h RMS', fmt(wc.I1h), 'A', 'rating ' + fmt(Lm.conductor_A) + ' A' + (wc.track ? ' · ' + esc(wc.track) + ' at ' + esc(wc.tss) : '')),
    card('', 'Energy from substations', fmt(E.tss_kWh), 'kWh', 'per ' + fmt(R.period / 60) + ' min · losses ' + fmt(E.losses_kWh / Math.max(E.tss_kWh, 1) * 100, 1) + ' %'),
    card('', 'Regeneration', fmt(E.regen_out_kWh), 'kWh', 'returned to line · ' + fmt(E.rheostat_kWh) + ' kWh lost in rheostats' + (E.inverter_kWh ? ' · ' + fmt(E.inverter_kWh) + ' kWh via inverters' : '')),
    card(F ? (fmax / 1000 > Lm.breaking_kA || fminF < Lm.breaker_trip_A * Lm.fault_margin ? 'bad' : 'ok') : '', 'DC fault current', F ? fmt(fmax / 1000, 1) : '–', 'kA max', F ? 'min feeder ' + fmt(fminF / 1000, 1) + ' kA vs trip ' + fmt(Lm.breaker_trip_A / 1000, 1) + ' kA' : '')
  ].join('');
  const w = (R.warnings || []).concat(R.solver.non_converged_steps ? ['Load flow did not converge in ' + R.solver.non_converged_steps + ' time steps; results near those steps are approximate'] : []);
  $('#warnBox').innerHTML = w.length ? '<div class="log">' + w.map(x => '<span class="w">' + esc(x) + '</span>').join('\n') + '</div>' : '';
  $('#sumRef').textContent = R.scenario + ' · ' + fmt(R.period) + ' s simulated · ' + R.engine;
  $('#tb_scen').textContent = R.scenario;
  $('#tb_res').innerHTML = fails ? '<span style="color:var(--fail)">' + fails + ' fail</span>' : '<span style="color:var(--pass)">All pass</span>';
}
function renderRun() {
  if (!R) return;
  const sel = $('#runSel'); const keys = Object.keys(R.runs); const prev = sel.value;
  sel.innerHTML = keys.map(k => { const r = R.runs[k]; const tr = R.tracks.filter(t => t.key === k).map(t => t.name).join(', '); return '<option value="' + esc(k) + '">' + esc(tr + ' · ' + r.train + ' · ' + r.dir) + '</option>'; }).join('');
  if (keys.indexOf(prev) >= 0) sel.value = prev;
  const run = R.runs[sel.value]; if (!run) return;
  const dir = run.dir === 'UP' ? 1 : -1;
  const tIdx = num(sel.value.split('|')[0], 0); const tm = cfg.trains[tIdx] || cfg.trains[0];
  const sp = [], pw = [], lim = [];
  for (let i = 0; i < run.n; i++) { sp.push({ x: run.x[i], y: run.v[i] }); pw.push({ x: run.x[i], y: run.P[i] / 1000 }); }
  const xs = run.stations.map(s => s.ch), a = Math.min.apply(null, xs), b = Math.max.apply(null, xs);
  for (let x = a; x <= b; x += Math.max(5, (b - a) / 1500)) lim.push({ x: x, y: TPS.speedLimitAt(cfg, num(tm.length_m, 0), num(tm.vmax, 80), x, dir) });
  const o = baseOpts('Chainage (m)', 'Speed (km/h)');
  o.scales.y.min = 0;
  o.scales.y2 = { position: 'right', title: { display: true, text: 'Power at collector (MW)', color: css('--ink2') }, ticks: { color: css('--ink2'), font: { family: css('--f-mono'), size: 10 } }, grid: { display: false } };
  o.plugins.vlines.lines = run.stations.map(s => ({ x: s.ch, color: css('--ink3'), dash: [2, 3], label: s.name }));
  mkChart('chSpeed', 'line', { datasets: [
    { label: 'Speed', data: sp, borderColor: css('--up'), borderWidth: 1.8, pointRadius: 0 },
    { label: 'Speed limit (front of train, with train-length clearance)', data: lim, borderColor: css('--ink3'), borderWidth: 1, borderDash: [5, 3], pointRadius: 0, stepped: true },
    { label: 'Power (MW, + traction, − regeneration)', data: pw, borderColor: css('--accent'), backgroundColor: css('--accent-soft'), borderWidth: 1, pointRadius: 0, yAxisID: 'y2', fill: 'origin' }] }, o);
  $('#tblRun').innerHTML = '<thead><tr><th>Station</th><th class="n">Chainage (m)</th><th class="n">Arrive</th><th class="n">Depart</th><th class="n">Run from previous</th></tr></thead><tbody>' +
    run.stations.map((s, i) => '<tr><td>' + esc(s.name) + '</td><td class="n">' + fmt(s.ch) + '</td><td class="n">' + mmss(s.arr) + '</td><td class="n">' + mmss(s.dep) + '</td><td class="n">' + (i ? mmss(s.arr - run.stations[i - 1].dep) : '–') + '</td></tr>').join('') + '</tbody>';
  const km = Math.abs(b - a) / 1000;
  const net = run.E_trac_kWh + run.E_aux_kWh - run.E_regen_kWh;
  $('#runKv').innerHTML = [['Train', esc(run.train)], ['Direction', run.dir], ['Trip time', mmss(run.T) + ' (' + fmt(run.T / 60, 2) + ' min)'], ['Route length', fmt(km, 2) + ' km'],
    ['Average speed', fmt(km / (run.T / 3600), 1) + ' km/h'], ['Top speed reached', fmt(run.vmax_kmh, 1) + ' km/h'], ['Traction energy', fmt(run.E_trac_kWh, 1) + ' kWh'],
    ['Auxiliary energy', fmt(run.E_aux_kWh, 1) + ' kWh'], ['Regenerated (available)', fmt(run.E_regen_kWh, 1) + ' kWh'], ['Net if all regeneration is used', fmt(net, 1) + ' kWh · ' + fmt(net / Math.max(km, 0.01), 2) + ' kWh/km']]
    .map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + (run.warn ? '<dt>Warning</dt><dd style="color:var(--fail)">' + esc(run.warn) + '</dd>' : '');
  $('#runRef').textContent = Object.keys(R.runs).length + ' distinct service pattern' + (Object.keys(R.runs).length > 1 ? 's' : '');
}
function renderGraph() {
  if (!R) return;
  const ds = [];
  R.tracks.forEach((tr, k) => {
    const run = R.runs[tr.key]; const col = tr.dir === 'UP' ? css('--up') : css('--dn');
    tr.deps.forEach((t0, j) => {
      const pts = [];
      for (let i = 0; i < run.n; i += 10) { const t = t0 + i * R.dt; if (t < 0 || t > R.period) continue; pts.push({ x: t / 60, y: run.x[i] / 1000 }); }
      if (pts.length > 1) ds.push({ label: tr.name, data: pts, borderColor: col, borderWidth: 1.1, pointRadius: 0 });
    });
  });
  const o = baseOpts('Time (min)', 'Chainage (km)');
  o.plugins.legend.display = false; o.plugins.decimation.enabled = false;
  o.scales.x.min = 0; o.scales.x.max = R.period / 60;
  mkChart('chGraph', 'line', { datasets: ds }, o);
}
let tssShown = null;
function renderTssCharts() {
  if (!R) return;
  const pal = PAL();
  if (!tssShown || tssShown.length !== R.tss.length) {
    const top = R.tss.map((t, i) => [t.active ? t.I1h / t.Ir : -1, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    tssShown = R.tss.map((t, i) => top.indexOf(i) >= 0);
  }
  $('#tssPick').innerHTML = R.tss.map((t, i) => '<label style="border-left:4px solid ' + pal[i % pal.length] + '"><input type="checkbox" data-i="' + i + '"' + (tssShown[i] && t.active ? ' checked' : '') + (t.active ? '' : ' disabled') + '> ' + esc(t.name) + (t.active ? '' : ' (out)') + '</label>').join('') + '<button class="sm" id="tssAll">All</button><button class="sm" id="tssNone">None</button>';
  $$('#tssPick input').forEach(c => c.addEventListener('change', () => { tssShown[+c.dataset.i] = c.checked; renderTssCharts(); }));
  $('#tssAll').addEventListener('click', () => { tssShown = R.tss.map(() => true); renderTssCharts(); });
  $('#tssNone').addEventListener('click', () => { tssShown = R.tss.map(() => false); renderTssCharts(); });
  const dsI = [], dsV = [];
  R.tss.forEach((t, i) => {
    if (!t.active || !tssShown[i]) return;
    const I = R.ts.tssI[i], V = R.ts.tssV[i], a = [], b = [];
    for (let s = 0; s < I.length; s++) { a.push({ x: s * R.dt / 60, y: I[s] }); b.push({ x: s * R.dt / 60, y: V[s] }); }
    dsI.push({ label: t.name, data: a, borderColor: pal[i % pal.length], borderWidth: 1, pointRadius: 0 });
    dsV.push({ label: t.name, data: b, borderColor: pal[i % pal.length], borderWidth: 1, pointRadius: 0 });
  });
  const o = baseOpts('Time (min)', 'Rectifier current (A)'); o.scales.y.min = 0;
  mkChart('chTss', 'line', { datasets: dsI }, o);
  const o2 = baseOpts('Time (min)', 'Busbar voltage (V)'); o2.plugins.legend.display = false;
  mkChart('chBus', 'line', { datasets: dsV }, o2);
}
function renderVolt() {
  if (!R) return;
  const ds = []; const Lm = cfg.limits;
  R.trainV.envelope.forEach((e) => {
    const tr = cfg.tracks.find(t => t.name === e.track) || { dir: 'UP' };
    const col = tr.dir === 'UP' ? css('--up') : css('--dn');
    ds.push({ label: e.track + ' lowest', data: e.x.map((x, i) => ({ x: x, y: e.min[i] })), borderColor: col, borderWidth: 1.6, pointRadius: 0 });
    ds.push({ label: e.track + ' highest', data: e.x.map((x, i) => ({ x: x, y: e.max[i] })), borderColor: col, borderWidth: 1, borderDash: [3, 3], pointRadius: 0 });
  });
  const ext = R.extent;
  ds.push({ label: 'Minimum limit', data: [{ x: ext[0], y: Lm.V_min }, { x: ext[1], y: Lm.V_min }], borderColor: css('--fail'), borderWidth: 1.2, borderDash: [6, 4], pointRadius: 0 });
  ds.push({ label: 'Maximum limit', data: [{ x: ext[0], y: Lm.V_max }, { x: ext[1], y: Lm.V_max }], borderColor: css('--fail'), borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0 });
  const o = baseOpts('Chainage (m)', 'Train voltage (V)');
  o.plugins.vlines.lines = R.tss.map(t => ({ x: t.ch, color: t.active ? css('--tss') : css('--ink3'), dash: t.active ? [2, 4] : [6, 3], label: t.name + (t.active ? '' : ' out') }));
  o.plugins.decimation.enabled = false;
  mkChart('chVolt', 'line', { datasets: ds }, o);
}
function stdList(txt, def) { const a = String(txt || '').split(/[,;\s]+/).map(Number).filter(x => isFinite(x) && x > 0).sort((a, b) => a - b); return a.length ? a : def; }
function nextStd(v, list) { for (const s of list) if (s >= v) return s; return null; }
function bar(r) { const p = Math.min(r, 1.4) / 1.4 * 100; return '<div class="bar" title="' + fmt(r * 100) + ' % of limit"><i class="' + (r > 1 ? 'over' : r > 0.9 ? 'hot' : '') + '" style="width:' + p + '%"></i><b style="left:' + (100 / 1.4) + '%"></b></div>'; }
function chip(p, txt) { return '<span class="chip ' + p + '">' + (txt || (p === 'pass' ? 'Pass' : p === 'fail' ? 'Fail' : p)) + '</span>'; }
function renderSizing() {
  if (!R) return;
  const d = dutyNow(), Vn = num(cfg.electrical.V_nom, 750);
  const sr = stdList(cfg.limits.std_rect_kW, STD_RECT), sx = stdList(cfg.limits.std_xfmr_kVA, STD_XFMR);
  let h = '<thead><tr><th>TSS</th><th class="n">Chainage</th><th class="n">Rectifier kW</th><th class="n">Rated A</th><th class="n">Peak A</th><th class="n">1-min RMS A</th><th>vs ' + fmt(d.m1 * 100) + ' %</th><th class="n">15-min RMS A</th><th>vs ' + fmt(d.m15 * 100) + ' %</th><th class="n">1-h RMS A</th><th>vs ' + fmt(d.h1 * 100) + ' %</th><th class="n">Rectifier needed kW</th><th class="n">Next standard</th><th class="n">Transformer kVA</th><th class="n">1-h kVA</th><th class="n">Transformer needed kVA</th><th class="n">Next standard</th><th class="n">Energy kWh</th><th>Result</th></tr></thead><tbody>';
  for (const t of R.tss) {
    if (!t.active) { h += '<tr><td><b>' + esc(t.name) + '</b></td><td class="n">' + fmt(t.ch) + '</td><td class="n">' + fmt(t.rect_kW) + '</td><td colspan="15" class="muted">out of service in this case</td><td>' + chip('off', 'Out') + '</td></tr>'; continue; }
    const r1 = t.I1 / (t.Ir * d.m1), r15 = t.I15 / (t.Ir * d.m15), rh = t.I1h / (t.Ir * d.h1);
    const needI = Math.max(t.I1h / d.h1, t.I15 / d.m15, t.I1 / d.m1), needkW = needI * Vn / 1000;
    const needS = Math.max(t.S1h / d.h1, t.S15 / d.m15, t.S1 / d.m1);
    const ok = Math.max(r1, r15, rh) <= 1 && needS <= t.xfmr_kVA + 1e-6;
    const ns = nextStd(needkW, sr), nx = nextStd(needS, sx);
    h += '<tr><td><b>' + esc(t.name) + '</b></td><td class="n">' + fmt(t.ch) + '</td><td class="n">' + fmt(t.rect_kW) + '</td><td class="n">' + fmt(t.Ir) + '</td><td class="n">' + fmt(t.Ipk) + '</td><td class="n">' + fmt(t.I1) + '</td><td>' + bar(r1) + '</td><td class="n">' + fmt(t.I15) + '</td><td>' + bar(r15) + '</td><td class="n">' + fmt(t.I1h) + '</td><td>' + bar(rh) + '</td>' +
      '<td class="n"><b>' + fmt(needkW) + '</b></td><td class="n">' + (ns ? fmt(ns) : '> list') + '</td><td class="n">' + fmt(t.xfmr_kVA) + '</td><td class="n">' + fmt(t.S1h) + '</td><td class="n"><b>' + fmt(needS) + '</b></td><td class="n">' + (nx ? fmt(nx) : '> list') + '</td><td class="n">' + fmt(t.E_kWh) + '</td><td>' + chip(ok ? 'pass' : 'fail') + '</td></tr>';
  }
  $('#tblSize').innerHTML = h + '</tbody>';
  $('#sizeRef').textContent = (R.contingency ? 'Outage duty limits' : 'Normal duty limits') + ': 1-h ' + d.h1 + ' ×, 15-min ' + d.m15 + ' ×, 1-min ' + d.m1 + ' × rating';
  $('#sizeNote').textContent = 'Needed rating = the largest of 1-h RMS ÷ ' + d.h1 + ', 15-min RMS ÷ ' + d.m15 + ' and 1-min RMS ÷ ' + d.m1 + ', at ' + fmt(Vn) + ' V. Size equipment on the design check (all cases), not on one scenario. Bars: the black tick marks 100 % of the limit.';
}
function renderFeeders() {
  if (!R) return;
  const L = cfg.limits;
  $('#tblFeed').innerHTML = '<thead><tr><th>Feeder</th><th>Track</th><th class="n">Peak A</th><th class="n">15-min RMS A</th><th class="n">1-h RMS A</th><th>vs cable ' + fmt(L.feeder_A) + ' A</th><th>Peak vs trip</th></tr></thead><tbody>' +
    R.feeders.map(f => '<tr><td>' + esc(f.tss) + '</td><td>' + esc(f.track) + '</td><td class="n">' + fmt(f.Ipk) + '</td><td class="n">' + fmt(f.I15) + '</td><td class="n">' + fmt(f.I1h) + '</td><td>' + bar(f.I1h / L.feeder_A) + '</td><td>' + bar(f.Ipk / L.breaker_trip_A) + '</td></tr>').join('') + '</tbody>';
  $('#tblCond').innerHTML = '<thead><tr><th>Conductor rail</th><th>Track</th><th>Side</th><th class="n">Peak A</th><th class="n">1-h RMS A</th><th>vs ' + fmt(L.conductor_A) + ' A</th></tr></thead><tbody>' +
    R.conductor.map(c => '<tr><td>' + esc(c.tss) + ' (' + fmt(c.ch) + ' m)</td><td>' + esc(c.track) + '</td><td>' + c.side + '</td><td class="n">' + fmt(c.Ipk) + '</td><td class="n">' + fmt(c.I1h) + '</td><td>' + bar(c.I1h / L.conductor_A) + '</td></tr>').join('') + '</tbody>';
}
function renderChecks() {
  if (!R) return;
  const ch = R.checks, f = ch.filter(c => !c.pass).length;
  $('#chkRef').textContent = (ch.length - f) + ' pass, ' + f + ' fail · failures first, then by utilisation';
  $('#tblChecks').innerHTML = '<thead><tr><th>Result</th><th>Group</th><th>Check</th><th>Location</th><th class="n">Value</th><th class="n">Limit</th><th>Unit</th><th class="n">Utilisation</th><th></th></tr></thead><tbody>' +
    ch.map(c => '<tr><td>' + chip(c.pass ? 'pass' : 'fail', c.pass ? 'Pass' : 'Fail +' + fmt((c.ratio - 1) * 100, 1) + ' %') + '</td><td>' + esc(c.group) + '</td><td>' + esc(c.item) + '</td><td>' + esc(c.where) + '</td><td class="n">' + fmt(c.value, c.unit === 'kA' ? 1 : 0) + '</td><td class="n">' + (c.kind === 'min' ? '≥ ' : '≤ ') + fmt(c.limit, c.unit === 'kA' ? 1 : 0) + '</td><td>' + c.unit + '</td><td class="n">' + fmt(c.ratio * 100) + ' %</td><td style="min-width:90px">' + bar(c.ratio) + '</td></tr>').join('') + '</tbody>';
}
function renderDC() {
  if (!DC) { $('#tblDc').innerHTML = '<tbody><tr><td class="muted" style="padding:12px">Runs normal service, every single-TSS outage and the extra cases. Takes roughly one simulation time per case.</td></tr></tbody>'; return; }
  const pc = (v) => { const p = v * 100; return '<span style="color:' + (v > 1 ? 'var(--fail)' : v > 0.9 ? 'var(--warn)' : 'inherit') + '">' + fmt(p) + ' %</span>'; };
  $('#tblDc').innerHTML = '<thead><tr><th>Case</th><th class="n">Min train V</th><th class="n">Max train V</th><th class="n">Rectifier</th><th class="n">Transformer</th><th class="n">Conductor</th><th class="n">Feeder</th><th class="n">Min feeder fault kA</th><th class="n">Voltage THD %</th><th class="n">Rail potential V</th><th class="n">Stray mA/m</th><th class="n">Energy kWh</th><th>Result</th><th>First failure</th></tr></thead><tbody>' +
    DC.map((x, i) => '<tr class="click' + ((x.outage || []).join('+') === scenOutage.join('+') ? ' sel' : '') + '" data-i="' + i + '" tabindex="0"><td><b>' + esc(x.scenario) + '</b></td><td class="n" style="color:' + (x.vmin < cfg.limits.V_min ? 'var(--fail)' : 'inherit') + '">' + fmt(x.vmin) + '</td><td class="n">' + fmt(x.vmax) + '</td><td class="n">' + pc(x.rect) + '</td><td class="n">' + pc(x.xfmr) + '</td><td class="n">' + pc(x.cond) + '</td><td class="n">' + pc(x.feeder) + '</td><td class="n">' + fmt((x.fault_min || 0) / 1000, 1) + '</td><td class="n">' + fmt(x.thd, 2) + '</td><td class="n">' + fmt(x.urail) + '</td><td class="n">' + fmt(x.stray, 2) + '</td><td class="n">' + fmt(x.E_kWh) + '</td><td>' + chip(x.nFail ? 'fail' : 'pass', x.nFail ? x.nFail + ' fail' : 'Pass') + '</td><td class="muted">' + esc(x.firstFail) + '</td></tr>').join('') + '</tbody>';
  $$('#tblDc tr.click').forEach(tr => { const go = () => { scenOutage = (DC[+tr.dataset.i].outage || []).slice(); renderScenarioSel(); runSim(); location.hash = '#r_summary'; }; tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
  $('#dcNote').textContent = DC.filter(x => x.nFail).length + ' of ' + DC.length + ' cases fail. Ratios are against the duty limits of each case (outage cases use the contingency multipliers). Click a row to load that case.';
}
function renderResults() { renderCards(); renderPlan(); renderLong(); renderRun(); renderGraph(); renderTssCharts(); renderVolt(); renderSizing(); renderFeeders(); renderSC(); renderHarm(); renderEMC(); renderChecks(); renderDC(); renderTracks(); renderReportsPanel(); }

/* ---------------- export / import ---------------- */
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
async function exportInputs() {
  syncTextInputs(); save();
  const txt = JSON.stringify(cfg, null, 1);
  const ok = await saveFile('inputs.json', new Blob([txt], { type: 'application/json' }));
  if (!ok && inIframe) {
    try { await navigator.clipboard.writeText(txt); toast('Saving is not available here, so the inputs JSON was copied to the clipboard.', 6000); }
    catch (e) { toast('Saving and copying are both blocked here. Open the HTML file from your computer to save inputs.json.', 6000); }
  }
}
function exportResults() {
  if (!R) { toast('Run the simulation first'); return; }
  if (typeof XLSX === 'undefined') { toast('The Excel library did not load'); return; }
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  const E = R.energy;
  add('Summary', [[cfg.project.name], [cfg.project.system + ' · ' + R.scenario + ' · ' + R.engine], [],
    ['Quantity', 'Value', 'Unit'], ['Simulated period', R.period, 's'], ['Minimum train voltage', R.trainV.min, 'V'], ['Maximum train voltage', R.trainV.max, 'V'], ['Mean useful voltage', R.trainV.mean_useful, 'V'],
    ['Energy from TSS (DC)', E.tss_kWh, 'kWh'], ['Regenerated energy returned', E.regen_out_kWh, 'kWh'], ['Rheostat energy', E.rheostat_kWh, 'kWh'], ['Inverter energy', E.inverter_kWh, 'kWh'], ['Losses', E.losses_kWh, 'kWh'], [],
    ['Track', 'Direction', 'Headway (s)', 'Trains/h', 'Trip (min)', 'Trains on track']].concat(R.tracks.map(t => [t.name, t.dir, t.headway, t.tph, t.trip / 60, t.inService])));
  add('Checks', [['Result', 'Group', 'Check', 'Location', 'Value', 'Limit', 'Unit', 'Utilisation %']].concat(R.checks.map(c => [c.pass ? 'PASS' : 'FAIL', c.group, c.item, c.where, c.value, c.limit, c.unit, c.ratio * 100])));
  add('TSS', [['TSS', 'Chainage', 'Status', 'Rectifier kW', 'Rated A', 'Transformer kVA', 'No-load V', 'Source R mΩ', 'Peak A', '1-min RMS A', '15-min RMS A', '1-h RMS A', 'Mean A', '1-h % rating', 'Transformer 1-h kVA', 'Transformer 15-min kVA', 'Mean kW', 'Peak kW', 'Energy kWh', 'Inverter kWh', 'Min bus V', 'Max bus V']]
    .concat(R.tss.map(t => [t.name, t.ch, t.active ? 'in service' : 'OUT', t.rect_kW, t.Ir, t.xfmr_kVA, t.V0, t.Req * 1000, t.Ipk, t.I1, t.I15, t.I1h, t.Iavg, t.active ? t.I1h / t.Ir * 100 : null, t.S1h, t.S15, t.Pavg, t.Ppk, t.E_kWh, t.Einv_kWh, t.Vmin, t.Vmax])));
  add('Feeders & rail', [['Feeder TSS', 'Track', 'Peak A', '1-h RMS A', '15-min RMS A']].concat(R.feeders.map(f => [f.tss, f.track, f.Ipk, f.I1h, f.I15]), [[]], [['Conductor at TSS', 'Track', 'Side', 'Peak A', '1-h RMS A', '15-min RMS A']], R.conductor.map(c => [c.tss, c.track, c.side, c.Ipk, c.I1h, c.I15])));
  const runs = [];
  for (const k of Object.keys(R.runs)) { const r = R.runs[k]; runs.push([r.train + ' ' + r.dir + ' trip ' + (r.T / 60).toFixed(2) + ' min, traction ' + r.E_trac_kWh.toFixed(1) + ' kWh, regen ' + r.E_regen_kWh.toFixed(1) + ' kWh']); runs.push(['Station', 'Chainage', 'Arrive (s)', 'Depart (s)']); r.stations.forEach(s => runs.push([s.name, s.ch, s.arr, s.dep])); runs.push([]); }
  add('Train runs', runs);
  const ts = [['Time (s)'].concat(R.tss.map(t => t.name + ' I (A)'), R.tss.map(t => t.name + ' V'), ['Min train V', 'Max train V', 'Trains'])];
  for (let s = 0; s < R.ts.nTrains.length; s++) ts.push([s * R.dt].concat(R.tss.map((t, i) => Math.round(R.ts.tssI[i][s] * 10) / 10), R.tss.map((t, i) => isFinite(R.ts.tssV[i][s]) ? Math.round(R.ts.tssV[i][s] * 10) / 10 : null), [isFinite(R.ts.vTrainMin[s]) ? Math.round(R.ts.vTrainMin[s]) : null, isFinite(R.ts.vTrainMax[s]) ? Math.round(R.ts.vTrainMax[s]) : null, R.ts.nTrains[s]]));
  add('TSS current time series', ts);
  const env = [[]]; R.trainV.envelope.forEach(e => { env[0].push(e.track + ' chainage', 'Min V', 'Mean V', 'Max V', ''); });
  const ml = Math.max.apply(null, R.trainV.envelope.map(e => e.x.length).concat([0]));
  for (let i = 0; i < ml; i++) { const row = []; R.trainV.envelope.forEach(e => { if (i < e.x.length) row.push(e.x[i], e.min[i], e.mean[i], e.max[i], ''); else row.push('', '', '', '', ''); }); env.push(row); }
  add('Voltage envelope', env);
  if (F) { const sc = [[]]; F.tracks.forEach(t => sc[0].push(t.track + ' chainage', 'Total fault A', 'Largest feeder A', '')); const n = Math.max.apply(null, F.tracks.map(t => t.x.length)); for (let i = 0; i < n; i++) { const row = []; F.tracks.forEach(t => row.push(t.x[i], t.If[i], t.Ifeeder[i], '')); sc.push(row); } add('Short circuit', sc); }
  if (DC) add('Design check', [['Case', 'Min train V', 'Max train V', 'Rectifier %', 'Transformer %', 'Conductor %', 'Feeder %', 'Min feeder fault A', 'Voltage THD %', 'Rail potential V', 'Stray mA/m', 'Energy kWh', 'Failures', 'First failure']].concat(DC.map(x => [x.scenario, x.vmin, x.vmax, x.rect * 100, x.xfmr * 100, x.cond * 100, x.feeder * 100, x.fault_min, x.thd, x.urail, x.stray, x.E_kWh, x.nFail, x.firstFail])));
  addStudySheets(add);
  add('Inputs', JSON.stringify(cfg, null, 1).split('\n').map(l => [l]));
  try {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveFile('TPS_Results.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) { toast('Export failed: ' + e.message); }
}
function importInputs(file) {
  if (!file) return;
  file.text().then(t => {
    try { cfg = fillDefaults(JSON.parse(t)); scenOutage = []; curTrain = 0; R = null; F = null; ST = null; DC = null; save(); renderInputs(); renderPlan(); renderLong(); renderCards(); runSim(); toast('Inputs loaded from ' + file.name); }
    catch (e) { toast('That file is not a valid inputs JSON: ' + e.message, 5000); }
  });
}

/* ---------------- wiring ---------------- */
function init() {
  cfg = loadCfg();
  initTabs(); initDigitiser();
  renderInputs();
  $$('[data-path]').forEach(el => el.addEventListener('change', () => { setPath(cfg, el.dataset.path, el.type === 'number' ? parseVal('num', el) : el.value); if (el.closest('.titleblock') || el.id === 'projNotes' || el.id === 'n_up' || el.id === 'n_dn') { save(); return; } changed(); }));
  $('#btnTracks').addEventListener('click', () => { TPS.generateTracks(cfg); renderTracks(); renderScenarioSel(); changed(); toast(cfg.tracks.length + ' tracks set up'); });
  $('#btnGenTss').addEventListener('click', () => { TPS.generateTSS(cfg); scenOutage = []; renderTss(); renderScenarioSel(); changed(); toast(cfg.tss.length + ' substations generated'); });
  $('#btnAddTss').addEventListener('click', () => {
    const last = cfg.tss[cfg.tss.length - 1] || { ch: 0, rect_kW: 3000, xfmr_kVA: 3300 };
    cfg.tss.push({ name: 'TSS' + (cfg.tss.length + 1), ch: num(last.ch, 0) + num(cfg.tss_gen.spacing, 2500), rect_kW: num(last.rect_kW, 3000), xfmr_kVA: num(last.xfmr_kVA, 3300), V0: '', Req_mohm: '', inv_kW: 0, in_service: true });
    cfg.tss_gen.count = cfg.tss.length; renderTss(); renderScenarioSel(); changed();
  });
  $('#btnSortTss').addEventListener('click', () => { cfg.tss.sort((a, b) => num(a.ch, 0) - num(b.ch, 0)); renderTss(); changed(); });
  $('#trainSel').addEventListener('change', () => { curTrain = +$('#trainSel').value; renderTrain(); $('#docxReport').hidden = true; });
  $('#btnTrainAdd').addEventListener('click', () => { const t = JSON.parse(JSON.stringify(TPS.defaults().trains[0])); t.name = 'Train type ' + (cfg.trains.length + 1); t.source = 'new'; cfg.trains.push(t); curTrain = cfg.trains.length - 1; renderTrain(); renderTracks(); save(); });
  $('#btnTrainDup').addEventListener('click', () => { const t = JSON.parse(JSON.stringify(cfg.trains[curTrain])); t.name = (t.name || 'train') + ' (copy)'; cfg.trains.push(t); curTrain = cfg.trains.length - 1; renderTrain(); renderTracks(); save(); });
  $('#btnTrainDel').addEventListener('click', () => {
    if (cfg.trains.length < 2) { toast('Keep at least one train type'); return; }
    cfg.trains.splice(curTrain, 1); for (const t of cfg.tracks) { if (num(t.train, 0) === curTrain) t.train = 0; else if (num(t.train, 0) > curTrain) t.train = num(t.train, 0) - 1; }
    curTrain = 0; renderTrain(); renderTracks(); changed();
  });
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.add, A = cfg.alignment, arr = A[k] || (A[k] = []); const last = arr[arr.length - 1];
    const tmpl = { stations: { name: 'ST' + (arr.length + 1), ch: last ? num(last.ch, 0) + 1000 : 0, dwell: 30 }, gradients: { from: last ? last.to : 0, to: (last ? num(last.to, 0) : 0) + 500, g: 0 }, curves: { from: last ? num(last.to, 0) + 200 : 0, to: (last ? num(last.to, 0) : 0) + 500, R: 500 }, speed: { from: 0, to: 500, up: 60, dn: 60 }, elevations: { ch: last ? num(last.ch, 0) + 500 : 0, z: last ? last.z : 0 } }[k];
    arr.push(tmpl); renderAlign(); changed();
  }));
  $('#btnAddExtra').addEventListener('click', () => { cfg.extra_details.push({ key: '', value: '', unit: '', note: '' }); renderExtra(); save(); });
  $('#extraCases').addEventListener('change', () => { syncTextInputs(); renderScenarioSel(); save(); });
  initDrop($('#dropDocx'), $('#fileDocx'), handleDocx);
  initDrop($('#dropXlsx'), $('#fileXlsx'), handleXlsx);
  $('#fileImg').addEventListener('change', () => { const f = $('#fileImg').files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => openDigitiser(rd.result, f.name); rd.readAsDataURL(f); $('#fileImg').value = ''; });
  $('#btnRun').addEventListener('click', runSim);
  $('#btnDesign').addEventListener('click', () => { runDesign(); });
  $('#btnDesign2').addEventListener('click', () => { runDesign(); });
  $('#scenSel').addEventListener('change', () => { const v = $('#scenSel').value; scenOutage = v ? v.split('+') : []; renderPlan(); runSim(); });
  $('#runSel').addEventListener('change', renderRun);
  $('#btnExportIn').addEventListener('click', exportInputs);
  $('#btnExportRes').addEventListener('click', exportResults);
  $('#importIn').addEventListener('change', () => { importInputs($('#importIn').files[0]); $('#importIn').value = ''; });
  let resetArm = 0;
  $('#btnReset').addEventListener('click', () => {
    if (Date.now() - resetArm > 4000) { resetArm = Date.now(); $('#btnReset').textContent = 'Click again to reset'; setTimeout(() => { $('#btnReset').textContent = 'Reset to sample'; }, 4000); return; }
    cfg = fillDefaults(TPS.defaults()); scenOutage = []; curTrain = 0; DC = null; ST = null; save(); renderInputs(); $('#btnReset').textContent = 'Reset to sample'; $('#docxReport').hidden = true; $('#xlsxReport').hidden = true; runSim(); toast('Sample inputs restored');
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const rethem = () => { drawCurvePreview(); renderPlan(); renderLong(); if (R) renderResults(); };
  if (mq.addEventListener) mq.addEventListener('change', rethem);
  new MutationObserver(rethem).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  renderPlan(); renderLong(); renderCards(); renderDC(); initStudiesUI();
  if (typeof Chart === 'undefined') toast('Chart library did not load; tables still work', 5000);
  runSim();
}
document.addEventListener('DOMContentLoaded', init);
