/* =====================================================================
   DC Traction Power Simulation engine  (TPS engine v1.0)
   ---------------------------------------------------------------------
   Shared by the HTML model (browser / Web Worker) and by Node.
   The Python file tps_engine.py is a line-by-line mirror of this file:
   same inputs (JSON), same algorithm, same result keys.

   Units used everywhere
     chainage / distance : m          speed      : km/h (inputs), m/s inside
     force               : kN         mass       : t   (kN / t = m/s2)
     power               : kW         energy     : kWh
     voltage             : V          current    : A    resistance : ohm
     gradient            : per mille (‰), + = rising with increasing chainage
   Direction: UP trains run with increasing chainage, DN with decreasing.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TPS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const G = 9.81;
  const VERSION = '1.0';

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  function num(v, d) { const x = Number(v); return (v === '' || v === null || v === undefined || !isFinite(x)) ? d : x; }
  function interp(tbl, x) {
    if (!tbl || !tbl.length) return 0;
    if (x <= tbl[0][0]) return +tbl[0][1];
    for (let i = 1; i < tbl.length; i++) {
      if (x <= tbl[i][0]) {
        const x0 = +tbl[i - 1][0], y0 = +tbl[i - 1][1], x1 = +tbl[i][0], y1 = +tbl[i][1];
        return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return +tbl[tbl.length - 1][1];
  }
  function cleanTable(t) {
    return (t || []).map(r => [Number(r[0]), Number(r[1])])
      .filter(r => isFinite(r[0]) && isFinite(r[1])).sort((a, b) => a[0] - b[0]);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ */
  /* default inputs (sample project, clearly marked as sample data)      */
  /* ------------------------------------------------------------------ */
  function defaults() {
    const stCh = [300, 1450, 2700, 3850, 5200, 6400, 7550, 8900, 10150, 11300, 12650, 13900, 15050, 16400, 17600, 18800];
    const stations = stCh.map((c, i) => ({ name: 'ST' + String(i + 1).padStart(2, '0'), ch: c, dwell: (i === 0 || i === stCh.length - 1) ? 40 : 30 }));
    return {
      version: VERSION,
      project: { name: 'Sample metro line (replace with project data)', system: '750 V DC third rail', ref: 'TPS-SIM-001', notes: '' },
      track_gen: { n_up: 1, n_down: 1 },
      tracks: [
        { name: 'UP1', dir: 'UP', headway: 180, offset: 0, train: 0, skip: '', enabled: true },
        { name: 'DN1', dir: 'DN', headway: 180, offset: 90, train: 0, skip: '', enabled: true }
      ],
      tss_gen: { count: 8, first_ch: 300, spacing: 2640, rect_kW: 3000, xfmr_kVA: 3300 },
      tss: [300, 2940, 5580, 8220, 10860, 13500, 16140, 18780].map((c, i) => ({
        name: 'TSS' + (i + 1), ch: c, rect_kW: 3000, xfmr_kVA: 3300, V0: '', Req_mohm: '', inv_kW: 0, in_service: true
      })),
      trains: [{
        name: '6-car metro (sample)', source: 'built-in sample', cars: 6, n_motors: 16, mass_t: 260, rot_factor: 0.08, length_m: 132,
        vmax: 80, acc: 1.0, dec: 1.0, aux_kW_car: 40,
        davis: { A: 3.5, B: 0.03, C: 0.0007 },
        te_basis: 'train',
        te_curve: [[0, 290], [10, 290], [20, 290], [30, 290], [36, 290], [40, 261], [50, 208.8], [60, 174], [70, 127.8], [80, 97.9], [90, 77.3]],
        be_curve: [[0, 0], [5, 0], [10, 290], [36, 290], [50, 240], [60, 210], [70, 180], [80, 155], [90, 140]],
        eff_curve: [[0, 0.75], [10, 0.82], [20, 0.86], [30, 0.88], [90, 0.88]],
        power_mode: 'efficiency', line_current: [],
        regen_eff_factor: 1.0, regen_max_kW: 3500,
        extra: []
      }],
      alignment: {
        source: 'built-in sample', start: 0, end: 19100, base_level: 215.0,
        stations: stations,
        gradients: [
          { from: 0, to: 900, g: 0 }, { from: 900, to: 1900, g: 12 }, { from: 1900, to: 3300, g: -8 }, { from: 3300, to: 4300, g: 25 },
          { from: 4300, to: 5600, g: 0 }, { from: 5600, to: 6900, g: -20 }, { from: 6900, to: 8300, g: 5 }, { from: 8300, to: 9600, g: 30 },
          { from: 9600, to: 10800, g: 0 }, { from: 10800, to: 12200, g: -30 }, { from: 12200, to: 13500, g: -6 }, { from: 13500, to: 14600, g: 15 },
          { from: 14600, to: 16000, g: 0 }, { from: 16000, to: 17100, g: -12 }, { from: 17100, to: 19100, g: 3 }
        ],
        curves: [
          { from: 650, to: 1050, R: 600 }, { from: 2050, to: 2400, R: 300 }, { from: 3150, to: 3500, R: 250 }, { from: 4550, to: 4900, R: 800 },
          { from: 5800, to: 6150, R: 180 }, { from: 7950, to: 8350, R: 450 }, { from: 9400, to: 9850, R: 1000 }, { from: 10600, to: 10950, R: 220 },
          { from: 12000, to: 12450, R: 500 }, { from: 13200, to: 13600, R: 350 }, { from: 14450, to: 14800, R: 160 }, { from: 16900, to: 17300, R: 700 }
        ],
        speed: [
          { from: 0, to: 300, up: 30, dn: 30 }, { from: 2050, to: 2400, up: 65, dn: 65 }, { from: 3150, to: 3500, up: 60, dn: 60 },
          { from: 5800, to: 6150, up: 45, dn: 45 }, { from: 10600, to: 10950, up: 55, dn: 55 }, { from: 14450, to: 14800, up: 45, dn: 45 },
          { from: 18800, to: 19100, up: 30, dn: 30 }
        ],
        elevations: [],
        curve_res: { k1: 650, c1: 55, k2: 500, c2: 30, R_split: 300 },
        auto_curve_speed: false, cant_plus_def_mm: 150, gauge_const: 11.82
      },
      electrical: {
        V_nom: 750, V0: 830, regulation_pct: 8.0,
        r_pos: 0.007, r_ret: 0.015, R_feeder: 0.003,
        V_regen_start: 900, V_regen_max: 950,
        V_cut_start: 600, V_cut_zero: 500,
        V_inv_on: 880, R_inv: 0.005,
        pf: 0.95, rect_eff: 0.985
      },
      limits: {
        V_min: 500, V_max: 1000, U_mean_useful: 675,
        conductor_A: 4000, feeder_A: 3000, breaker_trip_A: 8000, breaking_kA: 100, fault_margin: 1.0,
        normal: { h1: 1.0, m15: 1.5, m1: 3.0 },
        contingency: { h1: 1.5, m15: 1.5, m1: 3.0 }
      },
      sim: { period: 3600, dt: 1, dx: 5, bin_m: 100, fault_step: 100, R_fault: 0.001, iter_max: 40, tol_V: 0.05 },
      ac: { U_hv_kV: 33, S_sc_MVA: 500, XR: 10, c_max: 1.1, uk_pct: 7.0, pcu_pct: 1.0, pulse: 12, U_v: '', f: 50, L_smooth_mH: 0, source_from_ac: false },
      sc: { L_line_mH_km: 0.9, L_feeder_mH: 0.03, didt_setting_A_ms: 40, t_clear_s: 0.06 },
      harm: {
        residual_pct: 7.5, h_max: 49, pcc: 'separate', percentile: 95, thd_limit: 6.5, std_name: 'IEC 61000-3-6 MV planning levels',
        limits: [[5, 5], [7, 4], [11, 3], [13, 2.5], [17, 1.7], [19, 1.5], [23, 1.2], [25, 1.09], [29, 0.91], [31, 0.84], [35, 0.72], [37, 0.67], [41, 0.59], [43, 0.55], [47, 0.49], [49, 0.46]]
      },
      emc: {
        g_track_S_km: 0.1, g_limit_S_km: 0.5, dx: 100, R_tss_earth: '', stray_limit_mA_m: 2.5,
        touch_limits: [[0.02, 940], [0.05, 770], [0.1, 660], [0.2, 535], [0.3, 480], [0.4, 435], [0.5, 395], [0.6, 355], [0.7, 310], [0.8, 270], [0.9, 235], [1, 200], [300, 150], [3600, 120]],
        cond_y: 1.45, cond_z: 0.2, field_h: 1.0, field_d: '3, 5, 10, 20', B_limit_mT: 0.5,
        cable_d: 3.0, cable_z: -0.5, screening: 1.0, sensitivity: 0.001, psoph_limit_mV: '',
        psoph: [[300, 0.295], [600, 0.794], [900, 1.0], [1200, 1.0], [1500, 0.94], [1800, 0.861], [2400, 0.708], [3000, 0.596]],
        ripple_limits: []
      },
      scenarios: { extra: [] },
      extra_details: []
    };
  }

  /* ------------------------------------------------------------------ */
  /* generators for tracks and TSS                                       */
  /* ------------------------------------------------------------------ */
  function generateTracks(cfg) {
    const old = cfg.tracks || [];
    const out = [];
    const nu = Math.max(0, Math.round(num(cfg.track_gen.n_up, 1)));
    const nd = Math.max(0, Math.round(num(cfg.track_gen.n_down, 1)));
    const tmpl = (dir, i) => {
      const prev = old.find(t => t.name === dir + (i + 1));
      return prev ? prev : { name: dir + (i + 1), dir: dir, headway: 180, offset: dir === 'UP' ? i * 30 : 90 + i * 30, train: 0, skip: '', enabled: true };
    };
    for (let i = 0; i < nu; i++) out.push(tmpl('UP', i));
    for (let i = 0; i < nd; i++) out.push(tmpl('DN', i));
    cfg.tracks = out;
    return cfg;
  }
  function generateTSS(cfg) {
    const g = cfg.tss_gen;
    const n = Math.max(1, Math.round(num(g.count, 1)));
    const old = cfg.tss || [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = old[i] || {};
      out.push({
        name: p.name || ('TSS' + (i + 1)), ch: num(g.first_ch, 0) + i * num(g.spacing, 3000),
        rect_kW: num(g.rect_kW, p.rect_kW || 3000), xfmr_kVA: num(g.xfmr_kVA, p.xfmr_kVA || 3300),
        V0: p.V0 === undefined ? '' : p.V0, Req_mohm: p.Req_mohm === undefined ? '' : p.Req_mohm,
        inv_kW: num(p.inv_kW, 0), in_service: p.in_service === undefined ? true : p.in_service
      });
    }
    cfg.tss = out;
    return cfg;
  }

  /* ------------------------------------------------------------------ */
  /* alignment preparation                                               */
  /* ------------------------------------------------------------------ */
  function lineExtent(cfg) {
    const A = cfg.alignment;
    const st = A.stations.map(s => +s.ch);
    let a = (A.start === '' || A.start === null || A.start === undefined) ? Math.min.apply(null, st) - 200 : +A.start;
    let b = (A.end === '' || A.end === null || A.end === undefined) ? Math.max.apply(null, st) + 200 : +A.end;
    for (const t of cfg.tss) { a = Math.min(a, +t.ch); b = Math.max(b, +t.ch); }
    for (const s of st) { a = Math.min(a, s); b = Math.max(b, s); }
    return [a, b];
  }
  function curveRes(A, R) {   /* Röckl type formula, result in N/kN (= ‰ equivalent) */
    R = Math.abs(R);
    if (!R) return 0;
    const c = A.curve_res || { k1: 650, c1: 55, k2: 500, c2: 30, R_split: 300 };
    if (R >= c.R_split) return c.k1 / Math.max(R - c.c1, 1);
    return c.k2 / Math.max(R - c.c2, 10);
  }
  function gradeAt(A, x) {
    for (const s of A.gradients) if (x >= +s.from && x < +s.to) return +s.g;
    return 0;
  }
  function radiusAt(A, x) {
    for (const s of A.curves) if (x >= +s.from && x < +s.to) return +s.R;
    return 0;
  }
  function prepAlignment(cfg) {
    const A = cfg.alignment;
    const [x0, x1] = lineExtent(cfg);
    const dx = 1.0;
    const N = Math.max(1, Math.ceil(x1 - x0));
    const Cg = new Float64Array(N + 1), Cc = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      const xm = x0 + (i + 0.5) * dx;
      Cg[i + 1] = Cg[i] + gradeAt(A, xm) * dx;
      Cc[i + 1] = Cc[i] + curveRes(A, radiusAt(A, xm)) * dx;
    }
    return { x0, x1, dx, N, Cg, Cc };
  }
  function cumAt(P, C, x) {
    let u = (x - P.x0) / P.dx;
    if (u <= 0) return 0 + (u < 0 ? 0 : 0);
    if (u >= P.N) return C[P.N];
    const i = Math.floor(u);
    return C[i] + (C[i + 1] - C[i]) * (u - i);
  }
  function avgOver(P, C, xa, xb) {
    if (xb - xa < 1e-6) return (cumAt(P, C, xa + 0.5) - cumAt(P, C, xa - 0.5));
    return (cumAt(P, C, xb) - cumAt(P, C, xa)) / (xb - xa);
  }
  function elevationProfile(cfg, step) {
    const A = cfg.alignment, P = prepAlignment(cfg);
    step = step || 20;
    const xs = [], zs = [];
    if (A.elevations && A.elevations.length >= 2) {
      const tb = cleanTable(A.elevations.map(e => [e.ch, e.z]));
      for (let x = P.x0; x <= P.x1 + 1e-9; x += step) { xs.push(x); zs.push(interp(tb, x)); }
      return { x: xs, z: zs };
    }
    const base = num(A.base_level, 0);
    for (let x = P.x0; x <= P.x1 + 1e-9; x += step) { xs.push(x); zs.push(base + cumAt(P, P.Cg, x) / 1000); }
    return { x: xs, z: zs };
  }
  function speedLimitAt(cfg, L, vmax, x, dir) {
    /* L = train length (m): a restriction holds until the whole train has cleared it */
    const A = cfg.alignment;
    let v = vmax;
    const applies = (a, b) => dir > 0 ? (x > a && x < b + L) : (x > a - L && x < b);
    for (const s of A.speed) {
      const a = +s.from, b = +s.to;
      if (!applies(a, b)) continue;
      const lim = dir > 0 ? num(s.up, num(s.dn, v)) : num(s.dn, num(s.up, v));
      if (lim > 0) v = Math.min(v, lim);
    }
    if (A.auto_curve_speed) {
      for (const c of A.curves) {
        if (!applies(+c.from, +c.to)) continue;
        const vc = Math.sqrt(num(A.cant_plus_def_mm, 150) * Math.abs(+c.R) / num(A.gauge_const, 11.82));
        if (vc > 0) v = Math.min(v, vc);
      }
    }
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* train data                                                          */
  /* ------------------------------------------------------------------ */
  function trainModel(cfg, idx) {
    const T = cfg.trains[Math.min(Math.max(0, idx | 0), cfg.trains.length - 1)];
    const mult = T.te_basis === 'motor' ? Math.max(1, num(T.n_motors, 1)) : 1;
    const te = cleanTable(T.te_curve).map(r => [r[0], r[1] * mult]);
    let be = cleanTable(T.be_curve).map(r => [r[0], r[1] * mult]);
    const eff = cleanTable(T.eff_curve);
    const lc = cleanTable(T.line_current);
    const m = num(T.mass_t, 300);
    return {
      raw: T, m: m, Meff: m * (1 + num(T.rot_factor, 0.08)), L: num(T.length_m, 0),
      vmax: num(T.vmax, 80), acc: num(T.acc, 1.0), dec: num(T.dec, 1.0),
      aux: num(T.aux_kW_car, 0) * num(T.cars, 1),
      A: num(T.davis && T.davis.A, 0), B: num(T.davis && T.davis.B, 0), C: num(T.davis && T.davis.C, 0),
      te: te, be: be, eff: eff, lc: lc, mode: T.power_mode === 'line_current' && lc.length ? 'line_current' : 'efficiency',
      regenK: num(T.regen_eff_factor, 1.0), regenMax: num(T.regen_max_kW, 1e9)
    };
  }
  function effAt(tm, vk) { return tm.eff.length ? Math.min(1, Math.max(0.05, interp(tm.eff, vk))) : 0.85; }

  /* ------------------------------------------------------------------ */
  /* single train run (speed profile by forward / backward integration)  */
  /* ------------------------------------------------------------------ */
  function runTrain(cfg, P, tm, dir, stops, Vnom) {
    const A = cfg.alignment;
    const dx = Math.max(1, num(cfg.sim.dx, 5));
    const ds = dir > 0 ? 1 : -1;
    const segs = [];          /* [t0, dt, xa, xb, va, vb, Pkw, F] */
    const st = [];
    let t = 0, warn = '';
    let E_trac = 0, E_regen = 0, vpk = 0;
    const resist = (vms, xf) => {
      const vk = vms * 3.6;
      const xa = ds > 0 ? xf - tm.L : xf, xb = ds > 0 ? xf : xf + tm.L;
      const g = tm.L > 0 ? avgOver(P, P.Cg, xa, xb) : avgOver(P, P.Cg, xf, xf);
      const rc = tm.L > 0 ? avgOver(P, P.Cc, xa, xb) : avgOver(P, P.Cc, xf, xf);
      return tm.A + tm.B * vk + tm.C * vk * vk + tm.m * G * g / 1000 * ds + tm.m * G * rc / 1000;
    };
    for (let k = 0; k < stops.length; k++) {
      const s = stops[k];
      if (k === 0) { st.push({ name: s.name, ch: +s.ch, arr: 0, dep: 0 }); continue; }
      const a = +stops[k - 1].ch, b = +s.ch;
      const n = Math.max(1, Math.round(Math.abs(b - a) / dx));
      const h = Math.abs(b - a) / n;
      const xs = new Float64Array(n + 1), vl = new Float64Array(n + 1), vb = new Float64Array(n + 1), v = new Float64Array(n + 1);
      for (let j = 0; j <= n; j++) { xs[j] = a + ds * h * j; vl[j] = speedLimitAt(cfg, tm.L, tm.vmax, xs[j], ds) / 3.6; }
      vb[n] = 0;
      for (let j = n - 1; j >= 0; j--) vb[j] = Math.min(vl[j], Math.sqrt(vb[j + 1] * vb[j + 1] + 2 * tm.dec * h));
      vb[0] = 0; v[0] = 0;
      for (let j = 0; j < n; j++) {
        const R = resist(v[j], xs[j]);
        const Fm = Math.min(interp(tm.te, v[j] * 3.6), tm.Meff * tm.acc + R);
        const acc = (Fm - R) / tm.Meff;
        let vf = Math.sqrt(Math.max(0, v[j] * v[j] + 2 * acc * h));
        if (vf < 0.05 && v[j] < 0.05) { vf = 0.05; warn = 'Train cannot start on gradient near ch ' + Math.round(xs[j]) + ' m (tractive effort too low)'; }
        v[j + 1] = Math.min(vb[j + 1], vf);
      }
      for (let j = 0; j < n; j++) {
        const va = v[j], vbb = v[j + 1];
        const vavg = Math.max((va + vbb) / 2, 1e-3);
        const dt = h / vavg;
        const F = tm.Meff * (vbb * vbb - va * va) / (2 * h) + resist(va, xs[j]);
        const vk = vavg * 3.6;
        let Pm;
        if (F >= 0) {
          if (tm.mode === 'line_current') {
            const Fmax = Math.max(interp(tm.te, vk), 1e-6);
            Pm = Vnom * interp(tm.lc, vk) / 1000 * Math.min(1, F / Fmax);
          } else Pm = F * vavg / effAt(tm, vk);
          E_trac += Pm * dt / 3600;
        } else {
          const Fed = tm.be.length ? Math.min(-F, interp(tm.be, vk)) : -F;
          Pm = -Math.min(Fed * vavg * effAt(tm, vk) * tm.regenK, tm.regenMax);
          E_regen += -Pm * dt / 3600;
        }
        segs.push([t, dt, xs[j], xs[j + 1], va, vbb, Pm + tm.aux, F]);
        t += dt;
        vpk = Math.max(vpk, vbb);
      }
      const isLast = k === stops.length - 1;
      const dw = isLast ? 0 : num(s.dwell, 30);
      st.push({ name: s.name, ch: +s.ch, arr: t, dep: t + dw });
      if (dw > 0) { segs.push([t, dw, b, b, 0, 0, tm.aux, 0]); t += dw; }
    }
    /* resample at the simulation time step */
    const dts = num(cfg.sim.dt, 1);
    const ns = Math.floor(t / dts) + 1;
    const x = new Float64Array(ns), vv = new Float64Array(ns), Pw = new Float64Array(ns);
    let q = 0;
    for (let i = 0; i < ns; i++) {
      const ti = i * dts;
      while (q < segs.length - 1 && ti >= segs[q][0] + segs[q][1]) q++;
      const sg = segs[q];
      const f = sg[1] > 0 ? Math.min(1, Math.max(0, (ti - sg[0]) / sg[1])) : 0;
      x[i] = sg[2] + (sg[3] - sg[2]) * f;
      vv[i] = (sg[4] + (sg[5] - sg[4]) * f) * 3.6;
      Pw[i] = sg[6];
    }
    return {
      dir: ds > 0 ? 'UP' : 'DN', T: t, n: ns, x: x, v: vv, P: Pw, stations: st,
      E_trac_kWh: E_trac, E_regen_kWh: E_regen, E_aux_kWh: tm.aux * t / 3600, vmax_kmh: vpk * 3.6, warn: warn
    };
  }

  function stopsFor(cfg, track) {
    const skip = String(track.skip || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    let st = cfg.alignment.stations.filter(s => skip.indexOf(String(s.name).toUpperCase()) < 0).slice().sort((a, b) => a.ch - b.ch);
    if (track.dir === 'DN') st = st.reverse();
    return st;
  }

  /* ------------------------------------------------------------------ */
  /* banded linear solver (symmetric positive definite nodal matrix)    */
  /* ------------------------------------------------------------------ */
  function bandSolve(n, b, Ab, rhs) {
    const W = 2 * b + 1;
    for (let k = 0; k < n; k++) {
      const piv = Ab[k * W + b];
      const iMax = Math.min(n - 1, k + b);
      for (let i = k + 1; i <= iMax; i++) {
        const f = Ab[i * W + (k - i + b)] / piv;
        if (f === 0) continue;
        for (let j = k; j <= iMax; j++) Ab[i * W + (j - i + b)] -= f * Ab[k * W + (j - k + b)];
        rhs[i] -= f * rhs[k];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = rhs[i];
      const jMax = Math.min(n - 1, i + b);
      for (let j = i + 1; j <= jMax; j++) s -= Ab[i * W + (j - i + b)] * x[j];
      x[i] = s / Ab[i * W + b];
    }
    return x;
  }

  /* ------------------------------------------------------------------ */
  /* network builder (one time step)                                     */
  /* nodes: TSS buses, per track: ends, TSS tap points, train positions  */
  /* ------------------------------------------------------------------ */
  /* AC supply, transformer and rectifier data of one TSS (valve side quantities per bridge) */
  function acParams(cfg, t) {
    const A = cfg.ac || {}, E = cfg.electrical;
    const V0 = num(t.V0, num(E.V0, 830));
    const S = Math.max(num(t.xfmr_kVA, 3300), 1) * 1000;
    const nb = Math.max(1, Math.round(num(A.pulse, 12) / 6));
    const Uv = num(A.U_v, V0 / 1.35);
    const f = num(A.f, 50), w = 2 * Math.PI * f;
    const Sb = S / nb, Zb = Uv * Uv / Sb;
    const uk = num(A.uk_pct, 7) / 100, pcu = num(A.pcu_pct, 1) / 100;
    const Rtr = pcu * Zb, Xtr = Math.sqrt(Math.max(uk * uk - pcu * pcu, 0)) * Zb;
    const Ssc = Math.max(num(A.S_sc_MVA, 500), 1e-3) * 1e6, XR = Math.max(num(A.XR, 10), 0.01);
    const Zg = nb * Uv * Uv / Ssc;
    const Xg = Zg * XR / Math.sqrt(1 + XR * XR), Rg = Zg / Math.sqrt(1 + XR * XR);
    const Xc = Xtr + Xg, Rc = Rtr + Rg;
    const ReqAC = (3 * Xc / Math.PI + 2 * Rc) / nb;
    const Ldc = (2 * Xc / w) / nb + num(A.L_smooth_mH, 0) / 1000;
    const Uhv = num(A.U_hv_kV, 33) * 1000, c = num(A.c_max, 1.1);
    const kap = (r) => 1.02 + 0.98 * Math.exp(-3 * r);
    const IkHV = c * Ssc / (Math.sqrt(3) * Uhv);
    const IkLV = c * Uv / (Math.sqrt(3) * Math.hypot(Rc, Xc));
    return { V0, S, nb, Uv, f, w, Xtr, Rtr, Xg, Rg, Xc, Rc, ReqAC, Ldc, Uhv, Ssc, XR, XgHV: Uhv * Uhv / Ssc * XR / Math.sqrt(1 + XR * XR),
      IkHV, ipHV: kap(1 / XR) * Math.SQRT2 * IkHV, IkLV, ipLV: kap(Rc / Xc) * Math.SQRT2 * IkLV };
  }
  function tssParams(cfg) {
    const E = cfg.electrical;
    const fromAC = !!(cfg.ac && (cfg.ac.source_from_ac === true || cfg.ac.source_from_ac === 'true'));
    return cfg.tss.map(t => {
      const Ir = num(t.rect_kW, 3000) * 1000 / num(E.V_nom, 750);
      const V0 = num(t.V0, num(E.V0, 830));
      const ac = acParams(cfg, t);
      const ReqA = fromAC ? ac.ReqAC : num(E.regulation_pct, 6) / 100 * num(E.V_nom, 750) / Math.max(Ir, 1);
      const Req = t.Req_mohm === '' || t.Req_mohm === null || t.Req_mohm === undefined ? ReqA : num(t.Req_mohm, ReqA * 1000) / 1000;
      return { name: t.name, ch: +t.ch, V0: V0, Req: Math.max(Req, 1e-5), Ir: Ir, inv: num(t.inv_kW, 0), rect_kW: num(t.rect_kW, 0), xfmr_kVA: num(t.xfmr_kVA, 0), Ldc: Math.max(ac.Ldc, 1e-7), ac: ac };
    });
  }
  function buildNetwork(cfg, ext, tp, active, tracks, trainsOnTrack, fault) {
    const E = cfg.electrical;
    const rLoop = (num(E.r_pos, 0.007) + num(E.r_ret, 0.015)) / 1000;  /* ohm per m */
    const Rf = Math.max(num(E.R_feeder, 0.003), 1e-6);
    const nodes = [];   /* {x, kind:0 bus,1 end,2 tap,3 train,4 fault, k track, i index} */
    const busIdx = [];
    for (let i = 0; i < tp.length; i++) if (active[i]) { busIdx[i] = nodes.length; nodes.push({ x: tp[i].ch, kind: 0, k: -1, i: i }); }
    const edges = [];   /* [a, b, g, type, info]  type 0 track, 1 feeder */
    const tapNode = [];  /* tapNode[k][i] */
    const trainNode = [];
    for (let k = 0; k < tracks.length; k++) {
      const pts = [];
      pts.push({ x: ext[0], kind: 1, k: k, i: 0 });
      pts.push({ x: ext[1], kind: 1, k: k, i: 1 });
      for (let i = 0; i < tp.length; i++) pts.push({ x: tp[i].ch, kind: 2, k: k, i: i });
      const tl = trainsOnTrack[k] || [];
      for (let j = 0; j < tl.length; j++) pts.push({ x: tl[j].x, kind: 3, k: k, i: j });
      if (fault && fault.k === k) pts.push({ x: fault.x, kind: 4, k: k, i: 0 });
      pts.sort((p, q) => (p.x - q.x) || (p.kind - q.kind) || (p.i - q.i));
      tapNode[k] = []; trainNode[k] = [];
      let prev = -1;
      for (let m = 0; m < pts.length; m++) {
        const id = nodes.length; nodes.push(pts[m]);
        if (pts[m].kind === 2) tapNode[k][pts[m].i] = id;
        if (pts[m].kind === 3) trainNode[k][pts[m].i] = id;
        if (pts[m].kind === 4) fault.node = id;
        if (prev >= 0) {
          const len = Math.abs(pts[m].x - nodes[prev].x);
          edges.push([prev, id, 1 / Math.max(rLoop * len, 1e-6), 0, k]);
        }
        prev = id;
      }
      for (let i = 0; i < tp.length; i++) if (active[i]) edges.push([busIdx[i], tapNode[k][i], 1 / Rf, 1, k]);
    }
    /* order by chainage for a narrow band */
    const order = nodes.map((n, id) => id).sort((a, b) => (nodes[a].x - nodes[b].x) || (nodes[a].kind - nodes[b].kind) || (nodes[a].k - nodes[b].k) || (nodes[a].i - nodes[b].i));
    const pos = new Int32Array(nodes.length);
    order.forEach((id, p) => { pos[id] = p; });
    let bw = 1;
    for (const e of edges) bw = Math.max(bw, Math.abs(pos[e[0]] - pos[e[1]]));
    return { nodes, edges, busIdx, tapNode, trainNode, pos, bw, n: nodes.length };
  }
  function solveNet(net, diag, inj) {
    /* diag / inj indexed by node id; returns V by node id */
    const n = net.n, b = net.bw, W = 2 * b + 1;
    const Ab = new Float64Array(n * W), rhs = new Float64Array(n);
    const pos = net.pos;
    for (let id = 0; id < n; id++) { Ab[pos[id] * W + b] += diag[id] + 1e-6; rhs[pos[id]] += inj[id]; }
    for (const e of net.edges) {
      const p = pos[e[0]], q = pos[e[1]], g = e[2];
      Ab[p * W + b] += g; Ab[q * W + b] += g;
      Ab[p * W + (q - p + b)] -= g; Ab[q * W + (p - q + b)] -= g;
    }
    const xp = bandSolve(n, b, Ab, rhs);
    const V = new Float64Array(n);
    for (let id = 0; id < n; id++) V[id] = xp[pos[id]];
    return V;
  }

  /* ------------------------------------------------------------------ */
  /* rolling RMS helpers                                                 */
  /* ------------------------------------------------------------------ */
  function rmsStats(arr, dt) {
    const n = arr.length;
    const S = new Float64Array(n + 1);
    let pk = 0, sum = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(arr[i]); S[i + 1] = S[i] + a * a; pk = Math.max(pk, a); sum += arr[i]; }
    const win = (sec) => {
      const w = Math.max(1, Math.round(sec / dt));
      if (w >= n) return Math.sqrt(S[n] / Math.max(n, 1));
      let mx = 0;
      for (let i = 0; i + w <= n; i++) mx = Math.max(mx, S[i + w] - S[i]);
      return Math.sqrt(mx / w);
    };
    return { pk: pk, avg: sum / Math.max(n, 1), rms: Math.sqrt(S[n] / Math.max(n, 1)), r1h: win(3600), r15: win(900), r1: win(60) };
  }

  /* ------------------------------------------------------------------ */
  /* main time-step simulation                                           */
  /* ------------------------------------------------------------------ */
  function simulate(cfgIn, opts) {
    opts = opts || {};
    const cfg = clone(cfgIn);
    const outage = (opts.outage || []).map(String);
    const E = cfg.electrical, S = cfg.sim;
    const dt = num(S.dt, 1), period = num(S.period, 3600), nSteps = Math.max(1, Math.round(period / dt));
    const P = prepAlignment(cfg);
    const ext = [P.x0, P.x1];
    const tp = tssParams(cfg);
    const active = cfg.tss.map(t => t.in_service !== false && t.in_service !== 'false' && outage.indexOf(String(t.name)) < 0);
    const tracks = cfg.tracks.filter(t => t.enabled !== false);
    const Vnom = num(E.V_nom, 750);

    /* train runs */
    const runs = {}; const warns = [];
    const trackInfo = tracks.map((tr, k) => {
      const tm = trainModel(cfg, num(tr.train, 0));
      const dir = tr.dir === 'DN' ? -1 : 1;
      const stops = stopsFor(cfg, tr);
      const key = num(tr.train, 0) + '|' + tr.dir + '|' + stops.map(s => s.name).join(',');
      if (!runs[key]) {
        runs[key] = runTrain(cfg, P, tm, dir, stops, Vnom);
        runs[key].train = tm.raw.name; runs[key].key = key;
        if (runs[key].warn) warns.push(runs[key].warn);
      }
      const run = runs[key];
      const h = Math.max(1, num(tr.headway, 150)), off = num(tr.offset, 0);
      const deps = [];
      const iStart = Math.floor((-run.T - off) / h);
      for (let i = iStart; off + i * h < period; i++) { const t0 = off + i * h; if (t0 + run.T >= 0) deps.push(t0); }
      return { name: tr.name, dir: tr.dir, headway: h, key: key, deps: deps, tph: 3600 / h, trip: run.T, inService: Math.ceil(run.T / h) };
    });

    const nT = tp.length;
    const tssI = tp.map(() => new Float32Array(nSteps));
    const tssV = tp.map(() => new Float32Array(nSteps));
    const tssInv = tp.map(() => new Float32Array(nSteps));
    const feederI = tracks.map(() => tp.map(() => new Float32Array(nSteps)));
    const condL = tracks.map(() => tp.map(() => new Float32Array(nSteps)));
    const condR = tracks.map(() => tp.map(() => new Float32Array(nSteps)));
    const vTrainMin = new Float32Array(nSteps), vTrainMax = new Float32Array(nSteps), nTrains = new Int16Array(nSteps);
    const trOff = new Int32Array(nSteps + 1), trXa = [], trIa = [];
    const binM = num(S.bin_m, 100);
    const nBins = Math.max(1, Math.ceil((ext[1] - ext[0]) / binM));
    const envMin = tracks.map(() => new Float64Array(nBins).fill(1e9));
    const envMax = tracks.map(() => new Float64Array(nBins).fill(-1e9));
    const envSum = tracks.map(() => new Float64Array(nBins));
    const envCnt = tracks.map(() => new Float64Array(nBins));
    let vMin = 1e9, vMax = -1e9, vMinAt = null, vMaxAt = null;
    let uSum = 0, uCnt = 0;
    let E_tss = 0, E_inv = 0, E_loss = 0, E_rheo = 0, E_trainIn = 0, E_regenOut = 0;
    let itMaxUsed = 0, nonConv = 0;
    const Vprev = {};
    const blocked = new Uint8Array(nT);
    const invState = new Uint8Array(nT); /* 0 off, 1 on (voltage), 2 current limited */
    const Vr0 = num(E.V_regen_start, 900), Vr1 = num(E.V_regen_max, 950);
    const Vc0 = num(E.V_cut_start, 600), Vc1 = num(E.V_cut_zero, 500);
    const Vinv = num(E.V_inv_on, 880), Ginv = 1 / Math.max(num(E.R_inv, 0.005), 1e-5);
    const itMax = Math.max(5, num(S.iter_max, 40)), tol = num(S.tol_V, 0.05);
    const Rf = Math.max(num(E.R_feeder, 0.003), 1e-6);

    for (let s = 0; s < nSteps; s++) {
      const t = s * dt;
      const tot = tracks.map(() => []);
      for (let k = 0; k < tracks.length; k++) {
        const ti = trackInfo[k], run = runs[ti.key];
        for (let d = 0; d < ti.deps.length; d++) {
          const rel = t - ti.deps[d];
          if (rel < 0 || rel > run.T) continue;
          const q = Math.min(run.n - 1, Math.round(rel / dt));
          tot[k].push({ x: run.x[q], P: run.P[q], id: ti.name + '#' + d, v: run.v[q] });
        }
      }
      const net = buildNetwork(cfg, ext, tp, active, tracks, tot, null);
      const N = net.n;
      /* train list with node ids */
      const tl = [];
      for (let k = 0; k < tracks.length; k++) for (let j = 0; j < tot[k].length; j++) {
        const tr = tot[k][j];
        tl.push({ node: net.trainNode[k][j], P: tr.P, id: tr.id, k: k, x: tr.x, V: Vprev[tr.id] !== undefined ? Vprev[tr.id] : num(E.V0, 830) });
      }
      for (let i = 0; i < nT; i++) { blocked[i] = 0; invState[i] = 0; }
      let V = null, it = 0, conv = false;
      for (it = 0; it < itMax; it++) {
        const diag = new Float64Array(N), inj = new Float64Array(N);
        for (let i = 0; i < nT; i++) {
          if (!active[i]) continue;
          const bn = net.busIdx[i];
          if (!blocked[i]) { diag[bn] += 1 / tp[i].Req; inj[bn] += tp[i].V0 / tp[i].Req; }
          if (tp[i].inv > 0) {
            if (invState[i] === 1) { diag[bn] += Ginv; inj[bn] += Ginv * Vinv; }
            else if (invState[i] === 2) { inj[bn] -= tp[i].inv * 1000 / Vinv; }
          }
        }
        for (const tr of tl) {
          const Vt = Math.max(tr.V, 50);
          if (tr.P >= 0) {
            let f = 1;
            if (Vt <= Vc1) f = 0; else if (Vt < Vc0) f = (Vt - Vc1) / (Vc0 - Vc1);
            inj[tr.node] -= tr.P * 1000 * f / Vt;
          } else if (Vt < Vr0) {
            inj[tr.node] += -tr.P * 1000 / Vt;
          } else {
            const g = (-tr.P * 1000 / Vr0) / Math.max(Vr1 - Vr0, 1);
            diag[tr.node] += g; inj[tr.node] += g * Vr1;
          }
        }
        V = solveNet(net, diag, inj);
        /* state updates */
        let changed = false;
        for (let i = 0; i < nT; i++) {
          if (!active[i]) continue;
          const vb = V[net.busIdx[i]];
          if (!blocked[i] && vb > tp[i].V0 + 1e-6) { blocked[i] = 1; changed = true; }
          else if (blocked[i] && vb < tp[i].V0 - 1e-6) { blocked[i] = 0; changed = true; }
          if (tp[i].inv > 0) {
            const Imax = tp[i].inv * 1000 / Vinv;
            if (invState[i] === 0 && vb > Vinv + 1e-6) { invState[i] = 1; changed = true; }
            else if (invState[i] === 1) {
              const Ii = (vb - Vinv) * Ginv;
              if (Ii < 0) { invState[i] = 0; changed = true; } else if (Ii > Imax) { invState[i] = 2; changed = true; }
            } else if (invState[i] === 2 && vb < Vinv + Imax / Ginv - 1e-6) { invState[i] = 1; changed = true; }
          }
        }
        let dmax = 0;
        const w = it < 10 ? 1 : 0.5;
        for (const tr of tl) {
          const vn = V[tr.node];
          dmax = Math.max(dmax, Math.abs(vn - tr.V));
          tr.V = tr.V + w * (vn - tr.V);
        }
        if (!changed && dmax < tol) { conv = true; break; }
      }
      itMaxUsed = Math.max(itMaxUsed, it + 1);
      if (!conv) nonConv++;
      /* record results */
      for (let i = 0; i < nT; i++) {
        if (!active[i]) { tssV[i][s] = NaN; continue; }
        const vb = V[net.busIdx[i]];
        const Is = blocked[i] ? 0 : Math.max(0, (tp[i].V0 - vb) / tp[i].Req);
        let Ii = 0;
        if (invState[i] === 1) Ii = Math.max(0, (vb - Vinv) * Ginv); else if (invState[i] === 2) Ii = tp[i].inv * 1000 / Vinv;
        tssI[i][s] = Is; tssV[i][s] = vb; tssInv[i][s] = Ii;
        E_tss += vb * Is * dt / 3.6e6; E_inv += vb * Ii * dt / 3.6e6;
      }
      for (let k = 0; k < tracks.length; k++) {
        for (let i = 0; i < nT; i++) {
          const tn = net.tapNode[k][i];
          if (active[i]) feederI[k][i][s] = (V[net.busIdx[i]] - V[tn]) / Rf;
        }
      }
      /* conductor current either side of every TSS location */
      for (const e of net.edges) {
        const I = (V[e[0]] - V[e[1]]) * e[2];
        E_loss += I * I / e[2] * dt / 3.6e6;
        if (e[3] !== 0) continue;
        const na = net.nodes[e[0]], nb = net.nodes[e[1]], k = e[4];
        if (nb.kind === 2) condL[k][nb.i][s] = I;          /* edge arriving from the left of tap */
        if (na.kind === 2) condR[k][na.i][s] = I;          /* edge leaving to the right of tap  */
      }
      let mn = 1e9, mx = -1e9, cnt = 0;
      for (const tr of tl) {
        const v = V[tr.node];
        tr.V = v; Vprev[tr.id] = v;
        mn = Math.min(mn, v); mx = Math.max(mx, v); cnt++;
        if (v < vMin) { vMin = v; vMinAt = { t: t, x: tr.x, track: tracks[tr.k].name, train: tr.id }; }
        if (v > vMax) { vMax = v; vMaxAt = { t: t, x: tr.x, track: tracks[tr.k].name, train: tr.id }; }
        const bi = Math.min(nBins - 1, Math.max(0, Math.floor((tr.x - ext[0]) / binM)));
        envMin[tr.k][bi] = Math.min(envMin[tr.k][bi], v); envMax[tr.k][bi] = Math.max(envMax[tr.k][bi], v);
        envSum[tr.k][bi] += v; envCnt[tr.k][bi] += 1;
        /* actual train power with cut-back / regen limit */
        let Pa;
        if (tr.P >= 0) {
          let f = 1; const Vt = Math.max(v, 50);
          if (Vt <= Vc1) f = 0; else if (Vt < Vc0) f = (Vt - Vc1) / (Vc0 - Vc1);
          Pa = tr.P * f; E_trainIn += Pa * dt / 3600;
          if (tr.P > 0) { uSum += v; uCnt++; }
          trXa.push(tr.x); trIa.push(Pa * 1000 / Vt);
        } else {
          let Iinj;
          const Vt = Math.max(tr.V, 50);
          Iinj = (Vt < Vr0) ? -tr.P * 1000 / Vt : (-tr.P * 1000 / Vr0) * Math.max(0, Vr1 - v) / Math.max(Vr1 - Vr0, 1);
          Pa = -Iinj * v / 1000;
          trXa.push(tr.x); trIa.push(-Iinj);
          E_regenOut += -Pa * dt / 3600;
          E_rheo += Math.max(0, -tr.P + Pa) * dt / 3600;
        }
      }
      vTrainMin[s] = cnt ? mn : NaN; vTrainMax[s] = cnt ? mx : NaN; nTrains[s] = cnt;
      trOff[s + 1] = trXa.length;
    }

    /* ---------------- aggregation ---------------- */
    const pf = num(E.pf, 0.95), re = num(E.rect_eff, 0.985);
    const tssRes = tp.map((p, i) => {
      const st = rmsStats(tssI[i], dt);
      const Pk = new Float64Array(nSteps), Sk = new Float64Array(nSteps);
      let vmn = 1e9, vmx = -1e9, eK = 0, eInv = 0;
      for (let s = 0; s < nSteps; s++) {
        const vb = isNaN(tssV[i][s]) ? 0 : tssV[i][s];
        Pk[s] = vb * tssI[i][s] / 1000; Sk[s] = Pk[s] / (pf * re);
        if (active[i]) { vmn = Math.min(vmn, vb); vmx = Math.max(vmx, vb); }
        eK += Pk[s] * dt / 3600; eInv += vb * tssInv[i][s] / 1000 * dt / 3600;
      }
      const sp = rmsStats(Pk, dt), ss = rmsStats(Sk, dt);
      return {
        name: p.name, ch: p.ch, active: active[i], rect_kW: p.rect_kW, xfmr_kVA: p.xfmr_kVA, Ir: p.Ir, V0: p.V0, Req: p.Req, inv_kW: p.inv,
        Ipk: st.pk, Iavg: st.avg, Irms: st.rms, I1h: st.r1h, I15: st.r15, I1: st.r1,
        Pavg: sp.avg, Ppk: sp.pk, P1h: sp.r1h, S1h: ss.r1h, S15: ss.r15, S1: ss.r1, Spk: ss.pk,
        E_kWh: eK, Einv_kWh: eInv, Vmin: active[i] ? vmn : null, Vmax: active[i] ? vmx : null
      };
    });
    const cond = [], feed = [];
    for (let k = 0; k < tracks.length; k++) for (let i = 0; i < nT; i++) {
      const L = rmsStats(condL[k][i], dt), R = rmsStats(condR[k][i], dt);
      cond.push({ track: tracks[k].name, tss: tp[i].name, ch: tp[i].ch, side: 'left', Ipk: L.pk, Irms: L.rms, I1h: L.r1h, I15: L.r15 });
      cond.push({ track: tracks[k].name, tss: tp[i].name, ch: tp[i].ch, side: 'right', Ipk: R.pk, Irms: R.rms, I1h: R.r1h, I15: R.r15 });
      if (active[i]) { const F = rmsStats(feederI[k][i], dt); feed.push({ track: tracks[k].name, tss: tp[i].name, ch: tp[i].ch, Ipk: F.pk, Irms: F.rms, I1h: F.r1h, I15: F.r15 }); }
    }
    const env = tracks.map((tr, k) => {
      const xs = [], mn = [], mx = [], av = [];
      for (let b = 0; b < nBins; b++) if (envCnt[k][b] > 0) { xs.push(ext[0] + (b + 0.5) * binM); mn.push(envMin[k][b]); mx.push(envMax[k][b]); av.push(envSum[k][b] / envCnt[k][b]); }
      return { track: tr.name, x: xs, min: mn, max: mx, mean: av };
    });
    const res = {
      engine: 'TPS engine v' + VERSION,
      scenario: opts.name || (outage.length ? 'Outage: ' + outage.join(' + ') : 'Normal service'),
      outage: outage, contingency: outage.length > 0 || active.some(a => !a),
      period: period, dt: dt, extent: ext,
      tracks: trackInfo.map(t => ({ name: t.name, dir: t.dir, headway: t.headway, tph: t.tph, trip: t.trip, inService: t.inService, key: t.key, deps: t.deps })),
      runs: runs,
      tss: tssRes, conductor: cond, feeders: feed,
      trainV: { min: vMin < 1e9 ? vMin : null, max: vMax > -1e9 ? vMax : null, minAt: vMinAt, maxAt: vMaxAt, mean_useful: uCnt ? uSum / uCnt : null, envelope: env },
      energy: { tss_kWh: E_tss, inverter_kWh: E_inv, losses_kWh: E_loss, rheostat_kWh: E_rheo, train_in_kWh: E_trainIn, regen_out_kWh: E_regenOut },
      ts: { tssI: tssI, tssV: tssV, tssInv: tssInv, vTrainMin: vTrainMin, vTrainMax: vTrainMax, nTrains: nTrains,
        trOff: trOff, trX: Float32Array.from(trXa), trI: Float32Array.from(trIa) },
      solver: { iter_max_used: itMaxUsed, non_converged_steps: nonConv },
      warnings: warns
    };
    res.checks = checks(cfg, res);
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* DC short circuit scan (no trains): sustained current from the       */
  /* resistance network, initial rate of rise from the inductance        */
  /* network, first-order rise i(t) = Iss (1 - exp(-t/tau))              */
  /* ------------------------------------------------------------------ */
  function railParams(cfg, nTr) {
    const E = cfg.electrical, M = cfg.emc || {};
    const r = num(E.r_ret, 0.015) / 1000 / Math.max(nTr, 1);              /* ohm/m, all tracks bonded */
    const g = Math.max(num(M.g_track_S_km, 0.1), 1e-6) / 1000 * Math.max(nTr, 1); /* S/m */
    return { r: r, g: g, gamma: Math.sqrt(r * g), Zin: 0.5 * Math.sqrt(r / g) };
  }
  function faultScan(cfgIn, opts) {
    opts = opts || {};
    const cfg = clone(cfgIn);
    const outage = (opts.outage || []).map(String);
    const P = prepAlignment(cfg);
    const ext = [P.x0, P.x1];
    const tp = tssParams(cfg);
    const active = cfg.tss.map(t => t.in_service !== false && t.in_service !== 'false' && outage.indexOf(String(t.name)) < 0);
    const tracks = cfg.tracks.filter(t => t.enabled !== false);
    const step = Math.max(10, num(cfg.sim.fault_step, 100));
    const Rflt = Math.max(num(cfg.sim.R_fault, 0.001), 1e-5);
    const Rfd = Math.max(num(cfg.electrical.R_feeder, 0.003), 1e-6);
    const SC = cfg.sc || {};
    const Lp = Math.max(num(SC.L_line_mH_km, 0.9), 1e-6) / 1e6;     /* H per m */
    const Lfd = Math.max(num(SC.L_feeder_mH, 0.03), 1e-6) / 1000;
    const trip = num(cfg.limits.breaker_trip_A, 8000);
    const rail = railParams(cfg, tracks.length);
    const out = [];
    for (let k = 0; k < tracks.length; k++) {
      const xsSet = [];
      for (let x = ext[0]; x <= ext[1] + 1e-9; x += step) xsSet.push(+x.toFixed(3));
      tp.forEach(t => xsSet.push(t.ch));
      const xs = Array.from(new Set(xsSet)).sort((a, b) => a - b);
      const If = [], Inear = [], didt = [], didtF = [], tau = [], ttrip = [], Urail = [];
      for (const x of xs) {
        const fault = { k: k, x: x };
        const tot = tracks.map(() => []);
        const net = buildNetwork(cfg, ext, tp, active, tracks, tot, fault);
        const diag = new Float64Array(net.n), inj = new Float64Array(net.n);
        for (let i = 0; i < tp.length; i++) if (active[i]) { diag[net.busIdx[i]] += 1 / tp[i].Req; inj[net.busIdx[i]] += tp[i].V0 / tp[i].Req; }
        diag[fault.node] += 1 / Rflt;
        const V = solveNet(net, diag, inj);
        const Iss = V[fault.node] / Rflt;
        If.push(Iss);
        let mx = 0, mi = -1;
        for (let i = 0; i < tp.length; i++) if (active[i]) { const I = (V[net.busIdx[i]] - V[net.tapNode[k][i]]) / Rfd; if (I > mx) { mx = I; mi = i; } }
        Inear.push(mx);
        /* inductance network: same topology, 1/L instead of 1/R; node "voltages" give di/dt at t = 0 */
        const edgesL = net.edges.map(e => {
          if (e[3] === 0) { const len = Math.abs(net.nodes[e[0]].x - net.nodes[e[1]].x); return [e[0], e[1], 1 / Math.max(Lp * len, 1e-12), e[3], e[4]]; }
          return [e[0], e[1], 1 / Lfd, e[3], e[4]];
        });
        const netL = { nodes: net.nodes, edges: edgesL, pos: net.pos, bw: net.bw, n: net.n };
        const dL = new Float64Array(net.n), jL = new Float64Array(net.n);
        for (let i = 0; i < tp.length; i++) if (active[i]) { dL[net.busIdx[i]] += 1 / tp[i].Ldc; jL[net.busIdx[i]] += tp[i].V0 / tp[i].Ldc; }
        const Gf = 1e8;
        dL[fault.node] += Gf;
        const VL = solveNet(netL, dL, jL);
        const d0 = VL[fault.node] * Gf;                               /* A/s */
        const dF = mi >= 0 ? (VL[net.busIdx[mi]] - VL[net.tapNode[k][mi]]) / Lfd : 0;
        didt.push(d0 / 1000); didtF.push(dF / 1000);
        const tf = dF > 0 ? mx / dF : 0;                               /* s */
        tau.push(Iss > 0 && d0 > 0 ? Iss / d0 * 1000 : 0);
        ttrip.push(mx > trip && tf > 0 ? -tf * Math.log(1 - trip / mx) * 1000 : null);
        let dn = 1e12;
        for (let i = 0; i < tp.length; i++) if (active[i]) dn = Math.min(dn, Math.abs(tp[i].ch - x));
        Urail.push(Iss * rail.Zin * (1 - Math.exp(-rail.gamma * Math.min(dn, 1e7))));
      }
      const tt = ttrip.filter(v => v !== null);
      out.push({
        track: tracks[k].name, x: xs, If: If, Ifeeder: Inear, didt: didt, didtFeeder: didtF, tau_ms: tau, ttrip_ms: ttrip, Urail: Urail,
        max: Math.max.apply(null, If), min: Math.min.apply(null, If), minFeeder: Math.min.apply(null, Inear),
        minDidtFeeder: Math.min.apply(null, didtF), maxTtrip: tt.length ? Math.max.apply(null, tt) : null, notTripped: ttrip.length - tt.length,
        maxUrail: Math.max.apply(null, Urail)
      });
    }
    const tssAC = tp.map((t, i) => ({
      name: t.name, ch: t.ch, active: active[i], V0: t.V0, Req_mohm: t.Req * 1000, Ldc_mH: t.Ldc * 1000, IkD_kA: t.V0 / t.Req / 1000,
      didtD_A_ms: t.V0 / t.Ldc / 1000, tauD_ms: t.Ldc / t.Req * 1000,
      Uv: t.ac.Uv, nb: t.ac.nb, Xc_mohm: t.ac.Xc * 1000, IkHV_kA: t.ac.IkHV / 1000, ipHV_kA: t.ac.ipHV / 1000, IkLV_kA: t.ac.IkLV / 1000, ipLV_kA: t.ac.ipLV / 1000,
      ReqAC_mohm: t.ac.ReqAC * 1000
    }));
    return { tracks: out, tssAC: tssAC, rail: rail, scenario: outage.length ? 'Outage: ' + outage.join(' + ') : 'Normal service' };
  }

  /* ------------------------------------------------------------------ */
  /* rectifier harmonics (AC side) and DC ripple                         */
  /* ------------------------------------------------------------------ */
  function harmonicRatio(h, mu) {   /* I_h / I_1 for an uncontrolled bridge with overlap angle mu (rad) */
    if (mu < 1e-3) return 1 / h;
    const A = Math.sin((h - 1) * mu / 2) / (h - 1), B = Math.sin((h + 1) * mu / 2) / (h + 1);
    return Math.sqrt(Math.max(0, A * A + B * B - 2 * A * B * Math.cos(mu))) / (h * (1 - Math.cos(mu)));
  }
  function percentile(arr, p) {
    const a = Array.from(arr).filter(v => isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const k = (a.length - 1) * p / 100, i = Math.floor(k), f = k - i;
    return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[i];
  }
  function harmLimit(cfg, h) {
    const L = (cfg.harm && cfg.harm.limits) || [];
    for (const r of L) if (+r[0] === h) return +r[1];
    return null;
  }
  function sectionLength(tp, active, ext, i) {
    const xs = tp.filter((t, j) => active[j]).map(t => t.ch).sort((a, b) => a - b);
    const x = tp[i].ch, k = xs.indexOf(x);
    const left = k > 0 ? (x - xs[k - 1]) / 2 : x - ext[0];
    const right = k >= 0 && k < xs.length - 1 ? (xs[k + 1] - x) / 2 : ext[1] - x;
    return Math.max(left + right, 1);
  }
  function harmonics(cfgIn, r) {
    const cfg = clone(cfgIn);
    const H = cfg.harm || {}, A = cfg.ac || {};
    const tp = tssParams(cfg);
    const active = r.tss.map(t => t.active);
    const pulse = Math.max(6, Math.round(num(A.pulse, 12) / 6) * 6);
    const hmax = Math.max(5, Math.round(num(H.h_max, 49)));
    const resid = num(H.residual_pct, 7.5) / 100;
    const pct = num(H.percentile, 95);
    const orders = [];
    for (let k = 1; 6 * k - 1 <= hmax; k++) { orders.push(6 * k - 1); if (6 * k + 1 <= hmax) orders.push(6 * k + 1); }
    const isChar = h => (h - 1) % pulse === 0 || (h + 1) % pulse === 0;
    const kh = orders.map(h => isChar(h) ? 1 : resid);
    const n = r.ts.tssI[0] ? r.ts.tssI[0].length : 0;
    const Lp = Math.max(num((cfg.sc || {}).L_line_mH_km, 0.9), 1e-6) / 1e6;
    const spectrumAt = (ac, Id) => {
      const Idb = Id / ac.nb;
      const c = Math.min(1, Math.max(-1, 1 - Math.SQRT2 * ac.Xc * Idb / ac.Uv));
      const mu = Math.acos(c);
      const I1 = ac.nb * Math.sqrt(6) / Math.PI * Idb * ac.Uv / ac.Uhv;      /* HV fundamental, A */
      const Ih = orders.map((h, j) => I1 * harmonicRatio(h, mu) * kh[j]);
      const Vh = orders.map((h, j) => Ih[j] * h * ac.XgHV / (ac.Uhv / Math.sqrt(3)) * 100);
      return { mu: mu, I1: I1, Ih: Ih, Vh: Vh };
    };
    const out = [];
    const VhAll = [];   /* per active TSS: Float32Array per order */
    tp.forEach((t, i) => {
      if (!active[i]) { out.push({ name: t.name, ch: t.ch, active: false }); VhAll.push(null); return; }
      const ac = t.ac;
      const I = r.ts.tssI[i];
      const vh = orders.map(() => new Float32Array(n));
      const thdv = new Float32Array(n), thdi = new Float32Array(n);
      for (let s = 0; s < n; s++) {
        if (I[s] < 1) continue;
        const sp = spectrumAt(ac, I[s]);
        let sv = 0, si = 0;
        for (let j = 0; j < orders.length; j++) { vh[j][s] = sp.Vh[j]; sv += sp.Vh[j] * sp.Vh[j]; si += sp.Ih[j] * sp.Ih[j]; }
        thdv[s] = Math.sqrt(sv); thdi[s] = Math.sqrt(si) / sp.I1 * 100;
      }
      VhAll.push(vh);
      const rated = spectrumAt(ac, t.Ir);
      const peakI = r.tss[i].Ipk;
      const vh95 = vh.map(a => percentile(a, pct)), vhmax = vh.map(a => a.reduce((m, v) => Math.max(m, v), 0));
      /* DC side ripple: ideal p-pulse harmonics k*p, current into the feeding section loop inductance */
      const secLen = sectionLength(tp, active, r.extent, i);
      const Lloop = t.Ldc + Lp * secLen / 4;
      const dc = [];
      for (let k = 1; k <= 4; k++) {
        const nn = k * pulse, fn = nn * ac.f;
        const Vn = t.V0 * Math.SQRT2 / (nn * nn - 1);
        dc.push({ n: nn, f: fn, V: Vn, I: Vn / (2 * Math.PI * fn * Lloop) });
      }
      out.push({
        name: t.name, ch: t.ch, active: true, Uv: ac.Uv, nb: ac.nb, Xc: ac.Xc, Uhv: ac.Uhv, Ssc: ac.Ssc, XgHV: ac.XgHV,
        mu_rated_deg: rated.mu * 180 / Math.PI, I1_rated: rated.I1, Ih_rated: rated.Ih, Vh_rated: rated.Vh,
        Ipk: peakI, Vh95: vh95, Vhmax: vhmax, THDv95: percentile(thdv, pct), THDvmax: thdv.reduce((m, v) => Math.max(m, v), 0),
        THDi95: percentile(thdi.filter((v, s) => I[s] >= 1), pct), THDi_rated: Math.sqrt(rated.Ih.reduce((a, v) => a + v * v, 0)) / rated.I1 * 100,
        ts: { THDv: thdv }, dc: dc, secLen: secLen, Lloop: Lloop
      });
    });
    let common = null;
    if (H.pcc === 'common') {
      const alpha = h => h < 5 ? 1 : h <= 10 ? 1.4 : 2;
      const vh = orders.map(() => new Float32Array(n)), thdv = new Float32Array(n);
      for (let s = 0; s < n; s++) {
        let sv = 0;
        for (let j = 0; j < orders.length; j++) {
          const a = alpha(orders[j]); let sum = 0;
          for (const v of VhAll) if (v) sum += Math.pow(v[j][s], a);
          vh[j][s] = Math.pow(sum, 1 / a); sv += vh[j][s] * vh[j][s];
        }
        thdv[s] = Math.sqrt(sv);
      }
      common = { name: 'Common supply bus', Vh95: vh.map(a => percentile(a, pct)), Vhmax: vh.map(a => a.reduce((m, v) => Math.max(m, v), 0)), THDv95: percentile(thdv, pct), THDvmax: thdv.reduce((m, v) => Math.max(m, v), 0), ts: { THDv: thdv } };
    }
    return { orders: orders, characteristic: orders.map(isChar), limits: orders.map(h => harmLimit(cfg, h)), thd_limit: num(H.thd_limit, 6.5), percentile: pct, pulse: pulse, tss: out, common: common, std_name: H.std_name || '' };
  }

  /* ------------------------------------------------------------------ */
  /* EMC / EMI: rail potential, stray current, magnetic field, telecom   */
  /* ------------------------------------------------------------------ */
  function touchLimit(cfg, t) {
    const L = cleanTable(((cfg.emc || {}).touch_limits) || []);
    return L.length ? interp(L, t) : null;
  }
  function emc(cfgIn, r, flt, harm) {
    const cfg = clone(cfgIn);
    const M = cfg.emc || {};
    const tracks = cfg.tracks.filter(t => t.enabled !== false);
    const nTr = Math.max(tracks.length, 1);
    const rail = railParams(cfg, nTr);
    const ext = r.extent, Lline = Math.max(ext[1] - ext[0], 1);
    const n = Math.max(2, Math.floor(Lline / Math.max(10, num(M.dx, 100))) + 1);
    const dx = Lline / (n - 1);
    const xs = []; for (let j = 0; j < n; j++) xs.push(ext[0] + j * dx);
    const gs = rail.g * dx, gser = 1 / (rail.r * dx);
    const sh = new Float64Array(n);
    for (let j = 0; j < n; j++) sh[j] = (j === 0 || j === n - 1) ? gs / 2 : gs;
    const Rte = num(M.R_tss_earth, null);
    const tp = tssParams(cfg);
    const earthG = new Float64Array(n);
    if (Rte !== null && Rte > 0) for (let i = 0; i < tp.length; i++) if (r.tss[i].active) { const j = Math.min(n - 1, Math.max(0, Math.round((tp[i].ch - ext[0]) / dx))); earthG[j] += 1 / Rte; }
    /* tridiagonal factorisation (constant matrix) */
    const dg = new Float64Array(n), cp = new Float64Array(n);
    for (let j = 0; j < n; j++) dg[j] = sh[j] + earthG[j] + (j > 0 ? gser : 0) + (j < n - 1 ? gser : 0);
    const den = new Float64Array(n);
    den[0] = dg[0]; cp[0] = -gser / den[0];
    for (let j = 1; j < n; j++) { den[j] = dg[j] + gser * cp[j - 1]; cp[j] = j < n - 1 ? -gser / den[j] : 0; }
    const nS = r.ts.tssI[0] ? r.ts.tssI[0].length : 0;
    const U = new Float32Array(n * nS);
    const rhs = new Float64Array(n), y = new Float64Array(n);
    const addAt = (x, I) => {
      let u = (x - ext[0]) / dx; u = Math.min(n - 1, Math.max(0, u));
      const j = Math.min(n - 2, Math.floor(u)), f = u - j;
      rhs[j] += I * (1 - f); rhs[j + 1] += I * f;
    };
    let strayTot = 0;
    for (let s = 0; s < nS; s++) {
      rhs.fill(0);
      for (let q = r.ts.trOff[s]; q < r.ts.trOff[s + 1]; q++) addAt(r.ts.trX[q], r.ts.trI[q]);
      for (let i = 0; i < tp.length; i++) if (r.tss[i].active) addAt(tp[i].ch, -(r.ts.tssI[i][s] - r.ts.tssInv[i][s]));
      y[0] = rhs[0] / den[0];
      for (let j = 1; j < n; j++) y[j] = (rhs[j] + gser * y[j - 1]) / den[j];
      for (let j = n - 2; j >= 0; j--) y[j] = y[j] - cp[j] * y[j + 1];
      let out = 0;
      for (let j = 0; j < n; j++) { U[j * nS + s] = y[j]; const lk = sh[j] * y[j]; if (lk > 0) out += lk; }
      strayTot += out;
    }
    const dt = r.dt;
    const w300 = Math.max(1, Math.round(300 / dt));
    const Umax = [], Umin = [], U300 = [], Umean = [];
    let max1 = 0, max300 = 0, maxMean = 0, at1 = 0, at300 = 0;
    for (let j = 0; j < n; j++) {
      let mx = -1e9, mn = 1e9, sum = 0;
      const S = new Float64Array(nS + 1);
      for (let s = 0; s < nS; s++) { const u = U[j * nS + s]; mx = Math.max(mx, u); mn = Math.min(mn, u); S[s + 1] = S[s] + Math.abs(u); }
      let w = 0;
      if (w300 >= nS) w = S[nS] / Math.max(nS, 1);
      else for (let s = 0; s + w300 <= nS; s++) w = Math.max(w, (S[s + w300] - S[s]) / w300);
      const mean = S[nS] / Math.max(nS, 1);
      Umax.push(mx); Umin.push(mn); U300.push(w); Umean.push(mean);
      const a1 = Math.max(Math.abs(mx), Math.abs(mn));
      if (a1 > max1) { max1 = a1; at1 = xs[j]; }
      if (w > max300) { max300 = w; at300 = xs[j]; }
      maxMean = Math.max(maxMean, mean);
    }
    const strayAvg = nS ? strayTot / nS : 0;
    const stray_mA_m = strayAvg / (Lline * nTr) * 1000;
    /* static magnetic field: conductor rail (cond_y, cond_z) carrying I, return rails at (0, 0) carrying -I */
    const cy = num(M.cond_y, 1.45), cz = num(M.cond_z, 0.2), fh = num(M.field_h, 1.0);
    const ds = String(M.field_d === undefined ? '3, 5, 10, 20' : M.field_d).split(/[,;\s]+/).map(Number).filter(v => isFinite(v) && v > 0);
    const Bat = (I, d) => {
      const comp = (y0, z0, Ii) => { const dy = d - y0, dz = fh - z0, r2 = dy * dy + dz * dz; const k = 2e-7 * Ii / r2; return [-k * dz, k * dy]; };
      const a = comp(cy, cz, I), b = comp(0, 0, -I);
      return Math.hypot(a[0] + b[0], a[1] + b[1]) * 1e6;   /* microtesla */
    };
    const Ipk = r.conductor.reduce((m, c) => Math.max(m, c.Ipk), 0), Irms = r.conductor.reduce((m, c) => Math.max(m, c.I1h), 0);
    const field = ds.map(d => ({ d: d, Bpk_uT: Bat(Ipk, d), Brms_uT: Bat(Irms, d) }));
    /* inductive coupling to a parallel cable at (cable_d, cable_z) */
    const kd = num(M.cable_d, 3), kz = num(M.cable_z, -0.5);
    const r1 = Math.hypot(kd - cy, kz - cz), r2 = Math.hypot(kd, kz);
    const Mp = 2e-7 * Math.abs(Math.log(r2 / Math.max(r1, 1e-3)));   /* H/m */
    const scr = num(M.screening, 1);
    const W = cleanTable(M.psoph || []);
    const telecom = (harm ? harm.tss : []).filter(t => t.active).map(t => {
      const E = t.dc.map(d => ({ f: d.f, I: d.I, E_mV: 2 * Math.PI * d.f * Mp * t.secLen * d.I * scr * 1000, w: W.length ? interp(W, d.f) : 1 }));
      const Ew = Math.sqrt(E.reduce((a, e) => a + Math.pow(e.w * e.E_mV, 2), 0));
      return { tss: t.name, Lpar: t.secLen, E: E, Ew_mV: Ew, ep_mV: Ew * num(M.sensitivity, 0.001) };
    });
    const ULIM = { s1: touchLimit(cfg, 1), s300: touchLimit(cfg, 300), long: touchLimit(cfg, Math.max(r.period, 3600)), fault: touchLimit(cfg, num((cfg.sc || {}).t_clear_s, 0.06)) };
    const decim = Math.max(1, Math.floor(nS / 600));
    const sampleTs = []; for (let s = 0; s < nS; s += decim) sampleTs.push(s);
    const jMax = Umax.reduce((b, v, j) => Math.max(Math.abs(Umax[j]), Math.abs(Umin[j])) > Math.max(Math.abs(Umax[b]), Math.abs(Umin[b])) ? j : b, 0);
    return {
      x: xs, Umax: Umax, Umin: Umin, U300: U300, Umean: Umean, max1: max1, at1: at1, max300: max300, at300: at300, maxMean: maxMean,
      worstNode: { x: xs[jMax], t: sampleTs.map(s => s * dt), U: sampleTs.map(s => U[jMax * nS + s]) },
      strayAvg_A: strayAvg, stray_mA_m: stray_mA_m, rail: rail, nTracks: nTr, g_track: num(M.g_track_S_km, 0.1),
      field: field, Ipk: Ipk, Irms: Irms, Mprime_uH_m: Mp * 1e6, telecom: telecom, limits: ULIM,
      faultUrail: flt ? Math.max.apply(null, flt.tracks.map(t => t.maxUrail)) : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* pass / fail checks                                                  */
  /* ------------------------------------------------------------------ */
  function checks(cfg, r, flt, harm, em) {
    const Lm = cfg.limits;
    const d = r.contingency ? Lm.contingency : Lm.normal;
    const rows = [];
    const add = (group, item, where, value, limit, unit, kind) => {
      if (value === null || value === undefined || !isFinite(value)) return;
      const ratio = kind === 'min' ? (limit / Math.max(value, 1e-9)) : (value / Math.max(limit, 1e-9));
      rows.push({ group, item, where, value, limit, unit, kind, ratio, pass: kind === 'min' ? value >= limit - 1e-9 : value <= limit + 1e-9 });
    };
    for (const t of r.tss) {
      if (!t.active) continue;
      add('Rectifier', '1-hour RMS current', t.name, t.I1h, t.Ir * num(d.h1, 1), 'A', 'max');
      add('Rectifier', '15-min RMS current', t.name, t.I15, t.Ir * num(d.m15, 1.5), 'A', 'max');
      add('Rectifier', '1-min RMS current', t.name, t.I1, t.Ir * num(d.m1, 3), 'A', 'max');
      add('Transformer', '1-hour RMS load', t.name, t.S1h, t.xfmr_kVA * num(d.h1, 1), 'kVA', 'max');
      add('Transformer', '15-min RMS load', t.name, t.S15, t.xfmr_kVA * num(d.m15, 1.5), 'kVA', 'max');
      add('Transformer', '1-min RMS load', t.name, t.S1, t.xfmr_kVA * num(d.m1, 3), 'kVA', 'max');
    }
    let worstF = null; for (const f of r.feeders) if (!worstF || f.I1h > worstF.I1h) worstF = f;
    if (worstF) add('Feeder', 'Worst feeder 1-hour RMS current (cable)', worstF.tss + ' / ' + worstF.track, worstF.I1h, num(Lm.feeder_A, 3000), 'A', 'max');
    let worstFp = null; for (const f of r.feeders) if (!worstFp || f.Ipk > worstFp.Ipk) worstFp = f;
    if (worstFp) add('Feeder', 'Peak feeder load current below breaker trip setting', worstFp.tss + ' / ' + worstFp.track, worstFp.Ipk, num(Lm.breaker_trip_A, 8000), 'A', 'max');
    let worstC = null; for (const c of r.conductor) if (!worstC || c.I1h > worstC.I1h) worstC = c;
    if (worstC) add('Conductor rail', 'Worst 1-hour RMS current', worstC.track + ' at ' + worstC.tss + ' (' + worstC.side + ')', worstC.I1h, num(Lm.conductor_A, 4000), 'A', 'max');
    if (r.trainV.min !== null) add('Train voltage', 'Minimum train voltage', r.trainV.minAt ? r.trainV.minAt.track + ' ch ' + Math.round(r.trainV.minAt.x) : '', r.trainV.min, num(Lm.V_min, 500), 'V', 'min');
    if (r.trainV.max !== null) add('Train voltage', 'Maximum train voltage', r.trainV.maxAt ? r.trainV.maxAt.track + ' ch ' + Math.round(r.trainV.maxAt.x) : '', r.trainV.max, num(Lm.V_max, 1000), 'V', 'max');
    if (!r.contingency && r.trainV.mean_useful !== null) add('Train voltage', 'Mean useful voltage (motoring trains)', 'whole line', r.trainV.mean_useful, num(Lm.U_mean_useful, 675), 'V', 'min');
    if (flt) {
      let mx = 0, mnF = 1e12, whereMn = '', whereMx = '';
      for (const t of flt.tracks) {
        if (t.max > mx * (1 + 1e-9)) { mx = t.max; whereMx = t.track; }
        if (t.minFeeder < mnF * (1 - 1e-9)) { mnF = t.minFeeder; whereMn = t.track; }
      }
      add('Short circuit', 'Maximum fault current vs breaking capacity', whereMx, mx / 1000, num(Lm.breaking_kA, 50), 'kA', 'max');
      add('Short circuit', 'Minimum feeder fault current vs trip setting × margin', whereMn, mnF, num(Lm.breaker_trip_A, 8000) * num(Lm.fault_margin, 1), 'A', 'min');
      if (flt.tracks.length && flt.tracks[0].didtFeeder) {
        let md = 1e12, wd = '';
        for (const t of flt.tracks) if (t.minDidtFeeder < md * (1 - 1e-9)) { md = t.minDidtFeeder; wd = t.track; }
        add('Short circuit', 'Minimum feeder di/dt at fault vs di/dt protection setting', wd, md, num((cfg.sc || {}).didt_setting_A_ms, 40), 'A/ms', 'min');
      }
    }
    if (harm) {
      const lim = num(harm.thd_limit, 6.5);
      const ents = harm.tss.filter(t => t.active).concat(harm.common ? [harm.common] : []);
      for (const t of ents) {
        add('Harmonics', 'Voltage THD at supply point (' + harm.percentile + ' % value)', t.name, t.THDv95, lim, '%', 'max');
        let wr = -1, wj = -1;
        harm.orders.forEach((h, j) => { const L = harm.limits[j]; if (L && t.Vh95[j] / L > wr) { wr = t.Vh95[j] / L; wj = j; } });
        if (wj >= 0) add('Harmonics', 'Worst individual harmonic voltage, h = ' + harm.orders[wj], t.name, t.Vh95[wj], harm.limits[wj], '%', 'max');
      }
    }
    if (em) {
      const M = cfg.emc || {};
      if (em.limits.s1 !== null) add('EMC', 'Rail potential, highest instantaneous (touch voltage ≤ 1 s)', 'ch ' + Math.round(em.at1), em.max1, em.limits.s1, 'V', 'max');
      if (em.limits.s300 !== null) add('EMC', 'Rail potential, highest 300 s average', 'ch ' + Math.round(em.at300), em.max300, em.limits.s300, 'V', 'max');
      if (em.limits.long !== null) add('EMC', 'Rail potential, highest whole-period average (long term)', 'whole line', em.maxMean, em.limits.long, 'V', 'max');
      if (em.faultUrail !== null && em.limits.fault !== null) add('EMC', 'Rail potential at a fault (touch voltage at clearing time)', 'worst fault location', em.faultUrail, em.limits.fault, 'V', 'max');
      add('EMC', 'Average stray current per metre of track', 'whole line', em.stray_mA_m, num(M.stray_limit_mA_m, 2.5), 'mA/m', 'max');
      add('EMC', 'Rail-to-earth conductance per track', 'design value', em.g_track, num(M.g_limit_S_km, 0.5), 'S/km', 'max');
      if (em.field.length) add('EMC', 'Static magnetic field at ' + em.field[0].d + ' m (peak current)', 'beside conductor rail', em.field[0].Bpk_uT / 1000, num(M.B_limit_mT, 0.5), 'mT', 'max');
      let wt = null; for (const t of em.telecom) if (!wt || t.ep_mV > wt.ep_mV) wt = t;
      if (wt && num(M.psoph_limit_mV, null) !== null) add('EMC', 'Psophometric noise voltage in parallel telecom circuit', wt.tss + ' section', wt.ep_mV, num(M.psoph_limit_mV, 1), 'mV', 'max');
      const RL = cleanTable(M.ripple_limits || []);
      if (RL.length && harm) for (const t of harm.tss) if (t.active) for (const d of t.dc) { const L = RL.find(q => Math.abs(q[0] - d.f) < 1); if (L) add('EMC', 'DC ripple current at ' + d.f + ' Hz', t.name, d.I, L[1], 'A', 'max'); }
    }
    rows.sort((a, b) => (a.pass - b.pass) || (b.ratio - a.ratio));
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* design check over all cases (normal + each single TSS outage)      */
  /* ------------------------------------------------------------------ */
  function scenarioList(cfg) {
    const list = [{ name: 'Normal service', outage: [] }];
    for (const t of cfg.tss) if (t.in_service !== false) list.push({ name: t.name + ' out', outage: [t.name] });
    for (const x of (cfg.scenarios && cfg.scenarios.extra) || []) {
      const o = String(x).split(/[+,;]+/).map(s => s.trim()).filter(Boolean);
      if (o.length) list.push({ name: o.join(' + ') + ' out', outage: o });
    }
    return list;
  }
  function studies(cfg, r, flt) {
    const harm = harmonics(cfg, r);
    const em = emc(cfg, r, flt, harm);
    return { harm: harm, emc: em, checks: checks(cfg, r, flt, harm, em) };
  }
  function summarize(cfg, r, flt, harm, em) {
    const ch = checks(cfg, r, flt, harm, em);
    const worst = (g) => ch.filter(c => c.group === g).reduce((m, c) => Math.max(m, c.ratio), 0);
    const fails = ch.filter(c => !c.pass);
    return {
      scenario: r.scenario, outage: r.outage, vmin: r.trainV.min, vmax: r.trainV.max,
      rect: worst('Rectifier'), xfmr: worst('Transformer'), cond: worst('Conductor rail'), feeder: worst('Feeder'),
      fault_min: flt ? Math.min.apply(null, flt.tracks.map(t => t.minFeeder)) : null,
      fault_max: flt ? Math.max.apply(null, flt.tracks.map(t => t.max)) : null,
      thd: harm ? harm.tss.filter(t => t.active).concat(harm.common ? [harm.common] : []).reduce((m, t) => Math.max(m, t.THDv95), 0) : null,
      urail: em ? em.max1 : null, stray: em ? em.stray_mA_m : null,
      E_kWh: r.energy.tss_kWh, nFail: fails.length, firstFail: fails.length ? fails[0].group + ' ' + fails[0].item + ' at ' + fails[0].where : '',
      checks: ch
    };
  }
  function designCheck(cfg, onProgress) {
    const list = scenarioList(cfg);
    const out = [];
    list.forEach((sc, i) => {
      const r = simulate(cfg, { outage: sc.outage, name: sc.name });
      const f = faultScan(cfg, { outage: sc.outage });
      const h = harmonics(cfg, r), e = emc(cfg, r, f, h);
      out.push(summarize(cfg, r, f, h, e));
      if (onProgress) onProgress(i + 1, list.length, sc.name);
    });
    return out;
  }

  return {
    VERSION, defaults, generateTracks, generateTSS, lineExtent, prepAlignment, elevationProfile, curveRes, speedLimitAt,
    trainModel, runTrain, stopsFor, simulate, faultScan, checks, acParams, tssParams, harmonics, harmonicRatio, emc, studies, touchLimit, railParams, percentile, scenarioList, summarize, designCheck, interp, cleanTable, num, clone, rmsStats
  };
});
