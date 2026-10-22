"use strict";
// Overlays do Pitwall (mapa com bandeiras, pedais, participantes e delta). Uma página por overlay: /overlay/<nome>.
// Os dados vêm de /api/overlay/data; as opções, de /api/settings (overlays.<nome>), relidas a cada 1,5 s.

const NAME = (location.pathname.split("/").pop() || "map").replace(/[^a-z]/g, "");
const TITLES = { map: "Mapa", pedals: "Pedais", standings: "Participantes", delta: "Delta", tyres: "Pneus", corner: "Curva", radar: "Radar", blindl: "Ponto cego esquerdo", blindr: "Ponto cego direito" };
const PREVIEW = /[?&]preview/.test(location.search);       // dentro do palco da página Overlays: só mostra, com dados de exemplo
const root = document.getElementById("root");
root.dataset.title = TITLES[NAME] || NAME;

const FLAG_INFO = {
  red: ["Bandeira vermelha", "#ff3040"], yellow: ["Bandeira amarela", "#ffd21f"], blue: ["Bandeira azul", "#3d8bff"],
  white: ["Bandeira branca", "#ffffff"], green: ["Bandeira verde", "#2fe58a"], chequered: ["Bandeirada", "#ffffff"],
  black: ["Bandeira preta", "#9aa0aa"], penalty: ["Penalidade", "#ff9f1a"], orange: ["Bandeira laranja", "#ff9f1a"],
};
const DEFAULT_CFG = { mode: "off", scale: 100, bg: 0, cars: true, numbers: true, rotate: 0, width: 9, banner: true, sectors: true,
  seconds: 8, steer: false, wheel: true, gear: true, coast: true, bars: true, speed: true, rows: 10, view: "around", name: "short",
  cols: ["pos", "number", "name", "vs_me", "last", "best"], group: true, classpos: true, header: true, others: 3, carstyle: "both", logomode: "color", trendcolor: true, fuel: true, predicted: true,
  temp: true, press: true, brake: true, wear: true, compound: true, punit: "psi", tmin: 70, tmax: 100, pmin: 26, pmax: 27, pads: true, bmin: 350, bmax: 800, tystyle: "acc", weather: true, tynum: true,
  mapstyle: "asphalt", mapmode: "full", fzoom: 350, brakepts: false, dist: true, brakepoint: true, lead: 250, next: true, cstyle: "full",
  rstyle: "top", range: 40, gap: true, bstyle: "dot", always: true };

let cfg = { ...DEFAULT_CFG };
// modelos extras de overlay: Pro (overlay_styles) e Equipe (overlay_styles_team); sem o recurso, volta para o modelo clássico
const FEATS = new Set();
const F_PRO = "overlay_styles", F_TEAM = "overlay_styles_team";
// escada dos planos: Grátis = versões simples; Pro = os modelos completos; Equipe = modelos de transmissão
const STYLE_NEED = {
  map: { asphalt: F_PRO, neon: F_PRO }, mapmode: { follow: F_PRO, follow_rot: F_PRO },
  pedals: { classic: F_PRO, horizontal: F_PRO, driver: F_TEAM }, delta: { classic: F_PRO, bar: F_TEAM },
  standings: { classic: F_PRO, tower: F_TEAM }, radar: { top: F_PRO, circle: F_PRO, halo: F_TEAM }, tyres: { acc: F_PRO, cards: F_PRO, row: F_TEAM }, corner: { full: F_PRO, compact: F_PRO }, blind: { icon: F_PRO } };
const STYLE_FALLBACK = { map: "classic", mapmode: "full", pedals: "minimal", delta: "minimal", standings: "compact", radar: "sides", blind: "dot", tyres: "minimal", corner: "line" };
function pickStyle(group, key, def) {
  const v = cfg[key] || def, need = (STYLE_NEED[group] || {})[v];
  return !need || FEATS.has(need) ? v : STYLE_FALLBACK[group];
}
async function loadFeatures() {
  try { const l = await getJSON("/api/license"); FEATS.clear(); for (const f of l.features || []) FEATS.add(f.id); } catch (e) { /* mantém o que tinha */ }
}
const heatCol = (v, lo, hi, l = 52) => {          // 0 = ideal (verde forte); esquenta aos poucos até o vermelho e esfria até o azul
  const c = (lo + hi) / 2, h = Math.max(1e-6, (hi - lo) / 2), d = (v - c) / h, e = (x) => x * x * (3 - 2 * x);
  const hue = d >= 0 ? 140 - 140 * e(clamp(d / 1.7, 0, 1)) : 140 + 70 * e(clamp(-d / 1.7, 0, 1));
  return `hsl(${Math.round(hue)} 78% ${l}%)`;
};
let edit = false;
let lastSize = "";

// ------------------------------------------------------------------ utilidades
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtLap(ms) {
  if (ms == null || ms <= 0) return "—";
  const m = Math.floor(ms / 60000), s = (ms - m * 60000) / 1000;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}
function fmtDelta(ms) { return (ms < 0 ? "−" : "+") + (Math.abs(ms) / 1000).toFixed(3); }
function fmtGap(g, signed) {
  if (!g) return "";
  if (g.laps) return (g.laps > 0 ? "+" : "−") + Math.abs(g.laps) + "V";
  const v = g.ms, a = Math.abs(v) / 1000;
  const t = a >= 60 ? `${Math.floor(a / 60)}:${(a % 60).toFixed(1).padStart(4, "0")}` : a.toFixed(a >= 10 ? 1 : 2);
  return (v < 0 ? "−" : "+") + t;
}
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function reportSize() {
  const w = root.offsetWidth, h = root.offsetHeight, k = w + "x" + h + "@" + cfg.scale;
  if (k === lastSize || !w || !h) return;
  lastSize = k;
  if (PREVIEW) {                              // o palco precisa do tamanho já com a escala aplicada
    const sc = clamp(cfg.scale, 40, 300) / 100;
    parent.postMessage({ pitwallOverlay: true, name: NAME, w: Math.round(w * sc), h: Math.round(h * sc) }, "*");
    return;
  }
  fetch("/api/ui/overlay-size", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NAME, w, h }) }).catch(() => {});
}
function applyCfg(settings) {
  const o = (settings.overlays || {})[NAME] || {};
  cfg = { ...DEFAULT_CFG, ...o };
  edit = PREVIEW ? false : !!settings.overlay_edit;
  document.body.classList.toggle("edit", edit);
  handles();
  document.documentElement.style.setProperty("--s", String(clamp(cfg.scale, 40, 300) / 100));
  document.documentElement.style.setProperty("--bg", String(clamp(cfg.bg, 0, 100)));
}
let featAt = 0;
async function settingsLoop() {
  if (performance.now() - featAt > 15000) { featAt = performance.now(); loadFeatures(); }
  try { applyCfg((await getJSON("/api/settings")).settings || {}); } catch (e) { /* app reiniciando */ }
  if (current && current.onCfg) current.onCfg();
  reportSize();
  setTimeout(settingsLoop, 1500);
}

// ------------------------------------------------------------------ redimensionar arrastando as bordas (modo de edição)
let rzOn = false, rzLast = 0;
function handles() {
  const want = edit && !PREVIEW;
  if (want === rzOn) return;
  rzOn = want;
  root.querySelectorAll(".rz2").forEach((e) => e.remove());
  if (!want) return;
  for (const d of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    const h = document.createElement("i");
    h.className = "rz2 rz2-" + d; h.dataset.d = d;
    h.addEventListener("mousedown", (ev) => startResize(ev, d));
    root.appendChild(h);
  }
}
function startResize(ev, dir) {
  ev.preventDefault(); ev.stopPropagation();                // stopPropagation: senão a janela inteira começa a ser arrastada
  const s0 = cfg.scale, w0 = root.offsetWidth * s0 / 100, h0 = root.offsetHeight * s0 / 100, sx = ev.screenX, sy = ev.screenY;
  const anchor = (dir.includes("w") ? "r" : "l") + (dir.includes("n") ? "b" : "t");
  const move = (e) => {
    const dx = e.screenX - sx, dy = e.screenY - sy;
    const rx = dir.includes("e") ? (w0 + dx) / w0 : dir.includes("w") ? (w0 - dx) / w0 : null;
    const ry = dir.includes("s") ? (h0 + dy) / h0 : dir.includes("n") ? (h0 - dy) / h0 : null;
    const r = clamp(rx != null && ry != null ? (rx + ry) / 2 : rx ?? ry, 40 / s0, 300 / s0);
    const sc = Math.round(s0 * r);
    cfg.scale = sc;
    document.documentElement.style.setProperty("--s", String(sc / 100));
    const now = performance.now();
    if (now - rzLast > 45) {
      rzLast = now;
      fetch("/api/ui/overlay-scale", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: NAME, scale: sc, anchor }) }).catch(() => {});
    }
  };
  const up = (e) => {
    window.removeEventListener("mousemove", move, true); window.removeEventListener("mouseup", up, true);
    move(e); rzLast = 0;
    fetch("/api/ui/overlay-scale", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: NAME, scale: cfg.scale, anchor }) }).catch(() => {});
  };
  window.addEventListener("mousemove", move, true); window.addEventListener("mouseup", up, true);
}

// ------------------------------------------------------------------ dados ao vivo
let seq = 0, data = null, recvAt = 0;
const samples = [];                       // [t, gas, brake, steer, speed, gear, rpm]
let previewing = false;
async function dataLoop(parts, every) {
  const tick = async () => {
    if (PREVIEW) { previewing = true; data = null; if (current && current.onData) current.onData(); reportSize(); setTimeout(tick, every); return; }
    try {
      const d = await getJSON(`/api/overlay/data?since=${seq}&parts=${parts}`);
      if (d.seq < seq) { samples.length = 0; }
      seq = d.seq; data = d; recvAt = performance.now();
      for (const s of d.samples || []) samples.push(s);
      const cut = (samples.length ? samples[samples.length - 1][0] : 0) - 45;
      while (samples.length && samples[0][0] < cut) samples.shift();
    } catch (e) { data = null; }
    previewing = edit && (!data || data.status === "idle");
    if (current && current.onData) current.onData();
    reportSize();
    setTimeout(tick, every);
  };
  tick();
}
const live = () => !previewing && data && data.status !== "idle";

