"""Armazenamento em SQLite. A telemetria de cada volta fica num BLOB
(JSON comprimido com zlib, em colunas), o que mantém o banco pequeno e simples."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import zlib
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY,
    game          TEXT NOT NULL DEFAULT 'acc',
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    session_type  TEXT,
    track         TEXT,
    car           TEXT,
    player        TEXT
);
CREATE TABLE IF NOT EXISTS laps (
    id            INTEGER PRIMARY KEY,
    session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    lap_number    INTEGER NOT NULL,
    stint         INTEGER NOT NULL DEFAULT 1,
    lap_time_ms   INTEGER NOT NULL,
    s1_ms         INTEGER,
    s2_ms         INTEGER,
    s3_ms         INTEGER,
    valid         INTEGER NOT NULL DEFAULT 1,
    out_lap       INTEGER NOT NULL DEFAULT 0,
    in_lap        INTEGER NOT NULL DEFAULT 0,
    fuel_start    REAL,
    fuel_end      REAL,
    fuel_used     REAL,
    air_temp      REAL,
    road_temp     REAL,
    grip          TEXT,
    tyre_temp     TEXT,   -- JSON [FL, FR, RL, RR] média da volta
    tyre_press    TEXT,   -- JSON [FL, FR, RL, RR] média da volta
    recorded_at   TEXT NOT NULL,
    telemetry     BLOB
);
CREATE INDEX IF NOT EXISTS ix_laps_session ON laps(session_id);
CREATE TABLE IF NOT EXISTS setups (
    id            INTEGER PRIMARY KEY,
    sha1          TEXT UNIQUE NOT NULL,   -- conteúdo idêntico = mesmo setup (evita duplicados)
    car           TEXT NOT NULL,
    track         TEXT NOT NULL,
    name          TEXT NOT NULL,
    source        TEXT,                   -- "GO Setups", "Pitwall", "Meu"
    version       TEXT,                   -- ex.: 1.10.3 (setups GO)
    kind          TEXT,                   -- Q (classificação) / R (corrida)
    variant       TEXT,                   -- Esport, Safe, Hybrid, Wet, LFM...
    temp_c        INTEGER,                -- temperatura indicada no nome (ex.: 28C)
    rel_path      TEXT,                   -- onde está na pasta do ACC
    content       TEXT NOT NULL,          -- o JSON do setup
    file_mtime    REAL,
    imported_at   TEXT NOT NULL,
    notes         TEXT
);
CREATE INDEX IF NOT EXISTS ix_setups_car_track ON setups(car, track);
"""


def data_dir() -> Path:
    base = os.environ.get("PITWALL_HOME") or os.environ.get("LOCALAPPDATA") \
        or str(Path.home() / ".local" / "share")
    p = Path(base) if os.environ.get("PITWALL_HOME") else Path(base) / "Pitwall"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_db_path() -> Path:
    return data_dir() / "pitwall.db"


# só as suas sessões (exclui volta ideal e voltas de companheiros)
OWN = "COALESCE(s.kind, 'own') = 'own'"

# colunas adicionadas depois da primeira versão (migração simples)
MIGRATIONS = {
    "sessions": {"video_path": "TEXT", "video_start": "REAL", "video_offset": "REAL DEFAULT 0",
                 "setup_path": "TEXT", "setup_id": "INTEGER",
                 "kind": "TEXT DEFAULT 'own'",      # own = suas voltas; ideal = volta ideal; team = de companheiro
                 "suggested_setup_id": "INTEGER", "remote_id": "TEXT",
                 "setup_src": "TEXT",               # manual (escolhido pelo piloto) | auto (reconhecido pelo Pitwall) | skip (piloto disse que não sabe)
                 "setup_ask": "TEXT",               # JSON: ids dos setups candidatos quando o Pitwall não teve certeza
                 "setup_fp": "TEXT"},               # JSON: o que a telemetria mostrou com o carro parado (para conferir/calibrar)
    "setups": {"content_changed_at": "TEXT",      # quando o conteúdo mudou (atualização no próprio arquivo); voltas anteriores são de outro conteúdo
               "prev_content": "TEXT"},           # JSON do conteúdo antes da última atualização (base das análises antigas)
    "laps": {"start_wall": "REAL", "brake_temp": "TEXT", "susp_max": "TEXT",
             "events": "TEXT"},                       # JSON: incidentes da volta [{type, d, ...}]
}


