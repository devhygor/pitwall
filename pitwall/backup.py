"""Backup automático do banco do Pitwall.

Cópia consistente do SQLite (API de backup do próprio SQLite, funciona com o
app rodando) + configurações, num .zip numa pasta local — por padrão
C:/Users/<você>/Pitwall Backups (fora do OneDrive). Copie essa pasta para um
pendrive/HD externo de vez em quando se quiser proteger contra formatação.
Os vídeos não entram (são grandes e descartáveis).
"""
from __future__ import annotations

import datetime as dt
import shutil
import sqlite3
import threading
import time
import zipfile
from pathlib import Path

from .db import data_dir

PREFIX = "pitwall-backup-"


def default_dir() -> Path:
    home = Path.home()
    if home.exists():
        return home / "Pitwall Backups"
    return data_dir() / "backups"


def backup_dir(settings) -> Path:
    custom = (settings.get("backup_dir") or "").strip()
    return Path(custom) if custom else default_dir()


def list_backups(settings) -> list[dict]:
    d = backup_dir(settings)
    if not d.exists():
        return []
    out = []
    for f in sorted(d.glob(f"{PREFIX}*.zip"), reverse=True):
        st = f.stat()
        out.append({"name": f.name, "size": st.st_size, "mtime": st.st_mtime,
                    "when": dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")})
    return out


def run_backup(db_path: str, settings) -> dict:
    target_dir = backup_dir(settings)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp = data_dir() / f"backup-{stamp}.db"
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    zpath = target_dir / f"{PREFIX}{stamp}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, "pitwall.db")
        sp = data_dir() / "settings.json"
        if sp.exists():
            z.write(sp, "settings.json")
    tmp.unlink(missing_ok=True)
    # mantém só os N mais recentes
    keep = max(1, int(settings.get("backup_keep") or 10))
    for old in list_backups(settings)[keep:]:
        try:
            (target_dir / old["name"]).unlink()
        except OSError:
            pass
    return {"name": zpath.name, "path": str(zpath), "size": zpath.stat().st_size}


def schedule_restore(name: str, settings) -> dict:
    """Prepara a restauração; ela é aplicada na próxima vez que o Pitwall abrir."""
    z = backup_dir(settings) / Path(name).name
    if not z.exists():
        raise FileNotFoundError("backup não encontrado")
    with zipfile.ZipFile(z) as zf:
        with zf.open("pitwall.db") as src, open(data_dir() / "restore-pending.db", "wb") as dst:
            shutil.copyfileobj(src, dst)
    return {"ok": True}


def apply_pending_restore(db_path: str) -> bool:
    """Chamado ao iniciar, antes de abrir o banco."""
    pending = data_dir() / "restore-pending.db"
    if not pending.exists():
        return False
    cur = Path(db_path)
    if cur.exists():
        shutil.copy2(cur, cur.with_suffix(".antes-de-restaurar.db"))
        for ext in ("-wal", "-shm"):
            Path(str(cur) + ext).unlink(missing_ok=True)
    shutil.move(str(pending), cur)
    return True


def start_scheduler(db_path: str, settings, log=print):
    """Faz backup quando o último tiver mais de X horas (confere a cada hora)."""
    def loop():
        time.sleep(90)                       # deixa o app abrir em paz
        while True:
            try:
                if settings.get("backup_enabled"):
                    every = float(settings.get("backup_every_hours") or 24) * 3600
                    last = list_backups(settings)
                    if not last or time.time() - last[0]["mtime"] > every:
                        r = run_backup(db_path, settings)
                        log(f"Backup feito: {r['path']}")
            except Exception as e:  # noqa: BLE001
                log(f"Backup falhou: {e}")
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()
