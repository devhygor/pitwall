"""Gravador: consome frames de uma fonte, detecta sessões, voltas, setores e
stints, e grava cada volta completa (com telemetria) no banco."""
from __future__ import annotations

import datetime as dt
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Iterable, Optional

from .db import DB
from .sources import Frame

# Canais gravados por amostra
CHANNELS = ("d", "t", "speed", "gas", "brake", "steer", "gear", "rpm", "x", "z",
            "saf", "sar",        # deriva média (abs) dos pneus dianteiros / traseiros
            "srf", "srr", "srx",  # escorregamento: pior dianteiro (min), pior traseiro (min), traseiro máx
            "glat")


def now_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


@dataclass
class _LapBuffer:
    lap_number: int
    stint: int
    start_pos: float
    started_in_pit: bool
    fuel_start: float
    cols: dict = field(default_factory=lambda: {k: [] for k in CHANNELS})
    splits: list = field(default_factory=list)          # [(sector_idx, tempo_acumulado_ms)]
    sector_reports: dict = field(default_factory=dict)  # sector_idx -> last_sector_ms do jogo
    invalid: bool = False
    touched_pit: bool = False
    tyre_t: list = field(default_factory=lambda: [0.0] * 4)
    tyre_p: list = field(default_factory=lambda: [0.0] * 4)
    tyre_n: int = 0
    start_wall: Optional[float] = None
    brake_t: list = field(default_factory=lambda: [0.0] * 4)
    events: list = field(default_factory=list)     # incidentes: [{type, d, ...}]
    was_valid: bool = True
    last_event_t: dict = field(default_factory=dict)
    susp_max: list = field(default_factory=lambda: [0.0] * 4)


