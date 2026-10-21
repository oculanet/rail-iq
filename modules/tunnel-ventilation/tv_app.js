/* Rail-IQ Tunnel Ventilation — page logic. */
(function () {
  "use strict";
  const TV = window.TV;
  const $ = s => document.querySelector(s);
  const KEY = "railiq.tv.model";
  let model, evals = [], tests = [], tmr;

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (x, d = 0) => (isFinite(x) ? Number(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
  const pill = p => (p == null ? '<span class="pill na">no check</span>' : p ? '<span class="pill pass">pass</span>' : '<span class="pill fail">fail</span>');
  function nice(max, n) { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

  /* ---------------- model ---------------- */
  function normalise(m) {
    const s = window.TV_SAMPLE();
    ["project", "tunnel", "air", "train", "jet", "plantA", "plantB", "fire"].forEach(k => (m[k] = Object.assign({}, s[k], m[k] || {})));
    m.scenarios = (m.scenarios || []).map(x => Object.assign({ name: "Scenario", train: false, hrr: 0, fireX: 0, jetRun: 0, plantARun: 0, plantBRun: 0, portal: 0, dir: 1 }, x));
    if (!m.scenarios.length) m.scenarios = s.scenarios;
    m.selected = Math.min(Math.max(0, +m.selected || 0), m.scenarios.length - 1);
    return m;
  }
  function load() { try { const v = localStorage.getItem(KEY); if (v) { const m = JSON.parse(v); if (m && m.tunnel) return normalise(m); } } catch (e) { /* ignore */ } return normalise(window.TV_SAMPLE()); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(model)); } catch (e) { /* ignore */ } }
  const getK = path => path.split(".").reduce((o, k) => (o == null ? o : o[k]), model);
  function setK(path, val) { const ks = path.split("."), last = ks.pop(); ks.reduce((o, k) => o[k], model)[last] = val; }

  /* ---------------- inputs ---------------- */
  function fillInputs() {
    document.querySelectorAll("[data-k]").forEach(el => { const v = getK(el.dataset.k); if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? ""; });
  }
  function wireInputs() {
    const h = e => {
      const el = e.target; if (!el.dataset.k) return;
      setK(el.dataset.k, el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? "" : +el.value) : el.value);
      schedule();
    };
    document.addEventListener("input", h);
    document.addEventListener("change", e => { if (e.target.dataset.k && (e.target.type === "checkbox" || e.target.tagName === "SELECT")) h(e); });
  }
  function validate() {
    const t = model.tunnel, issues = [], bad = new Set();
    const need = (path, ok, msg) => { if (!ok) { issues.push(msg); bad.add(path); } };
    need("tunnel.length", +t.length > 0, "Tunnel length must be > 0");
    need("tunnel.area", +t.area > 0, "Tunnel area must be > 0");
    need("tunnel.perimeter", +t.perimeter > 0, "Perimeter must be > 0");
    need("tunnel.height", +t.height > 0, "Tunnel height must be > 0");
    need("air.rho", +model.air.rho > 0, "Air density must be > 0");
    need("train.area", !(+model.train.area >= +t.area), "Train area must be smaller than the tunnel area");
    ["plantA", "plantB"].forEach(p => need(p + ".p0", !(+model[p].p0 < +model[p].pRated), "Shut-off pressure must be at least the rated pressure (" + (p === "plantA" ? "end A" : "end B") + ")"));
    need("jet.vj", !(+model.jet.installed > 0) || +model.jet.vj > 0, "Jet fan outlet velocity must be > 0");
    document.querySelectorAll("[data-k]").forEach(el => el.classList.toggle("bad", bad.has(el.dataset.k)));
    return issues;
  }

  /* ---------------- scenario table ---------------- */
  function renderScenarios() {
    const cols = '<thead><tr><th style="min-width:260px">Scenario</th><th>Train</th><th class="num">Fire HRR (MW)</th><th class="num">Fire at (m)</th><th class="num">Jet fans run</th><th class="num">End A fans</th><th class="num">End B fans</th><th class="num">Portal ΔP (Pa)</th><th>Smoke to</th><th></th></tr></thead>';
    $("#sctable").innerHTML = cols + "<tbody>" + model.scenarios.map((s, i) => {
      const a = 'data-si="' + i + '"';
      const num = (f, st, w) => '<td><input type="number" ' + a + ' data-sf="' + f + '" value="' + esc(s[f]) + '" step="' + st + '" style="width:' + w + 'px" aria-label="' + f + '"></td>';
      return "<tr>" + '<td><input type="text" ' + a + ' data-sf="name" value="' + esc(s.name) + '" aria-label="Scenario name"></td>' +
        '<td style="text-align:center"><input type="checkbox" ' + a + ' data-sf="train" ' + (s.train ? "checked" : "") + ' aria-label="Train in tunnel"></td>' +
        num("hrr", "any", 80) + num("fireX", "any", 90) + num("jetRun", "1", 70) + num("plantARun", "1", 70) + num("plantBRun", "1", 70) + num("portal", "any", 80) +
        '<td><select ' + a + ' data-sf="dir" aria-label="Required smoke direction"><option value="1"' + (+s.dir === 1 ? " selected" : "") + '>towards B</option><option value="-1"' + (+s.dir === -1 ? " selected" : "") + '>towards A</option><option value=""' + (s.dir === "" || s.dir == null ? " selected" : "") + ">either</option></select></td>" +
        '<td><button class="btn icon sm" data-sdel="' + i + '" title="Delete scenario" aria-label="Delete scenario">✕</button></td></tr>';
    }).join("") + "</tbody>";
    $("#cnt-sc").textContent = model.scenarios.length;
  }
  function wireScenarios() {
    const tbl = $("#sctable");
    const h = e => {
      const el = e.target, f = el.dataset.sf; if (!f) return;
      const s = model.scenarios[+el.dataset.si];
      s[f] = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? 0 : +el.value) : f === "dir" ? (el.value === "" ? "" : +el.value) : el.value;
      schedule();
    };
    tbl.addEventListener("input", h);
    tbl.addEventListener("change", e => { if (e.target.type === "checkbox" || e.target.tagName === "SELECT") h(e); });
    tbl.addEventListener("click", e => {
      const b = e.target.closest("[data-sdel]"); if (!b) return;
      if (model.scenarios.length === 1) { toast("Keep at least one scenario"); return; }
      model.scenarios.splice(+b.dataset.sdel, 1); model.selected = Math.min(model.selected, model.scenarios.length - 1);
      renderScenarios(); recompute();
    });
    $("#b-addsc").addEventListener("click", () => {
      const last = model.scenarios[model.scenarios.length - 1] || {};
      model.scenarios.push({ ...last, name: "New scenario " + (model.scenarios.length + 1) });
      renderScenarios(); recompute();
    });
  }

  /* ---------------- compute ---------------- */
  function schedule() { clearTimeout(tmr); tmr = setTimeout(recompute, 150); }
  function recompute() {
    const issues = validate();
    const t = model.tunnel, G = TV.geom(t);
    $("#c-dh").textContent = isFinite(G.Dh) ? nf(G.Dh, 3) + " m" : "—";
    $("#c-k").textContent = isFinite(G.Dh) ? nf(TV.tunnelK(t), 2) : "—";
    $("#c-block").textContent = +t.area > 0 ? nf((+model.train.area / +t.area) * 100, 1) + " %" : "—";
    evals = issues.length ? [] : model.scenarios.map(sc => TV.evaluate(model, sc));
    const st = $("#status");
    if (issues.length) {
      st.classList.add("bad"); st.querySelector("span").textContent = issues[0];
      $("#tb-result").textContent = "Check inputs"; $("#tb-result").style.color = "var(--fail)";
      ["#scres", "#kpis", "#schem", "#pbal", "#fancurve", "#firechart", "#size-jet", "#size-plant", "#fire-call", "#size-call"].forEach(s => ($(s).innerHTML = ""));
      $("#scres").innerHTML = '<p class="muted">' + issues.map(esc).join("<br>") + "</p>";
      save(); return;
    }
    const fires = evals.filter(e => e.pass != null), ok = fires.filter(e => e.pass).length;
    const allOk = ok === fires.length;
    $("#tb-result").textContent = fires.length ? ok + " of " + fires.length + " pass" : "No checks";
    $("#tb-result").style.color = !fires.length ? "var(--ink-2)" : allOk ? "var(--pass)" : "var(--fail)";
    st.classList.toggle("bad", !allOk);
    st.querySelector("span").textContent = allOk ? "All checked scenarios pass" : fires.length - ok + " scenario(s) fail";
    renderResults();
    save();
  }

  /* ---------------- results ---------------- */
  function renderResults() {
    // scenario table
    let h = '<table><thead><tr><th>#</th><th>Scenario</th><th class="num">HRR (MW)</th><th class="num">Fans jet / A / B</th><th class="num">Velocity (m/s)</th><th class="num">Airflow (m³/s)</th><th class="num">Required (m/s)</th><th class="num">Margin</th><th class="num">Smoke temp. (°C)</th><th>Result</th></tr></thead><tbody>';
    evals.forEach((e, i) => {
      const s = e.sc;
      h += '<tr class="click' + (i === model.selected ? " sel" : "") + '" data-pick="' + i + '"><td class="num">' + (i + 1) + "</td><td>" + esc(s.name) + (s.train ? ' <span class="muted">· train</span>' : "") + '</td><td class="num">' + (+s.hrr > 0 ? nf(+s.hrr, 1) : "—") + '</td><td class="num">' + (+s.jetRun || 0) + " / " + (+s.plantARun || 0) + " / " + (+s.plantBRun || 0) +
        '</td><td class="num">' + (e.ok ? (e.v >= 0 ? "→ " : "← ") + nf(Math.abs(e.v), 2) : "no solution") + '</td><td class="num">' + (e.ok ? nf(Math.abs(e.Q), 1) : "—") + '</td><td class="num">' + (e.req ? nf(e.req, 2) : "—") +
        '</td><td class="num">' + (e.margin != null ? (e.margin >= 0 ? "+" : "") + nf(e.margin * 100, 0) + " %" : "—") + '</td><td class="num">' + (e.Tf != null ? nf(e.Tf, 0) : "—") + "</td><td>" + pill(e.pass) + (e.dirOk === false ? ' <span class="muted" style="font-size:12px">wrong direction</span>' : "") + "</td></tr>";
    });
    $("#scres").innerHTML = h + "</tbody></table>";

    const sel = $("#selsc");
    sel.innerHTML = model.scenarios.map((s, i) => '<option value="' + i + '"' + (i === model.selected ? " selected" : "") + ">" + (i + 1) + ". " + esc(s.name) + "</option>").join("");
    const e = evals[model.selected];
    renderDetail(e); renderSchematic(e); renderBalance(e); renderFanCurve(e); renderFire(e); renderSizing(e);
  }

  function renderDetail(e) {
    const s = e.sc, meth = { kennedy: "Kennedy", li: "Li & Ingason", max: "higher of both" }[model.fire.method] || "";
    $("#det-note").textContent = (s.train ? "stalled train · " : "") + (+s.hrr > 0 ? nf(+s.hrr, 1) + " MW fire at " + nf(+s.fireX) + " m" : "no fire");
    const k = (cls, l, v, sub) => '<div class="kpi ' + cls + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + sub + "</div></div>";
    const cls = e.pass == null ? "" : e.pass ? "pass" : "fail";
    if (!e.ok) { $("#kpis").innerHTML = k("fail", "Air velocity", "—", "no steady solution found"); return; }
    $("#kpis").innerHTML =
      k(cls, "Air velocity", nf(Math.abs(e.v), 2) + "<small> m/s</small>", (e.v >= 0 ? "towards end B →" : "← towards end A") + " " + pill(e.pass)) +
      k("", "Airflow", nf(Math.abs(e.Q), 1) + "<small> m³/s</small>", "through the tunnel section") +
      (e.Vc ? k("", "Critical velocity", nf(e.Vc, 2) + "<small> m/s</small>", meth + " · Kennedy " + nf(e.ken.Vc, 2) + " / Li " + nf(e.li.Vc, 2)) : k("", "Critical velocity", "—", "no fire in this scenario")) +
      k("", "Required velocity", e.req ? nf(e.req, 2) + "<small> m/s</small>" : "—", e.Vc ? "critical + " + nf(+model.fire.margin || 0) + " % margin" + (e.ken && e.ken.Kg > 1 ? " · grade factor " + nf(e.ken.Kg, 3) : "") : +model.fire.congestedMin > 0 && s.train ? "congested-train minimum" : "no requirement") +
      k(cls, "Margin", e.margin != null ? (e.margin >= 0 ? "+" : "") + nf(e.margin * 100, 0) + "<small> %</small>" : "—", "achieved ÷ required − 1") +
      (e.Tf != null ? k("", "Smoke temperature", nf(e.Tf, 0) + "<small> °C</small>", "bulk mean downstream of the fire") : "") +
      (e.dutyA ? k("", "End A fan duty", nf(e.dutyA.q, 1) + "<small> m³/s</small>", "per fan, " + nf(e.dutyA.p, 0) + " Pa net into tunnel") : "") +
      (e.dutyB ? k("", "End B fan duty", nf(e.dutyB.q, 1) + "<small> m³/s</small>", "per fan, " + nf(e.dutyB.p, 0) + " Pa net into tunnel") : "");
  }

  function renderSchematic(e) {
    const svg = $("#schem"), W = Math.max(600, svg.clientWidth || 1200), H = 250;
    const t = model.tunnel, s = e.sc, L = +t.length, x0 = 110, x1 = W - 110, ymid = 140, th = 46;
    const tilt = Math.max(-28, Math.min(28, -(+t.grade || 0) * 8)); // exaggerated, up = higher
    const X = c => x0 + (c / L) * (x1 - x0), Y = c => ymid + tilt / 2 - (c / L) * tilt;
    let g = "";
    // ground & tunnel band
    g += '<path d="M' + x0 + " " + (Y(0) - th / 2) + " L" + x1 + " " + (Y(L) - th / 2) + " L" + x1 + " " + (Y(L) + th / 2) + " L" + x0 + " " + (Y(0) + th / 2) + 'Z" style="fill:var(--air-soft);stroke:var(--ink-3);stroke-width:1.5"/>';
    // smoke zone downstream of the fire
    if (+s.hrr > 0 && e.ok) {
      const xf = Math.min(Math.max(+s.fireX || 0, 0), L), end = e.v >= 0 ? L : 0;
      const a = Math.min(xf, end), b = Math.max(xf, end);
      g += '<path d="M' + X(a) + " " + (Y(a) - th / 2 + 2) + " L" + X(b) + " " + (Y(b) - th / 2 + 2) + " L" + X(b) + " " + (Y(b) + th / 2 - 2) + " L" + X(a) + " " + (Y(a) + th / 2 - 2) + 'Z" style="fill:var(--smoke);opacity:.35"/>';
      g += '<text x="' + ((X(a) + X(b)) / 2) + '" y="' + (Y((a + b) / 2) + th / 2 + 16) + '" text-anchor="middle" style="fill:var(--ink-3)">smoke</text>';
    }
    // chainage ticks
    const step = L > 3000 ? 500 : L > 1200 ? 250 : 100;
    for (let c = 0; c <= L + 1e-6; c += step) g += '<line x1="' + X(c) + '" y1="' + (Y(c) + th / 2) + '" x2="' + X(c) + '" y2="' + (Y(c) + th / 2 + 5) + '" style="stroke:var(--ink-3)"/><text x="' + X(c) + '" y="' + (Y(c) + th / 2 + 32) + '" text-anchor="middle" style="font-size:10px">' + nf(c) + "</text>";
    // train
    if (s.train && +model.train.length > 0) {
      const xf = Math.min(Math.max(+s.fireX || 0, 0), L), tl = +model.train.length, a = Math.max(0, xf - tl / 2), b = Math.min(L, xf + tl / 2);
      const hh = th * Math.min(0.85, Math.sqrt(+model.train.area / +t.area));
      g += '<path d="M' + X(a) + " " + (Y(a) + th / 2 - 3 - hh) + " L" + X(b) + " " + (Y(b) + th / 2 - 3 - hh) + " L" + X(b) + " " + (Y(b) + th / 2 - 3) + " L" + X(a) + " " + (Y(a) + th / 2 - 3) + 'Z" style="fill:var(--panel);stroke:var(--ink);stroke-width:1.5"/>';
    }
    // jet fans along the crown
    const nJ = +model.jet.installed || 0, run = Math.min(nJ, +s.jetRun || 0);
    for (let i = 0; i < nJ; i++) {
      const c = (L * (i + 1)) / (nJ + 1), y = Y(c) - th / 2 + 7;
      g += '<rect x="' + (X(c) - 13) + '" y="' + (y - 4) + '" width="26" height="9" rx="4.5" style="fill:' + (i < run ? "var(--src)" : "var(--panel)") + ';stroke:var(--src);stroke-width:1.5"/>';
    }
    if (nJ) g += '<text x="' + X(L / (nJ + 1)) + '" y="' + (Y(L / (nJ + 1)) - th / 2 - 8) + '" text-anchor="middle" style="font-size:10px">jet fans ' + run + "/" + nJ + "</text>";
    // fire
    if (+s.hrr > 0) {
      const c = Math.min(Math.max(+s.fireX || 0, 0), L), fx = X(c), fy = Y(c) + th / 2 - 4;
      g += '<path d="M' + fx + " " + (fy - 24) + " C " + (fx + 10) + " " + (fy - 12) + ", " + (fx + 8) + " " + (fy - 2) + ", " + fx + " " + fy + " C " + (fx - 8) + " " + (fy - 2) + ", " + (fx - 10) + " " + (fy - 12) + ", " + fx + " " + (fy - 24) + 'Z" style="fill:var(--fire)"/>' +
        '<text x="' + fx + '" y="' + (Y(c) - th / 2 - 22) + '" text-anchor="middle" style="fill:var(--fire);font-weight:600">' + nf(+s.hrr, 1) + " MW</text>";
    }
    // end plants
    const plantSym = (x, y, name, run, inst, side) => {
      let p = '<line x1="' + x + '" y1="' + (y - th / 2) + '" x2="' + x + '" y2="' + (y - th / 2 - 34) + '" style="stroke:var(--ink-3);stroke-width:6;opacity:.5"/>';
      for (let i = 0; i < Math.max(inst, 1); i++) { const cx = x + (side * 18) + (side * i * 22); p += '<circle cx="' + cx + '" cy="' + (y - th / 2 - 40) + '" r="9" style="fill:' + (i < run ? "var(--src)" : "var(--panel)") + ';stroke:var(--src);stroke-width:1.5"/>'; }
      p += '<text x="' + x + '" y="' + (y - th / 2 - 60) + '" text-anchor="' + (side < 0 ? "end" : "start") + '" style="font-size:11px">' + esc(trunc(name, 30)) + " · " + run + "/" + inst + "</text>";
      return p;
    };
    g += plantSym(x0, Y(0), model.plantA.name || "End A plant", +s.plantARun || 0, +model.plantA.installed || 0, 1);
    g += plantSym(x1, Y(L), model.plantB.name || "End B plant", +s.plantBRun || 0, +model.plantB.installed || 0, -1);
    g += '<text class="lbl" x="' + (x0 - 12) + '" y="' + (Y(0) + 4) + '" text-anchor="end" style="font-weight:600">A</text><text class="lbl" x="' + (x1 + 12) + '" y="' + (Y(L) + 4) + '" style="font-weight:600">B</text>';
    // airflow arrows
    if (e.ok) {
      const dir = e.v >= 0 ? 1 : -1;
      [0.18, 0.5, 0.82].forEach(f => {
        const c = L * f, cx = X(c), cy = Y(c), len = 34;
        g += '<path d="M' + (cx - dir * len / 2) + " " + cy + " L" + (cx + dir * len / 2) + " " + cy + '" style="stroke:var(--air);stroke-width:3"/><path d="M' + (cx + dir * len / 2) + " " + cy + " l" + (-dir * 9) + " -6 l0 12 Z" + '" style="fill:var(--air)"/>';
      });
      g += '<text x="' + X(L * 0.18) + '" y="' + (Y(L * 0.18) + 19) + '" text-anchor="middle" style="fill:var(--air);font-weight:600">' + nf(Math.abs(e.v), 2) + " m/s</text>";
    }
    g += '<text x="' + x0 + '" y="' + (H - 6) + '" style="fill:var(--ink-3);font-size:10px">chainage (m) · gradient ' + nf(+t.grade || 0, 1) + " % (drawn exaggerated)</text>";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  function renderBalance(e) {
    const svg = $("#pbal");
    if (!e.ok) { svg.innerHTML = ""; return; }
    const rows = [
      ["Jet fans", e.s.jet, "src"], ["End A plant", e.s.plantA, "src"], ["End B plant", e.s.plantB, "src"], ["Portal pressure", e.s.portal, "src"], ["Fire buoyancy", e.s.buoy, "src"],
      ["Tunnel friction", e.l.friction, "loss"], ["Entry, exit, local", e.l.local, "loss"], ["Stalled train", e.l.train, "loss"]
    ].filter(r => Math.abs(r[1]) > 1e-9 || r[0] === "Tunnel friction");
    const W = Math.max(320, svg.clientWidth || 560), Lw = 130, Rw = 70, rowH = 26, top = 8;
    const H = top + rows.length * rowH + 30;
    const pos = Math.max(1e-9, ...rows.map(r => Math.max(0, r[1]))), neg = Math.max(0, ...rows.map(r => Math.max(0, -r[1])));
    const span = W - Lw - Rw, zx = Lw + span * (neg / (pos + neg)), sc = span / (pos + neg);
    let g = '<line x1="' + zx + '" y1="' + top + '" x2="' + zx + '" y2="' + (H - 22) + '" style="stroke:var(--ink-3)"/>';
    rows.forEach((r, i) => {
      const y = top + i * rowH, w = Math.abs(r[1]) * sc, x = r[1] >= 0 ? zx : zx - w;
      g += '<text class="lbl" x="' + (Lw - 8) + '" y="' + (y + 16) + '" text-anchor="end">' + r[0] + "</text>" +
        '<rect x="' + x + '" y="' + (y + 5) + '" width="' + Math.max(1, w) + '" height="15" rx="2" style="fill:var(--' + r[2] + ')"/>' +
        '<text x="' + (r[1] >= 0 ? x + w + 5 : zx + 5) + '" y="' + (y + 17) + '" text-anchor="start">' + nf(r[1], 0) + "</text>";
    });
    g += '<text x="' + Lw + '" y="' + (H - 6) + '" style="fill:var(--ink-3)">sources ' + nf(e.src, 0) + " Pa = losses " + nf(e.loss, 0) + " Pa</text>";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  function renderFanCurve(e) {
    const svg = $("#fancurve"), W = Math.max(320, svg.clientWidth || 560), H = 280, L = 56, R = 16, T = 14, B = 40;
    if (!e.ok) { svg.innerHTML = ""; return; }
    const sc = e.sc, A = +model.tunnel.area, Qop = Math.abs(e.Q);
    const nA = +sc.plantARun || 0, nB = +sc.plantBRun || 0;
    const qMax = Math.max(1.6 * Qop, 1.3 * Math.max(nA * +model.plantA.qRated, nB * +model.plantB.qRated, 1), 10);
    const plants = q => TV.plant(model.plantA, nA, q) + TV.plant(model.plantB, nB, q);
    const need = q => { const t = TV.terms(model, sc, q / A); return t.loss - t.s.jet - t.s.portal - t.s.buoy; };
    const N = 120, ps = [], ns = [];
    for (let i = 0; i <= N; i++) { const q = (qMax * i) / N; ps.push([q, plants(q)]); ns.push([q, need(q)]); }
    const needTop = Math.max(10, need(Math.min(qMax, 1.3 * Math.max(Qop, 1))));
    let yMax = Math.max(needTop, nA + nB ? plants(0) : 0) * 1.08;
    const yStep = nice(yMax, 5); yMax = Math.ceil(yMax / yStep) * yStep;
    let yMin = Math.min(0, ...ns.map(p => p[1]).filter(isFinite)); yMin = Math.max(-2 * yStep, Math.floor(yMin / yStep) * yStep);
    const sx = q => L + (q / qMax) * (W - L - R), sy = p => T + (1 - (p - yMin) / (yMax - yMin)) * (H - T - B);
    const clampY = p => Math.max(T, Math.min(H - B, sy(p)));
    let g = "";
    for (let p = yMin; p <= yMax + 1e-9; p += yStep) g += '<line class="gr" x1="' + L + '" y1="' + sy(p) + '" x2="' + (W - R) + '" y2="' + sy(p) + '"/><text x="' + (L - 6) + '" y="' + (sy(p) + 4) + '" text-anchor="end">' + nf(p, 0) + "</text>";
    const qStep = nice(qMax, 5); for (let q = 0; q <= qMax + 1e-9; q += qStep) g += '<text x="' + sx(q) + '" y="' + (H - 22) + '" text-anchor="middle">' + nf(q, 0) + "</text>";
    g += '<text x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end" style="fill:var(--ink-3)">airflow (m³/s) · pressure (Pa)</text>';
    if (yMin < 0) g += '<line x1="' + L + '" y1="' + sy(0) + '" x2="' + (W - R) + '" y2="' + sy(0) + '" style="stroke:var(--ink-3)"/>';
    const path = pts => pts.map((p, i) => (i ? "L" : "M") + sx(p[0]).toFixed(1) + " " + clampY(p[1]).toFixed(1)).join("");
    g += '<path d="' + path(ns) + '" style="fill:none;stroke:var(--loss);stroke-width:2.2"/>';
    if (nA + nB) g += '<path d="' + path(ps) + '" style="fill:none;stroke:var(--src);stroke-width:2.2"/>';
    if (e.v >= 0) g += '<circle cx="' + sx(Qop) + '" cy="' + clampY(e.s.plantA + e.s.plantB) + '" r="5" style="fill:var(--ink)"/><text x="' + (sx(Qop) + 8) + '" y="' + (clampY(e.s.plantA + e.s.plantB) - 8) + '" style="fill:var(--ink);font-weight:600">' + nf(Qop, 1) + " m³/s</text>";
    $("#fan-legend").innerHTML = (nA + nB ? '<span><i style="background:var(--src)"></i>end fan plants, net of shaft & damper loss</span>' : "") + '<span><i style="background:var(--loss)"></i>tunnel need = losses − jet fans − portal − buoyancy</span>';
    if (!(nA + nB)) g += '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" style="fill:var(--ink-3)">no end fans running in this scenario</text>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  function renderFire(e) {
    const sc = e.sc, svg = $("#firechart");
    const base = +sc.hrr > 0 ? +sc.hrr : 10;
    const maxMW = Math.max(50, Math.ceil((base * 3) / 10) * 10), sw = TV.fireSweep(model, sc, maxMW, maxMW / 120);
    let lim = sw.maxOk, top = maxMW;
    while (lim != null && lim >= top - 1e-9 && top < 400) { top = Math.min(400, top * 2); lim = TV.fireSweep(model, sc, top, top / 200).maxOk; }
    const beyond = lim != null && lim >= top - 1e-9;
    $("#fire-note").textContent = "fans of the selected scenario · fire at " + nf(+sc.fireX) + " m";
    const cov = +sc.hrr > 0 ? " Design fire " + nf(+sc.hrr, 1) + " MW: " + (lim != null && lim >= +sc.hrr ? "covered." : "<b style=\"color:var(--fail)\">not covered.</b>") : "";
    $("#fire-call").innerHTML = lim == null ? "<b>The fans in this scenario do not reach the required velocity for any fire size.</b>" + cov
      : beyond ? "The fans in this scenario stay above the required velocity for every fire size checked, up to <b>" + nf(top, 0) + " MW</b>: critical velocity levels off for large fires, so fire size stops being the limit." + cov
      : "With the fans in this scenario the airflow keeps smoke from backlayering for fires up to about <b>" + nf(lim, 1) + " MW</b>." + cov;
    const W = Math.max(340, svg.clientWidth || 1000), H = 260, L = 50, R = 20, T = 14, B = 36;
    const vTop = Math.max(...sw.pts.map(p => Math.max(Math.abs(p.v) || 0, p.req || 0)), 1) * 1.1, vStep = nice(vTop, 5), vMax = Math.ceil(vTop / vStep) * vStep;
    const sx = q => L + (q / maxMW) * (W - L - R), sy = v => T + (1 - v / vMax) * (H - T - B);
    let g = "";
    for (let v = 0; v <= vMax + 1e-9; v += vStep) g += '<line class="gr" x1="' + L + '" y1="' + sy(v) + '" x2="' + (W - R) + '" y2="' + sy(v) + '"/><text x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + nf(v, vStep < 1 ? 1 : 0) + "</text>";
    const qs = nice(maxMW, 5); for (let q = 0; q <= maxMW + 1e-9; q += qs) g += '<text x="' + sx(q) + '" y="' + (H - 18) + '" text-anchor="middle">' + nf(q, 0) + "</text>";
    g += '<text x="' + (W - R) + '" y="' + (H - 2) + '" text-anchor="end" style="fill:var(--ink-3)">fire heat release rate (MW) · velocity (m/s)</text>';
    const line = (f, col, dash) => '<path d="' + sw.pts.map((p, i) => (i ? "L" : "M") + sx(p.q).toFixed(1) + " " + sy(Math.max(0, f(p))).toFixed(1)).join("") + '" style="fill:none;stroke:' + col + ";stroke-width:2.2" + (dash ? ";stroke-dasharray:6 4" : "") + '"/>';
    g += line(p => Math.abs(p.v), "var(--air)") + line(p => p.req, "var(--fire)", true);
    if (+sc.hrr > 0) g += '<line x1="' + sx(+sc.hrr) + '" y1="' + T + '" x2="' + sx(+sc.hrr) + '" y2="' + (H - B) + '" style="stroke:var(--ink-3);stroke-dasharray:3 3"/><text x="' + (sx(+sc.hrr) + 5) + '" y="' + (T + 12) + '">design fire</text>';
    if (sw.maxOk != null && sw.maxOk < maxMW - 1e-9) g += '<circle cx="' + sx(sw.maxOk) + '" cy="' + sy(sw.pts.find(p => Math.abs(p.q - sw.maxOk) < 1e-9).req) + '" r="5" style="fill:var(--ink)"/>';
    g += '<rect x="' + (L + 12) + '" y="' + (H - B - 34) + '" width="14" height="3" style="fill:var(--air)"/><text x="' + (L + 32) + '" y="' + (H - B - 28) + '">achieved air velocity</text>' +
      '<rect x="' + (L + 12) + '" y="' + (H - B - 18) + '" width="14" height="3" style="fill:var(--fire)"/><text x="' + (L + 32) + '" y="' + (H - B - 12) + '">required (critical + margin)</text>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  function renderSizing(e) {
    const sc = e.sc;
    const checked = +sc.hrr > 0 || (+model.fire.congestedMin > 0 && sc.train);
    if (!checked) { $("#size-note").textContent = ""; $("#size-call").innerHTML = "The selected scenario has no fire and no congested-train requirement, so there is nothing to size against. Pick a fire scenario."; $("#size-jet").innerHTML = ""; $("#size-plant").innerHTML = ""; return; }
    const z = TV.sizing(model, sc);
    $("#size-note").textContent = "for “" + sc.name + "”";
    const spare = 1;
    $("#size-call").innerHTML =
      "<b>Jet fans:</b> " + (z.jetMin == null ? "not enough even with " + (z.jets.length - 1) + " running" : z.jetMin === 0 ? "none needed when " + (+sc.plantARun || 0) + " + " + (+sc.plantBRun || 0) + " end fans run" : "at least <b>" + z.jetMin + "</b> running with " + (+sc.plantARun || 0) + " + " + (+sc.plantBRun || 0) + " end fans; installed " + (+model.jet.installed || 0) + (z.jetMin + spare <= (+model.jet.installed || 0) ? " — covers one standby" : " — <b style=\"color:var(--fail)\">no standby margin</b>")) + ".<br>" +
      "<b>End fans:</b> " + (z.plantMin && z.plantMin.a + z.plantMin.b === 0 ? "none needed when " + (+sc.jetRun || 0) + " jet fans run" : z.plantMin ? "smallest passing combination is <b>" + z.plantMin.a + " at end A + " + z.plantMin.b + " at end B</b> with " + (+sc.jetRun || 0) + " jet fans running" : "no combination up to the table limit passes with " + (+sc.jetRun || 0) + " jet fans") + ".";
    let h = '<table><thead><tr><th class="num">Jet fans running</th><th class="num">Velocity (m/s)</th><th>Result</th></tr></thead><tbody>';
    z.jets.forEach(j => (h += "<tr" + (j.n === z.jetMin ? ' class="sel"' : "") + '><td class="num">' + j.n + '</td><td class="num">' + nf(j.v, 2) + "</td><td>" + pill(j.pass) + "</td></tr>"));
    $("#size-jet").innerHTML = h + "</tbody></table>";
    const amax = Math.max(...z.combos.map(c => c.a)), bmax = Math.max(...z.combos.map(c => c.b));
    let p = '<table class="combo"><thead><tr><th>A \\ B</th>' + Array.from({ length: bmax + 1 }, (_, b) => "<th>" + b + "</th>").join("") + "</tr></thead><tbody>";
    for (let a = 0; a <= amax; a++) {
      p += "<tr><th>" + a + "</th>";
      for (let b = 0; b <= bmax; b++) { const c = z.combos.find(x => x.a === a && x.b === b); p += '<td class="' + (c.pass ? "ok" : "no") + (z.plantMin && z.plantMin.a === a && z.plantMin.b === b ? " best" : "") + '">' + nf(c.v, 2) + "</td>"; }
      p += "</tr>";
    }
    $("#size-plant").innerHTML = p + '</tbody></table><div class="muted" style="font-size:12px;margin-top:6px">Velocity (m/s) by number of fans running at end A (rows) and end B (columns), with ' + (+sc.jetRun || 0) + " jet fans. Green = passes.</div>";
  }

  function renderVerify() {
    tests = window.TV_TESTS.run();
    const pass = tests.filter(t => t.pass).length;
    $("#ver-note").textContent = pass + " of " + tests.length + " checks pass";
    $("#ver-note").style.color = pass === tests.length ? "var(--pass)" : "var(--fail)";
    const fmt = v => (Math.abs(v) >= 1000 ? nf(v, 3) : Number(v).toPrecision(10));
    $("#verify").innerHTML = '<p class="muted" style="margin:0 0 10px">Each check compares the solver with an independent closed-form solution or a second, independent root finder.</p><table><thead><tr><th>Case</th><th>Check</th><th class="num">Independent</th><th class="num">Engine</th><th class="num">Rel. difference</th><th>Independent method</th><th>Result</th></tr></thead><tbody>' +
      tests.map(t => { const d = Math.abs(t.expected - t.got) / Math.max(Math.abs(t.expected), 1e-300); return "<tr><td>" + esc(t.group) + "</td><td>" + esc(t.name) + '</td><td class="num">' + fmt(t.expected) + '</td><td class="num">' + fmt(t.got) + '</td><td class="num">' + (d === 0 || !isFinite(d) ? "0" : d.toExponential(1)) + '</td><td class="muted">' + esc(t.how) + "</td><td>" + pill(t.pass) + "</td></tr>"; }).join("") + "</tbody></table>";
  }

  /* ---------------- export ---------------- */
  function fileBase() { return (model.project.docRef || "TVS").replace(/[^\w.-]+/g, "_"); }
  function exportResults() {
    if (!window.XLSX) { toast("The Excel library did not load — check the internet connection."); return; }
    const wb = XLSX.utils.book_new();
    const sc = [["#", "Scenario", "Train", "HRR (MW)", "Fire at (m)", "Jet fans", "End A fans", "End B fans", "Portal dP (Pa)", "Velocity (m/s, + = A to B)", "Airflow (m3/s)", "Critical velocity (m/s)", "Required (m/s)", "Margin", "Smoke temp (C)", "Result"]];
    evals.forEach((e, i) => { const s = e.sc; sc.push([i + 1, s.name, s.train ? "Y" : "N", +s.hrr, +s.fireX, +s.jetRun, +s.plantARun, +s.plantBRun, +s.portal, e.v, e.Q, e.Vc ?? "", e.req ?? "", e.margin ?? "", e.Tf ?? "", e.pass == null ? "no check" : e.pass ? "pass" : "fail"]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sc), "Scenarios");
    const pb = [["Scenario", "Jet fans", "End A plant", "End B plant", "Portal", "Fire buoyancy", "Tunnel friction", "Local losses", "Stalled train", "Sources", "Losses"]];
    evals.forEach(e => e.ok && pb.push([e.sc.name, e.s.jet, e.s.plantA, e.s.plantB, e.s.portal, e.s.buoy, e.l.friction, e.l.local, e.l.train, e.src, e.loss]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pb), "Pressure balance (Pa)");
    const inp = [["Group", "Field", "Value"]];
    ["project", "tunnel", "air", "train", "jet", "plantA", "plantB", "fire"].forEach(g => Object.entries(model[g]).forEach(([k, v]) => inp.push([g, k, v])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inp), "Inputs");
    const sel = evals[model.selected];
    if (sel && sel.ok) {
      const sw = TV.fireSweep(model, sel.sc, 100, 1);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["HRR (MW)", "Velocity (m/s)", "Critical (m/s)", "Required (m/s)"]].concat(sw.pts.map(p => [p.q, p.v, p.Vc, p.req]))), "Fire sweep (selected)");
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Case", "Check", "Independent", "Engine", "Method", "Result"]].concat(tests.map(t => [t.group, t.name, t.expected, t.got, t.how, t.pass ? "pass" : "FAIL"]))), "Verification");
    XLSX.writeFile(wb, fileBase() + "_tunnel_ventilation.xlsx");
    toast("Results workbook saved");
  }
  function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  function wireActions() {
    $("#b-export").onclick = exportResults;
    $("#b-json").onclick = () => download(fileBase() + "_tunnel_inputs.json", JSON.stringify(model, null, 2));
    $("#b-jsonin").onclick = () => $("#f-json").click();
    $("#f-json").onchange = e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { const m = JSON.parse(r.result); if (!m.tunnel) throw new Error("not a Rail-IQ tunnel ventilation inputs file"); model = normalise(m); fillInputs(); renderScenarios(); recompute(); toast("Opened " + f.name); } catch (err) { toast("Could not open " + f.name + ": " + err.message); } };
      r.readAsText(f);
    };
    $("#b-print").onclick = () => window.print();
    $("#b-sample").onclick = () => { if (confirm("Replace all inputs with the sample tunnel?")) { model = normalise(window.TV_SAMPLE()); fillInputs(); renderScenarios(); recompute(); toast("Sample tunnel loaded"); } };
    document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === t));
      document.querySelectorAll('[role="tabpanel"]').forEach(p => (p.hidden = p.id !== t.dataset.tab));
    }));
    $("#selsc").addEventListener("change", e => { model.selected = +e.target.value; renderResults(); save(); });
    $("#scres").addEventListener("click", e => { const r = e.target.closest("[data-pick]"); if (!r) return; model.selected = +r.dataset.pick; renderResults(); save(); });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => evals.length && renderResults(), 150); });
  }

  model = load();
  wireInputs(); wireScenarios(); wireActions();
  fillInputs(); renderScenarios(); renderVerify(); recompute();
})();
