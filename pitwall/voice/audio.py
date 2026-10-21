"""Áudio: lista de microfones e fones, reprodução no dispositivo escolhido e efeito de rádio."""
from __future__ import annotations

import threading
import time

import numpy as np

try:                                   # opcional: sem ele não há escolha de dispositivo (usa o padrão do Windows)
    import sounddevice as sd
except Exception:  # noqa: BLE001
    sd = None

_SKIP = ("mapeador", "mapper", "driver de captura", "driver de som", "primary", "primário", "prim�rio")


def available() -> bool:
    return sd is not None


def _hostapis() -> dict[int, str]:
    try:
        return {i: h["name"] for i, h in enumerate(sd.query_hostapis())}
    except Exception:  # noqa: BLE001
        return {}


def devices(kind: str) -> list[dict]:
    """kind = 'input' | 'output'. Uma entrada por aparelho (sem repetir por tipo de driver)."""
    if sd is None:
        return []
    key = "max_input_channels" if kind == "input" else "max_output_channels"
    apis = _hostapis()
    out: dict[str, dict] = {}
    try:
        devs = sd.query_devices()
    except Exception:  # noqa: BLE001
        return []
    try:
        default_idx = sd.default.device[0 if kind == "input" else 1]
    except Exception:  # noqa: BLE001
        default_idx = -1
    pref = {"Windows DirectSound": 0, "MME": 1, "Windows WASAPI": 2}
    for i, d in enumerate(devs):
        api = apis.get(d["hostapi"], "")
        if d[key] <= 0 or api not in pref:
            continue
        name = d["name"].strip()
        if any(s in name.lower() for s in _SKIP):
            continue
        cur = out.get(name.lower())
        if cur is None or pref[api] < cur["_p"]:
            out[name.lower()] = {"name": name, "index": i, "api": api, "_p": pref[api], "default": i == default_idx,
                                 "rate": d["default_samplerate"]}
    res = sorted(out.values(), key=lambda x: x["name"].lower())
    for r in res:
        r.pop("_p", None)
    return res


def resolve(name: str, kind: str):
    """Índice do dispositivo pelo nome salvo (None = padrão do Windows)."""
    if not name or sd is None:
        return None
    n = name.strip().lower()
    for d in devices(kind):
        if d["name"].lower() == n:
            return d["index"]
    for d in devices(kind):                      # nome truncado pelo driver antigo (MME corta em 31 letras)
        if d["name"].lower().startswith(n[:28]) or n.startswith(d["name"].lower()[:28]):
            return d["index"]
    return None


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or len(x) == 0:
        return x
    if dst < src and src % dst == 0:             # decimação inteira com média (filtro simples)
        k = src // dst
        n = (len(x) // k) * k
        return x[:n].reshape(-1, k).mean(axis=1)
    if dst < src:                                # passa-baixa leve antes de reduzir
        w = max(1, int(round(src / dst)))
        x = np.convolve(x, np.ones(w) / w, mode="same")
    n = int(round(len(x) * dst / src))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


# ---------------------------------------------------------------- efeito de rádio -------------------------
def radio_fx(x: np.ndarray, rate: int, level: int = 60, noise: int = 30) -> np.ndarray:
    """Voz de rádio de equipe. `level` (0-100) é o quanto a voz fica "de rádio" (corta graves/agudos e comprime);
    `noise` (0-100) é o chiado de fundo, independente (0 = sem chiado)."""
    if len(x) < 64:
        return x
    lv = max(0, min(100, level)) / 100.0
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / rate)
    hp = 1.0 / (1.0 + (330.0 / np.maximum(f, 1.0)) ** 4)
    lp = 1.0 / (1.0 + (f / 3300.0) ** 4)
    wet = np.tanh(np.fft.irfft(X * hp * lp, n) * 2.2) * 0.8
    y = (1 - lv) * x + lv * wet
    nz = max(0, min(100, noise)) / 100.0
    if nz > 0:
        y = y + np.random.default_rng(3).normal(0, 0.012 * nz, n).astype(np.float32)
    pk = np.max(np.abs(y)) or 1.0
    return (y / pk * 0.9).astype(np.float32)


def click(rate: int, up: bool = True, level: int = 60) -> np.ndarray:
    """Bipe curtinho de abrir/fechar o rádio."""
    dur = 0.07
    t = np.arange(int(dur * rate)) / rate
    f0 = 1500 if up else 1100
    s = np.sin(2 * np.pi * f0 * t) * np.exp(-t * 35)
    return (s * 0.35 * max(0, min(100, level)) / 60.0).astype(np.float32)


# ---------------------------------------------------------------- reprodução ---------------------------------
class Player:
    """Toca amostras (float32 mono) no dispositivo escolhido; pode ser interrompido."""

    def __init__(self):
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.playing = False

    def stop(self):
        self._stop.set()
        if sd is not None:
            try:
                sd.stop()
            except Exception:  # noqa: BLE001
                pass

    def play(self, x: np.ndarray, rate: int, device_name: str = "", volume=100) -> bool:
        """`volume` é 0-100 ou uma função que devolve 0-100 (lida a cada bloco: o volume muda enquanto toca)."""
        x = np.asarray(x, dtype=np.float32)
        if len(x) == 0:
            return True
        vol = volume if callable(volume) else (lambda v=volume: v)
        with self._lock:
            self._stop.clear()
            self.playing = True
            try:
                if sd is None:
                    return self._winsound(np.clip(x * (max(0, min(100, vol())) / 100.0), -1.0, 1.0), rate)
                dev = resolve(device_name, "output")
                info = sd.query_devices(dev if dev is not None else sd.default.device[1])
                dr = int(info["default_samplerate"]) or rate
                ch = 2 if info["max_output_channels"] >= 2 else 1
                y = resample(x, rate, dr)
                data = np.repeat(y[:, None], ch, axis=1) if ch > 1 else y[:, None]
                pos = [0]
                done = threading.Event()

                def cb(outdata, frames, t, status):
                    g = max(0, min(100, vol())) / 100.0
                    if self._stop.is_set():
                        outdata[:] = 0
                        raise sd.CallbackStop
                    chunk = data[pos[0]:pos[0] + frames]
                    n = len(chunk)
                    outdata[:n] = np.clip(chunk * g, -1.0, 1.0)
                    outdata[n:] = 0
                    pos[0] += frames
                    if pos[0] >= len(data):
                        raise sd.CallbackStop

                stream = sd.OutputStream(device=dev, samplerate=dr, channels=ch, dtype="float32", callback=cb,
                                         finished_callback=done.set)
                with stream:
                    done.wait(len(y) / dr + 2.0)
                return True
            except Exception:  # noqa: BLE001
                return False
            finally:
                self.playing = False

    @staticmethod
    def _winsound(x, rate) -> bool:
        import io
        import wave
        try:
            import winsound
        except ImportError:
            return False
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes((x * 32767).astype("<i2").tobytes())
        winsound.PlaySound(buf.getvalue(), winsound.SND_MEMORY)
        return True