// ------------------------------------------------------------------ MAPA
function mapOverlay() {
  root.innerHTML = `<div class="card map"><canvas id="cv"></canvas><div class="banner" id="bn"></div><div class="cornernow" id="cn"></div><div class="note" id="nt"></div></div>`;
  const cv = root.querySelector("#cv"), ctx = cv.getContext("2d"), bn = root.querySelector("#bn"), nt = root.querySelector("#nt"), cn = root.querySelector("#cn");
  const W = 340, H = 300;
  let track = null, pts = [], full = [], sectors = [1 / 3, 2 / 3], filled = 0, corners = [], mapAt = 0, mapTrack = null, greenUntil = 0, lastGreen = false;
  let bounds = null, bkey = "", prevTrack = null;

  async function loadMap() {
    try {
      const m = await getJSON("/api/overlay/map");
      pts = m.pts; sectors = m.sectors; corners = m.corners || []; filled = m.filled; mapTrack = m.track; mapAt = performance.now();
      rebuild();
    } catch (e) { /* ok */ }
  }
  function rebuild() {                       // preenche os buracos do contorno (volta ainda não completa)
    const n = pts.length, ok = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    full = new Array(n).fill(null);
    if (ok.length < 8) { return; }
    for (let i = 0; i < n; i++) {
      if (pts[i]) { full[i] = pts[i]; continue; }
      let a = i, b = i, da = 0, db = 0;
      while (!pts[a]) { a = (a - 1 + n) % n; da++; }
      while (!pts[b]) { b = (b + 1) % n; db++; }
      const u = da / (da + db);
      full[i] = [pts[a][0] + (pts[b][0] - pts[a][0]) * u, pts[a][1] + (pts[b][1] - pts[a][1]) * u];
    }
    bounds = null;
  }
  const rot = (p) => {
    const r = ((cfg.rotate || 0) % 360 + 360) % 360;
    const [x, y] = p;
    return r === 90 ? [-y, x] : r === 180 ? [-x, -y] : r === 270 ? [y, -x] : [x, y];
  };
  function fit(src) {
    const key = cfg.rotate + "|" + src.length + "|" + filled + "|" + (src === full);
    if (bounds && key === bkey) return bounds;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of src) { if (!p) continue; const [x, y] = rot(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 26, k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
    bkey = key;
    bounds = (p) => { const [x, y] = rot(p); return [x * k + ox, y * k + oy]; };
    return bounds;
  }
  function sectorFlag(s, f) {                // bandeira que vale para o setor s (0..2)
    if (!f) return null;
    if (f.red) return "red";
    if (f.yellow && f.yellow[s]) return "yellow";
    if (f.blue) return "blue";
    if (f.white) return "white";
    if (performance.now() < greenUntil) return "green";
    if (f.chequered) return "chequered";
    return null;
  }
  function dotNumber(x, y, n, col, sc = 1) {
    const t = String(n);
    ctx.fillStyle = col; ctx.font = `800 ${(t.length > 2 ? 8 : t.length > 1 ? 10 : 11) * sc}px Segoe UI`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y + 0.5 * sc);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
  let theta = 0;                              // giro suavizado do mapa (modo "seguir e girar")
  function draw() {
    const dpr = (window.devicePixelRatio || 1) * clamp(cfg.scale, 40, 300) / 100;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = performance.now() / 1000;
    let flags = live() ? data.flags : null;
    if (previewing) {                        // sem o jogo: mostra as bandeiras se alternando
      const c = t % 12;
      flags = { yellow: [false, c > 3 && c < 7, false], red: c > 9 && c < 11, blue: c > 7 && c < 9, green: false, white: false };
    }
    if (flags && flags.green && !lastGreen) greenUntil = performance.now() + 4500;
    lastGreen = !!(flags && flags.green);
    const hasMap = full.length && full.some(Boolean);
    if (!hasMap && previewing && !prevTrack) prevTrack = previewTrack();
    const src = hasMap ? full : previewing ? prevTrack : [];
    if (!src.length) { nt.textContent = live() ? "Aprendendo a pista… complete uma volta" : ""; bn.innerHTML = ""; return; }
    const tf = fit(src);
    const n = src.length, P = src.map(tf);
    const me = live() ? data.me : null;
    const mySp = me ? me.spline : previewing ? (t / 14) % 1 : null;
    const at = (sp) => P[Math.round((((sp % 1) + 1) % 1) * n) % n];
    // modo: pista inteira, seguindo o carro (norte para cima) ou seguindo e girando (a frente sempre para cima)
    const mode = cfg.mapmode === "follow" || cfg.mapmode === "follow_rot" ? pickStyle("mapmode", "mapmode", "full") : "full";
    const Z = mode === "full" || mySp == null ? 1 : clamp(cfg.fzoom, 150, 900) / 100, sc = 1 / Z;
    let rotA = 0;
    ctx.save();
    if (Z > 1) {
      const mi = Math.round((((mySp % 1) + 1) % 1) * n) % n, [px, py] = P[mi];
      const A = P[(mi + 5) % n], B = P[(mi - 5 + n) % n];
      if (mode === "follow_rot") {
        const target = -Math.atan2(A[0] - B[0], -(A[1] - B[1]));
        let d = target - theta; d = Math.atan2(Math.sin(d), Math.cos(d));
        theta += d * 0.18; rotA = theta;
      }
      ctx.translate(W / 2, mode === "follow_rot" ? H * 0.66 : H / 2);
      ctx.rotate(rotA); ctx.scale(Z, Z); ctx.translate(-px, -py);
    }
    // textos e marcas que precisam ficar em pé mesmo com o mapa girando
    const upright = (x, y, fn) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-rotA); ctx.scale(sc, sc); fn(); ctx.restore(); };
    const style = ["asphalt", "thin", "classic", "neon"].includes(cfg.mapstyle) ? pickStyle("map", "mapstyle", "asphalt") : pickStyle("map", "_", "asphalt");
    const lw = (style === "thin" ? 3.2 : style === "neon" ? 3.6 : clamp(cfg.width, 3, 20)) * sc;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const trace = (a, b) => { ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); for (let i = a + 1; i <= b; i++) ctx.lineTo(P[i % n][0], P[i % n][1]); };
    if (style === "asphalt") {
      ctx.strokeStyle = "rgba(150,165,196,.9)"; ctx.lineWidth = lw + 7 * sc; trace(0, n); ctx.stroke();      // borda clara
      ctx.strokeStyle = "rgba(10,15,24,.95)"; ctx.lineWidth = lw + 2 * sc; trace(0, n); ctx.stroke();        // asfalto
    } else if (style === "classic") {
      ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw + 5 * sc; trace(0, n); ctx.stroke();            // só uma base escura
    } else {
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = lw + 2.5 * sc; trace(0, n); ctx.stroke();         // fina: um fio de sombra
    }
    // cor por setor (a bandeira pinta só o trecho onde ela está)
    const sec = (i) => (i / n < sectors[0] ? 0 : i / n < sectors[1] ? 1 : 2);
    let a = 0;
    const pulse = 0.72 + 0.28 * Math.sin(t * 7);
    for (let i = 1; i <= n; i++) {
      if (i < n && sec(i) === sec(a)) continue;
      const fl = sectorFlag(sec(a), flags);
      ctx.globalAlpha = fl === "yellow" || fl === "red" ? pulse : 1;
      if (fl) { ctx.strokeStyle = FLAG_INFO[fl][1]; ctx.lineWidth = lw; trace(a, Math.min(i, n)); ctx.stroke(); }     // bandeira: pinta a pista toda
      else if (style === "asphalt") { ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = Math.max(1.5 * sc, lw * 0.14); ctx.setLineDash([6 * sc, 8 * sc]); trace(a, Math.min(i, n)); ctx.stroke(); ctx.setLineDash([]); }
      else if (style === "neon") { ctx.shadowColor = "#38e8ff"; ctx.shadowBlur = 12; ctx.strokeStyle = "#7df3ff"; ctx.lineWidth = lw; trace(a, Math.min(i, n)); ctx.stroke(); ctx.shadowBlur = 0; }
      else { ctx.strokeStyle = style === "thin" ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.88)"; ctx.lineWidth = lw; trace(a, Math.min(i, n)); ctx.stroke(); }
      if (fl === "chequered") { ctx.strokeStyle = "#111"; ctx.setLineDash([8 * sc, 8 * sc]); trace(a, Math.min(i, n)); ctx.stroke(); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
      a = i;
    }
    // linha de largada/chegada, divisas dos setores e pontos de frenagem
    const tick = (idx, col, len, w = 3) => {
      const p = P[idx % n], q = P[(idx + 2) % n], r = P[(idx - 2 + n) % n];
      let dx = q[0] - r[0], dy = q[1] - r[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      ctx.strokeStyle = col; ctx.lineWidth = w * sc; ctx.beginPath();
      ctx.moveTo(p[0] - dy * len, p[1] + dx * len); ctx.lineTo(p[0] + dy * len, p[1] - dx * len); ctx.stroke();
    };
    const half = (style === "thin" || style === "neon" ? 5 : lw * 0.9 + 3 * sc);
    tick(0, "#ffffff", half);
    if (cfg.sectors) { tick(Math.round(sectors[0] * n), "rgba(0,0,0,.75)", lw * 0.7); tick(Math.round(sectors[1] * n), "rgba(0,0,0,.75)", lw * 0.7); }
    // curvas: número (e nome) no mapa e a curva em que você está agora
    const cs = corners.length ? corners : previewing ? previewCorners : [];
    if (cfg.brakepts) {                      // ponto de frenagem do seu melhor tempo: marca vermelha atravessando a pista
      for (const c of cs) if (c.brake != null) tick(Math.round(c.brake * n), "#ff4d5e", Math.max(lw * 0.75, 4 * sc), 2.6);
    }
    if (cfg.corners && cs.length) {
      let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
      for (const c of cs) {
        const [x, y] = at(c.apex);
        let dx = x - cx, dy = y - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const off = lw / 2 + 12 * sc;
        const lx = Z > 1 ? x + dx * off : clamp(x + dx * off, 10, W - 10), ly = Z > 1 ? y + dy * off : clamp(y + dy * off, 10, H - 10);
        upright(lx, ly, () => {
          ctx.fillStyle = "rgba(8,10,14,.62)"; ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 7); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "700 10px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(c.n), 0, 0.5);
        });
      }
    }
    let nowTxt = "";
    if (cfg.corner_now && cs.length) {
      const sp = live() && data.me ? data.me.spline : previewing ? (t / 14) % 1 : null;
      if (sp != null) {
        const c = cs.find((q) => (q.start <= q.end ? sp >= q.start && sp <= q.end : sp >= q.start || sp <= q.end)) || cs[0];
        nowTxt = `<b>Curva ${c.n}</b>${c.name ? " · " + c.name.replace(/</g, "&lt;") : ""}`;
      }
    }
    if (cn.dataset.h !== nowTxt) { cn.dataset.h = nowTxt; cn.innerHTML = nowTxt; cn.style.display = nowTxt ? "block" : "none"; }
    // carros
    let cars = live() ? data.cars || [] : previewing ? previewCars(t) : [];
    const small = style === "thin" || style === "neon";
    if (cfg.cars) {
      for (const c of cars) {
        if (me && c.id === me.id) continue;
        const [x, y] = at(c.spline), num = cfg.numbers && c.number != null;
        upright(x, y, () => {
          ctx.fillStyle = c.pit ? "rgba(255,194,51,.95)" : "#7fb2ff"; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, num ? (small ? 8 : 9.5) : (small ? 3.8 : 5.5), 0, 7); ctx.stroke(); ctx.fill();
          if (num) dotNumber(0, 0, c.number, "#0b0d10", small ? 0.85 : 1);
        });
      }
    }
    if (mySp != null) {
      const [x, y] = at(mySp);
      upright(x, y, () => {
        ctx.fillStyle = "rgba(255,59,78,.35)"; ctx.beginPath(); ctx.arc(0, 0, (small ? 9 : 13) + 2 * Math.sin(t * 5), 0, 7); ctx.fill();
        const mine = cfg.numbers && me ? cars.find((c) => c.id === me.id) : null, big = mine && mine.number != null;
        ctx.fillStyle = "#ff3b4e"; ctx.strokeStyle = "#fff"; ctx.lineWidth = small ? 2 : 3; ctx.beginPath(); ctx.arc(0, 0, big ? (small ? 9 : 11) : (small ? 4.5 : 7), 0, 7); ctx.stroke(); ctx.fill();
        if (big) dotNumber(0, 0, mine.number, "#fff", small ? 0.85 : 1);
      });
    }
    ctx.restore();
    // faixa com o nome das bandeiras
    const act = [];
    if (flags) {
      if (flags.red) act.push(["red"]);
      if (flags.yellow && flags.yellow.some(Boolean)) act.push(["yellow", flags.yellow.every(Boolean) ? "" : " · " + flags.yellow.map((v, i) => (v ? "S" + (i + 1) : "")).filter(Boolean).join(" ")]);
      if (flags.blue) act.push(["blue"]);
      if (flags.white) act.push(["white"]);
      if (performance.now() < greenUntil) act.push(["green"]);
      if (flags.chequered) act.push(["chequered"]);
      if (flags.black) act.push(["black"]);
      if (flags.penalty) act.push(["penalty"]);
      if (flags.orange) act.push(["orange"]);
    }
    const html = cfg.banner ? act.map(([k, extra]) => `<span class="chip ${k === "yellow" || k === "red" ? "pulse" : ""}" style="background:${FLAG_INFO[k][1]}">${FLAG_INFO[k][0].replace("Bandeira ", "")}${extra || ""}</span>`).join("") : "";
    if (bn.dataset.h !== html) { bn.dataset.h = html; bn.innerHTML = html; }
    nt.textContent = !previewing && filled < 0.95 && live() ? "Desenhando a pista… complete uma volta" : "";
  }
  function previewTrack() {
    const out = [];
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * 6.2832;
      out.push([Math.cos(a) * (150 + 40 * Math.sin(2 * a) + 14 * Math.sin(5 * a)), Math.sin(a) * (95 + 25 * Math.sin(3 * a))]);
    }
    return out;
  }
  const previewCorners = [0.04, 0.14, 0.27, 0.38, 0.5, 0.63, 0.75, 0.88].map((a, i) => ({ n: i + 1, apex: a, brake: a - 0.03, start: a - 0.06, end: a + 0.06, name: i === 1 ? "Eau Rouge" : "" }));
  function previewCars(t) { return [0.1, 0.22, 0.4, 0.55, 0.7, 0.86].map((s, i) => ({ id: 100 + i, spline: (s + t / 40) % 1, number: 10 + i * 9, pit: false })); }
  loadMap();
  const loop = () => {
    if (mapTrack !== (data && data.track) && data && data.track && performance.now() - mapAt > 1500) loadMap();
    else if (filled < 0.95 && performance.now() - mapAt > 5000) loadMap();
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { onData() {}, onCfg() { bounds = null; } };
}

