'use strict';
/* =====================================================================
   Short circuit, harmonics and EMC panels, Excel sheets and reports
   (PDF via jsPDF + autotable, Word via docx; both loaded on first use)
   ===================================================================== */

/* ---------------- file saving (viewer capability or browser download) ---------------- */
let _dl;
async function downloadsApi() {
  if (_dl !== undefined) return _dl;
  _dl = null;
  try { if (window.claude && typeof window.claude.use === 'function') _dl = await window.claude.use('downloads'); } catch (e) { _dl = null; }
  return _dl;
}
async function saveFile(name, blob) {
  const api = inIframe ? await downloadsApi() : null;
  if (api) {
    try { await api.save({ filename: name, data: blob }); toast(name + ' saved'); return true; }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') { toast('Save cancelled'); return true; }
      if (c === 'rate_limited') { toast('Another save is waiting for confirmation; try again in a moment'); return true; }
      toast('Saving ' + name + ' is not available here (' + (c || 'unavailable') + ')', 5000); return false;
    }
  }
  if (inIframe) { toast('Saving files is not available in this view. Open TPS_Model.html from your computer.', 6000); return false; }
  download(name, blob); toast(name + ' saved'); return true;
}

/* ---------------- inputs ---------------- */
function renderStudiesInputs() {
  fieldsInto($('#f_ac'), [
    ['ac.U_hv_kV', 'Supply voltage (HV side)', 'kV'], ['ac.S_sc_MVA', 'Network fault level at TSS', 'MVA'], ['ac.XR', 'Network X/R ratio', ''],
    ['ac.c_max', 'Voltage factor c (IEC 60909)', ''], ['ac.uk_pct', 'Transformer impedance uk', '%'], ['ac.pcu_pct', 'Transformer load losses', '%'],
    ['ac.pulse', 'Rectifier pulse number', '', { type: 'select', numeric: true, options: [[6, '6-pulse'], [12, '12-pulse (2 bridges)'], [18, '18-pulse (3 bridges)'], [24, '24-pulse (4 bridges)']] }],
    ['ac.U_v', 'Valve-side voltage (line, RMS)', 'V', { ph: 'auto' }], ['ac.f', 'Frequency', 'Hz'], ['ac.L_smooth_mH', 'DC smoothing reactor', 'mH'],
    ['ac.source_from_ac', 'Derive TSS source resistance from AC data', '', { type: 'check' }]]);
  fieldsInto($('#f_sc'), [
    ['sc.L_line_mH_km', 'Conductor + return loop inductance', 'mH/km'], ['sc.L_feeder_mH', 'Feeder cable inductance', 'mH'],
    ['sc.didt_setting_A_ms', 'di/dt protection setting', 'A/ms'], ['sc.t_clear_s', 'Fault clearing time (touch voltage)', 's']]);
  fieldsInto($('#f_harm'), [
    ['harm.residual_pct', 'Non-characteristic residual (imbalance)', '%'], ['harm.h_max', 'Highest harmonic order', ''],
    ['harm.pcc', 'Supply point', '', { type: 'select', options: [['separate', 'Each TSS on its own supply'], ['common', 'All TSS on one common bus']] }],
    ['harm.percentile', 'Compared percentile', '%'], ['harm.thd_limit', 'Voltage THD limit', '%'], ['harm.std_name', 'Limit reference', '', { type: 'text' }]]);
  fieldsInto($('#f_emc'), [
    ['emc.g_track_S_km', 'Rail–earth conductance per track', 'S/km'], ['emc.g_limit_S_km', 'Conductance limit per track', 'S/km'],
    ['emc.dx', 'Rail model node spacing', 'm'], ['emc.R_tss_earth', 'TSS negative earthing resistance', 'Ω', { ph: 'floating' }],
    ['emc.stray_limit_mA_m', 'Stray current limit', 'mA/m'], ['emc.cond_y', 'Conductor rail offset from track centre', 'm'],
    ['emc.cond_z', 'Conductor rail height above running rail', 'm'], ['emc.field_h', 'Field point height', 'm'],
    ['emc.field_d', 'Field distances from track centre', 'm', { type: 'text' }], ['emc.B_limit_mT', 'Static field reference limit', 'mT', { help: '0.5 mT: implanted devices (ICNIRP)' }],
    ['emc.cable_d', 'Telecom cable offset from track centre', 'm'], ['emc.cable_z', 'Telecom cable level (− below rail)', 'm'],
    ['emc.screening', 'Combined screening factor', ''], ['emc.sensitivity', 'Cable sensitivity factor', '', { help: 'transverse noise ÷ longitudinal emf' }],
    ['emc.psoph_limit_mV', 'Psophometric noise limit', 'mV', { ph: 'report only' }]]);
  const tbl = (id, path, c1, u1, c2, u2) => {
    const arr = getPath(cfg, path) || []; setPath(cfg, path, arr);
    editTable($(id), arr, [{ k: 0, label: c1, unit: u1, type: 'num' }, { k: 1, label: c2, unit: u2, type: 'num' }], { onChange: () => changed(false), onDelete: () => changed(false) });
  };
  tbl('#tblHarmLim', 'harm.limits', 'Order h', '', 'Limit', '% of Un');
  tbl('#tblTouch', 'emc.touch_limits', 'Duration', 's', 'Touch voltage', 'V');
  tbl('#tblPsoph', 'emc.psoph', 'Frequency', 'Hz', 'Weight', '');
  tbl('#tblRipple', 'emc.ripple_limits', 'Frequency', 'Hz', 'Limit', 'A');
}
function initStudiesUI() {
  $$('[data-addtbl]').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.addtbl, arr = getPath(cfg, p) || []; const last = arr[arr.length - 1];
    arr.push(last ? [last[0] + (p === 'harm.limits' ? 2 : 100), last[1]] : [0, 0]); setPath(cfg, p, arr);
    renderStudiesInputs(); changed(false);
  }));
  $('#harmSel').addEventListener('change', renderHarm);
  $('#btnAllReports').addEventListener('click', downloadAllReports);
  renderReportsPanel();
}

/* ---------------- shared helpers ---------------- */
function lineDS(label, pts, color, o) { return Object.assign({ label: label, data: pts, borderColor: color, backgroundColor: color, borderWidth: 1.6, pointRadius: 0 }, o || {}); }
function trackColor(name) { const tr = cfg.tracks.find(z => z.name === name) || { dir: 'UP' }; return tr.dir === 'UP' ? css('--up') : css('--dn'); }
function riseCurve(Iss, tau_ms, tmax) { const pts = []; for (let i = 0; i <= 100; i++) { const t = tmax * i / 100; pts.push({ x: t, y: tau_ms > 0 ? Iss * (1 - Math.exp(-t / tau_ms)) / 1000 : Iss / 1000 }); } return pts; }
function scExtremes() {
  if (!F) return null;
  let near = null, far = null;
  for (const t of F.tracks) t.x.forEach((x, i) => {
    const c = { track: t.track, x: x, If: t.If[i], Ifd: t.Ifeeder[i], tau: t.tau_ms[i], didt: t.didt[i], didtF: t.didtFeeder[i], tt: t.ttrip_ms[i], U: t.Urail[i] };
    if (!near || c.If > near.If) near = c;
    if (!far || c.Ifd < far.Ifd) far = c;
  });
  return { near: near, far: far };
}

