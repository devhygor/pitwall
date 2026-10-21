"""Avisos proativos do engenheiro: olha o jogo e fala sozinho quando algo importa.

Cada aviso tem categoria (liga/desliga nas configurações), prioridade (5 = observador, interrompe tudo;
4 = bandeiras/penalidades; 3 = crítico; 2 = normal; 1 = informação), validade (se passou da hora, não fala)
e um intervalo mínimo para não repetir. O nível de conversa (pouco/normal/muito) escala os intervalos.
"""
from __future__ import annotations

import time

from . import phrases
from .fmt import gap_say, laptime, minutes_say, seg
from .state import session_label

CATEGORIES = [
    ("spotter", "Observador (carros ao lado)"), ("flags", "Bandeiras"), ("track_limits", "Limites da pista"),
    ("penalties", "Penalidades"), ("fuel", "Combustível"), ("tyres", "Pneus"), ("brakes", "Freios"),
    ("gaps", "Carros perto (frente e trás)"), ("positions", "Ultrapassagens e posição"), ("laps", "Tempos de volta"),
    ("session", "Tempo e voltas restantes"), ("weather", "Clima e aderência"), ("pit", "Box"),
    ("incidents", "Rodadas e incidentes"), ("humor", "Humor, dicas e broncas (veja Personalidade)"), ("info", "Boas-vindas e informações"),
]
DEFAULT_EVENTS = {k: True for k, _ in CATEGORIES}

# aviso -> evento de humor (ver humor.py)
MOOD_EVENTS = {"lap_invalid": "invalid", "track_limits": "invalid", "cut_penalty": "penalty", "penalty": "penalty", "spin": "spin",
               "lost": "lost", "gained": "gained", "lap_pb": "pb", "lap_best": "best", "lap_slow": "slow", "tyre_hot": "tyre_hot",
               "brake_hot": "brake_hot", "fuel_crit": "fuel", "fuel_low": "fuel", "fuel_short": "fuel", "behind_close": "pressure",
               "defend": "pressure", "behind_drop": "gap_good", "rain_start": "rain", "pit_in": "pit", "race_start": "start",
               "chequered": "finish"}

WHERE4 = ["dianteiro esquerdo", "dianteiro direito", "traseiro esquerdo", "traseiro direito"]


def _where(idx: list[int]) -> str:
    s = set(idx)
    if s == {0, 1, 2, 3}:
        return "todos"
    if s == {0, 1}:
        return "dianteiros"
    if s == {2, 3}:
        return "traseiros"
    if s == {0, 2}:
        return "da esquerda"
    if s == {1, 3}:
        return "da direita"
    return " e ".join(WHERE4[i] for i in sorted(s))