// ------------------------------------------------------------------ PRÓXIMA CURVA E PONTO DE FRENAGEM
function cornerOverlay() {
  root.innerHTML = `<div class="card cnr shadow" id="cnr">
    <div class="cn-arrow" id="ca"></div>
    <div class="cn-info"><b id="cnum">—</b><small id="cname"></small><span class="cn-dir" id="cdir"></span></div>
    <div class="cn-dist num" id="cd"></div>
    <div class="cn-brk" id="cb"><div class="lab"><span id="cbl">PONTO DE FRENAGEM</span><b class="num" id="cbd"></b></div><div class="bar"><i id="cbi"></i><u id="cbm"></u></div></div>
    <div class="cn-sub" id="cs"></div><div class="cn-next" id="cx"></div></div>`;
  const $ = (s) => root.querySelector(s);
  let plan = [], length = 0, planAt = 0, planTrack = null;
  const ARROW = (dir) => `<svg viewBox="0 0 48 48" width="58" height="58" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" style="${dir === "L" ? "transform:scaleX(-1)" : ""}"><g transform="translate(-3 .5)"><path d="M14 42V24a10 10 0 0 1 10-10h14"/><path d="M31 5l9 9-9 9"/></g></svg>`;
  async function loadPlan() {
    try {
      const m = await getJSON("/api/overlay/map");
      plan = (m.corners || []).filter((c) => c.dir); length = m.length || 0; planTrack = m.track; planAt = performance.now();
    } catch (e) { /* ok */ }
  }
  const prevPlan = [{ n: 1, apex: 0.1, brake: 0.075, dir: "R", angle: 62, min_speed: 74, entry_speed: 205, name: "" },
    { n: 2, apex: 0.3, brake: 0.27, dir: "L", angle: 28, min_speed: 128, entry_speed: 230, name: "Eau Rouge" },
    { n: 3, apex: 0.5, brake: null, dir: "R", angle: 18, min_speed: 210, entry_speed: 215, name: "" },
    { n: 4, apex: 0.78, brake: 0.745, dir: "L", angle: 80, min_speed: 62, entry_speed: 190, name: "" }];
  const mod1 = (v) => ((v % 1) + 1) % 1;
  function render() {
    const cst = pickStyle("corner", "cstyle", "full");
    $("#cnr").classList.toggle("compact", cst === "compact");
    $("#cnr").classList.toggle("line", cst === "line");
    $("#cnr").classList.toggle("nodist", cst === "compact" && !cfg.dist);       // só a seta: ela fica no centro
    const compact = cst === "compact" || cst === "line";
    const usePlan = plan.length ? plan : previewing ? prevPlan : [];
    const L = length || (previewing ? 5200 : 0);
    const sp = live() && data.me ? data.me.spline : previewing ? (performance.now() / 1000 / 40) % 1 : null;
    if (!usePlan.length || sp == null || !L) {
      $("#ca").innerHTML = ""; $("#cnum").textContent = live() ? "Sem curvas ainda" : "Aguardando…"; $("#cname").textContent = live() ? "grave uma volta nesta pista" : "";
      $("#cd").textContent = ""; $("#cb").style.display = "none"; $("#cs").textContent = ""; $("#cx").textContent = ""; $("#cdir").textContent = ""; return;
    }
    // próxima curva: a primeira com ápice à frente (dando a volta na pista)
    const ahead = usePlan.map((c) => ({ c, d: mod1(c.apex - sp) })).sort((x, y) => x.d - y.d);
    const cur = ahead[0], nxt = ahead[1];
    const c = cur.c, dApex = cur.d * L;
    const zone = c.brake != null && mod1(sp - c.brake) < mod1(c.apex - c.brake) && mod1(sp - c.brake) > 0 && mod1(c.apex - c.brake) < 0.2;   // já dentro da zona de frenagem
    const dBrake = c.brake != null ? mod1(c.brake - sp) * L : null;
    const live2 = live() ? data.live : previewing ? { brake: zone ? 0.7 : 0, speed: 150 } : null;
    $("#ca").innerHTML = ARROW(c.dir);
    $("#ca").className = "cn-arrow " + (c.angle > 55 ? "hard" : c.angle > 28 ? "mid" : "easy") + (zone ? " go" : "");
    $("#cnum").textContent = `Curva ${c.n}`;
    $("#cname").textContent = cfg.name && !compact ? c.name || "" : "";
    $("#cdir").textContent = (c.dir === "L" ? "ESQUERDA" : "DIREITA") + (c.angle > 60 ? " · GRAMPO" : c.angle > 40 ? " · FECHADA" : c.angle < 20 ? " · ABERTA" : "");
    $("#cd").style.display = cfg.dist ? "" : "none";
    $("#cd").innerHTML = dApex >= 1000 ? `${(dApex / 1000).toFixed(1).replace(".", ",")}<small>km</small>` : `${Math.round(dApex / 5) * 5}<small>m</small>`;
    const cb = $("#cb");
    cb.style.display = cfg.brakepoint ? "" : "none";
    const lead = clamp(cfg.lead, 100, 500);
    if (c.brake == null) {
      cb.className = "cn-brk flat"; $("#cbl").textContent = "SEM FREIO NESTA CURVA"; $("#cbd").textContent = "ACELERADOR"; $("#cbi").style.width = "100%"; $("#cbm").style.left = "100%";
    } else if (zone) {
      cb.className = "cn-brk zone"; $("#cbl").textContent = "ZONA DE FRENAGEM"; $("#cbd").textContent = live2 && live2.brake > 0.05 ? `freio ${Math.round(live2.brake * 100)}%` : "sem freio!";
      $("#cbi").style.width = "100%"; $("#cbm").style.left = "100%";
    } else {
      const near = dBrake < 60;
      cb.className = "cn-brk " + (near ? "near" : "");
      $("#cbl").textContent = near ? "PREPARE-SE · FREIO EM" : "FREIO EM";
      $("#cbd").textContent = dBrake >= 1000 ? `${(dBrake / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(dBrake / 5) * 5} m`;
      $("#cbi").style.width = clamp(1 - dBrake / lead, 0, 1) * 100 + "%"; $("#cbm").style.left = "100%";
    }
    $("#cs").innerHTML = cfg.speed ? `vel. mínima <b>${c.min_speed} km/h</b>${c.entry_speed ? ` · entrada <b>${c.entry_speed} km/h</b>` : ""}${c.brake != null && cur.c.brake_m ? ` · frenagem <b>${c.brake_m || Math.round(mod1(c.apex - c.brake) * L)} m</b>` : ""}` : "";
    const nx = nxt && nxt.c !== c ? nxt : null;
    $("#cx").innerHTML = cfg.next && nx ? `Depois: <b>Curva ${nx.c.n} ${nx.c.dir === "L" ? "←" : "→"}</b> em ${Math.round(nx.d * L / 10) * 10} m` : "";
  }
  const loop = () => {
    if (!plan.length && performance.now() - planAt > 4000) loadPlan();
    else if (data && data.track && planTrack !== data.track && performance.now() - planAt > 1500) loadPlan();
    render(); requestAnimationFrame(loop);
  };
  loadPlan(); requestAnimationFrame(loop);
  return { onData() {}, onCfg() {} };
}

