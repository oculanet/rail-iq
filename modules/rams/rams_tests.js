/* Rail-IQ RAMS — verification cases.
   Each case compares the engine with an independent result: a closed-form textbook
   expression or a brute-force enumeration of every up/down state of every unit. */
(function (root) {
  "use strict";
  const R = root.RAMS;

  function close(a, b, rel) {
    if (!isFinite(a) || !isFinite(b)) return a === b;
    const d = Math.abs(a - b), s = Math.max(Math.abs(a), Math.abs(b), 1e-300);
    return d / s <= rel;
  }

  // expand a list of items into units + a structure function for enumeration
  function expand(items) {
    const units = [], groups = [];
    items.forEach(it => {
      const idx = [];
      for (let j = 0; j < it.n; j++) { idx.push(units.length); units.push({ mtbf: it.mtbf, mttr: it.mttr }); }
      groups.push({ k: it.k, idx });
    });
    const up = st => groups.every(g => g.idx.reduce((a, i) => a + st[i], 0) >= g.k);
    return { units, up };
  }

  function run() {
    const out = [];
    const add = (group, name, expected, got, tol, how) =>
      out.push({ group, name, expected, got, pass: close(expected, got, tol), how });

    // 1 single unit
    {
      const u = R.derive(R.unit(1000, 10));
      add("Single unit", "Availability A = MTBF/(MTBF+MTTR)", 1000 / 1010, u.A, 1e-12, "closed form");
      add("Single unit", "Mean up time = MTBF", 1000, u.MUT, 1e-12, "closed form");
      add("Single unit", "Mean down time = MTTR", 10, u.MDT, 1e-12, "closed form");
    }
    // 2 series of three different units
    {
      const s = R.derive(R.series([R.unit(1000, 10), R.unit(2000, 5), R.unit(5000, 20)]));
      const A = (1000 / 1010) * (2000 / 2005) * (5000 / 5020);
      add("Series", "A = product of A_i", A, s.A, 1e-12, "closed form");
      add("Series", "Mean up time = 1 / sum(1/MTBF_i)", 1 / (1 / 1000 + 1 / 2000 + 1 / 5000), s.MUT, 1e-12, "closed form");
    }
    // 3 1oo2, 2oo3 identical — closed form and enumeration
    {
      const a = 1000 / 1010, q = 1 - a;
      const p = R.derive(R.koon(1, 2, 1000, 10));
      add("1oo2 redundancy", "A = 1 - U^2", 1 - q * q, p.A, 1e-12, "closed form");
      const e = R.enumerate([{ mtbf: 1000, mttr: 10 }, { mtbf: 1000, mttr: 10 }], st => st[0] + st[1] >= 1);
      add("1oo2 redundancy", "Failure frequency f", e.f, p.f, 1e-10, "state enumeration");
      // two-state Markov with two repair crews: f = P(one up) * lam = 2 a q * lam
      add("1oo2 redundancy", "Mean up time (Markov, independent repair)", (1 - q * q) / (2 * a * q * 0.001), p.MUT, 1e-10, "Markov chain");
      const t = R.derive(R.koon(2, 3, 1000, 10));
      add("2oo3 voting", "A = 3a^2 - 2a^3", 3 * a * a - 2 * a * a * a, t.A, 1e-12, "closed form");
      const e3 = R.enumerate([0, 1, 2].map(() => ({ mtbf: 1000, mttr: 10 })), st => st[0] + st[1] + st[2] >= 2);
      add("2oo3 voting", "Failure frequency f", e3.f, t.f, 1e-10, "state enumeration");
    }
    // 4 mixed system vs full enumeration (9 units, 512 states)
    {
      const items = [
        { n: 2, k: 1, mtbf: 3000, mttr: 8 },
        { n: 3, k: 2, mtbf: 1500, mttr: 4 },
        { n: 1, k: 1, mtbf: 20000, mttr: 12 },
        { n: 3, k: 3, mtbf: 50000, mttr: 2 }
      ];
      const eng = R.derive(R.series(items.map(i => R.koon(i.k, i.n, i.mtbf, i.mttr))));
      const x = expand(items);
      const e = R.enumerate(x.units, x.up);
      add("Mixed system (9 units)", "System availability", e.A, eng.A, 1e-10, "state enumeration (512 states)");
      add("Mixed system (9 units)", "System failure frequency", e.f, eng.f, 1e-9, "state enumeration (512 states)");
      add("Mixed system (9 units)", "Mean up time", e.A / e.f, eng.MUT, 1e-9, "state enumeration");
      add("Mixed system (9 units)", "Mean down time", (1 - e.A) / e.f, eng.MDT, 1e-9, "state enumeration");
    }
    // 5 non-repairable 1oo2 MTTF = 1.5 MTBF  (integral of R(t))
    {
      const item = { n: 2, k: 1, mtbf: 1000 };
      let s = 0; const dt = 1, T = 30000;
      for (let t = 0; t < T; t += dt) s += 0.5 * (R.itemR(item, t) + R.itemR(item, t + dt)) * dt;
      add("Mission reliability", "1oo2 MTTF = 1.5 x MTBF (integral of R)", 1500, s, 1e-4, "closed form vs numerical integral");
      add("Mission reliability", "Single unit R(t) = exp(-t/MTBF)", Math.exp(-0.02), R.itemR({ n: 1, k: 1, mtbf: 1000 }, 20), 1e-12, "closed form");
    }
    // 6 allocation
    {
      const subs = [{ A: 0.999, f: 0.001 * 0.999 }, { A: 0.9995, f: 0.0004 * 0.9995 }, { A: 0.998, f: 0.003 * 0.998 }];
      const eq = R.allocate(subs, { availability: 99.9, mtbsaf: 500, allocation: "equal" });
      add("Allocation", "Equal: product of allocated A = target", 0.999, eq.rows.reduce((p, r) => p * r.A, 1), 1e-12, "identity");
      const ar = R.allocate(subs, { availability: 99.9, mtbsaf: 500, allocation: "arinc" });
      add("Allocation", "ARINC: product of allocated A = target", 0.999, ar.rows.reduce((p, r) => p * r.A, 1), 1e-12, "identity");
      add("Allocation", "ARINC: sum of allocated failure rates = 1 / target MTBSAF", 1 / 500, ar.rows.reduce((p, r) => p + 1 / r.MUT, 0), 1e-12, "identity");
      add("Allocation", "ARINC weight of subsystem 3 = 0.003 / 0.0044", 0.003 / 0.0044, ar.w[2], 1e-12, "closed form");
    }
    // 7 FMECA
    add("FMECA", "RPN = S x O x D (8,4,3)", 96, R.rpn({ S: 8, O: 4, D: 3 }), 0, "definition");
    return out;
  }

  root.RAMS_TESTS = { run };
})(typeof window !== "undefined" ? window : globalThis);