class Monitor:
    def __init__(self, eng):
        self.eng = eng
        self._cool: dict[str, float] = {}
        self._reset_session()

    def _reset_session(self):
        mood = getattr(self.eng, "mood", None)
        if mood is not None:
            mood.reset()
        self.greeted = False
        self.live_since = None
        self.prev = None
        self.lap_wait = None
        self.prev_best = None
        self.lap_pit = False
        self.invalid_streak = 0
        self.yellow_prev = [False, False, False]
        self.flag_prev: dict = {}
        self.pos_prev = None
        self.pos_cand = None
        self.fuel_said: set = set()
        self.time_said: set = set()
        self.laps_said: set = set()
        self.rain_prev = None
        self.grip_prev = ""
        self.pit_prev = False
        self.tyre_state = ""
        self.wear_said = 0
        self.speed_hist: list = []
        self.gap_ahead_id = None
        self.fuel_short_at = 0.0
        self.last_eval = 0.0
        self.race_started = False
        self.gap_due = False
        self.best_seen = None
        self.pit_seen: dict = {}

    # ---- infraestrutura ---------------------------------------------------------------------
    def _on(self, cat) -> bool:
        ev = self.eng.settings.get("eng_events") if self.eng.settings else None
        return bool((ev or DEFAULT_EVENTS).get(cat, True))

    def _mult(self) -> float:
        return {"pouco": 2.0, "normal": 1.0, "muito": 0.5}.get(self.eng.settings.get("eng_verbosity") if self.eng.settings else "normal", 1.0)

    def emit(self, cat, key, text, prio=2, ttl=12.0, cool=0.0, tag=None):
        if not self._on(cat):
            return False
        now = time.monotonic()
        tag = tag or key
        if now < self._cool.get(tag, 0.0):
            return False
        self._cool[tag] = now + cool * self._mult()
        self.eng.say(text, prio=prio, ttl=ttl, cat=cat, key=tag)
        ev = MOOD_EVENTS.get(key)
        mood = getattr(self.eng, "mood", None)
        if ev and mood is not None:
            if ev == "finish":
                me = self.eng.state.me
                ev = "finish_good" if (me and me.get("pos", 99) <= 3) or mood.score > 0.3 else "finish_bad"
            mood.react(ev)
        return True

    # ---- laço principal ---------------------------------------------------------------------
    def update(self, st):
        f = st.f
        if f is None:
            return
        if st.session_key != getattr(self, "_skey", None):
            self._skey = st.session_key
            self._reset_session()
        if f.status != "live":
            self.live_since = None
            return
        now = time.monotonic()
        if self.live_since is None:
            self.live_since = now
        prev = self.prev
        self.prev = f
        if prev is None:
            return
        self._greet(st, f, now)
        self._flags(f)
        self._track_limits(st, f, prev)
        self._laps(st, f, prev, now)
        self._pit(f)
        self._incident(f, now)
        if now - self.last_eval >= 1.0:            # o resto não precisa de 60 vezes por segundo
            self.last_eval = now
            self._fuel(st, f)
            self._tyres(st, f)
            self._gaps(st, f)
            self._positions(st, f, now)
            self._session(st, f)
            self._others_best(st)
            self.eng.mood.spontaneous()
            self._weather(f)

    # ---- partes ------------------------------------------------------------------------------
    def _greet(self, st, f, now):
        if self.greeted or now - self.live_since < 4.0 or not f.track:
            return
        self.greeted = True
        from .answers import _pretty
        self.emit("info", "greet", phrases.say("greet", track=_pretty(f.track), car=_pretty(f.car), session=session_label(f.session_type)),
                  prio=1, ttl=20, tag="greet")

    def _flags(self, f):
        fl = f.flags or {}
        y = list(fl.get("yellow") or [False] * 3)
        y += [False] * (3 - len(y))
        old = self.yellow_prev
        new = [i for i, v in enumerate(y) if v and not old[i]]
        if any(y) and not any(old) and all(y):
            self.emit("flags", "yellow", phrases.say("yellow_all"), prio=4, ttl=6, cool=20, tag="yellow")
        elif new:
            if len(new) == 1:
                self.emit("flags", "yellow", phrases.say("yellow", s=new[0] + 1), prio=4, ttl=6, tag="yellow")
            else:
                self.emit("flags", "yellow", "Bandeira amarela nos setores " + " e ".join(str(i + 1) for i in new) + ".", prio=4, ttl=6, tag="yellow")
        elif not any(y) and any(old):
            self.emit("flags", "yellow_end", phrases.say("yellow_end"), prio=3, ttl=8, cool=15)
        self.yellow_prev = y
        for k, key, prio, cool in (("blue", "blue", 4, 25), ("red", "red", 4, 10), ("black", "black", 4, 20),
                                   ("white", "white", 3, 60), ("chequered", "chequered", 4, 30)):
            if fl.get(k) and not self.flag_prev.get(k):
                self.emit("flags", key, phrases.say(key), prio=prio, ttl=8, cool=cool)
            self.flag_prev[k] = bool(fl.get(k))
        if fl.get("green") and not self.flag_prev.get("green") and not self.race_started:
            self.race_started = True
            if (f.session_type or "").lower().startswith("race") and f.completed_laps == 0:
                self.emit("session", "race_start", phrases.say("race_start"), prio=3, ttl=8, cool=120)
        self.flag_prev["green"] = bool(fl.get("green"))

    def _track_limits(self, st, f, prev):
        if prev.is_valid_lap and not f.is_valid_lap and not f.in_pit_lane:
            self.invalid_streak += 1
            key = "lap_invalid" if self.invalid_streak == 1 or self.invalid_streak % 2 else "track_limits"
            self.emit("track_limits", key, phrases.say(key), prio=3, ttl=8, cool=8, tag="invalid")
        if f.cut_penalty and not prev.cut_penalty:
            self.emit("penalties", "cut_penalty", phrases.say("cut_penalty"), prio=4, ttl=10, cool=20)
        elif (f.flags or {}).get("penalty") and not (prev.flags or {}).get("penalty"):
            self.emit("penalties", "penalty", phrases.say("penalty"), prio=4, ttl=10, cool=20)

    def _laps(self, st, f, prev, now):
        if f.in_pit_lane:
            self.lap_pit = True
        if f.completed_laps == prev.completed_laps + 1:
            self.lap_wait = (now, prev.last_time_ms, prev.best_time_ms, self.lap_pit, prev.is_valid_lap)
            if f.is_valid_lap:
                self.invalid_streak = 0
            if st.race and f.completed_laps % 3 == 0:
                self.gap_due = True
            self.lap_pit = f.in_pit_lane
        w = self.lap_wait
        if not w:
            return
        t0, last_before, best_before, had_pit, was_valid = w
        if f.last_time_ms and f.last_time_ms != last_before and f.last_time_ms > 0:
            self.lap_wait = None
            if had_pit:
                return
            lt = f.last_time_ms
            if not was_valid and f.last_time_ms == last_before:
                return
            best_all = [r["best_ms"] for r in st.rows if r.get("best_ms")]
            if st.rows and best_all and lt <= min(best_all) and (not best_before or lt < best_before) and was_valid:
                self.emit("laps", "lap_best", phrases.say("lap_best", time=laptime(lt)), prio=2, ttl=20, cool=0)
            elif was_valid and (not best_before or lt < best_before):
                self.emit("laps", "lap_pb", phrases.say("lap_pb", time=laptime(lt)), prio=2, ttl=20, cool=0)
            elif was_valid and f.best_time_ms:
                d = (lt - f.best_time_ms) / 1000.0
                key = "lap_slow" if d > 0.5 else "lap_fast"
                if st.race and (self.eng.settings.get("eng_verbosity") or "normal") != "muito":
                    return                                  # em corrida só recorde pessoal e melhor volta (não fica falando toda volta)
                self.emit("laps", key, phrases.say(key, time=laptime(lt), gap=seg(abs(d))), prio=1, ttl=20, cool=0, tag="laptime")
            elif not was_valid:
                self.emit("laps", "lap_time", f"Volta invalidada de {laptime(lt)}.", prio=1, ttl=15, tag="laptime")
        elif now - t0 > 4.0:
            self.lap_wait = None

    def _pit(self, f):
        if f.in_pit_lane and not self.pit_prev:
            self.emit("pit", "pit_in", phrases.say("pit_in"), prio=2, ttl=6, cool=20)
        elif not f.in_pit_lane and self.pit_prev:
            self.emit("pit", "pit_out", phrases.say("pit_out"), prio=2, ttl=8, cool=20)
        self.pit_prev = f.in_pit_lane

    def _incident(self, f, now):
        self.speed_hist = [(t, v) for t, v in self.speed_hist if now - t <= 2.5] + [(now, f.speed)]
        vmax = max(v for _, v in self.speed_hist)
        if vmax > 110 and f.speed < 15 and not f.in_pit_lane and not f.in_pit:
            self.emit("incidents", "spin", phrases.say("spin"), prio=3, ttl=8, cool=45)

    def _fuel(self, st, f):
        fl = st.fuel_laps()
        if fl is None or f.in_pit_lane:
            return
        if fl > 4.5:
            self.fuel_said.clear()
        for thr, key, prio in ((1.5, "fuel_crit", 3), (3.0, "fuel_low", 3)):
            if fl <= thr and key not in self.fuel_said:
                self.fuel_said.add(key)
                if key == "fuel_crit":
                    self.fuel_said.add("fuel_low")
                    self.emit("fuel", key, phrases.say(key), prio=prio, ttl=10, cool=0, tag="fuel_c")
                else:
                    self.emit("fuel", key, phrases.say(key, laps=int(fl) if fl >= 2 else 1), prio=prio, ttl=12, cool=0, tag="fuel_l")
                break
        miss = st.fuel_missing()
        n = st.laps_to_go()
        if miss is not None and n is not None and miss > 0.5 and n < 12 and time.monotonic() - self.fuel_short_at > 240:
            self.fuel_short_at = time.monotonic()
            self.emit("fuel", "fuel_short", phrases.say("fuel_short", liters=int(round(miss))), prio=2, ttl=15, cool=0, tag="fuel_s")

    def _tyres(self, st, f):
        if f.in_pit_lane or f.speed < 60:
            return
        ov = ((self.eng.settings.get("overlays") or {}).get("tyres", {})) if self.eng.settings else {}
        tmin, tmax, pmin, pmax = ov.get("tmin", 70), ov.get("tmax", 100), ov.get("pmin", 26.0), ov.get("pmax", 27.0)
        bmax = ov.get("bmax", 800)
        t = list(f.tyre_temp or ())
        if len(t) == 4 and any(t):
            hot = [i for i, v in enumerate(t) if v > tmax + 4]
            if hot:
                self.emit("tyres", "tyre_hot", phrases.say("tyre_hot", where=_where(hot), t=int(max(t[i] for i in hot))), prio=2, ttl=15, cool=150, tag="tyre_hot")
            avg = sum(t) / 4
            if avg < tmin - 8 and f.completed_laps >= 0 and self.tyre_state != "cold" and f.speed > 80:
                self.tyre_state = "cold"
                self.emit("tyres", "tyre_cold", phrases.say("tyre_cold", where="todos"), prio=1, ttl=15, cool=240, tag="tyre_cold")
            elif tmin <= avg <= tmax and self.tyre_state == "cold":
                self.tyre_state = "ok"
                self.emit("tyres", "tyre_ok", phrases.say("tyre_ok"), prio=1, ttl=15, cool=60, tag="tyre_ok")
            elif avg >= tmin and self.tyre_state == "":
                self.tyre_state = "ok"
        p = list(f.tyre_press or ())
        if len(p) == 4 and any(p) and not any(v < tmin for v in t[:1] if t) and sum(t) / 4 >= tmin:
            hi = [i for i, v in enumerate(p) if v > pmax + 0.8]
            lo = [i for i, v in enumerate(p) if 0 < v < pmin - 0.8]
            if hi:
                self.emit("tyres", "press_high", phrases.say("press_high", where=_where(hi), p=f"{max(p[i] for i in hi):.1f}".replace(".", ",")), prio=1, ttl=15, cool=300, tag="press_h")
            if lo:
                self.emit("tyres", "press_low", phrases.say("press_low", where=_where(lo), p=f"{min(p[i] for i in lo):.1f}".replace(".", ",")), prio=1, ttl=15, cool=300, tag="press_l")
        w = [x for x in (f.tyre_wear or ()) if x]
        if w:
            wmax = max(w)
            step = int(wmax * 10)
            if wmax >= 0.9 and self.wear_said < 9:
                self.wear_said = 9
                self.emit("tyres", "tyre_worn", phrases.say("tyre_worn"), prio=2, ttl=15, tag="wear")
            elif step >= 5 and step > self.wear_said and wmax < 0.9:
                self.wear_said = step
                self.emit("tyres", "tyre_wear", phrases.say("tyre_wear", pct=step * 10), prio=1, ttl=15, tag="wear")
        b = list(f.brake_temp or ())
        if len(b) == 4 and any(b):
            hot = [i for i, v in enumerate(b) if v > bmax + 60]
            if hot:
                self.emit("brakes", "brake_hot", phrases.say("brake_hot", where=_where(hot), t=int(max(b[i] for i in hot))), prio=2, ttl=12, cool=150, tag="brake_hot")
        pads = [x for x in (f.pad_life or ()) if x]
        if pads and min(pads) < 2.5:
            self.emit("brakes", "pads_low", phrases.say("pads_low"), prio=2, ttl=15, cool=400, tag="pads")

    def _gaps(self, st, f):
        me = st.me
        if not me or f.in_pit_lane:
            return
        race = st.race
        b, a = st.behind, st.ahead
        if self.gap_due and (a or b):
            self.gap_due = False
            from .answers import _gap_txt
            ga = _gap_txt(st, a) if a else None
            gb = _gap_txt(st, b) if b else None
            if ga and gb:
                self.emit("gaps", "gap_report", phrases.say("gap_report", ahead=ga, behind=gb), prio=1, ttl=15, cool=100, tag="gap_report")
            elif ga or gb:
                self.emit("gaps", "gap_report", ("O da frente está a " + ga if ga else "O de trás está a " + gb) + ".", prio=1, ttl=15, cool=100, tag="gap_report")
        for r, rel in ((a, "da frente"), (st.leader if st.leader is not me else None, "líder")):
            if r is None:
                continue
            was = self.pit_seen.get(r["id"])
            self.pit_seen[r["id"]] = bool(r.get("pit"))
            if r.get("pit") and was is False and race:
                self.emit("gaps", "rival_pit", f"{r['name'].split(' ')[0]}, o {rel}, entrou nos boxes.", prio=1, ttl=15, cool=20, tag=f"rpit{r['id']}")
        if b and not b.get("pit"):
            g = st.gap_s(b)
            if g is not None and -1.6 < g < 0:
                gap = abs(g)
                tr = st.trend(b)
                who = b["name"].split(" ")[0] if b.get("name") else "ele"
                if gap < 0.7 and race:
                    self.emit("gaps", "defend", phrases.say("defend"), prio=2, ttl=8, cool=90, tag="defend")
                elif tr is not None and tr < -0.15 and gap < 2.0:
                    self.emit("gaps", "behind_closing", phrases.say("behind_closing", who=who, gap=seg(gap)), prio=2, ttl=10, cool=60, tag="behind_c")
                elif gap < 1.0:
                    self.emit("gaps", "behind_close", phrases.say("behind_close", who=who, gap=seg(gap)), prio=2, ttl=10, cool=60, tag="behind_n")
            elif g is not None and g < -2.0:
                tr = st.trend(b)
                if tr is not None and tr > 0.3 and self._cool.get("behind_c", 0) > time.monotonic() - 120:
                    self.emit("gaps", "behind_drop", phrases.say("behind_drop", gap=seg(abs(g))), prio=1, ttl=10, cool=120, tag="behind_d")
        if a and not a.get("pit"):
            g = st.gap_s(a)
            if g is not None and 0 < g < 1.5:
                tr = st.trend(a)
                who = a["name"].split(" ")[0] if a.get("name") else "ele"
                if g < 0.8 and race:
                    self.emit("gaps", "attack", phrases.say("attack"), prio=2, ttl=8, cool=90, tag="attack")
                elif tr is not None and tr < -0.15:
                    self.emit("gaps", "ahead_closing", phrases.say("ahead_closing", who=who, gap=seg(g)), prio=1, ttl=10, cool=60, tag="ahead_c")
                else:
                    self.emit("gaps", "ahead_close", phrases.say("ahead_close", who=who, gap=seg(g)), prio=1, ttl=10, cool=60, tag="ahead_n")

    def _positions(self, st, f, now):
        me = st.me
        if not me or not st.race or not st.rows:
            return
        pos = me["pos"]
        if self.pos_prev is None:
            self.pos_prev = pos
            return
        if pos != self.pos_prev:
            if self.pos_cand is None or self.pos_cand[0] != pos:
                self.pos_cand = (pos, now)
            elif now - self.pos_cand[1] >= 3.0 and f.completed_laps + f.norm_pos > 0.05:
                key = "gained" if pos < self.pos_prev else "lost"
                self.emit("positions", key, phrases.say(key, pos=pos), prio=2, ttl=10, cool=0, tag="pos")
                self.pos_prev, self.pos_cand = pos, None
        else:
            self.pos_cand = None

    def _session(self, st, f):
        tl = f.session_time_left
        quali = not (f.session_type or "").lower().startswith("race")
        if tl and tl > 0:
            left = tl / 60000.0
            marks = (60, 30, 20, 10, 5, 2, 1)
            hit = [m for m in marks if left <= m]
            if hit and min(hit) not in self.time_said:
                m = min(hit)
                self.time_said |= {x for x in marks if x >= m}
                if left > m * 0.85:                      # acabou de cruzar a marca (não é entrar no meio da sessão)
                    key = "time_last_quali" if (f.session_type or "").lower().startswith("qual") and m <= 5 else "time_left"
                    self.emit("session", key, phrases.say(key, m=m), prio=2, ttl=12, tag=f"t{m}")
        n = st.laps_to_go()
        if f.total_laps and n is not None:
            left = int(n + 0.999)
            for k in (10, 5, 3, 2, 1):
                if left == k and k not in self.laps_said:
                    self.laps_said.add(k)
                    if k == 1:
                        self.emit("session", "last_lap", phrases.say("last_lap"), prio=3, ttl=15, tag="laps")
                    elif k == 2:
                        self.emit("session", "laps_two", phrases.say("laps_two"), prio=2, ttl=15, tag="laps")
                    else:
                        self.emit("session", "laps_left", phrases.say("laps_left", n=k), prio=1, ttl=15, tag="laps")

    def _others_best(self, st):
        b = st.best_session_lap()
        if not b:
            return
        key = (b["id"], b["best_ms"])
        if self.best_seen is None:
            self.best_seen = key
        elif key != self.best_seen:
            self.best_seen = key
            if not b.get("me"):
                self.emit("laps", "opp_best", f"{b['name'].split(' ')[0]} fez a melhor volta da sessão, {laptime(b['best_ms'])}.", prio=1, ttl=15, cool=45, tag="opp_best")

    def _weather(self, f):
        r = tuple(f.rain or ())
        if r:
            if self.rain_prev is not None:
                if r[0] > 0 and self.rain_prev[0] == 0:
                    self.emit("weather", "rain_start", phrases.say("rain_start"), prio=3, ttl=12, cool=120)
                elif r[0] == 0 and self.rain_prev[0] > 0:
                    self.emit("weather", "rain_stop", phrases.say("rain_stop"), prio=2, ttl=12, cool=120)
                elif len(r) >= 3 and r[0] == 0:
                    if r[1] > 0 and not self.rain_prev[1]:
                        self.emit("weather", "rain_soon", phrases.say("rain_soon", m=10), prio=2, ttl=15, cool=300, tag="rain_soon")
                    elif r[2] > 0 and not self.rain_prev[2] and not r[1]:
                        self.emit("weather", "rain_soon", phrases.say("rain_soon", m=30), prio=2, ttl=15, cool=300, tag="rain_soon")
            self.rain_prev = r
        g = (f.grip or "").lower()
        if g and self.grip_prev and g != self.grip_prev:
            self.emit("weather", "grip_change", phrases.say("grip_change", grip=g), prio=1, ttl=12, cool=90)
        self.grip_prev = g or self.grip_prev