// ------------------------------------------------------------------ PEDAIS
function pedalsOverlay() {
  root.innerHTML = `<div class="card pedals"><canvas id="cv"></canvas><div class="bars" id="bars">
      <div class="vbar b"><i id="vb"></i></div><div class="vbar t"><i id="vt"></i></div></div>
      <div class="wheelbox" id="wb"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><g id="wh">
        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="6"/>
        <path d="M6 32h14M44 32h14M32 38v20" stroke="rgba(255,255,255,.92)" stroke-width="6" stroke-linecap="round"/>
        <path d="M24 6h16" stroke="#ff3b4e" stroke-width="6" stroke-linecap="round"/></g></svg>
        <div class="ang num" id="ang">0°</div></div>
      <div class="info" id="info"><div class="gear num" id="gear">N</div><div class="spd num" id="spd">0<small>KM/H</small></div>
      <div class="legend" id="lg"></div></div>
      <div class="alt hb"><div class="hrow r"><span>FREIO</span><div class="hbar"><i id="hbr"></i></div><b class="num" id="hbrv">0</b></div>
        <div class="hrow g"><span>ACEL</span><div class="hbar"><i id="hat"></i></div><b class="num" id="hatv">0</b></div></div>
      <div class="alt dash"><div class="dbars"><div class="vbar b"><i id="dbr"></i></div></div>
        <div class="dmid"><div class="dgear num" id="dgear">N</div><div class="dspd num" id="dspd">0</div><small>KM/H</small></div>
        <div class="dbars"><div class="vbar t"><i id="dat"></i></div></div></div></div>`;
  const cv = root.querySelector("#cv"), ctx = cv.getContext("2d");
  const wh = root.querySelector("#wh"), ang = root.querySelector("#ang");
  const vb = root.querySelector("#vb"), vt = root.querySelector("#vt"), gear = root.querySelector("#gear"), spd = root.querySelector("#spd"), lg = root.querySelector("#lg");
  const W = 360, H = 120;
  let pv = performance.now();
  const gearTxt = (g) => (g === 0 ? "R" : g === 1 ? "N" : String(g - 1));
  function onCfg() {
    root.querySelector("#bars").style.display = cfg.bars ? "" : "none";
    root.querySelector("#info").style.display = cfg.gear || cfg.speed || cfg.coast ? "" : "none";
    root.querySelector("#wb").style.display = cfg.wheel ? "" : "none";
    gear.style.display = cfg.gear ? "" : "none";
    spd.style.display = cfg.speed ? "" : "none";
  }
  function previewFeed() {                   // sem o jogo: pedais de exemplo
    const now = performance.now();
    while (pv < now) {
      pv += 1000 / 60;
      const t = pv / 1000, ph = (t % 7) / 7;
      const brake = ph > 0.55 && ph < 0.7 ? Math.min(1, (ph - 0.55) * 14) * (ph < 0.66 ? 1 : (0.7 - ph) * 25) : 0;
      const coast = ph > 0.5 && ph < 0.55;
      const gas = brake > 0 || coast ? 0 : clamp(0.35 + 0.65 * Math.sin(ph * 6.28 + 1), 0, 1);
      samples.push([pv / 1000, gas, brake, Math.sin(t * 0.9) * 0.6, 120 + 100 * gas, 4, 6000]);
    }
    while (samples.length && samples[0][0] < pv / 1000 - 45) samples.shift();
  }
  function draw() {
    const dpr = (window.devicePixelRatio || 1) * clamp(cfg.scale, 40, 300) / 100;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (previewing) previewFeed();
    const ps = pickStyle("pedals", "pstyle", "classic");
    root.firstChild.className = "card pedals p-" + ps;
    const Tm = clamp(cfg.seconds, 3, 30);
    const last = samples.length ? samples[samples.length - 1] : null;
    if (ps === "horizontal" || ps === "driver") {         // modelos sem gráfico: só os valores de agora
      const q = (id) => root.querySelector(id), g = last ? last[1] : 0, b = last ? last[2] : 0;
      q("#hbr").style.width = b * 100 + "%"; q("#hat").style.width = g * 100 + "%";
      q("#hbrv").textContent = Math.round(b * 100); q("#hatv").textContent = Math.round(g * 100);
      q("#dbr").style.height = b * 100 + "%"; q("#dat").style.height = g * 100 + "%";
      q("#dgear").textContent = last ? gearTxt(last[5]) : "N"; q("#dspd").textContent = last ? Math.round(last[4]) : 0;
      return;
    }
    // grade
    ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, H - f * (H - 10) - 4); ctx.lineTo(W, H - f * (H - 10) - 4); ctx.stroke(); }
    if (!last) { lg.innerHTML = ""; return; }
    const age = previewing ? 0 : Math.min(0.15, (performance.now() - recvAt) / 1000);
    const tNow = last[0] + age;
    const X = (t) => W * (1 - (tNow - t) / Tm), Y = (v) => H - 4 - v * (H - 10);
    let i0 = samples.length - 1;
    while (i0 > 0 && samples[i0 - 1][0] >= tNow - Tm - 0.1) i0--;
    const vis = samples.slice(i0);
    // trechos sem pedal nenhum (nem acelerador nem freio): faixa âmbar embaixo
    let coastN = 0, coastT = 0;
    if (cfg.coast) {
      let s = null;
      for (let i = 0; i <= vis.length; i++) {
        const q = vis[i], c = q && q[1] < 0.03 && q[2] < 0.03 && q[4] > 30;
        if (c && s == null) s = q[0];
        if ((!c || i === vis.length) && s != null) {
          const e = q && !c ? q[0] : vis[vis.length - 1][0];
          ctx.fillStyle = "rgba(255,194,51,.55)"; ctx.fillRect(Math.max(0, X(s)), H - 6, X(e) - Math.max(0, X(s)), 6);
          ctx.fillStyle = "rgba(255,194,51,.1)"; ctx.fillRect(Math.max(0, X(s)), 0, X(e) - Math.max(0, X(s)), H - 6);
          coastT += e - s; s = null;
        }
      }
      coastN = coastT / Math.max(0.1, vis.length ? vis[vis.length - 1][0] - vis[0][0] : 1);
    }
    const area = (idx, col1, col2, line) => {
      if (vis.length < 2) return;
      ctx.beginPath(); ctx.moveTo(X(vis[0][0]), H - 4);
      for (const q of vis) ctx.lineTo(X(q[0]), Y(q[idx]));
      ctx.lineTo(X(vis[vis.length - 1][0]), H - 4); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, col1); g.addColorStop(1, col2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); vis.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[idx])) : ctx.moveTo(X(q[0]), Y(q[idx]))));
      ctx.strokeStyle = line; ctx.lineWidth = 2.6; ctx.lineJoin = "round"; ctx.stroke();
    };
    area(1, "rgba(62,224,143,.45)", "rgba(62,224,143,.02)", "#3ee08f");
    area(2, "rgba(255,77,94,.5)", "rgba(255,77,94,.02)", "#ff4d5e");
    if (cfg.steer && vis.length > 1) {                       // volante: linha fina em torno do meio
      ctx.beginPath(); vis.forEach((q, i) => { const y = H / 2 - clamp(q[3], -1, 1) * (H / 2 - 8); i ? ctx.lineTo(X(q[0]), y) : ctx.moveTo(X(q[0]), y); });
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // valores atuais
    vb.style.height = (last[2] * 100).toFixed(0) + "%"; vt.style.height = (last[1] * 100).toFixed(0) + "%";
    const st = clamp(last[3], -1, 1), deg = st * 200;          // ±1 = batente do volante (~±200° no desenho)
    wh.setAttribute("transform", `rotate(${deg.toFixed(1)} 32 32)`);
    ang.textContent = (deg > 0.5 ? "→ " : deg < -0.5 ? "← " : "") + Math.abs(Math.round(st * 100)) + "%";
    gear.textContent = gearTxt(last[5]); spd.firstChild.nodeValue = Math.round(last[4]);
    const none = last[1] < 0.03 && last[2] < 0.03 && last[4] > 30;
    lg.innerHTML = `<span class="g">ACEL <b class="num">${Math.round(last[1] * 100)}</b></span><br><span class="r">FREIO <b class="num">${Math.round(last[2] * 100)}</b></span>` +
      (cfg.coast ? `<br><span class="a">${none ? "<b>SEM PEDAL</b>" : "sem pedal"} <span class="num">${Math.round(coastN * 100)}%</span></span>` : "");
  }
  const loop = () => { draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  onCfg();
  return { onData() {}, onCfg };
}

