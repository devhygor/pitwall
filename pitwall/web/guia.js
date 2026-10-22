// Tour de boas-vindas e lista "Primeiros passos" (o que já está pronto e o que falta configurar).
// Usa os helpers do app.js ($, api, esc, view, current).

// ---------------------------------------------------------------- tour com foco (destaca o lugar exato e deixa configurar na hora)
const q1 = (s) => document.querySelector(s);
const TOUR = [
  { t: "Bem-vindo ao Pitwall", center: true, p: [
    "O Pitwall grava as suas voltas do ACC e do iRacing, ajuda a analisar onde está o tempo e fala com você durante a corrida.",
    "Neste passeio eu mostro cada lugar e já deixo você configurar no caminho. O resto da tela fica apagado para dar foco. Pode sair quando quiser." ] },
  { t: "Menu lateral", hash: "#/", target: "#sidenav", side: "right", p: [
    "Passe o mouse aqui para ver os nomes. Tudo fica agrupado: Gravações, Preparação, Ao vivo e Comunidade.",
    "Embaixo ficam o Plano, as Configurações e os Primeiros passos." ] },
  { t: "Status da gravação", hash: "#/", target: "#live", side: "right", p: [
    "Este indicador mostra quando o jogo foi detectado e a sessão está sendo gravada. Você não precisa apertar nada: abriu o ACC ou o iRacing e entrou na pista, grava sozinho." ] },
  { t: "Análise e Replay", hash: "#/compare", target: '[data-nav="compare"]', side: "right", p: [
    "Em Análise você compara duas voltas e vê, curva a curva, onde ganha ou perde tempo. No Replay assiste à volta com o vídeo sincronizado com a telemetria." ] },
  { t: "Overlays: ligue o primeiro", hash: "#/overlays", target: "#ovTiles", side: "right", done: "overlay",
    p: ["Cada cartão é um overlay (mapa, pedais, participantes…). A chavinha liga ou desliga; clicar no cartão abre as opções dele.", "Ligue agora o que quiser usar: ele aparece por cima do jogo só quando você está na pista."],
    acts: [["Ligar o Mapa", () => { const c = q1('[data-tile="map"]'); if (c && !c.checked) c.click(); }]] },
  { t: "Posicione na tela do jogo", hash: "#/overlays", target: "#ovEdit", side: "bottom", p: [
    "Este botão mostra os overlays ligados direto na tela, com dados de exemplo. Arraste para mover e puxe as bordas para mudar o tamanho. Clique de novo em “Concluir edição” quando terminar." ] },
  { t: "Escolha o modelo", hash: "#/overlays", target: "#ovPanel", side: "left", p: [
    "Aqui ficam as opções do overlay selecionado, incluindo o modelo (simples, completo, transmissão). Os modelos com cadeado são dos planos Pro e Equipe." ] },
  { t: "Engenheiro: escolha a voz", hash: "#/engineer", pre: () => q1('#eTabs [data-tab="voz"]')?.click(), target: "#ePiperRow", side: "bottom", done: "voice",
    p: ["O engenheiro fala português. A voz offline Piper é baixada uma vez (cerca de 60 MB). Escolha a voz, ouça a amostra e clique em Baixar. O progresso aparece aqui mesmo."],
    acts: [["Ouvir amostra", () => q1("#ePiperPlay")?.click()], ["Baixar a voz", () => q1("#ePiperDl")?.click()]] },
  { t: "Engenheiro: tecla de falar", hash: "#/engineer", pre: () => q1('#eTabs [data-tab="falar"]')?.click(), target: "#ePttRow", side: "bottom", done: "ptt",
    p: ["Defina a tecla que você aperta para falar com ele: teclado, mouse ou botão do volante. Clique em Definir e aperte a tecla."],
    acts: [["Definir a tecla", () => q1("#ePttSet")?.click()]] },
  { t: "Engenheiro: reconhecimento de voz", hash: "#/engineer", pre: () => q1('#eTabs [data-tab="falar"]')?.click(), target: "#eSttBox", side: "top", done: "stt",
    p: ["Para ele entender o que você fala, baixe o modelo de reconhecimento (roda no seu computador, sem internet depois)."],
    acts: [["Baixar o modelo", () => q1("#eSttDl")?.click()]] },
  { t: "Engenheiro: ligue", hash: "#/engineer", target: "#eEnable", side: "bottom", done: "eng",
    p: ["Com o engenheiro ligado ele avisa sozinho de combustível, pneus e bandeiras e responde às suas perguntas. A aba Downloads mostra e limpa o que foi baixado."],
    acts: [["Ligar o engenheiro", () => { const c = q1("#eEnable"); if (c && !c.checked) c.click(); }]] },
  { t: "Planos", hash: "#/plano", target: ".plan-hero", side: "bottom", p: [
    "Gravar e analisar é grátis. O Pro libera o engenheiro completo, voz online, vídeos sem limite e os overlays completos; o Equipe inclui o Pro para até 10 pilotos. Há 10 dias de teste grátis, sem cartão." ] },
  { t: "Falta pouco", hash: "#/guia", target: ".gd-prog", side: "bottom", p: [
    "Esta página lista o que já está configurado e o que falta, cada item com um atalho. Ela fica sempre no menu lateral. Bom treino!" ] },
];

