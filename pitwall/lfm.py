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
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://api3.lowfuelmotorsport.com/api/"
SITE = "https://lowfuelmotorsport.com"
UA = "Pitwall/0.1 (+https://pitwall.hygor.com.br/)"

TTL_PROFILE = 10 * 60
TTL_SEASON = 15 * 60

# ordem das licenças de ELO do LFM (menor → maior)
LICENSES = ["ROOKIE", "IRON", "IRON+", "BRONZE", "BRONZE+", "SILVER", "SILVER+", "GOLD", "GOLD+",
            "PLATINUM", "PLATINUM+", "DIAMOND", "DIAMOND+", "ALIEN"]
SIMS = {"acc": "1", "ac": "3", "ams2": "4", "raceroom": "6"}


class LFMError(Exception):
    pass


class LFMAuthError(LFMError):
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
    def _http(path: str, token: str | None = None):
        h = {"Accept": "application/json", "User-Agent": UA}
        if token:
            h["Authorization"] = "Bearer " + token
        req = urllib.request.Request(API + path, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and token:
                raise LFMAuthError("a conta do LFM desconectou — entre de novo") from e
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

    def _get(self, path: str, ttl: int, force=False, token: str | None = None):
        """Retorna (dado, idade_em_segundos, stale). Usa o cache se a rede falhar."""
        now = time.time()
        if token:
            return self._get_auth(path, ttl, force, token)
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

    def past_races(self, uid: str | None = None, limit: int = 10, force=False) -> list[dict]:
        """Últimas corridas ranqueadas do piloto (todas as sims; a do ACC vem marcada)."""
        uid = parse_user_id(uid) or self.user_id()
        if not uid:
            return []
        rows, *_ = self._safe(f"users/getUsersPastRaces/{uid}?start=0&limit={int(limit)}&event=false&season=false", TTL_PROFILE, force, [])
        out = []
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict):
                continue
            out.append({"race_id": r.get("race_id"), "date": _iso(r.get("race_date")), "event": r.get("event_name"),
                        "sim_id": r.get("sim_id"), "car": r.get("car_name") or r.get("car"), "track": r.get("track_name"),
                        "class": r.get("class"), "sof": r.get("sof"), "start": r.get("start_pos"), "finish": r.get("finishing_pos"),
                        "elo_change": r.get("rating_change"), "sr_change": _num(r.get("sr_change")),
                        "incidents": r.get("incidents"), "points": r.get("points"), "url": f"{SITE}/race/{r.get('race_id')}" if r.get("race_id") else None})
        return out

    def snapshot(self, force=False) -> dict | None:
        """Resumo compacto do perfil + últimas corridas, para publicar no perfil do Pitwall (site)."""
        uid = self.user_id()
        if not uid:
            return None
        p = self.profile(uid, force)
        keep = ("id", "url", "name", "avatar", "country", "elo", "license", "safety_rating", "sr_license", "division", "acc", "team", "elo_delta", "stats")
        snap = {k: p.get(k) for k in keep}
        snap["elo_graph"] = (p.get("elo_graph") or [])[-80:]
        snap["sr_graph"] = (p.get("sr_graph") or [])[-80:]
        snap["races"] = self.past_races(uid, 10, force)
        return snap

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

    # --- conta do LFM (opcional) ---------------------------------------------------
    # Quando você entra no LFM pela janela do próprio LFM dentro do Pitwall, o app
    # guarda o seu token de acesso (fica só neste PC e só vai para o api3 do LFM)
    # para LER as suas inscrições e os horários de cada servidor. Nada é escrito
    # na sua conta pelo Pitwall: a inscrição é feita por você, na página do LFM.
    def _get_auth(self, path, ttl, force, token):
        now = time.time()
        key = "auth:" + path
        with self._lock:
            hit = self._mem.get(key)
        if hit and not force and now - hit[0] < ttl:
            return hit[1], now - hit[0], False
        try:
            data = self._fetch(path, token)
        except LFMAuthError:
            self.clear_account(expired=True)
            raise
        except LFMError:
            if hit:
                return hit[1], now - hit[0], True
            raise
        with self._lock:
            self._mem[key] = (now, data)
        return data, 0.0, False

    def _auth_file(self) -> Path | None:
        return self.cache_dir / "conta.json" if self.cache_dir else None

    def account(self) -> dict:
        f = self._auth_file()
        if f and f.exists():
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                pass
        return {}

    def token(self) -> str | None:
        return self.account().get("token") or None

    def set_account(self, token: str, user: dict | None = None, expires_at: str | None = None) -> dict:
        user = user or {}
        cur = self.account()
        acc = {"token": token, "user_id": str(user.get("id") or cur.get("user_id") or ""),
               "name": user.get("name") or cur.get("name"), "expires_at": expires_at or cur.get("expires_at"),
               "connected_at": cur.get("connected_at") if cur.get("token") == token else datetime.now(timezone.utc).isoformat()}
        f = self._auth_file()
        if f:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(acc), encoding="utf-8")
        if acc["user_id"] and self.settings is not None and not self.user_id():
            self.settings.update({"lfm_user_id": acc["user_id"]})
        with self._lock:
            for k in [k for k in self._mem if k.startswith("auth:")]:
                self._mem.pop(k, None)
        return self.account_status()

    def clear_account(self, expired=False):
        f = self._auth_file()
        if f and f.exists():
            try:
                if expired:
                    acc = self.account()
                    acc.pop("token", None)
                    acc["expired"] = True
                    f.write_text(json.dumps(acc), encoding="utf-8")
                else:
                    f.unlink()
            except OSError:
                pass
        with self._lock:
            for k in [k for k in self._mem if k.startswith("auth:")]:
                self._mem.pop(k, None)

    def account_status(self) -> dict:
        a = self.account()
        return {"connected": bool(a.get("token")), "name": a.get("name"), "user_id": a.get("user_id"),
                "expired": bool(a.get("expired")), "expires_at": a.get("expires_at")}

    # --- sessões (servidores) de cada série -------------------------------------------
    @staticmethod
    def _tz_of(raw) -> timezone:
        m = re.search(r"([+-])(\d{2}):?(\d{2})$", str(raw or ""))
        if not m:
            return timezone(timedelta(hours=1))   # o LFM usa +01:00 nas datas sem fuso
        sign = 1 if m.group(1) == "+" else -1
        return timezone(sign * timedelta(hours=int(m.group(2)), minutes=int(m.group(3))))

    @staticmethod
    def _local(s, tz) -> str | None:
        if not s:
            return None
        try:
            return datetime.strptime(str(s)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz).astimezone(timezone.utc).isoformat()
        except ValueError:
            return _iso(s)

    def sessions(self, force=False) -> list[dict]:
        """Próximos servidores de todas as séries de ACC (precisa da conta conectada)."""
        tok = self.token()
        if not tok:
            return []
        data, *_ = self._get("v2/seasons/getMinifiedSeasonBySim", TTL_SEASON, force)
        raw = (((data or {}).get("series") or {}).get("1") or {}).get("series") or {}
        out = []
        for o in (raw.values() if isinstance(raw, dict) else raw):
            if not isinstance(o, dict) or not o.get("event_id"):
                continue
            tz = self._tz_of(o.get("next_race_date") or o.get("next_race"))
            try:
                res, *_ = self._get(f"v2/seasons/getUpcomingSessions/{o['event_id']}", TTL_SESSIONS, force, tok)
            except LFMAuthError:
                raise
            except LFMError:
                continue
            for r in (res or {}).get("data") or []:
                if not isinstance(r, dict) or not r.get("race_id"):
                    continue
                tr = r.get("track") or {}
                out.append({
                    "race_id": r.get("race_id"), "series": o.get("series_name"), "slug": o.get("slug"),
                    "event_id": o.get("event_id"),
                    "date": self._local(r.get("race_date"), tz),
                    "signup_start": self._local(r.get("signupStart"), tz),
                    "signup_closes": self._local(r.get("signupCloses"), tz),
                    "signout_closes": self._local(r.get("signOutCloses"), tz),
                    "signed_up": bool(r.get("signedUp")), "live": bool(r.get("isLive")),
                    "registered": r.get("registered"), "slots": r.get("slots"),
                    "region": r.get("server_region"),
                    "server_name": r.get("server_name"), "server_password": r.get("server_password"),
                    "lengths": r.get("sessions_length"), "start_times": r.get("start_times"),
                    "weather": r.get("weather_settings"),
                    "track": tr.get("track_name") or (o.get("active_track") or {}).get("track_name"),
                    "track_image": tr.get("thumbnail"),
                    "url": f"{SITE}/series/{o.get('slug')}/upcomingsessions",
                })
        out.sort(key=lambda r: r["date"] or "9999")
        return out

    # --- alertas (o "Join" liberou) ---------------------------------------------------
    def _watch_file(self) -> Path | None:
        return self.cache_dir / "avisos.json" if self.cache_dir else None

    def watches(self) -> dict:
        f = self._watch_file()
        try:
            return json.loads(f.read_text(encoding="utf-8")) if f and f.exists() else {}
        except (ValueError, OSError):
            return {}

    def set_watch(self, key: str, on: bool, info: dict | None = None) -> dict:
        w = self.watches()
        if on:
            w[key] = {**(info or {}), "key": key}
        else:
            w.pop(key, None)
        now = datetime.now(timezone.utc) - timedelta(hours=6)
        w = {k: v for k, v in w.items() if not v.get("date") or v["date"] > now.isoformat()}
        f = self._watch_file()
        if f:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(w), encoding="utf-8")
        return w

    def targets(self, force=False) -> list[dict]:
        """Corridas que merecem alerta: as que você se inscreveu (conta) + as marcadas com o sininho."""
        out = {}
        try:
            for r in self.sessions(force):
                if r["signed_up"] and r["date"]:
                    out[str(r["race_id"])] = {**r, "why": "inscrito"}
        except LFMError:
            pass
        for k, v in self.watches().items():
            if v.get("date") and k not in out:
                out[k] = {**v, "why": "sininho"}
        return sorted(out.values(), key=lambda r: r["date"])


