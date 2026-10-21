/* Pitwall — interface local (sem dependências além do uPlot). */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------------------------------------------------------------- utilidades
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
function fmtLap(ms) {
  if (ms == null || ms <= 0) return "—";
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
function fmtSec(ms) {
  if (ms == null) return "—";
  return ms >= 60000 ? fmtLap(ms) : (ms / 1000).toFixed(3);
}
function fmtDelta(ms) {
  if (ms == null) return "—";
  if (ms === 0) return "0.000";
  return (ms > 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3);
}
function parseLap(str) {   // "1:50.064" -> ms
  const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  return Math.round(((+m[1] || 0) * 60 + parseFloat(m[2].replace(",", "."))) * 1000);
}
const UPPER = new Set(["gt2", "gt3", "gt4", "lms", "amr", "rs", "gtr", "evo", "ii", "m4", "m6", "m2", "cs", "rc", "f", "v8", "v12", "nsx", "r8", "gt"]);
function pretty(name) {
  if (!name) return "—";
  return name.replace(/[_-]+/g, " ").split(" ").filter(Boolean)
    .map((w) => (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " · " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
const TYPES = { Practice: "Treino", Qualify: "Classificação", Race: "Corrida", Hotlap: "Hotlap",
  Hotstint: "Hotstint", Superpole: "Superpole", Unknow: "Sessão" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- roteador
const routes = [
  [/^#\/?$/, renderSessions],
  [/^#\/session\/(\d+)$/, (m) => renderSession(+m[1])],
  [/^#\/compare(?:\?(.*))?$/, (m) => renderCompare(new URLSearchParams(m[1] || ""))],
  [/^#\/strategy(?:\?(.*))?$/, (m) => renderStrategy(new URLSearchParams(m[1] || ""))],
  [/^#\/settings$/, () => renderSettings()],
  [/^#\/setups$/, () => renderSetups()],
  [/^#\/replay(?:\?(.*))?$/, (m) => renderReplay(new URLSearchParams(m[1] || ""))],
  [/^#\/progress(?:\?(.*))?$/, (m) => renderProgress(new URLSearchParams(m[1] || ""))],
  [/^#\/team$/, () => renderTeam()],
  [/^#\/lfm$/, () => renderLfm()],
  [/^#\/community$/, () => renderCommunity()],
  [/^#\/overlay$/, () => renderOverlay()],
  [/^#\/overlays$/, () => renderOverlays()],
];
let current = { name: "", id: null };
let plots = [];
let lfmTimer = null;
function route() {
  plots.forEach((p) => p.destroy()); plots = [];
  if (player) { player.destroy(); player = null; }
  if (RP) { RP.destroy(); RP = null; }
  view.classList.remove("wide");
  closeLapPicker();
  if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
  if (lfmTimer) { clearInterval(lfmTimer); lfmTimer = null; }
  document.body.classList.remove("overlay");
  const h = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      const sec = h.startsWith("#/compare") ? "compare" : h.startsWith("#/replay") ? "replay" : h.startsWith("#/strategy") ? "strategy"
        : h.startsWith("#/settings") ? "settings" : h.startsWith("#/setups") ? "setups"
        : h.startsWith("#/progress") ? "progress" : h.startsWith("#/team") ? "team" : h.startsWith("#/lfm") ? "lfm" : h.startsWith("#/community") ? "community" : h.startsWith("#/overlays") ? "overlays" : "sessions";
      document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === sec));
      fn(m);
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- contexto (carro + pista em análise)
const CTX = (() => { try { return JSON.parse(localStorage.getItem("pitwall.ctx") || "{}"); } catch (e) { return {}; } })();
function setCtx(car, track) {
  CTX.car = car || ""; CTX.track = track || "";
  try { localStorage.setItem("pitwall.ctx", JSON.stringify(CTX)); } catch (e) { /* ok */ }
  renderCtx();
}
let ctxCombos = [];
async function renderCtx(reload) {
  const el = $("#ctx");
  if (!el) return;
  if (reload || !ctxCombos.length) {
    try { ctxCombos = await api("/api/records"); } catch (e) { ctxCombos = []; }
  }
  if (!ctxCombos.length) { el.innerHTML = `<b>Analisando</b><div class="sub">Grave uma volta para começar.</div>`; return; }
  if (!ctxCombos.some((c) => c.track === CTX.track && c.car === CTX.car)) {
    const recent = [...ctxCombos].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
    CTX.car = recent.car; CTX.track = recent.track;
  }
  const tracks = [...new Set(ctxCombos.map((c) => c.track))].sort();
  const cars = ctxCombos.filter((c) => c.track === CTX.track).map((c) => c.car);
  const q = `car=${encodeURIComponent(CTX.car)}&track=${encodeURIComponent(CTX.track)}`;
  el.innerHTML = `<b>Analisando</b>
    <select id="ctxTrack" aria-label="Pista">${tracks.map((t) => `<option value="${esc(t)}" ${t === CTX.track ? "selected" : ""}>${esc(pretty(t))}</option>`).join("")}</select>
    <select id="ctxCar" aria-label="Carro">${cars.map((c) => `<option value="${esc(c)}" ${c === CTX.car ? "selected" : ""}>${esc(pretty(c))}</option>`).join("")}</select>
    <div class="go"><a href="#/compare?${q}">Análise</a><a href="#/replay?${q}">Replay</a><a href="#/progress?${q}">Progresso</a></div>`;
  const changed = () => {
    if (current.name === "progress") location.hash = `#/progress?car=${encodeURIComponent(CTX.car)}&track=${encodeURIComponent(CTX.track)}`;
  };
  $("#ctxTrack").onchange = (e) => {
    const t = e.target.value, c = (ctxCombos.find((x) => x.track === t && x.car === CTX.car) || ctxCombos.find((x) => x.track === t)).car;
    setCtx(c, t); changed();
  };
  $("#ctxCar").onchange = (e) => { setCtx(e.target.value, CTX.track); changed(); };
}

// ---------------------------------------------------------------- status ao vivo
let lastLive = {};
async function pollLive() {
  try {
    const l = await api("/api/live");
    const el = $("#live");
    el.className = "live " + (l.state || "waiting") + (l.video ? " video" : "");
    const gname = l.game === "iracing" ? "iRacing" : "ACC";
    let txt = "Aguardando o jogo (ACC / iRacing)…";
    if (l.state === "recording") {
      txt = `Gravando · ${pretty(l.track)} · Volta ${l.lap} · ${fmtLap(l.current_ms)}` +
        (l.delta_ms != null && !l.in_pit_lane ? ` · ${fmtDelta(l.delta_ms)}` : "") +
        (l.in_pit_lane ? " · Box" : "");
    } else if (l.state === "pause") txt = `${gname} pausado`;
    else if (l.state === "replay") txt = "Replay (não grava)";
    $(".txt", el).textContent = txt;
    el.title = l.suggested_setup ? `Setup sugerido para hoje: ${l.suggested_setup}` : "";
    if (l.laps_saved !== lastLive.laps_saved || l.session_id !== lastLive.session_id) {
      const changed = lastLive.state !== undefined;
      lastLive = l;
      if (changed && (current.name === "sessions" ||
          (current.name === "session" && current.id === l.session_id))) route();
    }
    lastLive = l;
  } catch (e) { /* servidor reiniciando */ }
  setTimeout(pollLive, 1000);
}

// ---------------------------------------------------------------- sessões
const sessState = { track: "", car: "", type: "", period: "", sel: new Set(), confirm: false };
async function renderSessions() {
  current = { name: "sessions" };
  const [list, records] = await Promise.all([api("/api/sessions"), api("/api/records")]);
  if (!list.length) {
    view.innerHTML = `<div class="panel empty"><b>Nenhuma sessão gravada ainda</b>
      Abra o Assetto Corsa Competizione e vá para a pista: a gravação começa sozinha.<br><br>
      Quer só testar? Rode <code>.\\iniciar.bat --seed-demo</code> para criar sessões de exemplo.</div>`;
    return;
  }
  const st = sessState;
  const ids = new Set(list.map((s) => s.id));
  st.sel = new Set([...st.sel].filter((i) => ids.has(i)));
  const days = { "7": 7, "30": 30, "90": 90 };
  const now = Date.now();
  const shown = list.filter((s) => (!st.track || s.track === st.track) && (!st.car || s.car === st.car)
    && (!st.type || s.session_type === st.type)
    && (!st.period || now - new Date(s.started_at).getTime() <= days[st.period] * 86400000));
  const uniq = (k) => [...new Set(list.map((s) => s[k]))].sort();
  const sel = (id, opts, val, all) => `<select id="${id}"><option value="">${all}</option>${opts.map(([k, t]) => `<option value="${esc(k)}" ${k === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  // agrupa por pista
  const byTrack = {};
  shown.forEach((s) => (byTrack[s.track] = byTrack[s.track] || []).push(s));
  const recFor = (track) => records.filter((r) => r.track === track && (!st.car || r.car === st.car));
  const selCount = st.sel.size;
  const selProtected = list.filter((s) => st.sel.has(s.id) && s.protected).length;

  view.innerHTML = `
    <div class="head"><div><h1>Sessões</h1>
      <div class="sub">${list.length} sessões · ${records.length} recorde(s) pessoal(is) protegido(s) 🏆</div></div></div>
    <div class="filters">
      ${sel("fsTrack", uniq("track").map((t) => [t, pretty(t)]), st.track, "Todas as pistas")}
      ${sel("fsCar", uniq("car").map((c) => [c, pretty(c)]), st.car, "Todos os carros")}
      ${sel("fsType", uniq("session_type").map((t) => [t, TYPES[t] || t]), st.type, "Todos os tipos")}
      ${sel("fsPeriod", [["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"]], st.period, "Qualquer data")}
      <span class="spacer"></span>
      ${selCount ? `<span class="sub">${selCount} selecionada(s)${selProtected ? ` · ${selProtected} com recorde (não será excluída)` : ""}</span>
        <button class="btn sm" id="fsClear">Limpar seleção</button>
        <button class="btn danger ${st.confirm ? "armed" : ""}" id="fsDel">${st.confirm ? "Confirmar exclusão" : "Excluir selecionadas"}</button>` : ""}
    </div>
    <div id="fsOut"></div>
    ${list.some((s) => s.game === "demo" || /^demo_/.test(s.track)) ? `<div class="demo-bar">
      <div><b>${list.filter((s) => s.game === "demo" || /^demo_/.test(s.track)).length} sessões de demonstração</b>
        <span class="sub">criadas pelo simulador para testar o app. Não são voltas suas.</span></div>
      <button class="btn danger" id="demoDel">Apagar demonstrações</button></div>` : ""}
    ${Object.keys(byTrack).length ? Object.entries(byTrack).map(([track, ss]) => `
      <section class="tgroup">
        <div class="tghead">
          <h2>${esc(pretty(track))}</h2><span class="sub">${ss.length} sessão(ões)</span><span class="spacer"></span>
          <label class="sub"><input type="checkbox" data-selall="${esc(track)}"> selecionar todas</label>
        </div>
        <div class="recs">${recFor(track).map((r) => `
          <div class="rec">
            <span class="trophy">🏆</span>
            <div><span class="sub">Recorde · ${esc(pretty(r.car))}</span><b class="num">${fmtLap(r.lap_time_ms)}</b>
              <span class="sub">${fmtDate(r.started_at)} · volta ${r.lap_number}</span></div>
            <a class="btn sm" href="#/replay?a=${r.lap_id}">Replay</a>
          </div>`).join("")}</div>
        <div class="panel pad0">
          <table class="stable"><thead><tr><th></th><th>Data</th><th>Carro</th><th>Tipo</th><th>Voltas</th><th>Melhor volta</th><th>vs. recorde</th><th></th><th></th></tr></thead>
          <tbody>${ss.map((s) => {
            const d = s.best_ms && s.pb_ms ? s.best_ms - s.pb_ms : null;
            return `<tr class="${st.sel.has(s.id) ? "sel" : ""}">
              <td><input type="checkbox" data-sel="${s.id}" ${st.sel.has(s.id) ? "checked" : ""}></td>
              <td><a href="#/session/${s.id}">${fmtDate(s.started_at)}</a></td>
              <td>${esc(pretty(s.car))}</td>
              <td><span class="tag">${esc(TYPES[s.session_type] || s.session_type)}</span></td>
              <td class="num">${s.laps}</td>
              <td class="num ${s.protected ? "best" : ""}">${fmtLap(s.best_ms)}</td>
              <td class="num ${d > 0 ? "neg" : ""}">${s.protected ? "🏆 recorde" : d == null ? "—" : fmtDelta(d)}</td>
              <td>${s.has_video ? `<span class="tag" title="Tem vídeo">🎥</span>` : ""}</td>
              <td class="acts"><a class="btn sm" href="#/session/${s.id}">Abrir</a>
                ${s.protected ? `<span class="lock" title="Tem o seu recorde com este carro nesta pista: não pode ser excluída">🔒</span>`
                  : `<button class="btn sm danger" data-del="${s.id}" title="Excluir esta sessão">Excluir</button>`}</td>
            </tr>`;
          }).join("")}</tbody></table>
        </div>
      </section>`).join("") : `<div class="panel empty"><b>Nenhuma sessão com esses filtros</b></div>`}`;

  const re = () => renderSessions();
  $("#fsTrack").onchange = (e) => { st.track = e.target.value; re(); };
  $("#fsCar").onchange = (e) => { st.car = e.target.value; re(); };
  $("#fsType").onchange = (e) => { st.type = e.target.value; re(); };
  $("#fsPeriod").onchange = (e) => { st.period = e.target.value; re(); };
  if ($("#demoDel")) $("#demoDel").onclick = async () => {
    const b = $("#demoDel");
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar: apagar todas"; return; }
    b.disabled = true; b.textContent = "Apagando…";
    await api("/api/sessions/delete-demo", { method: "POST" });
    renderSessions();
  };
  view.querySelectorAll("[data-sel]").forEach((cb) => cb.onchange = () => {
    const id = +cb.dataset.sel;
    cb.checked ? st.sel.add(id) : st.sel.delete(id);
    st.confirm = false; re();
  });
  view.querySelectorAll("[data-selall]").forEach((cb) => cb.onchange = () => {
    byTrack[cb.dataset.selall].forEach((s) => (cb.checked ? st.sel.add(s.id) : st.sel.delete(s.id)));
    st.confirm = false; re();
  });
  const clear = $("#fsClear");
  if (clear) clear.onclick = () => { st.sel.clear(); st.confirm = false; re(); };
  const del = $("#fsDel");
  if (del) del.onclick = async () => {
    if (!st.confirm) { st.confirm = true; re(); return; }
    const r = await api("/api/sessions/delete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...st.sel] }) });
    st.sel.clear(); st.confirm = false;
    await re();
    $("#fsOut").innerHTML = `<div class="note okk">${r.deleted.length} sessão(ões) excluída(s).${r.skipped.length
      ? ` ${r.skipped.length} foi(ram) mantida(s) porque guarda(m) um recorde 🏆.` : ""}</div>`;
  };
  view.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar"; b.classList.add("armed"); return; }
    await api(`/api/sessions/${b.dataset.del}`, { method: "DELETE" });
    re();
  });
}

// ---------------------------------------------------------------- sessão
const sessionState = { stint: 0, selected: [] };
async function renderSession(id) {
  if (current.name !== "session" || current.id !== id) sessionState.stint = 0, sessionState.selected = [];
  current = { name: "session", id };
  const data = await api(`/api/sessions/${id}`);
  const { session: s, laps, summary: sm, pb } = data;
  const refId = pb ? pb.lap_id : sm.best_lap_id;   // referência padrão: seu recorde com o carro nesta pista
  const best = sm.best_ms;
  const [b1, b2, b3] = sm.best_sectors;
  const stintChips = sm.stints.length > 1
    ? `<div class="chips"><span class="chip ${sessionState.stint === 0 ? "on" : ""}" data-stint="0">Todos</span>${
      sm.stints.map((st) => `<span class="chip ${sessionState.stint === st.stint ? "on" : ""}" data-stint="${st.stint}">
        Stint ${st.stint} · ${st.laps} voltas</span>`).join("")}</div>` : "";
  const shown = laps.filter((l) => !sessionState.stint || l.stint === sessionState.stint);

  const row = (l) => {
    const clean = l.valid && !l.out_lap && !l.in_lap;
    const status = l.out_lap ? `<span class="status pit">Saída do box</span>`
      : l.in_lap ? `<span class="status pit">Entrada no box</span>`
      : l.valid ? `<button class="status ok vbtn" data-valid="${l.id}" data-to="0" title="Cortou a pista e o jogo não pegou? Clique para marcar como inválida">Válida</button>`
      : `<button class="status bad vbtn" data-valid="${l.id}" data-to="1" title="Clique para marcar como válida">Inválida</button>`;
    const d = best && clean ? l.lap_time_ms - best : null;
    const sec = (v, b) => `<td class="num ${clean && v && v === b ? "best" : ""}">${fmtSec(v)}</td>`;
    const checked = sessionState.selected.includes(l.id);
    return `<tr class="${clean ? "" : "dim"} ${checked ? "sel" : ""}">
      <td><input type="checkbox" data-lap="${l.id}" ${checked ? "checked" : ""}></td>
      <td class="num">${l.lap_number}</td>
      <td class="num">${l.stint}</td>
      <td class="num ${clean && l.lap_time_ms === best ? "best" : ""}">${fmtLap(l.lap_time_ms)}</td>
      <td class="num ${d === 0 ? "zero" : d > 0 ? "pos" : ""}">${d == null ? "—" : fmtDelta(d)}</td>
      ${sec(l.s1_ms, b1)}${sec(l.s2_ms, b2)}${sec(l.s3_ms, b3)}
      <td class="num">${l.fuel_used != null ? l.fuel_used.toFixed(2) + " L" : "—"}</td>
      <td>${status}</td>
      <td class="evs">${evIcons(l.events)}</td>
      <td class="acts"><a class="btn sm" href="#/compare?a=${l.id}${refId && refId !== l.id ? "&b=" + refId : ""}" title="Analisar contra o seu recorde">Analisar</a>
        <a class="btn sm" href="#/replay?a=${l.id}${refId && refId !== l.id ? "&b=" + refId : ""}" title="Replay contra o seu recorde">Replay</a></td></tr>`;
  };

  view.innerHTML = `
    <div class="head">
      <div><h1>${esc(pretty(s.track))}</h1>
        <div class="sub">${esc(pretty(s.car))} · ${esc(TYPES[s.session_type] || s.session_type)} · ${fmtDate(s.started_at)}
          ${s.has_video ? ` · <span class="tag" style="border-color:var(--accent);color:var(--accent)">com vídeo</span>` : ""}</div></div>
      <span class="spacer"></span>
      <button class="btn primary" id="cmpBtn" disabled>Analisar selecionadas</button>
      ${s.protected ? `<span class="lockmsg" title="A sessão com o seu recorde não pode ser excluída">🏆 Tem o seu recorde · protegida</span>`
        : `<button class="btn danger" id="delBtn">Excluir sessão</button>`}
    </div>
    <div class="kpis">
      <div class="kpi best"><span>Melhor volta</span><b class="num">${fmtLap(best)}</b></div>
      <div class="kpi"><span>Volta ideal (melhores setores)</span><b class="num">${fmtLap(sm.optimal_ms)}</b></div>
      <div class="kpi"><span>Média (sem box)</span><b class="num">${fmtLap(sm.avg_ms)}</b></div>
      <div class="kpi"><span>Consumo médio</span><b class="num">${sm.fuel_per_lap != null ? sm.fuel_per_lap.toFixed(2) + " L" : "—"}</b></div>
    </div>
    <div class="layout">
      <div>
        <div class="panel" style="margin-bottom:14px">
          <h2>Tempo por volta</h2>${stintChips}
          <div id="lapChart" class="chart"></div>
        </div>
        <div class="panel">
          <div class="row" style="margin-bottom:6px"><h2 style="margin:0">Voltas</h2><span class="spacer"></span>
            <span class="sub" id="selHint">Marque 1 ou 2 voltas para comparar</span></div>
          <table>
            <thead><tr><th></th><th>Volta</th><th>Stint</th><th>Tempo</th><th>Delta</th><th>S1</th><th>S2</th><th>S3</th>
              <th>Comb.</th><th>Status</th><th title="Incidentes">Inc.</th><th></th></tr></thead>
            <tbody>${shown.map(row).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="side">
        <div class="panel">
          <h2>Stints</h2>
          <table><thead><tr><th>#</th><th>Voltas</th><th>Melhor</th><th>Média</th><th>L/volta</th></tr></thead>
          <tbody>${sm.stints.map((st) => `<tr><td>${st.stint}</td><td class="num">${st.laps}</td>
            <td class="num">${fmtLap(st.best_ms)}</td><td class="num">${fmtLap(st.avg_ms)}</td>
            <td class="num">${st.fuel_per_lap ?? "—"}</td></tr>`).join("")}</tbody></table>
        </div>
        ${degPanel(data.stint_trends)}
        ${s.suggestions && s.suggestions.length ? `<div class="panel" style="margin-top:14px"><h2>Setup sugerido para estas condições</h2>
          ${s.suggestions.map((x, i) => `<div class="sug ${i === 0 ? "top" : ""}"><b>${esc(x.name)}</b><div class="sub">${esc(x.why || "")}</div></div>`).join("")}
          <div class="note">Pela temperatura ${esc(laps[0] && laps[0].air_temp != null ? `do ar ${Math.round(laps[0].air_temp)}°C / pista ${Math.round(laps[0].road_temp)}°C` : "da sessão")}.
            Ajuste a base (ar ou pista) e a variante preferida em Configurações.</div></div>` : ""}
        ${fuelPanel({ ...sm, _track: s.track, _car: s.car })}
      </div>
    </div>
    <div class="panel" id="engineer" style="margin-top:14px"></div>`;

  // gráfico de tempos
  const xs = shown.map((l) => l.lap_number);
  const ys = shown.map((l) => (l.out_lap || l.in_lap ? null : l.lap_time_ms / 1000));
  const yv = shown.map((l) => (l.out_lap || l.in_lap || !l.valid ? null : l.lap_time_ms / 1000));
  const el = $("#lapChart");
  if (xs.length > 1) {
    plots.push(new uPlot({
      width: el.clientWidth, height: 220,
      scales: { x: { time: false } },
      axes: [axis({ label: "" , values: (u, v) => v.map((n) => Number.isInteger(n) ? n : "") }),
             axis({ values: (u, v) => v.map((n) => fmtLap(n * 1000).slice(0, -2)), size: 70 })],
      series: [{}, { label: "Todas", stroke: "#5d6573", width: 1.5, points: { size: 6, fill: "#5d6573" }, spanGaps: true },
               { label: "Válidas", stroke: css("--accent"), width: 0, points: { size: 8, fill: css("--accent") } }],
      cursor: { drag: { x: false, y: false } },
    }, [xs, ys, yv], el));
  } else el.innerHTML = `<div class="sub">Poucas voltas para o gráfico.</div>`;

  // eventos
  view.querySelectorAll(".chip").forEach((c) => c.onclick = () => { sessionState.stint = +c.dataset.stint; renderSession(id); });
  const updateBtn = () => {
    const n = sessionState.selected.length;
    $("#cmpBtn").disabled = n === 0;
    $("#selHint").textContent = n === 0 ? "Marque 1 ou 2 voltas para comparar" : `${n} volta(s) selecionada(s)`;
  };
  view.querySelectorAll("input[data-lap]").forEach((cb) => cb.onchange = () => {
    const lid = +cb.dataset.lap;
    const sel = sessionState.selected.filter((x) => x !== lid);
    if (cb.checked) sel.push(lid);
    sessionState.selected = sel.slice(-2);
    view.querySelectorAll("input[data-lap]").forEach((o) => {
      o.checked = sessionState.selected.includes(+o.dataset.lap);
      o.closest("tr").classList.toggle("sel", o.checked);
    });
    updateBtn();
  });
  updateBtn();
  $("#cmpBtn").onclick = () => {
    const sel = sessionState.selected;
    let a, b;
    if (sel.length === 1) { a = sel[0]; b = refId !== a ? refId : null; }
    else {   // a mais rápida vira a referência
      const t = (id) => (laps.find((l) => l.id === id) || {}).lap_time_ms || 0;
      [a, b] = t(sel[0]) >= t(sel[1]) ? [sel[0], sel[1]] : [sel[1], sel[0]];
    }
    location.hash = `#/compare?a=${a}${b ? "&b=" + b : ""}`;
  };
  if ($("#delBtn")) $("#delBtn").onclick = async () => {
    const btn = $("#delBtn");
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Confirmar exclusão"; return; }
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    location.hash = "#/";
  };
  view.querySelectorAll("[data-valid]").forEach((b) => b.onclick = async () => {
    const to = b.dataset.to === "1";
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = to ? "Marcar válida?" : "Marcar inválida?"; return; }
    b.disabled = true;
    try {
      const r = await api(`/api/laps/${b.dataset.valid}/valid`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valid: to }) });
      if (r.cloud && r.cloud.error) console.warn("nuvem:", r.cloud.error);
    } catch (e) { b.textContent = e.message; return; }
    renderSession(id);
  });
  bindFuel();
  drawDegCharts(data.stint_trends);
  engineerPanel(s);
}

function axis(extra = {}) {
  return { stroke: css("--muted"), grid: { stroke: "#1f242c", width: 1 }, ticks: { stroke: "#1f242c" },
    font: "11px Segoe UI, system-ui", ...extra };
}

// ---------------------------------------------------------------- combustível
function fuelPanel(sm) {
  return `<div class="panel fuel" id="fuel">
    <h2>Calculadora de combustível</h2>
    <label>Tempo médio de volta <input id="fAvg" value="${sm.avg_ms ? fmtLap(sm.avg_ms) : ""}" placeholder="1:50.000"></label>
    <label>Consumo por volta (L) <input id="fFpl" value="${sm.fuel_per_lap ?? ""}" placeholder="3.10"></label>
    <label>Voltas extras de segurança <input id="fExtra" type="number" min="0" value="1"></label>
    <label>Outra duração (min) <input id="fCustom" type="number" min="1" placeholder="ex.: 90"></label>
    <table><thead><tr><th>Corrida</th><th>Voltas</th><th>Mínimo</th><th>Com margem</th></tr></thead>
      <tbody id="fRows"></tbody></table>
    <div class="note">Já vem preenchido com os dados desta sessão; dá pra editar à vontade.</div>
    <a class="btn" style="display:block;text-align:center;margin-top:12px" href="#/strategy?track=${encodeURIComponent(sm._track || "")}&car=${encodeURIComponent(sm._car || "")}">Planejar estratégia com paradas →</a>
  </div>`;
}
function bindFuel() {
  const calc = () => {
    const avg = parseLap($("#fAvg").value), fpl = parseFloat(String($("#fFpl").value).replace(",", "."));
    const extra = Math.max(0, parseInt($("#fExtra").value || "0", 10));
    const mins = [20, 30, 45, 60];
    const c = parseInt($("#fCustom").value, 10);
    if (c > 0 && !mins.includes(c)) mins.push(c);
    if (!avg || !(fpl > 0)) { $("#fRows").innerHTML = `<tr><td colspan="4" class="sub">Preencha tempo e consumo.</td></tr>`; return; }
    $("#fRows").innerHTML = mins.sort((a, b) => a - b).map((m) => {
      const laps = Math.ceil((m * 60000) / avg);
      return `<tr><td>${m} min</td><td class="num">${laps}</td><td class="num">${Math.ceil(laps * fpl)} L</td>
        <td class="num"><b>${Math.ceil((laps + extra) * fpl)} L</b></td></tr>`;
    }).join("");
  };
  ["#fAvg", "#fFpl", "#fExtra", "#fCustom"].forEach((s) => $(s).addEventListener("input", calc));
  calc();
}

// ---------------------------------------------------------------- análise (comparação)
// A = sua volta (laranja), B = referência (azul). delta > 0 = você está atrás.
const TRACES = [
  { key: "delta", label: "Diferença para a referência", short: "Diferença", h: 120 },
  { key: "phase", label: "Pedais (verde acelera, amarelo solto, vermelho freia)", short: "Pedais", h: 56 },
  { key: "speed", label: "Velocidade", h: 170, unit: "km/h" },
  { key: "brake", label: "Freio", h: 90, pct: true },
  { key: "gas", label: "Acelerador", h: 90, pct: true },
  { key: "steer", label: "Volante", h: 100 },
  { key: "gear", label: "Marcha", h: 120, gear: true },
];
const gearTxt = (g) => { if (g == null) return "—"; g = Math.round(g); return g === 0 ? "R" : g === 1 ? "N" : String(g - 1); };
let player = null;   // controle de vídeo da tela de análise
let AN = null;       // estado da tela de análise

// Fase do pedal em cada ponto: 0 = acelerando, 1 = sem pedal (carro solto), 2 = freando
const PHASE_COLORS = ["#3fd68b", "#ffd23f", "#ff5d5d"];
const PHASE_NAMES = ["Acelerando", "Sem pedal", "Freando"];
function phases(L) {
  const n = L.gas.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const g = L.gas[i], b = L.brake[i];
    out[i] = g == null && b == null ? null : (b ?? 0) >= 0.1 ? 2 : (g ?? 0) >= 0.1 ? 0 : 1;
  }
  return out;
}
// trechos contínuos de mesma fase: [[início, fim, fase], ...]
function phaseRuns(ph) {
  const runs = [];
  let st = 0;
  for (let i = 1; i <= ph.length; i++) {
    if (i === ph.length || ph[i] !== ph[st]) { if (ph[st] != null) runs.push([st, i - 1, ph[st]]); st = i; }
  }
  return runs;
}
// gradiente com cortes secos para pintar uma linha do uPlot conforme a fase
function phaseStroke(x, runs) {
  return (u) => {
    if (!AN || !AN.phaseColors) return css("--a");
    const { left, width } = u.bbox;
    const g = u.ctx.createLinearGradient(left, 0, left + width, 0);
    const pos = (i) => Math.min(1, Math.max(0, (u.valToPos(x[i], "x", true) - left) / width));
    let last = 0;
    for (const [a, b, p] of runs) {
      const p0 = Math.max(last, pos(a)), p1 = Math.max(p0, pos(Math.min(b + 1, x.length - 1)));
      if (p1 <= 0 || p0 >= 1) continue;
      g.addColorStop(p0, PHASE_COLORS[p]); g.addColorStop(p1, PHASE_COLORS[p]);
      last = p1;
    }
    return g;
  };
}

function fmtOffset(o) { return (o >= 0 ? "+" : "−") + Math.abs(o || 0).toFixed(1) + " s"; }
const fmtM = (m) => (m == null ? "—" : `${Math.round(m)} m`);
const sgn = (v, nd = 3, unit = "") => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(nd) + unit);

// ---------------------------------------------------------------- escolher volta (popover)
// Abre uma lista agrupada (recordes, volta ideal, equipe, sessões) ancorada num elemento.
function lapPicker(anchor, options, currentId, onPick, { allowNone = false, title = "Escolher volta" } = {}) {
  closeLapPicker();
  const pbIds = pbLapIds(options);
  const own = options.filter((l) => !l.kind || l.kind === "own");
  const groups = [
    ["Seus recordes", own.filter((l) => pbIds.has(l.id))],
    ["Volta ideal", options.filter((l) => l.kind === "ideal")],
    ["Equipe", options.filter((l) => l.kind === "team")],
    ["Todas as suas voltas", own.filter((l) => !pbIds.has(l.id)).sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)) || x.lap_time_ms - y.lap_time_ms)],
  ].filter(([, ls]) => ls.length);
  const item = (l) => {
    const name = l.kind === "ideal" ? "Volta ideal" : l.kind === "team" ? (l.player || "Equipe") : `Volta ${l.lap_number}`;
    const meta = l.kind === "ideal" ? pretty(l.car) : `${pretty(l.car)} · ${fmtDate(l.started_at)}${l.valid && !l.out_lap && !l.in_lap ? "" : " · fora do ritmo"}`;
    return `<button class="lp-item ${l.id === currentId ? "on" : ""}" data-id="${l.id}"><span><b>${esc(name)}</b><small>${esc(meta)}</small></span><b class="num">${fmtLap(l.lap_time_ms)}</b></button>`;
  };
  const pop = document.createElement("div");
  pop.className = "lap-pop";
  pop.innerHTML = `<div class="lp-head"><b>${esc(title)}</b><input type="search" placeholder="Filtrar (carro, data, volta)" id="lpQ"></div>
    <div class="lp-list">${allowNone ? `<button class="lp-item" data-id=""><span><b>Sem referência</b><small>Analisar só a sua volta</small></span></button>` : ""}
    ${groups.map(([g, ls]) => `<div class="lp-group">${esc(g)}</div>${ls.map(item).join("")}`).join("")}</div>`;
  document.body.appendChild(pop);
  const rc = anchor.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, rc.left)) + "px";
  pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 12, rc.bottom + 6) + "px";
  pop.querySelectorAll(".lp-item").forEach((b) => b.onclick = () => { closeLapPicker(); onPick(b.dataset.id ? +b.dataset.id : null); });
  const q = $("#lpQ", pop);
  q.oninput = () => {
    const v = q.value.toLowerCase();
    pop.querySelectorAll(".lp-item").forEach((b) => { b.style.display = !v || b.textContent.toLowerCase().includes(v) ? "" : "none"; });
  };
  setTimeout(() => {
    lapPickerClose = (e) => { if (!pop.contains(e.target)) closeLapPicker(); };
    document.addEventListener("pointerdown", lapPickerClose);
  }, 0);
}
let lapPickerClose = null;
function closeLapPicker() {
  document.querySelectorAll(".lap-pop").forEach((p) => p.remove());
  if (lapPickerClose) { document.removeEventListener("pointerdown", lapPickerClose); lapPickerClose = null; }
}

// sua volta mais recente (limpa) + seu recorde, para abrir direto um carro/pista
async function defaultPair(car, track) {
  const laps = await api(`/api/tracks/${encodeURIComponent(track)}/laps`);
  const own = laps.filter((l) => (!l.kind || l.kind === "own") && (!car || l.car === car));
  const clean = own.filter((l) => l.valid && !l.out_lap && !l.in_lap);
  const list = clean.length ? clean : own;
  if (!list.length) return null;
  const ref = list[0];
  const recent = list.filter((l) => l.id !== ref.id).sort((x, y) => y.started_at.localeCompare(x.started_at) || y.lap_number - x.lap_number)[0];
  return recent ? { a: recent.id, b: ref.id } : { a: ref.id, b: null };
}

// ---------------------------------------------------------------- análise
const TRACE_DEFAULT = ["delta", "phase", "speed", "brake", "gas"];
function shownTraces() {
  try { const v = JSON.parse(localStorage.getItem("pitwall.traces")); if (Array.isArray(v) && v.length) return new Set(v); } catch (e) { /* ok */ }
  return new Set(TRACE_DEFAULT);
}
const EVENT_TXT = {
  lock: ["Travou a roda", "a roda travou na freada: alivie um pouco o pedal ou freie em linha reta antes de virar"],
  loss: ["Perdeu o carro", "o carro escapou (rodada ou saída de traseira): entrada rápida demais ou acelerador cedo demais"],
  invalid: ["Volta invalidada", "passou dos limites da pista aqui"],
  pit_out: ["Saída dos boxes", "volta de saída: pneus e freios ainda frios"],
  pit_in: ["Entrada nos boxes", "volta de entrada nos boxes"],
  best: ["Melhor volta da sessão", "a volta mais rápida e válida desta sessão"],
};

async function renderCompare(params) {
  current = { name: "compare" };
  if (player) player.destroy();
  player = null;
  let a = +params.get("a") || null, b = +params.get("b") || null;
  if (!a) {
    const car = params.get("car") || CTX.car, track = params.get("track") || CTX.track;
    if (track) {
      const p = await defaultPair(car, track);
      if (p) { location.replace(`#/compare?a=${p.a}${p.b ? "&b=" + p.b : ""}`); return; }
    }
    return renderComparePicker();
  }
  view.classList.add("wide");
  view.innerHTML = `<div class="sub" style="padding:24px">Carregando telemetria…</div>`;
  const r = await api(`/api/compare?a=${a}${b ? "&b=" + b : ""}`);
  const LA = r.lap_a, LB = r.lap_b, hasB = !!LB;
  const track = LA.track;
  if (LA.kind !== "ideal" && LA.kind !== "team") setCtx(LA.car, track);
  const options = await api(`/api/tracks/${encodeURIComponent(track)}/laps`);
  const diff = hasB ? LA.lap_time_ms - LB.lap_time_ms : null;
  const segs = r.segments || [];
  const n = r.distance.length;
  // problemas da sua volta, já com a curva
  const evs = (LA.events || []).map((e) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(e.d * (n - 1))));
    const k = segs.findIndex((s) => i >= s.start && i <= s.end);
    return { ...e, i, seg: k };
  });
  const lapName = (L) => !L ? "" : L.kind === "ideal" ? "Volta ideal" : L.kind === "team" ? (L.player || "Equipe") : `Volta ${L.lap_number} · ${fmtDate(L.started_at)}`;
  const chip = (L, tag, who) => `
    <button class="lapchip ${tag}" id="pick${tag.toUpperCase()}" title="Trocar">
      <i></i><span><small>${who}</small><b class="num">${L ? fmtLap(L.lap_time_ms) : "Escolher"}</b><em>${esc(L ? lapName(L) : "nenhuma referência")}</em></span>
      <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>`;
  const secs = ["s1_ms", "s2_ms", "s3_ms"].map((k, i) => {
    const d = hasB && LA[k] && LB[k] ? LA[k] - LB[k] : null;
    return `<span>S${i + 1} <b class="num ${d > 0 ? "neg" : d < 0 ? "posg" : ""}">${hasB ? fmtDelta(d) : fmtSec(LA[k])}</b></span>`;
  }).join("");
  const worst = hasB ? segs.map((s, k) => ({ s, k })).filter((x) => x.s.delta > 0.02).sort((x, y) => y.s.delta - x.s.delta).slice(0, 6) : [];
  const hasVid = LA.video || (LB && LB.video);
  const vid = (L, tag, label) => `
    <div class="vid2 ${tag}">
      ${L && L.video ? `<video id="vid-${tag}" src="${L.video.url}" preload="auto" muted playsinline></video>
        <div class="vbar"><span class="vtag2">${label}</span><span class="spacer"></span>
          <span class="sync2" title="Ajuste fino da sincronia do vídeo"><button class="btn xs" data-off="${tag}" data-d="-0.1">−0,1</button>
          <span class="num" id="off-${tag}">${fmtOffset(L.video.offset)}</span><button class="btn xs" data-off="${tag}" data-d="0.1">+0,1</button></span>
          <button class="btn xs" data-fs="${tag}" title="Tela cheia">⛶</button></div>`
        : `<div class="novid2"><span class="vtag2">${label}</span><span>${L ? "Sem vídeo desta volta" : "Escolha uma referência"}</span></div>`}
    </div>`;
  const layout = localStorage.getItem("pitwall.anLayout") || "std";
  const shown = shownTraces();

  view.innerHTML = `
  <div class="an2 mode-${layout}" id="an2">
    <header class="an2-top">
      ${chip(LA, "a", "Sua volta")}<span class="vs">vs</span>${chip(LB, "b", "Referência")}
      <div class="an2-total"><small>${esc(pretty(track))} · ${esc(pretty(LA.car))}</small>
        <b class="num ${diff > 0 ? "neg" : diff < 0 ? "posg" : ""}">${hasB ? fmtDelta(diff) : fmtLap(LA.lap_time_ms)}</b>
        <div class="secs">${secs}</div></div>
      <span class="spacer"></span>
      <div class="seg-switch"><span class="btn sm on">Análise</span><a class="btn sm" href="#/replay?a=${a}${b ? "&b=" + b : ""}">Replay</a></div>
    </header>

    ${lapStrip(options, LA, LB)}

    <section class="an2-findings">
      ${hasB ? `<div class="fgroup"><span class="flabel">Onde você perde tempo</span>
        ${worst.length ? worst.map(({ s, k }) => `<button class="fchip loss" data-seg="${k}">Curva ${s.n}<b class="num">+${s.delta.toFixed(2).replace(".", ",")} s</b></button>`).join("")
          : `<span class="fnone">Nenhum trecho com perda relevante. Boa volta!</span>`}</div>` : `<div class="fgroup"><span class="fnone">Escolha uma referência para ver onde você perde tempo.</span></div>`}
      <div class="fgroup"><span class="flabel">Problemas na volta</span>
        ${evs.length ? evs.map((e, j) => `<button class="fchip ev-${e.type}" data-ev="${j}" title="${esc((EVENT_TXT[e.type] || [e.type, ""])[1])}">${(EV[e.type] || {}).icon || "•"} ${esc((EVENT_TXT[e.type] || [e.type])[0])}${e.seg >= 0 ? ` <small>curva ${segs[e.seg].n}</small>` : ""}</button>`).join("")
          : `<span class="fnone ok">Nenhuma travada, rodada ou saída de pista.</span>`}</div>
    </section>

    ${LA.session_id && LA.kind !== "ideal" && LA.kind !== "team" ? `<section class="an2-tl panel" id="tl"><div class="sub">Carregando os acontecimentos…</div></section>` : ""}

    <div class="an2-grid">
      <section class="an2-media panel pad0" id="media">
        <div class="vids3 ${localStorage.getItem("pitwall.anSolo") === "b" ? "solo-b" : "solo-a"}" id="vids">${vid(LA, "a", "Sua volta")}${vid(LB, "b", "Referência")}</div>
        <div class="pctl2">
          <button class="btn sm primary" id="play" ${hasVid ? "" : "disabled"} title="Espaço">▶</button>
          <div class="rates">${[0.25, 0.5, 1].map((x) => `<button class="btn xs ${x === 1 ? "on" : ""}" data-rate="${x}">${String(x).replace(".", ",")}×</button>`).join("")}</div>
          <div id="prog" class="prog"><div class="segband"></div><div class="fill"></div><div class="knob"></div><div class="hover"></div></div>
          <span class="num sub" id="progTxt"></span>
          <div class="seg-switch lay" title="Tamanho dos vídeos">
            <button class="btn xs ${layout === "std" ? "on" : ""}" data-lay="std">Padrão</button>
            <button class="btn xs ${layout === "one" ? "on" : ""}" data-lay="one">1 vídeo grande</button>
            <button class="btn xs ${layout === "two" ? "on" : ""}" data-lay="two">2 lado a lado</button>
          </div>
          <div class="seg-switch solo" title="Qual vídeo mostrar"><button class="btn xs" data-solo="a">Sua</button><button class="btn xs" data-solo="b">Ref.</button></div>
        </div>
        ${hasVid ? "" : `<div class="note" style="padding:0 14px 12px">Sem vídeo para estas voltas. Ligue a gravação em <a href="#/settings" style="color:var(--accent)">Configurações</a>.</div>`}
        <div class="vresize" id="vresize" title="Arraste para aumentar ou diminuir os vídeos"></div>
      </section>

      <aside class="an2-side">
        <div class="panel" id="segInfo"></div>
        <div class="panel pad0">
          <div class="mapbar"><span class="sub" id="zinfo">Traçado</span><span class="spacer"></span>
            <button class="btn xs" id="zout" title="Afastar">−</button><button class="btn xs" id="zin" title="Aproximar">+</button>
            <button class="btn xs on" id="zrot" title="Girar o mapa com o carro">Girar</button></div>
          <div id="zmap"></div>
        </div>
        <div class="panel pad0">
          <div id="fmap"></div>
          <div class="segnav"><button class="btn xs" id="segPrev" title="Curva anterior (←)">◀</button>
            <div id="segTitle" class="num"></div><button class="btn xs" id="segNext" title="Próxima curva (→)">▶</button></div>
        </div>
      </aside>

      <section class="an2-charts panel" id="traces">
        <div class="tbar">
          <div class="ttoggles">${TRACES.filter((t) => t.key !== "delta" || hasB).map((t) => `<button class="tchip ${shown.has(t.key) ? "on" : ""}" data-tr="${t.key}">${esc(t.short || t.label)}</button>`).join("")}</div>
          <span class="spacer"></span>
          <div class="plegend">${PHASE_NAMES.map((nm, i) => `<span><i style="background:${PHASE_COLORS[i]}"></i>${nm}</span>`).join("")}</div>
          <button class="btn xs on" id="phaseBtn" title="Pinta a sua linha conforme o pedal">Cores</button>
          <button class="btn xs on" id="focusBtn">Só a curva</button>
        </div>
        <div id="traceBox"></div>
        <div class="note">Passe o mouse nos gráficos ou no mapa · arraste para dar zoom · duplo clique volta · ← → troca de curva.</div>
      </section>
    </div>
  </div>`;

  $("#pickA").onclick = (e) => lapPicker(e.currentTarget, options, a, (id) => { if (id) location.hash = `#/compare?a=${id}${b ? "&b=" + b : ""}`; }, { title: "Sua volta" });
  $("#pickB").onclick = (e) => lapPicker(e.currentTarget, options, b, (id) => { location.hash = `#/compare?a=${a}${id ? "&b=" + id : ""}`; }, { allowNone: true, title: "Comparar com" });

  bindLapStrip(options, LA, LB, a, b);

  AN = { r, LA, LB, hasB, n, segs, evs, seg: 0, focus: true, idx: 0, lastIdx: -1, phaseColors: true, show: shown };
  AN.phA = phases(r.a); AN.runsA = phaseRuns(AN.phA);
  if (hasB) { AN.phB = phases(r.b); AN.runsB = phaseRuns(AN.phB); }
  AN.zmap = drawZoomMap(r, hasB);
  AN.fmap = drawFullMap(r, hasB, segs);
  incidentMarkers($("#fSvg"), LA.events, r.a.x, r.a.z, segs);
  player = makePlayer(r, LA, LB);
  applyMediaHeight();
  drawTraces(r, hasB);
  bindAnalysis();
  view.querySelectorAll(".fchip[data-seg]").forEach((c) => c.onclick = () => selectSegment(+c.dataset.seg));
  view.querySelectorAll(".fchip[data-ev]").forEach((c) => c.onclick = () => {
    const e = evs[+c.dataset.ev];
    if (e.seg >= 0) selectSegment(e.seg, { keepCursor: true });
    gotoIndex(e.i);
  });
  const want = +params.get("seg");
  const k0 = want ? segs.findIndex((s) => s.n === want) : -1;
  selectSegment(k0 >= 0 ? k0 : worst.length ? worst[0].k : 0);
  const at = params.get("at");
  if (at != null && at !== "") {                     // veio de um acontecimento de outra volta: vai direto ao momento
    const i = Math.max(0, Math.min(n - 1, Math.round(+at * (n - 1))));
    selectSegment(segFor(i), { keepCursor: true });
    gotoIndex(i);
  }
  if ($("#tl")) sessionTimeline(LA, a, b, segs, n);
}

// ---------------------------------------------------------------- acontecimentos da sessão
let tlFilter = "all";
async function sessionTimeline(LA, a, b, segs, n) {
  const box = $("#tl");
  let tl;
  try { tl = await api(`/api/sessions/${LA.session_id}/timeline`); } catch (e) { box.remove(); return; }
  if (!$("#tl")) return;
  const evs = tl.events;
  if (!evs.length) { box.innerHTML = `<div class="tl-head"><b>Acontecimentos da sessão</b></div><div class="fnone ok">Nenhum acontecimento marcado nesta sessão.</div>`; return; }
  const hasB = !!b;                                          // com referência, as curvas são as da tela; sem ela, as da melhor volta da sessão
  const cornerOf = (e) => hasB ? cornerAt(e.d) : e.corner;
  const cornerAt = (d) => { const i = Math.max(0, Math.min(n - 1, Math.round(d * (n - 1)))); const k = segs.findIndex((s) => i >= s.start && i <= s.end); return k >= 0 ? segs[k].n : null; };
  const count = (t) => evs.filter((e) => e.type === t).length;
  const FIL = [["all", "Todos", evs.length], ["loss", "Rodadas", count("loss")], ["lock", "Travadas", count("lock")], ["invalid", "Inválidas", count("invalid")],
    ["pit", "Boxes", count("pit_in") + count("pit_out")], ["best", "Melhor volta", count("best")]].filter((f) => f[0] === "all" || f[2]);
  if (!FIL.some((f) => f[0] === tlFilter)) tlFilter = "all";
  const match = (e) => tlFilter === "all" || (tlFilter === "pit" ? e.type.startsWith("pit_") : e.type === tlFilter);
  const lapLabel = (l) => `Volta ${l.n}${l.out ? " · saída" : l.inn ? " · entrada" : ""}`;
  const draw = () => {
    const shown = evs.filter(match);
    const byLap = new Map();
    for (const e of shown) { if (!byLap.has(e.lap)) byLap.set(e.lap, []); byLap.get(e.lap).push(e); }
    box.innerHTML = `<div class="tl-head"><b>Acontecimentos da sessão</b><span class="sub">clique para ir direto ao momento (gráficos, mapa e vídeo)</span><span class="spacer"></span>
        <div class="tl-fil">${FIL.map(([k, t, c]) => `<button class="tchip ${k === tlFilter ? "on" : ""}" data-f="${k}">${t}<small>${c}</small></button>`).join("")}</div></div>
      <div class="tl-list">${[...byLap.entries()].map(([lap, list]) => { const L = tl.laps.find((x) => x.n === lap) || { n: lap };
        return `<div class="tl-lap ${L.id === LA.id ? "cur" : ""}"><div class="tl-lapname"><b>${lapLabel(L)}</b><small class="num">${L.ms ? fmtLap(L.ms) : ""}</small></div>
          <div class="tl-evs">${list.map((e) => { const c = e.type === "pit_in" || e.type === "pit_out" || e.type === "best" ? null : cornerOf(e), meta = EV[e.type] || { icon: "•", cls: "" };
            const tip = (EVENT_TXT[e.type] || [e.type, ""])[1] + (e.drop ? ` (perdeu ${e.drop} km/h)` : "");
            return `<button class="tlev ev-${e.type}" data-lap="${e.lap_id}" data-d="${e.d}" title="${esc(tip)}">${meta.icon} ${esc((EVENT_TXT[e.type] || [e.type])[0])}
              ${c ? `<small>curva ${c}</small>` : ""}${e.t && e.type !== "pit_in" ? `<small class="num">${fmtLap(e.t)}</small>` : ""}</button>`; }).join("")}</div></div>`; }).join("")
        || `<div class="fnone">Nenhum acontecimento deste tipo.</div>`}</div>`;
    box.querySelectorAll("[data-f]").forEach((el) => el.onclick = () => { tlFilter = el.dataset.f; draw(); });
    box.querySelectorAll(".tlev").forEach((el) => el.onclick = () => {
      const lapId = +el.dataset.lap, d = +el.dataset.d;
      // sem referência, abre com a melhor volta da sessão como referência: assim a numeração das curvas bate com a da lista
      const ref = b || (tl.best_id && lapId !== tl.best_id ? tl.best_id : null);
      if (lapId === LA.id && (b || LA.id === tl.best_id || !tl.best_id)) {   // mesma volta: só move o cursor
        const i = Math.max(0, Math.min(n - 1, Math.round(d * (n - 1))));
        selectSegment(segFor(i), { keepCursor: true });
        gotoIndex(i);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {                                                // outra volta: abre ela (mantendo a referência) e vai ao momento
        location.hash = `#/compare?a=${lapId}${ref ? "&b=" + ref : ""}&at=${d}`;
      }
    });
  };
  draw();
}

function applyMediaHeight() {
  const el = $("#an2"), lay = el.className.match(/mode-(\w+)/)[1];
  const def = lay === "std" ? 210 : Math.round(window.innerHeight * 0.55);
  let h = def;
  try { h = +localStorage.getItem("pitwall.vh." + lay) || def; } catch (e) { /* ok */ }
  $("#vids").style.height = Math.max(120, Math.min(window.innerHeight * 0.85, h)) + "px";
}

function rebuildTraces() {
  plots.forEach((p) => p.destroy()); plots = [];
  drawTraces(AN.r, AN.hasB);
  if (AN.focus) selectSegment(AN.seg, { keepCursor: true });
  AN.lastIdx = -1; updateAt(AN.idx);
}

function segFor(i) {
  const s = AN.segs;
  for (let k = 0; k < s.length; k++) if (i >= s[k].start && i <= s[k].end) return k;
  return 0;
}

// Move tudo (gráficos, mapas, vídeo, barra) para o índice i da grade.
function gotoIndex(i, { fromPlot = false } = {}) {
  if (!AN) return;
  i = Math.max(0, Math.min(AN.n - 1, i));
  const k = segFor(i);
  if (AN.focus && k !== AN.seg && !fromPlot) selectSegment(k, { keepCursor: true });
  else if (!AN.focus && k !== AN.seg) { AN.seg = k; renderSegInfo(); AN.fmap.highlight(k); }
  updateAt(i);
  if (!fromPlot) {
    const u = plots[0];
    if (u) requestAnimationFrame(() => u.setCursor({ left: u.valToPos(AN.r.distance[i], "x"), top: 5 }));
  }
}

function updateAt(i) {
  if (i === AN.lastIdx) return;
  AN.lastIdx = AN.idx = i;
  const { r, hasB } = AN;
  for (const t of TRACES) {
    const el = $(`#v-${t.key}`);
    if (!el) continue;
    if (t.key === "phase") {
      const nm = (p) => p == null ? "—" : `<b style="color:${PHASE_COLORS[p]}">${PHASE_NAMES[p]}</b>`;
      el.innerHTML = `Você: ${nm(AN.phA[i])}${hasB ? ` · Ref.: ${nm(AN.phB[i])}` : ""}`;
      continue;
    }
    if (t.key === "delta") {
      el.innerHTML = `${Math.round(r.distance[i])} m · <b class="${r.delta[i] > 0 ? "neg" : "posg"}">${r.delta[i] == null ? "—" : sgn(r.delta[i], 3, " s")}</b>`;
      continue;
    }
    const f = (v) => v == null ? "—" : t.gear ? gearTxt(v) : t.pct ? Math.round(v * 100) + "%" : t.key === "steer" ? v.toFixed(2) : Math.round(v) + (t.unit ? " " + t.unit : "");
    el.innerHTML = `<span class="va">${f(r.a[t.key][i])}</span>${hasB ? ` <span class="vb">${f(r.b[t.key][i])}</span>` : ""}`;
  }
  AN.zmap.move(i);
  AN.fmap.move(i);
  if (player) player.seek(i);
  const frac = i / (AN.n - 1);
  $("#prog .fill").style.width = (frac * 100).toFixed(2) + "%";
  $("#prog .knob").style.left = (frac * 100).toFixed(2) + "%";
  const ta = r.a.t[i];
  $("#progTxt").textContent = ta == null ? "" : fmtLap(ta);
}

function selectSegment(k, { keepCursor = false } = {}) {
  const segs = AN.segs;
  if (!segs.length) return;
  k = (k + segs.length) % segs.length;
  AN.seg = k;
  const s = segs[k];
  renderSegInfo();
  AN.fmap.highlight(k);
  view.querySelectorAll(".fchip[data-seg]").forEach((c) => c.classList.toggle("on", +c.dataset.seg === k));
  const band = $("#prog .segband");
  band.style.left = (s.start / (AN.n - 1) * 100) + "%";
  band.style.width = ((s.end - s.start) / (AN.n - 1) * 100) + "%";
  const d = AN.r.distance;
  AN.syncing = true;
  plots.forEach((p) => {
    if (AN.focus) p.setScale("x", { min: Math.max(0, d[s.start] - 40), max: Math.min(d[AN.n - 1], d[s.end] + 40) });
    else p.redraw(false);
  });
  AN.syncing = false;
  if (!keepCursor) gotoIndex(s.apex);
}

// Cartão da curva: uma frase do que aconteceu, até 3 dicas e 4 números lado a lado.
function renderSegInfo() {
  const s = AN.segs[AN.seg];
  const el = $("#segInfo");
  if (!s) { el.innerHTML = ""; return; }
  const A = s.a || {}, B = s.b || {};
  const here = AN.evs.filter((e) => e.seg === AN.seg);
  const stat = (label, va, vb, good) => `<div class="stat2"><small>${label}</small><b class="num va">${va}</b>${AN.hasB ? `<b class="num vb">${vb}</b>` : ""}${good != null ? `<i class="${good ? "posg" : "neg"}">${good ? "melhor" : "pior"}</i>` : ""}</div>`;
  const m = (v) => v == null ? "—" : `${Math.round(v)} m`, kmh = (v) => v == null ? "—" : `${Math.round(v)}`;
  const better = (x, y, lowerIsBetter) => (x == null || y == null || !AN.hasB || Math.abs(x - y) < 1) ? null : lowerIsBetter ? x < y : x > y;
  el.innerHTML = `
    <div class="seghead"><h2>Curva ${s.n}</h2>${AN.hasB ? `<b class="num segdelta ${s.delta > 0 ? "neg" : "posg"}">${sgn(s.delta, 3, " s")}</b>` : ""}</div>
    ${AN.hasB ? `<p class="segsum ${s.delta > 0.03 ? "bad" : "ok"}">${esc(s.summary || "")}</p>` : `<p class="segsum">Escolha uma referência para ver o que mudar aqui.</p>`}
    ${here.map((e) => `<div class="segev ev-${e.type}">${(EV[e.type] || {}).icon || "•"} <b>${esc((EVENT_TXT[e.type] || [e.type])[0])}</b>: ${esc((EVENT_TXT[e.type] || ["", ""])[1])}</div>`).join("")}
    ${AN.hasB && (s.tips || []).length ? `<ul class="tips2">${s.tips.slice(0, 3).map((t) => `<li><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></li>`).join("")}</ul>` : ""}
    <div class="stats2">
      ${stat("Começa a frear", m(A.brake_m), m(B.brake_m), null)}
      ${stat("Vel. mínima", kmh(A.min_speed), kmh(B.min_speed), better(A.min_speed, B.min_speed, false))}
      ${stat("Acelera a fundo", m(A.throttle_m), m(B.throttle_m), better(A.throttle_m, B.throttle_m, true))}
      ${stat("Vel. na saída", kmh(A.exit_speed), kmh(B.exit_speed), better(A.exit_speed, B.exit_speed, false))}
    </div>
    ${AN.hasB ? `<div class="legend2"><span class="va">● você</span><span class="vb">● referência</span></div>` : ""}`;
  const tt = $("#segTitle");
  tt.innerHTML = `Curva ${s.n} de ${AN.segs.length}`;
}

function bindAnalysis() {
  $("#segPrev").onclick = () => selectSegment(AN.seg - 1);
  $("#segNext").onclick = () => selectSegment(AN.seg + 1);
  $("#focusBtn").onclick = () => {
    AN.focus = !AN.focus;
    $("#focusBtn").classList.toggle("on", AN.focus);
    $("#focusBtn").textContent = AN.focus ? "Só a curva" : "Volta inteira";
    if (AN.focus) selectSegment(AN.seg, { keepCursor: true });
    else { AN.syncing = true; plots.forEach((p) => p.setScale("x", { min: AN.r.distance[0], max: AN.r.distance[AN.n - 1] })); AN.syncing = false; }
  };
  $("#phaseBtn").onclick = () => {
    AN.phaseColors = !AN.phaseColors;
    $("#phaseBtn").classList.toggle("on", AN.phaseColors);
    $("#zLineA").innerHTML = phaseMapPaths(AN.r.a.x, AN.r.a.z, AN.runsA, css("--a"));
    plots.forEach((p) => p.redraw(false));
  };
  // liga/desliga gráficos
  view.querySelectorAll("[data-tr]").forEach((c) => c.onclick = () => {
    const k = c.dataset.tr;
    if (AN.show.has(k)) { if (AN.show.size > 1) AN.show.delete(k); } else AN.show.add(k);
    c.classList.toggle("on", AN.show.has(k));
    try { localStorage.setItem("pitwall.traces", JSON.stringify([...AN.show])); } catch (e) { /* ok */ }
    rebuildTraces();
  });
  // tamanho dos vídeos
  const root = $("#an2");
  view.querySelectorAll("[data-lay]").forEach((btn) => btn.onclick = () => {
    root.className = root.className.replace(/mode-\w+/, "mode-" + btn.dataset.lay);
    view.querySelectorAll("[data-lay]").forEach((x) => x.classList.toggle("on", x === btn));
    try { localStorage.setItem("pitwall.anLayout", btn.dataset.lay); } catch (e) { /* ok */ }
    applyMediaHeight();
    requestAnimationFrame(rebuildTraces);
  });
  view.querySelectorAll("[data-solo]").forEach((btn) => btn.onclick = () => {
    const v = $("#vids");
    v.classList.toggle("solo-a", btn.dataset.solo === "a"); v.classList.toggle("solo-b", btn.dataset.solo === "b");
    try { localStorage.setItem("pitwall.anSolo", btn.dataset.solo); } catch (e) { /* ok */ }
  });
  view.querySelectorAll("[data-fs]").forEach((btn) => btn.onclick = () => {
    const v = $(`#vid-${btn.dataset.fs}`); if (v && v.requestFullscreen) v.requestFullscreen();
  });
  // alça para redimensionar os vídeos
  const handle = $("#vresize"), vids = $("#vids");
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = vids.getBoundingClientRect().height;
    const mv = (ev) => { vids.style.height = Math.max(120, Math.min(window.innerHeight * 0.85, h0 + ev.clientY - y0)) + "px"; };
    const up = () => {
      handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up);
      const lay = root.className.match(/mode-(\w+)/)[1];
      try { localStorage.setItem("pitwall.vh." + lay, Math.round(vids.getBoundingClientRect().height)); } catch (err) { /* ok */ }
    };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up);
  });
  // barra de progresso: clicar, arrastar ou só passar o mouse (com o vídeo parado)
  const prog = $("#prog");
  let dragging = false;
  const scrub = (e) => {
    const rect = prog.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    gotoIndex(Math.round(f * (AN.n - 1)));
  };
  prog.addEventListener("pointerdown", (e) => {
    dragging = true;
    prog.setPointerCapture(e.pointerId);
    if (player && player.playing()) player.pause();
    scrub(e);
  });
  prog.addEventListener("pointermove", (e) => {
    const rect = prog.getBoundingClientRect();
    $("#prog .hover").style.left = ((e.clientX - rect.left) / rect.width * 100) + "%";
    if (dragging || !(player && player.playing())) scrub(e);
  });
  const end = (e) => { dragging = false; try { prog.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ } };
  prog.addEventListener("pointerup", end);
  prog.addEventListener("pointercancel", end);
}

