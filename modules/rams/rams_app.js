/* Rail-IQ RAMS — page logic: inputs, results, charts, Excel / JSON in and out. */
(function () {
  "use strict";
  const R = window.RAMS;
  const $ = s => document.querySelector(s);
  const KEY = "railiq.rams.model";
  let model, res, tmr, uid = Date.now();
  const nid = p => p + (uid++).toString(36);

  /* ---------------- formatting ---------------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (x, d = 0) => (isFinite(x) ? Number(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const pct = (A, d = 4) => (isFinite(A) && A != null ? (A * 100).toFixed(d) + " %" : "—");
  const hrs = h => (h == null ? "—" : !isFinite(h) ? "no SAF" : h >= 1e8 ? "> 100,000,000" : nf(h, h < 100 ? 1 : 0));
  const mins = m => nf(m, m < 10 ? 2 : m < 100 ? 1 : 0);
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const passPill = p => (p == null ? '<span class="pill na">no target</span>' : p ? '<span class="pill pass">pass</span>' : '<span class="pill fail">below</span>');

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ---------------- persistence ---------------- */
  function normalise(m) {
    m.project = Object.assign({ name: "", system: "", docRef: "", hoursPerDay: 20, daysPerYear: 365, missionHours: 20 }, m.project || {});
    m.targets = Object.assign({ availability: 99.9, mtbsaf: "", allocation: "arinc", rpnThreshold: 100 }, m.targets || {});
    m.subsystems = (m.subsystems || []).map(s => ({ id: s.id || nid("s"), name: s.name || "", weight: s.weight == null ? 1 : s.weight,
      items: (s.items || []).map(i => ({ id: i.id || nid("i"), name: i.name || "", n: i.n == null ? 1 : i.n, k: i.k == null ? 1 : i.k, mtbf: i.mtbf, mttr: i.mttr, saf: i.saf !== false, note: i.note || "" })) }));
    m.fmeca = (m.fmeca || []).map(f => Object.assign({ id: "", item: "", fn: "", mode: "", cause: "", local: "", effect: "", S: "", O: "", D: "", mitigation: "", owner: "", status: "Open" }, f, { _k: nid("f") }));
    return m;
  }
  function load() {
    try { const v = localStorage.getItem(KEY); if (v) { const m = JSON.parse(v); if (m && Array.isArray(m.subsystems)) return normalise(m); } } catch (e) { /* ignore */ }
    return normalise(window.RAMS_SAMPLE());
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(model, (k, v) => (k === "_k" ? undefined : v))); } catch (e) { /* ignore */ } }

  /* ---------------- project & targets ---------------- */
  function fillProject() {
    document.querySelectorAll("[data-p]").forEach(el => (el.value = model.project[el.dataset.p] ?? ""));
    document.querySelectorAll("[data-t]").forEach(el => (el.value = model.targets[el.dataset.t] ?? ""));
  }
  function wireProject() {
    document.addEventListener("input", e => {
      const el = e.target;
      if (el.dataset.p) { model.project[el.dataset.p] = el.type === "number" ? (el.value === "" ? "" : +el.value) : el.value; schedule(); }
      if (el.dataset.t) { model.targets[el.dataset.t] = el.type === "number" ? (el.value === "" ? "" : +el.value) : el.value; schedule(); if (el.dataset.t === "allocation") renderEquip(); if (el.dataset.t === "rpnThreshold") renderFmeca(); }
    });
    document.addEventListener("change", e => { if (e.target.dataset.t === "allocation") { model.targets.allocation = e.target.value; renderEquip(); schedule(); } });
  }

  /* ---------------- equipment table ---------------- */
  function renderEquip() {
    const weighted = model.targets.allocation === "weighted";
    let h = '<thead><tr><th style="min-width:220px">Item</th><th class="num">Qty n</th><th class="num">Req. k</th><th>Config</th><th class="num">MTBF (h)</th><th class="num">MTTR (h)</th><th title="Service affecting failure">SAF</th>' +
      '<th class="num">Unit A</th><th class="num">Item A</th><th class="num">MTBSAF (h)</th><th style="min-width:160px">Note</th><th></th></tr></thead>';
    model.subsystems.forEach((s, si) => {
      h += '<tbody><tr class="sub"><td colspan="7"><input type="text" value="' + esc(s.name) + '" data-s="' + si + '" data-f="name" aria-label="Subsystem name" placeholder="Subsystem name"></td>' +
        '<td colspan="5"><div class="subtools">' + (weighted ? '<label class="muted" style="font-size:12px">Weight <input type="number" min="0" step="0.1" value="' + esc(s.weight) + '" data-s="' + si + '" data-f="weight" style="width:70px;display:inline-block"></label>' : "") +
        '<span class="mono muted" id="c-' + s.id + '-A" style="font-size:12px"></span><button class="btn sm" data-act="additem" data-s="' + si + '">+ Item</button></div></td>' +
        '<td><button class="btn icon sm" data-act="delsub" data-s="' + si + '" title="Delete subsystem" aria-label="Delete subsystem">✕</button></td></tr>';
      s.items.forEach((it, ii) => {
        const a = 'data-s="' + si + '" data-i="' + ii + '"';
        h += '<tr id="row-' + it.id + '" class="' + (it.saf ? "" : "nonsaf") + '">' +
          '<td><input type="text" value="' + esc(it.name) + '" ' + a + ' data-f="name" aria-label="Item"></td>' +
          '<td><input type="number" min="1" step="1" value="' + esc(it.n) + '" ' + a + ' data-f="n" aria-label="Quantity installed" style="width:70px"></td>' +
          '<td><input type="number" min="1" step="1" value="' + esc(it.k) + '" ' + a + ' data-f="k" aria-label="Units required" style="width:70px"></td>' +
          '<td><span class="cfg" id="c-' + it.id + '-cfg"></span></td>' +
          '<td><input type="number" min="0" step="any" value="' + esc(it.mtbf) + '" ' + a + ' data-f="mtbf" aria-label="MTBF hours" style="width:110px"></td>' +
          '<td><input type="number" min="0" step="any" value="' + esc(it.mttr) + '" ' + a + ' data-f="mttr" aria-label="MTTR hours" style="width:80px"></td>' +
          '<td style="text-align:center"><input type="checkbox" ' + (it.saf ? "checked" : "") + " " + a + ' data-f="saf" aria-label="Service affecting"></td>' +
          '<td class="num" id="c-' + it.id + '-ua"></td><td class="num" id="c-' + it.id + '-ia"></td><td class="num" id="c-' + it.id + '-mut"></td>' +
          '<td><input type="text" value="' + esc(it.note) + '" ' + a + ' data-f="note" aria-label="Note"></td>' +
          '<td><button class="btn icon sm" data-act="delitem" ' + a + ' title="Delete item" aria-label="Delete item">✕</button></td></tr>';
      });
      h += "</tbody>";
    });
    $("#equip").innerHTML = h;
    $("#cnt-equip").textContent = model.subsystems.reduce((a, s) => a + s.items.length, 0);
    if (res) updateInline();
  }
  function wireEquip() {
    const tbl = $("#equip");
    const upd = e => {
      const el = e.target, f = el.dataset.f; if (!f) return;
      const s = model.subsystems[+el.dataset.s]; if (!s) return;
      if (el.dataset.i == null) { s[f] = f === "weight" ? (el.value === "" ? 0 : +el.value) : el.value; }
      else {
        const it = s.items[+el.dataset.i];
        if (f === "saf") { it.saf = el.checked; $("#row-" + it.id).className = it.saf ? "" : "nonsaf"; }
        else if (["n", "k", "mtbf", "mttr"].includes(f)) it[f] = el.value === "" ? "" : +el.value;
        else it[f] = el.value;
      }
      schedule();
    };
    tbl.addEventListener("input", upd);
    tbl.addEventListener("change", e => { if (e.target.type === "checkbox") upd(e); });
    tbl.addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const si = +b.dataset.s, s = model.subsystems[si];
      if (b.dataset.act === "additem") s.items.push({ id: nid("i"), name: "New item", n: 1, k: 1, mtbf: 10000, mttr: 2, saf: true, note: "" });
      if (b.dataset.act === "delitem") s.items.splice(+b.dataset.i, 1);
      if (b.dataset.act === "delsub") { if (!confirm("Delete subsystem “" + (s.name || "unnamed") + "” and its " + s.items.length + " items?")) return; model.subsystems.splice(si, 1); }
      renderEquip(); recompute();
    });
    $("#b-addsub").addEventListener("click", () => {
      model.subsystems.push({ id: nid("s"), name: "New subsystem", weight: 1, items: [{ id: nid("i"), name: "New item", n: 1, k: 1, mtbf: 10000, mttr: 2, saf: true, note: "" }] });
      renderEquip(); recompute();
    });
  }
  function updateInline() {
    const byId = {};
    res.subs.forEach(s => { byId[s.ref.id] = s; s.items.forEach(it => (byId[it.ref.id] = it)); });
    model.subsystems.forEach(s => {
      const rs = byId[s.id], el = document.getElementById("c-" + s.id + "-A");
      if (el && rs) el.textContent = "A " + pct(rs.A, 5) + " · " + mins(rs.downMinYr) + " min/yr";
      s.items.forEach(it => {
        const r = byId[it.id];
        const set = (k, v) => { const c = document.getElementById("c-" + it.id + "-" + k); if (c) c.textContent = v; };
        const row = document.getElementById("row-" + it.id);
        const n = +it.n, k = +it.k;
        set("cfg", n >= 1 && k >= 1 ? (k === n ? (n === 1 ? "single" : n + " in series") : k + "oo" + n) : "?");
        if (row) row.querySelectorAll("input").forEach(inp => {
          const f = inp.dataset.f;
          const bad = (f === "k" && !(k >= 1 && k <= n)) || (f === "n" && !(n >= 1)) || (f === "mtbf" && !(+it.mtbf > 0)) || (f === "mttr" && !(+it.mttr >= 0 && it.mttr !== ""));
          inp.classList.toggle("bad", !!bad);
        });
        if (!r) { set("ua", "—"); set("ia", "—"); set("mut", "—"); return; }
        set("ua", pct(r.unitA, 4));
        set("ia", r.saf ? pct(r.A, 5) : "not SAF");
        set("mut", r.saf ? hrs(r.MUT) : "—");
      });
    });
    const iss = $("#issues");
    iss.hidden = !res.issues.length;
    iss.innerHTML = res.issues.length ? "<b>" + res.issues.length + " item(s) left out of the calculation:</b><ul>" + res.issues.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "";
  }

  /* ---------------- FMECA table ---------------- */
  const FCOLS = [["id", "ID", 60], ["item", "Item", 170], ["fn", "Function", 150], ["mode", "Failure mode", 160], ["cause", "Cause", 140], ["local", "Local effect", 150], ["effect", "System effect", 190]];
  const FCOLS2 = [["mitigation", "Mitigation / control", 220], ["owner", "Owner", 110]];
  function renderFmeca() {
    const q = ($("#f-q").value || "").toLowerCase(), act = $("#f-act").checked, sort = $("#f-sort").value, th = model.targets.rpnThreshold;
    let rows = model.fmeca.map((r, i) => ({ r, i }));
    if (q) rows = rows.filter(x => Object.values(x.r).join(" ").toLowerCase().includes(q));
    if (act) rows = rows.filter(x => R.fmecaAction(x.r, th));
    if (sort === "rpn") rows.sort((a, b) => R.rpn(b.r) - R.rpn(a.r));
    if (sort === "S") rows.sort((a, b) => (+b.r.S || 0) - (+a.r.S || 0) || R.rpn(b.r) - R.rpn(a.r));
    const names = []; model.subsystems.forEach(s => s.items.forEach(it => it.name && names.push(it.name)));
    let h = '<thead><tr>' + FCOLS.map(c => "<th>" + c[1] + "</th>").join("") + '<th class="num">S</th><th class="num">O</th><th class="num">D</th><th class="num">RPN</th><th>Action</th>' +
      FCOLS2.map(c => "<th>" + c[1] + "</th>").join("") + "<th>Status</th><th></th></tr></thead><tbody>";
    rows.forEach(({ r, i }) => {
      const a = 'data-fi="' + i + '"';
      h += "<tr>" + FCOLS.map(c => '<td><textarea rows="1" ' + a + ' data-ff="' + c[0] + '" aria-label="' + c[1] + '" style="min-width:' + c[2] + 'px"' + (c[0] === "item" ? ' list="dl-items"' : "") + ">" + esc(r[c[0]]) + "</textarea></td>").join("") +
        ["S", "O", "D"].map(k => '<td><input type="number" min="1" max="10" step="1" value="' + esc(r[k]) + '" ' + a + ' data-ff="' + k + '" aria-label="' + k + '" style="width:56px;min-width:56px"></td>').join("") +
        '<td class="num" id="rpn-' + i + '">' + (R.rpn(r) || "—") + '</td><td id="act-' + i + '">' + actPill(r) + "</td>" +
        FCOLS2.map(c => '<td><textarea rows="1" ' + a + ' data-ff="' + c[0] + '" aria-label="' + c[1] + '" style="min-width:' + c[2] + 'px">' + esc(r[c[0]]) + "</textarea></td>").join("") +
        '<td><select ' + a + ' data-ff="status" aria-label="Status" style="min-width:90px">' + ["Open", "In progress", "Closed"].map(s => "<option" + (s === r.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select></td>" +
        '<td><button class="btn icon sm" data-fdel="' + i + '" title="Delete" aria-label="Delete failure mode">✕</button></td></tr>';
    });
    if (!rows.length) h += '<tr><td colspan="17" class="muted" style="padding:16px">No failure modes' + (q || act ? " match the filter" : "") + ".</td></tr>";
    h += "</tbody>";
    $("#fmeca").innerHTML = h + '<datalist id="dl-items">' + [...new Set(names)].map(n => '<option value="' + esc(n) + '">').join("") + "</datalist>";
    $("#cnt-fmeca").textContent = model.fmeca.length;
    $("#fmeca").querySelectorAll("textarea").forEach(grow);
  }
  function grow(el) { el.style.height = "auto"; el.style.height = Math.max(30, el.scrollHeight + 2) + "px"; }
  function actPill(r) {
    if (!R.rpn(r)) return '<span class="pill na">—</span>';
    return R.fmecaAction(r, model.targets.rpnThreshold) ? '<span class="pill fail">action</span>' : '<span class="pill pass">ok</span>';
  }
  function wireFmeca() {
    const tbl = $("#fmeca");
    const upd = e => {
      const el = e.target, f = el.dataset.ff; if (!f) return;
      const i = +el.dataset.fi, r = model.fmeca[i];
      if (el.tagName === "TEXTAREA") grow(el);
      r[f] = ["S", "O", "D"].includes(f) ? (el.value === "" ? "" : Math.max(1, Math.min(10, Math.round(+el.value)))) : el.value;
      if (["S", "O", "D"].includes(f)) { $("#rpn-" + i).textContent = R.rpn(r) || "—"; $("#act-" + i).innerHTML = actPill(r); }
      schedule();
    };
    tbl.addEventListener("input", upd);
    tbl.addEventListener("change", upd);
    tbl.addEventListener("click", e => { const b = e.target.closest("[data-fdel]"); if (!b) return; model.fmeca.splice(+b.dataset.fdel, 1); renderFmeca(); recompute(); });
    $("#b-addf").addEventListener("click", () => {
      const n = model.fmeca.length + 1;
      model.fmeca.push({ _k: nid("f"), id: "F" + n, item: "", fn: "", mode: "", cause: "", local: "", effect: "", S: 5, O: 5, D: 5, mitigation: "", owner: "", status: "Open" });
      $("#f-q").value = ""; $("#f-act").checked = false; renderFmeca(); recompute();
      const last = tbl.querySelector('tbody tr:last-child textarea[data-ff="item"]'); if (last) last.focus();
    });
    ["#f-q", "#f-act", "#f-sort"].forEach(s => $(s).addEventListener(s === "#f-q" ? "input" : "change", renderFmeca));
  }

  /* ---------------- compute + render results ---------------- */
  function schedule() { clearTimeout(tmr); tmr = setTimeout(recompute, 140); }
  function recompute() {
    res = R.compute(model);
    $("#p-opy").textContent = nf(res.H) + " h";
    updateInline();
    renderResults();
    save();
  }

  function renderResults() {
    const S = res.sys, T = model.targets;
    const anyTarget = S.passA != null || S.passM != null;
    const ok = (S.passA !== false) && (S.passM !== false);
    const tb = $("#tb-result");
    tb.textContent = !anyTarget ? "No targets set" : ok ? "Meets targets" : "Below target";
    tb.style.color = !anyTarget ? "var(--ink-2)" : ok ? "var(--pass)" : "var(--fail)";
    const st = $("#status");
    st.classList.toggle("bad", !!res.issues.length || (anyTarget && !ok));
    st.querySelector("span").textContent = res.issues.length ? res.issues.length + " input issue(s)" : anyTarget ? (ok ? "All targets met" : "Target not met") : "Calculated";
    $("#sum-note").textContent = nf(res.H) + " operating h / year · " + res.subs.length + " subsystems · " + res.subs.reduce((a, s) => a + s.items.length, 0) + " items";

    const kpi = (cls, l, v, s) => '<div class="kpi ' + cls + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>";
    const cl = p => (p == null ? "" : p ? "pass" : "fail");
    $("#kpis").innerHTML =
      kpi(cl(S.passA), "System availability", pct(S.A, 4), S.targetA != null ? "target " + pct(S.targetA, 3) + " " + passPill(S.passA) : "no target set") +
      kpi("", "Downtime per year", mins(S.downMinYr) + '<span style="font-size:16px"> min</span>', "service-affecting, " + nf(res.H) + " h operation") +
      kpi(cl(S.passM), "MTBSAF", hrs(S.MUT) + (isFinite(S.MUT) ? '<span style="font-size:16px"> h</span>' : ""), S.targetM != null ? "target " + nf(S.targetM) + " h " + passPill(S.passM) : "no target set") +
      kpi("", "Mean time to restore", nf(S.MDT, 2) + '<span style="font-size:16px"> h</span>', "equivalent MTTR, service-affecting") +
      kpi("", "Service-affecting failures", nf(S.safYr, 1) + '<span style="font-size:16px"> / yr</span>', "expected per operating year") +
      kpi("", "All failures (maintenance)", nf(S.totalFailuresYr, 0) + '<span style="font-size:16px"> / yr</span>', "including non-service-affecting") +
      kpi("", "Mission reliability", pct(S.Rmission, 2), "no SAF in " + nf(S.mission) + " h, without repair");

    renderRBD(); renderRollup(); renderAlloc(); renderPareto(); renderRel(); renderFmSummary();
  }

  /* ----- RBD ----- */
  function renderRBD() {
    const BW = 250, GAP = 44, HH = 50, IH = 25, PAD = 26;
    const subs = res.subs;
    const heights = subs.map(s => HH + Math.max(1, s.items.filter(i => i.saf).length) * IH + (s.items.some(i => !i.saf) ? IH : 0) + 10);
    const H = Math.max(...heights, 80) + 2 * PAD, W = PAD * 2 + 40 + subs.length * (BW + GAP);
    const y0 = PAD, cy = y0 + HH / 2;
    let g = '<line x1="' + PAD + '" y1="' + cy + '" x2="' + (W - PAD) + '" y2="' + cy + '" style="stroke:var(--ink-3);stroke-width:1.5"/>' +
      '<circle cx="' + PAD + '" cy="' + cy + '" r="5" style="fill:var(--ink)"/><circle cx="' + (W - PAD) + '" cy="' + cy + '" r="5" style="fill:var(--ink)"/>' +
      '<text x="' + PAD + '" y="' + (cy - 12) + '" style="font-size:10px">IN</text><text x="' + (W - PAD - 22) + '" y="' + (cy - 12) + '" style="font-size:10px">OUT</text>';
    subs.forEach((s, i) => {
      const x = PAD + 20 + GAP / 2 + i * (BW + GAP), h = heights[i];
      const col = s.passA == null ? "var(--line-2)" : s.passA ? "var(--pass)" : "var(--fail)";
      g += '<rect x="' + x + '" y="' + y0 + '" width="' + BW + '" height="' + h + '" rx="6" style="fill:var(--panel);stroke:' + col + ';stroke-width:2"/>' +
        '<rect x="' + x + '" y="' + y0 + '" width="' + BW + '" height="' + HH + '" rx="6" style="fill:var(--panel-2)"/>' +
        '<text class="lbl" x="' + (x + 12) + '" y="' + (y0 + 20) + '" style="font-weight:600;font-size:13px">' + esc(trunc(s.name || "Subsystem", 30)) + "</text>" +
        '<text x="' + (x + 12) + '" y="' + (y0 + 38) + '">A ' + pct(s.A, 5) + " · " + mins(s.downMinYr) + " min/yr</text>";
      let yy = y0 + HH + 18;
      const safItems = s.items.filter(it => it.saf);
      if (!safItems.length) { g += '<text x="' + (x + 12) + '" y="' + yy + '">no service-affecting items</text>'; yy += IH; }
      safItems.forEach(it => {
        const cfg = it.k === it.n ? (it.n === 1 ? "1/1" : it.n + "/" + it.n) : it.k + "/" + it.n;
        const red = it.k < it.n;
        g += '<rect x="' + (x + 10) + '" y="' + (yy - 12) + '" width="44" height="17" rx="3" style="fill:' + (red ? "var(--accent-soft)" : "var(--panel-2)") + '"/>' +
          '<text x="' + (x + 32) + '" y="' + (yy + 1) + '" text-anchor="middle" style="fill:' + (red ? "var(--accent)" : "var(--ink-2)") + ';font-weight:600">' + cfg + "</text>" +
          '<text class="lbl" x="' + (x + 62) + '" y="' + (yy + 1) + '">' + esc(trunc(it.name || "Item", 27)) + "</text>";
        yy += IH;
      });
      const non = s.items.filter(it => !it.saf).length;
      if (non) g += '<text x="' + (x + 12) + '" y="' + yy + '" style="fill:var(--ink-3)">+ ' + non + " not service-affecting</text>";
    });
    const cw = $("#rbd").clientWidth || W, fit = W <= cw * 1.6;
    $("#rbd").innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" style="' + (fit ? "width:100%;height:auto" : "min-width:" + W + "px;height:" + H + "px") + '" role="img" aria-label="Reliability block diagram">' + g + "</svg>";
  }

  /* ----- roll-up ----- */
  function renderRollup() {
    const maxShare = Math.max(1e-12, ...res.subs.flatMap(s => s.items.map(i => i.share)));
    let h = '<table><thead><tr><th>Subsystem / item</th><th>Config</th><th class="num">MTBF (h)</th><th class="num">MTTR (h)</th><th>SAF</th><th class="num">Availability</th><th class="num">Downtime (min/yr)</th><th class="num">MTBSAF (h)</th><th class="num">Eq. MTTR (h)</th><th class="num">SAF / yr</th><th class="num">All failures / yr</th><th style="min-width:150px">Share of downtime</th></tr></thead><tbody>';
    res.subs.forEach(s => {
      h += '<tr class="sub"><td colspan="5"><b>' + esc(s.name) + '</b></td><td class="num"><b>' + pct(s.A, 5) + '</b></td><td class="num"><b>' + mins(s.downMinYr) + '</b></td><td class="num"><b>' + hrs(s.MUT) + '</b></td><td class="num">' + nf(s.MDT, 2) + '</td><td class="num">' + nf(s.safYr, 2) + '</td><td class="num">' + nf(s.items.reduce((a, i) => a + i.failuresYr, 0), 1) + '</td><td class="inbar"><span class="mono">' + nf(s.share * 100, 1) + " %</span></td></tr>";
      s.items.forEach(it => {
        h += '<tr class="' + (it.saf ? "" : "nonsaf") + '"><td style="padding-left:20px">' + esc(it.name) + '</td><td><span class="cfg">' + (it.k === it.n ? (it.n === 1 ? "single" : it.n + " series") : it.k + "oo" + it.n) + '</span></td><td class="num">' + nf(it.mtbf) + '</td><td class="num">' + nf(it.mttr, 1) + "</td><td>" + (it.saf ? "Y" : "N") + "</td>" +
          '<td class="num">' + (it.saf ? pct(it.A, 5) : "—") + '</td><td class="num">' + (it.saf ? mins(it.downMinYr) : "—") + '</td><td class="num">' + (it.saf ? hrs(it.MUT) : "—") + '</td><td class="num">' + (it.saf ? nf(it.MDT, 2) : "—") + '</td><td class="num">' + (it.saf ? nf(it.safYr, 3) : "—") + '</td><td class="num">' + nf(it.failuresYr, 1) + "</td>" +
          '<td class="inbar"><span class="mono">' + (it.saf ? nf(it.share * 100, 1) + " %" : "") + '</span><i style="width:' + ((it.share / maxShare) * 90).toFixed(1) + 'px"></i></td></tr>';
      });
    });
    const S = res.sys;
    h += '</tbody><tbody class="tfoot"><tr><td colspan="5">System</td><td class="num">' + pct(S.A, 5) + '</td><td class="num">' + mins(S.downMinYr) + '</td><td class="num">' + hrs(S.MUT) + '</td><td class="num">' + nf(S.MDT, 2) + '</td><td class="num">' + nf(S.safYr, 2) + '</td><td class="num">' + nf(S.totalFailuresYr, 1) + '</td><td class="mono">100 %</td></tr></tbody></table>';
    $("#rollup").innerHTML = h;
  }

  /* ----- allocation ----- */
  const METHOD = { arinc: "ARINC — proportional to current failure rate", equal: "Equal apportionment", weighted: "Weighted by subsystem weights" };
  function renderAlloc() {
    const a = res.alloc;
    $("#alloc-note").textContent = METHOD[a.method] + (a.AT != null ? " · target " + pct(a.AT, 3) : "") + (a.MT != null ? " · MTBSAF " + nf(a.MT) + " h" : "");
    let h = '<table><thead><tr><th>Subsystem</th><th class="num">Weight</th><th class="num">Allocated A</th><th class="num">Achieved A</th><th class="num">Allocated MTBSAF</th><th class="num">Achieved MTBSAF</th><th>Result</th></tr></thead><tbody>';
    res.subs.forEach(s => {
      const both = [s.passA, s.passM].filter(x => x != null);
      const p = both.length ? both.every(Boolean) : null;
      h += "<tr><td>" + esc(s.name) + '</td><td class="num">' + nf(s.alloc.w, 3) + '</td><td class="num">' + (s.alloc.A == null ? "—" : pct(s.alloc.A, 5)) + '</td><td class="num">' + pct(s.A, 5) + '</td><td class="num">' + (s.alloc.MUT == null ? "—" : hrs(s.alloc.MUT)) + '</td><td class="num">' + hrs(s.MUT) + "</td><td>" + passPill(p) + "</td></tr>";
    });
    h += "</tbody></table>";
    $("#alloc").innerHTML = h;

    // chart: downtime vs budget
    const svg = $("#alloc-chart"), W = Math.max(320, svg.clientWidth || 520), L = 150, RW = 60, rowH = 34, top = 18;
    const rows = res.subs.map(s => ({ name: s.name, v: s.downMinYr, b: s.alloc.A == null ? null : (1 - s.alloc.A) * res.H * 60, pass: s.passA }));
    const max = Math.max(1e-9, ...rows.map(r => Math.max(r.v, r.b || 0))) * 1.08;
    const H = top + rows.length * rowH + 30, sx = v => L + (v / max) * (W - L - RW);
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = (max / 4) * i, x = sx(v); g += '<line class="gr" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (H - 24) + '"/><text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle">' + (v === 0 ? "0" : mins(v)) + "</text>"; }
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      g += '<text class="lbl" x="' + (L - 8) + '" y="' + (y + 17) + '" text-anchor="end">' + esc(trunc(r.name || "", 20)) + "</text>" +
        '<rect x="' + L + '" y="' + (y + 6) + '" width="' + Math.max(1, sx(r.v) - L) + '" height="16" rx="2" style="fill:' + (r.pass === false ? "var(--fail)" : r.pass ? "var(--pass)" : "var(--bar)") + '"/>' +
        '<text x="' + (sx(r.v) + 5) + '" y="' + (y + 18) + '">' + mins(r.v) + "</text>";
      if (r.b != null) g += '<line x1="' + sx(r.b) + '" y1="' + (y + 2) + '" x2="' + sx(r.b) + '" y2="' + (y + 26) + '" style="stroke:var(--ink);stroke-width:2.5"/>';
    });
    g += '<text x="' + L + '" y="11" style="fill:var(--ink-3)">downtime min / year · black tick = allocated budget</text>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  /* ----- pareto ----- */
  function renderPareto() {
    const items = res.subs.flatMap(s => s.items.filter(i => i.saf && i.share >= 0.001).map(i => ({ name: i.name, sub: s.name, v: i.share, m: i.downMinYr })))
      .sort((a, b) => b.v - a.v).slice(0, 12);
    const svg = $("#pareto"), W = Math.max(340, svg.clientWidth || 900), L = Math.min(340, W * 0.42), rowH = 26, top = 6;
    const H = top + Math.max(1, items.length) * rowH + 8, max = Math.max(1e-12, ...items.map(i => i.v));
    let g = "";
    if (!items.length) g = '<text x="10" y="20">No service-affecting downtime.</text>';
    items.forEach((it, i) => {
      const y = top + i * rowH, w = (it.v / max) * (W - L - 130);
      g += '<text class="lbl" x="' + (L - 8) + '" y="' + (y + 16) + '" text-anchor="end">' + esc(trunc(it.name, 38)) + ' <tspan style="fill:var(--ink-3);font-size:11px">' + esc(trunc(it.sub, 18)) + "</tspan></text>" +
        '<rect x="' + L + '" y="' + (y + 5) + '" width="' + Math.max(1, w) + '" height="15" rx="2" style="fill:var(--bar)"/>' +
        '<text x="' + (L + w + 6) + '" y="' + (y + 17) + '">' + nf(it.v * 100, 1) + " % · " + mins(it.m) + " min/yr</text>";
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  /* ----- reliability curve ----- */
  function renderRel() {
    const subs = res.subs, mis = res.sys.mission || 0;
    let tmax = Math.max(mis, 1);
    while (R.reliability(subs, tmax) > 0.05 && tmax < 1e7) tmax *= 2;
    const svg = $("#relchart"), W = Math.max(340, svg.clientWidth || 900), H = 240, L = 50, Rm = 20, T = 14, B = 34;
    const sx = t => L + (t / tmax) * (W - L - Rm), sy = r => T + (1 - r) * (H - T - B);
    let g = "";
    [0, 0.25, 0.5, 0.75, 1].forEach(r => { g += '<line class="gr" x1="' + L + '" y1="' + sy(r) + '" x2="' + (W - Rm) + '" y2="' + sy(r) + '"/><text x="' + (L - 6) + '" y="' + (sy(r) + 4) + '" text-anchor="end">' + r * 100 + "%</text>"; });
    for (let i = 0; i <= 5; i++) { const t = (tmax / 5) * i; g += '<text x="' + sx(t) + '" y="' + (H - 14) + '" text-anchor="middle">' + (t === 0 ? "0" : nf(t, t < 10 ? 1 : 0)) + "</text>"; }
    g += '<text x="' + (W - Rm) + '" y="' + (H - 1) + '" text-anchor="end" style="fill:var(--ink-3)">operating hours without repair</text>';
    let d = "";
    for (let i = 0; i <= 160; i++) { const t = (tmax / 160) * i; d += (i ? "L" : "M") + sx(t).toFixed(1) + " " + sy(R.reliability(subs, t)).toFixed(1); }
    g += '<path d="' + d + '" style="fill:none;stroke:var(--bar);stroke-width:2.2"/>';
    if (mis > 0 && mis <= tmax) {
      const rm = res.sys.Rmission;
      g += '<line x1="' + sx(mis) + '" y1="' + T + '" x2="' + sx(mis) + '" y2="' + (H - B) + '" style="stroke:var(--accent);stroke-dasharray:4 3"/><circle cx="' + sx(mis) + '" cy="' + sy(rm) + '" r="4.5" style="fill:var(--accent)"/>' +
        '<text x="' + (sx(mis) + 10) + '" y="' + (sy(rm) + (rm > 0.5 ? 34 : -10)) + '" style="fill:var(--accent);font-weight:600;paint-order:stroke;stroke:var(--panel);stroke-width:5px">R(' + nf(mis) + " h) = " + pct(rm, 2) + "</text>";
    }
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = g;
  }

  /* ----- FMECA summary ----- */
  function renderFmSummary() {
    const th = model.targets.rpnThreshold, fm = model.fmeca.filter(r => R.rpn(r));
    const act = fm.filter(r => R.fmecaAction(r, th)), open = act.filter(r => r.status !== "Closed");
    $("#fm-note").textContent = model.fmeca.length + " failure modes · " + act.length + " need action · " + open.length + " of those still open";
    const cnt = {}; fm.forEach(r => { const k = (+r.S) + "-" + (+r.O); cnt[k] = (cnt[k] || 0) + 1; });
    const heatCol = (S, O) => { const z = S * O; return z >= 56 ? "var(--heat4)" : z >= 36 ? "var(--heat3)" : z >= 20 ? "var(--heat2)" : z >= 9 ? "var(--heat1)" : "var(--heat0)"; };
    let h = '<div class="heat">';
    for (let S = 10; S >= 1; S--) {
      h += '<div class="ax">' + S + "</div>";
      for (let O = 1; O <= 10; O++) { const c = cnt[S + "-" + O] || 0; h += '<div style="background:' + heatCol(S, O) + ";" + (c ? "font-weight:700;color:var(--ink);outline:2px solid var(--ink);outline-offset:-2px" : "color:transparent") + '" title="S ' + S + " · O " + O + ": " + c + '">' + (c || "") + "</div>"; }
    }
    h += '<div class="ax"></div>' + Array.from({ length: 10 }, (_, i) => '<div class="ax">' + (i + 1) + "</div>").join("") + "</div>" +
      '<div class="muted" style="font-size:12px;margin-top:6px">rows: severity S (10 = worst) · columns: occurrence O</div>';
    $("#heat").innerHTML = h;
    const top = fm.slice().sort((a, b) => R.rpn(b) - R.rpn(a)).slice(0, 8);
    $("#fm-top").innerHTML = '<table><thead><tr><th>ID</th><th>Item · failure mode</th><th class="num">S</th><th class="num">RPN</th><th>Action</th><th>Status</th></tr></thead><tbody>' +
      (top.length ? top.map(r => "<tr><td>" + esc(r.id) + "</td><td>" + esc(r.item) + ' · <span class="muted">' + esc(r.mode) + '</span></td><td class="num">' + esc(r.S) + '</td><td class="num">' + R.rpn(r) + "</td><td>" + actPill(r) + "</td><td>" + esc(r.status) + "</td></tr>").join("") : '<tr><td colspan="6" class="muted">No failure modes scored yet.</td></tr>') + "</tbody></table>";
  }

  /* ----- verification (independent of the model) ----- */
  let tests = [];
  function renderVerify() {
    tests = window.RAMS_TESTS.run();
    const pass = tests.filter(t => t.pass).length;
    $("#ver-note").textContent = pass + " of " + tests.length + " checks pass";
    $("#ver-note").style.color = pass === tests.length ? "var(--pass)" : "var(--fail)";
    const fmt = v => (Math.abs(v) >= 1000 ? nf(v, 3) : Number(v).toPrecision(10));
    $("#verify").innerHTML = '<p class="muted" style="margin:0 0 10px">Each check compares the engine with an independent result: a closed-form expression, a Markov chain, or a brute-force enumeration of every up/down state of every unit.</p>' +
      '<table><thead><tr><th>Case</th><th>Check</th><th class="num">Independent</th><th class="num">Engine</th><th class="num">Rel. difference</th><th>Independent method</th><th>Result</th></tr></thead><tbody>' +
      tests.map(t => { const d = Math.abs(t.expected - t.got) / Math.max(Math.abs(t.expected), 1e-300); return "<tr><td>" + esc(t.group) + "</td><td>" + esc(t.name) + '</td><td class="num">' + fmt(t.expected) + '</td><td class="num">' + fmt(t.got) + '</td><td class="num">' + (d === 0 ? "0" : d.toExponential(1)) + '</td><td class="muted">' + esc(t.how) + "</td><td>" + (t.pass ? '<span class="pill pass">pass</span>' : '<span class="pill fail">fail</span>') + "</td></tr>"; }).join("") +
      "</tbody></table>";
  }

  /* ---------------- Excel ---------------- */
  const EQ_HEAD = ["Subsystem", "Item", "Qty (n)", "Required (k)", "MTBF (h)", "MTTR (h)", "Service affecting (Y/N)", "Subsystem weight", "Note"];
  const FM_HEAD = ["ID", "Item", "Function", "Failure mode", "Cause", "Local effect", "System effect", "S", "O", "D", "Mitigation", "Owner", "Status"];
  const FM_KEYS = ["id", "item", "fn", "mode", "cause", "local", "effect", "S", "O", "D", "mitigation", "owner", "status"];
  const PJ = [["Project", "p", "name"], ["System", "p", "system"], ["Document ref", "p", "docRef"], ["Operating hours per day", "p", "hoursPerDay"], ["Operating days per year", "p", "daysPerYear"], ["Mission time (h)", "p", "missionHours"],
    ["Target availability (%)", "t", "availability"], ["Target MTBSAF (h)", "t", "mtbsaf"], ["Allocation method (arinc/equal/weighted)", "t", "allocation"], ["FMECA RPN threshold", "t", "rpnThreshold"]];

  function needX() { if (!window.XLSX) { toast("The Excel library did not load — check the internet connection."); return false; } return true; }
  function inputSheets(wb) {
    const pj = [["Field", "Value"]].concat(PJ.map(r => [r[0], (r[1] === "p" ? model.project : model.targets)[r[2]]]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pj), "Project");
    const eq = [EQ_HEAD]; model.subsystems.forEach(s => s.items.forEach(it => eq.push([s.name, it.name, it.n, it.k, it.mtbf, it.mttr, it.saf ? "Y" : "N", s.weight, it.note])));
    const ws = XLSX.utils.aoa_to_sheet(eq); ws["!cols"] = [{ wch: 24 }, { wch: 36 }, { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 10 }, { wch: 20 }, { wch: 16 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, "Equipment");
    const fm = [FM_HEAD.concat(["RPN"])]; model.fmeca.forEach(r => fm.push(FM_KEYS.map(k => r[k]).concat([R.rpn(r) || ""])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fm), "FMECA");
  }
  function fileBase() { return (model.project.docRef || "RAMS").replace(/[^\w.-]+/g, "_"); }

  function exportTemplate() {
    if (!needX()) return;
    const wb = XLSX.utils.book_new(); inputSheets(wb);
    const help = [["Rail-IQ RAMS input template"], [""], ["Equipment sheet: one row per item. Qty (n) = units installed; Required (k) = units needed for service."], ["k = n means all units in series; k < n means redundancy (e.g. n=2, k=1 is 1oo2). A 'Redundancy' column like 2oo3 is also accepted."],
      ["MTBF and MTTR in hours. Instead of MTBF you may give 'Failure rate (per 10^6 h)' or 'Failure rate (FIT)'."], ["Service affecting Y/N: N items count only towards maintenance failures."], ["FMECA sheet: S, O, D on 1-10 scales. RPN is calculated."], ["Project sheet: operating profile and targets."]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), "Read me");
    XLSX.writeFile(wb, fileBase() + "_RAMS_inputs.xlsx");
    toast("Template saved with the current inputs");
  }

  function exportResults() {
    if (!needX()) return;
    const wb = XLSX.utils.book_new(), S = res.sys;
    const sum = [["Rail-IQ RAMS results"], ["Project", model.project.name], ["System", model.project.system], ["Document ref", model.project.docRef], ["Date", new Date().toISOString().slice(0, 10)], [""],
      ["Operating hours per year", res.H], ["System availability", S.A], ["Target availability", S.targetA ?? ""], ["Availability result", S.passA == null ? "no target" : S.passA ? "pass" : "below target"],
      ["Downtime (min / year)", S.downMinYr], ["MTBSAF (h)", isFinite(S.MUT) ? S.MUT : ""], ["Target MTBSAF (h)", S.targetM ?? ""], ["MTBSAF result", S.passM == null ? "no target" : S.passM ? "pass" : "below target"],
      ["Equivalent MTTR (h)", S.MDT], ["Service-affecting failures / year", S.safYr], ["All failures / year", S.totalFailuresYr], ["Mission time (h)", S.mission], ["Mission reliability", S.Rmission],
      ["Allocation method", METHOD[res.alloc.method]], ["Verification checks passed", tests.filter(t => t.pass).length + " of " + tests.length]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
    const ru = [["Subsystem", "Item", "Qty (n)", "Required (k)", "MTBF (h)", "MTTR (h)", "SAF", "Availability", "Downtime (min/yr)", "MTBSAF (h)", "Eq. MTTR (h)", "SAF / yr", "All failures / yr", "Share of downtime"]];
    res.subs.forEach(s => {
      ru.push([s.name, "(subsystem)", "", "", "", "", "", s.A, s.downMinYr, isFinite(s.MUT) ? s.MUT : "", s.MDT, s.safYr, s.items.reduce((a, i) => a + i.failuresYr, 0), s.share]);
      s.items.forEach(it => ru.push([s.name, it.name, it.n, it.k, it.mtbf, it.mttr, it.saf ? "Y" : "N", it.saf ? it.A : "", it.saf ? it.downMinYr : "", it.saf && isFinite(it.MUT) ? it.MUT : "", it.saf ? it.MDT : "", it.saf ? it.safYr : "", it.failuresYr, it.share]));
    });
    ru.push(["System", "", "", "", "", "", "", S.A, S.downMinYr, isFinite(S.MUT) ? S.MUT : "", S.MDT, S.safYr, S.totalFailuresYr, 1]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ru), "Roll-up");
    const al = [["Subsystem", "Weight", "Allocated A", "Achieved A", "Allocated MTBSAF (h)", "Achieved MTBSAF (h)", "Availability result", "MTBSAF result"]];
    res.subs.forEach(s => al.push([s.name, s.alloc.w, s.alloc.A ?? "", s.A, s.alloc.MUT ?? "", isFinite(s.MUT) ? s.MUT : "", s.passA == null ? "" : s.passA ? "pass" : "below", s.passM == null ? "" : s.passM ? "pass" : "below"]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(al), "Allocation");
    inputSheets(wb);
    const ve = [["Case", "Check", "Independent", "Engine", "Method", "Result"]]; tests.forEach(t => ve.push([t.group, t.name, t.expected, t.got, t.how, t.pass ? "pass" : "FAIL"]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ve), "Verification");
    XLSX.writeFile(wb, fileBase() + "_RAMS_results.xlsx");
    toast("Results workbook saved");
  }

  /* import: sheets recognised by their headers */
  const EQ_MAP = [
    ["sub", /^sub ?-?system|^system\b|^group|^subsys/], ["saf", /service|^saf\b|affect/], ["mtbf", /mtbf|mean time between/], ["lam", /failure ?rate|lambda|λ|fpmh|\bfit\b/],
    ["mttr", /mttr|restore|repair|\bmdt\b|down ?time/], ["n", /qty|quantity|installed|^n\b|\(n\)|no\.? of units|number of units/], ["k", /required|needed|\(k\)|^k\b/],
    ["red", /redundan|config|architecture|voting/], ["w", /weight/], ["note", /note|remark|comment/], ["item", /item|equipment|component|description|^name|unit/]
  ];
  function mapHeader(row, table) {
    const m = {};
    row.forEach((c, i) => {
      const h = String(c).trim().toLowerCase(); if (!h) return;
      for (const [k, re] of table) if (m[k] == null && re.test(h)) { m[k] = i; m[k + "_h"] = h; break; }
    });
    return m;
  }
  function findHeader(rows, ok, table) {
    for (let r = 0; r < Math.min(20, rows.length); r++) { const m = mapHeader(rows[r], table); if (ok(m)) return { r, m }; }
    return null;
  }
  const FM_MAP = [["mode", /failure ?mode|^mode/], ["S", /^s$|^sev|severity/], ["O", /^o$|^occ|occurrence/], ["D", /^d$|^det|detection/], ["id", /^id$|^ref|^no\.?$/], ["effect", /system effect|end effect|global effect/],
    ["local", /local effect/], ["cause", /cause|mechanism/], ["fn", /function/], ["mitigation", /mitigation|control|action|recommend/], ["owner", /owner|responsib/], ["status", /status/], ["item", /item|equipment|component|subsystem/]];

  function importWorkbook(wb) {
    let nEq = 0, nFm = 0, nPj = 0;
    wb.SheetNames.forEach(name => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
      if (!rows.length) return;
      if (/project/i.test(name)) {
        rows.forEach(r => { const f = String(r[0]).trim().toLowerCase(); const hit = PJ.find(p => p[0].toLowerCase() === f); if (hit && r[1] !== "") { (hit[1] === "p" ? model.project : model.targets)[hit[2]] = typeof r[1] === "number" ? r[1] : (/^[\d.]+$/.test(String(r[1]).trim()) ? +r[1] : String(r[1]).trim()); nPj++; } });
        return;
      }
      const eq = findHeader(rows, m => m.item != null && (m.mtbf != null || m.lam != null) && m.mttr != null, EQ_MAP);
      if (eq && !nEq) {
        const m = eq.m, subs = [], byName = {};
        let lastSub = "General";
        for (let r = eq.r + 1; r < rows.length; r++) {
          const row = rows[r], item = String(row[m.item] ?? "").trim(); if (!item) continue;
          if (m.sub != null && String(row[m.sub]).trim()) lastSub = String(row[m.sub]).trim();
          let n = m.n != null && row[m.n] !== "" ? +row[m.n] : NaN, k = m.k != null && row[m.k] !== "" ? +row[m.k] : NaN;
          if (m.red != null) { const x = /(\d+)\s*o\s*o\s*(\d+)/i.exec(String(row[m.red])); if (x) { k = +x[1]; n = +x[2]; } }
          if (!(n >= 1)) n = 1; if (!(k >= 1)) k = n;
          let mtbf = m.mtbf != null && row[m.mtbf] !== "" ? +row[m.mtbf] : NaN;
          if (!(mtbf > 0) && m.lam != null && +row[m.lam] > 0) {
            const lh = m.lam_h, lv = +row[m.lam];
            mtbf = /\bfit\b/.test(lh) ? 1e9 / lv : /per ?h(ou)?r?\b|\/ ?h\b/.test(lh) && !/10/.test(lh) ? 1 / lv : 1e6 / lv;
          }
          const saf = m.saf == null ? true : !/^(n|no|false|0)$/i.test(String(row[m.saf]).trim());
          if (!byName[lastSub]) { byName[lastSub] = { id: nid("s"), name: lastSub, weight: m.w != null && row[m.w] !== "" ? +row[m.w] : 1, items: [] }; subs.push(byName[lastSub]); }
          byName[lastSub].items.push({ id: nid("i"), name: item, n, k, mtbf: isFinite(mtbf) ? +mtbf.toPrecision(10) : "", mttr: row[m.mttr] === "" ? "" : +row[m.mttr], saf, note: m.note != null ? String(row[m.note]) : "" });
          nEq++;
        }
        if (nEq) model.subsystems = subs;
        return;
      }
      const fm = findHeader(rows, m => m.mode != null && m.S != null, FM_MAP);
      if (fm && !nFm) {
        const out = [];
        for (let r = fm.r + 1; r < rows.length; r++) {
          const row = rows[r]; if (!String(row[fm.m.mode] ?? "").trim()) continue;
          const o = { _k: nid("f"), id: "", item: "", fn: "", mode: "", cause: "", local: "", effect: "", S: "", O: "", D: "", mitigation: "", owner: "", status: "Open" };
          FM_MAP.forEach(([k]) => { if (fm.m[k] != null) o[k] = ["S", "O", "D"].includes(k) ? (row[fm.m[k]] === "" ? "" : Math.max(1, Math.min(10, Math.round(+row[fm.m[k]])))) : String(row[fm.m[k]]).trim(); });
          if (!["Open", "In progress", "Closed"].includes(o.status)) o.status = /clos/i.test(o.status) ? "Closed" : /prog/i.test(o.status) ? "In progress" : "Open";
          if (!o.id) o.id = "F" + (out.length + 1);
          out.push(o);
        }
        if (out.length) { model.fmeca = out; nFm = out.length; }
      }
    });
    return { nEq, nFm, nPj };
  }

  function readFile(file, asText) {
    return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; asText ? r.readAsText(file) : r.readAsArrayBuffer(file); });
  }
  function refreshAll() { fillProject(); renderEquip(); renderFmeca(); recompute(); }

  function download(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wireActions() {
    $("#b-import").onclick = () => { if (needX()) $("#f-xlsx").click(); };
    $("#f-xlsx").onchange = async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try {
        const wb = XLSX.read(await readFile(f), { type: "array" });
        const r = importWorkbook(wb);
        if (!r.nEq && !r.nFm && !r.nPj) { toast("No equipment, FMECA or project sheet recognised — see the template headers."); return; }
        refreshAll();
        toast("Imported " + [r.nEq && r.nEq + " items", r.nFm && r.nFm + " failure modes", r.nPj && r.nPj + " project fields"].filter(Boolean).join(", ") + " from " + f.name);
      } catch (err) { toast("Could not read " + f.name + ": " + err.message); }
    };
    $("#b-template").onclick = exportTemplate;
    $("#b-export").onclick = exportResults;
    $("#b-json").onclick = () => download(fileBase() + "_RAMS_inputs.json", JSON.stringify(model, (k, v) => (k === "_k" ? undefined : v), 2), "application/json");
    $("#b-jsonin").onclick = () => $("#f-json").click();
    $("#f-json").onchange = async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try { const m = JSON.parse(await readFile(f, true)); if (!Array.isArray(m.subsystems)) throw new Error("not a Rail-IQ RAMS inputs file"); model = normalise(m); refreshAll(); toast("Opened " + f.name); }
      catch (err) { toast("Could not open " + f.name + ": " + err.message); }
    };
    $("#b-print").onclick = () => window.print();
    $("#b-sample").onclick = () => { if (confirm("Replace all inputs with the sample model?")) { model = normalise(window.RAMS_SAMPLE()); refreshAll(); toast("Sample model loaded"); } };
    document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === t));
      document.querySelectorAll('[role="tabpanel"]').forEach(p => (p.hidden = p.id !== t.dataset.tab));
      if (t.dataset.tab === "t-fmeca") $("#fmeca").querySelectorAll("textarea").forEach(grow);
    }));
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => res && renderResults(), 150); });
  }

  /* ---------------- start ---------------- */
  model = load();
  wireProject(); wireEquip(); wireFmeca(); wireActions();
  fillProject(); renderEquip(); renderFmeca();
  renderVerify();
  recompute();
})();
