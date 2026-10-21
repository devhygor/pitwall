"""Cálculos: resumo de sessão/stints, volta ideal, combustível e comparação
de telemetria entre duas voltas (delta por distância)."""
from __future__ import annotations

import math
from statistics import mean, median

import numpy as np

COMPARE_CHANNELS = ("speed", "gas", "brake", "steer", "gear", "rpm")


def _clean(lap: dict) -> bool:
    """Volta 'limpa': válida e sem passar pelo box."""
    return bool(lap["valid"]) and not lap["out_lap"] and not lap["in_lap"]


def _racing(lap: dict) -> bool:
    return not lap["out_lap"] and not lap["in_lap"]


def session_summary(laps: list[dict]) -> dict:
    clean = [l for l in laps if _clean(l)]
    racing = [l for l in laps if _racing(l)]
    best = min(clean, key=lambda l: l["lap_time_ms"], default=None)

    def best_sector(k):
        vals = [l[k] for l in clean if l.get(k)]
        return min(vals) if vals else None

    bs = [best_sector(k) for k in ("s1_ms", "s2_ms", "s3_ms")]
    optimal = sum(bs) if all(bs) else None
    fuel_laps = [l["fuel_used"] for l in racing if l.get("fuel_used")]
    stints = []
    for n in sorted({l["stint"] for l in laps}):
        sl = [l for l in laps if l["stint"] == n]
        sc = [l for l in sl if _clean(l)]
        sr = [l for l in sl if _racing(l)]
        fu = [l["fuel_used"] for l in sl if l.get("fuel_used")]
        stints.append({
            "stint": n,
            "laps": len(sl),
            "best_ms": min((l["lap_time_ms"] for l in sc), default=None),
            "avg_ms": round(mean(l["lap_time_ms"] for l in sr)) if sr else None,
            "fuel_total": round(sum(fu), 2) if fu else None,
            "fuel_per_lap": round(mean(l["fuel_used"] for l in sr if l.get("fuel_used")), 2)
            if any(l.get("fuel_used") for l in sr) else None,
        })
    return {
        "best_lap_id": best["id"] if best else None,
        "best_ms": best["lap_time_ms"] if best else None,
        "best_sectors": bs,
        "optimal_ms": optimal,
        "avg_ms": round(mean(l["lap_time_ms"] for l in racing)) if racing else None,
        "fuel_per_lap": round(mean(fuel_laps), 3) if fuel_laps else None,
        "laps_total": len(laps),
        "laps_valid": len(clean),
        "stints": stints,
    }


def stint_trends(laps: list[dict]) -> list[dict]:
    """Desgaste ao longo de cada stint: tendência do tempo de volta (s por volta,
    pela reta de mínimos quadrados) e evolução de pressões/temperaturas."""
    out = []
    for n in sorted({l["stint"] for l in laps}):
        sl = [l for l in laps if l["stint"] == n and not l["out_lap"] and not l["in_lap"]]
        if not sl:
            continue
        rows = []
        for k, l in enumerate(sl, start=1):
            tp, tt = l.get("tyre_press") or [None] * 4, l.get("tyre_temp") or [None] * 4
            avg = lambda a, b: round((a + b) / 2, 2) if a is not None and b is not None else None
            rows.append({"lap_number": l["lap_number"], "i": k, "lap_time_ms": l["lap_time_ms"], "valid": l["valid"],
                         "fuel_end": l.get("fuel_end"),
                         "press_f": avg(tp[0], tp[1]), "press_r": avg(tp[2], tp[3]),
                         "temp_f": avg(tt[0], tt[1]), "temp_r": avg(tt[2], tt[3])})
        # tendência só com voltas válidas e sem as muito lentas (tráfego, erro)
        valid = [r for r in rows if r["valid"]]
        if valid:
            med = median(r["lap_time_ms"] for r in valid)
            valid = [r for r in valid if r["lap_time_ms"] < med * 1.03]
        slope = None
        if len(valid) >= 4:
            xs = np.array([r["i"] for r in valid], dtype=float)
            ys = np.array([r["lap_time_ms"] for r in valid], dtype=float) / 1000
            slope = float(np.polyfit(xs, ys, 1)[0])
        out.append({"stint": n, "laps": rows, "slope_s_per_lap": None if slope is None else round(slope, 3),
                    "used": len(valid)})
    return out


