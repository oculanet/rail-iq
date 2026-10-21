/*
 * Rail-IQ Tunnel Ventilation engine (Phase 1)
 * -------------------------------------------
 * Steady, one-dimensional longitudinal ventilation of a single tunnel bore
 * between end A (chainage 0) and end B (chainage L). Positive velocity = A -> B.
 *
 * Pressure balance solved for the tunnel air velocity v:
 *   jet fans + end fan plants + portal pressure + fire buoyancy
 *     = tunnel friction + entry/exit/other losses + stalled-train annulus loss
 *
 *   tunnel loss     dP = (lam L / Dh + z_in + z_out + z_other) * rho/2 * v|v|
 *   train (extra)   dP = rho/2 [ va|va| (lam_a Lt/Da + Kc + Ke) - v|v| lam Lt/Dh ]
 *                   va = v A/Aa, Aa = A - At, Da = 4 Aa/(P + Pt), r = 1 - Aa/A,
 *                   Kc = 0.5 r (contraction), Ke = r^2 (Borda-Carnot expansion)
 *   jet fans        dP = n * eta * T / A * (1 - v / vj)
 *   fan plant       dP = P0 - (P0 - Pr) * x|x|,  x = Q / (n Qr)   (n fans in parallel)
 *   fire buoyancy   dP = (rho0 - rhof) g s Ld,  s = grade, Ld = hot length to the
 *                   downstream end, rhof = rho0 T0/Tf, Tf = T0 + Qc/(rho0 cp A |v|)
 *
 * Critical velocity
 *   Kennedy (NFPA 502 Annex D / NFPA 130):  Vc = Kg K (g H Q / (rho cp A Tf))^(1/3),
 *     Tf = Q/(rho cp A Vc) + T0,  K = 0.61,  Kg = 1 + 0.0374 |grade%|^0.8 when the
 *     smoke flows downhill, else 1.  Solved by fixed-point iteration.
 *   Li, Lei & Ingason (2010):  Q* = Q/(rho cp T0 g^0.5 H^2.5),
 *     V* = 0.81 Q*^(1/3) for Q* <= 0.15, else 0.43;  Vc = V* (g H)^0.5
 */
