/*
 * Rail-IQ module registry
 * -----------------------
 * Every simulator shown on the portal is one entry here. The home page, filters,
 * search, command palette and the workspace switcher are all built from this list,
 * so adding a new simulator = drop its folder in /modules and add one entry below.
 *
 * Fields
 *   id          unique slug, also used in workspace.html?m=<id>
 *   title       display name
 *   summary     one line for the card
 *   description longer text for the detail drawer
 *   domains     any of: metro, lrt, tram, apm, mainline, hsr, monorail
 *   discipline  key from RAILIQ_DISCIPLINES
 *   status      live | beta | planned
 *   entry       path to the module's HTML, relative to the site root (live/beta only)
 *   version     module revision shown on the card
 *   updated     ISO date of last update
 *   standards   reference standards covered
 *   features    bullet list for the detail drawer
 *   outputs     what the module produces
 *   resources   extra links [{label, href}] (relative to site root)
 */
window.RAILIQ_DOMAINS = {
  metro:    { label: "Metro",          color: "var(--l-metro)" },
  lrt:      { label: "LRT",            color: "var(--l-lrt)" },
  tram:     { label: "Tram",           color: "var(--l-tram)" },
  apm:      { label: "APM",            color: "var(--l-apm)" },
  mainline: { label: "Mainline",       color: "var(--l-main)" },
  hsr:      { label: "High-speed",     color: "var(--l-hsr)" },
  monorail: { label: "Monorail",       color: "var(--l-mono)" }
};

window.RAILIQ_DISCIPLINES = {
  power:     { label: "Traction Power",     icon: "bolt" },
  telecom:   { label: "Telecom & Radio",    icon: "antenna" },
  signalling:{ label: "Signalling & Control", icon: "signal" },
  operations:{ label: "Operations",         icon: "clock" },
  stations:  { label: "Stations & Tunnels", icon: "station" },
  assurance: { label: "Systems Assurance",  icon: "shield" },
  environment:{ label: "Environment",       icon: "wave" }
};

