"""Equipe na nuvem (Supabase) com login pelo Google.

Como funciona o login no app: o Pitwall abre o navegador na página de login do
Google (via Supabase, fluxo PKCE). Depois de entrar, o Google/Supabase volta para
http://127.0.0.1:<porta>/auth/callback com um código, que o app troca pela sessão.
A sessão (refresh token) fica em auth.json na pasta de dados do Pitwall.

Só voltas suas sobem (o recorde de cada carro em cada pista, com a telemetria).
Setups NUNCA são enviados. Quem vê suas voltas: só quem está numa equipe com você.
O esquema do banco está em supabase/schema.sql.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .db import data_dir, pack, unpack

# projeto "pitwall" no Supabase (a chave anon é pública por design: quem protege os dados
# é o login + as regras de acesso do banco)
SUPABASE_URL = "https://iddijempjbyguqfhotij.supabase.co"
SUPABASE_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkZGlqZW1wamJ5Z3VxZmhvdGlq"
                "Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDA3MTQsImV4cCI6MjEwNzU3NjcxNH0."
                "X_S_Mi4s8xzaFsDOkFsH2OJS7Sx8mTAnly_aaNHY4xA")
SITE_URL = "https://pitwall.hygor.com.br/"

KEEP = ("d", "t", "speed", "gas", "brake", "steer", "gear", "rpm", "x", "z")


class TeamError(Exception):
    pass


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def invite_code(text: str) -> str:
    """Aceita o código (ABC12345) ou o link de convite inteiro."""
    m = re.findall(r"[A-Za-z0-9]{8}", (text or "").strip().rstrip("/").split("/")[-1])
    if not m:
        raise TeamError("Convite inválido.")
    return m[-1].upper()


class Team:
    def __init__(self, db, settings, port: int = 8765):
        self.db = db
        self.settings = settings
        self.port = port
        self.last_error = None
        self._lock = threading.Lock()
        self._verifier = None
        self._auth_path = data_dir() / "auth.json"
        self._auth = self._load()
        self.old_schema = False
        self.sync_info: dict = {"state": "idle", "at": None, "sent": 0, "total": 0}
        self._sync_now = threading.Event()
        self._sync_started = False

    # --- configuração ---------------------------------------------------------
    @property
    def url(self) -> str:
        return ((self.settings.get("cloud_url") if self.settings else "") or SUPABASE_URL).rstrip("/")

    @property
    def key(self) -> str:
        return (self.settings.get("cloud_key") if self.settings else "") or SUPABASE_KEY

    @property
    def redirect(self) -> str:
        return f"http://127.0.0.1:{self.port}/auth/callback"

    @property
    def configured(self) -> bool:
        return bool(self._auth.get("refresh_token"))

    @property
    def user(self) -> dict | None:
        u = self._auth.get("user")
        if not u:
            return None
        meta = u.get("user_metadata") or {}
        return {"id": u.get("id"), "email": u.get("email"),
                "name": meta.get("full_name") or meta.get("name") or (u.get("email") or "").split("@")[0],
                "avatar_url": meta.get("avatar_url") or meta.get("picture")}

    def _load(self) -> dict:
        try:
            return json.loads(self._auth_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return {}

    def _save(self):
        if self._auth:
            self._auth_path.write_text(json.dumps(self._auth), encoding="utf-8")
            try:
                os.chmod(self._auth_path, 0o600)
            except OSError:
                pass
        elif self._auth_path.exists():
            self._auth_path.unlink()

    # --- HTTP -----------------------------------------------------------------
    def _http(self, method: str, url: str, body=None, headers: dict | None = None):
        h = {"apikey": self.key, "Content-Type": "application/json", "Accept": "application/json"}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            txt = e.read().decode(errors="replace")
            try:
                j = json.loads(txt)
                msg = j.get("message") or j.get("msg") or j.get("error_description") or j.get("error") or txt
            except ValueError:
                msg = txt
            if e.code == 401:
                raise TeamError("Sua sessão expirou. Entre de novo com o Google.") from None
            raise TeamError(str(msg)[:300]) from None
        except urllib.error.URLError as e:
            raise TeamError(f"Sem conexão com a nuvem do Pitwall: {e.reason}") from None

    # --- login ----------------------------------------------------------------
    def login_url(self) -> str:
        self._verifier = _b64url(secrets.token_bytes(48))
        challenge = _b64url(hashlib.sha256(self._verifier.encode()).digest())
        q = urllib.parse.urlencode({"provider": "google", "redirect_to": self.redirect,
                                    "code_challenge": challenge, "code_challenge_method": "s256"})
        return f"{self.url}/auth/v1/authorize?{q}"

    def finish_login(self, code: str):
        if not self._verifier:
            raise TeamError("Login não iniciado por este app. Clique em “Entrar com Google” de novo.")
        r = self._http("POST", f"{self.url}/auth/v1/token?grant_type=pkce",
                       {"auth_code": code, "code_verifier": self._verifier})
        self._verifier = None
        self._set_session(r)
        self.sync_soon()

    def _set_session(self, r: dict):
        self._auth = {"access_token": r["access_token"], "refresh_token": r["refresh_token"],
                      "expires_at": time.time() + int(r.get("expires_in") or 3600), "user": r.get("user")}
        self._save()
        self.last_error = None

    def _token(self) -> str:
        if not self.configured:
            raise TeamError("Entre com o Google para usar a equipe.")
        with self._lock:
            if time.time() > self._auth.get("expires_at", 0) - 90:
                try:
                    r = self._http("POST", f"{self.url}/auth/v1/token?grant_type=refresh_token",
                                   {"refresh_token": self._auth["refresh_token"]})
                except TeamError as e:
                    if "expirou" in str(e) or "Invalid Refresh Token" in str(e) or "refresh" in str(e).lower():
                        self._auth = {}
                        self._save()
                        raise TeamError("Sua sessão expirou. Entre de novo com o Google.") from None
                    raise
                self._set_session(r)
            return self._auth["access_token"]

    def logout(self):
        try:
            if self.configured:
                self._http("POST", f"{self.url}/auth/v1/logout",
                           headers={"Authorization": f"Bearer {self._token()}"})
        except TeamError:
            pass
        self._auth = {}
        self._save()

    def _storage_put(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Envia um arquivo para o armazenamento (substitui se já existir) e devolve a URL pública."""
        url = f"{self.url}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}"
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "apikey": self.key, "Authorization": f"Bearer {self._token()}", "Content-Type": content_type,
            "x-upsert": "true", "cache-control": "3600"})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                r.read()
        except urllib.error.HTTPError as e:
            txt = e.read().decode(errors="replace")
            if "row-level security" in txt or e.code in (401, 403):
                raise TeamError("Sem permissão para enviar esse arquivo. Só o dono e os líderes da equipe trocam a logo "
                                "(e o banco precisa estar com o supabase/equipe_v4.sql aplicado).") from None
            if "mime" in txt.lower():
                raise TeamError("Tipo de imagem não aceito. Use PNG, JPG, WEBP ou SVG.") from None
            raise TeamError(f"Não deu para enviar o arquivo ({e.code}): {txt[:200]}") from None
        except urllib.error.URLError as e:
            raise TeamError(f"Sem conexão com a nuvem do Pitwall: {e.reason}") from None
        return self.public_url(bucket, path)

    def public_url(self, bucket: str, path: str) -> str:
        return f"{self.url}/storage/v1/object/public/{bucket}/{urllib.parse.quote(path)}"

    def _rest(self, method: str, path: str, query: dict | None = None, body=None, prefer: str | None = None):
        url = f"{self.url}/rest/v1/{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query, safe=",.()*:")
        h = {"Authorization": f"Bearer {self._token()}"}
        if prefer:
            h["Prefer"] = prefer
        return self._http(method, url, body, h)

    # --- equipes --------------------------------------------------------------
    def status(self) -> dict:
        out = {"logged_in": self.configured, "user": self.user, "site_url": SITE_URL,
               "last_error": self.last_error, "teams": [], "invites": [], "sync": dict(self.sync_info),
               "needs_migration": False}
        if self.configured:
            try:
                out["teams"] = self.teams()
                out["needs_migration"] = self.old_schema
                if not self.old_schema:
                    out["invites"] = self.my_invites()
                    out["pending"] = self.my_requests()
            except TeamError as e:
                out["error"] = str(e)
                out["logged_in"] = self.configured
        return out

    def teams(self) -> list[dict]:
        me = self.user["id"]
        cols = "id,name,invite_code,owner,created_at,logo_url"
        try:
            rows = self._rest("GET", "team_members", {"select": f"role,teams({cols},join_mode,description)",
                                                      "user_id": f"eq.{me}"}) or []
            self.old_schema = False
        except TeamError as e:
            if "join_mode" not in str(e) and "description" not in str(e):
                raise
            self.old_schema = True       # o SQL v4 ainda não foi rodado no Supabase
            rows = self._rest("GET", "team_members", {"select": f"role,teams({cols})", "user_id": f"eq.{me}"}) or []
        out = []
        for r in rows:
            t = r.get("teams") or {}
            if t:
                t.setdefault("join_mode", "invite")
                t.setdefault("description", None)
                out.append({**t, "role": r["role"], "invite_link": SITE_URL + "#/join/" + t["invite_code"]})
        return sorted(out, key=lambda t: t["created_at"])

    def create_team(self, name: str) -> dict:
        name = (name or "").strip()
        if len(name) < 2:
            raise TeamError("Dê um nome para a equipe.")
        t = self._rest("POST", "rpc/create_team", body={"team_name": name})
        self.sync_soon()
        return t

    def join_team(self, code: str) -> dict:
        """Entra com o link/código do convite. Devolve {status, team}."""
        try:
            r = self._rest("POST", "rpc/join_with_code", body={"code": invite_code(code)})
        except TeamError as e:
            if "join_with_code" not in str(e):
                raise
            r = {"status": "joined", "team": self._rest("POST", "rpc/join_team", body={"code": invite_code(code)})}
        self.sync_soon()
        return r

    def leave_team(self, team_id: str):
        try:
            self._rest("POST", "rpc/leave_team", body={"t": team_id})
        except TeamError as e:
            if "leave_team" not in str(e):
                raise
            self._rest("DELETE", "team_members", {"team_id": f"eq.{team_id}", "user_id": f"eq.{self.user['id']}"})

    def new_invite(self, team_id: str) -> str:
        return self._rest("POST", "rpc/new_invite_code", body={"t": team_id})

    # --- cargos, pedidos e convites por e-mail ---------------------------------
    def _rpc(self, name: str, body: dict):
        try:
            return self._rest("POST", f"rpc/{name}", body=body)
        except TeamError as e:
            if f"function public.{name}" in str(e) or "Could not find the function" in str(e):
                raise TeamError("Falta atualizar o banco da nuvem: rode o arquivo supabase/equipe_v4.sql "
                                "no SQL Editor do Supabase (uma vez).") from None
            raise

    def discover(self) -> list[dict]:
        return self._rpc("discover_teams", {}) or []

    def join_listed(self, team_id: str) -> dict:
        r = self._rpc("join_listed", {"t": team_id})
        if r.get("status") == "joined":
            self.sync_soon()
        return r

    def my_requests(self) -> list[dict]:
        rows = self._rest("GET", "team_requests", {"select": "team_id,teams(name)", "user_id": f"eq.{self.user['id']}"}) or []
        return [{"team_id": r["team_id"], "team_name": (r.get("teams") or {}).get("name")} for r in rows]

    def cancel_request(self, team_id: str):
        self._rpc("cancel_request", {"t": team_id})

    def requests(self, team_id: str) -> list[dict]:
        rows = self._rest("GET", "team_requests", {"select": "user_id,created_at,profiles(name,avatar_url)",
                                                   "team_id": f"eq.{team_id}", "order": "created_at.asc"}) or []
        return [{"user_id": r["user_id"], "created_at": r["created_at"],
                 "name": (r.get("profiles") or {}).get("name") or "?",
                 "avatar_url": (r.get("profiles") or {}).get("avatar_url")} for r in rows]

    def answer_request(self, team_id: str, user_id: str, accept: bool):
        self._rpc("answer_request", {"t": team_id, "u": user_id, "accept": bool(accept)})

    def invite_email(self, team_id: str, email: str) -> dict:
        r = self._rpc("invite_by_email", {"t": team_id, "mail": email})
        r["site_url"] = SITE_URL
        return r

    def sent_invites(self, team_id: str) -> list[dict]:
        return self._rest("GET", "team_invites", {"select": "id,email,created_at", "team_id": f"eq.{team_id}",
                                                  "order": "created_at.desc"}) or []

    def cancel_invite(self, invite_id: str):
        self._rpc("cancel_invite", {"i": invite_id})

    def my_invites(self) -> list[dict]:
        return self._rpc("my_invites", {}) or []

    def answer_invite(self, invite_id: str, accept: bool) -> dict:
        r = self._rpc("answer_invite", {"i": invite_id, "accept": bool(accept)})
        if r.get("status") == "joined":
            self.sync_soon()
        return r

    def set_role(self, team_id: str, user_id: str, role: str):
        self._rpc("set_member_role", {"t": team_id, "u": user_id, "new_role": role})

    def remove_member(self, team_id: str, user_id: str):
        self._rpc("remove_member", {"t": team_id, "u": user_id})

    def transfer_ownership(self, team_id: str, user_id: str):
        self._rpc("transfer_ownership", {"t": team_id, "u": user_id})

    def set_options(self, team_id: str, values: dict):
        allowed = {k: values[k] for k in ("name", "description", "join_mode") if k in values}
        if "join_mode" in allowed and allowed["join_mode"] not in ("invite", "request", "open"):
            raise TeamError("Modo de entrada inválido.")
        if "name" in allowed and len((allowed["name"] or "").strip()) < 2:
            raise TeamError("Dê um nome para a equipe.")
        if "description" in allowed:
            allowed["description"] = (allowed["description"] or "").strip()[:200] or None
        self._rest("PATCH", "teams", {"id": f"eq.{team_id}"}, allowed, prefer="return=minimal")

    def tiers(self, ids) -> dict:
        """Selo de plano (pro/team) de cada piloto; vazio se não tiver plano pago. Nunca derruba a tela."""
        ids = sorted({i for i in ids if i})
        if not ids:
            return {}
        try:
            rows = self._rest("POST", "rpc/plan_tiers", body={"p_ids": ids[:500]}) or []
            return {r["user_id"]: r["tier"] for r in rows}
        except Exception:
            return {}

    def my_profile(self) -> dict:
        return self._rest("POST", "rpc/public_profile", body={"p_id": self.user["id"]}) or {}

    def board(self, team_id: str) -> dict:
        members = self._rest("GET", "team_members", {"select": "role,joined_at,user_id,profiles(name,avatar_url)",
                                                      "team_id": f"eq.{team_id}", "order": "joined_at.asc"}) or []
        laps = self._rest("POST", "rpc/team_board", body={"t": team_id}) or []
        me = self.user["id"]
        tiers = self.tiers([m["user_id"] for m in members])
        for l in laps:
            l["tier"] = tiers.get(l["user_id"])
            l["me"] = l["user_id"] == me
            l["clip_url"] = self.public_url("clips", l["clip_path"]) if l.get("clip_path") else None
        return {"members": [{"user_id": m["user_id"], "role": m["role"], "joined_at": m["joined_at"],
                             "name": (m.get("profiles") or {}).get("name") or "?",
                             "avatar_url": (m.get("profiles") or {}).get("avatar_url"),
                             "tier": tiers.get(m["user_id"]),
                             "me": m["user_id"] == me} for m in members],
                "laps": laps}

    def community(self) -> list[dict]:
        """Ranking da comunidade: o recorde de cada piloto do Pitwall em cada carro/pista."""
        # o servidor devolve no máximo 1000 linhas por pedido: busca em páginas
        rows: list = []
        for page in range(0, 20):
            part = self._rest("GET", "laps", {
                "select": "id,user_id,game,car,track,lap_time_ms,s1_ms,s2_ms,s3_ms,recorded_at,setup_name,clip_path,profiles(name,avatar_url)",
                "order": "track.asc,car.asc,lap_time_ms.asc,id.asc", "limit": "1000", "offset": str(page * 1000)}) or []
            rows += part
            if len(part) < 1000:
                break
        me = self.user["id"]
        tiers = self.tiers([r["user_id"] for r in rows])
        for r in rows:
            r["tier"] = tiers.get(r["user_id"])
            p = r.pop("profiles", None) or {}
            r["driver"], r["avatar_url"], r["me"] = p.get("name") or "?", p.get("avatar_url"), r["user_id"] == me
            r["clip_url"] = self.public_url("clips", r["clip_path"]) if r.get("clip_path") else None
        return rows

    def set_logo(self, team_id: str, data: bytes, content_type: str) -> str:
        if len(data) > 2 * 1024 * 1024:
            raise TeamError("A imagem precisa ter até 2 MB.")
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg"}.get(content_type)
        if not ext:
            raise TeamError("Use uma imagem PNG, JPG, WEBP ou SVG.")
        url = self._storage_put("team-logos", f"{team_id}/logo.{ext}", data, content_type) + f"?v={int(time.time())}"
        self._rest("PATCH", "teams", {"id": f"eq.{team_id}"}, {"logo_url": url}, prefer="return=minimal")
        return url

    def set_logo_url(self, team_id: str, url: str) -> str:
        url = (url or "").strip()
        if url and not re.match(r"^https://", url):
            raise TeamError("O link da logo precisa começar com https://")
        self._rest("PATCH", "teams", {"id": f"eq.{team_id}"}, {"logo_url": url or None}, prefer="return=minimal")
        return url

    # --- envio ----------------------------------------------------------------
    def upload_lap(self, lap_id: int, force: bool = False, known: dict | None = None) -> dict:
        lap = self.db.lap(lap_id)
        if not lap:
            raise TeamError("volta não encontrada")
        me = self.user["id"]
        sess = self.db.session(lap["session_id"]) or {}
        game = sess.get("game") or "acc"
        if known is not None:       # sincronização em lote: já temos a lista da nuvem
            cur = [{"lap_time_ms": known[(game, lap["car"], lap["track"])]}] if (game, lap["car"], lap["track"]) in known else []
        else:
            q = {"select": "id,lap_time_ms", "user_id": f"eq.{me}", "game": f"eq.{game}",
                 "car": f"eq.{lap['car']}", "track": f"eq.{lap['track']}"}
            cur = self._rest("GET", "laps", q) or []
        if cur and cur[0]["lap_time_ms"] <= lap["lap_time_ms"] and not force:
            return {"sent": False, "reason": "a volta na nuvem já é igual ou melhor"}
        tel = {k: lap["telemetry"][k] for k in KEEP if k in lap["telemetry"]}
        row = {"user_id": me, "game": game, "car": lap["car"], "track": lap["track"],
               "lap_time_ms": lap["lap_time_ms"], "s1_ms": lap.get("s1_ms"), "s2_ms": lap.get("s2_ms"),
               "s3_ms": lap.get("s3_ms"), "air_temp": lap.get("air_temp"), "road_temp": lap.get("road_temp"),
               "recorded_at": (lap.get("recorded_at") or dt.datetime.now().isoformat()),
               "uploaded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "telemetry": base64.b64encode(pack(tel)).decode(), "clip_path": None, "events": lap.get("events") or []}
        sid = sess.get("setup_id") or sess.get("suggested_setup_id")
        if not sid:
            from . import setups as _setups
            sid = _setups.detect_used(self.db, lap["car"], lap["track"])      # estimativa, para o setup do recorde ir junto
        setup = self.db.setup(sid) if sid else None
        # enviar o setup é para todos (inclusive Grátis); ver e baixar os setups dos outros é do Pro/Equipe
        share = bool(setup and self.settings.get("team_share_setup"))
        self._rest("POST", "laps", {"on_conflict": "user_id,game,car,track"}, [row],
                   prefer="resolution=merge-duplicates,return=minimal")
        if share:     # a coluna do setup não pode ser lida de volta pelo banco, então vai num segundo passo
            self._rest("PATCH", "laps", {"user_id": f"eq.{me}", "game": f"eq.{game}", "car": f"eq.{lap['car']}", "track": f"eq.{lap['track']}"},
                       {"setup_name": setup["name"], "setup_json": json.dumps(setup["content"])}, prefer="return=minimal")
        if self.settings.get("team_share_clip"):
            self._clip_async(lap, game)
        return {"sent": True, "setup": share}

    # --- clipe de vídeo da volta ------------------------------------------------
    def _clip_async(self, lap: dict, game: str):
        def go():
            try:
                self.upload_clip(lap, game)
            except Exception as e:  # noqa: BLE001
                self.last_error = f"Clipe: {e}"
        threading.Thread(target=go, daemon=True).start()

    def upload_clip(self, lap: dict, game: str) -> str | None:
        """Corta do vídeo da sessão só esta volta (720p, ~2 Mbps) e envia. Um clipe por carro/pista."""
        import subprocess
        import tempfile
        sess = self.db.session(lap["session_id"]) or {}
        vp, v0 = sess.get("video_path"), sess.get("video_start")
        if not (vp and v0 and lap.get("start_wall") and os.path.exists(vp)):
            return None
        start = max(0.0, lap["start_wall"] - v0 + (sess.get("video_offset") or 0) - 1.0)
        dur = lap["lap_time_ms"] / 1000 + 2.0
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:  # noqa: BLE001
            return None
        out = os.path.join(tempfile.gettempdir(), f"pitwall-clip-{lap['id']}.mp4")
        cmd = [ff, "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-i", vp, "-t", f"{dur:.2f}",
               "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
               "-maxrate", "2500k", "-bufsize", "5000k", "-an", "-movflags", "+faststart", out]
        flags = 0x08000000 if os.name == "nt" else 0
        subprocess.run(cmd, check=True, timeout=900, creationflags=flags)
        try:
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{game}_{lap['car']}_{lap['track']}")
            path = f"{self.user['id']}/{safe}.mp4"
            with open(out, "rb") as fh:
                self._storage_put("clips", path, fh.read(), "video/mp4")
            self._rest("PATCH", "laps", {"user_id": f"eq.{self.user['id']}", "game": f"eq.{game}",
                                          "car": f"eq.{lap['car']}", "track": f"eq.{lap['track']}"},
                       {"clip_path": path}, prefer="return=minimal")
            return path
        finally:
            try:
                os.remove(out)
            except OSError:
                pass

    def upload_records(self) -> dict:
        """Manda os recordes que a nuvem ainda não tem (ou que são melhores que os de lá)."""
        sent, skipped, errors = 0, 0, []
        demo = set(self.db.demo_session_ids())
        known = {(r["game"], r["car"], r["track"]): r["lap_time_ms"] for r in
                 (self._rest("GET", "laps", {"select": "game,car,track,lap_time_ms", "user_id": f"eq.{self.user['id']}",
                                             "limit": "1000"}) or [])}
        pbs = [pb for pb in self.db.personal_bests().values() if pb["session_id"] not in demo]
        self.sync_info.update(total=len(pbs), sent=0)
        for pb in pbs:
            try:
                r = self.upload_lap(pb["lap_id"], known=known)
                sent += r["sent"]
                skipped += not r["sent"]
                self.sync_info["sent"] = sent
            except TeamError as e:
                errors.append(str(e))
                break
        return {"sent": sent, "skipped": skipped, "errors": errors}

    # --- envio automático -------------------------------------------------------
    def sync_soon(self):
        """Pede uma sincronização agora (depois de entrar, criar ou entrar numa equipe)."""
        self._sync_now.set()

    def start_auto_sync(self, every_s: int = 600):
        """Thread que mantém seus recordes na nuvem sem você clicar em nada:
        ao abrir o app, ao entrar numa equipe e a cada 10 min (tenta de novo se estava sem internet)."""
        if self._sync_started:
            return
        self._sync_started = True

        def loop():
            self._sync_now.wait(20)          # dá tempo do app abrir
            while True:
                self._sync_now.clear()
                if self.configured and self.settings.get("team_auto_upload"):
                    self.sync_info.update(state="syncing")
                    try:
                        r = self.upload_records()
                        self.sync_info.update(state="error" if r["errors"] else "ok", sent=r["sent"],
                                              total=r["sent"] + r["skipped"], error=(r["errors"] or [None])[0],
                                              at=dt.datetime.now().isoformat(timespec="seconds"))
                        self.last_error = r["errors"][0] if r["errors"] else None
                    except TeamError as e:
                        self.sync_info.update(state="error", error=str(e))
                        self.last_error = str(e)
                    except Exception as e:  # noqa: BLE001
                        self.sync_info.update(state="error", error=str(e))
                self._sync_now.wait(every_s)

        threading.Thread(target=loop, daemon=True, name="pitwall-auto-sync").start()

    def sync_pb(self, car: str, track: str) -> dict:
        """Depois de mudar a validade de uma volta: deixa na nuvem o recorde atual (ou nenhum)."""
        pb = self.db.pb_for(car, track)
        if pb:
            return self.upload_lap(pb["lap_id"], force=True)
        self._rest("DELETE", "laps", {"user_id": f"eq.{self.user['id']}", "car": f"eq.{car}", "track": f"eq.{track}"})
        return {"sent": False, "removed": True}

    def upload_async_if_pb(self, lap_id: int, car: str, track: str):
        """Chamado depois de cada volta: se for recorde novo, envia em segundo plano."""
        if not (self.configured and self.settings.get("team_auto_upload")):
            return
        pb = self.db.pb_for(car, track)
        if not pb or pb["lap_id"] != lap_id:
            return

        def go():
            try:
                self.upload_lap(lap_id)
                self.last_error = None
            except TeamError as e:
                self.last_error = str(e)
        threading.Thread(target=go, daemon=True).start()

    # --- baixar a volta de um companheiro -------------------------------------
    def import_lap(self, remote_id: str) -> int:
        rows = self._rest("GET", "laps", {"select": "id,user_id,game,car,track,lap_time_ms,s1_ms,s2_ms,s3_ms,air_temp,road_temp,recorded_at,uploaded_at,telemetry,setup_name,clip_path,events,profiles(name)", "id": f"eq.{remote_id}"}) or []
        if not rows:
            raise TeamError("volta não encontrada na equipe")
        r = rows[0]
        tel = unpack(base64.b64decode(r["telemetry"]))
        driver = (r.get("profiles") or {}).get("name") or "Equipe"
        lap_id = self.db.replace_external(
            "team", r["car"], r["track"], driver, str(r["recorded_at"])[:19],
            {"lap_number": 0, "stint": 1, "lap_time_ms": r["lap_time_ms"], "s1_ms": r.get("s1_ms"),
             "s2_ms": r.get("s2_ms"), "s3_ms": r.get("s3_ms"), "valid": 1, "out_lap": 0, "in_lap": 0,
             "air_temp": r.get("air_temp"), "road_temp": r.get("road_temp"), "start_wall": 1000.0,
             "recorded_at": str(r["recorded_at"])[:19], "telemetry": tel, "events": []},
            remote_id=r["id"])
        # clipe de vídeo: baixa para assistir lado a lado na Análise e no Replay
        if r.get("clip_path"):
            try:
                vdir = data_dir() / "videos" / "equipe"
                vdir.mkdir(parents=True, exist_ok=True)
                dest = vdir / f"{r['id']}.mp4"
                if not dest.exists():
                    urllib.request.urlretrieve(self.public_url("clips", r["clip_path"]), dest)
                sid = self.db.lap(lap_id, with_telemetry=False)["session_id"]
                self.db.set_session_video(sid, video_path=str(dest), video_start=999.0)   # clipe começa 1 s antes
            except Exception as e:  # noqa: BLE001
                self.last_error = f"Clipe da equipe: {e}"
        return lap_id

    # --- biblioteca de setups da equipe (plano Equipe) ------------------------------
    def setup_library(self, team_id: str) -> dict:
        return self._rpc("team_setup_library", {"p_team": team_id}) or {"ok": False, "error": "erro"}

    def share_setup(self, team_id: str, setup_id: int, note: str = "") -> dict:
        s = self.db.setup(setup_id)
        if not s:
            raise TeamError("Setup não encontrado.")
        pb = None
        try:
            pb = self.db.pb_for(s["car"], s["track"])
        except Exception:  # noqa: BLE001
            pb = None
        content = s["content"] if isinstance(s["content"], str) else json.dumps(s["content"])
        r = self._rpc("share_team_setup", {"p_team": team_id, "p_game": "acc", "p_car": s["car"], "p_track": s["track"], "p_name": s["name"],
                                           "p_content": content, "p_lap_ms": (pb or {}).get("lap_time_ms"), "p_air": (pb or {}).get("air_temp"),
                                           "p_road": (pb or {}).get("road_temp"), "p_note": (note or "").strip() or None})
        return r or {"ok": False}

    def import_library_item(self, team_id: str, kind: str, item_id: str) -> dict:
        r = self._rpc("team_setup_get", {"p_team": team_id, "p_kind": kind, "p_id": item_id}) or {}
        if not r.get("ok"):
            raise TeamError({"plano": "Os setups da equipe são do plano Pro ou Equipe. Veja o menu Plano.", "membro": "Você não é desta equipe.", "limite_teste": "No teste grátis dá para baixar só 2 setups. Assine o Pro ou o Equipe para baixar sem limite."}.get(r.get("error"), "Setup não encontrado."))
        from . import setups
        return setups.save_shared(self.db, r["car"], r["track"], f"Equipe - {r.get('who') or 'Equipe'} - {r['name']}", json.loads(r["content"]))

    def delete_library_item(self, team_id: str, item_id: str) -> dict:
        return self._rpc("delete_team_setup", {"p_team": team_id, "p_id": item_id}) or {"ok": False}

    def import_setup(self, remote_id: str) -> dict:
        """Salva no ACC (e na biblioteca) o setup que o companheiro usou nessa volta."""
        r = self._rpc("lap_setup_get", {"p_lap": remote_id}) or {}
        if not r.get("ok"):
            raise TeamError({"plano": "Os setups da equipe são do plano Pro ou Equipe. Veja o menu Plano.", "membro": "Esse setup é só para quem está na mesma equipe.",
                             "nao_achou": "Essa volta não tem setup.", "limite_teste": "No teste grátis dá para baixar só 2 setups. Assine o Pro ou o Equipe para baixar sem limite."}.get(r.get("error"), "Não foi possível baixar o setup."))
        from . import setups
        return setups.save_shared(self.db, r["car"], r["track"], f"Equipe - {r.get('who') or 'Equipe'} - {r['name']}", json.loads(r["content"]))
