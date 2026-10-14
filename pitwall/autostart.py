"""Iniciar o Pitwall junto com o Windows (em segundo plano).

Usa a chave do registro do próprio usuário
HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run — não precisa de
administrador e dá para desligar a qualquer momento (pelas Configurações do
Pitwall ou em Gerenciador de Tarefas → Inicializar).
"""
from __future__ import annotations

import sys
from pathlib import Path

KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
NAME = "Pitwall"
ROOT = Path(__file__).resolve().parent.parent          # pasta do projeto
LAUNCHER = ROOT / "pitwall_bg.pyw"


def supported() -> bool:
    return sys.platform == "win32"


def command() -> str:
    exe = Path(sys.executable)
    pyw = exe.with_name("pythonw.exe")
    if pyw.exists():
        exe = pyw
    return f'"{exe}" "{LAUNCHER}"'


def status() -> dict:
    out = {"supported": supported(), "enabled": False, "command": command() if supported() else None}
    if not supported():
        return out
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, KEY) as k:
            val, _ = winreg.QueryValueEx(k, NAME)
            out["enabled"] = True
            out["registered"] = val
            out["outdated"] = val != command()
    except FileNotFoundError:
        pass
    return out


def set_enabled(enabled: bool) -> dict:
    if not supported():
        return status()
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, NAME, 0, winreg.REG_SZ, command())
        else:
            try:
                winreg.DeleteValue(k, NAME)
            except FileNotFoundError:
                pass
    return status()
