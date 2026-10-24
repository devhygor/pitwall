"""Escolhe, para cada carro, um setup da sua pasta do ACC e o guarda em pitwall/base_setups/<carro>/default.json.

Quando o carro tem vários setups, a preferência é: nome começando com BASE > corrida (R) > variante "Safe" > nome mais curto.
Rode:  python tools/coletar_bases.py
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pitwall import setups  # noqa: E402

root = setups.setups_root()
dest = setups.BASES_DIR
best: dict[str, tuple[tuple, Path]] = {}
for f in sorted(root.glob("*/*/*.json")):
    try:
        json.loads(f.read_text(encoding="utf-8-sig"))
    except ValueError:
        print(f"ignorado (inválido): {f}")
        continue
    meta = setups.parse_name(f.stem)
    key = (not f.stem.upper().startswith("BASE"), meta["kind"] != "R", "safe" not in (meta["variant"] or "").lower(), len(f.stem), f.stem)
    car = f.parent.parent.name
    if car not in best or key < best[car][0]:
        best[car] = (key, f)
for car, (_, f) in sorted(best.items()):
    (dest / car).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(f, dest / car / "default.json")
    print(f"{car}  <-  {f.relative_to(root)}")
print(f"{len(best)} base(s) em {dest}" if best else f"Nenhum setup em {root}")