def fuel_plan(avg_lap_ms: float | None, fuel_per_lap: float | None,
              minutes=(20, 30, 45, 60), extra_laps: int = 1, max_fuel: float | None = None):
    """Para cada duração de corrida: voltas previstas e litros necessários.
    `extra_laps` é a margem de segurança (volta de formação/imprevistos)."""
    if not avg_lap_ms or not fuel_per_lap:
        return []
    out = []
    for m in minutes:
        laps = math.ceil(m * 60_000 / avg_lap_ms)
        need = laps * fuel_per_lap
        safe = (laps + extra_laps) * fuel_per_lap
        out.append({
            "minutes": m, "laps": laps,
            "fuel": math.ceil(need), "fuel_safe": math.ceil(safe),
            "over_tank": bool(max_fuel and safe > max_fuel),
        })
    return out


def _monotonic(d: np.ndarray, *others: np.ndarray):
    """Mantém só amostras com distância estritamente crescente."""
    keep = np.ones(len(d), dtype=bool)
    # a volta pode começar com amostras velhas (fim da volta anterior, d ~ 1.0): sem tirar, o resto seria descartado
    start = 0
    for i in range(1, min(len(d), 120)):
        if d[i] < d[i - 1] - 0.5:         # volta grande para trás logo no começo: o que veio antes é da volta anterior
            start = i
            break
    keep[:start] = False
    hi = -1.0
    for i, v in enumerate(d):
        if i < start:
            continue
        if v > hi:
            hi = v
        else:
            keep[i] = False
    return (d[keep],) + tuple(o[keep] for o in others)


def _track_length(x: np.ndarray, z: np.ndarray) -> float:
    if len(x) < 2:
        return 0.0
    return float(np.sum(np.hypot(np.diff(x), np.diff(z))))


def resample_lap(lap: dict, grid: np.ndarray, extra: tuple = ()) -> dict | None:
    """Reamostra a telemetria de uma volta numa grade de distância normalizada (0..1)."""
    tel = lap["telemetry"]
    if not tel or not tel.get("d"):
        return None
    names = ("t", *COMPARE_CHANNELS, "x", "z", *[e for e in extra if e in tel])
    arrs = {k: np.asarray(tel[k], dtype=float) for k in ("d", *names)}
    cols = _monotonic(arrs["d"], *(arrs[k] for k in names))
    d = cols[0]
    if len(d) < 2:
        return None
    out = {}
    lo, hi = d[0], d[-1]
    for name, arr in zip(names, cols[1:]):
        v = np.interp(grid, d, arr)
        v[(grid < lo - 0.01) | (grid > hi + 0.01)] = np.nan
        out[name] = v
    out["length"] = _track_length(arrs["x"], arrs["z"])
    return out


def compare(lap_a: dict, lap_b: dict | None, points: int = 2000) -> dict:
    """Reamostra as voltas na mesma grade de distância e calcula o delta.
    A = sua volta, B = referência. delta > 0 => você está atrás (mais lento)
    da referência naquele ponto."""
    grid = np.linspace(0, 1, points)
    resample = lambda lap: resample_lap(lap, grid)   # noqa: E731

    a = resample(lap_a)
    b = resample(lap_b) if lap_b else None
    if a is None:
        return {"error": "volta sem telemetria"}
    length = a["length"] or (b["length"] if b else 0) or 1.0
    dist = grid * length

    def js(arr, nd=3):
        return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), nd)
                for v in arr]

    res = {
        "distance": js(dist, 1),
        "track_length": round(length, 1),
        "a": {k: js(a[k], 2 if k in ("x", "z") else 3) for k in ("t", *COMPARE_CHANNELS, "x", "z")},
        "map": _map(lap_a),
    }
    if b is not None:
        res["b"] = {k: js(b[k], 2 if k in ("x", "z") else 3) for k in ("t", *COMPARE_CHANNELS, "x", "z")}
        res["delta"] = js((a["t"] - b["t"]) / 1000.0)
    res["segments"] = analyze_segments(dist, a, b)
    return res


