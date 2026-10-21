/*
 * Rail-IQ RAMS engine (Phase 1)
 * -----------------------------
 * Steady-state availability and failure frequency for a system made of
 * subsystems in series; each subsystem is a series of items; each item is
 * k-out-of-n identical, independently repaired units (active redundancy).
 *
 * Every block is reduced to (A, f):
 *   A  steady-state availability
 *   f  failure frequency  = transitions from up to down per operating hour
 * from which  MUT = A / f  (mean up time = equivalent MTBF while in service)
 *             MDT = (1 - A) / f  (mean down time = equivalent MTTR)
 *
 * Single unit       A = MTBF / (MTBF + MTTR),   f = A / MTBF
 * k-out-of-n        A = sum_{j=k..n} C(n,j) a^j u^(n-j)
 *                   f = n a lam * C(n-1,k-1) a^(k-1) u^(n-k)
 * series            A = prod A_i,  f = A * sum f_i / A_i
 * (frequency balancing for independent components — Billinton & Allan)
 *
 * Non-repairable reliability over a mission t: unit R = exp(-t / MTBF),
 * combined with the same k-out-of-n / series structure.
 */
(function (root) {
  "use strict";

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let c = 1;
    for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
    return c;
  }

  /** P(at least k of n identical independent units are up), unit probability p */
  function koonProb(k, n, p) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    const q = 1 - p;
    let s = 0;
    for (let j = k; j <= n; j++) s += comb(n, j) * Math.pow(p, j) * Math.pow(q, n - j);
    return Math.min(1, Math.max(0, s));
  }

  function unit(mtbf, mttr) {
    const lam = 1 / mtbf;
    const A = mtbf / (mtbf + mttr);
    return { A, f: A * lam, lam };
  }

  /** k-out-of-n identical repairable units */
  function koon(k, n, mtbf, mttr) {
    const u = unit(mtbf, mttr);
    const a = u.A, q = 1 - a;
    const A = koonProb(k, n, a);
    const f = k >= 1 && k <= n ? n * a * u.lam * comb(n - 1, k - 1) * Math.pow(a, k - 1) * Math.pow(q, n - k) : 0;
    return { A, f };
  }

  /** blocks in series: [{A, f}] */
  function series(blocks) {
    let A = 1, s = 0;
    for (const b of blocks) {
      A *= b.A;
      if (b.A > 0) s += b.f / b.A;
    }
    return { A, f: A * s };
  }

  function derive(b) {
    const out = { A: b.A, f: b.f, U: 1 - b.A };
    out.MUT = b.f > 0 ? b.A / b.f : Infinity;
    out.MDT = b.f > 0 ? (1 - b.A) / b.f : 0;
    return out;
  }

  /** reliability of an item over mission time t (non-repairable) */
  function itemR(item, t) {
    return koonProb(item.k, item.n, Math.exp(-t / item.mtbf));
  }

  /* ------------------------------------------------------------------ */
  /* full model                                                          */
  /* ------------------------------------------------------------------ */
  function opHours(project) {
    return Math.max(0, +project.hoursPerDay || 0) * Math.max(0, +project.daysPerYear || 0);
  }

  function validItem(it) {
    return it && +it.mtbf > 0 && +it.mttr >= 0 && +it.n >= 1 && +it.k >= 1 && +it.k <= +it.n;
  }

  function compute(model) {
    const H = opHours(model.project);
    const T = model.targets || {};
    const issues = [];
    const subs = [];
    let totalFailuresYr = 0;

    model.subsystems.forEach((ss, si) => {
      const items = [];
      ss.items.forEach((raw, ii) => {
        const it = { ...raw, n: Math.round(+raw.n), k: Math.round(+raw.k), mtbf: +raw.mtbf, mttr: +raw.mttr };
        if (!validItem(it)) {
          issues.push(`${ss.name || "Subsystem " + (si + 1)} / ${it.name || "item " + (ii + 1)}: check qty, required, MTBF and MTTR (need MTBF > 0, 1 ≤ k ≤ n).`);
          return;
        }
        const u = unit(it.mtbf, it.mttr);
        const blk = it.saf ? koon(it.k, it.n, it.mtbf, it.mttr) : { A: 1, f: 0 };
        const failuresYr = (it.n * H) / it.mtbf; // all failures, for maintenance
        totalFailuresYr += failuresYr;
        items.push({ ref: raw, sub: ss, name: it.name, n: it.n, k: it.k, mtbf: it.mtbf, mttr: it.mttr, saf: !!it.saf, unitA: u.A, ...derive(blk), failuresYr, block: blk });
      });
      const blk = series(items.filter(x => x.saf).map(x => x.block));
      subs.push({ ref: ss, name: ss.name, weight: +ss.weight || 0, items, block: blk, ...derive(blk) });
    });

    const sysBlk = series(subs.map(s => s.block));
    const sys = derive(sysBlk);
    sys.downMinYr = sys.U * H * 60;
    sys.safYr = sys.f * H;
    sys.totalFailuresYr = totalFailuresYr;
    sys.mission = +model.project.missionHours || 0;
    sys.Rmission = reliability(subs, sys.mission);

    // per-item and per-subsystem downtime and importance (improvement potential)
    let ipSum = 0;
    subs.forEach(s => {
      s.downMinYr = s.U * H * 60;
      s.safYr = s.f * H;
      s.items.forEach(it => {
        it.downMinYr = it.U * H * 60;
        it.safYr = it.f * H;
        it.IP = it.saf && it.A > 0 ? sys.A * (1 / it.A - 1) : 0;
        ipSum += it.IP;
      });
    });
    subs.forEach(s => s.items.forEach(it => (it.share = ipSum > 0 ? it.IP / ipSum : 0)));
    subs.forEach(s => (s.share = s.items.reduce((a, it) => a + it.share, 0)));

    const alloc = allocate(subs, T);
    subs.forEach((s, i) => {
      s.alloc = alloc.rows[i];
      s.passA = s.alloc.A == null ? null : s.A >= s.alloc.A - 1e-15;
      s.passM = s.alloc.MUT == null ? null : s.MUT >= s.alloc.MUT * (1 - 1e-12);
    });

    const targetA = T.availability != null && T.availability !== "" ? +T.availability / 100 : null;
    const targetM = T.mtbsaf != null && T.mtbsaf !== "" && +T.mtbsaf > 0 ? +T.mtbsaf : null;
    sys.passA = targetA == null ? null : sys.A >= targetA - 1e-15;
    sys.passM = targetM == null ? null : sys.MUT >= targetM;
    sys.targetA = targetA; sys.targetM = targetM;

    return { H, subs, sys, alloc, issues };
  }

  /** system reliability over mission t (non-repairable, SAF items only) */
  function reliability(subs, t) {
    let R = 1;
    subs.forEach(s => s.items.forEach(it => { if (it.saf) R *= itemR(it, t); }));
    return R;
  }

  /* ------------------------------------------------------------------ */
  /* allocation (series of subsystems)                                   */
  /*   equal     A_i = A_T^(1/n)                 MUT_i = n * MUT_T       */
  /*   arinc     w_i = lam_i / sum lam           A_i = A_T^(w_i)         */
  /*                                             MUT_i = MUT_T / w_i     */
  /*   weighted  w_i = user weight / sum weights (same as ARINC)         */
  /*   lam_i = f_i / A_i  (failure rate while in service)                */
  /* ------------------------------------------------------------------ */
  function allocate(subs, T) {
    const method = T.allocation || "arinc";
    const n = subs.length;
    const AT = T.availability != null && T.availability !== "" ? +T.availability / 100 : null;
    const MT = T.mtbsaf != null && T.mtbsaf !== "" && +T.mtbsaf > 0 ? +T.mtbsaf : null;
    let w;
    if (method === "equal") w = subs.map(() => 1 / n);
    else if (method === "weighted") {
      const sw = subs.reduce((a, s) => a + Math.max(0, s.weight || 0), 0);
      w = subs.map(s => (sw > 0 ? Math.max(0, s.weight || 0) / sw : 1 / n));
    } else {
      const lam = subs.map(s => (s.A > 0 ? s.f / s.A : 0));
      const sl = lam.reduce((a, b) => a + b, 0);
      w = lam.map(l => (sl > 0 ? l / sl : 1 / n));
    }
    const rows = w.map(wi => ({
      w: wi,
      A: AT == null ? null : Math.pow(AT, wi),
      MUT: MT == null || wi <= 0 ? null : MT / wi
    }));
    return { method, w, rows, AT, MT };
  }

  /* ------------------------------------------------------------------ */
  /* FMECA                                                               */
  /* ------------------------------------------------------------------ */
  function rpn(r) {
    const S = +r.S || 0, O = +r.O || 0, D = +r.D || 0;
    return S * O * D;
  }
  function fmecaAction(r, threshold) {
    return rpn(r) >= (+threshold || 100) || (+r.S || 0) >= 9;
  }

  /* ------------------------------------------------------------------ */
  /* independent check: brute-force state enumeration                    */
  /*   units: [{mtbf, mttr}], up(state[]) -> bool                        */
  /*   A = sum P(state) * up                                             */
  /*   f = sum_i [P(up | i up) - P(up | i down)] * a_i * lam_i           */
  /* ------------------------------------------------------------------ */
  function enumerate(units, up) {
    const m = units.length;
    const a = units.map(u => u.mtbf / (u.mtbf + u.mttr));
    const lam = units.map(u => 1 / u.mtbf);
    function prob(fixed) {
      let s = 0;
      const st = new Array(m);
      for (let mask = 0; mask < 1 << m; mask++) {
        let p = 1, ok = true;
        for (let i = 0; i < m; i++) {
          const b = (mask >> i) & 1;
          if (fixed && fixed[0] === i) { if (b !== fixed[1]) { ok = false; break; } st[i] = b; continue; }
          st[i] = b; p *= b ? a[i] : 1 - a[i];
        }
        if (ok && up(st)) s += p;
      }
      return s;
    }
    const A = prob(null);
    let f = 0;
    for (let i = 0; i < m; i++) f += (prob([i, 1]) - prob([i, 0])) * a[i] * lam[i];
    return { A, f };
  }

  const API = { comb, koonProb, unit, koon, series, derive, itemR, compute, allocate, reliability, rpn, fmecaAction, enumerate, opHours };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.RAMS = API;
})(typeof window !== "undefined" ? window : globalThis);
