"""
DC Traction Power Simulation engine (TPS engine v1.0) - Python edition
=======================================================================
Line-by-line mirror of engine.js used by the HTML model, so that the
Python run and the browser run give the same numbers for the same inputs.

Units used everywhere
  chainage / distance : m          speed      : km/h (inputs), m/s inside
  force               : kN         mass       : t   (kN / t = m/s2)
  power               : kW         energy     : kWh
  voltage             : V          current    : A    resistance : ohm
  gradient            : per mille, + = rising with increasing chainage
Direction: UP trains run with increasing chainage, DN with decreasing.
"""
from __future__ import annotations

import copy
import json
import math
import os
import re

import numpy as np

G = 9.81
VERSION = "1.0"
HERE = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def num(v, d):
    if v is None or v == "":
        return d
    try:
        x = float(v)
    except (TypeError, ValueError):
        return d
    return x if math.isfinite(x) else d


def interp(tbl, x):
    if not tbl:
        return 0.0
    if x <= tbl[0][0]:
        return float(tbl[0][1])
    for i in range(1, len(tbl)):
        if x <= tbl[i][0]:
            x0, y0 = float(tbl[i - 1][0]), float(tbl[i - 1][1])
            x1, y1 = float(tbl[i][0]), float(tbl[i][1])
            return y1 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return float(tbl[-1][1])


def clean_table(t):
    out = []
    for r in t or []:
        try:
            a, b = float(r[0]), float(r[1])
        except (TypeError, ValueError, IndexError):
            continue
        if math.isfinite(a) and math.isfinite(b):
            out.append([a, b])
    out.sort(key=lambda r: r[0])
    return out


def is_active(t, outage):
    ins = t.get("in_service", True)
    return ins is not False and ins != "false" and str(t["name"]) not in outage


# ----------------------------------------------------------------------
# default inputs (same sample project as the HTML model)
# ----------------------------------------------------------------------
def defaults():
    with open(os.path.join(HERE, "default_inputs.json"), encoding="utf-8") as f:
        return json.load(f)


def generate_tracks(cfg):
    old = cfg.get("tracks", [])
    nu = max(0, round(num(cfg["track_gen"].get("n_up"), 1)))
    nd = max(0, round(num(cfg["track_gen"].get("n_down"), 1)))

    def tmpl(d, i):
        for t in old:
            if t["name"] == f"{d}{i + 1}":
                return t
        return {"name": f"{d}{i + 1}", "dir": d, "headway": 180,
                "offset": i * 30 if d == "UP" else 90 + i * 30, "train": 0, "skip": "", "enabled": True}

    cfg["tracks"] = [tmpl("UP", i) for i in range(nu)] + [tmpl("DN", i) for i in range(nd)]
    return cfg


def generate_tss(cfg):
    g = cfg["tss_gen"]
    n = max(1, round(num(g.get("count"), 1)))
    old = cfg.get("tss", [])
    out = []
    for i in range(n):
        p = old[i] if i < len(old) else {}
        out.append({
            "name": p.get("name") or f"TSS{i + 1}",
            "ch": num(g.get("first_ch"), 0) + i * num(g.get("spacing"), 3000),
            "rect_kW": num(g.get("rect_kW"), p.get("rect_kW", 3000)),
            "xfmr_kVA": num(g.get("xfmr_kVA"), p.get("xfmr_kVA", 3300)),
            "V0": p.get("V0", ""), "Req_mohm": p.get("Req_mohm", ""),
            "inv_kW": num(p.get("inv_kW"), 0), "in_service": p.get("in_service", True),
        })
    cfg["tss"] = out
    return cfg


# ----------------------------------------------------------------------
# alignment preparation
# ----------------------------------------------------------------------
def line_extent(cfg):
    A = cfg["alignment"]
    st = [float(s["ch"]) for s in A["stations"]]
    a = min(st) - 200 if A.get("start") in ("", None) else float(A["start"])
    b = max(st) + 200 if A.get("end") in ("", None) else float(A["end"])
    for t in cfg["tss"]:
        a = min(a, float(t["ch"]))
        b = max(b, float(t["ch"]))
    for s in st:
        a = min(a, s)
        b = max(b, s)
    return a, b


def curve_res(A, R):
    """Röckl type formula, result in N/kN (= per mille equivalent)."""
    R = abs(float(R or 0))
    if not R:
        return 0.0
    c = A.get("curve_res") or {"k1": 650, "c1": 55, "k2": 500, "c2": 30, "R_split": 300}
    if R >= c["R_split"]:
        return c["k1"] / max(R - c["c1"], 1)
    return c["k2"] / max(R - c["c2"], 10)


def grade_at(A, x):
    for s in A["gradients"]:
        if float(s["from"]) <= x < float(s["to"]):
            return float(s["g"])
    return 0.0


def radius_at(A, x):
    for s in A["curves"]:
        if float(s["from"]) <= x < float(s["to"]):
            return float(s["R"])
    return 0.0


class Prep:
    pass


def prep_alignment(cfg):
    A = cfg["alignment"]
    x0, x1 = line_extent(cfg)
    dx = 1.0
    N = max(1, math.ceil(x1 - x0))
    xm = x0 + (np.arange(N) + 0.5) * dx
    # first matching segment wins (same rule as the JS loop)
    g = np.array([grade_at(A, x) for x in xm])
    c = np.array([curve_res(A, radius_at(A, x)) for x in xm])
    P = Prep()
    P.x0, P.x1, P.dx, P.N = x0, x1, dx, N
    P.Cg = np.concatenate([[0.0], np.cumsum(g * dx)])
    P.Cc = np.concatenate([[0.0], np.cumsum(c * dx)])
    return P


def cum_at(P, C, x):
    u = (x - P.x0) / P.dx
    if u <= 0:
        return 0.0
    if u >= P.N:
        return float(C[P.N])
    i = int(math.floor(u))
    return float(C[i] + (C[i + 1] - C[i]) * (u - i))


def avg_over(P, C, xa, xb):
    if xb - xa < 1e-6:
        return cum_at(P, C, xa + 0.5) - cum_at(P, C, xa - 0.5)
    return (cum_at(P, C, xb) - cum_at(P, C, xa)) / (xb - xa)


def elevation_profile(cfg, step=20):
    A = cfg["alignment"]
    P = prep_alignment(cfg)
    xs = list(np.arange(P.x0, P.x1 + 1e-9, step))
    if A.get("elevations") and len(A["elevations"]) >= 2:
        tb = clean_table([[e["ch"], e["z"]] for e in A["elevations"]])
        return {"x": xs, "z": [interp(tb, x) for x in xs]}
    base = num(A.get("base_level"), 0)
    return {"x": xs, "z": [base + cum_at(P, P.Cg, x) / 1000 for x in xs]}


def speed_limit_at(cfg, train_len, vmax, x, d):
    A = cfg["alignment"]
    L = train_len
    v = vmax

    def applies(a, b):
        return (a < x < b + L) if d > 0 else (a - L < x < b)

    for s in A["speed"]:
        a, b = float(s["from"]), float(s["to"])
        if not applies(a, b):
            continue
        lim = num(s.get("up"), num(s.get("dn"), v)) if d > 0 else num(s.get("dn"), num(s.get("up"), v))
        if lim > 0:
            v = min(v, lim)
    if A.get("auto_curve_speed"):
        for c in A["curves"]:
            if not applies(float(c["from"]), float(c["to"])):
                continue
            vc = math.sqrt(num(A.get("cant_plus_def_mm"), 150) * abs(float(c["R"])) / num(A.get("gauge_const"), 11.82))
            if vc > 0:
                v = min(v, vc)
    return v


# ----------------------------------------------------------------------
# train data
# ----------------------------------------------------------------------
class TrainModel:
    pass


def train_model(cfg, idx):
    idx = min(max(0, int(idx or 0)), len(cfg["trains"]) - 1)
    T = cfg["trains"][idx]
    mult = max(1, num(T.get("n_motors"), 1)) if T.get("te_basis") == "motor" else 1
    tm = TrainModel()
    tm.raw = T
    tm.te = [[r[0], r[1] * mult] for r in clean_table(T.get("te_curve"))]
    tm.be = [[r[0], r[1] * mult] for r in clean_table(T.get("be_curve"))]
    tm.eff = clean_table(T.get("eff_curve"))
    tm.lc = clean_table(T.get("line_current"))
    tm.m = num(T.get("mass_t"), 300)
    tm.Meff = tm.m * (1 + num(T.get("rot_factor"), 0.08))
    tm.L = num(T.get("length_m"), 0)
    tm.vmax = num(T.get("vmax"), 80)
    tm.acc = num(T.get("acc"), 1.0)
    tm.dec = num(T.get("dec"), 1.0)
    tm.aux = num(T.get("aux_kW_car"), 0) * num(T.get("cars"), 1)
    dv = T.get("davis") or {}
    tm.A, tm.B, tm.C = num(dv.get("A"), 0), num(dv.get("B"), 0), num(dv.get("C"), 0)
    tm.mode = "line_current" if T.get("power_mode") == "line_current" and tm.lc else "efficiency"
    tm.regenK = num(T.get("regen_eff_factor"), 1.0)
    tm.regenMax = num(T.get("regen_max_kW"), 1e9)
    return tm


