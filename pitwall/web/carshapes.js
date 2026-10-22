"use strict";
// Carrinhos vistos de cima (frente para cima) por tipo de classe e a tabela do que cada plano libera nas opções dos overlays.
// Usado pelas páginas dos overlays (overlay.js) e pela tela de opções do Radar (app.js).

const CAR_KINDS = [["formula", "Fórmula"], ["proto", "Protótipo (LMP, Hypercar)"], ["gt3", "GT3 / GTE"], ["gt4", "GT4"], ["touring", "Turismo (TCR)"]];
const CAR_RATIO = { formula: 0.64, proto: 0.4, gt3: 0.46, gt4: 0.44, touring: 0.47 };

// descobre o tipo pelo texto da classe e do modelo do carro (ACC e iRacing)
function carKindOf(info) {
  const t = `${info && info.cls || ""} ${info && info.model || ""} ${info && info.brand || ""} ${info && info.car || ""}`.toLowerCase();
  if (/formula|\bf[1-4]\b|\bfr\b|indy|dallara|super ?formula|\bsf\b|mazda mx.?5 cup.*open/.test(t)) return "formula";
  if (/lmp|lmdh|hypercar|prototype|protótipo|gtp|\bdpi\b|ligier|oreca|daytona/.test(t)) return "proto";
  if (/gt4/.test(t)) return "gt4";
  if (/tcr|touring|turismo|bmw m2|cup/.test(t)) return "touring";
  return "gt3";
}

// ---- desenho dos carros: vetor com curvas suaves, volume (sombra e brilho), vidros com reflexo, rodas com pneu e aro, faróis, lanternas e aerodinâmica
const _rgbCache = {};
function _rgb(ctx, col) {                                         // qualquer cor CSS -> [r, g, b]
  if (_rgbCache[col]) return _rgbCache[col];
  const p = ctx.fillStyle; ctx.fillStyle = "#000"; ctx.fillStyle = col;
  const s = String(ctx.fillStyle); ctx.fillStyle = p;
  let m = s.match(/^#([0-9a-f]{6})$/i), v;
  if (m) v = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  else { m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); v = m ? [+m[1], +m[2], +m[3]] : [200, 200, 200]; }
  return (_rgbCache[col] = v);
}
const _mix = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

function _spline(ctx, pts) {                                       // curva fechada suave (Catmull-Rom) passando pelos pontos
  const n = pts.length;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  ctx.closePath();
}
const _both = (half) => [...half, ...half.slice(1, -1).reverse().map(([u, v]) => [-u, v])];     // metade direita -> contorno completo

// contornos (u = fração da meia-largura, v = 0 frente ... 1 traseira)
const CAR_BODY = {
  gt3: [[0, 0], [.42, .012], [.70, .05], [.85, .12], [.91, .23], [.92, .35], [.87, .46], [.89, .57], [.97, .70], [.97, .82], [.89, .94], [.55, .99], [0, 1]],
  gt4: [[0, 0], [.40, .012], [.68, .05], [.82, .12], [.88, .24], [.89, .36], [.85, .47], [.87, .58], [.93, .71], [.93, .83], [.86, .94], [.55, .99], [0, 1]],
  touring: [[0, 0], [.44, .012], [.72, .05], [.86, .12], [.90, .22], [.91, .40], [.91, .60], [.92, .78], [.89, .92], [.60, .985], [0, 1]],
  proto: [[0, 0], [.22, .01], [.52, .06], [.78, .16], [.92, .30], [.95, .45], [.93, .62], [.85, .78], [.68, .90], [.38, .975], [0, 1]],
  formula: [[0, .05], [.06, .06], [.12, .20], [.17, .32], [.30, .38], [.36, .50], [.34, .64], [.24, .77], [.14, .88], [.08, .95], [0, .965]],
};

// quatro desenhos para cada classe (o radar escolhe sozinho pelo modelo do carro ou você escolhe nas opções do Radar)
const CAR_VARIANTS = {
  formula: [{ name: "Clássico" }, { name: "Moderno", side: 1.15, fin: true, haloW: 1.5 }, { name: "Antigo", halo: false, airbox: true, fw: 0.85, rw: 0.8 }, { name: "Indy", fw: 1.0, rw: 1.15, side: 0.9, stripe: "center" }],
  proto: [{ name: "Hypercar" }, { name: "LMP2", ws: 0.93, finH: 1.5 }, { name: "Bolha", bubble: 1.35, ws: 0.97 }, { name: "Longtail", ws: 0.9, tail: true, finH: 1.2 }],
  gt3: [{ name: "Clássico", vents: true }, { name: "Largo", flare: true, canard: true, stripe: "twin", vents: true }, { name: "Aero", wing: "swan", stripe: "center", scoop: true, ws: 0.97 }, { name: "Esportivo", wing: "low", stripe: "side", ws: 0.94, cabS: 0.26, cabE: 0.7 }],
  gt4: [{ name: "Clássico", vents: true }, { name: "Compacto", ws: 0.9, wing: "low" }, { name: "Listrado", stripe: "twin", vents: true }, { name: "Aero", wing: "swan", scoop: true, canard: true }],
  touring: [{ name: "Sedã" }, { name: "Hatch", cabE: 0.74, ws: 0.95 }, { name: "Cupê", cabS: 0.3, cabE: 0.7, ws: 0.96, stripe: "center" }, { name: "Perua", cabE: 0.86, ws: 0.97 }],
};
const carVariantName = (kind, v) => ((CAR_VARIANTS[kind] || [])[v] || {}).name || "";
// automático: o desenho varia pelo modelo do carro (carros diferentes ficam diferentes no radar)
function carAutoVariant(info) {
  const t = `${info && info.brand || ""}${info && info.model || ""}${info && info.car || ""}`;
  let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h % 4;
}

