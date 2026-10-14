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
  [/^#\/overlay$/, () => renderOverlay()],
];
let current = { name: "", id: null };
let plots = [];
function route() {
  plots.forEach((p) => p.destroy()); plots = [];
  if (player) { player.destroy(); player = null; }
  if (RP) { RP.destroy(); RP = null; }
  view.classList.remove("wide");
  if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
  document.body.classList.remove("overlay");
  const h = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      const sec = h.startsWith("#/compare") || h.startsWith("#/replay") ? "compare" : h.startsWith("#/strategy") ? "strategy"
        : h.startsWith("#/settings") ? "settings" : h.startsWith("#/setups") ? "setups"
        : h.startsWith("#/progress") ? "progress" : h.startsWith("#/team") ? "team" : "sessions";
      document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === sec));
      fn(m);
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", route);

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
  { key: "delta", label: "Diferença para a referência", h: 130 },
  { key: "phase", label: "Pedais", h: 70 },
  { key: "speed", label: "Velocidade", h: 170, unit: "km/h" },
  { key: "gas", label: "Acelerador", h: 90, pct: true },
  { key: "brake", label: "Freio", h: 90, pct: true },
  { key: "steer", label: "Volante", h: 100 },
  { key: "gear", label: "Marcha", h: 140, gear: true },
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

async function renderCompare(params) {
  current = { name: "compare" };
  if (player) player.destroy();
  player = null;
  const a = +params.get("a") || null, b = +params.get("b") || null;
  if (!a) return renderComparePicker();
  view.innerHTML = `<div class="sub">Carregando telemetria…</div>`;
  const r = await api(`/api/compare?a=${a}${b ? "&b=" + b : ""}`);
  const track = r.lap_a.track;
  const options = await api(`/api/tracks/${encodeURIComponent(track)}/laps`);
  const pbIds = pbLapIds(options);
  const opt = (sel) => options.map((l) => `<option value="${l.id}" ${l.id === sel ? "selected" : ""}>${lapLabel(l, pbIds)}</option>`).join("");
  const LA = r.lap_a, LB = r.lap_b, hasB = !!LB;
  const diff = hasB ? LA.lap_time_ms - LB.lap_time_ms : null;
  const secs = ["s1_ms", "s2_ms", "s3_ms"].map((k, i) => {
    const d = hasB && LA[k] && LB[k] ? LA[k] - LB[k] : null;
    return `<span>S${i + 1} <b class="num ${d > 0 ? "neg" : d < 0 ? "posg" : ""}">${hasB ? fmtDelta(d) : fmtSec(LA[k])}</b></span>`;
  }).join("");
  const hasVid = LA.video || (LB && LB.video);
  const vidBox = (L, tag, label) => `
      <div class="vid ${tag}"><span class="vtag">${label}</span>
        ${L && L.video ? `<video id="vid-${tag}" src="${L.video.url}" preload="auto" muted playsinline></video>
        <div class="sync"><span class="sub">Sincronia</span>
          <button class="btn sm" data-off="${tag}" data-d="-0.1">−0,1 s</button>
          <button class="btn sm" data-off="${tag}" data-d="0.1">+0,1 s</button>
          <span class="num sub" id="off-${tag}">${fmtOffset(L.video.offset)}</span></div>`
        : `<div class="novid">${L ? "Sem vídeo desta volta" : "Escolha uma referência"}</div>`}
      </div>`;

  view.innerHTML = `
    <div class="an-head">
      <div class="lapcard a"><div class="row"><span class="who">Sua volta</span><span class="spacer"></span>
          <b class="num big">${fmtLap(LA.lap_time_ms)}</b></div>
        <select id="pa">${opt(a)}</select></div>
      <div class="lapcard b"><div class="row"><span class="who">Referência</span><span class="spacer"></span>
          <b class="num big">${hasB ? fmtLap(LB.lap_time_ms) : "—"}</b></div>
        <select id="pb"><option value="">— sem referência —</option>${opt(b)}</select></div>
      <div class="lapsum"><span class="sub">${esc(pretty(track))} · ${(r.track_length / 1000).toFixed(2)} km</span>
        <div class="num total ${diff > 0 ? "neg" : diff < 0 ? "posg" : ""}">${hasB ? fmtDelta(diff) : "—"}</div>
        <div class="secs">${secs}</div>
        <div class="seg-switch" style="margin-top:8px"><span class="btn sm on">Análise</span><a class="btn sm" href="#/replay?a=${a}${b ? "&b=" + b : ""}">▶ Replay</a></div></div>
    </div>
    <div class="an">
      <div class="an-left">
        <div class="panel pad0">
          <div class="mapbar"><span class="sub" id="zinfo">Traçado</span><span class="spacer"></span>
            <button class="btn sm" id="zout" title="Afastar">−</button>
            <button class="btn sm" id="zin" title="Aproximar">+</button>
            <button class="btn sm on" id="zrot" title="Girar o mapa com o carro">Girar</button></div>
          <div id="zmap"></div>
        </div>
        <div class="panel" id="segInfo"></div>
        <div class="panel pad0">
          <div id="fmap"></div>
          <div class="segnav">
            <button class="btn sm" id="segPrev" title="Segmento anterior">◀</button>
            <div id="segTitle" class="num"></div>
            <button class="btn sm" id="segNext" title="Próximo segmento">▶</button>
          </div>
        </div>
      </div>
      <div class="an-right">
        <div class="panel">
          <div class="vids2">${vidBox(LA, "a", "SUA VOLTA")}${vidBox(LB, "b", "REFERÊNCIA")}</div>
          <div class="pctl">
            <button class="btn sm primary" id="play" ${hasVid ? "" : "disabled"} title="Espaço">▶</button>
            <div class="rates">${[0.25, 0.5, 1].map((x) => `<button class="btn sm ${x === 1 ? "on" : ""}" data-rate="${x}">${String(x).replace(".", ",")}×</button>`).join("")}</div>
            <div id="prog" class="prog"><div class="segband"></div><div class="fill"></div><div class="knob"></div><div class="hover"></div></div>
            <span class="num sub" id="progTxt"></span>
          </div>
          ${hasVid ? "" : `<div class="note">Sem vídeo para estas voltas. Com a gravação ligada em
             <a href="#/settings" style="color:var(--accent)">Configurações</a>, as próximas sessões já vêm com vídeo.</div>`}
        </div>
        <div class="panel" id="traces">
          <div class="row" style="margin-bottom:6px">
            <div class="plegend">${PHASE_NAMES.map((nm, i) => `<span><i style="background:${PHASE_COLORS[i]}"></i>${nm}</span>`).join("")}</div>
            <span class="spacer"></span>
            <button class="btn sm on" id="phaseBtn" title="Pinta a sua linha conforme o pedal">Cores por pedal</button>
            <button class="btn sm on" id="focusBtn">Focar no segmento</button></div>
          ${TRACES.filter((t) => t.key !== "delta" || hasB).map((t) => `
          <div class="trace"><div class="lbl"><span>${t.label}</span><span class="v" id="v-${t.key}"></span></div>
          <div id="p-${t.key}"></div></div>`).join("")}
          <div class="note">Passe o mouse nos gráficos ou no mapa · arraste para dar zoom · duplo clique para voltar.</div>
        </div>
      </div>
    </div>`;
  $("#pa").onchange = (e) => (location.hash = `#/compare?a=${e.target.value}${b ? "&b=" + b : ""}`);
  $("#pb").onchange = (e) => (location.hash = `#/compare?a=${a}${e.target.value ? "&b=" + e.target.value : ""}`);

  const segs = r.segments || [];
  AN = { r, LA, LB, hasB, n: r.distance.length, segs, seg: 0, focus: true, idx: 0, lastIdx: -1, phaseColors: true };
  AN.phA = phases(r.a); AN.runsA = phaseRuns(AN.phA);
  if (hasB) { AN.phB = phases(r.b); AN.runsB = phaseRuns(AN.phB); }
  AN.zmap = drawZoomMap(r, hasB);
  AN.fmap = drawFullMap(r, hasB, segs);
  incidentMarkers($("#fSvg"), LA.events, r.a.x, r.a.z, segs);
  player = makePlayer(r, LA, LB);
  drawTraces(r, hasB);
  bindAnalysis();
  // começa no segmento onde você mais perdeu tempo
  let worst = 0;
  segs.forEach((s, i) => { if ((s.delta ?? -1e9) > (segs[worst].delta ?? -1e9)) worst = i; });
  selectSegment(hasB ? worst : 0);
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
    // a troca de escala do gráfico só é aplicada no próximo quadro
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
      el.innerHTML = `Você: ${nm(AN.phA[i])}${hasB ? ` · Referência: ${nm(AN.phB[i])}` : ""}`;
      continue;
    }
    if (t.key === "delta") {
      el.innerHTML = `Distância: <b>${Math.round(r.distance[i])} m</b> · Diferença: <b class="${r.delta[i] > 0 ? "neg" : "posg"}">${
        r.delta[i] == null ? "—" : sgn(r.delta[i], 3, " s")}</b>`;
      continue;
    }
    const f = (v) => v == null ? "—" : t.gear ? gearTxt(v) : t.pct ? Math.round(v * 100) + "%" : t.key === "steer" ? v.toFixed(2) : Math.round(v) + (t.unit ? " " + t.unit : "");
    el.innerHTML = `<span class="va">Você: ${f(r.a[t.key][i])}</span>${hasB ? ` · <span class="vb">Referência: ${f(r.b[t.key][i])}</span>` : ""}`;
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