function drawTraces(r, hasB) {
  const x = r.distance;
  const A = css("--a"), B = css("--b");
  const box = $("#traceBox");
  box.innerHTML = TRACES.filter((t) => (t.key !== "delta" || hasB) && AN.show.has(t.key)).map((t) => `
    <div class="trace"><div class="lbl"><span>${t.label}</span><span class="v" id="v-${t.key}"></span></div>
    <div id="p-${t.key}"></div></div>`).join("");
  const width = box.clientWidth - 4;
  const visible = TRACES.filter((t) => (t.key !== "delta" || hasB) && AN.show.has(t.key));
  // marcas verticais onde houve travada, rodada ou saída de pista
  const evMarks = (u) => {
    if (!AN || !AN.evs.length) return;
    const { top, height } = u.bbox, ctx = u.ctx;
    ctx.save();
    for (const e of AN.evs) {
      const px = u.valToPos(x[e.i], "x", true);
      if (px < u.bbox.left || px > u.bbox.left + u.bbox.width) continue;
      ctx.strokeStyle = e.type === "lock" ? "#ff9b5d" : e.type === "loss" ? "#ff5d5d" : "#ffd23f";
      ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + height); ctx.stroke();
    }
    ctx.restore();
  };
  let raf = 0, pending = null;
  const onCursor = (u) => {
    const i = u.cursor.idx;
    if (i == null) return;
    pending = i;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending != null) gotoIndex(pending, { fromPlot: true }); });
  };
  // faixa da "zona de foco" do segmento atual
  const focusBand = (u) => {
    if (!AN || !AN.segs.length) return;
    const s = AN.segs[AN.seg];
    const x0 = u.valToPos(x[s.start], "x", true), x1 = u.valToPos(x[s.end], "x", true);
    const { top, height } = u.bbox;
    u.ctx.save();
    u.ctx.fillStyle = "rgba(255,176,32,0.07)";
    u.ctx.fillRect(x0, top, x1 - x0, height);
    u.ctx.strokeStyle = "rgba(255,176,32,0.35)";
    u.ctx.setLineDash([4, 4]);
    u.ctx.beginPath(); u.ctx.moveTo(x0, top); u.ctx.lineTo(x0, top + height);
    u.ctx.moveTo(x1, top); u.ctx.lineTo(x1, top + height); u.ctx.stroke();
    u.ctx.restore();
  };
  for (const t of visible) {
    const el = $(`#p-${t.key}`);
    let data, series;
    if (t.key === "phase") {
      data = [x, x.map(() => null)];
      series = [{}, { stroke: "transparent" }];
    } else if (t.key === "delta") {
      data = [x, r.delta];
      series = [{}, { stroke: A, width: 1.8, fill: "rgba(255,176,32,.08)" }];
    } else {
      const pct = (arr) => arr.map((v) => v == null ? null : v * 100);
      data = [x, t.pct ? pct(r.a[t.key]) : r.a[t.key]];
      series = [{}, t.key === "speed" ? { stroke: phaseStroke(x, AN.runsA), width: 2.2 } : { stroke: A, width: 1.6 }];
      if (hasB) {
        data.push(t.pct ? pct(r.b[t.key]) : r.b[t.key]);
        series.splice(1, 0, { stroke: B, width: 1.6 });   // referência por baixo
        data = [x, data[2], data[1]];
      }
    }
    const opts = {
      width, height: t.h, legend: { show: false },
      scales: { x: { time: false }, y: t.pct ? { range: [-5, 105] } : t.key === "steer" ? { range: [-1.05, 1.05] }
        : t.gear ? { range: [1, 8] } : t.key === "phase" ? { range: [0, 2] } : {} },
      axes: [axis({ show: t === visible[visible.length - 1], values: (u, v) => v.map((m) => `${Math.round(m)} m`) }),
             axis({ size: 52, ...(t.gear ? { values: (u, v) => v.map(gearTxt), splits: () => [2, 4, 6, 8] }
               : t.key === "phase" ? { splits: () => (hasB ? [1.5, 0.5] : [1]), values: () => (hasB ? ["Você", "Ref."] : ["Você"]),
                   grid: { show: false }, ticks: { show: false } } : {}) })],
      series,
      cursor: { sync: { key: "cmp" }, drag: { x: true, y: false }, y: false },
      hooks: {
        drawClear: [focusBand],
        draw: t.key === "phase" ? [(u) => drawPhaseBands(u, x, hasB), evMarks] : [evMarks],
        setCursor: [onCursor],
        setScale: [(u, key) => {
          if (key !== "x" || (AN && AN.syncing)) return;
          AN.syncing = true;
          plots.forEach((p) => p !== u && p.setScale("x", { min: u.scales.x.min, max: u.scales.x.max }));
          AN.syncing = false;
        }],
      },
    };
    if (t.key === "delta") opts.scales.y = { range: (u, mn, mx) => { const m = Math.max(Math.abs(mn), Math.abs(mx), 0.2); return [-m, m]; } };
    plots.push(new uPlot(opts, data, el));
  }
}

