/* Pitwall · Análise completa no site (mesma lógica do app):
   onde você perde tempo em cada curva, problemas da volta, gráficos que liga/desliga,
   barra de voltas para trocar rápido, mapa com os dois carros e os clipes sincronizados.
   Usa só o que está na nuvem: o recorde de cada piloto em cada carro/pista. */
"use strict";

const AN_PTS = 2000;
const CH = ["t", "speed", "gas", "brake", "steer", "gear", "rpm", "x", "z"];
const COL_A = "#2ee59d", COL_B = "#5cc8ff";
const PH_COL = ["#39d98a", "#ffd23f", "#ff5a5f"], PH_NAME = ["Acelerando", "Sem pedal", "Freando"];
const EVT = {
  lock: ["●", "Travou a roda", "a roda travou na freada: alivie um pouco o pedal ou freie em linha reta antes de virar"],
  loss: ["↯", "Perdeu o carro", "o carro escapou (rodada ou saída de traseira): entrada rápida demais ou acelerador cedo demais"],
  invalid: ["⚠", "Volta invalidada", "passou dos limites da pista aqui"],
};
const TRACES_S = [
  { key: "delta", label: "Diferença para a referência", short: "Diferença", h: 120 },
  { key: "phase", label: "Pedais (verde acelera, amarelo solto, vermelho freia)", short: "Pedais", h: 50 },
  { key: "speed", label: "Velocidade", short: "Velocidade", h: 170, unit: "km/h" },
  { key: "brake", label: "Freio", short: "Freio", h: 90, pct: true },
  { key: "gas", label: "Acelerador", short: "Acelerador", h: 90, pct: true },
  { key: "steer", label: "Volante", short: "Volante", h: 100 },
  { key: "gear", label: "Marcha", short: "Marcha", h: 110, gear: true },
  { key: "rpm", label: "Giro do motor", short: "RPM", h: 100, unit: "rpm" },
];
const TR_DEFAULT = ["delta", "phase", "speed", "brake", "gas"];
const gearTxt = (g) => { if (g == null) return "—"; g = Math.round(g); return g === 0 ? "R" : g === 1 ? "N" : String(g - 1); };
const sgn = (v, nd = 3, suf = "") => v == null || isNaN(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(nd).replace(".", ",") + suf;

// ---------------------------------------------------------------- cálculo (porta do analysis.py)
function anMonotonic(d) {
  const keep = []; let hi = -1, start = 0;
  // a volta pode começar com amostras velhas (fim da volta anterior, d ~ 1.0): sem tirar, o resto seria descartado
  for (let i = 1; i < Math.min(d.length, 120); i++) if (d[i] != null && d[i - 1] != null && d[i] < d[i - 1] - 0.5) { start = i; break; }
  for (let i = start; i < d.length; i++) if (d[i] != null && d[i] > hi) { hi = d[i]; keep.push(i); }
  return keep;
}
function anInterp(grid, d, arr) {
  const out = new Array(grid.length).fill(null);
  if (!arr || d.length < 2) return out;
  const lo = d[0], hi = d[d.length - 1];
  let j = 0;
  for (let k = 0; k < grid.length; k++) {
    const g = grid[k];
    if (g < lo - 0.01 || g > hi + 0.01) continue;
    while (j < d.length - 2 && d[j + 1] < g) j++;
    const a = arr[j], b = arr[j + 1];
    if (a == null || b == null) { out[k] = a ?? b; continue; }
    const u = Math.max(0, Math.min(1, (g - d[j]) / (d[j + 1] - d[j] || 1)));
    out[k] = a + (b - a) * u;
  }
  return out;
}
function anResample(tel, grid) {
  if (!tel || !tel.d || tel.d.length < 2) return null;
  const keep = anMonotonic(tel.d);
  const d = keep.map((i) => tel.d[i]);
  const out = {};
  for (const k of CH) out[k] = tel[k] ? anInterp(grid, d, keep.map((i) => tel[k][i])) : grid.map(() => null);
  let len = 0;
  const x = tel.x || [], z = tel.z || [];
  for (let i = 1; i < x.length; i++) if (x[i] != null && x[i - 1] != null) len += Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  out.length = len;
  return out;
}
function anFill(v) {
  const out = v.slice(), ok = [];
  for (let i = 0; i < out.length; i++) if (out[i] != null && !isNaN(out[i])) ok.push(i);
  if (ok.length < 2) return out.map(() => 0);
  let j = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null && !isNaN(out[i])) continue;
    while (j < ok.length - 2 && ok[j + 1] < i) j++;
    const a = ok[j], b = ok[j + 1];
    out[i] = i <= a ? out[a] : i >= b ? out[b] : out[a] + (out[b] - out[a]) * (i - a) / (b - a);
  }
  return out;
}
function anSmooth(v, w) {
  if (w < 2) return v;
  const n = v.length, h = Math.floor(w / 2), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
  const at = (i) => (i < 0 ? v[0] * i : i > n ? pre[n] + v[n - 1] * (i - n) : pre[i]);   // bordas repetidas
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (at(i - h + w) - at(i - h)) / w;
  return out;
}
const maxRange = (a, i, j) => { let m = -Infinity; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) if (a[k] > m) m = a[k]; return m; };
const minRange = (a, i, j) => { let m = Infinity; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) if (a[k] < m) m = a[k]; return m; };
function anSegments(dist, speed) {
  const n = dist.length, step = Math.max(dist[1] - dist[0], 0.1);
  const s = anSmooth(anFill(speed), Math.max(3, Math.round(30 / step)));
  const win = Math.max(3, Math.round(60 / step)), look = Math.max(5, Math.round(400 / step));
  const minima = [];
  for (let i = 1; i < n - 1; i++) {
    if (s[i] > minRange(s, i - win, i + win + 1) + 1e-6) continue;
    const before = maxRange(s, i - look, i + 1) - s[i], after = maxRange(s, i, i + look + 1) - s[i];
    if (before >= 12 && after >= 8) {
      if (minima.length && dist[i] - dist[minima[minima.length - 1]] < 100) {
        if (s[i] < s[minima[minima.length - 1]]) minima[minima.length - 1] = i;
        continue;
      }
      minima.push(i);
    }
  }
  if (!minima.length) { let m = 0; for (let i = 0; i < n; i++) if (s[i] < s[m]) m = i; return [{ n: 1, start: 0, end: n - 1, apex: m }]; }
  const bounds = [0];
  for (let k = 0; k < minima.length - 1; k++) {
    let best = minima[k];
    for (let i = minima[k]; i <= minima[k + 1]; i++) if (s[i] > s[best]) best = i;
    bounds.push(best);
  }
  bounds.push(n - 1);
  return minima.map((m, k) => ({ n: k + 1, start: bounds[k], end: bounds[k + 1], apex: m }));
}
function anMetrics(L, seg, dist) {
  const { start: a, end: b, apex } = seg, t = L.t;
  if (t[a] == null || t[b] == null) return null;
  const sp = anFill(L.speed), gas = anFill(L.gas), brk = anFill(L.brake), tf = anFill(t);
  let apexI = a; for (let i = a; i <= b; i++) if (sp[i] < sp[apexI]) apexI = i;
  let brakeI = null; for (let i = a; i <= apexI; i++) if (brk[i] >= 0.1) { brakeI = i; break; }
  let thrI = null; for (let i = apexI; i <= b; i++) if (gas[i] >= 0.9) { thrI = i; break; }
  let coast = 0, maxB = 0;
  for (let i = a; i < b; i++) { if (gas[i] < 0.1 && brk[i] < 0.1) coast += (tf[i + 1] - tf[i]) / 1000; if (brk[i] > maxB) maxB = brk[i]; }
  return {
    time: (t[b] - t[a]) / 1000, to_apex: t[apex] != null ? (t[apex] - t[a]) / 1000 : null,
    entry_speed: sp[a], min_speed: sp[apexI], exit_speed: sp[b], apex_m: dist[apexI],
    brake_m: brakeI != null ? dist[brakeI] : null, throttle_m: thrI != null ? dist[thrI] : null, max_brake: maxB, coast,
  };
}
function anTips(m, r, entryLoss, exitLoss) {
  const tips = [], f0 = (v) => Math.round(v);
  if (m.brake_m != null && r.brake_m != null) {
    const d = m.brake_m - r.brake_m;
    if (d > 5 && m.min_speed < r.min_speed - 2) tips.push({ title: "Freou tarde demais", detail: `Você freou ${f0(d)} m depois da referência e chegou mais lento no ápice (${f0(m.min_speed)} × ${f0(r.min_speed)} km/h).` });
    else if (d < -5) tips.push({ title: "Freou cedo", detail: `Você começou a frear ${f0(-d)} m antes da referência.` });
  } else if (m.brake_m != null && r.brake_m == null) tips.push({ title: "Frenagem desnecessária", detail: "A referência não freia neste trecho; tente só aliviar o acelerador." });
  const dv = m.min_speed - r.min_speed;
  if (dv < -3) tips.push({ title: "Pouca velocidade na curva", detail: `Velocidade mínima ${f0(-dv)} km/h abaixo da referência (${f0(m.min_speed)} × ${f0(r.min_speed)} km/h).` });
  else if (dv > 4 && exitLoss > 0.05) tips.push({ title: "Entrou rápido demais", detail: `Você passou ${f0(dv)} km/h mais rápido no ápice, mas perdeu ${exitLoss.toFixed(2)} s na saída. Talvez valha sacrificar a entrada.` });
  if (m.throttle_m != null && r.throttle_m != null && m.throttle_m - r.throttle_m > 10) tips.push({ title: "Acelerou tarde", detail: `Acelerador a fundo ${f0(m.throttle_m - r.throttle_m)} m depois da referência na saída.` });
  const de = m.exit_speed - r.exit_speed;
  if (de < -3) tips.push({ title: "Saída mais lenta", detail: `${f0(-de)} km/h a menos no fim do trecho — isso se arrasta pela reta seguinte.` });
  const dc = m.coast - r.coast;
  if (dc > 0.15) tips.push({ title: "Tempo sem acelerar nem frear", detail: `${dc.toFixed(2)} s a mais "rolando" (sem pedal) que a referência.` });
  return tips;
}
function anCompare(telA, telB) {
  const grid = Array.from({ length: AN_PTS }, (_, i) => i / (AN_PTS - 1));
  const a = anResample(telA, grid), b = telB ? anResample(telB, grid) : null;
  if (!a) return null;
  const len = a.length || (b && b.length) || 1;
  const dist = grid.map((g) => g * len);
  const res = { distance: dist, length: len, a, b, n: AN_PTS };
  if (b) res.delta = a.t.map((t, i) => t != null && b.t[i] != null ? (t - b.t[i]) / 1000 : null);
  const segs = anSegments(dist, (b || a).speed);
  res.segments = segs.map((s) => {
    const ma = anMetrics(a, s, dist), mb = b ? anMetrics(b, s, dist) : null;
    const it = { ...s, a: ma, b: mb };
    if (ma && mb) {
      const delta = ma.time - mb.time;
      const entry = ma.to_apex != null && mb.to_apex != null ? ma.to_apex - mb.to_apex : 0, exit = delta - entry;
      Object.assign(it, { delta, entry_loss: entry, exit_loss: exit, tips: anTips(ma, mb, entry, exit) });
      it.summary = delta > 0.03 ? `Maior perda ${entry >= exit ? "na entrada (frenagem até o ápice)" : "na saída (do ápice em diante)"}: +${Math.max(entry, exit).toFixed(3).replace(".", ",")} s`
        : delta < -0.03 ? `Você ganhou ${(-delta).toFixed(3).replace(".", ",")} s neste trecho` : "Praticamente igual à referência";
    }
    return it;
  });
  const ph = (L) => L.gas.map((g, i) => { const br = L.brake[i]; return g == null && br == null ? null : (br ?? 0) >= 0.1 ? 2 : (g ?? 0) >= 0.1 ? 0 : 1; });
  res.phA = ph(a); if (b) res.phB = ph(b);
  return res;
}

