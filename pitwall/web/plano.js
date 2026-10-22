// Tela "Plano": mostra o plano atual, ativa chave de licença, começa o teste grátis e leva para assinar no site.
// Usa os helpers do app.js ($, api, esc, view, setRow, current).

const PLAN_FEATURES = [
  ["Gravar, analisar e comparar voltas, replay e overlays", "free"],
  ["Engenheiro de voz: avisos e perguntas básicas (combustível, posição, voltas, bandeiras)", "free"],
  ["Engenheiro de voz completo: pneus, freios, rivais, clima, box e muito mais", "pro"],
  ["Personalização do engenheiro: velocidade, efeito de rádio, escolha de voz, modos de falar, quais avisos e personalidade", "pro"],
  ["Personalização completa dos overlays: ajustes, colunas, faixas de cor, unidades e mais opções em cada um", "pro"],
  ["Voz online (mais natural) e personalidade (humor, bronca, elogio)", "pro"],
  ["Observador: carros ao lado, três de lado, livre", "pro"],
  ["Vídeos das voltas sem limite (grátis guarda as últimas 5 sessões)", "pro"],
  ["Overlays básicos: mapa simples, pedais minimalistas, delta só número, participantes compacto, pneus em 4 quadrados, curva em linha, radar com luzes laterais, luzes de ponto cego (uma por lado)", "free"],
  ["Todos os modelos dos overlays: gráfico de pedais com volante e painel do piloto, delta completo e em barra larga, participantes completo e em torre, pneus como no ACC e em faixa, próxima curva completa, mapa com asfalto e modo seguir, radar (de cima, circular e halo) com carrinhos por classe", "pro"],
  ["Gerador de setup: analisa as suas voltas, recomenda ajustes e cria uma versão nova (ou atualiza o setup, com backup)", "pro"],
  ["Editor visual 3D do setup: clique nas partes do carro, veja a suspensão em raio-x e o que cada ajuste muda", "pro"],
  ["Setups da equipe: o setup de cada melhor tempo dos companheiros, com notas e instalação em 1 clique no ACC (para quem está na equipe)", "pro"],
  ["Equipe: Pro para 10 pessoas (o seu e mais 9 chaves para dividir com a equipe; todas vencem junto com o plano do dono)", "team"],
  ["Sem anúncios no site", "pro"],
];
const SRC_NAMES = { subscription: "Assinatura", grant: "Cortesia", trial: "Teste grátis", team: "Chave da equipe", free: "", dev: "Desenvolvimento" };

