"""Voz do engenheiro (texto -> áudio). Três motores, dois modos:

* offline: Piper (voz neural em português, ~60 MB baixados uma vez) ou a voz do Windows (Maria, já instalada);
* online:  Microsoft Edge TTS (vozes neurais Antonio/Francisca/Thalita). Grátis e sem chave, mas precisa
  de internet e envia o texto falado para os servidores da Microsoft. Se a internet falhar, cai sozinho
  para o modo offline.

Todo áudio gerado fica em cache no disco: as frases fixas do engenheiro ficam instantâneas e, depois da
primeira vez, até a voz online funciona sem internet para elas.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
import sys
import threading
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

EDGE_VOICES = [("pt-BR-AntonioNeural", "Antonio (masculina)"), ("pt-BR-FranciscaNeural", "Francisca (feminina)"),
               ("pt-BR-ThalitaMultilingualNeural", "Thalita (feminina)")]
PIPER_VOICES = [("pt_BR-faber-medium", "Faber (masculina)", "faber/medium"), ("pt_BR-cadu-medium", "Cadu (masculina)", "cadu/medium"),
                ("pt_BR-jeff-medium", "Jeff (masculina)", "jeff/medium"), ("pt_BR-edresson-low", "Edresson (masculina, leve)", "edresson/low")]
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/"
NOWIN = 0x08000000 if sys.platform == "win32" else 0


class TTSError(Exception):
    pass


def _read_wav(path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        n, sw, ch, sr = w.getnframes(), w.getsampwidth(), w.getnchannels(), w.getframerate()
        raw = w.readframes(n)
    if sw != 2:
        raise TTSError("formato de áudio inesperado")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def _write_wav(path, x: np.ndarray, sr: int):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def _trim(x: np.ndarray, sr: int) -> np.ndarray:
    """Tira o silêncio do começo/fim (acelera a resposta)."""
    if len(x) < sr // 10:
        return x
    a = np.abs(x)
    idx = np.where(a > 0.01)[0]
    if len(idx) == 0:
        return x
    s, e = max(0, idx[0] - int(0.02 * sr)), min(len(x), idx[-1] + int(0.08 * sr))
    return x[s:e]


# ---------------------------------------------------------------- Windows (offline) ------------------------
_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $r = $line | ConvertFrom-Json
    if ($r.list) {
      $v = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }
      [Console]::Out.WriteLine('voices:' + ($v -join ';'))
      continue
    }
    try { $s.SelectVoice($r.voice) } catch {}
    $s.Rate = [int]$r.rate
    $s.SetOutputToWaveFile($r.out)
    $s.Speak($r.text)
    $s.SetOutputToNull()
    [Console]::Out.WriteLine('ok')
  } catch { [Console]::Out.WriteLine('err:' + $_.Exception.Message) }
}
"""


