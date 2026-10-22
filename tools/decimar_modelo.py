"""Reduz um modelo .glb de malha única (ex.: gerado por IA) para um tamanho leve, mantendo a forma.

Uso:  .venv\\Scripts\\python.exe tools\\decimar_modelo.py entrada.glb saida.glb [triângulos alvo, padrão 200000]

Precisa de:  pip install fast-simplification numpy scipy   (só para quem prepara o modelo; o app não depende disso).
A saída tem só posição, normais e índices (sem texturas): o editor de setup pinta o carro com a pintura Pitwall.
"""
import json
import struct
import sys

import numpy as np
import fast_simplification as fs


def ler_glb(caminho):
    with open(caminho, "rb") as f:
        f.read(12)
        cl, _ = struct.unpack("<II", f.read(8))
        j = json.loads(f.read(cl))
        f.read(8)
        dados = f.read()
    prim = j["meshes"][0]["primitives"][0]
    acc, bv = j["accessors"], j["bufferViews"]

    def arr(i, dtype, comps):
        a = acc[i]
        b = bv[a["bufferView"]]
        off = b.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(dados, dtype=dtype, count=a["count"] * comps, offset=off).reshape(-1, comps)

    pos = arr(prim["attributes"]["POSITION"], np.float32, 3).copy()
    nor = arr(prim["attributes"]["NORMAL"], np.float32, 3).copy() if "NORMAL" in prim["attributes"] else None
    ct = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[acc[prim["indices"]]["componentType"]]
    idx = arr(prim["indices"], ct, 1).reshape(-1, 3).astype(np.int32)
    return pos, idx, nor


def normais_do_original(p_novo, p_orig, n_orig):
    """Normais suaves: cada vértice novo herda a normal do vértice original mais próximo (mantém o brilho liso do modelo completo)."""
    from scipy.spatial import cKDTree
    _, i = cKDTree(p_orig).query(p_novo)
    n = n_orig[i]
    l = np.linalg.norm(n, axis=1, keepdims=True)
    l[l == 0] = 1
    return (n / l).astype(np.float32)


def normais(pos, idx):
    n = np.zeros_like(pos)
    p0, p1, p2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)
    for k in range(3):
        np.add.at(n, idx[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True)
    l[l == 0] = 1
    return (n / l).astype(np.float32)


def escrever_glb(caminho, pos, nor, idx):
    pos = pos.astype(np.float32)
    idx = idx.astype(np.uint32)
    bp, bn, bi = pos.tobytes(), nor.tobytes(), idx.tobytes()
    tudo = bp + bn + bi
    j = {
        "asset": {"version": "2.0", "generator": "pitwall-decimar"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "carro"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}}],
        "buffers": [{"byteLength": len(tudo)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(bp), "target": 34962},
                        {"buffer": 0, "byteOffset": len(bp), "byteLength": len(bn), "target": 34962},
                        {"buffer": 0, "byteOffset": len(bp) + len(bn), "byteLength": len(bi), "target": 34963}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                      {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
                      {"bufferView": 2, "componentType": 5125, "count": idx.size, "type": "SCALAR"}],
    }
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    tudo += b"\0" * (-len(tudo) % 4)
    with open(caminho, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(tudo)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(tudo), 0x004E4942) + tudo)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    alvo = int(sys.argv[3]) if len(sys.argv) > 3 else 200_000
    pos, idx, nor0 = ler_glb(sys.argv[1])
    print(f"entrada: {len(pos)} vértices, {len(idx)} triângulos")
    red = max(0.0, min(0.99, 1 - alvo / len(idx)))
    p2, f2 = fs.simplify(pos, idx, target_reduction=red)
    f2 = f2.reshape(-1, 3)
    print(f"saída:   {len(p2)} vértices, {len(f2)} triângulos")
    escrever_glb(sys.argv[2], p2, normais_do_original(p2, pos, nor0) if nor0 is not None else normais(p2, f2), f2)
