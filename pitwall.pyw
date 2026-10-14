# Abre o Pitwall como aplicativo (janela própria, sem console).
# É para este arquivo que os atalhos da Área de Trabalho e do Menu Iniciar apontam.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from pitwall.__main__ import main  # noqa: E402

main([])