def _map(lap: dict, points: int = 700) -> dict:
    tel = lap["telemetry"]
    d = np.asarray(tel["d"], dtype=float)
    x = np.asarray(tel["x"], dtype=float)
    z = np.asarray(tel["z"], dtype=float)
    d, x, z = _monotonic(d, x, z)
    if len(d) < 2:
        return {"d": [], "x": [], "z": []}
    g = np.linspace(d[0], d[-1], points)
    return {
        "d": [round(float(v), 4) for v in g],
        "x": [round(float(v), 1) for v in np.interp(g, d, x)],
        "z": [round(float(v), 1) for v in np.interp(g, d, z)],
    }


# ---------------------------------------------------------------------------
# Segmentos (uma curva por segmento) e dicas de pilotagem
# ---------------------------------------------------------------------------

def _fill(v: np.ndarray) -> np.ndarray:
    """Preenche NaN por interpolação (bordas de voltas parciais)."""
    v = v.astype(float).copy()
    ok = ~np.isnan(v)
    if ok.sum() < 2:
        return np.zeros_like(v)
    idx = np.arange(len(v))
    v[~ok] = np.interp(idx[~ok], idx[ok], v[ok])
    return v


def _smooth(v: np.ndarray, w: int) -> np.ndarray:
    if w < 2:
        return v
    k = np.ones(w) / w
    pad = np.pad(v, (w, w), mode="edge")
    return np.convolve(pad, k, mode="same")[w:-w]


def detect_segments(dist: np.ndarray, speed: np.ndarray) -> list[dict]:
    """Uma curva = um mínimo local de velocidade com queda relevante.
    As fronteiras ficam no ponto de maior velocidade entre duas curvas
    (fim da reta, antes da frenagem). Cada segmento contém exatamente uma curva."""
    n = len(dist)
    step = max(float(dist[1] - dist[0]), 0.1)
    s = _smooth(_fill(speed), max(3, int(30 / step)))
    win = max(3, int(60 / step))          # o mínimo precisa ser o menor em ±60 m
    look = max(5, int(400 / step))        # e ter subida de velocidade em até 400 m
    minima = []
    for i in range(1, n - 1):
        lo, hi = max(0, i - win), min(n, i + win + 1)
        if s[i] > s[lo:hi].min() + 1e-6:
            continue
        before = s[max(0, i - look):i + 1].max() - s[i]
        after = s[i:min(n, i + look + 1)].max() - s[i]
        if before >= 12 and after >= 8:
            if minima and (dist[i] - dist[minima[-1]]) < 100:   # chicane: fica com o mais lento
                if s[i] < s[minima[-1]]:
                    minima[-1] = i
                continue
            minima.append(i)
    if not minima:
        return [{"n": 1, "start": 0, "end": n - 1, "apex": int(np.argmin(s))}]
    bounds = [0]
    for m1, m2 in zip(minima, minima[1:]):
        bounds.append(m1 + int(np.argmax(s[m1:m2 + 1])))
    bounds.append(n - 1)
    return [{"n": k + 1, "start": bounds[k], "end": bounds[k + 1], "apex": m}
            for k, m in enumerate(minima)]


def _first(mask: np.ndarray, start: int) -> int | None:
    idx = np.flatnonzero(mask)
    return int(idx[0]) + start if len(idx) else None


def _lap_metrics(L: dict, seg: dict, dist: np.ndarray) -> dict | None:
    a, b, apex = seg["start"], seg["end"], seg["apex"]
    t = L["t"]
    if np.isnan(t[a]) or np.isnan(t[b]):
        return None
    sp, gas, brk = _fill(L["speed"]), _fill(L["gas"]), _fill(L["brake"])
    seg_sp = sp[a:b + 1]
    apex_i = a + int(np.argmin(seg_sp))
    brake_i = _first(brk[a:apex_i + 1] >= 0.1, a)
    thr_i = _first(gas[apex_i:b + 1] >= 0.9, apex_i)
    dt = np.diff(_fill(t[a:b + 1])) / 1000.0
    coast = float(np.sum(dt[(gas[a:b] < 0.1) & (brk[a:b] < 0.1)]))
    return {
        "time": float(t[b] - t[a]) / 1000.0,
        "to_apex": float(t[apex] - t[a]) / 1000.0 if not np.isnan(t[apex]) else None,
        "entry_speed": float(sp[a]), "min_speed": float(sp[apex_i]), "exit_speed": float(sp[b]),
        "apex_m": float(dist[apex_i]),
        "brake_m": float(dist[brake_i]) if brake_i is not None else None,
        "throttle_m": float(dist[thr_i]) if thr_i is not None else None,
        "max_brake": float(brk[a:b + 1].max()),
        "coast": coast,
    }


