// Tour de boas-vindas e lista "Primeiros passos" (o que já está pronto e o que falta configurar).
// Usa os helpers do app.js ($, api, esc, view, current).

const TOUR = [
  { t: "Bem-vindo ao Pitwall", nav: "sessions", hash: "#/", p: [
    "O Pitwall grava as suas voltas do ACC e do iRacing, ajuda a analisar onde está o tempo e fala com você durante a corrida.",
    "Este passeio rápido mostra cada parte. Dá para sair quando quiser e rever depois em Configurações > Geral." ] },
  { t: "Sessões: tudo é gravado sozinho", nav: "sessions", hash: "#/", p: [
    "Abra o jogo e entre na pista: a gravação começa sozinha, com telemetria e (se ligado) vídeo.",
    "Aqui ficam as suas sessões. Clique numa para ver as voltas, os setores e o que mudou entre elas." ] },
  { t: "Análise e Replay", nav: "compare", hash: "#/compare", p: [
    "Compare duas voltas lado a lado: o gráfico mostra onde você ganha ou perde tempo, curva a curva.",
    "No Replay você assiste à volta com o vídeo e a telemetria sincronizados." ] },
  { t: "Setups e Estratégia", nav: "setups", hash: "#/setups", p: [
    "Guarde os setups por carro e pista e receba sugestão conforme a temperatura do dia.",
    "Em Estratégia o Pitwall calcula combustível e paradas para a corrida." ] },
  { t: "Overlays por cima do jogo", nav: "overlays", hash: "#/overlays", p: [
    "Mapa, pedais, participantes, pneus, próxima curva e delta, em janelas transparentes sobre o jogo.",
    "Escolha um overlay, ligue em “Só na pista” e use “Editar na tela do jogo” para arrastar e redimensionar.",
    "Cada overlay tem modelos diferentes (minimalista, horizontal, torre…). Os extras são dos planos Pro e Equipe." ] },
  { t: "Engenheiro de voz", nav: "engineer", hash: "#/engineer", p: [
    "Um engenheiro que fala português: responde perguntas (“quem está atrás?”) e avisa sozinho de pneus, combustível e bandeiras.",
    "Para funcionar: 1) escolha e baixe uma voz; 2) baixe o modelo de reconhecimento (se quiser falar com ele); 3) defina a tecla de falar; 4) ligue o engenheiro.",
    "A aba Downloads mostra o que está baixado e permite limpar." ] },
  { t: "Comunidade, LFM e Equipe", nav: "team", hash: "#/team", p: [
    "Entre com o Google para comparar seus recordes com os amigos, ver o ranking e participar de equipes.",
    "O LFM mostra as corridas do Low Fuel Motorsport e avisa quando abrir." ] },
  { t: "Planos", nav: "plano", hash: "#/plano", p: [
    "Gravar e analisar é grátis. O Pro libera o engenheiro completo, voz online, vídeos sem limite e modelos extras de overlay.",
    "O plano Equipe inclui o Pro para até 10 pilotos e os modelos de transmissão. Há 10 dias de teste grátis, sem cartão." ] },
  { t: "Falta pouco: confira o que falta", nav: "guia", hash: "#/guia", p: [
    "Na página Primeiros passos você vê o que já está configurado e o que ainda falta, cada item com um atalho.",
    "Ela fica sempre no menu lateral. Bom treino!" ] },
];

let tourEl = null, tourIdx = 0;
function tourClose(done) {
  if (tourEl) { tourEl.remove(); tourEl = null; }
  document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl"));
  if (done) api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tour_done: true }) }).catch(() => {});
}
function startTour(i = 0) {
  tourIdx = i;
  if (!tourEl) { tourEl = document.createElement("div"); tourEl.id = "tour"; document.body.appendChild(tourEl); }
  tourDraw();
}
function tourDraw() {
  const s = TOUR[tourIdx], last = tourIdx === TOUR.length - 1;
  if (s.hash && location.hash !== s.hash) location.hash = s.hash;
  document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl"));
  const a = document.querySelector(`[data-nav="${s.nav}"]`); if (a) a.classList.add("tour-hl");
  tourEl.innerHTML = `<div class="tour-card" role="dialog" aria-label="Tour do Pitwall">
    <div class="tour-step">Passo ${tourIdx + 1} de ${TOUR.length}</div>
    <h3>${esc(s.t)}</h3>${s.p.map((x) => `<p>${esc(x)}</p>`).join("")}
    <div class="tour-dots">${TOUR.map((_, k) => `<i class="${k === tourIdx ? "on" : k < tourIdx ? "past" : ""}" data-k="${k}"></i>`).join("")}</div>
    <div class="tour-btns"><button class="btn sm quiet" id="tourSkip">${last ? "Fechar" : "Pular tour"}</button><span></span>
      ${tourIdx ? `<button class="btn sm" id="tourPrev">Voltar</button>` : ""}<button class="btn sm primary" id="tourNext">${last ? "Concluir" : "Próximo"}</button></div></div>`;
  tourEl.querySelector("#tourSkip").onclick = () => tourClose(true);
  tourEl.querySelector("#tourNext").onclick = () => { if (last) tourClose(true); else { tourIdx++; tourDraw(); } };
  const pv = tourEl.querySelector("#tourPrev"); if (pv) pv.onclick = () => { tourIdx--; tourDraw(); };
  tourEl.querySelectorAll(".tour-dots i").forEach((d) => d.onclick = () => { tourIdx = +d.dataset.k; tourDraw(); });
}
async function maybeTour() {
  try { const r = await api("/api/settings"); if (!r.settings.tour_done) setTimeout(() => startTour(0), 600); } catch (e) { /* ok */ }
  guiaBadge();
}