def eff_at(tm, vk):
    return min(1.0, max(0.05, interp(tm.eff, vk))) if tm.eff else 0.85


# ----------------------------------------------------------------------
# single train run (speed profile by forward / backward integration)
# ----------------------------------------------------------------------
def run_train(cfg, P, tm, d, stops, Vnom):
    dx = max(1.0, num(cfg["sim"].get("dx"), 5))
    ds = 1 if d > 0 else -1
    segs = []
    st = []
    t = 0.0
    warn = ""
    E_trac = E_regen = vpk = 0.0

    def resist(vms, xf):
        vk = vms * 3.6
        xa, xb = (xf - tm.L, xf) if ds > 0 else (xf, xf + tm.L)
        g = avg_over(P, P.Cg, xa, xb) if tm.L > 0 else avg_over(P, P.Cg, xf, xf)
        rc = avg_over(P, P.Cc, xa, xb) if tm.L > 0 else avg_over(P, P.Cc, xf, xf)
        return tm.A + tm.B * vk + tm.C * vk * vk + tm.m * G * g / 1000 * ds + tm.m * G * rc / 1000

    for k, s in enumerate(stops):
        if k == 0:
            st.append({"name": s["name"], "ch": float(s["ch"]), "arr": 0.0, "dep": 0.0})
            continue
        a, b = float(stops[k - 1]["ch"]), float(s["ch"])
        n = max(1, int(_jsround(abs(b - a) / dx)))
        h = abs(b - a) / n
        xs = [a + ds * h * j for j in range(n + 1)]
        vl = [speed_limit_at(cfg, tm.L, tm.vmax, x, ds) / 3.6 for x in xs]
        vb = [0.0] * (n + 1)
        v = [0.0] * (n + 1)
        for j in range(n - 1, -1, -1):
            vb[j] = min(vl[j], math.sqrt(vb[j + 1] ** 2 + 2 * tm.dec * h))
        vb[0] = 0.0
        for j in range(n):
            R = resist(v[j], xs[j])
            Fm = min(interp(tm.te, v[j] * 3.6), tm.Meff * tm.acc + R)
            acc = (Fm - R) / tm.Meff
            vf = math.sqrt(max(0.0, v[j] * v[j] + 2 * acc * h))
            if vf < 0.05 and v[j] < 0.05:
                vf = 0.05
                warn = f"Train cannot start on gradient near ch {round(xs[j])} m (tractive effort too low)"
            v[j + 1] = min(vb[j + 1], vf)
        for j in range(n):
            va, vbb = v[j], v[j + 1]
            vavg = max((va + vbb) / 2, 1e-3)
            dt = h / vavg
            F = tm.Meff * (vbb * vbb - va * va) / (2 * h) + resist(va, xs[j])
            vk = vavg * 3.6
            if F >= 0:
                if tm.mode == "line_current":
                    Fmax = max(interp(tm.te, vk), 1e-6)
                    Pm = Vnom * interp(tm.lc, vk) / 1000 * min(1.0, F / Fmax)
                else:
                    Pm = F * vavg / eff_at(tm, vk)
                E_trac += Pm * dt / 3600
            else:
                Fed = min(-F, interp(tm.be, vk)) if tm.be else -F
                Pm = -min(Fed * vavg * eff_at(tm, vk) * tm.regenK, tm.regenMax)
                E_regen += -Pm * dt / 3600
            segs.append((t, dt, xs[j], xs[j + 1], va, vbb, Pm + tm.aux, F))
            t += dt
            vpk = max(vpk, vbb)
        is_last = k == len(stops) - 1
        dw = 0 if is_last else num(s.get("dwell"), 30)
        st.append({"name": s["name"], "ch": float(s["ch"]), "arr": t, "dep": t + dw})
        if dw > 0:
            segs.append((t, dw, b, b, 0.0, 0.0, tm.aux, 0.0))
            t += dw

    dts = num(cfg["sim"].get("dt"), 1)
    ns = int(math.floor(t / dts)) + 1
    x = np.zeros(ns)
    vv = np.zeros(ns)
    Pw = np.zeros(ns)
    q = 0
    for i in range(ns):
        ti = i * dts
        while q < len(segs) - 1 and ti >= segs[q][0] + segs[q][1]:
            q += 1
        sg = segs[q]
        f = min(1.0, max(0.0, (ti - sg[0]) / sg[1])) if sg[1] > 0 else 0.0
        x[i] = sg[2] + (sg[3] - sg[2]) * f
        vv[i] = (sg[4] + (sg[5] - sg[4]) * f) * 3.6
        Pw[i] = sg[6]
    return {"dir": "UP" if ds > 0 else "DN", "T": t, "n": ns, "x": x, "v": vv, "P": Pw, "stations": st,
            "E_trac_kWh": E_trac, "E_regen_kWh": E_regen, "E_aux_kWh": tm.aux * t / 3600,
            "vmax_kmh": vpk * 3.6, "warn": warn}


def stops_for(cfg, track):
    skip = [s.strip().upper() for s in re.split(r"[,;\s]+", str(track.get("skip") or "")) if s.strip()]
    st = sorted([s for s in cfg["alignment"]["stations"] if str(s["name"]).upper() not in skip], key=lambda s: float(s["ch"]))
    if track.get("dir") == "DN":
        st = st[::-1]
    return st


# ----------------------------------------------------------------------
# network
# ----------------------------------------------------------------------
def ac_params(cfg, t):
    """AC supply, transformer and rectifier data of one TSS (valve-side quantities per bridge)."""
    A = cfg.get("ac") or {}
    E = cfg["electrical"]
    V0 = num(t.get("V0"), num(E.get("V0"), 830))
    S = max(num(t.get("xfmr_kVA"), 3300), 1) * 1000
    nb = max(1, int(_jsround(num(A.get("pulse"), 12) / 6)))
    Uv = num(A.get("U_v"), V0 / 1.35)
    f = num(A.get("f"), 50)
    w = 2 * math.pi * f
    Sb = S / nb
    Zb = Uv * Uv / Sb
    uk, pcu = num(A.get("uk_pct"), 7) / 100, num(A.get("pcu_pct"), 1) / 100
    Rtr, Xtr = pcu * Zb, math.sqrt(max(uk * uk - pcu * pcu, 0)) * Zb
    Ssc = max(num(A.get("S_sc_MVA"), 500), 1e-3) * 1e6
    XR = max(num(A.get("XR"), 10), 0.01)
    Zg = nb * Uv * Uv / Ssc
    Xg, Rg = Zg * XR / math.sqrt(1 + XR * XR), Zg / math.sqrt(1 + XR * XR)
    Xc, Rc = Xtr + Xg, Rtr + Rg
    ReqAC = (3 * Xc / math.pi + 2 * Rc) / nb
    Ldc = (2 * Xc / w) / nb + num(A.get("L_smooth_mH"), 0) / 1000
    Uhv = num(A.get("U_hv_kV"), 33) * 1000
    c = num(A.get("c_max"), 1.1)
    kap = lambda r: 1.02 + 0.98 * math.exp(-3 * r)
    IkHV = c * Ssc / (math.sqrt(3) * Uhv)
    IkLV = c * Uv / (math.sqrt(3) * math.hypot(Rc, Xc))
    return {"V0": V0, "S": S, "nb": nb, "Uv": Uv, "f": f, "w": w, "Xtr": Xtr, "Rtr": Rtr, "Xg": Xg, "Rg": Rg, "Xc": Xc, "Rc": Rc,
            "ReqAC": ReqAC, "Ldc": Ldc, "Uhv": Uhv, "Ssc": Ssc, "XR": XR, "XgHV": Uhv * Uhv / Ssc * XR / math.sqrt(1 + XR * XR),
            "IkHV": IkHV, "ipHV": kap(1 / XR) * math.sqrt(2) * IkHV, "IkLV": IkLV, "ipLV": kap(Rc / Xc) * math.sqrt(2) * IkLV}


