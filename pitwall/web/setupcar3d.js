/* Pitwall · carro 3D do editor de setup (Three.js).
   O carro é montado por código (corpo "esculpido" por seções, rodas, asa, splitter, suspensão completa) com o perfil de cada marca.
   Cada ajuste do setup mexe na peça de verdade: altura, cambagem, convergência, molas, amortecedores, barras, asa, pressão, freios... */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";

// ------------------------------------------------------------------ utilidades
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// interpolação suave (cosseno) numa tabela [[x, y], ...] ordenada por x
function tab(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; const k = (x - x0) / (x1 - x0); return lerp(y0, y1, (1 - Math.cos(k * Math.PI)) / 2); }
  }
  return t[t.length - 1][1];
}
// duas seções superelípticas (z = lateral, y = altura) -> malha lofada ao longo de x
function loft(st, seg = 36, capEnds = true) {
  const pos = [], idx = [];
  for (const s of st) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2, c = Math.cos(th), si = Math.sin(th);
      const z = s.hw * sgnpow(c, 2 / s.n), ymid = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
      const y = ymid + hh * sgnpow(si, 2 / s.m);
      pos.push(s.x, y, z);
    }
  }
  const R = st.length;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, c, b, b, c, d);
  }
  if (capEnds) {
    for (const [ring, flip] of [[0, true], [R - 1, false]]) {
      const s = st[ring], ci = pos.length / 3; pos.push(s.x, (s.y0 + s.y1) / 2, 0);
      for (let j = 0; j < seg; j++) { const a = ring * seg + j, b = ring * seg + (j + 1) % seg; idx.push(...(flip ? [ci, b, a] : [ci, a, b])); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const mat = (o) => new THREE.MeshStandardMaterial(o);
function between(a, b, r, m, seg = 10) {                // cilindro entre dois pontos
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, seg), m);
  mesh.position.copy(a).addScaledVector(dir, 0.5); mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true; return mesh;
}
function setBetween(mesh, a, b, r) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5); mesh.scale.set(r ? r / (mesh.userData.r || r) : mesh.scale.x, len, r ? r / (mesh.userData.r || r) : mesh.scale.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

// ------------------------------------------------------------------ perfis por marca (medidas em metros; +x = frente)
const PROFILES = {
  porsche:     { paint: "#e9edf2", layout: "rear",  noseTop: 0.50, hoodH: 0.70, deckH: 0.90, roofH: 1.17, cab: [-0.95, 0.55], noseW: 0.62, haunch: 0.80, wing: "swan",  lamp: "round", scoops: "rear" },
  ferrari:     { paint: "#c8102e", layout: "mid",   noseTop: 0.40, hoodH: 0.62, deckH: 0.84, roofH: 1.12, cab: [-0.60, 0.75], noseW: 0.50, haunch: 0.80, wing: "std",   lamp: "slit",  scoops: "side" },
  lamborghini: { paint: "#8fd400", layout: "mid",   noseTop: 0.40, hoodH: 0.64, deckH: 0.84, roofH: 1.11, cab: [-0.60, 0.80], noseW: 0.66, haunch: 0.82, wing: "std",   lamp: "y",     scoops: "side" },
  mclaren:     { paint: "#ff7a00", layout: "mid",   noseTop: 0.42, hoodH: 0.62, deckH: 0.84, roofH: 1.13, cab: [-0.60, 0.80], noseW: 0.54, haunch: 0.80, wing: "std",   lamp: "slit",  scoops: "side" },
  audi:        { paint: "#c4161c", layout: "mid",   noseTop: 0.44, hoodH: 0.64, deckH: 0.86, roofH: 1.15, cab: [-0.55, 0.78], noseW: 0.64, haunch: 0.80, wing: "std",   lamp: "bar",   scoops: "side" },
  honda:       { paint: "#e11b22", layout: "mid",   noseTop: 0.42, hoodH: 0.64, deckH: 0.86, roofH: 1.14, cab: [-0.55, 0.78], noseW: 0.56, haunch: 0.80, wing: "std",   lamp: "slit",  scoops: "side" },
  bmw:         { paint: "#1c69d4", layout: "front", noseTop: 0.64, hoodH: 0.80, deckH: 0.82, roofH: 1.18, cab: [-1.15, 0.10], noseW: 0.66, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
  mercedes:    { paint: "#aab4c0", layout: "front", noseTop: 0.62, hoodH: 0.82, deckH: 0.82, roofH: 1.17, cab: [-1.15, 0.12], noseW: 0.64, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
  aston:       { paint: "#00a86b", layout: "front", noseTop: 0.60, hoodH: 0.80, deckH: 0.82, roofH: 1.16, cab: [-1.15, 0.12], noseW: 0.62, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
  ford:        { paint: "#0f5cc0", layout: "front", noseTop: 0.66, hoodH: 0.82, deckH: 0.84, roofH: 1.19, cab: [-1.15, 0.12], noseW: 0.70, haunch: 0.84, wing: "std",   lamp: "bar",   scoops: "hood" },
  corvette:    { paint: "#f2c600", layout: "front", noseTop: 0.54, hoodH: 0.72, deckH: 0.84, roofH: 1.12, cab: [-0.95, 0.30], noseW: 0.62, haunch: 0.84, wing: "std",   lamp: "slit",  scoops: "hood" },
  nissan:      { paint: "#c8102e", layout: "front", noseTop: 0.62, hoodH: 0.80, deckH: 0.82, roofH: 1.16, cab: [-1.10, 0.14], noseW: 0.66, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
  lexus:       { paint: "#8e99a8", layout: "front", noseTop: 0.62, hoodH: 0.80, deckH: 0.82, roofH: 1.17, cab: [-1.15, 0.12], noseW: 0.66, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
  bentley:     { paint: "#1f7a4d", layout: "front", noseTop: 0.66, hoodH: 0.84, deckH: 0.86, roofH: 1.22, cab: [-1.15, 0.12], noseW: 0.70, haunch: 0.86, wing: "std",   lamp: "round", scoops: "hood" },
  generic:     { paint: "#2ee59d", layout: "front", noseTop: 0.60, hoodH: 0.80, deckH: 0.82, roofH: 1.16, cab: [-1.10, 0.12], noseW: 0.64, haunch: 0.82, wing: "std",   lamp: "bar",   scoops: "hood" },
};

// medidas comuns
const WB = { front: 1.40, rear: -1.38 }, TRACK = { front: 1.64, rear: 1.60 }, R = 0.345, TW = { front: 0.31, rear: 0.335 };

// ------------------------------------------------------------------ montagem do carro
function buildCar(key, scene) {
  const P = PROFILES[key] || PROFILES.generic;
  const paint = new THREE.MeshPhysicalMaterial({ color: P.paint, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const carbon = mat({ color: "#0e1116", metalness: 0.4, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#05080c", metalness: 0.2, roughness: 0.04, transmission: 0, clearcoat: 1, opacity: 0.94, transparent: true });
  const dark = mat({ color: "#07090c", roughness: 0.8 });
  const steel = mat({ color: "#9aa4b2", metalness: 0.85, roughness: 0.3 });
  const metal = mat({ color: "#5d6775", metalness: 0.8, roughness: 0.4 });
  const rubber = mat({ color: "#121316", roughness: 0.92 });
  const root = new THREE.Group();                 // tudo do carro
  const body = new THREE.Group();                 // parte suspensa (mexe com altura/rolagem)
  root.add(body);
  const bodyMats = [paint, carbon, glass, dark];  // vira "raio-x" no modo suspensão

  // --- corpo
  const HW = [[-2.30, 0.50], [-2.15, 0.72], [-1.9, 0.90], [-1.4, P.haunch + 0.17], [-0.85, P.haunch + 0.08], [-0.3, P.haunch - 0.02], [0.3, P.haunch - 0.02], [0.9, P.haunch + 0.12], [1.4, P.haunch + 0.12], [1.85, P.noseW + 0.2], [2.15, P.noseW + 0.04], [2.32, P.noseW * 0.55]];
  const TOP = [[-2.30, 0.58], [-2.05, P.deckH - 0.06], [-1.6, P.deckH], [-0.9, P.deckH - 0.02], [-0.3, 0.80], [0.5, 0.80], [1.05, P.hoodH + 0.03], [1.7, P.hoodH - 0.04], [2.1, P.noseTop], [2.32, P.noseTop - 0.14]];
  const BOT = [[-2.30, 0.32], [-2.0, 0.17], [-1.7, 0.12], [1.8, 0.12], [2.1, 0.15], [2.32, 0.2]];
  const st = [];
  for (let i = 0; i <= 150; i++) {
    const x = lerp(-2.32, 2.32, i / 150);
    st.push({ x, hw: tab(HW, x), y0: tab(BOT, x), y1: tab(TOP, x), n: 4.6, m: 3.0 });
  }
  const carve = (g) => {                       // cava o arco de cada roda no flanco do corpo (a roda aparece, o paralama fica por cima)
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (Math.abs(z) < 0.5) continue;
      for (const ax of [WB.front, WB.rear]) {
        const d = Math.hypot(x - ax, y - R), r0 = R + 0.075, r1 = R + 0.03;
        if (d < r0) { const t = clamp((r0 - d) / (r0 - r1), 0, 1), k = t * t * (3 - 2 * t); pa.setZ(i, Math.sign(z) * lerp(Math.abs(z), 0.58, k)); }
      }
    }
    g.computeVertexNormals(); return g;
  };
  const shell = new THREE.Mesh(carve(loft(st, 72)), paint); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const lowerStrip = new THREE.Mesh(carve(loft(st.map((s) => ({ ...s, hw: s.hw + 0.004, y1: s.y0 + 0.07, n: 4.6, m: 3.0 })), 72)), carbon); body.add(lowerStrip);   // saia preta

  // --- cabine (vidros) e teto
  const [cx0, cx1] = P.cab, roof = [[cx0, 0.82], [cx0 + 0.25, 1.0], [cx0 + 0.6, P.roofH - 0.03], [(cx0 + cx1) / 2, P.roofH], [cx1 - 0.7, P.roofH - 0.02], [cx1 - 0.25, 1.0], [cx1, 0.83]];
  const cab = [];
  for (let i = 0; i <= 36; i++) {
    const x = lerp(cx0, cx1, i / 36);
    cab.push({ x, hw: tab([[cx0, 0.62], [cx0 + 0.5, 0.78], [(cx0 + cx1) / 2, 0.80], [cx1 - 0.5, 0.78], [cx1, 0.62]], x), y0: 0.76, y1: tab(roof, x), n: 3.4, m: 2.2 });
  }
  const cabin = new THREE.Mesh(loft(cab, 32), glass); cabin.castShadow = true; body.add(cabin);
  for (const s2 of [-1, 1]) {                    // colunas A e C em cor de carro
    const a = between(new THREE.Vector3(cx1 - 0.05, 0.82, s2 * 0.66), new THREE.Vector3(cx1 - 0.7, P.roofH - 0.03, s2 * 0.62), 0.028, paint);
    const c = between(new THREE.Vector3(cx0 + 0.05, 0.84, s2 * 0.62), new THREE.Vector3(cx0 + 0.55, P.roofH - 0.04, s2 * 0.62), 0.03, paint);
    body.add(a, c);
  }
  const roofSkin = new THREE.Mesh(loft(cab.filter((s) => s.x > cx0 + 0.45 && s.x < cx1 - 0.65).map((s) => ({ ...s, hw: s.hw * 0.86, y0: s.y1 - 0.05, y1: s.y1 + 0.004, n: 2.6, m: 2.4 })), 32), paint); body.add(roofSkin);

  // --- paralamas largos com o arco da roda (a roda aparece pelo furo)
  const flares = [];
  for (const ax of [WB.front, WB.rear]) for (const sd of [-1, 1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.4, 36, 1, true), dark); liner.material.side = THREE.DoubleSide;
    liner.rotation.x = Math.PI / 2; liner.position.set(ax, R, sd * 0.78); body.add(liner);
  }

  // --- splitter, difusor, asa
  const splitter = new THREE.Group(); splitter.position.set(2.18, 0.1, 0);
  const sp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 1.86), carbon); sp.position.x = 0.12; sp.castShadow = true; splitter.add(sp);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 1.86), carbon); lip.position.set(0.32, 0.02, 0); splitter.add(lip);
  body.add(splitter);
  const diff = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.1), carbon); diff.position.set(-2.0, 0.22, 0); diff.rotation.z = 0.2; body.add(diff);
  for (const z of [-0.36, 0, 0.36]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.012), carbon); f.position.set(-2.0, 0.27, z); f.rotation.z = 0.2; body.add(f); }

  const wing = new THREE.Group(); const wingX = -2.18, wingY = P.wing === "swan" ? 1.2 : 1.08; wing.position.set(wingX, wingY, 0); body.add(wing);
  const foil = new THREE.Shape(); foil.moveTo(0.18, 0); foil.bezierCurveTo(0.12, 0.05, -0.1, 0.045, -0.2, 0.01); foil.lineTo(-0.2, -0.004); foil.bezierCurveTo(-0.08, 0.012, 0.1, 0.0, 0.18, 0);
  const foilMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(foil, { depth: 1.86, bevelEnabled: false }), carbon); foilMesh.position.z = -0.93; foilMesh.castShadow = true;
  const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(foil, { depth: 1.86, bevelEnabled: false }), carbon); flap.scale.set(0.7, 1, 1); flap.position.set(-0.05, 0.1, -0.93);
  const wingPivot = new THREE.Group(); wingPivot.add(foilMesh, flap); wing.add(wingPivot);
  for (const s of [-1, 1]) {
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.012), paint); ep.position.set(0, 0.06, s * 0.93); wing.add(ep);
    const post = P.wing === "swan" ? between(new THREE.Vector3(0.1, -0.55, s * 0.32), new THREE.Vector3(-0.05, 0.02, s * 0.32), 0.022, carbon) : between(new THREE.Vector3(0.1, -0.35, s * 0.4), new THREE.Vector3(0, 0.0, s * 0.4), 0.018, carbon);
    wing.add(post);
  }

  // --- luzes, espelhos, saídas de ar
  const lampMat = new THREE.MeshStandardMaterial({ color: "#dff0ff", emissive: "#bfe0ff", emissiveIntensity: 1.4 });
  for (const s of [-1, 1]) {
    const nz = P.noseW;
    const l = new THREE.Mesh(P.lamp === "round" ? new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24) : new THREE.BoxGeometry(0.05, P.lamp === "slit" ? 0.035 : 0.06, P.lamp === "y" ? 0.28 : 0.34), lampMat);
    if (P.lamp === "round") l.rotation.z = Math.PI / 2;
    const lx = 1.98; l.position.set(lx, tab(TOP, lx) - 0.07, s * tab(HW, lx) * 0.74); l.rotation.y = -s * 0.5; body.add(l);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.12), paint); mir.position.set(cx1 - 0.12, 0.9, s * 0.78); body.add(mir);
    const tailMat = new THREE.MeshStandardMaterial({ color: "#ff2a1f", emissive: "#ff2a1f", emissiveIntensity: 1.2 });
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.86), new THREE.MeshStandardMaterial({ color: "#ff2a1f", emissive: "#ff2a1f", emissiveIntensity: 1.5 }));
  tail.position.set(-2.28, 0.52, 0); body.add(tail);
  const ducts = [];
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.16), dark); d.position.set(2.24, 0.28, s * 0.52); body.add(d); ducts.push(d);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, Math.min(0.9, P.noseW * 1.3)), dark); grille.position.set(2.28, 0.3, 0); body.add(grille);
  if (P.scoops === "hood") for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.1), carbon); v.position.set(1.45, P.hoodH + 0.015, s * 0.28); body.add(v); }
  if (P.scoops === "side") for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), dark); v.position.set(cx0 - 0.15, 0.55, s * (P.haunch - 0.04)); body.add(v); }
  if (P.scoops === "rear") { const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.5), carbon); v.position.set(-1.5, P.deckH + 0.012, 0); body.add(v); }
  // volante e painel (cockpit)
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 10, 28), carbon); wheelRim.position.set(0.08, 0.86, -0.32); wheelRim.rotation.y = Math.PI / 2 - 0.35; body.add(wheelRim);
  const dashLed = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: "#2ee59d", emissive: "#2ee59d", emissiveIntensity: 1.5 })); dashLed.position.set(0.12, 0.93, -0.32); body.add(dashLed);

  // --- rodas
  const corners = [];                                           // 0 DE, 1 DD, 2 TE, 3 TD
  const makeWheel = (front, side) => {
    const g = new THREE.Group(), w = front ? TW.front : TW.rear;
    const prof = []; const rr = R, rimR = 0.235, hw = w / 2;
    for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI; prof.push(new THREE.Vector2(lerp(rimR + 0.01, rr, Math.sin(a) ** 0.55) + (i === 0 || i === 28 ? 0 : 0), lerp(-hw, hw, i / 28))); }
    const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), rubber); tire.rotation.x = Math.PI / 2; tire.castShadow = true; g.add(tire);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.035, 0.006, 6, 48), new THREE.MeshStandardMaterial({ color: "#2ee59d", emissive: "#2ee59d", emissiveIntensity: 0.7 })); ring.position.z = side * (hw - 0.002); g.add(ring);
    const rim = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, w * 0.9, 40, 1, true), metal); barrel.rotation.x = Math.PI / 2; barrel.material.side = THREE.DoubleSide; rim.add(barrel);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.236, 0.236, 0.02, 40), mat({ color: "#1a1d23", metalness: 0.8, roughness: 0.3 })); face.rotation.x = Math.PI / 2; face.position.z = side * (hw - 0.03); rim.add(face);
    for (let i = 0; i < 10; i++) { const sp2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.034, 0.018), steel); sp2.position.set(Math.cos((i / 10) * Math.PI * 2) * 0.11, Math.sin((i / 10) * Math.PI * 2) * 0.11, side * (hw - 0.025)); sp2.rotation.z = (i / 10) * Math.PI * 2; rim.add(sp2); }
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), mat({ color: "#f0b429", metalness: 0.7, roughness: 0.3 })); nut.rotation.x = Math.PI / 2; nut.position.z = side * (hw - 0.02); rim.add(nut);
    g.add(rim);
    // freio (disco + pinça) dentro da roda
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.032, 40), mat({ color: "#6a727e", metalness: 0.85, roughness: 0.35, emissive: "#ff5a1a", emissiveIntensity: 0 })); disc.rotation.x = Math.PI / 2; disc.position.z = -side * 0.07; g.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.07), mat({ color: front ? "#e8c13a" : "#c92c2c", roughness: 0.4 })); cal.position.set(0, 0.15, -side * 0.07); g.add(cal);
    return { g, tire, ring, disc, cal, barrel };
  };
  const fz = TRACK.front / 2, rz = TRACK.rear / 2;
  const pos = [[WB.front, -fz], [WB.front, fz], [WB.rear, -rz], [WB.rear, rz]];
  for (let i = 0; i < 4; i++) {
    const [ax, z] = pos[i], side = Math.sign(z), front = i < 2;
    const piv = new THREE.Group(); piv.position.set(ax, R, z);              // pivô: aqui entram cambagem e convergência
    const wh = makeWheel(front, side); piv.add(wh.g); root.add(piv);
    corners.push({ piv, ax, z, side, front, ...wh });
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.02, 1.5), carbon); floor.position.set(0, 0.12, 0); body.add(floor);

  return { root, body, P, paint, bodyMats, flares, splitter, wing: wingPivot, wingGroup: wing, corners, ducts, shell, cabin, roofSkin, carbon, dark, metal, steel, lowerStrip, wheelRim, dashLed, hw: HW, top: TOP };
}