(function (root) {
  "use strict";
  const g = 9.81, CP = 1.005; // kJ/(kg K)

  const geom = t => ({ A: +t.area, P: +t.perimeter, Dh: (4 * +t.area) / +t.perimeter });
  const tunnelK = t => { const G = geom(t); return (+t.lambda * +t.length) / G.Dh + (+t.zIn || 0) + (+t.zOut || 0) + (+t.zOther || 0); };
  const sq = x => x * Math.abs(x);

  function trainLoss(t, tr, v, rho) {
    if (!tr || !(+tr.area > 0) || !(+tr.length > 0)) return 0;
    const G = geom(t), Aa = G.A - +tr.area;
    if (Aa <= 0) return Infinity;
    const va = (v * G.A) / Aa, Da = (4 * Aa) / (G.P + (+tr.perimeter || 0)), r = 1 - Aa / G.A;
    return (rho / 2) * (sq(va) * ((+tr.lambda * +tr.length) / Da + 0.5 * r + r * r) - sq(v) * ((+t.lambda * +tr.length) / G.Dh));
  }
  function jetFans(j, n, v, A) {
    if (!(n > 0) || !(+j.thrust > 0) || !(+j.vj > 0)) return 0;
    return (n * (+j.eta || 1) * +j.thrust) / A * (1 - v / +j.vj);
  }
  /** net pressure a fan plant adds to the tunnel: fan curve minus shaft & damper loss.
      shaftLoss (Pa) is the loss at the plant's full rated flow (installed fans x Qr). */
  function plant(p, n, Q) {
    if (!(n > 0) || !(+p.qRated > 0)) return 0;
    const x = Q / (n * +p.qRated);
    const qFull = Math.max(1, +p.installed || n) * +p.qRated;
    return +p.p0 - (+p.p0 - +p.pRated) * sq(x) - (+p.shaftLoss || 0) * sq(Q / qFull);
  }
  function fireTemp(fire, v, rho0, T0, A) {
    const Qc = (+fire.hrr || 0) * 1000 * (fire.convective == null ? 0.7 : +fire.convective); // kW
    if (Qc <= 0) return T0;
    const dT = Qc / (rho0 * CP * A * Math.max(Math.abs(v), 1e-6));
    return T0 + Math.min(dT, 1000); // bulk mean, capped
  }
  function buoyancy(t, fire, v, rho0, T0) {
    if (!fire || !fire.buoyancy || !(+fire.hrr > 0) || !+t.grade) return 0;
    const A = +t.area, Tf = fireTemp(fire, v, rho0, T0, A), rhof = (rho0 * T0) / Tf;
    const x = Math.min(Math.max(+fire.x || 0, 0), +t.length);
    const Ld = v >= 0 ? +t.length - x : x;
    return (rho0 - rhof) * g * (+t.grade / 100) * Ld;
  }

  /** all pressure terms at velocity v (Pa; sources positive A->B, losses positive resisting) */
  function terms(m, sc, v) {
    const t = m.tunnel, rho = +m.air.rho, T0 = +m.air.tempC + 273.15, A = +t.area, Q = v * A;
    const fire = { hrr: sc.hrr, x: sc.fireX, convective: m.fire.convective, buoyancy: m.fire.buoyancy };
    const s = {
      jet: jetFans(m.jet, +sc.jetRun, v, A),
      plantA: plant(m.plantA, +sc.plantARun, Q),
      plantB: plant(m.plantB, +sc.plantBRun, Q),
      portal: +sc.portal || 0,
      buoy: buoyancy(t, fire, v, rho, T0)
    };
    const G = geom(t);
    const l = {
      friction: (+t.lambda * +t.length) / G.Dh * (rho / 2) * sq(v),
      local: ((+t.zIn || 0) + (+t.zOut || 0) + (+t.zOther || 0)) * (rho / 2) * sq(v),
      train: sc.train ? trainLoss(t, m.train, v, rho) : 0
    };
    const src = s.jet + s.plantA + s.plantB + s.portal + s.buoy, loss = l.friction + l.local + l.train;
    return { s, l, src, loss, net: src - loss };
  }

  /** solve net(v) = 0 by bisection (net decreases with v) */
  function solve(m, sc) {
    const f = v => terms(m, sc, v).net;
    let lo = -60, hi = 60, flo = f(lo), fhi = f(hi), k = 0;
    while (flo < 0 && k++ < 8) { lo *= 2; flo = f(lo); }
    k = 0; while (fhi > 0 && k++ < 8) { hi *= 2; fhi = f(hi); }
    if (!(flo >= 0 && fhi <= 0)) return { ok: false, v: NaN };
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi), fm = f(mid);
      if (fm > 0) lo = mid; else hi = mid;
      if (hi - lo < 1e-11) break;
    }
    const v = 0.5 * (lo + hi);
    return { ok: true, v, ...terms(m, sc, v) };
  }

  /* ---------------- critical velocity ---------------- */
  function kennedy(hrrMW, A, H, rho, T0, gradeDown) {
    const Q = hrrMW * 1000; if (!(Q > 0)) return { Vc: 0, Tf: T0, Kg: 1 };
    const Kg = gradeDown > 0 ? 1 + 0.0374 * Math.pow(gradeDown, 0.8) : 1, K = 0.61;
    let V = 2, Tf = T0;
    for (let i = 0; i < 500; i++) {
      Tf = Q / (rho * CP * A * V) + T0;
      const Vn = Kg * K * Math.cbrt((g * H * Q) / (rho * CP * A * Tf));
      if (Math.abs(Vn - V) < 1e-13) { V = Vn; break; }
      V = Vn;
    }
    return { Vc: V, Tf: Q / (rho * CP * A * V) + T0, Kg };
  }
  function liIngason(hrrMW, H, rho, T0) {
    const Q = hrrMW * 1000; if (!(Q > 0)) return { Vc: 0, Qstar: 0 };
    const Qs = Q / (rho * CP * T0 * Math.sqrt(g) * Math.pow(H, 2.5));
    const Vs = Qs <= 0.15 ? 0.81 * Math.cbrt(Qs) : 0.43;
    return { Vc: Vs * Math.sqrt(g * H), Qstar: Qs };
  }
  /** critical velocity for a scenario; smoke direction from the sign of v */
  function critical(m, hrrMW, v) {
    const t = m.tunnel, rho = +m.air.rho, T0 = +m.air.tempC + 273.15;
    const gradeAlong = (v >= 0 ? 1 : -1) * (+t.grade || 0); // + = smoke goes uphill
    const ken = kennedy(hrrMW, +t.area, +t.height, rho, T0, gradeAlong < 0 ? -gradeAlong : 0);
    const li = liIngason(hrrMW, +t.height, rho, T0);
    const meth = m.fire.method || "kennedy";
    const Vc = meth === "li" ? li.Vc : meth === "max" ? Math.max(ken.Vc, li.Vc) : ken.Vc;
    return { Vc, ken, li };
  }

  /* ---------------- scenario evaluation ---------------- */
  function evaluate(m, sc) {
    const r = solve(m, sc);
    const out = { sc, ...r };
    if (!r.ok) { out.status = "error"; return out; }
    const A = +m.tunnel.area, rho = +m.air.rho, T0 = +m.air.tempC + 273.15;
    out.Q = r.v * A;
    out.qA = out.Q; // flow through each end plant (single bore, in series)
    if (+sc.hrr > 0) {
      const c = critical(m, +sc.hrr, r.v);
      out.Vc = c.Vc; out.ken = c.ken; out.li = c.li;
      out.req = c.Vc * (1 + (+m.fire.margin || 0) / 100);
      out.Tf = fireTemp({ hrr: sc.hrr, convective: m.fire.convective }, r.v, rho, T0, A) - 273.15;
      const dirOk = sc.dir == null || sc.dir === "" ? true : (+sc.dir >= 0 ? r.v > 0 : r.v < 0);
      out.margin = Math.abs(r.v) / out.req - 1;
      out.pass = dirOk && Math.abs(r.v) >= out.req;
      out.dirOk = dirOk;
    } else if (+m.fire.congestedMin > 0 && sc.train) {
      out.req = +m.fire.congestedMin;
      out.margin = Math.abs(r.v) / out.req - 1;
      out.pass = Math.abs(r.v) >= out.req;
    } else out.pass = null;
    // fan duty points
    out.dutyA = +sc.plantARun > 0 ? { q: out.Q / +sc.plantARun, p: r.s.plantA } : null;
    out.dutyB = +sc.plantBRun > 0 ? { q: out.Q / +sc.plantBRun, p: r.s.plantB } : null;
    return out;
  }

  /** velocity achieved and critical velocity across fire sizes (same fans) */
  function fireSweep(m, sc, maxMW, step) {
    const pts = [];
    let maxOk = null;
    for (let q = step; q <= maxMW + 1e-9; q += step) {
      const r = solve(m, { ...sc, hrr: q });
      const c = r.ok ? critical(m, q, r.v) : { Vc: NaN };
      const req = c.Vc * (1 + (+m.fire.margin || 0) / 100);
      const ok = r.ok && Math.abs(r.v) >= req && (sc.dir == null || sc.dir === "" || (+sc.dir >= 0 ? r.v > 0 : r.v < 0));
      pts.push({ q, v: r.v, Vc: c.Vc, req });
      if (ok) maxOk = q;
    }
    return { pts, maxOk };
  }

  /** minimum jet fans / plant fans to meet the requirement of a fire scenario */
  function sizing(m, sc) {
    const jets = [];
    const jmax = Math.max(12, (+m.jet.installed || 0) + 8);
    for (let n = 0; n <= jmax; n++) { const e = evaluate(m, { ...sc, jetRun: n }); jets.push({ n, v: e.v, pass: e.pass }); }
    const jetMin = jets.find(x => x.pass);
    const combos = [];
    const amax = Math.max(4, (+m.plantA.installed || 0) + 2), bmax = Math.max(4, (+m.plantB.installed || 0) + 2);
    for (let a = 0; a <= amax; a++) for (let b = 0; b <= bmax; b++) {
      const e = evaluate(m, { ...sc, plantARun: a, plantBRun: b });
      combos.push({ a, b, v: e.v, pass: e.pass });
    }
    const passing = combos.filter(c => c.pass).sort((x, y) => x.a + x.b - (y.a + y.b) || Math.abs(x.a - x.b) - Math.abs(y.a - y.b));
    return { jets, jetMin: jetMin ? jetMin.n : null, combos, plantMin: passing[0] || null };
  }

  const API = { g, CP, geom, tunnelK, trainLoss, jetFans, plant, fireTemp, buoyancy, terms, solve, kennedy, liIngason, critical, evaluate, fireSweep, sizing };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.TV = API;
})(typeof window !== "undefined" ? window : globalThis);
