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

function drawCar(ctx, cx, cy, h, col, o = {}) {
  const kind = CAR_RATIO[o.kind] ? o.kind : "gt3", w = h * CAR_RATIO[kind], rgb = _rgb(ctx, col);
  const X = (u) => cx + u * w / 2, Y = (v) => cy - h / 2 + v * h, P = (half) => _both(half).map(([u, v]) => [X(u), Y(v)]);
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
    const x = X(u) - ww / 2, y = Y(v) - hh / 2;
    ctx.fillStyle = dark; rr(x, y, ww, hh, ww * 0.3); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + ww, 0); g.addColorStop(0, "rgba(255,255,255,.0)"); g.addColorStop(0.5, "rgba(255,255,255,.14)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; rr(x, y, ww, hh, ww * 0.3); ctx.fill();
    ctx.fillStyle = "rgba(150,160,175,.55)"; rr(x + ww * 0.3, y + hh * 0.2, ww * 0.4, hh * 0.6, ww * 0.18); ctx.fill();
  };
  const glass = (path, strong) => {                                                    // vidro escuro com reflexo diagonal
    path(); const g = ctx.createLinearGradient(0, Y(0.3), 0, Y(0.75)); g.addColorStop(0, "rgba(40,70,110,.95)"); g.addColorStop(1, "rgba(6,12,24,.97)");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw * 0.7; ctx.stroke();
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.moveTo(X(-1), Y(0.34)); ctx.lineTo(X(-0.1), Y(0.34)); ctx.lineTo(X(-0.55), Y(0.62)); ctx.lineTo(X(-1), Y(0.62)); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const lights = (v0, u0, u1, hh, c1, c2) => { ctx.fillStyle = c1; rr(X(u0), Y(v0), (u1 - u0) * w / 2, hh, hh * 0.45); ctx.fill(); ctx.fillStyle = c1; rr(X(-u1), Y(v0), (u1 - u0) * w / 2, hh, hh * 0.45); ctx.fill(); };
  const stripe = (u0, u1, v0, v1, a) => { ctx.fillStyle = `rgba(255,255,255,${a})`; rr(X(u0), Y(v0), (u1 - u0) * w / 2, (v1 - v0) * h, w * 0.02); ctx.fill(); };

  if (kind === "formula") {
    const ww = w * 0.2, fh = h * 0.19, rh = h * 0.23;
    wheel(-0.86, 0.16, ww, fh); wheel(0.86, 0.16, ww, fh); wheel(-0.9, 0.72, ww * 1.08, rh); wheel(0.9, 0.72, ww * 1.08, rh);
    ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw;                                    // asa dianteira
    rr(X(-0.96), Y(0.0), w * 0.96, h * 0.05, h * 0.015); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; rr(X(-0.96), Y(0.0), w * 0.09, h * 0.07, h * 0.012); ctx.fill(); rr(X(0.78), Y(0.0), w * 0.09, h * 0.07, h * 0.012); ctx.fill();
    ctx.fillStyle = "#171b22"; rr(X(-0.78), Y(0.935), w * 0.78, h * 0.065, h * 0.015); ctx.fill(); ctx.stroke();      // asa traseira
    ctx.fillStyle = col; rr(X(-0.8), Y(0.925), w * 0.045, h * 0.085, h * 0.01); ctx.fill(); rr(X(0.71), Y(0.925), w * 0.045, h * 0.085, h * 0.01); ctx.fill();
    ctx.fillStyle = "#171b22"; ctx.beginPath(); ctx.moveTo(X(-0.55), Y(0.36)); ctx.lineTo(X(-0.28), Y(0.4)); ctx.lineTo(X(-0.28), Y(0.62)); ctx.lineTo(X(-0.55), Y(0.7)); ctx.closePath(); ctx.fill();   // suspensão
    ctx.beginPath(); ctx.moveTo(X(0.55), Y(0.36)); ctx.lineTo(X(0.28), Y(0.4)); ctx.lineTo(X(0.28), Y(0.62)); ctx.lineTo(X(0.55), Y(0.7)); ctx.closePath(); ctx.fill();
    body(CAR_BODY.formula);
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(X(0), Y(0.1)); ctx.lineTo(X(0), Y(0.93)); ctx.stroke();                                     // linha central
    ctx.fillStyle = "rgba(10,14,22,.92)"; ctx.beginPath(); ctx.ellipse(X(0), Y(0.46), w * 0.075, h * 0.075, 0, 0, 7); ctx.fill();                                                           // cockpit
    ctx.fillStyle = o.helmet || "#ffd24a"; ctx.beginPath(); ctx.arc(X(0), Y(0.47), w * 0.045, 0, 7); ctx.fill();
    ctx.strokeStyle = "#14181f"; ctx.lineWidth = Math.max(1.2, w * 0.04); ctx.beginPath(); ctx.moveTo(X(-0.17), Y(0.40)); ctx.quadraticCurveTo(X(0), Y(0.35), X(0.17), Y(0.40)); ctx.moveTo(X(0), Y(0.36)); ctx.lineTo(X(0), Y(0.31)); ctx.stroke();   // halo
    ctx.fillStyle = "rgba(0,0,0,.45)"; rr(X(-0.07), Y(0.54), w * 0.07, h * 0.3, w * 0.03); ctx.fill();                                                                                  // entrada de ar / motor
    stripe(-0.05, 0.05, 0.1, 0.34, 0.25);
  } else if (kind === "proto") {
    wheel(-0.97, 0.22, w * 0.15, h * 0.17); wheel(0.97, 0.22, w * 0.15, h * 0.17); wheel(-0.97, 0.74, w * 0.17, h * 0.2); wheel(0.97, 0.74, w * 0.17, h * 0.2);
    body(CAR_BODY.proto);
    ctx.fillStyle = "rgba(0,0,0,.35)";                                                                                        // grelhas dos para-lamas
    for (const s of [-1, 1]) { rr(X(s * 0.62) - w * 0.04, Y(0.15), w * 0.08, h * 0.1, w * 0.02); ctx.fill(); rr(X(s * 0.7) - w * 0.04, Y(0.67), w * 0.08, h * 0.12, w * 0.02); ctx.fill(); }
    glass(() => { _spline(ctx, [[X(0), Y(0.27)], [X(0.3), Y(0.33)], [X(0.34), Y(0.47)], [X(0.22), Y(0.58)], [X(-0.22), Y(0.58)], [X(-0.34), Y(0.47)], [X(-0.3), Y(0.33)]]); });
    ctx.fillStyle = "rgba(255,255,255,.28)"; rr(X(-0.03), Y(0.6), w * 0.06, h * 0.3, w * 0.02); ctx.fill();                      // aleta central
    ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw; rr(X(-0.88), Y(0.94), w * 0.88, h * 0.055, h * 0.015); ctx.fill(); ctx.stroke();   // asa traseira
    ctx.fillStyle = col; rr(X(-0.9), Y(0.92), w * 0.045, h * 0.08, h * 0.01); ctx.fill(); rr(X(0.81), Y(0.92), w * 0.045, h * 0.08, h * 0.01); ctx.fill();
    ctx.fillStyle = "#171b22"; rr(X(-0.4), Y(0.0), w * 0.4, h * 0.022, h * 0.01); ctx.fill();                                    // splitter
    lights(0.035, 0.2, 0.55, h * 0.025, "#fff6c8");
  } else {                                                                                                                  // gt3, gt4 e turismo
    const touring = kind === "touring", gt4 = kind === "gt4", f = gt4 ? 0.93 : 1;
    wheel(-0.98 * f, 0.2, w * 0.15, h * 0.19); wheel(0.98 * f, 0.2, w * 0.15, h * 0.19); wheel(-0.99 * f, 0.74, w * 0.16, h * 0.2); wheel(0.99 * f, 0.74, w * 0.16, h * 0.2);
    if (!touring) { ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.8; rr(X(-0.62), Y(-0.002), w * 0.62, h * 0.03, h * 0.012); ctx.fill(); }          // splitter
    body(CAR_BODY[kind]);
    // recortes das portas e linha central
    ctx.strokeStyle = "rgba(0,0,0,.28)"; ctx.lineWidth = lw * 0.7;
    ctx.beginPath(); ctx.moveTo(X(-0.7), Y(0.40)); ctx.lineTo(X(-0.7), Y(0.66)); ctx.moveTo(X(0.7), Y(0.40)); ctx.lineTo(X(0.7), Y(0.66)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(0), Y(0.05)); ctx.lineTo(X(0), Y(0.28)); ctx.stroke();
    if (!touring) { ctx.fillStyle = "rgba(0,0,0,.38)"; for (const s of [-1, 1]) { rr(X(s * 0.3) - w * 0.045, Y(0.1), w * 0.09, h * 0.11, w * 0.02); ctx.fill(); } ctx.fillStyle = "rgba(255,255,255,.12)"; rr(X(-0.12), Y(0.04), w * 0.12, h * 0.22, w * 0.05); ctx.fill(); }   // entradas de ar no capô
    // vidros e teto
    glass(() => { _spline(ctx, touring
      ? [[X(0), Y(0.25)], [X(0.62), Y(0.28)], [X(0.7), Y(0.46)], [X(0.68), Y(0.7)], [X(0.4), Y(0.78)], [X(-0.4), Y(0.78)], [X(-0.68), Y(0.7)], [X(-0.7), Y(0.46)], [X(-0.62), Y(0.28)]]
      : [[X(0), Y(0.29)], [X(0.58), Y(0.32)], [X(0.64), Y(0.47)], [X(0.6), Y(0.66)], [X(0.36), Y(0.73)], [X(-0.36), Y(0.73)], [X(-0.6), Y(0.66)], [X(-0.64), Y(0.47)], [X(-0.58), Y(0.32)]]); });
    ctx.fillStyle = _mix(rgb, WHITE, 0.18); _spline(ctx, touring
      ? [[X(0), Y(0.43)], [X(0.48), Y(0.45)], [X(0.5), Y(0.6)], [X(0.3), Y(0.66)], [X(-0.3), Y(0.66)], [X(-0.5), Y(0.6)], [X(-0.48), Y(0.45)]]
      : [[X(0), Y(0.45)], [X(0.46), Y(0.47)], [X(0.46), Y(0.58)], [X(0.28), Y(0.63)], [X(-0.28), Y(0.63)], [X(-0.46), Y(0.58)], [X(-0.46), Y(0.47)]]); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 0.6; ctx.stroke();
    // retrovisores
    ctx.fillStyle = _mix(rgb, BLACK, 0.3); ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.7;
    for (const s of [-1, 1]) { rr(X(s * 0.96) - w * 0.045, Y(0.37), w * 0.09, h * 0.045, w * 0.02); ctx.fill(); ctx.stroke(); }
    lights(0.04, 0.16, 0.5, h * 0.028, "#fff6c8");
    { const a = touring ? 0.46 : 0.62, wd = touring ? 0.22 : 0.3, vy = touring ? 0.945 : 0.955; ctx.fillStyle = "#ff3b4e"; rr(X(-a), Y(vy), w * wd * 0.9, h * 0.026, h * 0.01); ctx.fill(); rr(X(a) - w * wd * 0.9, Y(vy), w * wd * 0.9, h * 0.026, h * 0.01); ctx.fill(); }   // lanternas
    if (!touring) {                                                                                                         // asa traseira com suportes e placas laterais
      const ww = gt4 ? 0.82 : 1.0;
      ctx.fillStyle = "#171b22"; ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.9;
      rr(X(-ww), Y(0.925), w * ww, h * 0.06, h * 0.015); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; rr(X(-ww) - w * 0.012, Y(0.91), w * 0.04, h * 0.09, h * 0.01); ctx.fill(); rr(X(ww) - w * 0.028, Y(0.91), w * 0.04, h * 0.09, h * 0.01); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(X(-ww) + w * 0.02, Y(0.93), w * ww - w * 0.04, h * 0.008);
    } else { ctx.fillStyle = "#171b22"; rr(X(-0.55), Y(0.935), w * 0.55, h * 0.03, h * 0.01); ctx.fill(); }
    if (gt4) stripe(-0.05, 0.05, 0.06, 0.92, 0.5);                                                                          // faixa central do GT4
  }
  if (o.label != null) { ctx.fillStyle = o.labelCol || "#fff"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 2; ctx.font = `800 ${Math.max(8, h * 0.19)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.strokeText(String(o.label), cx, Y(0.545)); ctx.fillText(String(o.label), cx, Y(0.545)); }
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
  radar: { range: 40, gap: false, numbers: false },
  blindl: { always: true }, blindr: { always: true },
};
const OPT_LOCK_TEAM = { radar: { carmap: null } };                    // escolher o carrinho de cada classe: Pro