/* ---------------- short circuit panel ---------------- */
function renderSC() {
  if (!F) return;
  const L = cfg.limits, S = cfg.sc || {};
  const mx = Math.max.apply(null, F.tracks.map(t => t.max)), mnF = Math.min.apply(null, F.tracks.map(t => t.minFeeder));
  const mdd = Math.min.apply(null, F.tracks.map(t => t.minDidtFeeder));
  const tt = F.tracks.map(t => t.maxTtrip).filter(v => v !== null);
  const notT = F.tracks.reduce((a, t) => a + t.notTripped, 0);
  const mU = Math.max.apply(null, F.tracks.map(t => t.maxUrail));
  const uLim = TPS.touchLimit(cfg, num(S.t_clear_s, 0.06));
  const st = (bad) => bad ? 'bad' : 'ok';
  $('#scCards').innerHTML = [
    card(st(mx / 1000 > L.breaking_kA), 'Maximum DC fault current', fmt(mx / 1000, 1), 'kA', 'breaking capacity ' + fmt(L.breaking_kA) + ' kA'),
    card(st(mnF < L.breaker_trip_A * L.fault_margin), 'Minimum feeder fault current', fmt(mnF / 1000, 1), 'kA', 'trip setting ' + fmt(L.breaker_trip_A / 1000, 1) + ' kA × ' + L.fault_margin),
    card(st(mdd < num(S.didt_setting_A_ms, 40)), 'Minimum feeder di/dt', fmt(mdd), 'A/ms', 'di/dt setting ' + fmt(num(S.didt_setting_A_ms, 40)) + ' A/ms'),
    card(notT ? 'bad' : '', 'Longest time to reach trip', tt.length ? fmt(Math.max.apply(null, tt), 1) : '–', 'ms', notT ? notT + ' fault positions never reach the trip setting' : 'largest feeder contribution, first-order rise'),
    card(uLim !== null ? st(mU > uLim) : '', 'Rail potential at a fault', fmt(mU), 'V', uLim !== null ? 'limit ' + fmt(uLim) + ' V at ' + num(S.t_clear_s, 0.06) + ' s' : '')
  ].join('');
  const dsI = [], dsD = [], dsU = [];
  for (const t of F.tracks) {
    const c = trackColor(t.track);
    dsI.push(lineDS(t.track + ' total', t.x.map((x, i) => ({ x: x, y: t.If[i] / 1000 })), c));
    dsI.push(lineDS(t.track + ' largest feeder', t.x.map((x, i) => ({ x: x, y: t.Ifeeder[i] / 1000 })), c, { borderDash: [4, 3], borderWidth: 1 }));
    dsD.push(lineDS(t.track + ' total', t.x.map((x, i) => ({ x: x, y: t.didt[i] })), c));
    dsD.push(lineDS(t.track + ' largest feeder', t.x.map((x, i) => ({ x: x, y: t.didtFeeder[i] })), c, { borderDash: [4, 3], borderWidth: 1 }));
    dsU.push(lineDS(t.track, t.x.map((x, i) => ({ x: x, y: t.Urail[i] })), c));
  }
  const x0 = F.tracks[0].x[0], x1 = F.tracks[0].x[F.tracks[0].x.length - 1];
  dsI.push(lineDS('Breaker trip setting', [{ x: x0, y: L.breaker_trip_A / 1000 }, { x: x1, y: L.breaker_trip_A / 1000 }], css('--fail'), { borderDash: [6, 4], borderWidth: 1.2 }));
  dsD.push(lineDS('di/dt setting', [{ x: x0, y: num(S.didt_setting_A_ms, 40) }, { x: x1, y: num(S.didt_setting_A_ms, 40) }], css('--fail'), { borderDash: [6, 4], borderWidth: 1.2 }));
  if (uLim !== null) dsU.push(lineDS('Touch voltage limit', [{ x: x0, y: uLim }, { x: x1, y: uLim }], css('--fail'), { borderDash: [6, 4], borderWidth: 1.2 }));
  const vl = cfg.tss.map(t => ({ x: +t.ch, color: css('--ink3'), dash: [2, 3], label: t.name }));
  let o = baseOpts('Fault chainage (m)', 'kA'); o.scales.y.min = 0; o.plugins.decimation.enabled = false; o.plugins.vlines.lines = vl; mkChart('chSc', 'line', { datasets: dsI }, o);
  o = baseOpts('Fault chainage (m)', 'A/ms'); o.scales.y.min = 0; o.scales.y.type = 'logarithmic'; delete o.scales.y.min; o.plugins.decimation.enabled = false; o.plugins.vlines.lines = vl; mkChart('chScDidt', 'line', { datasets: dsD }, o);
  o = baseOpts('Fault chainage (m)', 'V'); o.scales.y.min = 0; o.plugins.decimation.enabled = false; o.plugins.vlines.lines = vl; mkChart('chScRail', 'line', { datasets: dsU }, o);
  const ex = scExtremes();
  const tmax = Math.max(5 * Math.max(ex.near.tau, ex.far.tau), 20);
  o = baseOpts('Time after fault (ms)', 'kA'); o.scales.y.min = 0; o.plugins.decimation.enabled = false;
  mkChart('chScRise', 'line', { datasets: [
    lineDS('Nearest fault ' + ex.near.track + ' ' + fmt(ex.near.x) + ' m (τ ' + fmt(ex.near.tau, 1) + ' ms)', riseCurve(ex.near.If, ex.near.tau, tmax), css('--accent')),
    lineDS('Remote fault, feeder current ' + ex.far.track + ' ' + fmt(ex.far.x) + ' m', riseCurve(ex.far.Ifd, ex.far.Ifd / Math.max(ex.far.didtF, 1e-6), tmax), css('--up')),
    lineDS('Trip setting', [{ x: 0, y: L.breaker_trip_A / 1000 }, { x: tmax, y: L.breaker_trip_A / 1000 }], css('--fail'), { borderDash: [6, 4], borderWidth: 1.2 })] }, o);
  $('#tblSc').innerHTML = '<thead><tr><th>Track</th><th class="n">Max fault kA</th><th class="n">Min fault kA</th><th class="n">Min feeder kA</th><th class="n">Min feeder di/dt A/ms</th><th class="n">Longest time to trip ms</th><th class="n">Max rail potential V</th><th>Breaking</th><th>Detection</th><th>di/dt</th></tr></thead><tbody>' +
    F.tracks.map(t => '<tr><td>' + esc(t.track) + '</td><td class="n">' + fmt(t.max / 1000, 1) + '</td><td class="n">' + fmt(t.min / 1000, 1) + '</td><td class="n">' + fmt(t.minFeeder / 1000, 1) + '</td><td class="n">' + fmt(t.minDidtFeeder) + '</td><td class="n">' + (t.maxTtrip !== null ? fmt(t.maxTtrip, 1) : '–') + (t.notTripped ? ' (' + t.notTripped + ' not reached)' : '') + '</td><td class="n">' + fmt(t.maxUrail) + '</td><td>' + chip(t.max / 1000 <= L.breaking_kA ? 'pass' : 'fail') + '</td><td>' + chip(t.minFeeder >= L.breaker_trip_A * L.fault_margin ? 'pass' : 'fail') + '</td><td>' + chip(t.minDidtFeeder >= num(S.didt_setting_A_ms, 40) ? 'pass' : 'fail') + '</td></tr>').join('') + '</tbody>';
  $('#tblScAC').innerHTML = '<thead><tr><th>TSS</th><th class="n">HV Ik″ kA</th><th class="n">HV ip kA</th><th class="n">Valve side Ik″ kA</th><th class="n">Valve side ip kA</th><th class="n">Xc mΩ</th><th class="n">Source R mΩ</th><th class="n">R from AC data mΩ</th><th class="n">Source L mH</th><th class="n">DC terminal fault kA</th><th class="n">di/dt at terminals A/ms</th><th class="n">τ ms</th></tr></thead><tbody>' +
    F.tssAC.map(a => '<tr><td>' + esc(a.name) + (a.active ? '' : ' <span class="chip off">out</span>') + '</td><td class="n">' + fmt(a.IkHV_kA, 2) + '</td><td class="n">' + fmt(a.ipHV_kA, 2) + '</td><td class="n">' + fmt(a.IkLV_kA, 1) + '</td><td class="n">' + fmt(a.ipLV_kA, 1) + '</td><td class="n">' + fmt(a.Xc_mohm, 2) + '</td><td class="n">' + fmt(a.Req_mohm, 2) + '</td><td class="n">' + fmt(a.ReqAC_mohm, 2) + '</td><td class="n">' + fmt(a.Ldc_mH, 3) + '</td><td class="n">' + fmt(a.IkD_kA, 1) + '</td><td class="n">' + fmt(a.didtD_A_ms) + '</td><td class="n">' + fmt(a.tauD_ms, 2) + '</td></tr>').join('') + '</tbody>';
}

/* ---------------- harmonics panel ---------------- */
function harmEntities() { if (!ST) return []; const e = ST.harm.tss.filter(t => t.active); return ST.harm.common ? [ST.harm.common].concat(e) : e; }
function worstHarm() { const e = harmEntities(); return e.reduce((b, t) => !b || t.THDv95 > b.THDv95 ? t : b, null); }
function renderHarm() {
  if (!ST) return;
  const H = ST.harm, ents = harmEntities(), sel = $('#harmSel');
  const prev = sel.value;
  sel.innerHTML = ents.map(t => '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>').join('');
  const w = worstHarm();
  sel.value = ents.some(t => t.name === prev) ? prev : (w ? w.name : '');
  const cur = ents.find(t => t.name === sel.value) || w;
  if (!cur) return;
  let wr = 0, wh = null, wn = '';
  for (const t of ents) H.orders.forEach((h, j) => { const L = H.limits[j]; if (L && t.Vh95[j] / L > wr) { wr = t.Vh95[j] / L; wh = h; wn = t.name; } });
  const tss = H.tss.filter(t => t.active);
  const mu = tss.reduce((m, t) => Math.max(m, t.mu_rated_deg), 0);
  const thdi = tss.reduce((m, t) => Math.max(m, t.THDi_rated), 0);
  $('#harmCards').innerHTML = [
    card(w.THDv95 > H.thd_limit ? 'bad' : w.THDv95 > 0.9 * H.thd_limit ? 'warn' : 'ok', 'Worst voltage THD (' + H.percentile + ' %)', fmt(w.THDv95, 2), '%', esc(w.name) + ' · limit ' + fmt(H.thd_limit, 1) + ' % · max ' + fmt(w.THDvmax, 2) + ' %'),
    card(wr > 1 ? 'bad' : wr > 0.9 ? 'warn' : 'ok', 'Worst individual harmonic', wh ? 'h' + wh : '–', '', wh ? fmt(wr * 100) + ' % of limit at ' + esc(wn) : 'no limits set'),
    card('', 'Current THD at rated load', fmt(thdi, 1), '%', H.pulse + '-pulse, residual ' + fmt(num(cfg.harm.residual_pct, 7.5), 1) + ' % · HV side'),
    card('', 'Commutation overlap at rated load', fmt(mu, 1), '°', 'largest of the substations')
  ].join('');
  $('#harmRef').textContent = H.pulse + '-pulse rectifiers · ' + (cfg.harm.pcc === 'common' ? 'common supply bus' : 'separate supply per TSS') + ' · ' + (H.std_name || '');
  const lab = H.orders.map(String);
  const o = baseOpts('Harmonic order', '% of nominal voltage');
  o.scales.x = { type: 'category', ticks: { color: css('--ink2'), font: { family: css('--f-mono'), size: 10 } }, grid: { display: false } };
  o.parsing = true; o.normalized = false; o.plugins.decimation.enabled = false;
  mkChart('chHarmSpec', 'bar', { labels: lab, datasets: [
    { type: 'bar', label: H.percentile + ' % value', data: cur.Vh95, backgroundColor: cur.Vh95.map((v, j) => H.limits[j] && v > H.limits[j] ? css('--fail') : css('--up')), borderWidth: 0 },
    { type: 'bar', label: 'Maximum', data: cur.Vhmax, backgroundColor: css('--grid'), borderColor: css('--ink3'), borderWidth: 1 },
    { type: 'line', label: 'Limit', data: H.limits.map(v => v === null ? NaN : v), borderColor: css('--fail'), backgroundColor: css('--fail'), borderWidth: 1.2, pointRadius: 2, stepped: 'middle', spanGaps: false }] }, o);
  const n = cur.ts.THDv.length, pts = [];
  for (let s = 0; s < n; s += 2) pts.push({ x: s * R.dt / 60, y: cur.ts.THDv[s] });
  const o2 = baseOpts('Time (min)', 'Voltage THD (%)'); o2.scales.y.min = 0;
  mkChart('chHarmThd', 'line', { datasets: [lineDS(cur.name, pts, css('--up'), { borderWidth: 1 }), lineDS('Limit', [{ x: 0, y: H.thd_limit }, { x: R.period / 60, y: H.thd_limit }], css('--fail'), { borderDash: [6, 4], borderWidth: 1.2 })] }, o2);
  $('#tblHarm').innerHTML = '<thead><tr><th>Supply point</th><th class="n">Overlap at rated °</th><th class="n">HV I1 rated A</th><th class="n">Current THD rated %</th><th class="n">Current THD ' + H.percentile + ' % value</th><th class="n">Voltage THD ' + H.percentile + ' %</th><th class="n">Voltage THD max %</th><th>vs ' + fmt(H.thd_limit, 1) + ' %</th><th>Worst harmonic</th><th>Result</th></tr></thead><tbody>' +
    ents.map(t => {
      let r = 0, hh = null; H.orders.forEach((h, j) => { const L = H.limits[j]; if (L && t.Vh95[j] / L > r) { r = t.Vh95[j] / L; hh = h; } });
      const ok = t.THDv95 <= H.thd_limit && r <= 1;
      return '<tr><td><b>' + esc(t.name) + '</b></td><td class="n">' + (t.mu_rated_deg !== undefined ? fmt(t.mu_rated_deg, 1) : '–') + '</td><td class="n">' + (t.I1_rated !== undefined ? fmt(t.I1_rated, 1) : '–') + '</td><td class="n">' + (t.THDi_rated !== undefined ? fmt(t.THDi_rated, 1) : '–') + '</td><td class="n">' + (t.THDi95 !== undefined ? fmt(t.THDi95, 1) : '–') + '</td><td class="n">' + fmt(t.THDv95, 2) + '</td><td class="n">' + fmt(t.THDvmax, 2) + '</td><td>' + bar(t.THDv95 / H.thd_limit) + '</td><td>' + (hh ? 'h' + hh + ' · ' + fmt(r * 100) + ' %' : '–') + '</td><td>' + chip(ok ? 'pass' : 'fail') + '</td></tr>';
    }).join('') + '</tbody>';
  $('#tblHarmSpec').innerHTML = '<thead><tr><th class="n">h</th><th>Type</th>' + (cur.Ih_rated ? '<th class="n">HV Ih at rated A</th>' : '') + '<th class="n">Vh ' + H.percentile + ' % (%)</th><th class="n">Vh max (%)</th><th class="n">Limit (%)</th><th>Result</th></tr></thead><tbody>' +
    H.orders.map((h, j) => '<tr><td class="n">' + h + '</td><td>' + (H.characteristic[j] ? 'characteristic' : 'residual') + '</td>' + (cur.Ih_rated ? '<td class="n">' + fmt(cur.Ih_rated[j], 2) + '</td>' : '') + '<td class="n">' + fmt(cur.Vh95[j], 3) + '</td><td class="n">' + fmt(cur.Vhmax[j], 3) + '</td><td class="n">' + (H.limits[j] !== null ? fmt(H.limits[j], 2) : '–') + '</td><td>' + (H.limits[j] !== null ? chip(cur.Vh95[j] <= H.limits[j] ? 'pass' : 'fail') : '') + '</td></tr>').join('') + '</tbody>';
  $('#tblRipple2').innerHTML = '<thead><tr><th>TSS</th><th class="n">f Hz</th><th class="n">Ripple voltage V</th><th class="n">Ripple current A</th><th class="n">Section m</th></tr></thead><tbody>' +
    tss.map(t => t.dc.map((d, k) => '<tr><td>' + (k ? '' : esc(t.name)) + '</td><td class="n">' + fmt(d.f) + '</td><td class="n">' + fmt(d.V, 2) + '</td><td class="n">' + fmt(d.I, 2) + '</td><td class="n">' + (k ? '' : fmt(t.secLen)) + '</td></tr>').join('')).join('') + '</tbody>';
}

