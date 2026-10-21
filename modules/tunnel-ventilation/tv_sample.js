/* Rail-IQ Tunnel Ventilation — sample model.
   ILLUSTRATIVE VALUES ONLY: one bore of a generic single-track metro running tunnel
   between two stations, push-pull station fans plus jet fans. Replace with project data. */
window.TV_SAMPLE = function () {
  return {
    version: 1,
    project: { name: "Sample metro running tunnel (replace with project data)", system: "Single-track bored tunnel, station A to station B", docRef: "TVS-SIM-001" },
    tunnel: { length: 1500, area: 22.1, perimeter: 16.7, height: 5.3, lambda: 0.02, zIn: 0.5, zOut: 1.0, zOther: 0.3, grade: -2.0 },
    air: { rho: 1.16, tempC: 30 },
    train: { length: 140, area: 9.8, perimeter: 13.2, lambda: 0.03 },
    jet: { installed: 4, thrust: 1100, vj: 32, eta: 0.75 },
    plantA: { name: "Station A tunnel fans (supply)", installed: 2, qRated: 50, pRated: 450, p0: 600, shaftLoss: 500 },
    plantB: { name: "Station B tunnel fans (exhaust)", installed: 2, qRated: 50, pRated: 450, p0: 600, shaftLoss: 500 },
    fire: { method: "kennedy", margin: 10, convective: 0.7, buoyancy: true, congestedMin: 0 },
    scenarios: [
      { name: "Congested train, push-pull 1 + 1", train: true, hrr: 0, fireX: 750, jetRun: 0, plantARun: 1, plantBRun: 1, portal: 0, dir: 1 },
      { name: "Train fire 15 MW, all fans", train: true, hrr: 15, fireX: 750, jetRun: 4, plantARun: 2, plantBRun: 2, portal: 0, dir: 1 },
      { name: "Train fire 15 MW, one station A fan failed", train: true, hrr: 15, fireX: 750, jetRun: 4, plantARun: 1, plantBRun: 2, portal: 0, dir: 1 },
      { name: "Train fire 15 MW, station fans only", train: true, hrr: 15, fireX: 750, jetRun: 0, plantARun: 2, plantBRun: 2, portal: 0, dir: 1 },
      { name: "Train fire 15 MW, jet fans only, adverse wind 50 Pa", train: true, hrr: 15, fireX: 750, jetRun: 4, plantARun: 0, plantBRun: 0, portal: -50, dir: 1 }
    ],
    selected: 1
  };
};
