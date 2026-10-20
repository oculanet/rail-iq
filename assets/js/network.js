/* Rail-IQ hero: animated schematic network.
   Each line is an octilinear polyline in a 1000 x 580 design space. Trains run station to
   station with an S-curve (accelerate / cruise / brake), dwell, and reverse at the termini. */
(function () {
  "use strict";

  // [x, y, stationName?, labelSide?]   labelSide: n | s | e | w | ne | nw | se | sw
  const LINES = [
    { id: "hsr", domain: "hsr", name: "HSR · Coastal Corridor", sys: "25 kV AC · 320 km/h", trains: 2, speed: 2.4, width: 6,
      pts: [[40, 70, "Northgate", "s"], [380, 70, "Ridge Parkway", "n"], [520, 210], [520, 280, "Central", "none"], [520, 330], [600, 410], [960, 410, "Southport", "s"]] },
    { id: "metro", domain: "metro", name: "Metro M1 · East–West", sys: "750 V DC third rail · CBTC", trains: 4, speed: 1.25, width: 6,
      pts: [[40, 280, "Westfield", "s"], [180, 280, "Oak St", "se"], [340, 280, "Museum", "se"], [520, 280], [680, 280, "Exchange", "s"], [800, 280], [880, 360, "Eastport", "e"]] },
    { id: "lrt", domain: "lrt", name: "LRT L2 · University", sys: "750 V DC OCS", trains: 2, speed: 1.0, width: 5,
      pts: [[80, 470, "Riverside", "n"], [250, 470, "Mill Lane", "s"], [340, 380, "Civic", "e"], [340, 280], [340, 150, "University", "e"]] },
    { id: "tram", domain: "tram", name: "Tram T3 · Old Town", sys: "750 V DC OCS + catenary-free", trains: 2, speed: 0.75, width: 4,
      pts: [[600, 540, "Promenade", "n"], [740, 540, "Market", "n"], [820, 460, "Old Town", "w"], [880, 400], [880, 360]] },
    { id: "apm", domain: "apm", name: "APM · Airport Link", sys: "Driverless · 3-car", trains: 2, speed: 1.1, width: 5,
      pts: [[680, 280], [760, 200, "Car Park", "nw"], [900, 200, "Terminal 1", "s"], [960, 140, "Terminal 2", "w"]] },
    { id: "mono", domain: "monorail", name: "Monorail · Parklands", sys: "Straddle beam · 750 V DC", trains: 1, speed: 0.9, width: 4,
      pts: [[60, 170, "Hillcrest", "s"], [180, 170, "Zoo", "n"], [180, 280], [180, 380, "Fairground", "e"]] },
    { id: "main", domain: "mainline", name: "Mainline · Coast Freight", sys: "25 kV AC · mixed traffic", trains: 1, speed: 1.5, width: 5,
      pts: [[40, 540, "Coast Jn", "n"], [300, 540, "Docklands", "n"], [430, 410, "Southbank", "e"], [506, 334], [506, 294]] }
  ];
  const INTERCHANGES = [
    { x: 520, y: 280, name: "Central" }, { x: 340, y: 280 }, { x: 180, y: 280 }, { x: 680, y: 280 }, { x: 880, y: 360 }
  ];
  const VW = 1000, VH = 580;
  const COLORVAR = { metro: "--l-metro", lrt: "--l-lrt", tram: "--l-tram", apm: "--l-apm", mainline: "--l-main", hsr: "--l-hsr", monorail: "--l-mono" };

  /* geometry: cumulative distances and station positions along each line */
  LINES.forEach(L => {
    L.cum = [0];
    for (let i = 1; i < L.pts.length; i++) {
      const [x0, y0] = L.pts[i - 1], [x1, y1] = L.pts[i];
      L.cum.push(L.cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    L.len = L.cum[L.cum.length - 1];
    // stops: named points + both ends + interchanges on the line
    L.stops = [];
    L.pts.forEach((p, i) => { if (p[2] || i === 0 || i === L.pts.length - 1 || INTERCHANGES.some(c => Math.abs(c.x - p[0]) < 1 && Math.abs(c.y - p[1]) < 1)) L.stops.push(L.cum[i]); });
    L.stops = [...new Set(L.stops)].sort((a, b) => a - b);
  });

  function at(L, s) {
    s = Math.max(0, Math.min(L.len, s));
    let i = 1; while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const s0 = L.cum[i - 1], s1 = L.cum[i], f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const [x0, y0] = L.pts[i - 1], [x1, y1] = L.pts[i];
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
  }

  /* S-curve: trapezoidal-ish profile — returns fraction of distance covered at fraction u of time */
  function profile(u) {
    const a = 0.25; // 25 % accelerating, 25 % braking
    if (u < a) return (u * u) / (2 * a * (1 - a));
    if (u > 1 - a) { const v = 1 - u; return 1 - (v * v) / (2 * a * (1 - a)); }
    return (u - a / 2) / (1 - a);
  }

  function mount(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const tip = opts.tip;
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, k = 1, ox = 0, oy = 0, dpr = 1, colors = {}, hover = null, focus = null, raf = 0, last = 0;

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      const g = n => cs.getPropertyValue(n).trim();
      colors = { bg: g("--map-bg"), grid: g("--map-grid"), label: g("--map-label"), ink: g("--ink"), surface: g("--surface"), accent: g("--accent") };
      Object.keys(COLORVAR).forEach(d => (colors[d] = g(COLORVAR[d])));
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      k = Math.min(W / VW, H / VH) * 0.96;
      ox = (W - VW * k) / 2; oy = (H - VH * k) / 2;
      if (reduce) draw(0);
    }

    /* trains: spread along each line, alternate direction */
    const trains = [];
    LINES.forEach(L => {
      const n = L.trains;
      for (let j = 0; j < n; j++) {
        const leg = Math.floor(((j + 0.5) / n) * (L.stops.length - 1));
        const dir = j % 2 ? -1 : 1;
        const from = dir > 0 ? leg : Math.min(L.stops.length - 1, leg + 1);
        trains.push({ L, from, dir, t: Math.random() * 0.8, dwell: 0, s: L.stops[from] });
      }
    });

    function step(tr, dt) {
      const L = tr.L;
      if (tr.dwell > 0) { tr.dwell -= dt; return; }
      let to = tr.from + tr.dir;
      if (to < 0 || to >= L.stops.length) { tr.dir *= -1; to = tr.from + tr.dir; }
      const sa = L.stops[tr.from], sb = L.stops[to];
      const T = Math.max(1.4, Math.abs(sb - sa) / (60 * L.speed)); // seconds for this leg
      tr.t += dt / T;
      if (tr.t >= 1) { tr.t = 0; tr.from = to; tr.s = sb; tr.dwell = 1.1 + Math.random() * 0.8; tr.arrived = performance.now(); return; }
      tr.s = sa + (sb - sa) * profile(tr.t);
    }

    const X = x => ox + x * k, Y = y => oy + y * k;

    function draw(dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // grid
      ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      const g = 40 * k;
      for (let x = ox % g; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = oy % g; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      const active = hover || focus;
      // lines
      LINES.forEach(L => {
        const dim = active && active !== L.domain;
        ctx.globalAlpha = dim ? 0.16 : 1;
        ctx.strokeStyle = colors[L.domain];
        ctx.lineWidth = L.width * k * (active === L.domain ? 1.35 : 1);
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.beginPath();
        L.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        // station ticks
        L.pts.forEach(p => {
          if (!p[2]) return;
          ctx.fillStyle = colors.surface; ctx.strokeStyle = colors[L.domain]; ctx.lineWidth = 2.2 * Math.max(0.7, k);
          ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4.6 * Math.max(0.75, k), 0, 7); ctx.fill(); ctx.stroke();
        });
      });
      ctx.globalAlpha = 1;
      // interchanges
      INTERCHANGES.forEach(c => {
        const r = (c.name ? 10 : 7) * Math.max(0.7, k);
        ctx.fillStyle = colors.surface; ctx.strokeStyle = colors.ink; ctx.lineWidth = 2.4 * Math.max(0.7, k);
        ctx.globalAlpha = active ? 0.6 : 1;
        ctx.beginPath(); ctx.arc(X(c.x), Y(c.y), r, 0, 7); ctx.fill(); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // labels
      if (k > 0.5) {
        const fs = Math.round(Math.max(9.5, 11.5 * Math.min(1.15, k)));
        ctx.font = "500 " + fs + "px 'IBM Plex Mono', ui-monospace, monospace";
        ctx.textBaseline = "middle";
        LINES.forEach(L => {
          const dim = active && active !== L.domain;
          ctx.globalAlpha = dim ? 0.25 : 1;
          ctx.fillStyle = colors.label;
          L.pts.forEach(p => {
            if (!p[2] || p[3] === "none") return;
            const side = p[3] || "s", d = 14 * Math.max(0.8, k);
            let x = X(p[0]), y = Y(p[1]);
            ctx.textAlign = side.includes("e") ? "left" : side.includes("w") ? "right" : "center";
            if (side.includes("n")) y -= d; if (side.includes("s")) y += d;
            if (side.includes("e")) x += d * 0.8; if (side.includes("w")) x -= d * 0.8;
            ctx.fillText(p[2].toUpperCase(), x, y);
          });
        });
        ctx.globalAlpha = active ? 0.5 : 1;
        ctx.fillStyle = colors.ink; ctx.font = "700 " + (fs + 3) + "px 'Saira Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = "left";
        ctx.fillText("CENTRAL", X(532), Y(250));
        ctx.globalAlpha = 1;
      }
      // trains
      const now = performance.now();
      trains.forEach(tr => {
        if (dt) step(tr, dt);
        const L = tr.L, dim = active && active !== L.domain;
        const p = at(L, tr.s);
        const len = (L.domain === "hsr" ? 26 : L.domain === "tram" ? 14 : L.domain === "mainline" ? 30 : 18) * Math.max(0.65, k);
        const wid = (L.width + 4) * Math.max(0.7, k);
        ctx.save();
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.a);
        // arrival ripple
        if (tr.dwell > 0 && tr.arrived) {
          const q = Math.min(1, (now - tr.arrived) / 900);
          ctx.strokeStyle = colors[L.domain]; ctx.lineWidth = 2; ctx.globalAlpha = (dim ? 0.1 : 0.55) * (1 - q);
          ctx.beginPath(); ctx.arc(0, 0, 6 + q * 18 * Math.max(0.7, k), 0, 7); ctx.stroke();
          ctx.globalAlpha = dim ? 0.2 : 1;
        }
        ctx.shadowColor = colors[L.domain]; ctx.shadowBlur = dim ? 0 : 10;
        ctx.fillStyle = colors[L.domain];
        rr(ctx, -len / 2, -wid / 2, len, wid, wid / 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = colors.surface; ctx.globalAlpha *= 0.85;
        const head = tr.dir > 0 ? len / 2 - wid * 0.55 : -len / 2 + wid * 0.55;
        ctx.beginPath(); ctx.arc(head, 0, wid * 0.22, 0, 7); ctx.fill();
        ctx.restore();
      });
    }

    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    function loop(t) {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
      draw(dt);
      raf = requestAnimationFrame(loop);
    }

    /* hit test: nearest line within 12 px */
    function pick(mx, my) {
      let best = null, bd = 12;
      LINES.forEach(L => {
        for (let i = 1; i < L.pts.length; i++) {
          const ax = X(L.pts[i - 1][0]), ay = Y(L.pts[i - 1][1]), bx = X(L.pts[i][0]), by = Y(L.pts[i][1]);
          const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
          const u = Math.max(0, Math.min(1, ((mx - ax) * vx + (my - ay) * vy) / l2));
          const d = Math.hypot(mx - ax - u * vx, my - ay - u * vy);
          if (d < bd) { bd = d; best = L; }
        }
      });
      return best;
    }
    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const L = pick(mx, my);
      hover = L ? L.domain : null;
      canvas.style.cursor = L ? "pointer" : "default";
      if (tip) {
        if (L) {
          const n = (window.RAILIQ_CATALOG || []).filter(m => (m.domains || []).includes(L.domain));
          const live = n.filter(m => m.status === "live").length;
          tip.innerHTML = "<b>" + L.name + '</b><div class="k">' + L.sys + "</div><div>" +
            L.pts.filter(p => p[2]).length + " stations · " + L.trains + (L.trains > 1 ? " trains" : " train") + "</div>" +
            '<div class="k" style="margin-top:4px">' + live + " live / " + n.length + " simulators → click to filter</div>";
          tip.style.left = mx + "px"; tip.style.top = my + "px"; tip.hidden = false;
        } else tip.hidden = true;
      }
      if (reduce) draw(0);
      if (opts.onHover) opts.onHover(hover);
    });
    canvas.addEventListener("mouseleave", () => { hover = null; if (tip) tip.hidden = true; if (reduce) draw(0); if (opts.onHover) opts.onHover(null); });
    canvas.addEventListener("click", e => {
      const r = canvas.getBoundingClientRect(); const L = pick(e.clientX - r.left, e.clientY - r.top);
      if (L && opts.onSelect) opts.onSelect(L.domain);
    });

    readColors();
    new ResizeObserver(resize).observe(canvas);
    resize();
    document.addEventListener("railiq:theme", () => { readColors(); if (reduce) draw(0); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); if (reduce) draw(0); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!reduce && !raf) { last = 0; raf = requestAnimationFrame(loop); } });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => reduce && draw(0));
    if (!reduce) raf = requestAnimationFrame(loop); else draw(0);

    return {
      lines: LINES.map(L => ({ domain: L.domain, name: L.name })),
      trainCount: trains.length,
      setFocus(d) { focus = d; if (reduce) draw(0); }
    };
  }

  window.RailIQNetwork = { mount, LINES };
})();