function drawPhaseBands(u, x, hasB) {
  const ctx = u.ctx, { left, width } = u.bbox;
  const rows = hasB ? [[AN.runsA, 2, 1.06], [AN.runsB, 0.94, 0]] : [[AN.runsA, 1.9, 0.1]];
  ctx.save();
  ctx.beginPath(); ctx.rect(left, u.bbox.top, width, u.bbox.height); ctx.clip();
  for (const [runs, yTop, yBot] of rows) {
    const y0 = u.valToPos(yTop, "y", true), y1 = u.valToPos(yBot, "y", true);
    for (const [a, b, p] of runs) {
      const x0 = u.valToPos(x[a], "x", true), x1 = u.valToPos(x[Math.min(b + 1, x.length - 1)], "x", true);
      if (x1 < left || x0 > left + width) continue;
      ctx.fillStyle = PHASE_COLORS[p];
      ctx.globalAlpha = p === 1 ? 0.95 : 0.85;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- mapas
function brakePoints(src, n) {
  const out = [];
  for (let i = 1; i < n; i++) {
    if (src.brake[i] != null && src.brake[i - 1] != null && src.brake[i] >= 0.1 && src.brake[i - 1] < 0.1 && src.x[i] != null)
      out.push([src.x[i], src.z[i]]);
  }
  return out;
}
function svgPath(X, Z, from = 0, to = X.length - 1) {
  let d = "", pen = false;
  for (let i = from; i <= to; i++) {
    if (X[i] == null || Z[i] == null) { pen = false; continue; }
    d += (pen ? "L" : "M") + X[i].toFixed(2) + " " + Z[i].toFixed(2);
    pen = true;
  }
  return d;
}

// sua linha no mapa: uma cor por fase de pedal (ou laranja se as cores estiverem desligadas)
function phaseMapPaths(ax, az, runs, plain) {
  if (!AN.phaseColors) return `<path d="${svgPath(ax, az)}" fill="none" stroke="${plain}" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  const by = [[], [], []];
  for (const [a, b, p] of runs) by[p].push(svgPath(ax, az, Math.max(0, a - 1), b));   // emenda com o trecho anterior
  return by.map((ds, p) => `<path d="${ds.join(" ")}" fill="none" stroke="${PHASE_COLORS[p]}" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
}

// Mapa com zoom no carro (opcionalmente girando com ele)
function drawZoomMap(r, hasB) {
  const el = $("#zmap");
  const ax = r.a.x, az = r.a.z, bx = hasB ? r.b.x : null, bz = hasB ? r.b.z : null;
  const n = ax.length;
  const ok = (i) => ax[i] != null && az[i] != null;
  if (!ax.some((v) => v != null)) { el.innerHTML = `<div class="sub" style="padding:16px">Sem coordenadas.</div>`; return { move() {} }; }
  const A = css("--a"), B = css("--b");
  const W = 440, H = 300;
  const brA = brakePoints(r.a, n), brB = hasB ? brakePoints(r.b, n) : [];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="zSvg">
    <g id="zWorld">
      <path d="${svgPath(ax, az)}" fill="none" stroke="#1d2129" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${svgPath(ax, az)}" fill="none" stroke="#2a3039" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
      ${hasB ? `<path d="${svgPath(bx, bz)}" fill="none" stroke="${B}" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : ""}
      <g id="zLineA">${phaseMapPaths(ax, az, AN.runsA, A)}</g>
      ${brA.map(([x, z]) => `<circle cx="${x}" cy="${z}" class="bk" stroke="${A}"/>`).join("")}
      ${brB.map(([x, z]) => `<circle cx="${x}" cy="${z}" class="bk" stroke="${B}"/>`).join("")}
      ${hasB ? `<circle id="zB" fill="${B}" stroke="#0b0d10" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ""}
      <circle id="zA" fill="${A}" stroke="#0b0d10" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </g>
  </svg>`;
  const world = $("#zWorld");
  let radius = 120, rotate = true, rot = 0, lastI = 0;
  const heading = (i) => {
    let i0 = Math.max(0, i - 10), i1 = Math.min(n - 1, i + 10);
    while (i0 < i && !ok(i0)) i0++;
    while (i1 > i && !ok(i1)) i1--;
    if (!ok(i0) || !ok(i1) || i0 === i1) return null;
    return Math.atan2(az[i1] - az[i0], ax[i1] - ax[i0]) * 180 / Math.PI;
  };
  const move = (i) => {
    lastI = i;
    const pa = ok(i) ? [ax[i], az[i]] : null;
    const pb = hasB && bx[i] != null && bz[i] != null ? [bx[i], bz[i]] : null;
    const c = pa || pb;
    if (!c) return;
    const s = W / (radius * 2);
    if (rotate) {
      const h = heading(i);
      if (h != null) {
        let target = -90 - h;
        // gira pelo caminho mais curto e suaviza
        while (target - rot > 180) target -= 360;
        while (target - rot < -180) target += 360;
        rot = rot + (target - rot) * 0.35;
      }
    } else rot = 0;
    world.setAttribute("transform", `translate(${W / 2} ${H / 2}) rotate(${rot.toFixed(2)}) scale(${s}) translate(${-c[0]} ${-c[1]})`);
    el.querySelectorAll(".bk").forEach((cc) => cc.setAttribute("r", 4.5 / s));
    const za = $("#zA"), zb = $("#zB");
    za.setAttribute("r", 7 / s); za.style.display = pa ? "" : "none";
    if (pa) { za.setAttribute("cx", pa[0]); za.setAttribute("cy", pa[1]); }
    if (zb) { zb.setAttribute("r", 7 / s); zb.style.display = pb ? "" : "none"; if (pb) { zb.setAttribute("cx", pb[0]); zb.setAttribute("cy", pb[1]); } }
    $("#zinfo").textContent = `Traçado · ${Math.round(radius * 2)} m de largura`;
  };
  $("#zin").onclick = () => { radius = Math.max(20, radius / 1.5); move(lastI); };
  $("#zout").onclick = () => { radius = Math.min(1500, radius * 1.5); move(lastI); };
  $("#zrot").onclick = () => { rotate = !rotate; $("#zrot").classList.toggle("on", rotate); rot = rotate ? rot : 0; move(lastI); };
  return { move };
}

// Mapa da pista inteira com os segmentos numerados
function drawFullMap(r, hasB, segs) {
  const el = $("#fmap");
  const ax = r.a.x, az = r.a.z;
  const n = ax.length;
  const pts = [];
  for (let i = 0; i < n; i++) if (ax[i] != null && az[i] != null) pts.push(i);
  if (pts.length < 2) { el.innerHTML = `<div class="sub" style="padding:16px">Sem coordenadas.</div>`; return { move() {}, highlight() {} }; }
  const xs = pts.map((i) => ax[i]), zs = pts.map((i) => az[i]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ);
  const pad = span * 0.09;
  const vb = [minX - pad, minZ - pad, maxX - minX + pad * 2, maxZ - minZ + pad * 2];
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const k = span / 300;             // unidades do mundo por "pixel" de referência
  const A = css("--a"), B = css("--b");
  // rótulo de cada segmento: perto do ápice, empurrado para fora da pista
  const labels = segs.map((s, idx) => {
    const i = s.apex;
    if (ax[i] == null) return "";
    const i0 = Math.max(0, i - 5), i1 = Math.min(n - 1, i + 5);
    let nx = -(az[i1] - az[i0]), nz = ax[i1] - ax[i0];
    const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
    if ((ax[i] - cx) * nx + (az[i] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const lx = ax[i] + nx * 22 * k, lz = az[i] + nz * 22 * k;
    return `<g class="seglbl" data-seg="${idx}"><circle cx="${lx}" cy="${lz}" r="${9 * k}"/>
      <text x="${lx}" y="${lz}" font-size="${10 * k}" dy="${3.5 * k}">${s.n}</text></g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="${vb.join(" ")}" id="fSvg">
    <path d="${svgPath(ax, az)}" fill="none" stroke="#2a3039" stroke-width="${8 * k}" stroke-linecap="round" stroke-linejoin="round"/>
    <path id="fSeg" d="" fill="none" stroke="${A}" stroke-opacity=".9" stroke-width="${8 * k}" stroke-linecap="round" stroke-linejoin="round"/>
    ${segs.map((s) => ax[s.start] != null ? `<circle cx="${ax[s.start]}" cy="${az[s.start]}" r="${2.2 * k}" fill="#8a93a3"/>` : "").join("")}
    ${labels}
    ${hasB ? `<circle id="fB" r="${5 * k}" fill="${B}" stroke="#0b0d10" stroke-width="${2 * k}"/>` : ""}
    <circle id="fA" r="${5.5 * k}" fill="#fff" stroke="${A}" stroke-width="${2.5 * k}"/>
  </svg>`;
  const svg = $("#fSvg");
  svg.querySelectorAll(".seglbl").forEach((g) => g.onclick = (e) => { e.stopPropagation(); selectSegment(+g.dataset.seg); });
  // passar o mouse no mapa move o cursor
  svg.addEventListener("mousemove", (e) => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const w = p.matrixTransform(svg.getScreenCTM().inverse());
    let best = -1, bd = Infinity;
    for (const i of pts) { const d = (ax[i] - w.x) ** 2 + (az[i] - w.y) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0 && bd < (30 * k) ** 2) gotoIndex(best);
  });
  return {
    move(i) {
      const fa = $("#fA"), fb = $("#fB");
      if (ax[i] != null) { fa.setAttribute("cx", ax[i]); fa.setAttribute("cy", az[i]); }
      if (fb && r.b.x[i] != null) { fb.setAttribute("cx", r.b.x[i]); fb.setAttribute("cy", r.b.z[i]); }
    },
    highlight(kk) {
      const s = segs[kk];
      $("#fSeg").setAttribute("d", s ? svgPath(ax, az, s.start, s.end) : "");
      svg.querySelectorAll(".seglbl").forEach((g) => g.classList.toggle("on", +g.dataset.seg === kk));
    },
  };
}

// ---------------------------------------------------------------- vídeo
function makePlayer(r, LA, LB) {
  const va = $("#vid-a"), vb = $("#vid-b");
  const startA = { v: LA.video ? LA.video.start : 0 };
  const startB = { v: LB && LB.video ? LB.video.start : 0 };
  let playing = false, raf = 0, rate = 1, pendingSeek = null, lastIdx = 0;
  const n = r.distance.length;
  const tA = r.a.t, tB = LB ? r.b.t : null;
  const idxFor = (arr, ms) => {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const v = arr[mid];
      if (v == null ? mid < n / 2 : v < ms) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const target = (vid, start, arr, i) => (vid && arr && arr[i] != null ? start + arr[i] / 1000 : null);
  const seekNow = () => {
    raf = 0;
    if (pendingSeek == null) return;
    const i = pendingSeek; pendingSeek = null;
    const ta = target(va, startA.v, tA, i), tb = target(vb, startB.v, tB, i);
    if (ta != null && Math.abs(va.currentTime - ta) > 0.03) va.currentTime = Math.max(0, ta);
    if (tb != null && Math.abs(vb.currentTime - tb) > 0.03) vb.currentTime = Math.max(0, tb);
  };
  const seek = (i) => {
    lastIdx = i;
    if (playing) return;
    pendingSeek = i;
    if (!raf) raf = requestAnimationFrame(seekNow);
  };
  const tick = () => {
    if (!playing) return;
    const master = va || vb, isA = master === va;
    const ms = (master.currentTime - (isA ? startA.v : startB.v)) * 1000;
    const i = idxFor(isA ? tA : tB, ms);
    if (i >= n - 1) { stop(); return; }
    lastIdx = i;
    gotoIndex(i);
    if (isA && vb) {   // a referência acompanha pelo mesmo ponto da pista
      const tb = target(vb, startB.v, tB, i);
      if (tb != null && Math.abs(vb.currentTime - tb) > 0.25) vb.currentTime = tb;
      if (vb.paused) vb.play().catch(() => {});
    }
    requestAnimationFrame(tick);
  };
  const playBtn = $("#play");
  const stop = () => {
    playing = false;
    [va, vb].forEach((v) => v && v.pause());
    if (playBtn) playBtn.textContent = "▶";
  };
  const play = () => {
    if (!(va || vb)) return;
    const ta = target(va, startA.v, tA, lastIdx), tb = target(vb, startB.v, tB, lastIdx);
    if (va && ta != null) va.currentTime = ta;
    if (vb && tb != null) vb.currentTime = tb;
    playing = true;
    [va, vb].forEach((v) => { if (v) { v.playbackRate = rate; v.play().catch(() => {}); } });
    if (playBtn) playBtn.textContent = "❚❚";
    requestAnimationFrame(tick);
  };
  if (playBtn) playBtn.onclick = () => (playing ? stop() : play());
  view.querySelectorAll("[data-rate]").forEach((btn) => btn.onclick = () => {
    rate = +btn.dataset.rate;
    view.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", b === btn));
    [va, vb].forEach((v) => v && (v.playbackRate = rate));
  });
  view.querySelectorAll("[data-off]").forEach((btn) => btn.onclick = async () => {
    const tag = btn.dataset.off, d = parseFloat(btn.dataset.d);
    const L = tag === "a" ? LA : LB, st = tag === "a" ? startA : startB;
    L.video.offset = Math.round(((L.video.offset || 0) + d) * 10) / 10;
    st.v += d;
    $(`#off-${tag}`).textContent = fmtOffset(L.video.offset);
    if (LB && LB.video && LA.session_id === LB.session_id) {   // mesma sessão: mesmo ajuste
      const o = tag === "a" ? LB : LA, os = tag === "a" ? startB : startA;
      o.video.offset = L.video.offset; os.v += d;
      const other = $(`#off-${tag === "a" ? "b" : "a"}`); if (other) other.textContent = fmtOffset(L.video.offset);
    }
    await api(`/api/sessions/${L.session_id}/video_offset`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: L.video.offset }) });
    seek(lastIdx);
  });
  const onKey = (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.code === "Space" && (va || vb)) { e.preventDefault(); playing ? stop() : play(); }
    if (e.code === "ArrowRight" && AN) { e.preventDefault(); selectSegment(AN.seg + 1); }
    if (e.code === "ArrowLeft" && AN) { e.preventDefault(); selectSegment(AN.seg - 1); }
  };
  document.addEventListener("keydown", onKey);
  [va, vb].forEach((v) => v && v.addEventListener("loadedmetadata", () => seek(lastIdx), { once: true }));
  return { seek, playing: () => playing, pause: stop, destroy() { stop(); document.removeEventListener("keydown", onKey); } };
}

async function renderComparePicker(mode = "compare") {
  const sessions = await api("/api/sessions");
  if (!sessions.length) { view.innerHTML = `<div class="panel empty"><b>Nada para analisar ainda</b>Grave algumas voltas primeiro.</div>`; return; }
  const tracks = [...new Set(sessions.map((s) => s.track))];
  view.innerHTML = `<div class="head"><div><h1>${mode === "replay" ? "Replay" : "Telemetria"}</h1><div class="sub">Escolha uma pista</div></div></div>
    <div class="grid">${tracks.map((t) => `<div class="card" data-track="${esc(t)}" style="cursor:pointer">
      <div class="t">${esc(pretty(t))}</div><div class="c">Sua volta mais recente contra o seu recorde</div></div>`).join("")}</div>`;
  view.querySelectorAll("[data-track]").forEach((c) => c.onclick = async () => {
    const laps = await api(`/api/tracks/${encodeURIComponent(c.dataset.track)}/laps`);
    const own = laps.filter((l) => !l.kind || l.kind === "own");
    const clean = own.filter((l) => l.valid && !l.out_lap && !l.in_lap);
    const list = clean.length ? clean : own;
    // referência = seu recorde; sua volta = a mais recente (que não seja o recorde)
    const ref = list[0];
    const recent = [...list].filter((l) => l.id !== ref.id && l.car === ref.car)
      .sort((x, y) => (y.started_at.localeCompare(x.started_at)) || (y.lap_number - x.lap_number))[0];
    location.hash = recent ? `#/${mode}?a=${recent.id}&b=${ref.id}` : `#/${mode}?a=${ref.id}`;
  });
}

// ---------------------------------------------------------------- engenheiro de setup (na sessão)
async function engineerPanel(s) {
  const el = $("#engineer");
  let lib = { cars: [] };
  try { lib = await api("/api/setups"); } catch (e) { /* sem biblioteca */ }
  const car = lib.cars.find((c) => c.car === s.car);
  const track = car && car.tracks.find((t) => t.track.toLowerCase() === String(s.track).toLowerCase());
  const options = track ? track.files : [];
  const others = car ? car.tracks.filter((t) => t !== track).flatMap((t) => t.files.map((f) => ({ ...f, other: t.track }))) : [];
  const preset = s.setup_id || s.suggested_setup_id || (s.suggestions && s.suggestions[0] && s.suggestions[0].id) || null;
  const opt = (f) => `<option value="${f.id}" ${preset === f.id ? "selected" : ""}>${esc(f.name)}${f.id === s.suggested_setup_id || (!s.setup_id && f.id === preset) ? " (sugerido)" : ""}${f.other ? ` (${esc(pretty(f.other))})` : ""}</option>`;
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Engenheiro de setup</h2><span class="spacer"></span>
      <a class="btn sm" href="#/setups">Biblioteca de setups</a></div>
    <div class="engform">
      <label>Setup usado nesta sessão
        <select id="eSetup"><option value="">— não sei / sem setup —</option>
          ${options.length ? `<optgroup label="${esc(pretty(s.track))}">${options.map(opt).join("")}</optgroup>` : ""}
          ${others.length ? `<optgroup label="Outras pistas">${others.map(opt).join("")}</optgroup>` : ""}
        </select></label>
      <label>Pressão alvo a quente (psi) <input id="eTarget" type="number" step="0.1" value="26.5"></label>
      <button class="btn primary" id="eRun">Analisar meu carro</button>
    </div>
    <div id="eOut"></div>`;
  $("#eSetup").onchange = async () => {
    await api(`/api/sessions/${s.id}/setup`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_id: $("#eSetup").value ? +$("#eSetup").value : null }) });
    run();
  };
  $("#eRun").onclick = () => run();
  const run = async () => {
    const sid = $("#eSetup").value, target = parseFloat($("#eTarget").value) || 26.5;
    $("#eOut").innerHTML = `<div class="sub">Analisando…</div>`;
    const r = await api(`/api/sessions/${s.id}/engineer?target=${target}${sid ? "&setup_id=" + sid : ""}`);
    renderEngineer(r, sid ? +sid : null, sid ? $("#eSetup").selectedOptions[0].textContent.trim() : null);
  };
  run();
}

function renderEngineer(r, setupId, setupName) {
  const out = $("#eOut");
  const sevCls = { alta: "bad", média: "warn", info: "info" };
  const stateCls = { subesterço: "us", sobresterço: "os", neutro: "ok" };
  const fmtV = (c, v, disp) => (v == null ? "—" : c.unit === "psi" ? `${disp} psi` : v);
  out.innerHTML = `
    ${r.error ? `<div class="note warn">${esc(r.error)}</div>` : ""}
    <div class="eng">
      <div>
        <h3>O que o carro está fazendo</h3>
        <div class="findings">${r.findings.map((f) => `<div class="finding ${sevCls[f.severity] || "info"}">
          <b>${esc(f.title)}</b><span>${esc(f.detail)}</span></div>`).join("")}</div>
        ${r.balance.length ? `<h3>Equilíbrio por fase da curva</h3>
        <table class="baltab"><thead><tr><th>Fase</th><th>Comportamento</th><th>Frente ÷ traseira</th><th>Curvas</th></tr></thead><tbody>
          ${r.balance.map((b) => `<tr><td>${esc(b.label)}</td><td><span class="pill ${stateCls[b.state]}">${b.state}</span></td>
            <td class="num">${b.ratio.toFixed(2)}</td><td class="num">${b.n}</td></tr>`).join("")}</tbody></table>
        <div class="note">Frente ÷ traseira = quanto os pneus dianteiros escorregam em relação aos traseiros. Acima de ~1,12 a frente
          escorrega mais (subesterço); abaixo de ~0,90 é a traseira (sobresterço). Voltas analisadas: ${r.laps_used.join(", ")}.</div>` : ""}
      </div>
      <div>
        <h3>Ajustes sugeridos</h3>
        ${r.changes.length ? `
        <table class="chgtab"><thead><tr><th></th><th>Parâmetro</th><th>Atual</th><th>Sugerido</th><th>Por quê</th></tr></thead><tbody>
          ${r.changes.map((c, i) => `<tr>
            <td><input type="checkbox" data-chg="${i}" ${c.unit === "psi" || i < 3 ? "checked" : ""}></td>
            <td>${esc(c.label)}</td>
            <td class="num">${fmtV(c, c.from, c.from_disp)}</td>
            <td class="num"><b>${c.from == null ? (c.delta > 0 ? "+" : "") + c.delta + " clique(s)" : fmtV(c, c.to, c.to_disp)}</b></td>
            <td class="why">${c.reasons.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table>
        ${setupId ? `
        <div class="gen"><input id="eName" value="${esc("Pitwall - " + (setupName || "setup"))}">
          <button class="btn primary" id="eGen">Criar setup novo no ACC</button></div>
        <div id="eGenOut"></div>` :
        `<div class="note">Escolha o setup que você usou para ver os valores atuais e criar um setup novo já ajustado.</div>`}
        <div class="note">Mude poucas coisas por vez e grave mais voltas para confirmar. Sem os dados reais de cada carro, os ajustes
          são em cliques: confira no menu do jogo se o valor faz sentido. Erros de pilotagem também aparecem como comportamento do carro.</div>`
        : `<div class="sub">Nenhum ajuste necessário.</div>`}
        ${r.pressures.length ? `<h3>Pneus e freios</h3>
        <table class="baltab"><thead><tr><th></th>${r.pressures.map((p) => `<th>${p.wheel}</th>`).join("")}</tr></thead><tbody>
          <tr><td>Pressão a quente</td>${r.pressures.map((p) => `<td class="num ${Math.abs(p.delta_psi) >= 0.2 ? "neg" : "posg"}">${p.hot.toFixed(1)}</td>`).join("")}</tr>
          ${r.temps.tyre ? `<tr><td>Temp. do pneu (°C)</td>${r.temps.tyre.map((t) => `<td class="num">${Math.round(t)}</td>`).join("")}</tr>` : ""}
          ${r.temps.brake ? `<tr><td>Temp. do freio (°C)</td>${r.temps.brake.map((t) => `<td class="num">${Math.round(t)}</td>`).join("")}</tr>` : ""}
        </tbody></table>` : ""}
      </div>
    </div>`;
  const gen = $("#eGen");
  if (gen) gen.onclick = async () => {
    const chosen = [...out.querySelectorAll("[data-chg]")].filter((c) => c.checked).map((c) => r.changes[+c.dataset.chg]);
    if (!chosen.length) { $("#eGenOut").innerHTML = `<div class="note warn">Marque pelo menos um ajuste.</div>`; return; }
    gen.disabled = true;
    try {
      const res = await api("/api/setups/generate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_id: setupId, name: $("#eName").value, changes: chosen.map((c) => ({ path: c.path, delta: c.delta })) }) });
      $("#eGenOut").innerHTML = res.already
        ? `<div class="note okk">Esse setup já existe: <b>${esc(res.name)}</b> (nada novo foi criado).</div>`
        : `<div class="note okk">Pronto! <b>${esc(res.name)}</b> foi salvo no ACC (Setups → carro → pista) e na sua biblioteca.</div>`;
    } catch (e) {
      $("#eGenOut").innerHTML = `<div class="note warn">Não deu para salvar: ${esc(e.message)}</div>`;
    } finally { gen.disabled = false; }
  };
}

// ---------------------------------------------------------------- biblioteca de setups
const setupsState = { car: "", track: "", kind: "", source: "", q: "", sel: [], open: null, diffOnly: true };
async function renderSetups() {
  current = { name: "setups" };
  const lib = await api("/api/setups");
  const all = lib.cars.flatMap((c) => c.tracks.flatMap((t) => t.files));
  const st = setupsState;
  const cars = lib.cars.map((c) => c.car);
  if (st.car && !cars.includes(st.car)) st.car = "";
  const tracks = [...new Set(all.filter((f) => !st.car || f.car === st.car).map((f) => f.track))].sort();
  if (st.track && !tracks.includes(st.track)) st.track = "";
  const q = st.q.toLowerCase();
  const list = all.filter((f) => (!st.car || f.car === st.car) && (!st.track || f.track === st.track)
    && (!st.kind || f.kind === st.kind) && (!st.source || f.source === st.source) && (!q || f.name.toLowerCase().includes(q)));
  const sel = (id, opts, val, all_) => `<select id="${id}"><option value="">${all_}</option>${opts.map(([k, t]) => `<option value="${esc(k)}" ${k === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  view.innerHTML = `
    <div class="head"><div><h1>Setups</h1>
      <div class="sub">${all.length} setups no seu banco · pasta do ACC: <code>${esc(lib.root)}</code>${lib.exists ? "" : " (não encontrada)"}</div></div>
      <span class="spacer"></span><button class="btn" id="sImport">Importar da pasta do ACC</button></div>
    <div id="sImportOut"></div>
    <div class="filters">
      ${sel("fCar", cars.map((c) => [c, pretty(c)]), st.car, "Todos os carros")}
      ${sel("fTrack", tracks.map((t) => [t, pretty(t)]), st.track, "Todas as pistas")}
      ${sel("fKind", [["Q", "Classificação (Q)"], ["R", "Corrida (R)"]], st.kind, "Q e R")}
      ${sel("fSrc", [["GO Setups", "GO Setups"], ["Meu", "Meus"], ["Pitwall", "Gerados pelo Pitwall"]], st.source, "Todas as origens")}
      <input id="fQ" placeholder="Buscar pelo nome…" value="${esc(st.q)}">
      <span class="spacer"></span>
      <button class="btn primary" id="sCmp" ${st.sel.length === 2 ? "" : "disabled"}>Comparar 2 selecionados</button>
    </div>
    <div class="slib">
      <div class="panel pad0 slist">
        ${list.length ? `<table><thead><tr><th></th><th>Nome</th><th>Carro / pista</th><th>Origem</th><th>Tipo</th><th>Temp.</th><th>No ACC</th></tr></thead><tbody>
          ${list.slice(0, 400).map((f) => `<tr class="srow ${st.open === f.id ? "sel" : ""}" data-id="${f.id}">
            <td><input type="checkbox" data-pick="${f.id}" ${st.sel.includes(f.id) ? "checked" : ""}></td>
            <td>${esc(f.name)}</td>
            <td class="sub">${esc(pretty(f.car))} · ${esc(pretty(f.track))}</td>
            <td><span class="tag ${f.source === "GO Setups" ? "go" : f.source === "Pitwall" ? "pw" : ""}">${esc(f.source || "—")}</span></td>
            <td>${f.kind || "—"}${f.variant ? ` <span class="sub">${esc(f.variant)}</span>` : ""}</td>
            <td class="num">${f.temp_c != null ? f.temp_c + "°C" : "—"}</td>
            <td>${f.in_acc ? `<span class="status ok">sim</span>` : `<button class="btn sm" data-install="${f.id}">Instalar</button>`}</td>
          </tr>`).join("")}</tbody></table>
          ${list.length > 400 ? `<div class="note" style="padding:0 14px 12px">Mostrando 400 de ${list.length}. Use os filtros.</div>` : ""}`
        : `<div class="empty"><b>Nenhum setup encontrado</b>${all.length ? "Mude os filtros." : "Clique em “Importar da pasta do ACC”."}</div>`}
      </div>
      <div class="panel sdetail" id="sDetail"><div class="sub">Clique num setup para ver os detalhes, ou marque dois para comparar.</div></div>
    </div>`;
  const reRender = () => renderSetups();
  $("#fCar").onchange = (e) => { st.car = e.target.value; st.track = ""; reRender(); };
  $("#fTrack").onchange = (e) => { st.track = e.target.value; reRender(); };
  $("#fKind").onchange = (e) => { st.kind = e.target.value; reRender(); };
  $("#fSrc").onchange = (e) => { st.source = e.target.value; reRender(); };
  let tq;
  $("#fQ").oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { st.q = e.target.value; reRender().then(() => { const i = $("#fQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  $("#sImport").onclick = async () => {
    $("#sImport").disabled = true;
    const r = await api("/api/setups/import", { method: "POST" });
    await reRender();
    $("#sImportOut").innerHTML = `<div class="note okk">${r.exists ? `${r.found} arquivos lidos, ${r.new} novos no banco.` : "Pasta do ACC não encontrada."}</div>`;
  };
  view.querySelectorAll("[data-pick]").forEach((cb) => cb.onclick = (e) => {
    e.stopPropagation();
    const id = +cb.dataset.pick;
    st.sel = st.sel.filter((x) => x !== id);
    if (cb.checked) st.sel.push(id);
    st.sel = st.sel.slice(-2);
    view.querySelectorAll("[data-pick]").forEach((o) => (o.checked = st.sel.includes(+o.dataset.pick)));
    $("#sCmp").disabled = st.sel.length !== 2;
  });
  view.querySelectorAll("[data-install]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    await api(`/api/setups/${b.dataset.install}/install`, { method: "POST" });
    reRender();
  });
  view.querySelectorAll(".srow").forEach((tr) => tr.onclick = () => { st.open = +tr.dataset.id; showSetup(st.open); });
  $("#sCmp").onclick = () => showDiff(st.sel[0], st.sel[1]);
  if (st.open) showSetup(st.open);
}

async function showSetup(id) {
  view.querySelectorAll(".srow").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.id === id));
  const s = await api(`/api/setups/${id}`);
  const groups = [...new Set(s.rows.map((r) => r.group))];
  $("#sDetail").innerHTML = `
    <h2 style="margin-bottom:2px">${esc(s.name)}</h2>
    <div class="sub" style="margin-bottom:10px">${esc(pretty(s.car))} · ${esc(pretty(s.track))} · ${esc(s.source || "")}${s.version ? " " + esc(s.version) : ""}</div>
    ${groups.map((g) => `<h3>${esc(g)}</h3><table class="stab"><tbody>
      ${s.rows.filter((r) => r.group === g).map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${
        r.values.map((v, i) => `${r.names[i] ? `<span class="sub">${r.names[i]}</span> ` : ""}${v}`).join(" · ")}${r.unit ? " " + r.unit : ""}</td></tr>`).join("")}
    </tbody></table>`).join("")}`;
}

async function showDiff(a, b) {
  const d = await api(`/api/setups/diff?a=${a}&b=${b}`);
  const st = setupsState;
  const draw = () => {
    const rows = d.rows.filter((r) => !st.diffOnly || !r.same);
    const fmt = (vals, r) => vals == null ? "—" : vals.map((v, i) => `${r.names[i] ? `<span class="sub">${r.names[i]}</span> ` : ""}${v}`).join(" · ") + (r.unit ? " " + r.unit : "");
    $("#sDetail").innerHTML = `
      <div class="row"><h2 style="margin:0">Comparação</h2><span class="spacer"></span>
        <label class="sub"><input type="checkbox" id="dOnly" ${st.diffOnly ? "checked" : ""}> só diferenças</label></div>
      <div class="sub" style="margin:4px 0 10px"><b class="va">A</b> ${esc(d.a)}<br><b class="vb">B</b> ${esc(d.b)}</div>
      ${rows.length ? `<table class="stab diff"><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.same ? "" : "chg"}"><td>${esc(r.label)}</td><td class="num">${fmt(r.a, r)}</td><td class="num">${fmt(r.b, r)}</td></tr>`).join("")}
      </tbody></table>` : `<div class="sub">Os dois setups são iguais.</div>`}`;
    $("#dOnly").onchange = (e) => { st.diffOnly = e.target.checked; draw(); };
  };
  draw();
}

// ---------------------------------------------------------------- replay (estilo engenheiro de corrida)
// Os dois carros andando na pista vista de cima. Modo "Tempo": cada carro está
// onde estava naquele instante da volta (dá pra ver quem está na frente e por
// quantos metros). Modo "Distância": os dois no mesmo ponto da pista (compara
// como cada um passou ali).
let RP = null;

async function renderReplay(params) {
  current = { name: "replay" };
  view.classList.add("wide", "bleed");
  if (RP) RP.destroy();
  RP = null;
  let a = +params.get("a") || null, b = +params.get("b") || null;
  if (!a) {
    const car = params.get("car") || CTX.car, track = params.get("track") || CTX.track;
    if (track) {
      const p = await defaultPair(car, track);
      if (p) { location.replace(`#/replay?a=${p.a}${p.b ? "&b=" + p.b : ""}`); return; }
    }
    return renderComparePicker("replay");
  }
  view.innerHTML = `<div class="sub" style="padding:24px">Carregando replay…</div>`;
  const r = await api(`/api/compare?a=${a}${b ? "&b=" + b : ""}`);
  const options = await api(`/api/tracks/${encodeURIComponent(r.lap_a.track)}/laps`);
  const LA = r.lap_a, LB = r.lap_b, hasB = !!LB;
  if (LA.kind !== "ideal" && LA.kind !== "team") setCtx(LA.car, LA.track);
  const lapName = (L) => !L ? "" : L.kind === "ideal" ? "Volta ideal" : L.kind === "team" ? (L.player || "Equipe") : `Volta ${L.lap_number}`;
  const card = (L, tag, who) => `
    <button class="dcard ${tag}" id="rpPick${tag.toUpperCase()}" title="Clique para trocar">
      <div class="row"><span class="who">${who}</span><span class="sub">${esc(lapName(L))}</span><span class="spacer"></span>
        <b class="num">${L ? fmtLap(L.lap_time_ms) : ""}</b><span class="swap">trocar ▾</span></div>
      ${L ? `<div class="gauges">
        <div class="pedal"><span>Acel.</span><div class="bar"><i id="g-${tag}-gas"></i></div><b class="num" id="t-${tag}-gas">0%</b></div>
        <div class="pedal brk"><span>Freio</span><div class="bar"><i id="g-${tag}-brake"></i></div><b class="num" id="t-${tag}-brake">0%</b></div>
        <div class="nums"><b class="num big" id="t-${tag}-speed">0</b><span class="sub">km/h</span>
          <b class="num" id="t-${tag}-gear">N</b><span class="sub">marcha</span>
          <b class="num" id="t-${tag}-rpm">0</b><span class="sub">rpm</span></div>
      </div>` : `<div class="sub" style="margin-top:6px">Clique para escolher uma volta de referência</div>`}
    </button>`;
  const rvid = (L, tag, label) => `<div class="vid2 ${tag}">${L && L.video
    ? `<video id="rvid-${tag}" src="${L.video.url}" preload="auto" muted playsinline></video>
       <div class="vbar"><span class="vtag2">${label}</span><span class="spacer"></span><button class="btn xs" data-rfs="${tag}" title="Tela cheia">⛶</button></div>`
    : `<div class="novid2"><span class="vtag2">${label}</span><span>${L ? "Sem vídeo desta volta" : "Sem referência"}</span></div>`}</div>`;
  const hasVid = !!(LA.video || (LB && LB.video));
  const showVids = hasVid && localStorage.getItem("pitwall.rpVids") !== "0";
  view.innerHTML = `
    <div class="rp2">
      <div class="rp-stage">
        <canvas id="rpCanvas"></canvas>
        <div class="rp-tl">
          <div class="rp-title"><h1>${esc(pretty(LA.track))}</h1>
            <div class="sub">${esc(pretty(LA.car))} · ${fmtDate(LA.started_at)}${LA.air_temp ? ` · ar ${Math.round(LA.air_temp)}°C · pista ${Math.round(LA.road_temp)}°C` : ""}</div>
            <div class="seg-switch"><a class="btn sm" href="#/compare?a=${a}${b ? "&b=" + b : ""}">Análise</a><span class="btn sm on">Replay</span></div>
          </div>
        </div>
        <div class="rp-tr">
          ${card(LA, "a", "Sua volta")}${card(LB, "b", "Referência")}
          <div class="panel rp-mini"><div id="rpMini"></div>
            <div class="row"><b id="rpSegName">—</b><span class="spacer"></span><b class="num" id="rpSegDelta"></b></div></div>
        </div>
        <div class="rp-bl panel">
          <table class="rp-sec"><thead><tr><th></th><th class="va">Você</th>${hasB ? `<th class="vb">Ref.</th><th>Dif.</th>` : ""}</tr></thead><tbody>
            ${["s1_ms", "s2_ms", "s3_ms"].map((k, i) => {
              const d = hasB && LA[k] && LB[k] ? LA[k] - LB[k] : null;
              return `<tr id="rpS${i}"><td>S${i + 1}</td><td class="num">${fmtSec(LA[k])}</td>${hasB ? `<td class="num">${fmtSec(LB[k])}</td>
                <td class="num ${d > 0 ? "neg" : d < 0 ? "posg" : ""}">${fmtDelta(d)}</td>` : ""}</tr>`;
            }).join("")}</tbody></table>
        </div>
        <div class="rp-zoom panel">
          <button class="btn sm" id="rpZo" title="Afastar (roda do mouse para baixo)">−</button>
          <input type="range" id="rpZoom" min="0" max="100" value="55" aria-label="Zoom">
          <button class="btn sm" id="rpZi" title="Aproximar (roda do mouse para cima)">+</button>
          <button class="btn sm" id="rpFit" title="Mostrar a pista inteira">Pista inteira</button>
          <button class="btn sm on" id="rpRot" title="Gira a pista com o carro">Girar</button>
          <button class="btn sm on" id="rpPh" title="Linha colorida por pedal">Cores</button>
        </div>
      </div>
      <div class="rp-dock ${showVids ? "" : "novids"}">
        <div class="vresize" id="rpResize" title="Arraste para aumentar ou diminuir os vídeos"></div>
        <div class="rp-vids" id="rpVids">${rvid(LA, "a", "Sua volta")}${rvid(LB, "b", "Referência")}</div>
        <div class="rp-bar">
          <button class="btn primary" id="rpPlay" title="Espaço">▶</button>
          <b class="num rp-clock" id="rpClock">0:00.000</b>
          <div class="rates">${[0.25, 0.5, 1, 2].map((x) => `<button class="btn sm ${x === 1 ? "on" : ""}" data-rprate="${x}">${String(x).replace(".", ",")}×</button>`).join("")}</div>
          <div class="prog" id="rpProg"><div class="fill"></div><div class="knob"></div><div class="hover"></div></div>
          ${hasB ? `<span class="rp-d">Delta <b class="num" id="rpDelta">—</b></span>
          <span class="rp-d">↔ <b class="num" id="rpGap">—</b></span>
          <div class="seg-switch"><button class="btn sm on" data-mode="time">Tempo</button><button class="btn sm" data-mode="dist">Distância</button></div>` : ""}
          <button class="btn sm ${showVids ? "on" : ""}" id="rpVidBtn" ${hasVid ? "" : "disabled title=\"Sem vídeo nestas voltas\""}>Vídeos</button>
        </div>
      </div>
    </div>`;
  $("#rpPickA").onclick = (e) => lapPicker(e.currentTarget, options, a, (id) => { if (id) location.hash = `#/replay?a=${id}${b ? "&b=" + b : ""}`; }, { title: "Sua volta" });
  $("#rpPickB").onclick = (e) => lapPicker(e.currentTarget, options, b, (id) => { location.hash = `#/replay?a=${a}${id ? "&b=" + id : ""}`; }, { allowNone: true, title: "Comparar com" });
  // vídeos: mostrar/esconder e redimensionar
  const dock = view.querySelector(".rp-dock"), vids = $("#rpVids");
  try { const h = +localStorage.getItem("pitwall.rpVh"); if (h) vids.style.height = h + "px"; } catch (e) { /* ok */ }
  $("#rpVidBtn").onclick = () => {
    const on = dock.classList.toggle("novids");
    $("#rpVidBtn").classList.toggle("on", !on);
    try { localStorage.setItem("pitwall.rpVids", on ? "0" : "1"); } catch (e) { /* ok */ }
    window.dispatchEvent(new Event("resize"));
  };
  const handle = $("#rpResize");
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = vids.getBoundingClientRect().height;
    const mv = (ev) => { vids.style.height = Math.max(100, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - y0))) + "px"; window.dispatchEvent(new Event("resize")); };
    const up = () => {
      handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up);
      try { localStorage.setItem("pitwall.rpVh", Math.round(vids.getBoundingClientRect().height)); } catch (err) { /* ok */ }
    };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up);
  });
  view.querySelectorAll("[data-rfs]").forEach((btn) => btn.onclick = () => { const v = $(`#rvid-${btn.dataset.rfs}`); if (v && v.requestFullscreen) v.requestFullscreen(); });
  RP = makeReplay(r, LA, LB);
}

