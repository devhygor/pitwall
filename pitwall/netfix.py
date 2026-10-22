"""Certificados HTTPS: soma os certificados do Windows com os do pacote certifi.

Em alguns computadores (Windows sem atualizações, antivírus que inspeciona HTTPS) a verificação falha com
"unable to get local issuer certificate" ao falar com o GitHub e o Supabase. Com os dois conjuntos juntos
funciona tanto onde falta a raiz pública quanto onde o antivírus instalou a própria raiz no Windows.
"""
from __future__ import annotations

import os
import ssl


def install():
    try:
        import certifi
        cafile = certifi.where()
    except Exception:  # noqa: BLE001
        return
    os.environ.setdefault("SSL_CERT_FILE", cafile)       # requests, aiohttp (edge-tts) e outros leem isto
    orig = ssl.create_default_context

    def create_default_context(purpose=ssl.Purpose.SERVER_AUTH, *, cafile=None, capath=None, cadata=None):
        ctx = orig(purpose, cafile=cafile, capath=capath, cadata=cadata)
        if cafile is None and capath is None and cadata is None:
            try:
                ctx.load_verify_locations(certifi.where())
            except Exception:  # noqa: BLE001
                pass
        return ctx

    ssl.create_default_context = create_default_context
    ssl._create_default_https_context = create_default_context