// ---------------------------------------------------------------- tela
let AS = null;   // estado da análise no site
const anState = { evf: "all", target: "a", cars: store.get("pitwall.site.anCars") || "all" };
// acontecimentos das duas voltas (a analisada e a referência): clicar leva gráficos, mapa e vídeo ao ponto
function anTimeline(LA, LB, evsA, evsB, segs, nameOf) {
  const box = $("#anTl");
  if (!box) return;
  const all = [...evsA.map((e) => ({ ...e, who: "a" })), ...evsB.map((e) => ({ ...e, who: "b" }))];
  const cnt = (t) => all.filter((e) => e.type === t).length;
  const FIL = [["all", "Todos", all.length], ["loss", "Rodadas", cnt("loss")], ["lock", "Travadas", cnt("lock")], ["invalid", "Inválidas", cnt("invalid")]]
    .filter((f) => f[0] === "all" || f[2]);
  if (!FIL.some((f) => f[0] === anState.evf)) anState.evf = "all";
  const col = (L, who, list) => {
    const rows = list.filter((e) => anState.evf === "all" || e.type === anState.evf).sort((x, y) => (x.d || 0) - (y.d || 0));
    return `<div class="tl-col"><div class="tl-who"><i class="dot ${who}"></i><b>${esc(nameOf(L))}</b><small class="num">${fmtLap(L.lap_time_ms)}</small></div>
      <div class="tl-evs">${rows.length ? rows.map((e) => { const t = EVT[e.type] || ["•", e.type, ""];
        return `<button class="tlev ev-${e.type}" data-i="${e.i}" data-seg="${e.seg}" title="${esc(t[2] + (e.drop ? ` (perdeu ${e.drop} km/h)` : ""))}">${t[0]} ${esc(t[1])}
          ${e.seg >= 0 ? `<small>curva ${segs[e.seg].n}</small>` : ""}${e.t ? `<small class="num">${fmtLap(e.t)}</small>` : ""}</button>`; }).join("")
        : `<span class="fnone ok">${all.length && anState.evf !== "all" ? "Nenhum deste tipo." : "Nenhum acontecimento marcado."}</span>`}</div></div>`;
  };
  const draw = () => {
    box.innerHTML = `<div class="tl-head"><b>Acontecimentos</b><span class="sub">clique para ir direto ao momento (gráficos, mapa e vídeo)</span><span class="spacer"></span>
        <div class="tl-fil">${FIL.map(([k, t, c]) => `<button class="${k === anState.evf ? "on" : ""}" data-f="${k}">${t}<small>${c}</small></button>`).join("")}</div></div>
      <div class="tl-cols">${col(LA, "a", evsA)}${LB ? col(LB, "b", evsB) : ""}</div>
      ${LB ? "" : `<div class="sub" style="margin-top:8px">Escolha uma referência na barra de voltas para ver também os acontecimentos dela.</div>`}`;
    box.querySelectorAll("[data-f]").forEach((el) => el.onclick = () => { anState.evf = el.dataset.f; draw(); });
    box.querySelectorAll(".tlev").forEach((el) => el.onclick = () => { const k = +el.dataset.seg; if (k >= 0) anSelect(k, true); anGoto(+el.dataset.i); window.scrollTo({ top: 0, behavior: "smooth" }); });
  };
  draw();
}

