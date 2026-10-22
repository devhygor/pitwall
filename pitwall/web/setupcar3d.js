/* Pitwall · carro 3D do editor de setup (Three.js).
   O carro é montado por código (corpo "esculpido" por seções, rodas, asa, splitter, suspensão completa) com o perfil de cada marca.
   Cada ajuste do setup mexe na peça de verdade: altura, cambagem, convergência, molas, amortecedores, barras, asa, pressão, freios... */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { Reflector } from "three/addons/Reflector.js";

// ------------------------------------------------------------------ utilidades
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// interpolação cúbica monótona (PCHIP) numa tabela [[x, y], ...]: curvas "justas", sem as ondulações da interpolação por cosseno
const _pch = new WeakMap();
function tab(t, x) {
  let sl = _pch.get(t);
  if (!sl) {
    const n = t.length, d = [], m = new Array(n).fill(0);
    for (let k = 0; k < n - 1; k++) d.push((t[k + 1][1] - t[k][1]) / (t[k + 1][0] - t[k][0]));
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (2 * d[k - 1] * d[k]) / (d[k - 1] + d[k]);
    m[0] = d[0]; m[n - 1] = d[n - 2]; sl = m; _pch.set(t, sl);
  }
  if (x <= t[0][0]) return t[0][1];
  const n = t.length; if (x >= t[n - 1][0]) return t[n - 1][1];
  let k = 0; while (x > t[k + 1][0]) k++;
  const [x0, y0] = t[k], [x1, y1] = t[k + 1], h = x1 - x0, u = (x - x0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * sl[k] + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * sl[k + 1];
}
// duas seções superelípticas (z = lateral, y = altura) -> malha lofada ao longo de x
function fixSeam(g, seg, rings) {                       // média das normais na costura (a seção fecha em seg e seg+1)
  const n = g.attributes.normal, S = seg + 1;
  for (let r = 0; r < rings; r++) {
    const a = r * S, b = r * S + seg;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
}
function loft(st, seg = 36, capEnds = true) {
  const pos = [], uv = [], idx = [], S = seg + 1, x0 = st[0].x, x1 = st[st.length - 1].x;
  for (const s of st) {
    for (let j = 0; j <= seg; j++) {
      const th = ((j % seg) / seg) * Math.PI * 2, c = Math.cos(th), si = Math.sin(th);
      const z = s.hw * sgnpow(c, 2 / s.n), ymid = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
      pos.push(s.x, ymid + hh * sgnpow(si, 2 / s.m), z); uv.push((s.x - x0) / (x1 - x0), j / seg);
    }
  }
  const R = st.length;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * S + j, b = i * S + j + 1, c = (i + 1) * S + j, d = (i + 1) * S + j + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (capEnds) {
    for (const [ring, flip] of [[0, true], [R - 1, false]]) {
      const s = st[ring], ci = pos.length / 3; pos.push(s.x, (s.y0 + s.y1) / 2, 0); uv.push(ring ? 1 : 0, 0.5);
      for (let j = 0; j < seg; j++) { const a = ring * S + j, b = ring * S + j + 1; idx.push(...(flip ? [ci, b, a] : [ci, a, b])); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  g.userData = { seg, rings: R }; fixSeam(g, seg, R);
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


// ------------------------------------------------------------------ pintura: cor da marca, saia escura, listras, número e nome
function makeLivery(P, key) {
  const W = 2048, H = 1024, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const U = (u) => u * W, V = (v) => H * (1 - v), dark = "#0b0f14", green = "#2ee59d";
  g.fillStyle = P.paint; g.fillRect(0, 0, W, H);
  // brilho suave no teto e nas laterais
  const grd = g.createLinearGradient(0, V(0.5), 0, V(0)); grd.addColorStop(0, "rgba(255,255,255,.10)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // saia / assoalho escuros com recorte em onda (cada lado)
  const skirt = (vMid, sgn) => {                       // sgn +1: v cresce para baixo (lado direito) ; -1: lado esquerdo
    g.beginPath(); g.moveTo(0, V(vMid + sgn * -0.0));
    const pts = [[0, 0.075], [0.18, 0.058], [0.42, 0.045], [0.62, 0.052], [0.82, 0.09], [1, 0.13]];
    g.moveTo(U(0), V(vMid));
    pts.forEach(([u, d]) => g.lineTo(U(u), V(vMid + sgn * d)));
    g.lineTo(U(1), V(vMid + sgn * 0.4)); g.lineTo(U(0), V(vMid + sgn * 0.4)); g.closePath(); g.fill();
  };
  g.fillStyle = dark; skirt(1.0, -1); skirt(0.0, -1); skirt(0.5, 1);
  g.fillRect(0, V(0.9), W, V(0.6) - V(0.9));            // assoalho
  // listras do capô ao teto, na cor Pitwall
  const stripe = (v, w, col) => { g.fillStyle = col; g.fillRect(U(0.03), V(v + w / 2), U(0.94), V(v - w / 2) - V(v + w / 2)); };
  stripe(0.25, 0.06, "#ffffff"); stripe(0.25, 0.022, "#10b774");
  // faixa lateral verde acompanhando a saia
  g.strokeStyle = green; g.lineWidth = 7; g.globalAlpha = 0.9;
  for (const [vm, sg] of [[1.0, -1], [0.0, -1], [0.5, 1]]) {
    g.beginPath(); [[0, 0.085], [0.18, 0.068], [0.42, 0.055], [0.62, 0.062], [0.82, 0.1], [1, 0.14]].forEach(([u, d], k) => { const x = U(u), y = V(vm + sg * d); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  g.globalAlpha = 1;
  // saídas de ar no capô (carros de motor dianteiro) ou tampa do motor (traseiro/central)
  g.fillStyle = "#0c1116";
  if (P.layout === "front") for (let k = 0; k < 5; k++) { g.fillRect(U(0.74 + k * 0.022), V(0.25 + 0.07), U(0.012), V(0.25 - 0.07) - V(0.25 + 0.07)); }
  else for (let k = 0; k < 7; k++) { g.fillRect(U(0.1 + k * 0.022), V(0.25 + 0.06), U(0.012), V(0.25 - 0.06) - V(0.25 + 0.06)); }
  // linhas das portas
  g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 3;
  const cab = P.cab, ux = (x) => (x + 2.32) / 4.64;
  if (!clean) for (const [a, b] of [[0.93, 1.07], [0.43, 0.57]]) for (const xx of [cab[0] + 0.35, cab[1] - 0.55]) {
    const u = ux(xx); [[a, Math.min(b, 1)], [0, Math.max(0, b - 1)]].forEach(([v0, v1]) => { if (v1 > v0) { g.beginPath(); g.moveTo(U(u), V(v0)); g.lineTo(U(u), V(v1)); g.stroke(); } });
  }
  // número, nome e roundel (cada lado lido de fora: o esquerdo é desenhado girado)
  const num = { porsche: "91", ferrari: "71", lamborghini: "63", mclaren: "59", audi: "29", honda: "30", bmw: "46", mercedes: "88", aston: "7", ford: "64", corvette: "3", nissan: "23", lexus: "14", bentley: "8" }[key] || "9";
  const side = (cv, flip) => {
    g.save(); g.translate(U(0.42), V(cv)); if (flip) g.scale(-1, -1);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.strokeStyle = green; g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#0b0f14"; g.font = "italic 800 92px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(num, 0, 6);
    g.restore();
    g.save(); g.translate(U(0.6), V(cv + (flip ? 0.12 : -0.115))); if (flip) g.scale(-1, -1);
    g.fillStyle = "#ffffff"; g.font = "italic 800 70px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PITWALL", 0, 0);
    g.fillStyle = green; g.fillRect(-150, 38, 300, 7); g.restore();
  };
  side(0.0, false); side(1.0, false); side(0.5, true);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.ClampToEdgeWrapping; return t;
}


// ------------------------------------------------------------------ pintura Pitwall: verde neon metálico, carbono, faixas em ângulo e brilho
function makePitwallLivery(P, key, clean = false) {
  const W = 2048, H = 1024, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const U = (u) => u * W, V = (v) => H * (1 - v);
  const dark = "#070a0e", neon = "#3dffa4", emerald = "#00cf6e", deep = "#00924f";
  // base: verde forte com degradê (mais claro no teto, mais fundo nas laterais) e flocos metálicos
  const base = g.createLinearGradient(0, V(0.5), 0, V(0)); base.addColorStop(0, "#2dff9c"); base.addColorStop(0.5, emerald); base.addColorStop(1, deep);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const rr = (() => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < (clean ? 0 : 9000); i++) { g.fillStyle = `rgba(${rr() > 0.5 ? "255,255,255" : "0,60,30"},${0.04 + rr() * 0.12})`; g.fillRect(rr() * W, rr() * H, 1 + rr() * 2.2, 1 + rr() * 2.2); }
  // saia, assoalho e traseira em carbono
  g.fillStyle = dark;
  const skirt = (vMid, sgn) => {
    g.beginPath(); g.moveTo(U(0), V(vMid));
    [[0, 0.09], [0.16, 0.07], [0.38, 0.05], [0.58, 0.055], [0.8, 0.1], [1, 0.16]].forEach(([u, d]) => g.lineTo(U(u), V(vMid + sgn * d)));
    g.lineTo(U(1), V(vMid + sgn * 0.4)); g.lineTo(U(0), V(vMid + sgn * 0.4)); g.closePath(); g.fill();
  };
  if (!clean) { skirt(1.0, -1); skirt(0.5, 1); g.fillRect(0, V(0.9), W, V(0.6) - V(0.9)); }
  // linha de neon acompanhando a saia
  g.lineWidth = 8; g.strokeStyle = neon; g.shadowColor = neon; g.shadowBlur = 14;
  if (!clean) for (const [vm, sg] of [[1.0, -1], [0.5, 1]]) { g.beginPath(); [[0, 0.1], [0.16, 0.078], [0.38, 0.058], [0.58, 0.063], [0.8, 0.11], [1, 0.17]].forEach(([u, d], k) => { const x = U(u), y = V(vm + sg * d); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  g.shadowBlur = 0;
  // faixas do capô ao teto: carbono com fio de neon e cortes em ângulo
  const bar = (v, w, col) => { g.fillStyle = col; g.fillRect(U(0.02), V(v + w / 2), U(0.96), V(v - w / 2) - V(v + w / 2)); };
  bar(0.25, 0.13, dark); bar(0.25, 0.012, neon);
  g.fillStyle = dark; for (const sgn of [-1, 1]) for (let k = 0; k < 4; k++) {
    const u0 = 0.06 + k * 0.045, v0 = 0.25 + sgn * 0.065; g.beginPath(); g.moveTo(U(u0), V(v0)); g.lineTo(U(u0 + 0.05), V(v0 + sgn * 0.045)); g.lineTo(U(u0 + 0.06), V(v0 + sgn * 0.045)); g.lineTo(U(u0 + 0.011), V(v0)); g.closePath(); g.fill();
  }
  // "estilhaços" diagonais nas laterais (em cima da porta até a coxa traseira)
  const shard = (vm, flip) => {
    g.save(); g.translate(0, 0);
    for (let k = 0; k < 5; k++) {
      const u0 = 0.18 + k * 0.055, w = 0.07 - k * 0.008;
      g.fillStyle = k % 2 ? dark : "rgba(0,0,0,.35)"; g.beginPath();
      const v0 = vm + (flip ? -0.015 : 0.015);
      g.moveTo(U(u0), V(v0 + 0.0)); g.lineTo(U(u0 + w), V(v0 + (flip ? -0.0 : 0.0))); g.lineTo(U(u0 + w + 0.03), V(v0 + (flip ? -0.09 : 0.09))); g.lineTo(U(u0 + 0.03), V(v0 + (flip ? -0.09 : 0.09))); g.closePath(); g.fill();
    }
    g.restore();
  };
  if (!clean) { shard(0.045, false); shard(0.955, true); shard(0.545, false); }
  // saídas de ar, linhas das portas
  g.fillStyle = "#04070a";
  if (!clean) if (P.layout === "front") for (let k = 0; k < 5; k++) g.fillRect(U(0.74 + k * 0.022), V(0.25 + 0.075), U(0.012), V(0.25 - 0.075) - V(0.25 + 0.075));
  else if (!clean) for (let k = 0; k < 7; k++) g.fillRect(U(0.1 + k * 0.022), V(0.25 + 0.065), U(0.012), V(0.25 - 0.065) - V(0.25 + 0.065));
  g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 3;
  const cab = P.cab, ux = (x) => (x + 2.32) / 4.64;
  for (const [a, b] of [[0.93, 1.07], [0.43, 0.57]]) for (const xx of [cab[0] + 0.35, cab[1] - 0.55]) {
    const u = ux(xx); [[a, Math.min(b, 1)], [0, Math.max(0, b - 1)]].forEach(([v0, v1]) => { if (v1 > v0) { g.beginPath(); g.moveTo(U(u), V(v0)); g.lineTo(U(u), V(v1)); g.stroke(); } });
  }
  // número, nome e roundel
  const num = { porsche: "91", ferrari: "71", lamborghini: "63", mclaren: "59", audi: "29", honda: "30", bmw: "46", mercedes: "88", aston: "7", ford: "64", corvette: "3", nissan: "23", lexus: "14", bentley: "8" }[key] || "9";
  const side = (cv, flip) => {
    g.save(); g.translate(U(0.42), V(cv)); if (flip) g.scale(-1, -1);
    g.fillStyle = "#f4f7fa"; g.beginPath(); g.arc(0, 0, 80, 0, Math.PI * 2); g.fill();
    g.lineWidth = 9; g.strokeStyle = neon; g.beginPath(); g.arc(0, 0, 80, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#070a0e"; g.font = "italic 800 94px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(num, 0, 6); g.restore();
    g.save(); g.translate(U(0.6), V(cv + (flip ? 0.12 : -0.115))); if (flip) g.scale(-1, -1);
    g.fillStyle = "#ffffff"; g.font = "italic 800 72px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PITWALL", 0, 0);
    g.fillStyle = neon; g.fillRect(-150, 40, 300, 7); g.restore();
  };
  side(0.0, false); side(1.0, false); side(0.5, true);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ------------------------------------------------------------------ montagem do carro
function buildCar(key, scene) {
  const P = PROFILES[key] || PROFILES.generic;
  const liveries = { pitwall: makePitwallLivery(P, key), brand: makeLivery(P, key) };
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: liveries.pitwall, metalness: 0.45, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03 });
  const paintPlain = new THREE.MeshPhysicalMaterial({ color: "#00cf6e", metalness: 0.45, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03 });
  const setScheme = (name) => { const pw = name === "pitwall"; paint.map = liveries[pw ? "pitwall" : "brand"]; paint.needsUpdate = true; paintPlain.color.set(pw ? "#00cf6e" : P.paint); };
  const carbon = mat({ color: "#0e1116", metalness: 0.4, roughness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#0f1b28", metalness: 0.55, roughness: 0.06, clearcoat: 1, opacity: 0.78, transparent: true, depthWrite: false });
  const dark = mat({ color: "#07090c", roughness: 0.8 });
  const steel = mat({ color: "#9aa4b2", metalness: 0.85, roughness: 0.3 });
  const metal = mat({ color: "#5d6775", metalness: 0.8, roughness: 0.4 });
  const rubber = mat({ color: "#121316", roughness: 0.92 });
  const root = new THREE.Group();                 // tudo do carro
  const body = new THREE.Group();                 // parte suspensa (mexe com altura/rolagem)
  root.add(body);
  const bodyMats = [paint, paintPlain, carbon, glass, dark];  // vira "raio-x" no modo suspensão

  // --- corpo
  const HW = [[-2.30, 0.50], [-2.15, 0.72], [-1.9, 0.90], [-1.4, P.haunch + 0.17], [-0.85, P.haunch + 0.08], [-0.3, P.haunch - 0.02], [0.3, P.haunch - 0.02], [0.9, P.haunch + 0.12], [1.4, P.haunch + 0.12], [1.85, P.noseW + 0.2], [2.15, P.noseW + 0.04], [2.32, P.noseW * 0.55]];
  const TOP = [[-2.30, 0.58], [-2.05, P.deckH - 0.06], [-1.6, P.deckH], [-0.9, P.deckH - 0.02], [-0.3, 0.80], [0.5, 0.80], [1.05, P.hoodH + 0.03], [1.7, P.hoodH - 0.04], [2.1, P.noseTop], [2.32, P.noseTop - 0.14]];
  const BOT = [[-2.30, 0.32], [-2.0, 0.17], [-1.7, 0.12], [1.8, 0.12], [2.1, 0.15], [2.32, 0.2]];
  const st = [];
  for (let i = 0; i <= 150; i++) {
    const x = lerp(-2.32, 2.32, i / 150);
    st.push({ x, hw: tab(HW, x), y0: tab(BOT, x), y1: tab(TOP, x), n: 6.5, m: 3.4 });
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
    g.computeVertexNormals(); fixSeam(g, g.userData.seg, g.userData.rings); return g;
  };
  const shell = new THREE.Mesh(carve(loft(st, 72)), paint); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const lowerStrip = new THREE.Mesh(carve(loft(st.map((s) => ({ ...s, hw: s.hw + 0.004, y1: s.y0 + 0.07, n: 6.5, m: 3.4 })), 72)), carbon); body.add(lowerStrip);   // saia preta

  // --- cabine: painéis de verdade (para-brisa, vidros laterais, teto, colunas), não um tubo mole
  const [cx0, cx1] = P.cab, belt = 0.79, bw = 0.80, tw = 0.62, rh = P.roofH;
  const cabin = new THREE.Group(); body.add(cabin);
  const quad = (a, b, c, d, m) => {                                 // quadrilátero (vértices em ordem), duas faces
    const g = new THREE.BufferGeometry(), v = [...a, ...b, ...c, ...d];
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    const mm = new THREE.Mesh(g, m); mm.material.side = THREE.DoubleSide; mm.castShadow = true; return mm;
  };
  const Lc = cx1 - cx0, xf = cx1 - Lc * 0.31, xr = cx0 + Lc * 0.27;                          // fim do para-brisa (teto) / começo do vidro traseiro
  cabin.add(quad([cx1, belt, -bw], [cx1, belt, bw], [xf, rh - 0.02, tw], [xf, rh - 0.02, -tw], glass));            // para-brisa
  cabin.add(quad([cx0, belt + 0.02, bw - 0.04], [cx0, belt + 0.02, -bw + 0.04], [xr, rh - 0.03, -tw], [xr, rh - 0.03, tw], glass));   // vidro traseiro
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(xf - xr, 0.035, tw * 2), carbon); roofPanel.position.set((xf + xr) / 2, rh - 0.012, 0); roofPanel.castShadow = true; cabin.add(roofPanel);
  const sideShape = new THREE.Shape(); sideShape.moveTo(cx0 + 0.16, belt + 0.01); sideShape.lineTo(xr + 0.02, rh - 0.05); sideShape.lineTo(xf - 0.02, rh - 0.05); sideShape.lineTo(cx1 - 0.12, belt + 0.01); sideShape.closePath();
  for (const s2 of [-1, 1]) {
    const gl = new THREE.Mesh(new THREE.ExtrudeGeometry(sideShape, { depth: 0.01, bevelEnabled: false }), glass);
    const pv = new THREE.Group(); pv.position.set(0, belt, s2 * bw); gl.position.set(0, -belt, 0); pv.add(gl); pv.rotation.x = -s2 * 0.3; cabin.add(pv);   // vidro inclinado para dentro (tumblehome)
    // colunas A e C, base da janela e coluna B
    cabin.add(between(new THREE.Vector3(cx1 - 0.03, belt, s2 * (bw - 0.02)), new THREE.Vector3(xf, rh - 0.03, s2 * tw), 0.03, paintPlain));
    cabin.add(between(new THREE.Vector3(cx0 + 0.02, belt, s2 * (bw - 0.03)), new THREE.Vector3(xr, rh - 0.03, s2 * tw), 0.034, paintPlain));
    cabin.add(between(new THREE.Vector3(cx0 + 0.05, belt, s2 * bw), new THREE.Vector3(cx1 - 0.05, belt, s2 * bw), 0.022, carbon));
    cabin.add(between(new THREE.Vector3(xf + 0.06, rh - 0.04, s2 * tw), new THREE.Vector3(xr - 0.05, rh - 0.04, s2 * tw), 0.02, carbon));
    const mid = (cx0 + cx1) / 2 - 0.05; cabin.add(between(new THREE.Vector3(mid, belt, s2 * (bw - 0.03)), new THREE.Vector3(mid, rh - 0.05, s2 * (tw + 0.03)), 0.022, carbon));
  }
  // interior visível pelos vidros: assoalho, banco, painel e gaiola de proteção
  const caged = mat({ color: "#aeb7c4", metalness: 0.8, roughness: 0.35 }), seatM = mat({ color: "#14171c", roughness: 0.8 });
  const fl = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0 - 0.2, 0.02, 1.2), seatM); fl.position.set((cx0 + cx1) / 2, 0.3, 0); cabin.add(fl);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.42), seatM); seat.position.set(cx0 + 0.5, 0.42, -0.3); cabin.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.44), seatM); back.position.set(cx0 + 0.36, 0.64, -0.3); back.rotation.z = -0.18; cabin.add(back);
  const dashM = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 1.18), carbon); dashM.position.set(cx1 - 0.3, 0.76, 0); cabin.add(dashM);
  for (const s2 of [-1, 1]) {
    const z = s2 * 0.58, Vv = (x, y, zz) => new THREE.Vector3(x, y, zz);
    cabin.add(between(Vv(cx0 + 0.35, 0.34, z), Vv(cx0 + 0.35, rh - 0.12, z * 0.88), 0.017, caged));
    cabin.add(between(Vv(cx1 - 0.3, 0.8, z), Vv(xf + 0.12, rh - 0.1, z * 0.9), 0.017, caged));
    cabin.add(between(Vv(cx0 + 0.45, 0.46, z), Vv(cx1 - 0.35, 0.74, z), 0.015, caged));
    cabin.add(between(Vv(cx0 + 0.45, 0.74, z), Vv(cx1 - 0.35, 0.46, z), 0.015, caged));
  }
  cabin.add(between(new THREE.Vector3(cx0 + 0.35, rh - 0.12, -0.5), new THREE.Vector3(cx0 + 0.35, rh - 0.12, 0.5), 0.017, caged));
  cabin.add(between(new THREE.Vector3(xf + 0.12, rh - 0.1, -0.52), new THREE.Vector3(xf + 0.12, rh - 0.1, 0.52), 0.017, caged));
  const cab = [];                                                  // (usado pelos detalhes que seguem a cabine)
  for (let i = 0; i <= 12; i++) { const x = lerp(cx0, cx1, i / 12); cab.push({ x, y1: rh }); }
  const cabinMeshes = cabin.children;

  // --- paralamas largos com o arco da roda (a roda aparece pelo furo)
  const flares = [];
  for (const ax of [WB.front, WB.rear]) for (const sd of [-1, 1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.4, 36, 1, true), dark); liner.material.side = THREE.DoubleSide;
    liner.rotation.x = Math.PI / 2; liner.position.set(ax, R, sd * 0.78); body.add(liner);
  }

  for (const ax of [WB.front, WB.rear]) for (const sd of [-1, 1]) {      // contorno do arco (aresta viva do paralama)
    const eb = new THREE.Mesh(new THREE.TorusGeometry(R + 0.07, 0.016, 10, 48, Math.PI), paintPlain); eb.position.set(ax, R, sd * (tab(HW, ax) - 0.01)); body.add(eb);
    const eb2 = new THREE.Mesh(new THREE.TorusGeometry(R + 0.07, 0.01, 8, 48, Math.PI), carbon); eb2.position.set(ax, R, sd * (tab(HW, ax) - 0.03)); body.add(eb2);
  }
  // --- splitter, difusor, asa
  const splitter = new THREE.Group(); splitter.position.set(2.18, 0.1, 0);
  const spShape = new THREE.Shape(); spShape.moveTo(-0.1, -0.86); spShape.lineTo(0.28, -0.82); spShape.quadraticCurveTo(0.4, -0.7, 0.4, -0.5); spShape.lineTo(0.4, 0.5); spShape.quadraticCurveTo(0.4, 0.7, 0.28, 0.82); spShape.lineTo(-0.1, 0.86); spShape.closePath();
  const sp = new THREE.Mesh(new THREE.ExtrudeGeometry(spShape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 1 }), carbon); sp.rotation.x = Math.PI / 2; sp.position.set(0.0, 0.02, 0); sp.castShadow = true; splitter.add(sp);
  for (const z of [-0.78, 0.78]) { const cn = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.012), carbon); cn.position.set(0.12, 0.07, z); cn.rotation.y = z > 0 ? 0.25 : -0.25; splitter.add(cn); }   // canards
  
  body.add(splitter);
  const diff = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.1), carbon); diff.position.set(-2.0, 0.22, 0); diff.rotation.z = 0.2; body.add(diff);
  for (const z of [-0.36, 0, 0.36]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.012), carbon); f.position.set(-2.0, 0.27, z); f.rotation.z = 0.2; body.add(f); }

  const wing = new THREE.Group(); const wingX = -2.18, wingY = P.wing === "swan" ? 1.2 : 1.08; wing.position.set(wingX, wingY, 0); body.add(wing);
  const foil = new THREE.Shape(); foil.moveTo(0.18, 0); foil.bezierCurveTo(0.12, 0.05, -0.1, 0.045, -0.2, 0.01); foil.lineTo(-0.2, -0.004); foil.bezierCurveTo(-0.08, 0.012, 0.1, 0.0, 0.18, 0);
  const foilMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(foil, { depth: 1.86, bevelEnabled: false }), carbon); foilMesh.position.z = -0.93; foilMesh.castShadow = true;
  const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(foil, { depth: 1.86, bevelEnabled: false }), carbon); flap.scale.set(0.7, 1, 1); flap.position.set(-0.05, 0.1, -0.93);
  const wingPivot = new THREE.Group(); wingPivot.add(foilMesh, flap); wing.add(wingPivot);
  const epShape = new THREE.Shape(); epShape.moveTo(-0.26, -0.12); epShape.lineTo(0.2, -0.05); epShape.quadraticCurveTo(0.26, 0.0, 0.18, 0.12); epShape.lineTo(-0.24, 0.17); epShape.quadraticCurveTo(-0.3, 0.0, -0.26, -0.12);
  for (const s of [-1, 1]) {
    const ep = new THREE.Mesh(new THREE.ExtrudeGeometry(epShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 }), paintPlain); ep.position.set(0, 0.05, s * 0.93 - (s > 0 ? 0 : 0.012)); wing.add(ep);
    const post = P.wing === "swan" ? between(new THREE.Vector3(0.1, -0.55, s * 0.32), new THREE.Vector3(-0.05, 0.02, s * 0.32), 0.026, carbon) : between(new THREE.Vector3(0.1, -0.35, s * 0.4), new THREE.Vector3(0, 0.0, s * 0.4), 0.02, carbon);
    wing.add(post);
  }
  const gurney = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 1.86), carbon); gurney.position.set(-0.24, 0.1, 0); wingPivot.add(gurney);

  // --- luzes, espelhos, saídas de ar
  // faróis: forma própria de cada marca (fenda, barra, redondo, "Y")
  const lampMat = new THREE.MeshStandardMaterial({ color: "#eaf5ff", emissive: "#bfe0ff", emissiveIntensity: 1.5 });
  const lampShape = () => {
    const sh = new THREE.Shape();
    if (P.lamp === "round") { sh.absarc(0, 0, 0.085, 0, Math.PI * 2, false); return sh; }
    if (P.lamp === "slit") { sh.moveTo(-0.19, -0.012); sh.lineTo(0.2, 0.028); sh.lineTo(0.2, 0.05); sh.lineTo(-0.19, 0.012); sh.closePath(); return sh; }
    if (P.lamp === "y") { sh.moveTo(-0.17, 0.05); sh.lineTo(-0.02, 0.0); sh.lineTo(0.18, 0.05); sh.lineTo(0.18, 0.075); sh.lineTo(-0.02, 0.03); sh.lineTo(-0.17, 0.075); sh.closePath(); return sh; }
    sh.moveTo(-0.2, -0.02); sh.lineTo(0.2, 0.0); sh.lineTo(0.2, 0.055); sh.lineTo(-0.2, 0.04); sh.closePath(); return sh;   // barra
  };
  for (const s of [-1, 1]) {
    const lx = 1.97, ly = tab(TOP, lx) - 0.08, lz = s * tab(HW, lx) * 0.68;
    const house = new THREE.Mesh(new THREE.ExtrudeGeometry(lampShape(), { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.006, bevelSegments: 1 }), dark);
    house.scale.set(1.25, 1.35, 1); house.position.set(lx - 0.01, ly, lz); house.rotation.y = Math.PI / 2 - s * 0.5; body.add(house);
    const lm = new THREE.Mesh(new THREE.ExtrudeGeometry(lampShape(), { depth: 0.03, bevelEnabled: false }), lampMat);
    lm.position.set(lx + 0.012, ly, lz); lm.rotation.y = Math.PI / 2 - s * 0.5; body.add(lm);
    const mir = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 12), paintPlain); mir.scale.set(1.5, 0.75, 1); mir.position.set(cx1 - 0.1, 0.9, s * 0.8); body.add(mir);
    body.add(between(new THREE.Vector3(cx1 - 0.14, 0.84, s * 0.66), new THREE.Vector3(cx1 - 0.12, 0.89, s * 0.74), 0.012, carbon));
    // escapamento
    if (P.layout !== "rear" || s > 0) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 20, 1, true), steel); pipe.material.side = THREE.DoubleSide; pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-2.34, 0.34, P.layout === "rear" ? 0.0 : s * 0.24); body.add(pipe);
    }
  }
  // detalhes por tipo de carro: snorkel no teto (motor central), "power bulge" no capô (motor dianteiro)
  if (P.layout === "mid") {
    const sn = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), carbon); sn.position.set((cx0 + cx1) / 2 - 0.12, P.roofH + 0.04, 0); body.add(sn);
  }
  if (P.layout === "front") {
    const hb = [];
    for (let i = 0; i <= 24; i++) { const x = lerp(0.65, 1.95, i / 24); hb.push({ x, hw: 0.2 * Math.sin(Math.PI * (0.12 + 0.76 * (i / 24))) + 0.05, y0: tab(TOP, x) - 0.02, y1: tab(TOP, x) + 0.03, n: 3.2, m: 2.4 }); }
    body.add(new THREE.Mesh(loft(hb, 24), paintPlain));
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
  // textura do flanco do pneu: faixa e nome
  const sideTex = (() => {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "#121316"; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = "#e9edf2"; g.font = "700 46px system-ui, sans-serif"; g.textBaseline = "middle";
    for (let k = 0; k < 2; k++) g.fillText("PITWALL  SLICK  M  ·  GT3", 40 + k * 512, 64);
    g.fillStyle = "#2ee59d"; g.fillRect(0, 100, 1024, 7);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: sideTex, roughness: 0.9, metalness: 0 });
  const spokeShape = (() => {                                     // raio cônico (largo no cubo, fino no aro)
    const sh = new THREE.Shape(); sh.moveTo(0.04, -0.03); sh.lineTo(0.225, -0.017); sh.lineTo(0.225, 0.017); sh.lineTo(0.04, 0.03); sh.closePath(); return sh;
  })();
  const makeWheel = (front, side) => {
    const g = new THREE.Group(), w = front ? TW.front : TW.rear;
    const prof = []; const rr = R, rimR = 0.235, hw = w / 2;
    for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI; prof.push(new THREE.Vector2(lerp(rimR + 0.012, rr, Math.pow(Math.sin(a), 0.5)), lerp(-hw, hw, i / 32))); }
    const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), tireMat); tire.rotation.x = Math.PI / 2; tire.castShadow = true; g.add(tire);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.035, 0.006, 6, 64), new THREE.MeshStandardMaterial({ color: "#2ee59d", emissive: "#2ee59d", emissiveIntensity: 0.7 })); ring.position.z = side * (hw - 0.002); g.add(ring);
    const rim = new THREE.Group(), faceZ = side * (hw - 0.045);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, w * 0.92, 48, 1, true), metal); barrel.rotation.x = Math.PI / 2; barrel.material.side = THREE.DoubleSide; rim.add(barrel);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.011, 8, 56), steel); lip.position.z = side * (hw - 0.012); rim.add(lip);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.2, 0.035, 48), mat({ color: "#15181d", metalness: 0.85, roughness: 0.3 })); dish.rotation.x = Math.PI / 2; dish.position.z = faceZ - side * 0.012; rim.add(dish);
    for (let i = 0; i < 5; i++) {                                  // 5 raios duplos
      for (const off of [-0.09, 0.09]) {
        const sp = new THREE.Mesh(new THREE.ExtrudeGeometry(spokeShape, { depth: 0.022, bevelEnabled: false }), steel);
        sp.rotation.z = (i / 5) * Math.PI * 2 + off; sp.position.z = faceZ - 0.011; rim.add(sp);
      }
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.034, 6), mat({ color: "#f0b429", metalness: 0.8, roughness: 0.3 })); hub.rotation.x = Math.PI / 2; hub.position.z = faceZ + side * 0.012; rim.add(hub);
    g.add(rim);
    // freio: disco com ranhuras + pinça
    const discMat = mat({ color: "#6a727e", metalness: 0.85, roughness: 0.35, emissive: "#ff5a1a", emissiveIntensity: 0 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.032, 56), discMat); disc.rotation.x = Math.PI / 2; disc.position.z = -side * 0.07; g.add(disc);
    for (const r0 of [0.12, 0.15, 0.175]) { const gr = new THREE.Mesh(new THREE.TorusGeometry(r0, 0.0025, 4, 48), mat({ color: "#2a2f37", roughness: 0.6 })); gr.position.z = -side * 0.053; g.add(gr); }
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.07), mat({ color: front ? "#e8c13a" : "#c92c2c", roughness: 0.35, metalness: 0.2 })); cal.position.set(0, 0.15, -side * 0.07); g.add(cal);
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

  return { root, body, P, paint, paintPlain, setScheme, glass, cabinMeshes, bodyMats, flares, splitter, wing: wingPivot, wingGroup: wing, corners, ducts, shell, carbon, dark, metal, steel, lowerStrip, wheelRim, dashLed, hw: HW, top: TOP };
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
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: "#39414d", metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.35, depthWrite: false })); engine.position.set(car.P.layout === "front" ? 1.05 : -1.3, 0.38, 0); grp.add(engine);
  items.grp = grp; return items;
}
function helix(a, b, coils, radius, wire, mat0) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length(), n = Math.max(2, coils) * 14, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, ang = t * coils * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(ang) * radius, t * len, Math.sin(ang) * radius)); }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, wire, 6, false), mat0);
  m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); m.castShadow = true; return m;
}



