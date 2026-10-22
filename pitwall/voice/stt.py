"""Reconhecimento de fala em português (voz -> texto), 100% no seu computador com o Whisper
(faster-whisper). O modelo é baixado uma vez (base ~145 MB, small ~480 MB) e depois funciona sem internet."""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import numpy as np

MODELS = [("base", "Base (145 MB, mais rápido)"), ("small", "Pequeno (480 MB, mais preciso)"), ("tiny", "Mínimo (75 MB, menos preciso)")]
PROMPT = ("Engenheiro de corrida. Diferença para o carro de trás, o carro da frente, o líder. Combustível, pneus, freios, "
          "melhor volta, última volta, posição, quantas voltas faltam, bandeira, penalidade, box, chuva.")
# frases que o Whisper inventa quando só ouve ruído
HALLUCINATIONS = ("legendas pela comunidade", "amara.org", "obrigado por assistir", "inscreva-se", "tchau tchau", "musica", "www.",
                  "transcricao", "legenda", "ate a proxima")


class STTError(Exception):
    pass


class WhisperSTT:
    def __init__(self, settings, root: Path):
        self.settings = settings
        self.dir = root / "whisper"
        self._model = None
        self._model_name = ""
        self._lock = threading.Lock()
        self._tlock = threading.Lock()
        self.progress = {"state": "idle", "name": "", "error": "", "pct": 0}

    @staticmethod
    def lib_ok() -> bool:
        try:
            import faster_whisper  # noqa: F401
            return True
        except Exception:  # noqa: BLE001
            return False

    def name(self) -> str:
        n = self.settings.get("eng_stt_model") if self.settings else "base"
        return n if n in dict(MODELS) else "base"

    def _folder(self, name: str) -> Path:
        return self.dir / f"models--Systran--faster-whisper-{name}"

    def installed(self, name: str | None = None) -> bool:
        snaps = self._folder(name or self.name()) / "snapshots"
        try:
            return any((s / "model.bin").exists() for s in snaps.iterdir())
        except OSError:
            return False

    def size_mb(self, name: str) -> int:
        f = self._folder(name)
        try:
            return int(sum(p.stat().st_size for p in f.rglob("*") if p.is_file()) / 1e6)
        except OSError:
            return 0

    def remove(self, name: str | None = None):
        import shutil
        name = name or self.name()
        with self._lock:
            if self._model_name == name:
                self._model, self._model_name = None, ""
        shutil.rmtree(self._folder(name), ignore_errors=True)
        if self.progress.get("name") == name:
            self.progress = {"state": "idle", "name": "", "error": "", "pct": 0}

    def download(self, name: str | None = None):
        """Baixa o modelo (bloqueante)."""
        name = name or self.name()
        if not self.lib_ok():
            raise STTError("o pacote faster-whisper não está instalado")
        total = {"tiny": 75, "base": 145, "small": 484}.get(name, 150)
        self.progress = {"state": "baixando", "name": name, "error": "", "pct": 0}
        stop = threading.Event()

        def watch():
            while not stop.is_set():
                self.progress["pct"] = min(99, int(self.size_mb(name) * 100 / total))
                time.sleep(0.7)
        threading.Thread(target=watch, daemon=True).start()
        try:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            from faster_whisper.utils import download_model
            self.dir.mkdir(parents=True, exist_ok=True)
            download_model(name, cache_dir=str(self.dir))
            self.progress = {"state": "pronto", "name": name, "error": "", "pct": 100}
        except Exception as e:  # noqa: BLE001
            self.progress = {"state": "erro", "name": name, "error": str(e), "pct": 0}
            raise STTError(f"não deu para baixar o modelo: {e}")
        finally:
            stop.set()

    def load(self):
        name = self.name()
        with self._lock:
            if self._model is not None and self._model_name == name:
                return self._model
            if not self.lib_ok():
                raise STTError("o pacote faster-whisper não está instalado")
            if not self.installed(name):
                raise STTError("o modelo de reconhecimento de voz ainda não foi baixado")
            from faster_whisper import WhisperModel
            threads = max(2, (os.cpu_count() or 4) // 2)
            self._model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads,
                                       download_root=str(self.dir))
            self._model_name = name
            return self._model

    def transcribe(self, audio: np.ndarray) -> str:
        """audio: float32 mono, 16 kHz."""
        m = self.load()
        with self._tlock:
            return self._run(m, audio)

    def _run(self, m, audio: np.ndarray) -> str:
        segs, _info = m.transcribe(audio, language="pt", beam_size=2, temperature=0.0, vad_filter=False,
                                   condition_on_previous_text=False, initial_prompt=PROMPT, no_speech_threshold=0.55,
                                   without_timestamps=True)
        text = " ".join(s.text.strip() for s in segs if getattr(s, "no_speech_prob", 0) < 0.8).strip()
        low = text.lower()
        if any(h in low for h in HALLUCINATIONS) and len(low) < 60:
            return ""
        return text

    def status(self) -> dict:
        return {"lib": self.lib_ok(), "model": self.name(), "installed": self.installed(), "progress": self.progress,
                "loaded": self._model is not None,
                "models": [{"id": i, "name": n, "installed": self.installed(i), "size_mb": self.size_mb(i)} for i, n in MODELS]}