class Recorder:
    def __init__(self, db: DB, game: str = "acc", video=None):
        self.db = db
        self.game = game
        self.video = video          # VideoRecorder opcional
        self.on_session_start = []  # funções chamadas com (session_id, primeiro frame)
        self.extra_live: dict = {}  # informações extras para o status ao vivo (ex.: setup sugerido)
        self._post = None           # conferência da última volta salva (ver _post_check)
        self.live_delta = None      # LiveDelta opcional (delta ao vivo contra o recorde)
        self.hub = None             # OverlayHub opcional (dados em tempo real dos overlays)
        self.engineer = None        # Engineer opcional (engenheiro de voz)
        self.detector = None        # SetupDetector opcional (reconhece o setup carregado no ACC)
        self.on_lap_saved = []      # funções chamadas com (lap_id, car, track) depois de gravar uma volta
        self.session_id: Optional[int] = None
        self._session_key = None
        self._lap: Optional[_LapBuffer] = None
        self._pending: Optional[tuple] = None   # (buffer, frame no cruzamento)
        self._prev: Optional[Frame] = None
        self._stint = 1
        self._was_in_pit_lane = False
        self.live: dict = {"state": "waiting"}
        self.laps_saved = 0
        self._session_laps = 0
        self._last_frame_at = time.monotonic()
        self._speed_hist = deque()
        self._lock_since = None
        self._stop = threading.Event()

    # --- ciclo de vida -----------------------------------------------------
    def run(self, frames: Iterable[Optional[Frame]]):
        for f in frames:
            if self._stop.is_set():
                break
            self.feed(f)
        self.close()

    def stop(self):
        self._stop.set()

    def close(self):
        self._flush_pending(force=True)
        self._end_session()

    # --- processamento -----------------------------------------------------
    def feed(self, f: Optional[Frame]):
        if self.hub is not None:
            self.hub.feed(f)
        if self.engineer is not None:
            self.engineer.feed(f)
        if f is None:
            # jogo fechado/no menu por mais de 60 s: encerra a sessão aberta
            if self.session_id is not None and time.monotonic() - self._last_frame_at > 60:
                self._flush_pending(force=True)
                self._end_session()
                self._prev = None
            if self.session_id is None:
                self.live = {"state": "waiting"}
            return
        self._last_frame_at = time.monotonic()
        if f.status == "off":
            self._flush_pending(force=True)
            self._end_session()
            self.live = {"state": "waiting"}
            self._prev = None
            return
        if f.status != "live":       # pausa ou replay: não grava
            self.live = {**self.live, "state": f.status, "game": f.game}
            return

        key = (f.session_index, f.session_type, f.track, f.car)
        restarted = self._prev is not None and f.completed_laps < self._prev.completed_laps
        if key != self._session_key or restarted:
            self._flush_pending(force=True)
            self._end_session()
            self._start_session(f, key)

        prev = self._prev
        self._prev = f
        if self.detector is not None:
            self.detector.feed(f, self.session_id)

        # pendente: a volta cruzou a linha, esperamos o jogo atualizar last_time
        self._flush_pending(frame=f)

        if self._lap is None:
            self._lap = self._new_lap(f)

        # stint: sai do pit lane -> novo stint (exceto na saída inicial)
        if self._was_in_pit_lane and not f.in_pit_lane and self.laps_saved_in_session > 0:
            self._stint += 1
            if self._lap is not None and self._lap.touched_pit:
                self._lap.stint = self._stint   # a volta de saída já é do novo stint
        self._was_in_pit_lane = f.in_pit_lane

        # cruzou a linha?
        if prev is not None and f.completed_laps > prev.completed_laps:
            self._pending = (self._lap, f, prev)
            self._lap = self._new_lap(f)
        elif prev is not None and f.sector_index != prev.sector_index and f.sector_index > 0:
            self._lap.splits.append((f.sector_index, f.current_time_ms))

        lap = self._lap
        if prev is not None and f.sector_index > 0 and f.last_sector_ms != prev.last_sector_ms:
            lap.sector_reports[f.sector_index] = f.last_sector_ms
        self._detect_events(lap, f)
        if not f.is_valid_lap:
            lap.invalid = True
        if f.cut_penalty and prev is not None and not prev.cut_penalty:
            lap.invalid = True          # penalidade nova por corte de pista nesta volta
        self._post_check(f)
        if f.in_pit_lane:
            lap.touched_pit = True
        self._sample(lap, f)
        self.live = {
            "state": "recording", "session_id": self.session_id, "track": f.track, "car": f.car,
            "session_type": f.session_type, "lap": f.completed_laps + 1, "stint": self._stint,
            "current_ms": f.current_time_ms, "last_ms": f.last_time_ms, "best_ms": f.best_time_ms,
            "fuel": round(f.fuel, 2), "speed": round(f.speed), "gear": f.gear,
            "in_pit_lane": f.in_pit_lane, "laps_saved": self.laps_saved_in_session,
            "video": bool(self.video and self.video.recording), "game": f.game,
            **self.extra_live,
        }
        if self.live_delta:
            self.live.update(self.live_delta.update(f))

    # --- auxiliares --------------------------------------------------------
    @property
    def laps_saved_in_session(self) -> int:
        return self._session_laps

    def _start_session(self, f: Frame, key):
        self._session_key = key
        self.session_id = self.db.create_session(
            game=f.game if self.game == "acc" else self.game, started_at=now_iso(), session_type=f.session_type,
            track=f.track, car=f.car, player=f.player)
        self._session_laps = 0
        self._lap = None
        self._prev = None
        self._stint = 1
        self._was_in_pit_lane = f.in_pit_lane
        if self.video:
            self.video.start(self.session_id)
        self.extra_live = {}
        if self.live_delta:
            try:
                self.live_delta.load(f.car, f.track, self.session_id)
            except Exception as e:  # noqa: BLE001
                print(f"Delta ao vivo indisponível: {e}")
        for fn in self.on_session_start:
            try:
                fn(self.session_id, f)
            except Exception as e:  # noqa: BLE001
                print(f"Aviso: {e}")

    def _end_session(self):
        if self.session_id is not None:
            self.db.end_session(self.session_id, now_iso())
            if self.video:
                self.video.stop()
        self.session_id = None
        self._session_key = None
        self._lap = None

    def _new_lap(self, f: Frame) -> _LapBuffer:
        return _LapBuffer(lap_number=f.completed_laps + 1, stint=self._stint,
                          start_pos=f.norm_pos, started_in_pit=f.in_pit_lane, fuel_start=f.fuel,
                          touched_pit=f.in_pit_lane)

    def _detect_events(self, lap: _LapBuffer, f: Frame):
        """Marca incidentes no ponto da pista onde aconteceram."""
        def add(kind, every, **extra):
            if f.t - lap.last_event_t.get(kind, -1e9) < every:
                return
            lap.last_event_t[kind] = f.t
            lap.events.append({"type": kind, "d": round(f.norm_pos, 4), "t": f.current_time_ms, **extra})
        # volta invalidada (limite de pista, corte...)
        if lap.was_valid and not f.is_valid_lap and not f.in_pit_lane:
            add("invalid", 0)
        lap.was_valid = f.is_valid_lap
        # perda brusca de velocidade sem estar freando forte = rodada/batida/saída de pista
        hist = self._speed_hist
        hist.append((f.t, f.speed, f.brake))
        while hist and f.t - hist[0][0] > 1.5:
            hist.popleft()
        if not f.in_pit_lane and len(hist) > 3:
            top = max(h[1] for h in hist)
            hard_brake = max(h[2] for h in hist) > 0.15
            if top - f.speed > 70 and not hard_brake:
                add("loss", 6, drop=round(top - f.speed))
        # travamento forte de roda (precisa durar ~0,25 s para não pegar ruído)
        if f.brake > 0.3 and min(f.slip_ratio[0], f.slip_ratio[1]) < -0.3:
            self._lock_since = self._lock_since or f.t
            if f.t - self._lock_since >= 0.25:
                add("lock", 4)
        else:
            self._lock_since = None

    @staticmethod
    def _sample(lap: _LapBuffer, f: Frame):
        c = lap.cols
        # descarta amostras do "fim da volta anterior" logo após cruzar a linha
        d = f.norm_pos
        if not c["d"] and d > 0.9 and f.current_time_ms < 5000:
            return                      # primeira amostra ainda é do fim da volta anterior
        if c["d"] and d < 0.5 and c["d"][-1] > 0.5 and f.current_time_ms > 5000:
            return
        if lap.start_wall is None and f.wall:
            lap.start_wall = f.wall - f.current_time_ms / 1000.0
        c["d"].append(round(d, 5))
        c["t"].append(f.current_time_ms)
        c["speed"].append(round(f.speed, 1))
        c["gas"].append(round(f.gas, 3))
        c["brake"].append(round(f.brake, 3))
        c["steer"].append(round(f.steer, 3))
        c["gear"].append(f.gear)
        c["rpm"].append(f.rpm)
        c["x"].append(round(f.x, 2))
        c["z"].append(round(f.z, 2))
        sa, sr = f.slip_angle, f.slip_ratio
        c["saf"].append(round((abs(sa[0]) + abs(sa[1])) / 2, 4))
        c["sar"].append(round((abs(sa[2]) + abs(sa[3])) / 2, 4))
        c["srf"].append(round(min(sr[0], sr[1]), 3))
        c["srr"].append(round(min(sr[2], sr[3]), 3))
        c["srx"].append(round(max(sr[2], sr[3]), 3))
        c["glat"].append(round(f.g_lat, 3))
        for k in range(4):
            lap.susp_max[k] = max(lap.susp_max[k], f.susp[k])
        if any(f.tyre_temp):
            for i in range(4):
                lap.tyre_t[i] += f.tyre_temp[i]
                lap.tyre_p[i] += f.tyre_press[i]
                lap.brake_t[i] += f.brake_temp[i]
            lap.tyre_n += 1

    def _post_check(self, f: Frame):
        """Confere a volta que acabou de ser salva nos primeiros segundos da volta seguinte.

        O ACC às vezes só invalida um corte (ex.: na última chicane) depois de cruzar a linha,
        e o melhor tempo oficial dele só considera voltas válidas: se a volta salva é mais rápida
        que o melhor tempo do jogo, o jogo não aceitou a volta."""
        pc = self._post
        if not pc:
            return
        lap_id, lap_time, t_cross = pc
        if f.t - t_cross > 4.0:
            self._post = None
            return
        reason = None
        # o melhor tempo do jogo pode demorar alguns quadros para atualizar: só confere depois de 2,5 s
        if f.t - t_cross >= 2.5 and f.best_time_ms and f.best_time_ms > 0 and lap_time < f.best_time_ms - 2:
            reason = "o jogo não aceitou como melhor volta"
        elif not f.is_valid_lap and f.current_time_ms < 2000 and not f.in_pit_lane:
            reason = "invalidada logo depois da linha"
        if reason:
            self._post = None
            try:
                self.db.set_lap_valid(lap_id, False, reason)
                if self.live_delta and self._session_key:
                    self.live_delta.load(self._session_key[3], self._session_key[2], self.session_id)
            except Exception as e:  # noqa: BLE001
                print(f"Aviso: {e}")

    def _flush_pending(self, frame: Optional[Frame] = None, force: bool = False):
        if not self._pending:
            return
        lap, cross, before = self._pending
        # espera até ~1,5 s para o jogo publicar o tempo oficial da volta
        ready = force or frame is None or (frame.last_time_ms != before.last_time_ms) \
            or (frame.t - cross.t > 1.5)
        if not ready:
            return
        self._pending = None
        lap_time = (frame or cross).last_time_ms or cross.last_time_ms
        if not lap_time or lap_time <= 0:
            lap_time = before.current_time_ms
        self._save_lap(lap, lap_time, end_frame=before, cross_frame=cross)

    def _resolve_sectors(self, lap: _LapBuffer, lap_time: int):
        """Calcula S1/S2/S3. Usa o tempo oficial do jogo quando ele bate com o
        que medimos; senão, usa o tempo medido na troca de setor."""
        cum = {}
        for idx, measured in lap.splits:
            rep = lap.sector_reports.get(idx)
            prev_cum = cum.get(idx - 1, 0)
            val = measured
            if rep:
                if abs(rep - measured) < 400:              # jogo reporta acumulado
                    val = rep
                elif abs(prev_cum + rep - measured) < 400:  # jogo reporta só o setor
                    val = prev_cum + rep
            cum[idx] = val
        if 1 not in cum or 2 not in cum:
            return None, None, None
        s1 = cum[1]
        s2 = cum[2] - cum[1]
        s3 = lap_time - cum[2]
        if min(s1, s2, s3) <= 0:
            return None, None, None
        return s1, s2, s3

    def _save_lap(self, lap: _LapBuffer, lap_time: int, end_frame: Frame, cross_frame: Frame):
        if len(lap.cols["d"]) < 20:
            return
        out_lap = lap.started_in_pit or (0.05 < lap.start_pos < 0.95)
        in_lap = bool(end_frame.in_pit_lane or cross_frame.in_pit_lane)
        s1, s2, s3 = self._resolve_sectors(lap, lap_time)
        n = max(lap.tyre_n, 1)
        fuel_end = end_frame.fuel
        fuel_used = lap.fuel_start - fuel_end
        if fuel_used < 0:      # reabasteceu no meio da volta
            fuel_used = None
        lap_id = self.db.insert_lap(
            session_id=self.session_id, lap_number=lap.lap_number, stint=lap.stint,
            lap_time_ms=int(lap_time), s1_ms=s1, s2_ms=s2, s3_ms=s3,
            valid=0 if lap.invalid else 1, out_lap=int(out_lap), in_lap=int(in_lap),
            fuel_start=round(lap.fuel_start, 3), fuel_end=round(fuel_end, 3),
            fuel_used=None if fuel_used is None else round(fuel_used, 3),
            air_temp=end_frame.air_temp, road_temp=end_frame.road_temp, grip=end_frame.grip,
            tyre_temp=[round(v / n, 1) for v in lap.tyre_t] if lap.tyre_n else None,
            tyre_press=[round(v / n, 2) for v in lap.tyre_p] if lap.tyre_n else None,
            recorded_at=now_iso(), telemetry=lap.cols,
            start_wall=None if lap.start_wall is None else round(lap.start_wall, 3),
            brake_temp=[round(v / n, 0) for v in lap.brake_t] if lap.tyre_n else None,
            events=lap.events,
            susp_max=[round(v, 4) for v in lap.susp_max],
        )
        self.laps_saved += 1
        self._session_laps += 1
        self._post = (lap_id, int(lap_time), cross_frame.t) \
            if not (lap.invalid or out_lap or in_lap) and cross_frame.game == "acc" else None
        if self._session_key:
            for fn in self.on_lap_saved:
                try:
                    fn(lap_id, self._session_key[3], self._session_key[2])
                except Exception as e:  # noqa: BLE001
                    print(f"Aviso: {e}")
        if self.live_delta and self._session_key:
            try:   # novo recorde ou consumo atualizado
                self.live_delta.load(self._session_key[3], self._session_key[2], self.session_id)
            except Exception:  # noqa: BLE001
                pass