def _tips(m: dict, r: dict, entry_loss: float, exit_loss: float) -> list[dict]:
    """Regras simples e transparentes, sempre comparando com a referência."""
    tips = []
    if m["brake_m"] is not None and r["brake_m"] is not None:
        d = m["brake_m"] - r["brake_m"]
        if d > 5 and m["min_speed"] < r["min_speed"] - 2:
            tips.append({"kind": "brake_late", "title": "Freou tarde demais",
                         "detail": f"Você freou {d:.0f} m depois da referência e chegou mais lento no ápice "
                                   f"({m['min_speed']:.0f} × {r['min_speed']:.0f} km/h)."})
        elif d < -5:
            tips.append({"kind": "brake_early", "title": "Freou cedo",
                         "detail": f"Você começou a frear {-d:.0f} m antes da referência."})
    elif m["brake_m"] is not None and r["brake_m"] is None:
        tips.append({"kind": "brake_extra", "title": "Frenagem desnecessária",
                     "detail": "A referência não freia neste trecho; tente só aliviar o acelerador."})
    dv = m["min_speed"] - r["min_speed"]
    if dv < -3:
        tips.append({"kind": "min_speed", "title": "Pouca velocidade na curva",
                     "detail": f"Velocidade mínima {-dv:.0f} km/h abaixo da referência "
                               f"({m['min_speed']:.0f} × {r['min_speed']:.0f} km/h)."})
    elif dv > 4 and exit_loss > 0.05:
        tips.append({"kind": "overspeed", "title": "Entrou rápido demais",
                     "detail": f"Você passou {dv:.0f} km/h mais rápido no ápice, mas perdeu "
                               f"{exit_loss:.2f} s na saída. Talvez valha sacrificar a entrada."})
    if m["throttle_m"] is not None and r["throttle_m"] is not None:
        d = m["throttle_m"] - r["throttle_m"]
        if d > 10:
            tips.append({"kind": "throttle_late", "title": "Acelerou tarde",
                         "detail": f"Acelerador a fundo {d:.0f} m depois da referência na saída."})
    de = m["exit_speed"] - r["exit_speed"]
    if de < -3:
        tips.append({"kind": "exit_speed", "title": "Saída mais lenta",
                     "detail": f"{-de:.0f} km/h a menos no fim do trecho — isso se arrasta pela reta seguinte."})
    dc = m["coast"] - r["coast"]
    if dc > 0.15:
        tips.append({"kind": "coasting", "title": "Tempo sem acelerar nem frear",
                     "detail": f"{dc:.2f} s a mais \"rolando\" (sem pedal) que a referência."})
    return tips


def analyze_segments(dist: np.ndarray, a: dict, b: dict | None) -> list[dict]:
    ref = b if b is not None else a
    segs = detect_segments(dist, ref["speed"])
    out = []
    for seg in segs:
        item = {**seg, "start_m": round(float(dist[seg["start"]]), 1),
                "end_m": round(float(dist[seg["end"]]), 1), "apex_m": round(float(dist[seg["apex"]]), 1)}
        ma = _lap_metrics(a, seg, dist)
        mb = _lap_metrics(b, seg, dist) if b is not None else None
        item["a"] = _round(ma)
        item["b"] = _round(mb)
        if ma and mb:
            delta = ma["time"] - mb["time"]
            entry = (ma["to_apex"] - mb["to_apex"]) if ma["to_apex"] is not None and mb["to_apex"] is not None else 0.0
            exit_ = delta - entry
            item.update(delta=round(delta, 3), entry_loss=round(entry, 3), exit_loss=round(exit_, 3))
            item["tips"] = _tips(ma, mb, entry, exit_)
            if delta > 0.03:
                where = "na entrada (frenagem até o ápice)" if entry >= exit_ else "na saída (do ápice em diante)"
                item["summary"] = f"Maior perda {where}: +{max(entry, exit_):.3f} s"
            elif delta < -0.03:
                item["summary"] = f"Você ganhou {-delta:.3f} s neste trecho"
            else:
                item["summary"] = "Praticamente igual à referência"
        out.append(item)
    return out