/* ---------------- EMC panel ---------------- */
function renderEMC() {
  if (!ST) return;
  const E = ST.emc, M = cfg.emc || {}, Lm = E.limits;
  const st = (v, l) => l === null || l === undefined || l === '' ? '' : v > l ? 'bad' : v > 0.9 * l ? 'warn' : 'ok';
  const wt = E.telecom.reduce((b, t) => !b || t.ep_mV > b.ep_mV ? t : b, null);
  const pl = num(M.psoph_limit_mV, null);
  $('#emcCards').innerHTML = [
    card(st(E.max1, Lm.s1), 'Rail potential, instantaneous', fmt(E.max1), 'V', 'at ' + fmt(E.at1) + ' m · limit ' + fmt(Lm.s1) + ' V (≤ 1 s)'),
    card(st(E.max300, Lm.s300), 'Rail potential, 300 s average', fmt(E.max300), 'V', 'limit ' + fmt(Lm.s300) + ' V'),
    card(st(E.maxMean, Lm.long), 'Rail potential, long term', fmt(E.maxMean), 'V', 'whole period average · limit ' + fmt(Lm.long) + ' V'),
    card(st(E.stray_mA_m, num(M.stray_limit_mA_m, 2.5)), 'Stray current', fmt(E.stray_mA_m, 2), 'mA/m', fmt(E.strayAvg_A, 1) + ' A average leaving the rails · limit ' + fmt(num(M.stray_limit_mA_m, 2.5), 1) + ' mA/m'),
    card(E.field.length ? st(E.field[0].Bpk_uT / 1000, num(M.B_limit_mT, 0.5)) : '', 'Static magnetic field', E.field.length ? fmt(E.field[0].Bpk_uT) : '–', 'µT', E.field.length ? 'at ' + E.field[0].d + ' m, peak ' + fmt(E.Ipk) + ' A · reference ' + fmt(num(M.B_limit_mT, 0.5) * 1000) + ' µT' : ''),
    card(pl !== null && wt ? st(wt.ep_mV, pl) : '', 'Telecom noise (psophometric)', wt ? fmt(wt.ep_mV, 2) : '–', 'mV', wt ? esc(wt.tss) + ' section · ' + (pl !== null ? 'limit ' + fmt(pl, 2) + ' mV' : 'no limit set, report only') : '')
  ].join('');
  const vl = cfg.tss.map(t => ({ x: +t.ch, color: css('--ink3'), dash: [2, 3], label: t.name }));
  const x0 = E.x[0], x1 = E.x[E.x.length - 1];
  const ds = [lineDS('Highest', E.x.map((x, j) => ({ x: x, y: E.Umax[j] })), css('--accent')), lineDS('Lowest', E.x.map((x, j) => ({ x: x, y: E.Umin[j] })), css('--up')),
    lineDS('Highest 300 s average |U|', E.x.map((x, j) => ({ x: x, y: E.U300[j] })), css('--dn'), { borderDash: [4, 3] })];
  if (Lm.s1 !== null) { ds.push(lineDS('±' + fmt(Lm.s1) + ' V (≤ 1 s)', [{ x: x0, y: Lm.s1 }, { x: x1, y: Lm.s1 }], css('--fail'), { borderDash: [6, 4], borderWidth: 1 })); ds.push(lineDS('', [{ x: x0, y: -Lm.s1 }, { x: x1, y: -Lm.s1 }], css('--fail'), { borderDash: [6, 4], borderWidth: 1 })); }
  let o = baseOpts('Chainage (m)', 'Rail potential to earth (V)'); o.plugins.decimation.enabled = false; o.plugins.vlines.lines = vl;
  o.plugins.legend.labels.filter = (it) => it.text !== '';
  mkChart('chRail', 'line', { datasets: ds }, o);
  $('#railNodeLbl').textContent = 'Rail potential against time at ' + fmt(E.worstNode.x) + ' m (worst location)';
  o = baseOpts('Time (min)', 'V'); o.plugins.decimation.enabled = false;
  mkChart('chRailT', 'line', { datasets: [lineDS('Rail potential', E.worstNode.t.map((t, i) => ({ x: t / 60, y: E.worstNode.U[i] })), css('--accent'), { borderWidth: 1 })] }, o);
  o = baseOpts('Distance from track centre (m)', 'µT'); o.scales.y.type = 'logarithmic'; o.plugins.decimation.enabled = false;
  const ref = num(M.B_limit_mT, 0.5) * 1000, xs = E.field.map(f => f.d);
  mkChart('chField', 'line', { datasets: [lineDS('Peak current ' + fmt(E.Ipk) + ' A', E.field.map(f => ({ x: f.d, y: f.Bpk_uT })), css('--accent'), { pointRadius: 3 }), lineDS('1-h RMS ' + fmt(E.Irms) + ' A', E.field.map(f => ({ x: f.d, y: f.Brms_uT })), css('--up'), { pointRadius: 3 }),
    lineDS('Reference ' + fmt(ref) + ' µT', [{ x: Math.min.apply(null, xs), y: ref }, { x: Math.max.apply(null, xs), y: ref }], css('--fail'), { borderDash: [6, 4], borderWidth: 1 }), lineDS('Earth field ≈ 50 µT', [{ x: Math.min.apply(null, xs), y: 50 }, { x: Math.max.apply(null, xs), y: 50 }], css('--ink3'), { borderDash: [2, 3], borderWidth: 1 })] }, o);
  $('#tblField').innerHTML = '<thead><tr><th class="n">Distance m</th><th class="n">B at peak µT</th><th class="n">B at 1-h RMS µT</th><th>vs ' + fmt(ref) + ' µT</th></tr></thead><tbody>' + E.field.map(f => '<tr><td class="n">' + f.d + '</td><td class="n">' + fmt(f.Bpk_uT, 1) + '</td><td class="n">' + fmt(f.Brms_uT, 1) + '</td><td>' + bar(f.Bpk_uT / ref) + '</td></tr>').join('') + '</tbody>';
  $('#tblTelecom').innerHTML = '<thead><tr><th>Section</th><th class="n">Length m</th><th class="n">Weighted emf mV</th><th class="n">Noise mV</th><th>Result</th></tr></thead><tbody>' +
    E.telecom.map(t => '<tr><td>' + esc(t.tss) + '</td><td class="n">' + fmt(t.Lpar) + '</td><td class="n">' + fmt(t.Ew_mV, 1) + '</td><td class="n">' + fmt(t.ep_mV, 3) + '</td><td>' + (pl !== null ? chip(t.ep_mV <= pl ? 'pass' : 'fail') : '<span class="muted">report only</span>') + '</td></tr>').join('') + '</tbody>' +
    '<tfoot><tr><td colspan="5" class="muted">Mutual inductance ' + fmt(E.Mprime_uH_m, 3) + ' µH/m · screening ' + num(M.screening, 1) + ' · sensitivity ' + num(M.sensitivity, 0.001) + '</td></tr></tfoot>';
}

