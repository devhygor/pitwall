"""Gravação de vídeo da tela sincronizada com a telemetria.

Usa o ffmpeg (do pacote imageio-ffmpeg, ou o do PATH). No Windows a captura é
feita pela GPU com o filtro `ddagrab` (Desktop Duplication) e codificada em
hardware (NVENC na NVIDIA, AMF na AMD). Se nenhum funcionar e o usuário
escolher "cpu", usa libx264 em 720p.

Sincronia: o ffmpeg informa (via -progress) quanto vídeo já foi gravado; com o
relógio do PC sabemos a hora exata do primeiro frame (`video_start`). Cada volta
guarda a hora em que começou (`start_wall`), então:

    posição no vídeo = start_wall - video_start + tempo_na_volta
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from .db import DB, data_dir
from .settings import Settings

IS_WIN = sys.platform == "win32"
NO_WINDOW = 0x08000000 if IS_WIN else 0   # CREATE_NO_WINDOW


def find_ffmpeg() -> Optional[str]:
    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        if p and Path(p).exists():
            return p
    except Exception:
        pass
    return shutil.which("ffmpeg")


def _input_and_codec(kind: str, monitor: int, fps: int, br: int) -> list[str]:
    dda = ["-f", "lavfi", "-i", f"ddagrab=output_idx={monitor}:framerate={fps}:draw_mouse=0"]
    gop = ["-g", str(fps)]          # 1 quadro-chave por segundo: busca rápida no player
    if kind == "nvenc":
        return dda + ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-b:v", f"{br}M",
                      "-maxrate", f"{int(br * 1.5)}M", *gop]
    if kind == "amf":
        return dda + ["-c:v", "h264_amf", "-quality", "speed", "-rc", "vbr_peak", "-b:v", f"{br}M",
                      "-maxrate", f"{int(br * 1.5)}M", *gop]
    if kind == "cpu":
        return dda + ["-vf", "hwdownload,format=bgra,scale=1280:-2,format=yuv420p",
                      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                      "-b:v", f"{min(br, 4)}M", *gop]
    if kind == "fake":   # só para testes fora do Windows
        return ["-re", "-f", "lavfi", "-i", f"testsrc=size=640x360:rate={fps}",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", *gop]
    raise ValueError(kind)


class VideoRecorder:
    def __init__(self, db: DB, settings: Settings, videos_dir: Path | None = None):
        self.db = db
        self.settings = settings
        self.dir = Path(videos_dir) if videos_dir else data_dir() / "videos"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg = find_ffmpeg()
        self.status: dict = {"ffmpeg": self.ffmpeg, "selected": None, "tested": {}, "probing": False}
        self._proc: Optional[subprocess.Popen] = None
        self._session_id: Optional[int] = None
        self._path: Optional[Path] = None
        self._start_est: Optional[float] = None
        self._err_tail: list[str] = []
        self._retries = 0
        self._waiting_session: Optional[int] = None   # sessão que começou antes do teste terminar
        self._lock = threading.Lock()

    # --- detecção do encoder ----------------------------------------------
    def candidates(self) -> list[str]:
        if os.environ.get("PITWALL_FAKE_VIDEO"):
            return ["fake"]
        if not IS_WIN:
            return []
        pref = self.settings.get("video_encoder")
        # "auto" termina na CPU: PCs sem NVIDIA/AMD (Intel, notebook híbrido) também gravam
        return {"auto": ["nvenc", "amf", "cpu"], "nvenc": ["nvenc", "cpu"], "amf": ["amf", "cpu"],
                "cpu": ["cpu"]}.get(pref, ["nvenc", "amf", "cpu"])

    def probe(self):
        """Testa cada opção por ~1,5 s e escolhe a primeira que funcionar."""
        self.status.update(probing=True, selected=None, tested={})
        if not self.ffmpeg:
            self.status.update(probing=False, error="ffmpeg não encontrado")
            return
        mon, fps = self.settings.get("video_monitor"), self.settings.get("video_fps")
        br = self.settings.get("video_bitrate_mbps")
        for kind in self.candidates():
            cmd = [self.ffmpeg, "-hide_banner", "-loglevel", "error",
                   *_input_and_codec(kind, mon, fps, br), "-t", "1.5", "-f", "null", "-"]
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=20, creationflags=NO_WINDOW)
                ok = r.returncode == 0
                msg = r.stderr.decode(errors="replace").strip().splitlines()[-1:] if not ok else []
            except Exception as e:  # noqa: BLE001
                ok, msg = False, [str(e)]
            self.status["tested"][kind] = "ok" if ok else (msg[0] if msg else "falhou")
            if ok:
                self.status["selected"] = kind
                break
        if not self.status["selected"]:
            self.status["error"] = "nenhum encoder funcionou" if self.candidates() else \
                "gravação de vídeo só funciona no Windows"
        else:
            self.status.pop("error", None)
        self.status["probing"] = False
        if self.status["selected"] and self._waiting_session is not None:
            sid, self._waiting_session = self._waiting_session, None
            self.start(sid)

    def probe_async(self):
        threading.Thread(target=self.probe, daemon=True).start()

    # --- gravação ----------------------------------------------------------
    @property
    def recording(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def start(self, session_id: int):
        with self._lock:
            if self.recording or not self.settings.get("video_enabled"):
                return
            kind = self.status.get("selected")
            if not kind or not self.ffmpeg:
                if self.status.get("probing") or not self.status.get("tested"):
                    self._waiting_session = session_id
                return
            self._session_id = session_id
            self._retries = 0
            self._spawn(kind, self.dir / f"session_{session_id}.mkv")

    def _spawn(self, kind: str, path: Path):
        self._path = path
        self._start_est = None
        self._err_tail = []
        cmd = [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats",
               *_input_and_codec(kind, self.settings.get("video_monitor"),
                                 self.settings.get("video_fps"),
                                 self.settings.get("video_bitrate_mbps")),
               "-an", "-progress", "pipe:1", "-stats_period", "0.25", "-y", str(path)]
        self._proc = proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                             stderr=subprocess.PIPE, creationflags=NO_WINDOW)
        sid = self._session_id
        threading.Thread(target=self._read_progress, args=(proc, sid), daemon=True).start()
        threading.Thread(target=self._read_errors, args=(proc,), daemon=True).start()
        threading.Thread(target=self._watch, args=(proc, sid, kind), daemon=True).start()

    def _watch(self, proc: subprocess.Popen, session_id: int, kind: str):
        """Se o ffmpeg morrer sozinho no meio da sessão (ex.: jogo trocou de modo de tela),
        registra o motivo e tenta de novo. As voltas seguintes sincronizam com o novo arquivo."""
        code = proc.wait()
        time.sleep(0.5)   # deixa a leitura do stderr terminar
        with self._lock:
            if self._proc is not proc:       # parada normal (stop) ou já substituído
                return
            err = " | ".join(self._err_tail) or "sem mensagem"
            msg = f"ffmpeg encerrou sozinho (código {code}): {err}"
            self.status["last_error"] = msg
            _log(self.dir, f"sessão {session_id} [{kind}] {msg}")
            if self._retries >= 3:
                return
            self._retries += 1
            old = self._path
            try:
                self._spawn(kind, self.dir / f"session_{session_id}_{self._retries}.mkv")
            except Exception as e:  # noqa: BLE001
                _log(self.dir, f"falha ao reiniciar: {e}")
                return
        if old and old.exists() and old.stat().st_size < 100_000:
            _rm(old)

    def _read_progress(self, proc: subprocess.Popen, session_id: int):
        readings = 0
        for raw in proc.stdout:
            line = raw.decode(errors="replace").strip()
            if not line.startswith("out_time_us="):
                continue
            try:
                us = int(line.split("=", 1)[1])
            except ValueError:
                continue
            if us <= 0:
                continue
            est = time.time() - us / 1e6
            # o menor valor é o mais próximo do real (as leituras só chegam atrasadas)
            if self._start_est is None or est < self._start_est:
                self._start_est = est
            readings += 1
            if readings in (4, 40):
                self.db.set_session_video(session_id, video_path=str(self._path),
                                          video_start=self._start_est)

    def _read_errors(self, proc: subprocess.Popen):
        for raw in proc.stderr:
            self._err_tail = (self._err_tail + [raw.decode(errors="replace").strip()])[-5:]

    def stop(self):
        self._waiting_session = None
        with self._lock:
            proc, sid, path, start = self._proc, self._session_id, self._path, self._start_est
            self._proc = None
            if proc is None:
                return
        try:
            if proc.poll() is None:
                proc.stdin.write(b"q")
                proc.stdin.flush()
            proc.wait(timeout=15)
        except Exception:  # noqa: BLE001
            proc.kill()
        if self._err_tail:
            self.status["last_error"] = " | ".join(self._err_tail)
            _log(self.dir, f"sessão {sid} ao parar: {self.status['last_error']}")
        if start is None:
            _log(self.dir, f"sessão {sid}: nenhum quadro gravado, vídeo descartado")
        threading.Thread(target=self._finalize, args=(sid, path, start), daemon=True).start()

    def _finalize(self, session_id: int, mkv: Path, start: Optional[float]):
        """Converte o .mkv (à prova de travamento) para .mp4 (melhor para o navegador)."""
        if not mkv or not mkv.exists() or mkv.stat().st_size == 0 or start is None:
            _rm(mkv)
            return
        if self.db.session(session_id) is None:     # sessão descartada (sem voltas)
            _rm(mkv)
            return
        mp4 = mkv.with_suffix(".mp4")
        r = subprocess.run([self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mkv),
                            "-c", "copy", "-movflags", "+faststart", str(mp4)],
                           capture_output=True, creationflags=NO_WINDOW)
        if r.returncode == 0 and mp4.exists():
            _rm(mkv)
            self.db.set_session_video(session_id, video_path=str(mp4), video_start=start)
        else:
            self.db.set_session_video(session_id, video_path=str(mkv), video_start=start)
        self.cleanup()

    def recover(self):
        """Converte vídeos que ficaram em .mkv (app fechado no meio da sessão)."""
        for s in self.db.sessions_with_video():
            p = Path(s["video_path"])
            if p.suffix == ".mkv" and p.exists() and not self.recording:
                sess = self.db.session(s["id"])
                if sess and sess.get("video_start"):
                    self._finalize(s["id"], p, sess["video_start"])

    def cleanup(self):
        keep = max(1, self.settings.get("video_keep_sessions"))
        for s in self.db.sessions_with_video()[keep:]:
            _rm(Path(s["video_path"]))
            self.db.set_session_video(s["id"], video_path=None)

    def delete_for(self, video_path: Optional[str]):
        if video_path:
            _rm(Path(video_path))
            _rm(Path(video_path).with_suffix(".mkv"))


def _log(folder: Path, text: str):
    """Registro simples para diagnóstico (videos/video.log)."""
    try:
        with open(folder / "video.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
    except OSError:
        pass


def _rm(p: Optional[Path]):
    try:
        if p and p.exists():
            p.unlink()
    except OSError:
        pass
