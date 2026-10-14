# Inicia o Pitwall em segundo plano (sem janela, com ícone perto do relógio).
# É este arquivo que o Windows abre quando "Iniciar com o Windows" está ligado.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from pitwall.__main__ import main  # noqa: E402

main(["--background"])
