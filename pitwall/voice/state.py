"""Estado da corrida visto pelo engenheiro: carros normalizados, vizinhos, diferenças em tempo,
tendências, combustível e voltas restantes. Montado a partir dos `Frame` do jogo."""
from __future__ import annotations

import time
from collections import deque
from statistics import median

from ..carinfo import acc_car

SESSION_NAMES = {"race": "Corrida", "qualify": "Classificação", "practice": "Treino livre", "hotlap": "Volta rápida",
                 "hotstint": "Stint", "superpole": "Superpole"}


def session_label(stype: str) -> str:
    s = (stype or "").lower()
    for k, v in SESSION_NAMES.items():
        if s.startswith(k):
            return v
    return "Sessão" if not s else stype.title()


class RaceState:
    def __init__(self, live_delta=None, settings=None):
        self.live_delta = live_delta
        self.settings = settings
        self.f = None
        self.rows: list[dict] = []
        self.me: dict | None = None
        self.race = False
        self.ref_ms = 100000.0
        self.classes: dict[str, list] = {}
        self.multiclass = False
        self.ahead: dict | None = None
        self.behind: dict | None = None
        self.leader: dict | None = None
        self._hist: dict[int, deque] = {}
        self._hist_at = 0.0
        self._fuel_cross = None
        self._fuel_laps: deque = deque(maxlen=6)
        self._lap_times: deque = deque(maxlen=12)
        self._seen_lap = None
        self._pit_this_lap = False
        self.session_key = None

    # ---- atualização -----------------------------------------------------------------------
    def update(self, f):
        self.f = f
        self.race = (f.session_type or "").lower().startswith("race")
        self._lap_bookkeeping(f)
        self._build_rows(f)
        self._neighbors()
        self._history()

    def _lap_bookkeeping(self, f):
        key = (f.track, f.car, f.session_index, f.session_type)
        if key != self.session_key:
            self.session_key = key
            self._fuel_laps.clear()
            self._lap_times.clear()
            self._hist.clear()
            self._fuel_cross, self._seen_lap, self._pit_this_lap = None, None, False
        if f.in_pit_lane:
            self._pit_this_lap = True
        if self._seen_lap is None:
            self._seen_lap, self._fuel_cross = f.completed_laps, f.fuel
        elif f.completed_laps != self._seen_lap:
            if f.completed_laps == self._seen_lap + 1:
                if not self._pit_this_lap and self._fuel_cross and self._fuel_cross > f.fuel > 0:
                    self._fuel_laps.append(self._fuel_cross - f.fuel)
                if f.last_time_ms and f.last_time_ms > 0 and f.is_valid_lap is not None and not self._pit_this_lap:
                    self._lap_times.append(f.last_time_ms)
            self._seen_lap, self._fuel_cross, self._pit_this_lap = f.completed_laps, f.fuel, f.in_pit_lane

    def _build_rows(self, f):
        rows = []
        for c in f.cars or []:
            r = dict(c)
            if isinstance(r.get("model"), int):
                info = acc_car(r["model"])
                r["brand"], r["cls"], r["model"] = info["brand"], r.get("cls") or info["cls"], info["model"]
            first, last = str(r.get("first") or "").strip(), str(r.get("last") or "").strip()
            r["name"] = (first + " " + last).strip() or str(r.get("short") or "")
            r["car"] = (str(r.get("brand") or "") + " " + str(r.get("model") or "")).strip()
            r["dist"] = float(r.get("laps") or 0) + float(r.get("spline") or 0.0)
            r["me"] = r.get("id") == f.player_id
            rows.append(r)
        self.me = next((r for r in rows if r["me"]), None)
        mine = (self.me or {})
        self.ref_ms = next((v for v in (mine.get("best_ms"), mine.get("last_ms"), self.avg_lap_ms(), f.best_time_ms) if v and v > 0), 100000.0)
        if rows and any(r.get("pos") for r in rows):
            rows.sort(key=lambda r: (r.get("pos") or 999, -r["dist"]))
        else:
            rows.sort(key=lambda r: -r["dist"])
            for i, r in enumerate(rows):
                r["pos"] = i + 1
        self.classes = {}
        for r in rows:
            self.classes.setdefault(r.get("cls") or "", []).append(r)
        self.multiclass = len(self.classes) > 1
        for grp in self.classes.values():
            for i, r in enumerate(grp):
                r["cls_pos"] = i + 1
        self.rows = rows
        self.leader = rows[0] if rows else None

    def _neighbors(self):
        self.ahead = self.behind = None
        me = self.me
        if not me:
            return
        if self.race:
            grp = self.classes.get(me.get("cls") or "", self.rows)
            i = next((k for k, r in enumerate(grp) if r is me), None)
            if i is not None:
                self.ahead = grp[i - 1] if i > 0 else None
                self.behind = grp[i + 1] if i + 1 < len(grp) else None
            return
        best_a = best_b = None
        for r in self.rows:
            if r is me or r.get("pit"):
                continue
            d = (r.get("spline", 0.0) - me.get("spline", 0.0)) % 1.0
            if best_a is None or d < best_a[0]:
                best_a = (d, r)
            if best_b is None or (1 - d) < best_b[0]:
                best_b = (1 - d, r)
        self.ahead = best_a[1] if best_a and best_a[0] < 0.5 else None
        self.behind = best_b[1] if best_b and best_b[0] < 0.5 else None

    def _history(self):
        now = time.monotonic()
        if now - self._hist_at < 1.0 or not self.me:
            return
        self._hist_at = now
        for r in self.rows:
            if r is self.me:
                continue
            g = self.gap_s(r)
            if g is not None and abs(g) < 40:
                self._hist.setdefault(r["id"], deque(maxlen=40)).append((now, g))

    # ---- diferenças ------------------------------------------------------------------------
    def gap_s(self, c) -> float | None:
        """Segundos até o carro `c` (positivo: ele está à frente de você; negativo: atrás).
        Em corrida/treino usa a distância na pista; mais de uma volta devolve None (use gap_laps)."""
        me = self.me
        if not me or c is None:
            return None
        if not self.race:
            d = (c.get("spline", 0.0) - me.get("spline", 0.0))
            d = (d + 0.5) % 1.0 - 0.5
        else:
            d = c["dist"] - me["dist"]
        if abs(d) >= 1.0:
            return None
        return d * self.ref_ms / 1000.0

    def gap_laps(self, c) -> int:
        me = self.me
        if not me or c is None or not self.race:
            return 0
        return int(c["dist"] - me["dist"]) if abs(c["dist"] - me["dist"]) >= 1.0 else 0

    def trend(self, c, window: float = 12.0) -> float | None:
        """Quanto a diferença para `c` mudou por volta (s/volta, em módulo): negativo = chegando perto."""
        h = self._hist.get(c["id"]) if c else None
        if not h or len(h) < 4:
            return None
        now = h[-1][0]
        pts = [(t, g) for t, g in h if now - t <= window]
        if len(pts) < 4 or pts[-1][0] - pts[0][0] < 5:
            return None
        sign = 1.0 if pts[-1][1] >= 0 else -1.0
        rate = (abs(pts[-1][1]) - abs(pts[0][1])) / (pts[-1][0] - pts[0][0])      # s/s
        return rate * self.ref_ms / 1000.0

    # ---- combustível e voltas ------------------------------------------------------------------
    def fuel_per_lap(self) -> float | None:
        if self._fuel_laps:
            return float(median(self._fuel_laps))
        ld = self.live_delta
        return float(ld.fpl) if ld is not None and getattr(ld, "fpl", None) else None

    def avg_lap_ms(self) -> float | None:
        if self._lap_times:
            return float(median(self._lap_times))
        ld = self.live_delta
        return float(ld.avg_ms) if ld is not None and getattr(ld, "avg_ms", None) else None

    def fuel_laps(self) -> float | None:
        fpl = self.fuel_per_lap()
        return self.f.fuel / fpl if self.f and fpl else None

    def laps_to_go(self) -> float | None:
        """Voltas até a bandeirada (inclui a fração da volta atual)."""
        f = self.f
        if not f:
            return None
        if f.total_laps:
            return max(0.0, f.total_laps - f.completed_laps - f.norm_pos)
        tl, avg = f.session_time_left, self.avg_lap_ms()
        if tl and tl > 0 and avg:
            left = max(0.0, 1 - f.norm_pos)
            return left + max(0.0, (tl - left * avg) / avg) + (1 if self.race else 0)
        return None

    def fuel_missing(self) -> float | None:
        """Litros que faltam para terminar (positivo = falta)."""
        n, fpl = self.laps_to_go(), self.fuel_per_lap()
        if n is None or not fpl:
            return None
        return n * fpl - self.f.fuel

    # ---- busca de pilotos ------------------------------------------------------------------------
    def find_number(self, n: int):
        for r in self.rows:
            try:
                if int(r.get("number")) == n:
                    return r
            except (TypeError, ValueError):
                pass
        return None

    def at_position(self, p: int, cls: bool = False):
        if cls and self.me and self.multiclass:
            grp = self.classes.get(self.me.get("cls") or "", [])
            return grp[p - 1] if 0 < p <= len(grp) else None
        return self.rows[p - 1] if 0 < p <= len(self.rows) else None

    def best_session_lap(self):
        c = [r for r in self.rows if r.get("best_ms")]
        return min(c, key=lambda r: r["best_ms"]) if c else None