function stopAnalysis() {
  if (!AS) return;
  cancelAnimationFrame(AS.raf);
  AS.plots.forEach((p) => p.destroy());
  window.removeEventListener("resize", AS.onResize);
  document.removeEventListener("keydown", AS.onKey);
  AS = null;
}

async function renderAnalysis(idA, idB) {
  stopAnalysis();
  view.innerHTML = `<div class="loading">Carregando as voltas…</div>`;
  const ids = [idA, idB].filter(Boolean);
  const { data, error } = await sb.from("laps").select("*,profiles(name,avatar_url)").in("id", ids);
  if (error || !data || !data.length || !data.find((r) => r.id === idA)) {
    view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Volta não encontrada</b><p>Ela pode ter sido substituída por um recorde novo.</p></div></div>`; return;
  }
  const LA = data.find((r) => r.id === idA), LB = idB ? data.find((r) => r.id === idB) || null : null;
  const [telA, telB] = await Promise.all([decodeTel(LA.telemetry), LB ? decodeTel(LB.telemetry) : null]);
  const R = anCompare(telA, telB);
  if (!R) { view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Volta sem telemetria</b></div></div>`; return; }
  // outras voltas do mesmo carro/pista (o recorde de cada piloto)
  // outras voltas da mesma pista (qualquer carro, ou só o mesmo carro); o nome da pista pode vir com outra caixa
  const trackLike = LA.track.replace(/[\\%_]/g, (c) => "\\" + c);
  const { data: others } = await sb.from("laps").select("id,user_id,car,lap_time_ms,recorded_at,clip_path,setup_name,profiles(name,avatar_url)")
    .eq("game", LA.game).ilike("track", trackLike).order("lap_time_ms").limit(300);
  const allOpts = (others || []).map((r) => ({ ...r, driver: (r.profiles || {}).name || "?" }));
  const manyCars = new Set(allOpts.map((r) => r.car)).size > 1;
  const sameOnly = anState.cars === "same" && manyCars;
  const opts = sameOnly ? allOpts.filter((r) => r.car === LA.car) : allOpts;
  const otherCar = LB && LB.car !== LA.car;
  const me = session.user.id;
  const nameOf = (L) => (L.profiles || {}).name || "?";
  const hasB = !!LB, n = R.n, segs = R.segments;
  const evs = (Array.isArray(LA.events) ? LA.events : []).map((e) => {
    const i = Math.max(0, Math.min(n - 1, Math.round((e.d || 0) * (n - 1))));
    return { ...e, i, seg: segs.findIndex((s) => i >= s.start && i <= s.end) };
  });
  const evsB = LB ? (Array.isArray(LB.events) ? LB.events : []).map((e) => {
    const i = Math.max(0, Math.min(n - 1, Math.round((e.d || 0) * (n - 1))));
    return { ...e, i, seg: segs.findIndex((s) => i >= s.start && i <= s.end) };
  }) : [];
  const clip = (L) => L && L.clip_path ? sb.storage.from("clips").getPublicUrl(L.clip_path).data.publicUrl : null;
  const cA = clip(LA), cB = clip(LB);
  const diff = hasB ? LA.lap_time_ms - LB.lap_time_ms : null;
  const secs = ["s1_ms", "s2_ms", "s3_ms"].map((k, i) => {
    const d = hasB && LA[k] && LB[k] ? (LA[k] - LB[k]) / 1000 : null;
    return `<span>S${i + 1} <b class="${d > 0 ? "neg" : d < 0 ? "pos" : ""}">${hasB ? sgn(d) : fmtSec(LA[k])}</b></span>`;
  }).join("");
  const worst = hasB ? segs.map((s, k) => ({ s, k })).filter((x) => x.s.delta > 0.02).sort((x, y) => y.s.delta - x.s.delta).slice(0, 6) : [];
  let shown; try { shown = new Set(JSON.parse(store.get("pitwall.site.traces") || "null") || TR_DEFAULT); } catch (e) { shown = new Set(TR_DEFAULT); }
  const layout = store.get("pitwall.site.anLayout") || "std";
  const card = (L, tag, who) => `<div class="an-lap ${tag}"><i></i>
      ${L ? avatar({ name: nameOf(L), avatar_url: (L.profiles || {}).avatar_url }) : ""}
      <div><small>${who}</small><b>${L ? fmtLap(L.lap_time_ms) : "—"}</b>
        <em>${L ? `${esc(nameOf(L))}${L.user_id === me ? " (você)" : ""} · ${fmtDate(L.recorded_at)}` : "escolha na barra abaixo"}</em></div>
      ${L && L.setup_name ? `<button class="btn small" data-setup="${L.id}" title="${esc(L.setup_name)}">⚙ Setup</button>` : ""}</div>`;
  const vid = (src, tag, label) => `<div class="an-vid ${tag}">${src ? `<video id="v${tag}" src="${esc(src)}" muted playsinline preload="auto"></video>
      <span class="vtag">${esc(label)}</span><button class="vfs" data-fs="${tag}" title="Tela cheia">⛶</button>`
    : `<div class="novid"><span class="vtag">${esc(label)}</span><span>Sem vídeo desta volta</span></div>`}</div>`;
  const ordered = opts.slice();
  view.innerHTML = `<div class="anw page" id="anw">
    <header class="an-top">
      <div class="an-title"><a class="back" href="javascript:history.back()">Voltar</a><h1>${esc(pretty(LA.track))}</h1><span class="sub">${esc(pretty(LA.car))}</span></div>
      ${card(LA, "a", "Volta analisada")}<span class="an-vs">vs</span>${card(LB, "b", "Referência")}
      <div class="an-total"><small>Diferença</small><b class="${diff > 0 ? "neg" : diff < 0 ? "pos" : ""}">${hasB ? sgn(diff / 1000, 3, " s") : fmtLap(LA.lap_time_ms)}</b><div class="secs">${secs}</div></div>
    </header>

    <section class="an-strip">
      <div class="st-top"><b>${sameOnly ? "Voltas neste carro e pista" : "Voltas nesta pista"}</b><span class="sub">o recorde de cada piloto${otherCar ? " · comparando carros diferentes" : ""}</span>
        ${manyCars ? `<div class="seg"><button class="${sameOnly ? "" : "on"}" data-cars="all">Todos os carros</button><button class="${sameOnly ? "on" : ""}" data-cars="same">Só este carro</button></div>` : ""}
        <span class="spacer"></span><span class="sub">Clique troca:</span>
        <div class="seg"><button class="${anState.target === "a" ? "on" : ""}" data-tgt="a"><i class="dot a"></i>Volta analisada</button>
          <button class="${anState.target === "b" ? "on" : ""}" data-tgt="b"><i class="dot b"></i>Referência</button></div>
        ${hasB ? `<button class="btn small quiet" id="anSwap" title="Inverter">⇄ Inverter</button><button class="btn small quiet" id="anNoRef">Sem referência</button>` : ""}</div>
      <div class="st-row"><button class="btn small st-nav" id="stPrev" title="Anterior ( [ )">◀</button>
        <div class="st-laps">${ordered.map((r, i) => `<button class="stc ${r.id === LA.id ? "isa" : ""} ${LB && r.id === LB.id ? "isb" : ""} ${r.user_id === me ? "mine" : ""}" data-lap="${r.id}">
          <small>${i + 1}º · ${esc(r.driver)}${r.user_id === me ? " (você)" : ""}</small><b>${fmtLap(r.lap_time_ms)}</b>
          <em>${i ? fmtGap(r.lap_time_ms - ordered[0].lap_time_ms) : "mais rápido"}${r.clip_path ? " · ▶" : ""}</em>
          ${manyCars && !sameOnly ? `<em class="stcar">${esc(pretty(r.car))}</em>` : ""}</button>`).join("")}</div>
        <button class="btn small st-nav" id="stNext" title="Próxima ( ] )">▶</button></div>
    </section>

    <section class="an-find">
      ${hasB ? `<div class="fg"><span class="fl">Onde perde tempo</span>${worst.length ? worst.map(({ s, k }) => `<button class="fchip loss" data-seg="${k}">Curva ${s.n}<b>+${s.delta.toFixed(2).replace(".", ",")} s</b></button>`).join("") : `<span class="fnone ok">Nenhum trecho com perda relevante. Boa volta!</span>`}</div>`
        : `<div class="fg"><span class="fnone">Escolha uma referência na barra acima para ver onde perde tempo.</span></div>`}
      <div class="fg"><span class="fl">Problemas na volta</span>${evs.length ? evs.map((e, j) => `<button class="fchip ev-${e.type}" data-ev="${j}" title="${esc((EVT[e.type] || ["", "", ""])[2])}">${(EVT[e.type] || ["•"])[0]} ${esc((EVT[e.type] || ["", e.type])[1])}${e.seg >= 0 ? ` <small>curva ${segs[e.seg].n}</small>` : ""}</button>`).join("")
        : `<span class="fnone ok">Nenhuma travada, rodada ou saída de pista registrada.</span>`}</div>
    </section>

    <section class="panel an-tl" id="anTl"></section>

    <div class="an-grid mode-${layout}">
      <aside class="an-side">
        <div class="panel an-seg" id="segInfo"></div>
        <div class="panel pad0 an-mapbox">
          <div class="mapbar"><span class="sub" id="mapInfo">Traçado</span><span class="spacer"></span>
            <div class="seg"><button class="on" data-map="full">Inteira</button><button data-map="follow">Seguir carro</button></div></div>
          <canvas id="anMap"></canvas>
          <div class="segnav"><button class="btn small" id="segPrev" title="Curva anterior (←)">◀</button><b id="segTitle"></b><button class="btn small" id="segNext" title="Próxima curva (→)">▶</button></div>
        </div>
      </aside>
      <section class="an-main">
        <div class="panel pad0 an-media">
          ${cA || cB ? `<div class="an-vids" id="anVids">${vid(cA, "a", nameOf(LA))}${hasB ? vid(cB, "b", nameOf(LB)) : ""}</div><div class="vresize" id="vresize" title="Arraste para aumentar ou diminuir os vídeos"></div>` : ""}
          <div class="an-ctl">
            <button class="btn go small" id="anPlay" title="Espaço">▶</button>
            <div class="seg">${[0.25, 0.5, 1].map((x) => `<button class="${x === 1 ? "on" : ""}" data-rate="${x}">${String(x).replace(".", ",")}×</button>`).join("")}</div>
            <div class="prog" id="anProg"><div class="band"></div><div class="fill"></div><div class="knob"></div></div>
            <span class="sub tnum" id="anClock">0:00.000</span>
            ${cA || cB ? `<div class="seg" title="Tamanho dos vídeos"><button class="${layout === "std" ? "on" : ""}" data-lay="std">Padrão</button><button class="${layout === "big" ? "on" : ""}" data-lay="big">Grande</button></div>` : ""}
          </div>
          ${cA || cB ? "" : `<p class="help" style="padding:0 16px 12px">Sem clipe de vídeo nestas voltas. No app do PC, ligue “Enviar um clipe de vídeo da volta” na tela Equipe.</p>`}
        </div>
        <div class="panel an-charts">
          <div class="tbar"><div class="ttog">${TRACES_S.filter((t) => t.key !== "delta" || hasB).map((t) => `<button class="tchip ${shown.has(t.key) ? "on" : ""}" data-tr="${t.key}">${t.short}</button>`).join("")}</div>
            <span class="spacer"></span><button class="btn small quiet on" id="focusBtn">Só a curva</button></div>
          <div id="traceBox"></div>
          <p class="help">Passe o mouse nos gráficos ou no mapa · arraste no gráfico para dar zoom · ← → troca de curva · [ ] troca de volta · espaço toca.</p>
        </div>
      </section>
    </div>
  </div>`;
  bindRows(view);

  AS = { R, LA, LB, hasB, n, segs, evs, seg: 0, idx: 0, focus: true, follow: false, show: shown, plots: [],
    T: 0, playing: false, rate: 1, last: 0, raf: 0, va: $("#va"), vb: $("#vb") };

  // ---- barra de voltas
  const go = (a, b) => { location.hash = `#/compare/${a}${b ? "/" + b : ""}`; };
  const pick = (id) => {
    if (anState.target === "b") { if (id !== LA.id) go(LA.id, id); }
    else if (LB && id === LB.id) go(id, LA.id);
    else go(id, LB ? LB.id : null);
  };
  view.querySelectorAll("[data-lap]").forEach((c) => c.onclick = () => pick(c.dataset.lap));
  view.querySelectorAll("[data-cars]").forEach((c) => c.onclick = () => {
    anState.cars = c.dataset.cars; store.set("pitwall.site.anCars", anState.cars);
    renderAnalysis(LA.id, LB ? LB.id : null);
  });
  view.querySelectorAll("[data-tgt]").forEach((c) => c.onclick = () => {
    anState.target = c.dataset.tgt;
    view.querySelectorAll("[data-tgt]").forEach((x) => x.classList.toggle("on", x === c));
  });
  if ($("#anSwap")) $("#anSwap").onclick = () => go(LB.id, LA.id);
  if ($("#anNoRef")) $("#anNoRef").onclick = () => go(LA.id, null);
  const lapIds = ordered.map((r) => r.id);
  const stepLap = (dir) => {
    const cur = anState.target === "b" ? (LB && LB.id) : LA.id;
    let i = lapIds.indexOf(cur); i = i < 0 ? (dir > 0 ? 0 : lapIds.length - 1) : i + dir;
    if (i >= 0 && i < lapIds.length) pick(lapIds[i]);
  };
  $("#stPrev").onclick = () => stepLap(-1); $("#stNext").onclick = () => stepLap(1);
  const act = view.querySelector(".stc.isa"); if (act) act.scrollIntoView({ block: "nearest", inline: "center" });

  // ---- achados
  view.querySelectorAll(".fchip[data-seg]").forEach((c) => c.onclick = () => anSelect(+c.dataset.seg));
  view.querySelectorAll(".fchip[data-ev]").forEach((c) => c.onclick = () => { const e = evs[+c.dataset.ev]; if (e.seg >= 0) anSelect(e.seg, true); anGoto(e.i); });
  anTimeline(LA, LB, evs, evsB, segs, nameOf);
  $("#segPrev").onclick = () => anSelect(AS.seg - 1);
  $("#segNext").onclick = () => anSelect(AS.seg + 1);
  $("#focusBtn").onclick = () => {
    AS.focus = !AS.focus;
    $("#focusBtn").classList.toggle("on", AS.focus); $("#focusBtn").textContent = AS.focus ? "Só a curva" : "Volta inteira";
    anZoom();
  };
  view.querySelectorAll("[data-tr]").forEach((c) => c.onclick = () => {
    const k = c.dataset.tr;
    if (AS.show.has(k)) { if (AS.show.size > 1) AS.show.delete(k); } else AS.show.add(k);
    c.classList.toggle("on", AS.show.has(k));
    store.set("pitwall.site.traces", JSON.stringify([...AS.show]));
    anCharts();
  });
  view.querySelectorAll("[data-map]").forEach((c) => c.onclick = () => {
    AS.follow = c.dataset.map === "follow";
    view.querySelectorAll("[data-map]").forEach((x) => x.classList.toggle("on", x === c));
    anMapDraw();
  });
  view.querySelectorAll("[data-lay]").forEach((c) => c.onclick = () => {
    const g = $(".an-grid"); g.className = g.className.replace(/mode-\w+/, "mode-" + c.dataset.lay);
    view.querySelectorAll("[data-lay]").forEach((x) => x.classList.toggle("on", x === c));
    store.set("pitwall.site.anLayout", c.dataset.lay);
    anMediaHeight(); requestAnimationFrame(() => { anCharts(); anMapFit(); });
  });
  view.querySelectorAll("[data-fs]").forEach((c) => c.onclick = () => { const v = $("#v" + c.dataset.fs); if (v && v.requestFullscreen) v.requestFullscreen(); });
  anBindResize(); anMediaHeight();

  // ---- player
  $("#anPlay").onclick = () => anPlay(!AS.playing);
  view.querySelectorAll("[data-rate]").forEach((c) => c.onclick = () => { AS.rate = +c.dataset.rate; view.querySelectorAll("[data-rate]").forEach((x) => x.classList.toggle("on", x === c)); });
  const prog = $("#anProg");
  const scrub = (e) => { const r = prog.getBoundingClientRect(); anPlay(false); anGoto(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1))); };
  let drag = false;
  prog.addEventListener("pointerdown", (e) => { drag = true; prog.setPointerCapture(e.pointerId); scrub(e); });
  prog.addEventListener("pointermove", (e) => { if (drag) scrub(e); });
  prog.addEventListener("pointerup", () => { drag = false; });

  AS.onKey = (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === " ") { e.preventDefault(); anPlay(!AS.playing); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); anSelect(AS.seg - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); anSelect(AS.seg + 1); }
    else if (e.key === "[") stepLap(-1);
    else if (e.key === "]") stepLap(1);
  };
  document.addEventListener("keydown", AS.onKey);
  AS.onResize = () => { anCharts(); anMapFit(); };
  window.addEventListener("resize", AS.onResize);

  anMapInit();
  anCharts();
  const k0 = worst.length ? worst[0].k : 0;
  anSelect(k0);
  const loop = (ts) => {
    if (!AS) return;
    if (AS.playing) {
      AS.T += (AS.last ? ts - AS.last : 0) * AS.rate;
      const end = LA.lap_time_ms;
      if (AS.T >= end) { AS.T = end; anPlay(false); }
      anGoto(anIdxAtTime(AS.T), { fromPlay: true });
    }
    AS.last = ts;
    AS.raf = requestAnimationFrame(loop);
  };
  AS.raf = requestAnimationFrame(loop);
}

