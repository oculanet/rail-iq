/* Rail-IQ Tunnel Ventilation — verification cases.
   Each case compares the solver with an independent closed-form solution, or with a
   second, independent root finder. */
(function (root) {
  "use strict";
  const TV = root.TV, g = 9.81, CP = 1.005;

  function close(a, b, rel) {
    if (!isFinite(a) || !isFinite(b)) return a === b;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300) <= rel;
  }
  function base() {
    return {
      tunnel: { length: 1000, area: 20, perimeter: 16, height: 5, lambda: 0.02, zIn: 0.5, zOut: 1, zOther: 0, grade: 0 },
      air: { rho: 1.2, tempC: 20 },
      train: { length: 120, area: 8, perimeter: 12, lambda: 0.03 },
      jet: { installed: 6, thrust: 1000, vj: 30, eta: 0.8 },
      plantA: { installed: 2, qRated: 50, pRated: 500, p0: 700, shaftLoss: 0 },
      plantB: { installed: 2, qRated: 50, pRated: 500, p0: 700, shaftLoss: 0 },
      fire: { method: "kennedy", margin: 0, convective: 0.7, buoyancy: false, congestedMin: 0 }
    };
  }
  const sc0 = { train: false, hrr: 0, fireX: 400, jetRun: 0, plantARun: 0, plantBRun: 0, portal: 0 };

  function run() {
    const out = [];
    const add = (group, name, expected, got, tol, how) => out.push({ group, name, expected, got, pass: close(expected, got, tol), how });
    const m = base(), K = 0.02 * 1000 / 5 + 1.5, rho = 1.2;

    // 1 natural: portal pressure only
    {
      const r = TV.solve(m, { ...sc0, portal: 100 });
      add("Pressure balance", "Portal 100 Pa only: v = sqrt(2 dP / (rho K))", Math.sqrt(200 / (rho * K)), r.v, 1e-9, "closed form");
      add("Pressure balance", "Darcy loss at v = 5 m/s", K * rho / 2 * 25, TV.terms(m, sc0, 5).loss, 1e-12, "closed form");
    }
    // 2 jet fans only: (K rho/2) v^2 + (T'/vj) v - T' = 0
    {
      const Tp = 4 * 0.8 * 1000 / 20, a = K * rho / 2, b = Tp / 30;
      const v = (-b + Math.sqrt(b * b + 4 * a * Tp)) / (2 * a);
      add("Jet fans", "4 jet fans: velocity from quadratic", v, TV.solve(m, { ...sc0, jetRun: 4 }).v, 1e-9, "closed form");
    }
    // 3 end fan plant on its curve
    {
      const Q = Math.sqrt(700 / ((200 / 100 ** 2) + K * rho / (2 * 20 * 20)));
      add("Fan plant", "2 fans in parallel on the fan curve", Q / 20, TV.solve(m, { ...sc0, plantARun: 2 }).v, 1e-9, "closed form");
      const m2 = base(); m2.plantA.shaftLoss = 300;
      const Q2 = Math.sqrt(700 / ((200 / 100 ** 2) + 300 / 100 ** 2 + K * rho / (2 * 20 * 20)));
      add("Fan plant", "Same with 300 Pa shaft & damper loss", Q2 / 20, TV.solve(m2, { ...sc0, plantARun: 2 }).v, 1e-9, "closed form");
      const Q3 = Math.sqrt(1400 / (2 * 200 / 100 ** 2 + K * rho / (2 * 20 * 20)));
      add("Fan plant", "Push-pull, both plants 2 fans", Q3 / 20, TV.solve(m, { ...sc0, plantARun: 2, plantBRun: 2 }).v, 1e-9, "closed form");
    }
    // 4 stalled train
    {
      const m0 = base(); m0.train.area = 0; m0.train.perimeter = 0;
      add("Stalled train", "Zero-area train adds no loss", 0, TV.trainLoss(m0.tunnel, m0.train, 4, rho), 0, "identity");
      const Aa = 12, va = 4 * 20 / Aa, Da = 4 * Aa / 28, r = 1 - Aa / 20;
      const hand = rho / 2 * (va * va * (0.03 * 120 / Da + 0.5 * r + r * r) - 16 * 0.02 * 120 / 5);
      add("Stalled train", "Annulus loss at 4 m/s (hand calculation)", hand, TV.trainLoss(m.tunnel, m.train, 4, rho), 1e-12, "closed form");
    }
    // 5 full scenario: residual and second root finder (secant)
    {
      const mf = base(); mf.tunnel.grade = 2; mf.fire.buoyancy = true;
      const sc = { train: true, hrr: 20, fireX: 400, jetRun: 3, plantARun: 1, plantBRun: 2, portal: -20 };
      const r = TV.solve(mf, sc);
      add("Full scenario", "Pressure residual at solution (Pa)", 0, Math.abs(r.net) < 1e-6 ? 0 : r.net, 0, "residual < 1e-6 Pa");
      let x0 = 1, x1 = 3, f0 = TV.terms(mf, sc, x0).net, f1 = TV.terms(mf, sc, x1).net;
      for (let i = 0; i < 100 && Math.abs(f1) > 1e-12; i++) { const x2 = x1 - f1 * (x1 - x0) / (f1 - f0); x0 = x1; f0 = f1; x1 = x2; f1 = TV.terms(mf, sc, x1).net; }
      add("Full scenario", "Velocity: bisection vs secant method", x1, r.v, 1e-8, "independent root finder");
    }
    // 6 fire buoyancy on a gradient
    {
      const t = { ...base().tunnel, grade: 2 }, T0 = 293.15, v = 3;
      const Tf = T0 + 7000 / (1.2 * CP * 20 * v), rhof = 1.2 * T0 / Tf;
      add("Fire buoyancy", "10 MW, 2 % grade, 600 m hot length", (1.2 - rhof) * g * 0.02 * 600, TV.buoyancy(t, { hrr: 10, x: 400, convective: 0.7, buoyancy: true }, v, 1.2, T0), 1e-12, "closed form");
    }
    // 7 critical velocity
    {
      const Q = 20000, A = 20, H = 5, T0 = 293.15, Kg = 1 + 0.0374 * Math.pow(3, 0.8);
      add("Critical velocity", "Grade factor, 3 % downhill", Kg, TV.kennedy(20, A, H, rho, T0, 3).Kg, 1e-12, "closed form");
      // Kennedy as a cubic: T0 V^3 + (Q/(rho cp A)) V^2 - (Kg K)^3 g H Q/(rho cp A) = 0
      const c1 = Q / (rho * CP * A), c0 = Math.pow(0.61, 3) * g * H * Q / (rho * CP * A);
      let lo = 0, hi = 20; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; (T0 * mid ** 3 + c1 * mid ** 2 - c0 > 0) ? (hi = mid) : (lo = mid); }
      add("Critical velocity", "Kennedy 20 MW: fixed point vs cubic root", (lo + hi) / 2, TV.kennedy(20, A, H, rho, T0, 0).Vc, 1e-9, "cubic solved by bisection");
      const Qs = 5000 / (rho * CP * T0 * Math.sqrt(g) * Math.pow(H, 2.5));
      add("Critical velocity", "Li & Ingason 5 MW (Q* <= 0.15)", 0.81 * Math.cbrt(Qs) * Math.sqrt(g * H), TV.liIngason(5, H, rho, T0).Vc, 1e-12, "closed form");
      add("Critical velocity", "Li & Ingason 100 MW (Q* > 0.15)", 0.43 * Math.sqrt(g * H), TV.liIngason(100, H, rho, T0).Vc, 1e-12, "closed form");
    }
    // 8 sizing
    {
      const mf = base(); const sc = { train: true, hrr: 15, fireX: 400, jetRun: 0, plantARun: 0, plantBRun: 0, portal: 0 };
      const s = TV.sizing(mf, sc), n = s.jetMin;
      const ok = n != null && TV.evaluate(mf, { ...sc, jetRun: n }).pass && (n === 0 || !TV.evaluate(mf, { ...sc, jetRun: n - 1 }).pass);
      add("Fan sizing", "Minimum jet fans: n passes and n - 1 fails", 1, ok ? 1 : 0, 0, "definition");
    }
    return out;
  }
  root.TV_TESTS = { run };
})(typeof window !== "undefined" ? window : globalThis);
