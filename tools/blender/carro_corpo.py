"""Carroceria e cabine do GT do Pitwall (seções suavizadas por subdivisão). Rodar depois de pwlib."""
exec(open(r"C:\Users\Hygor\Projetos-Hygor\Pitwall\tools\blender\pwlib.py", encoding="utf-8").read())

limpar()
M = materiais()

# ------------------------------------------------------------------ carroceria baixa (capô, para-lamas, laterais, traseira)
CX = [-2.18, -2.02, -1.75, -1.38, -0.80, -0.20, 0.40, 0.90, 1.40, 1.78, 2.00, 2.12, 2.18]
W  = [0.84, 0.94, 0.99, 1.00, 0.975, 0.96, 0.955, 0.965, 0.985, 0.965, 0.90, 0.80, 0.68]     # meia-largura
ZT = [0.88, 0.96, 0.97, 0.95, 0.90, 0.86, 0.86, 0.89, 0.88, 0.82, 0.72, 0.64, 0.58]           # linha de cima (capô longo, nariz alto)
ZB = [0.30, 0.22, 0.13, 0.11, 0.11, 0.11, 0.11, 0.11, 0.10, 0.10, 0.11, 0.13, 0.15]           # fundo
# perfil da seção (meia): (y/largura, altura relativa), de baixo/centro até o centro do capô
PERFIL = [(0.0, 0.0), (0.62, 0.0), (0.92, 0.05), (1.0, 0.22), (1.0, 0.48), (0.975, 0.70), (0.89, 0.88), (0.66, 0.975), (0.32, 0.995), (0.0, 0.985)]
NH = 9                      # amostras por trecho do perfil
XEND = (-2.18, 2.18)
EXTRA_F = [0.18, 0.43, 0.68, 0.86, 0.96]     # frações do raio da cúpula que fecham as pontas
RD_F, RD_T = 0.09, 0.045                      # frente arredondada, traseira quase reta (Kammback)


def catmull(P, n):
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for j in range(n):
            t = j / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(2)))
    out.append(P[-1])
    return out


PERF = catmull(PERFIL, NH)


def secao_baixa(x, s=1.0):
    w, zt, zb = interp(CX, W, x if XEND[0] <= x <= XEND[1] else min(max(x, XEND[0]), XEND[1])), interp(CX, ZT, min(max(x, XEND[0]), XEND[1])), interp(CX, ZB, min(max(x, XEND[0]), XEND[1]))
    zc, h = (zt + zb) / 2, (zt - zb)
    meia = [(f * w, zb + t * h) for (f, t) in PERF]
    pts = [(y, z) for (y, z) in meia]                         # lado +y (de baixo/centro até o capô)
    pts += [(-y, z) for (y, z) in reversed(meia[1:-1])]       # lado -y
    if s != 1.0:
        pts = [(y * s, zc + (z - zc) * s) for (y, z) in pts]
    return [(x, y, z) for (y, z) in pts]


stations = []
stations.append((XEND[0] - RD_T, 0.0))
for fr in reversed(EXTRA_F):
    d = fr * RD_T
    stations.append((XEND[0] - d, math.sqrt(max(0.0, 1 - fr ** 2))))
base_x = sorted(set([XEND[0] + (XEND[1] - XEND[0]) * (0.5 - 0.5 * math.cos(math.pi * i / 36)) for i in range(37)]))
for x in base_x:
    stations.append((x, 1.0))
for fr in EXTRA_F:
    d = fr * RD_F
    stations.append((XEND[1] + d, math.sqrt(max(0.0, 1 - fr ** 2))))
stations.append((XEND[1] + RD_F, 0.0))
# as pontas com escala 0 viram um ponto só
bm = bmesh.new()
rings = []
for x, s in stations:
    if s <= 0.0:
        xe = x
        rings.append(None)
        continue
    xx = min(max(x, XEND[0]), XEND[1])
    pts = secao_baixa(xx, s)
    pts = [(x, y, z) for (_, y, z) in pts]
    rings.append([bm.verts.new(p) for p in pts])
NP = len(next(r for r in rings if r))
# pontas: um vértice no centro da primeira/última seção real
def centro(ring):
    return Vector((sum(v.co.x for v in ring) / len(ring), 0, sum(v.co.z for v in ring) / len(ring)))
real = [r for r in rings if r]
tip0 = bm.verts.new((stations[0][0], 0, centro(real[0]).z))
tip1 = bm.verts.new((stations[-1][0], 0, centro(real[-1]).z))
for r in range(len(real) - 1):
    for k in range(NP):
        bm.faces.new([real[r][k], real[r][(k + 1) % NP], real[r + 1][(k + 1) % NP], real[r + 1][k]])
