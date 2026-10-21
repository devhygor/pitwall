// Tela do Engenheiro de voz: vozes (offline/online), microfone e fone, tecla de falar, avisos e teste de conversa.
// Usa os helpers do app.js ($, api, esc, view, setRow, current, lfmTimer).

const ENG_ENGINES = { piper: "Piper (offline)", windows: "Windows (offline)", edge: "Microsoft Edge (online)" };
const ENG_STATE = { off: "desligado", idle: "pronto", listening: "ouvindo…", thinking: "entendendo…" };

async function renderVoiceEngineer() {
  current = { name: "engineer" };
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let S, dev, cat;
  try {
    [S, dev, cat] = await Promise.all([api("/api/settings").then((r) => r.settings), api("/api/engineer/devices"), api("/api/engineer/catalog")]);
  } catch (e) {
    view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`;
    return;
  }
  if (current.name !== "engineer") return;
  const put = async (v) => {
    const r = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    S = r.settings;
    return r;
  };
  const post = (p, body) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}" ${String(val) === String(k) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const tgl = (id, on) => `<input id="${id}" class="tgl" type="checkbox" ${on ? "checked" : ""}>`;
  const ev = S.eng_events || {};
  const winVoices = (dev.windows_voices || []).filter((v) => /^pt/i.test(v.culture));
  const winAll = winVoices.length ? winVoices : dev.windows_voices || [];

  view.innerHTML = `
    <div class="head"><div><h1>Engenheiro</h1><div class="sub">Um engenheiro de rádio que fala português: responde às suas perguntas e avisa sozinho durante a pilotagem.</div></div></div>
    <div class="set-sec on">
      <div class="set-card">
        ${setRow("Engenheiro ligado", "Quando ligado, ele escuta (conforme o modo abaixo) e fala durante a sessão. Funciona no ACC e no iRacing.", tgl("eEnable", S.eng_enabled))}
        <div class="eng-chips" id="eChips"></div>
        <div class="eng-warn" id="eWarn"></div>
      </div>

      <div class="set-card"><h2>Voz</h2>
        ${setRow("Tipo de voz", "Offline funciona sem internet e é grátis. Online (Microsoft Edge) tem voz mais natural, também é grátis e não pede chave nem cadastro, mas precisa de internet e envia o texto falado para a Microsoft. Se a internet cair, ele volta sozinho para a voz offline.",
          sel("eMode", [["offline", "100% offline"], ["online", "Online (voz neural da Microsoft)"]], S.eng_voice_mode))}
        <div id="eOfflineBox">
        ${setRow("Voz offline", "Piper é uma voz neural em português, baixada uma vez (cerca de 60 MB). “Ouvir amostra”: antes de baixar toca uma frase de demonstração do projeto Piper; depois de baixada, fala frases de corrida com a voz. A voz do Windows (Maria) já vem instalada, mas soa mais robótica.",
          sel("eOff", [["piper", "Piper (neural, recomendada)"], ["windows", "Windows (Maria)"]], S.eng_offline_engine))}
        <div id="ePiperRow">${setRow("Voz do Piper", "<span id='ePiperMsg'></span>",
          `<div class="eng-inline">${sel("ePiper", dev.piper_voices.map((v) => [v.id, v.name + (v.installed ? " ✓" : " (baixar)")]), S.eng_piper_voice)}<button class="btn sm" id="ePiperStop">Parar</button><button class="btn sm" id="ePiperPlay" title="Toca uma amostra da voz, sem precisar baixar">Ouvir amostra</button><button class="btn sm" id="ePiperDl">Baixar</button></div>`)}</div>
        <div id="eWinRow">${setRow("Voz do Windows", winAll.length ? "" : "Nenhuma voz encontrada.",
          sel("eWin", [["", "Automática (português do Brasil)"], ...winAll.map((v) => [v.name, `${v.name} (${v.culture})`])], S.eng_win_voice))}</div>
        </div>
        <div id="eOnlineBox">${setRow("Voz online", "Neural, da Microsoft (a mesma da leitura em voz alta do Edge).", sel("eEdge", dev.edge_voices.map((v) => [v.id, v.name]), S.eng_edge_voice))}</div>
        ${setRow("Velocidade da fala", "", `<div class="eng-inline"><input type="range" id="eRate" min="70" max="150" step="5" value="${S.eng_rate}"><span id="eRateV" class="sub">${S.eng_rate}%</span></div>`)}
        ${setRow("Volume do engenheiro", "Só do engenheiro. Não mexe no volume do jogo nem do Windows.", `<div class="eng-inline"><input type="range" id="eVol" min="0" max="100" step="5" value="${S.eng_volume}"><span id="eVolV" class="sub">${S.eng_volume}%</span></div>`)}
        ${setRow("Efeito de rádio", "Voz de rádio de equipe, com bipe ao abrir e fechar o canal.", tgl("eRadio", S.eng_radio))}
        ${setRow("Intensidade do rádio", "0 = voz limpa e sem bipes; 100 = voz bem de rádio.", `<div class="eng-inline"><input type="range" id="eRadioLv" min="0" max="100" step="5" value="${S.eng_radio_level}"><span id="eRadioLvV" class="sub">${S.eng_radio_level}%</span></div>`)}
        ${setRow("Chiado", "Ruído de fundo do rádio. Zero tira o chiado e mantém o resto do efeito.", `<div class="eng-inline"><input type="range" id="eRadioNz" min="0" max="100" step="5" value="${S.eng_radio_noise}"><span id="eRadioNzV" class="sub">${S.eng_radio_noise}%</span></div>`)}
        ${setRow("Testar a voz", "Fala uma frase com a configuração atual. Dá para mexer no volume enquanto toca.", `<div class="eng-inline"><button class="btn" id="eTest">Testar</button><button class="btn sm" id="eStop">Parar</button></div>`)}
      </div>

      <div class="set-card"><h2>Microfone e fone</h2>
        ${dev.inputs.length || dev.outputs.length ? "" : `<div class="note warn">Não achei dispositivos de áudio (pacote sounddevice ausente?). Ele vai usar o padrão do Windows.</div>`}
        ${setRow("Microfone", "Onde ele ouve você.", sel("eMic", [["", "Padrão do Windows"], ...dev.inputs.map((d) => [d.name, d.name])], S.eng_mic))}
        ${setRow("Nível do microfone", "Fale para ver a barra mexer.", `<div class="lvl"><i id="eLvl"></i></div>`)}
        ${setRow("Fone / alto-falante do engenheiro", "Onde ele fala com você. Pode ser outro aparelho que o do jogo.", sel("eOut", [["", "Padrão do Windows"], ...dev.outputs.map((d) => [d.name, d.name])], S.eng_out))}
      </div>

      <div class="set-card"><h2>Falar com o engenheiro</h2>
        ${setRow("Ouvir minha voz", "Desligue se quiser só receber os avisos dele.", tgl("eListen", S.eng_listen !== false))}
        ${setRow("Como falar", "Segurar: aperte e segure a tecla enquanto fala. Apertar e falar: aperte uma vez, fale e ele para quando você se calar. Microfone aberto: ele escuta o tempo todo (use fone, ou o som do jogo atrapalha).",
          sel("ePttMode", [["hold", "Segurar a tecla (recomendado)"], ["toggle", "Apertar uma vez e falar"], ["open", "Microfone sempre aberto"]], S.eng_ptt_mode))}
        <div id="ePttRow">${setRow("Tecla de falar", "Teclado, botão do mouse ou botão do volante. Clique em Definir e aperte o que quiser usar (Esc cancela).",
          `<div class="eng-inline"><span class="keycap" id="ePttLbl">…</span><button class="btn" id="ePttSet">Definir</button><button class="btn sm" id="ePttClr" title="Remover">Limpar</button></div>`)}</div>
        <div id="eWakeRow">${setRow("Palavra de ativação", "No microfone aberto, ele só responde se você chamar por esse nome antes (ex.: “Engenheiro, quem está atrás?”).",
          `<div class="eng-inline">${tgl("eWake", S.eng_wake)}<input id="eWakeWord" type="text" value="${esc(S.eng_wake_word)}" style="min-width:110px"></div>`)}</div>
        ${setRow("Reconhecimento de voz", "Roda no seu computador (Whisper), sem internet depois de baixado. Maior = entende melhor e é mais lento.",
          `<div class="eng-inline">${sel("eStt", dev.stt_models.map((m) => [m.id, m.name + (m.installed ? " ✓" : "")]), S.eng_stt_model)}<button class="btn sm" id="eSttDl">Baixar</button></div>`)}
        <div class="sub" id="eSttMsg"></div>
      </div>

      <div class="set-card"><h2>Personalidade</h2>
        ${setRow("Jeito do engenheiro", "Profissional só dá os avisos. Bem-humorado brinca com os erros e comemora os acertos. Bravo dá bronca e elogia de má vontade. Variável muda de humor conforme o seu desempenho: sobe com recordes e ultrapassagens, cai com rodadas, voltas invalidadas e posições perdidas. Sem palavrão.",
          sel("ePers", [["profissional", "Profissional (só o essencial)"], ["humor", "Parceiro bem-humorado"], ["bravo", "Bravo (dá bronca)"], ["variavel", "Variável (muda com o seu desempenho)"]], S.eng_personality))}
        ${setRow("Quanto comenta", "Frequência dos comentários de humor, dicas e broncas.", sel("eHumLv", [["pouco", "De vez em quando"], ["normal", "Normal"], ["muito", "Toda hora"]], S.eng_humor_level))}
        ${setRow("Ouvir exemplo", "Fala três comentários no jeito escolhido (não precisa salvar nem estar no jogo).", `<div class="eng-inline"><button class="btn" id="ePersDemo">Ouvir exemplo</button><span class="sub" id="eMood"></span></div>`)}
      </div>

      <div class="set-card"><h2>Avisos automáticos</h2>
        ${setRow("Quanto ele fala", "Controla a frequência dos avisos.", sel("eVerb", [["pouco", "Pouco (só o importante)"], ["normal", "Normal"], ["muito", "Muito"]], S.eng_verbosity))}
        <div class="eng-cats" id="eCats">${cat.categories.map((c) => `<label class="eng-cat"><input class="tgl" type="checkbox" data-cat="${c.id}" ${ev[c.id] === false ? "" : "checked"}><span>${esc(c.name)}</span></label>`).join("")}</div>
        ${setRow("Inverter esquerda/direita do observador", "Se ele avisar “carro à esquerda” quando o carro está à direita, ligue isto. Veja abaixo o que ele está enxergando.", tgl("eSwap", S.eng_spotter_swap))}
        <div class="kv"><span>Observador agora</span><span id="eSpot" class="sub">—</span></div>
      </div>

      <div class="set-card"><h2>Conversar (teste)</h2>
        <div class="sub" style="margin-bottom:8px">Digite uma pergunta ou clique em “Falar” e pergunte pelo microfone (ele para sozinho quando você se calar). Funciona com os dados do jogo, ou do simulador (modo demo).</div>
        <div class="eng-ask"><input id="eAsk" type="text" placeholder="Ex.: quem está atrás de mim?" style="flex:1"><button class="btn primary" id="eAskBtn">Perguntar</button><button class="btn" id="eMicBtn" title="Fale uma pergunta no microfone escolhido">🎤 Falar</button></div>
        <div id="eAns" class="eng-ans"></div>
        <div class="eng-log" id="eLog"></div>
      </div>

      <div class="set-card"><h2>O que dá para perguntar</h2>
        <div class="sub" style="margin-bottom:10px">Clique numa pergunta para testar. Ele entende variações, gírias e números por extenso (“carro vinte e três”).</div>
        ${cat.examples.map((g) => `<div class="eng-exg"><b>${esc(g.group)}</b><div>${g.items.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`).join("")}
      </div>
    </div>`;

  // ---- ligações ------------------------------------------------------------------------------
  const bindSel = (id, key, conv = (x) => x) => $(id).addEventListener("change", async (e) => { await put({ [key]: conv(e.target.value) }); sync(); });
  const bindTgl = (id, key) => $(id).addEventListener("change", async (e) => { await put({ [key]: e.target.checked }); sync(); });
  bindTgl("#eEnable", "eng_enabled");
  bindTgl("#eRadio", "eng_radio");
  bindTgl("#eListen", "eng_listen");
  bindTgl("#eWake", "eng_wake");
  bindTgl("#eSwap", "eng_spotter_swap");
  bindSel("#eMode", "eng_voice_mode"); bindSel("#eOff", "eng_offline_engine"); bindSel("#ePiper", "eng_piper_voice");
  bindSel("#eWin", "eng_win_voice"); bindSel("#eEdge", "eng_edge_voice"); bindSel("#eMic", "eng_mic"); bindSel("#eOut", "eng_out");
  bindSel("#ePers", "eng_personality"); bindSel("#eHumLv", "eng_humor_level");
  $("#ePersDemo").onclick = () => post("/api/engineer/mood/demo", { personality: $("#ePers").value }).catch((e) => alert(e.message));
  bindSel("#ePttMode", "eng_ptt_mode"); bindSel("#eStt", "eng_stt_model"); bindSel("#eVerb", "eng_verbosity");
  $("#eWakeWord").addEventListener("change", (e) => put({ eng_wake_word: e.target.value.trim() || "engenheiro" }));
  $("#eRate").addEventListener("input", (e) => { $("#eRateV").textContent = e.target.value + "%"; });
  $("#eRate").addEventListener("change", (e) => put({ eng_rate: +e.target.value }));
  for (const [id, key] of [["eRadioLv", "eng_radio_level"], ["eRadioNz", "eng_radio_noise"]]) {
    $("#" + id).addEventListener("input", (e) => { $("#" + id + "V").textContent = e.target.value + "%"; });
    $("#" + id).addEventListener("change", (e) => put({ [key]: +e.target.value }));
  }
  $("#eVol").addEventListener("input", (e) => { $("#eVolV").textContent = e.target.value + "%"; });
  let volT = null;
  $("#eVol").addEventListener("input", (e) => {          // aplica enquanto arrasta, para ajustar durante o teste
    clearTimeout(volT);
    const v = +e.target.value;
    volT = setTimeout(() => put({ eng_volume: v }), 120);
  });
  $("#eCats").addEventListener("change", (e) => {
    const c = e.target.dataset.cat;
    if (c) put({ eng_events: { [c]: e.target.checked } });
  });
  $("#ePiperStop").onclick = () => post("/api/engineer/stop").catch(() => {});
  $("#eStop").onclick = () => post("/api/engineer/stop").catch(() => {});
  $("#eTest").onclick = () => post("/api/engineer/test").catch((e) => alert(e.message));
  $("#ePiperPlay").onclick = async (e) => {
    const b = e.target, t = b.textContent;
    b.disabled = true; b.textContent = "Carregando…";
    try { await post("/api/engineer/piper/sample", { name: $("#ePiper").value }); } catch (err) { alert(err.message); }
    setTimeout(() => { b.disabled = false; b.textContent = t; }, 800);
  };
  $("#ePiperDl").onclick = async () => { await post("/api/engineer/piper/download", { name: $("#ePiper").value }); pollNow(); };
  $("#eSttDl").onclick = async () => { await post("/api/engineer/stt/download", { name: $("#eStt").value }); pollNow(); };
  $("#ePttClr").onclick = async () => { await put({ eng_ptt: "" }); sync(); poll(); };
  $("#ePttSet").onclick = async () => {
    await post("/api/engineer/bind/start");
    const t0 = Date.now();
    $("#ePttSet").textContent = "Aperte a tecla…";
    const wait = async () => {
      if (current.name !== "engineer") return;
      const st = await api("/api/engineer/status");
      const c = st.binding.capture;
      if (c.state === "done") { await put({ eng_ptt: c.binding }); $("#ePttSet").textContent = "Definir"; poll(); return; }
      if (c.state === "waiting" && Date.now() - t0 < 12000) { setTimeout(wait, 150); return; }
      $("#ePttSet").textContent = "Definir";
    };
    setTimeout(wait, 250);
  };
  const ask = async (q) => {
    if (!q.trim()) return;
    $("#eAns").innerHTML = `<span class="sub">…</span>`;
    try {
      const r = await post("/api/engineer/ask", { text: q, speak: true });
      $("#eAns").innerHTML = `<div class="eng-q">${esc(r.heard)}</div><div class="eng-a">${esc(r.answer)}</div><div class="sub">intenção: ${esc(r.intent || "não entendi")}${r.target ? " · alvo: " + esc(r.target) : ""}</div>`;
    } catch (e) { $("#eAns").innerHTML = `<span class="status bad">${esc(e.message)}</span>`; }
    poll();
  };
  $("#eMicBtn").onclick = async () => {
    if ($("#eMicBtn").classList.contains("rec")) { post("/api/engineer/listen/stop").catch(() => {}); return; }   // clicou de novo: terminou de falar
    try { await post("/api/engineer/listen"); } catch (e) { $("#eAns").innerHTML = `<span class="status bad">${esc(e.message)}</span>`; return; }
    $("#eAns").innerHTML = `<span class="sub">Fale agora…</span>`;
    poll();
  };
  $("#eAskBtn").onclick = () => ask($("#eAsk").value);
  $("#eAsk").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(e.target.value); });
  view.querySelectorAll(".chip[data-q]").forEach((b) => b.onclick = () => { $("#eAsk").value = b.dataset.q; ask(b.dataset.q); });

  // mostra/esconde o que depende de outras opções
  function sync() {
    const online = S.eng_voice_mode === "online";
    $("#eOnlineBox").style.display = online ? "" : "none";
    $("#eOfflineBox").style.display = "";
    $("#ePiperRow").style.display = S.eng_offline_engine === "piper" ? "" : "none";
    $("#eWinRow").style.display = S.eng_offline_engine === "windows" ? "" : "none";
    $("#ePttRow").style.display = S.eng_ptt_mode === "open" ? "none" : "";
    $("#eWakeRow").style.display = S.eng_ptt_mode === "open" ? "" : "none";
  }
  sync();

  // ---- status ao vivo -----------------------------------------------------------------------------
  const chip = (txt, cls) => `<span class="eng-chip ${cls || ""}">${esc(txt)}</span>`;
  let lastLog = "";
  let wasDl = false;
  let lastTest = (await api("/api/engineer/status")).test.id;
  async function poll() {
    if (current.name !== "engineer") return;
    let st;
    try { st = await api("/api/engineer/status"); } catch (e) { return; }
    const chips = [];
    chips.push(chip(st.enabled ? (st.muted ? "Em silêncio" : "Ligado") : "Desligado", st.enabled ? (st.muted ? "warn" : "ok") : ""));
    const eng = st.tts.last_engine;
    chips.push(chip("Voz: " + (eng ? ENG_ENGINES[eng] : ENG_ENGINES[st.tts.order[0]] || "—"), st.tts.last_error ? "bad" : ""));
    chips.push(chip("Microfone: " + (ENG_STATE[st.listener.state] || st.listener.state), st.listener.error ? "bad" : st.listener.state === "listening" ? "ok" : ""));
    chips.push(chip(st.game.live ? `Jogo: ao vivo · ${st.game.cars} carros` : "Jogo: aguardando", st.game.live ? "ok" : ""));
    $("#eChips").innerHTML = chips.join("");
    // avisos do que falta instalar
    const warn = [];
    const first = st.tts.order[0];
    if (first === "piper" && (!st.tts.piper.lib || !dev.piper_voices.find((v) => v.id === S.eng_piper_voice)?.installed) && !st.tts.piper.voices.find((v) => v.id === S.eng_piper_voice && v.installed))
      warn.push(st.tts.piper.lib ? "Baixe a voz do Piper abaixo (uma vez só). Enquanto isso ele usa a voz do Windows." : "O pacote piper-tts não está instalado neste Pitwall; ele usa a voz do Windows.");
    if (S.eng_voice_mode === "online" && !st.tts.edge.lib) warn.push("O pacote edge-tts não está instalado; a voz online não vai funcionar.");
    if (S.eng_listen !== false) {
      if (!st.stt.lib) warn.push("O pacote faster-whisper não está instalado: ele não consegue ouvir você (os avisos funcionam).");
      else if (!st.stt.installed) warn.push("Baixe o modelo de reconhecimento de voz abaixo para ele entender o que você fala.");
      if (st.listener.error) warn.push(st.listener.error);
      if (S.eng_ptt_mode !== "open" && !st.binding.value) warn.push("Defina a tecla de falar.");
    }
    if (st.plan === "free") {
      if (S.eng_voice_mode === "online") warn.push("A voz online é do plano Pro: por enquanto ele usa a voz offline. Veja o menu Plano.");
      if (S.eng_personality !== "profissional") warn.push("A personalidade (humor, bronca) é do plano Pro. Veja o menu Plano.");
      warn.push("Plano Grátis: avisos e perguntas básicas. Pneus, freios, rivais, observador e o resto liberam no Pro (teste grátis de 10 dias no menu Plano).");
    }
    if (st.tts.last_error) warn.push("Voz: " + st.tts.last_error);
    if (st.errors.length) warn.push(st.errors[st.errors.length - 1]);
    $("#eWarn").innerHTML = warn.map((w) => `<div class="note warn">${esc(w)}</div>`).join("");
    const tst = st.test || {};
    const mb = $("#eMicBtn");
    const thinking = tst.state === "recording" && st.listener.state === "thinking";
    mb.classList.toggle("rec", tst.state === "recording" && !thinking);
    mb.classList.toggle("think", thinking);
    mb.textContent = thinking ? "Entendendo…" : tst.state === "recording" ? "● Ouvindo… (clique para parar)" : "🎤 Falar";
    if (tst.state === "recording") $("#eAns").innerHTML = tst.partial ? `<div class="eng-q">Você está dizendo:</div><div class="eng-a">${esc(tst.partial)}…</div>` : `<span class="sub">${thinking ? "Entendendo…" : "Fale agora…"}</span>`;
    else if (tst.state === "done" && tst.id !== lastTest) {
      lastTest = tst.id;
      $("#eAns").innerHTML = tst.error ? `<span class="status bad">${esc(tst.error)}</span>` :
        `<div class="eng-q">Você disse: ${esc(tst.heard)}</div><div class="eng-a">${esc(tst.answer)}</div><div class="sub">intenção: ${esc(tst.intent || "não entendi")}${tst.target ? " · alvo: " + esc(tst.target) : ""}</div>`;
    }
    $("#eMood").textContent = S.eng_personality === "variavel" ? "Humor agora: " + st.mood.label : "";
    $("#ePttLbl").textContent = st.binding.label;
    $("#eLvl").style.width = Math.round(st.listener.level * 100) + "%";
    // downloads
    const pp = st.tts.piper.progress;
    const nowDl = pp.state === "baixando" || st.stt.progress.state === "baixando";
    if (wasDl && !nowDl) { clearInterval(lfmTimer); renderVoiceEngineer(); return; }   // terminou de baixar: redesenha as listas
    wasDl = nowDl;
    $("#ePiperMsg").textContent = pp.state === "baixando" ? `Baixando ${pp.name}… ${pp.pct}%` : pp.state === "erro" ? "Erro: " + pp.error : "";
    const sp = st.stt.progress;
    const sm = st.stt.models.find((m) => m.id === S.eng_stt_model);
    $("#eSttMsg").textContent = sp.state === "baixando" ? `Baixando modelo ${sp.name}… ${sp.pct}%` : sp.state === "erro" ? "Erro: " + sp.error : sm && sm.installed ? "Modelo instalado." : "Modelo ainda não baixado.";
    const sps = st.spotter;
    $("#eSpot").textContent = !sps.source ? "sem dados (precisa estar na pista com outros carros)" : `${sps.source === "iracing" ? "iRacing" : "ACC"} · esquerda: ${sps.left} · direita: ${sps.right}${sps.source === "acc" && !sps.calibrated ? " · calibrando…" : ""}`;
    const log = st.log.slice().reverse().map((l) => {
      const k = { ouviu: "Você", falou: "Engenheiro", erro: "Erro", intencao: "" }[l.kind];
      if (k === "") return "";
      const t = new Date(l.t * 1000).toLocaleTimeString("pt-BR");
      return `<div class="eng-l ${l.kind}"><span class="sub">${t}</span> <b>${k}</b> ${esc(l.text)}</div>`;
    }).join("");
    if (log !== lastLog) { $("#eLog").innerHTML = log; lastLog = log; }
  }
  const pollNow = () => poll();
  await poll();
  post("/api/engineer/mic/probe").catch(() => {});
  let n = 0;
  lfmTimer = setInterval(() => {
    if (current.name !== "engineer") return;
    if (++n % 57 === 0) post("/api/engineer/mic/probe").catch(() => {});
    poll();
  }, 350);
}
