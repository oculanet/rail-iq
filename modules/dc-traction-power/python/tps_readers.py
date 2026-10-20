"""
Input readers for the DC traction power model
==============================================
* Alignment  : Excel workbook (.xlsx / .xlsm / .xls via pandas)  -> cfg["alignment"]
* Train data : Word document (.docx)                              -> cfg["trains"][i]
      - text lines   "Tare mass : 210 t", "Max speed 80 km/h", ...
      - tables       parameter tables and curve tables (speed vs effort, current, efficiency)
      - charts       Word / Excel charts embedded in the document (exact data read from XML)
      - images       graph pictures, digitised by colour tracing once the axes are calibrated

The parsing works on plain data (lists of rows, lists of text blocks), and the
JavaScript readers in the HTML model use the same rules, so both editions
read a file the same way.
"""
from __future__ import annotations

import io
import math
import os
import re
import zipfile
import xml.etree.ElementTree as ET

# ----------------------------------------------------------------------
# small parsing helpers
# ----------------------------------------------------------------------
NUM_RE = re.compile(r"[-+]?\d[\d,]*\.?\d*(?:[eE][-+]?\d+)?|[-+]?\.\d+")


def first_number(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s) if math.isfinite(s) else None
    m = NUM_RE.search(str(s).replace("−", "-"))
    if not m:
        return None
    txt = m.group(0).replace(",", "")
    try:
        return float(txt)
    except ValueError:
        return None