function lapLabel(l, pbIds) {
  if (l.kind === "ideal") return `✨ Volta ideal · ${fmtLap(l.lap_time_ms)} · ${esc(pretty(l.car))}`;
  if (l.kind === "team") return `👥 ${esc(l.player || "Equipe")} · ${fmtLap(l.lap_time_ms)} · ${esc(pretty(l.car))}`;
  return `${pbIds.has(l.id) ? "🏆 " : ""}${fmtLap(l.lap_time_ms)} · volta ${l.lap_number} · ${esc(pretty(l.car))} · ${fmtDate(l.started_at)}${
    l.valid && !l.out_lap && !l.in_lap ? "" : " (fora do ritmo)"}`;
}
function pbLapIds(options) {
  const seen = new Set(), ids = new Set();
  for (const l of options) {          // a API já devolve ordenado pelo tempo
    if ((l.kind && l.kind !== "own") || !l.valid || l.out_lap || l.in_lap || seen.has(l.car)) continue;
    seen.add(l.car); ids.add(l.id);
  }
  return ids;
}

function makeReplay(r, LA, LB) {
  const hasB = !!LB;
  const n = r.distance.length, dist = r.distance;
  const A = r.a, B = hasB ? r.b : null;
  const colA = css("--a"), colB = css("--b");
  const phA = phases(A), phB = hasB ? phases(B) : null;
  const runsA = phaseRuns(phA);
  const tEnd = LA.lap_time_ms;

  // ---- utilidades de interpolação na grade de distância
  const ok = (L, i) => L.x[i] != null && L.z[i] != null;
  const firstOk = (L) => { for (let i = 0; i < n; i++) if (ok(L, i) && L.t[i] != null) return i; return 0; };
  const lastOk = (L) => { for (let i = n - 1; i >= 0; i--) if (ok(L, i) && L.t[i] != null) return i; return n - 1; };
  const fA = firstOk(A), lA = lastOk(A), fB = hasB ? firstOk(B) : 0, lB = hasB ? lastOk(B) : 0;
  // índice fracionário onde o tempo de volta = ms
  const idxAtTime = (L, f0, l0, ms) => {
    if (ms <= L.t[f0]) return f0;
    if (ms >= L.t[l0]) return l0;
    let lo = f0, hi = l0;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((L.t[m] ?? -1) < ms) lo = m; else hi = m; }
    const t0 = L.t[lo], t1 = L.t[hi];
    return lo + (t1 > t0 ? (ms - t0) / (t1 - t0) : 0);
  };
  const lerp = (arr, fi) => {
    const i = Math.floor(fi), j = Math.min(n - 1, i + 1), u = fi - i;
    const a0 = arr[i], a1 = arr[j];
    if (a0 == null) return a1; if (a1 == null) return a0;
    return a0 + (a1 - a0) * u;
  };
  const pos = (L, fi) => [lerp(L.x, fi), lerp(L.z, fi)];
  const heading = (L, fi) => {
    const i = Math.max(0, Math.floor(fi) - 6), j = Math.min(n - 1, Math.floor(fi) + 6);
    if (!ok(L, i) || !ok(L, j)) return null;
    return Math.atan2(L.z[j] - L.z[i], L.x[j] - L.x[i]);
  };

  // ---- geometria da pista (a partir da sua volta): bordas a ±7 m
  const center = [], left = [], right = [];
  for (let i = 0; i < n; i++) {
    if (!ok(A, i)) continue;
    const i0 = Math.max(0, i - 4), i1 = Math.min(n - 1, i + 4);
    if (!ok(A, i0) || !ok(A, i1)) continue;
    let dx = A.x[i1] - A.x[i0], dz = A.z[i1] - A.z[i0];
    const ln = Math.hypot(dx, dz) || 1; dx /= ln; dz /= ln;
    center.push([A.x[i], A.z[i]]);
    left.push([A.x[i] - dz * 7, A.z[i] + dx * 7]);
    right.push([A.x[i] + dz * 7, A.z[i] - dx * 7]);
  }

  // ---- estado
  const S = { T: 0, playing: false, rate: 1, mode: "time", zoom: 55, rotate: true, phaseColors: true,
              camX: null, camZ: null, camRot: 0, last: 0, raf: 0, dragging: false };
  const cv = $("#rpCanvas"), ctx = cv.getContext("2d");
  const resize = () => {
    const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect();
    cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };
  // zoom = proximidade: 100 = colado no carro (~35 m de largura), 0 = pista inteira na tela
  let bbox = null;
  for (const [x, z] of center) {
    if (!bbox) bbox = [x, z, x, z];
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], z); bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], z);
  }
  bbox = bbox || [0, 0, 1000, 1000];
  const trackC = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const sidePx = () => ((cv.clientWidth || 0) > 900 ? 400 : 0);       // espaço dos cartões à direita
  const fitWidth = () => {
    const W = cv.clientWidth || 1, H = cv.clientHeight || 1, effW = Math.max(200, W - sidePx());
    return Math.max((bbox[2] - bbox[0]) * W / effW, (bbox[3] - bbox[1]) * W / H) * 1.12;
  };
  const viewWidth = () => { const maxW = Math.max(200, fitWidth()), minW = 35; return maxW * Math.pow(minW / maxW, S.zoom / 100); };
  const overview = () => Math.max(0, Math.min(1, 1 - S.zoom / 22));   // 1 = visão da pista inteira

  const mini = drawReplayMini(r, hasB);

  function frameState() {
    const fiA = idxAtTime(A, fA, lA, S.T);
    let fiB = null;
    if (hasB) fiB = S.mode === "time" ? idxAtTime(B, fB, lB, S.T) : Math.min(Math.max(fiA, fB), lB);
    return { fiA, fiB };
  }

  function strokePath(pts, width) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineWidth = width; ctx.stroke();
  }
  function drawCar(x, z, ang, color, scale) {
    ctx.save();
    ctx.translate(x, z); ctx.rotate(ang);
    const L = 4.7, W = 2.05;
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    roundRect(-L / 2, -W / 2, L, W, 0.6); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(10,12,16,.85)";                 // para-brisa e vidro traseiro
    roundRect(L * 0.02, -W * 0.36, L * 0.22, W * 0.72, 0.25); ctx.fill();
    roundRect(-L * 0.36, -W * 0.32, L * 0.14, W * 0.64, 0.2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.9)";              // faróis
    ctx.fillRect(L / 2 - 0.15, -W / 2 + 0.2, 0.12, 0.45); ctx.fillRect(L / 2 - 0.15, W / 2 - 0.65, 0.12, 0.45);
    ctx.restore();
  }
  function roundRect(x, y, w, h, rr) {
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
  }

  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const { fiA, fiB } = frameState();
    const [ax, az] = pos(A, fiA);
    // câmera suave no seu carro
    const ov = overview();
    const tx = ax + (trackC[0] - ax) * ov, tz = az + (trackC[1] - az) * ov;
    if (S.camX == null) { S.camX = tx; S.camZ = tz; }
    S.camX += (tx - S.camX) * 0.25; S.camZ += (tz - S.camZ) * 0.25;
    const h = heading(A, fiA);
    let target = S.rotate && h != null && ov < 1 ? (-Math.PI / 2 - h) * (1 - ov) : 0;
    while (target - S.camRot > Math.PI) target -= 2 * Math.PI;
    while (target - S.camRot < -Math.PI) target += 2 * Math.PI;
    S.camRot += (target - S.camRot) * 0.15;
    const scale = W / viewWidth();

    ctx.save();
    ctx.fillStyle = "#07080a"; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2 - sidePx() / 2 * overview(), H * (0.58 - 0.08 * overview()));
    ctx.rotate(S.camRot);
    ctx.scale(scale, scale);
    ctx.translate(-S.camX, -S.camZ);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // asfalto
    ctx.strokeStyle = "#16191e"; strokePath(center, 16);
    ctx.strokeStyle = "#1b1f25"; strokePath(center, 14);
    // bordas da pista
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.setLineDash([3, 3]); strokePath(left, 0.25); ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,.28)"; strokePath(right, 0.25);
    // linhas: referência (azul) e a sua (por pedal ou laranja)
    const px = 1 / scale;
    if (hasB) {
      ctx.strokeStyle = colB; ctx.globalAlpha = 0.9;
      const ptsB = []; for (let i = 0; i < n; i++) if (ok(B, i)) ptsB.push([B.x[i], B.z[i]]);
      strokePath(ptsB, 2.2 * px); ctx.globalAlpha = 1;
    }
    if (S.phaseColors) {
      for (const [s0, s1, p] of runsA) {
        const seg = []; for (let i = Math.max(0, s0 - 1); i <= s1; i++) if (ok(A, i)) seg.push([A.x[i], A.z[i]]);
        ctx.strokeStyle = PHASE_COLORS[p]; strokePath(seg, 2.6 * px);
      }
    } else {
      ctx.strokeStyle = colA; const ptsA = []; for (let i = 0; i < n; i++) if (ok(A, i)) ptsA.push([A.x[i], A.z[i]]);
      strokePath(ptsA, 2.6 * px);
    }
    // carros (a referência por baixo)
    const carScale = Math.max(1, 18 / (4.7 * scale));   // o carro nunca fica menor que ~18 px na tela
    if (hasB && fiB != null) {
      const [bx, bz] = pos(B, fiB), hb = heading(B, fiB) ?? 0;
      ctx.save(); ctx.translate(bx, bz); ctx.scale(carScale, carScale); ctx.translate(-bx, -bz);
      drawCar(bx, bz, hb, colB, scale); ctx.restore();
    }
    ctx.save(); ctx.translate(ax, az); ctx.scale(carScale, carScale); ctx.translate(-ax, -az);
    drawCar(ax, az, h ?? 0, colA, scale); ctx.restore();
    ctx.restore();
    hud(fiA, fiB);
  }

  function setGauge(tag, L, fi) {
    const g = (k) => lerp(L[k], fi);
    const gas = Math.round((g("gas") || 0) * 100), brake = Math.round((g("brake") || 0) * 100);
    $(`#g-${tag}-gas`).style.width = gas + "%"; $(`#t-${tag}-gas`).textContent = gas + "%";
    $(`#g-${tag}-brake`).style.width = brake + "%"; $(`#t-${tag}-brake`).textContent = brake + "%";
    $(`#t-${tag}-speed`).textContent = Math.round(g("speed") || 0);
    $(`#t-${tag}-gear`).textContent = gearTxt(L.gear[Math.round(fi)]);
    $(`#t-${tag}-rpm`).textContent = Math.round(g("rpm") || 0);
  }
  function hud(fiA, fiB) {
    const iA = Math.round(fiA);
    setGauge("a", A, fiA);
    if (hasB && fiB != null) {
      setGauge("b", B, fiB);
      const tb = lerp(B.t, fiA), ta = lerp(A.t, fiA);
      const delta = ta != null && tb != null ? ta - tb : null;     // + = você atrás
      const el = $("#rpDelta");
      el.textContent = delta == null ? "—" : fmtDelta(Math.round(delta));
      el.className = "num " + (delta > 0 ? "neg" : "posg");
      const gap = S.mode === "time" ? lerp(dist, fiA) - lerp(dist, fiB) : 0;   // + = você à frente
      const g = $("#rpGap");
      g.textContent = S.mode === "time" ? `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(0)} m` : "mesmo ponto";
      g.className = "num " + (gap < -0.5 ? "neg" : gap > 0.5 ? "posg" : "");
    }
    $("#rpClock").textContent = S.T <= 0 ? "0:00.000" : fmtLap(Math.round(S.T));
    const frac = Math.min(1, S.T / tEnd);
    $("#rpProg .fill").style.width = (frac * 100) + "%";
    $("#rpProg .knob").style.left = (frac * 100) + "%";
    // setor atual
    const ss = [LA.s1_ms, LA.s1_ms && LA.s2_ms ? LA.s1_ms + LA.s2_ms : null];
    const sec = ss[0] && S.T < ss[0] ? 0 : ss[1] && S.T < ss[1] ? 1 : 2;
    for (let k = 0; k < 3; k++) { const row = $(`#rpS${k}`); if (row) row.classList.toggle("on", k === sec); }
    mini.move(iA, fiB != null ? Math.round(fiB) : null);
  }

  // vídeos embaixo: seguem o relógio do replay (a referência pelo mesmo tempo ou pelo mesmo ponto)
  const rvA = $("#rvid-a"), rvB = $("#rvid-b");
  const vStartA = LA.video ? LA.video.start : 0, vStartB = LB && LB.video ? LB.video.start : 0;
  function syncVid(v, target) {
    if (!v || target == null || v.readyState < 1) return;
    if (S.playing) {
      if (v.playbackRate !== S.rate) v.playbackRate = S.rate;
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = Math.max(0, target);
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = Math.max(0, target);
    }
  }
  function syncVideos() {
    if (!rvA && !rvB) return;
    const { fiA, fiB } = frameState();
    syncVid(rvA, vStartA + S.T / 1000);
    if (rvB && fiB != null) {
      const tb = S.mode === "time" ? Math.min(S.T, LB.lap_time_ms) : lerp(B.t, fiB);
      syncVid(rvB, tb == null ? null : vStartB + tb / 1000);
    }
    void fiA;
  }
  function loop(ts) {
    if (S.playing) {
      const dt = S.last ? ts - S.last : 0;
      S.T += dt * S.rate;
      if (S.T >= tEnd) { S.T = tEnd; pause(); }
    }
    S.last = ts;
    draw();
    syncVideos();
    S.raf = requestAnimationFrame(loop);
  }
  const playBtn = $("#rpPlay");
  function play() { if (S.T >= tEnd) S.T = 0; S.playing = true; playBtn.textContent = "❚❚"; }
  function pause() { S.playing = false; playBtn.textContent = "▶"; }
  playBtn.onclick = () => (S.playing ? pause() : play());
  view.querySelectorAll("[data-rprate]").forEach((btn) => btn.onclick = () => {
    S.rate = +btn.dataset.rprate;
    view.querySelectorAll("[data-rprate]").forEach((x) => x.classList.toggle("on", x === btn));
  });
  view.querySelectorAll("[data-mode]").forEach((btn) => btn.onclick = () => {
    S.mode = btn.dataset.mode;
    view.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === btn));
  });
  const zoom = $("#rpZoom");
  const setZoom = (z) => { S.zoom = Math.min(100, Math.max(0, z)); zoom.value = S.zoom; };
  zoom.oninput = () => setZoom(+zoom.value);
  $("#rpZi").onclick = () => setZoom(S.zoom + 10);      // + aproxima
  $("#rpZo").onclick = () => setZoom(S.zoom - 10);      // − afasta
  $("#rpFit").onclick = () => setZoom(0);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(S.zoom + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
  $("#rpRot").onclick = () => { S.rotate = !S.rotate; $("#rpRot").classList.toggle("on", S.rotate); };
  $("#rpPh").onclick = () => { S.phaseColors = !S.phaseColors; $("#rpPh").classList.toggle("on", S.phaseColors); };
  // barra: clicar, arrastar ou passar o mouse (parado)
  const prog = $("#rpProg");
  const scrub = (e) => { const rc = prog.getBoundingClientRect(); S.T = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width)) * tEnd; };
  prog.addEventListener("pointerdown", (e) => { S.dragging = true; prog.setPointerCapture(e.pointerId); pause(); scrub(e); });
  prog.addEventListener("pointermove", (e) => {
    const rc = prog.getBoundingClientRect();
    $("#rpProg .hover").style.left = ((e.clientX - rc.left) / rc.width * 100) + "%";
    if (S.dragging || !S.playing) scrub(e);
  });
  prog.addEventListener("pointerup", () => { S.dragging = false; });
  mini.onPick = (i) => { pause(); S.T = A.t[i] ?? S.T; };
  const onKey = (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); S.playing ? pause() : play(); }
    if (e.code === "ArrowRight") { e.preventDefault(); S.T = Math.min(tEnd, S.T + 1000); }
    if (e.code === "ArrowLeft") { e.preventDefault(); S.T = Math.max(0, S.T - 1000); }
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  resize();
  S.raf = requestAnimationFrame(loop);
  return {
    destroy() {
      cancelAnimationFrame(S.raf);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", resize);
    },
  };
}

// mini mapa do replay: segmentos numerados, os dois carros e o delta do segmento atual
function drawReplayMini(r, hasB) {
  const el = $("#rpMini");
  const ax = r.a.x, az = r.a.z, n = ax.length, segs = r.segments || [];
  const pts = []; for (let i = 0; i < n; i++) if (ax[i] != null && az[i] != null) pts.push(i);
  const api_ = { move() {}, onPick: null };
  if (pts.length < 2) return api_;
  const xs = pts.map((i) => ax[i]), zs = pts.map((i) => az[i]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ), pad = span * 0.1, k = span / 260;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const labels = segs.map((s, idx) => {
    const i = s.apex; if (ax[i] == null) return "";
    const i0 = Math.max(0, i - 5), i1 = Math.min(n - 1, i + 5);
    let nx = -(az[i1] - az[i0]), nz = ax[i1] - ax[i0]; const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
    if ((ax[i] - cx) * nx + (az[i] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const lx = ax[i] + nx * 20 * k, lz = az[i] + nz * 20 * k;
    return `<g class="seglbl" data-seg="${idx}"><circle cx="${lx}" cy="${lz}" r="${9 * k}"/><text x="${lx}" y="${lz}" font-size="${10 * k}" dy="${3.5 * k}">${s.n}</text></g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}" id="rpMiniSvg">
    <path d="${svgPath(ax, az)}" fill="none" stroke="#2a3039" stroke-width="${7 * k}" stroke-linejoin="round"/>
    <path id="rpMiniSeg" d="" fill="none" stroke="${css("--accent")}" stroke-width="${7 * k}" stroke-linecap="round" stroke-linejoin="round"/>
    ${labels}
    ${hasB ? `<circle id="rpMB" r="${5 * k}" fill="${css("--b")}" stroke="#0b0d10" stroke-width="${1.5 * k}"/>` : ""}
    <circle id="rpMA" r="${5.5 * k}" fill="#fff" stroke="${css("--a")}" stroke-width="${2.5 * k}"/>
  </svg>`;
  let curSeg = -1;
  el.querySelectorAll(".seglbl").forEach((g) => g.onclick = () => {
    const s = segs[+g.dataset.seg];
    if (s && api_.onPick) api_.onPick(s.start);
  });
  api_.move = (iA, iB) => {
    if (ax[iA] != null) { $("#rpMA").setAttribute("cx", ax[iA]); $("#rpMA").setAttribute("cy", az[iA]); }
    const mb = $("#rpMB");
    if (mb && iB != null && r.b.x[iB] != null) { mb.setAttribute("cx", r.b.x[iB]); mb.setAttribute("cy", r.b.z[iB]); }
    let k2 = segs.findIndex((s) => iA >= s.start && iA <= s.end);
    if (k2 !== curSeg && k2 >= 0) {
      curSeg = k2;
      const s = segs[k2];
      $("#rpMiniSeg").setAttribute("d", svgPath(ax, az, s.start, s.end));
      el.querySelectorAll(".seglbl").forEach((g) => g.classList.toggle("on", +g.dataset.seg === k2));
      $("#rpSegName").textContent = `Segmento ${s.n}`;
      const d = $("#rpSegDelta");
      d.textContent = s.delta != null ? sgn(s.delta, 3) : "";
      d.className = "num " + (s.delta > 0 ? "neg" : "posg");
    }
  };
  return api_;
}

// ---------------------------------------------------------------- estratégia
async function renderStrategy(params) {
  current = { name: "strategy" };
  let stats = [];
  try { stats = await api("/api/stats/car-track"); } catch (e) { /* sem histórico */ }
  const saved = loadStrategy();
  const pre = params.get("track") && stats.find((s) => s.track === params.get("track") && s.car === params.get("car"));
  const v = { minutes: 60, byLaps: false, laps: 30, avg: "", fpl: "", tank: 120, stops: 0, margin: 1, formation: true, ...saved };
  const auto = pre || (!saved.avg && stats[0]);   // sem nada salvo: usa a última combinação gravada
  if (auto) { v.avg = fmtLap(Math.round(auto.avg_ms)); v.fpl = auto.fuel_per_lap ? auto.fuel_per_lap.toFixed(2) : v.fpl; }
  view.innerHTML = `
    <div class="head"><div><h1>Estratégia de corrida</h1>
      <div class="sub">Planeje combustível e paradas antes de largar. Não precisa de sessão gravada.</div></div></div>
    <div class="strat">
      <div class="panel fuel">
        <h2>Dados da corrida</h2>
        ${stats.length ? `<label>Usar meu histórico <select id="sHist"><option value="">— escolher carro e pista —</option>${
          stats.map((s, i) => `<option value="${i}" ${auto === s ? "selected" : ""}>${esc(pretty(s.track))} · ${esc(pretty(s.car))} (${s.laps} voltas)</option>`).join("")}</select></label>` : ""}
        <label>Tipo de corrida <select id="sType"><option value="time" ${v.byLaps ? "" : "selected"}>Por tempo</option>
          <option value="laps" ${v.byLaps ? "selected" : ""}>Por voltas</option></select></label>
        <label id="lMin">Duração (min) <input id="sMin" type="number" min="1" value="${v.minutes}"></label>
        <label id="lLaps">Número de voltas <input id="sLaps" type="number" min="1" value="${v.laps}"></label>
        <label>Tempo médio de volta <input id="sAvg" value="${esc(v.avg)}" placeholder="1:50.000"></label>
        <label>Consumo por volta (L) <input id="sFpl" value="${esc(v.fpl)}" placeholder="3.10"></label>
        <label>Capacidade do tanque (L) <input id="sTank" type="number" min="1" value="${v.tank}"></label>
        <label>Paradas obrigatórias <input id="sStops" type="number" min="0" value="${v.stops}"></label>
        <label>Voltas de margem <input id="sMargin" type="number" min="0" step="0.5" value="${v.margin}"></label>
        <label>Contar volta de formação <input id="sForm" type="checkbox" ${v.formation ? "checked" : ""}></label>
        <div class="note">O GT3 no ACC costuma ter tanque de 120 L; confira o do seu carro.</div>
      </div>
      <div>
        <div class="kpis" id="sKpis"></div>
        <div class="panel"><h2>Plano por stint</h2><div id="sPlan"></div></div>
      </div>
    </div>`;
  const ids = ["sType", "sMin", "sLaps", "sAvg", "sFpl", "sTank", "sStops", "sMargin", "sForm"];
  const read = () => ({
    byLaps: $("#sType").value === "laps", minutes: +$("#sMin").value, laps: +$("#sLaps").value,
    avg: $("#sAvg").value, fpl: $("#sFpl").value, tank: +$("#sTank").value, stops: +$("#sStops").value,
    margin: +$("#sMargin").value, formation: $("#sForm").checked,
  });
  const calc = () => {
    const s = read();
    saveStrategy(s);
    $("#lMin").style.display = s.byLaps ? "none" : "";
    $("#lLaps").style.display = s.byLaps ? "" : "none";
    const plan = strategyPlan(s);
    if (plan.error) {
      $("#sKpis").innerHTML = "";
      $("#sPlan").innerHTML = `<div class="sub">${plan.error}</div>`;
      return;
    }
    $("#sKpis").innerHTML = `
      <div class="kpi"><span>Voltas previstas</span><b class="num">${plan.laps}</b></div>
      <div class="kpi"><span>Combustível total</span><b class="num">${plan.total} L</b></div>
      <div class="kpi"><span>Paradas</span><b class="num">${plan.stops}</b></div>
      <div class="kpi best"><span>Largar com</span><b class="num">${plan.stints[0].fuelStart} L</b></div>`;
    $("#sPlan").innerHTML = `
      <table><thead><tr><th>Stint</th><th>Voltas</th><th>Até a volta</th><th>Consumo</th><th>No box: colocar</th><th>Tanque sai com</th></tr></thead>
      <tbody>${plan.stints.map((st, i) => `<tr>
        <td>${i + 1}</td><td class="num">${st.laps}</td><td class="num">${st.endLap}</td>
        <td class="num">${st.use} L</td>
        <td class="num">${i === 0 ? "— (largada)" : `<b>${st.add} L</b>`}</td>
        <td class="num ${st.fuelStart > s.tank ? "pos" : ""}">${st.fuelStart} L</td></tr>`).join("")}</tbody></table>
      ${plan.forced ? `<div class="note warn">O tanque não comporta a corrida com ${s.stops} parada(s): o plano usa ${plan.stops}.</div>` : ""}
      <div class="note">“No box: colocar” é o valor para o menu de pit do ACC, contando que você chega com a margem de
        ${s.margin} volta(s) no tanque. Arredondado para cima.</div>`;
  };
  ids.forEach((id) => { const el = $("#" + id); el.addEventListener("input", calc); el.addEventListener("change", calc); });
  const hist = $("#sHist");
  if (hist) hist.onchange = () => {
    const s = stats[+hist.value];
    if (!s) return;
    $("#sAvg").value = fmtLap(Math.round(s.avg_ms));
    if (s.fuel_per_lap) $("#sFpl").value = s.fuel_per_lap.toFixed(2);
    calc();
  };
  calc();
}

function strategyPlan(s) {
  const avg = parseLap(s.avg), fpl = parseFloat(String(s.fpl).replace(",", "."));
  if (!avg || !(fpl > 0)) return { error: "Preencha o tempo médio de volta e o consumo por volta." };
  if (!(s.tank > 0)) return { error: "Informe a capacidade do tanque." };
  const laps = s.byLaps ? Math.max(1, Math.round(s.laps)) : Math.ceil((s.minutes * 60000) / avg);
  const extra = s.formation ? 1 : 0;           // volta de formação gasta combustível do 1º stint
  const margin = Math.max(0, s.margin) * fpl;
  const fuelLaps = laps + extra;
  let stops = Math.max(0, Math.round(s.stops)), forced = false;
  let stints;
  for (;;) {
    const k = stops + 1;
    const base = Math.floor(fuelLaps / k), rest = fuelLaps % k;
    // voltas por stint (as que sobram vão para os primeiros)
    const lapsArr = Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
    const fuels = lapsArr.map((l) => l * fpl + margin);
    if (fuels.every((f) => f <= s.tank) || stops > 20) {
      let end = 0;
      stints = lapsArr.map((l, i) => {
        const raceLaps = i === 0 ? l - extra : l;
        end += raceLaps;
        return { laps: raceLaps, endLap: end, use: (l * fpl).toFixed(1),
          fuelStart: Math.ceil(l * fpl + margin), add: Math.ceil(l * fpl) };
      });
      break;
    }
    stops++; forced = true;
  }
  return { laps, total: Math.ceil(fuelLaps * fpl + margin), stops, stints, forced };
}
function loadStrategy() { try { return JSON.parse(localStorage.getItem("pitwall.strategy") || "{}"); } catch (e) { return {}; } }
function saveStrategy(v) { try { localStorage.setItem("pitwall.strategy", JSON.stringify(v)); } catch (e) { /* ok */ } }

// ---------------------------------------------------------------- configurações
async function renderSettings() {
  current = { name: "settings" };
  const draw = async () => {
    const { settings: s, video: v } = await api("/api/settings");
    let au = { supported: false };
    try { au = await api("/api/autostart"); } catch (e) { /* ok */ }
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${String(val) === String(k) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    const tested = Object.entries(v.tested || {}).map(([k, r]) => `<div><span class="tag">${k}</span> ${r === "ok" ? `<span class="status ok">funcionou</span>` : `<span class="status bad">${esc(r)}</span>`}</div>`).join("");
    const ver = await api("/api/update").catch(() => ({ current: "?" }));
    view.innerHTML = `
      <div class="head"><div><h1>Configurações</h1><div class="sub">As mudanças valem a partir da próxima sessão.</div></div></div>
      <div class="set-tabs" id="setTabs" role="tablist">
        ${SET_TABS.map(([k, t, ic]) => `<button class="set-tab" data-tab="${k}" role="tab">${ic}<span>${t}</span>${k === "update" && ver.available ? `<i class="set-dot" title="Nova versão"></i>` : ""}</button>`).join("")}
      </div>

      <section class="set-sec" data-sec="geral">
        <div class="set-card"><h2>Inicialização</h2>
          ${au.supported ? `
          ${setRow("Iniciar com o Windows, em segundo plano", "Fica só com um ícone perto do relógio, esperando o jogo, e grava sozinho. Quando começar a gravar aparece uma notificação. Clique no ícone para abrir esta tela ou use “Sair” no menu dele.", `<input id="cAuto" class="tgl" type="checkbox" ${au.enabled ? "checked" : ""}>`)}
          ${au.outdated ? `<div class="note warn">O registro aponta para outra pasta do Pitwall. Desligue e ligue de novo para atualizar.</div>` : ""}
          ${setRow("Atalhos", "Cria o ícone do Pitwall na Área de Trabalho e no Menu Iniciar.", `<button class="btn" id="cLnk">Criar atalhos</button>`)}
          <div class="sub" id="cLnkOut"></div>`
          : `<div class="sub">Disponível só no Windows.</div>`}
        </div>
        <div class="set-card"><h2>Jogos</h2>
          ${setRow("Ler telemetria de", "iRacing: o traçado do mapa é reconstruído pela velocidade e direção, e o engenheiro de setup fica limitado. Le Mans Ultimate ainda não. Mudar aqui exige reiniciar o Pitwall.", sel("xGames", [["auto", "Detectar sozinho (ACC e iRacing)"], ["acc", "Só ACC"], ["iracing", "Só iRacing"]], s.games))}
        </div>
      </section>

      <section class="set-sec" data-sec="video">
        <div class="set-card"><h2>Gravação de vídeo</h2>
          ${setRow("Gravar vídeo nas sessões", "Grava a tela durante a sessão, sincronizada com a telemetria.", `<input id="cVid" class="tgl" type="checkbox" ${s.video_enabled ? "checked" : ""}>`)}
          ${setRow("Monitor do jogo", "Qual tela gravar.", sel("cMon", [[0, "1 (principal)"], [1, "2"], [2, "3"], [3, "4"]], s.video_monitor))}
          ${setRow("Encoder", "Automático tenta NVIDIA, depois AMD e, por último, o processador.", sel("cEnc", [["auto", "Automático"], ["nvenc", "NVIDIA (NVENC)"], ["amf", "AMD (AMF)"], ["cpu", "Processador (720p)"]], s.video_encoder))}
          ${setRow("Quadros por segundo", "", sel("cFps", [[30, "30"], [60, "60"]], s.video_fps))}
          ${setRow("Qualidade", "Na normal, 1 hora de vídeo ocupa cerca de 2,7 GB.", sel("cBr", [[4, "Leve (4 Mbps)"], [6, "Normal (6 Mbps)"], [10, "Alta (10 Mbps)"]], s.video_bitrate_mbps))}
          ${setRow("Manter vídeos das últimas", "Os vídeos ficam em %LOCALAPPDATA%\\Pitwall\\videos.", sel("cKeep", [[5, "5 sessões"], [15, "15 sessões"], [30, "30 sessões"], [100, "100 sessões"]], s.video_keep_sessions))}
        </div>
        <div class="set-card"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">Status da gravação</h2><span class="spacer"></span>
            <button class="btn sm" id="cTest">Testar de novo</button></div>
          <div class="kv"><span>Encoder em uso</span>${v.probing ? `<span class="sub">testando…</span>` : v.selected ? `<span class="status ok">${v.selected}</span>` : `<span class="status bad">${esc(v.error || "nenhum")}</span>`}</div>
          <div class="kv"><span>Testes</span><div>${tested || `<span class="sub">—</span>`}</div></div>
          ${v.last_error ? `<div class="kv"><span>Último erro</span><code>${esc(v.last_error)}</code></div>` : ""}
          <div class="kv"><span>ffmpeg</span><code>${esc(v.ffmpeg || "não encontrado")}</code></div>
          <div class="note">O teste grava 1,5 s do monitor escolhido sem salvar nada. Se a GPU não funcionar, escolha “Processador”. Problemas ficam registrados em <code>%LOCALAPPDATA%\\Pitwall\\videos\\video.log</code>.</div>
        </div>
      </section>

      <section class="set-sec" data-sec="recursos">${extraSettings(s)}</section>

      <section class="set-sec" data-sec="backup">${backupSettings(s)}</section>

      <section class="set-sec" data-sec="update"><div class="set-card" id="updCard"></div></section>

      <section class="set-sec" data-sec="about">${aboutCard(ver)}</section>`;
    const tab = (() => { try { return localStorage.getItem("pitwall.settab"); } catch (e) { return null; } })();
    const showTab = (k) => {
      if (!SET_TABS.some((t) => t[0] === k)) k = "geral";
      view.querySelectorAll(".set-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === k));
      view.querySelectorAll(".set-sec").forEach((x) => x.classList.toggle("on", x.dataset.sec === k));
      try { localStorage.setItem("pitwall.settab", k); } catch (e) { /* ok */ }
    };
    view.querySelectorAll(".set-tab").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
    showTab(tab);
    drawUpdateCard(ver);
    const save = async () => {
      await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        video_enabled: $("#cVid").checked, video_monitor: +$("#cMon").value, video_encoder: $("#cEnc").value,
        video_fps: +$("#cFps").value, video_bitrate_mbps: +$("#cBr").value, video_keep_sessions: +$("#cKeep").value }) });
      setTimeout(draw, 300);
    };
    ["#cVid", "#cMon", "#cEnc", "#cFps", "#cBr", "#cKeep"].forEach((id) => $(id).addEventListener("change", save));
    const lnk = $("#cLnk");
    if (lnk) lnk.onclick = async () => {
      const r = await api("/api/shortcuts", { method: "POST" });
      $("#cLnkOut").textContent = r.ok ? "Pronto: procure o ícone “Pitwall”." : "Não deu certo: " + (r.error || "");
    };
    const auto = $("#cAuto");
    if (auto) auto.onchange = async () => {
      await api("/api/autostart", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: auto.checked }) });
      draw();
    };
    $("#cTest").onclick = async () => { await api("/api/settings/video-test", { method: "POST" }); setTimeout(draw, 300); };
    bindExtraSettings(draw);
    if (v.probing && current.name === "settings") setTimeout(() => current.name === "settings" && draw(), 1500);
  };
  await draw();
}

