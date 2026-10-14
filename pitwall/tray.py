"""Ícone na bandeja do Windows (perto do relógio) para o modo segundo plano.

Mostra o status, abre a interface e encerra o Pitwall. Também avisa com uma
notificação quando começa a gravar uma sessão — assim você tem certeza de que
está gravando sem sair do jogo.
"""
from __future__ import annotations

import threading
import time
import webbrowser


def available() -> bool:
    import importlib.util
    return all(importlib.util.find_spec(m) is not None for m in ("pystray", "PIL"))


def _icon_image(recording: bool, s: int = 64):
    from PIL import Image, ImageDraw
    k = s / 64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = (63, 214, 139, 255) if recording else (255, 176, 32, 255)
    d.rounded_rectangle((4 * k, 4 * k, s - 4 * k, s - 4 * k), radius=14 * k, fill=(19, 22, 27, 255),
                        outline=color, width=max(1, round(5 * k)))
    # letra P: "barriga" (anel arredondado) + haste
    bg = (19, 22, 27, 255)
    d.rounded_rectangle((20 * k, 15 * k, 46 * k, 40 * k), radius=12 * k, fill=color)
    d.rounded_rectangle((27 * k, 22 * k, 39 * k, 33 * k), radius=5 * k, fill=bg)
    d.rectangle((20 * k, 15 * k, 27 * k, 50 * k), fill=color)
    return img


def _pretty(name: str) -> str:
    return " ".join(w.capitalize() for w in str(name or "").replace("_", " ").split())


def start(recorder, on_open, on_quit, detached: bool = True, on_overlay=None):
    """Cria o ícone. Com detached=True ele roda em paralelo (a janela do app
    fica com a thread principal); senão bloqueia até "Sair"."""
    import pystray

    state = {"rec": False, "session": None}

    def status_text(_item=None):
        l = recorder.live or {}
        if l.get("state") == "recording":
            return f"Gravando · {_pretty(l.get('track'))} · volta {l.get('lap')}" + (" · REC" if l.get("video") else "")
        if l.get("state") == "pause":
            return "ACC pausado"
        return "Aguardando o ACC"

    def quit_(icon, _item=None):
        icon.visible = False
        icon.stop()
        on_quit()

    icon = pystray.Icon(
        "pitwall", _icon_image(False), "Pitwall",
        menu=pystray.Menu(
            pystray.MenuItem(status_text, None, enabled=False),
            pystray.MenuItem("Abrir o Pitwall", lambda *_: on_open(), default=True),
            *([pystray.MenuItem("Delta ao vivo (mostrar/esconder)", lambda *_: on_overlay())] if on_overlay else []),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Sair", quit_),
        ))

    def watch():
        while True:
            time.sleep(2)
            l = recorder.live or {}
            rec = l.get("state") == "recording"
            if rec != state["rec"]:
                state["rec"] = rec
                try:
                    icon.icon = _icon_image(rec)
                    icon.title = f"Pitwall — {status_text()}"
                except Exception:  # noqa: BLE001
                    pass
            if rec and l.get("session_id") != state["session"]:
                state["session"] = l.get("session_id")
                time.sleep(1)                      # dá tempo de escolher o setup sugerido
                l = recorder.live or {}
                msg = f"{_pretty(l.get('track'))} · {_pretty(l.get('car'))}" + (" · gravando vídeo" if l.get("video") else "")
                if l.get("suggested_setup"):
                    msg += f"\nSetup sugerido: {l['suggested_setup']}"
                notify(icon, msg, "Pitwall está gravando")
            try:
                icon.update_menu()
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=watch, daemon=True).start()
    if detached:
        icon.run_detached()
    else:
        icon.run()
    return icon


def notify(icon, msg: str, title: str = "Pitwall"):
    try:
        icon.notify(msg, title)
    except Exception:  # noqa: BLE001
        pass


def run(url: str, recorder, on_quit):
    """Modo sem janela própria: o ícone abre o navegador."""
    start(recorder, on_open=lambda: webbrowser.open(url), on_quit=on_quit, detached=False)


def save_ico(path) -> str:
    """Gera o ícone .ico (atalhos e janela)."""
    img = _icon_image(False, 256)
    img.save(path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return str(path)