function anIdxAtTime(ms) {
  const t = AS.R.a.t; let lo = 0, hi = AS.n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((t[m] ?? -1) < ms) lo = m + 1; else hi = m; }
  return lo;
}
function anPlay(on) {
  if (!AS) return;
  if (on && AS.T >= AS.LA.lap_time_ms - 5) AS.T = 0;
  AS.playing = on; AS.last = 0;
  $("#anPlay").textContent = on ? "❚❚" : "▶";
  for (const v of [AS.va, AS.vb]) if (v) { if (on) { v.playbackRate = AS.rate; v.play().catch(() => {}); } else v.pause(); }
}
function anSyncVideos(i) {
  const { R, va, vb } = AS;
  const set = (v, ms) => {
    if (!v || ms == null || v.readyState < 1) return;
    const target = 1 + ms / 1000;                 // o clipe começa 1 s antes da linha
    if (AS.playing) { v.playbackRate = AS.rate; if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target; }
    else if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
  };
  set(va, R.a.t[i]);
  if (R.b) set(vb, R.b.t[i]);      // referência no MESMO ponto da pista
}
function anSegFor(i) { const s = AS.segs; for (let k = 0; k < s.length; k++) if (i >= s[k].start && i <= s[k].end) return k; return 0; }

function anGoto(i, { fromPlot = false, fromPlay = false } = {}) {
  if (!AS) return;
  i = Math.max(0, Math.min(AS.n - 1, i));
  AS.idx = i;
  if (!fromPlay && AS.R.a.t[i] != null) AS.T = AS.R.a.t[i];
  const k = anSegFor(i);
  if (k !== AS.seg) { AS.seg = k; anSegInfo(); if (AS.focus) anZoom(); }
  anValues(i);
  anMapDraw();
  anSyncVideos(i);
  const f = i / (AS.n - 1);
  $("#anProg .fill").style.width = (f * 100) + "%"; $("#anProg .knob").style.left = (f * 100) + "%";
  const t = AS.R.a.t[i]; $("#anClock").textContent = t == null ? "" : fmtLap(Math.round(t)) + (AS.R.delta && AS.R.delta[i] != null ? `  ${sgn(AS.R.delta[i], 3, " s")}` : "");
  if (!fromPlot) for (const u of AS.plots) { const x = u.valToPos(AS.R.distance[i], "x"); if (x >= 0 && x <= u.bbox.width / devicePixelRatio) u.setCursor({ left: x, top: 8 }, false); }
}
function anSelect(k, keepCursor) {
  const segs = AS.segs; if (!segs.length) return;
  k = (k + segs.length) % segs.length; AS.seg = k;
  anSegInfo();
  view.querySelectorAll(".fchip[data-seg]").forEach((c) => c.classList.toggle("on", +c.dataset.seg === k));
  const s = segs[k];
  const band = $("#anProg .band"); band.style.left = (s.start / (AS.n - 1) * 100) + "%"; band.style.width = ((s.end - s.start) / (AS.n - 1) * 100) + "%";
  anZoom();
  if (!keepCursor) anGoto(s.apex);
  else anMapDraw();
}
function anZoom() {
  const d = AS.R.distance, s = AS.segs[AS.seg];
  AS.zooming = true;
  for (const u of AS.plots) {
    if (AS.focus && s) u.setScale("x", { min: Math.max(0, d[s.start] - 40), max: Math.min(d[AS.n - 1], d[s.end] + 40) });
    else u.setScale("x", { min: d[0], max: d[AS.n - 1] });
  }
  AS.zooming = false;
}
function anSegInfo() {
  const s = AS.segs[AS.seg], el = $("#segInfo"); if (!s) return;
  const A = s.a || {}, B = s.b || {}, hasB = AS.hasB;
  const here = AS.evs.filter((e) => e.seg === AS.seg);
  const m = (v) => v == null ? "—" : `${Math.round(v)} m`, kmh = (v) => v == null ? "—" : `${Math.round(v)}`;
  const better = (x, y, lower) => (x == null || y == null || !hasB || Math.abs(x - y) < 1) ? null : lower ? x < y : x > y;
  const stat = (label, va, vb, good) => `<div class="st2"><small>${label}</small><b class="va">${va}</b>${hasB ? `<b class="vb">${vb}</b>` : ""}${good != null ? `<i class="${good ? "pos" : "neg"}">${good ? "melhor" : "pior"}</i>` : ""}</div>`;
  el.innerHTML = `<div class="seghead"><h2>Curva ${s.n}</h2>${hasB ? `<b class="${s.delta > 0 ? "neg" : "pos"}">${sgn(s.delta, 3, " s")}</b>` : ""}</div>
    <p class="segsum ${hasB && s.delta > 0.03 ? "bad" : "ok"}">${hasB ? esc(s.summary || "") : "Escolha uma referência para ver o que mudar aqui."}</p>
    ${here.map((e) => `<div class="segev">${(EVT[e.type] || ["•"])[0]} <b>${esc((EVT[e.type] || ["", e.type])[1])}</b>: ${esc((EVT[e.type] || ["", "", ""])[2])}</div>`).join("")}
    ${hasB && (s.tips || []).length ? `<ul class="tips">${s.tips.slice(0, 3).map((t) => `<li><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></li>`).join("")}</ul>` : ""}
    <div class="stats2">${stat("Começa a frear", m(A.brake_m), m(B.brake_m), null)}${stat("Vel. mínima", kmh(A.min_speed), kmh(B.min_speed), better(A.min_speed, B.min_speed, false))}
      ${stat("Acelera a fundo", m(A.throttle_m), m(B.throttle_m), better(A.throttle_m, B.throttle_m, true))}${stat("Vel. na saída", kmh(A.exit_speed), kmh(B.exit_speed), better(A.exit_speed, B.exit_speed, false))}</div>
    ${hasB ? `<div class="legend"><span class="va">● ${esc((AS.LA.profiles || {}).name || "A")}</span><span class="vb">● ${esc((AS.LB.profiles || {}).name || "B")}</span></div>` : ""}`;
  $("#segTitle").textContent = `Curva ${s.n} de ${AS.segs.length}`;
}