let tourEl = null, tourIdx = 0, tourTimer = null, tourSeq = 0;
function tourClose(done) {
  clearInterval(tourTimer); tourTimer = null;
  if (tourEl) { tourEl.remove(); tourEl = null; }
  document.getElementById("tourSpot")?.remove();
  window.removeEventListener("resize", tourLayout);
  if (done) api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tour_done: true }) }).catch(() => {});
}
function startTour(i = 0) {
  tourIdx = i;
  if (!tourEl) {
    tourEl = document.createElement("div"); tourEl.id = "tour"; document.body.appendChild(tourEl);
    const sp = document.createElement("div"); sp.id = "tourSpot"; document.body.appendChild(sp);
    window.addEventListener("resize", tourLayout);
  }
  tourDraw();
}
const tourTarget = (s) => { const el = s.target ? q1(s.target) : null; return el && el.getClientRects().length ? el : null; };
async function tourDraw() {
  const s = TOUR[tourIdx], last = tourIdx === TOUR.length - 1, seq = ++tourSeq;
  if (s.hash && location.hash !== s.hash) location.hash = s.hash;
  tourEl.innerHTML = `<div class="tour-card" role="dialog" aria-label="Tour do Pitwall">
    <div class="tour-step">Passo ${tourIdx + 1} de ${TOUR.length}</div>
    <h3>${esc(s.t)}</h3>${s.p.map((x) => `<p>${esc(x)}</p>`).join("")}
    ${s.acts ? `<div class="tour-acts">${s.acts.map((a, k) => `<button class="btn sm" data-act="${k}">${esc(a[0])}</button>`).join("")}</div>` : ""}
    ${s.done ? `<div class="tour-done" id="tourDone"></div>` : ""}
    <div class="tour-dots">${TOUR.map((_, k) => `<i class="${k === tourIdx ? "on" : k < tourIdx ? "past" : ""}" data-k="${k}"></i>`).join("")}</div>
    <div class="tour-btns"><button class="btn sm quiet" id="tourSkip">${last ? "Fechar" : "Pular tour"}</button><span></span>
      ${tourIdx ? `<button class="btn sm" id="tourPrev">Voltar</button>` : ""}<button class="btn sm primary" id="tourNext">${last ? "Concluir" : "Próximo"}</button></div></div>`;
  tourEl.querySelector("#tourSkip").onclick = () => tourClose(true);
  tourEl.querySelector("#tourNext").onclick = () => { if (last) tourClose(true); else { tourIdx++; tourDraw(); } };
  const pv = tourEl.querySelector("#tourPrev"); if (pv) pv.onclick = () => { tourIdx--; tourDraw(); };
  tourEl.querySelectorAll(".tour-dots i").forEach((d) => d.onclick = () => { tourIdx = +d.dataset.k; tourDraw(); });
  tourEl.querySelectorAll("[data-act]").forEach((b) => b.onclick = async () => { await s.acts[+b.dataset.act][1](); setTimeout(tourCheck, 600); });
  // espera a tela carregar e o alvo aparecer (clica na aba certa, se for o caso)
  for (let n = 0; n < 40 && seq === tourSeq && s.target; n++) {
    if (s.pre) try { s.pre(); } catch (e) { /* ok */ }
    if (tourTarget(s)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (seq !== tourSeq || !tourEl) return;
  const t = tourTarget(s); if (t) t.scrollIntoView({ block: "center", behavior: "auto" });
  tourLayout(); tourCheck();
  clearInterval(tourTimer); tourTimer = setInterval(() => { tourLayout(); tourCheck(); }, 500);
}
function tourLayout() {
  if (!tourEl) return;
  const s = TOUR[tourIdx], card = tourEl.querySelector(".tour-card"), sp = document.getElementById("tourSpot");
  if (!card || !sp) return;
  const el = tourTarget(s);
  if (!el) { sp.style.cssText = "left:50%;top:50%;width:0;height:0"; card.style.cssText = "left:50%;top:50%;transform:translate(-50%,-50%)"; return; }
  const r = el.getBoundingClientRect(), pad = 8;
  sp.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const W = card.offsetWidth, H = card.offsetHeight, vw = innerWidth, vh = innerHeight, g = 18;
  const spots = { right: [r.right + pad + g, r.top], left: [r.left - pad - W - g, r.top], bottom: [r.left, r.bottom + pad + g], top: [r.left, r.top - pad - H - g] };
  let pos = null;
  for (const k of [s.side, "right", "bottom", "left", "top"]) {
    const [x, y] = spots[k] || [];
    if (x != null && x >= 8 && y >= 8 && x + W <= vw - 8 && y + H <= vh - 8) { pos = [x, y]; break; }
  }
  if (!pos) pos = [vw - W - 24, vh - H - 24];
  card.style.cssText = `left:${Math.max(8, Math.min(pos[0], vw - W - 8))}px;top:${Math.max(8, Math.min(pos[1], vh - H - 8))}px`;
}
async function tourCheck() {
  const s = TOUR[tourIdx], el = tourEl && tourEl.querySelector("#tourDone");
  if (!s || !s.done || !el) return;
  const items = await guiaItems().catch(() => []), it = items.find((i) => i.id === s.done), ok = it && it.ok;
  el.className = "tour-done" + (ok ? " ok" : "");
  el.textContent = ok ? "✓ Pronto, já está configurado" : "Ainda falta fazer esta parte (pode ser depois)";
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
  items.push({ g: "Gravação", ok: !!((sess && sess.length) || (live && live.state && live.state !== "waiting")), id: "game", t: "Gravar a primeira sessão",
    d: "Abra o ACC ou o iRacing e entre na pista. A gravação começa sozinha; nada para configurar.", a: ["Ver sessões", "#/"] });
  if (au && au.supported) items.push({ g: "Gravação", ok: !!au.enabled, opt: true, id: "auto", t: "Iniciar com o Windows", d: "Fica em segundo plano e grava sozinho quando o jogo abre.", a: ["Abrir Configurações", "#/settings"] });
  items.push({ g: "Ao vivo", ok: ovOn, id: "overlay", t: "Ligar um overlay", d: "Escolha um overlay (mapa, pedais, delta…) e ligue em “Só na pista”. Use “Editar na tela do jogo” para posicionar.", a: ["Abrir Overlays", "#/overlays"] });
  items.push({ g: "Engenheiro de voz", ok: !!voiceOk, id: "voice", t: "Escolher e baixar a voz", d: "A voz offline do Piper é baixada uma vez (cerca de 60 MB). A voz do Windows já vem pronta.", a: ["Abrir Engenheiro", "#/engineer"] });
  if (s.eng_listen !== false) {
    items.push({ g: "Engenheiro de voz", ok: !!(eng && eng.stt.installed), id: "stt", t: "Baixar o reconhecimento de voz", d: "Necessário para ele entender o que você fala (roda no seu PC).", a: ["Abrir Engenheiro", "#/engineer"] });
    items.push({ g: "Engenheiro de voz", ok: s.eng_ptt_mode === "open" || !!(eng && eng.binding.value), id: "ptt", t: "Definir a tecla de falar", d: "Teclado, mouse ou botão do volante. Clique em Definir e aperte a tecla.", a: ["Abrir Engenheiro", "#/engineer"] });
  }
  items.push({ g: "Engenheiro de voz", ok: !!s.eng_enabled, id: "eng", t: "Ligar o engenheiro", d: "Com ele ligado, fala durante a sessão e responde às suas perguntas.", a: ["Abrir Engenheiro", "#/engineer"] });
  items.push({ g: "Conta", ok: !!(team && (team.logged_in || team.user)), opt: true, id: "google", t: "Entrar com o Google", d: "Para ranking, equipes e licença atrelada ao seu e-mail.", a: ["Abrir Equipe", "#/team"] });
  items.push({ g: "Conta", ok: !!(lic && lic.plan !== "free"), opt: true, id: "plan", t: "Conhecer os planos", d: "Pro e Equipe liberam o engenheiro completo e modelos extras. Há 10 dias de teste grátis.", a: ["Ver Plano", "#/plano"] });
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