/* ---------------- Excel sheets for the studies ---------------- */
function addStudySheets(add) {
  if (F) {
    add('SC along line', [['Track', 'Chainage m', 'Total fault A', 'Largest feeder A', 'di/dt total A/ms', 'di/dt feeder A/ms', 'Time constant ms', 'Time to trip ms', 'Rail potential V']]
      .concat([].concat.apply([], F.tracks.map(t => t.x.map((x, i) => [t.track, x, t.If[i], t.Ifeeder[i], t.didt[i], t.didtFeeder[i], t.tau_ms[i], t.ttrip_ms[i], t.Urail[i]])))));
    add('SC per TSS', [['TSS', 'HV Ik kA', 'HV ip kA', 'Valve Ik kA', 'Valve ip kA', 'Xc mOhm', 'Source R mOhm', 'R from AC mOhm', 'Source L mH', 'DC terminal fault kA', 'di/dt A/ms', 'tau ms']]
      .concat(F.tssAC.map(a => [a.name, a.IkHV_kA, a.ipHV_kA, a.IkLV_kA, a.ipLV_kA, a.Xc_mohm, a.Req_mohm, a.ReqAC_mohm, a.Ldc_mH, a.IkD_kA, a.didtD_A_ms, a.tauD_ms])));
  }
  if (ST) {
    const H = ST.harm, ents = harmEntities();
    add('Harmonics', [['Supply point', 'Voltage THD 95% %', 'Voltage THD max %', 'Current THD rated %', 'Overlap rated deg']].concat(ents.map(t => [t.name, t.THDv95, t.THDvmax, t.THDi_rated === undefined ? null : t.THDi_rated, t.mu_rated_deg === undefined ? null : t.mu_rated_deg])),
      [[]], [['Order h', 'Limit %'].concat(ents.map(t => t.name + ' Vh95 %'))].concat(H.orders.map((h, j) => [h, H.limits[j]].concat(ents.map(t => t.Vh95[j])))));
    const E = ST.emc;
    add('EMC rail potential', [['Chainage m', 'Highest V', 'Lowest V', 'Highest 300 s avg |U| V', 'Mean |U| V']].concat(E.x.map((x, j) => [x, E.Umax[j], E.Umin[j], E.U300[j], E.Umean[j]])));
    add('EMC field & telecom', [['Distance m', 'B peak uT', 'B 1-h RMS uT']].concat(E.field.map(f => [f.d, f.Bpk_uT, f.Brms_uT]), [[]], [['Section', 'Length m', 'f Hz', 'Ripple A', 'Longitudinal emf mV', 'Weight', 'Noise mV (section)']],
      [].concat.apply([], E.telecom.map(t => t.E.map((e, k) => [k ? '' : t.tss, k ? '' : t.Lpar, e.f, e.I, e.E_mV, e.w, k ? '' : t.ep_mV]))), [[]], [['Stray current A (average)', E.strayAvg_A], ['Stray current mA/m', E.stray_mA_m]]));
  }
}

/* =====================================================================
   REPORTS
   ===================================================================== */
const REPORTS = [
  { id: 'dc', code: 'DC', title: 'DC Traction Power Simulation Report', desc: 'Train runs, substation loading and sizing, train voltages, feeders and conductor rail, energy, design check and compliance.' },
  { id: 'sc', code: 'SC', title: 'Short Circuit Study Report', desc: 'AC fault levels per substation, DC fault currents and rate of rise along the line, breaker detection and rail potential during faults.' },
  { id: 'hm', code: 'HM', title: 'Harmonic Study Report', desc: 'Rectifier harmonic currents, voltage distortion at the supply against limits, THD through the period and DC ripple.' },
  { id: 'emc', code: 'EMC', title: 'EMC / EMI Study Report', desc: 'Rail potential and touch voltage, stray current, static magnetic field and inductive interference to telecom cables.' }
];
function renderReportsPanel() {
  const box = $('#reportCards'); if (!box) return;
  box.innerHTML = REPORTS.map(r => '<div class="group"><h3>' + esc(r.title) + ' <small class="mono">' + esc((cfg.project.ref || 'TPS') + '-' + r.code) + '</small></h3><p class="note">' + esc(r.desc) + '</p><div class="row"><button class="accent" data-rep="' + r.id + '" data-fmt="pdf"' + (R ? '' : ' disabled') + '>Download PDF</button><button data-rep="' + r.id + '" data-fmt="docx"' + (R ? '' : ' disabled') + '>Download Word</button></div></div>').join('');
  $$('#reportCards button[data-rep]').forEach(b => b.addEventListener('click', () => downloadReport(b.dataset.rep, b.dataset.fmt, b)));
  $('#btnAllReports').disabled = !R;
  $('#reportNote').textContent = R ? 'Scenario: ' + R.scenario + (DC ? ' · design check included (' + DC.length + ' cases)' : ' · run the design check to include all cases in the DC report') : 'Run the simulation first.';
}
const LIBS = {
  pdf: ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'],
  docx: ['https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js']
};
function loadScript(src) { return new Promise((res, rej) => { if ($$('script').some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); }); }
async function loadLibs(kind) { for (const u of LIBS[kind]) await loadScript(u); }
async function downloadReport(id, fmtKind, btn) {
  if (!R) { toast('Run the simulation first'); return; }
  const lab = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const rep = buildReport(id);
    const blob = fmtKind === 'pdf' ? await reportToPDF(rep) : await reportToDOCX(rep);
    await saveFile(rep.file + '.' + fmtKind, blob);
  } catch (e) { toast('Report failed: ' + (e.message || e), 6000); console.error(e); }
  if (btn) { btn.disabled = false; btn.textContent = lab; }
}
async function downloadAllReports() {
  if (!R) return;
  const b = $('#btnAllReports'); b.disabled = true; const lab = b.textContent; b.textContent = 'Preparing 8 files…';
  try {
    const z = new JSZip();
    for (const r of REPORTS) { const rep = buildReport(r.id); z.file(rep.file + '.pdf', await reportToPDF(rep)); z.file(rep.file + '.docx', await reportToDOCX(rep)); }
    z.file('inputs.json', JSON.stringify(cfg, null, 1));
    const blob = await z.generateAsync({ type: 'blob' });
    await saveFile((cfg.project.ref || 'TPS') + '_Reports.zip', blob);
  } catch (e) { toast('Reports failed: ' + (e.message || e), 6000); console.error(e); }
  b.disabled = false; b.textContent = lab;
}

/* ---------- chart images for reports (fixed print colours) ---------- */
const PC = { ink: '#1c2631', ink2: '#4d5a67', grid: '#e1e4dd', up: '#1d6c88', dn: '#7a4aa0', acc: '#b1531b', fail: '#b3261e', pass: '#1b7442', mute: '#8a949e' };
const PPAL = [PC.up, PC.dn, PC.acc, PC.pass, '#9a6400', '#5b6f8a', '#b04a7a', '#3d8f8a', '#8a6d3b', '#6b4fb5'];
function chartImage(type, data, xTitle, yTitle, extra) {
  if (typeof Chart === 'undefined') return null;
  const W = 1000, H = (extra && extra.h) || 420;
  const host = $('#offscreen'); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.width = W + 'px'; cv.style.height = H + 'px'; host.appendChild(cv);
  const scales = {
    x: Object.assign({ type: 'linear', title: { display: !!xTitle, text: xTitle, color: PC.ink2, font: { size: 13 } }, ticks: { color: PC.ink2, font: { size: 12 } }, grid: { color: PC.grid } }, (extra && extra.x) || {}),
    y: Object.assign({ title: { display: !!yTitle, text: yTitle, color: PC.ink2, font: { size: 13 } }, ticks: { color: PC.ink2, font: { size: 12 } }, grid: { color: PC.grid } }, (extra && extra.y) || {})
  };
  const ch = new Chart(cv, { type: type, data: data, options: { responsive: false, animation: false, devicePixelRatio: 2, parsing: !!(extra && extra.parsing), normalized: true,
    plugins: { legend: { labels: { color: PC.ink, boxWidth: 16, boxHeight: 2, font: { size: 12 }, filter: it => it.text !== '' } }, decimation: { enabled: false }, vlines: { lines: (extra && extra.vlines) || [] } },
    scales: scales }, plugins: [vlinePlugin] });
  const url = ch.toBase64Image('image/png');
  ch.destroy(); cv.remove();
  return { t: 'chart', img: url, w: W, h: H, caption: (extra && extra.caption) || '' };
}
function pl(label, pts, color, o) { return Object.assign({ label: label, data: pts, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0 }, o || {}); }
function tssV() { return cfg.tss.map(t => ({ x: +t.ch, color: PC.mute, dash: [3, 4], label: t.name })); }

