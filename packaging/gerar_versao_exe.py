"""Gera packaging/version_info.txt (recurso de versão do Windows) para o PyInstaller.

Uso:  python packaging/gerar_versao_exe.py 0.1.123

Sem esses metadados o Pitwall.exe aparece sem empresa, produto nem descrição, o que pesa nas heurísticas de antivírus.
"""
import sys
from pathlib import Path

versao = sys.argv[1] if len(sys.argv) > 1 else "0.0.0"
partes = ([int(x) for x in versao.split(".") if x.isdigit()] + [0, 0, 0, 0])[:4]
tupla = tuple(partes)

texto = f'''VSVersionInfo(
  ffi=FixedFileInfo(filevers={tupla}, prodvers={tupla}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041604B0', [
      StringStruct('CompanyName', 'Pitwall'),
      StringStruct('FileDescription', 'Pitwall - telemetria e engenheiro de corrida para ACC e iRacing'),
      StringStruct('FileVersion', '{versao}'),
      StringStruct('InternalName', 'Pitwall'),
      StringStruct('LegalCopyright', 'Pitwall - https://pitwall.hygor.com.br'),
      StringStruct('OriginalFilename', 'Pitwall.exe'),
      StringStruct('ProductName', 'Pitwall'),
      StringStruct('ProductVersion', '{versao}')])]),
    VarFileInfo([VarStruct('Translation', [1046, 1200])])
  ]
)
'''
Path(__file__).with_name("version_info.txt").write_text(texto, encoding="utf-8")
print("version_info.txt gerado para", versao)