// ---------------------------------------------------------------- incidentes
const EV = {
  invalid: { icon: "⚠", name: "Volta invalidada (limite de pista)", cls: "inv" },
  pit_out: { icon: "↗", name: "Saída dos boxes", cls: "pit" },
  pit_in: { icon: "↘", name: "Entrada nos boxes", cls: "pit" },
  best: { icon: "★", name: "Melhor volta da sessão", cls: "best" },
  loss: { icon: "↯", name: "Perda de controle / rodada", cls: "loss" },
  lock: { icon: "●", name: "Travou a roda na freada", cls: "lock" },
};
function evIcons(events) {
  if (!events || !events.length) return `<span class="sub">—</span>`;
  const by = {};
  for (const e of events) by[e.type] = (by[e.type] || 0) + 1;
  return Object.entries(by).map(([k, n]) => {
    const e = EV[k] || { icon: "•", name: k, cls: "" };
    const why = events.filter((x) => x.type === k && x.why).map((x) => x.why);
    return `<span class="ev ${e.cls}" title="${esc(e.name)}${why.length ? ": " + esc(why.join("; ")) : ""}">${e.icon}${n > 1 ? n : ""}</span>`;
  }).join("");
}
function incidentMarkers(svg, events, ax, az, segs) {
  if (!svg || !events || !events.length) return;
  const n = ax.length;
  const vb = svg.viewBox.baseVal, k = Math.max(vb.width, vb.height) / 300;
  const ns = "http://www.w3.org/2000/svg";
  for (const e of events) {
    const i = Math.max(0, Math.min(n - 1, Math.round(e.d * (n - 1))));
    if (ax[i] == null) continue;
    const meta = EV[e.type] || { icon: "•", name: e.type, cls: "" };
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "evmark " + meta.cls);
    g.innerHTML = `<title>${esc(meta.name)}${e.t ? " · " + fmtLap(e.t) : ""}</title>
      <circle cx="${ax[i]}" cy="${az[i]}" r="${7 * k}"/>
      <text x="${ax[i]}" y="${az[i]}" font-size="${9 * k}" dy="${3.2 * k}">${meta.icon}</text>`;
    g.style.cursor = "pointer";
    g.onclick = (ev) => { ev.stopPropagation(); gotoIndex(i); };
    svg.appendChild(g);
  }
}

// ---------------------------------------------------------------- desgaste no stint
function degPanel(trends) {
  if (!trends || !trends.length) return "";
  const line = (t) => {
    const sl = t.slope_s_per_lap;
    const txt = sl == null ? `<span class="sub">poucas voltas limpas para medir</span>`
      : Math.abs(sl) < 0.02 ? `<span class="status ok">ritmo estável</span>`
      : sl > 0 ? `<span class="status bad">perde ${sl.toFixed(2).replace(".", ",")} s/volta</span>`
      : `<span class="status ok">ganha ${Math.abs(sl).toFixed(2).replace(".", ",")} s/volta</span>`;
    const f = t.laps[0], l = t.laps[t.laps.length - 1];
    const pr = f && l && f.press_f != null ? `<div class="sub">Pressão dianteira ${f.press_f.toFixed(1)} → ${l.press_f.toFixed(1)} psi ·
      traseira ${f.press_r.toFixed(1)} → ${l.press_r.toFixed(1)} psi</div>` : "";
    return `<div class="deg"><div class="row"><b>Stint ${t.stint}</b><span class="spacer"></span>${txt}</div>${pr}
      <div class="chart" id="deg${t.stint}" style="height:120px"></div></div>`;
  };
  return `<div class="panel" style="margin-top:14px"><h2>Desgaste ao longo do stint</h2>${trends.map(line).join("")}
    <div class="note">Tendência das voltas limpas (sem tráfego/erros). Se perde mais de 0,1 s/volta, o pneu está
      sofrendo: veja pressões e o engenheiro de setup abaixo.</div></div>`;
}
function drawDegCharts(trends) {
  for (const t of trends || []) {
    const el = $("#deg" + t.stint);
    const pts = t.laps.filter((r) => r.valid);
    if (!el || pts.length < 2) { if (el) el.style.display = "none"; continue; }
    const xs = pts.map((r) => r.i), ys = pts.map((r) => r.lap_time_ms / 1000);
    const series = [{}, { label: "Tempo", stroke: css("--accent"), width: 0, points: { size: 6, fill: css("--accent") } }];
    const data = [xs, ys];
    if (t.slope_s_per_lap != null) {
      const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
      const fit = xs.map((x) => my + t.slope_s_per_lap * (x - mx));
      series.push({ label: "Tendência", stroke: "#8a93a3", width: 1.5, dash: [5, 4], points: { show: false } });
      data.push(fit);
    }
    plots.push(new uPlot({
      width: el.clientWidth, height: 120, legend: { show: false }, scales: { x: { time: false } },
      axes: [axis({ values: (u, v) => v.map((x) => Number.isInteger(x) ? x : "") }),
             axis({ values: (u, v) => v.map((x) => fmtLap(x * 1000).slice(0, -2)), size: 64 })],
      series, cursor: { drag: { x: false, y: false } },
    }, data, el));
  }
}

// ---------------------------------------------------------------- progresso
async function renderProgress(params) {
  current = { name: "progress" };
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  const P = await api("/api/progress");
  const o = P.overall;
  if (!o.laps) {
    view.innerHTML = `<div class="head"><div><h1>Progresso</h1></div></div>
      <div class="panel empty"><b>Ainda sem voltas</b>Grave algumas sessões e volte aqui.</div>`;
    return;
  }
  const tab = params.get("tab") === "geral" ? "geral" : "combo";
  let car = params.get("car") || CTX.car, track = params.get("track") || CTX.track;
  const combos = P.combos_rated || P.combos;
  if (!combos.some((c) => c.car === car && c.track === track)) {
    const top = [...combos].sort((a, b) => b.laps - a.laps)[0];
    if (top) { car = top.car; track = top.track; }
  }
  if (car && track) setCtx(car, track);
  const q = (extra = "") => `#/progress?car=${encodeURIComponent(car)}&track=${encodeURIComponent(track)}${extra}`;
  const tracks = [...new Set(combos.map((c) => c.track))].sort();
  const cars = combos.filter((c) => c.track === track).map((c) => c.car);
  view.innerHTML = `
    <div class="pg-head">
      <div><span class="sub">Progresso de</span>
        <div class="pg-pick">
          <select id="pgTrack" aria-label="Pista">${tracks.map((t) => `<option value="${esc(t)}" ${t === track ? "selected" : ""}>${esc(pretty(t))}</option>`).join("")}</select>
          <span class="sub">com</span>
          <select id="pgCar" aria-label="Carro">${cars.map((c) => `<option value="${esc(c)}" ${c === car ? "selected" : ""}>${esc(pretty(c))}</option>`).join("")}</select>
        </div></div>
      <span class="spacer"></span>
      <div class="seg-switch"><a class="btn sm ${tab === "combo" ? "on" : ""}" href="${q()}">Este carro e pista</a>
        <a class="btn sm ${tab === "geral" ? "on" : ""}" href="${q("&tab=geral")}">Geral</a></div>
    </div>
    <div id="pgBody"><div class="sub">Calculando…</div></div>`;
  $("#pgTrack").onchange = (e) => {
    const t = e.target.value, c = (combos.find((x) => x.track === t && x.car === car) || combos.find((x) => x.track === t)).car;
    location.hash = `#/progress?car=${encodeURIComponent(c)}&track=${encodeURIComponent(t)}${tab === "geral" ? "&tab=geral" : ""}`;
  };
  $("#pgCar").onchange = (e) => { location.hash = `#/progress?car=${encodeURIComponent(e.target.value)}&track=${encodeURIComponent(track)}${tab === "geral" ? "&tab=geral" : ""}`; };
  if (tab === "geral") return progressGeneral(P);
  comboProgress(car, track);
}

function ratingRing(v, size = 112) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, f = v == null ? 0 : Math.max(0, Math.min(100, v)) / 100;
  const col = v == null ? "#3a414d" : v >= 85 ? "var(--good)" : v >= 70 ? "var(--accent)" : "var(--bad)";
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Rating ${v ?? "—"}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#262b34" stroke-width="9"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dy=".35em" fill="var(--text)" font-size="${size * 0.3}" font-weight="700">${v ?? "—"}</text></svg>`;
}

async function comboProgress(car, track) {
  const box = $("#pgBody");
  const C = await api(`/api/progress/combo?car=${encodeURIComponent(car)}&track=${encodeURIComponent(track)}`);
  if (current.name !== "progress") return;
  const cons = C.consistency || { segments: [], laps: [], plan: [] };
  const pb = C.pb, R = C.rating || {};
  const idealMs = cons.ideal_s != null ? Math.round(cons.ideal_s * 1000) : null;
  const pot = pb && idealMs ? pb.lap_time_ms - idealMs : null;
  const pbGain = C.pb_history.length > 1 ? C.pb_history[0].lap_time_ms - C.pb_history[C.pb_history.length - 1].lap_time_ms : null;
  const bar = (label, v, hint) => `<div class="rbar"><div class="row"><span>${label}</span><span class="spacer"></span><b class="num">${v ?? "—"}</b></div>
    <div class="rtrack"><i style="width:${v ?? 0}%"></i></div><small>${hint}</small></div>`;
  const target = C.ideal ? C.ideal.lap_id : null;
  const planCards = cons.plan.map((p, i) => {
    const s = cons.segments.find((x) => x.n === p.n);
    const link = pb ? `#/compare?a=${pb.lap_id}${target ? "&b=" + target : ""}&seg=${s.n}` : "";
    return `<div class="todo"><div class="todo-n">${i + 1}</div>
      <div><b>Curva ${s.n}</b> <span class="posg num">até −${s.potential.toFixed(2).replace(".", ",")} s por volta</span>
        <p>Você varia ±${s.std.toFixed(2).replace(".", ",")} s aqui. Seu melhor nesse trecho foi ${s.best.toFixed(2).replace(".", ",")} s
          (volta ${s.best_lap_number}${s.best_started_at ? ", " + fmtDate(s.best_started_at) : ""}). Repita isso com frequência.</p></div>
      ${link ? `<a class="btn sm" href="${link}">Ver na análise</a>` : ""}</div>`;
  }).join("");
  box.innerHTML = `
    <div class="pg-top">
      <div class="panel rating-card">
        ${ratingRing(R.current)}
        <div class="rbars"><h2>Rating Pitwall</h2>
          ${bar("Ritmo", R.pace, "quão perto do seu recorde você anda")}
          ${bar("Consistência", R.consistency, "quanto suas voltas variam entre si")}
          ${bar("Limpeza", R.clean, "voltas sem sair da pista")}
        </div>
      </div>
      <div class="kgrid">
        <div class="kpi best"><span>Seu recorde</span><b class="num">${fmtLap(pb && pb.lap_time_ms)}</b>
          ${pb ? `<small>${fmtDate(pb.started_at)}</small>` : ""}</div>
        <div class="kpi"><span>Volta ideal</span><b class="num">${fmtLap(idealMs)}</b>
          ${C.ideal_from ? `<small>seus melhores trechos de ${C.ideal_from.laps} voltas</small>` : ""}</div>
        <div class="kpi"><span>Dá para ganhar</span><b class="num posg">${pot != null ? "−" + (pot / 1000).toFixed(3) + " s" : "—"}</b><small>juntando seus melhores trechos</small></div>
        <div class="kpi"><span>Evolução do recorde</span><b class="num ${pbGain > 0 ? "posg" : ""}">${pbGain != null ? "−" + (pbGain / 1000).toFixed(3) + " s" : "—"}</b>
          <small>${C.sessions.length} sessões</small></div>
      </div>
    </div>

    <div class="panel" style="margin-top:14px">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">O que treinar agora</h2><span class="spacer"></span>
        <span class="sub">os 3 trechos onde você mais deixa tempo</span></div>
      ${planCards || `<div class="sub">Precisa de pelo menos 2 voltas limpas com esse carro nessa pista.</div>`}
    </div>

    <div class="strat two" style="margin-top:14px">
      <div class="panel"><h2>Evolução por sessão</h2><div id="pgTrend" class="chart"></div>
        <div class="note">Linha cheia: melhor volta · tracejada: média das voltas limpas.</div></div>
      <div class="panel"><h2>Rating por sessão</h2><div id="pgRate" class="chart"></div>
        <div class="note">Sobe quando você anda perto do recorde, varia pouco e não sai da pista.</div></div>
    </div>

    <div class="strat two" style="margin-top:14px">
      <div class="panel"><h2>Onde você varia mais</h2><div id="pgMap" class="cmap"></div>
        <div class="legend-row"><span><i style="background:#3fd68b"></i>consistente</span><span><i style="background:#ffd23f"></i>médio</span><span><i style="background:#ff5d5d"></i>varia muito</span></div></div>
      <div class="panel"><h2>Volta ideal (fantasma)</h2>
        <p class="sub" style="margin:0 0 12px">${esc(pretty(car))} em ${esc(pretty(track))}: o seu melhor tempo em cada curva, de voltas diferentes,
          numa volta só. Use como referência na Análise, no Replay e no delta ao vivo.</p>
        <div id="pgIdeal">${C.ideal ? idealCard(C.ideal, pb) : ""}</div>
        <button class="btn primary" id="pgGen" ${pb ? "" : "disabled"}>${C.ideal ? "Atualizar volta ideal" : "Gerar volta ideal"}</button>
        <span class="sub" id="pgGenOut"></span>
        <details style="margin-top:14px"><summary class="sub">Tempo de cada curva</summary>
          <table style="margin-top:8px"><thead><tr><th>Curva</th><th>Melhor</th><th>Média</th><th>Variação</th><th>Ganho</th></tr></thead><tbody>
          ${cons.segments.map((s) => `<tr><td>${s.n}</td><td class="num">${s.best.toFixed(2)}</td><td class="num">${s.mean.toFixed(2)}</td>
            <td class="num">±${s.std.toFixed(2)}</td><td class="num posg">${s.potential.toFixed(2)}</td></tr>`).join("")}</tbody></table></details>
      </div>
    </div>`;
  const S = C.sessions;
  const dlabel = (arr) => (u, v) => v.map((i) => (Number.isInteger(i) && arr[i] ? new Date(arr[i].started_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""));
  const el = $("#pgTrend");
  if (S.length > 1) {
    plots.push(new uPlot({
      width: el.clientWidth, height: 220, scales: { x: { time: false } },
      axes: [axis({ values: dlabel(S) }), axis({ values: (u, v) => v.map((x) => fmtLap(x * 1000).slice(0, -2)), size: 70 })],
      series: [{}, { label: "Melhor", stroke: css("--accent"), width: 2, points: { size: 6, fill: css("--accent") } },
               { label: "Média", stroke: "#8a93a3", width: 1.5, dash: [5, 4], points: { size: 4 } }],
      cursor: { drag: { x: false, y: false } },
    }, [S.map((_, i) => i), S.map((s) => s.best_ms / 1000), S.map((s) => s.avg_ms / 1000)], el));
  } else el.innerHTML = `<div class="sub">Precisa de 2 sessões ou mais.</div>`;
  const RS = R.sessions || [], el2 = $("#pgRate");
  if (RS.length > 1) {
    plots.push(new uPlot({
      width: el2.clientWidth, height: 220, scales: { x: { time: false }, y: { range: [0, 100] } },
      axes: [axis({ values: dlabel(RS) }), axis({ size: 40 })],
      series: [{}, { label: "Rating", stroke: css("--good"), width: 2.4, points: { size: 6, fill: css("--good") } },
               { label: "Ritmo", stroke: "#8a93a3", width: 1, dash: [4, 4], points: { show: false } },
               { label: "Consistência", stroke: "#b98cff", width: 1, dash: [4, 4], points: { show: false } }],
      cursor: { drag: { x: false, y: false } },
    }, [RS.map((_, i) => i), RS.map((s) => s.rating), RS.map((s) => s.pace), RS.map((s) => s.consistency)], el2));
  } else el2.innerHTML = `<div class="sub">Precisa de 2 sessões ou mais.</div>`;
  consistencyMap($("#pgMap"), cons);
  $("#pgGen").onclick = async () => {
    $("#pgGen").disabled = true; $("#pgGenOut").textContent = "Montando…";
    try {
      const r = await api("/api/progress/ideal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ car, track }) });
      $("#pgIdeal").innerHTML = idealCard({ lap_id: r.lap_id, lap_time_ms: r.lap_time_ms }, pb);
      $("#pgGenOut").textContent = `Pronto: ${pretty(car)} em ${pretty(track)}.`;
    } catch (e) { $("#pgGenOut").textContent = e.message; }
    $("#pgGen").disabled = false;
  };
}

function progressGeneral(P) {
  const o = P.overall, box = $("#pgBody");
  const combos = [...(P.combos_rated || [])].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  const recBy = {}; for (const r of P.records) recBy[r.car + "|" + r.track] = r;
  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Horas na pista</span><b class="num">${o.hours.toFixed(1).replace(".", ",")} h</b></div>
      <div class="kpi"><span>Voltas</span><b class="num">${o.laps}</b></div>
      <div class="kpi"><span>Voltas limpas</span><b class="num">${o.clean_laps}</b></div>
      <div class="kpi"><span>Sessões</span><b class="num">${o.sessions}</b></div>
    </div>
    <div class="strat two">
      <div class="panel"><h2>Voltas por semana</h2><div id="pgWeeks" class="chart"></div></div>
      <div class="panel"><h2>Seus carros e pistas</h2>
        <table><thead><tr><th>Pista</th><th>Carro</th><th>Recorde</th><th>Rating</th><th></th></tr></thead><tbody>
        ${combos.map((c) => { const r = recBy[c.car + "|" + c.track]; return `<tr><td>${esc(pretty(c.track))}</td><td>${esc(pretty(c.car))}</td>
          <td class="num best">${fmtLap(r && r.lap_time_ms)}</td><td class="num"><span class="rpill" style="--v:${c.rating ?? 0}">${c.rating ?? "—"}</span></td>
          <td class="acts"><a class="btn sm" href="#/progress?car=${encodeURIComponent(c.car)}&track=${encodeURIComponent(c.track)}">Abrir</a></td></tr>`; }).join("")}
        </tbody></table></div>
    </div>`;
  const el = $("#pgWeeks"), W = o.weeks;
  if (W.length) {
    plots.push(new uPlot({
      width: el.clientWidth, height: 220, legend: { show: false }, scales: { x: { time: false, range: [-0.6, W.length - 0.4] } },
      axes: [axis({ values: (u, v) => v.map((i) => (Number.isInteger(i) && W[i] ? new Date(W[i].week + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "")) }),
             axis({ size: 44 })],
      series: [{}, { label: "Voltas", fill: "rgba(255,176,32,.55)", stroke: css("--accent"), width: 1,
        paths: uPlot.paths.bars({ size: [0.6, 40] }), points: { show: false } }],
      cursor: { drag: { x: false, y: false } },
    }, [W.map((_, i) => i), W.map((w) => w.laps)], el));
  }
}

function idealCard(ideal, pb) {
  return `<div class="ideal"><b class="num">${fmtLap(ideal.lap_time_ms)}</b>
    ${pb ? `<span class="num posg">${fmtDelta(ideal.lap_time_ms - pb.lap_time_ms)} vs recorde</span>` : ""}
    <span class="spacer"></span>
    ${pb ? `<a class="btn sm" href="#/compare?a=${pb.lap_id}&b=${ideal.lap_id}">Analisar</a>
    <a class="btn sm" href="#/replay?a=${pb.lap_id}&b=${ideal.lap_id}">▶ Replay</a>` : ""}</div>`;
}
function consistencyMap(el, cons) {
  const X = cons.map && cons.map.x, Z = cons.map && cons.map.z;
  if (!X || !cons.segments.length) { el.innerHTML = `<div class="sub">Sem dados suficientes.</div>`; return; }
  const pts = X.map((v, i) => i).filter((i) => X[i] != null && Z[i] != null);
  const xs = pts.map((i) => X[i]), zs = pts.map((i) => Z[i]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ), pad = span * 0.08, k = span / 300;
  const maxStd = Math.max(...cons.segments.map((s) => s.std), 0.05);
  const col = (v) => { const t = Math.min(1, v / maxStd); return t < 0.33 ? "#3fd68b" : t < 0.66 ? "#ffd23f" : "#ff5d5d"; };
  const segs = cons.segments.map((s) => {
    const mid = Math.round((s.start + s.end) / 2);
    return `<path d="${svgPath(X, Z, s.start, s.end)}" fill="none" stroke="${col(s.std)}" stroke-width="${7 * k}" stroke-linecap="round">
        <title>Trecho ${s.n}: ±${s.std.toFixed(2)} s · ganho ${s.potential.toFixed(2)} s</title></path>
      ${X[mid] != null ? `<g class="seglbl"><circle cx="${X[mid]}" cy="${Z[mid]}" r="${8 * k}"/><text x="${X[mid]}" y="${Z[mid]}" font-size="${9 * k}" dy="${3.2 * k}">${s.n}</text></g>` : ""}`;
  }).join("");
  el.innerHTML = `<svg viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}">
    <path d="${svgPath(X, Z)}" fill="none" stroke="#2a3039" stroke-width="${9 * k}" stroke-linecap="round" stroke-linejoin="round"/>${segs}</svg>`;
}

// ---------------------------------------------------------------- equipe (login com Google)
const teamState = { sel: null, polling: null, tab: "ranking", filter: null, cfilter: null };
try { teamState.sel = localStorage.getItem("pitwall.team") || null; } catch (e) { /* ok */ }
const postJ = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const avatar = (u, cls = "") => u && u.avatar_url
  ? `<img class="ava ${cls}" src="${esc(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="ava ${cls}">${esc(((u && u.name) || "?").trim()[0] || "?").toUpperCase()}</span>`;

// desenho original de um carro de corrida (GT genérico, vista lateral)
const CAR_SVG = (color = "var(--accent)", cls = "") => `<svg class="carart ${cls}" viewBox="0 0 320 96" aria-hidden="true">
  <path d="M12 66 L22 52 C40 46 70 44 96 42 L132 26 C150 19 190 18 214 24 L252 38 C276 42 296 48 306 56 L310 66 Z" fill="${color}"/>
  <path d="M138 30 L160 24 C180 22 198 23 210 27 L230 38 L132 40 Z" fill="#0b0d10" opacity=".85"/>
  <path d="M8 66 H312 V72 H8 Z" fill="#0b0d10" opacity=".6"/>
  <path d="M286 44 L314 40 L316 46 L292 50 Z" fill="${color}" opacity=".85"/>
  <rect x="300" y="34" width="4" height="12" fill="${color}"/>
  <circle cx="74" cy="68" r="18" fill="#0b0d10"/><circle cx="74" cy="68" r="10" fill="#2a3039"/><circle cx="74" cy="68" r="4" fill="${color}"/>
  <circle cx="250" cy="68" r="18" fill="#0b0d10"/><circle cx="250" cy="68" r="10" fill="#2a3039"/><circle cx="250" cy="68" r="4" fill="${color}"/>
  <path d="M100 52 H200" stroke="#0b0d10" stroke-width="2" opacity=".5"/>
  <text x="170" y="60" font-size="14" font-weight="800" font-style="italic" fill="#0b0d10" opacity=".7">27</text></svg>`;

const teamLogo = (t, cls = "") => t && t.logo_url
  ? `<img class="tlogo ${cls}" src="${esc(t.logo_url)}" alt="Logo da equipe ${esc(t.name)}">`
  : `<span class="tlogo ${cls}">${esc((t && t.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;

const ROLE_NAME = { owner: "Dono", admin: "Líder", member: "Piloto" };
const MODE_INFO = {
  invite: ["Só por convite", "Entra quem receber o link, o código ou um convite por e-mail. A equipe não aparece na lista."],
  request: ["Por aprovação", "Aparece na lista de equipes. Quem pedir para entrar fica aguardando um líder aceitar."],
  open: ["Aberta", "Aparece na lista e qualquer piloto entra com um clique."],
};
function agoText(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "agora há pouco";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}
function syncChip(st, s) {
  const y = st.sync || {};
  if (!s.team_auto_upload) return `<span class="sync warn" title="Ligue em Ajustes">Envio automático desligado</span>`;
  if (y.state === "syncing") return `<span class="sync run"><i></i>Sincronizando seus recordes…</span>`;
  if (y.state === "error") return `<span class="sync warn" title="${esc(y.error || "")}">Não consegui sincronizar agora · tento de novo sozinho</span>`;
  if (y.at) return `<span class="sync ok" title="${y.sent ? y.sent + " recorde(s) novo(s) enviado(s)" : "tudo em dia"}"><i></i>Recordes em dia · ${agoText(y.at)}</span>`;
  return `<span class="sync"><i></i>Seus recordes sobem sozinhos</span>`;
}

async function renderTeam(tab) {
  current = { name: "team" };
  if (teamState.polling) { clearTimeout(teamState.polling); teamState.polling = null; }
  tab = tab || teamState.tab || "ranking";
  if (tab === "community" || tab === "manage") tab = "ranking";
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let st;
  try { st = await api("/api/team/status"); } catch (e) { view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if (!st.logged_in) return teamLogin(st);
  const { settings: s } = await api("/api/settings");
  const teams = st.teams || [];
  if (!teams.find((t) => t.id === teamState.sel)) teamState.sel = teams.length ? teams[0].id : null;
  const team = teams.find((t) => t.id === teamState.sel);
  const manager = !!team && (team.role === "owner" || team.role === "admin");
  const tabs = team ? [["ranking", "Ranking"], ["members", "Membros"], ...(manager ? [["access", "Convites e entrada"]] : []), ["discover", "Equipes"], ["settings", "Ajustes"]]
    : [["discover", "Equipes"], ["settings", "Ajustes"]];
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
  teamState.tab = tab;
  const u = st.user || {};
  const invites = st.invites || [], pending = st.pending || [];
  view.innerHTML = `
    <section class="team-hero">
      ${CAR_SVG("rgba(255,176,32,.16)", "bg")}
      <div class="th-main">${team ? teamLogo(team, "xl") : ""}
        <div><span class="sub">${team ? ROLE_NAME[team.role] + " · " + (MODE_INFO[team.join_mode] || MODE_INFO.invite)[0] : "Equipe"}</span>
          <h1>${esc(team ? team.name : "Sem equipe ainda")}</h1>
          ${team && team.description ? `<div class="sub">${esc(team.description)}</div>` : ""}
          ${teams.length > 1 ? `<div class="tswitch">${teams.map((t) => `<button class="${t.id === teamState.sel ? "on" : ""}" data-team="${t.id}">${esc(t.name)}</button>`).join("")}</div>` : ""}
          <div id="thMembers" class="th-members"></div></div></div>
      <div class="th-side">
        <div class="me-chip">${avatar(u)}<span>${esc(u.name || "")}<small>${esc(u.email || "")}</small></span><button class="btn xs" id="tOutBtn">Sair</button></div>
        <div class="row">${syncChip(st, s)}<button class="btn xs" id="tSync" title="Enviar agora os recordes que faltam">Sincronizar</button>
          <a class="btn xs" href="${esc(st.site_url)}" target="_blank" rel="noopener">Site</a></div>
      </div>
    </section>
    ${st.needs_migration ? `<div class="note warn">Cargos, convite por e-mail e entrada aberta precisam de uma atualização única no banco da nuvem:
      rode o arquivo <code>supabase/equipe_v4.sql</code> no SQL Editor do Supabase. Enquanto isso, o resto continua funcionando.</div>` : ""}
    ${st.error ? `<div class="note warn">${esc(st.error)}</div>` : ""}
    ${st.last_error ? `<div class="note warn">Último envio automático: ${esc(st.last_error)}</div>` : ""}
    ${invites.map((i) => `<div class="invite-card">${teamLogo({ name: i.team_name, logo_url: i.logo_url })}
      <div><b>${esc(i.invited_by || "Alguém")}</b> convidou você para a equipe <b>${esc(i.team_name)}</b></div>
      <span class="spacer"></span><button class="btn primary sm" data-inv="${i.id}" data-acc="1">Aceitar</button>
      <button class="btn sm" data-inv="${i.id}" data-acc="0">Recusar</button></div>`).join("")}
    ${pending.map((p) => `<div class="invite-card wait"><div>Pedido enviado para <b>${esc(p.team_name)}</b>. Aguardando um líder aceitar.</div>
      <span class="spacer"></span><button class="btn sm" data-cancelreq="${p.team_id}">Cancelar pedido</button></div>`).join("")}
    <div class="tabs2">${tabs.map(([k, t]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>
    <div id="tMain"></div>`;
  view.querySelectorAll("[data-team]").forEach((c) => c.onclick = () => {
    teamState.sel = c.dataset.team; try { localStorage.setItem("pitwall.team", teamState.sel); } catch (e) { /* ok */ }
    renderTeam();
  });
  view.querySelectorAll("[data-tab]").forEach((c) => c.onclick = () => renderTeam(c.dataset.tab));
  view.querySelectorAll("[data-inv]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await postJ("/api/team/answer-invite", { id: b.dataset.inv, accept: b.dataset.acc === "1" });
      if (r.team && r.status === "joined") teamState.sel = r.team.id;
      renderTeam("ranking");
    } catch (e) { b.textContent = e.message; }
  });
  view.querySelectorAll("[data-cancelreq]").forEach((b) => b.onclick = async () => {
    await postJ("/api/team/cancel-request", { team_id: b.dataset.cancelreq }); renderTeam();
  });
  $("#tOutBtn").onclick = async () => { await postJ("/api/team/logout"); renderTeam(); };
  $("#tSync").onclick = async () => {
    const b = $("#tSync"); b.disabled = true; b.textContent = "Sincronizando…";
    await postJ("/api/team/sync");
    setTimeout(() => renderTeam(tab), 4000);
  };
  const box = $("#tMain");
  if (tab === "ranking") teamBoard(team);
  else if (tab === "members") teamMembers(team, manager);
  else if (tab === "access") teamAccess(team);
  else if (tab === "discover") teamDiscover(team);
  else teamSettings(team, s);
}

const fmtGap = (ms) => (ms > 0 ? "+" + (ms / 1000).toFixed(3) : "—");
function towerRows(rows, recs, mode) {
  const lead = rows[0].lap_time_ms;
  const mineOf = (r) => recs.find((x) => x.car === r.car && x.track === r.track);
  return rows.map((r, i) => { const mine = mineOf(r); const pos = r._pos || i + 1; return `
    <div class="trow ${pos === 1 ? "first" : ""} ${r.me ? "mine" : ""}">
      <span class="p">${pos}</span>
      <span class="tw">${avatar({ name: r.driver, avatar_url: r.avatar_url })}<span><b>${esc(r.driver)}${r.me ? " <em>você</em>" : ""}</b><small>${mode === "track" ? `${esc(pretty(r.car))} · ` : ""}${fmtDate(r.recorded_at)}</small></span></span>
      <b class="num t">${fmtLap(r.lap_time_ms)}</b>
      <span class="num gap">${pos > 1 ? fmtGap(r.lap_time_ms - (r._lead != null ? r._lead : lead)) : ""}</span>
      <span class="secs3 num">${[r.s1_ms, r.s2_ms, r.s3_ms].map(fmtSec).join(" · ")}</span>
      <span class="tags">${r.setup_name ? `<button class="tag2" data-setup="${r.id}" title="${esc(r.setup_name)}">⚙ setup</button>` : ""}${r.clip_url ? `<span class="tag2" title="Tem vídeo da volta">▶ vídeo</span>` : ""}</span>
      <span class="acts">${r.me ? "" : `<button class="btn xs" data-imp="${r.id}" data-mode="compare" data-a="${mine ? mine.lap_id : ""}">Analisar</button>
        <button class="btn xs" data-imp="${r.id}" data-mode="replay" data-a="${mine ? mine.lap_id : ""}">Replay</button>`}</span>
    </div>`; }).join("");
}
function bindTower(box) {
  box.querySelectorAll("[data-imp]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "Baixando…";
    try {
      const r = await postJ("/api/team/import", { id: b.dataset.imp });
      location.hash = b.dataset.a ? `#/${b.dataset.mode}?a=${b.dataset.a}&b=${r.lap_id}` : `#/${b.dataset.mode}?a=${r.lap_id}`;
    } catch (e) { b.textContent = e.message; }
  });
  box.querySelectorAll("[data-setup]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "Salvando…";
    try { const r = await postJ("/api/team/setup", { id: b.dataset.setup }); b.textContent = r.already ? "✓ já tinha" : "✓ salvo no ACC"; b.title = r.name; }
    catch (e) { b.textContent = e.message; }
  });
}
function comboGroups(rows, filter) {
  const g = {};
  for (const r of rows) {
    if (filter && filter.track && r.track !== filter.track) continue;
    if (filter && filter.car && r.car !== filter.car) continue;
    (g[r.track + "|" + r.car + "|" + r.game] = g[r.track + "|" + r.car + "|" + r.game] || []).push(r);
  }
  return Object.values(g);
}