/* ---------- report content (block model) ---------- */
const f0 = v => fmt(v, 0), f1 = v => fmt(v, 1), f2 = v => fmt(v, 2);
function passTxt(c) { return c.pass ? 'PASS' : 'FAIL'; }
function checkTable(groups) {
  const rows = R.checks.filter(c => groups.indexOf(c.group) >= 0);
  return { t: 'table', head: ['Result', 'Group', 'Check', 'Location', 'Value', 'Limit', 'Unit', 'Use %'],
    rows: rows.map(c => [passTxt(c), c.group, c.item, c.where, fmt(c.value, c.unit === 'kA' || c.unit === '%' || c.unit === 'mT' || c.unit === 'mV' || c.unit === 'mA/m' || c.unit === 'S/km' ? 2 : 0), (c.kind === 'min' ? '≥ ' : '≤ ') + fmt(c.limit, c.unit === 'kA' || c.unit === '%' || c.unit === 'mT' || c.unit === 'mV' || c.unit === 'mA/m' || c.unit === 'S/km' ? 2 : 0), c.unit, f0(c.ratio * 100)]),
    status: 0, widths: [12, 18, 58, 30, 18, 20, 12, 12] };
}
function verdict(groups) {
  const rows = R.checks.filter(c => groups.indexOf(c.group) >= 0), f = rows.filter(c => !c.pass);
  return f.length ? f.length + ' of ' + rows.length + ' checks fail. The first is: ' + f[0].group + ', ' + f[0].item + ' at ' + f[0].where + ' (' + fmt(f[0].value, 1) + ' ' + f[0].unit + ' against ' + fmt(f[0].limit, 1) + ').'
    : 'All ' + rows.length + ' checks pass for this scenario.';
}
function headerBlocks(rp) {
  const A = cfg.alignment;
  return [{ t: 'title', title: rp.title, sub: cfg.project.name, meta: [
    ['Document', rp.docref], ['System', cfg.project.system || ''], ['Scenario', R.scenario], ['Date', new Date().toISOString().slice(0, 10)],
    ['Alignment data', A.source || ''], ['Train data', cfg.trains.map(t => t.source || t.name).join(', ')], ['Calculation', R.engine + ' (HTML model)']] }];
}
function lineFacts() {
  const A = cfg.alignment, ext = R.extent;
  const gmax = A.gradients.reduce((m, g) => Math.max(m, Math.abs(+g.g)), 0), rmin = A.curves.reduce((m, c) => Math.min(m, +c.R || 1e9), 1e9);
  return [['Line length (model extent)', f0(ext[1] - ext[0]) + ' m'], ['Stations', String(A.stations.length)], ['Tracks', cfg.tracks.filter(t => t.enabled !== false).map(t => t.name + ' (' + t.dir + ')').join(', ')],
    ['Steepest gradient', f1(gmax) + ' ‰'], ['Smallest curve radius', rmin < 1e9 ? f0(rmin) + ' m' : 'none'], ['Traction substations', cfg.tss.length + ' (' + cfg.tss.filter(t => t.in_service !== false).length + ' in service)']];
}
function buildReport(id) {
  const meta = REPORTS.find(r => r.id === id);
  const rp = { title: meta.title, docref: (cfg.project.ref || 'TPS') + '-' + meta.code, file: ((cfg.project.ref || 'TPS') + '_' + meta.code + '_Report').replace(/[^A-Za-z0-9_.-]+/g, '_') };
  const B = headerBlocks(rp);
  const E = cfg.electrical, L = cfg.limits;
  if (id === 'dc') {
    const groups = ['Rectifier', 'Transformer', 'Feeder', 'Conductor rail', 'Train voltage'];
    B.push({ t: 'h1', text: 'Summary' }, { t: 'p', text: 'This report gives the DC traction power simulation of ' + cfg.project.name + ' for the scenario "' + R.scenario + '" over ' + f0(R.period) + ' s of peak service. ' + verdict(groups) });
    B.push({ t: 'kv', rows: [['Minimum train voltage', f0(R.trainV.min) + ' V (limit ' + f0(L.V_min) + ' V)'], ['Maximum train voltage', f0(R.trainV.max) + ' V (limit ' + f0(L.V_max) + ' V)'],
      ['Mean useful voltage', f0(R.trainV.mean_useful) + ' V'], ['Energy from substations', f0(R.energy.tss_kWh) + ' kWh'], ['Regenerated energy returned', f0(R.energy.regen_out_kWh) + ' kWh'],
      ['Network losses', f0(R.energy.losses_kWh) + ' kWh (' + f1(R.energy.losses_kWh / Math.max(R.energy.tss_kWh, 1) * 100) + ' %)']] });
    B.push({ t: 'h1', text: 'Scope and method' });
    B.push({ t: 'p', text: 'Each train service is run over the alignment on a ' + f0(num(cfg.sim.dx, 5)) + ' m distance grid with tractive and braking effort, Davis resistance, gradient and curve resistance, speed restrictions held for the train length and the station dwell times. The trains are placed on the tracks at their headways and the DC network (substations, feeders, conductor and return rails, trains) is solved every ' + f0(R.dt) + ' s with diode substations, constant-power trains, low-voltage cut-back and the regeneration voltage limit. Ratings are checked against rolling 1-minute, 15-minute and 1-hour RMS values.' });
    B.push({ t: 'h1', text: 'Input data' }, { t: 'h2', text: 'Line and alignment' }, { t: 'kv', rows: lineFacts() });
    B.push({ t: 'h2', text: 'Tracks and service' }, { t: 'table', head: ['Track', 'Direction', 'Headway s', 'Trains/h', 'Train type', 'Skip stations', 'Trip min'], rows: R.tracks.map(t => { const c = cfg.tracks.find(z => z.name === t.name) || {}; return [t.name, t.dir, f0(t.headway), f1(t.tph), (cfg.trains[num(c.train, 0)] || {}).name || '', c.skip || '–', f1(t.trip / 60)]; }) });
    B.push({ t: 'h2', text: 'Traction substations' }, { t: 'table', head: ['TSS', 'Chainage m', 'Rectifier kW', 'Transformer kVA', 'No-load V', 'Source R mΩ', 'Inverter kW', 'Status'], rows: R.tss.map(t => [t.name, f0(t.ch), f0(t.rect_kW), f0(t.xfmr_kVA), f0(t.V0), f2(t.Req * 1000), f0(t.inv_kW), t.active ? 'in service' : 'out']) });
    B.push({ t: 'h2', text: 'Rolling stock' }, { t: 'table', head: ['Train', 'Cars', 'Mass t', 'Length m', 'Vmax km/h', 'Acc m/s²', 'Brake m/s²', 'Aux kW', 'Davis A/B/C'], rows: cfg.trains.map(t => [t.name, t.cars, t.mass_t, t.length_m, t.vmax, t.acc, t.dec, f0(num(t.aux_kW_car, 0) * num(t.cars, 1)), [t.davis.A, t.davis.B, t.davis.C].join(' / ')]) });
    const T0 = cfg.trains[0], mm = T0.te_basis === 'motor' ? Math.max(1, num(T0.n_motors, 1)) : 1;
    B.push(chartImage('line', { datasets: [pl('Tractive effort', TPS.cleanTable(T0.te_curve).map(r => ({ x: r[0], y: r[1] * mm })), PC.up), pl('Electric braking effort', TPS.cleanTable(T0.be_curve).map(r => ({ x: r[0], y: r[1] * mm })), PC.dn, { borderDash: [6, 4] })] }, 'Speed (km/h)', 'Effort per train (kN)', { h: 360, caption: 'Effort curves of ' + T0.name }));
    B.push({ t: 'h2', text: 'Electrical parameters and limits' }, { t: 'kv', rows: [['Nominal / no-load voltage', E.V_nom + ' V / ' + E.V0 + ' V'], ['Conductor + return resistance', E.r_pos + ' + ' + E.r_ret + ' Ω/km per track'], ['Feeder resistance', E.R_feeder + ' Ω'],
      ['Regeneration limit', E.V_regen_start + ' → ' + E.V_regen_max + ' V'], ['Traction cut-back', E.V_cut_start + ' → ' + E.V_cut_zero + ' V'], ['Train voltage limits', L.V_min + ' V min, ' + L.V_max + ' V max, ' + L.U_mean_useful + ' V mean useful'],
      ['Duty multipliers normal / outage', 'h1 ' + L.normal.h1 + ', 15 min ' + L.normal.m15 + ', 1 min ' + L.normal.m1 + ' / ' + L.contingency.h1 + ', ' + L.contingency.m15 + ', ' + L.contingency.m1], ['Conductor rail / feeder ratings', L.conductor_A + ' A / ' + L.feeder_A + ' A']] });
    B.push({ t: 'h1', text: 'Results' }, { t: 'h2', text: 'Train runs' });
    for (const k of Object.keys(R.runs)) {
      const run = R.runs[k], tr = R.tracks.filter(t => t.key === k).map(t => t.name).join(', ');
      B.push({ t: 'p', text: tr + ' · ' + run.train + ' · ' + run.dir + ': trip ' + mmss(run.T) + ' min:s, top speed ' + f1(run.vmax_kmh) + ' km/h, traction ' + f1(run.E_trac_kWh) + ' kWh, auxiliaries ' + f1(run.E_aux_kWh) + ' kWh, regeneration available ' + f1(run.E_regen_kWh) + ' kWh.' });
    }
    const k0 = Object.keys(R.runs)[0], r0 = R.runs[k0]; const sp = []; for (let i = 0; i < r0.n; i += 2) sp.push({ x: r0.x[i], y: r0.v[i] });
    B.push(chartImage('line', { datasets: [pl('Speed', sp, PC.up)] }, 'Chainage (m)', 'Speed (km/h)', { h: 340, vlines: r0.stations.map(s => ({ x: s.ch, color: PC.mute, dash: [2, 3], label: s.name })), caption: 'Speed profile, ' + r0.train + ' ' + r0.dir }));
    B.push({ t: 'table', head: ['Station', 'Chainage m', 'Arrive', 'Depart'], rows: r0.stations.map(s => [s.name, f0(s.ch), mmss(s.arr), mmss(s.dep)]) });
    const d = R.contingency ? L.contingency : L.normal, Vn = num(E.V_nom, 750);
    B.push({ t: 'h2', text: 'Substation loading and equipment sizing' }, { t: 'table', head: ['TSS', 'Rated A', 'Peak A', '1-min A', '15-min A', '1-h A', '1-h %', 'Needed kW', 'Xfmr 1-h kVA', 'Needed kVA', 'Energy kWh'],
      rows: R.tss.map(t => t.active ? [t.name, f0(t.Ir), f0(t.Ipk), f0(t.I1), f0(t.I15), f0(t.I1h), f0(t.I1h / t.Ir * 100), f0(Math.max(t.I1h / d.h1, t.I15 / d.m15, t.I1 / d.m1) * Vn / 1000), f0(t.S1h), f0(Math.max(t.S1h / d.h1, t.S15 / d.m15, t.S1 / d.m1)), f0(t.E_kWh)] : [t.name, f0(t.Ir), 'out', '', '', '', '', '', '', '', '']) });
    const top = R.tss.map((t, i) => [t.active ? t.I1h : -1, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    B.push(chartImage('line', { datasets: top.map((i, q) => { const a = []; for (let s = 0; s < R.ts.tssI[i].length; s += 3) a.push({ x: s * R.dt / 60, y: R.ts.tssI[i][s] }); return pl(R.tss[i].name, a, PPAL[q], { borderWidth: 1 }); }) }, 'Time (min)', 'Rectifier current (A)', { h: 360, caption: 'Currents of the three most loaded substations' }));
    B.push({ t: 'h2', text: 'Train voltage' });
    const dsV = []; R.trainV.envelope.forEach((e, q) => { dsV.push(pl(e.track + ' lowest', e.x.map((x, i) => ({ x: x, y: e.min[i] })), PPAL[q])); dsV.push(pl(e.track + ' highest', e.x.map((x, i) => ({ x: x, y: e.max[i] })), PPAL[q], { borderDash: [3, 3], borderWidth: 1 })); });
    dsV.push(pl('Minimum limit', [{ x: R.extent[0], y: L.V_min }, { x: R.extent[1], y: L.V_min }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 }));
    B.push(chartImage('line', { datasets: dsV }, 'Chainage (m)', 'Train voltage (V)', { h: 380, vlines: tssV(), caption: 'Lowest and highest train voltage by position' }));
    B.push({ t: 'h2', text: 'Feeders and conductor rail' }, { t: 'table', head: ['Feeder', 'Track', 'Peak A', '1-h RMS A', '% of cable rating'], rows: R.feeders.slice().sort((a, b) => b.I1h - a.I1h).slice(0, 12).map(f => [f.tss, f.track, f0(f.Ipk), f0(f.I1h), f0(f.I1h / L.feeder_A * 100)]) });
    if (DC) {
      B.push({ t: 'h1', text: 'Design check, all cases' }, { t: 'p', text: DC.filter(x => x.nFail).length + ' of ' + DC.length + ' cases have failing checks. Outage cases use the contingency duty multipliers.' });
      B.push({ t: 'table', head: ['Case', 'Min V', 'Max V', 'Rect %', 'Xfmr %', 'Rail %', 'Feeder %', 'THD %', 'Fails', 'First failure'], rows: DC.map(x => [x.scenario, f0(x.vmin), f0(x.vmax), f0(x.rect * 100), f0(x.xfmr * 100), f0(x.cond * 100), f0(x.feeder * 100), f2(x.thd), String(x.nFail), x.firstFail]) });
    }
    B.push({ t: 'h1', text: 'Compliance checks' }, checkTable(groups));
  } else if (id === 'sc') {
    const S = cfg.sc, A = cfg.ac, ex = scExtremes();
    const groups = ['Short circuit'];
    const fr = R.checks.filter(c => c.group === 'EMC' && /fault/.test(c.item));
    B.push({ t: 'h1', text: 'Summary' }, { t: 'p', text: 'Short circuit study for ' + cfg.project.name + ', scenario "' + R.scenario + '". ' + verdict(groups) + (fr.length ? ' Rail potential during faults: ' + f0(fr[0].value) + ' V against ' + f0(fr[0].limit) + ' V (' + passTxt(fr[0]) + ').' : '') });
    B.push({ t: 'kv', rows: [['Maximum DC fault current', f1(Math.max.apply(null, F.tracks.map(t => t.max)) / 1000) + ' kA at ' + ex.near.track + ' ' + f0(ex.near.x) + ' m'], ['Minimum feeder fault current', f1(Math.min.apply(null, F.tracks.map(t => t.minFeeder)) / 1000) + ' kA at ' + ex.far.track + ' ' + f0(ex.far.x) + ' m'],
      ['Breaker trip setting / breaking capacity', f1(L.breaker_trip_A / 1000) + ' kA / ' + f0(L.breaking_kA) + ' kA'], ['Minimum feeder di/dt', f0(Math.min.apply(null, F.tracks.map(t => t.minDidtFeeder))) + ' A/ms (setting ' + S.didt_setting_A_ms + ' A/ms)']] });
    B.push({ t: 'h1', text: 'Method' }, { t: 'p', text: 'AC side: three-phase fault currents to IEC 60909 at the HV busbar of each substation (network fault level, X/R and voltage factor c) and at the rectifier valve windings (network plus transformer impedance per bridge), with peak factor κ = 1.02 + 0.98·e^(−3R/X).' },
      { t: 'p', text: 'DC side: a bolted fault (fault resistance ' + cfg.sim.R_fault + ' Ω) is placed every ' + cfg.sim.fault_step + ' m along every track with all substations in service for the scenario. The resistance network gives the sustained current; the inductance network (rectifier commutation inductance 2·Lc per bridge plus ' + A.L_smooth_mH + ' mH smoothing reactor, feeder ' + S.L_feeder_mH + ' mH, conductor/return loop ' + S.L_line_mH_km + ' mH/km) gives the initial rate of rise. The current is taken to rise as i(t) = Iss·(1 − e^(−t/τ)) with τ = Iss ÷ (di/dt). Breaker detection uses the largest single-feeder contribution. Rail potential at the fault uses the input impedance of the rail–earth ladder, If·½√(r/g)·(1 − e^(−γd)).' });
    B.push({ t: 'h1', text: 'Input data' }, { t: 'kv', rows: [['Supply', A.U_hv_kV + ' kV, fault level ' + A.S_sc_MVA + ' MVA, X/R ' + A.XR + ', c = ' + A.c_max], ['Rectifier transformer', 'uk ' + A.uk_pct + ' %, load losses ' + A.pcu_pct + ' %, ' + A.pulse + '-pulse'], ['No-load DC voltage', E.V0 + ' V'],
      ['Loop / feeder inductance', S.L_line_mH_km + ' mH/km / ' + S.L_feeder_mH + ' mH'], ['Feeder resistance', E.R_feeder + ' Ω'], ['Breaker trip / breaking / di/dt setting', L.breaker_trip_A + ' A / ' + L.breaking_kA + ' kA / ' + S.didt_setting_A_ms + ' A/ms'], ['Fault clearing time', S.t_clear_s + ' s']] });
    B.push({ t: 'h1', text: 'AC fault levels and rectifier data' }, { t: 'table', head: ['TSS', 'HV Ik″ kA', 'HV ip kA', 'Valve Ik″ kA', 'Valve ip kA', 'Xc mΩ', 'R used mΩ', 'R from AC mΩ', 'L mH', 'DC term. kA', 'τ ms'],
      rows: F.tssAC.map(a => [a.name, f2(a.IkHV_kA), f2(a.ipHV_kA), f1(a.IkLV_kA), f1(a.ipLV_kA), f2(a.Xc_mohm), f2(a.Req_mohm), f2(a.ReqAC_mohm), fmt(a.Ldc_mH, 3), f1(a.IkD_kA), f2(a.tauD_ms)]) });
    B.push({ t: 'h1', text: 'DC fault currents along the line' }, { t: 'table', head: ['Track', 'Max kA', 'Min kA', 'Min feeder kA', 'Min feeder di/dt A/ms', 'Longest time to trip ms', 'Max rail potential V'],
      rows: F.tracks.map(t => [t.track, f1(t.max / 1000), f1(t.min / 1000), f1(t.minFeeder / 1000), f0(t.minDidtFeeder), t.maxTtrip !== null ? f1(t.maxTtrip) + (t.notTripped ? ' (' + t.notTripped + ' not reached)' : '') : 'not reached', f0(t.maxUrail)]) });
    const dsI = []; F.tracks.forEach((t, q) => { dsI.push(pl(t.track + ' total', t.x.map((x, i) => ({ x: x, y: t.If[i] / 1000 })), PPAL[q])); dsI.push(pl(t.track + ' largest feeder', t.x.map((x, i) => ({ x: x, y: t.Ifeeder[i] / 1000 })), PPAL[q], { borderDash: [5, 3], borderWidth: 1.2 })); });
    const x0 = F.tracks[0].x[0], x1 = F.tracks[0].x[F.tracks[0].x.length - 1];
    dsI.push(pl('Trip setting', [{ x: x0, y: L.breaker_trip_A / 1000 }, { x: x1, y: L.breaker_trip_A / 1000 }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 }));
    B.push(chartImage('line', { datasets: dsI }, 'Fault chainage (m)', 'Sustained fault current (kA)', { h: 380, vlines: tssV(), y: { min: 0 }, caption: 'Sustained fault current along each track' }));
    const dsD = []; F.tracks.forEach((t, q) => dsD.push(pl(t.track + ' largest feeder', t.x.map((x, i) => ({ x: x, y: t.didtFeeder[i] })), PPAL[q])));
    dsD.push(pl('di/dt setting', [{ x: x0, y: num(S.didt_setting_A_ms, 40) }, { x: x1, y: num(S.didt_setting_A_ms, 40) }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 }));
    B.push(chartImage('line', { datasets: dsD }, 'Fault chainage (m)', 'Initial di/dt (A/ms)', { h: 340, vlines: tssV(), y: { type: 'logarithmic' }, caption: 'Rate of rise seen by the largest feeder' }));
    const tmax = Math.max(5 * Math.max(ex.near.tau, ex.far.tau), 20);
    B.push(chartImage('line', { datasets: [pl('Nearest fault (' + f0(ex.near.x) + ' m)', riseCurve(ex.near.If, ex.near.tau, tmax), PC.acc), pl('Remote fault, feeder (' + f0(ex.far.x) + ' m)', riseCurve(ex.far.Ifd, ex.far.Ifd / Math.max(ex.far.didtF, 1e-6), tmax), PC.up), pl('Trip setting', [{ x: 0, y: L.breaker_trip_A / 1000 }, { x: tmax, y: L.breaker_trip_A / 1000 }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 })] }, 'Time after fault (ms)', 'Current (kA)', { h: 340, y: { min: 0 }, caption: 'Fault current rise' }));
    B.push({ t: 'h1', text: 'Rail potential during faults' }, { t: 'p', text: 'Highest rail potential at a fault ' + f0(Math.max.apply(null, F.tracks.map(t => t.maxUrail))) + ' V. Touch-voltage limit for ' + S.t_clear_s + ' s: ' + f0(TPS.touchLimit(cfg, num(S.t_clear_s, 0.06))) + ' V. Rail–earth conductance ' + cfg.emc.g_track_S_km + ' S/km per track; the touch voltage is conservatively taken equal to the rail potential.' });
    B.push({ t: 'h1', text: 'Compliance checks' }, checkTable(groups));
    if (fr.length) B.push({ t: 'table', head: ['Result', 'Check', 'Value V', 'Limit V'], rows: fr.map(c => [passTxt(c), c.item, f0(c.value), f0(c.limit)]) });
  } else if (id === 'hm') {
    const H = ST.harm, A = cfg.ac, ents = harmEntities(), w = worstHarm();
    const groups = ['Harmonics'];
    B.push({ t: 'h1', text: 'Summary' }, { t: 'p', text: 'Harmonic study of the ' + H.pulse + '-pulse traction rectifiers for ' + cfg.project.name + ', scenario "' + R.scenario + '". The highest voltage THD (' + H.percentile + ' % value) is ' + f2(w.THDv95) + ' % at ' + w.name + ' against a limit of ' + f1(H.thd_limit) + ' %. ' + verdict(groups) });
    B.push({ t: 'h1', text: 'Method' }, { t: 'p', text: 'For every second of the simulated substation current the commutation overlap of each diode bridge is found from 1 − cos μ = √2·Xc·Id/Uv, with Xc the transformer plus network reactance per bridge on the valve side. Harmonic currents follow the overlap formula for uncontrolled bridges, Ih/I1 = √(A² + B² − 2AB·cos μ) ÷ (h·(1 − cos μ)), A = sin((h−1)μ/2)/(h−1), B = sin((h+1)μ/2)/(h+1). Characteristic orders kp ± 1 are kept in full; the other 6k ± 1 orders are taken at ' + num(cfg.harm.residual_pct, 7.5) + ' % for transformer and supply imbalance. Harmonic voltages at the HV supply are Ih·h·Xnet with Xnet from the network fault level. ' + (cfg.harm.pcc === 'common' ? 'All substations are on one supply bus and are added with the IEC 61000-3-6 summation exponents (1.4 for h 5–10, 2 above).' : 'Each substation has its own supply point.') + ' The ' + H.percentile + ' % value over the period is compared with the limits.' });
    B.push({ t: 'h1', text: 'Input data' }, { t: 'kv', rows: [['Supply', A.U_hv_kV + ' kV, fault level ' + A.S_sc_MVA + ' MVA, X/R ' + A.XR], ['Rectifier', A.pulse + '-pulse, transformer uk ' + A.uk_pct + ' %'], ['Highest order', String(H.orders[H.orders.length - 1])], ['Limits', (H.std_name || '') + ', THD ' + H.thd_limit + ' %']] });
    B.push({ t: 'table', head: ['Order h'].concat(H.orders.filter((h, j) => H.limits[j] !== null).map(String)), rows: [['Limit %'].concat(H.limits.filter(v => v !== null).map(v => f2(v)))] });
    B.push({ t: 'h1', text: 'Results' }, { t: 'table', head: ['Supply point', 'Overlap °', 'HV I1 A', 'I THD rated %', 'V THD ' + H.percentile + '% %', 'V THD max %', 'Result'],
      rows: ents.map(t => { let r = 0; H.orders.forEach((h, j) => { const Lh = H.limits[j]; if (Lh) r = Math.max(r, t.Vh95[j] / Lh); }); return [t.name, t.mu_rated_deg !== undefined ? f1(t.mu_rated_deg) : '–', t.I1_rated !== undefined ? f1(t.I1_rated) : '–', t.THDi_rated !== undefined ? f1(t.THDi_rated) : '–', f2(t.THDv95), f2(t.THDvmax), t.THDv95 <= H.thd_limit && r <= 1 ? 'PASS' : 'FAIL']; }) });
    B.push(chartImage('bar', { labels: H.orders.map(String), datasets: [{ type: 'bar', label: H.percentile + ' % value', data: w.Vh95, backgroundColor: w.Vh95.map((v, j) => H.limits[j] && v > H.limits[j] ? PC.fail : PC.up) }, { type: 'bar', label: 'Maximum', data: w.Vhmax, backgroundColor: '#cfd6dc' }, { type: 'line', label: 'Limit', data: H.limits.map(v => v === null ? NaN : v), borderColor: PC.fail, backgroundColor: PC.fail, borderWidth: 1.5, pointRadius: 2, stepped: 'middle' }] },
      'Harmonic order', '% of nominal voltage', { h: 380, parsing: true, x: { type: 'category', grid: { display: false } }, caption: 'Harmonic voltage spectrum at ' + w.name }));
    B.push({ t: 'table', head: ['h', 'Type', 'Vh ' + H.percentile + '% %', 'Vh max %', 'Limit %', 'Result'], rows: H.orders.map((h, j) => [String(h), H.characteristic[j] ? 'characteristic' : 'residual', fmt(w.Vh95[j], 3), fmt(w.Vhmax[j], 3), H.limits[j] !== null ? f2(H.limits[j]) : '–', H.limits[j] !== null ? (w.Vh95[j] <= H.limits[j] ? 'PASS' : 'FAIL') : '']) });
    const a = []; for (let s = 0; s < w.ts.THDv.length; s += 3) a.push({ x: s * R.dt / 60, y: w.ts.THDv[s] });
    B.push(chartImage('line', { datasets: [pl(w.name, a, PC.up, { borderWidth: 1 }), pl('Limit', [{ x: 0, y: H.thd_limit }, { x: R.period / 60, y: H.thd_limit }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 })] }, 'Time (min)', 'Voltage THD (%)', { h: 320, y: { min: 0 }, caption: 'Voltage THD through the period at ' + w.name }));
    B.push({ t: 'h2', text: 'DC side ripple' }, { t: 'table', head: ['TSS', 'f Hz', 'Ripple V', 'Ripple A'], rows: [].concat.apply([], H.tss.filter(t => t.active).map(t => t.dc.map((d, k) => [k ? '' : t.name, f0(d.f), f2(d.V), f2(d.I)]))) });
    B.push({ t: 'h1', text: 'Compliance checks' }, checkTable(groups));
    if (R.checks.some(c => c.group === 'Harmonics' && !c.pass)) B.push({ t: 'p', text: 'Mitigation options to consider: higher pulse number by phase-shifted transformers between substations (for example 24- or 36-pulse equivalent), tuned filters at the supply point, or connection at a supply point with a higher fault level. Agree the limits and the background distortion with the supply authority.' });
  } else if (id === 'emc') {
    const Em = ST.emc, M = cfg.emc, Lm = Em.limits;
    const groups = ['EMC'];
    B.push({ t: 'h1', text: 'Summary' }, { t: 'p', text: 'EMC / EMI study for ' + cfg.project.name + ', scenario "' + R.scenario + '". ' + verdict(groups) });
    B.push({ t: 'kv', rows: [['Highest rail potential', f0(Em.max1) + ' V at ' + f0(Em.at1) + ' m (limit ' + f0(Lm.s1) + ' V)'], ['Highest 300 s average', f0(Em.max300) + ' V (limit ' + f0(Lm.s300) + ' V)'], ['Stray current', f2(Em.stray_mA_m) + ' mA/m (limit ' + M.stray_limit_mA_m + ' mA/m)'],
      ['Static field at ' + (Em.field[0] ? Em.field[0].d : '–') + ' m', Em.field[0] ? f0(Em.field[0].Bpk_uT) + ' µT at peak current' : '–'], ['Telecom noise (worst section)', Em.telecom.length ? fmt(Math.max.apply(null, Em.telecom.map(t => t.ep_mV)), 3) + ' mV' : '–']] });
    B.push({ t: 'h1', text: 'Method' }, { t: 'p', text: 'The running rails of all tracks are taken as bonded and modelled as a ladder of rail resistance (' + E.r_ret + ' Ω/km per track) and rail–earth conductance (' + M.g_track_S_km + ' S/km per track) every ' + M.dx + ' m. Each second the simulated train currents are injected at the train positions and the substation return currents drawn at the substations' + (num(M.R_tss_earth, null) !== null ? ', with the substation negative earthed through ' + M.R_tss_earth + ' Ω' : ', with floating substation negatives') + '. Touch voltage is taken equal to the rail potential, with the limits of EN 50122-1 for the exposure time. Stray current is the average current leaving the rails per metre of track (EN 50122-2). The static magnetic field is from the conductor rail current and the equal return current (Biot–Savart). Induced voltage in a parallel cable is 2πf·M′·L·I for the rectifier ripple harmonics, with psophometric weighting, screening and cable sensitivity.' });
    B.push({ t: 'h1', text: 'Input data' }, { t: 'kv', rows: [['Rail–earth conductance', M.g_track_S_km + ' S/km per track (limit ' + M.g_limit_S_km + ')'], ['Substation negative', num(M.R_tss_earth, null) !== null ? 'earthed, ' + M.R_tss_earth + ' Ω' : 'floating'],
      ['Conductor rail position', M.cond_y + ' m from track centre, ' + M.cond_z + ' m high'], ['Field points', M.field_d + ' m at ' + M.field_h + ' m height'], ['Telecom cable', M.cable_d + ' m from track centre, level ' + M.cable_z + ' m, screening ' + M.screening + ', sensitivity ' + M.sensitivity]] });
    B.push({ t: 'table', head: ['Exposure s'].concat((M.touch_limits || []).map(r => String(r[0]))), rows: [['Limit V'].concat((M.touch_limits || []).map(r => String(r[1])))] });
    B.push({ t: 'h1', text: 'Rail potential and touch voltage' });
    B.push(chartImage('line', { datasets: [pl('Highest', Em.x.map((x, j) => ({ x: x, y: Em.Umax[j] })), PC.acc), pl('Lowest', Em.x.map((x, j) => ({ x: x, y: Em.Umin[j] })), PC.up), pl('Highest 300 s average |U|', Em.x.map((x, j) => ({ x: x, y: Em.U300[j] })), PC.dn, { borderDash: [5, 3] }),
      pl('Limit ≤ 1 s', [{ x: Em.x[0], y: Lm.s1 }, { x: Em.x[Em.x.length - 1], y: Lm.s1 }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 }), pl('', [{ x: Em.x[0], y: -Lm.s1 }, { x: Em.x[Em.x.length - 1], y: -Lm.s1 }], PC.fail, { borderDash: [6, 4], borderWidth: 1.2 })] }, 'Chainage (m)', 'Rail potential (V)', { h: 380, vlines: tssV(), caption: 'Rail potential envelope along the line' }));
    B.push({ t: 'table', head: ['Exposure', 'Value V', 'Limit V', 'Result'], rows: [['≤ 1 s (instantaneous)', f0(Em.max1), f0(Lm.s1), Em.max1 <= Lm.s1 ? 'PASS' : 'FAIL'], ['300 s average', f0(Em.max300), f0(Lm.s300), Em.max300 <= Lm.s300 ? 'PASS' : 'FAIL'], ['Long term', f0(Em.maxMean), f0(Lm.long), Em.maxMean <= Lm.long ? 'PASS' : 'FAIL'], ['Fault, ' + cfg.sc.t_clear_s + ' s', f0(Em.faultUrail), f0(Lm.fault), Em.faultUrail <= Lm.fault ? 'PASS' : 'FAIL']] });
    B.push({ t: 'h1', text: 'Stray current' }, { t: 'p', text: 'Average current leaving the rails ' + f1(Em.strayAvg_A) + ' A over ' + f0((R.extent[1] - R.extent[0]) * Em.nTracks) + ' m of track: ' + f2(Em.stray_mA_m) + ' mA/m against ' + M.stray_limit_mA_m + ' mA/m. Keep the rail–earth conductance below ' + M.g_limit_S_km + ' S/km per track by rail insulation and drainage design, and confirm by measurement.' });
    B.push({ t: 'h1', text: 'Static magnetic field' }, { t: 'table', head: ['Distance m', 'B at peak µT', 'B at 1-h RMS µT', 'Reference µT'], rows: Em.field.map(f => [String(f.d), f1(f.Bpk_uT), f1(f.Brms_uT), f0(num(M.B_limit_mT, 0.5) * 1000)]) });
    B.push({ t: 'h1', text: 'Inductive interference to telecom cables' }, { t: 'p', text: 'Mutual inductance between the traction loop and the cable ' + fmt(Em.Mprime_uH_m, 3) + ' µH/m, parallel length = feeding section of each substation.' });
    B.push({ t: 'table', head: ['Section', 'Length m', 'f Hz', 'Ripple A', 'emf mV', 'Weight', 'Noise mV'], rows: [].concat.apply([], Em.telecom.map(t => t.E.map((e, k) => [k ? '' : t.tss, k ? '' : f0(t.Lpar), f0(e.f), f2(e.I), f1(e.E_mV), f2(e.w), k ? '' : fmt(t.ep_mV, 3)]))) });
    B.push({ t: 'h1', text: 'Compliance checks' }, checkTable(groups));
  }
  B.push({ t: 'h1', text: 'Assumptions and limitations' });
  for (const p of ['Results are planning-level values from the inputs listed; confirm with the supplier\'s final data and site measurement.', 'Trains are not slowed by low line voltage; their power is cut back but the timetable holds.', 'Fault currents rise with a first-order time constant; rectifier overshoot, arc resistance and breaker dynamics are not modelled.', 'Harmonics assume no background distortion and no network resonance.', 'Touch voltage is taken equal to rail potential, without body or footwear resistance.', 'The Python edition (tps_model.py) runs the same calculation on the same inputs file.'])
    B.push({ t: 'bullet', text: p });
  rp.blocks = B.filter(Boolean);
  return rp;
}

/* ---------- PDF renderer ---------- */
function pdfText(s) {
  return String(s === null || s === undefined ? '' : s).replace(/Ω/g, 'ohm').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/√/g, 'sqrt').replace(/[−–—]/g, '-')
    .replace(/τ/g, 'tau').replace(/κ/g, 'kappa').replace(/γ/g, 'gamma').replace(/α/g, 'alpha').replace(/μ/g, 'mu').replace(/µ/g, 'u').replace(/²/g, '^2').replace(/³/g, '^3').replace(/→/g, '->').replace(/″/g, '"').replace(/′/g, "'").replace(/·/g, '·').replace(/[^\x00-\xFF‰]/g, '?');
}
async function reportToPDF(rp) {
  await loadLibs('pdf');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18, CW = W - 2 * M, BOT = 280;
  let y = M + 6, h1 = 0, h2 = 0;
  const need = (h) => { if (y + h > BOT) { doc.addPage(); y = M + 8; } };
  const text = (s, size, style, color, gap) => {
    doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || [28, 38, 49]);
    const lines = doc.splitTextToSize(pdfText(s), CW);
    for (const ln of lines) { need(size * 0.45); doc.text(ln, M, y); y += size * 0.45; }
    y += gap || 2;
  };
  for (const b of rp.blocks) {
    if (b.t === 'title') {
      doc.setFillColor(28, 38, 49); doc.rect(0, 0, W, 6, 'F');
      y = 30; text(b.title, 22, 'bold', [28, 38, 49], 3); text(b.sub, 13, 'normal', [77, 90, 103], 8);
      doc.autoTable({ startY: y, margin: { left: M, right: M }, body: b.meta.map(r => [pdfText(r[0]), pdfText(r[1])]), theme: 'grid', styles: { fontSize: 9.5, cellPadding: 2.2, lineColor: [28, 38, 49], lineWidth: 0.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [243, 244, 239] } } });
      y = doc.lastAutoTable.finalY + 8;
      doc.addPage(); y = M + 8;
    } else if (b.t === 'h1') { h1++; h2 = 0; need(16); y += 3; text(h1 + '  ' + b.text, 14, 'bold', [28, 38, 49], 1); doc.setDrawColor(177, 83, 27); doc.setLineWidth(0.5); doc.line(M, y - 1, M + CW, y - 1); y += 3; }
    else if (b.t === 'h2') { h2++; need(12); y += 1; text(h1 + '.' + h2 + '  ' + b.text, 11.5, 'bold', [28, 38, 49], 1.5); }
    else if (b.t === 'p') text(b.text, 10, 'normal', [40, 48, 56], 3);
    else if (b.t === 'bullet') { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 48, 56); const lines = doc.splitTextToSize(pdfText(b.text), CW - 5); need(lines.length * 4.6); doc.text('•', M + 1, y); doc.setTextColor(40, 48, 56); lines.forEach(l => { doc.text(l, M + 5, y); y += 4.5; }); y += 1; }
    else if (b.t === 'kv' || b.t === 'table') {
      const head = b.t === 'kv' ? null : [b.head.map(pdfText)];
      const body = b.t === 'kv' ? b.rows.map(r => [pdfText(r[0]), pdfText(r[1])]) : b.rows.map(r => r.map(pdfText));
      doc.autoTable({ startY: y, margin: { left: M, right: M, top: M + 8, bottom: 297 - BOT }, head: head || undefined, body: body, theme: b.t === 'kv' ? 'plain' : 'striped',
        styles: { fontSize: b.t === 'kv' ? 9.5 : (b.head.length > 9 ? 7.2 : 8.2), cellPadding: 1.6, textColor: [28, 38, 49], overflow: 'linebreak' },
        headStyles: { fillColor: [31, 58, 77], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 247, 243] },
        columnStyles: b.t === 'kv' ? { 0: { fontStyle: 'bold', cellWidth: 62, textColor: [77, 90, 103] } } : {},
        didParseCell: (d) => { if (d.section === 'body' && (d.cell.raw === 'FAIL')) { d.cell.styles.textColor = [179, 38, 30]; d.cell.styles.fontStyle = 'bold'; } if (d.section === 'body' && d.cell.raw === 'PASS') { d.cell.styles.textColor = [27, 116, 66]; d.cell.styles.fontStyle = 'bold'; } } });
      y = doc.lastAutoTable.finalY + 5;
    } else if (b.t === 'chart' && b.img) {
      const h = CW * b.h / b.w; need(h + 8);
      doc.addImage(b.img, 'PNG', M, y, CW, h, undefined, 'FAST'); y += h + 1;
      if (b.caption) text('Figure: ' + b.caption, 8.5, 'italic', [110, 118, 126], 4);
    }
  }
  const n = doc.internal.getNumberOfPages();
  for (let i = 2; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 118, 126);
    doc.text(pdfText(rp.docref + ' · ' + rp.title), M, 10); doc.text(pdfText(cfg.project.name).slice(0, 70), W - M, 10, { align: 'right' });
    doc.setDrawColor(207, 212, 203); doc.setLineWidth(0.2); doc.line(M, 12, W - M, 12); doc.line(M, 287, W - M, 287);
    doc.text('Page ' + i + ' of ' + n, W - M, 291, { align: 'right' }); doc.text(pdfText(R.engine + ' · scenario: ' + R.scenario), M, 291);
  }
  return doc.output('blob');
}

