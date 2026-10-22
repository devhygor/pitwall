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

function drawCar(ctx, cx, cy, h, col, o = {}) {
  const kind = CAR_RATIO[o.kind] ? o.kind : "gt3", w = h * CAR_RATIO[kind], x = cx - w / 2, y = cy - h / 2;
  const dark = "#0b0d10", glass = "rgba(8,16,30,.9)", rr = (a, b, c, d, r) => { ctx.beginPath(); ctx.roundRect(a, b, c, d, r); };
  ctx.save(); ctx.lineJoin = "round";
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 14; }
  const grad = (a, b) => { const g = ctx.createLinearGradient(a, 0, b, 0); g.addColorStop(0, col); g.addColorStop(0.5, o.hi || col); g.addColorStop(1, col); return g; };
  ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = Math.max(1, h * 0.03);
  if (kind === "formula") {
    ctx.fillStyle = dark;                                                         // rodas grandes, de fora
    rr(x, y + h * 0.13, w * 0.2, h * 0.2, w * 0.05); ctx.fill(); rr(x + w * 0.8, y + h * 0.13, w * 0.2, h * 0.2, w * 0.05); ctx.fill();
    rr(x - w * 0.02, y + h * 0.62, w * 0.24, h * 0.24, w * 0.05); ctx.fill(); rr(x + w * 0.78, y + h * 0.62, w * 0.24, h * 0.24, w * 0.05); ctx.fill();
    ctx.fillStyle = grad(x, x + w);                                              // asas, nariz, laterais e corpo
    rr(x + w * 0.02, y, w * 0.96, h * 0.045, w * 0.03); ctx.fill(); ctx.stroke();
    rr(x + w * 0.12, y + h * 0.9, w * 0.76, h * 0.1, w * 0.03); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, y + h * 0.04); ctx.lineTo(x + w * 0.58, y + h * 0.3); ctx.lineTo(x + w * 0.6, y + h * 0.88); ctx.lineTo(x + w * 0.4, y + h * 0.88); ctx.lineTo(x + w * 0.42, y + h * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
    rr(x + w * 0.22, y + h * 0.4, w * 0.56, h * 0.3, w * 0.14); ctx.fill(); ctx.stroke();                 // caixas laterais
    ctx.fillStyle = glass; ctx.beginPath(); ctx.ellipse(cx, y + h * 0.5, w * 0.1, h * 0.07, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(cx, y + h * 0.5, w * 0.065, 0, 7); ctx.fill();   // capacete
  } else if (kind === "proto") {
    ctx.fillStyle = grad(x, x + w);
    ctx.shadowBlur = o.glow ? 14 : 0;
    rr(x + w * 0.04, y + h * 0.12, w * 0.92, h * 0.76, [w * 0.3, w * 0.3, w * 0.22, w * 0.22]); ctx.fill(); ctx.stroke();      // para-lamas cobrindo as rodas
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.bezierCurveTo(x + w * 0.9, y + h * 0.1, x + w * 0.78, y + h * 0.4, x + w * 0.74, y + h * 0.9); ctx.lineTo(x + w * 0.26, y + h * 0.9); ctx.bezierCurveTo(x + w * 0.22, y + h * 0.4, x + w * 0.1, y + h * 0.1, cx, y); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = glass; ctx.beginPath(); ctx.ellipse(cx, y + h * 0.42, w * 0.2, h * 0.14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(cx - w * 0.02, y + h * 0.58, w * 0.04, h * 0.3);                // aleta central
    ctx.fillStyle = dark; rr(x + w * 0.1, y + h * 0.93, w * 0.8, h * 0.05, w * 0.03); ctx.fill();                      // asa traseira
  } else {                                                                         // gt3, gt4 e turismo: mesma base, proporções e detalhes diferentes
    const touring = kind === "touring", gt4 = kind === "gt4";
    ctx.fillStyle = dark;
    for (const fy of [0.13, 0.67]) { rr(x - w * 0.05, y + h * fy, w * 0.17, h * 0.2, w * 0.05); ctx.fill(); rr(x + w * 0.88, y + h * fy, w * 0.17, h * 0.2, w * 0.05); ctx.fill(); }
    ctx.fillStyle = grad(x, x + w);
    rr(x + w * 0.07, y, w * 0.86, h, touring ? [w * 0.34, w * 0.34, w * 0.2, w * 0.2] : [w * 0.44, w * 0.44, w * 0.24, w * 0.24]); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (!touring) { ctx.fillStyle = "rgba(255,255,255,.22)"; rr(x + w * 0.38, y + h * 0.04, w * 0.24, h * 0.24, w * 0.1); ctx.fill(); }
    ctx.fillStyle = glass;
    if (touring) {                                                                 // cabine grande de sedã/hatch
      rr(x + w * 0.16, y + h * 0.26, w * 0.68, h * 0.5, w * 0.12); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.14)"; rr(x + w * 0.24, y + h * 0.4, w * 0.52, h * 0.2, w * 0.06); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.3); ctx.lineTo(x + w * 0.8, y + h * 0.3); ctx.lineTo(x + w * 0.72, y + h * 0.48); ctx.lineTo(x + w * 0.28, y + h * 0.48); ctx.closePath(); ctx.fill();
      rr(x + w * 0.26, y + h * 0.66, w * 0.48, h * 0.12, w * 0.08); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x + w * 0.3, y + h * 0.5, w * 0.4, h * 0.14);
    }
    ctx.fillStyle = "#fff6c8"; rr(x + w * 0.14, y + h * 0.045, w * 0.2, h * 0.05, w * 0.03); ctx.fill(); rr(x + w * 0.66, y + h * 0.045, w * 0.2, h * 0.05, w * 0.03); ctx.fill();
    ctx.fillStyle = "#ff3b4e"; rr(x + w * 0.14, y + h * 0.93, w * 0.22, h * 0.035, w * 0.02); ctx.fill(); rr(x + w * 0.64, y + h * 0.93, w * 0.22, h * 0.035, w * 0.02); ctx.fill();
    if (!touring) { ctx.fillStyle = dark; const ww = gt4 ? 0.74 : 1.0; rr(cx - w * ww / 2, y + h * 0.955, w * ww, h * 0.05, w * 0.03); ctx.fill(); }    // asa traseira (GT3 mais larga)
    if (gt4) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(cx - w * 0.04, y + h * 0.08, w * 0.08, h * 0.84); }                       // faixa central do GT4
  }
  if (o.label != null) { ctx.fillStyle = o.labelCol || "#fff"; ctx.font = `800 ${Math.max(8, h * 0.2)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(o.label), cx, y + h * 0.58); }
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