// carro visto de cima (frente para cima): rodas, carroceria, para-brisa, vidro traseiro, faróis e lanternas
function drawCar(ctx, cx, cy, h, col, o = {}) {
  const w = h * 0.46, x = cx - w / 2, y = cy - h / 2;
  ctx.save(); ctx.lineJoin = "round";
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 14; }
  ctx.fillStyle = "#0b0d10";                                                   // rodas
  for (const fy of [0.13, 0.67]) {
    ctx.beginPath(); ctx.roundRect(x - w * 0.05, y + h * fy, w * 0.17, h * 0.2, w * 0.05); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + w * 0.88, y + h * fy, w * 0.17, h * 0.2, w * 0.05); ctx.fill();
  }
  const g = ctx.createLinearGradient(x, 0, x + w, 0);                          // carroceria com volume
  g.addColorStop(0, col); g.addColorStop(0.5, o.hi || col); g.addColorStop(1, col);
  ctx.fillStyle = g; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = Math.max(1, h * 0.03);
  ctx.beginPath(); ctx.roundRect(x + w * 0.07, y, w * 0.86, h, [w * 0.44, w * 0.44, w * 0.24, w * 0.24]); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.22)";                                    // capô
  ctx.beginPath(); ctx.roundRect(x + w * 0.38, y + h * 0.04, w * 0.24, h * 0.24, w * 0.1); ctx.fill();
  ctx.fillStyle = "rgba(8,16,30,.9)";                                          // para-brisa e vidro traseiro
  ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.3); ctx.lineTo(x + w * 0.8, y + h * 0.3); ctx.lineTo(x + w * 0.72, y + h * 0.48); ctx.lineTo(x + w * 0.28, y + h * 0.48); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x + w * 0.26, y + h * 0.66, w * 0.48, h * 0.12, w * 0.08); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x + w * 0.3, y + h * 0.5, w * 0.4, h * 0.14);   // teto
  ctx.fillStyle = "#fff6c8";                                                   // faróis
  ctx.beginPath(); ctx.roundRect(x + w * 0.14, y + h * 0.045, w * 0.2, h * 0.05, w * 0.03); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x + w * 0.66, y + h * 0.045, w * 0.2, h * 0.05, w * 0.03); ctx.fill();
  ctx.fillStyle = "#ff3b4e";                                                   // lanternas
  ctx.beginPath(); ctx.roundRect(x + w * 0.14, y + h * 0.93, w * 0.22, h * 0.035, w * 0.02); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x + w * 0.64, y + h * 0.93, w * 0.22, h * 0.035, w * 0.02); ctx.fill();
  if (o.label != null) { ctx.fillStyle = o.labelCol || "#fff"; ctx.font = `800 ${Math.max(8, h * 0.2)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(o.label), cx, y + h * 0.58); }
  ctx.restore();
}
const carSVG = (col) => `<svg viewBox="0 0 46 100" width="40" height="86" aria-hidden="true"><g stroke="rgba(0,0,0,.75)" stroke-width="1.6" stroke-linejoin="round">
  <rect x="0" y="14" width="8" height="19" rx="2.5" fill="#0b0d10"/><rect x="38" y="14" width="8" height="19" rx="2.5" fill="#0b0d10"/><rect x="0" y="66" width="8" height="19" rx="2.5" fill="#0b0d10"/><rect x="38" y="66" width="8" height="19" rx="2.5" fill="#0b0d10"/>
  <rect x="3.5" y="1" width="39" height="98" rx="19" fill="${col}"/></g>
  <rect x="17" y="5" width="12" height="24" rx="5" fill="rgba(255,255,255,.22)"/><path d="M9.5 30h27l-3.5 18H13z" fill="rgba(8,16,30,.9)"/><rect x="14" y="66" width="18" height="12" rx="4" fill="rgba(8,16,30,.9)"/>
  <rect x="14" y="50" width="18" height="14" fill="rgba(255,255,255,.12)"/><rect x="7" y="5" width="9" height="5" rx="1.5" fill="#fff6c8"/><rect x="30" y="5" width="9" height="5" rx="1.5" fill="#fff6c8"/>
  <rect x="7" y="93" width="10" height="3.5" rx="1" fill="#ff3b4e"/><rect x="29" y="93" width="10" height="3.5" rx="1" fill="#ff3b4e"/></svg>`;

// ------------------------------------------------------------------ RADAR (carros ao lado, atrás e à frente)
function radarOverlay() {
  root.innerHTML = `<div class="card radar shadow"><canvas id="cv"></canvas>
    <div class="rd-sides" id="sd"><i class="L"></i><div class="mycar">${carSVG("#e8f0ff")}</div><i class="R"></i></div><div class="rd-gap" id="gp"></div><div class="rd-note" id="nt"></div></div>`;
  const card = root.firstChild, cv = root.querySelector("#cv"), ctx = cv.getContext("2d"), sd = root.querySelector("#sd"), gp = root.querySelector("#gp"), nt = root.querySelector("#nt");
  const SIZE = { top: [170, 250], circle: [230, 230], halo: [250, 250], sides: [0, 0] };
  const hsl = (h, a = 1) => `hsl(${Math.round(h)} 85% 55% / ${a})`;
  const heat = (d, R) => { const k = clamp(1 - d / R, 0, 1); return 130 - 130 * k; };          // longe = verde, colado = vermelho
  const alongside = (c) => Math.abs(c.fwd) < 6 && Math.abs(c.side) > 0.8 && Math.abs(c.side) < 6;
  function preview() {                                                                           // sem o jogo: carros de exemplo se movendo
    const t = performance.now() / 1000, cars = [
      { id: 1, n: 12, fwd: 22 * Math.sin(t * 0.5), side: 3.4 }, { id: 2, n: 44, fwd: -4 + 3 * Math.sin(t * 0.8), side: -3.4 },
      { id: 3, n: 7, fwd: -28 + 8 * Math.sin(t * 0.3), side: 0.4 }, { id: 4, n: 31, fwd: 30 + 6 * Math.sin(t * 0.4), side: -0.3 }];
    return { cars, left: alongside(cars[1]) ? 1 : 0, right: alongside(cars[0]) ? 1 : 0, source: "preview", calibrated: true };
  }
  function draw() {
    const style = pickStyle("radar", "rstyle", "top"), R = clamp(+cfg.range || 40, 15, 90), D = live() ? (data.radar || null) : previewing ? preview() : null;
    card.className = "card radar shadow r-" + style;
    const [W, H] = SIZE[style];
    const cars = D && D.cars ? D.cars.filter((c) => Math.abs(c.fwd) <= R) : [];
    const L = D ? D.left || cars.filter((c) => alongside(c) && c.side < 0).length : 0, Rr = D ? D.right || cars.filter((c) => alongside(c) && c.side > 0).length : 0;
    nt.textContent = !D ? (live() ? "" : "Aguardando o jogo…") : D.source === "acc" && !D.calibrated ? "Calibrando… dirija reto por alguns segundos" : !D.source && live() ? "Sem dados de posição dos carros" : "";
    // nearest ahead/behind in the same lane
    const lane = cars.filter((c) => Math.abs(c.side) < 2.6), ahead = lane.filter((c) => c.fwd > 0).sort((a, b) => a.fwd - b.fwd)[0], behind = lane.filter((c) => c.fwd < 0).sort((a, b) => b.fwd - a.fwd)[0];
    gp.style.display = cfg.gap && style !== "sides" && D ? "" : "none";
    gp.innerHTML = `<span>▲ ${ahead ? Math.round(ahead.fwd) + " m" : "—"}</span><span>▼ ${behind ? Math.round(-behind.fwd) + " m" : "—"}</span>`;
    sd.style.display = style === "sides" ? "" : "none";
    if (style === "sides") {
      sd.querySelector(".L").className = "L" + (L ? " on" : ""); sd.querySelector(".R").className = "R" + (Rr ? " on" : "");
      sd.classList.toggle("wide", L > 0 && Rr > 0);
      sd.querySelector(".L").dataset.n = L > 1 ? L : ""; sd.querySelector(".R").dataset.n = Rr > 1 ? Rr : "";
      return;
    }
    const dpr = (window.devicePixelRatio || 1) * clamp(cfg.scale, 40, 300) / 100;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const label = (c, x, y) => { if (!cfg.numbers || c.n == null) return; ctx.fillStyle = "#fff"; ctx.font = "700 10px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(c.n), x, y); };
    if (style === "top") {
      const cx = W / 2, cy = H / 2, ky = (H / 2 - 14) / R, kx = (W / 2 - 14) / 9;
      ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.fillRect(10, 8, W - 20, H - 16);
      ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.setLineDash([6, 8]); ctx.lineWidth = 1.5;
      for (const s of [-1.8, 1.8]) { ctx.beginPath(); ctx.moveTo(cx + s * 2 * kx, 10); ctx.lineTo(cx + s * 2 * kx, H - 10); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.beginPath(); ctx.moveTo(10, cy - R / 2 * ky); ctx.lineTo(W - 10, cy - R / 2 * ky); ctx.moveTo(10, cy + R / 2 * ky); ctx.lineTo(W - 10, cy + R / 2 * ky); ctx.stroke();
      for (const c of cars) {
        const x = cx + clamp(c.side, -9, 9) * kx, y = cy - c.fwd * ky, d = Math.hypot(c.fwd, c.side * 1.5), col = hsl(heat(d, R * 0.8));
        drawCar(ctx, x, y, 42, col, { glow: alongside(c) ? col : null, label: cfg.numbers ? c.n : null, hi: hsl(heat(d, R * 0.8), 1) });
      }
      drawCar(ctx, cx, cy, 46, "#e8f0ff", { glow: "#3ee08f", hi: "#ffffff" });                       // seu carro
    } else if (style === "circle") {
      const cx = W / 2, cy = H / 2, k = (W / 2 - 12) / R;
      ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5;
      for (const f of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(cx, cy, (W / 2 - 12) * f, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx, 8); ctx.lineTo(cx, H - 8); ctx.moveTo(8, cy); ctx.lineTo(W - 8, cy); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.04)"; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 12, 0, 7); ctx.fill();
      for (const c of cars) {
        const x = cx + clamp(c.side * 2.2, -R, R) * k * 0.62, y = cy - c.fwd * k, d = Math.hypot(c.fwd, c.side * 1.5);
        if (Math.hypot(x - cx, y - cy) > W / 2 - 8) continue;
        const col = hsl(heat(d, R * 0.8));
        drawCar(ctx, x, y, 30, col, { glow: alongside(c) ? col : null, label: cfg.numbers ? c.n : null });
      }
      drawCar(ctx, cx, cy, 38, "#e8f0ff", { glow: "#3ee08f", hi: "#ffffff" });
    } else {                                                                                         // halo: oito setores ao redor do carro acendem conforme a proximidade
      const cx = W / 2, cy = H / 2, r0 = W / 2 - 38, sec = new Array(8).fill(0), near = new Array(8).fill(1e9);
      for (const c of cars) {
        const ang = (Math.atan2(c.side * 1.6, c.fwd) + 2 * Math.PI) % (2 * Math.PI), k = Math.round(ang / (Math.PI / 4)) % 8, d = Math.hypot(c.fwd, c.side * 1.6);
        sec[k] = Math.max(sec[k], clamp(1 - d / R, 0, 1)); near[k] = Math.min(near[k], d);
      }
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 4, v = sec[k];
        ctx.lineCap = "round"; ctx.lineWidth = 14 + 8 * v;
        ctx.strokeStyle = v > 0.02 ? hsl(130 - 130 * clamp(v * 1.3, 0, 1), 0.35 + 0.65 * v) : "rgba(255,255,255,.08)";
        if (v > 0.5) { ctx.shadowColor = hsl(0); ctx.shadowBlur = 16; }
        ctx.beginPath(); ctx.arc(cx, cy, r0, a - Math.PI / 8 + 0.07, a + Math.PI / 8 - 0.07); ctx.stroke(); ctx.shadowBlur = 0;
      }
      drawCar(ctx, cx, cy, 84, "#e8f0ff", { hi: "#ffffff" });
    }
  }
  const loop = () => { draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return { onData() {}, onCfg() {} };
}

// ------------------------------------------------------------------ PONTO CEGO (uma luz por lado, cada uma numa janela para pôr onde quiser)
function blindOverlay(side) {                                    // side: "L" | "R"
  const left = side === "L";
  root.innerHTML = `<div class="card blind"><div class="bs" id="bs"></div></div>`;
  const bs = root.querySelector("#bs");
  const ICON = `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true" style="${left ? "transform:scaleX(-1)" : ""}">
    <rect x="6" y="18" width="24" height="40" rx="9" fill="rgba(255,255,255,.9)" stroke="rgba(0,0,0,.6)" stroke-width="2"/><rect x="11" y="26" width="14" height="9" rx="3" fill="rgba(8,16,30,.9)"/>
    <path class="a1" d="M38 30a9 9 0 0 1 0 14" fill="none" stroke-width="5" stroke-linecap="round"/><path class="a2" d="M45 24a17 17 0 0 1 0 26" fill="none" stroke-width="5" stroke-linecap="round"/><path class="a3" d="M52 18a25 25 0 0 1 0 38" fill="none" stroke-width="5" stroke-linecap="round"/></svg>`;
  function preview() {                                          // sem o jogo: acende e apaga para mostrar como fica
    const t = (performance.now() / 1000 + (left ? 0 : 3)) % 8;
    return { cars: t > 1 && t < 6 ? [{ fwd: t < 3 ? -7 + (t - 1) * 3.5 : t < 4.5 ? 0 : 2.5, side: left ? -3.4 : 3.4 }] : [], left: 0, right: 0, source: "preview" };
  }
  function draw() {
    const style = pickStyle("blind", "bstyle", "dot"), D = live() ? (data.radar || null) : previewing ? preview() : null;
    const zone = (D && D.cars ? D.cars : []).filter((c) => (left ? c.side < 0 : c.side > 0) && Math.abs(c.side) < 7 && c.fwd > -9 && c.fwd < 4.2);
    const n = Math.max(zone.length, D ? (left ? D.left : D.right) || 0 : 0), close = zone.some((c) => Math.abs(c.fwd) < 3.2) || n > 1;
    const state = !n ? "off" : close ? "danger" : "warn";
    if (bs.dataset.st !== state + style) {
      bs.dataset.st = state + style;
      bs.className = `bs b-${style} ${state}${cfg.always === false && state === "off" ? " hid" : ""}`;
      bs.innerHTML = style === "icon" ? ICON : "";
    }
    bs.dataset.n = n > 1 ? n : "";
    bs.classList.toggle("hid", cfg.always === false && state === "off");
  }
  const loop = () => { draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return { onData() {}, onCfg() { bs.dataset.st = ""; } };
}

// ------------------------------------------------------------------ PARTICIPANTES
// símbolos das marcas (pasta web/brands, ícones do projeto Simple Icons); sem arquivo, cai para a sigla em texto
const BRAND_FILE = { POR: "porsche", MER: "mercedes", FER: "ferrari", AUD: "audi", LAM: "lamborghini", MCL: "mclaren", NIS: "nissan", BMW: "bmw",
  BEN: "bentley", AMR: "astonmartin", JAG: "jaguar", HON: "honda", CHE: "chevrolet", KTM: "ktm", MAS: "maserati", FOR: "ford", TOY: "toyota",
  CAD: "cadillac", ACU: "acura", HYU: "hyundai", MAZ: "mazda", VW: "volkswagen" };
// logotipos originais, coloridos e com fundo transparente (web/brands/color); sem arquivo, cai para a sigla
const BRAND_COLOR_FILE = { ...BRAND_FILE, LEX: "lexus", ALP: "alpine", GIN: "ginetta" };
const TR_MIN = 1.5;       // ms/s (~0,14 s por volta de 90 s): abaixo disso a distância está estável
const COLS = {
  pos: ["Pos", "pos", "c"], number: ["#", "dim r", ""], name: ["Piloto", "", ""], cls: ["Classe", "dim", ""],
  gap_leader: ["Líder", "r num", ""], interval: ["À frente", "r num", ""], vs_me: ["Δ eu", "r num", ""],
  last: ["Última", "r num", ""], best: ["Melhor", "r num", ""], laps: ["Voltas", "dim r num", ""], pit: ["Box", "c", ""], car: ["Carro", "", ""], trend: ["Tendência", "r num", ""],
};
function standingsOverlay() {
  root.innerHTML = `<div class="card stand shadow" id="st"></div>`;
  const st = root.querySelector("#st");
  const nameOf = (r) => cfg.name === "short" ? (r.short || r.last || "?") : cfg.name === "last" ? (r.last || r.short || "?")
    : [r.first, r.last].filter(Boolean).join(" ") || r.short || "?";
  const hms = (ms) => { const t = Math.max(0, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
  function previewData() {
    const names = [["Lucas", "Almeida"], ["Marco", "Bianchi"], ["Tiago", "Ferreira"], ["Pedro", "Lima"], ["Rafa", "Moreira"], ["Hygor", "Rocha"],
      ["Bruno", "Costa"], ["Ana", "Ribeiro"], ["Caio", "Nunes"], ["Felipe", "Duarte"], ["Yuri", "Matos"], ["Gabriel", "Rocha"]];
    const cars = [["BMW", "M4"], ["FER", "296"], ["POR", "992 R"], ["AUD", "R8 Evo2"], ["MER", "AMG"], ["MCL", "720S"]];
    const rows = names.map((n, i) => { const gt4 = i >= 8, c = gt4 ? ["BMW", "M4 GT4"] : cars[i % cars.length];
      return { pos: i + 1, number: 10 + i * 7, first: n[0], last: n[1], short: n[1].slice(0, 3).toUpperCase(), cls: gt4 ? "GT4" : "GT3", cls_color: gt4 ? "#3d8bff" : "#e8505b",
        brand: c[0], model: c[1], cls_pos: gt4 ? i - 7 : i + 1, laps: 7, best_ms: 98500 + i * 410, last_ms: i === 0 || i === 2 || i === 8 ? 98500 + i * 410 : 98900 + i * 380, pit: i === 9, me: i === 5,
        gap_leader: i ? { ms: i * 1300 } : null, interval: i ? { ms: 900 + i * 40 } : null, trend_int: i ? { good: [0, 2.5, -3, 0.4, 4, -2, 3, -4, 1, -1, 0, 2][i] } : null, vs_me: i === 5 ? null : { ms: (i - 5) * 1100 },
        trend: i === 5 ? null : (() => { const ahead = i < 5, good = [4, -3, 0.5, -5, 6, 0, 2.5, -4, 3, 0, 1, -2][i]; return { good, per_lap: good * 0.09 }; })() }; });
    return { race: true, rows, classes: [{ name: "GT3", color: "#e8505b", n: 8 }, { name: "GT4", color: "#3d8bff", n: 4 }],
      header: { time_left: 1208000, total: 2700000, lap: 7, total_laps: 20, count: 36, type: "Race" } };
  }
  function render() {
    let s = live() ? data.standings : previewing ? previewData() : null;
    if (!s) { st.innerHTML = `<div class="msg">${data && data.status === "idle" ? "Aguardando o jogo…" : "Sem dados"}</div>`; return; }
    if (!s.rows || !s.rows.length) { st.innerHTML = `<div class="msg">${s.status || "Sem dados dos outros pilotos."}</div>`; return; }
    const rows = s.rows, N = clamp(cfg.rows, 3, 40), K = clamp(cfg.others, 1, 10);
    const classes = (s.classes || []).filter((g) => g.name);
    const multi = cfg.group && classes.length > 1;
    // quais linhas mostrar de uma lista (a minha classe: em volta de mim / os primeiros; as outras: só os primeiros)
    const pick = (list, n) => {
      const meI = list.findIndex((r) => r.me);
      let show;
      if (cfg.view === "around" && meI >= 0) { const a = clamp(meI - Math.floor(n / 2), 0, Math.max(0, list.length - n)); show = list.slice(a, a + n); }
      else { show = list.slice(0, n); if (meI >= n) { show = show.slice(0, n - 1); show.push(list[meI]); } }
      // o líder da classe e quem tem a melhor volta (o roxo) aparecem sempre, mesmo fora da janela em volta de você
      const idx = new Set(show.map((r) => list.indexOf(r)));
      idx.add(0);
      const bi = list.findIndex((r) => isBest(r)); if (bi >= 0) idx.add(bi);
      const out = []; let prev = -1;
      for (const i of [...idx].sort((x, y) => x - y)) { if (prev >= 0 && i - prev > 1) out.push(null); out.push(list[i]); prev = i; }
      return out;
    };
    const ss = pickStyle("standings", "sstyle", "classic");
    st.className = "card stand shadow s-" + ss;
    let want = ss === "tower" ? ["pos", "number", "name", s.race ? "interval" : "best"] : cfg.cols;
    if (ss === "compact") want = want.filter((c) => !["car", "trend", "laps", "cls", "gap_leader"].includes(c));
    const cols = want.filter((c) => COLS[c] && (c !== "cls" || rows.some((r) => r.cls)) && (c !== "car" || rows.some((r) => r.brand)));
    const bestAll = Math.min(...rows.map((r) => r.best_ms || 1e12));
    const bestCls = {};                                    // com várias classes, o mais rápido de cada classe fica roxo
    for (const r of rows) { const k = r.cls || ""; if (r.best_ms && (!bestCls[k] || r.best_ms < bestCls[k])) bestCls[k] = r.best_ms; }
    const isBest = (r) => r.best_ms && r.best_ms === (multi ? bestCls[r.cls || ""] : bestAll);
    const W = { name: "minmax(88px,1fr)", pos: "34px", number: "40px", pit: "40px", cls: "52px", laps: "52px", trend: "78px", car: cfg.carstyle === "logo" ? "64px" : cfg.carstyle === "text" ? "92px" : "118px" };
    const tpl = cols.map((c) => W[c] || "74px").join(" ");
    const clsPos = multi && cfg.classpos;
    const rowHtml = (r) => cols.map((c, ci) => {
      let v = "", cls = COLS[c][1] + (c === "car" && cfg.carstyle === "logo" ? " mid" : ""), style = "";
      if (c === "pos") v = clsPos ? r.cls_pos : r.pos;
      else if (c === "number") v = r.number != null ? "#" + r.number : "";
      else if (c === "name") v = nameOf(r).replace(/</g, "&lt;");
      else if (c === "car") {
        const mode = cfg.logomode || "color", mdl = r.model ? String(r.model).replace(/</g, "&lt;") : "", tip = esc(r.brand + " " + (r.model || ""));
        // colorido: logotipo original sem fundo; branco: só o contorno em branco; etiqueta: preto numa etiqueta clara
        const f = mode === "color" ? BRAND_COLOR_FILE[r.brand] : BRAND_FILE[r.brand];
        const logo = !f ? "" : mode === "color" ? `<img class="carlogo color" src="/static/brands/color/${f}.png" alt="${esc(r.brand)}" title="${tip}">`
          : mode === "mono" ? `<span class="logo" title="${tip}" style="--c:#fff;--u:url(/static/brands/${f}.svg)"></span>`
          : `<img class="carlogo" src="/static/brands/${f}.svg" alt="${esc(r.brand)}" title="${tip}">`;
        const wrap = mode === "chip" ? "" : " plain";
        v = !r.brand ? "" : cfg.carstyle === "logo" ? (f ? `<span class="carchip sym${wrap}" title="${tip}">${logo}</span>` : `<span class="carchip${wrap}" title="${tip}"><b>${r.brand}</b></span>`)
          : cfg.carstyle === "text" ? `<span class="carchip${wrap}"><b>${r.brand}</b>${mdl ? `<i>${mdl}</i>` : ""}</span>`
          : `<span class="carchip ${f ? "withsym" : ""}${wrap}">${logo}<b>${r.brand}</b>${mdl ? `<i>${mdl}</i>` : ""}</span>`;
      }
      else if (c === "cls") v = r.cls || "";
      else if (c === "gap_leader") v = (clsPos ? r.cls_pos === 1 : r.pos === 1) ? "" : fmtGap(r.gap_leader);
      else if (c === "interval") {
        v = r.interval ? fmtGap(r.interval) : "";
        const t = r.trend_int;
        if (v && cfg.trendcolor && t) cls += t.good > TR_MIN ? " tr-good" : t.good < -TR_MIN ? " tr-bad" : " tr-flat";
      }
      else if (c === "vs_me") {
        v = r.me ? "" : fmtGap(r.vs_me); const g = r.vs_me;
        if (g && cfg.trendcolor && r.trend) cls += r.trend.good > TR_MIN ? " tr-good" : r.trend.good < -TR_MIN ? " tr-bad" : " tr-flat";
        else if (g) cls += (g.laps ? g.laps < 0 : g.ms < 0) ? " ahead" : " behind";
      }
      else if (c === "trend") {
        const t = r.trend;
        if (r.me || !t) v = "";
        else {
          const up = t.good > TR_MIN, dn = t.good < -TR_MIN;
          v = `<span class="trd ${up ? "tr-good" : dn ? "tr-bad" : "tr-flat"}">${up ? "▲" : dn ? "▼" : "•"}<b class="num">${Math.abs(t.per_lap).toFixed(2)}</b></span>`;
        }
      }
      else if (c === "last") {                          // roxo: a última volta foi a melhor da sessão (da classe); verde: foi a melhor dele
        v = r.last_ms ? fmtLap(r.last_ms) : "—";
        if (r.last_ms && isBest({ ...r, best_ms: r.last_ms })) cls += " best-all";
        else if (r.last_ms && r.last_ms === r.best_ms) cls += " best-own";
      }
      else if (c === "best") { v = r.best_ms ? fmtLap(r.best_ms) : "—"; if (isBest(r)) cls += " best-all"; }
      else if (c === "laps") v = r.laps;
      else if (c === "pit") v = r.pit ? `<span class="pit">BOX</span>` : "";
      if (ci === 0 && r.cls_color && multi) style = `box-shadow: inset 3px 0 0 ${r.cls_color}`;
      return `<div class="cell ${cls} ${r.me ? "row-me" : ""} ${ci === 0 ? "first" : ""} ${ci === cols.length - 1 ? "last" : ""}" style="${style}">${v}</div>`;
    }).join("");
    // cabeçalho: tempo da sessão, volta e número de pilotos
    const H = s.header || {};
    let bar = "";
    if (cfg.header) {
      const t = H.time_left > 0 ? `<span class="clk"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg><b class="num">${hms(H.time_left)}</b>${H.total > 0 ? `<em> / ${Math.round(H.total / 60000)}m</em>` : ""}</span>` : `<span class="clk">${esc(s.race ? "Corrida" : "Classificação")}</span>`;
      const lap = H.total_laps > 0 ? `Volta <b class="num">${Math.min(H.lap, H.total_laps)}</b>/${H.total_laps}` : H.lap ? `Volta <b class="num">${H.lap}</b>` : "";
      bar = `<div class="st-bar">${t}<span class="st-lap">${lap}</span><span class="st-cnt"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/></svg><b class="num">${H.count || rows.length}</b></span></div>`;
    } else bar = `<div class="title"><span>${s.race ? "Corrida" : "Classificação"}</span><span>${rows.length} pilotos</span></div>`;
    let h = bar + `<div class="grid" style="grid-template-columns:${tpl}">`;
    h += cols.map((c) => `<div class="cell hd ${COLS[c][1].includes("r") ? "r" : COLS[c][1].includes("c") ? "pos" : c === "car" && cfg.carstyle === "logo" ? "mid" : ""}">${COLS[c][0]}</div>`).join("");
    const emit = (list) => { for (const r of list) { if (!r) { h += `<div class="sep" style="grid-column:1/-1"></div>`; continue; } h += rowHtml(r); } };
    if (multi) {
      for (const g of classes) {
        const list = rows.filter((r) => (r.cls || "") === g.name);
        if (!list.length) continue;
        h += `<div class="st-cls" style="grid-column:1/-1;--c:${g.color || "#888"}"><b>${esc(g.name)}</b><span class="num">${list.length}</span></div>`;
        emit(pick(list, list.some((r) => r.me) ? N : K));
      }
    } else emit(pick(rows, N));
    st.innerHTML = h + "</div>";
  }
  return { onData: render, onCfg: render };
}

