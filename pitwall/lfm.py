"""Low Fuel Motorsport (lowfuelmotorsport.com) — leitura dos SEUS dados públicos.

Só lê: perfil, progressão de ELO e de Safety Rating, estatísticas e as séries da
temporada (com a próxima corrida de cada uma). Nada é enviado ao LFM e não há
login nem inscrição automática: os botões do app abrem a página do próprio LFM
para você se inscrever lá. As respostas ficam em cache (memória + disco) para
não sobrecarregar o site e para funcionar sem internet com o último dado.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api3.lowfuelmotorsport.com/api/"
SITE = "https://lowfuelmotorsport.com"
UA = "Pitwall/0.1 (+https://devhygor.github.io/pitwall/)"

TTL_PROFILE = 10 * 60
TTL_SEASON = 15 * 60

# ordem das licenças de ELO do LFM (menor → maior)
LICENSES = ["ROOKIE", "IRON", "IRON+", "BRONZE", "BRONZE+", "SILVER", "SILVER+", "GOLD", "GOLD+",
            "PLATINUM", "PLATINUM+", "DIAMOND", "DIAMOND+", "ALIEN"]
SIMS = {"acc": "1", "ac": "3", "ams2": "4", "raceroom": "6"}


class LFMError(Exception):
    pass


def parse_user_id(value) -> str:
    """Aceita o número (326481) ou o link do perfil (…/profile/326481/statistics)."""
    s = str(value or "").strip()
    m = re.search(r"profile/(\d+)", s) or re.fullmatch(r"(\d+)", s)
    return m.group(1) if m else ""


def license_rank(lic: str | None) -> int:
    try:
        return LICENSES.index((lic or "").upper())
    except ValueError:
        return -1


def _num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _iso(s) -> str | None:
    """Data do LFM ('2026-10-20T19:00:00+0100') → ISO com offset 'HH:MM' (UTC)."""
    if not s:
        return None
    s = str(s)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            d = datetime.strptime(s, fmt)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return None


class LFM:
    def __init__(self, settings=None, cache_dir: Path | None = None, fetch=None):
        self.settings = settings
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self._fetch = fetch or self._http
        self._mem: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    # --- infraestrutura ---------------------------------------------------
    @staticmethod
    def _http(path: str):
        req = urllib.request.Request(API + path, headers={"Accept": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise LFMError("perfil do LFM não encontrado") from e
            raise LFMError(f"LFM respondeu {e.code}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise LFMError("sem conexão com o LFM") from e
        except ValueError as e:
            raise LFMError("resposta inesperada do LFM") from e

    def _disk(self, key: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / (re.sub(r"[^a-zA-Z0-9]+", "_", key) + ".json")

    def _get(self, path: str, ttl: int, force=False):
        """Retorna (dado, idade_em_segundos, stale). Usa o cache se a rede falhar."""
        now = time.time()
        with self._lock:
            hit = self._mem.get(path)
        if hit and not force and now - hit[0] < ttl:
            return hit[1], now - hit[0], False
        try:
            data = self._fetch(path)
        except LFMError:
            if hit:
                return hit[1], now - hit[0], True
            f = self._disk(path)
            if f and f.exists():
                try:
                    blob = json.loads(f.read_text(encoding="utf-8"))
                    with self._lock:
                        self._mem[path] = (blob["t"], blob["data"])
                    return blob["data"], now - blob["t"], True
                except (ValueError, KeyError, OSError):
                    pass
            raise
        with self._lock:
            self._mem[path] = (now, data)
        f = self._disk(path)
        if f:
            try:
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps({"t": now, "data": data}), encoding="utf-8")
            except OSError:
                pass
        return data, 0.0, False

    def user_id(self) -> str:
        return parse_user_id(self.settings.get("lfm_user_id") if self.settings else "")

    # --- perfil -------------------------------------------------------------
    def profile(self, uid: str | None = None, force=False) -> dict:
        uid = parse_user_id(uid) or self.user_id()
        if not uid:
            raise LFMError("informe o seu perfil do LFM")
        u, age, stale = self._get(f"users/getUserData/{uid}", TTL_PROFILE, force)
        if not isinstance(u, dict) or not u.get("name"):
            raise LFMError("perfil do LFM não encontrado")
        elo, *_ = self._safe(f"users/getEloGraphData/{uid}", TTL_PROFILE, force, [])
        sr, *_ = self._safe(f"users/getSrGraphData/{uid}", TTL_PROFILE, force, [])
        stats, *_ = self._safe(f"users/getUserStats/{uid}", TTL_PROFILE, force, {})
        team = u.get("team") or {}
        sims = [{"sim_id": s.get("sim_id"), "name": s.get("name"), "rating": s.get("rating"),
                 "license": s.get("license"), "division": s.get("division"),
                 "ranked_races": s.get("ranked_races"),
                 "logo": (SITE + s["logo_url"]) if str(s.get("logo_url", "")).startswith("/") else s.get("logo_url")}
                for s in (u.get("rating_by_sim") or []) if isinstance(s, dict)]
        acc = next((s for s in sims if str(s["sim_id"]) == "1"), None)
        series = lambda arr: [{"date": p.get("date"), "rating": _num(p.get("rating"))}  # noqa: E731
                              for p in (arr or []) if isinstance(p, dict) and p.get("date")]
        elo_s, sr_s = series(elo), series(sr)
        st = stats if isinstance(stats, dict) else {}
        return {
            "id": uid,
            "url": f"{SITE}/profile/{uid}",
            "name": u.get("name"),
            "first_name": u.get("vorname"), "last_name": u.get("nachname"),
            "avatar": u.get("avatar"), "country": u.get("origin"),
            "elo": u.get("cc_rating"), "license": u.get("license"),
            "safety_rating": _num(u.get("safety_rating")), "sr_license": u.get("sr_license"),
            "division": u.get("division"),
            "acc": acc,
            "sims": sims,
            "team": {"name": team.get("teamname"), "id": team.get("team_id"), "logo": team.get("teamlogo")} if team else None,
            "elo_graph": elo_s,
            "sr_graph": sr_s,
            "elo_delta": (elo_s[-1]["rating"] - elo_s[-2]["rating"]) if len(elo_s) > 1 else None,
            "stats": {k: _num(st.get(k)) for k in ("starts", "wins", "podium", "top5", "top10", "poles", "dnf",
                                                  "ranked", "avg_ip", "avg_q", "avg_r", "podiumrate", "zero_ip")},
            "age_s": round(age), "stale": stale,
        }

    def _safe(self, path, ttl, force, default):
        try:
            return self._get(path, ttl, force)
        except LFMError:
            return default, 0, True

    # --- séries / próximas corridas ------------------------------------------
    def series(self, sim: str = "acc", force=False, me: dict | None = None) -> dict:
        sim_id = SIMS.get(sim, sim)
        data, age, stale = self._get("v2/seasons/getMinifiedSeasonBySim", TTL_SEASON, force)
        block = ((data or {}).get("series") or {}).get(str(sim_id)) or {}
        raw = block.get("series") or {}
        items = raw.values() if isinstance(raw, dict) else raw
        my_lic = license_rank((me or {}).get("acc", {}).get("license") if me and me.get("acc") else (me or {}).get("license"))
        my_sr = (me or {}).get("safety_rating")
        my_elo = ((me or {}).get("acc") or {}).get("rating") or (me or {}).get("elo")
        out = []
        for o in items:
            if not isinstance(o, dict):
                continue
            tr = o.get("active_track") or {}
            ses = (o.get("settings") or {}).get("season_event_settings") or {}
            nxt = _iso(o.get("next_race_date") or o.get("next_race"))
            more = [x for x in (_iso(d) for d in (o.get("next3_races") or [])) if x]
            slug = o.get("slug") or ""
            req = {"license": o.get("min_license"), "sr": _num(o.get("min_sr")), "elo": o.get("min_elo") or 0}
            ok = None
            if me:
                reasons = []
                if license_rank(req["license"]) > my_lic >= 0:
                    reasons.append(f"licença {req['license']}")
                if req["sr"] is not None and my_sr is not None and my_sr < req["sr"]:
                    reasons.append(f"SR {req['sr']:g}")
                if req["elo"] and my_elo and my_elo < req["elo"]:
                    reasons.append(f"ELO {req['elo']}")
                ok = {"eligible": not reasons, "missing": reasons}
            out.append({
                "name": o.get("series_name"), "short": o.get("short_name"), "slug": slug,
                "event_id": o.get("event_id"),
                "class": ses.get("car_class"),
                "race_length": o.get("race_length"),
                "team_event": bool(o.get("team_event")), "fixed_car": bool(o.get("fixed_car")),
                "requirements": req,
                "track": tr.get("track_name"), "track_image": tr.get("thumbnail"),
                "track_country": tr.get("country"), "track_km": _num(tr.get("km")),
                "next_race": nxt, "upcoming": [x for x in more if x != nxt][:3],
                "signups": o.get("signups"), "racing": o.get("racing"),
                "url": f"{SITE}/series/{slug}" if slug else SITE,
                "sessions_url": f"{SITE}/series/{slug}/upcomingsessions" if slug else SITE,
                "you": ok,
            })
        out.sort(key=lambda s: s["next_race"] or "9999")
        return {"season": (data or {}).get("season_name"), "week": (data or {}).get("season_week"),
                "simulation": block.get("simulation"), "series": out,
                "age_s": round(age), "stale": stale}

    def overview(self, force=False) -> dict:
        """Tudo o que a tela do app precisa num pedido só."""
        uid = self.user_id()
        res = {"user_id": uid, "profile": None, "series": None, "errors": []}
        if uid:
            try:
                res["profile"] = self.profile(uid, force)
            except LFMError as e:
                res["errors"].append(str(e))
        try:
            res["series"] = self.series("acc", force, res["profile"])
        except LFMError as e:
            res["errors"].append(str(e))
        now = datetime.now(timezone.utc).isoformat()
        nxt = [s for s in (res["series"] or {}).get("series", []) if s["next_race"] and s["next_race"] > now]
        elig = [s for s in nxt if not s["you"] or s["you"]["eligible"]]
        res["next"] = (elig or nxt or [None])[0]
        return res