// ---------------------------------------------------------------- o que falta configurar
async function guiaItems() {
  const g = (p) => api(p).catch(() => null);
  const [S, live, sess, eng, team, lic, au] = await Promise.all([g("/api/settings").then((r) => r && r.settings), g("/api/live"), g("/api/sessions"),
    g("/api/engineer/status"), g("/api/team/status"), g("/api/license"), g("/api/autostart")]);
  const s = S || {}, items = [];
  const ovOn = Object.values(s.overlays || {}).some((o) => o.mode && o.mode !== "off");
  const piperOk = eng && eng.tts.piper.voices.some((v) => v.id === s.eng_piper_voice && v.installed);
  const voiceOk = s.eng_voice_mode === "online" || s.eng_offline_engine === "windows" || piperOk;
  items.push({ g: "Gravação", ok: !!((sess && sess.length) || (live && live.state && live.state !== "waiting")), t: "Gravar a primeira sessão",
    d: "Abra o ACC ou o iRacing e entre na pista. A gravação começa sozinha; nada para configurar.", a: ["Ver sessões", "#/"] });
  if (au && au.supported) items.push({ g: "Gravação", ok: !!au.enabled, opt: true, t: "Iniciar com o Windows", d: "Fica em segundo plano e grava sozinho quando o jogo abre.", a: ["Abrir Configurações", "#/settings"] });
  items.push({ g: "Ao vivo", ok: ovOn, t: "Ligar um overlay", d: "Escolha um overlay (mapa, pedais, delta…) e ligue em “Só na pista”. Use “Editar na tela do jogo” para posicionar.", a: ["Abrir Overlays", "#/overlays"] });
  items.push({ g: "Engenheiro de voz", ok: !!voiceOk, t: "Escolher e baixar a voz", d: "A voz offline do Piper é baixada uma vez (cerca de 60 MB). A voz do Windows já vem pronta.", a: ["Abrir Engenheiro", "#/engineer"] });
  if (s.eng_listen !== false) {
    items.push({ g: "Engenheiro de voz", ok: !!(eng && eng.stt.installed), t: "Baixar o reconhecimento de voz", d: "Necessário para ele entender o que você fala (roda no seu PC).", a: ["Abrir Engenheiro", "#/engineer"] });
    items.push({ g: "Engenheiro de voz", ok: s.eng_ptt_mode === "open" || !!(eng && eng.binding.value), t: "Definir a tecla de falar", d: "Teclado, mouse ou botão do volante. Clique em Definir e aperte a tecla.", a: ["Abrir Engenheiro", "#/engineer"] });
  }
  items.push({ g: "Engenheiro de voz", ok: !!s.eng_enabled, t: "Ligar o engenheiro", d: "Com ele ligado, fala durante a sessão e responde às suas perguntas.", a: ["Abrir Engenheiro", "#/engineer"] });
  items.push({ g: "Conta", ok: !!(team && (team.logged_in || team.user)), opt: true, t: "Entrar com o Google", d: "Para ranking, equipes e licença atrelada ao seu e-mail.", a: ["Abrir Equipe", "#/team"] });
  items.push({ g: "Conta", ok: !!(lic && lic.plan !== "free"), opt: true, t: "Conhecer os planos", d: "Pro e Equipe liberam o engenheiro completo e modelos extras. Há 10 dias de teste grátis.", a: ["Ver Plano", "#/plano"] });
  return items;
}
async function guiaBadge() {
  const items = await guiaItems().catch(() => []), n = items.filter((i) => !i.ok && !i.opt).length;
  const b = document.getElementById("guiaBadge");
  if (b) { b.textContent = n || ""; b.style.display = n ? "" : "none"; }
}
async function renderGuia() {
  current = { name: "guia" };
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  const items = await guiaItems();
  if (current.name !== "guia") return;
  const req = items.filter((i) => !i.opt), done = req.filter((i) => i.ok).length, pct = req.length ? Math.round(done / req.length * 100) : 100;
  const groups = [...new Set(items.map((i) => i.g))];
  view.innerHTML = `
    <div class="head"><div><h1>Primeiros passos</h1><div class="sub">O que já está pronto e o que ainda falta configurar.</div></div>
      <button class="btn" id="gTour">Rever o tour</button></div>
    <div class="set-sec on">
      <div class="set-card gd-prog"><div><b>${done} de ${req.length}</b> passos essenciais prontos</div>
        <div class="dl-bar"><i style="width:${Math.max(3, pct)}%"></i></div>
        <div class="sub">${done === req.length ? "Tudo configurado. Bom treino!" : "Siga os atalhos abaixo; os itens “opcional” não são obrigatórios."}</div></div>
      ${groups.map((gr) => `<div class="set-card"><h2>${esc(gr)}</h2>${items.filter((i) => i.g === gr).map((i, k) => `
        <div class="gd-row ${i.ok ? "ok" : ""}"><i class="gd-ck">${i.ok ? "✓" : ""}</i>
          <div class="gd-txt"><b>${esc(i.t)}${i.opt ? ` <em>opcional</em>` : ""}</b><small>${esc(i.d)}</small></div>
          ${i.ok ? "" : `<a class="btn sm primary" href="${i.a[1]}">${esc(i.a[0])}</a>`}</div>`).join("")}</div>`).join("")}
    </div>`;
  $("#gTour").onclick = () => startTour(0);
  guiaBadge();
}