async function teamBoard(team) {
  const box = $("#tMain");
  if (!box || !team) return;
  box.innerHTML = `<div class="sub">Carregando…</div>`;
  let data, recs;
  try { [data, recs] = await Promise.all([api(`/api/team/board/${team.id}`), api("/api/records")]); }
  catch (e) { box.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  $("#thMembers").innerHTML = `<div class="avstack">${data.members.slice(0, 8).map((m) => avatar(m)).join("")}</div>
    <span class="sub">${data.members.length} ${data.members.length === 1 ? "piloto" : "pilotos"}</span>`;
  const groups = comboGroups(data.laps);
  const tracks = [...new Set(data.laps.map((l) => l.track))].sort();
  const f = teamState.filter || { track: "" };
  box.innerHTML = groups.length ? `
    <div class="tfilter"><select id="tfTrack"><option value="">Todas as pistas</option>${tracks.map((t) => `<option value="${esc(t)}" ${t === f.track ? "selected" : ""}>${esc(pretty(t))}</option>`).join("")}</select></div>
    ${comboGroups(data.laps, f).map((g) => `<section class="combo2"><header><h2>${esc(pretty(g[0].track))}</h2><span class="sub">${esc(pretty(g[0].car))}${g[0].game !== "acc" ? " · " + esc(g[0].game) : ""}</span></header>
      <div class="tower2">${towerRows(g, recs)}</div></section>`).join("")}`
    : `<div class="panel empty">${CAR_SVG("var(--panel-2)")}<b>Ninguém enviou voltas ainda</b>Seus recordes sobem sozinhos quando você grava. Chame a turma em Convites e entrada.</div>`;
  const ft = $("#tfTrack");
  if (ft) ft.onchange = () => { teamState.filter = { track: ft.value }; teamBoard(team); };
  bindTower(box);
}

async function teamCommunity() {
  const box = $("#tMain");
  box.innerHTML = `<div class="sub">Carregando a comunidade…</div>`;
  let rows, recs;
  try { [rows, recs] = await Promise.all([api("/api/team/community"), api("/api/records")]); }
  catch (e) { box.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if ($("#thMembers")) $("#thMembers").innerHTML = "";
  if (!rows.length) { box.innerHTML = `<div class="panel empty"><b>Ninguém no ranking ainda</b>Seus recordes sobem sozinhos quando você grava no app.</div>`; return; }
  const F = teamState.cfilter = Object.assign({ track: "", car: "", user: "", more: false }, teamState.cfilter && teamState.cfilter.key === undefined ? teamState.cfilter : {});
  // filtros: pista, carro, piloto (todos combináveis)
  const trackOf = (r) => r.track + "|" + r.game;
  const opts = { tracks: {}, cars: {}, users: {} };
  for (const r of rows) {
    (opts.tracks[trackOf(r)] = opts.tracks[trackOf(r)] || { track: r.track, game: r.game, u: new Set() }).u.add(r.user_id);
    (opts.cars[r.car] = opts.cars[r.car] || new Set()).add(r.user_id);
    (opts.users[r.user_id] = opts.users[r.user_id] || { name: r.driver, n: 0 }).n++;
  }
  if (F.track && !opts.tracks[F.track]) F.track = "";
  if (F.car && !opts.cars[F.car]) F.car = "";
  if (F.user && !opts.users[F.user]) F.user = "";
  // por pista: a melhor volta de cada piloto (no carro filtrado, ou no carro em que foi mais rápido)
  const byTrack = {};
  for (const r of rows) {
    if (F.car && r.car !== F.car) continue;
    const k = trackOf(r);
    if (F.track && k !== F.track) continue;
    const g = (byTrack[k] = byTrack[k] || {});
    if (!g[r.user_id] || r.lap_time_ms < g[r.user_id].lap_time_ms) g[r.user_id] = r;
  }
  let sections = Object.entries(byTrack).map(([k, g]) => ({ k, t: opts.tracks[k], list: Object.values(g).sort((a, b) => a.lap_time_ms - b.lap_time_ms) }))
    .filter((x) => x.list.length).sort((a, b) => b.list.length - a.list.length || pretty(a.t.track).localeCompare(pretty(b.t.track)));
  if (F.user) sections = sections.filter((x) => x.list.some((r) => r.user_id === F.user));
  const total = sections.length, single = !!F.track;
  const shown = single || F.more ? sections : sections.slice(0, 12);
  const pilots = new Set(rows.map((r) => r.user_id));
  const sectionHtml = (x) => {
    const lead = x.list[0].lap_time_ms;
    const withPos = x.list.map((r, i) => ({ ...r, _pos: i + 1, _lead: lead }));
    const cap = single ? 100 : 10;
    let view_ = F.user ? withPos.filter((r) => r.user_id === F.user) : withPos.slice(0, cap);
    const mine = withPos.find((r) => r.me);
    if (!F.user && mine && mine._pos > cap) view_ = [...view_, mine];
    const myPos = mine ? mine._pos : 0;
    return `<section class="combo2"><header><h2>${esc(pretty(x.t.track))}${x.t.game !== "acc" ? " · " + esc(x.t.game) : ""}</h2>
      <span class="sub">${x.list.length} ${x.list.length === 1 ? "piloto" : "pilotos"}${F.car ? " · " + esc(pretty(F.car)) : " · cada um com o carro da sua melhor volta"}${myPos ? ` · você em ${myPos}º` : ""}</span>
      ${single ? "" : `<button class="btn xs" data-only="${esc(x.k)}">Ver só esta pista</button>`}</header>
      <div class="tower2">${towerRows(view_, recs, "track")}</div>
      ${!single && !F.user && x.list.length > cap ? `<div class="sub" style="margin-top:6px">+ ${x.list.length - cap} pilotos · <a class="lnk" href="#" data-only="${esc(x.k)}">ver todos</a></div>` : ""}</section>`;
  };
  const sel = (id, label, optsHtml) => `<label class="stack2"><span class="sub">${label}</span><select id="${id}">${optsHtml}</select></label>`;
  box.innerHTML = `
    <div class="comm-sum"><b>${pilots.size} ${pilots.size === 1 ? "piloto" : "pilotos"}</b> · ${Object.keys(opts.tracks).length} pistas · ${Object.keys(opts.cars).length} carros · ${rows.length} recordes</div>
    <div class="tfilter">
      ${sel("cfTrack", "Pista", `<option value="">Todas as pistas</option>` + Object.entries(opts.tracks).sort((a, b) => b[1].u.size - a[1].u.size || pretty(a[1].track).localeCompare(pretty(b[1].track))).map(([k, t]) => `<option value="${esc(k)}" ${k === F.track ? "selected" : ""}>${esc(pretty(t.track))}${t.game !== "acc" ? " · " + esc(t.game) : ""} (${t.u.size})</option>`).join(""))}
      ${sel("cfCar", "Carro", `<option value="">Todos os carros</option>` + Object.entries(opts.cars).sort((a, b) => b[1].size - a[1].size || pretty(a[0]).localeCompare(pretty(b[0]))).map(([c, u]) => `<option value="${esc(c)}" ${c === F.car ? "selected" : ""}>${esc(pretty(c))} (${u.size})</option>`).join(""))}
      ${sel("cfUser", "Piloto", `<option value="">Todos os pilotos</option>` + Object.entries(opts.users).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, u]) => `<option value="${esc(id)}" ${id === F.user ? "selected" : ""}>${esc(u.name)} (${u.n})</option>`).join(""))}
      ${F.track || F.car || F.user ? `<button class="btn sm" id="cfClear">Limpar filtros</button>` : ""}</div>
    ${shown.length ? shown.map(sectionHtml).join("") : `<div class="panel empty"><b>Nenhum tempo com esses filtros</b></div>`}
    ${!single && !F.more && total > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn" id="cfMore">Mostrar as outras ${total - shown.length} pistas</button></div>` : ""}`;
  const set = (v) => { teamState.cfilter = Object.assign({}, F, v); teamCommunity(); };
  $("#cfTrack").onchange = (e) => set({ track: e.target.value, more: false });
  $("#cfCar").onchange = (e) => set({ car: e.target.value });
  $("#cfUser").onchange = (e) => set({ user: e.target.value });
  if ($("#cfClear")) $("#cfClear").onclick = () => set({ track: "", car: "", user: "", more: false });
  if ($("#cfMore")) $("#cfMore").onclick = () => set({ more: true });
  box.querySelectorAll("[data-only]").forEach((b) => b.onclick = (e) => { e.preventDefault(); set({ track: b.dataset.only }); });
  bindTower(box);
}

// ---- membros e cargos
async function teamMembers(team, manager) {
  const box = $("#tMain");
  box.innerHTML = `<div class="sub">Carregando…</div>`;
  let data, mg = { requests: [], invites: [] };
  try {
    data = await api(`/api/team/board/${team.id}`);
    if (manager) mg = await api(`/api/team/manage/${team.id}`).catch(() => mg);
  } catch (e) { box.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  const owner = team.role === "owner";
  const order = { owner: 0, admin: 1, member: 2 };
  const members = data.members.slice().sort((a, b) => order[a.role] - order[b.role] || String(a.joined_at).localeCompare(String(b.joined_at)));
  box.innerHTML = `
    ${mg.requests.length ? `<div class="panel" style="margin-bottom:14px"><h2>Pedidos para entrar <span class="tag pw">${mg.requests.length}</span></h2>
      ${mg.requests.map((r) => `<div class="mrow">${avatar(r)}<div class="mname"><b>${esc(r.name)}</b><small>pediu ${agoText(r.created_at)}</small></div><span class="spacer"></span>
        <button class="btn primary xs" data-ans="${r.user_id}" data-acc="1">Aceitar</button><button class="btn xs" data-ans="${r.user_id}" data-acc="0">Recusar</button></div>`).join("")}</div>` : ""}
    <div class="panel"><h2>${members.length} ${members.length === 1 ? "membro" : "membros"}</h2>
      ${members.map((m) => `<div class="mrow">${avatar(m)}
        <div class="mname"><b>${esc(m.name)}${m.me ? " <em>você</em>" : ""}</b><small>desde ${fmtDate(m.joined_at)}</small></div>
        <span class="role ${m.role}">${ROLE_NAME[m.role]}</span><span class="spacer"></span>
        ${m.me || m.role === "owner" ? "" : `
          ${owner ? `<button class="btn xs" data-role="${m.user_id}" data-to="${m.role === "admin" ? "member" : "admin"}">${m.role === "admin" ? "Tirar de líder" : "Tornar líder"}</button>` : ""}
          ${owner ? `<button class="btn xs" data-own="${m.user_id}" title="Você vira líder">Passar a equipe</button>` : ""}
          ${manager && (owner || m.role !== "admin") ? `<button class="btn xs danger" data-kick="${m.user_id}">Remover</button>` : ""}`}
      </div>`).join("")}
      <p class="note">Dono: tudo, inclusive cargos e apagar. Líder: convida, aceita pedidos, remove pilotos e edita a equipe. Piloto: grava, compara e vê o ranking.</p></div>`;
  const confirmBtn = (b, label, fn) => b.onclick = async () => {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = label; return; }
    b.disabled = true;
    try { await fn(); renderTeam("members"); } catch (e) { b.textContent = e.message; }
  };
  box.querySelectorAll("[data-ans]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await postJ("/api/team/answer-request", { team_id: team.id, user_id: b.dataset.ans, accept: b.dataset.acc === "1" }); renderTeam("members"); }
    catch (e) { b.textContent = e.message; }
  });
  box.querySelectorAll("[data-role]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await postJ("/api/team/role", { team_id: team.id, user_id: b.dataset.role, role: b.dataset.to }); renderTeam("members"); }
    catch (e) { b.textContent = e.message; }
  });
  box.querySelectorAll("[data-own]").forEach((b) => confirmBtn(b, "Confirmar: você deixa de ser dono", () => postJ("/api/team/transfer", { team_id: team.id, user_id: b.dataset.own })));
  box.querySelectorAll("[data-kick]").forEach((b) => confirmBtn(b, "Confirmar remoção", () => postJ("/api/team/remove-member", { team_id: team.id, user_id: b.dataset.kick })));
  $("#thMembers").innerHTML = `<div class="avstack">${data.members.slice(0, 8).map((m) => avatar(m)).join("")}</div>`;
}

// ---- convites (e-mail e link) e como a equipe aceita gente
async function teamAccess(team) {
  const box = $("#tMain");
  box.innerHTML = `<div class="sub">Carregando…</div>`;
  let mg = { requests: [], invites: [] };
  try { mg = await api(`/api/team/manage/${team.id}`); } catch (e) { /* tabela ainda não criada */ }
  const link = team.invite_link;
  const mailto = (email) => `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Convite para a equipe " + team.name + " no Pitwall")}&body=${encodeURIComponent(`Oi! Te convidei para a equipe ${team.name} no Pitwall (telemetria e ranking de voltas).\n\nAbra o link, entre com o Google e pronto:\n${link}\n\nSe preferir, é só entrar no app/site com este e-mail que o convite já aparece lá.`)}`;
  box.innerHTML = `
    <div class="mgrid">
      <div class="panel"><h2>Convidar por e-mail</h2>
        <div class="row"><input id="tMail" class="inp" type="email" placeholder="amigo@exemplo.com"><button class="btn primary sm" id="tMailBtn">Convidar</button></div>
        <div class="sub" id="tMailOut">O convite fica esperando a pessoa entrar com esse e-mail no app ou no site. Você também pode mandar o link por e-mail.</div>
        ${mg.invites.length ? `<div class="invlist">${mg.invites.map((i) => `<div class="mrow"><div class="mname"><b>${esc(i.email)}</b><small>convidado ${agoText(i.created_at)} · aguardando</small></div>
          <span class="spacer"></span><a class="btn xs" href="${mailto(i.email)}">Enviar e-mail</a><button class="btn xs" data-cinv="${i.id}">Cancelar</button></div>`).join("")}</div>` : ""}
      </div>
      <div class="panel"><h2>Link de convite</h2>
        <code class="invcode">${esc(link)}</code>
        <div class="row"><button class="btn primary sm" id="tInvCopy">Copiar link</button>
          <button class="btn sm" id="tInvNew" title="O link antigo para de funcionar">Gerar novo</button></div>
        <p class="sub">Quem abrir o link entra com o Google e já fica na equipe, em qualquer modo.</p></div>
      <div class="panel"><h2>Quem pode entrar</h2>
        <div class="modes">${Object.entries(MODE_INFO).map(([k, [t, d]]) => `<label class="mode ${team.join_mode === k ? "on" : ""}"><input type="radio" name="tMode" value="${k}" ${team.join_mode === k ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}</div>
        <label class="stack">Descrição (aparece na lista de equipes)<input id="tDesc" class="inp" maxlength="200" placeholder="Ex.: Equipe de GT3 no ACC, corridas às quartas" value="${esc(team.description || "")}"></label>
        <div class="row"><button class="btn sm" id="tOptSave">Salvar</button><span class="sub" id="tOptOut"></span></div></div>
      <div class="panel"><h2>Logo e nome</h2>
        <div class="row" style="gap:16px">${teamLogo(team, "xl")}
          <div style="flex:1;display:grid;gap:8px">
            <label class="btn sm" style="justify-self:start">Enviar imagem<input type="file" id="tLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label>
            <div class="row"><input id="tLogoUrl" class="inp" placeholder="ou cole o link da imagem (https://…)" value="${esc(team.logo_url && !team.logo_url.includes("/storage/") ? team.logo_url : "")}">
              <button class="btn sm" id="tLogoSave">Usar link</button></div>
            <span class="sub" id="tLogoOut">PNG, JPG, WEBP ou SVG até 2 MB.</span></div></div>
        <label class="stack" style="margin-top:12px">Nome da equipe<input id="tName" class="inp" maxlength="60" value="${esc(team.name)}"></label>
        <div class="row"><button class="btn sm" id="tNameSave">Salvar nome</button><span class="sub" id="tNameOut"></span></div></div>
    </div>`;
  $("#tMailBtn").onclick = async () => {
    const out = $("#tMailOut"), email = $("#tMail").value.trim();
    out.textContent = "Convidando…";
    try {
      const r = await postJ("/api/team/invite-email", { team_id: team.id, email });
      out.innerHTML = `Convite criado para <b>${esc(r.email)}</b>. ${r.already_has_account ? "Essa pessoa já usa o Pitwall e vai ver o convite ao abrir." : "Ela vê o convite ao entrar com esse e-mail."}
        <a class="lnk" href="${mailto(r.email)}">Enviar o e-mail agora</a>`;
      $("#tMail").value = "";
      setTimeout(() => teamAccess(team), 4000);
    } catch (e) { out.textContent = e.message; }
  };
  box.querySelectorAll("[data-cinv]").forEach((b) => b.onclick = async () => { await postJ("/api/team/cancel-invite", { id: b.dataset.cinv }); teamAccess(team); });
  $("#tInvCopy").onclick = () => { try { navigator.clipboard.writeText(link); } catch (e) { /* ok */ } $("#tInvCopy").textContent = "Copiado"; };
  $("#tInvNew").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "O antigo para. Confirmar?"; return; }
    await postJ("/api/team/invite", { team_id: team.id }); renderTeam("access");
  };
  $("#tOptSave").onclick = async () => {
    const mode = (box.querySelector("input[name=tMode]:checked") || {}).value;
    $("#tOptOut").textContent = "Salvando…";
    try { await postJ("/api/team/options", { team_id: team.id, values: { join_mode: mode, description: $("#tDesc").value } }); renderTeam("access"); }
    catch (e) { $("#tOptOut").textContent = e.message; }
  };
  $("#tNameSave").onclick = async () => {
    $("#tNameOut").textContent = "Salvando…";
    try { await postJ("/api/team/options", { team_id: team.id, values: { name: $("#tName").value } }); renderTeam("access"); }
    catch (e) { $("#tNameOut").textContent = e.message; }
  };
  const lf = $("#tLogoFile");
  lf.onchange = async () => {
    const file = lf.files[0]; if (!file) return;
    $("#tLogoOut").textContent = "Enviando…";
    try {
      const r = await fetch(`/api/team/logo?team_id=${encodeURIComponent(team.id)}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      renderTeam("access");
    } catch (e) { $("#tLogoOut").textContent = e.message; }
  };
  $("#tLogoSave").onclick = async () => {
    $("#tLogoOut").textContent = "Salvando…";
    try { await postJ("/api/team/logo", { team_id: team.id, url: $("#tLogoUrl").value }); renderTeam("access"); }
    catch (e) { $("#tLogoOut").textContent = e.message; }
  };
}

// ---- descobrir equipes, entrar por código, criar
async function teamDiscover(team) {
  const box = $("#tMain");
  box.innerHTML = `<div class="sub">Carregando…</div>`;
  let list = [], err = "";
  try { list = await api("/api/team/discover"); } catch (e) { err = e.message; }
  const lbl = { open: "Entrar", request: "Pedir para entrar" };
  box.innerHTML = `
    <div class="mgrid">
      <div class="panel wide"><h2>Equipes abertas</h2>
        ${err ? `<div class="note warn">${esc(err)}</div>` : list.length ? list.map((t) => `<div class="mrow">${teamLogo(t)}
          <div class="mname"><b>${esc(t.name)}</b><small>${t.members} ${t.members === 1 ? "piloto" : "pilotos"} · ${(MODE_INFO[t.join_mode] || [""])[0]}${t.description ? " · " + esc(t.description) : ""}</small></div><span class="spacer"></span>
          ${t.my_status === "member" ? `<span class="tag ok">Você está</span>` : t.my_status === "pending" ? `<span class="tag pw">Aguardando aprovação</span>`
            : `<button class="btn primary xs" data-lst="${t.id}">${lbl[t.join_mode]}</button>`}</div>`).join("")
          : `<div class="sub">Nenhuma equipe aberta ainda. Quem deixar a equipe como “Aberta” ou “Por aprovação” aparece aqui.</div>`}</div>
      <div class="panel"><h2>Entrar com um convite</h2>
        <div class="row"><input id="tJoin" class="inp" placeholder="Cole o link ou o código do convite"><button class="btn primary sm" id="tJoinBtn">Entrar</button></div>
        <span class="sub" id="tJoinOut"></span></div>
      <div class="panel"><h2>Criar uma equipe</h2>
        <div class="row"><input id="tNew" class="inp" placeholder="Nome da equipe"><button class="btn sm" id="tNewBtn">Criar</button></div>
        <span class="sub" id="tNewOut">Quem cria vira dono e escolhe depois como a equipe aceita gente.</span></div>
    </div>`;
  box.querySelectorAll("[data-lst]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "Enviando…";
    try {
      const r = await postJ("/api/team/join-listed", { team_id: b.dataset.lst });
      if (r.status === "joined") { teamState.sel = r.team.id; renderTeam("ranking"); } else renderTeam("discover");
    } catch (e) { b.textContent = e.message; }
  });
  $("#tJoinBtn").onclick = async () => {
    $("#tJoinOut").textContent = "Entrando…";
    try { const r = await postJ("/api/team/join", { code: $("#tJoin").value }); teamState.sel = (r.team || r).id; renderTeam("ranking"); }
    catch (e) { $("#tJoinOut").textContent = e.message; }
  };
  $("#tNewBtn").onclick = async () => {
    $("#tNewOut").textContent = "Criando…";
    try { const t = await postJ("/api/team/create", { name: $("#tNew").value }); teamState.sel = t.id; renderTeam("access"); }
    catch (e) { $("#tNewOut").textContent = e.message; }
  };
}

// ---- ajustes do envio e sair
function teamSettings(team, s) {
  const box = $("#tMain");
  box.innerHTML = `
    <div class="mgrid">
      <div class="panel fuel"><h2>O que vai para a nuvem</h2>
        <label>Enviar meus recordes automaticamente <input id="tAuto" class="tgl" type="checkbox" ${s.team_auto_upload ? "checked" : ""}></label>
        <label>Enviar o setup usado junto <input id="tSetup" class="tgl" type="checkbox" ${s.team_share_setup ? "checked" : ""}></label>
        <label>Enviar um clipe de vídeo da volta (720p) <input id="tClip" class="tgl" type="checkbox" ${s.team_share_clip ? "checked" : ""}></label>
        <p class="sub">É automático: ao abrir o app, ao entrar numa equipe e a cada recorde novo, sobe o seu melhor tempo de cada carro em cada pista. Aparece para a sua equipe e no ranking da comunidade. O setup só vai se você marcou na sessão qual usou.</p></div>
      ${team ? `<div class="panel"><h2>Sair da equipe</h2>
        ${team.role === "owner" ? `<p class="sub">Você é o dono: passe a equipe para outra pessoa em Membros antes de sair.</p>` : `<button class="btn danger sm" id="tLeave">Sair de ${esc(team.name)}</button><span class="sub" id="tLeaveOut"></span>`}</div>` : ""}
    </div>`;
  const put = (v) => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
  $("#tAuto").onchange = () => put({ team_auto_upload: $("#tAuto").checked });
  $("#tSetup").onchange = () => put({ team_share_setup: $("#tSetup").checked });
  $("#tClip").onchange = () => put({ team_share_clip: $("#tClip").checked });
  const lv = $("#tLeave");
  if (lv) lv.onclick = async () => {
    if (lv.dataset.confirm !== "1") { lv.dataset.confirm = "1"; lv.textContent = "Confirmar saída"; return; }
    try { await postJ("/api/team/leave", { team_id: team.id }); teamState.sel = null; renderTeam("discover"); }
    catch (e) { $("#tLeaveOut").textContent = e.message; }
  };
}

function teamLogin(st) {
  view.innerHTML = `
    <div class="login">
      <div class="panel login-card">
        <h1>Equipe</h1>
        <p class="sub">Entre com a sua conta Google para comparar voltas com os amigos. É a mesma conta do site do Pitwall.</p>
        <button class="btn google" id="tLogin"><svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Entrar com Google</button>
        <div class="sub" id="tLoginOut" style="margin-top:12px"></div>
        <ul class="feat">
          <li>Ranking da equipe em cada pista e carro</li>
          <li>Análise e replay contra a volta do amigo</li>
          <li>Convite por link: o amigo entra com o Google e já está dentro</li>
          <li>Ranking da comunidade com todos os pilotos do Pitwall</li>
        </ul>
      </div>
    </div>`;
  $("#tLogin").onclick = async () => {
    const r = await postJ("/api/team/login");
    if (!r.opened) window.open(r.url, "_blank");
    $("#tLoginOut").innerHTML = `Termine o login no navegador que abriu. Esta tela atualiza sozinha.<br>
      <a class="lnk" href="${esc(r.url)}" target="_blank" rel="noopener">Não abriu? Clique aqui</a>`;
    const poll = async () => {
      if (current.name !== "team") return;
      try { const s2 = await api("/api/team/status"); if (s2.logged_in) return renderTeam(); } catch (e) { /* ok */ }
      teamState.polling = setTimeout(poll, 1500);
    };
    poll();
  };
}