def parse_chainage(v, header=""):
    """Accepts 12345.6, '12+345.6', 'Km 12.345', '12.345 km' (header with km → ×1000)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        x = float(v)
        return x * 1000 if re.search(r"\bkm\b|\(km\)", header.lower()) else x
    s = str(v).strip().replace("−", "-")
    m = re.match(r"^\s*(?:ch\.?|km\.?)?\s*(-?\d+)\s*\+\s*(\d+(?:\.\d+)?)\s*$", s, re.I)
    if m:
        a, b = m.group(1), m.group(2)
        sign = -1 if a.startswith("-") else 1
        return sign * (abs(int(a)) * 1000 + float(b))
    x = first_number(s)
    if x is None:
        return None
    if re.search(r"\bkm\b", s.lower()) or re.search(r"\bkm\b|\(km\)", header.lower()):
        return x * 1000
    return x


def norm(s):
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


# ----------------------------------------------------------------------
# ALIGNMENT  (Excel)
# ----------------------------------------------------------------------
HEAD_WORDS = ["station", "chainage", "from", "to", "start", "end", "grad", "slope", "radius", "speed", "level",
              "elevation", "dwell", "name", "km", "ch", "rl", "length", "curve", "limit", "up", "down", "dn"]


def find_header(rows):
    best, best_i = 0, -1
    for i, r in enumerate(rows[:15]):
        score = 0
        for c in r:
            t = norm(c)
            if t and not isinstance(c, (int, float)) and any(w in t for w in HEAD_WORDS):
                score += 1
        if score > best:
            best, best_i = score, i
    return best_i if best >= 2 else -1


def col_find(heads, *patterns, exclude=()):
    for p in patterns:
        for j, h in enumerate(heads):
            if re.search(p, h) and not any(re.search(e, h) for e in exclude):
                return j
    return -1


def gradient_value(v, header):
    """Return gradient in per mille. Header with % → ×10, ‰/per mille → as is, '1 in N' text supported."""
    if v is None or v == "":
        return None
    h = header.lower()
    s = str(v).lower()
    m = re.search(r"1\s*in\s*([\d.]+)", s)
    if m:
        g = 1000.0 / float(m.group(1))
        if re.search(r"fall|down|-|desc", s):
            g = -g
        return g
    x = first_number(v)
    if x is None:
        return None
    if "%" in h and "‰" not in h:
        return x * 10
    if "%" in s and "‰" not in s:
        return x * 10
    return x


def alignment_from_sheets(sheets):
    """sheets: dict  sheet_name -> list of rows (list of cell values).
    Returns (alignment_dict_partial, log_lines)."""
    out = {"stations": [], "gradients": [], "curves": [], "speed": [], "elevations": []}
    log = []
    grad_unit_guess = []
    for sname, rows in sheets.items():
        rows = [list(r) for r in rows if r is not None]
        if not rows:
            continue
        hi = find_header(rows)
        if hi < 0:
            log.append(f"Sheet '{sname}': no header row found, skipped")
            continue
        heads_raw = [str(c or "") for c in rows[hi]]
        heads = [norm(c) for c in heads_raw]
        data = rows[hi + 1:]
        sn = norm(sname)
        c_from = col_find(heads, r"^from|from\b|start ch|start|begin", exclude=[r"speed", r"grad", r"radius"])
        c_to = col_find(heads, r"^to\b|^to |\bto\b|end ch|^end|finish", exclude=[r"speed", r"grad", r"radius"])
        c_ch = col_find(heads, r"chainage|^ch\b|^ch\.|^km|location|position|centre|center", exclude=[r"from", r"to\b", r"start", r"end"])
        c_len = col_find(heads, r"length")
        c_name = col_find(heads, r"station|^name|stop")
        c_dwell = col_find(heads, r"dwell")
        c_grad = col_find(heads, r"grad|slope|incline")
        c_rad = col_find(heads, r"radius|^r\b|^r \(")
        c_lvl = col_find(heads, r"level|elevation|^rl\b|rail level|height")
        c_spd_up = col_find(heads, r"speed.*\bup\b|\bup\b.*speed|up speed|up line")
        c_spd_dn = col_find(heads, r"speed.*\b(dn|down)\b|\b(dn|down)\b.*speed|(dn|down) speed|down line")
        c_spd = col_find(heads, r"speed|limit|psr")
        used = False

        def ch_of(r, j):
            return parse_chainage(r[j] if j < len(r) else None, heads_raw[j] if j >= 0 else "")

        def ranges():
            """Yield (row, from, to) using From/To, or Start+Length, or point list (Chainage → next chainage)."""
            res = []
            if c_from >= 0 and c_to >= 0:
                for r in data:
                    a, b = ch_of(r, c_from), ch_of(r, c_to)
                    if a is not None and b is not None:
                        res.append((r, min(a, b), max(a, b)))
            elif c_from >= 0 and c_len >= 0:
                for r in data:
                    a, L = ch_of(r, c_from), first_number(r[c_len] if c_len < len(r) else None)
                    if a is not None and L:
                        res.append((r, a, a + abs(L)))
            elif c_ch >= 0:
                pts = [(r, ch_of(r, c_ch)) for r in data]
                pts = [p for p in pts if p[1] is not None]
                for i, (r, a) in enumerate(pts):
                    b = pts[i + 1][1] if i + 1 < len(pts) else None
                    if b is not None:
                        res.append((r, a, b))
            return res

        # stations
        if c_name >= 0 and (c_ch >= 0 or c_from >= 0) and ("station" in sn or "stop" in sn or "station" in heads[c_name] or c_grad < 0 and c_rad < 0):
            cc = c_ch if c_ch >= 0 else c_from
            for r in data:
                nm = r[c_name] if c_name < len(r) else None
                ch = ch_of(r, cc)
                if nm in (None, "") or ch is None:
                    continue
                dw = first_number(r[c_dwell]) if c_dwell >= 0 and c_dwell < len(r) else None
                out["stations"].append({"name": str(nm).strip(), "ch": ch, "dwell": dw if dw is not None else 30})
            log.append(f"Sheet '{sname}': {len(out['stations'])} stations")
            used = True
            continue
        # elevations (point list)
        if c_lvl >= 0 and c_ch >= 0 and c_grad < 0:
            n0 = len(out["elevations"])
            for r in data:
                ch = ch_of(r, c_ch)
                z = first_number(r[c_lvl] if c_lvl < len(r) else None)
                if ch is not None and z is not None:
                    out["elevations"].append({"ch": ch, "z": z})
            log.append(f"Sheet '{sname}': {len(out['elevations']) - n0} level points")
            used = True
        # gradients
        if c_grad >= 0:
            n0 = len(out["gradients"])
            for r, a, b in ranges():
                g = gradient_value(r[c_grad] if c_grad < len(r) else None, heads_raw[c_grad])
                if g is not None:
                    out["gradients"].append({"from": a, "to": b, "g": g})
            h = heads_raw[c_grad]
            ratio_text = any(re.search(r"1\s*in\s*\d", str(r[c_grad] if c_grad < len(r) else "").lower()) for r in data)
            if "%" not in h and "‰" not in h and "mille" not in h.lower() and "1 in" not in h.lower() and not ratio_text:
                grad_unit_guess.append((n0, len(out["gradients"])))
            log.append(f"Sheet '{sname}': {len(out['gradients']) - n0} gradient sections (column '{h.strip()}')")
            used = True
        # curves
        if c_rad >= 0:
            n0 = len(out["curves"])
            for r, a, b in ranges():
                R = first_number(r[c_rad] if c_rad < len(r) else None)
                if R:
                    out["curves"].append({"from": a, "to": b, "R": abs(R)})
            log.append(f"Sheet '{sname}': {len(out['curves']) - n0} curves")
            used = True
        # speed limits
        if c_spd >= 0 or c_spd_up >= 0:
            n0 = len(out["speed"])
            for r, a, b in ranges():
                up = first_number(r[c_spd_up]) if c_spd_up >= 0 and c_spd_up < len(r) else None
                dn = first_number(r[c_spd_dn]) if c_spd_dn >= 0 and c_spd_dn < len(r) else None
                sp = first_number(r[c_spd]) if c_spd >= 0 and c_spd < len(r) else None
                if up is None:
                    up = sp
                if dn is None:
                    dn = up
                if up:
                    out["speed"].append({"from": a, "to": b, "up": up, "dn": dn})
            log.append(f"Sheet '{sname}': {len(out['speed']) - n0} speed restrictions")
            used = True
        if not used:
            log.append(f"Sheet '{sname}': columns not recognised ({', '.join(h for h in heads if h)})")
    # unit guess for gradients without unit in header: small values → per cent
    for a, b in grad_unit_guess:
        vals = [abs(s["g"]) for s in out["gradients"][a:b]]
        if vals and max(vals) <= 6:
            for s in out["gradients"][a:b]:
                s["g"] *= 10
            log.append("Gradient column has no unit; values ≤ 6 read as per cent (converted to per mille)")
        else:
            log.append("Gradient column has no unit; values read as per mille")
    # gradients from levels when no gradient table given
    if not out["gradients"] and len(out["elevations"]) >= 2:
        e = sorted(out["elevations"], key=lambda p: p["ch"])
        for p, q in zip(e, e[1:]):
            if q["ch"] > p["ch"]:
                out["gradients"].append({"from": p["ch"], "to": q["ch"], "g": (q["z"] - p["z"]) / (q["ch"] - p["ch"]) * 1000})
        log.append(f"Gradients derived from {len(e)} level points")
    out["stations"].sort(key=lambda s: s["ch"])
    for k in ("gradients", "curves", "speed"):
        out[k].sort(key=lambda s: s["from"])
    return out, log


def read_alignment_xlsx(path):
    ext = os.path.splitext(path)[1].lower()
    sheets = {}
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        for ws in wb.worksheets:
            sheets[ws.title] = [list(r) for r in ws.iter_rows(values_only=True)]
    else:  # .xls / .csv via pandas
        import pandas as pd
        if ext == ".csv":
            df = pd.read_csv(path, header=None)
            sheets[os.path.basename(path)] = df.values.tolist()
        else:
            for name, df in pd.read_excel(path, sheet_name=None, header=None).items():
                sheets[name] = df.where(df.notna(), None).values.tolist()
    return alignment_from_sheets(sheets)


def merge_alignment(cfg, part, replace_empty=False):
    A = cfg["alignment"]
    for k in ("stations", "gradients", "curves", "speed", "elevations"):
        if part.get(k) or replace_empty:
            A[k] = part.get(k, [])
    if part.get("stations"):
        st = [s["ch"] for s in A["stations"]]
        lo = min([st[0]] + [g["from"] for g in A["gradients"]] + [c["from"] for c in A["curves"]])
        hi = max([st[-1]] + [g["to"] for g in A["gradients"]] + [c["to"] for c in A["curves"]])
        A["start"], A["end"] = min(lo, st[0] - 100), max(hi, st[-1] + 100)
    return cfg


# ----------------------------------------------------------------------
# TRAIN DATA  (Word)
# ----------------------------------------------------------------------
# field -> list of (regex on key, priority)  - lower priority value wins
PARAM_RULES = {
    "mass_t": [(r"simulation mass|design mass|mass for simulation", 0), (r"aw\s*3|crush|full load|fully loaded|loaded mass|laden", 1),
               (r"aw\s*2|normal load|seated", 3), (r"gross|total mass|train mass|train weight", 2), (r"\bmass\b|weight", 4)],
    "cars": [(r"no\.? of cars|number of cars|cars per train|train formation|car formation|consist", 0)],
    "n_motors": [(r"no\.? of (traction )?motors|number of (traction )?motors|traction motors per train|motors per train", 0)],
    "length_m": [(r"train length|length of train|length over couplers|overall length", 0), (r"\blength\b", 2)],
    "vmax": [(r"maximum operating speed|max\.? operating speed|operating speed", 0), (r"max(imum)?\.? speed|top speed", 1), (r"design speed", 2)],
    "acc": [(r"starting acceleration|initial acceleration|max(imum)?\.? acceleration", 0), (r"acceleration", 1)],
    "dec": [(r"service brak\w* (rate|deceleration)|service deceleration|full service brak", 0), (r"deceleration|braking rate", 1)],
    "aux_kW_car": [(r"auxiliar|aux\.? (power|load)|hvac|hotel load|static inverter load|siv load", 0)],
    "rot_factor": [(r"rotat\w* mass|rotary|rotating allowance|inertia factor|mass factor", 0)],
    "eff": [(r"(overall|traction|drive|system|motor.*gear|propulsion).*efficien|efficiency", 0)],
    "regen_eff_factor": [(r"regen\w*.*efficien", 0)],
    "regen_max_kW": [(r"max\w*.*regen\w*.*power|regen\w*.*power|regenerat\w* braking power", 0)],
    "te_max": [(r"starting tractive effort|max\w*\.? tractive effort|maximum tractive force|max\.? te\b", 0)],
    "p_max": [(r"traction power|power at wheel|rated power|max\w*\.? power", 1)],
    "V_line": [(r"nominal (line |supply )?voltage|line voltage|supply voltage", 0)],
    "davis": [(r"davis|running resistance|train resistance|rolling resistance", 0)],
}


def split_kv(line):
    line = line.strip()
    if not line:
        return None
    m = re.match(r"^(.{2,90}?)\s*[:=\t–—]\s*(.+)$", line)
    if not m:
        m = re.match(r"^(.*?[A-Za-z\)])\s+([-+]?\d[\d,.]*\s*.*)$", line)
    if not m:
        return None
    return m.group(1).strip(), m.group(2).strip()


def unit_convert(field, key, val_text, x, cars):
    k, v = key.lower(), val_text.lower()
    both = k + " " + v
    if field == "mass_t":
        if re.search(r"\bkg\b", both):
            x /= 1000
    elif field == "vmax":
        if re.search(r"m/s(?!2|²)", both) and "km/h" not in both:
            x *= 3.6
    elif field in ("acc", "dec"):
        if re.search(r"km/h/s|kmph/s|km/h per s", both):
            x /= 3.6
    elif field == "aux_kW_car":
        if re.search(r"\bmw\b", both):
            x *= 1000
        if re.search(r"\bkva\b", both):
            pass
        if not re.search(r"per car|/car|each car|per vehicle", both):
            x = x / max(cars, 1)
    elif field in ("eff", "regen_eff_factor"):
        if x > 1.0:
            x /= 100
    elif field == "rot_factor":
        if x >= 2:
            x /= 100
        elif x >= 1:
            x -= 1
    elif field in ("regen_max_kW", "p_max"):
        if re.search(r"\bmw\b", both):
            x *= 1000
    elif field == "te_max":
        if re.search(r"\bn\b", both) and "kn" not in both:
            x /= 1000
    elif field == "length_m":
        if re.search(r"\bmm\b", both):
            x /= 1000
    return x


def parse_davis(text, mass):
    t = text.replace("−", "-").replace("²", "2")
    A = B = C = None
    for nm in ("A", "B", "C"):
        m = re.search(rf"\b{nm}\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", t)
        if m:
            val = float(m.group(1))
            if nm == "A":
                A = val
            elif nm == "B":
                B = val
            else:
                C = val
    if A is None:
        m = re.search(r"=\s*([-+]?\d*\.?\d+)\s*\+\s*([-+]?\d*\.?\d+)\s*\*?\s*v\b\s*\+\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\*?\s*v\s*\^?\s*2", t, re.I)
        if m:
            A, B, C = float(m.group(1)), float(m.group(2)), float(m.group(3))
    if A is None:
        return None
    low = t.lower()
    scale = 1.0
    if re.search(r"n/t|n per t|n/tonne|dan/t", low):
        scale = mass / 1000 * (10 if "dan" in low else 1)
    elif re.search(r"\bdan\b", low):
        scale = 0.01
    elif re.search(r"\bn\b", low) and "kn" not in low:
        scale = 0.001
    return {"A": A * scale, "B": (B or 0) * scale, "C": (C or 0) * scale}


def classify_series(name):
    h = norm(name)
    if re.search(r"regen|brak|electric brake|ed brake|dynamic", h) and re.search(r"effort|force|kn|\bbe\b", h):
        return "be"
    if re.search(r"regen", h) and re.search(r"current", h):
        return "regen_current"
    if re.search(r"tractive|traction effort|traction force|\bte\b|effort|force", h):
        return "te"
    if re.search(r"current", h):
        return "lc"
    if re.search(r"efficien|\beta\b|η", h):
        return "eff"
    if re.search(r"power", h):
        return "power"
    return None


def series_scale(kind, header):
    h = header.lower()
    if kind in ("te", "be"):
        if re.search(r"\(n\)|\bn\b", h) and "kn" not in h:
            return 0.001
        return 1.0
    if kind == "eff":
        return 0.01 if "%" in h else 1.0
    if kind == "lc":
        return 1000.0 if re.search(r"\(ka\)|\bka\b", h) else 1.0
    return 1.0


def curves_from_table(rows):
    """Return list of {kind, header, data:[[v, y]], per_motor} from a table (list of rows)."""
    rows = [[str(c or "").strip() for c in r] for r in rows if any(str(c or "").strip() for c in r)]
    if len(rows) < 3:
        # transposed short table: first column holds labels, many columns
        if len(rows) >= 2 and len(rows[0]) > 3 and re.search(r"speed|km/h", norm(rows[0][0])):
            rows = [list(x) for x in zip(*rows)]
        else:
            return []
    elif len(rows[0]) > 3 and len(rows) <= 6 and re.search(r"speed|km/h", norm(rows[0][0])):
        rows = [list(x) for x in zip(*rows)]
    head = [norm(c) for c in rows[0]]
    sc = -1
    for j, h in enumerate(head):
        if re.search(r"speed|km/h|kmph|velocity|\bv\b", h):
            sc = j
            break
    if sc < 0:
        return []
    out = []
    for j, h in enumerate(head):
        if j == sc:
            continue
        kind = classify_series(rows[0][j])
        if not kind:
            continue
        data = []
        for r in rows[1:]:
            if j >= len(r) or sc >= len(r):
                continue
            v, y = first_number(r[sc]), first_number(r[j])
            if v is not None and y is not None:
                data.append([v * (3.6 if re.search(r"m/s", head[sc]) and "km" not in head[sc] else 1), y * series_scale(kind, rows[0][j])])
        if len(data) >= 2:
            out.append({"kind": kind, "header": rows[0][j], "data": sorted(data), "per_motor": bool(re.search(r"per motor|/motor|each motor", h))})
    return out


def train_from_blocks(blocks, charts=None, base=None):
    """blocks: list of {'type':'p','text':str} or {'type':'table','rows':[[...]]}
    charts : list of {'title':str,'series':[{'name','x':[...],'y':[...]}]}
    base   : existing train dict to update (copy).  Returns (train, report)."""
    import copy
    T = copy.deepcopy(base) if base else {}
    report = {"params": [], "curves": [], "log": []}
    lines = []
    curve_list = []
    for b in blocks:
        if b["type"] == "p":
            for ln in re.split(r"[\n;]+", b["text"]):
                if ln.strip():
                    lines.append(ln.strip())
        else:
            rows = b["rows"]
            cv = curves_from_table(rows)
            if cv:
                curve_list.extend(cv)
                continue
            for r in rows:
                cells = [str(c or "").strip() for c in r]
                cells = [c for i, c in enumerate(cells) if c and (i == 0 or c != cells[i - 1])]
                if len(cells) >= 2:
                    key = cells[0]
                    val = " ".join(cells[1:])
                    if len(cells) >= 3 and re.search(r"^(sl|s\.?no|no\.?|item|\d+\.?)$", cells[0].lower()):
                        key, val = cells[1], " ".join(cells[2:])
                    lines.append(f"{key}: {val}")
    for ch in charts or []:
        for s in ch["series"]:
            nm = (s.get("name") or "") + " " + (ch.get("title") or "")
            kind = classify_series(nm)
            data = [[float(x), float(y)] for x, y in zip(s["x"], s["y"]) if x is not None and y is not None]
            if kind and len(data) >= 2:
                curve_list.append({"kind": kind, "header": nm.strip(), "data": sorted(data),
                                   "per_motor": bool(re.search(r"per motor|/motor", nm.lower())), "from": "chart"})

    # parameters
    cars_guess = None
    found = {}
    for ln in lines:
        kv = split_kv(ln)
        if not kv:
            continue
        key, val = kv
        kl = key.lower()
        if re.search(r"emergency", kl):
            continue
        for field, rules in PARAM_RULES.items():
            for pat, pr in rules:
                if re.search(pat, kl):
                    if field == "davis":
                        if field not in found or pr < found[field][0]:
                            found[field] = (pr, ln, None)
                    else:
                        x = first_number(val)
                        if x is None:
                            m = re.search(r"(\d+)\s*-?\s*car", val.lower())
                            x = float(m.group(1)) if (m and field == "cars") else None
                        if x is not None and (field not in found or pr < found[field][0]):
                            found[field] = (pr, ln, (key, val, x))
                    break
    if "cars" in found:
        cars_guess = found["cars"][2][2]
    cars = cars_guess or T.get("cars") or 1
    if "cars" in found:
        T["cars"] = int(round(found["cars"][2][2]))
        report["params"].append(("cars", T["cars"], found["cars"][1]))
    for field in ("mass_t", "n_motors", "length_m", "vmax", "acc", "dec", "aux_kW_car", "rot_factor", "regen_eff_factor", "regen_max_kW"):
        if field in found:
            key, val, x = found[field][2]
            x = unit_convert(field, key, val, x, cars)
            if field == "n_motors":
                x = int(round(x))
            T[field] = round(x, 6)
            report["params"].append((field, T[field], found[field][1]))
    mass = T.get("mass_t", 300)
    if "davis" in found:
        dv = parse_davis(found["davis"][1], mass)
        if dv:
            T["davis"] = dv
            report["params"].append(("davis", dv, found["davis"][1]))
    # curves
    have = set()
    for c in curve_list:
        k = c["kind"]
        if k in have or k in ("power", "regen_current"):
            continue
        have.add(k)
        if k == "te":
            T["te_curve"] = c["data"]
            if c["per_motor"]:
                T["te_basis"] = "motor"
        elif k == "be":
            T["be_curve"] = c["data"]
        elif k == "eff":
            T["eff_curve"] = [[v, y / 100 if y > 1.5 else y] for v, y in c["data"]]
        elif k == "lc":
            T["line_current"] = c["data"]
            T["power_mode"] = "line_current"
        report["curves"].append((k, len(c["data"]), c["header"], c.get("from", "table")))
    # constant efficiency when no table
    if "eff" in found and "eff" not in have:
        key, val, x = found["eff"][2]
        e = unit_convert("eff", key, val, x, cars)
        T["eff_curve"] = [[0, e], [200, e]]
        report["params"].append(("eff (constant)", e, found["eff"][1]))
    # TE curve from max effort + max power when no TE table
    if "te" not in have and "te_max" in found:
        key, val, x = found["te_max"][2]
        F0 = unit_convert("te_max", key, val, x, cars)
        Pw = None
        if "p_max" in found:
            k2, v2, x2 = found["p_max"][2]
            Pw = unit_convert("p_max", k2, v2, x2, cars)
        vb = (Pw / F0 * 3.6) if Pw else 40.0
        vmax = T.get("vmax", 80)
        pts = sorted(set([0, round(vb * 0.5, 1), round(vb, 1)] + [round(vb + i * (vmax * 1.15 - vb) / 6, 1) for i in range(1, 7)]))
        T["te_curve"] = [[v, round(F0 if v <= vb else F0 * vb / v, 2)] for v in pts]
        report["params"].append(("te_curve (built from max effort / power)", f"{F0:.1f} kN, base speed {vb:.1f} km/h", found["te_max"][1]))
    if not report["params"] and not report["curves"]:
        report["log"].append("No recognisable train parameters found")
    return T, report


def docx_blocks(path):
    """Paragraph texts and tables in document order + embedded charts + image list."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        doc = ET.fromstring(z.read("word/document.xml"))
        charts = []
        for n in sorted(x for x in names if re.match(r"word/charts/chart\d+\.xml$", x)):
            charts.append(parse_chart_xml(z.read(n)))
        images = []
        for n in sorted(x for x in names if x.startswith("word/media/")):
            images.append({"name": os.path.basename(n), "data": z.read(n)})
    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    body = doc.find(W + "body")
    blocks = []

    def ptext(p):
        parts = []
        for el in p.iter():
            if el.tag == W + "t" and el.text:
                parts.append(el.text)
            elif el.tag == W + "tab":
                parts.append("\t")
            elif el.tag in (W + "br", W + "cr"):
                parts.append("\n")
        return "".join(parts)

    for el in body:
        if el.tag == W + "p":
            t = ptext(el)
            if t.strip():
                blocks.append({"type": "p", "text": t})
        elif el.tag == W + "tbl":
            rows = []
            for tr in el.findall(W + "tr"):
                rows.append(["\n".join(ptext(p) for p in tc.findall(".//" + W + "p")).strip() for tc in tr.findall(W + "tc")])
            blocks.append({"type": "table", "rows": rows})
    return blocks, charts, images


