"""Engenheiro de corrida por voz: responde perguntas em português e avisa sozinho durante a pilotagem.

Peças:  state (leitura da corrida) -> nlu/answers (perguntas) e events/spotter (avisos) -> Speaker (fila de falas, tts)
        listener + stt (ouvir o piloto) + inputs (tecla de falar).
"""
from __future__ import annotations

import threading
import time
from collections import deque

import numpy as np

from .. import db as _db
from . import audio, inputs, nlu, phrases
from .answers import answer
from .events import CATEGORIES, DEFAULT_EVENTS, Monitor
from .listener import Listener
from .spotter import Spotter
from .state import RaceState
from .stt import MODELS as STT_MODELS
from .stt import WhisperSTT
from .tts import EDGE_VOICES, PIPER_VOICES, TTS, TTSError

__all__ = ["Engineer", "CATEGORIES", "DEFAULT_EVENTS"]

# frases curtas e urgentes que vale a pena deixar prontas no disco (o observador não pode esperar a síntese)
_PREWARM_KEYS = ("car_left", "car_right", "two_left", "two_right", "three_wide", "clear_left", "clear_right", "clear_all",
                 "still_left", "still_right", "track_limits", "lap_invalid", "yellow_all", "yellow_end", "blue", "red", "black",
                 "white", "green", "chequered", "cut_penalty", "penalty", "fuel_crit", "defend", "attack", "pit_in", "pit_out",
                 "spin", "listening", "not_understood", "ok", "thanks", "radio_ok", "no_data", "muted", "unmuted", "box_now",
                 "fuel_enough", "tyre_ok", "tyre_worn", "pads_low", "lapped_me", "race_start", "last_lap", "laps_two", "rain_start", "rain_stop")


class _Item:
    __slots__ = ("text", "prio", "until", "cat", "key", "at")

    def __init__(self, text, prio, ttl, cat, key):
        self.text, self.prio, self.cat, self.key = text, prio, cat, key
        self.at = time.monotonic()
        self.until = self.at + ttl


class Speaker:
    """Fila de falas por prioridade, com validade. Fala uma de cada vez; o observador (prio 5) interrompe."""

    def __init__(self, eng):
        self.eng = eng
        self.player = audio.Player()
        self._items: list[_Item] = []
        self._cv = threading.Condition()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._now: _Item | None = None
        self._last_end = 0.0
        self.last_error = ""

    def start(self):
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True, name="pitwall-speaker")
            self._thread.start()

    def shutdown(self):
        self._stop.set()
        with self._cv:
            self._cv.notify_all()
        self.player.stop()

    def speaking_recently(self) -> bool:
        return self.player.playing or time.monotonic() - self._last_end < 0.6

    def enqueue(self, text, prio=2, ttl=12.0, cat="", key=""):
        it = _Item(text, prio, ttl, cat, key or text)
        with self._cv:
            self._items = [i for i in self._items if i.key != it.key]
            self._items.append(it)
            if len(self._items) > 8:
                self._items.sort(key=lambda i: (-i.prio, i.at))
                self._items = self._items[:8]
            if self._now is not None and prio >= 5 and self._now.prio < 5:
                self.player.stop()                       # o observador corta a fala atual
            self._cv.notify_all()
        self.start()

    def interrupt(self):
        with self._cv:
            self._items.clear()
        self.player.stop()

    def clear(self):
        with self._cv:
            self._items.clear()

    def pending(self) -> int:
        return len(self._items)

    def _pick(self):
        now = time.monotonic()
        self._items = [i for i in self._items if i.until > now]
        busy = self.eng.busy()
        cand = [i for i in self._items if not (busy and i.prio <= 2)]
        if not cand:
            return None
        it = max(cand, key=lambda i: (i.prio, -i.at))
        self._items.remove(it)
        return it

    def _run(self):
        while not self._stop.is_set():
            with self._cv:
                it = self._pick()
                if it is None:
                    self._cv.wait(0.25 if self._items else 1.0)
                    continue
            self._now = it
            try:
                self._speak(it)
            except Exception as e:  # noqa: BLE001
                self.last_error = str(e)
                self.eng.log("erro", f"Falha ao falar: {e}")
            finally:
                self._now = None
                self._last_end = time.monotonic()

    def _speak(self, it: _Item):
        s = self.eng.settings
        x, sr = self.eng.tts.synth(it.text)
        if time.monotonic() > it.until + (4.0 if it.prio >= 4 else 0.0):
            return                                       # demorou e perdeu a hora
        radio = bool(s.get("eng_radio")) if s else False
        if radio:
            lv = int(s.get("eng_radio_level") if s.get("eng_radio_level") is not None else 60)
            x = audio.radio_fx(x, sr, lv, int(s.get("eng_radio_noise") if s.get("eng_radio_noise") is not None else 30))
            if lv > 0:
                x = np.concatenate([audio.click(sr, True, lv), x, audio.click(sr, False, lv)])
        self.eng.log("falou", it.text, cat=it.cat)
        if it.cat != "spotter":
            self.eng.last_said = it.text
        self.player.play(x, sr, s.get("eng_out") if s else "", lambda: self.eng.volume)

    def beep(self):
        """Bipe curto de 'pode falar' (rádio aberto)."""
        s = self.eng.settings
        if not (s and s.get("eng_radio")):
            return
        threading.Thread(target=lambda: self.player.play(audio.click(22050, True, int(s.get("eng_radio_level") if s.get("eng_radio_level") is not None else 60)), 22050, s.get("eng_out") or "", lambda: self.eng.volume),
                         daemon=True).start()


