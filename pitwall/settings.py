"""Configurações do usuário (settings.json na pasta de dados)."""
from __future__ import annotations

import json
import threading
from pathlib import Path

from .db import data_dir

# Overlays transparentes sobre o jogo. mode: off | game (só na pista) | always
#   scale = tamanho em %, bg = opacidade do fundo (0 = totalmente transparente), x/y = posição na tela
_BASE = {"mode": "off", "scale": 100, "bg": 0, "x": None, "y": None}
OVERLAY_DEFAULTS = {
    "map": {**_BASE, "scale": 110, "bg": 0, "cars": True, "numbers": True, "corners": True, "corner_now": True, "rotate": 0, "width": 9, "banner": True,
            "sectors": True},
    "pedals": {**_BASE, "bg": 25, "seconds": 8, "steer": False, "gear": True, "coast": True, "bars": True, "speed": True},
    "standings": {**_BASE, "bg": 25, "rows": 10, "view": "around", "name": "short",
                  "cols": ["pos", "number", "name", "car", "vs_me", "last", "best"],
                  "group": True, "classpos": True, "header": True, "others": 3, "carstyle": "both", "logomode": "color"},
    "delta": {**_BASE, "bg": 35, "fuel": True, "predicted": True},
    "tyres": {**_BASE, "bg": 25, "temp": True, "press": True, "brake": True, "wear": True, "compound": True, "punit": "psi",
              "tmin": 70, "tmax": 100, "pmin": 26.0, "pmax": 27.0},   # faixas do ACC 1.9+ (todas as classes)
}


def merged_overlays(cur) -> dict:
    out = {}
    cur = cur if isinstance(cur, dict) else {}
    for name, d in OVERLAY_DEFAULTS.items():
        v = cur.get(name) if isinstance(cur.get(name), dict) else {}
        out[name] = {**d, **{k: x for k, x in v.items() if k in d}}
    return out


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
    "overlays": OVERLAY_DEFAULTS,   # mapa, pedais, participantes e delta (ver OVERLAY_DEFAULTS)
    "corner_names": {},         # {pista: {"3": "Eau Rouge"}} - nomes das curvas (o jogo não informa)
    "overlay_edit": False,      # modo de edição: overlays recebem cliques para mover/ver sem o jogo
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
    "lfm_alert_at_zero": True,   # avisa no momento em que o contador zera (servidor abre)
    "lfm_alert_before_min": 5,   # aviso antes de abrir (0 = desligado)
    "games": "auto",            # auto | acc | iracing
}


class Settings:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else data_dir() / "settings.json"
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        saved = {}
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
            self._data.update(saved)
        except (FileNotFoundError, ValueError):
            pass
        legacy = saved.get("overlay_enabled") and "overlays" not in saved
        self._data["overlays"] = merged_overlays(self._data.get("overlays"))
        if legacy:                                  # quem já abria o delta sozinho continua assim
            self._data["overlays"]["delta"]["mode"] = "game"
        self._data["overlay_edit"] = False

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
                if k == "overlays":
                    cur = self._data.get("overlays") or {}
                    v = merged_overlays({n: {**cur.get(n, {}), **(v.get(n) or {})} for n in OVERLAY_DEFAULTS})                         if isinstance(v, dict) else cur
                elif k == "corner_names":
                    cur = dict(self._data.get("corner_names") or {})
                    for tr, names in (v.items() if isinstance(v, dict) else []):
                        clean = {str(n): str(t).strip() for n, t in (names or {}).items() if str(t).strip()}
                        if clean:
                            cur[tr] = clean
                        else:
                            cur.pop(tr, None)
                    v = cur
                elif isinstance(default, bool):
                    v = bool(v)
                elif isinstance(default, int):
                    v = int(v)
                elif isinstance(default, str):
                    v = "" if v is None else str(v)
                self._data[k] = v
            self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        return self.all()
