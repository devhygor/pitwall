"""Biblioteca de setups do Pitwall.

Os setups da pasta do ACC (Documents/Assetto Corsa Competizione/Setups) são
importados para o banco do Pitwall — inclusive os que você comprou (GO Setups),
para uso pessoal. Arquivos de conteúdo idêntico viram um registro só.

Os valores são "cliques" (índices dos menus do jogo). Aqui explicamos cada
parâmetro em português, comparamos setups e geramos setups novos aplicando
ajustes — sempre em arquivo NOVO, nunca sobrescrevendo o original.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

WHEELS = ("DE", "DD", "TE", "TD")   # dianteira esq./dir., traseira esq./dir.


def psi(clicks) -> float:
    """Pressão no ACC: 20,3 psi + 0,1 por clique."""
    return round(20.3 + 0.1 * clicks, 1)


# (caminho, rótulo, grupo, formato, índices)
#  formato: "psi" converte cliques em psi; "+1" mostra a partir de 1; None = cliques
PARAMS = [
    ("basicSetup.tyres.tyrePressure", "Pressão dos pneus (fria)", "Pneus", "psi", None),
    ("basicSetup.tyres.tyreCompound", "Composto (0 = seco, 1 = chuva)", "Pneus", None, None),
    ("basicSetup.alignment.camber", "Cambagem", "Alinhamento", None, None),
    ("basicSetup.alignment.toe", "Convergência", "Alinhamento", None, None),
    ("basicSetup.alignment.casterLF", "Cáster esq.", "Alinhamento", None, None),
    ("basicSetup.alignment.casterRF", "Cáster dir.", "Alinhamento", None, None),
    ("basicSetup.alignment.steerRatio", "Relação de direção", "Alinhamento", None, None),
    ("basicSetup.electronics.tC1", "TC", "Eletrônica", None, None),
    ("basicSetup.electronics.tC2", "TC cut", "Eletrônica", None, None),
    ("basicSetup.electronics.abs", "ABS", "Eletrônica", None, None),
    ("basicSetup.electronics.eCUMap", "Mapa de motor", "Eletrônica", "+1", None),
    ("basicSetup.strategy.fuel", "Combustível (L)", "Estratégia", None, None),
    ("basicSetup.strategy.frontBrakePadCompound", "Pastilha dianteira", "Estratégia", "+1", None),
    ("basicSetup.strategy.rearBrakePadCompound", "Pastilha traseira", "Estratégia", "+1", None),
    ("advancedSetup.mechanicalBalance.aRBFront", "Barra estabilizadora dianteira", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.aRBRear", "Barra estabilizadora traseira", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.wheelRate", "Molas (wheel rate)", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.bumpStopRateUp", "Bump stop (rate)", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.bumpStopWindow", "Bump stop (janela)", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.brakeTorque", "Pressão de freio", "Mecânica", None, None),
    ("advancedSetup.mechanicalBalance.brakeBias", "Viés de freio (cliques, + = frente)", "Mecânica", None, None),
    ("advancedSetup.drivetrain.preload", "Pré-carga do diferencial", "Mecânica", None, None),
    ("advancedSetup.dampers.bumpSlow", "Bump lento", "Amortecedores", None, None),
    ("advancedSetup.dampers.bumpFast", "Bump rápido", "Amortecedores", None, None),
    ("advancedSetup.dampers.reboundSlow", "Rebound lento", "Amortecedores", None, None),
    ("advancedSetup.dampers.reboundFast", "Rebound rápido", "Amortecedores", None, None),
    ("advancedSetup.aeroBalance.rideHeight", "Altura (frente / traseira)", "Aerodinâmica", None, (0, 2)),
    ("advancedSetup.aeroBalance.splitter", "Splitter", "Aerodinâmica", None, None),
    ("advancedSetup.aeroBalance.rearWing", "Asa traseira", "Aerodinâmica", None, None),
    ("advancedSetup.aeroBalance.brakeDuct", "Dutos de freio (frente / traseira)", "Aerodinâmica", None, None),
]
LABELS = {p[0]: p[1] for p in PARAMS}


def setups_root() -> Path:
    env = os.environ.get("PITWALL_SETUPS_DIR")
    if env:
        return Path(env)
    candidates = []
    if sys.platform == "win32":
        try:   # pasta "Documentos" real (pode estar no OneDrive)
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)
            candidates.append(Path(buf.value))
        except Exception:  # noqa: BLE001
            pass
    home = Path.home()
    candidates += [home / "Documents", home / "OneDrive" / "Documents", home / "OneDrive" / "Documentos"]
    for c in candidates:
        p = c / "Assetto Corsa Competizione" / "Setups"
        if p.exists():
            return p
    return candidates[0] / "Assetto Corsa Competizione" / "Setups"


def _get(d: dict, path: str):
    for k in path.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _fmt(v, kind):
    if v is None:
        return None
    if kind == "psi":
        return psi(v)
    if kind == "+1":
        return v + 1
    return v


def describe(setup: dict) -> list[dict]:
    rows = []
    for path, label, group, kind, idx in PARAMS:
        v = _get(setup, path)
        if v is None:
            continue
        if isinstance(v, list):
            vals = [v[i] for i in idx] if idx else v
            names = ["Frente", "Traseira"] if idx or len(vals) == 2 else list(WHEELS[:len(vals)])
            rows.append({"path": path, "label": label, "group": group, "raw": vals,
                         "values": [_fmt(x, kind) for x in vals], "names": names, "unit": "psi" if kind == "psi" else ""})
        else:
            rows.append({"path": path, "label": label, "group": group, "raw": v,
                         "values": [_fmt(v, kind)], "names": [""], "unit": "psi" if kind == "psi" else ""})
    return rows


# ---------------------------------------------------------------------------
# Importação da pasta do ACC para o banco do Pitwall
# ---------------------------------------------------------------------------

_GO = re.compile(r"^GO\s+(?P<ver>[\d.]+)\s+.*?\s(?P<kind>[QR])\s+(?P<rest>.*)$")
_TEMP = re.compile(r"\b(\d{1,2})C\b")


def parse_name(name: str) -> dict:
    """Extrai metadados do nome (padrão dos setups GO: 'GO 1.10.3 ... MON R Safe 28C')."""
    meta = {"source": "Pitwall" if name.startswith("Pitwall") else "Meu",
            "version": None, "kind": None, "variant": None, "temp_c": None}
    t = _TEMP.search(name)
    if t:
        meta["temp_c"] = int(t.group(1))
    m = _GO.match(name)
    if m:
        rest = _TEMP.sub("", m.group("rest")).strip()
        meta.update(source="GO Setups", version=m.group("ver"), kind=m.group("kind"), variant=rest or None)
    else:
        if re.search(r"\bQ\b|quali", name, re.I):
            meta["kind"] = "Q"
        elif re.search(r"\bR\b|race|corrida", name, re.I):
            meta["kind"] = "R"
    return meta


def import_folder(db) -> dict:
    """Copia para o banco todos os setups da pasta do ACC. Arquivos com conteúdo
    idêntico (ex.: as cópias na subpasta "All") viram um registro só."""
    import datetime as dt
    import hashlib
    root = setups_root()
    stats = {"root": str(root), "exists": root.exists(), "found": 0, "new": 0, "errors": 0}
    if not root.exists():
        return stats
    now = dt.datetime.now().isoformat(timespec="seconds")
    for car_dir in (p for p in root.iterdir() if p.is_dir()):
        for track_dir in (p for p in car_dir.iterdir() if p.is_dir()):
            for f in sorted(track_dir.rglob("*.json"), key=lambda p: len(p.parts)):  # pasta principal primeiro
                stats["found"] += 1
                try:
                    raw = f.read_text(encoding="utf-8-sig")
                    content = json.loads(raw)
                except (OSError, ValueError):
                    stats["errors"] += 1
                    continue
                canon = json.dumps(content, sort_keys=True, separators=(",", ":"))
                meta = parse_name(f.stem)
                _, is_new = db.upsert_setup(
                    sha1=hashlib.sha1(canon.encode()).hexdigest(), car=car_dir.name, track=track_dir.name,
                    name=f.stem, rel_path=f.relative_to(root).as_posix(), content=canon,
                    file_mtime=f.stat().st_mtime, imported_at=now, **meta)
                stats["new"] += is_new
    return stats


def library(db) -> dict:
    root = setups_root()
    cars: dict = {}
    for s in db.setups_list():
        s["in_acc"] = bool(s["rel_path"]) and (root / s["rel_path"]).exists()
        cars.setdefault(s["car"], {}).setdefault(s["track"], []).append(s)
    return {"root": str(root), "exists": root.exists(),
            "cars": [{"car": c, "tracks": [{"track": t, "files": fs} for t, fs in sorted(tr.items())]}
                     for c, tr in sorted(cars.items())]}


def load(db, setup_id: int) -> dict:
    s = db.setup(int(setup_id))
    if not s:
        raise FileNotFoundError("setup não encontrado")
    return s


def info(db, setup_id: int) -> dict:
    s = load(db, setup_id)
    content = s.pop("content")
    return {**s, "rows": describe(content)}


def diff(db, id_a: int, id_b: int) -> dict:
    sa, sb = load(db, id_a), load(db, id_b)
    ra, rb = {r["path"]: r for r in describe(sa["content"])}, {r["path"]: r for r in describe(sb["content"])}
    rows = []
    for path, label, group, _, _ in PARAMS:
        x, y = ra.get(path), rb.get(path)
        if not x and not y:
            continue
        rows.append({"path": path, "label": label, "group": group,
                     "names": (x or y)["names"], "unit": (x or y)["unit"],
                     "a": x["values"] if x else None, "b": y["values"] if y else None,
                     "same": bool(x and y and x["raw"] == y["raw"])})
    return {"a": sa["name"], "b": sb["name"], "rows": rows}


def _write_acc(car: str, track: str, stem: str, content: dict) -> Path:
    folder = setups_root() / car / track
    folder.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r'[<>:"/\\|?*]', "-", stem).strip() or "Pitwall"
    target = folder / f"{stem}.json"
    n = 2
    while target.exists():                     # nunca sobrescreve
        target = folder / f"{stem} ({n}).json"
        n += 1
    target.write_text(json.dumps(content, indent="\t"), encoding="utf-8")
    return target


def generate(db, base_id: int, changes: list[dict], name: str | None = None) -> dict:
    """Cria um setup novo a partir de outro + ajustes; salva no banco e na pasta do ACC."""
    import datetime as dt
    import hashlib
    base = load(db, base_id)
    new = apply_changes(base["content"], changes)
    canon = json.dumps(new, sort_keys=True, separators=(",", ":"))
    sha = hashlib.sha1(canon.encode()).hexdigest()
    # já existe um setup idêntico? não cria arquivo repetido
    for s in db.setups_list():
        if s["car"] == base["car"] and s["track"] == base["track"]:
            full = db.setup(s["id"])
            if full and full["sha1"] == sha and s["rel_path"] and (setups_root() / s["rel_path"]).exists():
                return {"id": s["id"], "name": s["name"], "path": str(setups_root() / s["rel_path"]), "already": True}
    stem = name or f"Pitwall - {base['name']}"
    path = _write_acc(base["car"], base["track"], stem, new)
    sid, _ = db.upsert_setup(
        sha1=sha, car=base["car"], track=base["track"], name=path.stem,
        rel_path=path.relative_to(setups_root()).as_posix(), content=canon, file_mtime=path.stat().st_mtime,
        imported_at=dt.datetime.now().isoformat(timespec="seconds"), source="Pitwall",
        version=None, kind=base.get("kind"), variant=None, temp_c=base.get("temp_c"),
        notes=f"Gerado a partir de '{base['name']}'")
    return {"id": sid, "name": path.stem, "path": str(path)}


def save_shared(db, car: str, track: str, name: str, content: dict) -> dict:
    """Guarda um setup recebido da equipe: no banco e na pasta do ACC (sem sobrescrever nada)."""
    import datetime as dt
    import hashlib
    canon = json.dumps(content, sort_keys=True, separators=(",", ":"))
    sha = hashlib.sha1(canon.encode()).hexdigest()
    for s in db.setups_list():
        if s["car"] == car and s["track"] == track:
            full = db.setup(s["id"])
            if full and full["sha1"] == sha:
                return {"id": s["id"], "name": s["name"], "already": True}
    path = _write_acc(car, track, name, content)
    sid, _ = db.upsert_setup(
        sha1=sha, car=car, track=track, name=path.stem, rel_path=path.relative_to(setups_root()).as_posix(),
        content=canon, file_mtime=path.stat().st_mtime, imported_at=dt.datetime.now().isoformat(timespec="seconds"),
        **{**parse_name(name), "source": "Equipe"})
    return {"id": sid, "name": path.stem, "path": str(path)}


def install(db, setup_id: int) -> dict:
    """Grava no ACC um setup que está só no banco (ex.: depois de formatar o PC)."""
    s = load(db, setup_id)
    root = setups_root()
    if s["rel_path"] and (root / s["rel_path"]).exists():
        return {"path": str(root / s["rel_path"]), "already": True}
    path = _write_acc(s["car"], s["track"], s["name"], s["content"])
    db.upsert_setup(sha1=s["sha1"], car=s["car"], track=s["track"], name=s["name"],
                    rel_path=path.relative_to(root).as_posix(), content="", imported_at="")
    return {"path": str(path), "already": False}


_IDX = re.compile(r"^(.*)\[(\d+)\]$")


def get_value(setup: dict, path: str):
    m = _IDX.match(path)
    if m:
        arr = _get(setup, m.group(1))
        i = int(m.group(2))
        return arr[i] if isinstance(arr, list) and i < len(arr) else None
    return _get(setup, path)


def _set(setup: dict, path: str, value):
    m = _IDX.match(path)
    keys = (m.group(1) if m else path).split(".")
    d = setup
    for k in keys[:-1]:
        d = d[k]
    if m:
        d[keys[-1]][int(m.group(2))] = value
    else:
        d[keys[-1]] = value


def apply_changes(setup: dict, changes: list[dict]) -> dict:
    """Aplica deltas em cliques (nunca abaixo de zero). Devolve uma cópia."""
    out = json.loads(json.dumps(setup))
    for ch in changes:
        cur = get_value(out, ch["path"])
        if cur is None or not isinstance(cur, (int, float)):
            continue
        _set(out, ch["path"], max(0, int(round(cur + ch["delta"]))))
    return out


# ---------------------------------------------------------------------------
# Setup sugerido para a sessão (carro, pista, Q/R e temperatura)
# ---------------------------------------------------------------------------

WET_GRIP = ("wet", "damp", "flooded")
Q_TYPES = ("qualify", "superpole", "hotlap", "hotstint")


def _ver(v: str | None) -> tuple:
    try:
        return tuple(int(x) for x in (v or "").split("."))
    except ValueError:
        return ()


def suggest(db, car: str, track: str, session_type: str | None, air: float | None, road: float | None,
            basis: str = "air", variant_pref: str = "", grip: str = "", limit: int = 3) -> list[dict]:
    """Classifica os setups da biblioteca para esta sessão. Devolve os melhores com o motivo."""
    want_q = (session_type or "").lower() in Q_TYPES
    temp = road if basis == "track" else air
    wet = any(w in (grip or "").lower() for w in WET_GRIP)
    out = []
    for s in db.setups_list():
        if s["car"] != car or s["track"].lower() != (track or "").lower():
            continue
        score, why = 0.0, []
        variant = (s["variant"] or "")
        is_wet = "wet" in variant.lower() or "wet" in s["name"].lower()
        if is_wet != wet:
            score -= 300
        elif wet:
            why.append("chuva")
        if s["kind"]:
            if (s["kind"] == "Q") == want_q:
                score += 100
                why.append("classificação" if want_q else "corrida")
            else:
                score -= 60
        else:
            score += 30
        if temp is not None and s["temp_c"] is not None:
            diff = abs(s["temp_c"] - temp)
            score -= 4 * diff
            why.append(f"{s['temp_c']}°C (hoje {temp:.0f}°C)")
        elif temp is not None:
            score -= 20
        if variant_pref and variant_pref.lower() in variant.lower():
            score += 25
            why.append(variant_pref)
        if s["source"] == "Pitwall":
            score += 8                                # ajustado por você
        v = _ver(s["version"])
        score += sum(x / (100 ** i) for i, x in enumerate(v)) * 0.5 if v else 0
        out.append({**s, "score": round(score, 2), "why": why})
    out.sort(key=lambda x: (-x["score"], x["name"]))
    return out[:limit]