TTL_SESSIONS = 3 * 60


class Alerts:
    """Fica de olho nos horários e toca o som quando o servidor abre (Join liberado)."""

    def __init__(self, lfm: LFM, settings, folder: Path):
        self.lfm, self.settings, self.folder = lfm, settings, Path(folder)
        self.notifiers: list = []
        self.events: list[dict] = []
        self._fired = self._load_fired()
        self._stop = False

    def _load_fired(self) -> dict:
        try:
            return json.loads((self.folder / "alertas_tocados.json").read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {}

    def _save_fired(self):
        cut = time.time() - 3 * 86400
        self._fired = {k: v for k, v in self._fired.items() if v > cut}
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            (self.folder / "alertas_tocados.json").write_text(json.dumps(self._fired), encoding="utf-8")
        except OSError:
            pass

    def play(self, kind: str | None = None) -> bool:
        from . import sound
        kind = kind or self.settings.get("lfm_alert_sound")
        return sound.play(kind, int(self.settings.get("lfm_alert_volume")), self.folder)

    def fire(self, race: dict, phase: str):
        when = race.get("date")
        if phase == "open":
            title = "Servidor aberto — Join liberado!"
            msg = " · ".join(x for x in (race.get("series") or "LFM", race.get("track")) if x)
            if race.get("server_password"):
                msg += f" · senha: {race['server_password']}"
            played = self.play()
        else:
            mins = int(self.settings.get("lfm_alert_before_min"))
            title = f"Faltam {mins} min para abrir o servidor"
            msg = " · ".join(x for x in (race.get("series") or "LFM", race.get("track")) if x)
            played = self.play("aviso")
        ev = {"t": datetime.now(timezone.utc).isoformat(), "phase": phase, "title": title, "msg": msg,
              "race": {k: race.get(k) for k in ("race_id", "series", "track", "date", "server_name",
                                                 "server_password", "url", "why")},
              "played": played, "id": f"{race.get('race_id') or race.get('key')}:{phase}"}
        self.events = (self.events + [ev])[-20:]
        for n in self.notifiers:
            try:
                n(msg, title)
            except Exception:  # noqa: BLE001
                pass
        return ev

    def check(self, now: datetime | None = None, force=False) -> list[dict]:
        if not self.settings.get("lfm_alerts_enabled"):
            return []
        now = now or datetime.now(timezone.utc)
        before = timedelta(minutes=int(self.settings.get("lfm_alert_before_min")))
        fired = []
        for r in self.lfm.targets(force):
            try:
                t = datetime.fromisoformat(r["date"])
            except (TypeError, ValueError):
                continue
            key = str(r.get("race_id") or r.get("key"))
            if before.total_seconds() > 0 and t - before <= now < t and key + ":pre" not in self._fired:
                self._fired[key + ":pre"] = time.time()
                fired.append(self.fire(r, "pre"))
            at_zero = self.settings.get("lfm_alert_at_zero")
            if at_zero and t <= now < t + timedelta(minutes=10) and key + ":open" not in self._fired:
                self._fired[key + ":open"] = time.time()
                fired.append(self.fire(r, "open"))
        if fired:
            self._save_fired()
        return fired

    def next_due(self, now: datetime | None = None) -> float:
        """Segundos até o próximo alerta (para tocar exatamente quando o contador zerar)."""
        now = now or datetime.now(timezone.utc)
        before = timedelta(minutes=int(self.settings.get("lfm_alert_before_min")))
        best = 15.0
        try:
            targets = self.lfm.targets()
        except Exception:  # noqa: BLE001
            return best
        for r in targets:
            try:
                t = datetime.fromisoformat(r["date"])
            except (TypeError, ValueError):
                continue
            for moment in (t - before, t):
                d = (moment - now).total_seconds()
                if 0 < d < best:
                    best = d
        return max(0.2, best)

    def run(self):
        while not self._stop:
            try:
                self.check()
            except Exception as e:  # noqa: BLE001
                print(f"Alertas LFM: {e}")
            try:
                wait = self.next_due() + 0.05
            except Exception:  # noqa: BLE001
                wait = 15
            time.sleep(wait)

    def start(self):
        import threading as _t
        _t.Thread(target=self.run, daemon=True).start()