/* ---------- Word renderer ---------- */
function b64ToBytes(dataUrl) { const b = atob(dataUrl.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
async function reportToDOCX(rp) {
  await loadLibs('docx');
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ImageRun, Header, Footer, PageNumber, ShadingType, BorderStyle, PageBreak } = D;
  const kids = [];
  let h1 = 0, h2 = 0;
  const cellP = (txt, o) => new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun(Object.assign({ text: String(txt === null || txt === undefined ? '' : txt), size: o && o.size || 17, font: 'Calibri' }, o || {}))] });
  const mkTable = (head, rows, kv) => {
    const nc = Math.max.apply(null, (head ? [head] : []).concat(rows).map(r => r.length));
    const wt = [];
    for (let j = 0; j < nc; j++) { let m = head ? Math.min(String(head[j] || '').length, 12) : 4; for (const r of rows) m = Math.max(m, String(r[j] === undefined ? '' : r[j]).length); wt.push(Math.min(Math.max(m, 7), kv ? 60 : 40) + 2); }
    const tot = wt.reduce((a, v) => a + v, 0), TW = 9900;
    const cw = wt.map(v => Math.round(v / tot * TW));
    const trs = [];
    if (head) trs.push(new TableRow({ tableHeader: true, children: head.map((h, j) => new TableCell({ width: { size: cw[j], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: '1F3A4D' }, children: [cellP(h, { bold: true, color: 'FFFFFF' })] })) }));
    rows.forEach((r, i) => trs.push(new TableRow({ children: r.map((c, j) => new TableCell({ width: { size: cw[j] || 1000, type: WidthType.DXA }, shading: !kv && i % 2 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F5F0' } : undefined,
      children: [cellP(c, { bold: (kv && j === 0) || c === 'PASS' || c === 'FAIL', color: c === 'FAIL' ? 'B3261E' : c === 'PASS' ? '1B7442' : (kv && j === 0 ? '4D5A67' : '1C2631') })] })) })));
    return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: cw, layout: D.TableLayoutType.FIXED, rows: trs });
  };
  for (const b of rp.blocks) {
    if (b.t === 'title') {
      kids.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: b.title, bold: true, size: 48, font: 'Calibri', color: '1C2631' })] }));
      kids.push(new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: b.sub, size: 28, font: 'Calibri', color: '4D5A67' })] }));
      kids.push(mkTable(null, b.meta, true));
      kids.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (b.t === 'h1') { h1++; h2 = 0; kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text: h1 + '  ' + b.text, bold: true, size: 30, font: 'Calibri', color: '1C2631' })] })); }
    else if (b.t === 'h2') { h2++; kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: h1 + '.' + h2 + '  ' + b.text, bold: true, size: 24, font: 'Calibri', color: '1C2631' })] })); }
    else if (b.t === 'p') kids.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text, size: 21, font: 'Calibri' })] }));
    else if (b.t === 'bullet') kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b.text, size: 21, font: 'Calibri' })] }));
    else if (b.t === 'kv') { kids.push(mkTable(null, b.rows, true)); kids.push(new Paragraph({ text: '' })); }
    else if (b.t === 'table') { kids.push(mkTable(b.head, b.rows, false)); kids.push(new Paragraph({ text: '' })); }
    else if (b.t === 'chart' && b.img) {
      const w = 620, h = Math.round(w * b.h / b.w);
      kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: b64ToBytes(b.img), transformation: { width: w, height: h } })] }));
      if (b.caption) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: 'Figure: ' + b.caption, italics: true, size: 17, color: '6E767E', font: 'Calibri' })] }));
    }
  }
  const doc = new Document({
    creator: 'DC Traction Power Model', title: rp.title, description: rp.docref,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { color: 'CFD4CB', space: 4, style: BorderStyle.SINGLE, size: 6 } }, children: [new TextRun({ text: rp.docref + ' · ' + rp.title + ' · ' + cfg.project.name, size: 16, color: '6E767E', font: 'Calibri' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [R.engine + ' · ' + R.scenario + '   ·   Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: '6E767E', font: 'Calibri' })] })] }) },
      children: kids
    }]
  });
  return Packer.toBlob(doc);
}
