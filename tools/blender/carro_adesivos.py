"""Faróis, grades, entradas de ar, lanternas e pintura Pitwall, como adesivos projetados na superfície do carro. Rodar depois de carro_corpo."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())
M = materiais()

for o in list(bpy.data.objects):
    if o.name.startswith(("LIV_", "PW_target")):
        bpy.data.objects.remove(o, do_unlink=True)

# alvo da projeção: carroceria + cabine juntas (só geometria, escondido)
bm = bmesh.new()
for nm in ("BODY", "CABIN"):
    bm.from_mesh(bpy.data.objects[nm].data)
me = bpy.data.meshes.new("PW_target")
bm.to_mesh(me)
bm.free()
alvo = bpy.data.objects.new("PW_target", me)
colecao().objects.link(alvo)
alvo.hide_render = True


def grade(nu, nv, fn):
    bm = bmesh.new()
    vs = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new([vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]])
    return bm


def projetar(nome, bm, eixo, sentido, mat, offset=0.004):
    """eixo 'x','y','z'; sentido +1 projeta no sentido positivo do eixo (o plano de partida fica do lado negativo) e -1 o contrário."""
    ob = novo_objeto("LIV_" + nome, bm, [mat])
    md = ob.modifiers.new("sw", "SHRINKWRAP")
    md.target = alvo
    md.wrap_method = "PROJECT"
    md.use_project_x, md.use_project_y, md.use_project_z = eixo == "x", eixo == "y", eixo == "z"
    md.use_positive_direction = sentido > 0
    md.use_negative_direction = sentido < 0
    md.offset = offset
    md.wrap_mode = "ABOVE_SURFACE"
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=md.name)
    ob.select_set(False)
    # apaga o que não achou a superfície (ficou no plano de partida)
    lim = {"x": 3.0, "y": 1.8, "z": 1.6}[eixo]
    idx = "xyz".index(eixo)
    b2 = bmesh.new()
    b2.from_mesh(ob.data)
    ruim = [v for v in b2.verts if abs(v.co[idx]) > lim]
    if ruim:
        bmesh.ops.delete(b2, geom=ruim, context="VERTS")
    b2.to_mesh(ob.data)
    b2.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def sq(a, b, k=0.30):
    """Quadrado -> quadrado arredondado (a, b em [-1, 1])."""
    return a * (1 - k * b * b), b * (1 - k * a * a)


def faixa_x(nome, x0, x1, ymin, ymax, mat, offset=0.004, nu=60, nv=6):
    """Faixa ao longo de X (capô/teto/traseira), vista de cima."""
    def f(u, v):
        return (x0 + (x1 - x0) * u, ymin + (ymax - ymin) * v, 2.0)
    return projetar(nome, grade(nu, nv, f), "z", -1, mat, offset)


# ------------------------------------------------------------------ pintura Pitwall (faixas de carbono com fio neon)
for (nome, x0, x1) in (("capo", 0.72, 2.02), ("teto", -1.12, 0.20), ("deck", -2.10, -1.72)):
    faixa_x(nome + "_carbono", x0, x1, -0.15, 0.15, M["carbon"], 0.004, 60, 5)
    for s in (-1, 1):
        faixa_x(f"{nome}_neon{'L' if s > 0 else 'R'}", x0, x1, s * 0.158, s * 0.176, M["neon"], 0.006, 60, 2)

# laterais: banda de carbono embaixo da porta, fio neon, número e nome
for s, lado in ((1, "L"), (-1, "R")):
    def banda(u, v, s=s):
        x = -0.93 + 1.86 * u
        zt = 0.255 + 0.07 * abs(2 * u - 1) ** 2.5
        return (x, s * 2.0, 0.105 + (zt - 0.105) * v)
    projetar("banda_" + lado, grade(46, 5, banda), "y", -s, M["carbon"], 0.004)

    def fio(u, v, s=s):
        x = -0.93 + 1.86 * u
        zt = 0.262 + 0.07 * abs(2 * u - 1) ** 2.5
        return (x, s * 2.0, zt + 0.014 * v)
    projetar("fio_" + lado, grade(46, 2, fio), "y", -s, M["neon"], 0.006)

    def disco(u, v, s=s):
        a = 2 * math.pi * u
        r = 0.135 * v
        return (-0.08 + r * math.cos(a), s * 2.0, 0.42 + r * math.sin(a))
    projetar("numero_fundo_" + lado, grade(36, 6, disco), "y", -s, M["white"], 0.005)
    aro_ = lambda u, v, s=s: (-0.08 + (0.135 + 0.014 * v) * math.cos(2 * math.pi * u), s * 2.0, 0.42 + (0.135 + 0.014 * v) * math.sin(2 * math.pi * u))
    projetar("numero_aro_" + lado, grade(36, 2, aro_), "y", -s, M["neon"], 0.007)

# entrada de ar atrás da porta e saída do para-lama dianteiro (vistas nas referências de GT3)
for s, lado in ((1, "L"), (-1, "R")):
    def entrada(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.12)
        return (-1.00 + 0.10 * a, s * 2.0, 0.50 + 0.17 * b)
    projetar("entrada_lateral_" + lado, grade(14, 14, entrada), "y", -s, M["black"], 0.006)
    for i in range(5):
        def aleta(u, v, s=s, i=i):
            return (-1.00 + 0.085 * (2 * u - 1), s * 2.0, 0.37 + 0.065 * i + 0.012 * v)
        projetar(f"entrada_aleta_{lado}{i}", grade(8, 2, aleta), "y", -s, M["rim"], 0.009)

    def fenda_p(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.1)
        return (0.78 + 0.16 * a, s * 2.0, 0.60 + 0.09 * b)
    projetar("paralama_saida_" + lado, grade(16, 8, fenda_p), "y", -s, M["black"], 0.006)
    for i in range(5):
        def aleta2(u, v, s=s, i=i):
            return (0.78 + 0.15 * (2 * u - 1), s * 2.0, 0.555 + 0.025 * i + 0.007 * v)
        projetar(f"paralama_aleta_{lado}{i}", grade(10, 1, aleta2), "y", -s, M["rim"], 0.009)

# frente: abertura dupla central, entradas de freio, faróis finos e angulosos
for s, lado in ((1, "L"), (-1, "R")):
    def abertura(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.14)
        w = 0.155 + 0.03 * (1 - v)                    # trapézio, mais largo embaixo
        return (3.5, s * (0.215 + w * a), 0.36 + 0.10 * b)
    projetar("grade_" + lado, grade(20, 12, abertura), "x", -1, M["black"], 0.006)
    for i in range(4):
        def trave(u, v, s=s, i=i):
            return (3.5, s * (0.215 + 0.16 * (2 * u - 1)), 0.29 + 0.045 * i + 0.01 * v)
        projetar(f"grade_trave_{lado}{i}", grade(10, 1, trave), "x", -1, M["rim"], 0.009)

    def entrada_freio(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.2)
        return (3.5, s * (0.66 + 0.13 * a), 0.235 + 0.07 * b)
    projetar("entrada_freio_" + lado, grade(16, 8, entrada_freio), "x", -1, M["black"], 0.006)

    def farol(u, v, s=s):
        y = s * (0.43 + 0.40 * u)
        z = 0.50 + 0.075 * u + (v - 0.5) * (0.078 - 0.040 * u)
        return (3.5, y, z)
    projetar("farol_" + lado, grade(28, 6, farol), "x", -1, M["light"], 0.006)

    def moldura(u, v, s=s):
        y = s * (0.415 + 0.43 * u)
        z = 0.50 + 0.075 * u + (v - 0.5) * (0.100 - 0.040 * u)
        return (3.5, y, z)
    projetar("farol_moldura_" + lado, grade(28, 6, moldura), "x", -1, M["black"], 0.004)


def labio(u, v):
    a, b = sq(2 * u - 1, 2 * v - 1, 0.1)
    return (3.5, 0.34 * a, 0.195 + 0.035 * b)
projetar("entrada_inferior", grade(26, 4, labio), "x", -1, M["black"], 0.006)

# capô: duas grandes saídas de ar com aletas
for s in (-1, 1):
    def saida(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.1)
        return (1.14 + 0.19 * a, s * (0.24 + 0.15 * b), 2.0)
    projetar(f"capo_saida_{s}", grade(16, 12, saida), "z", -1, M["black"], 0.006)
    for i in range(5):
        def aleta3(u, v, s=s, i=i):
            return (0.98 + 0.075 * i + 0.012 * v, s * (0.11 + 0.26 * u), 2.0)
        projetar(f"capo_aleta_{s}_{i}", grade(8, 1, aleta3), "z", -1, M["rim"], 0.009)

# traseira: lanternas em "L", barra central e para-choque de carbono
for s, lado in ((1, "L"), (-1, "R")):
    def lamp(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.25)
        return (-3.5, s * (0.62 + 0.19 * a), 0.700 + 0.040 * b)
    projetar("lanterna_" + lado, grade(24, 6, lamp), "x", 1, M["tail"], 0.005)

    def lamp2(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.25)
        return (-3.5, s * (0.77 + 0.025 * a), 0.625 + 0.07 * b)
    projetar("lanterna_perna_" + lado, grade(6, 6, lamp2), "x", 1, M["tail"], 0.005)


def barra(u, v):
    return (-3.5, -0.36 + 0.72 * u, 0.700 + 0.018 * v)
projetar("lanterna_barra", grade(30, 2, barra), "x", 1, M["tail"], 0.005)


def parachoque(u, v):
    a, b = sq(2 * u - 1, 2 * v - 1, 0.18)
    return (-3.5, 0.74 * a, 0.40 + 0.075 * b)
projetar("traseira_carbono", grade(40, 10, parachoque), "x", 1, M["carbon"], 0.005)

# frestas das portas e maçanetas
for s, lado in ((1, "L"), (-1, "R")):
    def fresta_f(u, v, s=s):
        return (0.52 - 0.05 * u + 0.006 * v, s * 2.0, 0.30 + 0.52 * u)

    def fresta_t(u, v, s=s):
        return (-0.90 - 0.03 * u + 0.006 * v, s * 2.0, 0.30 + 0.52 * u)
    projetar("fresta_f_" + lado, grade(30, 1, fresta_f), "y", -s, M["black"], 0.003)
    projetar("fresta_t_" + lado, grade(30, 1, fresta_t), "y", -s, M["black"], 0.003)

    def macaneta(u, v, s=s):
        a, b = sq(2 * u - 1, 2 * v - 1, 0.5)
        return (-0.62 + 0.075 * a, s * 2.0, 0.62 + 0.011 * b)
    projetar("macaneta_" + lado, grade(12, 3, macaneta), "y", -s, M["carbon"], 0.006)


# textos nas portas (curva de texto -> malha densa -> projetada na lateral)
def texto(nome, corpo, tam, x, z, mat, s):
    cu = bpy.data.curves.new("txt" + nome, "FONT")
    cu.body = corpo
    cu.size = tam
    cu.align_x = "CENTER"
    cu.extrude = 0.0
    to = bpy.data.objects.new("LIV_txt_" + nome, cu)
    colecao().objects.link(to)
    to.location = (x, s * 2.0, z)
    to.rotation_euler = (math.pi / 2, 0, math.pi if s > 0 else 0)
    bpy.context.view_layer.objects.active = to
    to.select_set(True)
    bpy.ops.object.convert(target="MESH")
    to.select_set(False)
    b2 = bmesh.new()
    b2.from_mesh(to.data)
    bmesh.ops.triangulate(b2, faces=b2.faces[:])
    for _ in range(3):
        bmesh.ops.subdivide_edges(b2, edges=b2.edges[:], cuts=1, use_grid_fill=False)
    b2.to_mesh(to.data)
    b2.free()
    to.data.materials.clear()
    to.data.materials.append(mat)
    md = to.modifiers.new("sw", "SHRINKWRAP")
    md.target = alvo
    md.wrap_method = "PROJECT"
    md.use_project_z = True                 # eixo local Z do texto = normal da letra (aponta para fora do carro)
    md.use_negative_direction = True
    md.use_positive_direction = False
    md.offset = 0.008
    bpy.context.view_layer.objects.active = to
    to.select_set(True)
    bpy.ops.object.modifier_apply(modifier=md.name)
    to.select_set(False)
    for p in to.data.polygons:
        p.use_smooth = False


for s, lado in ((1, "L"), (-1, "R")):
    texto("pitwall_" + lado, "PITWALL", 0.085, -0.52, 0.335, M["white"], s)
    texto("num_" + lado, "69", 0.150, -0.08, 0.368, M["black"], s)

bpy.data.objects.remove(alvo, do_unlink=True)
result = {"n": len([o for o in bpy.data.objects if o.name.startswith("LIV_")])}