// ---- estilo "ACC": vista de cima do carro, como o widget do próprio jogo
function tyresACC() {
  const WX = ["Agora", "10'", "30'"];
  const wxIcon = (lv) => {                      // 0 sol, 1 nublado/garoa, 2-3 chuva, 4-5 chuva forte/tempestade
    const st = 'fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
    if (lv <= 0) return `<svg viewBox="0 0 32 32" width="30" height="30" ${st}><circle cx="16" cy="16" r="5.5" stroke="#ffc233"/><path stroke="#ffc233" d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M24.5 7.5l-2 2M9.5 22.5l-2 2"/></svg>`;
    const cloud = `<path stroke="#c9d3e3" d="M9 20a5 5 0 0 1 .8-9.9A7 7 0 0 1 23 11.5a4.3 4.3 0 0 1-.5 8.5z"/>`;
    if (lv === 1) return `<svg viewBox="0 0 32 32" width="30" height="30" ${st}>${cloud}<path stroke="#6fb4ff" d="M12 24l-1 2.5M18 24l-1 2.5"/></svg>`;
    if (lv <= 3) return `<svg viewBox="0 0 32 32" width="30" height="30" ${st}>${cloud}<path stroke="#4da3ff" d="M11 23l-1.6 4M16 23l-1.6 4M21 23l-1.6 4"/></svg>`;
    return `<svg viewBox="0 0 32 32" width="30" height="30" ${st}>${cloud}<path stroke="#3d8bff" d="M10 23l-1.8 4.5M15 23l-1.8 4.5M20 23l-1.8 4.5M24.5 23l-1.8 4.5"/>${lv >= 5 ? '<path stroke="#ffd21f" d="M17 11l-3 5h4l-3 5"/>' : ""}</svg>`;
  };
  const GRIP = { Green: "Pista verde", Fast: "Pista seca", Optimum: "Pista seca · ideal", Greasy: "Pista escorregadia", Damp: "Pista úmida", Wet: "Pista molhada", Flooded: "Pista alagada" };
  const tyre = (i) => `<div class="ta-tyre" data-w="${i}"><div class="st"><i></i><i></i><i></i></div><b class="num"></b><div class="wr"><i></i></div></div>`;
  const prs = (i) => `<div class="ta-p num" data-w="${i}">—</div>`;
  const brk = (a, b) => `<div class="ta-brk"><div class="bk" data-w="${a}"><i></i></div><div class="bk" data-w="${b}"><i></i></div></div>`;
  root.innerHTML = `<div class="card tyacc shadow"><div class="ta-wx" id="wx"></div><div class="ta-car">
      ${prs(0)}<div></div>${prs(1)}
      ${tyre(0)}${brk(0, 1)}${tyre(1)}
      <div class="ta-mid" id="grip"></div>
      ${tyre(2)}${brk(2, 3)}${tyre(3)}
      ${prs(2)}<div></div>${prs(3)}</div><div class="ta-pads" id="pads"></div></div>`;
  const q = (s, el = root) => el.querySelector(s);
  const hsl = (h, l = 52) => `hsl(${Math.round(h)} 78% ${l}%)`;
  const tcol = (t) => t <= 0 ? "#3a4352" : heatCol(t, cfg.tmin, cfg.tmax);
  const pcol = (p) => p <= 0 ? "var(--muted)" : heatCol(p, cfg.pmin, cfg.pmax, 62);
  const bcol = (b) => b <= 0 ? "#3a4352" : heatCol(b, cfg.bmin, cfg.bmax);
  const wcol = (left) => hsl(clamp(left, 0, 1) * 125);
  const preview = () => { const t = performance.now() / 1000;
    return { temp: [88, 94, 82, 86].map((v, i) => v + 4 * Math.sin(t / 2 + i)), press: [26.8, 26.1, 26.8, 26.3], brake: [520, 540, 380, 360].map((v, i) => v + 120 * Math.sin(t + i)),
      wear: [0.12, 0.14, 0.1, 0.1], pad: [24, 24, 22.5, 22.5], rain: [0, 1, 3], grip: "Optimum", compound: "dry_compound",
      zones: [0, 1, 2].map((z) => [0, 1, 2, 3].map((k) => 88 + [9, 0, -9][z] + 5 * Math.sin(t / 2 + k)))  /* só o exemplo: interna mais quente */ }; };
  function render() {
    const T = live() ? data.tyres : previewing ? preview() : null;
    const car = q(".ta-car");
    if (!T) { car.style.opacity = .35; return; }
    car.style.opacity = 1;
    const wx = q("#wx");
    const rain = T.rain && T.rain.length ? T.rain : null;
    wx.style.display = cfg.weather && rain ? "" : "none";
    if (rain) wx.innerHTML = rain.slice(0, 3).map((lv, i) => `<div class="wxc">${wxIcon(lv)}<small>${WX[i]}</small></div>`).join("");
    const gp = q("#grip");
    gp.style.display = cfg.weather && T.grip ? "" : "none";
    gp.textContent = (GRIP[T.grip] || T.grip || "").toUpperCase();
    for (let i = 0; i < 4; i++) {
      const el = q(`.ta-tyre[data-w="${i}"]`), t = T.temp[i], w = T.wear ? T.wear[i] : null;
      const c = tcol(t);
      const st = el.querySelectorAll(".st i");
      // com as três temperaturas (interna, meio, externa) cada faixa tem a sua cor; sem elas, todas usam a do núcleo.
      // Pneus da esquerda: externa | meio | interna; da direita: interna | meio | externa.
      const Z = T.zones && T.zones.length === 3 ? T.zones : null;
      st.forEach((s, k) => {
        const zt = Z ? Z[(i % 2 === 0 ? [2, 1, 0] : [0, 1, 2])[k]][i] : t, cc = Z ? tcol(zt) : c;
        s.style.background = `linear-gradient(180deg, ${cc}, color-mix(in srgb, ${cc} ${k === 1 ? 70 : 58}%, #0b0d10))`;
        s.title = Z ? `${["Externa", "Meio", "Interna"][i % 2 === 0 ? k : 2 - k]}: ${Math.round(zt)} °C` : "";
      });
      const nb = el.querySelector("b"); nb.style.display = cfg.temp ? "" : "none"; nb.textContent = t > 0 ? Math.round(t) + "°" : "—";
      const wr = el.querySelector(".wr");
      wr.style.display = cfg.wear && w != null ? "" : "none";
      if (w != null) { const left = 1 - w; wr.firstChild.style.width = clamp(left, 0, 1) * 100 + "%"; wr.firstChild.style.background = wcol(left * 1.3 - 0.1); }
      const pe = q(`.ta-p[data-w="${i}"]`), bar = cfg.punit === "bar", p = T.press[i], pv = bar ? p * 0.0689476 : p;
      pe.style.display = cfg.press ? "" : "none";
      pe.textContent = p > 0 ? pv.toFixed(bar ? 2 : 1) + (bar ? " bar" : " psi") : "—"; pe.style.color = pcol(p);
      const bk = q(`.bk[data-w="${i}"]`), b = T.brake[i];
      bk.style.display = cfg.brake ? "" : "none";
      bk.title = `Freio ${Math.round(b)} °C`;
      bk.firstChild.style.height = clamp((b - 100) / (cfg.bmax + 250 - 100), 0.04, 1) * 100 + "%"; bk.firstChild.style.background = bcol(b);
    }
    const pd = q("#pads");
    pd.style.display = cfg.pads && T.pad ? "" : "none";
    if (T.pad) pd.textContent = "pastilhas " + T.pad.map((v) => v.toFixed(0)).join(" · ") + " mm";
  }
  return { onData: render, onCfg: render };
}