function renderSegInfo() {
  const s = AN.segs[AN.seg];
  const el = $("#segInfo");
  if (!s) { el.innerHTML = ""; return; }
  const A = s.a || {}, B = s.b || {};
  const row = (label, va, vb, dv) => `<tr><td>${label}</td><td class="num va">${va}</td>${AN.hasB ? `<td class="num vb">${vb}</td><td class="num">${dv}</td>` : ""}</tr>`;
  const dnum = (x, y, nd = 0, unit = "") => (x == null || y == null ? "—" : sgn(x - y, nd, unit));
  el.innerHTML = `
    <div class="row"><h2 style="margin:0">Segmento ${s.n} <span class="sub">· curva ${s.n}</span></h2><span class="spacer"></span>
      ${AN.hasB ? `<b class="num segdelta ${s.delta > 0 ? "neg" : "posg"}">${sgn(s.delta, 3, " s")}</b>` : ""}</div>
    <div class="sub" style="margin:2px 0 10px">${fmtM(s.start_m)} → ${fmtM(s.end_m)} · ápice em ${fmtM(s.apex_m)}</div>
    ${AN.hasB ? `
      <div class="killer ${s.delta > 0.03 ? "" : "ok"}">⏱ ${esc(s.summary || "")}</div>
      ${(s.tips || []).length ? `<ul class="tips">${s.tips.map((t) => `<li><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></li>`).join("")}</ul>`
        : `<div class="sub" style="margin:8px 0">Nada fora do normal neste trecho.</div>`}
      <div class="lossbar"><span>Entrada <b class="num ${s.entry_loss > 0 ? "neg" : "posg"}">${sgn(s.entry_loss, 3, " s")}</b></span>
        <span>Saída <b class="num ${s.exit_loss > 0 ? "neg" : "posg"}">${sgn(s.exit_loss, 3, " s")}</b></span></div>`
      : `<div class="sub" style="margin-bottom:8px">Escolha uma volta de referência para ver as dicas deste trecho.</div>`}
    <table class="segtab"><thead><tr><th></th><th>Você</th>${AN.hasB ? "<th>Ref.</th><th>Dif.</th>" : ""}</tr></thead><tbody>
      ${row("Tempo no trecho", A.time != null ? A.time.toFixed(3) : "—", B.time != null ? B.time.toFixed(3) : "—", dnum(A.time, B.time, 3))}
      ${row("Início da frenagem", fmtM(A.brake_m), fmtM(B.brake_m), dnum(A.brake_m, B.brake_m, 0, " m"))}
      ${row("Velocidade mínima", A.min_speed != null ? Math.round(A.min_speed) : "—", B.min_speed != null ? Math.round(B.min_speed) : "—", dnum(A.min_speed, B.min_speed, 0))}
      ${row("Acelerador a fundo", fmtM(A.throttle_m), fmtM(B.throttle_m), dnum(A.throttle_m, B.throttle_m, 0, " m"))}
      ${row("Velocidade na saída", A.exit_speed != null ? Math.round(A.exit_speed) : "—", B.exit_speed != null ? Math.round(B.exit_speed) : "—", dnum(A.exit_speed, B.exit_speed, 0))}
      ${row("Tempo sem pedal", A.coast != null ? A.coast.toFixed(2) + " s" : "—", B.coast != null ? B.coast.toFixed(2) + " s" : "—", dnum(A.coast, B.coast, 2, " s"))}
    </tbody></table>`;
  const tt = $("#segTitle");
  tt.innerHTML = `Segmento ${s.n} de ${AN.segs.length}${AN.hasB ? `: <span class="${s.delta > 0 ? "neg" : "posg"}">${sgn(s.delta, 3)}</span>` : ""}`;
}

