/* =====================================================================
   Input readers for the HTML model (mirror of tps_readers.py)
   - alignmentFromSheets(sheets)        sheets: {name: rows[][]}  (SheetJS)
   - trainFromBlocks(blocks, charts, base)
   - readDocx(arrayBuffer, JSZip)        -> {blocks, charts, images}
   - parseChartXml(text)
   - digitize(imageData, box, axes, color)  colour trace on a calibrated plot
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TPSReaders = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NUM_RE = /[-+]?\d[\d,]*\.?\d*(?:[eE][-+]?\d+)?|[-+]?\.\d+/;
  function firstNumber(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return isFinite(s) ? s : null;
    const m = String(s).replace(/−/g, '-').match(NUM_RE);
    if (!m) return null;
    const x = parseFloat(m[0].replace(/,/g, ''));
    return isFinite(x) ? x : null;
  }
  function parseChainage(v, header) {
    header = header || '';
    if (v === null || v === undefined || v === '') return null;
    const kmHead = /\bkm\b|\(km\)/.test(header.toLowerCase());
    if (typeof v === 'number') return kmHead ? v * 1000 : v;
    const s = String(v).trim().replace(/−/g, '-');
    const m = s.match(/^\s*(?:ch\.?|km\.?)?\s*(-?\d+)\s*\+\s*(\d+(?:\.\d+)?)\s*$/i);
    if (m) { const sign = m[1].startsWith('-') ? -1 : 1; return sign * (Math.abs(parseInt(m[1], 10)) * 1000 + parseFloat(m[2])); }
    const x = firstNumber(s);
    if (x === null) return null;
    if (/\bkm\b/.test(s.toLowerCase()) || kmHead) return x * 1000;
    return x;
  }
  function norm(s) { return String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

  /* ---------------- alignment ---------------- */
  const HEAD_WORDS = ['station', 'chainage', 'from', 'to', 'start', 'end', 'grad', 'slope', 'radius', 'speed', 'level',
    'elevation', 'dwell', 'name', 'km', 'ch', 'rl', 'length', 'curve', 'limit', 'up', 'down', 'dn'];
  function findHeader(rows) {
    let best = 0, bi = -1;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      let sc = 0;
      for (const c of rows[i]) { const t = norm(c); if (t && typeof c !== 'number' && HEAD_WORDS.some(w => t.indexOf(w) >= 0)) sc++; }
      if (sc > best) { best = sc; bi = i; }
    }
    return best >= 2 ? bi : -1;
  }
  function colFind(heads, pats, excl) {
    excl = excl || [];
    for (const p of pats) for (let j = 0; j < heads.length; j++) if (p.test(heads[j]) && !excl.some(e => e.test(heads[j]))) return j;
    return -1;
  }
  function gradientValue(v, header) {
    if (v === null || v === undefined || v === '') return null;
    const h = header.toLowerCase(), s = String(v).toLowerCase();
    const m = s.match(/1\s*in\s*([\d.]+)/);
    if (m) { let g = 1000 / parseFloat(m[1]); if (/fall|down|-|desc/.test(s)) g = -g; return g; }
    const x = firstNumber(v);
    if (x === null) return null;
    if (h.indexOf('%') >= 0 && h.indexOf('‰') < 0) return x * 10;
    if (s.indexOf('%') >= 0 && s.indexOf('‰') < 0) return x * 10;
    return x;
  }
  function alignmentFromSheets(sheets) {
    const out = { stations: [], gradients: [], curves: [], speed: [], elevations: [] };
    const log = [], guess = [];
    for (const sname of Object.keys(sheets)) {
      const rows = (sheets[sname] || []).filter(r => r).map(r => Array.from(r));
      if (!rows.length) continue;
      const hi = findHeader(rows);
      if (hi < 0) { log.push("Sheet '" + sname + "': no header row found, skipped"); continue; }
      const headsRaw = rows[hi].map(c => String(c === null || c === undefined ? '' : c));
      const heads = headsRaw.map(norm);
      const data = rows.slice(hi + 1);
      const sn = norm(sname);
      const cFrom = colFind(heads, [/^from|from\b|start ch|start|begin/], [/speed/, /grad/, /radius/]);
      const cTo = colFind(heads, [/^to\b|^to |\bto\b|end ch|^end|finish/], [/speed/, /grad/, /radius/]);
      const cCh = colFind(heads, [/chainage|^ch\b|^ch\.|^km|location|position|centre|center/], [/from/, /to\b/, /start/, /end/]);
      const cLen = colFind(heads, [/length/]);
      const cName = colFind(heads, [/station|^name|stop/]);
      const cDwell = colFind(heads, [/dwell/]);
      const cGrad = colFind(heads, [/grad|slope|incline/]);
      const cRad = colFind(heads, [/radius|^r\b|^r \(/]);
      const cLvl = colFind(heads, [/level|elevation|^rl\b|rail level|height/]);
      const cUp = colFind(heads, [/speed.*\bup\b|\bup\b.*speed|up speed|up line/]);
      const cDn = colFind(heads, [/speed.*\b(dn|down)\b|\b(dn|down)\b.*speed|(dn|down) speed|down line/]);
      const cSpd = colFind(heads, [/speed|limit|psr/]);
      let used = false;
      const cell = (r, j) => (j >= 0 && j < r.length) ? r[j] : null;
      const chOf = (r, j) => parseChainage(cell(r, j), j >= 0 ? headsRaw[j] : '');
      const ranges = () => {
        const res = [];
        if (cFrom >= 0 && cTo >= 0) {
          for (const r of data) { const a = chOf(r, cFrom), b = chOf(r, cTo); if (a !== null && b !== null) res.push([r, Math.min(a, b), Math.max(a, b)]); }
        } else if (cFrom >= 0 && cLen >= 0) {
          for (const r of data) { const a = chOf(r, cFrom), L = firstNumber(cell(r, cLen)); if (a !== null && L) res.push([r, a, a + Math.abs(L)]); }
        } else if (cCh >= 0) {
          const pts = data.map(r => [r, chOf(r, cCh)]).filter(p => p[1] !== null);
          for (let i = 0; i + 1 < pts.length; i++) res.push([pts[i][0], pts[i][1], pts[i + 1][1]]);
        }
        return res;
      };
      if (cName >= 0 && (cCh >= 0 || cFrom >= 0) && (sn.indexOf('station') >= 0 || sn.indexOf('stop') >= 0 || heads[cName].indexOf('station') >= 0 || (cGrad < 0 && cRad < 0))) {
        const cc = cCh >= 0 ? cCh : cFrom;
        for (const r of data) {
          const nm = cell(r, cName), ch = chOf(r, cc);
          if (nm === null || nm === '' || ch === null) continue;
          const dw = cDwell >= 0 ? firstNumber(cell(r, cDwell)) : null;
          out.stations.push({ name: String(nm).trim(), ch: ch, dwell: dw !== null ? dw : 30 });
        }
        log.push("Sheet '" + sname + "': " + out.stations.length + ' stations');
        continue;
      }
      if (cLvl >= 0 && cCh >= 0 && cGrad < 0) {
        const n0 = out.elevations.length;
        for (const r of data) { const ch = chOf(r, cCh), z = firstNumber(cell(r, cLvl)); if (ch !== null && z !== null) out.elevations.push({ ch: ch, z: z }); }
        log.push("Sheet '" + sname + "': " + (out.elevations.length - n0) + ' level points'); used = true;
      }
      if (cGrad >= 0) {
        const n0 = out.gradients.length;
        for (const [r, a, b] of ranges()) { const g = gradientValue(cell(r, cGrad), headsRaw[cGrad]); if (g !== null) out.gradients.push({ from: a, to: b, g: g }); }
        const h = headsRaw[cGrad];
        const ratioText = data.some(r => /1\s*in\s*\d/.test(String(cell(r, cGrad) === null ? '' : cell(r, cGrad)).toLowerCase()));
        if (!ratioText && h.indexOf('%') < 0 && h.indexOf('‰') < 0 && h.toLowerCase().indexOf('mille') < 0 && h.toLowerCase().indexOf('1 in') < 0) guess.push([n0, out.gradients.length]);
        log.push("Sheet '" + sname + "': " + (out.gradients.length - n0) + " gradient sections (column '" + h.trim() + "')"); used = true;
      }
      if (cRad >= 0) {
        const n0 = out.curves.length;
        for (const [r, a, b] of ranges()) { const R = firstNumber(cell(r, cRad)); if (R) out.curves.push({ from: a, to: b, R: Math.abs(R) }); }
        log.push("Sheet '" + sname + "': " + (out.curves.length - n0) + ' curves'); used = true;
      }
      if (cSpd >= 0 || cUp >= 0) {
        const n0 = out.speed.length;
        for (const [r, a, b] of ranges()) {
          let up = cUp >= 0 ? firstNumber(cell(r, cUp)) : null;
          let dn = cDn >= 0 ? firstNumber(cell(r, cDn)) : null;
          const sp = cSpd >= 0 ? firstNumber(cell(r, cSpd)) : null;
          if (up === null) up = sp;
          if (dn === null) dn = up;
          if (up) out.speed.push({ from: a, to: b, up: up, dn: dn });
        }
        log.push("Sheet '" + sname + "': " + (out.speed.length - n0) + ' speed restrictions'); used = true;
      }
      if (!used) log.push("Sheet '" + sname + "': columns not recognised (" + heads.filter(Boolean).join(', ') + ')');
    }
    for (const [a, b] of guess) {
      const vals = out.gradients.slice(a, b).map(s => Math.abs(s.g));
      if (vals.length && Math.max.apply(null, vals) <= 6) {
        for (let i = a; i < b; i++) out.gradients[i].g *= 10;
        log.push('Gradient column has no unit; values ≤ 6 read as per cent (converted to per mille)');
      } else log.push('Gradient column has no unit; values read as per mille');
    }
    if (!out.gradients.length && out.elevations.length >= 2) {
      const e = out.elevations.slice().sort((p, q) => p.ch - q.ch);
      for (let i = 0; i + 1 < e.length; i++) if (e[i + 1].ch > e[i].ch) out.gradients.push({ from: e[i].ch, to: e[i + 1].ch, g: (e[i + 1].z - e[i].z) / (e[i + 1].ch - e[i].ch) * 1000 });
      log.push('Gradients derived from ' + e.length + ' level points');
    }
    out.stations.sort((a, b) => a.ch - b.ch);
    for (const k of ['gradients', 'curves', 'speed']) out[k].sort((a, b) => a.from - b.from);
    return { part: out, log: log };
  }
  function mergeAlignment(cfg, part) {
    const A = cfg.alignment;
    for (const k of ['stations', 'gradients', 'curves', 'speed', 'elevations']) if (part[k] && part[k].length) A[k] = part[k];
    if (part.stations && part.stations.length) {
      const st = A.stations.map(s => s.ch);
      const lo = Math.min.apply(null, [st[0]].concat(A.gradients.map(g => g.from), A.curves.map(c => c.from)));
      const hi = Math.max.apply(null, [st[st.length - 1]].concat(A.gradients.map(g => g.to), A.curves.map(c => c.to)));
      A.start = Math.min(lo, st[0] - 100); A.end = Math.max(hi, st[st.length - 1] + 100);
    }
    return cfg;
  }

  /* ---------------- train data ---------------- */
  const PARAM_RULES = {
    mass_t: [[/simulation mass|design mass|mass for simulation/, 0], [/aw\s*3|crush|full load|fully loaded|loaded mass|laden/, 1],
      [/aw\s*2|normal load|seated/, 3], [/gross|total mass|train mass|train weight/, 2], [/\bmass\b|weight/, 4]],
    cars: [[/no\.? of cars|number of cars|cars per train|train formation|car formation|consist/, 0]],
    n_motors: [[/no\.? of (traction )?motors|number of (traction )?motors|traction motors per train|motors per train/, 0]],
    length_m: [[/train length|length of train|length over couplers|overall length/, 0], [/\blength\b/, 2]],
    vmax: [[/maximum operating speed|max\.? operating speed|operating speed/, 0], [/max(imum)?\.? speed|top speed/, 1], [/design speed/, 2]],
    acc: [[/starting acceleration|initial acceleration|max(imum)?\.? acceleration/, 0], [/acceleration/, 1]],
    dec: [[/service brak\w* (rate|deceleration)|service deceleration|full service brak/, 0], [/deceleration|braking rate/, 1]],
    aux_kW_car: [[/auxiliar|aux\.? (power|load)|hvac|hotel load|static inverter load|siv load/, 0]],
    rot_factor: [[/rotat\w* mass|rotary|rotating allowance|inertia factor|mass factor/, 0]],
    eff: [[/(overall|traction|drive|system|motor.*gear|propulsion).*efficien|efficiency/, 0]],
    regen_eff_factor: [[/regen\w*.*efficien/, 0]],
    regen_max_kW: [[/max\w*.*regen\w*.*power|regen\w*.*power|regenerat\w* braking power/, 0]],
    te_max: [[/starting tractive effort|max\w*\.? tractive effort|maximum tractive force|max\.? te\b/, 0]],
    p_max: [[/traction power|power at wheel|rated power|max\w*\.? power/, 1]],
    V_line: [[/nominal (line |supply )?voltage|line voltage|supply voltage/, 0]],
    davis: [[/davis|running resistance|train resistance|rolling resistance/, 0]]
  };
  function splitKV(line) {
    line = line.trim();
    if (!line) return null;
    let m = line.match(/^(.{2,90}?)\s*[:=\t–—]\s*(.+)$/);
    if (!m) m = line.match(/^(.*?[A-Za-z\)])\s+([-+]?\d[\d,.]*\s*.*)$/);
    if (!m) return null;
    return [m[1].trim(), m[2].trim()];
  }
  function unitConvert(field, key, valText, x, cars) {
    const both = key.toLowerCase() + ' ' + valText.toLowerCase();
    if (field === 'mass_t') { if (/\bkg\b/.test(both)) x /= 1000; }
    else if (field === 'vmax') { if (/m\/s(?!2|²)/.test(both) && both.indexOf('km/h') < 0) x *= 3.6; }
    else if (field === 'acc' || field === 'dec') { if (/km\/h\/s|kmph\/s|km\/h per s/.test(both)) x /= 3.6; }
    else if (field === 'aux_kW_car') {
      if (/\bmw\b/.test(both)) x *= 1000;
      if (!/per car|\/car|each car|per vehicle/.test(both)) x = x / Math.max(cars, 1);
    } else if (field === 'eff' || field === 'regen_eff_factor') { if (x > 1.0) x /= 100; }
    else if (field === 'rot_factor') { if (x >= 2) x /= 100; else if (x >= 1) x -= 1; }
    else if (field === 'regen_max_kW' || field === 'p_max') { if (/\bmw\b/.test(both)) x *= 1000; }
    else if (field === 'te_max') { if (/\bn\b/.test(both) && both.indexOf('kn') < 0) x /= 1000; }
    else if (field === 'length_m') { if (/\bmm\b/.test(both)) x /= 1000; }
    return x;
  }
  function parseDavis(text, mass) {
    const t = text.replace(/−/g, '-').replace(/²/g, '2');
    let A = null, B = null, C = null;
    for (const nm of ['A', 'B', 'C']) {
      const m = t.match(new RegExp('\\b' + nm + '\\s*[=:]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)'));
      if (m) { const v = parseFloat(m[1]); if (nm === 'A') A = v; else if (nm === 'B') B = v; else C = v; }
    }
    if (A === null) {
      const m = t.match(/=\s*([-+]?\d*\.?\d+)\s*\+\s*([-+]?\d*\.?\d+)\s*\*?\s*v\b\s*\+\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\*?\s*v\s*\^?\s*2/i);
      if (m) { A = parseFloat(m[1]); B = parseFloat(m[2]); C = parseFloat(m[3]); }
    }
    if (A === null) return null;
    const low = t.toLowerCase();
    let sc = 1;
    if (/n\/t|n per t|n\/tonne|dan\/t/.test(low)) sc = mass / 1000 * (low.indexOf('dan') >= 0 ? 10 : 1);
    else if (/\bdan\b/.test(low)) sc = 0.01;
    else if (/\bn\b/.test(low) && low.indexOf('kn') < 0) sc = 0.001;
    return { A: A * sc, B: (B || 0) * sc, C: (C || 0) * sc };
  }
  function classifySeries(name) {
    const h = norm(name);
    if (/regen|brak|electric brake|ed brake|dynamic/.test(h) && /effort|force|kn|\bbe\b/.test(h)) return 'be';
    if (/regen/.test(h) && /current/.test(h)) return 'regen_current';
    if (/tractive|traction effort|traction force|\bte\b|effort|force/.test(h)) return 'te';
    if (/current/.test(h)) return 'lc';
    if (/efficien|\beta\b|η/.test(h)) return 'eff';
    if (/power/.test(h)) return 'power';
    return null;
  }
  function seriesScale(kind, header) {
    const h = header.toLowerCase();
    if (kind === 'te' || kind === 'be') return (/\(n\)|\bn\b/.test(h) && h.indexOf('kn') < 0) ? 0.001 : 1;
    if (kind === 'eff') return h.indexOf('%') >= 0 ? 0.01 : 1;
    if (kind === 'lc') return /\(ka\)|\bka\b/.test(h) ? 1000 : 1;
    return 1;
  }
  function transpose(rows) { const n = Math.max.apply(null, rows.map(r => r.length)); const o = []; for (let j = 0; j < n; j++) o.push(rows.map(r => r[j] === undefined ? '' : r[j])); return o; }
  function curvesFromTable(rows) {
    rows = rows.map(r => r.map(c => String(c === null || c === undefined ? '' : c).trim())).filter(r => r.some(c => c));
    if (rows.length < 3) {
      if (rows.length >= 2 && rows[0].length > 3 && /speed|km\/h/.test(norm(rows[0][0]))) rows = transpose(rows); else return [];
    } else if (rows[0].length > 3 && rows.length <= 6 && /speed|km\/h/.test(norm(rows[0][0]))) rows = transpose(rows);
    const head = rows[0].map(norm);
    let sc = -1;
    for (let j = 0; j < head.length; j++) if (/speed|km\/h|kmph|velocity|\bv\b/.test(head[j])) { sc = j; break; }
    if (sc < 0) return [];
    const out = [];
    for (let j = 0; j < head.length; j++) {
      if (j === sc) continue;
      const kind = classifySeries(rows[0][j]);
      if (!kind) continue;
      const data = [];
      for (const r of rows.slice(1)) {
        if (j >= r.length || sc >= r.length) continue;
        const v = firstNumber(r[sc]), y = firstNumber(r[j]);
        if (v !== null && y !== null) data.push([v * (/m\/s/.test(head[sc]) && head[sc].indexOf('km') < 0 ? 3.6 : 1), y * seriesScale(kind, rows[0][j])]);
      }
      data.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (data.length >= 2) out.push({ kind: kind, header: rows[0][j], data: data, per_motor: /per motor|\/motor|each motor/.test(head[j]) });
    }
    return out;
  }
  function trainFromBlocks(blocks, charts, base) {
    const T = base ? JSON.parse(JSON.stringify(base)) : {};
    const report = { params: [], curves: [], log: [] };
    const lines = [], curveList = [];
    for (const b of blocks) {
      if (b.type === 'p') { for (const ln of b.text.split(/[\n;]+/)) if (ln.trim()) lines.push(ln.trim()); }
      else {
        const cv = curvesFromTable(b.rows);
        if (cv.length) { curveList.push.apply(curveList, cv); continue; }
        for (const r of b.rows) {
          let cells = r.map(c => String(c === null || c === undefined ? '' : c).trim());
          cells = cells.filter((c, i) => c && (i === 0 || c !== cells[i - 1]));
          if (cells.length >= 2) {
            let key = cells[0], val = cells.slice(1).join(' ');
            if (cells.length >= 3 && /^(sl|s\.?no|no\.?|item|\d+\.?)$/.test(cells[0].toLowerCase())) { key = cells[1]; val = cells.slice(2).join(' '); }
            lines.push(key + ': ' + val);
          }
        }
      }
    }
    for (const ch of charts || []) for (const s of ch.series) {
      const nm = (s.name || '') + ' ' + (ch.title || '');
      const kind = classifySeries(nm);
      const data = [];
      for (let i = 0; i < Math.min(s.x.length, s.y.length); i++) if (s.x[i] !== null && s.y[i] !== null) data.push([+s.x[i], +s.y[i]]);
      data.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (kind && data.length >= 2) curveList.push({ kind: kind, header: nm.trim(), data: data, per_motor: /per motor|\/motor/.test(nm.toLowerCase()), from: 'chart' });
    }
    const found = {};
    for (const ln of lines) {
      const kv = splitKV(ln);
      if (!kv) continue;
      const key = kv[0], val = kv[1], kl = key.toLowerCase();
      if (/emergency/.test(kl)) continue;
      for (const field of Object.keys(PARAM_RULES)) {
        let hit = false;
        for (const [pat, pr] of PARAM_RULES[field]) {
          if (!pat.test(kl)) continue;
          hit = true;
          if (field === 'davis') { if (!found[field] || pr < found[field][0]) found[field] = [pr, ln, null]; }
          else {
            let x = firstNumber(val);
            if (x === null) { const m = val.toLowerCase().match(/(\d+)\s*-?\s*car/); x = (m && field === 'cars') ? parseFloat(m[1]) : null; }
            if (x !== null && (!found[field] || pr < found[field][0])) found[field] = [pr, ln, [key, val, x]];
          }
          break;
        }
        if (hit) { /* continue scanning other fields like the Python loop */ }
      }
    }
    const cars = found.cars ? found.cars[2][2] : (T.cars || 1);
    if (found.cars) { T.cars = Math.round(found.cars[2][2]); report.params.push(['cars', T.cars, found.cars[1]]); }
    for (const field of ['mass_t', 'n_motors', 'length_m', 'vmax', 'acc', 'dec', 'aux_kW_car', 'rot_factor', 'regen_eff_factor', 'regen_max_kW']) {
      if (!found[field]) continue;
      const [key, val, x0] = found[field][2];
      let x = unitConvert(field, key, val, x0, cars);
      if (field === 'n_motors') x = Math.round(x);
      T[field] = Math.round(x * 1e6) / 1e6;
      report.params.push([field, T[field], found[field][1]]);
    }
    const mass = T.mass_t || 300;
    if (found.davis) { const dv = parseDavis(found.davis[1], mass); if (dv) { T.davis = dv; report.params.push(['davis', dv, found.davis[1]]); } }
    const have = new Set();
    for (const c of curveList) {
      const k = c.kind;
      if (have.has(k) || k === 'power' || k === 'regen_current') continue;
      have.add(k);
      if (k === 'te') { T.te_curve = c.data; if (c.per_motor) T.te_basis = 'motor'; }
      else if (k === 'be') T.be_curve = c.data;
      else if (k === 'eff') T.eff_curve = c.data.map(r => [r[0], r[1] > 1.5 ? r[1] / 100 : r[1]]);
      else if (k === 'lc') { T.line_current = c.data; T.power_mode = 'line_current'; }
      report.curves.push([k, c.data.length, c.header, c.from || 'table']);
    }
    if (found.eff && !have.has('eff')) {
      const [key, val, x] = found.eff[2];
      const e = unitConvert('eff', key, val, x, cars);
      T.eff_curve = [[0, e], [200, e]];
      report.params.push(['eff (constant)', e, found.eff[1]]);
    }
    if (!have.has('te') && found.te_max) {
      const [key, val, x] = found.te_max[2];
      const F0 = unitConvert('te_max', key, val, x, cars);
      let Pw = null;
      if (found.p_max) { const [k2, v2, x2] = found.p_max[2]; Pw = unitConvert('p_max', k2, v2, x2, cars); }
      const vb = Pw ? Pw / F0 * 3.6 : 40;
      const vmax = T.vmax || 80;
      const r1 = v => Math.round(v * 10) / 10;
      const pts = Array.from(new Set([0, r1(vb * 0.5), r1(vb)].concat([1, 2, 3, 4, 5, 6].map(i => r1(vb + i * (vmax * 1.15 - vb) / 6))))).sort((a, b) => a - b);
      T.te_curve = pts.map(v => [v, Math.round((v <= vb ? F0 : F0 * vb / v) * 100) / 100]);
      report.params.push(['te_curve (built from max effort / power)', F0.toFixed(1) + ' kN, base speed ' + vb.toFixed(1) + ' km/h', found.te_max[1]]);
    }
    if (!report.params.length && !report.curves.length) report.log.push('No recognisable train parameters found');
    return { train: T, report: report };
  }

  /* ---------------- docx ---------------- */
  const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function pText(p) {
    let s = '';
    const walk = (n) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') s += c.textContent;
        else if (ln === 'tab') s += '\t';
        else if (ln === 'br' || ln === 'cr') s += '\n';
        else walk(c);
      }
    };
    walk(p);
    return s;
  }
  function parseChartXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const byLocal = (root, name) => Array.from(root.getElementsByTagName('*')).filter(e => e.localName === name);
    const child = (n, name) => n ? Array.from(n.children).find(e => e.localName === name) : null;
    const titleEl = byLocal(doc, 'title')[0];
    let title = titleEl ? byLocal(titleEl, 't').map(t => t.textContent).join(' ') : '';
    const vals = (node) => {
      if (!node) return [];
      const pts = byLocal(node, 'pt').map(pt => [parseInt(pt.getAttribute('idx'), 10), parseFloat((child(pt, 'v') || {}).textContent)]);
      pts.sort((a, b) => a[0] - b[0]);
      return pts.map(p => isFinite(p[1]) ? p[1] : null);
    };
    const series = byLocal(doc, 'ser').map(ser => {
      const tx = child(ser, 'tx');
      let name = tx ? byLocal(tx, 'v').map(v => v.textContent).join(' ') : '';
      if (!name && tx) name = byLocal(tx, 't').map(v => v.textContent).join(' ');
      const x = vals(child(ser, 'xVal')).length ? vals(child(ser, 'xVal')) : vals(child(ser, 'cat'));
      const y = vals(child(ser, 'yVal')).length ? vals(child(ser, 'yVal')) : vals(child(ser, 'val'));
      return { name: name, x: x, y: y };
    });
    const ax = byLocal(doc, 'valAx').map(a => byLocal(a, 't').map(t => t.textContent).join(' '));
    if (ax.length && !title) title = ax.join(' ');
    return { title: title, series: series };
  }
  async function readDocx(buf, JSZip) {
    const z = await JSZip.loadAsync(buf);
    const xml = await z.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = Array.from(doc.getElementsByTagNameNS(WNS, 'body'))[0];
    const blocks = [];
    for (const el of Array.from(body.children)) {
      if (el.localName === 'p') { const t = pText(el); if (t.trim()) blocks.push({ type: 'p', text: t }); }
      else if (el.localName === 'tbl') {
        const rows = [];
        for (const tr of Array.from(el.children).filter(e => e.localName === 'tr')) {
          rows.push(Array.from(tr.children).filter(e => e.localName === 'tc').map(tc => Array.from(tc.getElementsByTagNameNS(WNS, 'p')).map(pText).join('\n').trim()));
        }
        blocks.push({ type: 'table', rows: rows });
      }
    }
    const charts = [];
    const chartNames = Object.keys(z.files).filter(n => /^word\/charts\/chart\d+\.xml$/.test(n)).sort();
    for (const n of chartNames) charts.push(parseChartXml(await z.file(n).async('string')));
    const images = [];
    for (const n of Object.keys(z.files).filter(n => n.indexOf('word/media/') === 0).sort()) {
      const ext = n.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' }[ext];
      images.push({ name: n.split('/').pop(), mime: mime || null, data: mime ? await z.file(n).async('base64') : null });
    }
    return { blocks: blocks, charts: charts, images: images };
  }

  /* ---------------- graph digitiser ---------------- */
  /* img: {width,height,data(RGBA)}  returns {L,T,R,B} plot frame in pixels */
  function detectPlotBox(img) {
    const W = img.width, H = img.height, d = img.data;
    const dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      dark[i] = ((r + g + b) / 3 < 110 && mx - mn < 60) ? 1 : 0;
    }
    const colsum = new Int32Array(W), rowsum = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark[y * W + x]) { colsum[x]++; rowsum[y]++; }
    let left = 0; for (let x = 0; x < Math.max(2, Math.floor(W * 0.45)); x++) if (colsum[x] > colsum[left]) left = x;
    const y0 = Math.floor(H * 0.55);
    let bottom = y0; for (let y = y0; y < H; y++) if (rowsum[y] > rowsum[bottom]) bottom = y;
    let top = bottom, gap = 0;
    for (let y = bottom; y >= 0; y--) { if (dark[y * W + left]) { top = y; gap = 0; } else if (++gap > 6) break; }
    let right = left; gap = 0;
    for (let x = left; x < W; x++) { if (dark[bottom * W + x]) { right = x; gap = 0; } else if (++gap > 6) break; }
    return { L: left, T: top, R: right, B: bottom };
  }
  /* box: pixel frame {L,T,R,B}; axes: {x0,x1,y0,y1} values at L,R,B,T; color [r,g,b] or null (dominant colour) */
  function digitize(img, box, axes, color, nPoints) {
    nPoints = nPoints || 25;
    const W = img.width, d = img.data;
    const x0 = box.L + 3, x1 = box.R - 2, y0 = box.T + 3, y1 = box.B - 2;
    const w = x1 - x0, h = y1 - y0;
    if (w < 10 || h < 10) return null;
    const px = (x, y) => { const i = 4 * (y * W + x); return [d[i], d[i + 1], d[i + 2]]; };
    let tgt = color;
    if (!tgt) {
      const counts = {};
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = px(x, y), mx = Math.max.apply(null, c), mn = Math.min.apply(null, c);
        if (mx - mn > 60 && (c[0] + c[1] + c[2]) / 3 < 235) { const k = c.map(v => Math.floor(v / 48) * 48 + 24).join(','); counts[k] = (counts[k] || 0) + 1; }
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      tgt = best ? best.split(',').map(Number) : null;
    }
    const isCurve = (x, y) => {
      const c = px(x, y);
      if (!tgt) return (c[0] + c[1] + c[2]) / 3 < 110;
      return (c[0] - tgt[0]) ** 2 + (c[1] - tgt[1]) ** 2 + (c[2] - tgt[2]) ** 2 < 70 * 70;
    };
    const cols = [], cand = [];
    for (let x = x0; x < x1; x++) {
      const ys = [];
      for (let y = y0; y < y1; y++) if (isCurve(x, y)) ys.push(y);
      if (!tgt && ys.length > 0.5 * h) continue;
      if (!ys.length) continue;
      const runs = []; let st = 0;
      for (let i = 1; i <= ys.length; i++) if (i === ys.length || ys[i] - ys[i - 1] > 3) { const seg = ys.slice(st, i); runs.push([seg.reduce((a, b) => a + b, 0) / seg.length, seg.length]); st = i; }
      cols.push(x); cand.push(runs);
    }
    if (cols.length < 5) return null;
    let prev = null; const rows = [];
    for (const cs of cand) {
      const pick = prev === null ? cs.reduce((a, b) => b[1] > a[1] ? b : a)[0] : cs.reduce((a, b) => Math.abs(b[0] - prev) < Math.abs(a[0] - prev) ? b : a)[0];
      rows.push(pick); prev = pick;
    }
    const med = rows.map((_, i) => { const s = rows.slice(Math.max(0, i - 2), i + 3).slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; });
    const fr = rows.map((r, i) => Math.abs(r - med[i]) > 6 ? med[i] : r);
    const xs = cols.map(c => axes.x0 + (c - box.L) / (box.R - box.L) * (axes.x1 - axes.x0));
    const ys = fr.map(r => axes.y0 + (box.B - r) / (box.B - box.T) * (axes.y1 - axes.y0));
    const out = [];
    const xa = xs[0], xb = xs[xs.length - 1];
    let q = 0;
    for (let i = 0; i < nPoints; i++) {
      const xv = xa + (xb - xa) * i / (nPoints - 1);
      while (q < xs.length - 2 && xs[q + 1] < xv) q++;
      const f = xs[q + 1] === xs[q] ? 0 : Math.min(1, Math.max(0, (xv - xs[q]) / (xs[q + 1] - xs[q])));
      out.push([Math.round(xv * 1000) / 1000, Math.round((ys[q] + (ys[q + 1] - ys[q]) * f) * 1000) / 1000]);
    }
    return { color: tgt, data: out };
  }

  return { firstNumber, parseChainage, alignmentFromSheets, mergeAlignment, trainFromBlocks, curvesFromTable, readDocx, parseChartXml, detectPlotBox, digitize };
});