def parse_chart_xml(xml_bytes):
    C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
    A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    root = ET.fromstring(xml_bytes)
    title = " ".join(t.text or "" for t in root.iter(A + "t")) if root.find(".//" + C + "title") is not None else ""

    def vals(node):
        if node is None:
            return []
        pts = {}
        for pt in node.iter(C + "pt"):
            v = pt.find(C + "v")
            try:
                pts[int(pt.get("idx"))] = float(v.text)
            except (TypeError, ValueError):
                pts[int(pt.get("idx"))] = None
        return [pts[i] for i in sorted(pts)]

    series = []
    for ser in root.iter(C + "ser"):
        tx = ser.find(C + "tx")
        name = " ".join(v.text or "" for v in tx.iter(C + "v")) if tx is not None else ""
        if not name and tx is not None:
            name = " ".join(t.text or "" for t in tx.iter(A + "t"))
        x = vals(ser.find(C + "xVal")) or vals(ser.find(C + "cat"))
        y = vals(ser.find(C + "yVal")) or vals(ser.find(C + "val"))
        series.append({"name": name, "x": x, "y": y})
    # axis titles help classify (e.g. "Tractive effort (kN)")
    ax = [" ".join(t.text or "" for t in a.iter(A + "t")) for a in root.iter(C + "valAx")]
    if ax and not title:
        title = " ".join(ax)
    return {"title": title, "series": series}