// ---------------------------------------------------------------- delta ao vivo (janela pequena por cima do jogo)
let overlayTimer = null;
function renderOverlay() {
  current = { name: "overlay" };
  document.body.classList.add("overlay");
  view.innerHTML = `<div class="ov" id="ov">
    <div class="ov-d num" id="ovD">—</div>
    <div class="ov-row"><span id="ovRef">aguardando…</span><span class="num" id="ovPred"></span></div>
    <div class="ov-row"><span class="num" id="ovFuel"></span><span class="num" id="ovEnd"></span></div></div>`;
  const tick = async () => {
    try {
      const l = await api("/api/live");
      const d = l.delta_ms, el = $("#ovD");
      if (!el) return;
      if (l.state !== "recording") { el.textContent = "—"; el.className = "ov-d num"; $("#ovRef").textContent = "aguardando o jogo…"; }
      else {
        el.textContent = d == null ? (l.in_pit_lane ? "BOX" : "—") : fmtDelta(d);
        el.className = "ov-d num " + (d == null ? "" : d > 0 ? "slow" : "fast");
        $("#ovRef").textContent = l.ref_kind ? (l.ref_kind === "ideal" ? "vs volta ideal " : "vs recorde ") + fmtLap(l.ref_ms) : "sem referência ainda";
        $("#ovPred").textContent = l.predicted_ms ? "prev. " + fmtLap(l.predicted_ms) : "";
        $("#ovFuel").textContent = l.fuel_laps != null ? `⛽ ${String(l.fuel_laps).replace(".", ",")} voltas` : "";
        const fe = l.fuel_to_end;
        $("#ovEnd").textContent = fe == null ? "" : fe > 0 ? `falta ${String(fe).replace(".", ",")} L` : `sobra ${String(-fe).replace(".", ",")} L`;
        $("#ovEnd").className = "num " + (fe > 0 ? "slow" : "fast");
      }
    } catch (e) { /* reiniciando */ }
    overlayTimer = setTimeout(tick, 100);
  };
  tick();
}
async function openOverlay() {
  let r = { window: false };
  try { r = await api("/api/ui/overlay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show: true }) }); } catch (e) { /* ok */ }
  if (!r.window) window.open("#/overlay", "pitwall-delta", "width=380,height=150");
}

// ---------------------------------------------------------------- Overlays (ferramenta completa: palco + um overlay por vez)
const OV_NAMES = [["map", "Mapa"], ["pedals", "Pedais"], ["standings", "Participantes"], ["tyres", "Pneus"], ["corner", "Curva"], ["delta", "Delta"]];
const OV_TITLE = { map: "Mapa da pista", pedals: "Pedais", standings: "Participantes", tyres: "Pneus", corner: "Próxima curva", delta: "Delta da volta" };
const OV_ICON = {
  map: '<path d="M4 15c3-9 6 3 9-5s5 2 7-2"/><circle cx="19" cy="6" r="1.6"/>',
  pedals: '<path d="M3 20V9M9 20V5M15 20v-8M21 20V8"/>',
  standings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="7" cy="6" r=".6"/>',
  delta: '<path d="M12 4l8 15H4z"/>',
  tyres: '<rect x="7" y="3" width="10" height="18" rx="4"/><path d="M7 9h10M7 15h10"/>',
  corner: '<path d="M7 20V11a5 5 0 0 1 5-5h6"/><path d="M15 2l4 4-4 4"/>',
};
const OV_MODE_TXT = { off: "Desligado", game: "Só na pista", always: "Sempre aberto" };
const OV_COLS = [["pos", "Posição"], ["number", "Nº do carro"], ["name", "Piloto"], ["cls", "Classe"], ["vs_me", "Δ para mim"],
  ["interval", "Intervalo p/ o da frente"], ["gap_leader", "Dif. p/ o líder"], ["last", "Última volta"], ["best", "Melhor volta"],
  ["laps", "Voltas"], ["pit", "Box"]];
OV_COLS.splice(3, 0, ["car", "Carro (símbolo / abreviação)"]);
OV_COLS.splice(6, 0, ["trend", "Tendência (aproximando / afastando)"]);

// peças da tela de opções
const ovChip = (n, k, label, v, tip) => `<button type="button" class="ovchip ${v ? "on" : ""}" data-ov="${n}" data-k="${k}" data-chip="1" title="${esc(tip || "")}"><i></i>${label}</button>`;
const ovSeg = (n, k, opts, val, num) => `<div class="ovseg">${opts.map(([v, t]) => `<button type="button" class="${String(val) === String(v) ? "on" : ""}" data-ov="${n}" data-k="${k}" data-val="${v}" ${num ? 'data-num="1"' : ""}>${t}</button>`).join("")}</div>`;
const ovSlider = (n, k, label, v, min, max, step, unit) => `<label class="ovslide"><span>${label}</span><input type="range" data-ov="${n}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-unit="${unit}">${v}${unit}</output></label>`;
const ovGroup = (title, body, hint) => `<section class="ovg"><h3>${title}${hint ? `<small>${hint}</small>` : ""}</h3>${body}</section>`;

function ovPanel(n, S) {
  const c = S.overlays[n];
  let g = "";
  g += ovGroup("Quando aparece", ovSeg(n, "mode", [["off", "Desligado"], ["game", "Só na pista"], ["always", "Sempre aberto"]], c.mode),
    c.mode === "game" ? "abre ao entrar numa sessão e fecha ao sair" : "");
  g += ovGroup("Tamanho e fundo", ovSlider(n, "scale", "Tamanho", c.scale, 50, 250, 5, "%") + ovSlider(n, "bg", "Fundo", c.bg, 0, 90, 5, "%"), "fundo 0% = transparente");
  if (n === "map") {
    g += ovGroup("Estilo da pista", ovSeg(n, "mapstyle", [["asphalt", "Asfalto"], ["thin", "Fino"], ["classic", "Clássico"]], c.mapstyle || "asphalt"),
      "o Fino é uma linha só, discreta");
    g += ovGroup("Modo do mapa", ovSeg(n, "mapmode", [["full", "Pista inteira"], ["follow", "Seguir o carro"], ["follow_rot", "Seguir e girar"]], c.mapmode || "full") +
      ovSlider(n, "fzoom", "Aproximação (seguindo)", c.fzoom || 350, 150, 900, 10, "%"),
      "“Seguir e girar” mantém a frente do carro sempre para cima");
    g += ovGroup("Mostrar no mapa", `<div class="ovchips">${ovChip(n, "banner", "Nome da bandeira", c.banner, "Etiqueta com a bandeira em vigor")}
      ${ovChip(n, "cars", "Outros carros", c.cars, "No ACC precisa do broadcasting ligado (padrão do jogo)")}
      ${ovChip(n, "numbers", "Nº dentro das bolinhas", c.numbers)}${ovChip(n, "sectors", "Setores", c.sectors)}
      ${ovChip(n, "corners", "Nº das curvas", c.corners, "Numeradas como na Análise; precisa de ao menos uma volta gravada na pista")}
      ${ovChip(n, "corner_now", "Curva atual", c.corner_now, "Etiqueta com o número e o nome da curva em que você está")}
      ${ovChip(n, "brakepts", "Pontos de frenagem", c.brakepts, "Marca vermelha na pista onde você começa a frear no seu melhor tempo")}</div>`,
      "a pista muda de cor com as bandeiras");
    g += ovGroup("Ajustes", ovSlider(n, "width", "Espessura da pista", c.width, 4, 16, 1, " px") +
      `<div class="ovslide"><span>Girar o mapa</span>${ovSeg(n, "rotate", [[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]], c.rotate, true)}</div>`);
    g += `<details class="ovg cnames" id="cnBox"><summary>Dar nome às curvas</summary>
        <div class="sub" style="margin:6px 0">O jogo não informa os nomes das curvas: escreva o que quiser (ex.: “Eau Rouge”). A numeração é a da Análise e pode diferir da oficial.</div>
        <select id="cnTrack"><option value="">Escolha a pista…</option></select><div id="cnList" style="margin-top:8px"></div></details>`;
  } else if (n === "corner") {
    g += ovGroup("Mostrar", `<div class="ovchips">${ovChip(n, "dist", "Distância até a curva", c.dist)}
      ${ovChip(n, "brakepoint", "Ponto de frenagem", c.brakepoint, "Contagem regressiva até o ponto onde você começa a frear no seu melhor tempo desta pista")}
      ${ovChip(n, "speed", "Velocidades (mínima e entrada)", c.speed)}${ovChip(n, "next", "Curva seguinte", c.next)}${ovChip(n, "name", "Nome da curva", c.name, "Os nomes são os que você escreveu no mapa")}</div>`);
    g += ovGroup("Aviso de frenagem", ovSlider(n, "lead", "Começar a contar a", c.lead, 100, 500, 10, " m"),
      "a barra enche conforme você chega ao ponto de frenagem");
    g += `<p class="sub" style="margin:8px 0 0">As curvas, o lado delas e o ponto de frenagem vêm do seu melhor tempo no carro e na pista (o ACC e o iRacing não informam isso). Grave uma volta limpa na pista para o overlay aprender. O ponto é onde você começou a frear nessa volta: não é um cálculo de frenagem ideal.</p>`;
  } else if (n === "pedals") {
    g += ovGroup("Mostrar", `<div class="ovchips">${ovChip(n, "coast", "Sem pedal", c.coast, "Faixa âmbar quando você não pisa em nenhum dos dois, e a porcentagem do tempo")}
      ${ovChip(n, "bars", "Barras", c.bars)}${ovChip(n, "wheel", "Roda do volante", c.wheel, "Desenho do volante que gira junto com o seu")}${ovChip(n, "steer", "Volante no gráfico", c.steer)}${ovChip(n, "gear", "Marcha", c.gear)}${ovChip(n, "speed", "Velocidade", c.speed)}</div>`);
    g += ovGroup("Gráfico", ovSlider(n, "seconds", "Janela de tempo", c.seconds, 3, 20, 1, " s"));
  } else if (n === "standings") {
    g += ovGroup("Quais pilotos", ovSeg(n, "view", [["around", "Em volta de mim"], ["top", "Os primeiros"]], c.view) + ovSlider(n, "rows", "Linhas", c.rows, 3, 30, 1, ""));
    g += ovGroup("Velocidade da tendência", ovSeg(n, "trend_secs", [[8, "Rápida · 8 s"], [25, "Normal · 25 s"], [60, "Lenta · 60 s"]], c.trend_secs, true) +
      ovSlider(n, "trend_secs", "Janela de cálculo", c.trend_secs, 5, 90, 1, " s"),
      "menor = reage mais rápido (e oscila mais); maior = mais estável");
    g += ovGroup("Tendência do intervalo", `<div class="ovchips">${ovChip(n, "trendcolor", "Colorir as diferenças (Δ para mim e À frente)", c.trendcolor, "Verde: você está se aproximando de quem está à frente ou se afastando de quem está atrás. Vermelho: o contrário")}</div>
      <p class="sub" style="margin:8px 0 0">Compara a distância de cada carro até você nos últimos ~25 segundos. <b style="color:#4be58f">Verde</b>: você está chegando em quem está à frente, ou abrindo para quem está atrás. <b style="color:#ff5a64">Vermelho</b>: quem está à frente está abrindo, ou quem está atrás está chegando. Cinza: distância estável. Na coluna “À frente”: verde quando o carro está chegando no da frente dele (e você chegando no seu), vermelho quando ele abre; para quem está atrás de você é o contrário, vermelho quando ele está chegando no pelotão à frente (ameaça para você). Para ver o número (segundos por volta), ligue a coluna “Tendência”.</p>`);
    g += ovGroup("Cabeçalho e classes", `<div class="ovchips">${ovChip(n, "header", "Tempo e volta", c.header, "Tempo restante da sessão, volta atual e número de pilotos")}
      ${ovChip(n, "group", "Separar por classe", c.group, "Quando há mais de uma classe de carro (GT3, GT4…)")}
      ${ovChip(n, "classpos", "Posição na classe", c.classpos, "Com as classes separadas, mostra a posição dentro da classe")}</div>` +
      ovSlider(n, "others", "Linhas das outras classes", c.others, 1, 10, 1, ""));
    g += ovGroup("Carro (coluna Carro)", ovSeg(n, "carstyle", [["both", "Símbolo e texto"], ["logo", "Só o símbolo"], ["text", "Só o texto"]], c.carstyle),
      "escolher um estilo liga a coluna Carro; marcas sem símbolo aparecem em texto");
    g += ovGroup("Aparência do símbolo", ovSeg(n, "logomode", [["color", "Colorido (logo original)"], ["mono", "Branco, sem cor"], ["chip", "Com etiqueta clara"]], c.logomode || "color"),
      "colorido e branco ficam sem fundo; só a etiqueta clara tem fundo");
    g += ovGroup("Nome do piloto", ovSeg(n, "name", [["short", "Sigla"], ["last", "Sobrenome"], ["full", "Nome completo"]], c.name));
    g += ovGroup("Colunas", `<div class="ovchips">${OV_COLS.map(([k, t]) => `<button type="button" class="ovchip ${c.cols.includes(k) ? "on" : ""}" data-col="${k}"><i></i>${t}</button>`).join("")}</div>
      <p class="sub" style="margin:8px 0 0">Nos tempos de diferença, “−” é quem está à frente de você e “+” quem está atrás. Na corrida a diferença vem da distância na pista; no treino e na classificação, da melhor volta de cada um. Roxo = a melhor volta da sessão (da classe, se houver mais de uma); na coluna Última, roxo mostra quem acabou de fazer a melhor volta e verde, quem acabou de fazer a melhor dele.</p>`);
  } else if (n === "tyres") {
    g += ovGroup("Mostrar", `<div class="ovchips">${ovChip(n, "temp", "Temperatura", c.temp, "Temperatura do núcleo do pneu; a cor mostra se está fria, ideal ou quente")}
      ${ovChip(n, "press", "Pressão", c.press, "A cor mostra se está abaixo, dentro ou acima da faixa ideal")}
      ${ovChip(n, "brake", "Freio (temperatura)", c.brake, "Temperatura do disco de freio de cada roda, com barra e cor de status")}
      ${ovChip(n, "pads", "Pastilhas", c.pads, "Vida restante da pastilha em mm (só o ACC informa)")}
      ${ovChip(n, "wear", "Desgaste", c.wear, "Quanto resta de cada pneu (o ACC não informa o desgaste; o iRacing sim)")}
      ${ovChip(n, "compound", "Composto", c.compound)}
      ${ovChip(n, "weather", "Clima (agora, 10 e 30 min)", c.weather, "Previsão de chuva e estado da pista, como no widget do ACC (a previsão só o ACC informa)")}</div>`);
    g += ovGroup("Estilo", ovSeg(n, "tystyle", [["acc", "Como o ACC (vista de cima)"], ["cards", "Cartões"]], c.tystyle || "acc"));
    g += ovGroup("Unidade da pressão", ovSeg(n, "punit", [["psi", "psi"], ["bar", "bar"]], c.punit));
    g += ovGroup("Faixa ideal", ovSlider(n, "tmin", "Temp. mínima", c.tmin, 40, 120, 1, " °C") + ovSlider(n, "tmax", "Temp. máxima", c.tmax, 50, 140, 1, " °C") +
      ovSlider(n, "pmin", "Pressão mínima", c.pmin, 20, 35, 0.1, " psi") + ovSlider(n, "pmax", "Pressão máxima", c.pmax, 20, 35, 0.1, " psi") +
      ovSlider(n, "bmin", "Freio mínimo", c.bmin, 100, 700, 10, " °C") + ovSlider(n, "bmax", "Freio máximo", c.bmax, 400, 1100, 10, " °C"),
      "abaixo = azul, dentro = verde, acima = vermelho") .replace("</section>", `<div class="ovreset"><button type="button" class="btn sm" id="tyReset">Restaurar padrão</button>
        <span class="sub">Padrão do ACC (1.9 em diante, todas as classes): 70–100 °C e 26,0–27,0 psi com o pneu quente. No iRacing a faixa muda de carro para carro: ajuste à mão. A faixa do freio (350–800 °C) é uma estimativa minha, sem fonte oficial: ajuste ao seu carro.</span></div></section>`);
  } else if (n === "delta") {
    g += ovGroup("Comparar contra", ovSeg("", "ref", [["pb", "Seu recorde"], ["ideal", "Volta ideal"]], S.overlay_reference));
    g += ovGroup("Mostrar", `<div class="ovchips">${ovChip(n, "predicted", "Tempo previsto", c.predicted)}${ovChip(n, "fuel", "Combustível", c.fuel, "Voltas restantes e quanto falta/sobra até o fim")}</div>`);
  }
  return `<div class="ovp-head"><span class="ovp-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${OV_ICON[n]}</svg></span>
    <div><h2>${OV_TITLE[n]}</h2><div class="sub">${OV_MODE_TXT[c.mode]}</div></div></div>${g}`;
}

async function renderOverlays() {
  current = { name: "overlays" };
  view.classList.add("wide");
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let S;
  try { S = (await api("/api/settings")).settings; } catch (e) { view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if (current.name !== "overlays") return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sw = screen.width || 1920, sh = screen.height || 1080;
  const defPos = { map: [sw - 460, 60], pedals: [Math.round(sw / 2 - 260), sh - 260], standings: [24, 180], delta: [Math.round(sw / 2 - 190), 36], tyres: [24, sh - 330], corner: [Math.round(sw / 2 - 165), 120] };
  let sel = localStorage.getItem("pitwall.ovSel");
  if (!OV_NAMES.some((x) => x[0] === sel)) sel = "map";
  view.innerHTML = `<div class="ovpage">
    <div class="ov-left">
      <div class="ov-head"><div><h1>Overlays</h1><div class="sub">Janelas transparentes por cima do jogo. Escolha um para configurar.</div></div>
        <button class="btn ${S.overlay_edit ? "primary" : ""}" id="ovEdit" title="Mostra os overlays ligados direto na tela, com dados de exemplo se o jogo estiver fechado. Arraste-os e puxe as bordas para redimensionar.">${S.overlay_edit ? "Concluir edição" : "Editar na tela do jogo"}</button></div>
      <div class="ov-tiles" id="ovTiles"></div>
      <div class="ov-stage" id="ovStage"><span class="ov-stagelbl">Sua tela · ${sw}×${sh}</span></div>
      <div class="sub" style="margin-top:8px">Arraste para mover, puxe as bordas para redimensionar, clique para escolher qual configurar.</div>
    </div>
    <div class="ov-right" id="ovPanel"></div></div>`;
  const stage = $("#ovStage"), boxes = {};
  const put = async (v) => {
    const r = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    S = r.settings; paintStage(); return r;
  };
  const k = () => stage.clientWidth / sw;
  const sizeStage = () => { stage.style.height = Math.round(stage.clientWidth * sh / sw) + "px"; };
  sizeStage();
  const place = (name) => {
    const b = boxes[name]; if (!b || b.busy) return;
    const c = S.overlays[name], [dx, dy] = defPos[name], x = c.x ?? dx, y = c.y ?? dy, kk = k();
    b.el.style.left = x * kk + "px"; b.el.style.top = y * kk + "px";
    if (b.w) { b.el.style.width = b.w * kk + "px"; b.el.style.height = b.h * kk + "px"; b.fr.style.transform = `scale(${kk})`; b.fr.style.width = b.w + "px"; b.fr.style.height = b.h + "px"; b.el.style.opacity = 1; }
  };
  function paintTiles() {
    $("#ovTiles").innerHTML = OV_NAMES.map(([n, t]) => { const c = S.overlays[n], on = c.mode !== "off";
      return `<div class="ovtile ${n === sel ? "sel" : ""} ${on ? "on" : ""}" data-sel="${n}" role="button" tabindex="0">
        <div class="ovt-top"><span class="ovt-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${OV_ICON[n]}</svg></span>
          <label class="ovsw" title="${on ? "Desligar" : "Ligar"}"><input type="checkbox" data-tile="${n}" ${on ? "checked" : ""}><i></i></label></div>
        <b>${t}</b><small>${OV_MODE_TXT[c.mode]}</small></div>`; }).join("");
    $("#ovTiles").querySelectorAll("[data-sel]").forEach((el) => el.onclick = (e) => { if (!e.target.closest(".ovsw")) select(el.dataset.sel); });
    $("#ovTiles").querySelectorAll("[data-tile]").forEach((el) => el.onchange = async () => {
      await put({ overlays: { [el.dataset.tile]: { mode: el.checked ? "game" : "off" } } });
      paintTiles(); if (el.dataset.tile === sel) paintPanel();
    });
  }
  function paintStage() {
    for (const [n] of OV_NAMES) {
      const on = S.overlays[n].mode !== "off";
      if (on && !boxes[n]) makeBox(n);
      if (!on && boxes[n]) { boxes[n].el.remove(); delete boxes[n]; }
      place(n);
      if (boxes[n]) boxes[n].el.classList.toggle("sel", n === sel);
    }
  }
  function select(n) {
    sel = n; localStorage.setItem("pitwall.ovSel", n);
    paintTiles(); paintPanel(); paintStage();
  }
  function paintPanel() {
    const box = $("#ovPanel");
    box.innerHTML = ovPanel(sel, S);
    bindOverlayPanel(box, sel, put, async (v) => { await put(v); paintTiles(); });
  }
  function makeBox(name) {
    const el = document.createElement("div");
    el.className = "ovbox"; el.style.opacity = 0;
    el.innerHTML = `<iframe src="/overlay/${name}?preview=1" tabindex="-1" scrolling="no"></iframe><span class="ovtag">${OV_NAMES.find((x) => x[0] === name)[1]}</span>` +
      ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((d) => `<i class="rz rz-${d}" data-d="${d}"></i>`).join("");
    stage.appendChild(el);
    const b = boxes[name] = { el, fr: el.querySelector("iframe"), w: 0, h: 0, busy: false };
    let drag = null;
    const begin = (e, dir) => {
      e.preventDefault(); e.stopPropagation();
      const c = S.overlays[name], kk = k();
      drag = { dir, sx: e.clientX, sy: e.clientY, x0: c.x ?? defPos[name][0], y0: c.y ?? defPos[name][1], s0: c.scale, w0: b.w, h0: b.h, kk, moved: false };
      b.busy = true; el.classList.add("drag"); el.setPointerCapture(e.pointerId);
    };
    el.onpointerdown = (e) => begin(e, e.target.dataset.d || "move");
    el.onpointermove = (e) => {
      if (!drag) return;
      const d = drag, dx = (e.clientX - d.sx) / d.kk, dy = (e.clientY - d.sy) / d.kk;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.dir === "move") {
        d.x = clamp(d.x0 + dx, -d.w0 + 40, sw - 40); d.y = clamp(d.y0 + dy, -d.h0 + 40, sh - 40); d.r = 1;
        el.style.left = d.x * d.kk + "px"; el.style.top = d.y * d.kk + "px"; return;
      }
      const rx = d.dir.includes("e") ? (d.w0 + dx) / d.w0 : d.dir.includes("w") ? (d.w0 - dx) / d.w0 : null;
      const ry = d.dir.includes("s") ? (d.h0 + dy) / d.h0 : d.dir.includes("n") ? (d.h0 - dy) / d.h0 : null;
      let r = rx != null && ry != null ? (rx + ry) / 2 : rx ?? ry;
      r = clamp(r, 50 / d.s0, 300 / d.s0);
      const w1 = d.w0 * r, h1 = d.h0 * r;
      d.r = r; d.x = d.dir.includes("w") ? d.x0 + d.w0 - w1 : d.x0; d.y = d.dir.includes("n") ? d.y0 + d.h0 - h1 : d.y0;
      el.style.left = d.x * d.kk + "px"; el.style.top = d.y * d.kk + "px";
      el.style.width = w1 * d.kk + "px"; el.style.height = h1 * d.kk + "px";
      b.fr.style.transform = `scale(${d.kk * r})`;
    };
    el.onpointerup = el.onpointercancel = async () => {
      if (!drag) return;
      const d = drag; drag = null; el.classList.remove("drag");
      b.busy = false;
      if (!d.moved) { select(name); return; }                     // só um clique: escolhe este overlay
      const v = { x: Math.round(d.x ?? d.x0), y: Math.round(d.y ?? d.y0) };
      if (d.r && d.r !== 1) { v.scale = Math.round(d.s0 * d.r); b.w = d.w0 * d.r; b.h = d.h0 * d.r; b.fr.style.width = b.w + "px"; b.fr.style.height = b.h + "px"; b.fr.style.transform = `scale(${d.kk})`; }
      await put({ overlays: { [name]: v } });
      if (name === sel) { const sc = $(`#ovPanel [data-k="scale"]`); if (sc) { sc.value = S.overlays[name].scale; sc.nextElementSibling.textContent = sc.value + "%"; } }
    };
  }
  // tamanho que cada overlay ocupa (a página dele avisa)
  const onMsg = (e) => {
    const m = e.data;
    if (!m || !m.pitwallOverlay || !boxes[m.name]) return;
    const b = boxes[m.name]; b.w = m.w; b.h = m.h; place(m.name);
  };
  window.addEventListener("message", onMsg);
  const onResize = () => { sizeStage(); OV_NAMES.forEach(([n]) => place(n)); };
  window.addEventListener("resize", onResize);
  const cleanup = () => { window.removeEventListener("message", onMsg); window.removeEventListener("resize", onResize); window.removeEventListener("hashchange", cleanup); };
  window.addEventListener("hashchange", cleanup);
  paintTiles(); paintStage(); paintPanel();
  $("#ovEdit").onclick = async () => {
    const ed = $("#ovEdit"), on = !ed.classList.contains("primary");
    let r = null;
    try { r = await api("/api/ui/overlay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show: on }) }); } catch (e) { /* ok */ }
    if (!r || !r.window) await put({ overlay_edit: on });
    ed.classList.toggle("primary", on); ed.textContent = on ? "Concluir edição" : "Editar na tela do jogo";
  };
}

function bindOverlayPanel(box, n, put, putModes) {
  const send = (name, key, v) => (key === "mode" ? putModes : put)({ overlays: { [name]: { [key]: v } } });
  box.querySelectorAll("[data-ov]").forEach((el) => {
    const name = el.dataset.ov, key = el.dataset.k;
    if (el.type === "range") {
      el.oninput = () => { el.nextElementSibling.textContent = el.value + el.nextElementSibling.dataset.unit; };
      el.onchange = () => {
        send(name, key, +el.value);
        if (key === "trend_secs") box.querySelectorAll('button[data-k="trend_secs"]').forEach((x) => x.classList.toggle("on", +x.dataset.val === +el.value));
      };
    } else if (el.dataset.chip) {
      el.onclick = () => { el.classList.toggle("on"); send(name, key, el.classList.contains("on")); };
    } else if (el.dataset.val !== undefined) {
      el.onclick = async () => {
        const v = el.dataset.num ? +el.dataset.val : el.dataset.val;
        if (key === "carstyle") {                      // escolher o estilo do carro liga a coluna Carro, se estiver desligada
          const chip = box.querySelector('[data-col="car"]');
          const patch = { carstyle: v };
          if (chip && !chip.classList.contains("on")) {
            chip.classList.add("on");
            patch.cols = OV_COLS.map(([k2]) => k2).filter((k2) => box.querySelector(`[data-col="${k2}"]`).classList.contains("on"));
          }
          await put({ overlays: { [name]: patch } });
        }
        else if (key === "ref") { await put({ overlay_reference: v }); }
        else await send(name, key, v);
        if (key === "mode") { const sub = box.querySelector(".ovp-head .sub"); if (sub) sub.textContent = OV_MODE_TXT[v]; }
        el.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === el));
        if (key === "trend_secs") { const sl = box.querySelector('input[data-k="trend_secs"]'); if (sl) { sl.value = v; sl.nextElementSibling.textContent = v + " s"; } }
      };
    }
  });
  box.querySelectorAll("[data-col]").forEach((el) => el.onclick = () => {
    el.classList.toggle("on");
    const cols = OV_COLS.map(([k2]) => k2).filter((k2) => box.querySelector(`[data-col="${k2}"]`).classList.contains("on"));
    put({ overlays: { standings: { cols } } });
  });
  const rs = box.querySelector("#tyReset");
  if (rs) rs.onclick = async () => {
    const def = { tmin: 70, tmax: 100, pmin: 26, pmax: 27, bmin: 350, bmax: 800 };
    await put({ overlays: { tyres: def } });
    for (const [k2, v] of Object.entries(def)) {
      const el = box.querySelector(`[data-ov="tyres"][data-k="${k2}"]`);
      if (el) { el.value = v; el.nextElementSibling.textContent = v + el.nextElementSibling.dataset.unit; }
    }
    rs.textContent = "Restaurado ✓"; setTimeout(() => { rs.textContent = "Restaurar padrão"; }, 1500);
  };
  const cb = box.querySelector("#cnBox");
  if (cb) {
    let loaded = false;
    cb.ontoggle = async () => {
      if (!cb.open || loaded) return;
      loaded = true;
      try { for (const t of await api("/api/overlay/corner-tracks")) box.querySelector("#cnTrack").insertAdjacentHTML("beforeend", `<option value="${esc(t)}">${esc(pretty(t))}</option>`); } catch (e) { /* ok */ }
    };
    box.querySelector("#cnTrack").onchange = async () => {
      const t = box.querySelector("#cnTrack").value, list = box.querySelector("#cnList");
      if (!t) { list.innerHTML = ""; return; }
      list.innerHTML = `<span class="sub">Carregando…</span>`;
      let r = { corners: [] };
      try { r = await api("/api/overlay/corners?track=" + encodeURIComponent(t)); } catch (e) { /* ok */ }
      list.innerHTML = r.corners.length ? r.corners.map((c) => `<label class="cnrow"><span>Curva ${c.n}</span><input data-cn="${c.n}" maxlength="40" placeholder="nome (opcional)" value="${esc(c.name)}"></label>`).join("")
        : `<span class="sub">Nenhuma volta gravada nesta pista ainda.</span>`;
      list.querySelectorAll("[data-cn]").forEach((inp) => inp.onchange = () => {
        const names = {}; list.querySelectorAll("[data-cn]").forEach((i) => { if (i.value.trim()) names[i.dataset.cn] = i.value.trim(); });
        put({ corner_names: { [t]: names } });
      });
    };
  }
}

// ---------------------------------------------------------------- configurações extras
function extraSettings(s) {
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${String(val) === String(k) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  return `
    <div class="set-card"><h2>Setup sugerido</h2>
      ${setRow("Escolher pela temperatura", "Ao começar a sessão, o Pitwall procura na sua biblioteca o setup do carro e da pista mais próximo da temperatura do momento e avisa na notificação.", sel("xBasis", [["air", "do ar"], ["track", "da pista"]], s.setup_temp_basis))}
      ${setRow("Variante preferida", "Vazio = qualquer.", `<input id="xVar" placeholder="ex.: Safe, Esport" value="${esc(s.setup_variant_pref)}">`)}
    </div>`;
}
function backupSettings(s) {
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${String(val) === String(k) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  return `<div class="set-card"><h2>Backup</h2>
      ${setRow("Backup automático", "Cópia do seu banco de dados (voltas, sessões e configurações).", `<input id="xBk" class="tgl" type="checkbox" ${s.backup_enabled ? "checked" : ""}>`)}
      ${setRow("A cada", "", sel("xBkH", [[6, "6 horas"], [24, "1 dia"], [72, "3 dias"], [168, "1 semana"]], s.backup_every_hours))}
      ${setRow("Guardar os últimos", "", sel("xBkK", [[5, "5"], [10, "10"], [20, "20"], [50, "50"]], s.backup_keep))}
      ${setRow("Pasta", "Vazio = padrão.", `<input id="xBkDir" placeholder="padrão" value="${esc(s.backup_dir)}">`)}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="xBkRun">Fazer backup agora</button><span class="sub" id="xBkOut"></span></div>
      <div id="xBkList" style="margin-top:12px"></div>
    </div>`;
}

// ---- peças das configurações
const SET_ICON = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SET_TABS = [
  ["geral", "Geral", SET_ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>')],
  ["video", "Vídeo", SET_ICON('<rect x="2" y="5" width="14" height="14" rx="3"/><path d="M16 10l6-3v10l-6-3"/>')],
  ["recursos", "Recursos", SET_ICON('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')],
  ["backup", "Backup", SET_ICON('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>')],
  ["update", "Atualização", SET_ICON('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>')],
  ["about", "Sobre", SET_ICON('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>')],
];
function setRow(title, desc, ctl) {
  return `<div class="set-row"><div class="set-txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</div><div class="set-ctl">${ctl}</div></div>`;
}
function aboutCard(ver) {
  return `
    <div class="set-card about">
      <div class="about-hero">
        <svg viewBox="0 0 32 32" width="56" height="56" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10 22V10h6.5a4 4 0 0 1 0 8H10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="22" cy="22" r="2" fill="currentColor"/></svg>
        <div><h2 style="margin:0">Pitwall</h2><div class="sub">Telemetria, vídeo e análise de voltas para ACC e iRacing</div>
          <span class="tag ok" style="margin-top:8px">Versão ${esc(ver.current === "dev" ? "de desenvolvimento" : ver.current)}</span></div>
      </div>
    </div>
    <div class="set-card"><h2>Desenvolvedor</h2>
      <div class="dev">
        <div class="dev-av">H</div>
        <div><b>Hygor Rocha</b><div class="sub">Criador e desenvolvedor do Pitwall</div></div>
      </div>
      <div class="about-links">
        <a class="btn" href="https://github.com/devhygor" target="_blank" rel="noopener">GitHub · devhygor</a>
        <a class="btn" href="https://github.com/devhygor/pitwall" target="_blank" rel="noopener">Código do projeto</a>
        <a class="btn" href="https://pitwall.hygor.com.br/" target="_blank" rel="noopener">Site da equipe</a>
        <a class="btn" href="https://github.com/devhygor/pitwall/issues" target="_blank" rel="noopener">Reportar um problema</a>
      </div>
    </div>
    <div class="set-card"><h2>Seus dados</h2>
      <div class="kv"><span>Pasta de dados</span><code>%LOCALAPPDATA%\\Pitwall</code></div>
      <div class="kv"><span>Vídeos</span><code>%LOCALAPPDATA%\\Pitwall\\videos</code></div>
      <div class="note">Tudo fica no seu computador. Só vão para a nuvem as voltas que você compartilha com a sua equipe. Atualizar o app não apaga nada disso.</div>
    </div>`;
}
async function drawUpdateCard(ver) {
  const card = $("#updCard");
  if (!card) return;
  const paint = (u, msg = "") => {
    const dl = u.download || {};
    card.innerHTML = `<h2>Atualização do app</h2>
      <div class="upd-top">
        <div><span class="sub">Versão instalada</span><div class="upd-v">${esc(u.current === "dev" ? "desenvolvimento" : u.current)}</div></div>
        <div><span class="sub">Última versão publicada</span><div class="upd-v">${esc(u.latest || "—")}</div></div>
        <span class="spacer"></span>
        ${u.available ? `<span class="tag pw">Nova versão disponível</span>` : u.current === "dev" ? `<span class="tag">Código-fonte</span>` : u.latest ? `<span class="tag ok">Você está em dia</span>` : ""}
      </div>
      ${u.error ? `<div class="note warn">Não consegui consultar o GitHub: ${esc(u.error)}</div>` : ""}
      ${u.available && u.notes ? `<div class="note" style="white-space:pre-wrap">${esc(u.notes)}</div>` : ""}
      <div class="row" style="margin-top:14px">
        ${u.available && u.frozen ? `<button class="btn primary" id="updGo">${dl.state === "downloading" ? `Baixando ${dl.pct || 0}%` : dl.state === "installing" ? "Instalando…" : "Atualizar agora"}</button>` : ""}
        ${(u.available || u.current === "dev") && !u.frozen && u.page ? `<a class="btn primary" href="${esc(u.page || "#")}" target="_blank" rel="noopener">Abrir página da última versão</a><span class="sub">Rodando pelo código-fonte: atualize com git pull.</span>` : ""}
        <button class="btn" id="updChk">Verificar agora</button><span class="sub" id="updMsg">${esc(msg)}</span>
      </div>
      <div class="note">Atualizar mantém suas sessões, vídeos e configurações. O instalador fecha o Pitwall e abre de novo no fim.</div>`;
    $("#updChk").onclick = async () => {
      $("#updMsg").textContent = "Verificando…";
      try { const n = await api("/api/update?force=true"); paint(n, n.available ? "" : n.current === "dev" ? "Você roda pelo código-fonte (sem número de versão): atualize com git pull." : "Nenhuma versão nova."); }
      catch (e) { $("#updMsg").textContent = e.message; }
    };
    const go = $("#updGo");
    if (go) go.onclick = async () => {
      go.disabled = true;
      try { await api("/api/update/install", { method: "POST" }); } catch (e) { $("#updMsg").textContent = e.message; go.disabled = false; return; }
      const t = setInterval(async () => {
        try {
          const n = await api("/api/update");
          if (current.name !== "settings") return clearInterval(t);
          if (n.download && n.download.state === "error") { clearInterval(t); paint(n, n.download.error); }
          else paint(n);
        } catch (e) { clearInterval(t); }
      }, 800);
    };
  };
  paint(ver);
}
function bindExtraSettings(draw) {
  const put = (v) => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
  $("#xBasis").onchange = () => put({ setup_temp_basis: $("#xBasis").value });
  $("#xVar").onchange = () => put({ setup_variant_pref: $("#xVar").value.trim() });
  $("#xGames").onchange = () => put({ games: $("#xGames").value });
  $("#xBk").onchange = () => put({ backup_enabled: $("#xBk").checked });
  $("#xBkH").onchange = () => put({ backup_every_hours: +$("#xBkH").value });
  $("#xBkK").onchange = () => put({ backup_keep: +$("#xBkK").value });
  $("#xBkDir").onchange = async () => { await put({ backup_dir: $("#xBkDir").value.trim() }); backupList(); };
  $("#xBkRun").onclick = async () => {
    $("#xBkOut").textContent = "Fazendo…";
    try { const r = await api("/api/backups/run", { method: "POST" }); $("#xBkOut").textContent = "Pronto: " + r.name; }
    catch (e) { $("#xBkOut").textContent = e.message; }
    backupList();
  };
  backupList();
}
async function backupList() {
  const el = $("#xBkList");
  if (!el) return;
  let b;
  try { b = await api("/api/backups"); } catch (e) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="sub" style="margin-bottom:6px">Em <code>${esc(b.dir)}</code></div>
    ${b.items.length ? `<table><tbody>${b.items.slice(0, 8).map((x) => `<tr><td>${fmtDate(new Date(x.mtime * 1000).toISOString())}</td><td class="num">${(x.size / 1048576).toFixed(1)} MB</td>
      <td class="acts"><button class="btn sm" data-restore="${esc(x.name)}">Restaurar</button></td></tr>`).join("")}</tbody></table>` : `<div class="sub">Nenhum backup ainda.</div>`}`;
  el.querySelectorAll("[data-restore]").forEach((btn) => btn.onclick = async () => {
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Confirmar"; return; }
    try {
      await api("/api/backups/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: btn.dataset.restore }) });
      $("#xBkOut").textContent = "Agendado: feche o Pitwall (Sair no ícone) e abra de novo para concluir.";
    } catch (e) { $("#xBkOut").textContent = e.message; }
  });
}

route();
if (!location.hash.startsWith("#/overlay")) { pollLive(); renderCtx(); }

// ---------------------------------------------------------------- Low Fuel Motorsport (só leitura)
const LIC_COL = { ROOKIE: "#9aa3b2", IRON: "#8d7b6a", BRONZE: "#cd7f32", SILVER: "#c8ced8", GOLD: "#ffcf3f",
  PLATINUM: "#7fe3d6", DIAMOND: "#7fb6ff", ALIEN: "#c38bff" };
const SR_COL = { A: "#3fd68b", B: "#9be35b", C: "#ffd23f", D: "#ffb020", E: "#ff8a3d", F: "#ff5d5d" };
const licBadge = (lic) => {
  const base = String(lic || "").replace("+", "").toUpperCase();
  return `<span class="lic" style="--c:${LIC_COL[base] || "#8a93a3"}">${esc(lic || "—")}</span>`;
};
const srBadge = (l) => `<span class="lic sr" style="--c:${SR_COL[String(l || "").toUpperCase()] || "#8a93a3"}">SR ${esc(l || "—")}</span>`;
const flag = (cc) => cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return "agora";
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const p = (n) => String(n).padStart(2, "0");
  return d ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(s)}`;
}
const raceWhen = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }) + " · " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
async function openExt(url) {
  if (url.startsWith("https://lowfuelmotorsport.com/")) {
    try { const r = await postJ("/api/lfm/window", { url }); if (r.window || r.opened) return; } catch (e) { /* segue */ }
  }
  try { const r = await postJ("/api/open", { url }); if (r.opened) return; } catch (e) { /* abre no app */ }
  window.open(url, "_blank");
}

async function renderLfm(force) {
  current = { name: "lfm" };
  view.innerHTML = `<div class="sub">Carregando dados do LFM…</div>`;
  let D;
  try { D = await api("/api/lfm" + (force ? "?force=true" : "")); } catch (e) {
    view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return;
  }
  if (current.name !== "lfm") return;
  if (!D.user_id) return lfmSetup(D);
  const P = D.profile, S = (D.series && D.series.series) || [], N = D.next;
  const st = (P && P.stats) || {};
  const acc = (P && P.acc) || {};
  const pct = (a, b) => b ? Math.round((a / b) * 100) + "%" : "—";
  view.innerHTML = `
    ${D.errors.length ? `<div class="note warn">${D.errors.map(esc).join(" · ")}${(P && P.stale) || (D.series && D.series.stale) ? " — mostrando o último dado salvo." : ""}</div>` : ""}
    ${P ? `<section class="lfm-hero">
      <div class="lh-id">
        ${P.avatar ? `<img class="lh-av" src="${esc(P.avatar)}" alt="" onerror="this.style.visibility='hidden'">` : `<div class="lh-av"></div>`}
        <div><span class="sub">Low Fuel Motorsport ${flag(P.country)}</span>
          <h1>${esc(P.name)}</h1>
          <div class="sub">${esc([P.first_name, P.last_name].filter(Boolean).join(" "))}${P.team && P.team.name ? ` · ${P.team.logo ? `<img class="lh-tl" src="${esc(P.team.logo)}" alt="">` : ""}${esc(P.team.name)}` : ""}</div></div>
      </div>
      <div class="lh-kpis">
        <div class="kpi"><span>ELO</span><b class="num">${P.elo ?? "—"}</b>
          ${P.elo_delta != null ? `<small class="${P.elo_delta >= 0 ? "posg" : "neg"}">${P.elo_delta >= 0 ? "▲" : "▼"} ${Math.abs(P.elo_delta)} na última corrida</small>` : ""}</div>
        <div class="kpi"><span>Licença</span>${licBadge(P.license)}<small>Divisão ${P.division ?? "—"}</small></div>
        <div class="kpi"><span>Safety Rating</span><b class="num">${P.safety_rating != null ? P.safety_rating.toFixed(2) : "—"}</b>${srBadge(P.sr_license)}</div>
        ${acc.rating ? `<div class="kpi"><span>ACC</span><b class="num">${acc.rating}</b>${licBadge(acc.license)}<small>${acc.ranked_races ?? 0} corridas ranqueadas</small></div>` : ""}
      </div>
      <div class="lh-act">
        <button class="btn" id="lfRef" title="Buscar de novo no LFM">Atualizar</button>
        <button class="btn" data-ext="${esc(P.url)}">Perfil no LFM ↗</button>
        <button class="btn xs ghost" id="lfChange">Trocar perfil</button>
      </div>
    </section>
    ${lfmAccountBar(D)}` : `<div class="panel"><div class="row"><button class="btn" id="lfRef">Tentar de novo</button><button class="btn xs ghost" id="lfChange">Trocar perfil</button></div></div>`}

    ${N ? `<section class="lfm-next" style="${N.track_image ? `--img:url('${esc(N.track_image)}')` : ""}">
      <div class="ln-txt"><span class="sub">Próxima corrida</span>
        <h2>${esc(N.name)}</h2>
        <div>${esc(N.track || "")} · ${raceWhen(N.next_race)} · ${N.race_length ? N.race_length + " min" : ""} ${N.class ? "· " + esc(N.class) : ""}</div>
        <div class="ln-req">Requisitos: ${licBadge(N.requirements.license)} SR ${N.requirements.sr ?? "—"}${N.requirements.elo ? ` · ELO ${N.requirements.elo}` : ""}
          ${N.signups != null ? ` · <b>${N.signups}</b> inscritos` : ""}</div></div>
      <div class="ln-cd"><b class="num" data-cd="${esc(N.next_race)}">${countdown(N.next_race)}</b>
        <div class="row"><button class="btn primary" data-ext="${esc(N.sessions_url)}">Inscrever no LFM ↗</button>
          <button class="btn" data-ext="${esc(N.url)}">Ver série</button></div>
        <small class="sub">A inscrição é feita no site do LFM, com a sua conta.</small></div>
    </section>` : ""}

    ${P ? `<div class="grid2">
      <div class="panel"><h2>Progressão do ELO</h2><div id="lfElo" class="chart"></div></div>
      <div class="panel"><h2>Progressão do Safety Rating</h2><div id="lfSr" class="chart"></div></div>
    </div>
    <div class="panel"><h2>Estatísticas</h2>
      <div class="lfm-stats">
        ${[["Largadas", st.starts], ["Vitórias", st.wins], ["Pódios", st.podium], ["Top 5", st.top5], ["Top 10", st.top10],
           ["Poles", st.poles], ["Abandonos", st.dnf], ["Ranqueadas", st.ranked]].map(([k, v]) => `<div><b class="num">${v ?? "—"}</b><span>${k}</span></div>`).join("")}
        <div><b class="num">${st.avg_q != null ? "P" + st.avg_q.toFixed(1) : "—"}</b><span>Média classif.</span></div>
        <div><b class="num">${st.avg_r != null ? "P" + st.avg_r.toFixed(1) : "—"}</b><span>Média chegada</span></div>
        <div><b class="num">${st.avg_ip != null ? st.avg_ip.toFixed(1) : "—"}</b><span>Incidentes/corrida</span></div>
        <div><b class="num">${pct(st.top10, st.starts)}</b><span>Top 10</span></div>
      </div>
      ${P.sims && P.sims.length > 1 ? `<h3 class="sub" style="margin:16px 0 8px">Ratings & licenças por simulador</h3>
      <div class="lfm-sims">${P.sims.map((x) => `<div class="lsim">${x.logo ? `<img src="${esc(x.logo)}" alt="" onerror="this.remove()">` : ""}
        <div><b>${esc(x.name || "")}</b><span class="num">${x.rating ?? "—"}</span> ${licBadge(x.license)} <small class="sub">${x.ranked_races ?? 0} ranq.</small></div></div>`).join("")}</div>` : ""}
    </div>` : ""}

    <div id="lfMine"></div>
    <div class="panel"><h2>Séries de ACC desta semana ${D.series ? `<small class="sub">${esc(D.series.season || "")}${D.series.week ? " · semana " + D.series.week : ""}</small>` : ""}</h2>
      <div class="lfm-series">${S.map((x) => `
        <div class="lser ${x.you && !x.you.eligible ? "locked" : ""}">
          <div class="ls-img" style="${x.track_image ? `background-image:url('${esc(x.track_image)}')` : ""}">${x.class ? `<span>${esc(x.class)}</span>` : ""}</div>
          <div class="ls-body"><b>${esc(x.name)}</b>
            <div class="sub">${esc(x.track || "")}${x.race_length ? ` · ${x.race_length} min` : ""}${x.team_event ? " · equipes" : ""}</div>
            <div class="ls-req">${licBadge(x.requirements.license)} <span>SR ${x.requirements.sr ?? "—"}</span>${x.requirements.elo ? `<span>ELO ${x.requirements.elo}</span>` : ""}
              ${x.you ? (x.you.eligible ? `<span class="okc">✓ você pode correr</span>` : `<span class="noc">falta ${esc(x.you.missing.join(", "))}</span>`) : ""}</div>
            ${x.next_race ? `<div class="ls-next"><span>${raceWhen(x.next_race)}</span><b class="num" data-cd="${esc(x.next_race)}">${countdown(x.next_race)}</b>
              ${x.signups != null ? `<small class="sub">${x.signups} inscritos</small>` : ""}</div>` : `<div class="sub">Sem corrida marcada</div>`}
            <div class="ls-sess" data-ev="${x.event_id}"></div>
            <div class="row"><button class="btn xs primary" data-ext="${esc(x.sessions_url)}">Inscrever</button><button class="btn xs" data-ext="${esc(x.url)}">Série</button>
              ${x.next_race ? `<button class="bell" title="Me avisar quando o servidor abrir" data-bell="${esc(x.slug + "@" + x.next_race)}"
                data-info='${esc(JSON.stringify({ series: x.name, slug: x.slug, track: x.track, date: x.next_race, url: x.sessions_url }))}'>🔔</button>` : ""}</div>
          </div></div>`).join("") || `<div class="sub">Nenhuma série encontrada.</div>`}</div>
      <p class="sub" style="margin-top:12px">Dados do lowfuelmotorsport.com, atualizados a cada poucos minutos. A inscrição é feita na página do LFM, que abre numa janela do próprio Pitwall.</p>
    </div>
    <div id="lfAlerts"></div>`;
  view.querySelectorAll("[data-ext]").forEach((b) => b.onclick = () => openExt(b.dataset.ext));
  lfmExtras(D);
  const ref = $("#lfRef"); if (ref) ref.onclick = () => renderLfm(true);
  const ch = $("#lfChange"); if (ch) ch.onclick = () => lfmSetup(D, true);
  lfmTimer = setInterval(() => {
    if (current.name !== "lfm") { clearInterval(lfmTimer); lfmTimer = null; return; }
    view.querySelectorAll("[data-cd]").forEach((el) => { el.textContent = countdown(el.dataset.cd); });
  }, 1000);
  if (!P) return;
  const lfChart = (el, pts, color, opts = {}) => {
    if (!el) return;
    if (pts.length < 2) { el.innerHTML = `<div class="sub">Precisa de 2 corridas ou mais.</div>`; return; }
    const lbl = (u, v) => v.map((i) => (Number.isInteger(i) && pts[i] ? new Date(pts[i].date + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""));
    plots.push(new uPlot({
      width: el.clientWidth, height: 220, scales: { x: { time: false }, ...(opts.scales || {}) },
      axes: [axis({ values: lbl }), axis({ size: 52 })],
      series: [{}, { label: opts.label, stroke: color, width: 2.4, fill: color + "22", points: { size: 6, fill: color } }],
      cursor: { drag: { x: false, y: false } },
    }, [pts.map((_, i) => i), pts.map((p) => p.rating)], el));
  };
  lfChart($("#lfElo"), P.elo_graph, "#ffb020", { label: "ELO" });
  lfChart($("#lfSr"), P.sr_graph, "#3fd68b", { label: "SR" });
}

function lfmSetup(D, changing) {
  view.innerHTML = `
    <section class="lfm-hero setup">
      <div><span class="sub">Low Fuel Motorsport</span><h1>Conecte o seu perfil do LFM</h1>
        <p class="sub">Veja aqui o seu ELO, Safety Rating, licenças, estatísticas e um contador para a próxima corrida.
          É só leitura: o Pitwall não entra na sua conta nem faz inscrições sozinho.</p>
        <ol class="sub"><li>Abra o seu perfil em lowfuelmotorsport.com (clique na sua foto → Profile).</li>
          <li>Copie o endereço da página (ex.: lowfuelmotorsport.com/profile/<b>326481</b>) e cole abaixo.</li></ol>
        <div class="row"><input id="lfId" placeholder="Link do perfil ou número" value="${esc(changing ? D.user_id : "")}" style="min-width:320px">
          <button class="btn primary" id="lfSave">Conectar</button>
          <button class="btn" data-ext="https://lowfuelmotorsport.com/">Abrir o LFM ↗</button></div>
        <div id="lfMsg" class="sub" style="margin-top:8px"></div></div>
    </section>`;
  view.querySelectorAll("[data-ext]").forEach((b) => b.onclick = () => openExt(b.dataset.ext));
  $("#lfSave").onclick = async () => {
    $("#lfSave").disabled = true; $("#lfMsg").textContent = "Procurando o perfil…";
    try { await api("/api/lfm/user", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: $("#lfId").value }) }); renderLfm(); }
    catch (e) { $("#lfMsg").innerHTML = `<span class="status bad">${esc(e.message)}</span>`; $("#lfSave").disabled = false; }
  };
}

function lfmAccountBar(D) {
  const A = D.account || {};
  if (A.connected) return `<div class="lfm-acc ok"><span>🔗 Conta do LFM conectada${A.name ? ` como <b>${esc(A.name)}</b>` : ""}.
      O Pitwall vê suas inscrições e toca o alerta quando o servidor abrir.</span>
    <button class="btn xs ghost" id="lfDisc">Desconectar</button></div>`;
  return `<div class="lfm-acc"><span>${A.expired ? "A conexão com a sua conta do LFM expirou. " : ""}<b>Conecte sua conta do LFM</b> para ver suas inscrições,
      os horários de cada servidor e receber o alerta de “Join liberado”. Você entra pela própria página do LFM${D.in_app ? ", numa janela do Pitwall" : ""}.</span>
    <button class="btn primary sm" id="lfConn">Conectar conta do LFM</button></div>`;
}

const LFM_SOUNDS = [["ambos", "Ronco do motor + luzes da largada"], ["motor", "Ronco do motor"], ["largada", "Luzes da largada (bipes)"]];
async function lfmExtras(D) {
  const conn = $("#lfConn"), disc = $("#lfDisc");
  if (conn) conn.onclick = async () => {
    conn.disabled = true; conn.textContent = "Entre no LFM na janela que abriu…";
    await openExt("https://lowfuelmotorsport.com/");
    const t0 = Date.now();
    const poll = async () => {
      if (current.name !== "lfm") return;
      try { const a = await api("/api/lfm/account"); if (a.connected) return renderLfm(); } catch (e) { /* tenta de novo */ }
      if (Date.now() - t0 < 10 * 60e3) setTimeout(poll, 3000); else { conn.disabled = false; conn.textContent = "Conectar conta do LFM"; }
    };
    setTimeout(poll, 3000);
  };
  if (disc) disc.onclick = async () => { await api("/api/lfm/account", { method: "DELETE" }); renderLfm(); };

  // sininhos (avisar quando o servidor abrir)
  const bindBells = (root) => root.querySelectorAll("[data-bell]").forEach((b) => b.onclick = async () => {
    const on = !b.classList.contains("on");
    let info = {}; try { info = JSON.parse(b.dataset.info || "{}"); } catch (e) { /* ok */ }
    b.disabled = true;
    try { await api("/api/lfm/watch", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: b.dataset.bell, on, info }) });
      root.querySelectorAll(`[data-bell="${CSS.escape(b.dataset.bell)}"]`).forEach((x) => x.classList.toggle("on", on));
      toast(on ? "Combinado: vou tocar o alerta quando o servidor abrir." : "Alerta removido.");
    } catch (e) { toast(e.message); }
    b.disabled = false;
  });

  // painel de alertas
  const { settings: st } = await api("/api/settings");
  if (current.name !== "lfm") return;
  const box = $("#lfAlerts");
  if (box) {
    box.innerHTML = `<div class="panel lfm-al"><h2>Alerta de “Join liberado”</h2>
      <p class="sub">Para as corridas em que você se inscreveu (ou marcou com 🔔): um aviso antecipado, se quiser, e o alerta principal
        no segundo em que o contador zera e o servidor abre — mesmo com a janela do Pitwall fechada.</p>
      <div class="al-grid">
        <label class="sw"><input type="checkbox" id="alOn" ${st.lfm_alerts_enabled ? "checked" : ""}> Alertas ligados</label>
        <label class="sw"><input type="checkbox" id="alZero" ${st.lfm_alert_at_zero ? "checked" : ""}> Avisar quando o contador zerar</label>
        <label>Som <select id="alKind">${LFM_SOUNDS.map(([k, n]) => `<option value="${k}" ${st.lfm_alert_sound === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Volume <span class="vol"><input type="range" id="alVol" min="0" max="100" step="5" value="${st.lfm_alert_volume}"><b id="alVolV">${st.lfm_alert_volume}%</b></span></label>
        <label>Aviso antecipado <select id="alPre">${[0, 1, 2, 5, 10, 15, 30].map((m) => `<option value="${m}" ${+st.lfm_alert_before_min === m ? "selected" : ""}>${m ? m + " min antes" : "sem aviso antes"}</option>`).join("")}</select></label>
        <button class="btn" id="alTest">▶ Testar som</button>
      </div></div>`;
    const put = (v) => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    $("#alOn").onchange = () => put({ lfm_alerts_enabled: $("#alOn").checked });
    $("#alZero").onchange = () => put({ lfm_alert_at_zero: $("#alZero").checked });
    $("#alKind").onchange = () => put({ lfm_alert_sound: $("#alKind").value });
    $("#alPre").onchange = () => put({ lfm_alert_before_min: +$("#alPre").value });
    $("#alVol").oninput = () => { $("#alVolV").textContent = $("#alVol").value + "%"; };
    $("#alVol").onchange = () => put({ lfm_alert_volume: +$("#alVol").value });
    $("#alTest").onclick = async () => {
      await put({ lfm_alert_volume: +$("#alVol").value, lfm_alert_sound: $("#alKind").value });
      let r = {}; try { r = await postJ("/api/lfm/alerts/test", {}); } catch (e) { /* toca aqui */ }
      if (!r.played) playAlert($("#alKind").value, +$("#alVol").value);
    };
  }

  // minhas corridas + servidores de cada série
  const S = await api("/api/lfm/sessions").catch(() => null);
  if (current.name !== "lfm" || !S) { bindBells(view); return; }
  const watched = new Set((S.watches || []).map((w) => w.key));
  view.querySelectorAll("[data-bell]").forEach((b) => b.classList.toggle("on", watched.has(b.dataset.bell)));
  const sess = S.sessions || [];
  const bell = (r) => `<button class="bell ${r.watch || watched.has(String(r.race_id)) ? "on" : ""}" title="Me avisar quando o servidor abrir" data-bell="${r.race_id}"
    data-info='${esc(JSON.stringify({ race_id: r.race_id, series: r.series, slug: r.slug, track: r.track, date: r.date, server_name: r.server_name, server_password: r.server_password, url: r.url }))}'>🔔</button>`;
  view.querySelectorAll(".ls-sess").forEach((el) => {
    const mine = sess.filter((r) => String(r.event_id) === el.dataset.ev && r.date && new Date(r.date) > Date.now() - 15 * 60e3).slice(0, 4);
    if (!mine.length) return;
    el.innerHTML = `<div class="sub" style="margin-top:4px">Próximos servidores</div>` + mine.map((r) => `
      <div class="srv ${r.signed_up ? "me" : ""}"><span>${raceWhen(r.date)}</span>
        <b class="num" data-cd="${esc(r.date)}">${countdown(r.date)}</b>
        <small class="sub">${r.registered ?? 0}/${r.slots ?? "?"}</small>
        ${r.signed_up ? `<span class="tag ok">inscrito</span>` : ""}${r.live ? `<span class="tag live">ao vivo</span>` : ""}${bell(r)}</div>`).join("");
  });
  const up = sess.filter((r) => r.signed_up && r.date && new Date(r.date) > Date.now() - 60 * 60e3);
  const ws = (S.watches || []).filter((w) => w.date && new Date(w.date) > Date.now() - 60 * 60e3 && !up.some((r) => String(r.race_id) === w.key));
  const mineBox = $("#lfMine");
  if (mineBox && (S.account.connected || ws.length)) {
    const card = (r, why) => `<div class="mine-r">
        <div><b>${esc(r.series || "")}</b><div class="sub">${esc(r.track || "")} · ${raceWhen(r.date)} · ${why}</div>
          ${r.server_name ? `<div class="srvname">Servidor: <code>${esc(r.server_name)}</code>${r.server_password ? ` · senha <code>${esc(r.server_password)}</code> <button class="btn xs" data-copy="${esc(r.server_password)}">copiar</button>` : ""}</div>` : ""}</div>
        <div class="mr-cd"><small class="sub">${new Date(r.date) > Date.now() ? "servidor abre em" : "servidor aberto"}</small><b class="num" data-cd="${esc(r.date)}">${countdown(r.date)}</b></div></div>`;
    mineBox.innerHTML = `<div class="panel"><h2>Minhas corridas</h2>
      ${up.length || ws.length ? [...up.map((r) => card(r, "inscrito")), ...ws.map((r) => card(r, "🔔 alerta marcado"))].join("")
        : `<div class="sub">${S.account.connected ? "Você não está inscrito em nenhuma corrida de ACC agora. Inscreva-se numa série abaixo — a página do LFM abre aqui no Pitwall." : ""}</div>`}
      ${S.error ? `<div class="note warn">${esc(S.error)}</div>` : ""}</div>`;
    mineBox.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast("Senha copiada."); });
  }
  bindBells(view);
}

// ---------------------------------------------------------------- alerta global (qualquer tela)
function playAlert(kind, vol) {
  try { const a = new Audio(`/api/lfm/sound.wav?kind=${encodeURIComponent(kind || "ambos")}&vol=${vol ?? 80}`); a.play(); } catch (e) { /* ok */ }
}
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 3200);
}
const seenAlerts = new Set();
let alertsPrimed = false;
async function pollAlerts() {
  if (document.body.classList.contains("overlay")) return;
  try {
    const r = await api("/api/lfm/alerts");
    for (const ev of r.events || []) {
      if (seenAlerts.has(ev.id)) continue;
      seenAlerts.add(ev.id);
      const recent = Date.now() - new Date(ev.t) < (ev.phase === "open" ? 10 : 3) * 60e3;
      if (!alertsPrimed && !recent) continue;  // eventos antigos (de antes de abrir a janela)
      if (alertsPrimed && !ev.played) playAlert(ev.phase === "open" ? undefined : "aviso");
      showAlertBanner(ev);
    }
    alertsPrimed = true;
    for (const t of r.targets || []) {
      for (const ms of [new Date(t.date) - Date.now()]) {
        if (ms > 0 && ms < 15000 && !scheduledZero.has(t.date)) {
          scheduledZero.add(t.date);
          setTimeout(() => { pollAlerts(); setTimeout(pollAlerts, 1500); }, ms + 600);
        }
      }
    }
  } catch (e) { /* servidor ocupado */ }
}
const scheduledZero = new Set();
function showAlertBanner(ev) {
  const b = document.createElement("div");
  b.className = "race-alert " + ev.phase;
  const R = ev.race || {};
  b.innerHTML = `<div class="ra-lights">${"<i></i>".repeat(5)}</div>
    <div class="ra-txt"><b>${esc(ev.title)}</b><span>${esc(ev.msg)}</span>
      ${R.server_name ? `<small>Servidor: <code>${esc(R.server_name)}</code></small>` : ""}</div>
    ${R.server_password ? `<button class="btn sm" data-copy="${esc(R.server_password)}">Copiar senha</button>` : ""}
    <button class="btn sm ghost" data-x>Fechar</button>`;
  document.body.appendChild(b);
  b.querySelector("[data-x]").onclick = () => b.remove();
  const c = b.querySelector("[data-copy]"); if (c) c.onclick = () => { navigator.clipboard.writeText(c.dataset.copy); toast("Senha copiada."); };
  setTimeout(() => b.remove(), ev.phase === "open" ? 10 * 60e3 : 3 * 60e3);
}
setInterval(pollAlerts, 10000);
setTimeout(pollAlerts, 1500);

// ---------------------------------------------------------------- aviso de nova versão
async function checkUpdate() {
  if ($(".update-bar")) return;
  let u;
  try { u = await api("/api/update"); } catch (e) { return; }
  if (!u.available) return;
  const gear = document.querySelector('[data-nav="settings"]');
  if (gear && !gear.querySelector(".nav-dot")) gear.insertAdjacentHTML("beforeend", '<i class="nav-dot" title="Nova versão disponível"></i>');
  const b = document.createElement("div");
  b.className = "update-bar";
  b.innerHTML = `<span>Nova versão do Pitwall disponível: <b>${esc(u.latest)}</b> (você está na ${esc(u.current)})</span>
    <button class="btn sm" data-up>Atualizar agora</button>
    <button class="btn sm ghost" data-x>Depois</button>`;
  document.body.appendChild(b);
  b.querySelector("[data-x]").onclick = () => b.remove();
  b.querySelector("[data-up]").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api("/api/update/install", { method: "POST" }); } catch (e) { toast(e.message); ev.target.disabled = false; return; }
    const t = setInterval(async () => {
      try {
        const d = (await api("/api/update")).download || {};
        if (d.state === "error") { clearInterval(t); toast(d.error || "Falha ao baixar."); ev.target.disabled = false; ev.target.textContent = "Tentar de novo"; }
        else ev.target.textContent = d.state === "installing" ? "Instalando…" : `Baixando ${d.pct || 0}%`;
      } catch (e) { clearInterval(t); }   // app fechou para atualizar
    }, 800);
  };
}
setTimeout(checkUpdate, 4000);
setInterval(checkUpdate, 6 * 3600e3);