def tss_params(cfg):
    E = cfg["electrical"]
    sfa = (cfg.get("ac") or {}).get("source_from_ac")
    from_ac = sfa is True or sfa == "true"
    out = []
    for t in cfg["tss"]:
        Ir = num(t.get("rect_kW"), 3000) * 1000 / num(E.get("V_nom"), 750)
        V0 = num(t.get("V0"), num(E.get("V0"), 830))
        ac = ac_params(cfg, t)
        ReqA = ac["ReqAC"] if from_ac else num(E.get("regulation_pct"), 6) / 100 * num(E.get("V_nom"), 750) / max(Ir, 1)
        Req = ReqA if t.get("Req_mohm") in ("", None) else num(t.get("Req_mohm"), ReqA * 1000) / 1000
        out.append({"name": t["name"], "ch": float(t["ch"]), "V0": V0, "Req": max(Req, 1e-5), "Ir": Ir,
                    "inv": num(t.get("inv_kW"), 0), "rect_kW": num(t.get("rect_kW"), 0), "xfmr_kVA": num(t.get("xfmr_kVA"), 0),
                    "Ldc": max(ac["Ldc"], 1e-7), "ac": ac})
    return out


class Net:
    pass


def build_network(cfg, ext, tp, active, tracks, trains_on_track, fault):
    E = cfg["electrical"]
    rLoop = (num(E.get("r_pos"), 0.007) + num(E.get("r_ret"), 0.015)) / 1000
    Rf = max(num(E.get("R_feeder"), 0.003), 1e-6)
    nodes = []
    bus_idx = {}
    for i in range(len(tp)):
        if active[i]:
            bus_idx[i] = len(nodes)
            nodes.append({"x": tp[i]["ch"], "kind": 0, "k": -1, "i": i})
    edges = []
    tap_node = []
    train_node = []
    for k in range(len(tracks)):
        pts = [{"x": ext[0], "kind": 1, "k": k, "i": 0}, {"x": ext[1], "kind": 1, "k": k, "i": 1}]
        for i in range(len(tp)):
            pts.append({"x": tp[i]["ch"], "kind": 2, "k": k, "i": i})
        tl = trains_on_track[k] if k < len(trains_on_track) else []
        for j, tr in enumerate(tl):
            pts.append({"x": tr["x"], "kind": 3, "k": k, "i": j})
        if fault and fault["k"] == k:
            pts.append({"x": fault["x"], "kind": 4, "k": k, "i": 0})
        pts.sort(key=lambda p: (p["x"], p["kind"], p["i"]))
        tn = {}
        trn = {}
        prev = -1
        for p in pts:
            nid = len(nodes)
            nodes.append(p)
            if p["kind"] == 2:
                tn[p["i"]] = nid
            if p["kind"] == 3:
                trn[p["i"]] = nid
            if p["kind"] == 4:
                fault["node"] = nid
            if prev >= 0:
                ln = abs(p["x"] - nodes[prev]["x"])
                edges.append((prev, nid, 1 / max(rLoop * ln, 1e-6), 0, k))
            prev = nid
        tap_node.append(tn)
        train_node.append(trn)
        for i in range(len(tp)):
            if active[i]:
                edges.append((bus_idx[i], tn[i], 1 / Rf, 1, k))
    net = Net()
    net.nodes, net.edges, net.bus_idx, net.tap_node, net.train_node, net.n = nodes, edges, bus_idx, tap_node, train_node, len(nodes)
    n = net.n
    Y = np.zeros((n, n))
    ea = np.array([e[0] for e in edges], dtype=int)
    eb = np.array([e[1] for e in edges], dtype=int)
    eg = np.array([e[2] for e in edges])
    np.add.at(Y, (ea, ea), eg)
    np.add.at(Y, (eb, eb), eg)
    np.add.at(Y, (ea, eb), -eg)
    np.add.at(Y, (eb, ea), -eg)
    Y[np.diag_indices(n)] += 1e-6
    net.Y = Y
    net.ea, net.eb, net.eg = ea, eb, eg
    return net


def solve_net(net, diag, inj):
    Y = net.Y.copy()
    Y[np.diag_indices(net.n)] += diag
    return np.linalg.solve(Y, inj)


def rms_stats(arr, dt):
    a = np.abs(np.asarray(arr, dtype=np.float64))
    n = len(a)
    S = np.concatenate([[0.0], np.cumsum(a * a)])

    def win(sec):
        w = max(1, int(_jsround(sec / dt)))
        if w >= n:
            return math.sqrt(S[n] / max(n, 1))
        return math.sqrt(float(np.max(S[w:] - S[:-w])) / w)

    return {"pk": float(a.max()) if n else 0.0, "avg": float(np.sum(arr)) / max(n, 1),
            "rms": math.sqrt(S[n] / max(n, 1)), "r1h": win(3600), "r15": win(900), "r1": win(60)}


