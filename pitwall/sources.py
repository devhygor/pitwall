"""Fontes de dados: ACC ao vivo (shared memory) e um simulador para testes/demo.

Cada fonte produz objetos `Frame`, um retrato normalizado do estado do carro do
jogador. O resto do app só conhece `Frame`, então dá pra plugar outros jogos
depois (iRacing, LMU...) escrevendo uma nova fonte.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from typing import Iterator, Optional


@dataclass
class Frame:
    t: float                    # relógio da fonte, em segundos
    status: str                 # "live" | "pause" | "replay" | "off"
    session_type: str
    session_index: int
    track: str
    car: str
    player: str
    completed_laps: int
    current_time_ms: int        # tempo da volta atual
    last_time_ms: int           # tempo da última volta completa
    best_time_ms: int
    sector_index: int
    last_sector_ms: int
    norm_pos: float             # 0..1 ao longo da pista
    is_valid_lap: bool
    in_pit_lane: bool
    in_pit: bool
    fuel: float
    speed: float                # km/h
    gas: float                  # 0..1
    brake: float                # 0..1
    steer: float                # -1..1
    gear: int                   # 0 = R, 1 = N, 2 = 1ª ... (padrão ACC)
    rpm: int
    x: float
    z: float
    tyre_temp: tuple = (0.0, 0.0, 0.0, 0.0)      # FL FR RL RR (°C)
    tyre_press: tuple = (0.0, 0.0, 0.0, 0.0)     # psi
    air_temp: float = 0.0
    road_temp: float = 0.0
    grip: str = ""
    wall: float = 0.0           # hora do PC (epoch) — usada para sincronizar com o vídeo
    # dados de equilíbrio do carro (FL, FR, RL, RR)
    slip_angle: tuple = (0.0, 0.0, 0.0, 0.0)   # ângulo de deriva de cada pneu
    slip_ratio: tuple = (0.0, 0.0, 0.0, 0.0)   # < 0 travando, > 0 patinando
    g_lat: float = 0.0
    brake_temp: tuple = (0.0, 0.0, 0.0, 0.0)   # °C
    susp: tuple = (0.0, 0.0, 0.0, 0.0)         # curso da suspensão (m)
    session_time_left: float = -1.0            # ms até a bandeirada (-1 = desconhecido)
    game: str = "acc"
    cut_penalty: bool = False                  # o jogo deu penalidade por cortar a pista
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# ACC ao vivo
# ---------------------------------------------------------------------------

class ACCSource:
    """Lê a shared memory do Assetto Corsa Competizione (só Windows)."""

    name = "acc"

    def __init__(self, hz: float = 60.0):
        self.hz = hz
        self._asm = None

    def _open(self):
        from pyaccsharedmemory import accSharedMemory  # import tardio: só existe no Windows
        self._asm = accSharedMemory()

    def frames(self) -> Iterator[Optional[Frame]]:
        """Gera frames para sempre. Gera None quando não há dado novo (jogo
        fechado, pausado ou no menu), para o gravador saber que está ocioso."""
        period = 1.0 / self.hz
        idle = 0
        while True:
            if self._asm is None:
                try:
                    self._open()
                except Exception:
                    yield None
                    time.sleep(2)
                    continue
            try:
                sm = self._asm.read_shared_memory()
            except Exception:
                sm = None
            if sm is None:
                # sem dado novo: jogo fechado, no menu ou pausado. Depois de ~2 s
                # parado, consulta só 2x por segundo para quase não usar CPU.
                idle += 1
                yield None
                time.sleep(period if idle < 120 else 0.5)
                continue
            idle = 0
            yield self._to_frame(sm)
            time.sleep(period)

    @staticmethod
    def _to_frame(sm) -> Frame:
        p, g, s = sm.Physics, sm.Graphics, sm.Static
        status = {0: "off", 1: "replay", 2: "live", 3: "pause"}.get(g.status.value, "off")
        # posição x/z do carro do jogador
        x = z = 0.0
        try:
            idx = list(g.car_id).index(g.player_car_id)
            x, z = g.car_coordinates[idx].x, g.car_coordinates[idx].z
        except (ValueError, IndexError):
            pass
        w = lambda wh: (wh.front_left, wh.front_right, wh.rear_left, wh.rear_right)
        clean = lambda v: str(v or "").split("\x00")[0].strip()
        player = " ".join(n for n in (clean(s.player_name), clean(s.player_surname)) if n) or clean(s.player_nick)
        return Frame(
            t=time.monotonic(),
            wall=time.time(),
            status=status,
            session_type=g.session_type.name.replace("ACC_", "").title(),
            session_index=g.session_index,
            track=clean(s.track),
            car=clean(s.car_model),
            player=player,
            completed_laps=g.completed_lap,
            current_time_ms=g.current_time,
            last_time_ms=g.last_time,
            best_time_ms=g.best_time,
            sector_index=g.current_sector_index,
            last_sector_ms=g.last_sector_time,
            norm_pos=g.normalized_car_position,
            is_valid_lap=bool(g.is_valid_lap),
            cut_penalty="Cutting" in getattr(g.penalty, "name", ""),
            in_pit_lane=bool(g.is_in_pit_lane),
            in_pit=bool(g.is_in_pit),
            fuel=p.fuel,
            speed=p.speed_kmh,
            gas=p.gas,
            brake=p.brake,
            steer=p.steer_angle,
            gear=p.gear,
            rpm=p.rpm,
            x=x,
            z=z,
            tyre_temp=w(p.tyre_core_temp),
            tyre_press=w(p.wheel_pressure),
            slip_angle=w(p.slip_angle),
            slip_ratio=w(p.slip_ratio),
            g_lat=p.g_force.x,
            brake_temp=w(p.brake_temp),
            susp=w(p.suspension_travel),
            air_temp=p.air_temp,
            road_temp=p.road_temp,
            grip=getattr(g.track_grip_status, "name", "").replace("ACC_", "").title(),
            session_time_left=float(g.session_time_left or -1),
        )


# ---------------------------------------------------------------------------
# iRacing
# ---------------------------------------------------------------------------

class IRacingSource:
    """Lê a telemetria do iRacing (SDK oficial, via pyirsdk; só Windows).

    O iRacing não informa a posição x/z do carro ao vivo, então o traçado é
    reconstruído integrando a velocidade e a direção (yaw). Funciona bem para o
    mapa e as comparações; pode ter um pequeno desvio acumulado ao longo da volta.
    Ângulo de deriva por pneu também não existe ao vivo: o engenheiro de setup
    fica limitado no iRacing.
    """

    name = "iracing"

    def __init__(self, hz: float = 60.0):
        self.hz = hz
        self.ir = None
        self._x = self._z = 0.0
        self._last_t = None
        self._incidents = None
        self._lap_incident = False
        self._lap_seen = None

    def _ensure(self) -> bool:
        if self.ir is None:
            try:
                import irsdk
            except ImportError:
                return False
            self.ir = irsdk.IRSDK()
        if self.ir.is_initialized and self.ir.is_connected:
            return True
        if self.ir.is_initialized:
            self.ir.shutdown()
        try:
            return bool(self.ir.startup())
        except Exception:  # noqa: BLE001
            return False

    def frames(self) -> Iterator[Optional[Frame]]:
        period = 1.0 / self.hz
        while True:
            if not self._ensure():
                yield None
                time.sleep(3)
                continue
            try:
                self.ir.freeze_var_buffer_latest()
                f = self._to_frame()
            except Exception:  # noqa: BLE001
                f = None
            yield f
            time.sleep(period if f is not None else 0.5)

    def _to_frame(self) -> Optional[Frame]:
        ir = self.ir
        if not ir["IsOnTrack"] and not ir["IsReplayPlaying"]:
            return Frame(t=time.monotonic(), status="off", session_type="", session_index=0, track="", car="",
                         player="", completed_laps=0, current_time_ms=0, last_time_ms=0, best_time_ms=0,
                         sector_index=0, last_sector_ms=0, norm_pos=0, is_valid_lap=True, in_pit_lane=False,
                         in_pit=False, fuel=0, speed=0, gas=0, brake=0, steer=0, gear=1, rpm=0, x=0, z=0,
                         game="iracing")
        wk = ir["WeekendInfo"] or {}
        di = ir["DriverInfo"] or {}
        me = di.get("DriverCarIdx", 0)
        drivers = di.get("Drivers") or []
        car = next((d.get("CarPath") for d in drivers if d.get("CarIdx") == me), "") or ""
        player = next((d.get("UserName") for d in drivers if d.get("CarIdx") == me), "") or ""
        sessions = (ir["SessionInfo"] or {}).get("Sessions") or []
        snum = ir["SessionNum"] or 0
        stype = next((x.get("SessionType") for x in sessions if x.get("SessionNum") == snum), "") or ""
        now = time.monotonic()
        speed_ms = ir["Speed"] or 0.0
        yaw = ir["Yaw"] or 0.0
        if self._last_t is not None:
            dt = min(0.2, now - self._last_t)
            self._x += speed_ms * math.cos(yaw) * dt
            self._z += speed_ms * math.sin(yaw) * dt
        self._last_t = now
        lap = ir["Lap"] or 0
        inc = ir["PlayerCarMyIncidentCount"] or 0
        if self._lap_seen != lap:                     # volta nova: zera a marcação de incidente
            self._lap_seen, self._lap_incident = lap, False
        if self._incidents is not None and inc > self._incidents:
            self._lap_incident = True                 # incidente (ex.: 1x fora da pista) invalida a volta
        self._incidents = inc
        pct = max(0.0, min(1.0, ir["LapDistPct"] or 0.0))
        surf = ir["PlayerTrackSurface"]
        tl = ir["SessionTimeRemain"]
        return Frame(
            t=now, wall=time.time(), status="replay" if ir["IsReplayPlaying"] else "live",
            session_type=str(stype).title(), session_index=int(snum), track=str(wk.get("TrackName") or ""),
            car=str(car), player=str(player), completed_laps=int(ir["LapCompleted"] or 0),
            current_time_ms=int((ir["LapCurrentLapTime"] or 0) * 1000),
            last_time_ms=int(max(0.0, ir["LapLastLapTime"] or 0) * 1000),
            best_time_ms=int(max(0.0, ir["LapBestLapTime"] or 0) * 1000),
            sector_index=min(2, int(pct * 3)), last_sector_ms=0, norm_pos=pct,
            is_valid_lap=not self._lap_incident, in_pit_lane=bool(ir["OnPitRoad"]), in_pit=surf == 1,
            fuel=float(ir["FuelLevel"] or 0), speed=speed_ms * 3.6, gas=float(ir["Throttle"] or 0),
            brake=float(ir["Brake"] or 0), steer=max(-1.0, min(1.0, (ir["SteeringWheelAngle"] or 0) / 3.0)),
            gear=int(ir["Gear"] or 0) + 1, rpm=int(ir["RPM"] or 0), x=self._x, z=self._z,
            air_temp=float(ir["AirTemp"] or 0), road_temp=float(ir["TrackTempCrew"] or ir["TrackTemp"] or 0),
            g_lat=float(ir["LatAccel"] or 0) / 9.81,
            session_time_left=float(tl) * 1000 if tl and tl > 0 else -1.0, game="iracing",
        )


class AutoSource:
    """Detecta sozinho qual jogo está rodando (ACC ou iRacing) e lê dele."""

    name = "auto"

    def __init__(self, sources):
        self.sources = sources

    def frames(self) -> Iterator[Optional[Frame]]:
        gens = [s.frames() for s in self.sources]
        active = None
        idle_since = None
        while True:
            if active is not None:
                f = next(gens[active])
                if f is not None and f.status != "off":
                    idle_since = None
                    yield f
                    continue
                idle_since = idle_since or time.monotonic()
                yield f
                if time.monotonic() - idle_since < 10:
                    continue
                active = None                         # parado há 10 s: volta a procurar
            for k, g in enumerate(gens):
                f = next(g)
                if f is not None and f.status != "off":
                    active, idle_since = k, None
                    yield f
                    break
            else:
                yield None


# ---------------------------------------------------------------------------
# Simulador (modo demo)
# ---------------------------------------------------------------------------

class _DemoTrack:
    """Pista fictícia: um circuito fechado com retas e curvas de raios variados."""

    def __init__(self, n: int = 2000, variant: int = 0):
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            if variant == 1:   # segunda pista: mais travada
                r = 700 + 180 * math.sin(3 * a + 1.1) + 120 * math.sin(7 * a) + 50 * math.sin(11 * a + 0.4)
                pts.append((r * math.cos(a), r * 0.7 * math.sin(a)))
                continue
            r = 900 + 260 * math.sin(2 * a) + 140 * math.sin(5 * a + 0.6) + 60 * math.sin(9 * a)
            pts.append((r * math.cos(a), r * 0.55 * math.sin(a)))
        self.pts = pts
        seg = [math.dist(pts[i], pts[(i + 1) % n]) for i in range(n)]
        self.length = sum(seg)
        # curvatura -> velocidade alvo
        curv = []
        for i in range(n):
            ax, az = pts[i - 1]
            bx, bz = pts[i]
            cx, cz = pts[(i + 1) % n]
            h1 = math.atan2(bz - az, bx - ax)
            h2 = math.atan2(cz - bz, cx - bx)
            d = (h2 - h1 + math.pi) % (2 * math.pi) - math.pi
            curv.append(abs(d) / max(seg[i], 1e-6))
        k = 25
        curv = [sum(curv[(i + j) % n] for j in range(-k, k + 1)) / (2 * k + 1) for i in range(n)]
        vmax, lat = 285.0, 2.6 * 9.81
        target = [min(vmax, math.sqrt(lat / max(c, 1e-5)) * 3.6) for c in curv]
        # limita aceleração/frenagem (passadas para frente e para trás)
        acc, dec = 6.5, 15.0
        ds = self.length / n
        v = target[:]
        for _ in range(2):
            for i in range(1, n * 2):
                a, b = (i - 1) % n, i % n
                v[b] = min(v[b], math.sqrt((v[a] / 3.6) ** 2 + 2 * acc * ds) * 3.6)
            for i in range(n * 2, 0, -1):
                a, b = i % n, (i - 1) % n
                v[b] = min(v[b], math.sqrt((v[a] / 3.6) ** 2 + 2 * dec * ds) * 3.6)
        self.speed = v
        self.curv_sign = []
        for i in range(n):
            ax, az = pts[i - 1]
            bx, bz = pts[i]
            cx, cz = pts[(i + 1) % n]
            cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
            self.curv_sign.append(1 if cross > 0 else -1)
        self.curv = curv
        self.normals = []
        for i in range(n):
            ax, az = pts[i - 1]
            cx, cz = pts[(i + 1) % n]
            dx, dz = cx - ax, cz - az
            ln = math.hypot(dx, dz) or 1.0
            self.normals.append((-dz / ln, dx / ln))

    def at(self, d: float):
        n = len(self.pts)
        f = (d % 1.0) * n
        i = int(f)
        j = (i + 1) % n
        u = f - i
        lerp = lambda a, b: a + (b - a) * u
        x = lerp(self.pts[i][0], self.pts[j][0])
        z = lerp(self.pts[i][1], self.pts[j][1])
        return x, z, lerp(self.speed[i], self.speed[j]), i


class DemoSource:
    """Simula um piloto dando voltas, com variação entre voltas, consumo de
    combustível, um pit stop e uma volta inválida. `speed` acelera o tempo."""

    name = "demo"

    def __init__(self, laps: int = 8, speed: float = 1.0, hz: float = 30.0, seed: int = 7,
                 track: str = "demo_ring", car: str = "mclaren_720s_gt3_evo",
                 session_type: str = "Practice", session_index: int = 0, realtime: bool = True,
                 pit_after: int = 4):
        self.laps, self.speed, self.hz = laps, speed, hz
        self.rng = random.Random(seed)
        self.track = _DemoTrack(variant=1 if track == "demo_park" else 0)
        self.track_name, self.car = track, car
        self.session_type, self.session_index = session_type, session_index
        self.realtime = realtime
        self.pit_after = pit_after

    def frames(self) -> Iterator[Optional[Frame]]:
        tr = self.track
        dt = 1.0 / self.hz
        fuel = 62.0
        best = 0
        last = 0
        t = 0.0
        sector_marks = (1 / 3, 2 / 3)
        last_sector_ms = 0
        # começa no box, logo depois da linha de chegada
        d = 0.02
        in_pit_lane = True
        pitted = False
        completed = 0
        lap_ms = 0.0
        pace = 1.0
        invalid = False
        n_pts = len(tr.speed)

        def new_style():
            """Estilo de pilotagem da volta: variações suaves de ritmo, frenagem e traçado."""
            ph = [self.rng.uniform(0, 2 * math.pi) for _ in range(6)]
            amp = [self.rng.uniform(0.004, 0.012) for _ in range(3)]
            return {
                "pace": lambda i: 1 + sum(a * math.sin(k * 2 * math.pi * i / n_pts + p)
                                          for a, k, p in zip(amp, (3, 7, 11), ph[:3])),
                "line": lambda i: 1.6 * math.sin(5 * 2 * math.pi * i / n_pts + ph[3])
                                  + 0.8 * math.sin(13 * 2 * math.pi * i / n_pts + ph[4]),
                "look": self.rng.randint(8, 18),
                "lift": self.rng.choice([0, 0, 3, 6, 10]),
            }
        style = new_style()
        inval_at = None          # onde a volta vai ser invalidada (None = volta limpa)
        spin_at = None           # onde vai acontecer uma rodada
        spin_left = 0.0
        lock_corner = None       # trecho da volta onde vai travar a roda
        stint_laps = 0           # voltas no stint atual (o pneu esquenta aos poucos)
        tyre = [70.0] * 4
        wall0 = time.time()
        while completed < self.laps:
            x, z, vt, i = tr.at(d)
            off = style["line"](i)
            x, z = x + tr.normals[i][0] * off, z + tr.normals[i][1] * off
            if in_pit_lane:
                v = min(vt, 80.0)
            else:
                v = vt * pace * style["pace"](i)
            if spin_at is not None and spin_at <= d < spin_at + 0.002 and spin_left <= 0:
                spin_left = 3.0
                spin_at = None
            if spin_left > 0:                      # rodada: perde muita velocidade por ~3 s
                v = max(35.0, v * 0.35)
                spin_left -= dt
            # entrada
            prev_d = d
            ds = (v / 3.6) * dt
            d = (d + ds / tr.length) % 1.0
            lap_ms += dt * 1000
            t += dt
            crossed = prev_d > 0.9 and d < 0.1
            # setor
            sector = 0 if d < sector_marks[0] else (1 if d < sector_marks[1] else 2)
            prev_sector = 0 if prev_d < sector_marks[0] else (1 if prev_d < sector_marks[1] else 2)
            if sector != prev_sector and not crossed:
                last_sector_ms = int(lap_ms)
            fuel -= v * dt * 0.00015   # ~3 L por volta
            if inval_at is not None and d >= inval_at and d > 0.05:
                invalid = True
            # entradas do piloto
            nxt = tr.speed[(i + style["look"]) % len(tr.speed)]
            braking = nxt < vt - 8 and not in_pit_lane
            # tira o pé um pouco antes de frear (o famoso "sem pedal")
            far = tr.speed[(i + style["look"] + style["lift"]) % len(tr.speed)]
            coasting = not braking and not in_pit_lane and far < vt - 8
            gas = 0.0 if (braking or coasting) else min(1.0, 0.35 + (vt / 285) * 0.7)
            brake = min(1.0, (vt - nxt) / 60) if braking else 0.0
            steer = max(-1, min(1, tr.curv[i] * tr.curv_sign[i] * 140))
            gear = 2 + min(5, int(v / 48))
            rpm = int(4000 + (v % 48) / 48 * 3400)
            for k in range(4):
                tyre[k] += ((82 + (4 if k < 2 else 0) + stint_laps * 0.6) - tyre[k]) * 0.0005
            # equilíbrio simulado: carro com subesterço em curva lenta, traseira solta
            # na frenagem e um pouco de patinagem na saída de curvas lentas
            g_lat = ((v / 3.6) ** 2 * tr.curv[i] / 9.81) * tr.curv_sign[i]
            if braking:
                bal = -0.14
            elif v < 150:
                bal = 0.2 if gas < 0.8 else 0.08
            else:
                bal = 0.06
            base = 0.012 + 0.018 * abs(g_lat)
            jit = lambda: self.rng.uniform(0.95, 1.05)
            saf, sar = base * (1 + bal) * jit(), base * (1 - bal) * jit()
            lock = brake > 0.5 and lock_corner is not None and abs(d - lock_corner) < 0.02
            spin = gas > 0.8 and v < 140 and abs(g_lat) > 0.6 and self.rng.random() < 0.25
            srf = -0.03 * brake - (0.35 if lock else 0.0)
            srr = (0.18 if spin else 0.02 * gas) - 0.02 * brake
            if crossed:
                completed += 1
                last = int(lap_ms)
                if not invalid and not in_pit_lane and (best == 0 or last < best):
                    best = last
                lap_ms = 0.0
                last_sector_ms = last
                pace = 1.0 + self.rng.uniform(-0.012, 0.02)
                style = new_style()
                invalid = False
                inval_at = self.rng.uniform(0.1, 0.9) if self.rng.random() < 0.15 else None
                spin_at = self.rng.uniform(0.2, 0.9) if self.rng.random() < 0.08 else None
                lock_corner = self.rng.uniform(0.05, 0.95) if self.rng.random() < 0.4 else None
                stint_laps += 1
                if in_pit_lane and not pitted and completed >= self.pit_after:
                    # parada: reabastece e perde ~25 s parado
                    fuel = 62.0
                    stint_laps = 0
                    tyre = [70.0] * 4
                    lap_ms += 25000
                    t += 25
                    pitted = True
            # entra no pit lane no fim da volta `pit_after`
            if (not in_pit_lane and not pitted and completed == self.pit_after - 1
                    and d > 0.92):
                in_pit_lane = True
            # sai do pit lane logo depois da linha
            if in_pit_lane and 0.08 < d < 0.5:
                in_pit_lane = False
            yield Frame(
                t=t, status="live", session_type=self.session_type, session_index=self.session_index,
                track=self.track_name, car=self.car, player="Piloto Demo",
                completed_laps=completed, current_time_ms=int(lap_ms), last_time_ms=last,
                best_time_ms=best, sector_index=sector, last_sector_ms=last_sector_ms,
                norm_pos=d, is_valid_lap=not invalid, in_pit_lane=in_pit_lane, in_pit=False,
                fuel=max(fuel, 0), speed=v, gas=gas, brake=brake, steer=steer, gear=gear, rpm=rpm,
                x=x, z=z, tyre_temp=tuple(round(v_, 1) for v_ in tyre),
                tyre_press=tuple(round(25.4 + (tyre[k] - 70) * 0.13 + (0.1 if k < 2 else 0), 2) for k in range(4)),
                air_temp=22, road_temp=29, grip="Optimum",
                wall=time.time() if self.realtime else wall0 + t,
                slip_angle=(saf, saf, sar, sar), slip_ratio=(srf, srf * 0.9, srr, srr),
                g_lat=g_lat, brake_temp=(560, 555, 420, 418), susp=(0.04, 0.04, 0.05, 0.05),
                session_time_left=max(0.0, 20 * 60_000 - t * 1000) if self.session_type == "Race" else -1.0,
            )
            if self.realtime:
                time.sleep(dt / self.speed)
        # fim da sessão
        yield Frame(
            t=t, status="off", session_type=self.session_type, session_index=self.session_index,
            track=self.track_name, car=self.car, player="Piloto Demo", completed_laps=completed,
            current_time_ms=0, last_time_ms=last, best_time_ms=best, sector_index=0, last_sector_ms=0,
            norm_pos=0, is_valid_lap=True, in_pit_lane=False, in_pit=False, fuel=fuel, speed=0,
            gas=0, brake=0, steer=0, gear=1, rpm=0, x=0, z=0,
        )