// "Pintura Pitwall" para modelos locais: troca a pintura/livery pela cor do sistema, tira decalques, banners e texto do pneu.
// É só visual e acontece no PC de quem usa; não altera nem redistribui o arquivo do modelo.
function makeRestyle(model, car) {
  const mats = new Map(), hid = [];
  const reg = (m, kind) => { if (!mats.has(m)) mats.set(m, { kind, map: m.map, color: m.color && m.color.clone(), metal: m.metalness, rough: m.roughness, cc: m.clearcoat }); };
  model.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material], nm = `${o.name} ${list.map((m) => m.name).join(" ")}`;
    if (/decal|banner|logo|sticker|sponsor/i.test(nm) && !/glass|window/i.test(nm)) hid.push(o);
    for (const m of list) {
      if (/carpaint|body_paint|^paint/i.test(m.name)) reg(m, "paint");
      else if (/tyre|tire/i.test(m.name) && !/glass|rim/i.test(m.name)) reg(m, "tire");
    }
  });
  return (mode) => {
    const on = mode === "pitwall";
    for (const [m, o] of mats) {
      if (!on) { m.map = o.map; if (o.color) m.color.copy(o.color); m.metalness = o.metal; m.roughness = o.rough; if (o.cc !== undefined) m.clearcoat = o.cc; }
      else if (o.kind === "paint") { m.map = null; m.color.set("#00c46a"); m.metalness = 0.55; m.roughness = 0.22; if ("clearcoat" in m) { m.clearcoat = 1; m.clearcoatRoughness = 0.03; } }
      else { m.map = null; m.color.set("#15171b"); m.roughness = 0.9; m.metalness = 0; }
      m.needsUpdate = true;
    }
    hid.forEach((o) => { o.visible = !on; });
  };
}


