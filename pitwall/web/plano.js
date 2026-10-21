// Tela "Plano": mostra o plano atual, ativa chave de licença, começa o teste grátis e leva para assinar no site.
// Usa os helpers do app.js ($, api, esc, view, setRow, current).

const PLAN_FEATURES = [
  ["Gravar, analisar e comparar voltas, replay e overlays", "free"],
  ["Engenheiro de voz: avisos e perguntas básicas (combustível, posição, voltas, bandeiras)", "free"],
  ["Engenheiro de voz completo: pneus, freios, rivais, clima, box e muito mais", "pro"],
  ["Voz online (mais natural) e personalidade (humor, bronca, elogio)", "pro"],
  ["Observador: carros ao lado, três de lado, livre", "pro"],
  ["Vídeos das voltas sem limite (grátis guarda as últimas 5 sessões)", "pro"],
  ["Sem anúncios no site", "pro"],
];
const SRC_NAMES = { subscription: "Assinatura", grant: "Cortesia", trial: "Teste grátis", free: "", dev: "Desenvolvimento" };

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
          ${s.email ? `<span class="sub">${esc(s.email)}</span>` : ""}
        </div>
        <div class="plan-line">${paid ? esc(until) + " O Pitwall renova o plano sozinho sempre que abre com internet." : "Você está no plano Grátis. Assine o Pro ou comece o teste de 10 dias."}</div>
        ${s.error ? `<div class="note warn">${esc(s.error)}</div>` : ""}
        ${s.needs_refresh ? `<div class="note warn">A licença salva venceu ou não confere. Abra o Pitwall com internet para renovar.</div>` : ""}
        <div class="plan-actions">
          ${paid ? "" : s.logged_in ? `<button class="btn primary" id="pTrial">Começar teste grátis de 10 dias</button>`
            : `<button class="btn primary" id="pLogin">Entrar com o Google</button>`}
          <button class="btn ${paid ? "" : "primary"}" id="pUp">${paid ? "Gerenciar minha conta" : "Ver planos e assinar"}</button>
          <button class="btn sm" id="pRef">Atualizar agora</button>
        </div>
      </div>

      <div class="set-card"><h2>Chave de licença</h2>
        ${setRow("Tenho uma chave", "Se você pagou com um e-mail diferente do Google, cole a chave que aparece na sua conta no site (PW-XXXX-XXXX-XXXX-XXXX).",
          `<div class="eng-inline"><input id="pKey" type="text" placeholder="PW-XXXX-XXXX-XXXX-XXXX" value="" style="min-width:230px"><button class="btn" id="pKeyBtn">Ativar</button></div>`)}
        ${s.license_key ? `<div class="kv"><span>Sua chave</span><code>${esc(s.license_key)}</code></div>` : ""}
        ${(paid && s.source !== "dev") ? `<div class="sub" style="margin-top:8px"><button class="btn sm" id="pClear">Remover a licença deste computador</button></div>` : ""}
      </div>

      <div class="set-card"><h2>Código de presente</h2>
        ${setRow("Ganhou um código?", "Códigos de sorteios e parcerias liberam o Pro por alguns dias. Precisa estar com o Google ligado (botão acima).",
          `<div class="eng-inline"><input id="pGift" type="text" placeholder="PW-XXXXXXXX" style="min-width:200px"><button class="btn" id="pGiftBtn">Resgatar</button></div>`)}
      </div>

      <div class="set-card"><h2>O que cada plano libera</h2>
        <div class="plan-table">
          ${PLAN_FEATURES.map(([t, need]) => {
            const ok = need === "free" || paid;
            return `<div class="plan-row ${ok ? "on" : ""}"><i>${ok ? "✓" : "🔒"}</i><span>${esc(t)}</span>${need === "pro" ? `<em>Pro</em>` : ""}</div>`;
          }).join("")}
        </div>
      </div>
    </div>`;
  const act = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } renderPlano(); };
  const t = $("#pTrial");
  if (t) t.onclick = () => act(async () => { t.disabled = true; t.textContent = "Ativando…"; await post("/api/license/trial"); });
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
  $("#pKeyBtn").onclick = () => act(async () => {
    const r = await post("/api/license/key", { key: $("#pKey").value });
    if (r.error) alert(r.error);
  });
  $("#pGiftBtn").onclick = async () => {
    try {
      const r = await post("/api/license/redeem", { code: $("#pGift").value });
      alert(`Pronto! Você ganhou o plano ${r.plan === "team" ? "Equipe" : "Pro"} por ${r.days} dias.`);
    } catch (e) { alert(e.message); }
    renderPlano();
  };
  const c = $("#pClear");
  if (c) c.onclick = () => act(() => post("/api/license/clear"));
}
