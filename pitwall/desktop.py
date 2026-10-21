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

    # overlays transparentes por cima do jogo (mapa, pedais, participantes e delta)
    ov: dict = {}                      # nome -> {"win", "nat": (w, h) tamanho natural da página}
    ov_lock = threading.RLock()
    ov_save = {}
    TITLES = {"map": "Pitwall Mapa", "pedals": "Pitwall Pedais", "standings": "Pitwall Participantes", "delta": "Pitwall Delta",
              "tyres": "Pitwall Pneus", "corner": "Pitwall Curva"}

    def ov_cfg(name):
        from .settings import merged_overlays
        return merged_overlays(app.state.settings.get("overlays"))[name]

    def ov_default_pos(name):
        try:
            sw, sh = webview.screens[0].width, webview.screens[0].height
        except Exception:  # noqa: BLE001
            sw, sh = 1920, 1080
        return {"map": (sw - 460, 60), "pedals": (int(sw / 2 - 260), sh - 260), "standings": (24, 180),
                "delta": (int(sw / 2 - 190), 36), "tyres": (24, sh - 330), "corner": (int(sw / 2 - 165), 120)}[name]

    def ov_glass(name, win):
        """Fundo realmente transparente (vidro do Windows) e, fora do modo de edição, cliques atravessam."""
        if sys.platform != "win32":
            return
        try:
            import ctypes

            from System import Action
            from System.Drawing import Color
            form = win.native
            editing = bool(app.state.settings.get("overlay_edit"))

            def go():
                hwnd = int(form.Handle.ToInt64())
                form.BackColor = Color.Black

                class M(ctypes.Structure):
                    _fields_ = [("a", ctypes.c_int), ("b", ctypes.c_int), ("c", ctypes.c_int), ("d", ctypes.c_int)]
                v = ctypes.c_int(1)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 38, ctypes.byref(v), 4)      # sem Mica
                none = ctypes.c_uint(0xFFFFFFFE)                                              # DWMWA_COLOR_NONE
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(none), 4)   # sem cor de borda
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(v), 4)      # cantos retos (sem arredondar)
                ctypes.windll.dwmapi.DwmExtendFrameIntoClientArea(hwnd, ctypes.byref(M(-1, -1, -1, -1)))
                u = ctypes.windll.user32
                ex = u.GetWindowLongW(hwnd, -20) | 0x80000 | 0x80               # LAYERED + TOOLWINDOW (fora do Alt+Tab)
                ex = (ex & ~0x20) if editing else (ex | 0x20)                  # TRANSPARENT = cliques atravessam
                u.SetWindowLongW(hwnd, -20, ex)
                u.SetLayeredWindowAttributes(hwnd, 0, 255, 2)
            def safe():
                try:
                    go()
                except Exception as e:  # noqa: BLE001
                    print("overlay: não deu para aplicar o vidro:", repr(e), file=sys.stderr)
            form.Invoke(Action(safe))
        except Exception as e:  # noqa: BLE001
            print("overlay: vidro indisponível:", repr(e), file=sys.stderr)

    def ov_apply_size(name):
        d = ov.get(name)
        if not d or not d.get("nat"):
            return
        sc = ov_cfg(name)["scale"] / 100.0
        w, h = int(d["nat"][0] * sc) + 2, int(d["nat"][1] * sc) + 2
        if d.get("size") != (w, h):
            d["size"] = (w, h)
            try:
                d["win"].resize(w, h)
            except Exception:  # noqa: BLE001
                pass

    def ov_moved(name, x, y):
        ov_save[name] = (x, y)
        if name in ov:
            ov[name]["pos"] = (int(x), int(y))

        def flush():
            xy = ov_save.pop(name, None)
            if xy and app.state.settings:
                app.state.settings.update({"overlays": {name: {"x": int(xy[0]), "y": int(xy[1])}}})
        t = ov.get(name, {}).get("timer")
        if t:
            t.cancel()
        if name in ov:
            ov[name]["timer"] = threading.Timer(0.6, flush)
            ov[name]["timer"].start()

    def ov_open(name):
        cfg = ov_cfg(name)
        x, y = (cfg["x"], cfg["y"]) if cfg["x"] is not None and cfg["y"] is not None else ov_default_pos(name)
        w = webview.create_window(TITLES[name], f"{url}/overlay/{name}", width=420, height=220, x=int(x), y=int(y),
                                  frameless=True, easy_drag=True, resizable=False, on_top=True, transparent=True,
                                  focus=False, shadow=False, background_color="#000000")
        ov[name] = {"win": w, "nat": None, "size": None, "pos": (int(x), int(y))}
        w.events.shown += lambda: ov_glass(name, w)
        w.events.loaded += lambda: ov_glass(name, w)
        w.events.moved += lambda x, y: ov_moved(name, x, y)
        w.events.closed += lambda: ov.pop(name, None)

    def ov_wanted(name):
        cfg = ov_cfg(name)
        if cfg["mode"] == "off":
            return False
        if app.state.settings.get("overlay_edit") or cfg["mode"] == "always":
            return True
        return (recorder.live or {}).get("state") == "recording"

    def ov_sync():
        with ov_lock:
            for name in TITLES:
                want, has = ov_wanted(name), name in ov
                try:
                    if want and not has:
                        ov_open(name)
                    elif has and not want:
                        t = ov[name].get("timer")
                        if t:
                            t.cancel()
                        ov.pop(name)["win"].destroy()
                    elif has:
                        ov_apply_size(name)
                        c = ov_cfg(name)
                        if c["x"] is not None and c["y"] is not None and ov[name].get("pos") != (c["x"], c["y"]):
                            ov[name]["pos"] = (c["x"], c["y"])
                            ov[name]["win"].move(int(c["x"]), int(c["y"]))
                        ed = bool(app.state.settings.get("overlay_edit"))
                        if ov[name].get("edit") != ed:
                            ov[name]["edit"] = ed
                            ov_glass(name, ov[name]["win"])
                except Exception:  # noqa: BLE001
                    pass

    def overlay(show_it: bool | None = None):
        """Modo de edição: mostra todos os overlays ligados, com cliques, para posicionar e conferir."""
        st = app.state.settings
        want = (not st.get("overlay_edit")) if show_it is None else show_it
        st.update({"overlay_edit": want})
        ov_sync()
        return want

    def ov_scale(name, scale, anchor):
        """Alça arrastada no overlay: aplica a escala já e mantém o canto oposto no lugar."""
        scale = max(40, min(300, int(scale)))
        with ov_lock:
            d = ov.get(name)
            st = app.state.settings
            if not d or not d.get("nat") or not st:
                return
            w1, h1 = int(d["nat"][0] * scale / 100) + 2, int(d["nat"][1] * scale / 100) + 2
            w0, h0 = d.get("size") or (w1, h1)
            x, y = d.get("pos") or (0, 0)
            nx = x + (w0 - w1) if anchor[:1] == "r" else x
            ny = y + (h0 - h1) if anchor[1:2] == "b" else y
            d["size"], d["pos"] = (w1, h1), (nx, ny)
            try:
                d["win"].resize(w1, h1)
                if (nx, ny) != (x, y):
                    d["win"].move(nx, ny)
            except Exception:  # noqa: BLE001
                pass
            st.update({"overlays": {name: {"scale": scale, "x": nx, "y": ny}}})

    def ov_size(name, w, h):
        with ov_lock:
            if name in ov:
                ov[name]["nat"] = (w, h)
                ov_apply_size(name)
    app.state.ui_overlay = overlay
    app.state.ui_overlay_sync = ov_sync
    app.state.ui_overlay_size = ov_size
    app.state.ui_overlay_scale = ov_scale

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
        """Abre os overlays sozinhos ao entrar na pista (modo "só na pista") e fecha ao sair."""
        import time
        while not state["quitting"]:
            time.sleep(1.5)
            try:
                ov_sync()
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

