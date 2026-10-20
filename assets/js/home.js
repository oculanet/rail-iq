/* Rail-IQ home page: builds stats, discipline tiles, filters, cards and the detail drawer from RAILIQ_CATALOG. */
(function () {
  "use strict";
  const R = window.RailIQ, CAT = window.RAILIQ_CATALOG, DOM = window.RAILIQ_DOMAINS, DIS = window.RAILIQ_DISCIPLINES;
  const $ = s => document.querySelector(s);
  const esc = R.esc;

  const STATUS_ORDER = { live: 0, beta: 1, planned: 2 };
  const state = { q: "", domain: null, discipline: null, status: "all", sort: "status" };

  /* ---------- URL hash <-> state ---------- */
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    state.q = h.get("q") || "";
    state.domain = DOM[h.get("domain")] ? h.get("domain") : null;
    state.discipline = DIS[h.get("discipline")] ? h.get("discipline") : null;
    state.status = ["all", "live", "planned"].includes(h.get("status")) ? h.get("status") : "all";
    return h.get("m");
  }
  function writeHash() {
    const h = new URLSearchParams();
    if (state.q) h.set("q", state.q);
    if (state.domain) h.set("domain", state.domain);
    if (state.discipline) h.set("discipline", state.discipline);
    if (state.status !== "all") h.set("status", state.status);
    const s = h.toString();
    try { history.replaceState(null, "", s ? "#" + s : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }

  /* ---------- stats ---------- */
  function countUp(el, to) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.textContent = to; return; }
    const t0 = performance.now(), d = 900;
    (function f(t) { const u = Math.min(1, (t - t0) / d); el.textContent = Math.round(to * (1 - Math.pow(1 - u, 3))); if (u < 1) requestAnimationFrame(f); })(t0);
  }
  function renderStats() {
    const live = CAT.filter(R.isOpenable).length;
    const vals = { live, pipe: CAT.length - live, disc: Object.keys(DIS).length, dom: Object.keys(DOM).length };
    document.querySelectorAll("[data-stat]").forEach(el => countUp(el, vals[el.dataset.stat]));
  }

  /* ---------- discipline tiles ---------- */
  function renderDisciplines() {
    const box = $("#disc");
    box.innerHTML = Object.entries(DIS).map(([k, d]) => {
      const all = CAT.filter(m => m.discipline === k), live = all.filter(R.isOpenable).length;
      return '<button class="dtile" data-disc="' + k + '" aria-pressed="' + (state.discipline === k) + '">' + R.icon(d.icon) +
        "<b>" + esc(d.label) + '</b><span class="cnt">' + live + " live · " + (all.length - live) + ' planned</span><span class="bar"><i style="width:' + (all.length ? (100 * live) / all.length : 0) + '%"></i></span></button>';
    }).join("");
    box.onclick = e => {
      const b = e.target.closest("[data-disc]"); if (!b) return;
      state.discipline = state.discipline === b.dataset.disc ? null : b.dataset.disc;
      update(true);
    };
  }

  /* ---------- toolbar ---------- */
  function renderChips() {
    const box = $("#domchips");
    box.innerHTML = '<button class="chip" data-dom="" aria-pressed="' + !state.domain + '">All domains</button>' +
      Object.entries(DOM).map(([k, d]) => {
        const n = CAT.filter(m => (m.domains || []).includes(k)).length;
        return '<button class="chip" data-dom="' + k + '" style="--c:' + d.color + '" aria-pressed="' + (state.domain === k) + '"><i></i>' + esc(d.label) + ' <span class="mono" style="opacity:.6">' + n + "</span></button>";
      }).join("");
    document.querySelectorAll("#statseg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.status === state.status));
    document.querySelectorAll("#disc .dtile").forEach(b => b.setAttribute("aria-pressed", b.dataset.disc === state.discipline));
    document.querySelectorAll("#netlegend button").forEach(b => b.setAttribute("aria-pressed", b.dataset.dom === state.domain));
  }

  /* ---------- cards ---------- */
  function matches(m) {
    if (state.domain && !(m.domains || []).includes(state.domain)) return false;
    if (state.discipline && m.discipline !== state.discipline) return false;
    if (state.status === "live" && !R.isOpenable(m)) return false;
    if (state.status === "planned" && R.isOpenable(m)) return false;
    if (state.q) {
      const hay = [m.title, m.summary, m.description, (DIS[m.discipline] || {}).label, (m.domains || []).map(d => (DOM[d] || {}).label).join(" "), (m.standards || []).join(" "), (m.features || []).join(" ")].join(" ").toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t))) return false;
    }
    return true;
  }
  function card(m, i) {
    const d = DIS[m.discipline] || { label: m.discipline, icon: "grid" };
    const open = R.isOpenable(m);
    const doms = (m.domains || []).map(k => DOM[k]).filter(Boolean);
    return '<article class="card ' + (open ? "" : "planned") + '" style="animation-delay:' + Math.min(i, 12) * 35 + 'ms" data-id="' + m.id + '">' +
      '<div class="rail">' + doms.map(x => '<i style="--c:' + x.color + '"></i>').join("") + "</div>" +
      '<div class="body"><div class="top"><span class="ico">' + R.icon(d.icon) + '</span><span class="disc-l">' + esc(d.label) + '</span><span class="pill ' + m.status + '">' + (m.status === "planned" ? "Pipeline" : m.status) + "</span></div>" +
      "<h3>" + esc(m.title) + "</h3><p>" + esc(m.summary) + "</p>" +
      '<div class="doms">' + doms.map(x => '<span class="dom" style="--c:' + x.color + '"><i></i>' + esc(x.label) + "</span>").join("") + "</div>" +
      ((m.standards || []).length ? '<div class="stds">' + m.standards.map(esc).join(" · ") + "</div>" : "") + "</div>" +
      '<footer><span class="meta">' + (open ? esc(m.version || "") + (m.updated ? " · " + esc(m.updated) : "") : "In the Rail-IQ pipeline") + "</span>" +
      '<button class="btn sm ghost" data-details="' + m.id + '">' + R.icon("info") + "Details</button>" +
      (open ? '<a class="btn sm primary" href="' + R.launchUrl(m) + '">' + R.icon("play") + "Launch</a>" : "") + "</footer></article>";
  }
  function renderCards() {
    const list = CAT.filter(matches).sort((a, b) =>
      state.sort === "name" ? a.title.localeCompare(b.title) :
      state.sort === "updated" ? String(b.updated || "").localeCompare(String(a.updated || "")) :
      (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.title.localeCompare(b.title));
    $("#grid").innerHTML = list.length ? list.map(card).join("") :
      '<div class="empty">No simulator matches these filters. <button class="btn sm" id="clear2" style="margin-left:8px">Clear filters</button></div>';
    const parts = [];
    if (state.domain) parts.push(DOM[state.domain].label);
    if (state.discipline) parts.push(DIS[state.discipline].label);
    if (state.status !== "all") parts.push(state.status === "live" ? "Live" : "Pipeline");
    if (state.q) parts.push("“" + state.q + "”");
    $("#resultline").innerHTML = "<span>" + list.length + " of " + CAT.length + " simulators" + (parts.length ? " · " + parts.map(esc).join(" · ") : "") + "</span>" +
      (parts.length ? '<button id="clear">clear</button>' : "");
  }

  /* ---------- recent ---------- */
  function renderRecent() {
    const r = R.recent(), box = $("#recent");
    if (!r.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<span class="lbl">Recently opened</span>' + r.map(x => {
      const m = R.byId(x.id);
      return '<a href="' + R.launchUrl(m) + '">' + R.icon((DIS[m.discipline] || {}).icon || "grid", 'width="16" height="16"') + esc(m.title) + " <small>" + R.ago(x.t) + "</small></a>";
    }).join("");
  }

  /* ---------- drawer ---------- */
  const scrim = $("#scrim"), drawer = $("#drawer");
  let lastFocus = null;
  function openDrawer(m) {
    lastFocus = document.activeElement;
    const d = DIS[m.discipline] || { label: m.discipline, icon: "grid" }, open = R.isOpenable(m);
    drawer.innerHTML =
      '<div class="dh"><div style="flex:1;min-width:0"><span class="pill ' + m.status + '">' + (m.status === "planned" ? "Pipeline" : m.status) + '</span> <span class="mono" style="font-size:12px;color:var(--ink-3);margin-left:6px">' + esc(d.label) + (m.version ? " · " + esc(m.version) : "") + "</span>" +
      '<h3 id="drawer-title">' + esc(m.title) + '</h3></div><button class="iconbtn" id="dclose" aria-label="Close">' + R.icon("close") + "</button></div>" +
      '<div class="db"><p>' + esc(m.description || m.summary) + "</p>" +
      ((m.features || []).length ? '<div><h5>' + (open ? "What it does" : "Planned scope") + '</h5><ul class="feat">' + m.features.map(f => "<li>" + esc(f) + "</li>").join("") + "</ul></div>" : "") +
      ((m.outputs || []).length ? '<div><h5>Outputs</h5><div class="tags">' + m.outputs.map(o => '<span class="tag">' + esc(o) + "</span>").join("") + "</div></div>" : "") +
      '<div><h5>Applies to</h5><div class="tags">' + (m.domains || []).map(k => DOM[k] ? '<span class="dom" style="--c:' + DOM[k].color + '"><i></i>' + esc(DOM[k].label) + "</span>" : "").join("") + "</div></div>" +
      ((m.standards || []).length ? '<div><h5>Reference standards</h5><div class="tags">' + m.standards.map(s => '<span class="tag mono">' + esc(s) + "</span>").join("") + "</div></div>" : "") +
      ((m.resources || []).length ? '<div class="res"><h5>Files & resources</h5>' + m.resources.map(r => '<a href="' + esc(r.href) + '" target="_blank" rel="noopener"><span>' + esc(r.label) + "</span>" + R.icon("ext", 'width="15" height="15"') + "</a>").join("") + "</div>" : "") +
      "</div>" +
      '<div class="df">' + (open
        ? '<a class="btn primary" href="' + R.launchUrl(m) + '">' + R.icon("play") + 'Launch in workspace</a><a class="btn" href="' + esc(m.entry) + '" target="_blank" rel="noopener">' + R.icon("ext") + "Open standalone</a>"
        : '<span style="color:var(--ink-3);font-size:14px">This simulator is on the Rail-IQ roadmap and not yet available.</span>') + "</div>";
    drawer.setAttribute("aria-labelledby", "drawer-title");
    scrim.hidden = false; drawer.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add("on"); drawer.classList.add("on"); });
    $("#dclose").onclick = closeDrawer;
    setTimeout(() => $("#dclose").focus(), 60);
  }
  function closeDrawer() {
    scrim.classList.remove("on"); drawer.classList.remove("on");
    setTimeout(() => { scrim.hidden = true; drawer.hidden = true; }, 260);
    if (lastFocus) lastFocus.focus();
  }
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });

  /* ---------- update ---------- */
  let net = null;
  function update(scroll) {
    renderChips(); renderCards(); writeHash();
    if (net) net.setFocus(state.domain);
    if (scroll) $("#simulators").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- events ---------- */
  function wire() {
    const q = $("#q");
    q.value = state.q;
    let tmr;
    q.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = q.value.trim(); update(false); }, 120); });
    $("#domchips").addEventListener("click", e => { const b = e.target.closest("[data-dom]"); if (!b) return; state.domain = b.dataset.dom || null; update(false); });
    $("#statseg").addEventListener("click", e => { const b = e.target.closest("[data-status]"); if (!b) return; state.status = b.dataset.status; update(false); });
    $("#sort").addEventListener("change", e => { state.sort = e.target.value; renderCards(); });
    document.addEventListener("click", e => {
      if (e.target.closest("#clear,#clear2")) { state.q = ""; state.domain = state.discipline = null; state.status = "all"; q.value = ""; update(false); }
      const d = e.target.closest("[data-details]"); if (d) openDrawer(R.byId(d.dataset.details));
      const c = e.target.closest(".card"); if (c && !e.target.closest("a,button")) openDrawer(R.byId(c.dataset.id));
    });
    document.addEventListener("keydown", e => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); q.select(); }
    });
    window.addEventListener("hashchange", () => { const m = readHash(); q.value = state.q; update(false); if (m && R.byId(m)) openDrawer(R.byId(m)); });
  }

  /* ---------- network + clock ---------- */
  function mountNetwork() {
    const cv = $("#net");
    if (!cv || !window.RailIQNetwork) return;
    const legend = $("#netlegend");
    net = window.RailIQNetwork.mount(cv, {
      tip: $("#nettip"),
      onSelect: dom => { state.domain = state.domain === dom ? null : dom; update(true); }
    });
    legend.innerHTML = window.RailIQNetwork.LINES.map(L =>
      '<button data-dom="' + L.domain + '" style="--c:' + DOM[L.domain].color + '" aria-pressed="false"><i></i>' + esc(DOM[L.domain].label) + "</button>").join("");
    legend.addEventListener("click", e => { const b = e.target.closest("[data-dom]"); if (!b) return; state.domain = state.domain === b.dataset.dom ? null : b.dataset.dom; update(false); });
    legend.addEventListener("mouseover", e => { const b = e.target.closest("[data-dom]"); if (b) net.setFocus(b.dataset.dom); });
    legend.addEventListener("mouseleave", () => net.setFocus(state.domain));
    $("#trains").textContent = net.trainCount;
    const clk = $("#clock");
    const tick = () => { clk.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); };
    tick(); setInterval(tick, 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const deep = readHash();
    renderStats(); renderDisciplines(); renderRecent(); wire(); mountNetwork(); update(false);
    R.mountPalette({ onDetails: openDrawer });
    if (deep && R.byId(deep)) openDrawer(R.byId(deep));
    document.getElementById("year").textContent = new Date().getFullYear();
  });
})();
