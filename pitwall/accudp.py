"""Cliente do Broadcasting API do ACC (UDP): lista de carros, nomes, posições e tempos de todos.

A shared memory do ACC só traz o carro do jogador. Os outros pilotos (nome, volta, melhor volta,
posição) só vêm por este protocolo, que o jogo liga por padrão em 127.0.0.1:9000 (senha "asd").
Os valores reais ficam em Documentos\\Assetto Corsa Competizione\\Config\\broadcasting.json.
O formato das mensagens é o do SDK oficial (protocolo v4).
"""
from __future__ import annotations

import json
import os
import socket
import sys
import struct
import threading
import time
from pathlib import Path

NONE_MS = 2147483647


def _config_files() -> list[Path]:
    """Onde pode estar o broadcasting.json: a pasta Documentos pode estar no OneDrive ou em outro drive."""
    roots: list[Path] = []
    if sys.platform == "win32":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)    # CSIDL_PERSONAL
            if buf.value:
                roots.append(Path(buf.value))
        except Exception:  # noqa: BLE001
            pass
        for env in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
            if os.environ.get(env):
                roots += [Path(os.environ[env]) / "Documents", Path(os.environ[env]) / "Documentos"]
    home = Path.home()
    roots += [home / "Documents", home / "Documentos", home / "OneDrive" / "Documents", home / "OneDrive" / "Documentos"]
    return [r / "Assetto Corsa Competizione" / "Config" / "broadcasting.json" for r in roots]


def _config() -> tuple[int, str]:
    port, pw = 9000, "asd"
    for p in _config_files():
        try:
            raw = p.read_bytes()
            txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") or b"\x00" in raw[:4] else raw.decode("utf-8-sig")
            cfg = json.loads(txt)
            port = int(cfg.get("updListenerPort", cfg.get("udpListenerPort", port)))
            pw = str(cfg.get("connectionPassword", pw))
            break
        except Exception:  # noqa: BLE001
            continue
    return port, pw


class _R:
    """Leitor sequencial de bytes."""

    def __init__(self, b: bytes):
        self.b, self.i = b, 0

    def take(self, n: int) -> bytes:
        if self.i + n > len(self.b):
            raise struct.error("fim dos dados")
        v = self.b[self.i:self.i + n]
        self.i += n
        return v

    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack("<H", self.take(2))[0]
    def i32(self): return struct.unpack("<i", self.take(4))[0]
    def f32(self): return struct.unpack("<f", self.take(4))[0]
    def s(self): return self.take(self.u16()).decode("utf-8", "replace")

    def lap(self) -> dict:
        ms = self.i32()
        car, drv, n = self.u16(), self.u16(), self.u8()
        self.take(n * 4)
        invalid, valid_best, out, inn = self.u8(), self.u8(), self.u8(), self.u8()
        return {"ms": None if ms >= NONE_MS or ms <= 0 else ms, "invalid": bool(invalid)}


def _write_s(buf: bytearray, s: str):
    b = s.encode()
    buf += struct.pack("<H", len(b)) + b


