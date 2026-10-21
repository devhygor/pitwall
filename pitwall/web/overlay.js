"use strict";
// Overlays do Pitwall (mapa com bandeiras, pedais, participantes e delta). Uma página por overlay: /overlay/<nome>.
// Os dados vêm de /api/overlay/data; as opções, de /api/settings (overlays.<nome>), relidas a cada 1,5 s.

const NAME = (location.pathname.split("/").pop() || "map").replace(/[^a-z]/g, "");
const TITLES = { map: "Mapa", pedals: "Pedais", standings: "Participantes", delta: "Delta", tyres: "Pneus" };
const PREVIEW = /[?&]preview/.test(location.search);       // dentro do palco da página Overlays: só mostra, com dados de exemplo
const root = document.getElementById("root");
root.dataset.title = TITLES[NAME] || NAME;

const FLAG_INFO = {
  red: ["Bandeira vermelha", "#ff3040"], yellow: ["Bandeira amarela", "#ffd21f"], blue: ["Bandeira azul", "#3d8bff"],
  white: ["Bandeira branca", "#ffffff"], green: ["Bandeira verde", "#2fe58a"], chequered: ["Bandeirada", "#ffffff"],
  black: ["Bandeira preta", "#9aa0aa"], penalty: ["Penalidade", "#ff9f1a"], orange: ["Bandeira laranja", "#ff9f1a"],
};
const DEFAULT_CFG = { mode: "off", scale: 100, bg: 0, cars: true, numbers: true, rotate: 0, width: 9, banner: true, sectors: true,
  seconds: 8, steer: false, gear: true, coast: true, bars: true, speed: true, rows: 10, view: "around", name: "short",
  cols: ["pos", "number", "name", "vs_me", "last", "best"], group: true, classpos: true, header: true, others: 3, carstyle: "both", fuel: true, predicted: true,
  temp: true, press: true, brake: true, wear: true, compound: true, punit: "psi", tmin: 80, tmax: 100, pmin: 26.5, pmax: 28 };

