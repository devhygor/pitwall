"""Engenheiro de setup: lê as voltas de uma sessão, identifica como o carro se
comporta e sugere ajustes concretos (em cliques) no setup do ACC.

Como funciona (regras transparentes, nada de caixa-preta):

* Equilíbrio: compara o ângulo de deriva dos pneus dianteiros com o dos
  traseiros enquanto o carro está fazendo curva (G lateral alto). Frente
  escorregando mais = subesterço; traseira escorregando mais = sobresterço.
  Isso é medido em três fases de cada curva — entrada (freando), meio e saída
  (acelerando) — e separado entre curvas lentas e rápidas, porque a correção
  é diferente (mecânica nas lentas, aerodinâmica nas rápidas).
* Travamento de roda na frenagem e patinagem na saída, pelo escorregamento
  longitudinal (slip ratio).
* Pressão dos pneus a quente contra a janela ideal, e temperatura dos freios.

As sugestões são pontos de partida: mude poucas coisas por vez, teste e grave
de novo. Erros de pilotagem também aparecem como "comportamento do carro".
"""
from __future__ import annotations

import math
from statistics import median

import numpy as np

from .analysis import _monotonic, _track_length, detect_segments
from .setups import LABELS, WHEELS, get_value, psi

US_RATIO, OS_RATIO = 1.12, 0.90          # limites para considerar sub/sobresterço
PHASES = {"entry": "entrada (freando)", "mid": "meio da curva", "exit": "saída (acelerando)"}
PHASE_IN = {"entry": "na entrada", "mid": "no meio", "exit": "na saída"}
SPEED_CLASS = {"slow": "curvas lentas", "fast": "curvas rápidas"}


def _resample(lap: dict, points: int = 1500):
    tel = lap.get("telemetry") or {}
    need = ("d", "t", "speed", "gas", "brake", "saf", "sar", "srf", "srr", "srx", "glat", "x", "z")
    if not tel.get("d") or any(k not in tel for k in need):
        return None
    arr = {k: np.asarray(tel[k], dtype=float) for k in need}
    cols = _monotonic(arr["d"], *(arr[k] for k in need[1:]))
    d = cols[0]
    if len(d) < 50 or d[-1] - d[0] < 0.8:
        return None
    grid = np.linspace(d[0], d[-1], points)
    out = {k: np.interp(grid, d, c) for k, c in zip(need[1:], cols[1:])}
    length = _track_length(arr["x"], arr["z"]) or 1.0
    out["dist"] = (grid - grid[0]) * length
    return out


def _corner_phases(L: dict, seg: dict) -> dict:
    a, b, apex = seg["start"], seg["end"], seg["apex"]
    idx = np.arange(a, b + 1)
    sp, gas, brk, glat = L["speed"][idx], L["gas"][idx], L["brake"][idx], np.abs(L["glat"][idx])
    rel_apex = apex - a
    turning = (glat >= 0.5) & (sp > 50)
    entry = turning & (brk >= 0.1) & (np.arange(len(idx)) <= rel_apex)
    exit_ = turning & (gas >= 0.5) & (np.arange(len(idx)) >= rel_apex)
    mid = turning & ~entry & ~exit_
    return {"entry": idx[entry], "mid": idx[mid], "exit": idx[exit_], "all": idx,
            "min_speed": float(sp.min()), "braking": idx[brk >= 0.3], "power": idx[(gas >= 0.8) & (np.arange(len(idx)) >= rel_apex)]}


def _ratio(L, ix):
    if len(ix) < 4:
        return None
    f, r = float(L["saf"][ix].sum()), float(L["sar"][ix].sum())
    if r <= 1e-9:
        return None
    return f / r