// escolhe o estilo (ACC ou cartões) e refaz a janela se ele mudar
function tyresOverlay() {
  let style = null, impl = null;
  const pick = () => {
    const s = pickStyle("tyres", ["acc", "cards", "minimal", "row"].includes(cfg.tystyle) ? "tystyle" : "_", "acc");
    if (s !== style) { style = s; impl = s === "cards" ? tyresCards() : s === "minimal" ? tyresMini(false) : s === "row" ? tyresMini(true) : tyresACC(); lastSize = ""; }
    return impl;
  };
  pick();
  return { onData() { pick().onData(); }, onCfg() { pick().onCfg(); } };
}

// ------------------------------------------------------------------ DELTA
function deltaOverlay() {
  root.innerHTML = `<div class="card delta shadow"><div class="big num" id="big">—</div><div class="dbar"><i id="bar"></i></div>
    <div class="row"><span id="ref">aguardando…</span><span class="num" id="pred"></span></div>
    <div class="row"><span class="num" id="fuel"></span><span class="num" id="fend"></span></div></div>`;
  const $ = (s) => root.querySelector(s);
  function render() {
    root.firstChild.className = "card delta shadow d-" + pickStyle("delta", "dstyle", "classic");
    let d = live() ? data.delta : previewing ? { state: "recording", delta_ms: -234, predicted_ms: 98260, ref_ms: 98494, ref_kind: "pb", fuel_laps: 12.4, fuel_to_end: -1.8 } : null;
    const big = $("#big");
    if (!d || d.state !== "recording") { big.textContent = "—"; big.className = "big num"; $("#ref").textContent = "aguardando o jogo…"; $("#bar").style.width = "0"; $("#pred").textContent = $("#fuel").textContent = $("#fend").textContent = ""; return; }
    const v = d.delta_ms;
    big.textContent = v == null ? (d.in_pit_lane ? "BOX" : "—") : fmtDelta(v);
    big.className = "big num " + (v == null ? "" : v > 0 ? "slow" : "fast");
    const w = v == null ? 0 : clamp(Math.abs(v) / 1500, 0, 1) * 50, bar = $("#bar");
    bar.style.width = w + "%"; bar.style.left = v > 0 ? "50%" : (50 - w) + "%";
    bar.style.background = v > 0 ? "var(--bad)" : "var(--good)";
    $("#ref").textContent = d.ref_kind ? (d.ref_kind === "ideal" ? "vs volta ideal " : "vs recorde ") + fmtLap(d.ref_ms) : "sem referência ainda";
    $("#pred").textContent = cfg.predicted && d.predicted_ms ? "prev. " + fmtLap(d.predicted_ms) : "";
    $("#fuel").textContent = cfg.fuel && d.fuel_laps != null ? `⛽ ${String(d.fuel_laps).replace(".", ",")} voltas` : "";
    const fe = d.fuel_to_end;
    $("#fend").textContent = cfg.fuel && fe != null ? (fe > 0 ? `falta ${String(fe).replace(".", ",")} L` : `sobra ${String(-fe).replace(".", ",")} L`) : "";
    $("#fend").style.color = fe > 0 ? "var(--bad)" : "var(--good)";
  }
  return { onData: render, onCfg: render };
}

