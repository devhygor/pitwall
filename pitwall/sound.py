"""Sons de alerta do Pitwall, gerados na hora (nada de arquivo de terceiros).

- "motor":   ronco de motor acelerando (síntese: harmônicos + pulsos de combustão)
- "largada": as 5 luzes vermelhas (bipes) e o "apagou, vai!" (bipe longo e agudo)
- "ambos":   motor e depois a largada
- "aviso":   bipe duplo curto (para o aviso de antecedência)

O volume (0–100) é aplicado no próprio arquivo, então não mexe no volume do Windows.
"""
from __future__ import annotations

import io
import sys
import wave
from pathlib import Path

import numpy as np

RATE = 22050
KINDS = ("motor", "largada", "ambos", "aviso")


def _env(n, attack=0.01, release=0.05):
    e = np.ones(n)
    a, r = int(attack * RATE), int(release * RATE)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] = np.linspace(1, 0, r)
    return e


def _beep(freq, dur, vol=0.6):
    t = np.arange(int(dur * RATE)) / RATE
    tone = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return vol * tone * _env(len(t), 0.004, 0.03)


def _silence(dur):
    return np.zeros(int(dur * RATE))


def engine(seed=7):
    """~3,2 s: marcha lenta → duas aceleradas → corte de giro → solta."""
    rng = np.random.default_rng(seed)
    # curva de rotação (Hz da explosão ~ rpm/60 * cilindros/2)
    pts = [(0.0, 38), (0.45, 40), (0.85, 120), (1.05, 125), (1.35, 70), (1.6, 72),
           (2.35, 210), (2.55, 205), (2.62, 190), (2.7, 208), (3.2, 60)]
    dur = pts[-1][0]
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    f = np.interp(t, [p[0] for p in pts], [p[1] for p in pts])
    phase = 2 * np.pi * np.cumsum(f) / RATE
    # som do escapamento: muitos harmônicos, ímpares mais fortes, com leve aspereza
    sig = np.zeros(n)
    for k in range(1, 14):
        amp = (1.0 / k) * (1.35 if k % 2 else 0.8)
        sig += amp * np.sin(k * phase + rng.uniform(0, 6.28))
    # pulsos de combustão (modulação no ritmo das explosões)
    sig *= 0.65 + 0.35 * (0.5 + 0.5 * np.sin(phase / 2))
    # ruído de admissão/escape que cresce com o giro
    noise = rng.normal(0, 1, n)
    noise = np.convolve(noise, np.ones(6) / 6, mode="same")
    load = (f - f.min()) / (f.max() - f.min())
    sig += noise * (0.15 + 0.55 * load)
    # leve distorção (motor de corrida é "sujo")
    sig = np.tanh(sig * 0.9)
    amp = 0.35 + 0.65 * load
    return sig * amp * _env(n, 0.05, 0.45)


def lights():
    """5 luzes acendendo (bipe grave) e o apagar (bipe agudo longo)."""
    parts = []
    for _ in range(5):
        parts += [_beep(660, 0.16), _silence(0.36)]
    parts += [_silence(0.35), _beep(1320, 0.7, 0.7)]
    return np.concatenate(parts)


def warn():
    return np.concatenate([_beep(988, 0.12), _silence(0.08), _beep(988, 0.12), _silence(0.25),
                           _beep(1175, 0.18)])


def render(kind: str = "ambos", volume: int = 80) -> np.ndarray:
    kind = kind if kind in KINDS else "ambos"
    if kind == "motor":
        s = engine()
    elif kind == "largada":
        s = lights()
    elif kind == "aviso":
        s = warn()
    else:
        s = np.concatenate([engine(), _silence(0.25), lights()])
    peak = np.max(np.abs(s)) or 1.0
    vol = max(0, min(100, int(volume))) / 100.0
    return (s / peak) * 0.95 * vol


def wav_bytes(kind: str = "ambos", volume: int = 80) -> bytes:
    data = (render(kind, volume) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)
    return buf.getvalue()


def play(kind: str, volume: int, folder: Path) -> bool:
    """Toca no Windows (sem bloquear). Em outros sistemas não faz nada."""
    if sys.platform != "win32":
        return False
    try:
        import winsound
        folder.mkdir(parents=True, exist_ok=True)
        f = folder / f"alerta_{kind}.wav"
        f.write_bytes(wav_bytes(kind, volume))
        winsound.PlaySound(str(f), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
        return True
    except Exception:  # noqa: BLE001
        return False
