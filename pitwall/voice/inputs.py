"""Teclas e botões globais (funcionam com o jogo em primeiro plano): teclado, mouse e volantes/controles.

Uma "tecla" é guardada como texto: "kb:70" (código virtual do Windows) ou "joy:0:5" (controle 0, botão 5).
Nas configurações o piloto clica em "Definir", aperta o que quiser e a gente descobre qual foi.
O teclado e o mouse são lidos com GetAsyncKeyState; volantes e controles, pela API antiga winmm
(até 32 botões por aparelho, a maioria dos volantes aparece assim).
"""
from __future__ import annotations

import ctypes
import sys
import threading
import time
from ctypes import wintypes

_WIN = sys.platform == "win32"

if _WIN:
    _user32 = ctypes.windll.user32
    _winmm = ctypes.windll.winmm

    class _JOYINFOEX(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("dwXpos", wintypes.DWORD),
                    ("dwYpos", wintypes.DWORD), ("dwZpos", wintypes.DWORD), ("dwRpos", wintypes.DWORD),
                    ("dwUpos", wintypes.DWORD), ("dwVpos", wintypes.DWORD), ("dwButtons", wintypes.DWORD),
                    ("dwButtonNumber", wintypes.DWORD), ("dwPOV", wintypes.DWORD), ("dwReserved1", wintypes.DWORD),
                    ("dwReserved2", wintypes.DWORD)]

NAMES = {4: "Mouse (botão do meio)", 5: "Mouse (botão 4)", 6: "Mouse (botão 5)", 8: "Backspace", 9: "Tab", 13: "Enter",
         19: "Pause", 20: "Caps Lock", 27: "Esc", 32: "Espaço", 33: "Page Up", 34: "Page Down", 35: "End", 36: "Home",
         37: "Seta ←", 38: "Seta ↑", 39: "Seta →", 40: "Seta ↓", 45: "Insert", 46: "Delete", 144: "Num Lock", 145: "Scroll Lock",
         160: "Shift esquerdo", 161: "Shift direito", 162: "Ctrl esquerdo", 163: "Ctrl direito", 164: "Alt esquerdo", 165: "Alt direito",
         91: "Windows esquerdo", 92: "Windows direito", 93: "Menu", 186: "Ç", 187: "=", 188: ",", 189: "-", 190: ".", 191: ";",
         192: "'", 219: "´", 220: "]", 221: "[", 222: "~", 226: "\\"}
# ignorados na captura: botões esquerdo/direito do mouse (clicar em "Definir"), modificadores genéricos, teclas do sistema
_SKIP = {1, 2, 3, 7, 12, 16, 17, 18, 21, 25, 28, 29, 30, 31, 41, 42, 43, 44, 47, 91, 92}


def vk_name(vk: int) -> str:
    if vk in NAMES:
        return NAMES[vk]
    if 48 <= vk <= 57 or 65 <= vk <= 90:
        return chr(vk)
    if 112 <= vk <= 135:
        return f"F{vk - 111}"
    if 96 <= vk <= 105:
        return f"Num {vk - 96}"
    if vk in (106, 107, 109, 110, 111):
        return "Num " + {106: "*", 107: "+", 109: "-", 110: ",", 111: "/"}[vk]
    if _WIN:
        try:
            sc = _user32.MapVirtualKeyW(vk, 0)
            buf = ctypes.create_unicode_buffer(64)
            if sc and _user32.GetKeyNameTextW(sc << 16, buf, 64):
                return buf.value
        except Exception:  # noqa: BLE001
            pass
    return f"Tecla {vk}"


def label(binding: str) -> str:
    if not binding:
        return "Não definida"
    kind, _, rest = binding.partition(":")
    try:
        if kind == "kb":
            return vk_name(int(rest))
        if kind == "joy":
            dev, btn = rest.split(":")
            return f"Controle/volante {int(dev) + 1}, botão {int(btn) + 1}"
    except ValueError:
        pass
    return binding


def joysticks() -> list[dict]:
    """Controles/volantes que o Windows enxerga (winmm)."""
    if not _WIN:
        return []
    out = []
    try:
        n = _winmm.joyGetNumDevs()
    except Exception:  # noqa: BLE001
        return []
    for i in range(min(n, 16)):
        info = _JOYINFOEX()
        info.dwSize = ctypes.sizeof(info)
        info.dwFlags = 0x80                                  # JOY_RETURNBUTTONS
        if _winmm.joyGetPosEx(i, ctypes.byref(info)) == 0:
            buf = ctypes.create_string_buffer(728)
            name = ""
            if _winmm.joyGetDevCapsW(i, buf, 728) == 0:
                name = bytes(buf.raw[4:68]).decode("utf-16-le", "ignore").split("\x00")[0]
            out.append({"id": i, "name": name or "Controle"})
    return out


