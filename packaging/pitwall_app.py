"""Ponto de entrada do executável (Pitwall.exe, gerado pelo PyInstaller).

    Pitwall.exe                abre o app (janela própria)
    Pitwall.exe --background   segundo plano, só o ícone perto do relógio (iniciar com o Windows)
"""
import sys

from pitwall.__main__ import main

if __name__ == "__main__":
    main(sys.argv[1:])
