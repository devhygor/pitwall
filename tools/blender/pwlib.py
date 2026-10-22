"""Funções de apoio para modelar o carro do editor de setup no Blender (carregadas por exec nas chamadas do MCP).

Convenção do modelo: X = frente, Y = esquerda, Z = cima, em metros. Rodas: raio 0,345, entre-eixos 2,78.
"""
import bpy, bmesh, math
from mathutils import Vector


def interp(xs, ys, x):
    """Catmull-Rom por trechos (C1) em x não uniforme."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = max(j for j in range(len(xs) - 1) if xs[j] <= x)
    x0, x1 = xs[i], xs[i + 1]
    t = (x - x0) / (x1 - x0)

    def m(k):
        a, b = max(k - 1, 0), min(k + 1, len(xs) - 1)
        return (ys[b] - ys[a]) / (xs[b] - xs[a]) if b != a else 0
    h = x1 - x0
    p0, p1, m0, m1 = ys[i], ys[i + 1], m(i) * h, m(i + 1) * h
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1


def sp(a, e):
    return math.copysign(abs(a) ** e, a)


def mat(name, color, metal=0.0, rough=0.5, cc=0.0, alpha=1.0, emit=None, forca=2.0, culling=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = culling          # no glTF vira doubleSided=false: o editor (three.js) não desenha o lado de trás
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b is None:
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    b.inputs["Base Color"].default_value = color
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    for k, v in (("Coat Weight", cc), ("Coat Roughness", 0.03)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    b.inputs["Alpha"].default_value = alpha
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = forca
    if alpha < 1:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    return m


def materiais():
    return {
        "paint": mat("carpaint", (0.0, 0.55, 0.14, 1), 0.55, 0.22, 1.0, culling=True),
        "glass": mat("glass_tint", (0.03, 0.05, 0.07, 1), 0.6, 0.05, 1.0, 0.82, culling=True),
        "hull": mat("hull_black", (0.004, 0.004, 0.005, 1), 0.0, 0.8, culling=True),
        "carbon": mat("carbon", (0.015, 0.017, 0.02, 1), 0.35, 0.42),
        "black": mat("trim_black", (0.005, 0.005, 0.006, 1), 0.0, 0.7),
        "tyre": mat("tyre", (0.03, 0.03, 0.035, 1), 0.0, 0.9),
        "rim": mat("rim_dark", (0.07, 0.075, 0.085, 1), 0.9, 0.3),
        "disc": mat("brake_disc", (0.35, 0.35, 0.37, 1), 0.9, 0.35),
        "neon": mat("livery_neon", (0.1, 1.0, 0.55, 1), 0.0, 0.4, emit=(0.1, 1.0, 0.55, 1)),
        "white": mat("livery_white", (0.92, 0.94, 0.96, 1), 0.0, 0.4),
        "light": mat("headlight", (0.8, 0.9, 1.0, 1), 0.0, 0.1, emit=(0.8, 0.9, 1.0, 1)),
        "tail": mat("taillight", (0.5, 0.0, 0.0, 1), 0.0, 0.2, emit=(1.0, 0.0, 0.0, 1), forca=0.9),
    }


def colecao():
    col = bpy.data.collections.get("PitwallGT") or bpy.data.collections.new("PitwallGT")
    if col.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(col)
    return col


def limpar():
    for o in list(bpy.data.objects):
        if o.name.startswith(("PW_", "BODY", "CABIN", "WHEEL_", "DISC_", "SUSP_", "GEO_", "LIV_")):
            bpy.data.objects.remove(o, do_unlink=True)
    cube = bpy.data.objects.get("Cube")
    if cube:
        cube.hide_viewport = True
        cube.hide_render = True


def novo_objeto(nome, bm, mats, suave=True):
    me = bpy.data.meshes.new(nome)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(nome, me)
    colecao().objects.link(ob)
    if suave:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def subdividir(ob, niveis=2):
    md = ob.modifiers.new("Subd", "SUBSURF")
    md.levels = niveis
    md.render_levels = niveis
    md.quality = 6
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=md.name)
    ob.select_set(False)