// ------------------------------------------------------------------ suspensão (visível no modo raio-x)
function buildSuspension(car) {
  const grp = new THREE.Group(); const items = { corners: [], arb: [] };
  const armMat = mat({ color: "#c9d1db", metalness: 0.7, roughness: 0.35 }), rodMat = mat({ color: "#e8eef6", metalness: 0.85, roughness: 0.25 });
  const damperMat = new THREE.MeshStandardMaterial({ color: "#3b9cff", metalness: 0.6, roughness: 0.35 });
  const springMat = new THREE.MeshStandardMaterial({ color: "#ff9d2e", metalness: 0.5, roughness: 0.4 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  car.corners.forEach((c, i) => {
    const s = c.side, ax = c.ax, hubZ = s * (Math.abs(c.z) - 0.18), chZ = s * 0.28;
    const g = new THREE.Group(); const it = { g };
    // braços inferior (A) e superior (A)
    const low = [between(V(ax - 0.28, 0.2, chZ), V(ax, 0.2, hubZ), 0.014, armMat), between(V(ax + 0.28, 0.2, chZ), V(ax, 0.2, hubZ), 0.014, armMat)];
    const upp = [between(V(ax - 0.2, 0.52, chZ), V(ax, 0.5, hubZ), 0.012, armMat), between(V(ax + 0.2, 0.52, chZ), V(ax, 0.5, hubZ), 0.012, armMat)];
    const hub = between(V(ax, 0.2, hubZ), V(ax, 0.5, hubZ), 0.022, rodMat);
    const tie = between(V(ax - 0.22, 0.36, chZ), V(ax - 0.06, 0.36, hubZ), 0.008, rodMat);
    // coilover: amortecedor + mola helicoidal
    const dTop = V(ax, 0.66, s * 0.2), dBot = V(ax, 0.26, s * 0.4);
    const damper = between(dBot, dTop, 0.028, damperMat); it.damper = damper;
    const rod = between(dBot.clone().lerp(dTop, 0.45), dTop, 0.011, rodMat);
    it.dTop = dTop; it.dBot = dBot; it.springMat = springMat.clone(); it.damperMat = damper.material = damperMat.clone();
    it.spring = null; it.coils = -1; it.wire = -1;
    g.add(...low, ...upp, hub, tie, damper, rod);
    grp.add(g); items.corners.push(it);
  });
  // barras estabilizadoras (frente e trás)
  for (const front of [true, false]) {
    const ax = front ? WB.front - 0.4 : WB.rear + 0.4, hz = (front ? TRACK.front : TRACK.rear) / 2 - 0.3;
    const bar = between(V(ax, 0.27, -hz + 0.05), V(ax, 0.27, hz - 0.05), 0.016, mat({ color: "#2ee59d", metalness: 0.6, roughness: 0.35 }));
    const l1 = between(V(ax, 0.27, -hz + 0.05), V(ax + 0.34, 0.2, -hz - 0.1), 0.012, rodMat), l2 = between(V(ax, 0.27, hz - 0.05), V(ax + 0.34, 0.2, hz + 0.1), 0.012, rodMat);
    bar.userData.r = 0.016; grp.add(bar, l1, l2); items.arb.push({ bar, front });
  }
  // diferencial e tanque
  const dif = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 20), mat({ color: "#8791a0", metalness: 0.8, roughness: 0.4 })); dif.rotation.x = Math.PI / 2; dif.position.set(WB.rear, 0.3, 0); grp.add(dif); items.diff = dif;
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.9), new THREE.MeshStandardMaterial({ color: "#f0b429", metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.55 })); tank.position.set(-0.78, 0.4, 0); grp.add(tank); items.tank = tank;
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.7), mat({ color: "#39414d", metalness: 0.6, roughness: 0.5 })); engine.position.set(car.P.layout === "front" ? 1.05 : -1.3, 0.38, 0); grp.add(engine);
  items.grp = grp; return items;
}
function helix(a, b, coils, radius, wire, mat0) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length(), n = Math.max(2, coils) * 14, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, ang = t * coils * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(ang) * radius, t * len, Math.sin(ang) * radius)); }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, wire, 6, false), mat0);
  m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); m.castShadow = true; return m;
}