# ----------------------------------------------------------------------
# GRAPH IMAGE DIGITISER
# ----------------------------------------------------------------------
def detect_plot_box(rgb):
    import numpy as np
    g = rgb.astype(int).sum(axis=2) / 3
    sat = rgb.max(axis=2).astype(int) - rgb.min(axis=2).astype(int)
    dark = (g < 110) & (sat < 60)
    H, W = dark.shape
    colsum = dark.sum(axis=0)
    rowsum = dark.sum(axis=1)
    left = int(np.argmax(colsum[: max(2, int(W * 0.45))]))
    bottom = int(H * 0.55) + int(np.argmax(rowsum[int(H * 0.55):]))
    col = dark[:, left]
    top = bottom
    gap = 0
    for y in range(bottom, -1, -1):
        if col[y]:
            top, gap = y, 0
        else:
            gap += 1
            if gap > 6:
                break
    row = dark[bottom, :]
    right = left
    gap = 0
    for x in range(left, W):
        if row[x]:
            right, gap = x, 0
        else:
            gap += 1
            if gap > 6:
                break
    return left, top, right, bottom


def _trace_rows(m, cols):
    """For every pixel column pick the run of curve pixels nearest the previous column,
    so that legend samples, labels and other traces of the same colour are skipped."""
    import numpy as np
    cand = []
    for c in cols:
        r = np.nonzero(m[:, c])[0]
        runs = np.split(r, np.nonzero(np.diff(r) > 3)[0] + 1)
        cand.append([(float(np.mean(x)), len(x)) for x in runs if len(x)])
    # start from the column whose biggest run is part of the longest smooth chain: use the first column
    # and the run with most pixels, then follow continuity
    out = []
    prev = None
    for cs in cand:
        if prev is None:
            pick = max(cs, key=lambda t: t[1])[0]
        else:
            pick = min(cs, key=lambda t: abs(t[0] - prev))[0]
        out.append(pick)
        prev = pick
    # reject isolated jumps (median of 5)
    o = np.array(out)
    if len(o) >= 5:
        med = np.array([np.median(o[max(0, i - 2):i + 3]) for i in range(len(o))])
        o = np.where(np.abs(o - med) > 6, med, o)
    return o