def _round(m: dict | None) -> dict | None:
    if m is None:
        return None
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()}


# ---------------------------------------------------------------------------
# Progresso: consistência por segmento e volta ideal
# ---------------------------------------------------------------------------

def consistency(laps: list[dict], ref: dict, points: int = 2000) -> dict:
    """Tempo de cada segmento (definidos pela volta de referência) em cada volta.
    Mostra onde você varia mais e quanto dá pra ganhar só repetindo o seu melhor."""
    grid = np.linspace(0, 1, points)
    R = resample_lap(ref, grid)
    if R is None:
        return {"segments": [], "laps": []}
    length = R["length"] or 1.0
    dist = grid * length
    segs = detect_segments(dist, R["speed"])
    rows = []
    for lap in laps:
        L = resample_lap(lap, grid)
        if L is None or np.isnan(L["t"]).any():
            continue
        times = [float(L["t"][s["end"]] - L["t"][s["start"]]) / 1000 for s in segs]
        rows.append({"lap_id": lap["id"], "lap_number": lap["lap_number"], "session_id": lap["session_id"],
                     "started_at": lap.get("started_at"), "lap_time_ms": lap["lap_time_ms"], "seg_times": times})
    out_segs = []
    for k, s in enumerate(segs):
        vals = [r["seg_times"][k] for r in rows]
        if not vals:
            continue
        best_i = int(np.argmin(vals))
        arr = np.array(vals)
        out_segs.append({
            "n": s["n"], "start": s["start"], "end": s["end"], "apex": s["apex"],
            "start_m": round(float(dist[s["start"]]), 1), "end_m": round(float(dist[s["end"]]), 1),
            "best": round(float(arr.min()), 3), "mean": round(float(arr.mean()), 3),
            "std": round(float(arr.std()), 3), "potential": round(float(arr.mean() - arr.min()), 3),
            "best_lap_id": rows[best_i]["lap_id"], "best_lap_number": rows[best_i]["lap_number"],
            "best_started_at": rows[best_i]["started_at"],
        })
    ideal = sum(s["best"] for s in out_segs) if out_segs else None
    plan = sorted(out_segs, key=lambda s: -(s["potential"] + s["std"]))[:3]
    return {"segments": out_segs, "laps": rows, "ideal_s": None if ideal is None else round(ideal, 3),
            "plan": [{"n": s["n"], "potential": s["potential"], "std": s["std"]} for s in plan],
            "map": {"x": _js(R["x"], 1), "z": _js(R["z"], 1)}, "track_length": round(length, 1)}


def build_ideal(laps_by_id: dict, cons: dict, points: int = 2000) -> dict | None:
    """Monta a volta ideal costurando, segmento a segmento, a volta onde cada trecho foi mais rápido."""
    grid = np.linspace(0, 1, points)
    if not cons["segments"]:
        return None
    cache: dict = {}
    names = ("t", *COMPARE_CHANNELS, "x", "z")
    out = {k: np.full(points, np.nan) for k in names}
    t_acc = 0.0
    for s in cons["segments"]:
        lid = s["best_lap_id"]
        if lid not in cache:
            cache[lid] = resample_lap(laps_by_id[lid], grid)
        L = cache[lid]
        a, b = s["start"], s["end"]
        for k in names:
            if k == "t":
                out["t"][a:b + 1] = t_acc + (L["t"][a:b + 1] - L["t"][a])
            else:
                out[k][a:b + 1] = L[k][a:b + 1]
        t_acc = float(out["t"][b])
    if np.isnan(out["t"]).any():
        return None
    cols = {"d": [round(float(v), 5) for v in grid]}
    for k in names:
        nd = 0 if k in ("t", "gear", "rpm") else 2 if k in ("x", "z", "speed") else 3
        cols[k] = [round(float(v), nd) if nd else int(round(float(v))) for v in out[k]]
    return {"lap_time_ms": int(round(t_acc)), "telemetry": cols,
            "composition": [{"n": s["n"], "lap_number": s["best_lap_number"], "started_at": s["best_started_at"]}
                            for s in cons["segments"]]}


def _js(arr, nd):
    return [None if np.isnan(v) else round(float(v), nd) for v in arr]