def analyze(laps: list[dict], setup: dict | None = None, target_psi: float = 26.5) -> dict:
    racing = [l for l in laps if not l.get("out_lap") and not l.get("in_lap")]
    use = [l for l in racing if l.get("valid")] or racing
    use = use[-10:]
    res: dict = {"laps_used": [l["lap_number"] for l in use], "findings": [], "changes": [],
                 "pressures": [], "balance": [], "temps": {}}
    if not use:
        res["error"] = "Nenhuma volta completa (sem box) para analisar."
        return res

    # ---------------- equilíbrio por fase e tipo de curva
    buckets: dict = {}
    locks_f = locks_r = spins = braking_zones = power_zones = 0
    analyzed = 0
    for lap in use:
        L = _resample(lap)
        if L is None:
            continue
        analyzed += 1
        for seg in detect_segments(L["dist"], L["speed"]):
            ph = _corner_phases(L, seg)
            cls = "slow" if ph["min_speed"] < 140 else "fast"
            for name in ("entry", "mid", "exit"):
                r = _ratio(L, ph[name])
                if r is not None:
                    buckets.setdefault((name, cls), []).append(r)
            if len(ph["braking"]) >= 3:
                braking_zones += 1
                locks_f += bool((L["srf"][ph["braking"]] < -0.12).sum() >= 2)
                locks_r += bool((L["srr"][ph["braking"]] < -0.12).sum() >= 2)
            if len(ph["power"]) >= 3:
                power_zones += 1
                spins += bool((L["srx"][ph["power"]] > 0.12).sum() >= 2)
    if not analyzed:
        res["error"] = ("Estas voltas não têm os dados de equilíbrio (foram gravadas por uma versão "
                        "antiga do Pitwall). Grave uma sessão nova para usar o engenheiro.")
    res["analyzed_laps"] = analyzed

    changes: dict = {}

    def add(path, delta, reason, weight):
        c = changes.setdefault(path, {"delta": 0, "reasons": [], "weight": 0.0})
        c["delta"] += delta
        if reason not in c["reasons"]:
            c["reasons"].append(reason)
        c["weight"] += weight

    def has(path):
        return setup is None or get_value(setup, path) is not None

    def val(path):
        return None if setup is None else get_value(setup, path)

    for (name, cls), vals in sorted(buckets.items()):
        m = median(vals)
        state = "subesterço" if m > US_RATIO else "sobresterço" if m < OS_RATIO else "neutro"
        share_us = sum(v > US_RATIO for v in vals) / len(vals)
        share_os = sum(v < OS_RATIO for v in vals) / len(vals)
        res["balance"].append({"phase": name, "class": cls, "label": f"{PHASES[name]} · {SPEED_CLASS[cls]}",
                               "ratio": round(m, 3), "state": state, "n": len(vals),
                               "share_us": round(share_us, 2), "share_os": round(share_os, 2)})
        if state == "neutro" or len(vals) < 3:
            continue
        strength = abs(math.log(m))
        sev = "alta" if strength > 0.22 else "média"
        pct = round((m - 1) * 100) if m > 1 else round((1 - m) * 100)
        where = f"{PHASE_IN[name]} das {SPEED_CLASS[cls]}"
        if state == "subesterço":
            detail = f"A frente escorrega ~{pct}% mais que a traseira {where} ({round(share_us * 100)}% das curvas)."
            res["findings"].append({"kind": f"us_{name}_{cls}", "title": f"Subesterço {where}",
                                    "detail": detail, "severity": sev})
            if name == "entry":
                add("advancedSetup.mechanicalBalance.brakeBias", -1, "Viés para trás ajuda o carro a girar na entrada", strength)
                if has("advancedSetup.drivetrain.preload") and (val("advancedSetup.drivetrain.preload") or 0) > 0:
                    add("advancedSetup.drivetrain.preload", -1, "Menos pré-carga solta a entrada", strength * 0.6)
            elif name == "mid":
                if cls == "slow":
                    if (val("advancedSetup.mechanicalBalance.aRBFront") or 1) > 0:
                        add("advancedSetup.mechanicalBalance.aRBFront", -1, "Barra dianteira mais macia = mais aderência na frente", strength)
                    else:
                        add("advancedSetup.mechanicalBalance.aRBRear", +1, "Barra traseira mais dura = mais rotação", strength)
                else:
                    add("advancedSetup.aeroBalance.splitter", +1, "Mais carga aerodinâmica na frente em curva rápida", strength)
            else:
                if (val("advancedSetup.drivetrain.preload") or 1) > 0:
                    add("advancedSetup.drivetrain.preload", -1, "Menos pré-carga deixa o carro girar ao acelerar", strength)
                add("advancedSetup.mechanicalBalance.aRBRear", +1, "Barra traseira mais dura = mais rotação na saída", strength * 0.7)
        else:
            detail = f"A traseira escorrega ~{pct}% mais que a frente {where} ({round(share_os * 100)}% das curvas)."
            res["findings"].append({"kind": f"os_{name}_{cls}", "title": f"Sobresterço {where}",
                                    "detail": detail, "severity": sev})
            if name == "entry":
                add("advancedSetup.mechanicalBalance.brakeBias", +1, "Viés para frente estabiliza a traseira na frenagem", strength)
                add("advancedSetup.drivetrain.preload", +1, "Mais pré-carga estabiliza a entrada", strength * 0.6)
            elif name == "mid":
                if cls == "slow":
                    if (val("advancedSetup.mechanicalBalance.aRBRear") or 1) > 0:
                        add("advancedSetup.mechanicalBalance.aRBRear", -1, "Barra traseira mais macia = mais aderência atrás", strength)
                    else:
                        add("advancedSetup.mechanicalBalance.aRBFront", +1, "Barra dianteira mais dura equilibra a traseira", strength)
                else:
                    add("advancedSetup.aeroBalance.rearWing", +1, "Mais asa = traseira mais firme em curva rápida", strength)
            else:
                add("basicSetup.electronics.tC1", +1, "Mais TC segura a traseira ao acelerar", strength)
                add("advancedSetup.mechanicalBalance.aRBRear", -1, "Barra traseira mais macia melhora a tração", strength * 0.7)

    # ---------------- travamento e patinagem
    if braking_zones >= 4:
        fl, rl = locks_f / braking_zones, locks_r / braking_zones
        if fl > 0.2:
            res["findings"].append({"kind": "lock_front", "severity": "alta" if fl > 0.4 else "média",
                                    "title": "Rodas dianteiras travando na frenagem",
                                    "detail": f"Travou a frente em {round(fl * 100)}% das frenagens fortes."})
            add("advancedSetup.mechanicalBalance.brakeBias", -1, "Menos freio na frente evita travar as dianteiras", fl)
            if (val("basicSetup.electronics.abs") or 1) > 0:
                add("basicSetup.electronics.abs", +1, "Mais ABS segura o travamento", fl * 0.5)
        if rl > 0.2:
            res["findings"].append({"kind": "lock_rear", "severity": "alta" if rl > 0.4 else "média",
                                    "title": "Rodas traseiras travando na frenagem",
                                    "detail": f"Travou a traseira em {round(rl * 100)}% das frenagens fortes."})
            add("advancedSetup.mechanicalBalance.brakeBias", +1, "Mais freio na frente evita travar as traseiras", rl)
    if power_zones >= 4 and spins / power_zones > 0.2:
        sp = spins / power_zones
        res["findings"].append({"kind": "wheelspin", "severity": "alta" if sp > 0.4 else "média",
                                "title": "Patinando na saída de curva",
                                "detail": f"As traseiras patinaram em {round(sp * 100)}% das retomadas com acelerador a fundo."})
        add("basicSetup.electronics.tC1", +1, "Mais TC reduz a patinagem", sp)
        for i in (2, 3):
            if (val(f"advancedSetup.mechanicalBalance.wheelRate[{i}]") or 1) > 0:
                add(f"advancedSetup.mechanicalBalance.wheelRate[{i}]", -1, "Mola traseira mais macia = mais tração", sp * 0.5)

    # ---------------- pressões (a quente) — ignora as 2 primeiras voltas do stint
    hot = [l["tyre_press"] for l in use if l.get("tyre_press") and l["lap_number"] > 2] or \
          [l["tyre_press"] for l in use if l.get("tyre_press")]
    if hot:
        avg = [sum(p[i] for p in hot) / len(hot) for i in range(4)]
        for i in range(4):
            dpsi = target_psi - avg[i]
            clicks = int(round(dpsi / 0.1))
            path = f"basicSetup.tyres.tyrePressure[{i}]"
            cur = val(path)
            res["pressures"].append({"wheel": WHEELS[i], "hot": round(avg[i], 2), "target": target_psi,
                                     "delta_psi": round(dpsi, 2), "clicks": clicks,
                                     "cold_now": psi(cur) if cur is not None else None,
                                     "cold_new": psi(max(0, cur + clicks)) if cur is not None else None})
        off = [p for p in res["pressures"] if abs(p["delta_psi"]) >= 0.2]
        if off:
            worst = max(off, key=lambda p: abs(p["delta_psi"]))
            res["findings"].append({
                "kind": "pressure", "severity": "média" if abs(worst["delta_psi"]) > 0.5 else "info",
                "title": "Pressão dos pneus fora da janela",
                "detail": "Pressão a quente: " + ", ".join(f"{p['wheel']} {p['hot']:.1f}" for p in res["pressures"])
                          + f" psi (alvo {target_psi:.1f}). Ajuste na pressão fria, cerca de 1 clique para cada 0,1 psi."})
    res["temps"]["tyre"] = _avg4([l.get("tyre_temp") for l in use])
    brake = _avg4([l.get("brake_temp") for l in use])
    res["temps"]["brake"] = brake
    if brake:
        fr, rr = (brake[0] + brake[1]) / 2, (brake[2] + brake[3]) / 2
        if fr > 750:
            add("advancedSetup.aeroBalance.brakeDuct[0]", +1, f"Freios dianteiros quentes ({fr:.0f} °C)", 0.2)
        elif 0 < fr < 300:
            add("advancedSetup.aeroBalance.brakeDuct[0]", -1, f"Freios dianteiros frios ({fr:.0f} °C)", 0.2)
        if rr > 750:
            add("advancedSetup.aeroBalance.brakeDuct[1]", +1, f"Freios traseiros quentes ({rr:.0f} °C)", 0.2)
        elif 0 < rr < 300:
            add("advancedSetup.aeroBalance.brakeDuct[1]", -1, f"Freios traseiros frios ({rr:.0f} °C)", 0.2)

    # ---------------- monta a lista final (no máximo 4 mudanças de comportamento)
    items = []
    for path, c in changes.items():
        delta = max(-2, min(2, c["delta"]))
        if delta == 0 or not has(path):
            continue
        items.append((c["weight"], path, delta, c["reasons"]))
    items.sort(reverse=True)
    for weight, path, delta, reasons in items[:4]:
        base = path.split("[")[0]
        label = LABELS.get(base, path)
        if "[" in path:
            i = int(path.split("[")[1].rstrip("]"))
            suffix = {"brakeDuct": ["frente", "traseira"]}.get(base.split(".")[-1], list(WHEELS))
            label += f" ({suffix[i] if i < len(suffix) else i})"
        cur = val(path)
        res["changes"].append({"path": path, "label": label, "delta": delta, "reasons": reasons,
                               "from": cur, "to": None if cur is None else max(0, cur + delta),
                               "weight": round(weight, 3)})
    for p in res["pressures"]:
        if p["clicks"] and abs(p["delta_psi"]) >= 0.2:
            i = WHEELS.index(p["wheel"])
            path = f"basicSetup.tyres.tyrePressure[{i}]"
            cur = val(path)
            res["changes"].append({"path": path, "label": f"Pressão {p['wheel']}", "delta": p["clicks"],
                                   "reasons": [f"{p['hot']:.1f} psi a quente → alvo {p['target']:.1f}"],
                                   "from": cur, "to": None if cur is None else max(0, cur + p["clicks"]),
                                   "unit": "psi", "from_disp": p["cold_now"], "to_disp": p["cold_new"]})
    if not res["findings"] and not res.get("error"):
        res["findings"].append({"kind": "ok", "severity": "info", "title": "Carro equilibrado",
                                "detail": "Nada fora do normal. Agora é ganhar tempo na pilotagem — veja a análise de segmentos."})
    return res


def _avg4(rows):
    rows = [r for r in rows if r and any(r)]
    if not rows:
        return None
    return [round(sum(r[i] for r in rows) / len(rows), 1) for i in range(4)]