class WindowsTTS:
    def __init__(self, root: Path):
        self.root = root
        self.proc = None
        self.lock = threading.Lock()
        self._voices: list[dict] | None = None

    def available(self) -> bool:
        return sys.platform == "win32"

    def _ensure(self):
        if self.proc and self.proc.poll() is None:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        script = self.root / "sapi.ps1"
        script.write_text(_PS, encoding="utf-8-sig")
        self.proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=NOWIN,
            text=True, encoding="utf-8", bufsize=1)
        line = self._readline(15)
        if line != "ready":
            self.close()
            raise TTSError("a voz do Windows não iniciou")

    def _readline(self, timeout: float) -> str:
        res: list[str] = []
        t = threading.Thread(target=lambda: res.append(self.proc.stdout.readline().strip()), daemon=True)
        t.start()
        t.join(timeout)
        if not res:
            self.close()
            raise TTSError("a voz do Windows não respondeu")
        return res[0]

    def _send(self, obj: dict, timeout: float = 20) -> str:
        with self.lock:
            self._ensure()
            self.proc.stdin.write(json.dumps(obj, ensure_ascii=True) + "\n")
            self.proc.stdin.flush()
            return self._readline(timeout)

    def voices(self) -> list[dict]:
        if self._voices is None:
            try:
                ans = self._send({"list": True}, 20)
                items = ans[7:].split(";") if ans.startswith("voices:") else []
                self._voices = [{"name": n, "culture": c} for n, c in (i.split("|") for i in items if "|" in i)]
            except TTSError:
                self._voices = []
        return self._voices

    def best_voice(self) -> str:
        v = self.voices()
        for x in v:
            if x["culture"].lower() == "pt-br":
                return x["name"]
        for x in v:
            if x["culture"].lower().startswith("pt"):
                return x["name"]
        return v[0]["name"] if v else ""

    def synth(self, text: str, voice: str = "", rate_pct: int = 100) -> tuple[np.ndarray, int]:
        voice = voice or self.best_voice()
        sapi_rate = max(-10, min(10, int(round((rate_pct - 100) / 10))))
        out = self.root / f"_tmp_{threading.get_ident()}.wav"
        ans = self._send({"text": text, "voice": voice, "rate": sapi_rate, "out": str(out)})
        if ans != "ok":
            raise TTSError(ans[4:] if ans.startswith("err:") else "falha na voz do Windows")
        x, sr = _read_wav(out)
        try:
            out.unlink()
        except OSError:
            pass
        return x, sr

    def close(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                p.kill()
            except OSError:
                pass


# ---------------------------------------------------------------- Piper (offline neural) --------------------
class PiperTTS:
    def __init__(self, root: Path):
        self.dir = root / "piper"
        self._voices: dict = {}
        self.progress = {"name": "", "pct": 0, "state": "idle", "error": ""}

    @staticmethod
    def lib_ok() -> bool:
        try:
            import piper  # noqa: F401
            return True
        except Exception:  # noqa: BLE001
            return False

    def model_path(self, name: str) -> Path:
        return self.dir / f"{name}.onnx"

    def installed(self, name: str) -> bool:
        return self.model_path(name).exists() and self.model_path(name).with_suffix(".onnx.json").exists()

    def download(self, name: str):
        """Baixa o modelo da voz (bloqueante). O andamento fica em `progress`."""
        info = next((v for v in PIPER_VOICES if v[0] == name), None)
        if not info:
            raise TTSError("voz desconhecida")
        self.dir.mkdir(parents=True, exist_ok=True)
        self.progress = {"name": name, "pct": 0, "state": "baixando", "error": ""}
        try:
            for ext in (".onnx.json", ".onnx"):
                url = f"{PIPER_BASE}{info[2]}/{name}{ext}"
                dest = self.dir / f"{name}{ext}"
                tmp = dest.with_suffix(dest.suffix + ".part")
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Pitwall"}), timeout=30) as r, open(tmp, "wb") as fh:
                    total = int(r.headers.get("Content-Length") or 0)
                    got = 0
                    while True:
                        b = r.read(1 << 16)
                        if not b:
                            break
                        fh.write(b)
                        got += len(b)
                        if total and ext == ".onnx":
                            self.progress["pct"] = int(got * 100 / total)
                tmp.replace(dest)
            self.progress = {"name": name, "pct": 100, "state": "pronto", "error": ""}
        except Exception as e:  # noqa: BLE001
            self.progress = {"name": name, "pct": 0, "state": "erro", "error": str(e)}
            raise TTSError(f"não deu para baixar a voz: {e}")

    def sample(self, name: str) -> tuple[np.ndarray, int]:
        """Amostra da voz publicada pelo projeto Piper (~100 KB), para ouvir antes de baixar o modelo."""
        info = next((v for v in PIPER_VOICES if v[0] == name), None)
        if not info:
            raise TTSError("voz desconhecida")
        path = self.dir / "samples" / f"{name}.mp3"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with urllib.request.urlopen(urllib.request.Request(f"{PIPER_BASE}{info[2]}/samples/speaker_0.mp3", headers={"User-Agent": "Pitwall"}), timeout=20) as r:
                    path.write_bytes(r.read())
            except Exception as e:  # noqa: BLE001
                raise TTSError(f"não deu para baixar a amostra: {e}")
        return _decode_mp3(path.read_bytes())

    def synth(self, text: str, name: str, rate_pct: int = 100) -> tuple[np.ndarray, int]:
        if not self.lib_ok():
            raise TTSError("o pacote piper-tts não está instalado")
        if not self.installed(name):
            raise TTSError("a voz Piper ainda não foi baixada")
        from piper import PiperVoice
        try:
            from piper.config import SynthesisConfig
        except Exception:  # noqa: BLE001
            SynthesisConfig = None
        v = self._voices.get(name)
        if v is None:
            v = self._voices[name] = PiperVoice.load(str(self.model_path(name)))
        kw = {}
        if SynthesisConfig is not None:
            kw["syn_config"] = SynthesisConfig(length_scale=100.0 / max(50, min(200, rate_pct)))
        chunks = list(v.synthesize(text, **kw))
        if not chunks:
            raise TTSError("a voz Piper não gerou áudio")
        x = np.concatenate([np.asarray(c.audio_float_array, dtype=np.float32) for c in chunks])
        return x, int(chunks[0].sample_rate)


# ---------------------------------------------------------------- Edge (online) ----------------------------
class EdgeTTS:
    @staticmethod
    def lib_ok() -> bool:
        try:
            import edge_tts  # noqa: F401
            return True
        except Exception:  # noqa: BLE001
            return False

    def synth(self, text: str, voice: str, rate_pct: int = 100) -> tuple[np.ndarray, int]:
        if not self.lib_ok():
            raise TTSError("o pacote edge-tts não está instalado")
        import edge_tts
        rate = f"{int(rate_pct) - 100:+d}%"

        async def run():
            comm = edge_tts.Communicate(text, voice, rate=rate)
            buf = bytearray()
            async for ch in comm.stream():
                if ch["type"] == "audio":
                    buf += ch["data"]
            return bytes(buf)

        try:
            mp3 = asyncio.run(asyncio.wait_for(run(), timeout=9))
        except Exception as e:  # noqa: BLE001
            raise TTSError(f"voz online indisponível: {e}")
        if not mp3:
            raise TTSError("a voz online não devolveu áudio")
        return _decode_mp3(mp3)


def _decode_mp3(mp3: bytes) -> tuple[np.ndarray, int]:
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:  # noqa: BLE001
        raise TTSError(f"sem ffmpeg para decodificar a voz online: {e}")
    p = subprocess.run([exe, "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "24000", "pipe:1"],
                       input=mp3, capture_output=True, creationflags=NOWIN, timeout=20)
    if p.returncode != 0 or not p.stdout:
        raise TTSError("não consegui decodificar o áudio da voz online")
    return np.frombuffer(p.stdout, dtype="<i2").astype(np.float32) / 32768.0, 24000


# ---------------------------------------------------------------- gerenciador -------------------------------
class TTS:
    def __init__(self, settings, root: Path):
        self.settings = settings
        self.root = root
        self.cache_dir = root / "cache"
        self.win = WindowsTTS(root)
        self.piper = PiperTTS(root)
        self.edge = EdgeTTS()
        self.last_engine = ""
        self.last_error = ""
        self._online_fail_until = 0.0

    def _cfg(self, k, d=""):
        v = self.settings.get(k) if self.settings else None
        return d if v in (None, "") else v

    def order(self) -> list[str]:
        mode = self._cfg("eng_voice_mode", "offline")
        off = self._cfg("eng_offline_engine", "piper")
        offline = [off, "windows" if off == "piper" else "piper"]
        return (["edge"] + offline) if mode == "online" else offline

    def _voice_for(self, eng: str) -> str:
        if eng == "edge":
            return self._cfg("eng_edge_voice", EDGE_VOICES[0][0])
        if eng == "piper":
            return self._cfg("eng_piper_voice", PIPER_VOICES[0][0])
        return self._cfg("eng_win_voice", "")

    def _usable(self, eng: str) -> bool:
        if eng == "edge":
            return self.edge.lib_ok() and time.monotonic() >= self._online_fail_until
        if eng == "piper":
            return self.piper.lib_ok() and self.piper.installed(self._voice_for("piper"))
        return self.win.available()

    def _path(self, eng: str, voice: str, rate: int, text: str) -> Path:
        h = hashlib.sha1(f"{eng}|{voice}|{rate}|{text}".encode("utf-8")).hexdigest()[:20]
        return self.cache_dir / f"{eng}_{h}.wav"

    def synth(self, text: str) -> tuple[np.ndarray, int]:
        rate = int(self._cfg("eng_rate", 100))
        errs = []
        for eng in self.order():
            voice = self._voice_for(eng)
            cp = self._path(eng, voice, rate, text)
            if cp.exists():                                    # cache vale mesmo sem internet
                try:
                    x, sr = _read_wav(cp)
                    self.last_engine = eng
                    return x, sr
                except Exception:  # noqa: BLE001
                    pass
            if not self._usable(eng):
                continue
            try:
                if eng == "edge":
                    x, sr = self.edge.synth(text, voice, rate)
                elif eng == "piper":
                    x, sr = self.piper.synth(text, voice, rate)
                else:
                    x, sr = self.win.synth(text, voice, rate)
            except TTSError as e:
                errs.append(f"{eng}: {e}")
                if eng == "edge":
                    self._online_fail_until = time.monotonic() + 60       # sem internet: não tenta de novo por 1 min
                continue
            x = _trim(x, sr)
            try:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                _write_wav(cp, x, sr)
            except OSError:
                pass
            self.last_engine, self.last_error = eng, ""
            return x, sr
        self.last_error = "; ".join(errs) or "nenhuma voz disponível"
        raise TTSError(self.last_error)

    def cached(self, text: str) -> bool:
        rate = int(self._cfg("eng_rate", 100))
        return any(self._path(e, self._voice_for(e), rate, text).exists() for e in self.order())

    def status(self) -> dict:
        return {
            "order": self.order(), "last_engine": self.last_engine, "last_error": self.last_error,
            "edge": {"lib": self.edge.lib_ok(), "voices": [{"id": i, "name": n} for i, n in EDGE_VOICES]},
            "piper": {"lib": self.piper.lib_ok(), "progress": self.piper.progress,
                      "voices": [{"id": i, "name": n, "installed": self.piper.installed(i)} for i, n, _ in PIPER_VOICES]},
            "windows": {"available": self.win.available(), "voices": self.win._voices if self.win._voices is not None else None},
        }

    def close(self):
        self.win.close()