async function renderPlano() {
  current = { name: "plano" };
  view.innerHTML = `<div class="sub">Carregando…</div>`;
  let s;
  try { s = await api("/api/license"); } catch (e) { view.innerHTML = `<div class="panel"><span class="status bad">${esc(e.message)}</span></div>`; return; }
  if (current.name !== "plano") return;
  const post = (p, body) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const paid = s.plan !== "free";
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "";
  const endsFar = s.ends_at && new Date(s.ends_at).getFullYear() > 2100;
  const shownEnd = s.ends_at && s.source === "subscription" ? new Date(new Date(s.ends_at).getTime() - 3 * 86400000).toISOString() : s.ends_at;
  const until = !paid ? "" : endsFar ? "Sem data para acabar." : shownEnd ? `Válido até ${fmt(shownEnd)}.` : "";
  view.innerHTML = `
    <div class="head"><div><h1>Plano</h1><div class="sub">O que o seu plano libera e como mudar.</div></div></div>
    <div class="set-sec on">
      <div class="set-card plan-hero ${paid ? "paid" : ""}">
        <div class="plan-top">
          <div><span class="plan-chip ${paid ? "pro" : ""}">${esc(s.plan_name)}</span>
            ${SRC_NAMES[s.source] ? `<span class="sub"> · ${SRC_NAMES[s.source]}</span>` : ""}</div>
          ${s.email ? `<span class="sub">${pii(s.email, "email")}</span>` : ""}
        </div>
        <div class="plan-line">${paid ? esc(until) + " O Pitwall renova o plano sozinho sempre que abre com internet." : "Você está no plano Grátis. Assine o Pro ou comece o teste grátis."}</div>
        ${s.error ? `<div class="note warn">${esc(s.error)}</div>` : ""}
        ${s.needs_refresh ? `<div class="note warn">A licença salva venceu ou não confere. Abra o Pitwall com internet para renovar.</div>` : ""}
        <div class="plan-actions">
          ${paid ? "" : s.logged_in ? `<button class="btn primary" id="pTrial">Testar o Pro por ${s.trial_days || 10} dias</button>`
            : `<button class="btn primary" id="pLogin">Entrar com o Google</button>`}
          <button class="btn ${paid ? "" : "primary"}" id="pUp">${paid ? "Gerenciar minha conta" : "Ver planos e assinar"}</button>
          <button class="btn sm" id="pRef">Atualizar agora</button>
        </div>
      </div>

      <div class="set-card"><h2>Chave de licença</h2>
        ${setRow("Tenho uma chave", "Se você pagou com um e-mail diferente do Google, cole a chave que aparece na sua conta no site (PW-XXXX-XXXX-XXXX-XXXX).",
          `<div class="eng-inline"><input id="pKey" type="text" placeholder="PW-XXXX-XXXX-XXXX-XXXX" value="" style="min-width:230px"><button class="btn" id="pKeyBtn">Ativar</button></div>`)}
        ${s.license_key ? `<div class="kv"><span>Sua chave</span><code>${pii(s.license_key, "key")}</code></div>` : ""}
        ${(paid && s.source !== "dev") ? `<div class="sub" style="margin-top:8px"><button class="btn sm" id="pClear">Remover a licença deste computador</button></div>` : ""}
      </div>

      <div class="set-card"><h2>Indique e ganhe</h2>
        ${setRow("Seu link de indicação", "Cada amigo que entrar pelo seu link ganha 5% no primeiro pagamento, e você ganha 1% de desconto na próxima assinatura a cada 2 amigos que usarem o Pitwall, até 50%.",
          `<button class="btn" id="pRefer">Ver meu link</button>`)}
      </div>

      <div class="set-card"><h2>Código de presente</h2>
        ${setRow("Ganhou um código?", "Códigos de sorteios e parcerias liberam o Pro por alguns dias, e a chave da equipe (PWT-…) libera o Pro até o fim do plano de quem te passou a chave. Precisa estar com o Google ligado (botão acima).",
          `<div class="eng-inline"><input id="pGift" type="text" placeholder="PW-… ou PWT-… (chave da equipe)" style="min-width:230px"><button class="btn" id="pGiftBtn">Resgatar</button></div>`)}
      </div>

      <div class="set-card"><h2>O que cada plano libera</h2>
        <div class="plan-table">
          ${PLAN_FEATURES.map(([t, need]) => {
            const ok = need === "free" || (need === "pro" ? paid : s.plan === "team");
            return `<div class="plan-row ${ok ? "on" : ""}"><i>${ok ? "✓" : "🔒"}</i><span>${esc(t)}</span>${need === "pro" ? `<em>Pro</em>` : need === "team" ? `<em>Equipe</em>` : ""}</div>`;
          }).join("")}
        </div>
      </div>
    </div>`;
  const act = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } renderPlano(); };
  for (const [id, plan] of [["#pTrial", "pro"], ["#pTrialTeam", "team"]]) {
    const t = $(id);
    if (t) t.onclick = () => act(async () => { t.disabled = true; t.textContent = "Ativando…"; await post("/api/license/trial", { plan }); });
  }
  const l = $("#pLogin");
  if (l) l.onclick = async () => {
    await post("/api/team/login");
    l.textContent = "Termine o login no navegador…";
    const wait = async (n) => {
      if (current.name !== "plano") return;
      const st = await api("/api/team/status").catch(() => ({}));
      if (st.logged_in || st.user) { await post("/api/license/refresh"); renderPlano(); return; }
      if (n < 120) setTimeout(() => wait(n + 1), 1500);
    };
    wait(0);
  };
  $("#pUp").onclick = () => post("/api/open-url", { url: s.upgrade_url }).catch((e) => alert(e.message));
  $("#pRef").onclick = () => act(() => post("/api/license/refresh"));
  $("#pRefer").onclick = () => post("/api/open-url", { url: "https://pitwall.hygor.com.br/#/indicar" }).catch((e) => alert(e.message));
  $("#pKeyBtn").onclick = () => act(async () => {
    const r = await post("/api/license/key", { key: $("#pKey").value });
    if (r.error) alert(r.error);
  });
  $("#pGiftBtn").onclick = async () => {
    try {
      const r = await post("/api/license/redeem", { code: $("#pGift").value });
      alert(r.seat ? `Chave da equipe ativada! Você tem o Pro até ${new Date(r.ends_at).toLocaleDateString("pt-BR")}, o mesmo prazo do plano do dono da equipe.` : `Pronto! Você ganhou o plano ${r.plan === "team" ? "Equipe" : "Pro"} por ${r.days} dias.`);
    } catch (e) { alert(e.message); }
    renderPlano();
  };
  const c = $("#pClear");
  if (c) c.onclick = () => act(() => post("/api/license/clear"));
}