// ---------------------------------------------------------------- ranking geral da comunidade
async function renderCommunity() {
  current = { name: "community" };
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let st;
  try { st = await api("/api/team/status"); } catch (e) { view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if (current.name !== "community") return;
  view.innerHTML = `
    <section class="team-hero comm-hero">
      ${CAR_SVG("rgba(62,199,255,.14)", "bg")}
      <div class="th-main"><div><span class="sub">Ranking geral</span><h1>Comunidade Pitwall</h1>
        <div class="sub">O recorde de cada piloto que usa o Pitwall, em cada pista e carro — de todas as equipes.</div></div></div>
      <div class="th-side"><a class="btn" href="${esc((st.site_url || "") + "#/ranking")}" target="_blank" rel="noopener">Ver no site</a></div>
    </section>
    <div id="tMain"></div>`;
  if (!st.logged_in) {
    $("#tMain").innerHTML = `<div class="panel empty"><b>Entre com o Google para ver o ranking</b>
      <p class="sub">O ranking usa a mesma conta da tela Equipe (não precisa ter equipe).</p><a class="btn primary" href="#/team">Entrar</a></div>`;
    return;
  }
  teamCommunity();
}

// ---------------------------------------------------------------- barra de voltas (trocar rápido na Análise)
const lapStripState = { target: "a", session: null };
function stripSessions(options, car) {
  const own = options.filter((l) => (!l.kind || l.kind === "own") && l.car === car);
  const by = {};
  for (const l of own) (by[l.session_id] = by[l.session_id] || { id: l.session_id, started_at: l.started_at, type: l.session_type, laps: [] }).laps.push(l);
  return Object.values(by).sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)));
}
function lapStrip(options, LA, LB) {
  const car = LA.car;
  const sessions = stripSessions(options, car);
  if (!sessions.length) return "";
  const own = LA.kind !== "ideal" && LA.kind !== "team";
  let sid = lapStripState.session;
  if (!sessions.some((x) => x.id === sid)) sid = own && sessions.some((x) => x.id === LA.session_id) ? LA.session_id : sessions[0].id;
  lapStripState.session = sid;
  const S = sessions.find((x) => x.id === sid);
  const laps = S.laps.slice().sort((x, y) => x.lap_number - y.lap_number);
  const clean = (l) => l.valid && !l.out_lap && !l.in_lap;
  const best = Math.min(...laps.filter(clean).map((l) => l.lap_time_ms), Infinity);
  const pb = Math.min(...options.filter((l) => (!l.kind || l.kind === "own") && l.car === car && clean(l)).map((l) => l.lap_time_ms), Infinity);
  const sBest = (x) => Math.min(...x.laps.filter(clean).map((l) => l.lap_time_ms), Infinity);
  const chip = (l) => {
    const d = clean(l) && isFinite(best) ? l.lap_time_ms - best : null;
    const cls = [l.id === LA.id ? "isa" : "", LB && l.id === LB.id ? "isb" : "", clean(l) ? "" : "bad",
      clean(l) && l.lap_time_ms === pb ? "pb" : clean(l) && l.lap_time_ms === best ? "best" : ""].join(" ");
    const why = l.out_lap ? "saída dos boxes" : l.in_lap ? "entrada nos boxes" : !l.valid ? "inválida" : "";
    return `<button class="lsc ${cls}" data-lap="${l.id}" title="Volta ${l.lap_number}${why ? " · " + why : ""}">
      <small>V${l.lap_number}${l.id === LA.id ? " · sua" : ""}${LB && l.id === LB.id ? " · ref" : ""}</small>
      <b class="num">${fmtLap(l.lap_time_ms)}</b>
      <em class="num">${why ? (l.out_lap ? "box ↗" : l.in_lap ? "box ↘" : "⚠ inválida") : d === 0 ? (l.lap_time_ms === pb ? "recorde" : "melhor") : "+" + (d / 1000).toFixed(3)}</em></button>`;
  };
  const ideal = options.find((l) => l.kind === "ideal" && l.car === car);
  const pbLap = options.find((l) => (!l.kind || l.kind === "own") && l.car === car && clean(l) && l.lap_time_ms === pb);
  const sbLap = laps.find((l) => clean(l) && l.lap_time_ms === best);
  return `<section class="lapstrip">
    <div class="ls-top">
      <select id="lsSess" title="Sessão">${sessions.map((x) => `<option value="${x.id}" ${x.id === sid ? "selected" : ""}>${esc(fmtDate(x.started_at))} · ${esc(TYPES[x.type] || x.type || "Sessão")} · ${x.laps.length} voltas${isFinite(sBest(x)) ? " · " + fmtLap(sBest(x)) : ""}</option>`).join("")}</select>
      <div class="seg-switch ls-tgt" title="O que o clique numa volta troca">
        <span class="sub">Clique troca:</span>
        <button class="btn xs ${lapStripState.target === "a" ? "on" : ""}" data-tgt="a"><i class="dot a"></i>Sua volta</button>
        <button class="btn xs ${lapStripState.target === "b" ? "on" : ""}" data-tgt="b"><i class="dot b"></i>Referência</button>
      </div>
      <span class="spacer"></span>
      <span class="sub">Referência rápida:</span>
      ${sbLap ? `<button class="btn xs" data-ref="${sbLap.id}">Melhor da sessão</button>` : ""}
      ${pbLap ? `<button class="btn xs" data-ref="${pbLap.id}">Meu recorde</button>` : ""}
      ${ideal ? `<button class="btn xs" data-ref="${ideal.id}">Volta ideal</button>` : ""}
      ${LB ? `<button class="btn xs ghost" data-ref="">Sem referência</button>` : ""}
    </div>
    <div class="ls-row">
      <button class="btn sm ls-nav" id="lsPrev" title="Volta anterior ( [ )">◀</button>
      <div class="ls-laps" id="lsLaps">${laps.map(chip).join("")}</div>
      <button class="btn sm ls-nav" id="lsNext" title="Próxima volta ( ] )">▶</button>
    </div></section>`;
}
function bindLapStrip(options, LA, LB, a, b) {
  const box = $(".lapstrip");
  if (!box) return;
  const go = (na, nb) => { location.hash = `#/compare?a=${na}${nb ? "&b=" + nb : ""}`; };
  const pick = (id) => {
    if (lapStripState.target === "b") { if (id !== a) go(a, id); }
    else if (id === b) go(id, a);        // trocou pela referência: inverte
    else go(id, b);
  };
  box.querySelectorAll("[data-lap]").forEach((c) => c.onclick = () => pick(+c.dataset.lap));
  box.querySelectorAll("[data-tgt]").forEach((c) => c.onclick = () => {
    lapStripState.target = c.dataset.tgt;
    box.querySelectorAll("[data-tgt]").forEach((x) => x.classList.toggle("on", x === c));
  });
  box.querySelectorAll("[data-ref]").forEach((c) => c.onclick = () => go(a, c.dataset.ref ? +c.dataset.ref : null));
  $("#lsSess").onchange = (e) => {
    lapStripState.session = +e.target.value;
    const tmp = document.createElement("div");
    tmp.innerHTML = lapStrip(options, LA, LB);
    box.replaceWith(tmp.firstElementChild);
    bindLapStrip(options, LA, LB, a, b);
  };
  const ids = [...box.querySelectorAll("[data-lap]")].map((c) => +c.dataset.lap);
  const step = (dir) => {
    const cur = lapStripState.target === "b" ? b : a;
    let i = ids.indexOf(cur);
    i = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : i + dir;
    if (i >= 0 && i < ids.length) pick(ids[i]);
  };
  $("#lsPrev").onclick = () => step(-1);
  $("#lsNext").onclick = () => step(1);
  const act = box.querySelector(".lsc.isa") || box.querySelector(".lsc.isb");
  if (act) act.scrollIntoView({ block: "nearest", inline: "center" });
  if (lapStripKey) document.removeEventListener("keydown", lapStripKey);
  lapStripKey = (e) => {
    if (current.name !== "compare" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
    if (e.key === "[" || e.key === "PageUp") { e.preventDefault(); step(-1); }
    if (e.key === "]" || e.key === "PageDown") { e.preventDefault(); step(1); }
  };
  document.addEventListener("keydown", lapStripKey);
}
let lapStripKey = null;