// ------------------------------------------------------------------ modelo de malha única (gerado por IA, sem peças nomeadas)
// Acha as rodas pelo contato com o chão, alinha às medidas do editor, separa as rodas por região (para a cambagem e a
// convergência girarem de verdade) e pinta por zonas: pintura Pitwall (livery projetada por UV), carbono, vidros, pneus e aros.
function adoptRaw(gltf, brand) {
  let mesh = null; gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
  if (!mesh) throw new Error("modelo sem malha");
  const g = mesh.geometry; g.applyMatrix4(mesh.matrixWorld);
  const PA = g.attributes.position.array, NA = g.attributes.normal ? g.attributes.normal.array : null, n = PA.length / 3;
  let idx = g.index ? g.index.array : null; if (!idx) { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  // eixos: a traseira é a ponta com o ponto mais alto (a asa); queremos a frente em +x
  let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < n; i++) { const x = PA[3 * i], y = PA[3 * i + 1]; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const Lm = xmax - xmin; let hi = [-1e9, -1e9];
  for (let i = 0; i < n; i++) { const x = PA[3 * i], y = PA[3 * i + 1]; if (x < xmin + 0.08 * Lm && y > hi[0]) hi[0] = y; if (x > xmax - 0.08 * Lm && y > hi[1]) hi[1] = y; }
  const flip = hi[1] > hi[0];                                   // traseira em +x: gira 180° em torno de y
  if (flip) for (let i = 0; i < n; i++) { PA[3 * i] = -PA[3 * i]; PA[3 * i + 2] = -PA[3 * i + 2]; if (NA) { NA[3 * i] = -NA[3 * i]; NA[3 * i + 2] = -NA[3 * i + 2]; } }
  // contato com o chão -> rodas
  const tol = 0.02 * (ymax - ymin), lowX = [], lowZ = [];
  for (let i = 0; i < n; i++) if (PA[3 * i + 1] < ymin + tol) { lowX.push(PA[3 * i]); lowZ.push(PA[3 * i + 2]); }
  if (lowX.length < 50) throw new Error("não achei o contato das rodas com o chão");
  let c0 = Math.min(...lowX), c1 = Math.max(...lowX);
  for (let it = 0; it < 8; it++) {
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (const x of lowX) { if (Math.abs(x - c0) < Math.abs(x - c1)) { s0 += x; n0++; } else { s1 += x; n1++; } }
    c0 = s0 / Math.max(n0, 1); c1 = s1 / Math.max(n1, 1);
  }
  const mid = (c0 + c1) / 2;
  const box = (front, sign) => { let a = 1e9, b = -1e9, xa = 1e9, xb = -1e9; lowX.forEach((x, k) => { if ((x > mid) === front && Math.sign(lowZ[k]) === sign) { if (lowZ[k] < a) a = lowZ[k]; if (lowZ[k] > b) b = lowZ[k]; if (x < xa) xa = x; if (x > xb) xb = x; } }); return { zc: (a + b) / 2, xc: (xa + xb) / 2 }; };
  const wb = { front: [box(true, -1), box(true, 1)], rear: [box(false, -1), box(false, 1)] };
  const xf = (wb.front[0].xc + wb.front[1].xc) / 2, xr = (wb.rear[0].xc + wb.rear[1].xc) / 2, k = (WB.front - WB.rear) / (xf - xr);
  const zOf = (b) => Math.abs(b.zc) * k;
  for (let i = 0; i < n; i++) { PA[3 * i] = (PA[3 * i] - xf) * k + WB.front; PA[3 * i + 1] = (PA[3 * i + 1] - ymin) * k; PA[3 * i + 2] = PA[3 * i + 2] * k; }
  const centers = [[WB.front, -zOf(wb.front[0])], [WB.front, zOf(wb.front[1])], [WB.rear, -zOf(wb.rear[0])], [WB.rear, zOf(wb.rear[1])]];
  const halfW = [TW.front / 2, TW.front / 2, TW.rear / 2, TW.rear / 2];

  // ---- rodas: triângulos dentro de cada cilindro de roda; o resto é a carroceria
  const T = idx.length / 3, wheelOf = new Int8Array(T).fill(-1), tireTri = new Uint8Array(T), dropTri = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const cx = (PA[a] + PA[b] + PA[c]) / 3, cy = (PA[a + 1] + PA[b + 1] + PA[c + 1]) / 3, cz = (PA[a + 2] + PA[b + 2] + PA[c + 2]) / 3;
    for (let i = 0; i < 4; i++) { const dx = cx - centers[i][0], dy = cy - R, dz = cz - centers[i][1]; if (Math.abs(dz) < halfW[i] + 0.015 && dx * dx + dy * dy < (R * 1.04) ** 2) { wheelOf[t] = i; tireTri[t] = Math.hypot(dx, dy) > R * 0.8 ? 1 : 0; break; } }
  }
  // ---- pintura por vértice (bordas suaves, sem triângulos recortados): verde neon em cima, carbono embaixo, vidros escuros, faixas e fios de neon
  let roof = 0; for (let i = 0; i < n; i++) { const y = PA[3 * i + 1]; if (y < 1.34 && y > roof && PA[3 * i] > -1 && PA[3 * i] < 0.8) roof = y; }
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const buildColors = (upper, neon) => {
    const col = new Float32Array(n * 3), cU = new THREE.Color(upper), cN = new THREE.Color(neon), cC = new THREE.Color("#07090c"), cG = new THREE.Color("#0a131c"), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = PA[3 * i], y = PA[3 * i + 1], z = PA[3 * i + 2], ny = NA ? NA[3 * i + 1] : 0, az = Math.abs(z);
      tmp.copy(cU).multiplyScalar(0.86 + 0.14 * clamp((y - 0.3) / 0.9, 0, 1));                       // degradê suave: mais claro em cima
      const wing = Math.max(sm(-1.9, -2.0, x) * sm(0.7, 0.8, y), 0), spl = sm(2.2, 2.3, x) * (1 - sm(0.3, 0.38, y)), ant = sm(1.3, 1.36, y);
      const low = 1 - sm(0.3, 0.42, y);                                                                // saia / assoalho em carbono
      const stripe = sm(0.17, 0.12, az) * sm(0.25, 0.5, ny) * sm(-2.1, -1.9, x) * (1 - sm(2.2, 2.3, x));   // faixa central
      const roofM = sm(roof - 0.1, roof - 0.02, y) * sm(0.2, 0.6, ny) * sm(-1.1, -1.0, x) * (1 - sm(0.8, 0.9, x));
      const glass = sm(0.82, 0.88, y) * (1 - sm(roof - 0.1, roof - 0.04, y)) * sm(-1.12, -1.02, x) * (1 - sm(0.78, 0.86, x)) * (1 - sm(0.82, 0.9, az)) * (1 - sm(0.45, 0.6, ny));
      const carbon = Math.max(low, wing, spl, ant, stripe, roofM);
      tmp.lerp(cC, carbon);
      tmp.lerp(cG, glass);
      // fios de neon: linha de caráter na lateral e bordas da faixa central
      const line = Math.exp(-(((y - 0.47) / 0.011) ** 2)) * sm(0.45, 0.6, az) * (1 - low * 0.0);
      const edge = (Math.exp(-(((az - 0.185) / 0.009) ** 2))) * sm(0.25, 0.5, ny) * sm(-2.0, -1.9, x) * (1 - sm(2.15, 2.25, x));
      tmp.lerp(cN, clamp(Math.max(line, edge) * 0.95, 0, 1));
      col[3 * i] = tmp.r; col[3 * i + 1] = tmp.g; col[3 * i + 2] = tmp.b;
    }
    return col;
  };
  const colorsPW = buildColors("#049a4c", "#5dffb0");
  const P = PROFILES[brand] || PROFILES.generic, colorsBrand = buildColors(P.paint, "#ffffff");
  g.setAttribute("color", new THREE.BufferAttribute(colorsPW.slice(), 3));
  const mk = (pred) => { let m = 0; for (let t = 0; t < T; t++) if (pred(t)) m++; const out = new Uint32Array(m * 3); let p = 0; for (let t = 0; t < T; t++) if (pred(t)) { out[p++] = idx[3 * t]; out[p++] = idx[3 * t + 1]; out[p++] = idx[3 * t + 2]; } return out; };
  const geo = (arr) => { const gg = new THREE.BufferGeometry(); gg.setAttribute("position", g.attributes.position); if (NA) gg.setAttribute("normal", g.attributes.normal); gg.setAttribute("color", g.attributes.color); gg.setIndex(new THREE.BufferAttribute(arr, 1)); return gg; };
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35 });      // acabamento acetinado: esconde as ondulações da malha de IA
  const rubber = new THREE.MeshStandardMaterial({ color: "#121316", roughness: 0.92 });
  const rimM = new THREE.MeshStandardMaterial({ color: "#222831", metalness: 0.85, roughness: 0.3 });
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const bm = new THREE.Mesh(geo(mk((t) => wheelOf[t] < 0 && !dropTri[t])), paint); bm.castShadow = true; bm.receiveShadow = true; body.add(bm);
  // decalques planos (número em círculo e nome), colados na altura da porta
  const decal = (w, h, draw, x, y, side) => {
    let zs = 0; for (let i = 0; i < n; i++) { if (Math.abs(PA[3 * i] - x) < 0.14 && Math.abs(PA[3 * i + 1] - y) < 0.07 && PA[3 * i + 2] * side > 0.5) zs = Math.max(zs, Math.abs(PA[3 * i + 2])); }
    if (!zs) return;
    const c = document.createElement("canvas"); c.width = 512; c.height = Math.round(512 * h / w); const cx = c.getContext("2d"); draw(cx, c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    m.position.set(x, y, side * (zs + 0.006)); if (side < 0) m.rotation.y = Math.PI; body.add(m);
  };
  const num = { porsche: "91", ferrari: "71", lamborghini: "63", mclaren: "59", audi: "29", honda: "30", bmw: "46", mercedes: "88", aston: "7", ford: "64", corvette: "3", nissan: "23", lexus: "14", bentley: "8" }[brand] || "9";
  for (const sd of [-1, 1]) {
    decal(0.36, 0.36, (cx, w, h) => { cx.fillStyle = "#f4f7fa"; cx.beginPath(); cx.arc(w / 2, h / 2, w * 0.47, 0, 7); cx.fill(); cx.lineWidth = 16; cx.strokeStyle = "#19c37d"; cx.stroke(); cx.fillStyle = "#070a0e"; cx.font = "italic 800 260px system-ui, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText(num, w / 2, h / 2 + 14); }, 0.35, 0.62, sd);
    decal(0.9, 0.16, (cx, w, h) => { cx.fillStyle = "#ffffff"; cx.font = "italic 800 120px system-ui, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText("PITWALL", w / 2, h / 2); }, -0.2, 0.34, sd);
  }
  const carbonM = new THREE.MeshStandardMaterial({ color: "#0b0e12" });
  const splitter = new THREE.Group();                      // o splitter da malha não tem peça própria: o ajuste só aparece nos valores
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = centers[i], piv = new THREE.Group(); piv.position.set(cx, R, cz); root.add(piv);
    const tire = new THREE.Mesh(geo(mk((t) => wheelOf[t] === i && tireTri[t])), rubber), rim = new THREE.Mesh(geo(mk((t) => wheelOf[t] === i && !tireTri[t])), rimM);
    for (const me of [tire, rim]) { me.position.set(-cx, -R, -cz); me.castShadow = true; piv.add(me); }
    const dummy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    corners.push({ piv, ax: cx, z: cz, side: Math.sign(cz) || 1, front: i < 2, g: piv, tire, ring: dummy, disc: dummy, cal: dummy, barrel: dummy });
  }
  const keep = new Map(); [paint, rubber, rimM, carbonM].forEach((m) => keep.set(m, { t: m.transparent, o: m.opacity, d: m.depthWrite }));
  body.traverse((o) => { if (o.isMesh && o.material.map) keep.set(o.material, { t: true, o: 1, d: false }); });
  const restyle = (mode) => { const c = mode === "pitwall" ? colorsPW : colorsBrand; g.attributes.color.array.set(c); g.attributes.color.needsUpdate = true; };
  return { isModel: true, isRaw: true, restyle, root, body, P, corners, wing: new THREE.Group(), wingGroup: new THREE.Group(), splitter, ducts: [], dashLed: { material: { emissiveIntensity: 1 } },
    modelMats: keep, paint: null, paintPlain: null, carbon: null, dark: null, bodyMats: [], cabinMeshes: [], glass: null };
}

// ------------------------------------------------------------------ modelo .glb do próprio usuário (opcional)
// Procura rodas/discos/suspensão pelos nomes (WHEEL_LF, DISC_RF, SUSP_LR...), alinha o modelo às medidas do editor
// e prende as peças em pivôs para a cambagem, a convergência e a altura mexerem de verdade.
async function adoptModel(url, onProgress, brand) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url, (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); });
  const model = gltf.scene, root = new THREE.Group(), body = new THREE.Group();
  const align = new THREE.Group(); align.add(model); root.add(align);
  model.updateMatrixWorld(true);
  const find = (rx) => { let r = null; model.traverse((o) => { if (!r && rx.test(o.name)) r = o; }); return r; };
  const wn = { LF: find(/^WHEEL_LF/), RF: find(/^WHEEL_RF/), LR: find(/^WHEEL_LR/), RR: find(/^WHEEL_RR/) };
  if (!wn.LF || !wn.RF || !wn.LR || !wn.RR) return adoptRaw(gltf, brand);          // malha única: separa as rodas por geometria
  const ctr = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const c = Object.fromEntries(Object.entries(wn).map(([k, o]) => [k, ctr(o)]));
  const fwd = new THREE.Vector3().addVectors(c.LF, c.RF).sub(new THREE.Vector3().addVectors(c.LR, c.RR)).setY(0).normalize();     // trás -> frente
  const right = new THREE.Vector3().subVectors(c.RF, c.LF).setY(0).normalize();                                                      // esquerda -> direita
  const up = new THREE.Vector3(0, 1, 0);
  right.sub(fwd.clone().multiplyScalar(right.dot(fwd))).normalize();
  // se o sistema for espelhado em relação ao nosso (frente x cima != direita), refletimos o eixo lateral
  const mirrored = new THREE.Vector3().crossVectors(fwd, up).dot(right) < 0;
  const B = new THREE.Matrix4().makeBasis(fwd, up, mirrored ? right.clone().negate() : right);
  const T = B.clone().transpose();
  align.applyMatrix4(T);
  if (mirrored) align.scale.z *= -1;
  align.updateMatrixWorld(true);
  const c2 = Object.fromEntries(Object.entries(wn).map(([k, o]) => [k, ctr(o)]));
  const wbModel = (c2.LF.x + c2.RF.x) / 2 - (c2.LR.x + c2.RR.x) / 2;
  const k = (WB.front - WB.rear) / wbModel;
  align.scale.multiplyScalar(k); align.updateMatrixWorld(true);
  const c3 = Object.fromEntries(Object.entries(wn).map(([kk, o]) => [kk, ctr(o)]));
  const box = new THREE.Box3().setFromObject(align);
  align.position.set(WB.front - (c3.LF.x + c3.RF.x) / 2, -box.min.y, -(c3.LF.z + c3.RF.z + c3.LR.z + c3.RR.z) / 4);
  align.updateMatrixWorld(true);
  // pivôs das rodas: roda + disco + suspensão giram juntos (cambagem/convergência)
  const corners = [], moved = new Set();
  const order = [["LF", 0], ["RF", 1], ["LR", 2], ["RR", 3]];
  for (const [key, idx] of order) {
    const wheel = wn[key], disc = find(new RegExp("^DISC_" + key)), susp = find(new RegExp("^SUSP_" + key));
    const ce = ctr(wheel), piv = new THREE.Group(); piv.position.copy(ce); root.add(piv); piv.updateMatrixWorld(true);
    for (const o of [wheel, disc, susp]) if (o) { piv.attach(o); moved.add(o); }
    let tire = null, discMesh = null;
    wheel.traverse((o) => { if (!tire && /^GEO_TIRE/.test(o.name)) tire = o; });
    (disc || piv).traverse((o) => { if (!discMesh && o.isMesh) discMesh = o; });
    if (discMesh) { discMesh.material = discMesh.material.clone(); discMesh.material.emissive = new THREE.Color("#ff5a1a"); discMesh.material.emissiveIntensity = 0; }
    const dummy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());       // pontos que o editor atualiza e que o modelo não tem
    corners.push({ piv, ax: ce.x, z: ce.z, side: Math.sign(ce.z) || 1, front: ce.x > 0, g: piv, tire: tire || dummy, ring: dummy, disc: discMesh || dummy, cal: dummy, barrel: dummy });
  }
  // todo o resto é a carroceria (sobe, desce e inclina com a altura)
  root.add(body);
  for (const ch of [...align.children]) body.attach(ch);
  const materials = new Set();
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m)); } });
  corners.forEach((cn) => cn.piv.traverse((o) => { if (o.isMesh) { o.castShadow = true; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m)); } }));
  const wingGroup = new THREE.Group(), wing = new THREE.Group(), splitter = new THREE.Group();
  const keep = new Map(); materials.forEach((m) => keep.set(m, { t: m.transparent, o: m.opacity, d: m.depthWrite }));
  const restyle = makeRestyle(model, null);
  return { isModel: true, restyle, root, body, P: PROFILES.generic, corners, wing, wingGroup, splitter, ducts: [], dashLed: { material: { emissiveIntensity: 1 } }, modelMats: keep,
    paint: null, paintPlain: null, carbon: null, dark: null, bodyMats: [], cabinMeshes: [], glass: null };
}

