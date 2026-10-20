/* Rail-IQ shared helpers: icons, theme, local storage, recent modules, command palette. */
(function () {
  "use strict";

  const P = {
    bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"/>',
    antenna: '<path d="M12 12v10M8 22h8"/><circle cx="12" cy="10" r="2"/><path d="M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14"/>',
    signal: '<rect x="8" y="2" width="8" height="14" rx="4"/><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><path d="M12 16v6M8 22h8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    station: '<path d="M3 10 12 4l9 6M5 10v10h14V10M9 20v-5h6v5"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    wave: '<path d="M2 12c2.5-4 4.5-4 7 0s4.5 4 7 0 4.5-4 6-2"/><path d="M2 18c2.5-4 4.5-4 7 0s4.5 4 7 0 4.5-4 6-2" opacity=".5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
    play: '<path d="M7 4v16l13-8L7 4Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    home: '<path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/><path d="M14 3v4h4"/>',
    chev: '<path d="m6 9 6 6 6-6"/>'
  };

  function icon(name, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra ? " " + extra : "") + ">" + (P[name] || P.grid) + "</svg>";
  }

  const LOGO =
    '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink)"/>' +
    '<path d="M9 25 14 7M23 25 18 7" stroke="var(--bg)" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M11 19h10M12.2 14h7.6" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>' +
    '<circle cx="24.5" cy="8" r="3" fill="var(--accent)"/></svg>';

  /* ---------- storage (may be unavailable: private mode, file://, blocked) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("railiq." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("railiq." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------- theme ---------- */
  const THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    document.querySelectorAll("[data-theme-btn]").forEach(b => {
      b.innerHTML = icon(t === "light" ? "sun" : t === "dark" ? "moon" : "auto");
      b.title = "Theme: " + t + " (click to change)";
      b.setAttribute("aria-label", b.title);
    });
    document.dispatchEvent(new CustomEvent("railiq:theme", { detail: t }));
  }
  function cycleTheme() {
    const cur = store.get("theme", "auto");
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    store.set("theme", next);
    applyTheme(next);
  }
  applyTheme(store.get("theme", "auto"));

  /* ---------- catalog helpers ---------- */
  const catalog = () => window.RAILIQ_CATALOG || [];
  const byId = id => catalog().find(m => m.id === id);
  const isOpenable = m => m && m.entry && (m.status === "live" || m.status === "beta");
  const launchUrl = m => "workspace.html?m=" + encodeURIComponent(m.id);

  function pushRecent(id) {
    const r = store.get("recent", []).filter(x => x.id !== id);
    r.unshift({ id, t: Date.now() });
    store.set("recent", r.slice(0, 6));
  }
  const recent = () => store.get("recent", []).filter(x => isOpenable(byId(x.id)));

  function ago(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 24) return h + " h ago";
    const d = Math.round(h / 24); return d + " d ago";
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- command palette ---------- */
  function mountPalette(opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "palette";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Command palette");
    el.innerHTML =
      '<div class="pin">' + icon("search") + '<input type="text" placeholder="Open a simulator or run a command…" aria-label="Search" autocomplete="off"><kbd>Esc</kbd></div>' +
      '<ul role="listbox"></ul>' +
      '<div class="pf"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> toggle</span></div>';
    document.body.appendChild(el);
    const input = el.querySelector("input"), list = el.querySelector("ul");
    let items = [], sel = 0, open = false;

    function allItems() {
      const D = window.RAILIQ_DISCIPLINES || {};
      const mods = catalog().map(m => ({
        icon: (D[m.discipline] || {}).icon || "grid",
        title: m.title,
        sub: (isOpenable(m) ? "Launch · " : "Pipeline · ") + ((D[m.discipline] || {}).label || "") + " · " + m.summary,
        hay: [m.title, m.summary, m.discipline, (m.domains || []).join(" "), (m.standards || []).join(" ")].join(" ").toLowerCase(),
        run: () => isOpenable(m) ? (location.href = launchUrl(m)) : (opts.onDetails ? opts.onDetails(m) : (location.href = "index.html#m=" + m.id)),
        rank: isOpenable(m) ? 0 : 1
      }));
      const cmds = [
        { icon: "home", title: "Go to Rail-IQ home", sub: "Portal overview", hay: "home portal index", run: () => (location.href = "index.html"), rank: 2 },
        { icon: "auto", title: "Change theme", sub: "Cycle auto / light / dark", hay: "theme dark light mode", run: () => cycleTheme(), rank: 2 }
      ];
      return mods.concat(cmds, opts.extra || []);
    }
    function render() {
      const q = input.value.trim().toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      items = allItems().filter(i => terms.every(t => i.hay.includes(t) || i.title.toLowerCase().includes(t))).sort((a, b) => a.rank - b.rank);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map((i, k) =>
        '<li role="option" data-k="' + k + '" aria-selected="' + (k === sel) + '"><span class="ico">' + icon(i.icon) + '</span><span class="t"><b>' + esc(i.title) + "</b><small>" + esc(i.sub) + "</small></span>" + (k === sel ? icon("arrow", 'width="16" height="16"') : "") + "</li>"
      ).join("") : '<li aria-disabled="true"><span class="t"><small>No match</small></span></li>';
    }
    function show() { open = true; el.classList.add("on"); input.value = ""; sel = 0; render(); input.focus(); }
    function hide() { open = false; el.classList.remove("on"); }
    function run(k) { const it = items[k]; if (!it) return; hide(); it.run(); }

    input.addEventListener("input", () => { sel = 0; render(); });
    list.addEventListener("click", e => { const li = e.target.closest("li[data-k]"); if (li) run(+li.dataset.k); });
    list.addEventListener("mousemove", e => { const li = e.target.closest("li[data-k]"); if (li && +li.dataset.k !== sel) { sel = +li.dataset.k; render(); } });
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open ? hide() : show(); return; }
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); hide(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel); }
    });
    document.addEventListener("mousedown", e => { if (open && !el.contains(e.target)) hide(); });
    document.querySelectorAll("[data-palette-btn]").forEach(b => b.addEventListener("click", show));
    return { show, hide };
  }

  /* ---------- wire common buttons ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-logo]").forEach(e => (e.innerHTML = LOGO));
    document.querySelectorAll("[data-icon]").forEach(e => (e.innerHTML = icon(e.dataset.icon)));
    document.querySelectorAll("[data-theme-btn]").forEach(b => b.addEventListener("click", cycleTheme));
    applyTheme(store.get("theme", "auto"));
  });

  window.RailIQ = { icon, LOGO, store, byId, isOpenable, launchUrl, pushRecent, recent, ago, esc, mountPalette, cycleTheme };
})();