// ---- mapa (canvas): pista, as duas linhas, números das curvas e os carros
function anMapInit() {
  const cv = $("#anMap");
  AS.map = { cv, ctx: cv.getContext("2d") };
  const { a } = AS.R;
  const xs = a.x.filter((v) => v != null), zs = a.z.filter((v) => v != null);
  AS.map.bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  const near = (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best = 0, bd = Infinity;
    for (let i = 0; i < AS.n; i += 2) { if (a.x[i] == null) continue; const [x, y] = AS.map.P(a.x[i], a.z[i]); const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; best = i; } }
    return bd < 900 ? best : null;
  };
  cv.onpointermove = (e) => { if (AS.playing) return; const i = near(e); if (i != null) anGoto(i); };
  cv.onclick = (e) => { const i = near(e); if (i != null) { const k = anSegFor(i); anSelect(k, true); anGoto(i); } };
  anMapFit();
}
function anMapFit() {
  if (!AS || !AS.map) return;
  const { cv, ctx } = AS.map, r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  anMapDraw();
}
function anMapDraw() {
  if (!AS || !AS.map) return;
  const { cv, ctx, bb } = AS.map, W = cv.clientWidth, H = cv.clientHeight, { a, b } = AS.R, n = AS.n, i0 = AS.idx;
  if (!W) return;
  let sc = Math.min(W / (bb[2] - bb[0] || 1), H / (bb[3] - bb[1] || 1)) * 0.86;
  let cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
  if (AS.follow && a.x[i0] != null) { sc = Math.max(sc * 4, 1.6); cx = a.x[i0]; cz = a.z[i0]; }
  const P = (x, z) => [W / 2 + sc * (x - cx), H / 2 + sc * (z - cz)];
  AS.map.P = P;
  ctx.fillStyle = "#0b0f18"; ctx.fillRect(0, 0, W, H);
  const path = (L, from = 0, to = n - 1) => { ctx.beginPath(); let pen = false; for (let i = from; i <= to; i++) { if (L.x[i] == null) { pen = false; continue; } const [x, y] = P(L.x[i], L.z[i]); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } };
  ctx.lineJoin = ctx.lineCap = "round";
  path(a); ctx.strokeStyle = "#1d2738"; ctx.lineWidth = AS.follow ? 26 : 14; ctx.stroke();
  // trecho da curva selecionada
  const s = AS.segs[AS.seg];
  if (s) { path(a, s.start, s.end); ctx.strokeStyle = "rgba(46,229,157,.22)"; ctx.lineWidth = AS.follow ? 30 : 18; ctx.stroke(); }
  // linha A colorida pela fase do pedal (zoom) ou laranja (inteira)
  if (b) { path(b); ctx.strokeStyle = COL_B; ctx.lineWidth = 1.6; ctx.stroke(); }
  if (AS.follow) {
    for (let i = 1; i < n; i++) {
      if (a.x[i] == null || a.x[i - 1] == null) continue;
      const [x0, y0] = P(a.x[i - 1], a.z[i - 1]), [x1, y1] = P(a.x[i], a.z[i]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = PH_COL[AS.R.phA[i] ?? 1]; ctx.lineWidth = 2.6; ctx.stroke();
    }
  } else { path(a); ctx.strokeStyle = COL_A; ctx.lineWidth = 1.8; ctx.stroke(); }
  // números das curvas (cor = ganho/perda)
  ctx.font = "600 11px Barlow, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  AS.segs.forEach((sg, k) => {
    const L = b || a; if (L.x[sg.apex] == null) return;
    const [x, y] = P(L.x[sg.apex], L.z[sg.apex]);
    const col = !AS.hasB || sg.delta == null ? "#3a4560" : sg.delta > 0.03 ? "#ff5a5f" : sg.delta < -0.03 ? "#39d98a" : "#5b6780";
    ctx.beginPath(); ctx.arc(x, y, k === AS.seg ? 11 : 9, 0, 7); ctx.fillStyle = col; ctx.fill();
    if (k === AS.seg) { ctx.lineWidth = 2; ctx.strokeStyle = "#2ee59d"; ctx.stroke(); }
    ctx.fillStyle = "#0b0f18"; ctx.fillText(String(sg.n), x, y + 0.5);
  });
  // problemas
  for (const e of AS.evs) { if (a.x[e.i] == null) continue; const [x, y] = P(a.x[e.i], a.z[e.i]); ctx.fillStyle = e.type === "lock" ? "#ff9b5d" : e.type === "loss" ? "#ff5a5f" : "#ffd23f"; ctx.fillRect(x - 4, y - 4, 8, 8); }
  const car = (L, col, idx) => { if (!L || L.x[idx] == null) return; const [x, y] = P(L.x[idx], L.z[idx]); ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#0b0f18"; ctx.stroke(); };
  car(b, COL_B, i0); car(a, COL_A, i0);
  $("#mapInfo").textContent = `${Math.round(AS.R.distance[i0])} m de ${Math.round(AS.R.length)} m`;
}

