"""Dados em tempo real para os overlays (mapa com bandeiras, pedais e participantes).

O gravador entrega cada frame do jogo a `OverlayHub.feed`. Os overlays (páginas em /overlay/<nome>)
pedem `snapshot` várias vezes por segundo: recebem só as amostras novas dos pedais, as bandeiras e a
tabela de participantes já calculada. Nada daqui grava no banco.
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque

import numpy as np

from .db import data_dir

BINS = 400           # pontos do contorno da pista (um por fatia de norm_pos)
SAMPLES = 2400       # ~40 s de pedais a 60 Hz


class OverlayHub:
    def __init__(self, db=None, recorder=None, settings=None):
        self.db = db
        self.recorder = recorder
        self.settings = settings
        self._corners: list = []
        self._corners_try = 0.0
        self._lock = threading.Lock()
        self._seq = 0
        self._samples: deque = deque(maxlen=SAMPLES)
        self._last_at = 0.0
        self.frame = None            # último frame
        self.track = None
        self._xs = [None] * BINS
        self._zs = [None] * BINS
        self._prefilled = False
        self._sector_file = data_dir() / "track_sectors.json"
        self._sectors: dict = {}
        try:
            self._sectors = json.loads(self._sector_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        self._prev_sector = None
        self._prev_pos = 0.0
        self._gh: dict = {}          # histórico da distância até cada carro (tendência: aproximando/afastando)
        self._ih: dict = {}          # histórico do intervalo de cada carro para o da frente
        self._win = 25.0

    # ---- entrada -----------------------------------------------------------------
    def feed(self, f):
        if f is None:
            return
        now = time.monotonic()
        with self._lock:
            self.frame = f
            self._last_at = now
            if f.status == "off":
                return
            if f.track != self.track:
                self._new_track(f.track)
            if f.status == "live":
                self._seq += 1
                self._samples.append((self._seq, now, f.gas, f.brake, f.steer, f.speed, f.gear, f.rpm))
                if f.x or f.z:
                    b = min(BINS - 1, max(0, int(f.norm_pos * BINS)))
                    if self._xs[b] is None:
                        self._xs[b], self._zs[b] = f.x, f.z
                self._learn_sectors(f)

    def _new_track(self, track: str):
        self.track = track
        self._xs = [None] * BINS
        self._zs = [None] * BINS
        self._prefilled = False
        self._corners = []
        self._corners_try = 0.0
        self._prev_sector = None
        self._gh = {}
        self._ih = {}
        if track and self.db is not None:
            threading.Thread(target=self._prefill, args=(track,), daemon=True).start()
            threading.Thread(target=self._load_corners, args=(track,), daemon=True).start()

    def _prefill(self, track: str):
        """Contorno da pista a partir de uma volta já gravada (o mapa aparece completo desde o início)."""
        try:
            pbs = [(k, v) for k, v in self.db.personal_bests().items() if k[1] == track]
            if not pbs:
                return
            lap = self.db.lap(pbs[0][1]["lap_id"])
            tel = (lap or {}).get("telemetry") or {}
            d, x, z = (np.asarray(tel.get(k, []), float) for k in ("d", "x", "z"))
            if len(d) < 50 or len(x) != len(d):
                return
            order = np.argsort(d)
            d, x, z = d[order], x[order], z[order]
            grid = (np.arange(BINS) + 0.5) / BINS
            xs, zs = np.interp(grid, d, x), np.interp(grid, d, z)
            with self._lock:
                if self.track == track:
                    self._xs, self._zs = [float(v) for v in xs], [float(v) for v in zs]
                    self._prefilled = True
        except Exception:  # noqa: BLE001
            pass

    def corners_for(self, track: str) -> list[dict]:
        """Curvas da pista, numeradas como na Análise (mínimos de velocidade do melhor tempo)."""
        from .analysis import detect_segments, resample_lap
        pbs = [v for k, v in self.db.personal_bests().items() if k[1] == track]
        if not pbs:
            return []
        lap = self.db.lap(pbs[0]["lap_id"])
        grid = np.linspace(0, 1, 2000)
        R = resample_lap(lap, grid) if lap else None
        if R is None or not R["length"]:
            return []
        segs = detect_segments(grid * R["length"], R["speed"])
        return [{"n": s["n"], "apex": round(float(grid[s["apex"]]), 4), "start": round(float(grid[s["start"]]), 4),
                 "end": round(float(grid[s["end"]]), 4)} for s in segs]

    def _load_corners(self, track: str):
        try:
            cs = self.corners_for(track)
        except Exception:  # noqa: BLE001
            cs = []
        with self._lock:
            if self.track == track:
                self._corners = cs

    def _learn_sectors(self, f):
        """Descobre onde terminam o setor 1 e o setor 2 (pela virada do índice de setor)."""
        s = f.sector_index
        if self._prev_sector is not None and s != self._prev_sector and abs(f.norm_pos - self._prev_pos) < 0.05:
            if (self._prev_sector, s) in ((0, 1), (1, 2)):
                cur = self._sectors.setdefault(f.track, [None, None])
                i = s - 1
                if cur[i] is None or abs(cur[i] - f.norm_pos) > 0.002:
                    cur[i] = round(f.norm_pos, 4)
                    try:
                        self._sector_file.write_text(json.dumps(self._sectors), encoding="utf-8")
                    except OSError:
                        pass
        self._prev_sector, self._prev_pos = s, f.norm_pos

    # ---- saída -------------------------------------------------------------------
    def map(self) -> dict:
        with self._lock:
            pts = [[x, z] if x is not None else None for x, z in zip(self._xs, self._zs)]
            sec = self._sectors.get(self.track or "", [None, None])
            filled = sum(p is not None for p in pts) / BINS
            track, corners = self.track, list(self._corners)
            retry = track and not corners and self.db is not None and time.monotonic() - self._corners_try > 20
            if retry:
                self._corners_try = time.monotonic()
        if retry:                    # ainda sem curvas (pista nova): tenta de novo depois que uma volta for gravada
            threading.Thread(target=self._load_corners, args=(track,), daemon=True).start()
        names = ((self.settings.get("corner_names") or {}).get(track or "") or {}) if self.settings else {}
        return {"track": track, "pts": pts, "filled": round(filled, 3), "sectors": [sec[0] or 1 / 3, sec[1] or 2 / 3],
                "corners": [{**c, "name": names.get(str(c["n"]), "")} for c in corners]}

    def snapshot(self, since: int = 0, parts: str = "all") -> dict:
        want = set(parts.split(",")) if parts != "all" else {"pedals", "flags", "cars", "delta", "tyres"}
        now = time.monotonic()
        with self._lock:
            f = self.frame
            idle = f is None or now - self._last_at > 3 or f.status == "off"
            out = {"seq": self._seq, "t": now, "track": self.track,
                   "status": "idle" if idle else f.status, "game": f.game if f else ""}
            if "pedals" in want:
                if since > self._seq or since == 0:
                    since = max(0, self._seq - 600)        # primeira chamada (ou o app reiniciou): últimos ~10 s
                out["samples"] = [[round(s[1], 3), round(s[2], 3), round(s[3], 3), round(s[4], 3), round(s[5]), s[6], s[7]]
                                  for s in self._samples if s[0] > since]
            if f is not None and not idle:
                out["session"] = {"type": f.session_type, "time_left": f.session_time_left, "lap": f.completed_laps + 1,
                                  "car": f.car, "in_pit": f.in_pit_lane, "valid": f.is_valid_lap, "pos": f.norm_pos}
                if "flags" in want:
                    out["flags"] = f.flags
                if "tyres" in want:
                    out["tyres"] = {"temp": [round(v, 1) for v in f.tyre_temp], "press": [round(v, 2) for v in f.tyre_press],
                                    "brake": [round(v) for v in f.brake_temp], "wear": [round(v, 3) for v in f.tyre_wear] or None,
                                    "pad": [round(v, 1) for v in f.pad_life] or None, "compound": f.tyre_compound, "game": f.game}
                if "cars" in want:
                    out["standings"] = self._standings(f)
                    out["me"] = {"spline": f.norm_pos, "x": f.x, "z": f.z, "id": f.player_id}
                    out["cars"] = [{"id": c.get("id"), "spline": c.get("spline", 0), "pos": c.get("pos", 0),
                                    "number": c.get("number"), "pit": c.get("pit", False)} for c in f.cars]
        if "delta" in want and self.recorder is not None:
            live = self.recorder.live or {}
            out["delta"] = {k: live.get(k) for k in ("state", "delta_ms", "predicted_ms", "ref_ms", "ref_kind", "fuel_laps",
                                                      "fuel_to_end", "current_ms", "last_ms", "best_ms", "in_pit_lane")}
        return out

    # ---- participantes -----------------------------------------------------------
    def _window(self) -> float:
        """Janela (s) da tendência do intervalo, ajustável nas opções do overlay de participantes."""
        try:
            v = float(((self.settings.get("overlays") or {}).get("standings") or {}).get("trend_secs", 25)) if self.settings else 25.0
        except (TypeError, ValueError):
            v = 25.0
        return max(5.0, min(90.0, v))

    def _rate(self, store: dict, key, gap: float, ref_ms: float, now: float):
        """Variação (ms por segundo) de `gap` na janela da tendência; None sem histórico suficiente."""
        win = self._win
        h = store.setdefault(key, deque(maxlen=300))
        if h and abs(gap - h[-1][1]) > 0.4 * ref_ms:             # pulo (volta, box, teleporte): recomeça
            h.clear()
        if not h or now - h[-1][0] >= 0.4:
            h.append((now, gap))
        while h and now - h[0][0] > win:
            h.popleft()
        if len(h) < 4 or h[-1][0] - h[0][0] < max(3.0, win * 0.25):       # espera juntar ~1/4 da janela
            return None
        return (abs(h[-1][1]) - abs(h[0][1])) / (h[-1][0] - h[0][0])

    def _trend(self, c, me, ref_ms: float, now: float):
        """Estou me aproximando ou me afastando deste carro? (ms/s, positivo = bom para mim)

        Guarda a distância (em tempo) entre mim e o carro nos últimos segundos e vê se ela cresce ou encolhe:
        - carro à frente: encolher é bom (estou chegando); crescer é ruim (ele está abrindo);
        - carro atrás: crescer é bom (estou abrindo); encolher é ruim (ele está chegando).
        """
        diff = me["_dist"] - c["_dist"]                         # > 0: o carro está atrás de mim
        if c.get("pit") or abs(diff) >= 1.0:
            self._gh.pop(c.get("id"), None)
            return None
        gap = diff * ref_ms
        rate = self._rate(self._gh, c.get("id"), gap, ref_ms, now)
        if rate is None:
            return None
        good = -rate if gap < 0 else rate
        return {"good": round(good, 2), "per_lap": round(good * ref_ms / 1e6, 3)}

    def _standings(self, f) -> dict:
        from .carinfo import acc_car
        cars = f.cars
        if not cars:
            return {"rows": [], "status": f.cars_status or "sem dados dos outros pilotos neste jogo/sessão"}
        for c in cars:
            if c.get("model") is not None and not c.get("brand"):
                info = acc_car(c["model"])
                c["brand"], c["cls"], c["cls_color"] = info["brand"], c.get("cls") or info["cls"], c.get("cls_color") or info["cls_color"]
                c["model"] = info["model"] if info["model"] else c["model"]
        race = (f.session_type or "").lower().startswith("race")
        me = next((c for c in cars if c.get("id") == f.player_id), None)
        for c in cars:
            c["_dist"] = c.get("laps", 0) + c.get("spline", 0.0)
        order = sorted(cars, key=lambda c: (c.get("pos") or 999, -c["_dist"]))
        if race and not any(c.get("pos") for c in cars):
            order = sorted(cars, key=lambda c: -c["_dist"])
        ref_ms = next((v for v in ((me or {}).get("best_ms"), (me or {}).get("last_ms"), order[0].get("best_ms")) if v), 100000)
        lead = order[0]
        rows = []
        now = time.monotonic()
        self._win = self._window()
        for i, c in enumerate(order):
            ahead = order[i - 1] if i else None
            row = {"pos": c.get("pos") or i + 1, "number": c.get("number"), "first": c.get("first", ""), "last": c.get("last", ""),
                   "short": c.get("short", ""), "cls": c.get("cls", ""), "cls_color": c.get("cls_color"), "laps": c.get("laps", 0),
                   "brand": c.get("brand", "") if isinstance(c.get("brand"), str) else "", "model": c.get("model", "") if isinstance(c.get("model"), str) else "",
                   "best_ms": c.get("best_ms"), "last_ms": c.get("last_ms"), "pit": bool(c.get("pit")),
                   "me": c is me, "id": c.get("id"),
                   "trend": self._trend(c, me, ref_ms, now) if me and c is not me else None}
            row["trend_int"] = None
            if ahead is not None and me is not None and not c.get("pit") and not ahead.get("pit") and abs(ahead["_dist"] - c["_dist"]) < 1.0:
                r = self._rate(self._ih, c.get("id"), (ahead["_dist"] - c["_dist"]) * ref_ms, ref_ms, now)
                if r is not None:
                    behind_me = c["_dist"] < me["_dist"] and c is not me
                    # quem está atrás de mim chegando no da frente é ameaça (vermelho); eu chegando no da frente é bom (verde)
                    row["trend_int"] = {"good": round(r if behind_me else -r, 2)}
            if race:
                row["gap_leader"] = _gap(lead["_dist"] - c["_dist"], ref_ms) if i else None
                row["interval"] = _gap(ahead["_dist"] - c["_dist"], ref_ms) if ahead else None
                row["vs_me"] = _gap(me["_dist"] - c["_dist"], ref_ms) if me and c is not me else None
            else:                      # treino/classificação: a diferença é de melhor volta
                lb, ab, mb, cb = lead.get("best_ms"), (ahead or {}).get("best_ms"), (me or {}).get("best_ms"), c.get("best_ms")
                row["gap_leader"] = {"ms": cb - lb} if i and cb and lb else None
                row["interval"] = {"ms": cb - ab} if ahead and cb and ab else None
                row["vs_me"] = {"ms": cb - mb} if me and c is not me and cb and mb else None
            rows.append(row)
        # posição dentro da classe e as classes (a mais à frente primeiro)
        classes: dict = {}
        for r in rows:
            k = r["cls"] or ""
            g = classes.setdefault(k, {"name": k, "color": r["cls_color"], "n": 0, "pos": r["pos"]})
            g["n"] += 1
            r["cls_pos"] = g["n"]
            if g["color"] is None:
                g["color"] = r["cls_color"]
        header = {"time_left": f.session_time_left, "total": f.session_total_ms, "lap": f.completed_laps + 1,
                  "total_laps": f.total_laps, "count": len(rows), "type": f.session_type}
        return {"rows": rows, "race": race, "ref_ms": ref_ms, "classes": list(classes.values()), "header": header}


def _gap(dist_diff: float, ref_ms: float) -> dict:
    """Diferença em tempo (distância na pista × tempo de volta de referência).
    Positivo = o outro carro está atrás; negativo = à frente (em volta ou em tempo)."""
    laps = int(abs(dist_diff))
    if laps >= 1:
        return {"laps": laps if dist_diff > 0 else -laps}
    return {"ms": dist_diff * ref_ms}