window.RAILIQ_CATALOG = [
  {
    id: "dc-traction-power",
    title: "DC Traction Power Model",
    summary: "Second-by-second DC load flow, TSS sizing, short circuit, harmonics and EMC on the real alignment.",
    description:
      "Runs every train on the real alignment, builds the timetable on any number of UP / DOWN tracks and solves the nodal DC network each second through every traction substation. Checks ratings against rolling RMS windows, scans short-circuit cases, evaluates rectifier harmonics and rail potential / stray current, and repeats the design check over every single-TSS outage. The HTML model and the Python model share one engine and give the same numbers.",
    domains: ["metro", "lrt", "tram", "apm", "monorail"],
    discipline: "power",
    status: "live",
    entry: "modules/dc-traction-power/TPS_Model.html",
    version: "2026.10",
    updated: "2026-10-20",
    standards: ["EN 50163", "EN 50122-1", "EN 50122-2", "IEC 60909", "IEC 61000-3-6"],
    features: [
      "Train run on a 5 m grid: braking curve, effort limits, Davis + gradient + curve resistance",
      "Timetable on any number of UP / DOWN tracks, skip-stop patterns, several train types",
      "Nodal load flow each second with diode TSS, inverters, regen limit and low-voltage cut-back",
      "Equipment sizing with next standard size, 1-min / 15-min / 1-h RMS duty checks",
      "Short circuit: sustained current, di/dt, time to trip, AC fault levels",
      "Harmonics vs IEC limits, rail potential, stray current, magnetic field, telecom noise",
      "Reads Word train data (tables, charts, graph images) and Excel alignment",
      "Design check over every single-TSS outage; Word / PDF / Excel reports"
    ],
    outputs: ["Line schematic", "Train graph", "TSS currents", "Voltage envelope", "Sizing table", "Pass / fail list", "Word + PDF reports", "Excel workbook"],
    resources: [
      { label: "Module README", href: "modules/dc-traction-power/README.md" },
      { label: "Alignment template (.xlsx)", href: "modules/dc-traction-power/samples/Alignment_Template.xlsx" },
      { label: "Train data template (.docx)", href: "modules/dc-traction-power/samples/Train_Data_Template.docx" },
      { label: "Python engine", href: "modules/dc-traction-power/python/tps_model.py" }
    ]
  },
  {
    id: "apm-onboard-telecom",
    title: "APM Onboard Telecom Layout",
    summary: "Interactive 3D vehicle with onboard telecom equipment, wayside bearers and CCTV coverage.",
    description:
      "A three-dimensional, three-car APM consist showing where every onboard telecom item sits and how the train talks to the wayside. Switch between exterior, cutaway, walk-inside and roof views; compare 5.8 GHz, private LTE and TETRA bearers with their coverage; overlay the signal flow and CCTV camera coverage while the train runs.",
    domains: ["apm"],
    discipline: "telecom",
    status: "live",
    entry: "modules/apm-onboard-telecom/index.html",
    version: "Rev 16",
    updated: "2026-09-23",
    standards: [],
    features: [
      "3D consist with exterior, cutaway, walk-inside and roof views",
      "Train-to-wayside bearers: 5.8 GHz, private LTE and TETRA with coverage",
      "Wayside coverage view with the train running at adjustable speed",
      "Signal-flow overlay between onboard systems",
      "CCTV camera coverage overlay",
      "Equipment by system: CCTV, PA, PIDS, network, radio, power, racks"
    ],
    outputs: ["3D layout", "Bearer coverage", "Signal flow", "CCTV coverage"],
    resources: []
  },

  /* ---------------- pipeline ---------------- */
  {
    id: "ac-traction-power",
    title: "AC 25 kV Traction Power",
    summary: "Autotransformer and booster-transformer feeding, neutral sections, unbalance at the grid.",
    description: "Load flow for 1×25 kV and 2×25 kV feeding with autotransformers, phase unbalance at the point of common coupling, neutral-section placement and feeder-station sizing for mainline and high-speed corridors.",
    domains: ["mainline", "hsr"],
    discipline: "power",
    status: "planned",
    standards: ["EN 50163", "EN 50388", "IEC 61000-3-13"],
    features: ["2×25 kV AT network solver", "Voltage unbalance at PCC", "Neutral-section and feeder-station layout"],
    outputs: ["Pantograph voltage", "Transformer loading", "Unbalance factor"]
  },
  {
    id: "train-performance",
    title: "Train Performance & Running Time",
    summary: "Run-time, energy and speed profile for any rolling stock on any alignment.",
    description: "Stand-alone running-time calculator built on the Rail-IQ train-run engine: flat-out and coasting strategies, energy per run, regenerated energy and sensitivity to dwell and speed limits.",
    domains: ["metro", "lrt", "tram", "apm", "mainline", "hsr", "monorail"],
    discipline: "operations",
    status: "planned",
    standards: ["EN 15528", "UIC 544-1"],
    features: ["Coasting / eco-driving strategies", "Energy per run and per passenger-km", "Dwell sensitivity"],
    outputs: ["Speed-distance", "Run-time table", "Energy breakdown"]
  },
  {
    id: "cbtc-headway",
    title: "CBTC Headway & Capacity",
    summary: "Safe-braking-model headway, turnback capacity and line throughput.",
    description: "Computes the minimum headway from the safe braking model, station dwell and turnback layout, and turns it into line capacity in trains and passengers per hour per direction.",
    domains: ["metro", "lrt", "apm", "monorail"],
    discipline: "signalling",
    status: "planned",
    standards: ["IEEE 1474.1", "IEC 62290"],
    features: ["Safe braking model", "Station and turnback headway", "PPHPD capacity"],
    outputs: ["Headway diagram", "Blocking times", "Capacity table"]
  },
  {
    id: "radio-coverage",
    title: "Radio Coverage & Link Budget",
    summary: "LTE / TETRA / Wi-Fi link budget and handover zones along the alignment.",
    description: "Link budget along the route for trackside radio — site spacing, tunnel leaky feeder, handover overlap and redundancy for train-to-ground communication.",
    domains: ["metro", "lrt", "tram", "apm", "mainline"],
    discipline: "telecom",
    status: "planned",
    standards: ["3GPP TS 36.101", "ETSI EN 300 392"],
    features: ["Free-space, tunnel and urban path loss", "Leaky-feeder budget", "Handover overlap check"],
    outputs: ["Coverage profile", "Site list", "Margin table"]
  },
  {
    id: "timetable-fleet",
    title: "Timetable & Fleet Sizing",
    summary: "Service pattern, cycle time and the fleet needed to run it, with depot reserve.",
    description: "Builds a service pattern from demand and headway, computes round-trip cycle time and the fleet including maintenance reserve and operating spares.",
    domains: ["metro", "lrt", "tram", "apm", "monorail"],
    discipline: "operations",
    status: "planned",
    standards: [],
    features: ["Peak / off-peak patterns", "Cycle and layover time", "Maintenance reserve"],
    outputs: ["Time-distance graph", "Fleet requirement"]
  },
  {
    id: "tram-ocs",
    title: "Tram OCS & Catenary-free",
    summary: "Overhead contact system and onboard energy storage for catenary-free sections.",
    description: "Sizing of onboard storage (supercapacitors / batteries) for catenary-free running, recharge at stops and its effect on substation loading.",
    domains: ["tram", "lrt"],
    discipline: "power",
    status: "planned",
    standards: ["EN 50119", "EN 50163"],
    features: ["Storage state-of-charge along route", "Charging at stops", "OCS voltage drop"],
    outputs: ["SoC profile", "Storage size", "Charging power"]
  },
  {
    id: "passenger-flow",
    title: "Station Passenger Flow & Egress",
    summary: "Platform clearance and evacuation times against NFPA 130.",
    description: "Platform clearance and point-of-safety times for station evacuation, with stair, escalator and fare-gate capacities.",
    domains: ["metro", "lrt", "apm", "mainline"],
    discipline: "stations",
    status: "planned",
    standards: ["NFPA 130"],
    features: ["4-minute platform clearance", "6-minute point of safety", "Element capacities"],
    outputs: ["Egress timeline", "Bottleneck list"]
  },
  {
    id: "tunnel-ventilation",
    title: "Tunnel Ventilation",
    summary: "1D airflow and smoke control for running tunnels during congestion and fire.",
    description: "One-dimensional network model for tunnel airflow — piston effect, jet fans and shaft fans — to check critical velocity under fire scenarios.",
    domains: ["metro", "mainline", "hsr"],
    discipline: "stations",
    status: "planned",
    standards: ["NFPA 130", "PIARC"],
    features: ["Piston-effect airflow", "Critical velocity", "Fan sizing"],
    outputs: ["Air velocity profile", "Fan duty"]
  },
  {
    id: "rams",
    title: "RAMS & Availability",
    summary: "Service availability, MTBSAF and target allocation from an equipment list with k-out-of-n redundancy, plus an FMECA register.",
    description: "Phase 1 RAM model. Builds the system as subsystems in series, each made of items with k-out-of-n redundancy and independent repair, and computes steady-state availability, MTBSAF, equivalent MTTR, downtime per year and mission reliability for service-affecting failures. Allocates system targets to subsystems (equal, ARINC or weighted), ranks the largest contributors to downtime and keeps an FMECA register with RPN and a severity × occurrence matrix. A built-in verification tab checks the engine against closed-form results and brute-force state enumeration. Beta: results to be reviewed by a RAM engineer before use in a submission.",
    domains: ["metro", "lrt", "tram", "apm", "mainline", "hsr", "monorail"],
    discipline: "assurance",
    status: "beta",
    entry: "modules/rams/index.html",
    version: "Phase 1 (beta)",
    updated: "2026-10-20",
    standards: ["EN 50126-1", "EN 50126-2", "IEC 61078", "IEC 60812"],
    features: [
      "Equipment table: quantity, units required (k-out-of-n), MTBF, MTTR, service-affecting flag",
      "System availability, MTBSAF, equivalent MTTR, downtime per year, failures per year",
      "Reliability block diagram drawn from the equipment table",
      "Target allocation to subsystems: equal, ARINC or weighted",
      "Largest contributors to downtime and mission reliability curve",
      "FMECA register with RPN, action flag and severity × occurrence matrix",
      "Excel template import / export, JSON inputs, printable report",
      "Verification tab: engine checked against closed-form and brute-force results"
    ],
    outputs: ["Availability roll-up", "Allocation table", "Block diagram", "Pareto of contributors", "FMECA summary", "Excel workbook", "PDF report"],
    resources: []
  },
  {
    id: "noise-vibration",
    title: "Noise & Vibration",
    summary: "Wayside noise and ground-borne vibration screening along the alignment.",
    description: "Screening of airborne noise and ground-borne vibration at receivers along the route, with mitigation options.",
    domains: ["metro", "lrt", "tram", "mainline", "hsr"],
    discipline: "environment",
    status: "planned",
    standards: ["ISO 3095", "FTA 2018"],
    features: ["Receiver screening", "Mitigation comparison"],
    outputs: ["Noise contour", "Receiver table"]
  }
];
