/* Rail-IQ RAMS — sample model.
   ILLUSTRATIVE VALUES ONLY: a generic driverless APM line used to show how the module works.
   Replace with project data (Import Excel or edit the tables). */
window.RAMS_SAMPLE = function () {
  let id = 0;
  const it = (name, n, k, mtbf, mttr, saf, note) => ({ id: "i" + ++id, name, n, k, mtbf, mttr, saf: saf !== false, note: note || "" });
  return {
    version: 1,
    project: {
      name: "Sample APM line (replace with project data)",
      system: "Driverless APM · 3-car trains",
      docRef: "RAM-SIM-001",
      hoursPerDay: 20,
      daysPerYear: 365,
      missionHours: 20
    },
    targets: { availability: 99.9, mtbsaf: 300, allocation: "arinc", rpnThreshold: 100 },
    subsystems: [
      { id: "s1", name: "Power supply", weight: 2, items: [
        it("Traction substation (N-1)", 5, 4, 50000, 8),
        it("22 kV ring main unit", 2, 1, 100000, 6),
        it("Power rail section", 10, 10, 500000, 4),
        it("Power SCADA RTU", 1, 1, 40000, 2, false, "Not service affecting: local control available")
      ]},
      { id: "s2", name: "Signalling / ATC", weight: 3, items: [
        it("Zone controller (hot standby)", 2, 1, 60000, 1),
        it("Interlocking CPU (2oo2 x 2)", 2, 1, 80000, 2),
        it("Axle counter section", 40, 40, 150000, 2),
        it("Point machine", 12, 12, 100000, 1.5),
        it("Wayside signal / balise", 60, 60, 400000, 2)
      ]},
      { id: "s3", name: "Communications", weight: 1, items: [
        it("Backbone switch (ring)", 2, 1, 120000, 2),
        it("5.8 GHz wayside access point", 20, 19, 80000, 2, true, "Overlapping cells: one AP may be lost"),
        it("Onboard data radio (per train, 2 per train)", 16, 8, 60000, 6, false, "Redundant pair per train; counted under fleet"),
        it("CCTV camera", 120, 120, 50000, 4, false),
        it("PA / PIDS controller", 6, 6, 70000, 2, false)
      ]},
      { id: "s4", name: "Platform screen doors", weight: 1, items: [
        it("PSD door unit (one may be isolated)", 48, 47, 30000, 0.5),
        it("PSD controller", 6, 6, 60000, 2)
      ]},
      { id: "s5", name: "Rolling stock fleet", weight: 3, items: [
        it("Train in service (8 trains, 7 required)", 8, 7, 4000, 24, true, "MTBF per train for service-affecting failures"),
        it("Train door system (per train)", 8, 7, 9000, 12)
      ]}
    ],
    fmeca: [
      { id: "F1", item: "Zone controller", fn: "Movement authority", mode: "CPU failure", cause: "Hardware fault", local: "Switchover to standby", effect: "No service impact if switchover succeeds", S: 7, O: 3, D: 2, mitigation: "Hot standby, periodic switchover test", owner: "Signalling", status: "Closed" },
      { id: "F2", item: "Point machine", fn: "Move and lock points", mode: "Fails to lock", cause: "Obstruction / wear", local: "Point not detected", effect: "Route not set, service stops on branch", S: 8, O: 4, D: 3, mitigation: "Heaters, cleaning regime, detection alarm", owner: "Signalling", status: "Open" },
      { id: "F3", item: "PSD door unit", fn: "Platform edge protection", mode: "Door fails to open", cause: "Motor / controller fault", local: "One door unavailable", effect: "Door isolated, minor delay", S: 4, O: 6, D: 2, mitigation: "Isolation procedure, door-by-door bypass", owner: "PSD", status: "Open" },
      { id: "F4", item: "PSD door unit", fn: "Platform edge protection", mode: "Door fails to close", cause: "Obstruction", local: "Train cannot depart", effect: "Service delay until door secured", S: 7, O: 5, D: 3, mitigation: "Obstruction detection, staff response", owner: "PSD", status: "Open" },
      { id: "F5", item: "Traction substation", fn: "DC power to guideway", mode: "Rectifier trip", cause: "Overcurrent / cooling", local: "TSS out", effect: "Adjacent TSS feed (N-1), no service impact", S: 6, O: 3, D: 2, mitigation: "N-1 design, remote reset", owner: "Power", status: "Closed" },
      { id: "F6", item: "5.8 GHz wayside access point", fn: "Train-to-wayside data", mode: "Loss of radio", cause: "Power / hardware", local: "Coverage gap", effect: "Neighbour AP covers; CCTV stream gap", S: 5, O: 4, D: 4, mitigation: "Overlapping cells, NMS alarm", owner: "Comms", status: "Open" },
      { id: "F7", item: "Train in service", fn: "Carry passengers", mode: "Propulsion fault", cause: "Inverter fault", local: "Train stalls", effect: "Rescue, headway gap 10-20 min", S: 9, O: 4, D: 3, mitigation: "Redundant inverters per car, push-out procedure", owner: "Rolling stock", status: "Open" },
      { id: "F8", item: "Axle counter section", fn: "Train detection", mode: "Disturbed section", cause: "Head fault / EMI", local: "Section shows occupied", effect: "Trains held, manual reset", S: 8, O: 3, D: 4, mitigation: "Supervised reset procedure, EMC tests", owner: "Signalling", status: "Open" }
    ]
  };
};
