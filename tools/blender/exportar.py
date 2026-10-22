"""Exporta a coleção PitwallGT como .glb (sem texturas, sem UV) para o editor de setup. Defina SAIDA antes de executar."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())

col = bpy.data.collections["PitwallGT"]
bpy.ops.object.select_all(action="DESELECT")
n_tris = 0
n_obj = 0
for o in col.objects:
    if o.type in {"MESH", "EMPTY"} and not o.name.startswith("PW_target"):
        o.hide_set(False)
        o.select_set(True)
        n_obj += 1
        if o.type == "MESH":
            n_tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
bpy.context.view_layer.objects.active = next(o for o in col.objects if o.name == "BODY")
bpy.ops.export_scene.gltf(
    filepath=SAIDA, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_materials="EXPORT", export_image_format="NONE", export_texcoords=False, export_normals=True,
    export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
    export_draco_mesh_compression_enable=False,
)
import os
result = {"objetos": n_obj, "triangulos": n_tris, "bytes": os.path.getsize(SAIDA)}
