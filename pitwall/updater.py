"""Atualização do app: consulta a última versão publicada no GitHub (Releases),
baixa o instalador e executa. O instalador fecha o Pitwall, atualiza e reabre."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

REPO = "devhygor/pitwall"
API = f"https://api.github.com/repos/{REPO}/releases/latest"
ASSET = "Pitwall-Setup.exe"
CACHE_S = 1800

try:
    from ._version import __version__
except Exception:  # noqa: BLE001
    __version__ = "dev"

_cache: dict = {"at": 0.0, "data": None}
_dl: dict = {"state": "idle"}
_lock = threading.Lock()


def _parse(v: str):
    try:
        return tuple(int(p) for p in v.lstrip("v").split("."))
    except ValueError:
        return None


def check(force: bool = False) -> dict:
    """{current, latest, available, url, notes}. Em modo dev (sem versão) nunca oferece."""
    out = {"current": __version__, "available": False, "frozen": bool(getattr(sys, "frozen", False))}
    with _lock:
        if not force and _cache["data"] is not None and time.time() - _cache["at"] < CACHE_S:
            rel = _cache["data"]
        else:
            try:
                req = urllib.request.Request(API, headers={"User-Agent": "Pitwall", "Accept": "application/vnd.github+json"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    rel = json.load(r)
                _cache.update(at=time.time(), data=rel)
            except Exception as e:  # noqa: BLE001
                out["error"] = str(e)
                return out
    latest = str(rel.get("tag_name", ""))
    url = next((a["browser_download_url"] for a in rel.get("assets", []) if a.get("name") == ASSET), None)
    out.update(latest=latest.lstrip("v"), url=url, notes=rel.get("body") or "", page=rel.get("html_url"))
    cur, new = _parse(__version__), _parse(latest)
    out["available"] = bool(cur and new and new > cur and url)
    return out


def download_and_run() -> dict:
    info = check()
    if not info.get("available"):
        return {"state": "error", "error": "nenhuma atualização disponível"}
    if _dl.get("state") == "downloading":
        return _dl
    _dl.clear()
    _dl.update(state="downloading", pct=0)

    def work():
        try:
            dest = Path(tempfile.mkdtemp(prefix="pitwall-update-")) / ASSET
            req = urllib.request.Request(info["url"], headers={"User-Agent": "Pitwall"})
            with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                while chunk := r.read(1 << 18):
                    f.write(chunk)
                    got += len(chunk)
                    if total:
                        _dl["pct"] = int(got * 100 / total)
            _dl.update(state="installing", pct=100)
            # /SILENT: mostra só o progresso; o instalador fecha o app e reabre no fim
            subprocess.Popen([str(dest), "/SILENT", "/SUPPRESSMSGBOXES"], close_fds=True)
            time.sleep(1.5)
            os._exit(0)
        except Exception as e:  # noqa: BLE001
            _dl.update(state="error", error=str(e))

    threading.Thread(target=work, daemon=True).start()
    return _dl


def progress() -> dict:
    return dict(_dl)