def evolution(laps: list[dict]) -> dict:
    """Totais, voltas/horas por semana e histórico do recorde (voltas suas, em ordem)."""
    import datetime as dt
    weeks: dict = {}
    for l in laps:
        d = dt.date.fromisoformat(l["started_at"][:10])
        monday = d - dt.timedelta(days=d.weekday())
        w = weeks.setdefault(monday.isoformat(), {"week": monday.isoformat(), "laps": 0, "hours": 0.0})
        w["laps"] += 1
        w["hours"] += l["lap_time_ms"] / 3_600_000
    total_ms = sum(l["lap_time_ms"] for l in laps)
    return {
        "laps": len(laps), "clean_laps": sum(1 for l in laps if l["valid"] and not l["out_lap"] and not l["in_lap"]),
        "hours": round(total_ms / 3_600_000, 2), "sessions": len({l["session_id"] for l in laps}),
        "combos": len({(l["car"], l["track"]) for l in laps}),
        "weeks": [dict(w, hours=round(w["hours"], 2)) for w in sorted(weeks.values(), key=lambda w: w["week"])],
    }


def pb_history(clean_laps: list[dict]) -> list[dict]:
    best, out = None, []
    for l in clean_laps:
        if best is None or l["lap_time_ms"] < best:
            best = l["lap_time_ms"]
            out.append({"lap_id": l["id"], "lap_time_ms": best, "started_at": l["started_at"],
                        "lap_number": l["lap_number"]})
    return out


def session_trend(clean_laps: list[dict]) -> list[dict]:
    by: dict = {}
    for l in clean_laps:
        by.setdefault(l["session_id"], []).append(l["lap_time_ms"])
    starts = {l["session_id"]: l["started_at"] for l in clean_laps}
    return [{"session_id": sid, "started_at": starts[sid], "best_ms": min(v), "avg_ms": round(mean(v)),
             "laps": len(v)} for sid, v in sorted(by.items(), key=lambda kv: starts[kv[0]])]


def ratings(all_laps: list[dict]) -> dict:
    """Rating Pitwall (0–100) por sessão de um carro numa pista.

    ritmo        quão perto a melhor volta da sessão ficou do seu recorde (1% mais lento = 75)
    consistência quanto as voltas limpas variam (desvio de 0,5% = 80)
    limpeza      % de voltas válidas (sem contar entrada/saída do box)
    rating       50% ritmo + 30% consistência + 20% limpeza
    """
    by: dict = {}
    for l in all_laps:
        by.setdefault(l["session_id"], []).append(l)
    clean_all = [l["lap_time_ms"] for l in all_laps if l["valid"] and not l["out_lap"] and not l["in_lap"]]
    if not clean_all:
        return {"current": None, "sessions": []}
    pb = min(clean_all)
    out = []
    for sid, ls in by.items():
        racing = [l for l in ls if not l["out_lap"] and not l["in_lap"]]
        clean = [l["lap_time_ms"] for l in racing if l["valid"]]
        if not clean:
            continue
        best = min(clean)
        med = median(clean)
        steady = [t for t in clean if t < med * 1.03]
        sd = float(np.std(steady)) if len(steady) >= 2 else 0.0
        mean_ = float(np.mean(steady)) if steady else best
        pace = max(0.0, min(100.0, 100 - (best / pb - 1) * 100 * 25))
        cons = max(0.0, min(100.0, 100 - (sd / mean_) * 100 * 40)) if len(steady) >= 2 else None
        cleanp = 100.0 * len(clean) / len(racing) if racing else 100.0
        rating = 0.5 * pace + 0.3 * (cons if cons is not None else pace) + 0.2 * cleanp
        out.append({"session_id": sid, "started_at": ls[0]["started_at"], "laps": len(racing), "best_ms": best,
                    "pace": round(pace), "consistency": None if cons is None else round(cons),
                    "clean": round(cleanp), "rating": round(rating)})
    out.sort(key=lambda r: r["started_at"])
    last = out[-3:]
    current = round(sum(r["rating"] for r in last) / len(last)) if last else None
    return {"current": current, "sessions": out,
            "pace": last[-1]["pace"] if last else None,
            "consistency": last[-1]["consistency"] if last else None,
            "clean": round(sum(r["clean"] for r in last) / len(last)) if last else None}
