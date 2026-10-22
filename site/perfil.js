/* Pitwall · perfil do piloto: dados do cadastro (editável no seu), progresso das voltas e o resumo do LFM.
   Também põe o selo Pro/Equipe ao lado dos nomes (qualquer elemento com data-uid) e faz o nome abrir o perfil. */
"use strict";

// ---------------------------------------------------------------- nomes clicáveis com selo
const TIER_NAME = { pro: "Pro", team: "Equipe" };
const tierBadge = (t) => (t && TIER_NAME[t] ? `<em class="tier ${t}" title="Plano ${TIER_NAME[t]}">${TIER_NAME[t]}</em>` : "");
const uname = (id, name) => (id ? `<a class="ulink" href="#/perfil/${esc(id)}" data-uid="${esc(id)}">${esc(name || "?")}</a>` : esc(name || "?"));

const _tiers = new Map();                 // id -> "pro" | "team" | ""
let _tierTimer = null;
async function decorateTiers() {
  const els = [...document.querySelectorAll("[data-uid]:not([data-tdone])")];
  if (!els.length || !session) return;
  const need = [...new Set(els.map((e) => e.dataset.uid))].filter((i) => !_tiers.has(i));
  if (need.length) {
    try {
      const rows = (await sb.rpc("plan_tiers", { p_ids: need.slice(0, 500) })).data || [];
      need.forEach((i) => _tiers.set(i, ""));
      rows.forEach((r) => _tiers.set(r.user_id, r.tier));
    } catch (e) { return; }
  }
  els.forEach((e) => {
    if (e.dataset.tdone) return;
    e.dataset.tdone = "1";
    const t = _tiers.get(e.dataset.uid);
    if (t) e.insertAdjacentHTML("afterend", tierBadge(t));
  });
}
new MutationObserver(() => { clearTimeout(_tierTimer); _tierTimer = setTimeout(decorateTiers, 120); })
  .observe(document.getElementById("view") || document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------- perfil
const PF_GAME = { acc: "ACC", iracing: "iRacing" };
const pfAgo = (iso) => {
  const m = Math.max(0, (Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`;
};

const pfSec = (ms) => fmtLap(Math.round(ms));
const pfDiff = (ms) => (ms >= 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3).replace(".", ",") + " s";

async function renderProfile(id) {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  let r;
  try { r = await rpc("public_profile", { p_id: id }); } catch (e) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">${esc(e.message)}</div></div></section>`; return; }
  if (!r || !r.ok) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">Perfil não encontrado.</div></div></section>`; return; }
  const mine = !!r.me, st = r.stats || {}, recs = r.records || [];
  _tiers.set(r.id, r.tier || "");
  // resumo de sessões enviado pelo app (sem telemetria); some se o piloto deixou o progresso privado
  let PR = [];
  if (!r.progress_hidden) {
    const q = await sb.from("progress_sessions").select("game,car,track,started_at,laps,best_ms,avg_ms,rating,pace,consistency,clean").eq("user_id", id).order("started_at").limit(5000);
    PR = q.data || [];
  }
  // combinações: do resumo de sessões, completadas pelos recordes (que podem existir sem sessões)
  const combos = new Map();
  const key = (x) => `${x.game}|${x.car}|${x.track}`;
  for (const p of PR) {
    const c = combos.get(key(p)) || { game: p.game, car: p.car, track: p.track, sessions: [], laps: 0, best: null, last: null };
    c.sessions.push(p); c.laps += p.laps || 0; c.best = c.best == null ? p.best_ms : Math.min(c.best, p.best_ms || c.best); c.last = p.started_at; combos.set(key(p), c);
  }
  for (const x of recs) {
    const c = combos.get(key(x)) || { game: x.game, car: x.car, track: x.track, sessions: [], laps: x.laps || 0, best: null, last: x.last };
    c.best = c.best == null ? x.best : Math.min(c.best, x.best); c.laps = Math.max(c.laps, x.laps || 0); c.last = c.last && c.last > x.last ? c.last : x.last; combos.set(key(x), c);
  }
  const list = [...combos.values()].sort((a, b) => b.sessions.length - a.sessions.length || b.laps - a.laps);
  const top = list[0];
  const days = new Set(PR.map((p) => String(p.started_at).slice(0, 10))).size;
  const K = PR.length
    ? [["Voltas", Math.max(st.laps || 0, PR.reduce((a, p) => a + (p.laps || 0), 0))], ["Sessões", PR.length], ["Pistas", new Set(list.map((c) => c.track)).size], ["Carros", new Set(list.map((c) => c.car)).size], ["Dias correndo", Math.max(days, st.days || 0)]]
    : [["Voltas", st.laps || 0], ["Pistas", st.tracks || 0], ["Carros", st.cars || 0], ["Dias correndo", st.days || 0]];
  view.innerHTML = `<section class="sect"><div class="wrap prof">
    <div class="prof-head panel">
      <span class="ava-xl">${avatar({ name: r.name, avatar_url: r.avatar_url })}</span>
      <div class="prof-id"><h1>${esc(r.name || "Piloto")}${tierBadge(r.tier)}</h1>
        <div class="sub">Piloto desde ${new Date(r.since).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}${st.last ? ` · última volta há ${pfAgo(st.last)}` : ""}</div>
        ${r.bio ? `<p class="prof-bio">${esc(r.bio)}</p>` : ""}
        ${mine ? `<div class="prof-actions"><button class="btn small" id="pfEdit">Editar perfil</button><a class="btn small quiet" href="#/conta">Meu plano e conta</a></div>` : ""}</div>
    </div>
    ${mine ? `<div class="panel" id="pfForm" hidden></div>` : ""}
    <div class="kpis prof-kpis">${K.map(([t, v]) => `<div class="kpi"><small>${t}</small><b>${v}</b></div>`).join("")}</div>
    <div class="panel"><h2>Progresso</h2>
      ${r.progress_hidden ? `<p class="sub">Este piloto prefere manter o progresso (sessões, médias e rating) privado. Os recordes continuam visíveis.</p>` : ""}
      ${list.length ? `<p class="sub">Toque numa linha para ver a evolução daquela combinação de carro e pista.</p>
        <div class="tbl-wrap"><table class="tbl prof-recs"><thead><tr><th>Pista</th><th>Carro</th><th>Melhor volta</th><th>Sessões</th><th>Voltas</th>${PR.length ? "<th>Rating</th>" : ""}<th>Última</th></tr></thead><tbody>
        ${list.map((x, i) => `<tr data-i="${i}" class="${x === top ? "on" : ""}"><td>${esc(pretty(x.track))}</td><td>${esc(pretty(x.car))}${x.game && x.game !== "acc" ? ` <small class="sub">${esc(PF_GAME[x.game] || x.game)}</small>` : ""}</td>
          <td><b>${fmtLap(x.best)}</b></td><td>${x.sessions.length || "—"}</td><td>${x.laps}</td>${PR.length ? `<td>${x.sessions.length ? (x.sessions[x.sessions.length - 1].rating ?? "—") : "—"}</td>` : ""}<td>${fmtDate(x.last)}</td></tr>`).join("")}</tbody></table></div>
        <h3 id="pfChartTitle" style="margin:16px 0 4px"></h3><div id="pfSummary" class="sub"></div>
        <div class="lfm-charts"><div><h3>Evolução por sessão</h3><div id="pfTrend" class="prof-chart"></div></div>
          <div><h3>Rating por sessão</h3><div id="pfRate" class="prof-chart"></div></div></div>
        ${PR.length ? `<h3 style="margin:16px 0 6px">Voltas por semana</h3><div id="pfWeeks" class="prof-chart"></div>` : ""}`
        : `<p class="sub">${mine ? "Ainda sem voltas enviadas. Grave sessões no app com a conta do Pitwall conectada." : "Ainda sem voltas enviadas."}</p>`}
    </div>
    <div id="pfLfm"></div>
  </div></section>`;
  if (mine) bindProfileEdit(r);
  if (list.length) {
    view.querySelectorAll(".prof-recs tr[data-i]").forEach((tr) => tr.onclick = () => {
      view.querySelectorAll(".prof-recs tr").forEach((t) => t.classList.toggle("on", t === tr)); comboCharts(list[+tr.dataset.i]);
    });
    comboCharts(top);
    weeksChart(PR);
  }
  renderLfm(r, mine);
}

const pfAx = () => {
  const cs = getComputedStyle(document.documentElement), fog = cs.getPropertyValue("--fog").trim() || "#8b93a1", line = cs.getPropertyValue("--line").trim() || "#2a3140";
  return { stroke: fog, grid: { stroke: line, width: 1 }, ticks: { stroke: line } };
};

function comboCharts(c) {
  $("#pfChartTitle").textContent = `${pretty(c.track)} · ${pretty(c.car)}`;
  const S = c.sessions, trend = $("#pfTrend"), rate = $("#pfRate"), sum = $("#pfSummary");
  if (S.length < 2) {
    const msg = `<div class="sub">${S.length ? "Precisa de 2 sessões ou mais para o gráfico." : "Sem resumo de sessões para esta combinação ainda."}</div>`;
    trend.innerHTML = msg; rate.innerHTML = ""; sum.textContent = c.best ? `Recorde ${fmtLap(c.best)}` : "";
    return;
  }
  const xs = S.map((p) => new Date(p.started_at) / 1000), ax = pfAx(), w = Math.max(260, trend.clientWidth);
  const first = S[0].best_ms, bestNow = Math.min(...S.map((p) => p.best_ms));
  const last = S[S.length - 1];
  sum.innerHTML = `Recorde <b>${fmtLap(c.best || bestNow)}</b> · ${first > bestNow ? `evoluiu <b style="color:var(--sodium)">${pfDiff(bestNow - first)}</b> desde a 1ª sessão` : "ainda sem evolução do recorde"} · rating atual <b>${last.rating ?? "—"}</b> · ${S.length} sessões`;
  trend.innerHTML = ""; rate.innerHTML = "";
  new uPlot({
    width: w, height: 220, legend: { show: false }, cursor: { drag: { x: false, y: false } }, scales: { x: { time: true } },
    axes: [ax, { ...ax, size: 72, values: (u, v) => v.map((n) => fmtLap(Math.round(n))) }],
    series: [{}, { label: "Melhor", value: (u, v) => pfSec(v), stroke: "#2ee59d", width: 2, points: { size: 6, fill: "#2ee59d" } },
      { label: "Média", value: (u, v) => pfSec(v), stroke: "#8a93a3", width: 1.5, dash: [5, 4], points: { size: 4 }, spanGaps: true }],
  }, [xs, S.map((p) => p.best_ms), S.map((p) => p.avg_ms)], trend);
  new uPlot({
    width: Math.max(260, rate.clientWidth), height: 220, legend: { show: false }, cursor: { drag: { x: false, y: false } }, scales: { x: { time: true }, y: { range: [0, 100] } },
    axes: [ax, { ...ax, size: 40 }],
    series: [{}, { label: "Rating", stroke: "#2ee59d", width: 2.4, points: { size: 6, fill: "#2ee59d" } },
      { label: "Ritmo", stroke: "#8a93a3", width: 1, dash: [4, 4], points: { show: false }, spanGaps: true },
      { label: "Consistência", stroke: "#b98cff", width: 1, dash: [4, 4], points: { show: false }, spanGaps: true }],
  }, [xs, S.map((p) => p.rating), S.map((p) => p.pace), S.map((p) => p.consistency)], rate);
}

function weeksChart(PR) {
  const box = $("#pfWeeks"); if (!box || !PR.length) return;
  const by = new Map();
  for (const p of PR) {
    const d = new Date(p.started_at), mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); mon.setHours(12, 0, 0, 0);
    const k = mon.toISOString().slice(0, 10); by.set(k, (by.get(k) || 0) + (p.laps || 0));
  }
  const ws = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!ws.length) return;
  const ax = pfAx(); box.innerHTML = "";
  new uPlot({
    width: Math.max(260, box.clientWidth), height: 200, legend: { show: false }, cursor: { drag: { x: false, y: false } },
    scales: { x: { time: false, range: [-0.6, ws.length - 0.4] } },
    axes: [{ ...ax, values: (u, v) => v.map((i) => (Number.isInteger(i) && ws[i] ? new Date(ws[i][0] + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "")) }, { ...ax, size: 44 }],
    series: [{}, { label: "Voltas", stroke: "#2ee59d", fill: "rgba(46,229,157,.55)", width: 1, paths: uPlot.paths.bars({ size: [0.6, 40] }), points: { show: false } }],
  }, [ws.map((_, i) => i), ws.map((w) => w[1])], box);
}

// ---------------------------------------------------------------- LFM
// gráficos do LFM (ELO e Safety Rating) com eixos, pontos e caixinha de valores ao passar o mouse
function lfmChart(box, series, color, label, dec) {
  const pts = (series || []).filter((p) => p.rating != null && p.date);
  if (!box) return;
  if (pts.length < 2) { box.innerHTML = `<div class="sub">Poucas medições para o gráfico.</div>`; return; }
  const cs = getComputedStyle(document.documentElement), fog = cs.getPropertyValue("--fog").trim() || "#8b93a1", line = cs.getPropertyValue("--line").trim() || "#2a3140";
  const xs = pts.map((p) => new Date(p.date + "T12:00:00") / 1000), ys = pts.map((p) => p.rating);
  const ax = { stroke: fog, grid: { stroke: line, width: 1 }, ticks: { stroke: line } };
  box.innerHTML = "";
  new uPlot({
    width: Math.max(260, box.clientWidth), height: 200, legend: { show: false }, cursor: { drag: { x: false, y: false } }, scales: { x: { time: true } },
    axes: [ax, { ...ax, size: 54, values: (u, v) => v.map((n) => (dec ? n.toFixed(dec).replace(".", ",") : Math.round(n))) }],
    series: [{}, { label, value: (u, v) => (dec ? v.toFixed(dec).replace(".", ",") : String(Math.round(v))), stroke: color, width: 2.2, fill: color + "22", points: { size: 6, fill: color } }],
  }, [xs, ys], box);
}
const pfNum = (n, d = 0) => (n == null ? "—" : d ? String(Math.round(n * 10 ** d) / 10 ** d).replace(".", ",") : String(Math.round(n)));
function renderLfm(r, mine) {
  const box = $("#pfLfm"); if (!box) return;
  const l = r.lfm;
  if (!l) { box.innerHTML = mine ? `<div class="panel"><h2>Low Fuel Motorsport</h2><p class="sub">Para mostrar o seu ELO, SR e as últimas corridas do LFM aqui, abra o app do Pitwall, vá em <b>LFM</b>, cole o link do seu perfil e deixe a conta do Pitwall conectada. O resumo é publicado sozinho.</p></div>` : ""; return; }
  const acc = l.acc || {}, s = l.stats || {}, races = l.races || [];
  box.innerHTML = `<div class="panel"><div class="lfm-top"><h2>Low Fuel Motorsport</h2>
      <a class="btn small quiet" href="${esc(l.url)}" target="_blank" rel="noopener">Abrir no LFM</a></div>
    <div class="lfm-grid">
      <div class="lfm-card"><small>ELO (ACC)</small><b>${pfNum(acc.rating != null ? acc.rating : l.elo)}</b>${l.elo_delta != null ? `<span class="${l.elo_delta >= 0 ? "up" : "down"}">${l.elo_delta >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(l.elo_delta))}</span>` : ""}</div>
      <div class="lfm-card"><small>Licença</small><b>${esc(acc.license || l.license || "—")}</b><span class="sub">${acc.division != null ? "Divisão " + esc(acc.division) : ""}</span></div>
      <div class="lfm-card"><small>Safety Rating</small><b>${pfNum(l.safety_rating, 2)}</b><span class="sub">${esc(l.sr_license || "")}</span></div>
      <div class="lfm-card"><small>Equipe no LFM</small><b class="sm">${esc((l.team && l.team.name) || "—")}</b><span class="sub">${esc(l.country || "")}</span></div>
    </div>
    <div class="lfm-stats">${[["Corridas", s.starts], ["Vitórias", s.wins], ["Pódios", s.podium], ["Poles", s.poles], ["Top 5", s.top5], ["Chegada média", s.avg_r, 1], ["Largada média", s.avg_q, 1]]
      .map(([t, v, d]) => `<div><b>${pfNum(v, d)}</b><small>${t}</small></div>`).join("")}</div>
    <div class="lfm-charts"><div><h3>Evolução do ELO</h3><div id="pfElo" class="prof-chart"></div></div>
      <div><h3>Evolução do Safety Rating</h3><div id="pfSr" class="prof-chart"></div></div></div>
    ${races.length ? `<h3 style="margin:16px 0 6px">Últimas corridas</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Evento</th><th>Carro · pista</th><th>Largada → chegada</th><th>ELO</th><th>SR</th><th>Inc.</th></tr></thead><tbody>
      ${races.map((x) => `<tr><td>${x.date ? fmtDate(x.date) : ""}</td><td>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.event || "")}</a>` : esc(x.event || "")}${x.sim_id === 1 ? "" : ` <small class="sub">outro sim</small>`}</td>
        <td class="sub">${esc(x.car || "")} · ${esc(x.track || "")}</td><td>P${x.start ?? "—"} → <b>P${x.finish ?? "—"}</b></td>
        <td class="${(x.elo_change || 0) >= 0 ? "up" : "down"}">${x.elo_change != null ? (x.elo_change > 0 ? "+" : "") + x.elo_change : "—"}</td>
        <td class="${(x.sr_change || 0) >= 0 ? "up" : "down"}">${x.sr_change != null ? (x.sr_change > 0 ? "+" : "") + String(x.sr_change).replace(".", ",") : "—"}</td><td>${x.incidents ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="note">Dados do LFM, publicados pelo app do Pitwall${r.lfm_at ? ` (atualizado há ${pfAgo(r.lfm_at)})` : ""}.</div></div>`;
  lfmChart($("#pfElo"), l.elo_graph, "#a77bff", "ELO");
  lfmChart($("#pfSr"), l.sr_graph, "#2ee59d", "SR", 2);
}

// ---------------------------------------------------------------- edição do meu perfil
function bindProfileEdit(r) {
  const form = $("#pfForm"), me = session.user.id;
  $("#pfEdit").onclick = () => {
    form.hidden = !form.hidden;
    if (form.hidden) return;
    const meta = session.user.user_metadata || {};
    form.innerHTML = `<h2>Editar perfil</h2>
      <div class="pf-grid">
        <div><label class="pf-l">Foto</label><div class="pf-photo"><span id="pfPrev">${avatar({ name: r.name, avatar_url: r.avatar_url })}</span>
          <div><input type="file" id="pfFile" accept="image/*" hidden><button class="btn small" id="pfPick" type="button">Escolher foto</button>
          ${meta.avatar_url || meta.picture ? `<button class="btn small quiet" id="pfGoogle" type="button">Usar a do Google</button>` : ""}</div></div></div>
        <div><label class="pf-l" for="pfName">Nome</label><input class="field" id="pfName" maxlength="60" value="${esc(r.name || "")}">
          <label class="pf-l" for="pfBio">Sobre você</label><textarea class="field" id="pfBio" maxlength="300" rows="3" placeholder="ex.: piloto de ACC, GT3, de Curitiba">${esc(r.bio || "")}</textarea>
          <label class="pf-l">E-mail</label><input class="field" value="${esc(session.user.email)}" disabled>
          <div class="pf-row"><button class="btn go small" id="pfSave" type="button">Salvar perfil</button></div></div>
      </div>
      <h3 style="margin:20px 0 6px">Privacidade</h3>
      <label class="pf-chk"><input type="checkbox" id="pfShow" ${r.show_progress === false ? "" : "checked"}> Mostrar o meu progresso (sessões, médias e rating) no meu perfil</label>
      <p class="sub">Desligado, os outros pilotos veem só seus recordes e o resumo do LFM; o progresso fica visível só para você.</p>
      <h3 style="margin:20px 0 6px">Senha</h3>
      <p class="sub">Defina uma senha para entrar também com e-mail e senha (na tela inicial, “Entrar com senha”). Google e link por e-mail continuam funcionando.</p>
      <div class="adm-form"><input class="field" id="pfPw" type="password" autocomplete="new-password" placeholder="nova senha (mínimo 8)"><input class="field" id="pfPw2" type="password" autocomplete="new-password" placeholder="repita a senha"><button class="btn small" id="pfPwGo" type="button">Definir senha</button></div>`;
    const setAva = async (url) => {
      const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", me);
      if (error) { toast(friendlyError(error.message), "err"); return; }
      r.avatar_url = url; if (profile) profile.avatar_url = url; renderMe();
      $("#pfPrev").innerHTML = avatar({ name: r.name, avatar_url: url }); document.querySelector(".ava-xl").innerHTML = avatar({ name: r.name, avatar_url: url });
      toast("Foto atualizada", "ok");
    };
    $("#pfPick").onclick = () => $("#pfFile").click();
    $("#pfFile").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Não deu para abrir essa imagem.")); i.src = URL.createObjectURL(f); });
        const c = document.createElement("canvas"); c.width = c.height = 320;
        const sz = Math.min(img.width, img.height); c.getContext("2d").drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, 320, 320);
        const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.88));
        const path = `${me}/avatar.jpg`;
        const up = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
        if (up.error) throw new Error(up.error.message);
        await setAva(sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now());
      } catch (err) { toast(friendlyError(err.message), "err"); }
    };
    const g = $("#pfGoogle"); if (g) g.onclick = () => setAva(meta.avatar_url || meta.picture);
    $("#pfSave").onclick = async () => {
      const res = await rpc("set_my_profile", { p_name: $("#pfName").value, p_bio: $("#pfBio").value });
      if (!res || !res.ok) { toast((res && res.error) || "Não foi possível salvar.", "err"); return; }
      toast("Perfil salvo", "ok"); await loadProfile(); renderMe(); renderProfile(me);
    };
    $("#pfShow").onchange = async (e) => {
      const res = await rpc("set_my_progress_visibility", { p_show: e.target.checked });
      if (res && res.ok) { r.show_progress = e.target.checked; toast(e.target.checked ? "Progresso visível no perfil" : "Progresso privado", "ok"); }
      else toast("Não foi possível salvar.", "err");
    };
    $("#pfPwGo").onclick = async () => {
      const a = $("#pfPw").value, b = $("#pfPw2").value;
      if (a.length < 8) { toast("A senha precisa ter pelo menos 8 caracteres.", "err"); return; }
      if (a !== b) { toast("As duas senhas não são iguais.", "err"); return; }
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { toast(friendlyError(error.message), "err"); return; }
      $("#pfPw").value = $("#pfPw2").value = ""; toast("Senha definida", "ok");
    };
  };
}
