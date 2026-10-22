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
$("#dlTop").href = PITWALL.download;

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
  if (h.startsWith("#/planos")) { markTop(); return renderPlans(); }
  if (!session) return renderLanding();
  if (h.startsWith("#/conta")) { markTop(); return renderAccount(); }
  if (h.startsWith("#/indicar")) { markTop(); return renderReferral(); }
  if (h.startsWith("#/afiliado")) { markTop(); return renderAffiliate(); }
  if (h.startsWith("#/admin")) { markTop(); return renderAdmin(); }
  if ((m = h.match(/^#\/team\/([0-9a-f-]{36})/))) return renderTeam(m[1]);
  if ((m = h.match(/^#\/compare\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?/))) return renderAnalysis(m[1], m[2]);
  markTop();
  if (h.startsWith("#/ranking")) return renderCommunity();
  return renderHome();
}
window.addEventListener("hashchange", route);

function markTop() {
  const h = location.hash || "#/";
  const top = h.startsWith("#/ranking") ? "ranking" : h.startsWith("#/planos") ? "planos" : h.startsWith("#/conta") ? "conta" : h.startsWith("#/indicar") ? "indicar" : h.startsWith("#/afiliado") ? "afiliado" : h.startsWith("#/admin") ? "admin" : (h === "#/" || h === "#") ? "home" : "";
  document.querySelectorAll("[data-top]").forEach((a) => a.classList.toggle("on", a.dataset.top === top));
}

function renderMe() {
  const el = $("#me");
  if (!session) {
    el.innerHTML = `<nav class="topnav pub"><a href="#analise" data-go="analise">Comparar</a><a href="#overlays" data-go="overlays">Overlays</a><a href="#engenheiro" data-go="engenheiro">Engenheiro</a><a href="#equipe" data-go="equipe">Equipe</a><a href="#/planos" data-top="planos">Planos</a></nav>
      <a class="btn small quiet" href="#entrar" data-go="entrar" id="goLogin">Entrar</a>`;
    return;
  }
  const u = profile || {};
  el.innerHTML = `<nav class="topnav"><a href="#/ranking" data-top="ranking">🏆 Comunidade</a><a href="#/" data-top="home">Minhas equipes</a><a href="#/planos" data-top="planos">Planos</a><a href="#/indicar" data-top="indicar">Indique e ganhe</a><a href="#/conta" data-top="conta">Conta</a>${typeof isAffiliate !== "undefined" && isAffiliate ? `<a href="#/afiliado" data-top="afiliado">Painel do afiliado</a>` : ""}${typeof isAdmin !== "undefined" && isAdmin ? `<a href="#/admin" data-top="admin">Admin</a>` : ""}</nav>${avatar(u)}<span class="name">${esc(u.name || session.user.email)}</span>
    <button class="btn small quiet" id="logout">Sair</button>`;
  markTop();
  $("#logout").onclick = async () => { await sb.auth.signOut(); };
}

async function loadProfile() {
  if (!session) { profile = null; return; }
  const { data } = await sb.from("profiles").select("id,name,avatar_url").eq("id", session.user.id).maybeSingle();
  const meta = session.user.user_metadata || {};
  profile = data || { id: session.user.id, name: meta.full_name || meta.name || session.user.email, avatar_url: meta.avatar_url };
  if (typeof loadAccountFlags === "function") await loadAccountFlags();
}

// ---------------------------------------------------------------- página inicial (não logado)
const GOOGLE = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const TRACK = "M180 470 C118 470 88 418 110 368 L188 192 C210 140 262 122 312 142 L420 190 C462 208 500 200 522 164 L560 96 C586 54 642 50 682 76 L860 190 C906 220 914 276 880 310 L762 420 C730 450 736 490 772 505 L822 526 C862 546 850 592 804 592 L302 592 C250 592 228 540 262 510 L282 490 C292 478 272 470 254 470 Z";

const DL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16"/></svg>`;
const ico = (d) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const FEATURES = [
  ["Grava sozinho", "Abre com o Windows e começa a gravar quando você entra na pista. Cada volta, setor e sessão fica guardada, sem apertar nada.", ico(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/>`)],
  ["Telemetria completa", "Velocidade, freio, acelerador, marcha, volante e pneus, volta a volta e curva a curva, em gráficos que você consegue ler.", ico(`<path d="M3 17l5-6 4 3 5-8 4 5"/><path d="M3 21h18"/>`)],
  ["Análise de voltas", "O delta mostra em que ponto da pista você ganha e perde tempo. Acontecimentos como travadas e saídas aparecem marcados na volta.", ico(`<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>`)],
  ["Compare com os amigos", "Sua melhor volta contra a de um companheiro de equipe, mesmo em carros diferentes, lado a lado e com o replay dos dois na pista.", ico(`<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.6"/><path d="M3 20c.4-3.4 3-5.5 6-5.5s5.6 2.1 6 5.5M16 14.6c2.7 0 4.6 1.8 5 4.4"/>`)],
  ["Vídeo sincronizado", "Grave a tela junto com a telemetria. Ao passar o mouse no gráfico, o vídeo vai exatamente para aquele ponto da volta.", ico(`<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>`)],
  ["Engenheiro de setup", "Lê as suas voltas, identifica sub e sobresterço, travadas e patinagem, e sugere ajustes em cliques para o setup do ACC.", ico(`<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>`)],
];

function overlayShots() {
  const bar = (c, h) => `<i style="background:${c};height:${h}%"></i>`;
  const tyre = (t, p, c) => `<div class="ty" style="--c:${c}"><b>${t}°</b><small>${p}</small></div>`;
  const row = (p, n, g, cls = "") => `<div class="${cls}"><span class="p">${p}</span><span class="n">${n}</span><span class="g">${g}</span></div>`;
  return `
    <figure class="ov ov-map"><div class="screen">
      <svg viewBox="70 40 860 590" aria-hidden="true">
        <path d="${TRACK}" fill="none" stroke="#3a4560" stroke-width="40" stroke-linejoin="round"/>
        <path d="${TRACK}" fill="none" stroke="#0e1420" stroke-width="30" stroke-linejoin="round"/>
        <path d="M262 592 H600" fill="none" stroke="#ffd23f" stroke-width="30" opacity=".9"/>
        <circle cx="822" cy="526" r="13" fill="#2ee59d"/><circle cx="522" cy="164" r="10" fill="#a77bff"/><circle cx="420" cy="190" r="10" fill="#8e9bb2"/>
        <path d="M560 70v52l34-12-34-14" fill="#ffd23f"/><path d="M560 60v90" stroke="#eef2f7" stroke-width="5"/>
      </svg>
    </div><figcaption><b>Mapa com bandeiras</b><span>A pista com todos os carros. A bandeira amarela acende no trecho certo.</span></figcaption></figure>
    <figure class="ov ov-part"><div class="screen"><div class="grid-part">
      ${row(1, "Lucas", "1:47.112", "best")}${row(2, "Você", "+0.214", "you")}${row(3, "Rafa", "+0.903")}${row(4, "Bia", "+1.480")}
    </div></div><figcaption><b>Participantes</b><span>Posições, intervalos e tendência. Roxo para a melhor volta, verde para a sua.</span></figcaption></figure>
    <figure class="ov ov-ped"><div class="screen"><div class="pedals">
      <div class="pbar">${bar("#39d98a", 86)}${bar("#ff5a5f", 28)}${bar("#4aa3ff", 6)}</div>
      <div class="wheel"><svg viewBox="0 0 48 48" width="54" height="54" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="none" stroke="#eef2f7" stroke-width="4" transform="rotate(-18 24 24)"/><path d="M5 24h13M30 24h13M24 30v13" stroke="#eef2f7" stroke-width="4" transform="rotate(-18 24 24)"/></svg><b>5</b><small>214 km/h</small></div>
    </div></div><figcaption><b>Pedais e volante</b><span>Acelerador, freio e embreagem em tempo real, com marcha e velocidade.</span></figcaption></figure>
    <figure class="ov ov-tyre"><div class="screen"><div class="tyres">
      ${tyre(84, "27.4", "#2ee59d")}${tyre(86, "27.6", "#3b9cff")}${tyre(79, "27.1", "#39d98a")}${tyre(81, "27.2", "#39d98a")}
    </div></div><figcaption><b>Pneus</b><span>Temperatura e pressão das quatro rodas, com a cor mostrando a janela ideal.</span></figcaption></figure>
    <figure class="ov ov-delta"><div class="screen"><div class="dlt">
      <small>contra a sua melhor</small><b>−0.214</b>
      <div class="dbar"><i style="width:34%"></i></div>
    </div></div><figcaption><b>Delta</b><span>Quanto você está ganhando ou perdendo, a cada metro da volta.</span></figcaption></figure>`;
}

function renderLanding(invite) {
  view.innerHTML = `
    <section class="hero">
      <div class="wrap">
        <div class="pitch">
          <span class="eyebrow">ACC · iRacing · Windows</span>
          <h1>Seu engenheiro de corrida, <em>dentro do PC.</em></h1>
          <p>O Pitwall grava cada volta, mostra onde você perde tempo e coloca você lado a lado com os seus amigos.
            E ainda põe mapa, pedais, pneus e delta por cima do jogo, e tem um engenheiro que fala português com você.</p>
          <div class="cta-row">
            <a class="btn go xl" href="${esc(PITWALL.download)}">${DL_ICON}Baixar para Windows</a>
            <button class="btn xl quiet" data-go="entrar" type="button">Entrar na minha conta</button>
          </div>
          <ul class="trust"><li>Grátis</li><li>Instala em um minuto</li><li>Atualiza sozinho</li></ul>
        </div>
        <div class="circuit" aria-hidden="true">
          <svg viewBox="70 40 860 590">
            <path d="${TRACK}" fill="none" stroke="#2a3548" stroke-width="46" stroke-linejoin="round"/>
            <path d="${TRACK}" fill="none" stroke="#1a2333" stroke-width="40" stroke-linejoin="round"/>
            <path d="${TRACK}" fill="none" stroke="#2ee59d" stroke-width="1.6" stroke-dasharray="7 11" opacity=".4" id="tline"/>
            <g id="sf"></g>
            <circle id="carBglow" r="24" fill="#a77bff" opacity=".2"/><circle id="carB" r="10" fill="#a77bff"/>
            <circle id="carAglow" r="24" fill="#2ee59d" opacity=".22"/><circle id="carA" r="10" fill="#2ee59d"/>
          </svg>
          <div class="tower">
            <div><span class="pos">1</span><span class="who"><i class="dot" style="background:var(--purple)"></i>Lucas</span><span class="gap fast">2:17.512</span></div>
            <div><span class="pos">2</span><span class="who"><i class="dot" style="background:var(--sodium)"></i>Você</span><span class="gap plus" id="liveGap">+0.508</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="how" id="como">
      <div class="wrap">
        <div class="step"><i>1</i><div><b>Baixe e instale</b><span>Um instalador só. Não precisa de Python nem de administrador.</span></div></div>
        <div class="step"><i>2</i><div><b>Corra como sempre</b><span>O Pitwall percebe o jogo abrir e grava tudo em segundo plano.</span></div></div>
        <div class="step"><i>3</i><div><b>Compare e evolua</b><span>Abra a análise, veja o delta e desafie a sua equipe.</span></div></div>
      </div>
    </section>

    <section class="sect" id="overlays">
      <div class="wrap">
        <span class="eyebrow">Overlays transparentes</span>
        <h2>As informações certas, por cima do jogo</h2>
        <p class="lede">Janelas transparentes que ficam na frente do ACC e do iRacing sem atrapalhar. Você escolhe quais
          mostrar, onde ficam e o tamanho. Os cliques passam direto para o jogo.</p>
        <div class="ovgrid">${overlayShots()}</div>
      </div>
    </section>

    <section class="sect voice" id="engenheiro">
      <div class="wrap">
        <span class="eyebrow">Engenheiro de voz</span>
        <h2>Um engenheiro que fala português com você</h2>
        <p class="lede">Pergunte no meio da corrida e ouça a resposta no fone. Ele também avisa sozinho o que importa, sem
          precisar de outro programa aberto.</p>
        <div class="vgrid">
          <div class="vlist">
            <div class="vitem"><div class="fi">${ico(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>`)}</div><div><h3>Pergunte o que quiser</h3><p>“Quem está atrás de mim?”, “qual a diferença para o da frente?”, “quanto combustível eu tenho?”. Entende gírias, número do carro, posição e nome do piloto.</p></div></div>
            <div class="vitem"><div class="fi">${ico(`<path d="M4 12h3l2-6 4 12 2-6h5"/>`)}</div><div><h3>Avisa sozinho</h3><p>Carro ao lado (“três de lado, você está no meio”), bandeiras, limites da pista, combustível, pneus, carro colado, recordes e chuva chegando.</p></div></div>
            <div class="vitem"><div class="fi">${ico(`<path d="M3 12a9 9 0 0 1 18 0M3 12v4a2 2 0 0 0 2 2h1v-6H5M21 12v4a2 2 0 0 1-2 2h-1v-6h1"/>`)}</div><div><h3>Voz offline ou online</h3><p>Voz neural que funciona sem internet, ou a voz online mais natural. Escolha o microfone, o fone e a tecla (ou botão do volante) para falar.</p></div></div>
            <div class="vitem"><div class="fi">${ico(`<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2M9 9.5h.01M15 9.5h.01"/>`)}</div><div><h3>Com personalidade</h3><p>Do profissional ao bem-humorado, que brinca com os erros e comemora os acertos, ou ao bravo, que dá bronca. Seu humor muda com o seu desempenho.</p></div></div>
          </div>
          <div class="radio" role="img" aria-label="Exemplo de conversa com o engenheiro">
            <div class="radio-top"><i></i>Rádio da equipe<em>canal aberto</em></div>
            <div class="msg me"><small>Você</small>Quem está atrás de mim?</div>
            <div class="msg eng"><small>Engenheiro</small>É o Lucas, número 24, de Porsche. Está a 1,2 segundo, e chegando.</div>
            <div class="msg warn"><small>Aviso</small>Carro à esquerda.</div>
            <div class="msg warn"><small>Aviso</small>Três de lado, você está no meio.</div>
            <div class="msg eng"><small>Engenheiro</small>Livre dos dois lados. Combustível para 6 voltas.</div>
            <div class="msg me"><small>Você</small>Como estou indo?</div>
            <div class="msg eng"><small>Engenheiro</small>Mandou bem! Sua última volta ficou perto da melhor. Mantém o ritmo.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="sect alt" id="recursos">
      <div class="wrap">
        <span class="eyebrow">Recursos</span>
        <h2>Tudo o que um engenheiro olharia</h2>
        <div class="feats">
          ${FEATURES.map(([t, d, i]) => `<article class="feat"><div class="fi">${i}</div><h3>${t}</h3><p>${d}</p></article>`).join("")}
        </div>
      </div>
    </section>

    ${typeof adSlot === "function" ? adSlot("landing") : ""}
    <section class="sect" id="analise">
      <div class="wrap">
        <span class="eyebrow">Compare com os amigos</span>
        <h2>Veja onde o amigo é mais rápido, curva a curva</h2>
        <p class="lede">Escolha a sua volta e a volta de um companheiro de equipe como referência. O Pitwall mostra
          a diferença, aponta a curva onde você perde mais tempo e explica o porquê, mesmo com carros diferentes.</p>
        <div class="win" role="img" aria-label="Exemplo da tela de análise comparando duas voltas">
          <div class="win-top">
            <div class="lapc a"><i class="av">H</i><div><small>VOLTA ANALISADA</small><b>1:50.207</b><span>Você · Ferrari 296 GT3</span></div></div>
            <span class="vs">vs</span>
            <div class="lapc b"><i class="av">J</i><div><small>REFERÊNCIA</small><b>1:52.590</b><span>Lucas · McLaren 720S GT3 Evo</span></div></div>
            <div class="bigd"><small>DIFERENÇA</small><b>−2,383 s</b><span>S1 −0,098 · S2 −1,432 · S3 −0,853</span></div>
          </div>
          <div class="win-mid"><span class="mpill">Onde perde tempo <b>Curva 4 +0,21 s</b></span><span class="ok">Nenhuma travada, rodada ou saída de pista registrada.</span></div>
          <div class="win-body">
            <div class="tips">
              <h4>Curva 4 <em>+0,213 s</em></h4>
              <p class="mut">Maior perda na entrada (frenagem até o ápice)</p>
              <div class="tip"><b>Freou cedo</b><span>Você começou a frear 6 m antes da referência.</span></div>
              <div class="tip"><b>Pouca velocidade na curva</b><span>Velocidade mínima 5 km/h abaixo da referência (116 × 121 km/h).</span></div>
              <div class="tip good"><b>Acelera a fundo mais cedo</b><span>Saída 3 km/h mais rápida.</span></div>
            </div>
            <div class="chart">
              <svg viewBox="0 0 520 230" aria-hidden="true">
                <g stroke="#2a3548" stroke-width="1"><path d="M0 40H520M0 100H520M0 160H520"/></g>
                <rect x="292" y="6" width="70" height="150" fill="#ff5a5f" opacity=".1" rx="6"/>
                <path d="M0 40 C40 40 60 44 80 120 C92 160 120 160 140 120 C170 60 200 30 260 30 C300 30 310 60 330 140 C340 170 370 168 390 120 C420 70 470 50 520 46" fill="none" stroke="#2ee59d" stroke-width="2.5"/>
                <path d="M0 42 C38 42 58 50 84 126 C96 164 126 166 146 126 C176 66 206 36 262 34 C302 34 314 66 336 148 C346 176 378 172 396 128 C426 78 472 56 520 52" fill="none" stroke="#5ab0ff" stroke-width="2.5"/>
                <path d="M0 196 C80 196 130 206 200 200 S300 186 340 192 S460 212 520 214" fill="none" stroke="#39d98a" stroke-width="2"/>
                <path d="M0 196 H520" stroke="#3c4a63" stroke-dasharray="4 6"/>
                <text x="8" y="18" fill="#8e9bb2" font-size="12" font-family="Barlow">Velocidade</text>
                <text x="8" y="186" fill="#8e9bb2" font-size="12" font-family="Barlow">Diferença para a referência</text>
                <text x="298" y="22" fill="#ff5a5f" font-family="Barlow Condensed" font-weight="700" font-size="17">Curva 4</text>
              </svg>
              <div class="legend"><span><i style="background:#2ee59d"></i>Você</span><span><i style="background:#5ab0ff"></i>Referência</span></div>
            </div>
          </div>
        </div>
        <div class="feats mini">
          <article class="feat"><div class="fi">${ico(`<path d="M3 12h18M7 7l-4 5 4 5M17 7l4 5-4 5"/>`)}</div><h3>Carros diferentes, sem problema</h3><p>Compare a sua Ferrari com a McLaren do amigo: a referência é sempre o recorde de cada piloto na pista.</p></article>
          <article class="feat"><div class="fi">${ico(`<path d="M12 3l2.4 5.4 5.9.6-4.4 4 1.3 5.8L12 15.8 6.8 18.8l1.3-5.8-4.4-4 5.9-.6z"/>`)}</div><h3>Dicas em português</h3><p>“Freou cedo”, “pouca velocidade na curva”, “acelerou tarde”: o app diz o que mudar em cada curva.</p></article>
          <article class="feat"><div class="fi">${ico(`<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>`)}</div><h3>Acontecimentos da volta</h3><p>Travadas, rodadas e saídas de pista aparecem marcadas. Um clique leva ao momento no gráfico, no mapa e no vídeo.</p></article>
          <article class="feat"><div class="fi">${ico(`<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>`)}</div><h3>Vídeo lado a lado</h3><p>Se os dois gravaram a tela, os replays tocam juntos e sincronizados com o mapa e com os gráficos.</p></article>
        </div>
      </div>
    </section>

    <section class="uses">
      <div class="wrap">
        <span class="eyebrow">Para correr com os amigos</span>
        <h2>Cada volta vira uma disputa</h2>
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
            <code>pitwall.hygor.com.br/#/join/7F3A91C2</code>
            <div class="steps"><span>Abre o link</span><span>Entra com Google</span><span>Já está na equipe</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="sect alt" id="equipe">
      <div class="wrap">
        <span class="eyebrow">Equipe e comunidade</span>
        <h2>Monte a sua equipe em um minuto</h2>
        <div class="feats">
          <article class="feat"><div class="fi">${ico(`<path d="M8 21V8l4-4 4 4v13M4 21h16M10 12h4M10 16h4"/>`)}</div><h3>Ranking por pista e carro</h3><p>Filtre por pista, carro ou piloto. Cada um aparece com a melhor volta e a diferença para o líder.</p></article>
          <article class="feat"><div class="fi">${ico(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`)}</div><h3>Comunidade</h3><p>Uma lista aberta com o recorde de cada piloto em cada pista, para você se medir com todo mundo.</p></article>
          <article class="feat"><div class="fi">${ico(`<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 8l9 6 9-6"/>`)}</div><h3>Convite por e-mail ou link</h3><p>Mande o link no grupo ou convide pelo e-mail. Quem entra com o Google já cai dentro da equipe.</p></article>
          <article class="feat"><div class="fi">${ico(`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`)}</div><h3>Você controla quem entra</h3><p>Equipe só por convite, com pedidos que o líder aprova, ou aberta. Dono e líderes gerenciam os pilotos.</p></article>
          <article class="feat"><div class="fi">${ico(`<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>`)}</div><h3>Logo e identidade</h3><p>Coloque o escudo da sua equipe e dê cara para o grupo de amigos ou para o campeonato.</p></article>
          <article class="feat"><div class="fi">${ico(`<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16"/>`)}</div><h3>Seus dados, a sua escolha</h3><p>As voltas só são vistas pela sua equipe e os setups nunca saem do seu PC.</p></article>
        </div>
      </div>
    </section>

    <section class="sect login" id="entrar">
      <div class="wrap login-wrap">
        <div>
          <span class="eyebrow">Sua conta</span>
          <h2>Entre para ver a sua equipe</h2>
          <p class="lede">Depois de instalar o app, entre aqui com a mesma conta para ver o ranking, comparar voltas e
            convidar os amigos. Só a sua equipe vê as suas voltas; setups nunca saem do seu PC.</p>
        </div>
        <div class="pitboard">
          ${invite ? `<div class="invite-note">${avatar({ name: "+" })}<div>Você foi convidado para uma <b>equipe</b>. Entre para aceitar.</div></div>` : ""}
          <button class="btn google" id="gLogin">${GOOGLE}Continuar com Google</button>
          <div class="or">ou receba um link no e-mail</div>
          <form class="mail" id="mailForm">
            <label for="email" style="position:absolute;left:-9999px">E-mail</label>
            <input class="field" id="email" type="email" autocomplete="email" placeholder="seu@email.com" required>
            <button class="btn go" type="submit" id="mailBtn">Enviar link</button>
          </form>
          <div class="msg" id="loginMsg" role="status"></div>
          <p class="fine">Mesma conta no site e no app do PC.</p>
        </div>
      </div>
    </section>

    <section class="cta-band"><div class="wrap">
      <div><h2>Pronto para encontrar os décimos que faltam?</h2>
        <p>Windows 10 ou 11 · ACC e iRacing · Grátis. Abre junto com o Windows e só aparece quando você entra na pista.</p></div>
      <a class="btn go xl" href="${esc(PITWALL.download)}">${DL_ICON}Baixar o Pitwall</a>
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
  if (location.hash === "#entrar" || invite) goTo("entrar");
  stopCircuit = animateCircuit();
}
// rola até uma seção da página inicial sem mexer na rota (#entrar/#overlays não são rotas)
function goTo(id) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); }
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  e.preventDefault();
  if (!document.getElementById(b.dataset.go)) { location.hash = "#/"; setTimeout(() => goTo(b.dataset.go), 50); return; }
  goTo(b.dataset.go);
});
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
    let r;
    try { r = await rpc("join_with_code", { code }); }
    catch (e) { if (!/join_with_code/.test(e.message)) throw e; r = { team: await rpc("join_team", { code }) }; }
    store.set(PENDING, null);
    location.hash = `#/team/${r.team.id}`;
  } catch (e) {
    store.set(PENDING, null);
    view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Esse convite não funcionou</b>
      <p>${esc(e.message)}. Peça um link novo para quem criou a equipe.</p><br><a class="btn" href="#/">Ir para as suas equipes</a></div></div>`;
  }
}

// ---------------------------------------------------------------- equipes
const ROLE_NAME = { owner: "Dono", admin: "Líder", member: "Piloto" };
const MODE_INFO = {
  invite: ["Só por convite", "Entra quem receber o link ou um convite por e-mail. Não aparece na lista."],
  request: ["Por aprovação", "Aparece na lista. Quem pedir para entrar espera um líder aceitar."],
  open: ["Aberta", "Aparece na lista e qualquer piloto entra com um clique."],
};
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? "agora há pouco" : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86400)} d`;
};
async function myTeams() {
  let r = await sb.from("team_members").select("role,teams(id,name,invite_code,owner,created_at,logo_url,join_mode,description)").eq("user_id", session.user.id);
  if (r.error && /join_mode|description/.test(r.error.message)) {
    r = await sb.from("team_members").select("role,teams(id,name,invite_code,owner,created_at,logo_url)").eq("user_id", session.user.id);
  }
  if (r.error) throw new Error(r.error.message);
  return (r.data || []).filter((x) => x.teams).map((x) => ({ join_mode: "invite", ...x.teams, role: x.role }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function renderHome() {
  view.innerHTML = `<div class="loading">Carregando as suas equipes…</div>`;
  let teams = [], invites = [], listed = [];
  try { teams = await myTeams(); } catch (e) { view.innerHTML = `<div class="wrap page"><div class="panel">${esc(e.message)}</div></div>`; return; }
  try { invites = (await rpc("my_invites", {})) || []; } catch (e) { /* SQL v4 ainda não aplicado */ }
  try { listed = ((await rpc("discover_teams", {})) || []).filter((t) => t.my_status !== "member"); } catch (e) { /* idem */ }
  if (teams.length === 1 && !invites.length && !store.get("pitwall.stayHome")) { location.hash = `#/team/${teams[0].id}`; return; }
  const first = ((profile && profile.name) || "").split(" ")[0];
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>${first ? `Boa, ${esc(first)}.` : "Suas equipes"}</h1>
      <div class="sub">${teams.length ? "Escolha uma equipe para ver o ranking." : "Crie a sua equipe, entre com um convite ou escolha uma equipe aberta."}</div></div></div>
    ${invites.map((i) => `<div class="panel invite-row">${teamLogo({ name: i.team_name, logo_url: i.logo_url })}
      <div><b>${esc(i.invited_by || "Alguém")}</b> convidou você para <b>${esc(i.team_name)}</b></div>
      <span class="spacer"></span><button class="btn go small" data-inv="${i.id}" data-acc="1">Aceitar</button>
      <button class="btn small" data-inv="${i.id}" data-acc="0">Recusar</button></div>`).join("")}
    ${teams.length ? `<div class="teams">${teams.map((t) => `<a class="team-tile" href="#/team/${t.id}">${teamLogo(t)}<b>${esc(t.name)}</b>
      <span>${ROLE_NAME[t.role] || ""} · ${(MODE_INFO[t.join_mode] || MODE_INFO.invite)[0]}</span></a>`).join("")}</div>` : ""}
    <div class="two">
      <div class="panel"><h2>Criar equipe</h2>
        <form class="inline" id="newForm"><input class="field" id="newName" placeholder="Nome da equipe" minlength="2" maxlength="60" required>
          <button class="btn go" type="submit">Criar</button></form><div class="msg" id="newOut"></div></div>
      <div class="panel"><h2>Tenho um convite</h2>
        <form class="inline" id="joinForm"><input class="field" id="joinCode" placeholder="Cole o link ou o código" required>
          <button class="btn" type="submit">Entrar na equipe</button></form><div class="msg" id="joinOut"></div></div>
    </div>
    ${listed.length ? `<div class="panel" style="margin-top:14px"><h2>Equipes abertas</h2>
      ${listed.map((t) => `<div class="member">${teamLogo(t)}<span><b>${esc(t.name)}</b><br><em>${t.members} ${t.members === 1 ? "piloto" : "pilotos"} · ${(MODE_INFO[t.join_mode] || [""])[0]}${t.description ? " · " + esc(t.description) : ""}</em></span>
        <span style="flex:1"></span>${t.my_status === "pending" ? `<span class="role">aguardando aprovação</span>`
          : `<button class="btn small go" data-list="${t.id}">${t.join_mode === "open" ? "Entrar" : "Pedir para entrar"}</button>`}</div>`).join("")}</div>` : ""}
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
  view.querySelectorAll("[data-inv]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await rpc("answer_invite", { i: b.dataset.inv, accept: b.dataset.acc === "1" });
      if (r.status === "joined") location.hash = `#/team/${r.team.id}`; else renderHome();
    } catch (e) { b.textContent = e.message; }
  });
  view.querySelectorAll("[data-list]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await rpc("join_listed", { t: b.dataset.list });
      if (r.status === "joined") location.hash = `#/team/${r.team.id}`; else renderHome();
    } catch (e) { b.textContent = e.message; }
  });
}

function appPanel() {
  return `<div class="panel" style="margin-top:14px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap">
    <div><h2 style="margin-bottom:6px">Suas voltas entram pelo app</h2>
      <div class="help" style="margin:0">Instale o Pitwall no PC e entre com esta mesma conta Google (aba Equipe).
        Seus recordes sobem sozinhos, sem precisar enviar nada.</div></div>
    <a class="btn go" href="${esc(PITWALL.download)}">Baixar o Pitwall</a></div>`;
}

async function renderTeam(id) {
  view.innerHTML = `<div class="loading">Carregando a equipe…</div>`;
  let tq = await sb.from("teams").select("id,name,invite_code,owner,logo_url,join_mode,description").eq("id", id).maybeSingle();
  if (tq.error && /join_mode|description/.test(tq.error.message)) tq = await sb.from("teams").select("id,name,invite_code,owner,logo_url").eq("id", id).maybeSingle();
  const [{ data: members, error: e2 }, board] = await Promise.all([
    sb.from("team_members").select("role,user_id,joined_at,profiles(name,avatar_url)").eq("team_id", id).order("joined_at"),
    rpc("team_board", { t: id }).catch(() => []),
  ]);
  const team = tq.data && { join_mode: "invite", ...tq.data };
  if (tq.error || e2 || !team) {
    view.innerHTML = `<div class="wrap page"><div class="panel empty"><b>Equipe não encontrada</b>
      <p>Você não faz parte dela, ou ela foi apagada.</p><br><a class="btn" href="#/">Ir para as suas equipes</a></div></div>`;
    return;
  }
  const laps = Array.isArray(board) ? board : [];
  const me = session.user.id;
  const myRole = (members.find((m) => m.user_id === me) || {}).role || "member";
  const owner = myRole === "owner", manager = owner || myRole === "admin";
  let requests = [], invites = [];
  if (manager) {
    const [rq, iv] = await Promise.all([
      sb.from("team_requests").select("user_id,created_at,profiles(name,avatar_url)").eq("team_id", id).order("created_at"),
      sb.from("team_invites").select("id,email,created_at").eq("team_id", id).order("created_at", { ascending: false })]);
    requests = rq.data || []; invites = iv.data || [];
  }
  const R = rankingBlock(laps, me, "pitwall.teamF", () => renderTeam(id));
  const mine = laps.filter((l) => l.user_id === me).length;
  const link = inviteLink(team.invite_code);
  const order = { owner: 0, admin: 1, member: 2 };
  const sorted = members.slice().sort((a, b) => order[a.role] - order[b.role] || a.joined_at.localeCompare(b.joined_at));
  const mailto = (email) => `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Convite para a equipe " + team.name + " no Pitwall")}&body=${encodeURIComponent(`Oi! Te convidei para a equipe ${team.name} no Pitwall.\n\nAbra o link, entre com o Google e pronto:\n${link}`)}`;
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div class="team-title">${teamLogo(team)}<div><a class="back" href="#/" id="allTeams">Suas equipes</a><h1>${esc(team.name)}</h1>
      <div class="sub">${members.length} ${members.length === 1 ? "piloto" : "pilotos"}, ${R.tracks} ${R.tracks === 1 ? "pista" : "pistas"}, ${R.cars} ${R.cars === 1 ? "carro" : "carros"} · ${(MODE_INFO[team.join_mode] || MODE_INFO.invite)[0]}${team.description ? " · " + esc(team.description) : ""}</div>
      <div class="hint-an">📈 Clique em <b>Analisar</b> ou <b>Comparar</b> numa volta para abrir a análise completa: onde perde tempo em cada curva, dicas, gráficos, mapa e vídeo.</div></div></div></div>
    <div class="layout">
      <div>${laps.length ? `<div id="teamRank">${R.html}</div>` : `<div class="panel empty"><b>Ninguém enviou voltas ainda</b><p>Os recordes sobem sozinhos quando os pilotos gravam no app do PC.</p></div>`}
      <div id="teamSetups"></div>
      ${mine ? "" : appPanel()}</div>
      <aside class="side">
        ${requests.length ? `<div class="panel"><h2>Pedidos para entrar <span class="role">${requests.length}</span></h2>
          ${requests.map((r) => `<div class="member">${avatar(r.profiles)}<span>${esc((r.profiles || {}).name || "?")}<br><em>${ago(r.created_at)}</em></span><span style="flex:1"></span>
            <button class="btn small go" data-ans="${r.user_id}" data-acc="1">Aceitar</button><button class="btn small quiet" data-ans="${r.user_id}" data-acc="0">Recusar</button></div>`).join("")}</div>` : ""}
        <div class="panel"><h2>Pilotos</h2>
          ${sorted.map((m) => `<div class="member">${avatar(m.profiles)}<span>${esc((m.profiles || {}).name || "?")}${m.user_id === me ? " (você)" : ""}</span>
            <span class="role ${m.role}">${ROLE_NAME[m.role] || ""}</span>
            ${m.user_id !== me && m.role !== "owner" ? `<span class="macts">
              ${owner ? `<button class="btn small quiet" data-role="${m.user_id}" data-to="${m.role === "admin" ? "member" : "admin"}">${m.role === "admin" ? "Tirar de líder" : "Tornar líder"}</button>` : ""}
              ${manager && (owner || m.role !== "admin") ? `<button class="btn small quiet chip-x" data-kick="${m.user_id}" aria-label="Remover ${esc((m.profiles || {}).name || "")}">Remover</button>` : ""}</span>` : ""}</div>`).join("")}
          <p class="help">Dono: tudo. Líder: convida, aceita pedidos, remove pilotos e edita a equipe.</p></div>
        ${manager ? `<div class="panel"><h2>Convidar por e-mail</h2>
          <form class="inline" id="mailForm"><input class="field" type="email" id="mailTo" placeholder="amigo@exemplo.com" required><button class="btn go small" type="submit">Convidar</button></form>
          <div class="msg" id="mailOut"></div>
          ${invites.length ? invites.map((i) => `<div class="member"><span>${pii(i.email, "email")}<br><em>aguardando · ${ago(i.created_at)}</em></span><span style="flex:1"></span>
            <a class="btn small quiet" href="${mailto(i.email)}">Enviar e-mail</a><button class="btn small quiet" data-cinv="${i.id}">Cancelar</button></div>`).join("") : ""}
          <p class="help">A pessoa vê o convite ao entrar com esse e-mail aqui no site ou no app.</p></div>` : ""}
        <div class="panel"><h2>Chamar mais gente</h2>
          <code class="inv" id="inv">${esc(link)}</code>
          <div class="inline"><button class="btn go small" id="copy">Copiar link</button>
            ${navigator.share ? `<button class="btn small" id="share">Compartilhar</button>` : ""}
            ${manager ? `<button class="btn small quiet" id="newInv">Trocar link</button>` : ""}</div>
          <p class="help">Quem abrir o link entra com o Google e já fica na equipe. Mande só para quem é da equipe.</p></div>
        ${manager ? `<div class="panel"><h2>Quem pode entrar</h2>
          ${Object.entries(MODE_INFO).map(([k, [t, d]]) => `<label class="modeopt"><input type="radio" name="mode" value="${k}" ${team.join_mode === k ? "checked" : ""}><span><b>${t}</b><br><em>${d}</em></span></label>`).join("")}
          <input class="field" id="descIn" maxlength="200" placeholder="Descrição (aparece na lista)" value="${esc(team.description || "")}" style="margin-top:8px">
          <div class="inline" style="margin-top:8px"><button class="btn small" id="optSave">Salvar</button></div><div class="msg" id="optOut"></div></div>
        <div class="panel"><h2>Logo da equipe</h2>
          <div class="inline" style="align-items:center">${teamLogo(team, "lg")}
            <label class="btn small">Enviar imagem<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label></div>
          <p class="help" id="logoOut">PNG, JPG, WEBP ou SVG até 2 MB.</p></div>` : ""}
        <button class="btn danger small" id="leave">${owner ? "Apagar equipe" : "Sair da equipe"}</button>
      </aside>
    </div></div>`;
  $("#allTeams").onclick = () => store.set("pitwall.stayHome", "1");
  if ($("#teamRank")) R.bind($("#teamRank"));
  const run = async (b, fn) => { b.disabled = true; try { await fn(); renderTeam(id); } catch (e) { b.disabled = false; b.textContent = e.message; } };
  const lf = $("#logoFile");
  if (lf) lf.onchange = async () => {
    const f = lf.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { $("#logoOut").textContent = "A imagem precisa ter até 2 MB."; return; }
    $("#logoOut").textContent = "Enviando…";
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[f.type];
    if (!ext) { $("#logoOut").textContent = "Use uma imagem PNG, JPG, WEBP ou SVG."; return; }
    const path = `${id}/logo.${ext}`;
    const up = await sb.storage.from("team-logos").upload(path, f, { upsert: true, contentType: f.type, cacheControl: "3600" });
    if (up.error) {
      const m = up.error.message || "";
      $("#logoOut").textContent = /row-level|policy|unauthor/i.test(m)
        ? "Sem permissão para enviar a logo. O banco precisa do arquivo supabase/equipe_v4.sql aplicado (quem administra o projeto roda uma vez)." : m;
      return;
    }
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
  loadTeamSetups(id);
  view.querySelectorAll("[data-kick]").forEach((b) => b.onclick = () => {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Remover mesmo?"; return; }
    run(b, () => rpc("remove_member", { t: id, u: b.dataset.kick }));
  });
  view.querySelectorAll("[data-role]").forEach((b) => b.onclick = () => run(b, () => rpc("set_member_role", { t: id, u: b.dataset.role, new_role: b.dataset.to })));
  view.querySelectorAll("[data-ans]").forEach((b) => b.onclick = () => run(b, () => rpc("answer_request", { t: id, u: b.dataset.ans, accept: b.dataset.acc === "1" })));
  view.querySelectorAll("[data-cinv]").forEach((b) => b.onclick = () => run(b, () => rpc("cancel_invite", { i: b.dataset.cinv })));
  const mf = $("#mailForm");
  if (mf) mf.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#mailOut"); out.className = "msg"; out.textContent = "Convidando…";
    try {
      const r = await rpc("invite_by_email", { t: id, mail: $("#mailTo").value });
      out.innerHTML = `Convite criado para <b>${esc(r.email)}</b>. <a href="${mailto(r.email)}">Enviar o e-mail agora</a>`;
      $("#mailTo").value = "";
      setTimeout(() => renderTeam(id), 5000);
    } catch (err) {
      out.className = "msg err";
      out.textContent = /invite_by_email|schema cache/.test(err.message) ? "Falta aplicar o supabase/equipe_v4.sql no banco (uma vez)." : err.message;
    }
  };
  if ($("#optSave")) $("#optSave").onclick = async () => {
    const mode = (view.querySelector("input[name=mode]:checked") || {}).value;
    const { error } = await sb.from("teams").update({ join_mode: mode, description: $("#descIn").value.trim() || null }).eq("id", id);
    if (error) { $("#optOut").className = "msg err"; $("#optOut").textContent = /join_mode|description/.test(error.message) ? "Falta aplicar o supabase/equipe_v4.sql no banco (uma vez)." : error.message; return; }
    renderTeam(id);
  };
  $("#leave").onclick = async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = owner ? "Apagar para todos?" : "Sair mesmo?"; return; }
    let error;
    if (owner) ({ error } = await sb.from("teams").delete().eq("id", id));
    else {
      ({ error } = await sb.rpc("leave_team", { t: id }));
      if (error && /leave_team/.test(error.message)) ({ error } = await sb.from("team_members").delete().eq("team_id", id).eq("user_id", me));
    }
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
  const { data } = await sb.from("laps").select("id,car,track,game,lap_time_ms").eq("user_id", session.user.id);
  myRecs = data || [];
  return myRecs;
}
function rowsHtml(g, me, showCar) {
  const lead = g[0].lap_time_ms;
  return g.map((r, i) => { const pos = r._pos || i + 1; return `<div class="row ${pos === 1 ? "first" : ""} ${r.user_id === me ? "mine" : ""}">
    <span class="p">${pos}</span>
    <span class="name">${avatar({ name: r.driver, avatar_url: r.avatar_url })}<span>${esc(r.driver)} ${r.user_id === me ? "<em>você</em>" : ""}<br><em>${showCar ? esc(pretty(r.car)) + " · " : ""}${fmtDate(r.recorded_at)}</em></span></span>
    <span class="time">${fmtLap(r.lap_time_ms)}</span>
    <span class="gap">${pos > 1 ? fmtGap(r.lap_time_ms - (r._lead != null ? r._lead : lead)) : ""}</span>
    <span class="sec">${fmtSec(r.s1_ms)}</span><span class="sec">${fmtSec(r.s2_ms)}</span><span class="sec">${fmtSec(r.s3_ms)}</span>
    <span class="racts">${r.clip_path ? `<span class="pill" title="Tem vídeo da volta">▶</span>` : ""}${r.setup_name ? `<button class="pill" data-setup="${r.id}" title="Baixar o setup: ${esc(r.setup_name)}">⚙</button>` : ""}
      <button class="btn small" data-cmp="${r.id}" data-combo="${esc(r.track + "|" + r.car + "|" + r.game)}" data-me="${r.user_id === me ? 1 : ""}" title="Abrir a análise completa: curvas, dicas, gráficos, mapa e vídeo">📈 ${r.user_id === me ? "Analisar" : "Comparar"}</button></span></div>`; }).join("");
}
function bindRows(root) {
  root.querySelectorAll("[data-cmp]").forEach((b) => b.onclick = async () => {
    if (b.dataset.me) { location.hash = `#/compare/${b.dataset.cmp}`; return; }
    const [track, car, game] = b.dataset.combo.split("|");
    const recs = await myRecords(), tl = (t) => String(t).toLowerCase();
    const mine = recs.find((x) => tl(x.track) === tl(track) && x.car === car && x.game === game)
      || recs.filter((x) => tl(x.track) === tl(track) && x.game === game).sort((a, b) => a.lap_time_ms - b.lap_time_ms)[0];
    location.hash = mine ? `#/compare/${mine.id}/${b.dataset.cmp}` : `#/compare/${b.dataset.cmp}`;
  });
  root.querySelectorAll("[data-setup]").forEach((b) => b.onclick = async () => {
    let g = null;
    try { g = await rpc("lap_setup_get", { p_lap: b.dataset.setup }); } catch (e) { /* abaixo */ }
    if (!g || !g.ok) { alert(g && g.error === "plano" ? "Os setups da equipe são do plano Pro ou Equipe." : g && g.error === "membro" ? "Esse setup é só para quem está na mesma equipe." : "Não foi possível baixar o setup."); return; }
    const blob = new Blob([JSON.stringify(JSON.parse(g.content), null, "\t")], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(g.name || "setup").replace(/[^\w.-]+/g, "_")}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

// ---------------------------------------------------------------- setups da equipe (plano Equipe)
async function loadTeamSetups(teamId) {
  const box = $("#teamSetups");
  if (!box) return;
  let r;
  try { r = await rpc("team_setup_library", { p_team: teamId }); } catch (e) { return; }
  if (!r) return;
  if (!r.ok) {
    if (r.error === "plano") box.innerHTML = `<div class="panel"><h2>Setups da equipe</h2><p class="help">Os setups da equipe são para quem está na equipe e tem o plano <b>Pro</b> ou <b>Equipe</b> ativo. Com o plano, o setup de cada melhor tempo dos pilotos fica reunido aqui, com notas, e baixa com um clique. <a href="#/planos">Ver planos</a></p></div>`;
    return;
  }
  const items = r.items || [];
  box.innerHTML = `<div class="panel"><h2>Setups da equipe <span class="role">${items.length}</span></h2>
    <p class="help">Os setups usados nos melhores tempos dos pilotos (enviados pelo app) e os compartilhados de propósito. Baixe o arquivo e coloque na pasta de setups do ACC, ou use o app do Pitwall para instalar com um clique.</p>
    ${items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Piloto</th><th>Carro / pista</th><th>Setup</th><th>Melhor volta</th><th></th></tr></thead><tbody>${items.slice(0, 100).map((x) => `<tr>
      <td>${esc(x.who || "—")}</td><td class="sub">${esc(pretty(x.car))} · ${esc(pretty(x.track))}</td>
      <td>${esc(x.name || "")}${x.note ? `<br><small class="sub">${esc(x.note)}</small>` : ""}</td>
      <td>${x.best_lap_ms ? fmtLap(x.best_lap_ms) : "—"}<br><small class="sub">${x.kind === "volta" ? "do melhor tempo" : "compartilhado"}</small></td>
      <td><button class="btn small go" data-tsd="${x.kind}:${x.id}">Baixar</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="help">Nenhum setup ainda. Eles aparecem quando os pilotos batem um recorde com o setup selecionado na sessão do app.</p>`}</div>`;
  box.querySelectorAll("[data-tsd]").forEach((b) => b.onclick = async () => {
    const [kind, sid] = b.dataset.tsd.split(":");
    const g = await rpc("team_setup_get", { p_team: teamId, p_kind: kind, p_id: sid });
    if (!g || !g.ok) { alert("Não foi possível baixar este setup."); return; }
    const blob = new Blob([JSON.stringify(JSON.parse(g.content), null, "\t")], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(g.name || "setup").replace(/[^\w.-]+/g, "_")}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

// ---------------------------------------------------------------- ranking da comunidade
async function allLaps() {
  // o servidor devolve no máximo 1000 linhas por pedido: busca em páginas até acabar
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("laps").select("id,user_id,game,car,track,lap_time_ms,s1_ms,s2_ms,s3_ms,recorded_at,setup_name,clip_path,profiles(name,avatar_url)")
      .order("track").order("car").order("lap_time_ms").order("id").range(from, from + 999);
    if (error) return { error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out };
}
const rankF = (key) => { const d = { track: "", car: "", user: "", more: false }; try { return Object.assign(d, JSON.parse(store.get(key) || "{}")); } catch (e) { return d; } };
// ranking por pista (melhor volta de cada piloto) com filtros de pista, carro e piloto; serve à comunidade e à equipe
function rankingBlock(rows, me, key, rerender) {
  const F = rankF(key);
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
  const single = !!F.track, total = sections.length;
  const shown = single || F.more ? sections : sections.slice(0, 12);
  const sectionHtml = (x) => {
    const lead = x.list[0].lap_time_ms, cap = single ? 100 : 10;
    const withPos = x.list.map((r, i) => ({ ...r, _pos: i + 1, _lead: lead }));
    let v = F.user ? withPos.filter((r) => r.user_id === F.user) : withPos.slice(0, cap);
    const mine = withPos.find((r) => r.user_id === me);
    if (!F.user && mine && mine._pos > cap) v = [...v, mine];
    return `<section class="combo"><div class="combo-head"><h3>${esc(pretty(x.t.track))}${x.t.game !== "acc" ? " · " + esc(x.t.game) : ""}</h3>
        <small>${x.list.length} ${x.list.length === 1 ? "piloto" : "pilotos"} · ${F.car ? esc(pretty(F.car)) : "cada um com o carro da sua melhor volta"}${mine ? ` · você em ${mine._pos}º` : ""}</small>
        ${single ? "" : `<button class="btn small quiet" data-only="${esc(x.k)}" style="margin-left:auto">Ver só esta pista</button>`}</div>
      <div class="rows"><div class="row head"><span class="p">Pos</span><span>Piloto</span><span style="text-align:right">Tempo</span><span style="text-align:right">Diferença</span>
        <span class="sec">S1</span><span class="sec">S2</span><span class="sec">S3</span><span></span></div>${rowsHtml(v, me, !F.car)}</div>
      ${!single && !F.user && x.list.length > cap ? `<div class="help" style="padding:8px 14px">+ ${x.list.length - cap} pilotos · <a href="#" data-only="${esc(x.k)}">ver todos</a></div>` : ""}</section>`;
  };
  const sel = (id, label, h) => `<label class="help" style="margin:0">${label}<br><select class="field" id="${id}" style="min-width:200px;max-width:100%">${h}</select></label>`;
  const html = `<div class="inline" style="align-items:flex-end;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      ${sel("fTrack", "Pista", `<option value="">Todas as pistas</option>` + Object.entries(opts.tracks).sort((a, b) => b[1].u.size - a[1].u.size || pretty(a[1].track).localeCompare(pretty(b[1].track))).map(([k, t]) => `<option value="${esc(k)}" ${k === F.track ? "selected" : ""}>${esc(pretty(t.track))}${t.game !== "acc" ? " · " + esc(t.game) : ""} (${t.u.size})</option>`).join(""))}
      ${sel("fCar", "Carro", `<option value="">Todos os carros</option>` + Object.entries(opts.cars).sort((a, b) => b[1].size - a[1].size || pretty(a[0]).localeCompare(pretty(b[0]))).map(([c, u]) => `<option value="${esc(c)}" ${c === F.car ? "selected" : ""}>${esc(pretty(c))} (${u.size})</option>`).join(""))}
      ${sel("fUser", "Piloto", `<option value="">Todos os pilotos</option>` + Object.entries(opts.users).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, u]) => `<option value="${esc(id)}" ${id === F.user ? "selected" : ""}>${esc(u.name)} (${u.n})</option>`).join(""))}
      ${F.track || F.car || F.user ? `<button class="btn small" id="fClear">Limpar filtros</button>` : ""}</div>
    ${shown.length ? shown.map(sectionHtml).join("") : `<div class="panel empty"><b>Nenhum tempo com esses filtros</b></div>`}
    ${!single && !F.more && total > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn" id="fMore">Mostrar as outras ${total - shown.length} pistas</button></div>` : ""}`;
  const bind = (root) => {
    const set = (v) => { store.set(key, JSON.stringify(Object.assign({}, F, v))); rerender(); };
    $("#fTrack", root).onchange = (e) => set({ track: e.target.value, more: false });
    $("#fCar", root).onchange = (e) => set({ car: e.target.value });
    $("#fUser", root).onchange = (e) => set({ user: e.target.value });
    if ($("#fClear", root)) $("#fClear", root).onclick = () => set({ track: "", car: "", user: "", more: false });
    if ($("#fMore", root)) $("#fMore", root).onclick = () => set({ more: true });
    root.querySelectorAll("[data-only]").forEach((b) => b.onclick = (e) => { e.preventDefault(); set({ track: b.dataset.only }); });
    bindRows(root);
  };
  return { html, bind, pilots: new Set(rows.map((r) => r.user_id)).size, tracks: Object.keys(opts.tracks).length, cars: Object.keys(opts.cars).length };
}
async function renderCommunity() {
  view.innerHTML = `<div class="loading">Carregando o ranking…</div>`;
  const { data, error } = await allLaps();
  if (error) { view.innerHTML = `<div class="wrap page"><div class="panel">${esc(error.message)}</div></div>`; return; }
  const rows = (data || []).map((r) => ({ ...r, driver: (r.profiles || {}).name || "?", avatar_url: (r.profiles || {}).avatar_url }));
  if (!rows.length) {
    view.innerHTML = `<div class="wrap page"><div class="page-head"><div><h1>Comunidade</h1></div></div>
      <div class="panel empty"><b>Ninguém no ranking ainda</b><p>Os recordes sobem sozinhos pelo app do PC.</p></div></div>`;
    return;
  }
  const R = rankingBlock(rows, session.user.id, "pitwall.commF", renderCommunity);
  view.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>Comunidade</h1><div class="sub">${R.pilots} ${R.pilots === 1 ? "piloto" : "pilotos"} · ${R.tracks} pistas · ${R.cars} carros · ${rows.length} recordes. A melhor volta de cada um; filtre por pista, carro ou piloto.</div></div></div>
    ${R.html}
    ${typeof adSlot === "function" ? adSlot("ranking") : ""}</div>`;
  R.bind(view);
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
  if (session && typeof claimReferral === "function") claimReferral();
  renderMe();
  const pending = store.get(PENDING);
  if (session && pending && !location.hash.startsWith("#/join/")) { location.hash = `#/join/${pending}`; return; }
  route();
}
view.innerHTML = `<div class="loading">Carregando…</div>`;
sb.auth.onAuthStateChange((ev, s) => { setTimeout(() => onSession(ev, s), 0); });