// ------------------------------------------------------------------ palco (cena, câmera, pontos, ao vivo)
export async function createStage(host, opts) {
  const { brand, items, spots, onHover, onSelect } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9; renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement); renderer.domElement.className = "sc3d-canvas";
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene(); env.background = new THREE.Color("#0b0f15");
  const glow = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide });
  const panel = (w, h, pos, rot, m) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(...pos); p.rotation.set(...rot); env.add(p); };
  for (const x of [-6, 0, 6]) panel(2.2, 24, [x, 9, 0], [Math.PI / 2, 0, 0], glow("#ffffff", 7));            // faixas de luz no teto
  panel(14, 6, [0, 4, -11], [0, 0, 0], glow("#cfe6ff", 2.6)); panel(14, 6, [0, 4, 11], [0, Math.PI, 0], glow("#ffe9d2", 2.2));   // softboxes dos lados
  panel(5, 8, [-12, 3, 0], [0, Math.PI / 2, 0], glow("#9fc2ff", 1.8)); panel(5, 8, [12, 3, 0], [0, -Math.PI / 2, 0], glow("#ffffff", 1.8));
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: "#05070a" })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.2; env.add(gnd);
  scene.environment = pm.fromScene(env, 0.015).texture;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60); camera.position.set(-5.4, 2.0, 4.7);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.5, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.5; controls.maxDistance = 11; controls.maxPolarAngle = Math.PI * 0.495; controls.update();
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 }); sun.shadow.bias = -0.0004; scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9ec5ff, 0x10151c, 0.35));
  const rim = new THREE.DirectionalLight(0x2ee59d, 0.25); rim.position.set(4, 2, -4); scene.add(rim);
  // chão: espelho (reflete o carro) com uma camada escura translúcida por cima e um anel de brilho
  const mirror = new Reflector(new THREE.CircleGeometry(9, 64), { color: 0x9aa4b0, textureWidth: 1024, textureHeight: 1024, clipBias: 0.003 });
  mirror.rotation.x = -Math.PI / 2; mirror.position.y = -0.003; scene.add(mirror);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: "#04060a", roughness: 0.7, metalness: 0, transparent: true, opacity: 0.88 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const glow2 = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.74, 120), new THREE.MeshBasicMaterial({ color: "#2ee59d", transparent: true, opacity: 0.22 })); glow2.rotation.x = -Math.PI / 2; glow2.position.y = 0.004; scene.add(glow2);

  let car = null;
  if (opts.modelUrl) { try { car = await adoptModel(opts.modelUrl, opts.onProgress, brand); } catch (e) { console.warn("modelo 3D local indisponível, usando o carro por código:", e); } }
  if (!car) car = buildCar(brand, scene); else car.P = PROFILES[brand] || PROFILES.generic;
  scene.add(car.root);
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
      if (!car.isModel) c.tire.scale.set(k, 1, k);                                                       // lateral do pneu: mais pressão = mais "cheio"
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
    if (car.isModel) { car.modelMats.forEach((st, m) => { m.transparent = on ? true : st.t; m.opacity = on ? Math.min(st.o, 0.1) : st.o; m.depthWrite = on ? false : st.d; m.needsUpdate = true; }); sus.grp.visible = on; return; }
    for (const m of [car.paint, car.paintPlain, car.carbon, car.dark, ...(car.bodyMats || [])]) { m.transparent = true; m.depthWrite = !on; m.opacity = on ? 0.10 : 1; }
    car.cabinMeshes.forEach((m) => { if (m.material === car.glass) { m.material.opacity = on ? 0.05 : 0.78; } });
    car.corners.forEach((c) => { c.tire.material.transparent = true; c.tire.material.opacity = on ? 0.4 : 1; c.tire.material.depthWrite = !on; });
    sus.grp.visible = on;
  }
  setXray(false);
  if (car.isModel) car.restyle(opts.paint || "pitwall"); else car.setScheme(opts.paint || "pitwall");

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
  // qualidade automática: em PCs fracos (menos de ~22 quadros por segundo) desliga o piso espelhado e as sombras
  let fN = 0, fSum = 0, fLast = performance.now(), degraded = false;
  function frame() {
    if (!alive) return; raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = now - fLast; fLast = now;
    if (!degraded && dt < 500) { fN++; fSum += dt; if (fN === 90) { if (fSum / fN > 45) { degraded = true; mirror.visible = false; floor.material.opacity = 1; renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); resize(); scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } }); console.info("editor 3D: qualidade reduzida (" + Math.round(fSum / fN) + " ms por quadro)"); } fN = 91; } }
    if (tween) { tween.t = Math.min(1, tween.t + 0.045); const e = 1 - Math.pow(1 - tween.t, 3); camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (tween.t >= 1) tween = null; }
    controls.update(); renderer.render(scene, camera); project();
  }
  apply(); frame();
  return {
    isModel: !!car.isModel, isRaw: !!car.isRaw, setPaint(mode) { if (car.isModel) car.restyle(mode); else car.setScheme(mode === "pitwall" ? "pitwall" : "brand"); },
    setEdits(e) { for (const k of Object.keys(edits)) delete edits[k]; Object.assign(edits, e); apply(); },
    setXray, view, els, destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); host.innerHTML = ""; },
    get xray() { return xray; }, renderer, scene, camera, car, sus,
  };
}
export const brandProfiles = PROFILES;
