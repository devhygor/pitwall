"""Janela própria do Pitwall (em vez do navegador).

Usa o pywebview, que no Windows abre a interface com o WebView2 do Edge — o
mesmo motor que apps como o GO FAST usam. Fechar a janela (X) só a esconde:
o Pitwall continua rodando perto do relógio, gravando quando o ACC abrir.
Para encerrar de vez, use "Sair" no ícone.
"""
from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

from .db import data_dir

ROOT = Path(__file__).resolve().parent.parent
APP_ID = "Pitwall.App"


def available() -> bool:
    import importlib.util
    return importlib.util.find_spec("webview") is not None


def icon_path() -> Path:
    p = data_dir() / "pitwall.ico"
    if not p.exists():
        from . import tray
        tray.save_ico(p)
    return p


def _set_app_id():
    """Faz o Windows tratar o Pitwall como um app próprio na barra de tarefas."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:  # noqa: BLE001
        pass


def _set_window_icon(title: str):
    if sys.platform != "win32":
        return
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return
        ico = str(icon_path())
        for size, which in ((16, 0), (32, 1)):        # ICON_SMALL, ICON_BIG
            h = user32.LoadImageW(None, ico, 1, size, size, 0x10)   # IMAGE_ICON, LR_LOADFROMFILE
            if h:
                user32.SendMessageW(hwnd, 0x80, which, h)            # WM_SETICON
    except Exception:  # noqa: BLE001
        pass


def run(url: str, recorder, server, app, start_hidden: bool = False):
    """Roda a janela na thread principal (bloqueia até "Sair")."""
    import webview

    from . import tray

    _set_app_id()
    state = {"quitting": False, "loaded": False, "told": False}
    title = "Pitwall"
    win = webview.create_window(
        title, url=None if start_hidden else url, html="<body style='background:#0b0d10'></body>" if start_hidden else None,
        width=1520, height=960, min_size=(1100, 700), hidden=start_hidden, background_color="#0b0d10")
    state["loaded"] = not start_hidden
    icon = None

    def show():
        if not state["loaded"]:
            state["loaded"] = True
            win.load_url(url)
        win.show()
        try:
            win.restore()
        except Exception:  # noqa: BLE001
            pass

    def quit_all():
        state["quitting"] = True
        server.should_exit = True
        try:
            win.destroy()
        except Exception:  # noqa: BLE001
            pass

    def on_closing():
        if state["quitting"] or icon is None:
            server.should_exit = True
            return True
        win.hide()
        if not state["told"]:
            state["told"] = True
            tray.notify(icon, "Continua rodando aqui perto do relógio e grava quando o ACC abrir. "
                              "Para fechar de vez, use Sair no ícone.", "Pitwall")
        return False   # cancela o fechamento: só esconde

    win.events.closing += on_closing
    win.events.shown += lambda: _set_window_icon(title)
    app.state.ui_show = show          # a 2ª abertura do Pitwall só mostra esta janela

    # janelinha do delta ao vivo (sempre por cima do jogo)
    ov = {"win": None}

    def overlay(show_it: bool | None = None):
        visible = ov["win"] is not None
        want = (not visible) if show_it is None else show_it
        if want and not visible:
            try:
                sw = webview.screens[0].width if webview.screens else 1920
            except Exception:  # noqa: BLE001
                sw = 1920
            ov["win"] = webview.create_window(
                "Pitwall Delta", url + "/#/overlay", width=380, height=136, x=int(sw / 2 - 190), y=36,
                on_top=True, frameless=True, easy_drag=True, resizable=False, background_color="#0b0d10")
            ov["win"].events.closed += lambda: ov.update(win=None)
        elif not want and visible:
            try:
                ov["win"].destroy()
            except Exception:  # noqa: BLE001
                pass
            ov["win"] = None
        return ov["win"] is not None
    app.state.ui_overlay = overlay

    # janela do LFM dentro do Pitwall (o próprio site do LFM, com o seu login)
    lw = {"win": None}

    def lfm_window(target: str):
        if lw["win"] is not None:
            try:
                lw["win"].load_url(target)
                lw["win"].show()
                lw["win"].restore()
                return True
            except Exception:  # noqa: BLE001
                lw["win"] = None
        lw["win"] = webview.create_window("LFM · Low Fuel Motorsport", target, width=1360, height=900,
                                          min_size=(900, 600), background_color="#0b0d10")
        lw["win"].events.closed += lambda: lw.update(win=None)
        threading.Thread(target=_lfm_token_watch, args=(lw["win"],), daemon=True).start()
        return True

    def _lfm_token_watch(w):
        """Enquanto a janela do LFM está aberta, pega o login (token) para LER suas inscrições."""
        import json
        import time
        lfm = getattr(app.state, "lfm", None)
        last = None
        while lw["win"] is w and not state["quitting"]:
            time.sleep(3)
            try:
                if "lowfuelmotorsport.com" not in (w.get_current_url() or ""):
                    continue
                raw = w.evaluate_js("localStorage.getItem('currentUser')")
            except Exception:  # noqa: BLE001
                continue
            if not raw or raw == last or lfm is None:
                continue
            last = raw
            try:
                cu = json.loads(raw)
                tok = cu.get("accessToken")
                if tok:
                    lfm.set_account(tok, cu.get("userData") or {}, (cu.get("token") or {}).get("expires_at"))
            except Exception:  # noqa: BLE001
                pass
    app.state.ui_lfm = lfm_window

    def auto_overlay():
        """Abre o delta sozinho ao entrar na pista (se ligado nas Configurações) e fecha ao sair."""
        import time
        was = False
        while not state["quitting"]:
            time.sleep(1.5)
            rec = (recorder.live or {}).get("state") == "recording"
            enabled = bool(app.state.settings and app.state.settings.get("overlay_enabled"))
            if rec != was:
                was = rec
                if enabled:
                    try:
                        overlay(rec)
                    except Exception:  # noqa: BLE001
                        pass
    threading.Thread(target=auto_overlay, daemon=True).start()

    if tray.available():
        try:
            icon = tray.start(recorder, on_open=show, on_quit=quit_all, detached=True,
                              on_overlay=lambda: overlay())
        except Exception as e:  # noqa: BLE001
            print(f"Ícone na bandeja indisponível ({e})")
            icon = None
    alerts = getattr(app.state, "lfm_alerts", None)
    if alerts is not None and icon is not None:
        alerts.notifiers.append(lambda msg, title: tray.notify(icon, msg, title))
    storage = data_dir() / "webview"
    storage.mkdir(exist_ok=True)
    webview.start(private_mode=False, storage_path=str(storage))
    server.should_exit = True
    if icon is not None:
        try:
            icon.stop()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# Atalhos na Área de Trabalho e no Menu Iniciar
# ---------------------------------------------------------------------------

def create_shortcuts() -> dict:
    if sys.platform != "win32":
        return {"ok": False, "error": "só no Windows"}
    exe = Path(sys.executable)
    if getattr(sys, "frozen", False):        # instalado: atalho direto para o Pitwall.exe
        target, ico, workdir, args = exe, exe, exe.parent, ""
    else:
        pyw = exe.with_name("pythonw.exe")
        target, ico, workdir = (pyw if pyw.exists() else exe), icon_path(), ROOT
        args = f'"{ROOT / "pitwall.pyw"}"'
    launcher = args
    ps = f"""
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {{
  $s = $ws.CreateShortcut((Join-Path $dir 'Pitwall.lnk'))
  $s.TargetPath = '{target}'
  $s.Arguments = '{launcher}'
  $s.WorkingDirectory = '{workdir}'
  $s.IconLocation = '{ico},0'
  $s.Description = 'Pitwall - engenheiro de corrida para o ACC'
  $s.Save()
}}
"""
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       capture_output=True, text=True, creationflags=0x08000000)
    return {"ok": r.returncode == 0, "error": r.stderr.strip()[-300:] if r.returncode else None}

