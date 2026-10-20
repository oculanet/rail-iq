# DC Traction Power Model (HTML + Python)

Second-by-second DC traction power simulation and equipment sizing: train run on the
real alignment, timetable on any number of UP / DOWN tracks, nodal load flow through
every traction substation (TSS), rating checks, short-circuit scan and an all-cases
design check. The HTML model and the Python model use the same calculation and the
same inputs file, and give the same numbers (checked to 1 part in 10^9).

## Files

| File | What it is |
|---|---|
| `TPS_Model.html` | The interactive model. Double-click to open in Chrome / Edge (needs internet once for the chart, Word and Excel libraries). |
| `python/tps_model.py` | Python program (command line). Writes `TPS_Results.xlsx`, PNG charts and a JSON summary. |
| `python/tps_engine.py` | Python calculation engine (mirror of `src/engine.js`). |
| `python/tps_readers.py` | Python readers for the Excel alignment and the Word train data (text, tables, Word charts, graph images). |
| `python/tps_reports.py` | Word reports: DC simulation, short circuit, harmonics, EMC / EMI. |
| `python/default_inputs.json` | Sample inputs (the same sample the HTML opens with). |
| `samples/Alignment_Template.xlsx` | Alignment template to fill in (stations, gradients, curves, speed limits, levels). |
| `samples/Train_Data_Template.docx` | Train data template: parameter table, Davis line, effort / efficiency table, graph. |
| `samples/Train_Data_Graph_Only.docx` | Example with the tractive-effort curve only as a picture (shows graph reading). |
| `src/` + `build.py` | Source of the HTML. Edit `src/*.js` / `src/page.html`, then `python build.py` rebuilds `TPS_Model.html`. |

## HTML model

1. **Tracks & service** – set the number of UP and DOWN tracks, press *Apply track count*; edit headway, first-departure offset, train type and skip-stop stations per track.
2. **Traction substations** – number of TSS, chainage of first TSS and spacing, then *Generate TSS list*. *Add TSS* adds more; every row (chainage, kW, kVA, no-load V, source resistance, inverter, in service) stays editable.
3. **Train data** – *Choose Word file*. Parameters, curve tables and Word charts are read directly; graph pictures open in the digitiser (set the frame, enter axis values, click the curve, *Trace*, *Apply*). Several train types can be kept. Curves can also be pasted from Excel.
4. **Alignment** – *Choose Excel file*. Sheets are recognised by their headers; chainage in m or `12+345`; gradients in % or ‰ or `1 in N`.
5. **Electrical & limits**, **Simulation & cases**, **Additional details** – all values editable; extra rows are kept with the inputs.

6. **AC supply, fault, harmonics & EMC** – supply fault level and X/R, rectifier transformer uk and pulse number, loop and feeder
   inductance, di/dt setting and clearing time, harmonic limits table, rail–earth conductance, touch-voltage table, field and
   telecom geometry, psophometric weights and optional ripple-current limits.

Results: summary cards, line schematic (click a TSS to take it out), long section, train run, train graph,
TSS currents, train-voltage envelope, equipment sizing with next standard size, feeders and conductor rail,
short circuit (sustained current, di/dt, current rise, time to trip, AC fault levels, rail potential at faults), harmonics
(spectrum against limits, THD through the period, DC ripple), EMC / EMI (rail potential envelope, stray current, magnetic
field, telecom noise), pass/fail check list (failures first) and the design check over every single-TSS outage.

**Reports:** the Reports panel downloads the DC simulation, short circuit, harmonic and EMC / EMI reports as PDF or Word,
or all eight files plus the inputs in one zip. The Python program writes the same four reports as Word files.
*Export inputs* saves `inputs.json` for the Python model; *Export results* saves an Excel workbook.
In the claude.ai page every save asks you to confirm the file first.

## Python model

Requires Python 3.9+ with `numpy openpyxl python-docx xlsxwriter matplotlib pillow` (`pip install numpy openpyxl python-docx xlsxwriter matplotlib pillow`).

```
cd python
python tps_model.py --make-templates --out ../samples
python tps_model.py --alignment ../samples/Alignment_Template.xlsx --train ../samples/Train_Data_Template.docx --out results
python tps_model.py --inputs inputs.json --design-check --out results          # inputs exported from the HTML
python tps_model.py --n-up 2 --n-down 2 --tss-count 9 --tss-first 300 --tss-spacing 2300 --out results
python tps_model.py --add-tss "TSS-X,9800,3000,3300" --outage TSS4 --out results
python tps_model.py --train graph.docx --graph-axes 0,100,0,350 --graph-use te --out results
python tps_model.py --help
```

Each run writes `TPS_Results.xlsx` (including short-circuit, harmonic and EMC sheets), PNG charts and the four Word reports
(`--no-reports` skips them).

`--save-inputs file.json` writes the final inputs (after reading files and options) so they can be edited and re-run, or imported into the HTML.

## Method (short)

Train run on a 5 m grid (braking-curve backward pass, effort-limited forward pass, restrictions held for the train length,
Davis + gradient + Röckl curve resistance). Power = wheel power ÷ efficiency (or line-current curve) + auxiliaries;
regeneration up to the electric-brake curve and power limit. Each second the nodal network (busbars, feeder taps,
trains on each track) is solved with diode substations, constant-power trains, low-voltage cut-back, regeneration
voltage limit and optional inverters. Ratings use worst rolling 1-min / 15-min / 1-h RMS against rating × duty multipliers
(contingency multipliers for outage cases). Short circuit: resistance network for the sustained current, inductance network for di/dt, first-order rise,
IEC 60909 AC fault levels. Harmonics: overlap-dependent rectifier harmonics each second, IEC 61000-3-6 limits and summation.
EMC: rail–earth ladder each second for rail potential (EN 50122-1) and stray current (EN 50122-2), Biot–Savart static field,
inductive coupling with psophometric weighting. Not modelled: train slowing at low voltage, turnback and depot moves,
rectifier overshoot and arc dynamics, background harmonic distortion and resonance.
