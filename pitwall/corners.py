"""Plano de curvas de uma pista a partir de uma volta gravada (a sua melhor).

Para cada curva: onde está o ápice, para que lado ela vira, a velocidade mínima e onde você começa a frear.
O ACC e o iRacing não entregam nada disso: tudo vem da telemetria do seu melhor tempo na pista.
"""
from __future__ import annotations

import numpy as np

from .analysis import detect_segments, resample_lap

BRAKE_ON = 0.10          # pedal acima disso = "freando"


def plan(lap: dict, points: int = 2000) -> dict | None:
    grid = np.linspace(0, 1, points)
    R = resample_lap(lap, grid) if lap else None
    if R is None or not R["length"]:
        return None
    length = float(R["length"])
    speed = np.nan_to_num(np.asarray(R["speed"], float), nan=0.0)
    brake = np.nan_to_num(np.asarray(R["brake"], float), nan=0.0)
    x, z = np.asarray(R["x"], float), np.asarray(R["z"], float)
    segs = detect_segments(grid * length, speed)
    step = length / points                      # metros por amostra
    w = max(3, int(40 / max(step, 0.1)))        # ~40 m antes/depois do ápice para medir a direção
    out = []
    for s in segs:
        a, lo = s["apex"], s["start"]
        # direção: sinal do giro do rumo ao redor do ápice (conferido em Monza e Brands Hatch: positivo = curva à DIREITA)
        i0, i1, i2 = max(0, a - w), a, min(points - 1, a + w)
        h1 = (x[i1] - x[i0], z[i1] - z[i0])
        h2 = (x[i2] - x[i1], z[i2] - z[i1])
        cross = h1[0] * h2[1] - h1[1] * h2[0]
        norm = (np.hypot(*h1) * np.hypot(*h2)) or 1.0
        turn = float(np.degrees(np.arcsin(max(-1.0, min(1.0, cross / norm)))))
        # ponto de frenagem: início da zona de freio mais próxima antes do ápice
        j = a
        while j > lo and brake[j] <= BRAKE_ON:
            j -= 1
        brake_d = None
        if brake[j] > BRAKE_ON and (a - j) * step < 250:
            k = j
            while k > lo and brake[k - 1] > BRAKE_ON:
                k -= 1
            brake_d = round(float(grid[k]), 4)
        out.append({"n": s["n"], "apex": round(float(grid[a]), 4), "start": round(float(grid[s["start"]]), 4),
                    "end": round(float(grid[s["end"]]), 4), "dir": "R" if cross > 0 else "L", "angle": round(abs(turn), 1),
                    "min_speed": round(float(speed[a])), "brake": brake_d,
                    "entry_speed": round(float(speed[k])) if brake_d is not None else round(float(speed[max(lo, a - int(150 / max(step, 0.1)))])),
                    "brake_m": round((a - k) * step) if brake_d is not None else None})
    return {"length": round(length), "corners": out}