cr = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
vivos = {real[r][k] for r in range(1, len(real) - 1) for k in (6 * NH, NP - 6 * NH, 2 * NH, NP - 2 * NH)}
for e in bm.edges:
    a, b = e.verts
    for r in range(len(real) - 1):
        for k in (6 * NH, NP - 6 * NH):
            if {a, b} == {real[r][k], real[r + 1][k]}:
                e[cr] = 0.75
        for k in (2 * NH, NP - 2 * NH):
            if {a, b} == {real[r][k], real[r + 1][k]}:
                e[cr] = 0.5
for k in range(NP):
    bm.faces.new([real[0][(k + 1) % NP], real[0][k], tip0])
    bm.faces.new([real[-1][k], real[-1][(k + 1) % NP], tip1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
body = novo_objeto("BODY", bm, [M["paint"]])


def casco_interno(ob, nome, fator, niveis=1):
    """Cópia menor com normais invertidas e material preto: só aparece vista de dentro (boca dos paralamas, vidros)."""
    me = ob.data.copy()
    h = bpy.data.objects.new(nome, me)
    colecao().objects.link(h)
    for i in range(len(me.materials)):
        me.materials[i] = M["hull"]
    bmh = bmesh.new()
    bmh.from_mesh(me)
    bmesh.ops.reverse_faces(bmh, faces=bmh.faces)
    c = sum((v.co for v in bmh.verts), Vector()) / len(bmh.verts)
    for v in bmh.verts:
        v.co = c + (v.co - c) * fator
    bmh.to_mesh(me)
    bmh.free()
    for p in me.polygons:
        p.use_smooth = True
    subdividir(h, niveis)
    return h


casco_interno(body, "BODY_inner", 0.985)
subdividir(body, 2)
bpy.context.view_layer.objects.active = body

# ------------------------------------------------------------------ cabine (teto, vidros e colunas)
CAB_X = [-1.65, -1.55, -1.45, -1.35, -1.25, -1.12, -0.85, -0.55, -0.25, 0.0, 0.18, 0.28, 0.45, 0.62]
sx = [-1.65, -1.30, -0.90, -0.45, -0.05, 0.30, 0.62]
WSH = [0.62, 0.82, 0.89, 0.89, 0.87, 0.82, 0.74]     # meia-largura na linha da janela
WR  = [0.42, 0.54, 0.59, 0.60, 0.58, 0.53, 0.45]     # meia-largura no teto
ZR  = [0.94, 1.04, 1.15, 1.20, 1.19, 1.08, 0.90]     # altura do teto (fastback, para-brisa inclinado)


def secao_cabine(x):
    ws, wr, zr = interp(sx, WSH, x), interp(sx, WR, x), interp(sx, ZR, x)
    zbase = 0.66
    L = [(0, zbase), (0.55 * ws, zbase), (0.95 * ws, 0.72), (ws, 0.82), (ws - 0.02, 0.91),
         (wr + 0.12, zr - 0.13), (wr + 0.045, zr - 0.045), (wr * 0.55, zr - 0.008), (0, zr)]
    return L + [(-y, z) for (y, z) in reversed(L[1:-1])]


bm = bmesh.new()
rings = []
for x in CAB_X:
    rings.append([bm.verts.new((x, y, z)) for (y, z) in secao_cabine(x)])
n = len(rings[0])
for r in range(len(rings) - 1):
    xm = (CAB_X[r] + CAB_X[r + 1]) / 2
    for k in range(n):
        f = bm.faces.new([rings[r][k], rings[r][(k + 1) % n], rings[r + 1][(k + 1) % n], rings[r + 1][k]])
        ke = k if k < 8 else (15 - k)          # índice da aresta no lado esquerdo (espelhado)
        glass = False
        if -1.12 <= xm <= 0.18 and ke in (3, 4, 5):
            glass = True                       # vidros laterais
        if (0.28 <= xm <= 0.62 or -1.65 <= xm <= -1.25) and ke in (5, 6, 7):
            glass = True                       # para-brisa e vidro traseiro (colunas ficam pintadas)
        f.material_index = 1 if glass else 0
for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
    c = bm.verts.new((sum(v.co.x for v in ring) / n + sgn * 0.01, 0, sum(v.co.z for v in ring) / n))
    for k in range(n):
        bm.faces.new([ring[k], ring[(k + 1) % n], c] if sgn < 0 else [ring[(k + 1) % n], ring[k], c])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
cab = novo_objeto("CABIN", bm, [M["paint"], M["glass"]])
casco_interno(cab, "CABIN_inner", 0.975)
subdividir(cab, 2)

result = {"body_faces": len(body.data.polygons), "cabin_faces": len(cab.data.polygons), "dim": [round(v, 3) for v in body.dimensions]}