# ----------------------------------------------------------------------
# main time-step simulation
# ----------------------------------------------------------------------
def simulate(cfg_in, outage=None, name=None, progress=None):
    cfg = copy.deepcopy(cfg_in)
    outage = [str(o) for o in (outage or [])]
    E, S = cfg["electrical"], cfg["sim"]
    dt = num(S.get("dt"), 1)
    period = num(S.get("period"), 3600)
    nSteps = max(1, int(_jsround(period / dt)))
    P = prep_alignment(cfg)
    ext = (P.x0, P.x1)
    tp = tss_params(cfg)
    active = [is_active(t, outage) for t in cfg["tss"]]
    tracks = [t for t in cfg["tracks"] if t.get("enabled", True) is not False]
    Vnom = num(E.get("V_nom"), 750)

    runs = {}
    warns = []
    track_info = []
    for tr in tracks:
        tm = train_model(cfg, num(tr.get("train"), 0))
        d = -1 if tr.get("dir") == "DN" else 1
        stops = stops_for(cfg, tr)
        key = f"{int(num(tr.get('train'), 0))}|{tr.get('dir')}|" + ",".join(s["name"] for s in stops)
        if key not in runs:
            runs[key] = run_train(cfg, P, tm, d, stops, Vnom)
            runs[key]["train"] = tm.raw.get("name")
            runs[key]["key"] = key
            if runs[key]["warn"]:
                warns.append(runs[key]["warn"])
        run = runs[key]
        h = max(1, num(tr.get("headway"), 150))
        off = num(tr.get("offset"), 0)
        deps = []
        i = math.floor((-run["T"] - off) / h)
        while off + i * h < period:
            t0 = off + i * h
            if t0 + run["T"] >= 0:
                deps.append(t0)
            i += 1
        track_info.append({"name": tr["name"], "dir": tr.get("dir"), "headway": h, "key": key, "deps": deps,
                           "tph": 3600 / h, "trip": run["T"], "inService": math.ceil(run["T"] / h)})

    nT = len(tp)
    nK = len(tracks)
    tssI = np.zeros((nT, nSteps), dtype=np.float32)
    tssV = np.full((nT, nSteps), np.nan, dtype=np.float32)
    tssInv = np.zeros((nT, nSteps), dtype=np.float32)
    feederI = np.zeros((nK, nT, nSteps), dtype=np.float32)
    condL = np.zeros((nK, nT, nSteps), dtype=np.float32)
    condR = np.zeros((nK, nT, nSteps), dtype=np.float32)
    vTrainMin = np.full(nSteps, np.nan, dtype=np.float32)
    vTrainMax = np.full(nSteps, np.nan, dtype=np.float32)
    trOff = np.zeros(nSteps + 1, dtype=np.int32)
    trXa, trIa = [], []
    nTrains = np.zeros(nSteps, dtype=np.int16)
    binM = num(S.get("bin_m"), 100)
    nBins = max(1, math.ceil((ext[1] - ext[0]) / binM))
    envMin = np.full((nK, nBins), 1e9)
    envMax = np.full((nK, nBins), -1e9)
    envSum = np.zeros((nK, nBins))
    envCnt = np.zeros((nK, nBins))
    vMin, vMax, vMinAt, vMaxAt = 1e9, -1e9, None, None
    uSum = uCnt = 0.0
    E_tss = E_inv = E_loss = E_rheo = E_trainIn = E_regenOut = 0.0
    itMaxUsed = nonConv = 0
    Vprev = {}
    Vr0, Vr1 = num(E.get("V_regen_start"), 900), num(E.get("V_regen_max"), 950)
    Vc0, Vc1 = num(E.get("V_cut_start"), 600), num(E.get("V_cut_zero"), 500)
    Vinv = num(E.get("V_inv_on"), 880)
    Ginv = 1 / max(num(E.get("R_inv"), 0.005), 1e-5)
    itMax = max(5, int(num(S.get("iter_max"), 40)))
    tol = num(S.get("tol_V"), 0.05)
    Rf = max(num(E.get("R_feeder"), 0.003), 1e-6)
    V0def = num(E.get("V0"), 830)

    def cut(Vt):
        if Vt <= Vc1:
            return 0.0
        if Vt < Vc0:
            return (Vt - Vc1) / (Vc0 - Vc1)
        return 1.0

    for s in range(nSteps):
        if progress and s % 300 == 0:
            progress(s, nSteps)
        t = s * dt
        tot = [[] for _ in tracks]
        for k, ti in enumerate(track_info):
            run = runs[ti["key"]]
            for d, t0 in enumerate(ti["deps"]):
                rel = t - t0
                if rel < 0 or rel > run["T"]:
                    continue
                q = min(run["n"] - 1, int(_jsround(rel / dt)))
                tot[k].append({"x": float(run["x"][q]), "P": float(run["P"][q]), "id": f"{ti['name']}#{d}"})
        net = build_network(cfg, ext, tp, active, tracks, tot, None)
        N = net.n
        tl = []
        for k in range(nK):
            for j, tr in enumerate(tot[k]):
                tl.append({"node": net.train_node[k][j], "P": tr["P"], "id": tr["id"], "k": k, "x": tr["x"],
                           "V": Vprev.get(tr["id"], V0def)})
        blocked = [0] * nT
        inv_state = [0] * nT
        V = None
        conv = False
        it = 0
        for it in range(itMax):
            diag = np.zeros(N)
            inj = np.zeros(N)
            for i in range(nT):
                if not active[i]:
                    continue
                bn = net.bus_idx[i]
                if not blocked[i]:
                    diag[bn] += 1 / tp[i]["Req"]
                    inj[bn] += tp[i]["V0"] / tp[i]["Req"]
                if tp[i]["inv"] > 0:
                    if inv_state[i] == 1:
                        diag[bn] += Ginv
                        inj[bn] += Ginv * Vinv
                    elif inv_state[i] == 2:
                        inj[bn] -= tp[i]["inv"] * 1000 / Vinv
            for tr in tl:
                Vt = max(tr["V"], 50)
                if tr["P"] >= 0:
                    inj[tr["node"]] -= tr["P"] * 1000 * cut(Vt) / Vt
                elif Vt < Vr0:
                    inj[tr["node"]] += -tr["P"] * 1000 / Vt
                else:
                    g = (-tr["P"] * 1000 / Vr0) / max(Vr1 - Vr0, 1)
                    diag[tr["node"]] += g
                    inj[tr["node"]] += g * Vr1
            V = solve_net(net, diag, inj)
            changed = False
            for i in range(nT):
                if not active[i]:
                    continue
                vb = V[net.bus_idx[i]]
                if not blocked[i] and vb > tp[i]["V0"] + 1e-6:
                    blocked[i] = 1
                    changed = True
                elif blocked[i] and vb < tp[i]["V0"] - 1e-6:
                    blocked[i] = 0
                    changed = True
                if tp[i]["inv"] > 0:
                    Imax = tp[i]["inv"] * 1000 / Vinv
                    if inv_state[i] == 0 and vb > Vinv + 1e-6:
                        inv_state[i] = 1
                        changed = True
                    elif inv_state[i] == 1:
                        Ii = (vb - Vinv) * Ginv
                        if Ii < 0:
                            inv_state[i] = 0
                            changed = True
                        elif Ii > Imax:
                            inv_state[i] = 2
                            changed = True
                    elif inv_state[i] == 2 and vb < Vinv + Imax / Ginv - 1e-6:
                        inv_state[i] = 1
                        changed = True
            dmax = 0.0
            w = 1.0 if it < 10 else 0.5
            for tr in tl:
                vn = V[tr["node"]]
                dmax = max(dmax, abs(vn - tr["V"]))
                tr["V"] = tr["V"] + w * (vn - tr["V"])
            if not changed and dmax < tol:
                conv = True
                break
        itMaxUsed = max(itMaxUsed, it + 1)
        if not conv:
            nonConv += 1

        for i in range(nT):
            if not active[i]:
                continue
            vb = V[net.bus_idx[i]]
            Is = 0.0 if blocked[i] else max(0.0, (tp[i]["V0"] - vb) / tp[i]["Req"])
            Ii = 0.0
            if inv_state[i] == 1:
                Ii = max(0.0, (vb - Vinv) * Ginv)
            elif inv_state[i] == 2:
                Ii = tp[i]["inv"] * 1000 / Vinv
            tssI[i, s] = Is
            tssV[i, s] = vb
            tssInv[i, s] = Ii
            E_tss += vb * Is * dt / 3.6e6
            E_inv += vb * Ii * dt / 3.6e6
        for k in range(nK):
            for i in range(nT):
                if active[i]:
                    feederI[k, i, s] = (V[net.bus_idx[i]] - V[net.tap_node[k][i]]) / Rf
        Ie = (V[net.ea] - V[net.eb]) * net.eg
        E_loss += float(np.sum(Ie * Ie / net.eg)) * dt / 3.6e6
        for ei, e in enumerate(net.edges):
            if e[3] != 0:
                continue
            na, nb = net.nodes[e[0]], net.nodes[e[1]]
            if nb["kind"] == 2:
                condL[e[4], nb["i"], s] = Ie[ei]
            if na["kind"] == 2:
                condR[e[4], na["i"], s] = Ie[ei]
        mn, mx, cnt = 1e9, -1e9, 0
        for tr in tl:
            v = float(V[tr["node"]])
            tr["V"] = v
            Vprev[tr["id"]] = v
            mn, mx, cnt = min(mn, v), max(mx, v), cnt + 1
            if v < vMin:
                vMin, vMinAt = v, {"t": t, "x": tr["x"], "track": tracks[tr["k"]]["name"], "train": tr["id"]}
            if v > vMax:
                vMax, vMaxAt = v, {"t": t, "x": tr["x"], "track": tracks[tr["k"]]["name"], "train": tr["id"]}
            bi = min(nBins - 1, max(0, math.floor((tr["x"] - ext[0]) / binM)))
            envMin[tr["k"], bi] = min(envMin[tr["k"], bi], v)
            envMax[tr["k"], bi] = max(envMax[tr["k"], bi], v)
            envSum[tr["k"], bi] += v
            envCnt[tr["k"], bi] += 1
            if tr["P"] >= 0:
                Pa = tr["P"] * cut(max(v, 50))
                E_trainIn += Pa * dt / 3600
                trXa.append(tr["x"])
                trIa.append(Pa * 1000 / max(v, 50))
                if tr["P"] > 0:
                    uSum += v
                    uCnt += 1
            else:
                Vt = max(tr["V"], 50)
                Iinj = (-tr["P"] * 1000 / Vt) if Vt < Vr0 else (-tr["P"] * 1000 / Vr0) * max(0.0, Vr1 - v) / max(Vr1 - Vr0, 1)
                Pa = -Iinj * v / 1000
                trXa.append(tr["x"])
                trIa.append(-Iinj)
                E_regenOut += -Pa * dt / 3600
                E_rheo += max(0.0, -tr["P"] + Pa) * dt / 3600
        if cnt:
            vTrainMin[s], vTrainMax[s] = mn, mx
        nTrains[s] = cnt
        trOff[s + 1] = len(trXa)

    pf, re_ = num(E.get("pf"), 0.95), num(E.get("rect_eff"), 0.985)
    tss_res = []
    for i, p in enumerate(tp):
        st = rms_stats(tssI[i], dt)
        vb = np.nan_to_num(tssV[i].astype(np.float64), nan=0.0)
        Pk = vb * tssI[i].astype(np.float64) / 1000
        Sk = Pk / (pf * re_)
        sp, ss = rms_stats(Pk, dt), rms_stats(Sk, dt)
        eK = float(np.sum(Pk)) * dt / 3600
        eInv = float(np.sum(vb * tssInv[i] / 1000)) * dt / 3600
        tss_res.append({
            "name": p["name"], "ch": p["ch"], "active": active[i], "rect_kW": p["rect_kW"], "xfmr_kVA": p["xfmr_kVA"],
            "Ir": p["Ir"], "V0": p["V0"], "Req": p["Req"], "inv_kW": p["inv"],
            "Ipk": st["pk"], "Iavg": st["avg"], "Irms": st["rms"], "I1h": st["r1h"], "I15": st["r15"], "I1": st["r1"],
            "Pavg": sp["avg"], "Ppk": sp["pk"], "P1h": sp["r1h"], "S1h": ss["r1h"], "S15": ss["r15"], "S1": ss["r1"], "Spk": ss["pk"],
            "E_kWh": eK, "Einv_kWh": eInv,
            "Vmin": float(np.min(vb)) if active[i] else None, "Vmax": float(np.max(vb)) if active[i] else None})
    cond, feed = [], []
    for k in range(nK):
        for i in range(nT):
            L, R = rms_stats(condL[k, i], dt), rms_stats(condR[k, i], dt)
            cond.append({"track": tracks[k]["name"], "tss": tp[i]["name"], "ch": tp[i]["ch"], "side": "left",
                         "Ipk": L["pk"], "Irms": L["rms"], "I1h": L["r1h"], "I15": L["r15"]})
            cond.append({"track": tracks[k]["name"], "tss": tp[i]["name"], "ch": tp[i]["ch"], "side": "right",
                         "Ipk": R["pk"], "Irms": R["rms"], "I1h": R["r1h"], "I15": R["r15"]})
            if active[i]:
                F = rms_stats(feederI[k, i], dt)
                feed.append({"track": tracks[k]["name"], "tss": tp[i]["name"], "ch": tp[i]["ch"],
                             "Ipk": F["pk"], "Irms": F["rms"], "I1h": F["r1h"], "I15": F["r15"]})
    env = []
    for k, tr in enumerate(tracks):
        m = envCnt[k] > 0
        b = np.nonzero(m)[0]
        env.append({"track": tr["name"], "x": list(ext[0] + (b + 0.5) * binM), "min": list(envMin[k][m]),
                    "max": list(envMax[k][m]), "mean": list(envSum[k][m] / envCnt[k][m])})
    res = {
        "engine": "TPS engine v" + VERSION + " (Python)",
        "scenario": name or ("Outage: " + " + ".join(outage) if outage else "Normal service"),
        "outage": outage, "contingency": len(outage) > 0 or not all(active),
        "period": period, "dt": dt, "extent": list(ext),
        "tracks": [{k: v for k, v in t.items()} for t in track_info],
        "runs": runs, "tss": tss_res, "conductor": cond, "feeders": feed,
        "trainV": {"min": vMin if vMin < 1e9 else None, "max": vMax if vMax > -1e9 else None,
                   "minAt": vMinAt, "maxAt": vMaxAt, "mean_useful": uSum / uCnt if uCnt else None, "envelope": env},
        "energy": {"tss_kWh": E_tss, "inverter_kWh": E_inv, "losses_kWh": E_loss, "rheostat_kWh": E_rheo,
                   "train_in_kWh": E_trainIn, "regen_out_kWh": E_regenOut},
        "ts": {"tssI": tssI, "tssV": tssV, "tssInv": tssInv, "vTrainMin": vTrainMin, "vTrainMax": vTrainMax, "nTrains": nTrains,
               "trOff": trOff, "trX": np.array(trXa, dtype=np.float32), "trI": np.array(trIa, dtype=np.float32)},
        "solver": {"iter_max_used": itMaxUsed, "non_converged_steps": nonConv},
        "warnings": warns,
    }
    res["checks"] = checks(cfg, res)
    return res


