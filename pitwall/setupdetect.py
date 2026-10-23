"""Reconhece sozinho qual setup está carregado no ACC.

O ACC não diz o nome do setup, mas com o carro parado (garagem, box ou grid) a telemetria mostra o que ele
define: a pressão FRIA dos quatro pneus (20,3 psi + 0,1 por clique), o nível de TC, de TC cut, de ABS e o mapa do
motor. Comparamos isso com os setups da biblioteca do mesmo carro e pista:

* um só combina  -> ligamos a sessão a ele (marcado como "automático"; a escolha manual sempre manda);
* vários ou nenhum combina de perto -> guardamos os candidatos e o Pitwall pergunta ao piloto qual era.

O que foi visto fica em `sessions.setup_fp` (para conferir e calibrar depois).
"""
from __future__ import annotations

import json
import time

from .setups import _get, psi

PRESS_TOL = 0.30          # soma máxima (psi) das diferenças dos quatro pneus para contar como "combina"
STABLE_S = 1.2            # tempo parado e estável antes de confiar nas leituras
ASK_LIMIT = 5

# leitura da telemetria -> caminho no JSON do setup (o nível mostrado pode ser o valor do arquivo ou +1)
_ELEC = (("tc", "basicSetup.electronics.tC1"), ("tc_cut", "basicSetup.electronics.tC2"),
         ("abs", "basicSetup.electronics.abs"), ("emap", "basicSetup.electronics.eCUMap"))


def fingerprint(f) -> dict | None:
    """Leituras do carro parado que dependem do setup (None se ainda não dá para confiar)."""
    p = list(f.tyre_press or ())
    if len(p) != 4 or not all(10.0 < v < 45.0 for v in p):
        return None
    ex = f.extra or {}
    return {"press": [round(float(v), 2) for v in p], "tc": ex.get("tc"), "tc_cut": ex.get("tc_cut"), "abs": ex.get("abs"),
            "emap": ex.get("emap"), "bias": ex.get("bias"), "fuel": round(float(f.fuel or 0), 1)}


def score(fp: dict, content: dict) -> tuple[float, int]:
    """(soma das diferenças de pressão em psi, nº de itens de eletrônica diferentes). Menor é melhor."""
    raw = _get(content, "basicSetup.tyres.tyrePressure")
    if not isinstance(raw, list) or len(raw) != 4:
        return 99.0, 9
    dp = sum(abs(o - psi(r)) for o, r in zip(fp["press"], raw))
    miss = 0
    for key, path in _ELEC:
        obs, val = fp.get(key), _get(content, path)
        if obs is None or not isinstance(val, (int, float)):
            continue
        if int(obs) not in (int(val), int(val) + 1):
            miss += 1
    return dp, miss


def rank(fp: dict, cands: list[dict]) -> list[dict]:
    out = []
    for s in cands:
        content = s.get("content")
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except ValueError:
                continue
        if not isinstance(content, dict):
            continue
        dp, miss = score(fp, content)
        out.append({"id": s["id"], "name": s["name"], "dp": round(dp, 2), "miss": miss, "d": dp + 1.5 * miss})
    out.sort(key=lambda x: (x["d"], x["name"]))
    return out


def decide(fp: dict, cands: list[dict]) -> tuple[int | None, list[int], list[dict]]:
    """(setup certo ou None, candidatos a perguntar, ranking). Certo = só um combina de perto."""
    ranked = rank(fp, cands)
    close = [r for r in ranked if r["dp"] <= PRESS_TOL and r["miss"] == 0]
    if len(close) == 1:
        return close[0]["id"], [], ranked
    pool = close or ranked[:3]
    return None, [r["id"] for r in pool[:ASK_LIMIT]], ranked


class Detector:
    """Recebe os frames do gravador e liga a sessão ao setup reconhecido."""

    def __init__(self, db, recorder=None):
        self.db = db
        self.rec = recorder
        self._sid = None
        self._hist: list = []
        self._done_fp = None

    def reset(self, session_id):
        self._sid, self._hist, self._done_fp = session_id, [], None

    def feed(self, f, session_id):
        if session_id != self._sid:
            self.reset(session_id)
        if f.game != "acc" or f.status != "live":
            return
        now = time.monotonic()
        if f.speed > 2.0:
            self._hist = []
            return
        fp = fingerprint(f)
        if fp is None:
            return
        self._hist = [(t, p) for t, p in self._hist if now - t < 4.0] + [(now, fp["press"])]
        if now - self._hist[0][0] < STABLE_S or max(abs(a - b) for _, p in self._hist for a, b in zip(p, fp["press"])) > 0.06:
            return                                          # ainda não parou ou a pressão ainda está mexendo
        key = (tuple(fp["press"]), fp["tc"], fp["tc_cut"], fp["abs"], fp["emap"])
        if key == self._done_fp:
            return
        self._done_fp = key
        try:
            self._detect(f, fp)
        except Exception as e:  # noqa: BLE001
            print(f"Detecção do setup: {e}")

    def _detect(self, f, fp):
        s = self.db.session(self._sid)
        if not s or s.get("setup_src") == "manual":
            return                                           # a escolha do piloto nunca é trocada
        cands = [self.db.setup(x["id"]) for x in self.db.setups_list()
                 if x["car"] == f.car and x["track"].lower() == (f.track or "").lower()]
        cands = [c for c in cands if c]
        if not cands:
            return
        sure, ask, ranked = decide(fp, cands)
        self.db.set_detected_setup(self._sid, sure, ask, {"fp": fp, "rank": ranked[:6]})
        if self.rec is not None:
            if sure:
                self.rec.extra_live["setup_detected"] = next((c["name"] for c in cands if c["id"] == sure), "")
            else:
                self.rec.extra_live.pop("setup_detected", None)