// ---- gráficos (uPlot)
function anCharts() {
  if (!AS) return;
  AS.plots.forEach((p) => p.destroy()); AS.plots = [];
  const box = $("#traceBox"), R = AS.R, x = R.distance, hasB = AS.hasB;
  const vis = TRACES_S.filter((t) => (t.key !== "delta" || hasB) && AS.show.has(t.key));
  box.innerHTML = vis.map((t) => `<div class="trace"><div class="tl"><span>${t.label}</span><span class="tv" id="tv-${t.key}"></span></div><div id="tp-${t.key}"></div></div>`).join("");
  const width = box.clientWidth;
  const axisS = (extra = {}) => ({ stroke: "#8e9bb2", grid: { stroke: "#1d2738", width: 1 }, ticks: { stroke: "#1d2738" }, font: "11px Barlow, sans-serif", ...extra });
  const marks = (u) => {
    const ctx = u.ctx, { top, height, left, width: w } = u.bbox, s = AS.segs[AS.seg];
    ctx.save();
    if (s) { const x0 = u.valToPos(x[s.start], "x", true), x1 = u.valToPos(x[s.end], "x", true); ctx.fillStyle = "rgba(46,229,157,.06)"; ctx.fillRect(x0, top, x1 - x0, height); }
    for (const e of AS.evs) { const px = u.valToPos(x[e.i], "x", true); if (px < left || px > left + w) continue; ctx.strokeStyle = e.type === "lock" ? "#ff9b5d" : e.type === "loss" ? "#ff5a5f" : "#ffd23f"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + height); ctx.stroke(); }
    ctx.restore();
  };
  const phaseDraw = (u) => {
    const ctx = u.ctx, { top, height } = u.bbox, rows = hasB ? 2 : 1, h = height / rows;
    [[R.phA, 0], ...(hasB ? [[R.phB, 1]] : [])].forEach(([ph, r]) => {
      let st = 0;
      for (let i = 1; i <= ph.length; i++) {
        if (i === ph.length || ph[i] !== ph[st]) {
          if (ph[st] != null) { const x0 = u.valToPos(x[st], "x", true), x1 = u.valToPos(x[i - 1], "x", true); ctx.fillStyle = PH_COL[ph[st]]; ctx.fillRect(x0, top + r * h + 2, Math.max(1, x1 - x0), h - 4); }
          st = i;
        }
      }
    });
  };
  vis.forEach((t, ti) => {
    const el = $(`#tp-${t.key}`);
    let data, series;
    const pct = (arr) => arr.map((v) => v == null ? null : v * 100);
    if (t.key === "delta") { data = [x, R.delta]; series = [{}, { stroke: COL_A, width: 1.8, fill: "rgba(46,229,157,.08)" }]; }
    else if (t.key === "phase") { data = [x, x.map(() => null)]; series = [{}, { stroke: "transparent" }]; }
    else {
      const va = t.pct ? pct(R.a[t.key]) : R.a[t.key];
      if (hasB) { data = [x, t.pct ? pct(R.b[t.key]) : R.b[t.key], va]; series = [{}, { stroke: COL_B, width: 1.5 }, { stroke: COL_A, width: 1.8 }]; }
      else { data = [x, va]; series = [{}, { stroke: COL_A, width: 1.8 }]; }
    }
    const last = ti === vis.length - 1;
    const u = new uPlot({
      width, height: t.h + (last ? 24 : 0), legend: { show: false },
      cursor: { sync: { key: "pitwall-an" }, y: false, drag: { x: true, y: false }, points: { size: 6 } },
      scales: { x: { time: false }, y: t.pct ? { range: [-5, 105] } : t.key === "steer" ? { range: [-1.05, 1.05] } : t.gear ? { range: [1, 8] } : t.key === "phase" ? { range: [0, 1] } : {} },
      axes: [axisS({ show: last, values: (u2, v) => v.map((m) => `${Math.round(m)} m`) }),
        axisS({ size: 52, ...(t.gear ? { values: (u2, v) => v.map(gearTxt) } : t.key === "phase" ? { values: () => [] } : {}) })],
      series,
      hooks: {
        draw: [(u2) => { if (t.key === "phase") phaseDraw(u2); marks(u2); }],
        setCursor: [(u2) => { const i = u2.cursor.idx; if (i != null && u2.cursor.left >= 0 && !AS.playing) anGoto(i, { fromPlot: true }); }],
        setSelect: [(u2) => { if (u2.select.width > 5) { const min = u2.posToVal(u2.select.left, "x"), max = u2.posToVal(u2.select.left + u2.select.width, "x"); AS.plots.forEach((p) => p.setScale("x", { min, max })); u2.setSelect({ width: 0, height: 0 }, false); } }],
      },
    }, data, el);
    el.ondblclick = () => anZoom();
    AS.plots.push(u);
  });
  anZoom();
  anValues(AS.idx);
}
function anValues(i) {
  const R = AS.R;
  for (const t of TRACES_S) {
    const el = $(`#tv-${t.key}`); if (!el) continue;
    if (t.key === "delta") { el.innerHTML = `${Math.round(R.distance[i])} m · <b class="${R.delta[i] > 0 ? "neg" : "pos"}">${sgn(R.delta[i], 3, " s")}</b>`; continue; }
    if (t.key === "phase") { const nm = (p) => p == null ? "—" : `<b style="color:${PH_COL[p]}">${PH_NAME[p]}</b>`; el.innerHTML = `${nm(R.phA[i])}${AS.hasB ? ` · ${nm(R.phB[i])}` : ""}`; continue; }
    const f = (v) => v == null ? "—" : t.gear ? gearTxt(v) : t.pct ? Math.round(v * 100) + "%" : t.key === "steer" ? v.toFixed(2) : Math.round(v) + (t.unit ? " " + t.unit : "");
    el.innerHTML = `<span class="va">${f(R.a[t.key][i])}</span>${AS.hasB ? ` <span class="vb">${f(R.b[t.key][i])}</span>` : ""}`;
  }
}
function anMediaHeight() {
  const v = $("#anVids"); if (!v) return;
  const big = $(".an-grid").classList.contains("mode-big");
  const def = big ? Math.round(innerHeight * 0.55) : 240;
  const h = +store.get("pitwall.site.vh." + (big ? "big" : "std")) || def;
  v.style.height = Math.max(140, Math.min(innerHeight * 0.85, h)) + "px";
}
function anBindResize() {
  const handle = $("#vresize"), v = $("#anVids"); if (!handle || !v) return;
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = v.getBoundingClientRect().height;
    const mv = (ev) => { v.style.height = Math.max(140, Math.min(innerHeight * 0.85, h0 + ev.clientY - y0)) + "px"; };
    const up = () => {
      handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up);
      store.set("pitwall.site.vh." + ($(".an-grid").classList.contains("mode-big") ? "big" : "std"), Math.round(v.getBoundingClientRect().height));
    };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up);
  });
}