// ---- carrinhos especiais (diversão): Uno com escada, Fusca, Kombi, Táxi e Viatura
const CAR_SPECIALS = [["uno", "Uno com escada"], ["fusca", "Fusca"], ["kombi", "Kombi"], ["taxi", "Táxi"], ["viatura", "Viatura"]];
const SPECIAL_RATIO = { uno: 0.5, fusca: 0.5, kombi: 0.46, taxi: 0.47, viatura: 0.47 };

function drawSpecial(ctx, cx, cy, h, col, o) {
  const sp = o.special;
  if (sp === "taxi" || sp === "viatura") {                                  // sedã com pintura e acessórios próprios
    const taxi = sp === "taxi";
    drawCar(ctx, cx, cy, h, taxi ? "#ffcf24" : "#1d222c", { ...o, special: null, kind: "touring", variant: 0, hi: taxi ? "#fff3b0" : "#3a4254", label: null });
    const w = h * 0.47, X = (u) => cx + u * w / 2, Y = (v) => cy - h / 2 + v * h, rr = (a, b, c, d, r) => { ctx.beginPath(); ctx.roundRect(a, b, c, d, r); };
    ctx.save();
    if (taxi) {
      ctx.fillStyle = "#101318";                                                                     // faixa quadriculada nas laterais
      const n = 9, sq = h * 0.54 / n;
      for (const s of [-1, 1]) for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? "#111" : "#fff"; ctx.fillRect(X(s * 0.9) - w * 0.03, Y(0.3) + i * sq, w * 0.06, sq); }
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = Math.max(1, h * 0.02); rr(X(-0.3), Y(0.5), w * 0.3, h * 0.07, h * 0.015); ctx.fill(); ctx.stroke();   // luminoso do teto
      ctx.fillStyle = "#101318"; ctx.font = `800 ${Math.max(6, h * 0.05)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; if (h > 60) ctx.fillText("TÁXI", cx, Y(0.535));
    } else {
      ctx.fillStyle = "rgba(255,255,255,.95)";                                                       // portas e capô brancos
      for (const s of [-1, 1]) rr(X(s * 0.9) - w * 0.065, Y(0.36), w * 0.13, h * 0.32, w * 0.03), ctx.fill();
      rr(X(-0.12), Y(0.04), w * 0.12, h * 0.2, w * 0.03); ctx.fill();
      const ph = Math.floor(performance.now() / 160) % 2;                                            // giroflex piscando
      const bar = (u0, c1, on) => { ctx.fillStyle = on ? c1 : "rgba(60,60,70,.9)"; if (on) { ctx.shadowColor = c1; ctx.shadowBlur = h * 0.22; } rr(X(u0), Y(0.48), w * 0.26, h * 0.06, h * 0.015); ctx.fill(); ctx.shadowBlur = 0; };
      bar(-0.3, "#ff2f45", ph === 0); bar(0.0, "#3d8bff", ph === 1);
    }
    ctx.restore();
    return;
  }
  const w = h * SPECIAL_RATIO[sp], rgb = _rgb(ctx, col);
  const X = (u) => cx + u * w / 2, Y = (v) => cy - h / 2 + v * h, lw = Math.max(0.8, h * 0.022), WHITE = [255, 255, 255], BLACK = [8, 10, 14], edge = "rgba(0,0,0,.8)", dark = "#0a0c10";
  const rr = (a, b, c, d, r) => { ctx.beginPath(); ctx.roundRect(a, b, c, d, r); };
  const paint = (pathFn, c) => {                                                                       // sombra, volume e contorno
    const r = _rgb(ctx, c);
    pathFn(); ctx.save(); ctx.shadowColor = o.glow || "rgba(0,0,0,.55)"; ctx.shadowBlur = o.glow ? h * 0.16 : h * 0.07; ctx.shadowOffsetY = o.glow ? 0 : h * 0.02; ctx.fillStyle = c; ctx.fill(); ctx.restore();
    const g = ctx.createLinearGradient(X(-1), 0, X(1), 0); g.addColorStop(0, _mix(r, BLACK, 0.42)); g.addColorStop(0.5, _mix(r, WHITE, 0.3)); g.addColorStop(1, _mix(r, BLACK, 0.42));
    ctx.fillStyle = g; pathFn(); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = lw; pathFn(); ctx.stroke();
  };
  const wheel = (u, v, ww, hh) => { ctx.fillStyle = dark; rr(X(u) - ww / 2, Y(v) - hh / 2, ww, hh, ww * 0.3); ctx.fill(); ctx.fillStyle = "rgba(150,160,175,.5)"; rr(X(u) - ww * 0.2, Y(v) - hh * 0.3, ww * 0.4, hh * 0.6, ww * 0.15); ctx.fill(); };
  const poly = (pts) => () => { ctx.beginPath(); pts.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.closePath(); };
  const glassFill = (pathFn) => { pathFn(); const g = ctx.createLinearGradient(0, Y(0.25), 0, Y(0.8)); g.addColorStop(0, "rgba(40,70,110,.95)"); g.addColorStop(1, "rgba(6,12,24,.97)"); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw * 0.7; ctx.stroke(); };
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";

  if (sp === "uno") {
    for (const s of [-1, 1]) { wheel(s * 0.97, 0.2, w * 0.15, h * 0.17); wheel(s * 0.97, 0.78, w * 0.15, h * 0.17); }
    paint(() => rr(X(-0.9), Y(0), w * 0.9, h, [w * 0.3, w * 0.3, w * 0.16, w * 0.16]), col);
    ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(X(-0.6), Y(0.28)); ctx.lineTo(X(-0.6), Y(0.05)); ctx.moveTo(X(0.6), Y(0.28)); ctx.lineTo(X(0.6), Y(0.05)); ctx.stroke();      // vincos do capô
    glassFill(poly([[-0.68, 0.3], [0.68, 0.3], [0.76, 0.46], [-0.76, 0.46]]));
    ctx.fillStyle = _mix(rgb, WHITE, 0.2); rr(X(-0.74), Y(0.46), w * 0.74, h * 0.27, w * 0.05); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = lw * 0.6; ctx.stroke();                          // teto
    glassFill(poly([[-0.7, 0.73], [0.7, 0.73], [0.62, 0.84], [-0.62, 0.84]]));
    ctx.fillStyle = "#fff6c8"; rr(X(-0.82), Y(0.025), w * 0.3, h * 0.03, h * 0.012); ctx.fill(); rr(X(0.22), Y(0.025), w * 0.3, h * 0.03, h * 0.012); ctx.fill();
    ctx.fillStyle = "#ff3b4e"; rr(X(-0.86), Y(0.93), w * 0.16, h * 0.05, h * 0.012); ctx.fill(); rr(X(0.54), Y(0.93), w * 0.16, h * 0.05, h * 0.012); ctx.fill();
    // a escada no teto, saindo pela traseira
    ctx.fillStyle = "#2a2f38"; for (const v of [0.5, 0.7]) { rr(X(-0.86), Y(v), w * 0.86, h * 0.02, h * 0.008); ctx.fill(); }          // bagageiro
    const L = (u) => X(u) - w * 0.018, top = Y(0.2), bot = Y(1.1);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = h * 0.03; ctx.shadowOffsetY = h * 0.012;
    ctx.fillStyle = "#cfd6e2"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = lw * 0.7;
    for (const u of [-0.42, 0.42]) { rr(L(u), top, w * 0.036, bot - top, w * 0.012); ctx.fill(); ctx.stroke(); }
    const rungs = 9; for (let i = 0; i <= rungs; i++) { const y = top + (bot - top) * (i / rungs); rr(X(-0.42), y - h * 0.008, w * 0.42, h * 0.016, h * 0.005); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "#e04b4b"; rr(X(-0.5) - w * 0.01, Y(1.02), w * 0.5 + w * 0.02, h * 0.03, h * 0.008); ctx.fill();                            // bandeirinha vermelha na ponta
  } else if (sp === "fusca") {
    for (const s of [-1, 1]) { wheel(s * 0.98, 0.2, w * 0.15, h * 0.17); wheel(s * 0.98, 0.76, w * 0.15, h * 0.17); }
    paint(() => { const half = [[0, 0], [.42, .02], [.74, .1], [.9, .24], [.94, .42], [.92, .62], [.84, .82], [.6, .96], [0, 1]]; _spline(ctx, [...half, ...half.slice(1, -1).reverse().map(([u, v]) => [-u, v])].map(([u, v]) => [X(u), Y(v)])); }, col);
    ctx.fillStyle = "rgba(255,255,255,.16)"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(X(s * 0.8), Y(0.2), w * 0.12, h * 0.1, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(X(s * 0.8), Y(0.74), w * 0.12, h * 0.1, 0, 0, 7); ctx.fill(); }       // paralamas
    glassFill(() => _spline(ctx, [[X(0), Y(0.3)], [X(0.52), Y(0.36)], [X(0.58), Y(0.55)], [X(0.46), Y(0.74)], [X(-0.46), Y(0.74)], [X(-0.58), Y(0.55)], [X(-0.52), Y(0.36)]]));
    ctx.fillStyle = _mix(rgb, WHITE, 0.22); ctx.beginPath(); ctx.ellipse(X(0), Y(0.55), w * 0.26, h * 0.12, 0, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = lw * 0.6; ctx.stroke();
    ctx.fillStyle = "#fffbe0"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(X(s * 0.6), Y(0.085), w * 0.07, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw * 0.6; ctx.stroke(); }
    ctx.fillStyle = "#ff3b4e"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(X(s * 0.52), Y(0.94), w * 0.045, 0, 7); ctx.fill(); }
    ctx.strokeStyle = "rgba(220,226,236,.9)"; ctx.lineWidth = lw * 0.9; ctx.beginPath(); ctx.arc(X(0), Y(0.04), w * 0.5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();                          // para-choque
  } else {                                                                                               // kombi
    for (const s of [-1, 1]) { wheel(s * 0.97, 0.2, w * 0.15, h * 0.17); wheel(s * 0.97, 0.78, w * 0.15, h * 0.17); }
    paint(() => rr(X(-0.9), Y(0), w * 0.9, h, [w * 0.2, w * 0.2, w * 0.12, w * 0.12]), col);
    ctx.fillStyle = "#f4f1e6"; rr(X(-0.8), Y(0.1), w * 0.8, h * 0.82, w * 0.08); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 0.7; ctx.stroke();                              // teto branco
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = lw * 0.6; for (const v of [0.32, 0.5, 0.68]) { ctx.beginPath(); ctx.moveTo(X(-0.76), Y(v)); ctx.lineTo(X(0.76), Y(v)); ctx.stroke(); }      // nervuras do teto
    glassFill(poly([[-0.78, 0.12], [0.78, 0.12], [0.7, 0.25], [-0.7, 0.25]]));                                // para-brisa
    glassFill(poly([[-0.62, 0.86], [0.62, 0.86], [0.66, 0.92], [-0.66, 0.92]]));
    ctx.fillStyle = "#fffbe0"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(X(s * 0.55), Y(0.05), w * 0.075, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw * 0.6; ctx.stroke(); }
    ctx.strokeStyle = "rgba(235,240,248,.95)"; ctx.lineWidth = lw * 1.1; ctx.beginPath(); ctx.moveTo(X(-0.3), Y(0.02)); ctx.lineTo(X(0), Y(0.12)); ctx.lineTo(X(0.3), Y(0.02)); ctx.stroke();           // "V" cromado da nariz
    ctx.fillStyle = "#ff3b4e"; for (const s of [-1, 1]) rr(X(s * 0.84) - w * 0.03, Y(0.9), w * 0.06, h * 0.07, h * 0.012), ctx.fill();
  }
  if (o.label != null) { ctx.fillStyle = o.labelCol || "#fff"; ctx.strokeStyle = o.labelCol === "#0b0d10" ? "rgba(255,255,255,.6)" : "rgba(0,0,0,.7)"; ctx.lineWidth = 2; ctx.font = `800 ${Math.max(8, h * 0.19)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.strokeText(String(o.label), cx, Y(sp === "uno" ? 0.6 : 0.5)); ctx.fillText(String(o.label), cx, Y(sp === "uno" ? 0.6 : 0.5)); }
  ctx.restore();
}

function drawCar(ctx, cx, cy, h, col, o = {}) {
  if (o.special && SPECIAL_RATIO[o.special]) return drawSpecial(ctx, cx, cy, h, col, o);
  const kind = CAR_RATIO[o.kind] ? o.kind : "gt3", w = h * CAR_RATIO[kind], rgb = _rgb(ctx, col);
  const V = (CAR_VARIANTS[kind] || [])[(o.variant | 0) % 4] || {}, ws = V.ws || 1;
  const X = (u) => cx + u * ws * w / 2, XW = (u) => cx + u * w / 2, Y = (v) => cy - h / 2 + v * h, P = (half) => _both(half).map(([u, v]) => [X(u), Y(v)]);
  const WHITE = [255, 255, 255], BLACK = [8, 10, 14], dark = "#0a0c10", edge = "rgba(0,0,0,.8)";
  const lw = Math.max(0.8, h * 0.022);
  const rr = (a, b, c, d, r) => { ctx.beginPath(); ctx.roundRect(a, b, c, d, r); };
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";

  const body = (half, shadowCol) => {                                                  // carroceria: sombra projetada, volume e contorno
    _spline(ctx, P(half));
    ctx.save(); ctx.shadowColor = o.glow || shadowCol || "rgba(0,0,0,.55)"; ctx.shadowBlur = o.glow ? h * 0.16 : h * 0.07; ctx.shadowOffsetY = o.glow ? 0 : h * 0.02;
    ctx.fillStyle = col; ctx.fill(); ctx.restore();
    const gx = ctx.createLinearGradient(X(-1), 0, X(1), 0);                             // luz vindo de cima: centro claro, laterais escuras
    gx.addColorStop(0, _mix(rgb, BLACK, 0.42)); gx.addColorStop(0.22, _mix(rgb, WHITE, 0.04)); gx.addColorStop(0.5, o.hi ? _mix(_rgb(ctx, o.hi), WHITE, 0.12) : _mix(rgb, WHITE, 0.36));
    gx.addColorStop(0.78, _mix(rgb, WHITE, 0.04)); gx.addColorStop(1, _mix(rgb, BLACK, 0.42));
    ctx.fillStyle = gx; _spline(ctx, P(half)); ctx.fill();
    const gy = ctx.createLinearGradient(0, Y(0), 0, Y(1));                              // frente um pouco mais clara, traseira mais escura
    gy.addColorStop(0, "rgba(255,255,255,.16)"); gy.addColorStop(0.5, "rgba(255,255,255,0)"); gy.addColorStop(1, "rgba(0,0,0,.28)");
    ctx.fillStyle = gy; _spline(ctx, P(half)); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = lw; _spline(ctx, P(half)); ctx.stroke();
  };
  const wheel = (u, v, ww, hh) => {                                                    // pneu + aro + brilho
    const x = XW(u) - ww / 2, y = Y(v) - hh / 2;
    ctx.fillStyle = dark; rr(x, y, ww, hh, ww * 0.3); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + ww, 0); g.addColorStop(0, "rgba(255,255,255,.0)"); g.addColorStop(0.5, "rgba(255,255,255,.14)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; rr(x, y, ww, hh, ww * 0.3); ctx.fill();
    ctx.fillStyle = "rgba(150,160,175,.55)"; rr(x + ww * 0.3, y + hh * 0.2, ww * 0.4, hh * 0.6, ww * 0.18); ctx.fill();
  };
  const glass = (path) => {                                                            // vidro escuro com reflexo diagonal
    path(); const g = ctx.createLinearGradient(0, Y(0.3), 0, Y(0.75)); g.addColorStop(0, "rgba(40,70,110,.95)"); g.addColorStop(1, "rgba(6,12,24,.97)");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw * 0.7; ctx.stroke();
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.moveTo(X(-1), Y(0.34)); ctx.lineTo(X(-0.1), Y(0.34)); ctx.lineTo(X(-0.55), Y(0.62)); ctx.lineTo(X(-1), Y(0.62)); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const lights = (v0, u0, u1, hh, c1) => { ctx.fillStyle = c1; rr(X(u0), Y(v0), (u1 - u0) * ws * w / 2, hh, hh * 0.45); ctx.fill(); rr(X(-u1), Y(v0), (u1 - u0) * ws * w / 2, hh, hh * 0.45); ctx.fill(); };
  const stripe = (kindS, a = 0.5) => {                                                 // faixas de pintura
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    if (kindS === "center") rr(X(-0.05), Y(0.05), 0.1 * ws * w / 2, 0.88 * h, w * 0.02), ctx.fill();
    else if (kindS === "twin") { rr(X(-0.16), Y(0.05), 0.07 * ws * w / 2, 0.88 * h, w * 0.02); ctx.fill(); rr(X(0.09), Y(0.05), 0.07 * ws * w / 2, 0.88 * h, w * 0.02); ctx.fill(); }
    else if (kindS === "side") { rr(X(-0.78), Y(0.2), 0.07 * ws * w / 2, 0.66 * h, w * 0.02); ctx.fill(); rr(X(0.71), Y(0.2), 0.07 * ws * w / 2, 0.66 * h, w * 0.02); ctx.fill(); }
  };

  if (kind === "formula") {
    const ww = w * 0.2, fh = h * 0.19, rh = h * 0.23, fwS = V.fw || 1, rwS = V.rw || 1, sd = V.side || 1;
    wheel(-0.86, 0.16, ww, fh); wheel(0.86, 0.16, ww, fh); wheel(-0.9, 0.72, ww * 1.08, rh); wheel(0.9, 0.72, ww * 1.08, rh);
    ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw;                                    // asa dianteira
    const fwW = 0.96 * fwS; rr(XW(-fwW), Y(0.0), w * fwW, h * 0.05, h * 0.015); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; rr(XW(-fwW), Y(0.0), w * 0.09, h * 0.07, h * 0.012); ctx.fill(); rr(XW(fwW) - w * 0.09, Y(0.0), w * 0.09, h * 0.07, h * 0.012); ctx.fill();
    const rwW = 0.78 * rwS; ctx.fillStyle = "#171b22"; rr(XW(-rwW), Y(0.935), w * rwW, h * 0.065, h * 0.015); ctx.fill(); ctx.stroke();      // asa traseira
    ctx.fillStyle = col; rr(XW(-rwW) - w * 0.01, Y(0.925), w * 0.045, h * 0.085, h * 0.01); ctx.fill(); rr(XW(rwW) - w * 0.035, Y(0.925), w * 0.045, h * 0.085, h * 0.01); ctx.fill();
    ctx.fillStyle = "#171b22"; ctx.beginPath(); ctx.moveTo(XW(-0.55), Y(0.36)); ctx.lineTo(XW(-0.28), Y(0.4)); ctx.lineTo(XW(-0.28), Y(0.62)); ctx.lineTo(XW(-0.55), Y(0.7)); ctx.closePath(); ctx.fill();   // suspensão
    ctx.beginPath(); ctx.moveTo(XW(0.55), Y(0.36)); ctx.lineTo(XW(0.28), Y(0.4)); ctx.lineTo(XW(0.28), Y(0.62)); ctx.lineTo(XW(0.55), Y(0.7)); ctx.closePath(); ctx.fill();
    body(CAR_BODY.formula.map(([u, v]) => [u > 0.2 ? Math.min(0.5, u * sd) : u, v]));
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(XW(0), Y(0.1)); ctx.lineTo(XW(0), Y(0.93)); ctx.stroke();
    if (V.stripe) stripe(V.stripe, 0.45);
    ctx.fillStyle = "rgba(10,14,22,.92)"; ctx.beginPath(); ctx.ellipse(XW(0), Y(0.46), w * 0.075, h * 0.075, 0, 0, 7); ctx.fill();                                                           // cockpit
    ctx.fillStyle = o.helmet || "#ffd24a"; ctx.beginPath(); ctx.arc(XW(0), Y(0.47), w * 0.045, 0, 7); ctx.fill();
    if (V.halo !== false) { ctx.strokeStyle = "#14181f"; ctx.lineWidth = Math.max(1.2, w * 0.04 * (V.haloW || 1)); ctx.beginPath(); ctx.moveTo(XW(-0.17), Y(0.40)); ctx.quadraticCurveTo(XW(0), Y(0.35), XW(0.17), Y(0.40)); ctx.moveTo(XW(0), Y(0.36)); ctx.lineTo(XW(0), Y(0.31)); ctx.stroke(); }   // halo
    if (V.airbox) { ctx.fillStyle = "#14181f"; ctx.beginPath(); ctx.ellipse(XW(0), Y(0.57), w * 0.06, h * 0.05, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = "rgba(0,0,0,.45)"; rr(XW(-0.07), Y(0.54), w * 0.07, h * 0.3, w * 0.03); ctx.fill();
    if (V.fin) { ctx.fillStyle = "rgba(255,255,255,.55)"; rr(XW(-0.025), Y(0.6), w * 0.025, h * 0.3, w * 0.01); ctx.fill(); }
  } else if (kind === "proto") {
    const finH = V.finH || 1, bub = V.bubble || 1;
    wheel(-0.97, 0.22, w * 0.15, h * 0.17); wheel(0.97, 0.22, w * 0.15, h * 0.17); wheel(-0.97, 0.74, w * 0.17, h * 0.2); wheel(0.97, 0.74, w * 0.17, h * 0.2);
    body(CAR_BODY.proto.map(([u, v]) => (V.tail && v > 0.78 ? [u * 0.82, v] : [u, v])));
    ctx.fillStyle = "rgba(0,0,0,.35)";                                                                                        // grelhas dos para-lamas
    for (const s of [-1, 1]) { rr(X(s * 0.62) - w * 0.04, Y(0.15), w * 0.08, h * 0.1, w * 0.02); ctx.fill(); rr(X(s * 0.7) - w * 0.04, Y(0.67), w * 0.08, h * 0.12, w * 0.02); ctx.fill(); }
    glass(() => { _spline(ctx, [[X(0), Y(0.27)], [X(0.3 * bub), Y(0.33)], [X(0.34 * bub), Y(0.47)], [X(0.22 * bub), Y(0.58 + 0.02 * bub)], [X(-0.22 * bub), Y(0.58 + 0.02 * bub)], [X(-0.34 * bub), Y(0.47)], [X(-0.3 * bub), Y(0.33)]]); });
    ctx.fillStyle = "rgba(255,255,255,.28)"; rr(X(-0.03 * finH), Y(0.6), w * 0.06 * finH * 0.5, h * 0.3 * finH * 0.8, w * 0.02); ctx.fill();                      // aleta central
    ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw; rr(X(-0.88), Y(0.94), w * 0.88 * ws, h * 0.055, h * 0.015); ctx.fill(); ctx.stroke();   // asa traseira
    ctx.fillStyle = col; rr(X(-0.9), Y(0.92), w * 0.045, h * 0.08, h * 0.01); ctx.fill(); rr(X(0.81), Y(0.92), w * 0.045, h * 0.08, h * 0.01); ctx.fill();
    ctx.fillStyle = "#171b22"; rr(X(-0.4), Y(0.0), w * 0.4 * ws, h * 0.022, h * 0.01); ctx.fill();                                    // splitter
    lights(0.035, 0.2, 0.55, h * 0.025, "#fff6c8");
  } else {                                                                                                                  // gt3, gt4 e turismo
    const touring = kind === "touring", gt4 = kind === "gt4", f = gt4 ? 0.93 : 1, cs = V.cabS ?? 0.29, ce = V.cabE ?? (touring ? 0.78 : 0.73);
    wheel(-0.98 * f, 0.2, w * 0.15, h * 0.19); wheel(0.98 * f, 0.2, w * 0.15, h * 0.19); wheel(-0.99 * f, 0.74, w * 0.16, h * 0.2); wheel(0.99 * f, 0.74, w * 0.16, h * 0.2);
    if (!touring) { ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.8; const sp = V.flare ? 0.8 : 0.62; rr(X(-sp), Y(-0.002), w * sp * ws, h * 0.03, h * 0.012); ctx.fill(); }          // splitter
    body(CAR_BODY[kind]);
    ctx.strokeStyle = "rgba(0,0,0,.28)"; ctx.lineWidth = lw * 0.7;                                                           // recortes das portas e linha central
    ctx.beginPath(); ctx.moveTo(X(-0.7), Y(0.40)); ctx.lineTo(X(-0.7), Y(0.66)); ctx.moveTo(X(0.7), Y(0.40)); ctx.lineTo(X(0.7), Y(0.66)); ctx.stroke();
    if (V.stripe) stripe(V.stripe, 0.5);
    if (V.flare) { ctx.fillStyle = "rgba(255,255,255,.14)"; for (const s of [-1, 1]) { rr(X(s * 0.88) - w * 0.05, Y(0.12), w * 0.1, h * 0.17, w * 0.04); ctx.fill(); rr(X(s * 0.93) - w * 0.05, Y(0.66), w * 0.1, h * 0.19, w * 0.04); ctx.fill(); } }
    if (V.canard) { ctx.fillStyle = "#171b22"; for (const s of [-1, 1]) { rr(X(s * 0.8) - w * 0.05, Y(0.045), w * 0.1, h * 0.018, h * 0.008); ctx.fill(); } }
    if (V.vents) { ctx.fillStyle = "rgba(0,0,0,.38)"; for (const s of [-1, 1]) { rr(X(s * 0.3) - w * 0.045, Y(0.1), w * 0.09, h * 0.11, w * 0.02); ctx.fill(); } ctx.fillStyle = "rgba(255,255,255,.12)"; rr(X(-0.12), Y(0.04), w * 0.12 * ws, h * 0.22, w * 0.05); ctx.fill(); }
    if (V.scoop) { ctx.fillStyle = "rgba(0,0,0,.55)"; rr(X(-0.1), Y(0.5), w * 0.1 * ws, h * 0.06, w * 0.02); ctx.fill(); }                  // entrada de ar no teto
    // vidros e teto
    glass(() => { _spline(ctx, touring
      ? [[X(0), Y(cs - 0.04)], [X(0.62), Y(cs - 0.01)], [X(0.7), Y(cs + 0.17)], [X(0.68), Y(ce - 0.08)], [X(0.4), Y(ce)], [X(-0.4), Y(ce)], [X(-0.68), Y(ce - 0.08)], [X(-0.7), Y(cs + 0.17)], [X(-0.62), Y(cs - 0.01)]]
      : [[X(0), Y(cs)], [X(0.58), Y(cs + 0.03)], [X(0.64), Y(cs + 0.18)], [X(0.6), Y(ce - 0.07)], [X(0.36), Y(ce)], [X(-0.36), Y(ce)], [X(-0.6), Y(ce - 0.07)], [X(-0.64), Y(cs + 0.18)], [X(-0.58), Y(cs + 0.03)]]); });
    ctx.fillStyle = _mix(rgb, WHITE, 0.18); _spline(ctx, touring
      ? [[X(0), Y(cs + 0.14)], [X(0.48), Y(cs + 0.16)], [X(0.5), Y(ce - 0.18)], [X(0.3), Y(ce - 0.12)], [X(-0.3), Y(ce - 0.12)], [X(-0.5), Y(ce - 0.18)], [X(-0.48), Y(cs + 0.16)]]
      : [[X(0), Y(cs + 0.16)], [X(0.46), Y(cs + 0.18)], [X(0.46), Y(ce - 0.15)], [X(0.28), Y(ce - 0.1)], [X(-0.28), Y(ce - 0.1)], [X(-0.46), Y(ce - 0.15)], [X(-0.46), Y(cs + 0.18)]]); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 0.6; ctx.stroke();
    ctx.fillStyle = _mix(rgb, BLACK, 0.3); ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.7;                                   // retrovisores
    for (const s of [-1, 1]) { rr(X(s * 0.96) - w * 0.045, Y(cs + 0.08), w * 0.09, h * 0.045, w * 0.02); ctx.fill(); ctx.stroke(); }
    lights(0.04, 0.16, 0.5, h * 0.028, "#fff6c8");
    { const a = touring ? 0.46 : 0.62, wd = touring ? 0.22 : 0.3, vy = touring ? 0.945 : 0.955; ctx.fillStyle = "#ff3b4e"; rr(X(-a), Y(vy), w * wd * 0.9 * ws, h * 0.026, h * 0.01); ctx.fill(); rr(X(a) - w * wd * 0.9 * ws, Y(vy), w * wd * 0.9 * ws, h * 0.026, h * 0.01); ctx.fill(); }   // lanternas
    const wingT = V.wing || (touring ? "spoiler" : "wide");
    if (wingT === "wide" || wingT === "swan") {                                                                             // asa traseira (a "swan" fica elevada, presa por dois suportes)
      const ww = gt4 ? 0.82 : 1.0, y0 = wingT === "swan" ? 0.9 : 0.925;
      ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.9;
      if (wingT === "swan") { ctx.fillStyle = "rgba(0,0,0,.55)"; rr(X(-0.3), Y(0.8), w * 0.05, h * 0.12, w * 0.01); ctx.fill(); rr(X(0.25), Y(0.8), w * 0.05, h * 0.12, w * 0.01); ctx.fill(); ctx.fillStyle = "#171b22"; }
      rr(X(-ww), Y(y0), w * ww * ws, h * 0.06, h * 0.015); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; rr(X(-ww) - w * 0.012, Y(y0 - 0.015), w * 0.04, h * 0.09, h * 0.01); ctx.fill(); rr(X(ww) - w * 0.028, Y(y0 - 0.015), w * 0.04, h * 0.09, h * 0.01); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(X(-ww) + w * 0.02, Y(y0 + 0.005), w * ww * ws - w * 0.04, h * 0.008);
    } else if (wingT === "low") { ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; rr(X(-0.7), Y(0.945), w * 0.7 * ws, h * 0.04, h * 0.012); ctx.fill(); ctx.stroke(); }
    else { ctx.fillStyle = "#171b22"; rr(X(-0.55), Y(0.935), w * 0.55 * ws, h * 0.03, h * 0.01); ctx.fill(); }
  }
  if (o.label != null) { ctx.fillStyle = o.labelCol || "#fff"; ctx.strokeStyle = o.labelCol === "#0b0d10" ? "rgba(255,255,255,.6)" : "rgba(0,0,0,.7)"; ctx.lineWidth = 2; ctx.font = `800 ${Math.max(8, h * 0.19)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.strokeText(String(o.label), cx, Y(0.545)); ctx.fillText(String(o.label), cx, Y(0.545)); }
  ctx.restore();
}

// ---- o que cada plano libera nas opções de cada overlay ------------------------------------------------------
// Sem o recurso, a opção volta ao valor da coluna "Grátis" (valor abaixo). Tudo isto é do plano Pro (o Equipe inclui o Pro).
const OPT_FEATURE = "overlay_custom", OPT_FEATURE_TEAM = "overlay_styles";          // escolher o carrinho de cada classe agora também é do Pro
const OPT_LOCK = {
  map: { width: 9, rotate: 0, fzoom: 350, brakepts: false, corners: false, corner_now: false, numbers: false },
  pedals: { seconds: 8, steer: false, coast: false, wheel: false },
  standings: { rows: 10, view: "around", name: "short", cols: ["pos", "number", "name", "vs_me", "best"], carstyle: "both", logomode: "color", trendcolor: false, classpos: false, others: 3, trend_secs: 25 },
  delta: { predicted: false, fuel: false },
  corner: { lead: 250, speed: false, next: false, name: false, brakepoint: false },
  tyres: { brake: false, pads: false, wear: false, compound: false, weather: false, tmin: 70, tmax: 100, pmin: 26, pmax: 27, bmin: 350, bmax: 800, punit: "psi" },
  radar: { range: 40, gap: false, numbers: false, carcolor: "heat", carstatic: "#f4f7ff", showmode: "always", nearm: 30, special: null, specialfor: "me" },
  blindl: { always: true }, blindr: { always: true },
};
const OPT_LOCK_TEAM = { radar: { carmap: null } };                    // escolher o carrinho de cada classe: Pro
