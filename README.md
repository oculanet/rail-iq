# Rail-IQ

Browser-based simulation workbench for railway systems — metro, LRT, tram, APM, monorail, mainline and high-speed rail.
One portal lists every simulator; each opens inside the Rail-IQ workspace or on its own.

## Run it

**Option 1 — double-click** `index.html`. Works in Chrome / Edge straight from disk (internet needed once for fonts and chart libraries).

**Option 2 — local server** (recommended; also lets the workspace pass the theme into the simulators):

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. No Python or Node needed.

**Option 3 — GitHub Pages.** Push the repository, then *Settings → Pages → Deploy from branch → main / root*. Everything is static with relative paths, so it works as-is.

## Structure

```
index.html                 Portal home: network view, disciplines, catalogue, details, Ctrl+K launcher
workspace.html             Shell that runs one simulator: workspace.html?m=<id>
assets/
  css/railiq.css           Shared styles, light + dark themes
  js/catalog.js            ★ Module registry — the single source of truth for the portal
  js/common.js             Icons, theme, recent modules, command palette
  js/network.js            Animated network schematic on the home page
  js/home.js               Home page rendering, filters, search, drawer
  img/favicon.svg
modules/
  dc-traction-power/       DC Traction Power Model (HTML + Python twin, samples, sources)
  apm-onboard-telecom/     APM Onboard Telecom Layout (3D, Three.js)
serve.ps1                  Local static server for Windows
```

## Simulators

| Module | Status | Discipline | Entry |
|---|---|---|---|
| DC Traction Power Model | Live | Traction Power | `modules/dc-traction-power/TPS_Model.html` |
| APM Onboard Telecom Layout | Live | Telecom & Radio | `modules/apm-onboard-telecom/index.html` |
| AC 25 kV Traction Power, Train Performance, CBTC Headway, Radio Coverage, Timetable & Fleet, Tram OCS, Passenger Flow, Tunnel Ventilation, RAMS, Noise & Vibration | Pipeline | various | — |

See `modules/dc-traction-power/README.md` for the traction power model's inputs, method and Python usage.

## Add a simulator

1. Create `modules/<id>/` and put the simulator in it (a self-contained `index.html` is easiest; keep its asset paths relative).
2. Add an entry to `RAILIQ_CATALOG` in `assets/js/catalog.js`:

   ```js
   {
     id: "cbtc-headway",
     title: "CBTC Headway & Capacity",
     summary: "One line for the card.",
     description: "Longer text for the details drawer.",
     domains: ["metro", "apm"],          // metro | lrt | tram | apm | mainline | hsr | monorail
     discipline: "signalling",           // key of RAILIQ_DISCIPLINES
     status: "live",                     // live | beta | planned
     entry: "modules/cbtc-headway/index.html",
     version: "1.0", updated: "2026-11-01",
     standards: ["IEEE 1474.1"], features: [], outputs: [], resources: []
   }
   ```

3. Reload. The card, filters, counters, network tooltip, Ctrl+K launcher and workspace switcher all pick it up.
   A pipeline item becomes launchable by changing `status` to `live` and setting `entry`.

## Notes

- The portal's theme button cycles auto / light / dark. When served over http the workspace also switches the simulator's theme; from disk each simulator keeps its own theme switch.
- "Recently opened" is stored in the browser only.
- The original upload archives (`*.zip`) are kept locally and excluded from git.