def digitize_image(data, axes, color=None, n_points=25, overlay_path=None):
    """data: image bytes.  axes: (x_at_left, x_at_right, y_at_bottom, y_at_top) of the plot box.
    color: (r,g,b) of the curve or None for the most frequent coloured trace.
    Returns list of curves [{'color':(r,g,b),'data':[[x,y],..]}] (largest first)."""
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert("RGB")
    rgb = np.asarray(im)
    L, T, R, B = detect_plot_box(rgb)
    if R - L < 20 or B - T < 20:
        raise ValueError("plot area not found")
    inner = rgb[T + 3:B - 2, L + 3:R - 2].astype(int)
    sat = inner.max(axis=2) - inner.min(axis=2)
    bright = inner.sum(axis=2) / 3
    colored = (sat > 60) & (bright < 235)
    curves = []
    if color is not None:
        targets = [tuple(int(c) for c in color)]
    elif colored.sum() > 30:
        q = (inner[colored] // 48) * 48 + 24
        keys, counts = np.unique(q, axis=0, return_counts=True)
        order = np.argsort(-counts)
        targets = []
        for o in order[:6]:
            k = tuple(int(v) for v in keys[o])
            if counts[o] < 30:
                break
            if all(sum((a - b) ** 2 for a, b in zip(k, t)) > 90 ** 2 for t in targets):
                targets.append(k)
    else:
        targets = [None]
    H, W = inner.shape[:2]
    for tgt in targets:
        if tgt is None:
            m = (bright < 110)
            # remove grid lines (long straight runs)
            m[m.sum(axis=1) > 0.5 * W, :] = False
            m[:, m.sum(axis=0) > 0.5 * H] = False
        else:
            d = ((inner - np.array(tgt)) ** 2).sum(axis=2)
            m = d < 70 ** 2
        cols = np.nonzero(m.any(axis=0))[0]
        if len(cols) < 5:
            continue
        rows = _trace_rows(m, cols)
        xs = axes[0] + (cols + 3) / (R - L) * (axes[1] - axes[0])
        ys = axes[2] + (B - (rows + T + 3)) / (B - T) * (axes[3] - axes[2])
        grid = np.linspace(xs.min(), xs.max(), n_points)
        yi = np.interp(grid, xs, ys)
        curves.append({"color": tgt, "data": [[round(float(a), 3), round(float(b), 3)] for a, b in zip(grid, yi)], "pixels": int(m.sum())})
    curves.sort(key=lambda c: -c["pixels"])
    if overlay_path and curves:
        from PIL import ImageDraw
        ov = im.copy()
        dr = ImageDraw.Draw(ov)
        dr.rectangle([L, T, R, B], outline=(255, 0, 255), width=2)
        for c in curves:
            pts = [(L + (x - axes[0]) / (axes[1] - axes[0]) * (R - L), B - (y - axes[2]) / (axes[3] - axes[2]) * (B - T)) for x, y in c["data"]]
            for p in pts:
                dr.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], outline=(0, 0, 0), width=2)
        ov.save(overlay_path)
    return curves


