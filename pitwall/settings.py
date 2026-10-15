"""Configurações do usuário (settings.json na pasta de dados)."""
from __future__ import annotations

import json
import threading
from pathlib import Path

from .db import data_dir

DEFAULTS = {
    "video_enabled": True,      # grava a tela durante as sessões
    "video_monitor": 0,         # índice do monitor (0 = principal)
    "video_fps": 30,
    "video_bitrate_mbps": 6,
    "video_encoder": "auto",    # auto | nvenc | amf | cpu
    "video_keep_sessions": 15,  # apaga vídeos de sessões mais antigas que isso
    # backup
    "backup_enabled": True,
    "backup_dir": "",           # vazio = C:\\Users\\<você>\\Pitwall Backups
    "backup_keep": 10,
    "backup_every_hours": 24,
    # setup sugerido pela temperatura
    "setup_temp_basis": "air",  # air = temperatura do ar, track = da pista
    "setup_variant_pref": "",   # ex.: Safe, Esport, LFM (vazio = qualquer)
    # delta ao vivo
    "overlay_enabled": False,
    "overlay_reference": "pb",  # pb = seu recorde; ideal = volta ideal
    # equipe (nuvem do Pitwall, login com Google)
    "cloud_url": "",            # vazio = projeto padrão do Pitwall
    "cloud_key": "",
    "team_auto_upload": True,   # envia seus recordes automaticamente
    "team_share_setup": True,   # envia o setup usado junto com o recorde
    "team_share_clip": True,    # envia um clipe de vídeo (720p) do recorde
    # jogos
    "lfm_user_id": "",          # número ou link do perfil no lowfuelmotorsport.com
    "lfm_alerts_enabled": True,  # toca um som quando o servidor da corrida abre
    "lfm_alert_sound": "ambos",  # motor | largada | ambos
    "lfm_alert_volume": 80,      # 0–100
    "lfm_alert_before_min": 5,   # aviso antes de abrir (0 = desligado)
    "games": "auto",            # auto | acc | iracing
}


class Settings:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else data_dir() / "settings.json"
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        try:
            self._data.update(json.loads(self.path.read_text(encoding="utf-8")))
        except (FileNotFoundError, ValueError):
            pass

    def get(self, key):
        return self._data.get(key, DEFAULTS.get(key))

    def all(self) -> dict:
        return dict(self._data)

    def update(self, values: dict) -> dict:
        with self._lock:
            for k, v in values.items():
                if k not in DEFAULTS:
                    continue
                default = DEFAULTS[k]
                if isinstance(default, bool):
                    v = bool(v)
                elif isinstance(default, int):
                    v = int(v)
                elif isinstance(default, str):
                    v = "" if v is None else str(v)
                self._data[k] = v
            self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        return self.all()