// ------------------------------------------------------------------ PNEUS (modelos enxutos: quadrados 2x2 ou faixa horizontal)
function tyresMini(row) {
  root.innerHTML = `<div class="card tymini ${row ? "row" : ""} shadow">${[0, 1, 2, 3].map((i) => `<div class="tm" data-w="${i}"><b class="num tt">—</b><small class="num tp">—</small>${row ? `<div class="tb"><i></i></div><div class="tw"><i></i></div>` : ""}</div>`).join("")}</div>`;
  const hsl = (h, l = 52) => `hsl(${Math.round(h)} 78% ${l}%)`;
  const tcol = (t) => t <= 0 ? "#3a4352" : heatCol(t, cfg.tmin, cfg.tmax);
  const bcol = (b) => b <= 0 ? "#3a4352" : heatCol(b, cfg.bmin, cfg.bmax);
  const wcol = (left) => hsl(clamp(left, 0, 1) * 125);
  const preview = () => { const t = performance.now() / 1000;
    return { temp: [88, 94, 82, 86].map((v, i) => v + 4 * Math.sin(t / 2 + i)), press: [26.8, 26.1, 26.8, 26.3], brake: [520, 540, 380, 360].map((v, i) => v + 120 * Math.sin(t + i)), wear: [0.12, 0.14, 0.1, 0.1] }; };
  function render() {
    const T = live() ? data.tyres : previewing ? preview() : null;
    const box = root.firstChild;
    box.style.opacity = T ? 1 : .35;
    if (!T) return;
    for (let i = 0; i < 4; i++) {
      const el = box.children[i], t = T.temp[i], p = T.press[i], c = tcol(t), bar = cfg.punit === "bar", pv = bar ? p * 0.0689476 : p;
      el.style.background = `linear-gradient(180deg, ${c}, color-mix(in srgb, ${c} 55%, #0b0d10))`;
      const tt = el.querySelector(".tt"), tp = el.querySelector(".tp");
      tt.style.display = cfg.temp ? "" : "none"; tt.textContent = t > 0 ? Math.round(t) + "°" : "—";
      tp.style.display = cfg.press ? "" : "none"; tp.textContent = p > 0 ? pv.toFixed(bar ? 2 : 1) : "—";
      if (row) {
        const tb = el.querySelector(".tb"), tw = el.querySelector(".tw"), b = T.brake ? T.brake[i] : 0, w = T.wear ? T.wear[i] : null;
        tb.style.display = cfg.brake ? "" : "none"; tb.firstChild.style.width = clamp((b - 100) / (cfg.bmax + 250 - 100), 0.04, 1) * 100 + "%"; tb.firstChild.style.background = bcol(b);
        tw.style.display = cfg.wear && w != null ? "" : "none";
        if (w != null) { tw.firstChild.style.width = clamp(1 - w, 0, 1) * 100 + "%"; tw.firstChild.style.background = wcol((1 - w) * 1.3 - 0.1); }
      }
    }
  }
  return { onData: render, onCfg: render };
}

// ------------------------------------------------------------------ PNEUS
function tyresCards() {
  const NAMES = ["FL", "FR", "RL", "RR"], LBL = ["Diant. esq.", "Diant. dir.", "Tras. esq.", "Tras. dir."];
  root.innerHTML = `<div class="card tyres shadow"><div class="ty-comp" id="tc"></div><div class="ty-grid" id="tg"></div></div>`;
  const tg = root.querySelector("#tg"), tc = root.querySelector("#tc");
  tg.innerHTML = NAMES.map((n, i) => `<div class="ty" id="ty${i}">
      <div class="ty-main"><div class="ty-tyre"><b class="num ty-t">—</b><small>${LBL[i]}</small></div></div>
      <div class="ty-p num">—</div><div class="ty-wear"><i></i><span class="num"></span></div>
      <div class="ty-br" title="Temperatura do disco de freio"><small>FREIO</small><b class="num">—</b><div class="bar"><i></i></div></div>
      <div class="ty-pad num" title="Vida restante da pastilha"></div></div>`).join("");
  const hsl = (h, l = 52) => `hsl(${Math.round(h)} 78% ${l}%)`;
  const tcol = (t) => t <= 0 ? "#3a4352" : heatCol(t, cfg.tmin, cfg.tmax);
  const pcol = (p) => p <= 0 ? "var(--muted)" : heatCol(p, cfg.pmin, cfg.pmax, 62);
  // freio: abaixo da faixa = azul (frio), dentro = verde, acima = laranja e depois vermelho (risco de fade)
  const bcol = (b) => b <= 0 ? "#3a4352" : heatCol(b, cfg.bmin, cfg.bmax);
  const wcol = (left) => hsl(clamp(left, 0, 1) * 125);
  const preview = () => { const t = performance.now() / 1000;
    return { temp: [88, 94, 82, 86].map((v, i) => v + 4 * Math.sin(t / 2 + i)), press: [27.2, 27.4, 26.9, 27.1], brake: [520, 540, 380, 360].map((v, i) => v + 120 * Math.sin(t + i)),
      wear: [0.12, 0.14, 0.1, 0.1], pad: [24, 24, 22.5, 22.5], compound: "dry_compound" }; };
  function render() {
    const T = live() ? data.tyres : previewing ? preview() : null;
    if (!T) { tg.style.opacity = .35; return; }
    tg.style.opacity = 1;
    tc.style.display = cfg.compound && T.compound ? "" : "none";
    tc.textContent = /wet/i.test(T.compound || "") ? "Pneu de chuva" : "Pneu de seco";
    for (let i = 0; i < 4; i++) {
      const el = tg.children[i], t = T.temp[i], p = T.press[i], b = T.brake[i], w = T.wear ? T.wear[i] : null;
      const tyre = el.querySelector(".ty-tyre");
      tyre.style.background = `linear-gradient(180deg, ${tcol(t)}, color-mix(in srgb, ${tcol(t)} 55%, #0b0d10))`;
      el.querySelector(".ty-t").textContent = cfg.temp ? (t > 0 ? Math.round(t) + "°" : "—") : "";
      el.querySelector(".ty-t").style.display = cfg.temp ? "" : "none";
      const bk = el.querySelector(".ty-br");
      bk.style.display = cfg.brake ? "" : "none";
      bk.querySelector("b").textContent = b > 0 ? Math.round(b) + "°" : "—"; bk.querySelector("b").style.color = bcol(b);
      const bi = bk.querySelector(".bar i"); bi.style.width = clamp((b - 100) / (cfg.bmax + 250 - 100), 0.03, 1) * 100 + "%"; bi.style.background = bcol(b);
      const pd = el.querySelector(".ty-pad"), padv = T.pad ? T.pad[i] : null;
      pd.style.display = cfg.pads && padv != null ? "" : "none";
      if (padv != null) pd.textContent = "pastilha " + padv.toFixed(1).replace(".", ",") + " mm";
      const pe = el.querySelector(".ty-p");
      pe.style.display = cfg.press ? "" : "none";
      const bar = cfg.punit === "bar", pv = bar ? p * 0.0689476 : p;
      pe.textContent = p > 0 ? pv.toFixed(bar ? 2 : 1) + (bar ? " bar" : " psi") : "—"; pe.style.color = pcol(p);
      const we = el.querySelector(".ty-wear");
      we.style.display = cfg.wear && w != null ? "" : "none";
      if (w != null) { const left = 1 - w; we.firstChild.style.width = clamp(left, 0, 1) * 100 + "%"; we.firstChild.style.background = wcol(left * 1.3 - 0.1); we.lastChild.textContent = Math.round(left * 100) + "%"; }
    }
  }
  return { onData: render, onCfg: render };
}

// ------------------------------------------------------------------ início
let current = null;
const KIND = { map: mapOverlay, pedals: pedalsOverlay, standings: standingsOverlay, delta: deltaOverlay, tyres: tyresOverlay, corner: cornerOverlay, radar: radarOverlay, blindl: () => blindOverlay("L"), blindr: () => blindOverlay("R") };
(async function init() {
  await loadFeatures(); featAt = performance.now();
  try { applyCfg((await getJSON("/api/settings")).settings || {}); } catch (e) { /* ok */ }
  current = (KIND[NAME] || mapOverlay)();
  const parts = { map: "flags,cars", pedals: "pedals", standings: "cars", delta: "delta", tyres: "tyres", corner: "pos", radar: "radar", blindl: "radar", blindr: "radar" }[NAME] || "all";
  const every = { map: 100, pedals: 50, standings: 250, delta: 100, tyres: 200, corner: 100, radar: 60, blindl: 60, blindr: 60 }[NAME] || 200;
  dataLoop(parts, every);
  settingsLoop();
  new ResizeObserver(reportSize).observe(root);
})();
