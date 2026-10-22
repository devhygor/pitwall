"""Rodas (pneu, aro com raios), discos de freio, pinças, braços de suspensão e recortes dos para-lamas. Rodar depois de carro_corpo."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())
M = materiais()
R = 0.345
AXLE = {"F": 1.40, "R": -1.38}
HALF = {"F": 0.82, "R": 0.80}            # meia-bitola
TW = {"F": 0.31, "R": 0.335}             # largura do pneu
SEG = 56


def girar(perfil, cy=0.0, seg=SEG, sy=1.0):
    """Revolução de um perfil (raio, deslocamento lateral) em torno do eixo Y local. Retorna bm."""
    bm = bmesh.new()
    rings = []
    for (r, y) in perfil:
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(bm.verts.new((r * math.cos(a), y * sy + cy, r * math.sin(a))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(seg):
            bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    return bm


def pneu(w):
    h = w / 2
    r_rim = 0.232
    P = [(r_rim + 0.002, -h * 0.80), (r_rim + 0.03, -h * 0.96), (r_rim + 0.075, -h * 1.0), (R - 0.045, -h * 0.97),
         (R - 0.012, -h * 0.84), (R, -h * 0.55), (R, -h * 0.2), (R, h * 0.2), (R, h * 0.55), (R - 0.012, h * 0.84), (R - 0.045, h * 0.97),
         (r_rim + 0.075, h * 1.0), (r_rim + 0.03, h * 0.96), (r_rim + 0.002, h * 0.80)]
    return P


def caixa(bm, c, d, giro=0.0):
    """Prisma (cx,cy,cz) com dimensões d=(dx,dy,dz), girado em torno de Y."""
    vs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                x, y, z = sx * d[0] / 2, sy * d[1] / 2, sz * d[2] / 2
                x, z = x * math.cos(giro) - z * math.sin(giro), x * math.sin(giro) + z * math.cos(giro)
                vs.append(bm.verts.new((c[0] + x, c[1] + y, c[2] + z)))
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for f in idx:
        bm.faces.new([vs[i] for i in f])


def aro(w, lado, eixo):
    """Aro: barril, face côncava com 10 raios e cubo central. lado=+1 (esquerda) ou -1. Retorna bm."""
    h = w / 2
    sgn = lado          # a face externa fica no lado de fora do carro
    bm = bmesh.new()
    # barril
    P = [(0.236, -h * 0.82 * sgn), (0.236, h * 0.82 * sgn), (0.222, h * 0.82 * sgn), (0.222, -h * 0.82 * sgn)]
    rings = []
    for (r, y) in P:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / SEG), y, r * math.sin(2 * math.pi * k / SEG))) for k in range(SEG)])
    for i in range(4):
        a, b = rings[i], rings[(i + 1) % 4]
        for k in range(SEG):
            bm.faces.new([a[k], a[(k + 1) % SEG], b[(k + 1) % SEG], b[k]])
    # raios: prisma afunilado do cubo (r=0.05) ao aro (r=0.222), levemente inclinado na face
    ye = h * 0.66 * sgn
    nrad = 10
    for i in range(nrad):
        a = 2 * math.pi * i / nrad
        ca, sa = math.cos(a), math.sin(a)
        def p(r, yy, off):
            ta, tb = -sa, ca
            return bm.verts.new((r * ca + off * ta, yy, r * sa + off * tb))
        w0, w1 = 0.020, 0.030
        v = [p(0.045, ye, -w0), p(0.045, ye, w0), p(0.222, ye * 0.82, w1), p(0.222, ye * 0.82, -w1)]
        e = [p(0.045, ye - 0.025 * sgn, -w0), p(0.045, ye - 0.025 * sgn, w0), p(0.222, ye * 0.82 - 0.025 * sgn, w1), p(0.222, ye * 0.82 - 0.025 * sgn, -w1)]
        quads = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        allv = v + e
        for q in quads:
            bm.faces.new([allv[j] for j in q])
    # cubo (disco central) e porca
    hub = girar([(0.0, ye + 0.012 * sgn), (0.055, ye + 0.012 * sgn), (0.062, ye - 0.01 * sgn), (0.062, ye - 0.03 * sgn), (0.0, ye - 0.03 * sgn)], seg=24)
    return bm, hub


def junta(bm_a, bm_b):
    me = bpy.data.meshes.new("tmp")
    bm_b.to_mesh(me)
    bm_b.free()
    bm_a.from_mesh(me)
    bpy.data.meshes.remove(me)


def disco(lado):
    """Disco ventilado: anel + sino. Fica no lado de dentro do aro."""
    ye = -0.095 * lado
    bm = girar([(0.075, ye - 0.012 * lado), (0.19, ye - 0.012 * lado), (0.19, ye + 0.012 * lado), (0.075, ye + 0.012 * lado)], seg=SEG)
    bm2 = girar([(0.075, ye + 0.012 * lado), (0.075, ye + 0.05 * lado), (0.045, ye + 0.05 * lado), (0.0, ye + 0.05 * lado)], seg=32)
    junta(bm, bm2)
    return bm


def tubo(bm, a, b, r=0.012, seg=8):
    a, b = Vector(a), Vector(b)
    d = (b - a)
    L = d.length
    z = d.normalized()
    x = z.cross(Vector((0, 0, 1)))
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    ring0 = [bm.verts.new(a + (math.cos(2 * math.pi * k / seg) * x + math.sin(2 * math.pi * k / seg) * y) * r) for k in range(seg)]
    ring1 = [bm.verts.new(b + (math.cos(2 * math.pi * k / seg) * x + math.sin(2 * math.pi * k / seg) * y) * r) for k in range(seg)]
    for k in range(seg):
        bm.faces.new([ring0[k], ring0[(k + 1) % seg], ring1[(k + 1) % seg], ring1[k]])


def objeto_de(nome, bm, mats, pai=None, loc=(0, 0, 0)):
    ob = novo_objeto(nome, bm, mats)
    ob.location = loc
    if pai:
        ob.parent = pai
    return ob


# ------------------------------------------------------------------ monta as 4 rodas
for eixo in ("F", "R"):
    for lado, sig in ((1, "L"), (-1, "R")):
        nome = eixo + ("L" if lado == 1 else "R")
        # convenção do editor: LF, RF, LR, RR
        nm = ("L" if lado == 1 else "R") + ("F" if eixo == "F" else "R")
        cx, cy, cz = AXLE[eixo], lado * HALF[eixo], R
        w = TW[eixo]
        pai = bpy.data.objects.new(f"WHEEL_{nm}", None)
        colecao().objects.link(pai)
        pai.location = (cx, cy, cz)
        # pneu: perfil em coordenadas locais; y local aponta para a esquerda
        bm = girar(pneu(w), sy=1.0)
        objeto_de(f"GEO_TIRE_{nm}", bm, [M["tyre"]], pai)
        bm_aro, hub = aro(w, lado, eixo)
        junta(bm_aro, hub)
        objeto_de(f"GEO_RIM_{nm}", bm_aro, [M["rim"]], pai)
        # disco e suspensão ficam fora da hierarquia da roda (o editor os agrupa por nome)
        d = disco(lado)
        dob = novo_objeto(f"DISC_{nm}", d, [M["disc"]])
        dob.location = (cx, cy, cz)
        # pinça + braços
        s = bmesh.new()
        caixa(s, (0.14, -0.095 * lado, 0.0), (0.16, 0.07, 0.06), 0.0)         # pinça atrás do disco, na parte de cima
        caixa(s, (0.0, -0.095 * lado, 0.16), (0.07, 0.07, 0.10), 0.0)
        for sy in (0.10, -0.08):
            tubo(s, (0, -0.07 * lado, sy * 0.2 + 0.05), (0.18 if sy > 0 else -0.18, -lado * (HALF[eixo] - 0.40), 0.10 + sy), 0.012)
        tubo(s, (0, -0.07 * lado, -0.08), (0.0, -lado * (HALF[eixo] - 0.42), -0.18), 0.012)
        mo = bmesh.new()
        sob = novo_objeto(f"SUSP_{nm}", s, [M["carbon"]])
        sob.location = (cx, cy, cz)
        mo.free()

# ------------------------------------------------------------------ recortes dos para-lamas
body = bpy.data.objects["BODY"]
cab = bpy.data.objects.get("CABIN")
for eixo in ("F", "R"):
    for lado in (1, -1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.40 if eixo == "F" else 0.415, depth=0.56, location=(AXLE[eixo], lado * (HALF[eixo] + 0.02), R), rotation=(math.pi / 2, 0, 0))
        cut = bpy.context.active_object
        cut.name = f"PW_cut_{eixo}{lado}"
        md = body.modifiers.new("cut", "BOOLEAN")
        md.operation = "DIFFERENCE"
        md.object = cut
        md.solver = "EXACT"
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.data.objects.remove(cut, do_unlink=True)

result = {"objs": sorted(o.name for o in bpy.data.objects if o.name.startswith(("WHEEL", "DISC", "SUSP", "GEO")))[:40], "body_faces": len(body.data.polygons)}
