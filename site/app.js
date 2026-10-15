/* Pitwall · site da equipe: entrar (Google ou link por e-mail), equipes, convites e ranking. */
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
const fmtGap = (ms) => "+" + (ms / 1000).toFixed(3);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
const avatar = (u, cls = "") => u && u.avatar_url
  ? `<img class="ava ${cls}" src="${esc(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="ava ${cls}" aria-hidden="true">${esc(((u && u.name) || "?").trim()[0] || "?").toUpperCase()}</span>`;
const inviteLink = (code) => location.origin + location.pathname + "#/join/" + code;
const PENDING = "pitwall.pendingJoin";
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ok */ } } };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let session = null, profile = null, stopCircuit = null;

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- roteador
function route() {
  if (stopCircuit) { stopCircuit(); stopCircuit = null; }
  if (typeof stopAnalysis === "function") stopAnalysis();
  window.scrollTo(0, 0);
  const h = location.hash || "#/";
  let m;
  if ((m = h.match(/^#\/join\/([A-Za-z0-9]{8})/))) return joinRoute(m[1].toUpperCase());
  if (!session) return renderLanding();
  if ((m = h.match(/^#\/team\/([0-9a-f-]{36})/))) return renderTeam(m[1]);
  if ((m = h.match(/^#\/compare\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?/))) return renderAnalysis(m[1], m[2]);
  markTop();
  if (h.startsWith("#/ranking")) return renderCommunity();
  return renderHome();
}
window.addEventListener("hashchange", route);

function markTop() {
  const h = location.hash || "#/";
  const top = h.startsWith("#/ranking") ? "ranking" : (h === "#/" || h === "#") ? "home" : "";
  document.querySelectorAll("[data-top]").forEach((a) => a.classList.toggle("on", a.dataset.top === top));
}

function renderMe() {
  const el = $("#me");
  if (!session) { el.innerHTML = `<a class="btn small quiet" href="#entrar" id="goLogin">Entrar</a>`; return; }
  const u = profile || {};
  el.innerHTML = `<nav class="topnav"><a href="#/ranking" data-top="ranking">🏆 Comunidade</a><a href="#/" data-top="home">Minhas equipes</a></nav>${avatar(u)}<span class="name">${esc(u.name || session.user.email)}</span>
    <button class="btn small quiet" id="logout">Sair</button>`;
  markTop();
  $("#logout").onclick = async () => { await sb.auth.signOut(); };
}

async function loadProfile() {
  if (!session) { profile = null; return; }
  const { data } = await sb.from("profiles").select("id,name,avatar_url").eq("id", session.user.id).maybeSingle();
  const meta = session.user.user_metadata || {};
  profile = data || { id: session.user.id, name: meta.full_name || meta.name || session.user.email, avatar_url: meta.avatar_url };
}

// ---------------------------------------------------------------- página inicial (não logado)
const GOOGLE = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const TRACK = "M180 470 C118 470 88 418 110 368 L188 192 C210 140 262 122 312 142 L420 190 C462 208 500 200 522 164 L560 96 C586 54 642 50 682 76 L860 190 C906 220 914 276 880 310 L762 420 C730 450 736 490 772 505 L822 526 C862 546 850 592 804 592 L302 592 C250 592 228 540 262 510 L282 490 C292 478 272 470 254 470 Z";

function renderLanding(invite) {
  view.innerHTML = `
    <section class="hero">
      <div class="wrap">
        <div class="pitch">
          <h1>Sua volta contra a volta deles.</h1>
          <p>O Pitwall grava suas voltas no ACC e no iRacing e coloca você na mesma pista que os seus amigos:
            ranking da equipe, telemetria lado a lado e replay para ver onde está a diferença.</p>
          <div class="pitboard" id="entrar">
            ${invite ? `<div class="invite-note">${avatar({ name: "+" })}<div>Você foi convidado para uma <b>equipe</b>. Entre para aceitar.</div></div>` : ""}
            <button class="btn google" id="gLogin">${GOOGLE}Continuar com Google</button>
            <div class="or">ou receba um link no e-mail</div>
            <form class="mail" id="mailForm">
              <label for="email" style="position:absolute;left:-9999px">E-mail</label>
              <input class="field" id="email" type="email" autocomplete="email" placeholder="seu@email.com" required>
              <button class="btn go" type="submit" id="mailBtn">Enviar link</button>
            </form>
            <div class="msg" id="loginMsg" role="status"></div>
            <p class="fine">Mesma conta no site e no app do PC. Só a sua equipe vê as suas voltas; setups nunca saem do seu PC.</p>
          </div>
        </div>
        <div class="circuit" aria-hidden="true">
          <svg viewBox="70 40 860 590">
            <path d="${TRACK}" fill="none" stroke="#2a3548" stroke-width="46" stroke-linejoin="round"/>
            <path d="${TRACK}" fill="none" stroke="#1a2333" stroke-width="40" stroke-linejoin="round"/>
            <path d="${TRACK}" fill="none" stroke="#f2a93b" stroke-width="1.6" stroke-dasharray="7 11" opacity=".4" id="tline"/>
            <g id="sf"></g>
            <circle id="carBglow" r="24" fill="#a77bff" opacity=".2"/><circle id="carB" r="10" fill="#a77bff"/>
            <circle id="carAglow" r="24" fill="#f2a93b" opacity=".22"/><circle id="carA" r="10" fill="#f2a93b"/>
          </svg>
          <div class="tower">
            <div><span class="pos">1</span><span class="who"><i class="dot" style="background:var(--purple)"></i>Lucas</span><span class="gap fast">2:17.512</span></div>
            <div><span class="pos">2</span><span class="who"><i class="dot" style="background:var(--sodium)"></i>Você</span><span class="gap plus" id="liveGap">+0.508</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="uses">
      <div class="wrap">
        <h2>Feito para correr com os amigos</h2>
        <div class="use">
          <div class="copy"><h3>Ranking da equipe em cada pista</h3>
            <p>Cada recorde que você bate no app sobe sozinho. A equipe vê, por carro e por pista, quem está na frente
              e por quanto, com os três setores.</p></div>
          <div class="shot"><div class="mini-board">
            <div><span class="p">1</span><span>Lucas</span><span class="t" style="color:var(--purple)">1:47.112</span></div>
            <div class="you"><span class="p">2</span><span>Você</span><span class="t">+0.214</span></div>
            <div><span class="p">3</span><span>Rafa</span><span class="t">+0.903</span></div>
          </div></div>
        </div>
        <div class="use">
          <div class="copy"><h3>Convite por link</h3>
            <p>Crie a equipe e mande o link no grupo. Quem abre entra com a conta Google e já cai dentro da equipe,
              sem cadastro e sem senha.</p></div>
          <div class="shot link-demo">
            <code>devhygor.github.io/pitwall/#/join/7F3A91C2</code>
            <div class="steps"><span>Abre o link</span><span>Entra com Google</span><span>Já está na equipe</span></div>
          </div>
        </div>
        <div class="use">
          <div class="copy"><h3>Onde você perde o tempo</h3>
            <p>No app, a volta do amigo vira referência: velocidade, freio e acelerador sobrepostos, o delta curva a
              curva e o replay com os dois carros na pista.</p></div>
          <div class="shot">
            <svg viewBox="0 0 520 190" role="img" aria-label="Exemplo de gráfico de velocidade de duas voltas">
              <path d="M0 40 C40 40 60 44 80 120 C92 160 120 160 140 120 C170 60 200 30 260 30 C300 30 310 60 330 140 C340 170 370 168 390 120 C420 70 470 50 520 46" fill="none" stroke="#a77bff" stroke-width="2.5"/>
              <path d="M0 42 C38 42 58 50 84 126 C96 164 126 166 146 126 C176 66 206 36 262 34 C302 34 314 66 336 148 C346 176 378 172 396 128 C426 78 472 56 520 52" fill="none" stroke="#f2a93b" stroke-width="2.5"/>
              <rect x="300" y="10" width="64" height="172" fill="#ff5a5f" opacity=".1" rx="6"/>
              <text x="306" y="28" fill="#ff5a5f" font-family="Barlow Condensed" font-weight="700" font-size="18">+0.18</text>
            </svg>
          </div>
        </div>
      </div>
    </section>

    <section class="cta-band"><div class="wrap">
      <div><h2>O app grava sozinho enquanto você corre</h2>
        <p>Windows, ACC e iRacing. Abre junto com o Windows e só aparece quando você entra na pista.</p></div>
      <a class="btn go" href="${esc(PITWALL.download)}">Baixar o Pitwall</a>
    </div></section>`;

  $("#gLogin").onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) setMsg(error.message, "err");
  };
  $("#mailForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    $("#mailBtn").disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("#mailBtn").disabled = false;
    if (error) setMsg(/rate|limit/i.test(error.message) ? "Muitos pedidos seguidos. Espere alguns minutos e tente de novo." : error.message, "err");
    else setMsg(`Pronto. Abra o e-mail que mandamos para ${email} e clique no link para entrar.`, "ok");
  };
  if (location.hash === "#entrar") $("#entrar").scrollIntoView();
  stopCircuit = animateCircuit();
}
function setMsg(t, cls) { const m = $("#loginMsg"); m.textContent = t; m.className = "msg " + (cls || ""); }

// os dois carros na pista: você (âmbar) contra o recorde da equipe (roxo)
function animateCircuit() {
  const line = $("#tline");
  if (!line) return null;
  const L = line.getTotalLength();
  const put = (id, s) => {
    const p = line.getPointAtLength(((s % 1) + 1) % 1 * L);
    for (const k of [id, id + "glow"]) { const c = document.getElementById(k); c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); }
  };
  const p0 = line.getPointAtLength(0);
  $("#sf").innerHTML = `<rect x="${p0.x - 3}" y="${p0.y - 24}" width="6" height="48" fill="#eef2f7" opacity=".85"/>`;
  if (reduced) { put("carB", 0.34); put("carA", 0.31); return null; }
  const lapB = 14000, lapA = 14080;
  let raf, last = 0;
  const t0 = performance.now();
  const tick = (now) => {
    const t = now - t0;
    // ritmo varia ao longo da volta: freia nas curvas, acelera nas retas
    const sB = t / lapB, sA = t / lapA - 0.012 * Math.sin(t / 900);
    put("carB", sB); put("carA", sA);
    if (now - last > 120) {
      last = now;
      const gapMs = Math.max(40, ((sB - sA) % 1) * 137512);
      const g = $("#liveGap"); if (g) g.textContent = fmtGap(gapMs);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ---------------------------------------------------------------- convite
async function joinRoute(code) {
  if (!session) { store.set(PENDING, code); return renderLanding(true); }
  view.innerHTML = `<div class="loading">Entrando na equipe…</div>`;
  try {
    const t = await rpc("join_team", { code });
    store.set(PENDING, null);
    location.hash = `#/team/${t.id}`;
  } catch (e) {
    store.set(PENDING, null);
    view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Esse convite não funcionou</b>
      <p>${esc(e.message)}. Peça um link novo para quem criou a equipe.</p><br><a class="btn" href="#/">Ir para as suas equipes</a></div></div>`;
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
  view.innerHTML = `<div class="loading">Carregando as suas equipes…</div>`;
  let teams = [];
  try { teams = await myTeams(); } catch (e) { view.innerHTML = `<div class="wrap page"><div class="panel">${esc(e.message)}</div></div>`; return; }
  if (teams.length === 1 && !store.get("pitwall.stayHome")) { location.hash = `#/team/${teams[0].id}`; return; }
  const first = ((profile && profile.name) || "").split(" ")[0];
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>${first ? `Boa, ${esc(first)}.` : "Suas equipes"}</h1>
      <div class="sub">${teams.length ? "Escolha uma equipe para ver o ranking." : "Crie a sua equipe ou entre com um convite."}</div></div></div>
    ${teams.length ? `<div class="teams">${teams.map((t) => `<a class="team-tile" href="#/team/${t.id}"><b>${esc(t.name)}</b>
      <span>${t.role === "owner" ? "Você criou" : "Você participa"}</span></a>`).join("")}</div>` : ""}
    <div class="two">
      <div class="panel"><h2>Criar equipe</h2>
        <form class="inline" id="newForm"><input class="field" id="newName" placeholder="Nome da equipe" minlength="2" maxlength="60" required>
          <button class="btn go" type="submit">Criar</button></form><div class="msg" id="newOut"></div></div>
      <div class="panel"><h2>Tenho um convite</h2>
        <form class="inline" id="joinForm"><input class="field" id="joinCode" placeholder="Cole o link ou o código" required>
          <button class="btn" type="submit">Entrar na equipe</button></form><div class="msg" id="joinOut"></div></div>
    </div>
    ${appPanel()}</div>`;
  $("#newForm").onsubmit = async (e) => {
    e.preventDefault(); $("#newOut").textContent = "Criando…";
    try { const t = await rpc("create_team", { team_name: $("#newName").value.trim() }); location.hash = `#/team/${t.id}`; }
    catch (err) { $("#newOut").textContent = err.message; $("#newOut").className = "msg err"; }
  };
  $("#joinForm").onsubmit = (e) => {
    e.preventDefault();
    const m = $("#joinCode").value.trim().match(/([A-Za-z0-9]{8})\/?$/);
    if (!m) { $("#joinOut").textContent = "Esse convite não parece certo. Cole o link inteiro que você recebeu."; $("#joinOut").className = "msg err"; return; }
    location.hash = `#/join/${m[1].toUpperCase()}`;
  };
}

function appPanel() {
  return `<div class="panel" style="margin-top:14px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap">
    <div><h2 style="margin-bottom:6px">Suas voltas entram pelo app</h2>
      <div class="help" style="margin:0">Instale o Pitwall no PC e abra Equipe → Entrar com Google, com esta mesma conta.
        Seus recordes aparecem aqui sozinhos.</div></div>
    <a class="btn go" href="${esc(PITWALL.download)}">Baixar o Pitwall</a></div>`;
}

async function renderTeam(id) {
  view.innerHTML = `<div class="loading">Carregando a equipe…</div>`;
  const [{ data: team, error: e1 }, { data: members, error: e2 }, board] = await Promise.all([
    sb.from("teams").select("id,name,invite_code,owner,logo_url").eq("id", id).maybeSingle(),
    sb.from("team_members").select("role,user_id,joined_at,profiles(name,avatar_url)").eq("team_id", id).order("joined_at"),
    rpc("team_board", { t: id }).catch(() => []),
  ]);
  if (e1 || e2 || !team) {
    view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Equipe não encontrada</b>
      <p>Você não faz parte dela, ou ela foi apagada.</p><br><a class="btn" href="#/">Ir para as suas equipes</a></div></div>`;
    return;
  }
  const laps = Array.isArray(board) ? board : [];
  const me = session.user.id, owner = team.owner === me;
  const groups = {};
  for (const r of laps) (groups[[r.track, r.car, r.game].join("|")] = groups[[r.track, r.car, r.game].join("|")] || []).push(r);
  const mine = laps.filter((l) => l.user_id === me).length;
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div class="team-title">${teamLogo(team)}<div><a class="back" href="#/" id="allTeams">Suas equipes</a><h1>${esc(team.name)}</h1>
      <div class="sub">${members.length} ${members.length === 1 ? "piloto" : "pilotos"}, ${Object.keys(groups).length} ${Object.keys(groups).length === 1 ? "combinação" : "combinações"} de carro e pista</div></div></div></div>
    <div class="layout">
      <div>${Object.keys(groups).length ? Object.values(groups).map((g) => {
        const lead = g[0].lap_time_ms;
        return `<section class="combo"><div class="combo-head"><h3>${esc(pretty(g[0].track))}</h3>
            <small>${esc(pretty(g[0].car))}${g[0].game !== "acc" ? ` · ${esc(g[0].game)}` : ""}</small></div>
          <div class="rows">
            <div class="row head"><span class="p">Pos</span><span>Piloto</span><span style="text-align:right">Tempo</span><span style="text-align:right">Diferença</span>
              <span class="sec">S1</span><span class="sec">S2</span><span class="sec">S3</span></div>
            ${rowsHtml(g, me)}
          </div></section>`;
      }).join("") : `<div class="panel empty"><b>Ninguém enviou voltas ainda</b><p>No app do PC, abra Equipe e clique em “Enviar meus recordes”.</p></div>`}
      ${mine ? "" : appPanel()}</div>
      <aside class="side">
        <div class="panel"><h2>Pilotos</h2>
          ${members.map((m) => `<div class="member">${avatar(m.profiles)}<span>${esc((m.profiles || {}).name || "?")}${m.user_id === me ? " (você)" : ""}</span>
            <span class="role">${m.role === "owner" ? "criou a equipe" : ""}</span>
            ${owner && m.user_id !== me ? `<button class="btn small quiet chip-x" data-kick="${m.user_id}" aria-label="Remover ${esc((m.profiles || {}).name || "")}">Remover</button>` : ""}</div>`).join("")}</div>
        <div class="panel"><h2>Chamar mais gente</h2>
          <code class="inv" id="inv">${esc(inviteLink(team.invite_code))}</code>
          <div class="inline"><button class="btn go small" id="copy">Copiar link</button>
            ${navigator.share ? `<button class="btn small" id="share">Compartilhar</button>` : ""}
            ${owner ? `<button class="btn small quiet" id="newInv">Trocar link</button>` : ""}</div>
          <p class="help">Quem abrir o link entra com o Google e já fica na equipe. Mande só para quem é da equipe.</p></div>
        ${owner ? `<div class="panel"><h2>Logo da equipe</h2>
          <div class="inline" style="align-items:center">${teamLogo(team, "lg")}
            <label class="btn small">Enviar imagem<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label></div>
          <p class="help" id="logoOut">PNG, JPG, WEBP ou SVG até 2 MB.</p></div>` : ""}
        <button class="btn danger small" id="leave">${owner ? "Apagar equipe" : "Sair da equipe"}</button>
      </aside>
    </div></div>`;
  $("#allTeams").onclick = () => store.set("pitwall.stayHome", "1");
  bindRows(view);
  const lf = $("#logoFile");
  if (lf) lf.onchange = async () => {
    const f = lf.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { $("#logoOut").textContent = "A imagem precisa ter até 2 MB."; return; }
    $("#logoOut").textContent = "Enviando…";
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[f.type] || "png";
    const path = `${id}/logo.${ext}`;
    const up = await sb.storage.from("team-logos").upload(path, f, { upsert: true, contentType: f.type });
    if (up.error) { $("#logoOut").textContent = up.error.message; return; }
    const url = sb.storage.from("team-logos").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
    const { error } = await sb.from("teams").update({ logo_url: url }).eq("id", id);
    if (error) { $("#logoOut").textContent = error.message; return; }
    renderTeam(id);
  };
  $("#copy").onclick = () => { navigator.clipboard.writeText($("#inv").textContent).catch(() => {}); $("#copy").textContent = "Link copiado"; };
  if ($("#share")) $("#share").onclick = () => navigator.share({ title: `${team.name} no Pitwall`, text: `Entra na equipe ${team.name} no Pitwall:`, url: $("#inv").textContent }).catch(() => {});
  if ($("#newInv")) $("#newInv").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "O link atual vai parar. Trocar?"; return; }
    await rpc("new_invite_code", { t: id }); renderTeam(id);
  };
  view.querySelectorAll("[data-kick]").forEach((b) => b.onclick = async () => {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Remover mesmo?"; return; }
    await sb.from("team_members").delete().eq("team_id", id).eq("user_id", b.dataset.kick); renderTeam(id);
  });
  $("#leave").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = owner ? "Apagar para todos?" : "Sair mesmo?"; return; }
    const { error } = owner ? await sb.from("teams").delete().eq("id", id)
      : await sb.from("team_members").delete().eq("team_id", id).eq("user_id", me);
    if (error) { b.textContent = error.message; return; }
    store.set("pitwall.stayHome", "1");
    location.hash = "#/";
  };
}

// ---------------------------------------------------------------- linhas do ranking (equipe e comunidade)
const teamLogo = (t, cls = "") => t && t.logo_url
  ? `<img class="tlogo ${cls}" src="${esc(t.logo_url)}" alt="">`
  : `<span class="tlogo ${cls}">${esc((t && t.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
let myRecs = null;
async function myRecords() {
  if (myRecs) return myRecs;
  const { data } = await sb.from("laps").select("id,car,track,game").eq("user_id", session.user.id);
  myRecs = data || [];
  return myRecs;
}
function rowsHtml(g, me) {
  const lead = g[0].lap_time_ms;
  return g.map((r, i) => `<div class="row ${i === 0 ? "first" : ""} ${r.user_id === me ? "mine" : ""}">
    <span class="p">${i + 1}</span>
    <span class="name">${avatar({ name: r.driver, avatar_url: r.avatar_url })}<span>${esc(r.driver)} ${r.user_id === me ? "<em>você</em>" : ""}<br><em>${fmtDate(r.recorded_at)}</em></span></span>
    <span class="time">${fmtLap(r.lap_time_ms)}</span>
    <span class="gap">${i ? fmtGap(r.lap_time_ms - lead) : ""}</span>
    <span class="sec">${fmtSec(r.s1_ms)}</span><span class="sec">${fmtSec(r.s2_ms)}</span><span class="sec">${fmtSec(r.s3_ms)}</span>
    <span class="racts">${r.clip_path ? `<span class="pill" title="Tem vídeo da volta">▶</span>` : ""}${r.setup_name ? `<button class="pill" data-setup="${r.id}" title="Baixar o setup: ${esc(r.setup_name)}">⚙</button>` : ""}
      <button class="btn small" data-cmp="${r.id}" data-combo="${esc(r.track + "|" + r.car + "|" + r.game)}" data-me="${r.user_id === me ? 1 : ""}">${r.user_id === me ? "Ver" : "Comparar"}</button></span></div>`).join("");
}
function bindRows(root) {
  root.querySelectorAll("[data-cmp]").forEach((b) => b.onclick = async () => {
    if (b.dataset.me) { location.hash = `#/compare/${b.dataset.cmp}`; return; }
    const [track, car, game] = b.dataset.combo.split("|");
    const mine = (await myRecords()).find((x) => x.track === track && x.car === car && x.game === game);
    location.hash = mine ? `#/compare/${mine.id}/${b.dataset.cmp}` : `#/compare/${b.dataset.cmp}`;
  });
  root.querySelectorAll("[data-setup]").forEach((b) => b.onclick = async () => {
    const { data, error } = await sb.from("laps").select("setup_name,setup_json,car,track").eq("id", b.dataset.setup).maybeSingle();
    if (error || !data || !data.setup_json) return;
    const blob = new Blob([JSON.stringify(JSON.parse(data.setup_json), null, "\t")], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${data.setup_name}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

// ---------------------------------------------------------------- ranking da comunidade
async function renderCommunity() {
  view.innerHTML = `<div class="loading">Carregando o ranking…</div>`;
  const { data, error } = await sb.from("laps").select("id,user_id,game,car,track,lap_time_ms,s1_ms,s2_ms,s3_ms,recorded_at,setup_name,clip_path,profiles(name,avatar_url)")
    .order("track").order("car").order("lap_time_ms").limit(3000);
  if (error) { view.innerHTML = `<div class="wrap page"><div class="panel">${esc(error.message)}</div></div>`; return; }
  const rows = (data || []).map((r) => ({ ...r, driver: (r.profiles || {}).name || "?", avatar_url: (r.profiles || {}).avatar_url }));
  const groups = {};
  for (const r of rows) (groups[[r.track, r.car, r.game].join("|")] = groups[[r.track, r.car, r.game].join("|")] || []).push(r);
  const keys = Object.keys(groups);
  const me = session.user.id;
  let sel = store.get("pitwall.comm");
  if (!groups[sel]) sel = keys.find((k) => groups[k].some((r) => r.user_id === me)) || keys[0];
  const g = groups[sel] || [];
  const pos = g.findIndex((r) => r.user_id === me);
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>Comunidade</h1><div class="sub">O recorde de cada piloto do Pitwall, por pista e carro.</div></div></div>
    ${keys.length ? `<div class="inline" style="align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <select class="field" id="combo" style="max-width:420px">${keys.map((k) => { const [t, c] = k.split("|"); return `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(pretty(t))} · ${esc(pretty(c))} (${groups[k].length})</option>`; }).join("")}</select>
      ${pos >= 0 ? `<span class="mypos">Você está em <b>${pos + 1}º</b> de ${g.length}</span>` : ""}</div>
    <section class="combo"><div class="combo-head"><h3>${esc(pretty(g[0].track))}</h3><small>${esc(pretty(g[0].car))}</small></div>
      <div class="rows"><div class="row head"><span class="p">Pos</span><span>Piloto</span><span style="text-align:right">Tempo</span><span style="text-align:right">Diferença</span>
        <span class="sec">S1</span><span class="sec">S2</span><span class="sec">S3</span><span></span></div>${rowsHtml(g.slice(0, 200), me)}</div></section>`
      : `<div class="panel empty"><b>Ninguém no ranking ainda</b><p>Envie seus recordes pelo app do PC.</p></div>`}</div>`;
  const c = $("#combo");
  if (c) c.onchange = () => { store.set("pitwall.comm", c.value); renderCommunity(); };
  bindRows(view);
}

// ---------------------------------------------------------------- comparar duas voltas (site)
async function decodeTel(b64) {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate"));
  return JSON.parse(await new Response(stream).text());
}
// ---------------------------------------------------------------- início
// Importante: não chamar o Supabase direto dentro do onAuthStateChange (trava a sessão);
// o tratamento roda logo depois, fora do callback.
async function onSession(ev, s) {
  const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
  session = s;
  if (s && /[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
  if (!changed && ev !== "INITIAL_SESSION") return;
  try { await loadProfile(); } catch (e) { /* segue com os dados da conta */ }
  renderMe();
  const pending = store.get(PENDING);
  if (session && pending && !location.hash.startsWith("#/join/")) { location.hash = `#/join/${pending}`; return; }
  route();
}
view.innerHTML = `<div class="loading">Carregando…</div>`;
sb.auth.onAuthStateChange((ev, s) => { setTimeout(() => onSession(ev, s), 0); });