// ------------------------------------------------------------------ palco (cena, câmera, pontos, ao vivo)
export async function createStage(host, opts) {
  const { brand, items, spots, onHover, onSelect } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement); renderer.domElement.className = "sc3d-canvas";
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60); camera.position.set(-5.4, 2.0, 4.7);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.5, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.5; controls.maxDistance = 11; controls.maxPolarAngle = Math.PI * 0.495; controls.update();
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 }); sun.shadow.bias = -0.0004; scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9ec5ff, 0x10151c, 0.35));
  const rim = new THREE.DirectionalLight(0x2ee59d, 0.25); rim.position.set(4, 2, -4); scene.add(rim);
  // chão: disco escuro com anel de brilho
  const floorMat = new THREE.MeshStandardMaterial({ color: "#06090d", roughness: 0.75, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const glow = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.74, 120), new THREE.MeshBasicMaterial({ color: "#2ee59d", transparent: true, opacity: 0.18 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.003; scene.add(glow);

  const car = buildCar(brand, scene); scene.add(car.root);
  const sus = buildSuspension(car); sus.grp.visible = false; car.root.add(sus.grp);
  // peças da suspensão ficam presas ao corpo (sobem e descem com ele)? Só os pontos de fixação: mantemos no mundo (chassi) e movemos o corpo.

  // ----- valores ao vivo
  const byPath = Object.fromEntries(items.map((x) => [x.path, x]));
  const edits = {};
  const cur = (p, d = 0) => { const it = byPath[p]; return it ? Math.max(0, it.raw + (edits[p] || 0)) : d; };
  const del = (p) => (edits[p] || 0);
  const info = opts.extras || {};
  let xray = false, selected = null, t0 = performance.now();

  function apply() {
    // altura: cada canto sobe/desce; o corpo inclina (pitch/rolagem) em proporção
    const mm = 0.0055;
    const rh = [0, 1, 2, 3].map((i) => del(`advancedSetup.aeroBalance.rideHeight[${i}]`) * mm);
    const front = (rh[0] + rh[1]) / 2, rear = (rh[2] + rh[3]) / 2, left = (rh[0] + rh[2]) / 2, right = (rh[1] + rh[3]) / 2;
    const fuel = (cur("basicSetup.strategy.fuel", 60) - 60) * 0.00012;
    car.body.position.y = (front + rear) / 2 - fuel;
    car.body.rotation.z = Math.atan2(front - rear, WB.front - WB.rear);          // + = frente sobe
    car.body.rotation.x = Math.atan2(right - left, (TRACK.front + TRACK.rear) / 2) * -1;
    // asa e splitter
    car.wing.rotation.z = -(4 + cur("advancedSetup.aeroBalance.rearWing", 0) * 1.5) * Math.PI / 180;
    car.splitter.rotation.z = (-cur("advancedSetup.aeroBalance.splitter", 0) * 1.1 + 0) * Math.PI / 180;
    car.splitter.position.y = 0.1 - cur("advancedSetup.aeroBalance.splitter", 0) * 0.004;
    const duct = [cur("advancedSetup.aeroBalance.brakeDuct[0]", 3), cur("advancedSetup.aeroBalance.brakeDuct[1]", 3)];
    car.ducts.forEach((d) => d.scale.set(1, 0.6 + duct[0] * 0.14, 0.6 + duct[0] * 0.14));
    // rodas
    const sc = info.static_camber || [-3.6, -3.6, -3.2, -3.2];
    const bias = clamp(0.5 + (cur("advancedSetup.mechanicalBalance.brakeBias", 35) - 35) * 0.012, 0.15, 0.85), torque = cur("advancedSetup.mechanicalBalance.brakeTorque", 20);
    car.corners.forEach((c, i) => {
      const camClicks = del(`basicSetup.alignment.camber[${i}]`), camDeg = (sc[i] ?? -3.4) + camClicks * 0.1;
      c.piv.rotation.x = (camDeg * 2.2 * Math.PI / 180) * c.side;                    // x2.2: exagero para enxergar
      const toeD = del(`basicSetup.alignment.toe[${i}]`);
      c.piv.rotation.y = (toeD * 0.06 * Math.PI / 180) * (c.side > 0 ? 1 : -1) * 2.5;
      const p = cur(`basicSetup.tyres.tyrePressure[${i}]`, 56), psi = 20.3 + p * 0.1, k = 1 + (psi - 26.5) * 0.006;
      c.tire.scale.set(k, 1, k);                                                       // lateral do pneu: mais pressão = mais "cheio"
      const col = new THREE.Color().setHSL(lerp(0.58, 0.0, clamp((psi - 25) / 3, 0, 1)), 0.9, 0.5); c.ring.material.color.copy(col); c.ring.material.emissive.copy(col);
      const share = c.front ? bias : 1 - bias; c.disc.material.emissiveIntensity = clamp(share * (0.5 + torque / 40) - 0.2, 0, 1.2);
      // suspensão deste canto
      const it = sus.corners[i];
      const wr = cur(`advancedSetup.mechanicalBalance.wheelRate[${i}]`, 0), coils = Math.round(clamp(9 - wr * 0.28, 4, 10)), wire = 0.0075 + wr * 0.00055;
      if (it.coils !== coils || it.wire !== wire) {
        if (it.spring) { it.g.remove(it.spring); it.spring.geometry.dispose(); }
        it.spring = helix(it.dBot, it.dTop, coils, 0.052, wire, it.springMat); it.g.add(it.spring); it.coils = coils; it.wire = wire;
      }
      it.springMat.color.setHSL(lerp(0.09, 0.0, clamp(wr / 22, 0, 1)), 0.95, 0.5);
      const dmp = (cur(`advancedSetup.dampers.bumpSlow[${i}]`, 8) + cur(`advancedSetup.dampers.bumpFast[${i}]`, 8) + cur(`advancedSetup.dampers.reboundSlow[${i}]`, 8) + cur(`advancedSetup.dampers.reboundFast[${i}]`, 8)) / 4;
      it.damperMat.color.setHSL(lerp(0.58, 0.0, clamp(dmp / 16, 0, 1)), 0.85, 0.5);
    });
    sus.arb.forEach((a) => { const v = cur(a.front ? "advancedSetup.mechanicalBalance.aRBFront" : "advancedSetup.mechanicalBalance.aRBRear", 0); const k = 0.8 + v * 0.07; a.bar.scale.x = k; a.bar.scale.z = k; });
    const pre = cur("advancedSetup.drivetrain.preload", 0); sus.diff.scale.set(1 + pre * 0.012, 1, 1 + pre * 0.012);
    sus.tank.scale.y = 0.2 + clamp(cur("basicSetup.strategy.fuel", 60) / 120, 0, 1) * 0.9; sus.tank.position.y = 0.23 + sus.tank.scale.y * 0.17;
    car.dashLed.material.emissiveIntensity = 1 + cur("basicSetup.electronics.tC1", 0) * 0.12;
  }

  function setXray(on) {
    xray = on; sus.grp.visible = true;
    for (const m of [car.paint, car.carbon, car.dark, ...(car.bodyMats || [])]) { m.transparent = true; m.depthWrite = !on; m.opacity = on ? 0.10 : (m === car.paint ? 1 : 1); }
    car.cabin.material.opacity = on ? 0.06 : 0.94;
    car.corners.forEach((c) => { c.tire.material.transparent = true; c.tire.material.opacity = on ? 0.4 : 1; c.tire.material.depthWrite = !on; });
    sus.grp.visible = on;
  }
  setXray(false);

  // ----- pontos clicáveis (3D -> tela)
  const spotPos = { aero_f: [2.3, 0.28, 0], aero_r: [-2.2, 1.22, 0], w0: [WB.front, 0.78, -fzTop()], w1: [WB.front, 0.78, fzTop()], w2: [WB.rear, 0.78, -rzTop()], w3: [WB.rear, 0.78, rzTop()],
    axle_f: [WB.front - 0.55, 0.42, 0], axle_r: [WB.rear + 0.5, 0.42, 0], cockpit: [0.1, 1.0, 0], fuel: [-0.78, 0.55, 0] };
  function fzTop() { return TRACK.front / 2 + 0.1; } function rzTop() { return TRACK.rear / 2 + 0.1; }
  const layer = document.createElement("div"); layer.className = "sc3d-pts"; host.appendChild(layer);
  const els = {};
  for (const k of Object.keys(spotPos)) {
    const b = document.createElement("button"); b.type = "button"; b.className = "sc3d-pt"; b.dataset.spot = k; b.setAttribute("aria-label", spots[k] || k);
    b.innerHTML = `<i class="r"></i><i class="d"></i><span class="bd"></span><span class="lb">${spots[k] || k}</span>`;
    b.onmouseenter = () => onHover && onHover(k, b); b.onmouseleave = () => onHover && onHover(null, b); b.onfocus = b.onmouseenter; b.onblur = b.onmouseleave;
    b.onclick = () => onSelect && onSelect(k);
    layer.appendChild(b); els[k] = b;
  }
  const v3 = new THREE.Vector3();
  function project() {
    const w = host.clientWidth, h = host.clientHeight;
    for (const [k, p] of Object.entries(spotPos)) {
      v3.set(...p); car.root.localToWorld(v3);
      if (k.startsWith("aero") || true) { /* pontos seguem o corpo apenas no eixo vertical leve */ }
      v3.project(camera);
      const hid = v3.z > 1;
      els[k].style.display = hid ? "none" : "";
      els[k].style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // ----- câmera
  const PRESETS = {
    car: { pos: [-5.4, 2.0, 4.7], tgt: [0, 0.5, 0] }, front: { pos: [6.2, 1.5, 0.01], tgt: [0, 0.5, 0] }, rear: { pos: [-6.2, 1.6, 0.01], tgt: [0, 0.6, 0] },
    side: { pos: [0, 1.1, 6.6], tgt: [0, 0.5, 0] }, top: { pos: [0.01, 8.6, 0.01], tgt: [0, 0.3, 0] },
    aero_f: { pos: [4.7, 1.0, 2.6], tgt: [1.8, 0.35, 0] }, aero_r: { pos: [-4.4, 1.8, 2.6], tgt: [-1.9, 0.9, 0] }, w0: { pos: [3.1, 2.1, -2.7], tgt: [1.4, 0.35, -0.45] }, w1: { pos: [3.1, 2.1, 2.7], tgt: [1.4, 0.35, 0.45] },
    w2: { pos: [-3.1, 2.1, -2.7], tgt: [-1.4, 0.35, -0.45] }, w3: { pos: [-3.1, 2.1, 2.7], tgt: [-1.4, 0.35, 0.45] }, axle_f: { pos: [4.6, 2.3, 2.2], tgt: [1.2, 0.3, 0] }, axle_r: { pos: [-4.6, 2.3, 2.2], tgt: [-1.2, 0.3, 0] },
    cockpit: { pos: [-1.4, 2.3, 3.0], tgt: [0, 0.8, 0] }, fuel: { pos: [-3.4, 2.4, 3.0], tgt: [-0.8, 0.4, 0] },
  };
  let tween = null;
  function view(name) {
    const p = PRESETS[name] || PRESETS.car; tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...p.pos), t1: new THREE.Vector3(...p.tgt) };
  }

  // ----- laço
  function resize() { const w = host.clientWidth || 600, h = host.clientHeight || 400; renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px"; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  let raf = 0, alive = true;
  function frame() {
    if (!alive) return; raf = requestAnimationFrame(frame);
    if (tween) { tween.t = Math.min(1, tween.t + 0.045); const e = 1 - Math.pow(1 - tween.t, 3); camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (tween.t >= 1) tween = null; }
    controls.update(); renderer.render(scene, camera); project();
  }
  apply(); frame();
  return {
    setEdits(e) { for (const k of Object.keys(edits)) delete edits[k]; Object.assign(edits, e); apply(); },
    setXray, view, els, destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); host.innerHTML = ""; },
    get xray() { return xray; }, renderer, scene, camera, car, sus,
  };
}
export const brandProfiles = PROFILES;
