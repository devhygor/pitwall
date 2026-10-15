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
SITE_URL = "https://devhygor.github.io/pitwall/"

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
            raise TeamError(f"Não deu para enviar o arquivo: {e.read().decode(errors='replace')[:200]}") from None
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
               "last_error": self.last_error, "teams": []}
        if self.configured:
            try:
                out["teams"] = self.teams()
            except TeamError as e:
                out["error"] = str(e)
                out["logged_in"] = self.configured
        return out

    def teams(self) -> list[dict]:
        me = self.user["id"]
        rows = self._rest("GET", "team_members", {"select": "role,teams(id,name,invite_code,owner,created_at,logo_url)",
                                                  "user_id": f"eq.{me}"}) or []
        out = []
        for r in rows:
            t = r.get("teams") or {}
            if t:
                out.append({**t, "role": r["role"], "invite_link": SITE_URL + "#/join/" + t["invite_code"]})
        return sorted(out, key=lambda t: t["created_at"])

    def create_team(self, name: str) -> dict:
        name = (name or "").strip()
        if len(name) < 2:
            raise TeamError("Dê um nome para a equipe.")
        return self._rest("POST", "rpc/create_team", body={"team_name": name})

    def join_team(self, code: str) -> dict:
        return self._rest("POST", "rpc/join_team", body={"code": invite_code(code)})

    def leave_team(self, team_id: str):
        self._rest("DELETE", "team_members", {"team_id": f"eq.{team_id}", "user_id": f"eq.{self.user['id']}"})

    def new_invite(self, team_id: str) -> str:
        return self._rest("POST", "rpc/new_invite_code", body={"t": team_id})

    def board(self, team_id: str) -> dict:
        members = self._rest("GET", "team_members", {"select": "role,joined_at,user_id,profiles(name,avatar_url)",
                                                      "team_id": f"eq.{team_id}", "order": "joined_at.asc"}) or []
        laps = self._rest("POST", "rpc/team_board", body={"t": team_id}) or []
        me = self.user["id"]
        for l in laps:
            l["me"] = l["user_id"] == me
            l["clip_url"] = self.public_url("clips", l["clip_path"]) if l.get("clip_path") else None
        return {"members": [{"user_id": m["user_id"], "role": m["role"], "joined_at": m["joined_at"],
                             "name": (m.get("profiles") or {}).get("name") or "?",
                             "avatar_url": (m.get("profiles") or {}).get("avatar_url"),
                             "me": m["user_id"] == me} for m in members],
                "laps": laps}

    def community(self) -> list[dict]:
        """Ranking da comunidade: o recorde de cada piloto do Pitwall em cada carro/pista."""
        rows = self._rest("GET", "laps", {
            "select": "id,user_id,game,car,track,lap_time_ms,s1_ms,s2_ms,s3_ms,recorded_at,setup_name,clip_path,profiles(name,avatar_url)",
            "order": "track.asc,car.asc,lap_time_ms.asc", "limit": "3000"}) or []
        me = self.user["id"]
        for r in rows:
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
    def upload_lap(self, lap_id: int, force: bool = False) -> dict:
        lap = self.db.lap(lap_id)
        if not lap:
            raise TeamError("volta não encontrada")
        me = self.user["id"]
        sess = self.db.session(lap["session_id"]) or {}
        game = sess.get("game") or "acc"
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
               "telemetry": base64.b64encode(pack(tel)).decode(), "setup_name": None, "setup_json": None,
               "clip_path": None, "events": lap.get("events") or []}
        setup = self.db.setup(sess["setup_id"]) if sess.get("setup_id") else None
        if setup and self.settings.get("team_share_setup"):
            row["setup_name"], row["setup_json"] = setup["name"], json.dumps(setup["content"])
        self._rest("POST", "laps", {"on_conflict": "user_id,game,car,track"}, [row],
                   prefer="resolution=merge-duplicates,return=minimal")
        if self.settings.get("team_share_clip"):
            self._clip_async(lap, game)
        return {"sent": True, "setup": bool(row["setup_name"])}

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
        sent, skipped, errors = 0, 0, []
        demo = set(self.db.demo_session_ids())
        for pb in self.db.personal_bests().values():
            if pb["session_id"] in demo:      # voltas do simulador não vão para a equipe
                continue
            try:
                r = self.upload_lap(pb["lap_id"])
                sent += r["sent"]
                skipped += not r["sent"]
            except TeamError as e:
                errors.append(str(e))
                break
        return {"sent": sent, "skipped": skipped, "errors": errors}

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
        rows = self._rest("GET", "laps", {"select": "*,profiles(name)", "id": f"eq.{remote_id}"}) or []
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

    def import_setup(self, remote_id: str) -> dict:
        """Salva no ACC (e na biblioteca) o setup que o companheiro usou nessa volta."""
        rows = self._rest("GET", "laps", {"select": "car,track,setup_name,setup_json,profiles(name)", "id": f"eq.{remote_id}"}) or []
        if not rows or not rows[0].get("setup_json"):
            raise TeamError("Essa volta não tem setup.")
        r = rows[0]
        from . import setups
        driver = (r.get("profiles") or {}).get("name") or "Equipe"
        return setups.save_shared(self.db, r["car"], r["track"], f"Equipe - {driver} - {r['setup_name']}",
                                  json.loads(r["setup_json"]))