def _jsround(x):
    """JavaScript Math.round (half rounds up), used to pick the same sample as the browser."""
    return math.floor(x + 0.5)


# ----------------------------------------------------------------------
# DC short circuit scan (no trains): sustained current from the resistance
# network, initial rate of rise from the inductance network,
# first-order rise i(t) = Iss (1 - exp(-t/tau))
# ----------------------------------------------------------------------
def rail_params(cfg, nTr):
    E, M = cfg["electrical"], cfg.get("emc") or {}
    r = num(E.get("r_ret"), 0.015) / 1000 / max(nTr, 1)
    g = max(num(M.get("g_track_S_km"), 0.1), 1e-6) / 1000 * max(nTr, 1)
    return {"r": r, "g": g, "gamma": math.sqrt(r * g), "Zin": 0.5 * math.sqrt(r / g)}


def _solve_edges(n, edges, diag, inj):
    Y = np.zeros((n, n))
    ea = np.array([e[0] for e in edges], dtype=int)
    eb = np.array([e[1] for e in edges], dtype=int)
    eg = np.array([e[2] for e in edges])
    np.add.at(Y, (ea, ea), eg)
    np.add.at(Y, (eb, eb), eg)
    np.add.at(Y, (ea, eb), -eg)
    np.add.at(Y, (eb, ea), -eg)
    Y[np.diag_indices(n)] += 1e-6 + diag
    return np.linalg.solve(Y, inj)


def fault_scan(cfg_in, outage=None):
    cfg = copy.deepcopy(cfg_in)
    outage = [str(o) for o in (outage or [])]
    P = prep_alignment(cfg)
    ext = (P.x0, P.x1)
    tp = tss_params(cfg)
    active = [is_active(t, outage) for t in cfg["tss"]]
    tracks = [t for t in cfg["tracks"] if t.get("enabled", True) is not False]
    step = max(10, num(cfg["sim"].get("fault_step"), 100))
    Rflt = max(num(cfg["sim"].get("R_fault"), 0.001), 1e-5)
    Rfd = max(num(cfg["electrical"].get("R_feeder"), 0.003), 1e-6)
    SC = cfg.get("sc") or {}
    Lp = max(num(SC.get("L_line_mH_km"), 0.9), 1e-6) / 1e6
    Lfd = max(num(SC.get("L_feeder_mH"), 0.03), 1e-6) / 1000
    trip = num(cfg["limits"].get("breaker_trip_A"), 8000)
    rail = rail_params(cfg, len(tracks))
    out = []
    for k in range(len(tracks)):
        xs = set()
        x = ext[0]
        while x <= ext[1] + 1e-9:
            xs.add(round(x, 3))
            x += step
        for t in tp:
            xs.add(t["ch"])
        xs = sorted(xs)
        If, Inear, didt, didtF, tau, ttrip, Urail = [], [], [], [], [], [], []
        for x in xs:
            fault = {"k": k, "x": x}
            net = build_network(cfg, ext, tp, active, tracks, [[] for _ in tracks], fault)
            diag = np.zeros(net.n)
            inj = np.zeros(net.n)
            for i in range(len(tp)):
                if active[i]:
                    diag[net.bus_idx[i]] += 1 / tp[i]["Req"]
                    inj[net.bus_idx[i]] += tp[i]["V0"] / tp[i]["Req"]
            diag[fault["node"]] += 1 / Rflt
            V = solve_net(net, diag, inj)
            Iss = float(V[fault["node"]] / Rflt)
            If.append(Iss)
            mx, mi = 0.0, -1
            for i in range(len(tp)):
                if active[i]:
                    I = float((V[net.bus_idx[i]] - V[net.tap_node[k][i]]) / Rfd)
                    if I > mx:
                        mx, mi = I, i
            Inear.append(mx)
            edgesL = []
            for e in net.edges:
                if e[3] == 0:
                    ln = abs(net.nodes[e[0]]["x"] - net.nodes[e[1]]["x"])
                    edgesL.append((e[0], e[1], 1 / max(Lp * ln, 1e-12)))
                else:
                    edgesL.append((e[0], e[1], 1 / Lfd))
            dL = np.zeros(net.n)
            jL = np.zeros(net.n)
            for i in range(len(tp)):
                if active[i]:
                    dL[net.bus_idx[i]] += 1 / tp[i]["Ldc"]
                    jL[net.bus_idx[i]] += tp[i]["V0"] / tp[i]["Ldc"]
            Gf = 1e8
            dL[fault["node"]] += Gf
            VL = _solve_edges(net.n, edgesL, dL, jL)
            d0 = float(VL[fault["node"]] * Gf)
            dF = float((VL[net.bus_idx[mi]] - VL[net.tap_node[k][mi]]) / Lfd) if mi >= 0 else 0.0
            didt.append(d0 / 1000)
            didtF.append(dF / 1000)
            tf = mx / dF if dF > 0 else 0.0
            tau.append(Iss / d0 * 1000 if Iss > 0 and d0 > 0 else 0.0)
            ttrip.append(-tf * math.log(1 - trip / mx) * 1000 if mx > trip and tf > 0 else None)
            dn = min([abs(tp[i]["ch"] - x) for i in range(len(tp)) if active[i]] or [1e12])
            Urail.append(Iss * rail["Zin"] * (1 - math.exp(-rail["gamma"] * min(dn, 1e7))))
        tt = [v for v in ttrip if v is not None]
        out.append({"track": tracks[k]["name"], "x": xs, "If": If, "Ifeeder": Inear, "didt": didt, "didtFeeder": didtF,
                    "tau_ms": tau, "ttrip_ms": ttrip, "Urail": Urail, "max": max(If), "min": min(If), "minFeeder": min(Inear),
                    "minDidtFeeder": min(didtF), "maxTtrip": max(tt) if tt else None, "notTripped": len(ttrip) - len(tt),
                    "maxUrail": max(Urail)})
    tssAC = []
    for i, t in enumerate(tp):
        ac = t["ac"]
        tssAC.append({"name": t["name"], "ch": t["ch"], "active": active[i], "V0": t["V0"], "Req_mohm": t["Req"] * 1000,
                      "Ldc_mH": t["Ldc"] * 1000, "IkD_kA": t["V0"] / t["Req"] / 1000, "didtD_A_ms": t["V0"] / t["Ldc"] / 1000,
                      "tauD_ms": t["Ldc"] / t["Req"] * 1000, "Uv": ac["Uv"], "nb": ac["nb"], "Xc_mohm": ac["Xc"] * 1000,
                      "IkHV_kA": ac["IkHV"] / 1000, "ipHV_kA": ac["ipHV"] / 1000, "IkLV_kA": ac["IkLV"] / 1000,
                      "ipLV_kA": ac["ipLV"] / 1000, "ReqAC_mohm": ac["ReqAC"] * 1000})
    return {"tracks": out, "tssAC": tssAC, "rail": rail,
            "scenario": "Outage: " + " + ".join(outage) if outage else "Normal service"}


