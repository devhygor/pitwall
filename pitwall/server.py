"""API HTTP local + arquivos da interface."""
from __future__ import annotations

from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, engineer, setups
from .db import DB

WEB = Path(__file__).parent / "web"


def create_app(db: DB, recorder=None, settings=None, video=None, team=None, lfm=None, alerts=None, engineer=None, lic=None) -> FastAPI:
    app = FastAPI(title="Pitwall", docs_url="/api/docs")

    @app.get("/api/live")
    def live():
        return recorder.live if recorder else {"state": "offline"}

    @app.get("/api/sessions")
    def sessions():
        pbs = db.personal_bests()
        protected = db.protected_session_ids()
        out = []
        for s in db.sessions():
            pb = pbs.get((s["car"], s["track"]))
            s["protected"] = s["id"] in protected
            s["pb_ms"] = pb["lap_time_ms"] if pb else None
            s["has_video"] = _video_ok(s)
            out.append(s)
        return out

    @app.get("/api/records")
    def records():
        return sorted(db.personal_bests().values(), key=lambda r: (r["track"], r["car"]))

    @app.post("/api/sessions/delete")
    def delete_many(ids: list[int] = Body(..., embed=True)):
        """Exclui várias sessões, mas nunca as que guardam um recorde pessoal."""
        protected = db.protected_session_ids()
        deleted, skipped = [], []
        for sid in ids:
            if sid in protected:
                skipped.append(sid)
                continue
            path = db.delete_session(sid)
            if video:
                video.delete_for(path)
            deleted.append(sid)
        return {"deleted": deleted, "skipped": skipped}

    @app.post("/api/sessions/delete-demo")
    def delete_demo():
        """Apaga todas as sessões de demonstração (e as voltas demo enviadas para a equipe)."""
        ids = db.demo_session_ids()
        for sid in ids:
            path = db.delete_session(sid)
            if video:
                video.delete_for(path)
        cloud = None
        t = _team()
        if t.configured:
            from .team import TeamError
            try:
                t._rest("DELETE", "laps", {"user_id": f"eq.{t.user['id']}", "game": "eq.demo"})
                cloud = "ok"
            except TeamError as e:
                cloud = str(e)
        return {"deleted": len(ids), "cloud": cloud}

    @app.get("/api/sessions/{sid}")
    def session(sid: int, extra_laps: int = 1):
        s = db.session(sid)
        if not s:
            raise HTTPException(404, "sessão não encontrada")
        laps = db.laps(sid)
        summ = analysis.session_summary(laps)
        s["has_video"] = _video_ok(s)
        pb = db.pb_for(s["car"], s["track"])
        s["protected"] = sid in db.protected_session_ids()
        first = laps[0] if laps else {}
        sug = setups.suggest(db, s["car"], s["track"], s["session_type"], first.get("air_temp"), first.get("road_temp"),
                             basis=settings.get("setup_temp_basis") if settings else "air",
                             variant_pref=settings.get("setup_variant_pref") if settings else "",
                             grip=first.get("grip") or "", limit=3)
        s["suggestions"] = [{"id": x["id"], "name": x["name"], "why": x["why"]} for x in sug]
        return {
            "session": s, "laps": laps, "summary": summ, "pb": pb,
            "stint_trends": analysis.stint_trends(laps),
            "fuel_plan": analysis.fuel_plan(summ["avg_ms"], summ["fuel_per_lap"], extra_laps=extra_laps),
        }

    @app.get("/api/sessions/{sid}/timeline")
    def session_timeline(sid: int):
        """Tudo que aconteceu na sessão, volta a volta: travadas, rodadas, voltas invalidadas, boxes e a melhor volta."""
        laps = db.laps(sid)
        clean = [l for l in laps if l.get("valid") and not l.get("out_lap") and not l.get("in_lap") and l.get("lap_time_ms")]
        best = min(clean, key=lambda l: l["lap_time_ms"]) if clean else None
        events = []
        for l in laps:
            base = {"lap_id": l["id"], "lap": l["lap_number"], "lap_ms": l.get("lap_time_ms")}
            if l.get("out_lap"):
                events.append({**base, "type": "pit_out", "d": 0.0, "t": 0})
            has_invalid = False
            for e in l.get("events") or []:
                has_invalid = has_invalid or e.get("type") == "invalid"
                events.append({**base, "type": e.get("type"), "d": e.get("d", 0), "t": e.get("t"), "drop": e.get("drop")})
            if not l.get("valid") and not has_invalid:
                events.append({**base, "type": "invalid", "d": 0.0, "t": 0})
            if best and l["id"] == best["id"]:
                events.append({**base, "type": "best", "d": 0.0, "t": 0})
            if l.get("in_lap"):
                events.append({**base, "type": "pit_in", "d": 0.98, "t": l.get("lap_time_ms")})
        events.sort(key=lambda e: (e["lap"], e["d"]))
        # número da curva de cada acontecimento, pela melhor volta da sessão (a mesma numeração da Análise com ela de referência)
        if best:
            try:
                import numpy as np
                grid = np.linspace(0, 1, 2000)
                R = analysis.resample_lap(db.lap(best["id"]), grid)
                segs = analysis.detect_segments(grid * R["length"], R["speed"]) if R else []
                for e in events:
                    i = max(0, min(1999, round((e["d"] or 0) * 1999)))
                    e["corner"] = next((sg["n"] for sg in segs if sg["start"] <= i <= sg["end"]), None)
            except Exception:  # noqa: BLE001
                pass
        return {"best_id": best["id"] if best else None, "events": events, "laps": [{"id": l["id"], "n": l["lap_number"], "ms": l.get("lap_time_ms"),
                                            "valid": bool(l.get("valid")), "out": bool(l.get("out_lap")), "inn": bool(l.get("in_lap"))} for l in laps]}

    @app.delete("/api/sessions/{sid}")
    def delete_session(sid: int):
        if sid in db.protected_session_ids():
            raise HTTPException(409, "Esta sessão tem o seu recorde com este carro nesta pista e não pode ser excluída.")
        path = db.delete_session(sid)
        if video:
            video.delete_for(path)
        return {"ok": True}

    @app.put("/api/sessions/{sid}/video_offset")
    def set_offset(sid: int, offset: float = Body(..., embed=True)):
        db.set_session_video(sid, video_offset=float(offset))
        return {"ok": True}

    @app.get("/api/video/{sid}")
    def video_file(sid: int):
        s = db.session(sid)
        if not s or not _video_ok(s):
            raise HTTPException(404, "sem vídeo")
        p = Path(s["video_path"])
        media = {".mp4": "video/mp4", ".webm": "video/webm"}.get(p.suffix, "video/x-matroska")
        return FileResponse(p, media_type=media)

    @app.get("/api/fuel")
    def fuel(avg_ms: float, fuel_per_lap: float, minutes: str = "20,30,45,60", extra_laps: int = 1):
        mins = [float(m) for m in minutes.split(",") if m.strip()]
        return analysis.fuel_plan(avg_ms, fuel_per_lap, minutes=mins, extra_laps=extra_laps)

    @app.get("/api/stats/car-track")
    def car_track():
        return db.car_track_stats()

    @app.get("/api/laps/{lap_id}")
    def lap(lap_id: int):
        l = db.lap(lap_id, with_telemetry=False)
        if not l:
            raise HTTPException(404, "volta não encontrada")
        return l

    @app.put("/api/laps/{lap_id}/valid")
    def lap_valid(lap_id: int, valid: bool = Body(..., embed=True)):
        """Marca à mão uma volta como válida/inválida (ex.: corte que o jogo não pegou)."""
        l = db.lap(lap_id, with_telemetry=False)
        if not l:
            raise HTTPException(404, "volta não encontrada")
        before = db.pb_for(l["car"], l["track"])
        db.set_lap_valid(lap_id, valid)
        after = db.pb_for(l["car"], l["track"])
        changed = (before or {}).get("lap_id") != (after or {}).get("lap_id")
        cloud = None
        if changed:
            t = _team()
            if t.configured:
                from .team import TeamError
                try:
                    cloud = t.sync_pb(l["car"], l["track"])
                except TeamError as e:
                    cloud = {"error": str(e)}
            if recorder and recorder.live_delta and getattr(recorder, "_session_key", None) \
                    and recorder._session_key[3] == l["car"] and recorder._session_key[2] == l["track"]:
                try:
                    recorder.live_delta.load(l["car"], l["track"], recorder.session_id)
                except Exception:  # noqa: BLE001
                    pass
        return {"ok": True, "pb_changed": changed, "pb": after, "cloud": cloud}

    @app.get("/api/tracks/{track}/laps")
    def track_laps(track: str):
        return db.laps_for_track(track)

    @app.get("/api/compare")
    def compare(a: int, b: int | None = Query(default=None)):
        la = db.lap(a)
        if not la:
            raise HTTPException(404, "volta A não encontrada")
        lb = db.lap(b) if b else None
        res = analysis.compare(la, lb)

        def strip(l):
            out = {k: v for k, v in l.items() if k not in ("telemetry", "video_path")}
            out["video"] = _lap_video(l)
            return out
        res["lap_a"] = strip(la)
        res["lap_b"] = strip(lb) if lb else None
        return res

    # --- setups e engenheiro --------------------------------------------------
    @app.get("/api/setups")
    def setup_library():
        return setups.library(db)

    @app.get("/api/setups/suggest")
    def setup_suggest(car: str, track: str, session_type: str = "Race", air: float | None = None,
                      road: float | None = None, grip: str = ""):
        return setups.suggest(db, car, track, session_type, air, road,
                              basis=settings.get("setup_temp_basis") if settings else "air",
                              variant_pref=settings.get("setup_variant_pref") if settings else "", grip=grip, limit=5)

    @app.post("/api/setups/import")
    def setup_import():
        return setups.import_folder(db)

    @app.get("/api/setups/performance")
    def setup_performance(a: int, b: int):
        try:
            return setups.compare_performance(db, a, b)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.get("/api/setups/diff")
    def setup_diff(a: int, b: int):
        try:
            return setups.diff(db, a, b)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    def _need_setup_gen():
        if lic and not lic.has("setup_gen"):
            raise HTTPException(403, "O gerador de setup é do plano Pro ou Equipe. Veja o menu Plano.")

    @app.get("/api/setups/{setup_id}/advice")
    def setup_advice(setup_id: int, target: float = 26.5):
        _need_setup_gen()
        try:
            return setups.advice(db, setup_id, target)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/setups/{setup_id}/apply")
    def setup_apply(setup_id: int, changes: list[dict] = Body(..., embed=True), mode: str = Body("new", embed=True), name: str | None = Body(None, embed=True)):
        """mode = 'new' (cria uma versão nova) ou 'update' (atualiza o próprio setup, com backup)."""
        _need_setup_gen()
        try:
            if mode == "update":
                return setups.update_in_place(db, setup_id, changes)
            return setups.generate(db, setup_id, changes, name)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.get("/api/setups/{setup_id}")
    def setup_info(setup_id: int):
        try:
            return setups.info(db, setup_id)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.delete("/api/setups/{setup_id}")
    def setup_delete(setup_id: int, remove_file: bool = True):
        try:
            return setups.delete_setup(db, setup_id, remove_file)
        except (FileNotFoundError, OSError) as e:
            raise HTTPException(400, str(e))

    @app.post("/api/setups/{setup_id}/install")
    def setup_install(setup_id: int):
        try:
            return setups.install(db, setup_id)
        except (FileNotFoundError, OSError) as e:
            raise HTTPException(400, str(e))

    @app.post("/api/setups/generate")
    def setup_generate(body: dict = Body(...)):
        _need_setup_gen()
        try:
            return setups.generate(db, int(body["base_id"]), body.get("changes") or [], body.get("name"))
        except (KeyError, ValueError, FileNotFoundError, OSError) as e:
            raise HTTPException(400, str(e))

    @app.put("/api/sessions/{sid}/setup")
    def set_setup(sid: int, setup_id: int | None = Body(None, embed=True)):
        db.set_session_setup(sid, setup_id)
        return {"ok": True}

    @app.get("/api/sessions/{sid}/engineer")
    def session_engineer(sid: int, setup_id: int | None = None, target: float = 26.5):
        if not db.session(sid):
            raise HTTPException(404, "sessão não encontrada")
        base = db.setup(setup_id) if setup_id else None
        return engineer.analyze(db.session_laps_full(sid), base["content"] if base else None, target)

    # --- janela do app e atalhos ---------------------------------------------
    app.state.ui_show = None
    app.state.ui_lfm = None
    app.state.lfm = lfm
    app.state.lfm_alerts = alerts
    app.state.ui_overlay = None
    app.state.settings = settings

    app.state.ui_overlay_sync = None
    app.state.ui_overlay_size = None
    app.state.ui_overlay_scale = None

    @app.post("/api/ui/overlay-scale")
    def ui_overlay_scale(name: str = Body(..., embed=True), scale: int = Body(..., embed=True), anchor: str = Body("lt", embed=True)):
        """Redimensionar arrastando a borda: muda a escala e mantém fixo o canto oposto ao que foi puxado."""
        if app.state.ui_overlay_scale:
            app.state.ui_overlay_scale(name, scale, anchor)
        return {"ok": True}

    @app.post("/api/ui/overlay")
    def ui_overlay(show: bool | None = Body(None, embed=True)):
        """Liga/desliga o modo de edição dos overlays (mostra todos, com cliques, para posicionar)."""
        if app.state.ui_overlay:
            return {"window": True, "visible": app.state.ui_overlay(show)}
        return {"window": False}

    @app.post("/api/ui/overlay-size")
    def ui_overlay_size(name: str = Body(..., embed=True), w: int = Body(..., embed=True), h: int = Body(..., embed=True)):
        """O próprio overlay informa o tamanho que ocupa; a janela se ajusta a ele."""
        if app.state.ui_overlay_size:
            app.state.ui_overlay_size(name, w, h)
        return {"ok": True}

    @app.get("/api/overlay/data")
    def overlay_data(since: int = 0, parts: str = "all"):
        hub = getattr(recorder, "hub", None) if recorder else None
        return hub.snapshot(since, parts) if hub else {"status": "idle", "seq": 0, "samples": []}

    @app.get("/api/overlay/map")
    def overlay_map():
        hub = getattr(recorder, "hub", None) if recorder else None
        return hub.map() if hub else {"pts": [], "filled": 0, "sectors": [1 / 3, 2 / 3]}

    @app.get("/api/overlay/corner-tracks")
    def overlay_corner_tracks():
        """Pistas com tempo gravado (as únicas em que dá para numerar as curvas)."""
        return sorted({k[1] for k in db.personal_bests()})

    @app.get("/api/overlay/corners")
    def overlay_corners(track: str):
        hub = getattr(recorder, "hub", None) if recorder else None
        if not hub:
            return {"corners": []}
        names = ((settings.get("corner_names") or {}).get(track) or {}) if settings else {}
        return {"corners": [{**c, "name": names.get(str(c["n"]), "")} for c in hub.corners_for(track)]}

    @app.get("/overlay/{name}")
    def overlay_page(name: str):
        return FileResponse(WEB / "overlay.html")

    @app.post("/api/ui/show")
    def ui_show():
        if app.state.ui_show:
            app.state.ui_show()
            return {"window": True}
        return {"window": False}

    @app.post("/api/shortcuts")
    def shortcuts():
        from . import desktop
        return desktop.create_shortcuts()

    # --- progresso ----------------------------------------------------------
    def _combo_laps(car, track, last=30):
        brief = db.own_laps(car, track)[-last:]
        out = []
        for b in brief:
            l = db.lap(b["id"])
            if l:
                out.append(l)
        return out

    @app.get("/api/progress")
    def progress():
        combos = db.car_track_stats()
        for c in combos:
            c["rating"] = analysis.ratings(db.own_laps(c["car"], c["track"], clean_only=False))["current"]
        return {"overall": analysis.evolution(db.all_own_laps_brief()), "combos_rated": combos,
                "combos": db.car_track_stats(),
                "records": sorted(db.personal_bests().values(), key=lambda r: (r["track"], r["car"]))}

    @app.get("/api/progress/combo")
    def progress_combo(car: str, track: str):
        pb = db.pb_for(car, track)
        clean = db.own_laps(car, track)
        res = {"car": car, "track": track, "pb": pb, "pb_history": analysis.pb_history(clean),
               "sessions": analysis.session_trend(clean),
               "rating": analysis.ratings(db.own_laps(car, track, clean_only=False)),
               "ideal": next((e for e in db.externals("ideal") if e["car"] == car and e["track"] == track), None)}
        if pb:
            cons = analysis.consistency(_combo_laps(car, track), db.lap(pb["lap_id"]))
            res["consistency"] = cons
            used = {s["best_lap_id"] for s in cons.get("segments", [])}
            res["ideal_from"] = {"laps": len(used), "sessions": len({l["session_id"] for l in cons.get("laps", []) if l["lap_id"] in used})}
        return res

    @app.post("/api/progress/ideal")
    def progress_ideal(car: str = Body(...), track: str = Body(...)):
        import datetime as dt
        pb = db.pb_for(car, track)
        if not pb:
            raise HTTPException(400, "Ainda não há voltas limpas com esse carro nessa pista.")
        laps = _combo_laps(car, track)
        cons = analysis.consistency(laps, db.lap(pb["lap_id"]))
        ideal = analysis.build_ideal({l["id"]: l for l in laps}, cons)
        if not ideal:
            raise HTTPException(400, "Não deu para montar a volta ideal com essas voltas.")
        lap_id = db.replace_external(
            "ideal", car, track, "Volta ideal", dt.datetime.now().isoformat(timespec="seconds"),
            {"lap_number": 0, "stint": 1, "lap_time_ms": ideal["lap_time_ms"], "valid": 1, "out_lap": 0,
             "in_lap": 0, "recorded_at": dt.datetime.now().isoformat(timespec="seconds"),
             "telemetry": ideal["telemetry"], "events": []})
        return {"lap_id": lap_id, "lap_time_ms": ideal["lap_time_ms"], "composition": ideal["composition"],
                "gain_ms": pb["lap_time_ms"] - ideal["lap_time_ms"]}

    # --- equipe (nuvem, login com Google) ---------------------------------------
    def _team():
        from .team import Team
        return team or Team(db, settings)

    def _team_call(fn):
        from .team import TeamError
        try:
            return fn()
        except TeamError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/team/status")
    def team_status():
        _publish_lfm()          # com a conta do Pitwall conectada, mantém o LFM do perfil em dia sem precisar abrir a tela LFM
        return _team().status()

    @app.get("/api/profile")
    def my_profile():
        if not _team().configured:
            raise HTTPException(400, "Entre com a sua conta do Pitwall na tela Equipe.")
        try:
            return _team().my_profile()
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.post("/api/bug-report")
    def bug_report(body: dict = Body(...)):
        """Manda um relato de bug (com o log do programa, se a pessoa deixar) para o e-mail do desenvolvedor."""
        import json as _json, platform, urllib.request, urllib.error
        from . import team as _tm
        from .db import data_dir
        try:
            from ._version import __version__ as ver
        except Exception:
            ver = "dev"
        logs = ""
        if body.get("include_logs", True):
            try:
                with open(data_dir() / "pitwall.log", "rb") as f:
                    f.seek(0, 2)
                    f.seek(max(0, f.tell() - 200_000))
                    logs = f.read().decode("utf-8", "replace")
            except OSError:
                logs = ""
        t = _team()
        headers = {"Content-Type": "application/json", "apikey": t.key}
        if getattr(t, "configured", False):
            try:
                headers["Authorization"] = "Bearer " + t._token()
            except Exception:
                pass
        s = settings.all() if hasattr(settings, "all") else {}
        payload = {"title": body.get("title"), "description": body.get("description"), "email": body.get("email"),
                   "source": "app", "app_version": ver, "logs": logs, "images": body.get("images") or [],
                   "context": {"sistema": platform.platform(), "python": platform.python_version(),
                               "jogo": str(s.get("game") or ""), "conta_pitwall": bool(getattr(t, "configured", False))}}
        req = urllib.request.Request(t.url + "/functions/v1/report-bug", data=_json.dumps(payload).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return _json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                msg = _json.loads(e.read().decode()).get("message")
            except Exception:
                msg = None
            raise HTTPException(400, msg or f"Não foi possível enviar ({e.code}).")
        except Exception:
            raise HTTPException(400, "Sem conexão. Confira a internet e tente de novo.")

    @app.post("/api/team/login")
    def team_login():
        url = _team().login_url()
        opened = False
        try:
            import webbrowser
            opened = webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
        return {"url": url, "opened": bool(opened)}

    @app.get("/auth/callback", response_class=HTMLResponse)
    def auth_callback(code: str = "", error: str = "", error_description: str = ""):
        from .team import TeamError
        ok, msg = False, error_description or error or "O login não voltou com um código."
        if code:
            try:
                _team().finish_login(code)
                ok, msg = True, "Login feito! Pode fechar esta aba e voltar para o Pitwall."
            except TeamError as e:
                msg = str(e)
        if ok and app.state.ui_show:
            try:
                app.state.ui_show()
            except Exception:  # noqa: BLE001
                pass
        import html as _html
        msg = _html.escape(msg)
        color = "#3fd68b" if ok else "#ff5d5d"
        return f"""<!doctype html><meta charset="utf-8"><title>Pitwall</title>
<body style="background:#0b0d10;color:#e8ebf0;font:16px Segoe UI,system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:42px;color:{color}">{"✓" if ok else "✕"}</div>
<p>{msg}</p></div></body>"""

    @app.post("/api/team/logout")
    def team_logout():
        _team().logout()
        return {"ok": True}

    @app.post("/api/team/create")
    def team_create(name: str = Body(..., embed=True)):
        return _team_call(lambda: _team().create_team(name))

    @app.post("/api/team/join")
    def team_join(code: str = Body(..., embed=True)):
        return _team_call(lambda: _team().join_team(code))

    @app.post("/api/team/leave")
    def team_leave(team_id: str = Body(..., embed=True)):
        _team_call(lambda: _team().leave_team(team_id))
        return {"ok": True}

    @app.post("/api/team/invite")
    def team_invite(team_id: str = Body(..., embed=True)):
        return {"code": _team_call(lambda: _team().new_invite(team_id))}

    @app.get("/api/team/board/{team_id}")
    def team_board(team_id: str):
        return _team_call(lambda: _team().board(team_id))

    @app.post("/api/team/upload")
    def team_upload():
        return _team_call(lambda: _team().upload_records())

    @app.get("/api/team/community")
    def team_community():
        return _team_call(lambda: _team().community())

    @app.post("/api/team/setup")
    def team_setup(id: str = Body(..., embed=True)):
        return _team_call(lambda: _team().import_setup(id))

    @app.get("/api/team/setups")
    def team_setups(team_id: str):
        return _team_call(lambda: _team().setup_library(team_id))

    @app.post("/api/team/setups/share")
    def team_setups_share(team_id: str = Body(..., embed=True), setup_id: int = Body(..., embed=True), note: str = Body("", embed=True)):
        return _team_call(lambda: _team().share_setup(team_id, setup_id, note))

    @app.post("/api/team/setups/import")
    def team_setups_import(team_id: str = Body(..., embed=True), kind: str = Body(..., embed=True), id: str = Body(..., embed=True)):
        return _team_call(lambda: _team().import_library_item(team_id, kind, id))

    @app.post("/api/team/setups/delete")
    def team_setups_delete(team_id: str = Body(..., embed=True), id: str = Body(..., embed=True)):
        return _team_call(lambda: _team().delete_library_item(team_id, id))

    @app.post("/api/team/logo")
    async def team_logo(request: Request):
        """Corpo = a imagem; ?team_id=... (ou JSON {team_id, url} para usar um link)."""
        team_id = request.query_params.get("team_id", "")
        ctype = request.headers.get("content-type", "").split(";")[0]
        if ctype == "application/json":
            body = await request.json()
            return {"logo_url": _team_call(lambda: _team().set_logo_url(body.get("team_id") or team_id, body.get("url", "")))}
        data = await request.body()
        return {"logo_url": _team_call(lambda: _team().set_logo(team_id, data, ctype))}

    @app.get("/api/team/discover")
    def team_discover():
        return _team_call(lambda: _team().discover())

    @app.post("/api/team/join-listed")
    def team_join_listed(team_id: str = Body(..., embed=True)):
        return _team_call(lambda: _team().join_listed(team_id))

    @app.post("/api/team/cancel-request")
    def team_cancel_request(team_id: str = Body(..., embed=True)):
        _team_call(lambda: _team().cancel_request(team_id))
        return {"ok": True}

    @app.get("/api/team/manage/{team_id}")
    def team_manage_data(team_id: str):
        """Pedidos de entrada e convites enviados (só dono/líder enxerga)."""
        t = _team()
        return {"requests": _team_call(lambda: t.requests(team_id)),
                "invites": _team_call(lambda: t.sent_invites(team_id))}

    @app.post("/api/team/answer-request")
    def team_answer_request(team_id: str = Body(...), user_id: str = Body(...), accept: bool = Body(...)):
        _team_call(lambda: _team().answer_request(team_id, user_id, accept))
        return {"ok": True}

    @app.post("/api/team/invite-email")
    def team_invite_email(team_id: str = Body(...), email: str = Body(...)):
        return _team_call(lambda: _team().invite_email(team_id, email))

    @app.post("/api/team/cancel-invite")
    def team_cancel_invite(id: str = Body(..., embed=True)):
        _team_call(lambda: _team().cancel_invite(id))
        return {"ok": True}

    @app.post("/api/team/answer-invite")
    def team_answer_invite(id: str = Body(...), accept: bool = Body(...)):
        return _team_call(lambda: _team().answer_invite(id, accept))

    @app.post("/api/team/role")
    def team_role(team_id: str = Body(...), user_id: str = Body(...), role: str = Body(...)):
        _team_call(lambda: _team().set_role(team_id, user_id, role))
        return {"ok": True}

    @app.post("/api/team/remove-member")
    def team_remove_member(team_id: str = Body(...), user_id: str = Body(...)):
        _team_call(lambda: _team().remove_member(team_id, user_id))
        return {"ok": True}

    @app.post("/api/team/transfer")
    def team_transfer(team_id: str = Body(...), user_id: str = Body(...)):
        _team_call(lambda: _team().transfer_ownership(team_id, user_id))
        return {"ok": True}

    @app.post("/api/team/options")
    def team_options(team_id: str = Body(...), values: dict = Body(...)):
        _team_call(lambda: _team().set_options(team_id, values))
        return {"ok": True}

    @app.post("/api/team/sync")
    def team_sync():
        _team().sync_soon()
        return {"ok": True}

    @app.post("/api/team/import")
    def team_import(id: str = Body(..., embed=True)):
        lap_id = _team_call(lambda: _team().import_lap(id))
        return {"lap_id": lap_id}

    # --- backup -------------------------------------------------------------
    # --- Low Fuel Motorsport (só leitura) ---------------------------------------
    def _lfm():
        if lfm is None:
            raise HTTPException(400, "integração com o LFM indisponível")
        return lfm

    _lfm_push = {"t": 0.0, "busy": False}

    def _publish_lfm(force=False):
        """Publica o resumo do LFM no perfil do site (no máx. a cada 30 min, em segundo plano; só com a conta do Pitwall conectada)."""
        import threading, time
        t = _team()
        if not getattr(t, "configured", False) or _lfm_push["busy"]:
            return
        if not force and time.time() - _lfm_push["t"] < 1800:
            return
        _lfm_push["busy"] = True

        def work():
            try:
                snap = lfm.snapshot() if lfm else None
                t._rpc("set_my_lfm", {"p": snap})
                _lfm_push["t"] = time.time()
            except Exception as e:
                print("lfm: não deu para publicar no perfil:", repr(e))
                _lfm_push["t"] = time.time() - 1500      # tenta de novo em ~5 min
            finally:
                _lfm_push["busy"] = False
        threading.Thread(target=work, daemon=True).start()

    @app.get("/api/lfm")
    def lfm_overview(force: bool = False):
        _publish_lfm(force)
        o = _lfm().overview(force)
        o["account"] = _lfm().account_status()
        o["in_app"] = app.state.ui_lfm is not None
        return o

    @app.put("/api/lfm/user")
    def lfm_user(body: dict = Body(...)):
        from .lfm import LFMError, parse_user_id
        raw = str(body.get("user") or "").strip()
        uid = parse_user_id(raw)
        if raw and not uid:
            raise HTTPException(400, "cole o link do seu perfil do LFM (…/profile/NÚMERO) ou só o número")
        if uid:
            try:
                _lfm().profile(uid, force=True)
            except LFMError as e:
                if "conexão" not in str(e):   # sem internet: salva assim mesmo
                    raise HTTPException(400, str(e))
        settings.update({"lfm_user_id": uid})
        _publish_lfm(True)
        return _lfm().overview()

    @app.post("/api/open")
    def open_external(body: dict = Body(...)):
        """Abre no navegador do sistema (só endereços conhecidos)."""
        url = str(body.get("url") or "")
        allowed = ("https://lowfuelmotorsport.com/", "https://pitwall.hygor.com.br",
                   "https://devhygor.github.io/pitwall")
        if not url.startswith(allowed):
            raise HTTPException(400, "endereço não permitido")
        import webbrowser
        return {"opened": bool(webbrowser.open(url)), "url": url}

    @app.get("/api/lfm/account")
    def lfm_account():
        return _lfm().account_status()

    @app.delete("/api/lfm/account")
    def lfm_logout():
        _lfm().clear_account()
        return _lfm().account_status()

    @app.post("/api/lfm/window")
    def lfm_window(body: dict = Body(...)):
        """Abre uma página do LFM numa janela do Pitwall (ou no navegador, se não houver janela)."""
        from .lfm import SITE
        url = str(body.get("url") or SITE + "/")
        if not url.startswith(SITE + "/"):
            raise HTTPException(400, "endereço não permitido")
        if app.state.ui_lfm:
            app.state.ui_lfm(url)
            return {"window": True}
        import webbrowser
        return {"window": False, "opened": bool(webbrowser.open(url)), "url": url}

    @app.get("/api/lfm/sessions")
    def lfm_sessions(force: bool = False):
        from .lfm import LFMError
        L = _lfm()
        w = L.watches()
        try:
            rows = L.sessions(force)
            err = None
        except LFMError as e:
            rows, err = [], str(e)
        for r in rows:
            r["watch"] = str(r["race_id"]) in w
        return {"account": L.account_status(), "sessions": rows, "error": err,
                "watches": list(w.values())}

    @app.put("/api/lfm/watch")
    def lfm_watch(body: dict = Body(...)):
        key = str(body.get("key") or "").strip()
        if not key:
            raise HTTPException(400, "faltou a corrida")
        info = body.get("info") or {}
        keep = ("race_id", "series", "slug", "track", "date", "server_name", "server_password", "url")
        return {"watches": list(_lfm().set_watch(key, bool(body.get("on")), {k: info.get(k) for k in keep}).values())}

    @app.get("/api/lfm/alerts")
    def lfm_alerts():
        if alerts is None:
            return {"events": [], "targets": []}
        from .lfm import LFMError
        try:
            targets = _lfm().targets()
        except LFMError:
            targets = []
        return {"events": alerts.events, "targets": targets[:10]}

    @app.post("/api/lfm/alerts/test")
    def lfm_alert_test(body: dict = Body({})):
        kind = body.get("kind")
        played = alerts.play(kind) if alerts else False
        return {"played": played}

    @app.get("/api/lfm/sound.wav")
    def lfm_sound(kind: str = "ambos", vol: int = 80):
        from fastapi.responses import Response
        from . import sound
        return Response(sound.wav_bytes(kind, vol), media_type="audio/wav")

    @app.get("/api/lfm/profile/{uid}")
    def lfm_profile(uid: str):
        from .lfm import LFMError
        try:
            return _lfm().profile(uid)
        except LFMError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/backups")
    def backups():
        from . import backup
        return {"dir": str(backup.backup_dir(settings)), "default_dir": str(backup.default_dir()),
                "items": backup.list_backups(settings)}

    @app.post("/api/backups/run")
    def backup_now():
        from . import backup
        try:
            return backup.run_backup(db.path, settings)
        except OSError as e:
            raise HTTPException(400, f"Não deu para fazer o backup: {e}")

    @app.post("/api/backups/restore")
    def backup_restore(name: str = Body(..., embed=True)):
        from . import backup
        try:
            return backup.schedule_restore(name, settings)
        except (FileNotFoundError, OSError, KeyError) as e:
            raise HTTPException(400, str(e))

    # --- iniciar com o Windows ----------------------------------------------
    @app.get("/api/autostart")
    def get_autostart():
        from . import autostart
        return autostart.status()

    @app.put("/api/autostart")
    def put_autostart(enabled: bool = Body(..., embed=True)):
        from . import autostart
        return autostart.set_enabled(enabled)

    # --- configurações -----------------------------------------------------
    @app.get("/api/settings")
    def get_settings():
        return {"settings": settings.all() if settings else {},
                "video": video.status if video else {"error": "indisponível"}}

    @app.put("/api/settings")
    def put_settings(values: dict = Body(...)):
        if not settings:
            raise HTTPException(400, "indisponível")
        before = settings.all()
        new = settings.update(values)
        keys = ("video_encoder", "video_monitor", "video_fps", "video_bitrate_mbps")
        if video and any(before.get(k) != new.get(k) for k in keys):
            video.probe_async()
        if app.state.ui_overlay_sync and any(before.get(k) != new.get(k) for k in ("overlays", "overlay_edit")):
            app.state.ui_overlay_sync()
        if engineer and any(before.get(k) != new.get(k) for k in new if k.startswith("eng_")):
            engineer.apply()
        return {"settings": new, "video": video.status if video else {}}

    # --- plano e licença ----------------------------------------------------------------
    def _lic():
        if not lic:
            raise HTTPException(400, "Licença indisponível.")
        return lic

    @app.post("/api/open-url")
    def open_url(url: str = Body(..., embed=True)):
        """Abre um endereço do próprio Pitwall no navegador (só o nosso domínio, por segurança)."""
        import webbrowser
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        if urlparse(url).scheme != "https" or not (host == "pitwall.hygor.com.br" or host.endswith(".hygor.com.br")):
            raise HTTPException(400, "Endereço não permitido.")
        webbrowser.open(url)
        return {"ok": True}

    @app.get("/api/license")
    def license_status():
        return _lic().status()

    @app.post("/api/license/refresh")
    def license_refresh():
        return _lic().refresh()

    @app.post("/api/license/key")
    def license_key(key: str = Body(..., embed=True)):
        return _lic().activate_key(key)

    @app.post("/api/license/redeem")
    def license_redeem(code: str = Body(..., embed=True)):
        """Resgata um código de presente (sorteio, parceiro): precisa estar logado com o Google."""
        from .team import TeamError
        t = _team()
        if not t.configured:
            raise HTTPException(400, "Entre com o Google (botão no menu Plano) para resgatar o código.")
        try:
            r = t._rpc("redeem_code", {"p_code": code})
        except TeamError as e:
            raise HTTPException(400, str(e))
        if not r.get("ok"):
            msgs = {"invalido": "Código inválido.", "expirado": "Esse código expirou.", "esgotado": "Esse código já foi usado.",
                    "ja_usado": "Você já resgatou esse código.", "use_no_checkout": "Esse código é de desconto: use na hora de assinar, no site.",
                    "login": "Entre com o Google primeiro.", "ja_tem_chave": "Você já usa uma chave de equipe.", "ja_pago": "Você já tem um plano pago.",
                    "proprio": "Essa chave é do seu próprio plano."}
            raise HTTPException(400, msgs.get(r.get("error"), "Não foi possível resgatar o código."))
        _lic().refresh()
        return {**r, "status": _lic().status()}

    @app.post("/api/license/trial")
    def license_trial(plan: str = Body("pro", embed=True)):
        return _lic().start_trial(plan)

    @app.post("/api/license/clear")
    def license_clear():
        _lic().clear()
        return _lic().status()

    # --- engenheiro de voz --------------------------------------------------------------
    def _eng():
        if not engineer:
            raise HTTPException(400, "O engenheiro de voz não está disponível.")
        return engineer

    @app.get("/api/engineer/status")
    def eng_status():
        return _eng().status()

    @app.get("/api/engineer/devices")
    def eng_devices():
        return _eng().devices()

    @app.get("/api/engineer/catalog")
    def eng_catalog():
        from .voice import CATEGORIES
        from .voice.answers import EXAMPLES
        return {"categories": [{"id": k, "name": n} for k, n in CATEGORIES], "examples": EXAMPLES}

    @app.post("/api/engineer/apply")
    def eng_apply():
        _eng().apply()
        return {"ok": True}

    @app.post("/api/engineer/test")
    def eng_test(text: str = Body("", embed=True)):
        return {"text": _eng().test_voice(text)}

    @app.post("/api/engineer/ask")
    def eng_ask(text: str = Body(..., embed=True), speak: bool = Body(True, embed=True)):
        return _eng().ask(text, speak=speak)

    @app.post("/api/engineer/mute")
    def eng_mute(muted: bool = Body(..., embed=True)):
        _eng().set_muted(muted)
        return {"muted": _eng().muted}

    @app.post("/api/engineer/bind/start")
    def eng_bind_start():
        _eng().keys.capture()
        return {"ok": True}

    @app.post("/api/engineer/bind/cancel")
    def eng_bind_cancel():
        _eng().keys.cancel_capture()
        return {"ok": True}

    @app.post("/api/engineer/mic/probe")
    def eng_mic_probe():
        _eng().listener.probe()
        return {"ok": True}

    @app.post("/api/engineer/piper/download")
    def eng_piper_download(name: str = Body(..., embed=True)):
        import threading
        e = _eng()

        def run():
            try:
                e.tts.piper.download(name)
            except Exception as ex:  # noqa: BLE001
                e.errors.append(str(ex))
        if e.tts.piper.progress.get("state") != "baixando":
            threading.Thread(target=run, daemon=True).start()
        return {"ok": True}

    @app.post("/api/engineer/listen")
    def eng_listen_test():
        _eng().start_listen_test()
        return {"ok": True}

    @app.post("/api/engineer/listen/stop")
    def eng_listen_stop():
        _eng().stop_listen_test()
        return {"ok": True}

    @app.post("/api/engineer/mood/demo")
    def eng_mood_demo(personality: str = Body(..., embed=True)):
        return {"lines": _eng().mood_demo(personality)}

    @app.post("/api/engineer/stop")
    def eng_stop():
        _eng().stop_audio()
        return {"ok": True}

    @app.post("/api/engineer/piper/sample")
    def eng_piper_sample(name: str = Body(..., embed=True)):
        err = _eng().play_sample(name)
        if err:
            raise HTTPException(400, err)
        return {"ok": True}

    @app.post("/api/engineer/storage/clear")
    def eng_storage_clear(what: str = Body(..., embed=True)):
        if what not in ("cache", "piper", "whisper", "all"):
            raise HTTPException(400, "opção inválida")
        _eng().clear_storage(what)
        return {"ok": True}

    @app.post("/api/engineer/storage/open")
    def eng_storage_open():
        import os
        p = _eng().root
        p.mkdir(parents=True, exist_ok=True)
        try:
            os.startfile(str(p))          # abre a pasta no Explorer (só no Windows)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.post("/api/engineer/piper/remove")
    def eng_piper_remove(name: str = Body(..., embed=True)):
        e = _eng()
        e.tts.piper.remove(name)
        return {"ok": True}

    @app.post("/api/engineer/stt/remove")
    def eng_stt_remove(name: str = Body("", embed=True)):
        e = _eng()
        e.stt.remove(name or None)
        e.apply()
        return {"ok": True}

    @app.post("/api/engineer/stt/download")
    def eng_stt_download(name: str = Body("", embed=True)):
        import threading
        e = _eng()

        def run():
            try:
                e.stt.download(name or None)
                e.apply()
            except Exception as ex:  # noqa: BLE001
                e.errors.append(str(ex))
        if e.stt.progress.get("state") != "baixando":
            threading.Thread(target=run, daemon=True).start()
        return {"ok": True}

    @app.get("/api/update")
    def get_update(force: bool = False):
        from . import updater
        return {**updater.check(force), "download": updater.progress()}

    @app.post("/api/update/install")
    def install_update():
        from . import updater
        if not getattr(__import__("sys"), "frozen", False):
            raise HTTPException(400, "A atualização automática só funciona no app instalado.")
        return updater.download_and_run()

    @app.post("/api/settings/video-test")
    def video_test():
        if video:
            video.probe_async()
        return {"ok": True}

    import mimetypes
    mimetypes.add_type("text/javascript", ".js")        # o registro do Windows às vezes diz text/plain, e o navegador recusa módulos assim
    mimetypes.add_type("text/javascript", ".mjs")
    app.mount("/static", StaticFiles(directory=WEB), name="static")

    @app.middleware("http")
    async def no_stale_ui(request: Request, call_next):
        """A janela do app guarda cache em disco: sem isso a interface nova não aparece depois de atualizar."""
        resp = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith(("/static/", "/overlay/")):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/")
    def index():
        return FileResponse(WEB / "index.html")

    return app


def _video_ok(s: dict) -> bool:
    p = s.get("video_path")
    return bool(p and s.get("video_start") and Path(p).exists())


def _lap_video(l: dict) -> dict | None:
    """Onde a volta começa dentro do vídeo da sessão (em segundos)."""
    if not _video_ok(l) or not l.get("start_wall"):
        return None
    start = l["start_wall"] - l["video_start"] + (l.get("video_offset") or 0)
    if start < -1:
        return None
    return {"url": f"/api/video/{l['session_id']}", "start": round(start, 3),
            "offset": l.get("video_offset") or 0}