class ACCBroadcast:
    """Fica conectado ao ACC enquanto o jogo está aberto e guarda o estado de todos os carros."""

    def __init__(self, interval_ms: int = 100):
        self.interval = interval_ms
        self.cars: dict[int, dict] = {}
        self.entries: dict[int, dict] = {}
        self.session = {}
        self.status = "procurando o ACC…"      # texto para mostrar no overlay quando não conecta
        self.connected = False
        self.last_rx = 0.0
        self._lock = threading.Lock()
        self._stop = False
        self._need_entries = False
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def stop(self):
        self._stop = True

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [dict(c, **{k: v for k, v in self.entries.get(i, {}).items() if k not in c}) for i, c in self.cars.items()]

    # ---- conexão -----------------------------------------------------------------
    def _run(self):
        while not self._stop:
            port, pw = _config()
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(2.0)
            conn_id = None
            asked = 0.0
            try:
                sock.connect(("127.0.0.1", port))
                reg = bytearray(struct.pack("<BB", 1, 4))
                _write_s(reg, "Pitwall")
                _write_s(reg, pw)
                reg += struct.pack("<i", self.interval)
                _write_s(reg, "")
                sock.send(bytes(reg))
                self.last_rx = time.monotonic()
                while not self._stop:
                    try:
                        data = sock.recv(8192)
                    except (socket.timeout, ConnectionResetError):
                        if time.monotonic() - self.last_rx > 6:     # jogo fechou ou não respondeu: registra de novo
                            break
                        continue
                    if self._need_entries and conn_id is not None and time.monotonic() - asked > 5:
                        asked, self._need_entries = time.monotonic(), False
                        sock.send(struct.pack("<Bi", 10, conn_id))
                    self.last_rx = time.monotonic()
                    cid = self._parse(data)
                    if cid is not None:
                        conn_id = cid
                        sock.send(struct.pack("<Bi", 10, conn_id))     # pede a lista de inscritos
            except OSError:
                pass
            finally:
                if conn_id is not None:
                    try:
                        sock.send(struct.pack("<Bi", 9, conn_id))
                    except OSError:
                        pass
                sock.close()
            self.connected = False
            if not self.status.startswith("senha"):
                self.status = "procurando o ACC…"
            with self._lock:
                self.cars.clear()
            time.sleep(4)

    # ---- mensagens ---------------------------------------------------------------
    def _parse(self, data: bytes):
        """Devolve o id da conexão quando a inscrição é aceita."""
        r = _R(data)
        try:
            t = r.u8()
            if t == 1:                                   # resultado da inscrição
                cid, ok, _ro = r.i32(), r.u8(), r.u8()
                msg = r.s()
                if ok:
                    self.connected, self.status = True, ""
                    return cid
                self.status = "senha do broadcasting do ACC não confere" + (f" ({msg})" if msg else "")
            elif t == 2:                                 # sessão
                r.u16(); r.u16()
                st, ph = r.u8(), r.u8()
                stime, send = r.f32(), r.f32()
                focused = r.i32()
                self.session = {"type": st, "phase": ph, "time": stime, "end": send, "focused": focused}
            elif t == 3:                                 # atualização de um carro
                cid, drv, ndrv, gear = r.u16(), r.u16(), r.u8(), r.u8() - 1
                x, y, yaw = r.f32(), r.f32(), r.f32()
                loc, kmh, pos, cup, tpos = r.u8(), r.u16(), r.u16(), r.u16(), r.u16()
                spline, laps, delta = r.f32(), r.u16(), r.i32()
                best, last, cur = r.lap(), r.lap(), r.lap()
                with self._lock:
                    self.cars[cid] = {
                        "id": cid, "driver_index": drv, "gear": gear, "x": x, "y": y, "loc": loc, "kmh": kmh,
                        "pos": pos, "cup_pos": cup, "track_pos": tpos, "spline": spline, "laps": laps,
                        "best_ms": best["ms"], "last_ms": last["ms"], "cur_ms": cur["ms"],
                        "last_invalid": last["invalid"], "pit": loc in (2, 3, 4)}
                    if cid not in self.entries or self.entries[cid].get("drivers") != ndrv:
                        self.entries.setdefault(cid, {})["drivers"] = ndrv
                        self._need_entries = True
            elif t == 6:                                 # carro da lista de inscritos
                cid, model = r.u16(), r.u8()
                team, number, cup, cur_drv, _nat, n = r.s(), r.i32(), r.u8(), r.u8(), r.u16(), r.u8()
                drivers = []
                for _ in range(n):
                    first, last, short = r.s(), r.s(), r.s()
                    r.u8(); r.u16()
                    drivers.append({"first": first, "last": last, "short": short})
                cur = drivers[cur_drv] if cur_drv < len(drivers) else (drivers[0] if drivers else {})
                with self._lock:
                    self.entries[cid] = {"id": cid, "model": model, "team": team, "number": number, "cup": cup,
                                         "drivers": n, "first": cur.get("first", ""), "last": cur.get("last", ""),
                                         "short": cur.get("short", "")}
        except struct.error:
            pass
        return None