# ----------------------------------------------------------------------
# rectifier harmonics (AC side) and DC ripple
# ----------------------------------------------------------------------
def harmonic_ratio(h, mu):
    """I_h / I_1 for an uncontrolled bridge with commutation overlap mu (rad)."""
    if mu < 1e-3:
        return 1 / h
    A = math.sin((h - 1) * mu / 2) / (h - 1)
    B = math.sin((h + 1) * mu / 2) / (h + 1)
    return math.sqrt(max(0.0, A * A + B * B - 2 * A * B * math.cos(mu))) / (h * (1 - math.cos(mu)))


def percentile(arr, p):
    a = np.sort(np.asarray([v for v in np.asarray(arr, dtype=np.float64) if math.isfinite(v)]))
    if not len(a):
        return 0.0
    k = (len(a) - 1) * p / 100
    i = int(math.floor(k))
    f = k - i
    return float(a[i] + (a[i + 1] - a[i]) * f) if i + 1 < len(a) else float(a[i])


def harm_limit(cfg, h):
    for r in (cfg.get("harm") or {}).get("limits", []) or []:
        if float(r[0]) == h:
            return float(r[1])
    return None


def section_length(tp, active, ext, i):
    xs = sorted(t["ch"] for j, t in enumerate(tp) if active[j])
    x = tp[i]["ch"]
    k = xs.index(x) if x in xs else -1
    left = (x - xs[k - 1]) / 2 if k > 0 else x - ext[0]
    right = (xs[k + 1] - x) / 2 if 0 <= k < len(xs) - 1 else ext[1] - x
    return max(left + right, 1)


def harmonics(cfg_in, r):
    cfg = copy.deepcopy(cfg_in)
    H, A = cfg.get("harm") or {}, cfg.get("ac") or {}
    tp = tss_params(cfg)
    active = [t["active"] for t in r["tss"]]
    pulse = max(6, int(_jsround(num(A.get("pulse"), 12) / 6)) * 6)
    hmax = max(5, int(_jsround(num(H.get("h_max"), 49))))
    resid = num(H.get("residual_pct"), 7.5) / 100
    pct = num(H.get("percentile"), 95)
    orders = []
    k = 1
    while 6 * k - 1 <= hmax:
        orders.append(6 * k - 1)
        if 6 * k + 1 <= hmax:
            orders.append(6 * k + 1)
        k += 1
    is_char = lambda h: (h - 1) % pulse == 0 or (h + 1) % pulse == 0
    kh = [1.0 if is_char(h) else resid for h in orders]
    n = r["ts"]["tssI"].shape[1] if len(r["ts"]["tssI"]) else 0
    Lp = max(num((cfg.get("sc") or {}).get("L_line_mH_km"), 0.9), 1e-6) / 1e6

    def spectrum_at(ac, Id):
        Idb = Id / ac["nb"]
        c = min(1.0, max(-1.0, 1 - math.sqrt(2) * ac["Xc"] * Idb / ac["Uv"]))
        mu = math.acos(c)
        I1 = ac["nb"] * math.sqrt(6) / math.pi * Idb * ac["Uv"] / ac["Uhv"]
        Ih = [I1 * harmonic_ratio(h, mu) * kh[j] for j, h in enumerate(orders)]
        Vh = [Ih[j] * h * ac["XgHV"] / (ac["Uhv"] / math.sqrt(3)) * 100 for j, h in enumerate(orders)]
        return mu, I1, Ih, Vh

    out, VhAll = [], []
    for i, t in enumerate(tp):
        if not active[i]:
            out.append({"name": t["name"], "ch": t["ch"], "active": False})
            VhAll.append(None)
            continue
        ac = t["ac"]
        I = r["ts"]["tssI"][i]
        vh = np.zeros((len(orders), n), dtype=np.float32)
        thdv = np.zeros(n, dtype=np.float32)
        thdi = np.zeros(n, dtype=np.float32)
        for s_ in range(n):
            Id = float(I[s_])
            if Id < 1:
                continue
            mu, I1, Ih, Vh = spectrum_at(ac, Id)
            sv = si = 0.0
            for j in range(len(orders)):
                vh[j, s_] = Vh[j]
                sv += Vh[j] * Vh[j]
                si += Ih[j] * Ih[j]
            thdv[s_] = math.sqrt(sv)
            thdi[s_] = math.sqrt(si) / I1 * 100
        VhAll.append(vh)
        mu_r, I1_r, Ih_r, Vh_r = spectrum_at(ac, t["Ir"])
        secLen = section_length(tp, active, r["extent"], i)
        Lloop = t["Ldc"] + Lp * secLen / 4
        dc = []
        for kk in range(1, 5):
            nn = kk * pulse
            fn = nn * ac["f"]
            Vn = t["V0"] * math.sqrt(2) / (nn * nn - 1)
            dc.append({"n": nn, "f": fn, "V": Vn, "I": Vn / (2 * math.pi * fn * Lloop)})
        out.append({"name": t["name"], "ch": t["ch"], "active": True, "Uv": ac["Uv"], "nb": ac["nb"], "Xc": ac["Xc"],
                    "Uhv": ac["Uhv"], "Ssc": ac["Ssc"], "XgHV": ac["XgHV"], "mu_rated_deg": mu_r * 180 / math.pi,
                    "I1_rated": I1_r, "Ih_rated": Ih_r, "Vh_rated": Vh_r, "Ipk": r["tss"][i]["Ipk"],
                    "Vh95": [percentile(vh[j], pct) for j in range(len(orders))],
                    "Vhmax": [float(vh[j].max()) if n else 0.0 for j in range(len(orders))],
                    "THDv95": percentile(thdv, pct), "THDvmax": float(thdv.max()) if n else 0.0,
                    "THDi95": percentile(thdi[I >= 1], pct),
                    "THDi_rated": math.sqrt(sum(v * v for v in Ih_r)) / I1_r * 100,
                    "ts": {"THDv": thdv}, "dc": dc, "secLen": secLen, "Lloop": Lloop})
    common = None
    if H.get("pcc") == "common":
        alpha = lambda h: 1 if h < 5 else (1.4 if h <= 10 else 2)
        vhc = np.zeros((len(orders), n), dtype=np.float32)
        thdc = np.zeros(n, dtype=np.float32)
        for s_ in range(n):
            sv = 0.0
            for j, h in enumerate(orders):
                a_ = alpha(h)
                sm = 0.0
                for v in VhAll:
                    if v is not None:
                        sm += float(v[j, s_]) ** a_
                vhc[j, s_] = sm ** (1 / a_)
                sv += float(vhc[j, s_]) ** 2
            thdc[s_] = math.sqrt(sv)
        common = {"name": "Common supply bus", "Vh95": [percentile(vhc[j], pct) for j in range(len(orders))],
                  "Vhmax": [float(vhc[j].max()) for j in range(len(orders))], "THDv95": percentile(thdc, pct),
                  "THDvmax": float(thdc.max()), "ts": {"THDv": thdc}}
    return {"orders": orders, "characteristic": [is_char(h) for h in orders], "limits": [harm_limit(cfg, h) for h in orders],
            "thd_limit": num(H.get("thd_limit"), 6.5), "percentile": pct, "pulse": pulse, "tss": out, "common": common,
            "std_name": H.get("std_name", "")}


# ----------------------------------------------------------------------
# EMC / EMI: rail potential, stray current, magnetic field, telecom
# ----------------------------------------------------------------------
def touch_limit(cfg, t):
    L = clean_table((cfg.get("emc") or {}).get("touch_limits") or [])
    return interp(L, t) if L else None


