"""Ponto de entrada:

    python -m pitwall                 # grava o ACC e abre a interface
    python -m pitwall --demo          # simula um piloto (sem o jogo)
    python -m pitwall --seed-demo     # cria sessões de exemplo e sai
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser

from .db import DB
from .recorder import Recorder
from .sources import ACCSource, DemoSource


def seed_demo(db: DB):
    """Gera sessões simuladas instantaneamente (útil pra testar a interface)."""
    plan = [
        ("Practice", 9, 3, "demo_ring", "mclaren_720s_gt3_evo", 99),
        ("Race", 12, 11, "demo_ring", "mclaren_720s_gt3_evo", 5),
        ("Practice", 6, 21, "demo_ring", "bmw_m4_gt3", 99),
        ("Qualify", 5, 31, "demo_park", "mclaren_720s_gt3_evo", 99),
        ("Practice", 7, 41, "demo_park", "mclaren_720s_gt3_evo", 99),
    ]
    for i, (stype, laps, seed, track, car, pit) in enumerate(plan):
        rec = Recorder(db, game="demo")
        src = DemoSource(laps=laps, realtime=False, seed=seed, session_type=stype, session_index=i,
                         pit_after=pit, track=track, car=car)
        rec.run(src.frames())
        print(f"  sessão demo '{stype}' {track} / {car}: {rec.laps_saved} voltas gravadas")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pitwall", description="Engenheiro de corrida para o ACC")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", help="caminho do banco SQLite (padrão: %%LOCALAPPDATA%%/Pitwall)")
    ap.add_argument("--demo", action="store_true", help="usa o simulador em vez do ACC")
    ap.add_argument("--demo-speed", type=float, default=4.0, help="acelera o tempo do simulador")
    ap.add_argument("--seed-demo", action="store_true", help="cria sessões de exemplo e sai")
    ap.add_argument("--no-browser", action="store_true", help="não abre o navegador")
    ap.add_argument("--sem-video", action="store_true", help="não grava vídeo nesta execução")
    ap.add_argument("--background", action="store_true",
                    help="segundo plano: janela escondida, só o ícone perto do relógio (usado ao iniciar com o Windows)")
    ap.add_argument("--browser", action="store_true", help="usa o navegador em vez da janela própria")
    ap.add_argument("--create-shortcuts", action="store_true", help="cria atalhos na Área de Trabalho e no Menu Iniciar")
    args = ap.parse_args(argv)
    url = f"http://127.0.0.1:{args.port}"

    if args.background or sys.stdout is None:   # sem console (pythonw): log em arquivo
        _log_to_file()
    if args.create_shortcuts:
        from . import desktop
        r = desktop.create_shortcuts()
        print("Atalhos do Pitwall criados na Área de Trabalho e no Menu Iniciar." if r["ok"]
              else f"Não deu para criar os atalhos: {r['error']}")
        return
    # já tem um Pitwall rodando? então só mostra a janela (ou abre a interface) dele
    if not args.seed_demo and _already_running(url):
        print(f"O Pitwall já está rodando em {url}")
        if not args.background and not _show_running(url):
            webbrowser.open(url)
        return

    from . import backup
    from .db import default_db_path
    if backup.apply_pending_restore(str(args.db or default_db_path())):
        print("Backup restaurado.")
    db = DB(args.db)
    print(f"Banco de dados: {db.path}")
    if args.seed_demo:
        seed_demo(db)
        return

    if args.demo:
        source, game = DemoSource(laps=10, speed=args.demo_speed, pit_after=6), "demo"
    else:
        from .settings import Settings as _S
        from .sources import AutoSource, IRacingSource
        pref = _S().get("games")
        if pref == "iracing":
            source = IRacingSource()
        elif pref == "acc":
            source = ACCSource()
        else:
            source = AutoSource([ACCSource(), IRacingSource()])
        game = "acc"   # o jogo de cada sessão vem do próprio frame

    from .settings import Settings
    from .video import VideoRecorder
    settings = Settings()
    video = None if args.sem_video else VideoRecorder(db, settings)
    if video:
        def _init_video():
            video.recover()
            video.probe()
            st = video.status
            print("Vídeo:", f"pronto ({st['selected']})" if st.get("selected")
                  else f"desativado — {st.get('error', '?')}")
        threading.Thread(target=_init_video, daemon=True).start()
    recorder = Recorder(db, game=game, video=video)
    backup.start_scheduler(db.path, settings)
    from .live import LiveDelta
    recorder.live_delta = LiveDelta(db, settings)
    from .overlay import OverlayHub
    recorder.hub = OverlayHub(db, recorder, settings)
    from .team import Team
    team = Team(db, settings, args.port)
    recorder.on_lap_saved.append(team.upload_async_if_pb)
    team.start_auto_sync()

    def _suggest_setup(session_id, f):
        """Ao entrar na pista: escolhe o setup da biblioteca mais adequado."""
        from . import setups
        best = setups.suggest(db, f.car, f.track, f.session_type, f.air_temp, f.road_temp,
                              basis=settings.get("setup_temp_basis"),
                              variant_pref=settings.get("setup_variant_pref"), grip=f.grip, limit=1)
        if best:
            db.set_suggested_setup(session_id, best[0]["id"])
            recorder.extra_live["suggested_setup"] = best[0]["name"]
    recorder.on_session_start.append(_suggest_setup)

    def _import_setups():
        from . import setups
        st = setups.import_folder(db)
        if st["exists"]:
            print(f"Setups: {st['found']} arquivos na pasta do ACC, {st['new']} novos no banco")
    threading.Thread(target=_import_setups, daemon=True).start()
    threading.Thread(target=recorder.run, args=(source.frames(),), daemon=True).start()

    import uvicorn
    from .server import create_app

    from .db import data_dir as _dd
    from .lfm import LFM, Alerts
    lfm = LFM(settings, _dd() / "lfm")
    alerts = Alerts(lfm, settings, _dd() / "lfm")
    alerts.start()
    app = create_app(db, recorder, settings, video, team, lfm, alerts)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning"))
    from . import desktop
    use_window = desktop.available() and not args.browser
    try:
        if use_window:
            print(f"Pitwall rodando em {url} (janela própria)")
            th = threading.Thread(target=server.run, daemon=True)
            th.start()
            for _ in range(100):                      # espera o servidor subir
                if _already_running(url):
                    break
                time.sleep(0.1)
            try:
                desktop.run(url, recorder, server, app, start_hidden=args.background)
            except Exception as e:  # noqa: BLE001
                print(f"Janela própria indisponível ({e}); usando o navegador.")
                app.state.ui_show = None
                if not args.background:
                    webbrowser.open(url)
                th.join()
            th.join(timeout=5)
        elif args.background:
            from . import tray
            print(f"Pitwall em segundo plano em {url}")
            if tray.available():
                th = threading.Thread(target=server.run, daemon=True)
                th.start()
                try:
                    tray.run(url, recorder, on_quit=lambda: setattr(server, "should_exit", True))
                except Exception as e:  # noqa: BLE001
                    print(f"Ícone na bandeja indisponível ({e}); seguindo sem ele.")
                th.join()
            else:
                server.run()
        else:
            print(f"Pitwall rodando em {url}  (Ctrl+C para sair)")
            if not args.no_browser:
                threading.Timer(1.2, lambda: webbrowser.open(url)).start()
            server.run()
    finally:
        recorder.stop()
        try:
            recorder.close()     # salva a volta pendente e fecha o vídeo da sessão
        except Exception:  # noqa: BLE001
            pass


def _already_running(url: str) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(url + "/api/live", timeout=1.5) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _show_running(url: str) -> bool:
    """Pede para o Pitwall que já está aberto mostrar a janela dele."""
    import json
    import urllib.request
    try:
        req = urllib.request.Request(url + "/api/ui/show", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as r:
            return bool(json.loads(r.read() or b"{}").get("window"))
    except Exception:  # noqa: BLE001
        return False


def _log_to_file():
    """Sem janela (pythonw) não há onde imprimir: manda tudo para um arquivo de log."""
    import sys
    from .db import data_dir
    log = open(data_dir() / "pitwall.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = log
    import datetime as dt
    print(f"\n--- {dt.datetime.now():%Y-%m-%d %H:%M:%S} iniciando em segundo plano ---")


if __name__ == "__main__":
    main()