def snapshot() -> set[str]:
    """Todas as teclas/botões apertados agora."""
    s: set[str] = set()
    if not _WIN:
        return s
    gas = _user32.GetAsyncKeyState
    for vk in range(4, 255):
        if vk in _SKIP:
            continue
        if gas(vk) & 0x8000:
            s.add(f"kb:{vk}")
    info = _JOYINFOEX()
    info.dwSize = ctypes.sizeof(info)
    info.dwFlags = 0x80
    for i in _joy_ids():
        if _winmm.joyGetPosEx(i, ctypes.byref(info)) == 0 and info.dwButtons:
            b = info.dwButtons
            for k in range(32):
                if b & (1 << k):
                    s.add(f"joy:{i}:{k}")
    return s


_JOY_CACHE = {"at": 0.0, "ids": []}


def _joy_ids() -> list[int]:
    now = time.monotonic()
    if now - _JOY_CACHE["at"] > 5.0:
        _JOY_CACHE["at"] = now
        _JOY_CACHE["ids"] = [j["id"] for j in joysticks()]
    return _JOY_CACHE["ids"]


def is_down(binding: str) -> bool:
    if not binding or not _WIN:
        return False
    kind, _, rest = binding.partition(":")
    try:
        if kind == "kb":
            return bool(_user32.GetAsyncKeyState(int(rest)) & 0x8000)
        if kind == "joy":
            dev, btn = (int(x) for x in rest.split(":"))
            info = _JOYINFOEX()
            info.dwSize = ctypes.sizeof(info)
            info.dwFlags = 0x80
            return _winmm.joyGetPosEx(dev, ctypes.byref(info)) == 0 and bool(info.dwButtons & (1 << btn))
    except (ValueError, OSError):
        pass
    return False


class KeyWatcher:
    """Vigia a tecla de falar e avisa quando é apertada/solta; também captura uma nova tecla."""

    def __init__(self, on_down, on_up):
        self.on_down, self.on_up = on_down, on_up
        self.binding = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.capture_state = {"state": "idle", "binding": "", "label": ""}
        self._cap_lock = threading.Lock()

    def start(self):
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True, name="pitwall-keys")
            self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        down = False
        while not self._stop.is_set():
            b = self.binding
            now = bool(b) and self.capture_state["state"] != "waiting" and is_down(b)
            if now and not down:
                down = True
                self._safe(self.on_down)
            elif not now and down:
                down = False
                self._safe(self.on_up)
            time.sleep(0.02)

    @staticmethod
    def _safe(fn):
        try:
            fn()
        except Exception:  # noqa: BLE001
            pass

    # ---- captura de uma tecla nova ------------------------------------------------------------
    def capture(self, timeout: float = 10.0):
        with self._cap_lock:
            if self.capture_state["state"] == "waiting":
                return
            self.capture_state = {"state": "waiting", "binding": "", "label": ""}
        threading.Thread(target=self._capture, args=(timeout,), daemon=True).start()

    def cancel_capture(self):
        with self._cap_lock:
            if self.capture_state["state"] == "waiting":
                self.capture_state = {"state": "cancelled", "binding": "", "label": ""}

    def _capture(self, timeout: float):
        ignored = snapshot()                  # o que já estava apertado (ex.: o clique no botão "Definir")
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.capture_state["state"] != "waiting":
                return
            cur = snapshot()
            ignored &= cur                    # soltou? passa a valer
            new = cur - ignored
            if new:
                if "kb:27" in new:            # Esc cancela
                    self.capture_state = {"state": "cancelled", "binding": "", "label": ""}
                    return
                # se vierem vários ao mesmo tempo, prefere o botão de volante (mais específico)
                pick = sorted(new, key=lambda s: (not s.startswith("joy"), s))[0]
                self.capture_state = {"state": "done", "binding": pick, "label": label(pick)}
                return
            time.sleep(0.02)
        if self.capture_state["state"] == "waiting":
            self.capture_state = {"state": "timeout", "binding": "", "label": ""}