let cfg = { ...DEFAULT_CFG };
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
async function settingsLoop() {
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
  function dotNumber(x, y, n, col) {
    const t = String(n);
    ctx.fillStyle = col; ctx.font = `800 ${t.length > 2 ? 8 : t.length > 1 ? 10 : 11}px Segoe UI`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y + 0.5);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
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
    const lw = clamp(cfg.width, 3, 20);
    // base escura (contraste sobre qualquer fundo)
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const trace = (a, b) => { ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); for (let i = a + 1; i <= b; i++) ctx.lineTo(P[i % n][0], P[i % n][1]); };
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = lw + 5; trace(0, n); ctx.stroke();
    // cor por setor (a bandeira pinta só o trecho onde ela está)
    const sec = (i) => (i / n < sectors[0] ? 0 : i / n < sectors[1] ? 1 : 2);
    let a = 0;
    const pulse = 0.72 + 0.28 * Math.sin(t * 7);
    for (let i = 1; i <= n; i++) {
      if (i < n && sec(i) === sec(a)) continue;
      const fl = sectorFlag(sec(a), flags), col = fl ? FLAG_INFO[fl][1] : "rgba(255,255,255,.88)";
      ctx.globalAlpha = fl === "yellow" || fl === "red" ? pulse : 1;
      ctx.strokeStyle = col; ctx.lineWidth = lw; trace(a, Math.min(i, n)); ctx.stroke();
      if (fl === "chequered") { ctx.strokeStyle = "#111"; ctx.setLineDash([8, 8]); trace(a, Math.min(i, n)); ctx.stroke(); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
      a = i;
    }
    // linha de largada/chegada e divisas dos setores
    const tick = (idx, col, len) => {
      const p = P[idx % n], q = P[(idx + 2) % n], r = P[(idx - 2 + n) % n];
      let dx = q[0] - r[0], dy = q[1] - r[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(p[0] - dy * len, p[1] + dx * len); ctx.lineTo(p[0] + dy * len, p[1] - dx * len); ctx.stroke();
    };
    tick(0, "#ffffff", lw * 0.9 + 3);
    if (cfg.sectors) { tick(Math.round(sectors[0] * n), "rgba(0,0,0,.75)", lw * 0.7); tick(Math.round(sectors[1] * n), "rgba(0,0,0,.75)", lw * 0.7); }
    // curvas: número (e nome) no mapa e a curva em que você está agora
    const cs = corners.length ? corners : previewing ? previewCorners : [];
    const at = (sp) => P[Math.round((((sp % 1) + 1) % 1) * n) % n];
    if (cfg.corners && cs.length) {
      let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
      ctx.font = "700 10px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const c of cs) {
        const [x, y] = at(c.apex);
        let dx = x - cx, dy = y - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const lx = clamp(x + dx * (lw / 2 + 12), 10, W - 10), ly = clamp(y + dy * (lw / 2 + 12), 10, H - 10);
        ctx.fillStyle = "rgba(8,10,14,.62)"; ctx.beginPath(); ctx.arc(lx, ly, 8.5, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillText(String(c.n), lx, ly + 0.5);
      }
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
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
    const me = live() ? data.me : null;
    if (cfg.cars) {
      for (const c of cars) {
        if (me && c.id === me.id) continue;
        const [x, y] = at(c.spline), num = cfg.numbers && c.number != null;
        ctx.fillStyle = c.pit ? "rgba(255,194,51,.95)" : "#7fb2ff"; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, num ? 9.5 : 5.5, 0, 7); ctx.stroke(); ctx.fill();
        if (num) dotNumber(x, y, c.number, "#0b0d10");
      }
    }
    const mySp = me ? me.spline : previewing ? (t / 14) % 1 : null;
    if (mySp != null) {
      const [x, y] = at(mySp);
      ctx.fillStyle = "rgba(255,59,78,.35)"; ctx.beginPath(); ctx.arc(x, y, 13 + 2 * Math.sin(t * 5), 0, 7); ctx.fill();
      const mine = cfg.numbers && me ? cars.find((c) => c.id === me.id) : null, big = mine && mine.number != null;
      ctx.fillStyle = "#ff3b4e"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, big ? 11 : 7, 0, 7); ctx.stroke(); ctx.fill();
      if (big) dotNumber(x, y, mine.number, "#fff");
    }
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
  const previewCorners = [0.04, 0.14, 0.27, 0.38, 0.5, 0.63, 0.75, 0.88].map((a, i) => ({ n: i + 1, apex: a, start: a - 0.06, end: a + 0.06, name: i === 1 ? "Eau Rouge" : "" }));
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

// ------------------------------------------------------------------ PEDAIS
function pedalsOverlay() {
  root.innerHTML = `<div class="card pedals"><canvas id="cv"></canvas><div class="bars" id="bars">
      <div class="vbar b"><i id="vb"></i></div><div class="vbar t"><i id="vt"></i></div></div>
      <div class="info" id="info"><div class="gear num" id="gear">N</div><div class="spd num" id="spd">0<small>KM/H</small></div>
      <div class="legend" id="lg"></div></div></div>`;
  const cv = root.querySelector("#cv"), ctx = cv.getContext("2d");
  const vb = root.querySelector("#vb"), vt = root.querySelector("#vt"), gear = root.querySelector("#gear"), spd = root.querySelector("#spd"), lg = root.querySelector("#lg");
  const W = 360, H = 120;
  let pv = performance.now();
  const gearTxt = (g) => (g === 0 ? "R" : g === 1 ? "N" : String(g - 1));
  function onCfg() {
    root.querySelector("#bars").style.display = cfg.bars ? "" : "none";
    root.querySelector("#info").style.display = cfg.gear || cfg.speed || cfg.coast ? "" : "none";
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
    const T = clamp(cfg.seconds, 3, 30);
    const last = samples.length ? samples[samples.length - 1] : null;
    // grade
    ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, H - f * (H - 10) - 4); ctx.lineTo(W, H - f * (H - 10) - 4); ctx.stroke(); }
    if (!last) { lg.innerHTML = ""; return; }
    const age = previewing ? 0 : Math.min(0.15, (performance.now() - recvAt) / 1000);
    const tNow = last[0] + age;
    const X = (t) => W * (1 - (tNow - t) / T), Y = (v) => H - 4 - v * (H - 10);
    let i0 = samples.length - 1;
    while (i0 > 0 && samples[i0 - 1][0] >= tNow - T - 0.1) i0--;
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

// ------------------------------------------------------------------ PARTICIPANTES
// símbolos das marcas (pasta web/brands, ícones do projeto Simple Icons); sem arquivo, cai para a sigla em texto
const BRAND_FILE = { POR: "porsche", MER: "mercedes", FER: "ferrari", AUD: "audi", LAM: "lamborghini", MCL: "mclaren", NIS: "nissan", BMW: "bmw",
  BEN: "bentley", AMR: "astonmartin", JAG: "jaguar", HON: "honda", CHE: "chevrolet", KTM: "ktm", MAS: "maserati", FOR: "ford", TOY: "toyota",
  CAD: "cadillac", ACU: "acura", HYU: "hyundai", MAZ: "mazda", VW: "volkswagen" };
const COLS = {
  pos: ["Pos", "pos", "c"], number: ["#", "dim r", ""], name: ["Piloto", "", ""], cls: ["Classe", "dim", ""],
  gap_leader: ["Líder", "r num", ""], interval: ["À frente", "r num", ""], vs_me: ["Δ eu", "r num", ""],
  last: ["Última", "r num", ""], best: ["Melhor", "r num", ""], laps: ["Voltas", "dim r num", ""], pit: ["Box", "c", ""], car: ["Carro", "", ""],
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
        brand: c[0], model: c[1], cls_pos: gt4 ? i - 7 : i + 1, laps: 7, best_ms: 98500 + i * 410, last_ms: 98900 + i * 380, pit: i === 9, me: i === 5,
        gap_leader: i ? { ms: i * 1300 } : null, interval: i ? { ms: 900 + i * 40 } : null, vs_me: i === 5 ? null : { ms: (5 - i) * 1100 } }; });
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
      if (cfg.view === "around" && meI >= 0) { const a = clamp(meI - Math.floor(n / 2), 0, Math.max(0, list.length - n)); return list.slice(a, a + n); }
      let show = list.slice(0, n);
      if (meI >= n) { show = show.slice(0, n - 1); show.push(null, list[meI]); }
      return show;
    };
    const cols = cfg.cols.filter((c) => COLS[c] && (c !== "cls" || (rows.some((r) => r.cls) && !multi)) && (c !== "car" || rows.some((r) => r.brand)));
    const bestAll = Math.min(...rows.map((r) => r.best_ms || 1e12));
    const W = { name: "minmax(88px,1fr)", pos: "34px", number: "40px", pit: "40px", cls: "52px", laps: "52px", car: cfg.carstyle === "logo" ? "46px" : cfg.carstyle === "text" ? "92px" : "118px" };
    const tpl = cols.map((c) => W[c] || "74px").join(" ");
    const clsPos = multi && cfg.classpos;
    const rowHtml = (r) => cols.map((c, ci) => {
      let v = "", cls = COLS[c][1], style = "";
      if (c === "pos") v = clsPos ? r.cls_pos : r.pos;
      else if (c === "number") v = r.number != null ? "#" + r.number : "";
      else if (c === "name") v = nameOf(r).replace(/</g, "&lt;");
      else if (c === "car") {
        const f = BRAND_FILE[r.brand], mdl = r.model ? String(r.model).replace(/</g, "&lt;") : "";
        const logo = f ? `<img class="carlogo" src="/static/brands/${f}.svg" alt="${esc(r.brand)}" title="${esc(r.brand + " " + (r.model || ""))}">` : "";
        v = !r.brand ? "" : cfg.carstyle === "logo" ? `<span class="carchip ${f ? "sym" : ""}" title="${esc(r.brand + " " + (r.model || ""))}">${logo || `<b>${r.brand}</b>`}</span>`
          : cfg.carstyle === "text" ? `<span class="carchip"><b>${r.brand}</b>${mdl ? `<i>${mdl}</i>` : ""}</span>`
          : `<span class="carchip ${f ? "withsym" : ""}">${logo}<b>${r.brand}</b>${mdl ? `<i>${mdl}</i>` : ""}</span>`;
      }
      else if (c === "cls") v = r.cls || "";
      else if (c === "gap_leader") v = (clsPos ? r.cls_pos === 1 : r.pos === 1) ? "" : fmtGap(r.gap_leader);
      else if (c === "interval") v = r.interval ? fmtGap(r.interval) : "";
      else if (c === "vs_me") { v = r.me ? "" : fmtGap(r.vs_me); const g = r.vs_me; if (g) cls += (g.laps ? g.laps < 0 : g.ms < 0) ? " ahead" : " behind"; }
      else if (c === "last") v = r.last_ms ? fmtLap(r.last_ms) : "—";
      else if (c === "best") { v = r.best_ms ? fmtLap(r.best_ms) : "—"; if (r.best_ms && r.best_ms === bestAll) cls += " best-all"; }
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
    h += cols.map((c) => `<div class="cell hd ${COLS[c][1].includes("r") ? "r" : COLS[c][1].includes("c") ? "pos" : ""}">${COLS[c][0]}</div>`).join("");
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

// ------------------------------------------------------------------ DELTA
function deltaOverlay() {
  root.innerHTML = `<div class="card delta shadow"><div class="big num" id="big">—</div><div class="dbar"><i id="bar"></i></div>
    <div class="row"><span id="ref">aguardando…</span><span class="num" id="pred"></span></div>
    <div class="row"><span class="num" id="fuel"></span><span class="num" id="fend"></span></div></div>`;
  const $ = (s) => root.querySelector(s);
  function render() {
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

// ------------------------------------------------------------------ PNEUS
function tyresOverlay() {
  const NAMES = ["FL", "FR", "RL", "RR"], LBL = ["Diant. esq.", "Diant. dir.", "Tras. esq.", "Tras. dir."];
  root.innerHTML = `<div class="card tyres shadow"><div class="ty-comp" id="tc"></div><div class="ty-grid" id="tg"></div></div>`;
  const tg = root.querySelector("#tg"), tc = root.querySelector("#tc");
  tg.innerHTML = NAMES.map((n, i) => `<div class="ty" id="ty${i}">
      <div class="ty-main"><div class="ty-brake" title="Temperatura do disco de freio"><i></i></div>
        <div class="ty-tyre"><b class="num ty-t">—</b><small>${LBL[i]}</small></div></div>
      <div class="ty-p num">—</div><div class="ty-wear"><i></i><span class="num"></span></div></div>`).join("");
  const hsl = (h, l = 52) => `hsl(${Math.round(h)} 78% ${l}%)`;
  const tcol = (t) => t <= 0 ? "#3a4352" : t < cfg.tmin ? hsl(205 - clamp((t - (cfg.tmin - 20)) / 20, 0, 1) * 65)
    : t <= cfg.tmax ? hsl(140) : hsl(140 - clamp((t - cfg.tmax) / 25, 0, 1) * 140);
  const pcol = (p) => p <= 0 ? "var(--muted)" : p < cfg.pmin ? hsl(205, 66) : p > cfg.pmax ? hsl(8, 68) : hsl(140, 62);
  const bcol = (b) => hsl(205 - clamp((b - 150) / 750, 0, 1) * 205);
  const wcol = (left) => hsl(clamp(left, 0, 1) * 125);
  const preview = () => { const t = performance.now() / 1000;
    return { temp: [88, 94, 82, 86].map((v, i) => v + 4 * Math.sin(t / 2 + i)), press: [27.2, 27.4, 26.9, 27.1], brake: [520, 540, 380, 360].map((v, i) => v + 120 * Math.sin(t + i)),
      wear: [0.12, 0.14, 0.1, 0.1], compound: "dry_compound" }; };
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
      const bk = el.querySelector(".ty-brake");
      bk.style.display = cfg.brake ? "" : "none";
      bk.firstChild.style.height = clamp((b - 100) / 900, 0.03, 1) * 100 + "%"; bk.firstChild.style.background = bcol(b); bk.title = `Freio ${Math.round(b)}°C`;
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
const KIND = { map: mapOverlay, pedals: pedalsOverlay, standings: standingsOverlay, delta: deltaOverlay, tyres: tyresOverlay };
(async function init() {
  try { applyCfg((await getJSON("/api/settings")).settings || {}); } catch (e) { /* ok */ }
  current = (KIND[NAME] || mapOverlay)();
  const parts = { map: "flags,cars", pedals: "pedals", standings: "cars", delta: "delta", tyres: "tyres" }[NAME] || "all";
  const every = { map: 100, pedals: 50, standings: 250, delta: 100, tyres: 200 }[NAME] || 200;
  dataLoop(parts, every);
  settingsLoop();
  new ResizeObserver(reportSize).observe(root);
})();
