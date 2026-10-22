"""Peças aerodinâmicas e acessórios: splitter, saias, difusor, aerofólio, retrovisores, escapamento. Rodar depois de carro_corpo."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())
M = materiais()


def poligono(nome, pts, z0, esp, mat, bevel=0.006, suave=True):
    """Chapa: contorno (x,y) extrudado esp para cima a partir de z0."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=(0, 0, esp))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    return novo_objeto(nome, bm, [mat], suave)


def caixa_b(nome, c, d, mat, bevel=0.008, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=d, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    ob = novo_objeto(nome, bm, [mat])
    ob.location = c
    ob.rotation_euler = rot
    return ob


def aerofolio_perfil(corda, esp=0.11, camber=0.07, n=22):
    """Perfil assimétrico (NACA 4 dígitos invertido, gera downforce). Retorna lista (x_local, z_local) de contorno fechado."""
    sup, inf = [], []
    for i in range(n + 1):
        u = (1 - math.cos(math.pi * i / n)) / 2
        t = esp * 5 * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)
        yc = -camber * 4 * u * (1 - u)
        sup.append((u * corda, (yc + t) * corda))
        inf.append((u * corda, (yc - t) * corda))
    return sup + list(reversed(inf[1:-1]))


def extrudar_perfil_y(nome, perfil, x0, z0, y0, y1, mat, ang=0.0):
    """Extruda um contorno no plano XZ ao longo de Y (de y0 a y1). Perfil em (x,z) local; ang gira em torno de Y (positivo = bordo de ataque mais baixo)."""
    bm = bmesh.new()
    ca, sa = math.cos(ang), math.sin(ang)
    pts = [(x0 + px * ca + pz * sa, z0 - px * sa + pz * ca) for px, pz in perfil]
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    for i in range(n):
        bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return novo_objeto(nome, bm, [mat])


def tubo(bm, a, b, r=0.012, seg=8):
    a, b = Vector(a), Vector(b)
    z = (b - a).normalized()
    x = z.cross(Vector((0, 0, 1)))
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    r0 = [bm.verts.new(a + (math.cos(2 * math.pi * k / seg) * x + math.sin(2 * math.pi * k / seg) * y) * r) for k in range(seg)]
    r1 = [bm.verts.new(b + (math.cos(2 * math.pi * k / seg) * x + math.sin(2 * math.pi * k / seg) * y) * r) for k in range(seg)]
    for k in range(seg):
        bm.faces.new([r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]])


# ------------------------------------------------------------------ splitter, saias e difusor
def meia_largura(x):
    return interp(CX, W, min(max(x, XEND[0]), XEND[1]))


frente = []
for i in range(0, 17):
    x = 1.55 + (2.36 - 1.55) * i / 16
    frente.append((x, meia_largura(min(x, 2.17)) + 0.045 - 0.20 * max(0, (x - 2.0)) ** 1.3))
pts = [(x, y) for x, y in frente] + [(x, -y) for x, y in reversed(frente)]
poligono("PW_splitter", pts, 0.035, 0.022, M["carbon"], 0.006)
for i, s in enumerate((-1, 1)):
    caixa_b(f"PW_skirt_{'L' if s > 0 else 'R'}", (0.0, s * 0.935, 0.135), (2.30, 0.06, 0.085), M["carbon"], 0.012)
# difusor: rampa + aletas
bm = bmesh.new()
xs = [-1.62, -1.85, -2.10, -2.34]
zs = [0.075, 0.095, 0.17, 0.33]
rows = []
for x, z in zip(xs, zs):
    rows.append([bm.verts.new((x, y, z)) for y in (-0.72, -0.24, 0.24, 0.72)])
