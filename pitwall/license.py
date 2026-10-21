"""Plano e licença do Pitwall.

O servidor (função de borda "license" no Supabase) confere o pagamento/cortesia/teste e devolve um TOKEN assinado
com Ed25519. O app só aceita o token se a assinatura bater com a chave pública embutida aqui, se não tiver vencido
e se for deste computador. O token dura poucos dias e é renovado toda vez que o Pitwall abre com internet.

Identificação: pelo login com o Google (mesmo e-mail do pagamento) ou colando a chave de licença (PW-XXXX-...).

Nada aqui "libera" sozinho: sem um token válido o plano é o Grátis. Qualquer erro (sem biblioteca, relógio
voltado, token alterado) cai no Grátis.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import sys
import threading
import time
import urllib.error
import urllib.request

from .db import data_dir

SUPABASE_URL = "https://iddijempjbyguqfhotij.supabase.co"
FUNC_URL = f"{SUPABASE_URL}/functions/v1/license"
PUBKEY_X = "aNMQWbEsoHvV_HsywrLJ4u6b_y_w0dwk3pv7gufUpAk"       # chave pública Ed25519 (base64url)
SKEW = 3600                                                       # tolerância do relógio (1 h)

FREE_FEATURES = ["voice_basic"]
FEATURE_NAMES = {
    "voice_basic": "Engenheiro de voz básico", "voice_full": "Engenheiro de voz completo", "voice_online": "Voz online",
    "voice_personality": "Personalidade do engenheiro", "spotter": "Observador (carros ao lado)",
    "video_unlimited": "Vídeos sem limite", "setups_unlimited": "Setups sem limite", "team_multi": "Várias equipes",
    "no_ads": "Sem anúncios", "team_admin": "Painel da equipe",
}
PLAN_NAMES = {"free": "Grátis", "pro": "Pro", "team": "Equipe"}
UPGRADE_URL = "https://pitwall.hygor.com.br/#/planos"


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def device_id() -> tuple[str, str]:
    """(hash, nome) deste computador. O hash não revela nada; só serve para contar aparelhos."""
    guid = ""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as k:
            guid = winreg.QueryValueEx(k, "MachineGuid")[0]
    except Exception:  # noqa: BLE001
        guid = platform.node() + str(os.getenv("USERNAME", ""))
    return hashlib.sha256(("pitwall|" + guid).encode()).hexdigest()[:40], platform.node()[:60]


class License:
    def __init__(self, team=None):
        self.team = team                     # Team (login do Google), para pegar o token de acesso
        self.path = data_dir() / "license.json"
        self._lock = threading.Lock()
        self._data = self._load()
        self._payload: dict | None = None
        self._checked_at = 0.0
        self.last_error = ""
        self.busy = False
        self._started = False

    # ---- arquivo --------------------------------------------------------------------------
    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self):
        try:
            self.path.write_text(json.dumps(self._data), encoding="utf-8")
        except OSError:
            pass

    # ---- verificação do token -----------------------------------------------------------------
    def _verify(self, token: str) -> dict | None:
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
            body, sig = token.split(".")
            Ed25519PublicKey.from_public_bytes(_b64d(PUBKEY_X)).verify(_b64d(sig), body.encode())
            p = json.loads(_b64d(body))
        except Exception:  # noqa: BLE001
            return None
        now = time.time()
        if p.get("dev") != device_id()[0]:
            return None
        if now > float(p.get("exp", 0)) or now + SKEW < float(p.get("iat", 0)):
            return None
        seen = float(self._data.get("seen", 0))
        if now + SKEW < seen:                # relógio voltado: só vale de novo depois de renovar online
            return None
        return p

    def payload(self) -> dict | None:
        """Token válido agora (ou None = plano Grátis)."""
        dev = os.environ.get("PITWALL_DEV_PLAN")
        if dev and not getattr(sys, "frozen", False):            # só rodando do código-fonte, nunca no app instalado
            return {"plan": dev, "features": _dev_features(dev), "src": "dev", "email": "dev", "exp": time.time() + 3600}
        now = time.time()
        if self._payload is not None and now < float(self._payload.get("exp", 0)) and now - self._checked_at < 60:
            return self._payload
        tok = self._data.get("token")
        p = self._verify(tok) if tok else None
        self._payload, self._checked_at = p, now
        if p and now - float(self._data.get("seen", 0)) > 600:
            self._data["seen"] = now
            self._save()
        return p

    @property
    def plan(self) -> str:
        p = self.payload()
        return p.get("plan", "free") if p else "free"

    def has(self, feature: str) -> bool:
        p = self.payload()
        feats = p.get("features") if p else None
        return feature in (feats if isinstance(feats, list) else FREE_FEATURES)

    # ---- servidor -------------------------------------------------------------------------
    def _call(self, action: str, key: str = "") -> dict:
        h, label = device_id()
        body = {"action": action, "device": {"hash": h, "label": label}, "app_version": _version()}
        if key:
            body["key"] = key
        headers = {"Content-Type": "application/json", "apikey": _anon_key()}
        if self.team is not None and self.team.configured:
            try:
                headers["Authorization"] = f"Bearer {self.team._token()}"
            except Exception:  # noqa: BLE001
                pass
        req = urllib.request.Request(FUNC_URL, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read())
            except ValueError:
                return {"ok": False, "error": f"http_{e.code}"}
        except (urllib.error.URLError, TimeoutError, OSError):
            return {"ok": False, "error": "offline"}

    ERRORS = {
        "auth": "Entre com o Google (menu Equipe) ou cole a sua chave de licença.",
        "key_invalid": "Essa chave de licença não existe ou foi cancelada.",
        "device_limit": "Esta licença já está em uso no número máximo de computadores. Remova um em pitwall.hygor.com.br, na sua conta.",
        "trial_used": "O teste grátis já foi usado neste e-mail ou computador.",
        "already_paid": "Você já tem um plano pago.",
        "login": "Entre com o Google para começar o teste grátis.",
        "offline": "Sem conexão com o servidor do Pitwall. O plano atual continua valendo até o token vencer.",
    }

    def refresh(self, key: str = "", action: str = "refresh") -> dict:
        """Pede um token novo ao servidor. Devolve o status."""
        with self._lock:
            self.busy = True
            try:
                key = key or self._data.get("key", "")
                r = self._call(action, key)
                if r.get("ok") and r.get("token"):
                    if self._verify_new(r["token"]):
                        self._data.update({"token": r["token"], "key": key or self._data.get("key", ""), "seen": time.time(),
                                           "email": r.get("email"), "license_key": r.get("license_key"), "ends_at": r.get("ends_at"),
                                           "source": r.get("source"), "plan": r.get("plan"), "checked": time.time()})
                        self._save()
                        self._payload = None
                        self.last_error = ""
                    else:
                        self.last_error = "O servidor respondeu com uma licença que não confere. Atualize o Pitwall."
                else:
                    err = r.get("error", "erro")
                    self.last_error = self.ERRORS.get(err, f"Não deu para validar a licença ({err}).")
                    if err == "key_invalid":                 # chave cancelada ou inexistente: volta ao Grátis
                        for k in ("token", "key", "license_key", "plan", "ends_at"):
                            self._data.pop(k, None)
                        self._save()
                        self._payload = None
                return self.status()
            finally:
                self.busy = False

    def _verify_new(self, token: str) -> bool:
        keep = self._data.get("seen")
        self._data["seen"] = 0                       # o relógio é conferido contra o último "visto"; token novo reinicia
        ok = self._verify(token) is not None
        if keep is not None and not ok:
            self._data["seen"] = keep
        return ok

    def activate_key(self, key: str) -> dict:
        return self.refresh(key=key.strip().upper(), action="activate")

    def start_trial(self) -> dict:
        return self.refresh(action="trial")

    def clear(self):
        self._data = {}
        self._payload = None
        self._save()

    def start(self):
        """Renova o token ao abrir e a cada 6 horas (em segundo plano)."""
        if self._started:
            return
        self._started = True

        def loop():
            time.sleep(5)
            while True:
                try:
                    if self._data.get("token") or self._data.get("key") or (self.team is not None and self.team.configured):
                        self.refresh()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(6 * 3600)
        threading.Thread(target=loop, daemon=True, name="pitwall-license").start()

    # ---- para a tela ----------------------------------------------------------------------
    def status(self) -> dict:
        p = self.payload()
        plan = p.get("plan", "free") if p else "free"
        feats = p.get("features") if p else FREE_FEATURES
        return {
            "plan": plan, "plan_name": PLAN_NAMES.get(plan, plan), "source": (p or {}).get("src", "free"),
            "email": (p or {}).get("email") or self._data.get("email"),
            "ends_at": self._data.get("ends_at") if p else None, "token_exp": (p or {}).get("exp"),
            "features": [{"id": f, "name": FEATURE_NAMES.get(f, f)} for f in (feats or [])],
            "license_key": self._data.get("license_key") or self._data.get("key"),
            "logged_in": bool(self.team is not None and self.team.configured),
            "error": self.last_error, "busy": self.busy, "upgrade_url": UPGRADE_URL,
            "needs_refresh": bool(self._data.get("token")) and p is None,
        }


def _version() -> str:
    try:
        from ._version import __version__
        return __version__
    except Exception:  # noqa: BLE001
        return "dev"


def _anon_key() -> str:
    from .team import SUPABASE_KEY
    return SUPABASE_KEY


def _dev_features(plan: str) -> list[str]:
    allf = list(FEATURE_NAMES)
    return allf if plan in ("pro", "team") else FREE_FEATURES
