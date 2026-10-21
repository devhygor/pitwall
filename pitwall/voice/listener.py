"""Escuta o microfone. Três jeitos de falar com o engenheiro (configurável):

* hold:   segure a tecla enquanto fala e solte (tecla de rádio);
* toggle: aperte uma vez, fale e ele para sozinho quando você se calar (ou aperte de novo);
* open:   microfone sempre aberto; detecta sua voz sozinho (com palavra de ativação, se quiser).
"""
from __future__ import annotations

import queue
import threading
import time
from collections import deque

import numpy as np

from . import audio

try:
    import sounddevice as sd
except Exception:  # noqa: BLE001
    sd = None


class Listener:
    def __init__(self, eng):
        self.eng = eng
        self._q: queue.Queue = queue.Queue(maxsize=400)
        self._stream = None
        self._rate = 16000
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.state = "off"            # off | idle | listening | thinking
        self.level = 0.0
        self.error = ""
        self._rec = False
        self._buf: list = []
        self._mode_hold = False
        self._noise = 0.003
        self._pre: deque = deque(maxlen=12)
        self._speech_run = 0
        self._silence = 0.0
        self._speech_t = 0.0
        self._rec_start = 0.0
        self._busy = threading.Lock()
        self._probe_until = 0.0
        self._dev_key = None
        self.enabled = False
        self._test = False
        self._partial_at = 0.0
        self._partial_busy = False

    # ---- ciclo de vida ----------------------------------------------------------------------
    def start(self):
        self.enabled = True
        self._ensure_thread()

    def stop(self):
        self.enabled = False
        self._rec = False
        if time.monotonic() >= self._probe_until:
            self.state = "off"

    def start_test(self):
        """Grava uma frase para o teste da tela (para sozinho quando você se cala)."""
        self.probe(30)
        self._test, self._rec, self._mode_hold = True, True, False
        self._buf, self._speech_t, self._silence = [], 0.0, 0.0
        self._partial_at = time.monotonic()
        self.state = "listening"

    def probe(self, seconds: float = 20.0):
        """Mantém o microfone aberto por alguns segundos só para mostrar o nível na tela."""
        self._probe_until = time.monotonic() + seconds
        self._ensure_thread()

    def shutdown(self):
        self._stop.set()
        self._close()

    def _ensure_thread(self):
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True, name="pitwall-mic")
            self._thread.start()

    # ---- fluxo de áudio ---------------------------------------------------------------------
    def _open(self):
        if sd is None:
            self.error = "instale o pacote sounddevice para usar o microfone"
            return False
        name = self.eng.settings.get("eng_mic") if self.eng.settings else ""
        dev = audio.resolve(name, "input")
        try:
            info = sd.query_devices(dev if dev is not None else sd.default.device[0], "input")
            self._rate = int(info["default_samplerate"]) or 16000
            self._stream = sd.InputStream(device=dev, channels=1, samplerate=self._rate, dtype="float32",
                                          blocksize=int(self._rate * 0.03), callback=self._cb)
            self._stream.start()
            self._dev_key = name
            self.error = ""
            return True
        except Exception as e:  # noqa: BLE001
            self._stream = None
            self.error = f"não consegui abrir o microfone: {e}"
            return False

    def _close(self):
        s, self._stream = self._stream, None
        if s is not None:
            try:
                s.stop()
                s.close()
            except Exception:  # noqa: BLE001
                pass

    def _cb(self, indata, frames, t, status):
        try:
            self._q.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def _run(self):
        while not self._stop.is_set():
            want = self.enabled or time.monotonic() < self._probe_until
            name = self.eng.settings.get("eng_mic") if self.eng.settings else ""
            if self._stream is not None and (not want or name != self._dev_key):
                self._close()
                self.level = 0.0
            if not want:
                if self.state != "off":
                    self.state = "off"
                time.sleep(0.2)
                if not self.enabled and time.monotonic() >= self._probe_until and self._stream is None:
                    # nada a fazer: encerra a thread (volta quando precisar)
                    if not self.enabled:
                        return
                continue
            if self._stream is None and not self._open():
                self.state = "off"
                time.sleep(2.0)
                continue
            if self.state == "off":
                self.state = "idle"
            try:
                x = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            self._process(x)

    # ---- processamento ----------------------------------------------------------------------
    def _process(self, x: np.ndarray):
        rms = float(np.sqrt(np.mean(x * x))) + 1e-9
        self.level = min(1.0, rms * 8)
        dt = len(x) / self._rate
        if rms < self._noise * 2.5:
            self._noise = 0.97 * self._noise + 0.03 * rms
        thr = max(0.012, self._noise * 4.0)
        mode = (self.eng.settings.get("eng_ptt_mode") if self.eng.settings else "hold") or "hold"
        talking = self.eng.speaker.speaking_recently() if hasattr(self.eng, "speaker") else False
        if self._rec:
            self._buf.append(x)
            if rms > thr:
                self._speech_t += dt
                self._silence = 0.0
            else:
                self._silence += dt
            total = sum(len(b) for b in self._buf) / self._rate
            if self._test and self._speech_t > 0.3 and time.monotonic() - self._partial_at > 1.0 and not self._partial_busy:
                self._partial_at = time.monotonic()
                self._partial_busy = True
                threading.Thread(target=self._partial, args=(np.concatenate(self._buf),), daemon=True).start()
            if mode == "hold" and self._mode_hold and not self._test:
                if total > 20:
                    self.finish()
            elif (self._speech_t > 0.25 and self._silence > (1.0 if mode != "open" else 0.8)) or total > 14 or \
                    ((mode == "toggle" or self._test) and self._speech_t < 0.1 and total > 7):
                self.finish()
            return
        self._pre.append(x)
        if mode != "open" or not self.enabled or talking:
            self._speech_run = 0
            return
        if rms > thr * 1.5:
            self._speech_run += 1
            if self._speech_run >= 3:                       # ~90 ms de voz: começa a gravar
                self._rec, self._mode_hold = True, False
                self._buf = list(self._pre)
                self._speech_t, self._silence = 0.1, 0.0
                self._rec_start = time.monotonic()
                self.state = "listening"
        else:
            self._speech_run = 0

    # ---- teclas ----------------------------------------------------------------------------
    def ptt_down(self):
        if not self.enabled:
            return
        mode = (self.eng.settings.get("eng_ptt_mode") if self.eng.settings else "hold") or "hold"
        if mode == "open":
            return
        if mode == "toggle" and self._rec:
            self.finish()
            return
        self.eng.speaker.interrupt()
        self._rec, self._mode_hold = True, mode == "hold"
        self._buf = list(self._pre)[-4:]
        self._speech_t, self._silence = 0.0, 0.0
        self._rec_start = time.monotonic()
        self.state = "listening"
        self.eng.on_listen_start()

    def ptt_up(self):
        mode = (self.eng.settings.get("eng_ptt_mode") if self.eng.settings else "hold") or "hold"
        if mode == "hold" and self._rec:
            self.finish()

    def finish(self):
        if not self._rec:
            return
        self._rec = False
        buf, self._buf = self._buf, []
        self.state = "thinking" if buf else "idle"
        if not buf:
            return
        x = np.concatenate(buf)
        if len(x) / self._rate < 0.3:
            self.state = "idle"
            return
        threading.Thread(target=self._transcribe, args=(x,), daemon=True).start()

    def _partial(self, x: np.ndarray):
        """Texto parcial enquanto o piloto ainda fala (só no teste da tela)."""
        try:
            y = audio.resample(x, self._rate, 16000).astype(np.float32)
            pk = float(np.max(np.abs(y))) or 1.0
            if pk >= 0.02 and self._test:
                t = self.eng.stt.transcribe(y / pk * 0.9)
                if self._test and self.eng.test.get("state") == "recording":
                    self.eng.test = {**self.eng.test, "partial": t}
        except Exception:  # noqa: BLE001
            pass
        finally:
            self._partial_busy = False

    def _transcribe(self, x: np.ndarray):
        test, self._test = self._test, False
        if not self._busy.acquire(blocking=False):
            self.state = "idle"
            if test:
                self.eng.test_heard("", "O reconhecimento ainda está ocupado, tente de novo.")
            return
        try:
            y = audio.resample(x, self._rate, 16000).astype(np.float32)
            pk = float(np.max(np.abs(y))) or 1.0
            if pk < 0.02:
                if test:
                    self.eng.test_heard("", "Não ouvi nada. Confira o microfone escolhido e o nível acima.")
                return
            y = y / pk * 0.9                                 # normaliza: voz baixa também é entendida
            text = self.eng.stt.transcribe(y)
            if test:
                self.eng.test_heard(text, "" if text else "Não entendi o que foi dito.")
            elif text:
                self.eng.handle_speech(text)
            else:
                self.eng.on_nothing_heard()
        except Exception as e:  # noqa: BLE001
            self.error = str(e)
            self.eng.log("erro", f"Reconhecimento de voz: {e}")
            if test:
                self.eng.test_heard("", str(e))
        finally:
            self._busy.release()
            if self.state == "thinking":
                self.state = "idle"

    def status(self) -> dict:
        return {"state": self.state, "level": round(self.level, 3), "error": self.error, "available": sd is not None}