class Engineer:
    def __init__(self, settings, recorder=None):
        self.settings = settings
        self.recorder = recorder
        self.root = _db.data_dir() / "voice"
        self.state = RaceState(live_delta=getattr(recorder, "live_delta", None), settings=settings)
        self.spotter = Spotter(settings)
        self.monitor = Monitor(self)
        self.tts = TTS(settings, self.root)
        self.stt = WhisperSTT(settings, self.root)
        self.speaker = Speaker(self)
        self.listener = Listener(self)
        self.keys = inputs.KeyWatcher(self.listener.ptt_down, self.listener.ptt_up)
        self.muted = False
        self.last_said = ""
        self.heard = ""
        self._log: deque = deque(maxlen=80)
        self._last_tick = 0.0
        self._awake_until = 0.0
        self._last_rival = None
        self._sample_gen = 0
        self.test = {"id": 0, "state": "idle"}
        self._applied = None
        self._prewarm_gen = 0
        self.errors: deque = deque(maxlen=5)

    # ---- util ----------------------------------------------------------------------------------
    @property
    def enabled(self) -> bool:
        return bool(self.settings.get("eng_enabled"))

    def log(self, kind: str, text: str, **kw):
        self._log.append({"t": time.time(), "kind": kind, "text": text, **kw})

    def busy(self) -> bool:
        f = self.state.f
        return bool(f and f.status == "live" and (f.brake > 0.5 or abs(f.g_lat) > 1.25))

    def set_muted(self, v: bool):
        self.muted = bool(v)
        if v:
            self.speaker.clear()

    # ---- entrada de dados --------------------------------------------------------------------------
    def feed(self, f):
        if f is None or not self.enabled:
            return
        now = time.monotonic()
        if now - self._last_tick < 0.066:
            return
        self._last_tick = now
        try:
            if f.status == "off":
                return
            self.state.update(f)
            if f.status != "live":
                return
            self.spotter.update(f, self.state)
            if self._on("spotter") and not self.muted:
                for k in self.spotter.calls():
                    self.speaker.enqueue(phrases.say(k), prio=5, ttl=1.6, cat="spotter", key=f"spot_{k}")
            self.monitor.update(self.state)
        except Exception as e:  # noqa: BLE001
            self.errors.append(f"{type(e).__name__}: {e}")

    def _on(self, cat) -> bool:
        return bool((self.settings.get("eng_events") or DEFAULT_EVENTS).get(cat, True))

    def say(self, text, prio=2, ttl=12.0, cat="", key=""):
        """Fala proativa (respeita o silêncio pedido pelo piloto)."""
        if not self.enabled or self.muted:
            return
        self.speaker.enqueue(text, prio=prio, ttl=ttl, cat=cat, key=key)

    def reply(self, text):
        self.speaker.enqueue(text, prio=4, ttl=30.0, cat="reply", key="reply")

    # ---- conversa --------------------------------------------------------------------------------
    def on_listen_start(self):
        self.speaker.beep()

    def on_nothing_heard(self):
        mode = self.settings.get("eng_ptt_mode") or "hold"
        if mode != "open":
            self.reply(phrases.say("not_understood"))

    def ask(self, text: str, speak: bool = True) -> dict:
        """Responde a uma pergunta em texto (usado pela voz, pela tela e nos testes)."""
        p = nlu.parse(text, self.state, last=self._last_rival)
        if p is None:
            ans = phrases.say("not_understood")
            res = {"heard": text, "intent": None, "answer": ans}
        else:
            ans = answer(p, self)
            if p.rival and not p.rival.get("me"):
                self._last_rival = {"id": p.rival.get("id")}
            res = {"heard": text, "intent": p.intent, "target": p.target, "answer": ans}
        if speak:
            self.reply(ans)
        return res

    def handle_speech(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        self.heard = text
        self.log("ouviu", text)
        mode = self.settings.get("eng_ptt_mode") or "hold"
        wake = (self.settings.get("eng_wake_word") or "engenheiro").strip()
        use_wake = mode == "open" and bool(self.settings.get("eng_wake"))
        now = time.monotonic()
        stripped = nlu.norm(text)
        if use_wake:
            has = nlu.norm(wake) in stripped.split() or stripped.startswith(nlu.norm(wake))
            if not has and now > self._awake_until:
                return                                           # não falaram comigo
            if has:
                rest = nlu.parse(text, self.state, wake=wake)
                self._awake_until = now + 8.0
                if rest is None or stripped in (nlu.norm(wake), "oi " + nlu.norm(wake), "ei " + nlu.norm(wake)):
                    self.reply(phrases.say("listening"))
                    return
        p = nlu.parse(text, self.state, wake=wake if use_wake else "", last=self._last_rival)
        if p is None:
            if mode != "open" or now < self._awake_until:
                self.reply(phrases.say("not_understood"))
            return
        ans = answer(p, self)
        if p.rival and not p.rival.get("me"):
            self._last_rival = {"id": p.rival.get("id")}
        self.log("intencao", f"{p.intent} · alvo {p.target}")
        self.reply(ans)

    # ---- controle --------------------------------------------------------------------------------
    def apply(self):
        """Aplica as configurações (liga/desliga microfone, tecla, vozes)."""
        s = self.settings
        if self.enabled:
            self.speaker.start()
            self.keys.binding = s.get("eng_ptt") or ""
            self.keys.start()
            if self.stt.lib_ok() and self.stt.installed():
                threading.Thread(target=self._warm_stt, daemon=True).start()
            if (s.get("eng_listen") is not False) and audio.available() and self.stt.lib_ok() and self.stt.installed():
                self.listener.start()
            else:
                self.listener.stop()
            self._start_prewarm()
        else:
            self.keys.binding = ""
            self.listener.stop()
            self.speaker.clear()

    def _warm_stt(self):
        try:
            self.stt.load()
        except Exception as e:  # noqa: BLE001
            self.errors.append(f"STT: {e}")

    def _start_prewarm(self):
        sig = (self.tts.order()[0], self.tts._voice_for(self.tts.order()[0]), int(self.settings.get("eng_rate") or 100))
        if sig == self._applied:
            return
        self._applied = sig
        self._prewarm_gen += 1
        gen = self._prewarm_gen

        def run():
            for key in _PREWARM_KEYS:
                for t in phrases.P.get(key, []):
                    if gen != self._prewarm_gen or self._stop_prewarm():
                        return
                    if "{" in t or self.tts.cached(t):
                        continue
                    try:
                        self.tts.synth(t)
                    except TTSError:
                        return
                    if self.tts.last_engine == "edge":
                        time.sleep(0.25)
        threading.Thread(target=run, daemon=True, name="pitwall-prewarm").start()

    def _stop_prewarm(self) -> bool:
        return not self.enabled

    def test_voice(self, text: str = ""):
        text = text or phrases.say("radio_ok")
        self.speaker.enqueue(text, prio=4, ttl=30, cat="reply", key="test")
        self.speaker.start()
        return text

    @property
    def volume(self) -> int:
        v = self.settings.get("eng_volume")
        return 90 if v is None else int(v)

    def start_listen_test(self):
        """Teste do microfone na tela: ouve uma frase, mostra o que entendeu e responde."""
        nid = self.test["id"] + 1
        if not self.stt.lib_ok():
            self.test = {"id": nid, "state": "done", "heard": "", "error": "O pacote faster-whisper não está instalado."}
            return
        if not self.stt.installed():
            self.test = {"id": nid, "state": "done", "heard": "", "error": "Baixe o modelo de reconhecimento de voz primeiro."}
            return
        self.test = {"id": self.test["id"], "state": "recording", "partial": ""}
        self.speaker.interrupt()
        self.listener.start_test()
        threading.Thread(target=self._warm_stt, daemon=True).start()

    def stop_listen_test(self):
        self.listener.finish()

    def test_heard(self, text: str, error: str = ""):
        res = {"id": self.test["id"] + 1, "state": "done", "heard": text, "error": error}
        if text:
            res.update(self.ask(text, speak=True))
            self.log("ouviu", text)
        self.test = res

    def stop_audio(self):
        """Para na hora o que estiver falando/tocando (teste, amostra ou fala) e limpa a fila."""
        self._sample_gen += 1
        self.speaker.interrupt()

    def play_sample(self, name: str):
        """Amostra de uma voz Piper. Baixada: fala uma frase de corrida com ela; senão toca a amostra publicada pelo
        projeto Piper (frase fixa). Devolve erro em texto ou ''."""
        self._sample_gen += 1
        gen = self._sample_gen
        s = self.settings
        try:
            if self.tts.piper.installed(name) and self.tts.piper.lib_ok():
                x, sr = self.tts.piper.synth(phrases.say("three_wide") + " " + phrases.say("fuel_low", laps=3) + " " + phrases.say("lap_pb", time="1 minuto e 42,3 segundos"), name, int(s.get("eng_rate") or 100))
            else:
                x, sr = self.tts.piper.sample(name)
        except TTSError as e:
            return str(e)

        def run():
            if gen == self._sample_gen:
                self.speaker.player.play(x, sr, s.get("eng_out") or "", lambda: self.volume)
        threading.Thread(target=run, daemon=True).start()
        return ""

    def shutdown(self):
        self.keys.stop()
        self.listener.shutdown()
        self.speaker.shutdown()
        self.tts.close()

    # ---- status para a tela ---------------------------------------------------------------------
    def status(self) -> dict:
        sp = self.spotter
        f = self.state.f
        return {
            "enabled": self.enabled, "muted": self.muted, "heard": self.heard, "last_said": self.last_said,
            "listener": self.listener.status(), "tts": self.tts.status(), "stt": self.stt.status(),
            "speaker": {"pending": self.speaker.pending(), "error": self.speaker.last_error},
            "binding": {"value": self.settings.get("eng_ptt") or "", "label": inputs.label(self.settings.get("eng_ptt") or ""),
                        "capture": self.keys.capture_state},
            "spotter": {"source": sp.source, "left": sp.left, "right": sp.right, "calibrated": sp.tf is not None},
            "game": {"live": bool(f and f.status == "live"), "track": f.track if f else "", "cars": len(self.state.rows)},
            "test": self.test, "log": list(self._log)[-40:], "errors": list(self.errors),
            "audio": {"available": audio.available()},
        }

    def devices(self) -> dict:
        return {"inputs": audio.devices("input"), "outputs": audio.devices("output"), "joysticks": inputs.joysticks(),
                "edge_voices": [{"id": i, "name": n} for i, n in EDGE_VOICES],
                "piper_voices": [{"id": i, "name": n, "installed": self.tts.piper.installed(i)} for i, n, _ in PIPER_VOICES],
                "windows_voices": self.tts.win.voices() if self.tts.win.available() else [],
                "stt_models": [{"id": i, "name": n, "installed": self.stt.installed(i)} for i, n in STT_MODELS]}