def emc(cfg_in, r, flt, harm):
    cfg = copy.deepcopy(cfg_in)
    M = cfg.get("emc") or {}
    tracks = [t for t in cfg["tracks"] if t.get("enabled", True) is not False]
    nTr = max(len(tracks), 1)
    rail = rail_params(cfg, nTr)
    ext = r["extent"]
    Lline = max(ext[1] - ext[0], 1)
    n = max(2, int(math.floor(Lline / max(10, num(M.get("dx"), 100)))) + 1)
    dx = Lline / (n - 1)
    xs = [ext[0] + j * dx for j in range(n)]
    gs = rail["g"] * dx
    gser = 1 / (rail["r"] * dx)
    sh = np.array([gs / 2 if j in (0, n - 1) else gs for j in range(n)])
    Rte = num(M.get("R_tss_earth"), None)
    tp = tss_params(cfg)
    earthG = np.zeros(n)
    if Rte is not None and Rte > 0:
        for i in range(len(tp)):
            if r["tss"][i]["active"]:
                j = min(n - 1, max(0, int(_jsround((tp[i]["ch"] - ext[0]) / dx))))
                earthG[j] += 1 / Rte
    dg = np.array([sh[j] + earthG[j] + (gser if j > 0 else 0) + (gser if j < n - 1 else 0) for j in range(n)])
    den = np.zeros(n)
    cp = np.zeros(n)
    den[0] = dg[0]
    cp[0] = -gser / den[0]
    for j in range(1, n):
        den[j] = dg[j] + gser * cp[j - 1]
        cp[j] = -gser / den[j] if j < n - 1 else 0.0
    ts = r["ts"]
    nS = ts["tssI"].shape[1] if len(ts["tssI"]) else 0
    U = np.zeros((n, nS), dtype=np.float32)
    strayTot = 0.0
    trOff, trX, trI = ts["trOff"], ts["trX"], ts["trI"]
    actives = [i for i in range(len(tp)) if r["tss"][i]["active"]]

    def add_at(rhs, x, I):
        u = min(n - 1, max(0.0, (x - ext[0]) / dx))
        j = min(n - 2, int(math.floor(u)))
        f = u - j
        rhs[j] += I * (1 - f)
        rhs[j + 1] += I * f

    for s_ in range(nS):
        rhs = np.zeros(n)
        for q in range(int(trOff[s_]), int(trOff[s_ + 1])):
            add_at(rhs, float(trX[q]), float(trI[q]))
        for i in actives:
            add_at(rhs, tp[i]["ch"], -(float(ts["tssI"][i, s_]) - float(ts["tssInv"][i, s_])))
        y = np.zeros(n)
        y[0] = rhs[0] / den[0]
        for j in range(1, n):
            y[j] = (rhs[j] + gser * y[j - 1]) / den[j]
        for j in range(n - 2, -1, -1):
            y[j] = y[j] - cp[j] * y[j + 1]
        U[:, s_] = y
        lk = sh * y
        strayTot += float(lk[lk > 0].sum())
    dt = r["dt"]
    w300 = max(1, int(_jsround(300 / dt)))
    Umax, Umin, U300, Umean = [], [], [], []
    max1 = max300 = maxMean = 0.0
    at1 = at300 = 0.0
    for j in range(n):
        u = U[j].astype(np.float64)
        mx, mn = (float(u.max()), float(u.min())) if nS else (-1e9, 1e9)
        S = np.concatenate([[0.0], np.cumsum(np.abs(u))])
        if w300 >= nS:
            w = S[nS] / max(nS, 1)
        else:
            w = float(np.max(S[w300:] - S[:-w300])) / w300
        mean = S[nS] / max(nS, 1)
        Umax.append(mx)
        Umin.append(mn)
        U300.append(float(w))
        Umean.append(float(mean))
        a1 = max(abs(mx), abs(mn))
        if a1 > max1:
            max1, at1 = a1, xs[j]
        if w > max300:
            max300, at300 = float(w), xs[j]
        maxMean = max(maxMean, float(mean))
    strayAvg = strayTot / nS if nS else 0.0
    stray_mA_m = strayAvg / (Lline * nTr) * 1000
    cy, cz, fh = num(M.get("cond_y"), 1.45), num(M.get("cond_z"), 0.2), num(M.get("field_h"), 1.0)
    fd = M.get("field_d")
    fd = "3, 5, 10, 20" if fd is None else fd
    ds = [float(v) for v in re.split(r"[,;\s]+", str(fd)) if v.strip() and _isnum(v) and float(v) > 0]

    def B_at(I, d):
        def comp(y0, z0, Ii):
            dy, dz = d - y0, fh - z0
            r2 = dy * dy + dz * dz
            k = 2e-7 * Ii / r2
            return -k * dz, k * dy
        a, b = comp(cy, cz, I), comp(0, 0, -I)
        return math.hypot(a[0] + b[0], a[1] + b[1]) * 1e6

    Ipk = max([c["Ipk"] for c in r["conductor"]] + [0])
    Irms = max([c["I1h"] for c in r["conductor"]] + [0])
    field = [{"d": d, "Bpk_uT": B_at(Ipk, d), "Brms_uT": B_at(Irms, d)} for d in ds]
    kd, kz = num(M.get("cable_d"), 3), num(M.get("cable_z"), -0.5)
    r1, r2 = math.hypot(kd - cy, kz - cz), math.hypot(kd, kz)
    Mp = 2e-7 * abs(math.log(r2 / max(r1, 1e-3)))
    scr = num(M.get("screening"), 1)
    W = clean_table(M.get("psoph") or [])
    telecom = []
    for t in (harm["tss"] if harm else []):
        if not t["active"]:
            continue
        E_ = [{"f": d["f"], "I": d["I"], "E_mV": 2 * math.pi * d["f"] * Mp * t["secLen"] * d["I"] * scr * 1000,
               "w": interp(W, d["f"]) if W else 1} for d in t["dc"]]
        Ew = math.sqrt(sum((e["w"] * e["E_mV"]) ** 2 for e in E_))
        telecom.append({"tss": t["name"], "Lpar": t["secLen"], "E": E_, "Ew_mV": Ew, "ep_mV": Ew * num(M.get("sensitivity"), 0.001)})
    ULIM = {"s1": touch_limit(cfg, 1), "s300": touch_limit(cfg, 300), "long": touch_limit(cfg, max(r["period"], 3600)),
            "fault": touch_limit(cfg, num((cfg.get("sc") or {}).get("t_clear_s"), 0.06))}
    decim = max(1, nS // 600)
    sample = list(range(0, nS, decim))
    jMax = 0
    for j in range(n):
        if max(abs(Umax[j]), abs(Umin[j])) > max(abs(Umax[jMax]), abs(Umin[jMax])):
            jMax = j
    return {"x": xs, "Umax": Umax, "Umin": Umin, "U300": U300, "Umean": Umean, "max1": max1, "at1": at1,
            "max300": max300, "at300": at300, "maxMean": maxMean,
            "worstNode": {"x": xs[jMax], "t": [s_ * dt for s_ in sample], "U": [float(U[jMax, s_]) for s_ in sample]},
            "strayAvg_A": strayAvg, "stray_mA_m": stray_mA_m, "rail": rail, "nTracks": nTr,
            "g_track": num(M.get("g_track_S_km"), 0.1), "field": field, "Ipk": Ipk, "Irms": Irms,
            "Mprime_uH_m": Mp * 1e6, "telecom": telecom, "limits": ULIM,
            "faultUrail": max(t["maxUrail"] for t in flt["tracks"]) if flt else None}


def _isnum(v):
    try:
        float(v)
        return True
    except ValueError:
        return False


# ----------------------------------------------------------------------
# pass / fail checks
# ----------------------------------------------------------------------
def checks(cfg, r, flt=None, harm=None, em=None):
    Lm = cfg["limits"]
    d = Lm["contingency"] if r["contingency"] else Lm["normal"]
    rows = []

    def add(group, item, where, value, limit, unit, kind):
        if value is None or not math.isfinite(value):
            return
        ratio = (limit / max(value, 1e-9)) if kind == "min" else (value / max(limit, 1e-9))
        ok = value >= limit - 1e-9 if kind == "min" else value <= limit + 1e-9
        rows.append({"group": group, "item": item, "where": where, "value": value, "limit": limit,
                     "unit": unit, "kind": kind, "ratio": ratio, "pass": bool(ok)})

    for t in r["tss"]:
        if not t["active"]:
            continue
        add("Rectifier", "1-hour RMS current", t["name"], t["I1h"], t["Ir"] * num(d.get("h1"), 1), "A", "max")
        add("Rectifier", "15-min RMS current", t["name"], t["I15"], t["Ir"] * num(d.get("m15"), 1.5), "A", "max")
        add("Rectifier", "1-min RMS current", t["name"], t["I1"], t["Ir"] * num(d.get("m1"), 3), "A", "max")
        add("Transformer", "1-hour RMS load", t["name"], t["S1h"], t["xfmr_kVA"] * num(d.get("h1"), 1), "kVA", "max")
        add("Transformer", "15-min RMS load", t["name"], t["S15"], t["xfmr_kVA"] * num(d.get("m15"), 1.5), "kVA", "max")
        add("Transformer", "1-min RMS load", t["name"], t["S1"], t["xfmr_kVA"] * num(d.get("m1"), 3), "kVA", "max")
    if r["feeders"]:
        wf = _first_max(r["feeders"], "I1h")
        add("Feeder", "Worst feeder 1-hour RMS current (cable)", f"{wf['tss']} / {wf['track']}", wf["I1h"], num(Lm.get("feeder_A"), 3000), "A", "max")
        wp = _first_max(r["feeders"], "Ipk")
        add("Feeder", "Peak feeder load current below breaker trip setting", f"{wp['tss']} / {wp['track']}", wp["Ipk"], num(Lm.get("breaker_trip_A"), 8000), "A", "max")
    if r["conductor"]:
        wc = _first_max(r["conductor"], "I1h")
        add("Conductor rail", "Worst 1-hour RMS current", f"{wc['track']} at {wc['tss']} ({wc['side']})", wc["I1h"], num(Lm.get("conductor_A"), 4000), "A", "max")
    tv = r["trainV"]
    if tv["min"] is not None:
        w = f"{tv['minAt']['track']} ch {_jsround(tv['minAt']['x'])}" if tv["minAt"] else ""
        add("Train voltage", "Minimum train voltage", w, tv["min"], num(Lm.get("V_min"), 500), "V", "min")
    if tv["max"] is not None:
        w = f"{tv['maxAt']['track']} ch {_jsround(tv['maxAt']['x'])}" if tv["maxAt"] else ""
        add("Train voltage", "Maximum train voltage", w, tv["max"], num(Lm.get("V_max"), 1000), "V", "max")
    if not r["contingency"] and tv["mean_useful"] is not None:
        add("Train voltage", "Mean useful voltage (motoring trains)", "whole line", tv["mean_useful"], num(Lm.get("U_mean_useful"), 675), "V", "min")
    if flt:
        mx, mnF, wmx, wmn = 0.0, 1e12, "", ""
        for t in flt["tracks"]:
            if t["max"] > mx * (1 + 1e-9):
                mx, wmx = t["max"], t["track"]
            if t["minFeeder"] < mnF * (1 - 1e-9):
                mnF, wmn = t["minFeeder"], t["track"]
        add("Short circuit", "Maximum fault current vs breaking capacity", wmx, mx / 1000, num(Lm.get("breaking_kA"), 50), "kA", "max")
        add("Short circuit", "Minimum feeder fault current vs trip setting × margin", wmn, mnF,
            num(Lm.get("breaker_trip_A"), 8000) * num(Lm.get("fault_margin"), 1), "A", "min")
        if flt["tracks"] and flt["tracks"][0].get("didtFeeder"):
            md, wd = 1e12, ""
            for t in flt["tracks"]:
                if t["minDidtFeeder"] < md * (1 - 1e-9):
                    md, wd = t["minDidtFeeder"], t["track"]
            add("Short circuit", "Minimum feeder di/dt at fault vs di/dt protection setting", wd, md,
                num((cfg.get("sc") or {}).get("didt_setting_A_ms"), 40), "A/ms", "min")
    if harm:
        lim = num(harm["thd_limit"], 6.5)
        ents = [t for t in harm["tss"] if t["active"]] + ([harm["common"]] if harm["common"] else [])
        for t in ents:
            add("Harmonics", f"Voltage THD at supply point ({_fmtp(harm['percentile'])} % value)", t["name"], t["THDv95"], lim, "%", "max")
            wr, wj = -1, -1
            for j, h in enumerate(harm["orders"]):
                L = harm["limits"][j]
                if L and t["Vh95"][j] / L > wr:
                    wr, wj = t["Vh95"][j] / L, j
            if wj >= 0:
                add("Harmonics", f"Worst individual harmonic voltage, h = {harm['orders'][wj]}", t["name"], t["Vh95"][wj], harm["limits"][wj], "%", "max")
    if em:
        M = cfg.get("emc") or {}
        L = em["limits"]
        if L["s1"] is not None:
            add("EMC", "Rail potential, highest instantaneous (touch voltage ≤ 1 s)", f"ch {_jsround(em['at1'])}", em["max1"], L["s1"], "V", "max")
        if L["s300"] is not None:
            add("EMC", "Rail potential, highest 300 s average", f"ch {_jsround(em['at300'])}", em["max300"], L["s300"], "V", "max")
        if L["long"] is not None:
            add("EMC", "Rail potential, highest whole-period average (long term)", "whole line", em["maxMean"], L["long"], "V", "max")
        if em["faultUrail"] is not None and L["fault"] is not None:
            add("EMC", "Rail potential at a fault (touch voltage at clearing time)", "worst fault location", em["faultUrail"], L["fault"], "V", "max")
        add("EMC", "Average stray current per metre of track", "whole line", em["stray_mA_m"], num(M.get("stray_limit_mA_m"), 2.5), "mA/m", "max")
        add("EMC", "Rail-to-earth conductance per track", "design value", em["g_track"], num(M.get("g_limit_S_km"), 0.5), "S/km", "max")
        if em["field"]:
            add("EMC", f"Static magnetic field at {_fmtp(em['field'][0]['d'])} m (peak current)", "beside conductor rail",
                em["field"][0]["Bpk_uT"] / 1000, num(M.get("B_limit_mT"), 0.5), "mT", "max")
        wt = None
        for t in em["telecom"]:
            if wt is None or t["ep_mV"] > wt["ep_mV"]:
                wt = t
        if wt and num(M.get("psoph_limit_mV"), None) is not None:
            add("EMC", "Psophometric noise voltage in parallel telecom circuit", f"{wt['tss']} section", wt["ep_mV"], num(M.get("psoph_limit_mV"), 1), "mV", "max")
        RL = clean_table(M.get("ripple_limits") or [])
        if RL and harm:
            for t in harm["tss"]:
                if t["active"]:
                    for dd in t["dc"]:
                        Lr = next((q for q in RL if abs(q[0] - dd["f"]) < 1), None)
                        if Lr:
                            add("EMC", f"DC ripple current at {_fmtp(dd['f'])} Hz", t["name"], dd["I"], Lr[1], "A", "max")
    rows.sort(key=lambda c: (c["pass"], -c["ratio"]))
    return rows


def _fmtp(v):
    """Format a number the way JavaScript prints it in a string (3 -> '3', 1.5 -> '1.5')."""
    v = float(v)
    return str(int(v)) if v == int(v) else repr(v)


def _first_max(rows, key):
    best = None
    for f in rows:
        if best is None or f[key] > best[key]:
            best = f
    return best


# ----------------------------------------------------------------------
# design check over all cases
# ----------------------------------------------------------------------
def scenario_list(cfg):
    lst = [{"name": "Normal service", "outage": []}]
    for t in cfg["tss"]:
        if t.get("in_service", True) is not False:
            lst.append({"name": f"{t['name']} out", "outage": [t["name"]]})
    for x in (cfg.get("scenarios") or {}).get("extra", []):
        o = [s_.strip() for s_ in re.split(r"[+,;]+", str(x)) if s_.strip()]
        if o:
            lst.append({"name": " + ".join(o) + " out", "outage": o})
    return lst


def studies(cfg, r, flt):
    harm = harmonics(cfg, r)
    em = emc(cfg, r, flt, harm)
    return {"harm": harm, "emc": em, "checks": checks(cfg, r, flt, harm, em)}


def summarize(cfg, r, flt, harm=None, em=None):
    ch = checks(cfg, r, flt, harm, em)

    def worst(g):
        return max([c["ratio"] for c in ch if c["group"] == g], default=0)

    fails = [c for c in ch if not c["pass"]]
    ents = ([t for t in harm["tss"] if t["active"]] + ([harm["common"]] if harm["common"] else [])) if harm else []
    return {"scenario": r["scenario"], "outage": r["outage"], "vmin": r["trainV"]["min"], "vmax": r["trainV"]["max"],
            "rect": worst("Rectifier"), "xfmr": worst("Transformer"), "cond": worst("Conductor rail"), "feeder": worst("Feeder"),
            "fault_min": min(t["minFeeder"] for t in flt["tracks"]) if flt else None,
            "fault_max": max(t["max"] for t in flt["tracks"]) if flt else None,
            "thd": max([t["THDv95"] for t in ents] + [0]) if harm else None,
            "urail": em["max1"] if em else None, "stray": em["stray_mA_m"] if em else None,
            "E_kWh": r["energy"]["tss_kWh"], "nFail": len(fails),
            "firstFail": f"{fails[0]['group']} {fails[0]['item']} at {fails[0]['where']}" if fails else "", "checks": ch}


def design_check(cfg, on_progress=None):
    out = []
    lst = scenario_list(cfg)
    for i, sc in enumerate(lst):
        r = simulate(cfg, outage=sc["outage"], name=sc["name"])
        f = fault_scan(cfg, outage=sc["outage"])
        h = harmonics(cfg, r)
        e = emc(cfg, r, f, h)
        out.append(summarize(cfg, r, f, h, e))
        if on_progress:
            on_progress(i + 1, len(lst), sc["name"])
    return out
