"""API HTTP local + arquivos da interface."""
from __future__ import annotations

from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, engineer, setups
from .db import DB

WEB = Path(__file__).parent / "web"


def create_app(db: DB, recorder=None, settings=None, video=None, team=None) -> FastAPI:
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

    @app.get("/api/setups/diff")
    def setup_diff(a: int, b: int):
        try:
            return setups.diff(db, a, b)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.get("/api/setups/{setup_id}")
    def setup_info(setup_id: int):
        try:
            return setups.info(db, setup_id)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/setups/{setup_id}/install")
    def setup_install(setup_id: int):
        try:
            return setups.install(db, setup_id)
        except (FileNotFoundError, OSError) as e:
            raise HTTPException(400, str(e))

    @app.post("/api/setups/generate")
    def setup_generate(body: dict = Body(...)):
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
    app.state.ui_overlay = None
    app.state.settings = settings

    @app.post("/api/ui/overlay")
    def ui_overlay(show: bool | None = Body(None, embed=True)):
        if app.state.ui_overlay:
            return {"window": True, "visible": app.state.ui_overlay(show)}
        return {"window": False}

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
        return _team().status()

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

    @app.post("/api/team/import")
    def team_import(id: str = Body(..., embed=True)):
        lap_id = _team_call(lambda: _team().import_lap(id))
        return {"lap_id": lap_id}

    # --- backup -------------------------------------------------------------
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
        return {"settings": new, "video": video.status if video else {}}

    @app.post("/api/settings/video-test")
    def video_test():
        if video:
            video.probe_async()
        return {"ok": True}

    app.mount("/static", StaticFiles(directory=WEB), name="static")

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