def read_train_docx(path, base=None, graph_axes=None, graph_kind="te", overlay_dir=None):
    """Read a Word train data sheet.  graph_axes: (x_left, x_right, y_bottom, y_top) applied to graph
    images when no curve table/chart of that kind exists.  Returns (train, report)."""
    blocks, charts, images = docx_blocks(path)
    T, report = train_from_blocks(blocks, charts, base)
    T["source"] = os.path.basename(path)
    report["images"] = [im["name"] for im in images]
    kinds = {c[0] for c in report["curves"]}
    if images and graph_axes and graph_kind not in kinds:
        for im in images:
            if not re.search(r"\.(png|jpe?g|bmp|gif)$", im["name"], re.I):
                report["log"].append(f"Image {im['name']}: format not readable (save the graph as PNG/JPG)")
                continue
            try:
                ov = os.path.join(overlay_dir, "digitised_" + os.path.splitext(im["name"])[0] + ".png") if overlay_dir else None
                cv = digitize_image(im["data"], graph_axes, overlay_path=ov)
            except Exception as e:  # noqa: BLE001
                report["log"].append(f"Image {im['name']}: {e}")
                continue
            if cv:
                key = {"te": "te_curve", "be": "be_curve", "eff": "eff_curve", "lc": "line_current"}[graph_kind]
                T[key] = cv[0]["data"]
                if graph_kind == "lc":
                    T["power_mode"] = "line_current"
                report["curves"].append((graph_kind, len(cv[0]["data"]), f"digitised from image {im['name']}", "image"))
                report["log"].append(f"Image {im['name']}: {len(cv)} trace(s) found, largest used as {graph_kind}; check overlay {ov}")
                break
    elif images and graph_kind not in kinds:
        report["log"].append(f"{len(images)} image(s) found. To read a graph image give the axis values with "
                             "--graph-axes x_left,x_right,y_bottom,y_top (or use the digitiser in the HTML model).")
    return T, report