for r in range(3):
    for k in range(3):
        bm.faces.new([rows[r][k], rows[r][k + 1], rows[r + 1][k + 1], rows[r + 1][k]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
novo_objeto("PW_diffuser", bm, [M["carbon"]], False)
for y in (-0.55, -0.28, 0.0, 0.28, 0.55):
    poligono(f"PW_dfin_{int(y * 100)}", [(-1.70, y - 0.008), (-2.34, y - 0.008), (-2.34, y + 0.008), (-1.70, y + 0.008)], 0.0, 0.0, M["carbon"], 0, False) if False else None

# placas laterais do splitter (carbono) e uma aleta pintada acima de cada uma
for s_ in (-1, 1):
    lado_ = "L" if s_ > 0 else "R"
    yb = s_ * (meia_largura(2.0) + 0.040)
    for nome, cont, mt in ((f"PW_splitter_plate_{lado_}", [(1.80, 0.055), (2.30, 0.055), (2.31, 0.11), (2.12, 0.19), (1.90, 0.20)], M["carbon"]),
                           (f"PW_splitter_fin_{lado_}", [(1.95, 0.25), (2.22, 0.23), (2.20, 0.27), (1.98, 0.31)], M["paint"])):
        bm = bmesh.new()
        a_ = [bm.verts.new((x, yb, z)) for x, z in cont]
        b_ = [bm.verts.new((x, yb + s_ * 0.012, z)) for x, z in cont]
        n_ = len(cont)
        for i in range(n_):
            bm.faces.new([a_[i], a_[(i + 1) % n_], b_[(i + 1) % n_], b_[i]])
        bm.faces.new(a_)
        bm.faces.new(list(reversed(b_)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        novo_objeto(nome, bm, [mt], False)

# ------------------------------------------------------------------ aerofólio traseiro (dois elementos, hastes e placas laterais)
wx, wz = -1.98, 1.13
prof1 = aerofolio_perfil(0.34, esp=0.10, camber=0.05)
prof2 = aerofolio_perfil(0.17, esp=0.09, camber=0.08)
w1 = extrudar_perfil_y("PW_wing_main", prof1, wx - 0.30, wz, -0.93, 0.93, M["carbon"], ang=-0.04)
w2 = extrudar_perfil_y("PW_wing_flap", prof2, wx - 0.34, wz + 0.075, -0.93, 0.93, M["carbon"], ang=-0.30)
for s in (-1, 1):
    ep = poligono(f"PW_endplate_{'L' if s > 0 else 'R'}", [(wx - 0.38, -0.01), (wx + 0.08, -0.01), (wx + 0.10, 0.01), (wx - 0.38, 0.01)], 0, 0, M["carbon"], 0) if False else None
    # placa lateral: contorno no plano XZ extrudado em y
    contorno = [(-0.40, -0.10), (0.02, -0.10), (0.07, 0.0), (0.04, 0.10), (-0.12, 0.12), (-0.40, 0.14)]
    bm = bmesh.new()
    y0, y1 = s * 0.935, s * 0.955
    a = [bm.verts.new((wx + px, y0, wz + pz)) for px, pz in contorno]
    b = [bm.verts.new((wx + px, y1, wz + pz)) for px, pz in contorno]
    n = len(contorno)
    for i in range(n):
        bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    novo_objeto(f"PW_endplate_{'L' if s > 0 else 'R'}", bm, [M["carbon"]], False)
    # haste "pescoço de cisne": curva do deck até a face de cima do aerofólio
    cam = [(-1.72, 0.90), (-1.74, 1.00), (-1.80, 1.10), (-1.90, 1.19), (-2.04, 1.24), (-2.14, 1.255)]
    bm = bmesh.new()
    for (x0, z0), (x1, z1) in zip(cam[:-1], cam[1:]):
        tubo(bm, (x0, s * 0.43, z0), (x1, s * 0.43, z1), 0.017, 10)
    novo_objeto(f"PW_strut_{'L' if s > 0 else 'R'}", bm, [M["paint"]])

# ------------------------------------------------------------------ retrovisores e escapamento
for s in (-1, 1):
    lado = "L" if s > 0 else "R"
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.5)
    bmesh.ops.scale(bm, vec=(0.20, 0.26, 0.14), verts=bm.verts)
    ob = novo_objeto(f"PW_mirror_{lado}", bm, [M["paint"]])
    ob.location = (0.52, s * 0.98, 0.93)
    ob.rotation_euler = (0, 0, s * 0.12)
    caixa_b(f"PW_mirror_stalk_{lado}", (0.55, s * 0.86, 0.90), (0.07, 0.20, 0.025), M["carbon"], 0.005, (0, 0, s * 0.2))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=0.045, radius2=0.045, depth=0.20)
for v in bm.verts:
    v.co = Vector((v.co.z, v.co.y, v.co.x))
ex = novo_objeto("PW_exhaust", bm, [M["rim"]])
ex.location = (-2.22, 0.0, 0.30)

result = {"objs": len([o for o in bpy.data.objects if o.name.startswith("PW_")])}