def pack(columns: dict) -> bytes:
    return zlib.compress(json.dumps(columns, separators=(",", ":")).encode(), 6)


def unpack(blob: bytes | None) -> dict:
    if not blob:
        return {}
    return json.loads(zlib.decompress(blob))


class DB:
    def __init__(self, path: Path | str | None = None):
        self.path = str(path or default_db_path())
        self._lock = threading.Lock()
        with self.connect() as c:
            c.executescript(SCHEMA)
            for table, cols in MIGRATIONS.items():
                have = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
                for col, typ in cols.items():
                    if col not in have:
                        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")

    def connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        return c

    # --- escrita -----------------------------------------------------------
    def create_session(self, **kw) -> int:
        with self._lock, self.connect() as c:
            cur = c.execute(
                "INSERT INTO sessions (game, started_at, session_type, track, car, player)"
                " VALUES (:game, :started_at, :session_type, :track, :car, :player)", kw)
            return cur.lastrowid

    def end_session(self, session_id: int, ended_at: str):
        with self._lock, self.connect() as c:
            c.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (ended_at, session_id))
            # sessão sem nenhuma volta não serve pra nada
            c.execute("DELETE FROM sessions WHERE id = ? AND NOT EXISTS"
                      " (SELECT 1 FROM laps WHERE session_id = ?)", (session_id, session_id))

    def insert_lap(self, **kw) -> int:
        kw = dict(kw)
        kw["telemetry"] = pack(kw.get("telemetry") or {})
        kw["tyre_temp"] = json.dumps(kw.get("tyre_temp"))
        kw["tyre_press"] = json.dumps(kw.get("tyre_press"))
        for k in ("brake_temp", "susp_max", "events"):
            if k in kw:
                kw[k] = json.dumps(kw[k])
        cols = ", ".join(kw)
        vals = ", ".join(":" + k for k in kw)
        with self._lock, self.connect() as c:
            return c.execute(f"INSERT INTO laps ({cols}) VALUES ({vals})", kw).lastrowid

    def delete_session(self, session_id: int) -> str | None:
        """Apaga a sessão e devolve o caminho do vídeo (se houver) para o chamador remover."""
        with self._lock, self.connect() as c:
            r = c.execute("SELECT video_path FROM sessions WHERE id = ?", (session_id,)).fetchone()
            c.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return r["video_path"] if r else None

    def set_session_video(self, session_id: int, **kw):
        sets = ", ".join(f"{k} = :{k}" for k in kw)
        with self._lock, self.connect() as c:
            c.execute(f"UPDATE sessions SET {sets} WHERE id = :id", {**kw, "id": session_id})

    def sessions_with_video(self) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("SELECT id, video_path FROM sessions WHERE video_path IS NOT NULL"
                             " ORDER BY started_at DESC, id DESC").fetchall()
        return [dict(r) for r in rows]

    def car_track_stats(self) -> list[dict]:
        """Médias por carro+pista (voltas limpas), para pré-preencher a estratégia."""
        with self.connect() as c:
            rows = c.execute("""
                SELECT s.track, s.car, COUNT(*) AS laps,
                       AVG(l.lap_time_ms) AS avg_ms, MIN(l.lap_time_ms) AS best_ms,
                       AVG(l.fuel_used) AS fuel_per_lap, MAX(s.started_at) AS last_at
                FROM laps l JOIN sessions s ON s.id = l.session_id
                WHERE l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0 AND COALESCE(s.kind, 'own') = 'own'
                GROUP BY s.track, s.car ORDER BY last_at DESC""").fetchall()
        return [dict(r) for r in rows]

    # --- leitura -----------------------------------------------------------
    def sessions(self) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("""
                SELECT s.*, COUNT(l.id) AS laps,
                       MIN(CASE WHEN l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0
                                THEN l.lap_time_ms END) AS best_ms
                FROM sessions s LEFT JOIN laps l ON l.session_id = s.id
                WHERE COALESCE(s.kind, 'own') = 'own'
                GROUP BY s.id HAVING COUNT(l.id) > 0
                ORDER BY s.started_at DESC, s.id DESC""").fetchall()
        return [dict(r) for r in rows]

    # --- recordes pessoais ---------------------------------------------------
    def personal_bests(self) -> dict:
        """Melhor volta limpa (válida, sem box) de cada carro em cada pista."""
        with self.connect() as c:
            rows = c.execute("""
                SELECT l.id AS lap_id, l.session_id, l.lap_number, l.lap_time_ms, s.car, s.track, s.started_at
                FROM laps l JOIN sessions s ON s.id = l.session_id
                WHERE l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0 AND COALESCE(s.kind, 'own') = 'own'
                ORDER BY l.lap_time_ms ASC, l.id ASC""").fetchall()
        out: dict = {}
        for r in rows:
            out.setdefault((r["car"], r["track"]), dict(r))
        return out

    def set_lap_valid(self, lap_id: int, valid: bool, reason: str | None = None):
        """Marca uma volta como válida/inválida. `reason` (detecção automática) vira um evento da volta."""
        with self._lock, self.connect() as c:
            row = c.execute("SELECT events FROM laps WHERE id = ?", (lap_id,)).fetchone()
            if row is None:
                return
            try:
                ev = json.loads(row["events"] or "[]")
            except (TypeError, ValueError):
                ev = []
            if reason and not valid:
                ev.append({"type": "invalid", "d": 1.0, "t": None, "why": reason})
            c.execute("UPDATE laps SET valid = ?, events = ? WHERE id = ?", (1 if valid else 0, json.dumps(ev), lap_id))

    def pb_for(self, car: str, track: str) -> dict | None:
        return self.personal_bests().get((car, track))

    def demo_session_ids(self) -> list[int]:
        """Sessões do simulador (modo demo/--seed-demo), inclusive volta ideal/equipe em pista demo."""
        with self.connect() as c:
            return [r[0] for r in c.execute(
                r"SELECT id FROM sessions WHERE game = 'demo' OR track LIKE 'demo\_%' ESCAPE '\'")]

    def protected_session_ids(self) -> set:
        """Sessões com recorde pessoal não podem ser apagadas (as de demonstração podem)."""
        demo = set(self.demo_session_ids())
        return {pb["session_id"] for pb in self.personal_bests().values()} - demo

    def session(self, session_id: int) -> dict | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(r) if r else None

    def laps(self, session_id: int) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT * FROM laps WHERE session_id = ? ORDER BY lap_number", (session_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d.pop("telemetry", None)
            d["tyre_temp"] = json.loads(d["tyre_temp"] or "null")
            d["tyre_press"] = json.loads(d["tyre_press"] or "null")
            d["brake_temp"] = json.loads(d.get("brake_temp") or "null")
            d["susp_max"] = json.loads(d.get("susp_max") or "null")
            d["events"] = json.loads(d.get("events") or "[]")
            out.append(d)
        return out

    def lap(self, lap_id: int, with_telemetry: bool = True) -> dict | None:
        with self.connect() as c:
            r = c.execute("""SELECT l.*, s.track, s.car, s.player, s.session_type, s.started_at,
                                    s.video_path, s.video_start, s.video_offset,
                                    COALESCE(s.kind, 'own') AS kind
                             FROM laps l JOIN sessions s ON s.id = l.session_id
                             WHERE l.id = ?""", (lap_id,)).fetchone()
        if not r:
            return None
        d = dict(r)
        blob = d.pop("telemetry", None)
        if with_telemetry:
            d["telemetry"] = unpack(blob)
        d["tyre_temp"] = json.loads(d["tyre_temp"] or "null")
        d["tyre_press"] = json.loads(d["tyre_press"] or "null")
        d["brake_temp"] = json.loads(d.get("brake_temp") or "null")
        d["susp_max"] = json.loads(d.get("susp_max") or "null")
        d["events"] = json.loads(d.get("events") or "[]")
        return d

    def session_laps_full(self, session_id: int) -> list[dict]:
        """Voltas com telemetria (para o engenheiro de setup)."""
        with self.connect() as c:
            ids = [r[0] for r in c.execute("SELECT id FROM laps WHERE session_id = ? ORDER BY lap_number",
                                            (session_id,))]
        return [self.lap(i) for i in ids]

    def set_session_setup(self, session_id: int, setup_id: int | None):
        """Escolha do piloto (vale mais que o reconhecimento automático)."""
        with self._lock, self.connect() as c:
            c.execute("UPDATE sessions SET setup_id = ?, setup_src = ?, setup_ask = NULL WHERE id = ?",
                      (setup_id, "manual" if setup_id else None, session_id))

    def set_detected_setup(self, session_id: int, setup_id: int | None, ask: list, fp: dict):
        """Resultado do reconhecimento: com certeza liga o setup; sem certeza guarda os candidatos para perguntar."""
        import json as _json
        with self._lock, self.connect() as c:
            r = c.execute("SELECT setup_id, setup_src FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not r or r["setup_src"] == "manual":
                return
            if setup_id:
                c.execute("UPDATE sessions SET setup_id = ?, setup_src = 'auto', setup_ask = NULL, setup_fp = ? WHERE id = ?",
                          (setup_id, _json.dumps(fp), session_id))
            elif r["setup_src"] == "auto" and r["setup_id"]:
                c.execute("UPDATE sessions SET setup_fp = ? WHERE id = ?", (_json.dumps(fp), session_id))   # já tinha um certo: não perde
            else:
                c.execute("UPDATE sessions SET setup_ask = ?, setup_fp = ? WHERE id = ? AND COALESCE(setup_src, '') != 'skip'",
                          (_json.dumps(ask) if ask else None, _json.dumps(fp), session_id))

    def skip_session_setup(self, session_id: int):
        with self._lock, self.connect() as c:
            c.execute("UPDATE sessions SET setup_src = 'skip', setup_ask = NULL WHERE id = ? AND setup_id IS NULL", (session_id,))

    def sessions_without_setup(self, days: int = 14, limit: int = 5) -> list[dict]:
        """Suas sessões recentes com voltas limpas e sem setup definido (nem escolhido nem reconhecido), a perguntar ao piloto."""
        with self.connect() as c:
            rows = c.execute("""
                SELECT s.id, s.started_at, s.session_type, s.car, s.track, s.setup_ask, s.suggested_setup_id,
                       SUM(CASE WHEN l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0 THEN 1 ELSE 0 END) AS clean,
                       MIN(CASE WHEN l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0 THEN l.lap_time_ms END) AS best_ms
                FROM sessions s JOIN laps l ON l.session_id = s.id
                WHERE COALESCE(s.kind, 'own') = 'own' AND s.setup_id IS NULL AND COALESCE(s.setup_src, '') != 'skip'
                  AND s.started_at >= date('now', ?)
                GROUP BY s.id HAVING clean > 0 ORDER BY s.started_at DESC LIMIT ?""", (f"-{int(days)} day", limit)).fetchall()
        return [dict(r) for r in rows]

    # --- voltas externas (volta ideal, companheiros de equipe) ----------------
    def replace_external(self, kind: str, car: str, track: str, player: str, started_at: str,
                         lap: dict, remote_id: str | None = None) -> int:
        """Guarda uma volta que não é sua (ou é sintética) numa sessão própria, trocando a anterior
        do mesmo tipo/carro/pista/piloto. Devolve o id da volta."""
        with self._lock, self.connect() as c:
            c.execute("""DELETE FROM sessions WHERE kind = ? AND car = ? AND track = ? AND player = ?""",
                      (kind, car, track, player))
            sid = c.execute("""INSERT INTO sessions (game, started_at, ended_at, session_type, track, car, player,
                                                     kind, remote_id)
                               VALUES ('pitwall', ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (started_at, started_at, "Ideal" if kind == "ideal" else "Equipe", track, car,
                             player, kind, remote_id)).lastrowid
        return self.insert_lap(session_id=sid, **lap)

    def externals(self, kind: str | None = None) -> list[dict]:
        q = """SELECT s.id AS session_id, s.kind, s.car, s.track, s.player, s.started_at, s.remote_id,
                      l.id AS lap_id, l.lap_time_ms
               FROM sessions s JOIN laps l ON l.session_id = s.id
               WHERE COALESCE(s.kind, 'own') != 'own'"""
        args = []
        if kind:
            q += " AND s.kind = ?"
            args.append(kind)
        with self.connect() as c:
            return [dict(r) for r in c.execute(q + " ORDER BY s.track, s.car, l.lap_time_ms", args)]

    def own_laps(self, car: str, track: str, clean_only: bool = True) -> list[dict]:
        """Suas voltas (sem telemetria) de um carro numa pista, em ordem cronológica."""
        q = f"""SELECT l.id, l.session_id, l.lap_number, l.stint, l.lap_time_ms, l.s1_ms, l.s2_ms, l.s3_ms,
                       l.valid, l.out_lap, l.in_lap, l.recorded_at, l.air_temp, l.road_temp, s.started_at,
                       s.session_type
                FROM laps l JOIN sessions s ON s.id = l.session_id
                WHERE s.car = ? AND s.track = ? AND {OWN}"""
        if clean_only:
            q += " AND l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0"
        with self.connect() as c:
            return [dict(r) for r in c.execute(q + " ORDER BY s.started_at, l.lap_number", (car, track))]

    def progress_laps(self) -> list[dict]:
        """Todas as suas voltas (sem telemetria) com jogo, carro, pista e início da sessão, para o resumo de progresso do perfil."""
        with self.connect() as c:
            return [dict(r) for r in c.execute(rf"""
                SELECT l.session_id, l.lap_time_ms, l.valid, l.out_lap, l.in_lap, s.game, s.car, s.track, s.started_at
                FROM laps l JOIN sessions s ON s.id = l.session_id
                WHERE {OWN} AND s.game != 'demo' AND s.track NOT LIKE 'demo\_%' ESCAPE '\'
                ORDER BY s.started_at, l.lap_number""")]

    def all_own_laps_brief(self) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(f"""
                SELECT l.id, l.lap_time_ms, l.valid, l.out_lap, l.in_lap, l.recorded_at, s.car, s.track,
                       s.started_at, s.id AS session_id
                FROM laps l JOIN sessions s ON s.id = l.session_id WHERE {OWN}
                ORDER BY s.started_at, l.lap_number""")]

    def set_suggested_setup(self, session_id: int, setup_id: int | None):
        with self._lock, self.connect() as c:
            c.execute("UPDATE sessions SET suggested_setup_id = ? WHERE id = ?", (setup_id, session_id))

    # --- setups -------------------------------------------------------------
    def upsert_setup(self, **kw) -> tuple[int, bool]:
        """Insere (ou atualiza o caminho de) um setup. Devolve (id, novo?)."""
        with self._lock, self.connect() as c:
            r = c.execute("SELECT id FROM setups WHERE sha1 = ?", (kw["sha1"],)).fetchone()
            if r:
                c.execute("UPDATE setups SET rel_path = COALESCE(:rel_path, rel_path) WHERE id = :id",
                          {"rel_path": kw.get("rel_path"), "id": r["id"]})
                return r["id"], False
            cols = ", ".join(kw)
            cur = c.execute(f"INSERT INTO setups ({cols}) VALUES ({', '.join(':' + k for k in kw)})", kw)
            return cur.lastrowid, True

    def setups_list(self) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("""SELECT id, car, track, name, source, version, kind, variant, temp_c,
                                       rel_path, file_mtime, imported_at
                                FROM setups ORDER BY car, track, name""").fetchall()
        return [dict(r) for r in rows]

    def setup_stats(self) -> dict:
        """Por setup: melhor volta válida sua com ele, quantas voltas e sessões, e quando usou por último.
        Vale o setup escolhido na sessão; sem escolha, o sugerido (então vira estimativa)."""
        with self.connect() as c:
            rows = c.execute("""SELECT COALESCE(s.setup_id, s.suggested_setup_id) AS sid, MIN(l.lap_time_ms) AS best_ms, COUNT(*) AS laps,
                                       COUNT(DISTINCT s.id) AS sessions, MAX(s.started_at) AS last_used,
                                       SUM(CASE WHEN s.setup_id IS NOT NULL THEN 1 ELSE 0 END) AS explicit_laps
                                FROM laps l JOIN sessions s ON s.id = l.session_id
                                WHERE l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0 AND COALESCE(s.kind, 'own') = 'own'
                                  AND COALESCE(s.setup_id, s.suggested_setup_id) IS NOT NULL
                                GROUP BY sid""").fetchall()
        return {r["sid"]: {"best_ms": r["best_ms"], "laps": r["laps"], "sessions": r["sessions"], "last_used": r["last_used"],
                           "estimated": not r["explicit_laps"]} for r in rows}

    def setup_laps(self, setup_id: int) -> list[dict]:
        """Suas voltas limpas feitas com o setup (o escolhido na sessão; sem escolha, o sugerido), em ordem de tempo."""
        with self.connect() as c:
            return [dict(r) for r in c.execute("""
                SELECT l.id, l.session_id, l.lap_number, l.lap_time_ms, l.s1_ms, l.s2_ms, l.s3_ms, l.air_temp, l.road_temp,
                       s.started_at, s.session_type
                FROM laps l JOIN sessions s ON s.id = l.session_id
                WHERE COALESCE(s.setup_id, s.suggested_setup_id) = ? AND COALESCE(s.kind, 'own') = 'own'
                  AND l.valid = 1 AND l.out_lap = 0 AND l.in_lap = 0
                ORDER BY s.started_at, l.lap_number""", (setup_id,))]

    def sessions_using_setup(self, setup_id: int, car: str, track: str, limit: int = 3) -> tuple[list[int], bool]:
        """Últimas sessões em que este setup foi usado; sem nenhuma, as últimas do mesmo carro e pista (assumido=True)."""
        with self.connect() as c:
            ids = [r[0] for r in c.execute("""SELECT id FROM sessions WHERE COALESCE(setup_id, suggested_setup_id) = ? AND COALESCE(kind, 'own') = 'own'
                                              ORDER BY started_at DESC LIMIT ?""", (setup_id, limit))]
            if ids:
                return ids, False
            ids = [r[0] for r in c.execute("""SELECT id FROM sessions WHERE car = ? AND lower(track) = lower(?) AND COALESCE(kind, 'own') = 'own'
                                              ORDER BY started_at DESC LIMIT ?""", (car, track, limit))]
        return ids, True

    def update_setup_content(self, setup_id: int, sha1: str, content: str, file_mtime: float, imported_at: str, notes: str | None = None):
        with self._lock, self.connect() as c:
            c.execute("UPDATE setups SET prev_content = content, content_changed_at = ?, sha1 = ?, content = ?, file_mtime = ?, imported_at = ?,"
                      " notes = COALESCE(?, notes) WHERE id = ?",
                      (imported_at, sha1, content, file_mtime, imported_at, notes, setup_id))

    def sessions_for_evidence(self, car: str, track: str, limit: int = 40) -> list[dict]:
        """Suas sessões recentes (com voltas) neste carro e pista e o setup de cada uma (o escolhido/reconhecido, senão o sugerido)."""
        with self.connect() as c:
            rows = c.execute("""SELECT s.id, s.started_at, COALESCE(s.setup_id, s.suggested_setup_id) AS sid
                                FROM sessions s WHERE s.car = ? AND lower(s.track) = lower(?) AND COALESCE(s.kind, 'own') = 'own'
                                  AND EXISTS (SELECT 1 FROM laps l WHERE l.session_id = s.id)
                                ORDER BY s.started_at DESC LIMIT ?""", (car, track, limit)).fetchall()
        return [dict(r) for r in rows]

    def delete_setup(self, setup_id: int) -> int:
        """Remove o setup; as sessões que o usavam ficam sem setup (as voltas continuam). Devolve quantas sessões foram desligadas."""
        with self._lock, self.connect() as c:
            n = c.execute("SELECT COUNT(*) FROM sessions WHERE setup_id = ? OR suggested_setup_id = ?", (setup_id, setup_id)).fetchone()[0]
            c.execute("UPDATE sessions SET setup_id = NULL WHERE setup_id = ?", (setup_id,))
            c.execute("UPDATE sessions SET suggested_setup_id = NULL WHERE suggested_setup_id = ?", (setup_id,))
            c.execute("DELETE FROM setups WHERE id = ?", (setup_id,))
        return n

    def setup(self, setup_id: int) -> dict | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM setups WHERE id = ?", (setup_id,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["content"] = json.loads(d["content"])
        return d

    def delete_setup(self, setup_id: int):
        with self._lock, self.connect() as c:
            c.execute("DELETE FROM setups WHERE id = ?", (setup_id,))

    def laps_for_track(self, track: str) -> list[dict]:
        with self.connect() as c:
            rows = c.execute("""SELECT l.id, l.session_id, l.lap_number, l.lap_time_ms, l.valid,
                                       l.out_lap, l.in_lap, s.car, s.started_at, s.session_type,
                                       COALESCE(s.kind, 'own') AS kind, s.player
                                FROM laps l JOIN sessions s ON s.id = l.session_id
                                WHERE s.track = ? ORDER BY l.lap_time_ms""", (track,)).fetchall()
        return [dict(r) for r in rows]
