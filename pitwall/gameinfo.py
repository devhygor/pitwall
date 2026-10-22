"""Versão do jogo (ACC) vista pelo Pitwall: lida da memória compartilhada quando o jogo está aberto e lembrada depois,
para os nomes dos setups gerados trazerem a versão (os setups mudam de comportamento entre atualizações do jogo)."""
from __future__ import annotations

import json
import re

from .db import data_dir

_cache: dict = {}


def _file():
    return data_dir() / "game_version.json"


def set_version(game: str, raw) -> None:
    v = str(raw or "").split("\x00")[0].strip()
    if not re.match(r"^\d+(\.\d+)+", v) or _cache.get(game) == v:
        return
    _cache[game] = v
    try:
        d = json.loads(_file().read_text(encoding="utf-8")) if _file().exists() else {}
        d[game] = v
        _file().write_text(json.dumps(d), encoding="utf-8")
    except (OSError, ValueError):
        pass


def get_version(game: str = "acc") -> str:
    if game in _cache:
        return _cache[game]
    try:
        return str(json.loads(_file().read_text(encoding="utf-8")).get(game) or "")
    except (OSError, ValueError):
        return ""


def short(game: str = "acc") -> str:
    """Só 'major.minor' (1.10.2 -> 1.10): é o que costuma mudar o comportamento dos setups."""
    m = re.match(r"^(\d+)\.(\d+)", get_version(game))
    return f"{m.group(1)}.{m.group(2)}" if m else ""
