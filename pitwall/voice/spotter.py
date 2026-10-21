"""Observador (spotter): avisa quando há carro ao lado ("três de lado, você está no meio").

* iRacing: o próprio jogo informa (CarLeftRight), vem em `frame.extra["car_lr"]`.
* ACC: calcula pela posição dos carros (broadcast) em relação ao seu, usando o rumo do seu carro. O sistema
  de coordenadas do broadcast é descoberto sozinho comparando a posição do seu carro nos dois
  lados (shared memory × broadcast). Se esquerda/direita ficarem trocadas no seu jogo, há uma
  opção de inverter nas configurações.
"""
from __future__ import annotations

import math
import time
from collections import deque

# transformações possíveis (broadcast x,y) -> (X,Z) da shared memory: (índice a, sinal a, índice b, sinal b)
_TRANSFORMS = [(a, sa, 1 - a, sb) for a in (0, 1) for sa in (1, -1) for sb in (1, -1)]


class Spotter:
    def __init__(self, settings=None):
        self.settings = settings
        self.hist: deque = deque(maxlen=40)       # (t, x, z) do seu carro
        self._err = [[0.0, 0.0] for _ in _TRANSFORMS]   # soma de erro e peso de cada transformação
        self.tf = None
        self.left = 0
        self.right = 0
        self.source = ""                          # "iracing" | "acc" | ""
        self._since = {"L": 0.0, "R": 0.0}
        self._clear_at = {"L": 0.0, "R": 0.0}
        self._said = (0, 0)
        self._last_call = 0.0
        self._repeat = 0

    def reset(self):
        self.hist.clear()
        self._err = [[0.0, 0.0] for _ in _TRANSFORMS]
        self.tf = None
        self.left = self.right = 0
        self._said = (0, 0)

    # ---- geometria -------------------------------------------------------------------------
    def _heading(self, now):
        if len(self.hist) < 2:
            return None
        t1, x1, z1 = self.hist[-1]
        for t0, x0, z0 in reversed(self.hist):
            if t1 - t0 >= 0.2:
                d = math.hypot(x1 - x0, z1 - z0)
                return ((x1 - x0) / d, (z1 - z0) / d) if d > 0.3 else None
        return None

    def _calibrate(self, f, me):
        if me is None or me.get("x") is None or me.get("y") is None or f.speed < 20:
            return
        bx, by = float(me["x"]), float(me["y"])
        for k, (a, sa, b, sb) in enumerate(_TRANSFORMS):
            v = (bx, by)
            X, Z = sa * v[a], sb * v[b]
            e = math.hypot(X - f.x, Z - f.z)
            s = self._err[k]
            s[0] = s[0] * 0.995 + min(e, 200.0)
            s[1] = s[1] * 0.995 + 1.0
        means = sorted((s[0] / s[1], k) for k, s in enumerate(self._err) if s[1] > 0)
        if means and self._err[means[0][1]][1] > 80:
            best = means[0]
            self.tf = _TRANSFORMS[best[1]] if best[0] < 25.0 else None

    # ---- atualização -----------------------------------------------------------------------
    def update(self, f, st) -> tuple[int, int]:
        now = time.monotonic()
        lr = (f.extra or {}).get("car_lr")
        if lr is not None:
            self.source = "iracing"
            self.left, self.right = {2: (1, 0), 3: (0, 1), 4: (1, 1), 5: (2, 0), 6: (0, 2)}.get(int(lr), (0, 0))
            return self.left, self.right
        self.source = ""
        if f.status != "live" or f.speed < 25 or not st.rows or not st.me:
            self.left = self.right = 0
            return 0, 0
        self.hist.append((now, f.x, f.z))
        self._calibrate(f, st.me)
        h = self._heading(now)
        if self.tf is None or h is None:
            self.left = self.right = 0
            return 0, 0
        self.source = "acc"
        a, sa, b, sb = self.tf
        hx, hz = h
        rx, rz = hz, -hx                                  # direita do rumo (x à direita, z à frente)
        if self.settings and self.settings.get("eng_spotter_swap"):
            rx, rz = -rx, -rz
        L = R = 0
        for r in st.rows:
            if r.get("me") or r.get("pit") or r.get("x") is None:
                continue
            v = (float(r["x"]), float(r["y"]))
            dx, dz = sa * v[a] - f.x, sb * v[b] - f.z
            if abs(dx) > 14 or abs(dz) > 14:
                continue
            fwd = dx * hx + dz * hz
            side = dx * rx + dz * rz
            if -6.5 < fwd < 4.5 and 1.0 < abs(side) < 5.5:
                if side < 0:
                    L += 1
                else:
                    R += 1
        self.left, self.right = min(L, 2), min(R, 2)
        return self.left, self.right

    # ---- falas -----------------------------------------------------------------------------
    def calls(self) -> list[str]:
        """Frases (chaves de `phrases`) a falar agora, com histerese para não tremer."""
        now = time.monotonic()
        L, R = self.left, self.right
        sl, sr = self._said
        out: list[str] = []
        # --- ocupado: avisa quando um lado passa a ter carro (ou mais carros)
        if L and R and not (sl and sr):
            out.append("three_wide")
        else:
            if L > sl:
                out.append("two_left" if L > 1 else "car_left")
            if R > sr:
                out.append("two_right" if R > 1 else "car_right")
        # --- livre: só depois de 0,35 s sem carro naquele lado
        for side, n in (("L", L), ("R", R)):
            if n:
                self._clear_at[side] = 0.0
            elif (sl if side == "L" else sr) and not self._clear_at[side]:
                self._clear_at[side] = now
        cl = bool(sl and not L and self._clear_at["L"] and now - self._clear_at["L"] >= 0.35)
        cr = bool(sr and not R and self._clear_at["R"] and now - self._clear_at["R"] >= 0.35)
        if cl and cr:
            out.append("clear_all")
        elif cl:
            out.append("clear_left")
        elif cr:
            out.append("clear_right")
        # --- continua ocupado: lembra uma ou duas vezes
        if out:
            self._last_call, self._repeat = now, 0
        elif (L or R) and (sl or sr) and now - self._last_call > 4.0 and self._repeat < 2:
            self._last_call = now
            self._repeat += 1
            out.append("three_wide" if L and R else "still_left" if L else "still_right")
        self._said = (0 if cl else (L or sl), 0 if cr else (R or sr))
        return out

    def describe(self) -> str | None:
        if not self.source:
            return None
        L, R = self.left, self.right
        if not L and not R:
            return "Pista livre dos dois lados."
        if L and R:
            return "Tem carro dos dois lados, você está no meio."
        n = L or R
        return f"Tem {'um carro' if n == 1 else 'dois carros'} à {'esquerda' if L else 'direita'}."
