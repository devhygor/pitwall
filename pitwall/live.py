"""Delta ao vivo contra o seu recorde (ou a volta ideal) + combustível até o fim.

A cada frame: procura, na volta de referência, quanto tempo ela levou para chegar
ao mesmo ponto da pista em que você está agora. A diferença é o delta. O
consumo médio vem das voltas desta sessão (ou do seu histórico com o carro).
"""
from __future__ import annotations

import math

import numpy as np

from .analysis import _monotonic


class LiveDelta:
    def __init__(self, db, settings):
        self.db = db
        self.settings = settings
        self.key = None
        self.ref = None            # (d, t) da volta de referência
        self.ref_ms = None
        self.ref_kind = None
        self.fpl = None            # litros por volta
        self.avg_ms = None

    def load(self, car: str, track: str, session_id: int | None = None):
        self.key = (car, track)
        self.ref = None
        kind = self.settings.get("overlay_reference") if self.settings else "pb"
        lap = None
        if kind == "ideal":
            ideal = next((e for e in self.db.externals("ideal") if e["car"] == car and e["track"] == track), None)
            if ideal:
                lap = self.db.lap(ideal["lap_id"])
        if lap is None:
            pb = self.db.pb_for(car, track)
            lap = self.db.lap(pb["lap_id"]) if pb else None
            kind = "pb"
        if lap and lap.get("telemetry", {}).get("d"):
            tel = lap["telemetry"]
            d, t = _monotonic(np.asarray(tel["d"], float), np.asarray(tel["t"], float))
            self.ref = (d, t)
            self.ref_ms = lap["lap_time_ms"]
            self.ref_kind = kind
        self.refresh_fuel(car, track, session_id)

    def refresh_fuel(self, car: str, track: str, session_id: int | None):
        laps = self.db.laps(session_id) if session_id else []
        used = [l["fuel_used"] for l in laps if l.get("fuel_used") and not l["out_lap"] and not l["in_lap"]]
        times = [l["lap_time_ms"] for l in laps if not l["out_lap"] and not l["in_lap"]]
        hist = next((s for s in self.db.car_track_stats() if s["car"] == car and s["track"] == track), None)
        self.fpl = (sum(used) / len(used)) if used else (hist["fuel_per_lap"] if hist and hist["fuel_per_lap"] else None)
        self.avg_ms = (sum(times) / len(times)) if times else (hist["avg_ms"] if hist else self.ref_ms)

    def update(self, f) -> dict:
        out = {"ref_kind": self.ref_kind, "ref_ms": self.ref_ms}
        if self.ref is not None and not f.in_pit_lane:
            d, t = self.ref
            if d[0] <= f.norm_pos <= d[-1]:
                ref_t = float(np.interp(f.norm_pos, d, t))
                delta = f.current_time_ms - ref_t
                out["delta_ms"] = int(round(delta))
                out["predicted_ms"] = int(round(self.ref_ms + delta))
        if self.fpl:
            out["fuel_per_lap"] = round(self.fpl, 2)
            out["fuel_laps"] = round(f.fuel / self.fpl, 1) if self.fpl > 0 else None
            tl = getattr(f, "session_time_left", -1)
            if tl and tl > 0 and self.avg_ms:
                # voltas até a bandeirada: termina a volta atual + as que cabem no tempo restante + a final
                left_this = max(0.0, 1 - f.norm_pos)
                laps_left = left_this + math.ceil(max(0.0, tl - left_this * self.avg_ms) / self.avg_ms)
                need = laps_left * self.fpl
                out["laps_left"] = round(laps_left, 1)
                out["fuel_to_end"] = round(need - f.fuel, 1)       # > 0: falta combustível
        return out
