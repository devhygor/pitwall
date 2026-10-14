/* Pitwall · site da equipe (login com Google, equipes, convites e ranking). */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const sb = window.supabase.createClient(PITWALL.url, PITWALL.key, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const UPPER = new Set(["gt2", "gt3", "gt4", "lms", "amr", "rs", "gtr", "evo", "ii", "m4", "m6", "m2", "cs", "rc", "f", "v8", "v12", "nsx", "r8", "gt"]);
const pretty = (n) => !n ? "—" : n.replace(/[_-]+/g, " ").split(" ").filter(Boolean)
  .map((w) => (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
function fmtLap(ms) {
  if (ms == null || ms <= 0) return "—";
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
const fmtSec = (ms) => (ms == null ? "—" : ms >= 60000 ? fmtLap(ms) : (ms / 1000).toFixed(3));
const fmtDelta = (ms) => (ms == null ? "—" : ms === 0 ? "0.000" : (ms > 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3));
const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const avatar = (u, cls = "") => u && u.avatar_url
  ? `<img class="ava ${cls}" src="${esc(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="ava ${cls}">${esc(((u && u.name) || "?").trim()[0] || "?").toUpperCase()}</span>`;
const inviteLink = (code) => location.origin + location.pathname + "#/join/" + code;
const PENDING = "pitwall.pendingJoin";
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ok */ } } };

let session = null;
let profile = null;

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- roteador
async function route() {
  const h = location.hash || "#/";
  let m;
  if ((m = h.match(/^#\/join\/([A-Za-z0-9]{8})/))) return joinRoute(m[1].toUpperCase());
  if (!session) return renderLogin();
  if ((m = h.match(/^#\/team\/([0-9a-f-]{36})/))) return renderTeam(m[1]);
  return renderHome();
}
window.addEventListener("hashchange", route);

function renderMe() {
  const el = $("#me");
  if (!session) { el.innerHTML = ""; return; }
  const u = profile || {};
  el.innerHTML = `<div class="row">${avatar(u)}<span class="hide-sm">${esc(u.name || session.user.email)}</span>
    <button class="btn sm" id="logout">Sair</button></div>`;
  $("#logout").onclick = async () => { await sb.auth.signOut(); };
}

async function loadProfile() {
  if (!session) { profile = null; return; }
  const { data } = await sb.from("profiles").select("id,name,avatar_url").eq("id", session.user.id).maybeSingle();
  const meta = session.user.user_metadata || {};
  profile = data || { id: session.user.id, name: meta.full_name || meta.name || session.user.email, avatar_url: meta.avatar_url };
}

// ---------------------------------------------------------------- login
function login() {
  return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
}
const GOOGLE = `<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function renderLogin(joining) {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Seu engenheiro de corrida.<br><span>E a sua equipe junto.</span></h1>
        <p class="lead">O Pitwall grava suas voltas no ACC e no iRacing, mostra onde você perde tempo e compara
          a sua volta com a dos seus companheiros: telemetria, traçado e replay lado a lado.</p>
        ${joining ? `<div class="note">Você recebeu um convite para uma equipe. Entre com o Google para aceitar.</div>` : ""}
        <button class="btn google" id="login">${GOOGLE} Entrar com Google</button>
        <a class="btn" href="${esc(PITWALL.download)}" style="margin-left:8px">Baixar o app (Windows)</a>
      </div>
      <ul class="feat">
        <li><b>Ranking da equipe</b> por pista e carro, com setores</li>
        <li><b>Convite por link</b>: o amigo entra com o Google e já está dentro</li>
        <li><b>Análise e replay</b> contra a volta do amigo, direto no app</li>
        <li><b>Privado</b>: só a sua equipe vê suas voltas. Setups nunca saem do seu PC</li>
      </ul>
    </section>`;
  $("#login").onclick = login;
}

async function joinRoute(code) {
  if (!session) { store.set(PENDING, code); return renderLogin(true); }
  view.innerHTML = `<div class="sub">Entrando na equipe…</div>`;
  try {
    const t = await rpc("join_team", { code });
    store.set(PENDING, null);
    location.hash = `#/team/${t.id}`;
  } catch (e) {
    store.set(PENDING, null);
    view.innerHTML = `<div class="panel empty"><b>Não deu para entrar</b>${esc(e.message)}<br><br><a class="btn" href="#/">Voltar</a></div>`;
  }
}

// ---------------------------------------------------------------- equipes
async function myTeams() {
  const { data, error } = await sb.from("team_members").select("role,teams(id,name,invite_code,owner,created_at)")
    .eq("user_id", session.user.id);
  if (error) throw new Error(error.message);
  return (data || []).filter((r) => r.teams).map((r) => ({ ...r.teams, role: r.role }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function renderHome() {
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let teams = [];
  try { teams = await myTeams(); } catch (e) { view.innerHTML = `<div class="panel"><span class="bad">${esc(e.message)}</span></div>`; return; }
  if (teams.length === 1 && !store.get("pitwall.stayHome")) { location.hash = `#/team/${teams[0].id}`; return; }
  view.innerHTML = `
    <div class="head"><div><h1>Suas equipes</h1><div class="sub">Olá, ${esc((profile && profile.name) || "")}!</div></div></div>
    ${teams.length ? `<div class="grid">${teams.map((t) => `<a class="card" href="#/team/${t.id}"><div class="t">${esc(t.name)}</div>
      <div class="c">${t.role === "owner" ? "Você é o dono" : "Membro"}</div></a>`).join("")}</div>`
      : `<div class="panel empty"><b>Você ainda não está em nenhuma equipe</b>Crie uma e mande o convite, ou abra o link de convite que recebeu.</div>`}
    <div class="two" style="margin-top:16px">
      <div class="panel"><h2>Criar equipe</h2>
        <div class="row"><input id="newName" placeholder="ex.: Foi Mal Engenheiro"><button class="btn primary" id="newBtn">Criar</button></div>
        <div class="sub" id="newOut"></div></div>
      <div class="panel"><h2>Tenho um convite</h2>
        <div class="row"><input id="joinCode" placeholder="link ou código"><button class="btn" id="joinBtn">Entrar</button></div>
        <div class="sub" id="joinOut"></div></div>
    </div>
    ${appBox()}`;
  $("#newBtn").onclick = async () => {
    $("#newOut").textContent = "Criando…";
    try { const t = await rpc("create_team", { team_name: $("#newName").value.trim() }); location.hash = `#/team/${t.id}`; }
    catch (e) { $("#newOut").textContent = e.message; }
  };
  $("#joinBtn").onclick = () => {
    const m = $("#joinCode").value.trim().match(/([A-Za-z0-9]{8})\/?$/);
    if (!m) { $("#joinOut").textContent = "Convite inválido."; return; }
    location.hash = `#/join/${m[1].toUpperCase()}`;
  };
}

function appBox() {
  return `<div class="panel app-box"><div><h2>Use o app no PC</h2>
    <div class="sub">É o app que grava as voltas. Depois de instalar, abra <b>Equipe → Entrar com Google</b> com esta mesma conta:
      suas equipes aparecem lá e seus recordes sobem sozinhos.</div></div>
    <a class="btn primary" href="${esc(PITWALL.download)}">Baixar (Windows)</a></div>`;
}

async function renderTeam(id) {
  view.innerHTML = `<div class="sub">Carregando a equipe…</div>`;
  const [{ data: team, error: e1 }, { data: members, error: e2 }, board] = await Promise.all([
    sb.from("teams").select("id,name,invite_code,owner").eq("id", id).maybeSingle(),
    sb.from("team_members").select("role,user_id,joined_at,profiles(name,avatar_url)").eq("team_id", id).order("joined_at"),
    rpc("team_leaderboard", { t: id }).catch((e) => ({ error: e })),
  ]);
  if (e1 || e2 || !team) {
    view.innerHTML = `<div class="panel empty"><b>Equipe não encontrada</b>Você não faz parte dela ou ela foi apagada.<br><br><a class="btn" href="#/">Voltar</a></div>`;
    return;
  }
  const laps = Array.isArray(board) ? board : [];
  const me = session.user.id, owner = team.owner === me;
  const groups = {};
  for (const r of laps) (groups[r.track + "|" + r.car + "|" + r.game] = groups[r.track + "|" + r.car + "|" + r.game] || []).push(r);
  const tracks = [...new Set(laps.map((l) => l.track))];
  const myLaps = laps.filter((l) => l.user_id === me).length;
  view.innerHTML = `
    <div class="head"><div><a class="sub" href="#/" id="allTeams">← Suas equipes</a><h1>${esc(team.name)}</h1>
      <div class="sub">${members.length} piloto(s) · ${tracks.length} pista(s) · ${laps.length} recorde(s)</div></div></div>
    <div class="layout">
      <div>${Object.keys(groups).length ? Object.values(groups).map((g) => {
        const lead = g[0].lap_time_ms;
        return `<div class="panel" style="margin-bottom:14px">
          <div class="row" style="margin-bottom:8px"><h2 style="margin:0">${esc(pretty(g[0].track))} · ${esc(pretty(g[0].car))}</h2>
            ${g[0].game !== "acc" ? `<span class="tag">${esc(g[0].game)}</span>` : ""}</div>
          <div class="tbl"><table><thead><tr><th>#</th><th>Piloto</th><th>Tempo</th><th>Dif.</th><th class="hide-sm">S1</th><th class="hide-sm">S2</th><th class="hide-sm">S3</th><th class="hide-sm">Quando</th></tr></thead><tbody>
          ${g.map((r, i) => `<tr class="${r.user_id === me ? "sel" : ""}"><td>${i + 1}</td>
            <td><span class="row" style="gap:8px">${avatar({ name: r.driver, avatar_url: r.avatar_url }, "sm")}${esc(r.driver)}${r.user_id === me ? " (você)" : ""}</span></td>
            <td class="num ${i === 0 ? "best" : ""}">${fmtLap(r.lap_time_ms)}</td><td class="num">${i ? fmtDelta(r.lap_time_ms - lead) : "—"}</td>
            <td class="num hide-sm">${fmtSec(r.s1_ms)}</td><td class="num hide-sm">${fmtSec(r.s2_ms)}</td><td class="num hide-sm">${fmtSec(r.s3_ms)}</td>
            <td class="hide-sm">${fmtDate(r.recorded_at)}</td></tr>`).join("")}
          </tbody></table></div></div>`;
      }).join("") : `<div class="panel empty"><b>Ninguém enviou voltas ainda</b>No app do PC: Equipe → Enviar meus recordes.</div>`}
      ${myLaps ? "" : appBox()}</div>
      <div class="side">
        <div class="panel"><h2>Pilotos</h2>
          <div class="members">${members.map((m) => `<div class="mem">${avatar(m.profiles)}<span>${esc((m.profiles || {}).name || "?")}${m.user_id === me ? " (você)" : ""}</span>
            ${m.role === "owner" ? `<span class="tag">dono</span>` : ""}
            ${owner && m.user_id !== me ? `<button class="btn sm ghost" data-kick="${m.user_id}" title="Remover da equipe">✕</button>` : ""}</div>`).join("")}</div></div>
        <div class="panel"><h2>Convidar</h2>
          <code class="inv" id="inv">${esc(inviteLink(team.invite_code))}</code>
          <div class="row" style="margin-top:10px"><button class="btn primary sm" id="copy">Copiar link</button>
            ${navigator.share ? `<button class="btn sm" id="share">Compartilhar</button>` : ""}
            ${owner ? `<button class="btn sm" id="newInv" title="O link antigo para de funcionar">Gerar novo</button>` : ""}</div>
          <div class="note">Mande só para quem é da equipe: quem abrir o link entra com o Google e já fica dentro.</div></div>
        <div class="panel"><button class="btn danger sm" id="leave">${owner ? "Apagar equipe" : "Sair da equipe"}</button></div>
      </div>
    </div>`;
  $("#allTeams").onclick = () => store.set("pitwall.stayHome", "1");
  $("#copy").onclick = () => { navigator.clipboard.writeText($("#inv").textContent).catch(() => {}); $("#copy").textContent = "Copiado!"; };
  if ($("#share")) $("#share").onclick = () => navigator.share({ title: `Equipe ${team.name} no Pitwall`, text: `Entra na equipe ${team.name} no Pitwall:`, url: $("#inv").textContent }).catch(() => {});
  if ($("#newInv")) $("#newInv").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmar"; return; }
    await rpc("new_invite_code", { t: id }); renderTeam(id);
  };
  view.querySelectorAll("[data-kick]").forEach((b) => b.onclick = async () => {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Remover?"; return; }
    await sb.from("team_members").delete().eq("team_id", id).eq("user_id", b.dataset.kick); renderTeam(id);
  });
  $("#leave").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = owner ? "Confirmar: apagar para todos" : "Confirmar saída"; return; }
    const { error } = owner ? await sb.from("teams").delete().eq("id", id)
      : await sb.from("team_members").delete().eq("team_id", id).eq("user_id", me);
    if (error) { b.textContent = error.message; return; }
    store.set("pitwall.stayHome", "1");
    location.hash = "#/";
  };
}

// ---------------------------------------------------------------- início
sb.auth.onAuthStateChange(async (ev, s) => {
  const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
  session = s;
  if (s && /[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
  if (!changed && ev !== "INITIAL_SESSION") return;
  await loadProfile();
  renderMe();
  const pending = store.get(PENDING);
  if (session && pending && !location.hash.startsWith("#/join/")) { location.hash = `#/join/${pending}`; return; }
  route();
});
