"""Cena de vitrine para conferir o modelo (piso, luzes e câmera). Rodar depois de pwlib."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = 1400, 800
w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
sc.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.05, 0.06, 0.08, 1)
bg.inputs[1].default_value = 1.0
if "PW_floor" not in bpy.data.objects:
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    fl = bpy.context.active_object
    fl.name = "PW_floor"
    fl.data.materials.append(mat("floor", (0.08, 0.09, 0.1, 1), 0.0, 0.5))
for nm, loc, e, sz in (("PW_key", (-4, 5, 5), 1500, 4), ("PW_fill", (5, -4, 3), 700, 5), ("PW_rim", (0, -6, 4), 900, 3)):
    if nm in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)
    ld = bpy.data.lights.new(nm, "AREA")
    ld.energy = e
    ld.size = sz
    lo = bpy.data.objects.new(nm, ld)
    sc.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
l0 = bpy.data.objects.get("Light")
if l0:
    l0.hide_render = True
    l0.hide_viewport = True
cam = bpy.data.objects["Camera"]
cam.data.lens = 50


def cena(loc, target=(0, 0, 0.55), lens=50):
    cam.data.lens = lens
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