function bindAnalysis() {
  $("#segPrev").onclick = () => selectSegment(AN.seg - 1);
  $("#segNext").onclick = () => selectSegment(AN.seg + 1);
  $("#focusBtn").onclick = () => {
    AN.focus = !AN.focus;
    $("#focusBtn").classList.toggle("on", AN.focus);
    $("#focusBtn").textContent = AN.focus ? "Focar no segmento" : "Volta inteira";
    if (AN.focus) selectSegment(AN.seg, { keepCursor: true });
    else { AN.syncing = true; plots.forEach((p) => p.setScale("x", { min: AN.r.distance[0], max: AN.r.distance[AN.n - 1] })); AN.syncing = false; }
  };
  $("#phaseBtn").onclick = () => {
    AN.phaseColors = !AN.phaseColors;
    $("#phaseBtn").classList.toggle("on", AN.phaseColors);
    $("#zLineA").innerHTML = phaseMapPaths(AN.r.a.x, AN.r.a.z, AN.runsA, css("--a"));
    plots.forEach((p) => p.redraw(false));
  };
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
  const width = $("#traces").clientWidth - 36;
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
  for (const t of TRACES) {
    if (t.key === "delta" && !hasB) continue;
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
      axes: [axis({ show: t === TRACES[TRACES.length - 1], values: (u, v) => v.map((m) => `${Math.round(m)} m`) }),
             axis({ size: 52, ...(t.gear ? { values: (u, v) => v.map(gearTxt), splits: () => [2, 4, 6, 8] }
               : t.key === "phase" ? { splits: () => (hasB ? [1.5, 0.5] : [1]), values: () => (hasB ? ["Você", "Ref."] : ["Você"]),
                   grid: { show: false }, ticks: { show: false } } : {}) })],
      series,
      cursor: { sync: { key: "cmp" }, drag: { x: true, y: false }, y: false },
      hooks: {
        drawClear: [focusBand],
        draw: t.key === "phase" ? [(u) => drawPhaseBands(u, x, hasB)] : [],
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
  view.classList.add("wide");
  if (RP) RP.destroy();
  RP = null;
  const a = +params.get("a") || null, b = +params.get("b") || null;
  if (!a) return renderComparePicker("replay");
  view.innerHTML = `<div class="sub">Carregando replay…</div>`;
  const r = await api(`/api/compare?a=${a}${b ? "&b=" + b : ""}`);
  const options = await api(`/api/tracks/${encodeURIComponent(r.lap_a.track)}/laps`);
  const LA = r.lap_a, LB = r.lap_b, hasB = !!LB;
  const pbIds = pbLapIds(options);
  const opt = (sel) => options.map((l) => `<option value="${l.id}" ${l.id === sel ? "selected" : ""}>${lapLabel(l, pbIds)}</option>`).join("");
  const card = (L, tag, who) => `
    <div class="dcard ${tag}">
      <div class="row"><span class="who">${who}</span><span class="sub num">${L ? `volta ${L.lap_number}` : ""}</span><span class="spacer"></span>
        <b class="num">${L ? fmtLap(L.lap_time_ms) : "—"}</b></div>
      ${L ? `<div class="gauges">
        <div class="pedal"><span>Acel.</span><div class="bar"><i id="g-${tag}-gas"></i></div><b class="num" id="t-${tag}-gas">0%</b></div>
        <div class="pedal brk"><span>Freio</span><div class="bar"><i id="g-${tag}-brake"></i></div><b class="num" id="t-${tag}-brake">0%</b></div>
        <div class="nums"><b class="num big" id="t-${tag}-speed">0</b><span class="sub">km/h</span>
          <b class="num" id="t-${tag}-gear">N</b><span class="sub">marcha</span>
          <b class="num" id="t-${tag}-rpm">0</b><span class="sub">rpm</span></div>
      </div>` : `<div class="sub">Escolha uma referência</div>`}
    </div>`;
  view.innerHTML = `
    <div class="rp">
      <canvas id="rpCanvas"></canvas>
      <div class="rp-tl">
        <div class="rp-title"><h1>${esc(pretty(LA.track))}</h1>
          <div class="sub">${esc(pretty(LA.car))} · ${fmtDate(LA.started_at)}${LA.air_temp ? ` · ar ${Math.round(LA.air_temp)}°C · pista ${Math.round(LA.road_temp)}°C` : ""}${LA.grip ? " · " + esc(LA.grip) : ""}</div>
          <div class="seg-switch"><a class="btn sm" href="#/compare?a=${a}${b ? "&b=" + b : ""}">Análise</a><span class="btn sm on">Replay</span></div>
        </div>
        <div class="panel rp-pick">
          <label><span class="who a">Sua volta</span><select id="rpa">${opt(a)}</select></label>
          <label><span class="who b">Referência</span><select id="rpb"><option value="">— nenhuma —</option>${opt(b)}</select></label>
        </div>
      </div>
      <div class="rp-tr">
        ${card(LA, "a", "Sua volta")}${card(LB, "b", "Referência")}
        <div class="panel rp-mini"><div id="rpMini"></div>
          <div class="row"><b id="rpSegName">—</b><span class="spacer"></span><b class="num" id="rpSegDelta"></b></div></div>
      </div>
      <div class="rp-bl panel">
        <div class="row" style="margin-bottom:6px"><b>Setores</b></div>
        <table class="rp-sec"><thead><tr><th></th><th class="va">Você</th>${hasB ? `<th class="vb">Ref.</th><th>Dif.</th>` : ""}</tr></thead><tbody>
          ${["s1_ms", "s2_ms", "s3_ms"].map((k, i) => {
            const d = hasB && LA[k] && LB[k] ? LA[k] - LB[k] : null;
            return `<tr id="rpS${i}"><td>S${i + 1}</td><td class="num">${fmtSec(LA[k])}</td>${hasB ? `<td class="num">${fmtSec(LB[k])}</td>
              <td class="num ${d > 0 ? "neg" : d < 0 ? "posg" : ""}">${fmtDelta(d)}</td>` : ""}</tr>`;
          }).join("")}</tbody></table>
      </div>
      <div class="rp-zoom panel">
        <button class="btn sm" id="rpZo">−</button><input type="range" id="rpZoom" min="0" max="100" value="45"><button class="btn sm" id="rpZi">+</button>
        <button class="btn sm on" id="rpRot" title="Gira a pista com o carro">Girar</button>
        <button class="btn sm on" id="rpPh" title="Linha colorida por pedal">Cores</button>
      </div>
      <div class="rp-bar panel">
        <button class="btn primary" id="rpPlay" title="Espaço">▶</button>
        <b class="num rp-clock" id="rpClock">0:00.000</b>
        <div class="rates">${[0.25, 0.5, 1, 2].map((x) => `<button class="btn sm ${x === 1 ? "on" : ""}" data-rprate="${x}">${String(x).replace(".", ",")}×</button>`).join("")}</div>
        <div class="prog" id="rpProg"><div class="fill"></div><div class="knob"></div><div class="hover"></div></div>
        ${hasB ? `<span class="rp-d">Delta <b class="num" id="rpDelta">—</b></span>
        <span class="rp-d">↔ <b class="num" id="rpGap">—</b></span>
        <div class="seg-switch"><button class="btn sm on" data-mode="time">Tempo</button><button class="btn sm" data-mode="dist">Distância</button></div>` : ""}
      </div>
    </div>`;
  $("#rpa").onchange = (e) => (location.hash = `#/replay?a=${e.target.value}${b ? "&b=" + b : ""}`);
  $("#rpb").onchange = (e) => (location.hash = `#/replay?a=${a}${e.target.value ? "&b=" + e.target.value : ""}`);
  RP = makeReplay(r, LA, LB);
}

// ids das voltas que são recorde (melhor volta limpa de cada carro na pista)
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
  const S = { T: 0, playing: false, rate: 1, mode: "time", zoom: 45, rotate: true, phaseColors: true,
              camX: null, camZ: null, camRot: 0, last: 0, raf: 0, dragging: false };
  const cv = $("#rpCanvas"), ctx = cv.getContext("2d");
  const resize = () => {
    const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect();
    cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };
  const viewWidth = () => 40 * Math.pow(25, S.zoom / 100);   // 40 m … 1000 m de largura visível

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
    if (S.camX == null) { S.camX = ax; S.camZ = az; }
    S.camX += (ax - S.camX) * 0.25; S.camZ += (az - S.camZ) * 0.25;
    const h = heading(A, fiA);
    let target = S.rotate && h != null ? -Math.PI / 2 - h : 0;
    while (target - S.camRot > Math.PI) target -= 2 * Math.PI;
    while (target - S.camRot < -Math.PI) target += 2 * Math.PI;
    S.camRot += (target - S.camRot) * 0.15;
    const scale = W / viewWidth();

    ctx.save();
    ctx.fillStyle = "#07080a"; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.58);
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
    $("#rpClock").textContent = fmtLap(Math.max(0, Math.round(S.T))).replace(/^0:/, "0:");
    const frac = Math.min(1, S.T / tEnd);
    $("#rpProg .fill").style.width = (frac * 100) + "%";
    $("#rpProg .knob").style.left = (frac * 100) + "%";
    // setor atual
    const ss = [LA.s1_ms, LA.s1_ms && LA.s2_ms ? LA.s1_ms + LA.s2_ms : null];
    const sec = ss[0] && S.T < ss[0] ? 0 : ss[1] && S.T < ss[1] ? 1 : 2;
    for (let k = 0; k < 3; k++) { const row = $(`#rpS${k}`); if (row) row.classList.toggle("on", k === sec); }
    mini.move(iA, fiB != null ? Math.round(fiB) : null);
  }

  function loop(ts) {
    if (S.playing) {
      const dt = S.last ? ts - S.last : 0;
      S.T += dt * S.rate;
      if (S.T >= tEnd) { S.T = tEnd; pause(); }
    }
    S.last = ts;
    draw();
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
  zoom.oninput = () => { S.zoom = +zoom.value; };
  $("#rpZi").onclick = () => { S.zoom = Math.max(0, S.zoom - 8); zoom.value = S.zoom; };
  $("#rpZo").onclick = () => { S.zoom = Math.min(100, S.zoom + 8); zoom.value = S.zoom; };
  cv.addEventListener("wheel", (e) => { e.preventDefault(); S.zoom = Math.min(100, Math.max(0, S.zoom + (e.deltaY > 0 ? 4 : -4))); zoom.value = S.zoom; }, { passive: false });
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
    view.innerHTML = `
      <div class="head"><div><h1>Configurações</h1><div class="sub">As mudanças valem a partir da próxima sessão.</div></div></div>
      <div class="panel fuel" style="margin-bottom:14px">
        <h2>Inicialização</h2>
        ${au.supported ? `
        <label>Iniciar com o Windows, em segundo plano <input id="cAuto" type="checkbox" ${au.enabled ? "checked" : ""}></label>
        ${au.outdated ? `<div class="note warn">O registro aponta para outra pasta do Pitwall. Desligue e ligue de novo para atualizar.</div>` : ""}
        <div class="note">Ligado, o Pitwall abre sozinho quando você entra no Windows: fica só com um ícone perto do relógio,
          esperando o ACC, e grava sem você precisar lembrar. Quando começar a gravar aparece uma notificação.
          Clique no ícone para abrir esta tela, ou use "Sair" no menu dele. Para iniciar agora sem reiniciar o PC,
          feche esta janela de terminal e rode <code>iniciar-em-segundo-plano.bat</code>.</div>
        <div class="row" style="margin-top:12px"><button class="btn" id="cLnk">Criar atalhos na Área de Trabalho e no Menu Iniciar</button>
          <span class="sub" id="cLnkOut"></span></div>`
        : `<div class="sub">Disponível só no Windows.</div>`}
      </div>
      <div class="strat">
        <div class="panel fuel">
          <h2>Vídeo da tela</h2>
          <label>Gravar vídeo nas sessões <input id="cVid" type="checkbox" ${s.video_enabled ? "checked" : ""}></label>
          <label>Monitor do jogo ${sel("cMon", [[0, "1 (principal)"], [1, "2"], [2, "3"], [3, "4"]], s.video_monitor)}</label>
          <label>Encoder ${sel("cEnc", [["auto", "Automático (GPU)"], ["nvenc", "NVIDIA (NVENC)"], ["amf", "AMD (AMF)"], ["cpu", "Processador (720p)"]], s.video_encoder)}</label>
          <label>Quadros por segundo ${sel("cFps", [[30, "30"], [60, "60"]], s.video_fps)}</label>
          <label>Qualidade ${sel("cBr", [[4, "Leve (4 Mbps)"], [6, "Normal (6 Mbps)"], [10, "Alta (10 Mbps)"]], s.video_bitrate_mbps)}</label>
          <label>Manter vídeos das últimas ${sel("cKeep", [[5, "5 sessões"], [15, "15 sessões"], [30, "30 sessões"], [100, "100 sessões"]], s.video_keep_sessions)}</label>
          <div class="note">Na qualidade normal, 1 hora de vídeo ocupa cerca de 2,7 GB. Os vídeos ficam em %LOCALAPPDATA%\\Pitwall\\videos.</div>
        </div>
        <div class="panel">
          <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Status da gravação</h2><span class="spacer"></span>
            <button class="btn sm" id="cTest">Testar de novo</button></div>
          <div class="kv"><span>ffmpeg</span><code>${esc(v.ffmpeg || "não encontrado")}</code></div>
          <div class="kv"><span>Encoder em uso</span>${v.probing ? `<span class="sub">testando…</span>` : v.selected ? `<span class="status ok">${v.selected}</span>` : `<span class="status bad">${esc(v.error || "nenhum")}</span>`}</div>
          <div class="kv"><span>Testes</span><div>${tested || `<span class="sub">—</span>`}</div></div>
          ${v.last_error ? `<div class="kv"><span>Último erro</span><code>${esc(v.last_error)}</code></div>` : ""}
          <div class="note">O teste grava 1,5 s do monitor escolhido sem salvar nada. Se a GPU não funcionar, escolha "Processador".</div>
        </div>
      </div>${extraSettings(s)}`;
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
  const recs = P.records;
  let car = params.get("car"), track = params.get("track");
  if (!car || !track) {
    const top = [...P.combos].sort((a, b) => b.laps - a.laps)[0] || recs[0];
    if (top) { car = top.car; track = top.track; }
  }
  view.innerHTML = `
    <div class="head"><div><h1>Progresso</h1><div class="sub">Sua evolução, onde você é inconstante e quanto ainda dá para ganhar</div></div></div>
    <div class="kpis">
      <div class="kpi"><span>Horas na pista</span><b class="num">${o.hours.toFixed(1).replace(".", ",")} h</b></div>
      <div class="kpi"><span>Voltas</span><b class="num">${o.laps}</b></div>
      <div class="kpi"><span>Voltas limpas</span><b class="num">${o.clean_laps}</b></div>
      <div class="kpi"><span>Sessões · carro+pista</span><b class="num">${o.sessions} · ${o.combos}</b></div>
    </div>
    <div class="strat two">
      <div class="panel"><h2>Voltas por semana</h2><div id="pgWeeks" class="chart"></div></div>
      <div class="panel"><h2>Seus recordes</h2>
        <table><thead><tr><th>Pista</th><th>Carro</th><th>Recorde</th><th></th></tr></thead><tbody>
        ${recs.map((r) => `<tr class="${r.car === car && r.track === track ? "sel" : ""}"><td>${esc(pretty(r.track))}</td><td>${esc(pretty(r.car))}</td>
          <td class="num best">${fmtLap(r.lap_time_ms)}</td>
          <td class="acts"><a class="btn sm" href="#/progress?car=${encodeURIComponent(r.car)}&track=${encodeURIComponent(r.track)}">Ver evolução</a></td></tr>`).join("")}
        </tbody></table></div>
    </div>
    <div id="pgCombo" style="margin-top:14px"></div>`;
  // gráfico semanal (barras)
  const el = $("#pgWeeks"), W = o.weeks;
  if (W.length) {
    plots.push(new uPlot({
      width: el.clientWidth, height: 200, legend: { show: false }, scales: { x: { time: false, range: [-0.6, W.length - 0.4] } },
      axes: [axis({ values: (u, v) => v.map((i) => (Number.isInteger(i) && W[i] ? new Date(W[i].week + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "")) }),
             axis({ size: 44 })],
      series: [{}, { label: "Voltas", fill: "rgba(255,176,32,.55)", stroke: css("--accent"), width: 1,
        paths: uPlot.paths.bars({ size: [0.6, 40] }), points: { show: false } }],
      cursor: { drag: { x: false, y: false } },
    }, [W.map((_, i) => i), W.map((w) => w.laps)], el));
  }
  if (car && track) comboProgress(car, track);
}

async function comboProgress(car, track) {
  const box = $("#pgCombo");
  box.innerHTML = `<div class="sub">Calculando ${esc(pretty(car))} em ${esc(pretty(track))}…</div>`;
  const C = await api(`/api/progress/combo?car=${encodeURIComponent(car)}&track=${encodeURIComponent(track)}`);
  const cons = C.consistency || { segments: [], laps: [], plan: [] };
  const pb = C.pb;
  const idealMs = cons.ideal_s != null ? Math.round(cons.ideal_s * 1000) : null;
  const segName = (n) => `Trecho ${n}`;
  const planTxt = cons.plan.map((p, i) => {
    const s = cons.segments.find((x) => x.n === p.n);
    return `<li><b>${i + 1}. ${segName(p.n)}</b> — você varia ±${s.std.toFixed(2).replace(".", ",")} s aqui.
      Repetindo o seu melhor (${s.best.toFixed(2).replace(".", ",")} s, volta ${s.best_lap_number}${s.best_started_at ? " de " + fmtDate(s.best_started_at) : ""})
      você ganha em média <b class="posg">${s.potential.toFixed(2).replace(".", ",")} s</b> por volta.
      ${pb ? `<a href="#/compare?a=${pb.lap_id}" data-seg="${s.n}" class="lnk">ver no recorde</a>` : ""}</li>`;
  }).join("");
  box.innerHTML = `
    <div class="head" style="margin-top:6px"><div><h1 style="font-size:20px">${esc(pretty(track))} · ${esc(pretty(car))}</h1>
      <div class="sub">${C.sessions.length} sessões · ${cons.laps.length} voltas limpas recentes analisadas</div></div></div>
    <div class="kpis">
      <div class="kpi best"><span>Seu recorde</span><b class="num">${fmtLap(pb && pb.lap_time_ms)}</b></div>
      <div class="kpi"><span>Volta ideal (melhores trechos)</span><b class="num">${fmtLap(idealMs)}</b></div>
      <div class="kpi"><span>Potencial</span><b class="num posg">${pb && idealMs ? fmtDelta(idealMs - pb.lap_time_ms) : "—"}</b></div>
      <div class="kpi"><span>Recorde melhorou</span><b class="num">${C.pb_history.length > 1 ? fmtDelta(C.pb_history[C.pb_history.length - 1].lap_time_ms - C.pb_history[0].lap_time_ms) : "—"}</b></div>
    </div>
    <div class="strat two">
      <div class="panel"><h2>Evolução por sessão</h2><div id="pgTrend" class="chart"></div>
        <div class="note">Linha cheia: melhor volta da sessão · tracejada: média das voltas limpas. Média caindo = mais consistente.</div></div>
      <div class="panel"><h2>Volta ideal (fantasma)</h2>
        <div class="sub" style="margin-bottom:10px">Junta o seu melhor tempo em cada trecho, de voltas diferentes, numa volta só.
          Use como referência na Análise e no Replay, ou no delta ao vivo.</div>
        <div id="pgIdeal">${C.ideal ? idealCard(C.ideal, pb) : ""}</div>
        <button class="btn primary" id="pgGen" ${pb ? "" : "disabled"}>${C.ideal ? "Atualizar volta ideal" : "Gerar volta ideal"}</button>
        <span class="sub" id="pgGenOut"></span>
      </div>
    </div>
    <div class="strat two" style="margin-top:14px">
      <div class="panel"><h2>Mapa de consistência</h2><div id="pgMap" class="cmap"></div>
        <div class="legend-row"><span><i style="background:#3fd68b"></i>consistente</span><span><i style="background:#ffd23f"></i>médio</span><span><i style="background:#ff5d5d"></i>varia muito</span></div></div>
      <div class="panel"><h2>Plano de treino</h2>
        ${planTxt ? `<ol class="plan">${planTxt}</ol>` : `<div class="sub">Precisa de pelo menos 2 voltas limpas.</div>`}
        <table style="margin-top:12px"><thead><tr><th>Trecho</th><th>Melhor</th><th>Média</th><th>Variação</th><th>Ganho</th></tr></thead><tbody>
        ${cons.segments.map((s) => `<tr><td>${s.n}</td><td class="num">${s.best.toFixed(2)}</td><td class="num">${s.mean.toFixed(2)}</td>
          <td class="num">±${s.std.toFixed(2)}</td><td class="num posg">${s.potential.toFixed(2)}</td></tr>`).join("")}</tbody></table>
      </div>
    </div>`;
  // tendência por sessão
  const el = $("#pgTrend"), S = C.sessions;
  if (S.length > 1) {
    plots.push(new uPlot({
      width: el.clientWidth, height: 220, scales: { x: { time: false } },
      axes: [axis({ values: (u, v) => v.map((i) => (Number.isInteger(i) && S[i] ? new Date(S[i].started_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "")) }),
             axis({ values: (u, v) => v.map((x) => fmtLap(x * 1000).slice(0, -2)), size: 70 })],
      series: [{}, { label: "Melhor", stroke: css("--accent"), width: 2, points: { size: 6, fill: css("--accent") } },
               { label: "Média", stroke: "#8a93a3", width: 1.5, dash: [5, 4], points: { size: 4 } }],
      cursor: { drag: { x: false, y: false } },
    }, [S.map((_, i) => i), S.map((s) => s.best_ms / 1000), S.map((s) => s.avg_ms / 1000)], el));
  } else el.innerHTML = `<div class="sub">Precisa de 2 sessões ou mais.</div>`;
  consistencyMap($("#pgMap"), cons);
  $("#pgGen").onclick = async () => {
    $("#pgGen").disabled = true; $("#pgGenOut").textContent = "Montando…";
    try {
      const r = await api("/api/progress/ideal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ car, track }) });
      $("#pgIdeal").innerHTML = idealCard({ lap_id: r.lap_id, lap_time_ms: r.lap_time_ms }, pb);
      $("#pgGenOut").textContent = "";
    } catch (e) { $("#pgGenOut").textContent = e.message; }
    $("#pgGen").disabled = false;
  };
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
const teamState = { sel: null, polling: null };
try { teamState.sel = localStorage.getItem("pitwall.team") || null; } catch (e) { /* ok */ }
const postJ = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const avatar = (u, cls = "") => u && u.avatar_url
  ? `<img class="ava ${cls}" src="${esc(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="ava ${cls}">${esc(((u && u.name) || "?").trim()[0] || "?").toUpperCase()}</span>`;

async function renderTeam() {
  current = { name: "team" };
  if (teamState.polling) { clearTimeout(teamState.polling); teamState.polling = null; }
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let st;
  try { st = await api("/api/team/status"); } catch (e) { view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if (!st.logged_in) return teamLogin(st);
  const { settings: s } = await api("/api/settings");
  const teams = st.teams || [];
  if (!teams.find((t) => t.id === teamState.sel)) teamState.sel = teams.length ? teams[0].id : null;
  const u = st.user || {};
  view.innerHTML = `
    <div class="head"><div class="row" style="gap:12px">${avatar(u, "lg")}<div><h1 style="margin:0">Equipe</h1>
      <div class="sub">${esc(u.name || "")} · ${esc(u.email || "")}</div></div></div>
      <span class="spacer"></span>
      <a class="btn" href="${esc(st.site_url)}" target="_blank" rel="noopener">Abrir o site</a>
      <button class="btn" id="tUp">Enviar meus recordes</button>
      <button class="btn" id="tOutBtn">Sair da conta</button></div>
    ${st.error ? `<div class="note warn">${esc(st.error)}</div>` : ""}
    ${st.last_error ? `<div class="note warn">Último envio automático falhou: ${esc(st.last_error)}</div>` : ""}
    <div class="chips" style="margin-bottom:14px">${teams.map((t) => `<span class="chip ${t.id === teamState.sel ? "on" : ""}" data-team="${t.id}">${esc(t.name)}${t.role === "owner" ? " ★" : ""}</span>`).join("")}</div>
    <div id="tMain">${teams.length ? `<div class="sub">Carregando a equipe…</div>` : `<div class="panel empty"><b>Você ainda não está em nenhuma equipe</b>Crie uma e mande o convite para os amigos, ou cole o convite que recebeu.</div>`}</div>
    <div class="strat two" style="margin-top:14px">
      <div class="panel fuel"><h2>Entrar numa equipe</h2>
        <label>Convite (link ou código) <input id="tJoin" placeholder="https://…#/join/ABCD1234"></label>
        <div class="row"><button class="btn primary" id="tJoinBtn">Entrar</button><span class="sub" id="tJoinOut"></span></div></div>
      <div class="panel fuel"><h2>Criar equipe</h2>
        <label>Nome <input id="tNew" placeholder="ex.: Foi Mal Engenheiro"></label>
        <div class="row"><button class="btn" id="tNewBtn">Criar</button><span class="sub" id="tNewOut"></span></div></div>
    </div>
    <div class="panel fuel" style="margin-top:14px">
      <label>Enviar meu recorde novo automaticamente <input id="tAuto" type="checkbox" ${s.team_auto_upload ? "checked" : ""}></label>
      <div class="note">Só sobe o seu melhor tempo de cada carro em cada pista (com a telemetria daquela volta), e só quem
        está numa equipe com você consegue ver. Setups nunca saem do seu PC.</div></div>`;
  view.querySelectorAll("[data-team]").forEach((c) => c.onclick = () => {
    teamState.sel = c.dataset.team; try { localStorage.setItem("pitwall.team", teamState.sel); } catch (e) { /* ok */ }
    renderTeam();
  });
  $("#tOutBtn").onclick = async () => { await postJ("/api/team/logout"); renderTeam(); };
  $("#tAuto").onchange = () => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team_auto_upload: $("#tAuto").checked }) });
  $("#tUp").onclick = async () => {
    const b = $("#tUp"); b.disabled = true; b.textContent = "Enviando…";
    try {
      const r = await postJ("/api/team/upload");
      b.textContent = r.errors.length ? "Erro: " + r.errors[0] : `${r.sent} enviado(s) · ${r.skipped} já estavam lá`;
      if (teamState.sel) teamBoard(teams.find((t) => t.id === teamState.sel));
    } catch (e) { b.textContent = e.message; }
    setTimeout(() => { if ($("#tUp")) { b.disabled = false; b.textContent = "Enviar meus recordes"; } }, 3500);
  };
  $("#tJoinBtn").onclick = async () => {
    $("#tJoinOut").textContent = "Entrando…";
    try { const t = await postJ("/api/team/join", { code: $("#tJoin").value }); teamState.sel = t.id; renderTeam(); }
    catch (e) { $("#tJoinOut").textContent = e.message; }
  };
  $("#tNewBtn").onclick = async () => {
    $("#tNewOut").textContent = "Criando…";
    try { const t = await postJ("/api/team/create", { name: $("#tNew").value }); teamState.sel = t.id; renderTeam(); }
    catch (e) { $("#tNewOut").textContent = e.message; }
  };
  if (teamState.sel) teamBoard(teams.find((t) => t.id === teamState.sel));
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
          <li>Só os seus recordes sobem; setups nunca</li>
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

async function teamBoard(team) {
  const box = $("#tMain");
  if (!box || !team) return;
  let data, recs;
  try { [data, recs] = await Promise.all([api(`/api/team/board/${team.id}`), api("/api/records")]); }
  catch (e) { box.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  const owner = team.role === "owner";
  const groups = {};
  for (const r of data.laps) (groups[r.track + "|" + r.car] = groups[r.track + "|" + r.car] || []).push(r);
  const myPb = (car, track) => recs.find((x) => x.car === car && x.track === track);
  box.innerHTML = `
    <div class="strat">
      <div class="panel">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">${esc(team.name)}</h2><span class="spacer"></span>
          <span class="sub">${data.members.length} piloto(s)</span></div>
        <div class="members">${data.members.map((m) => `<div class="mem">${avatar(m)}<span>${esc(m.name)}${m.me ? " (você)" : ""}</span>
          ${m.role === "owner" ? `<span class="tag">dono</span>` : ""}</div>`).join("")}</div>
        <div class="invite"><span class="sub">Convite</span><code id="tInv">${esc(team.invite_link)}</code>
          <div class="row"><button class="btn sm" id="tInvCopy">Copiar convite</button>
          ${owner ? `<button class="btn sm" id="tInvNew" title="O convite antigo para de funcionar">Gerar novo</button>` : ""}
          <span class="spacer"></span><button class="btn sm danger" id="tLeave">Sair da equipe</button></div>
          <div class="note">Mande o link só para quem é da equipe. Quem abrir entra com o Google e já fica na equipe.</div></div>
      </div>
      <div>${Object.keys(groups).length ? Object.values(groups).map((g) => {
        const lead = g[0].lap_time_ms, mine = myPb(g[0].car, g[0].track);
        return `<div class="panel" style="margin-bottom:14px">
          <div class="row" style="margin-bottom:8px"><h2 style="margin:0">${esc(pretty(g[0].track))} · ${esc(pretty(g[0].car))}</h2>
            ${g[0].game !== "acc" ? `<span class="tag">${esc(g[0].game)}</span>` : ""}</div>
          <table><thead><tr><th>#</th><th>Piloto</th><th>Tempo</th><th>Dif.</th><th>S1</th><th>S2</th><th>S3</th><th>Quando</th><th></th></tr></thead><tbody>
          ${g.map((r, i) => `<tr class="${r.me ? "sel" : ""}"><td>${i + 1}</td><td><span class="row" style="gap:8px">${avatar({ name: r.driver, avatar_url: r.avatar_url }, "sm")}${esc(r.driver)}${r.me ? " (você)" : ""}</span></td>
            <td class="num ${i === 0 ? "best" : ""}">${fmtLap(r.lap_time_ms)}</td><td class="num">${i ? fmtDelta(r.lap_time_ms - lead) : "—"}</td>
            <td class="num">${fmtSec(r.s1_ms)}</td><td class="num">${fmtSec(r.s2_ms)}</td><td class="num">${fmtSec(r.s3_ms)}</td>
            <td>${fmtDate(r.recorded_at)}</td>
            <td class="acts">${r.me ? "" : `<button class="btn sm" data-imp="${r.id}" data-mode="compare" data-a="${mine ? mine.lap_id : ""}">Analisar</button>
              <button class="btn sm" data-imp="${r.id}" data-mode="replay" data-a="${mine ? mine.lap_id : ""}">Replay</button>`}</td></tr>`).join("")}
          </tbody></table>
          ${mine ? "" : `<div class="note">Você ainda não tem volta limpa com esse carro nessa pista.</div>`}</div>`;
      }).join("") : `<div class="panel empty"><b>Ninguém enviou voltas ainda</b>Clique em “Enviar meus recordes”.</div>`}</div>
    </div>`;
  $("#tInvCopy").onclick = () => { try { navigator.clipboard.writeText($("#tInv").textContent); } catch (e) { /* ok */ } $("#tInvCopy").textContent = "Copiado"; };
  if ($("#tInvNew")) $("#tInvNew").onclick = async () => {
    const b = $("#tInvNew");
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar (o antigo para)"; return; }
    await postJ("/api/team/invite", { team_id: team.id }); renderTeam();
  };
  $("#tLeave").onclick = async () => {
    const b = $("#tLeave");
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar saída"; return; }
    await postJ("/api/team/leave", { team_id: team.id }); teamState.sel = null; renderTeam();
  };
  box.querySelectorAll("[data-imp]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "Baixando…";
    try {
      const r = await postJ("/api/team/import", { id: b.dataset.imp });
      location.hash = b.dataset.a ? `#/${b.dataset.mode}?a=${b.dataset.a}&b=${r.lap_id}` : `#/${b.dataset.mode}?a=${r.lap_id}`;
    } catch (e) { b.textContent = e.message; }
  });
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

// ---------------------------------------------------------------- configurações extras
function extraSettings(s) {
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${String(val) === String(k) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  return `
    <div class="strat" style="margin-top:14px">
      <div class="panel fuel"><h2>Delta ao vivo</h2>
        <label>Abrir sozinho quando começar a gravar <input id="xOv" type="checkbox" ${s.overlay_enabled ? "checked" : ""}></label>
        <label>Comparar contra ${sel("xOvRef", [["pb", "Seu recorde"], ["ideal", "Volta ideal"]], s.overlay_reference)}</label>
        <div class="row" style="margin-top:12px"><button class="btn" id="xOvOpen">Abrir agora</button></div>
        <div class="note">Uma janelinha sempre por cima do jogo com o delta da volta, o tempo previsto e quantas voltas o
          combustível aguenta (e quanto falta até a bandeirada na corrida). Use o jogo em “janela sem bordas”. Mostrar/esconder
          também pelo ícone perto do relógio.</div>
      </div>
      <div class="panel fuel"><h2>Setup sugerido</h2>
        <label>Escolher pela temperatura ${sel("xBasis", [["air", "do ar"], ["track", "da pista"]], s.setup_temp_basis)}</label>
        <label>Variante preferida <input id="xVar" placeholder="ex.: Safe, Esport (vazio = qualquer)" value="${esc(s.setup_variant_pref)}"></label>
        <div class="note">Quando a sessão começa, o Pitwall procura na sua biblioteca o setup do carro e da pista mais próximo
          da temperatura do momento (e do tipo de sessão: classificação ou corrida) e avisa na notificação.</div>
      </div>
    </div>
    <div class="strat" style="margin-top:14px">
      <div class="panel fuel"><h2>Jogos</h2>
        <label>Ler telemetria de ${sel("xGames", [["auto", "Detectar sozinho (ACC e iRacing)"], ["acc", "Só ACC"], ["iracing", "Só iRacing"]], s.games)}</label>
        <div class="note">iRacing: o traçado no mapa é reconstruído pela velocidade e direção (o jogo não informa a posição),
          e o engenheiro de setup fica limitado (o iRacing não dá o ângulo de deriva ao vivo). Le Mans Ultimate ainda não.
          Mudar aqui exige reiniciar o Pitwall.</div>
      </div>
      <div class="panel fuel"><h2>Backup</h2>
        <label>Backup automático <input id="xBk" type="checkbox" ${s.backup_enabled ? "checked" : ""}></label>
        <label>A cada ${sel("xBkH", [[6, "6 horas"], [24, "1 dia"], [72, "3 dias"], [168, "1 semana"]], s.backup_every_hours)}</label>
        <label>Guardar os últimos ${sel("xBkK", [[5, "5"], [10, "10"], [20, "20"], [50, "50"]], s.backup_keep)}</label>
        <label>Pasta <input id="xBkDir" placeholder="padrão" value="${esc(s.backup_dir)}"></label>
        <div class="row" style="margin-top:12px"><button class="btn" id="xBkRun">Fazer backup agora</button><span class="sub" id="xBkOut"></span></div>
        <div id="xBkList" style="margin-top:10px"></div>
      </div>
    </div>`;
}
function bindExtraSettings(draw) {
  const put = (v) => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
  $("#xOv").onchange = () => put({ overlay_enabled: $("#xOv").checked });
  $("#xOvRef").onchange = () => put({ overlay_reference: $("#xOvRef").value });
  $("#xOvOpen").onclick = openOverlay;
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
if (!location.hash.startsWith("#/overlay")) pollLive();
