/* Pitwall · planos, minha conta e painel do administrador.
   Usa os helpers do app.js ($, view, sb, esc, session, rpc) e as funções do Supabase
   (planos/preços públicos, my_account, start_trial, admin_*, e as funções de borda "checkout" e "license"). */
"use strict";

let isAdmin = false, myPlan = { plan: "free", features: [] };

async function loadAccountFlags() {
  isAdmin = false; myPlan = { plan: "free", features: [] };
  if (!session) { window.PITWALL_NO_ADS = false; return; }
  try { isAdmin = !!(await rpc("is_admin")); } catch (e) { /* ok */ }
  try { myPlan = (await rpc("my_account")) || myPlan; } catch (e) { /* ok */ }
  window.PITWALL_NO_ADS = (myPlan.features || []).includes("no_ads");
}

const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const dtt = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const days = (iso) => iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null;
const PLAN_NAME = { free: "Grátis", pro: "Pro", team: "Equipe" };
const SRC_NAME = { subscription: "Assinatura", grant: "Cortesia", trial: "Teste grátis", free: "" };
const STATUS_NAME = { active: "Ativa", pending: "Aguardando pagamento", past_due: "Atrasada", canceled: "Cancelada", expired: "Expirada",
  paid: "Pago", overdue: "Vencido", refunded: "Reembolsado", failed: "Falhou" };
const FEATURE_NAME = { voice_basic: "Engenheiro de voz básico", voice_full: "Engenheiro de voz completo", voice_online: "Voz online",
  voice_personality: "Personalidade do engenheiro", spotter: "Observador (carros ao lado)", video_unlimited: "Vídeos sem limite",
  setups_unlimited: "Setups sem limite", team_multi: "Várias equipes", no_ads: "Sem anúncios", team_admin: "Painel da equipe" };
const loginGoogle = (back) => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname + (back || "") } });

// ---------------------------------------------------------------- planos (público)
async function renderPlans() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  const [{ data: plans }, { data: prices }] = await Promise.all([
    sb.from("plans").select("*").order("sort"), sb.from("prices").select("*").eq("active", true)]);
  let period = store.get("pw.period") === "year" ? "year" : "month";
  const price = (code, per, fundador) => (prices || []).filter((p) => p.plan_code === code && p.period === per && (fundador ? p.label : !p.label))[0];
  const draw = () => {
    store.set("pw.period", period);
    view.innerHTML = `
      <section class="sect"><div class="wrap plans">
        <span class="eyebrow">Planos</span>
        <h1 class="plans-h">Comece de graça. Assine quando quiser mais.</h1>
        <p class="lede">Gravar, analisar e comparar as suas voltas é grátis. O Pro libera o engenheiro de voz completo e tira os anúncios.</p>
        <div class="period"><button class="btn small ${period === "month" ? "on" : ""}" data-per="month">Mensal</button>
          <button class="btn small ${period === "year" ? "on" : ""}" data-per="year">Anual <em>economize</em></button></div>
        <div class="plan-grid">${(plans || []).map((pl) => planCard(pl)).join("")}</div>
        <p class="plans-note">Pagamento por Pix, cartão ou boleto, com renovação automática. Cancele quando quiser. Emitimos nota fiscal. O teste grátis de 10 dias não pede cartão.</p>
      </div></section>`;
    view.querySelectorAll("[data-per]").forEach((b) => b.onclick = () => { period = b.dataset.per; draw(); });
    view.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => buy(b.dataset.buy, b.dataset.price));
    view.querySelectorAll("[data-trial]").forEach((b) => b.onclick = startTrialSite);
  };
  const planCard = (pl) => {
    const std = price(pl.code, period), fund = pl.code === "pro" && period === "month" ? price("pro", "month", true) : null;
    const cur = myPlan.plan === pl.code;
    const LISTS = {
      free: ["Gravar, analisar e comparar voltas", "Replay e overlays no jogo", "Engenheiro de voz: avisos e perguntas básicas", "Compare com amigos em 1 equipe", "Vídeos das últimas 5 sessões"],
      pro: ["Tudo do plano Grátis, e mais:", "Engenheiro de voz completo (pneus, freios, rivais, clima, box)", "Voz online, mais natural", "Personalidade: humor, elogio e bronca", "Observador: carros ao lado, três de lado, livre", "Vídeos e setups sem limite", "Várias equipes", "Sem anúncios no site"],
      team: ["Tudo do plano Pro, e mais:", "Até 10 pilotos na equipe", "Painel do dono para gerenciar os pilotos", "Até 3 computadores por licença"],
    };
    const feats = (LISTS[pl.code] || (pl.features || []).map((f) => FEATURE_NAME[f] || f)).map((t, i) => `<li${i === 0 && /^Tudo do/.test(t) ? ' class="all"' : ""}>${esc(t)}</li>`).join("");
    let amount = pl.code === "free" ? "R$ 0" : std ? brl(period === "year" ? std.amount_cents / 12 : std.amount_cents) : "—";
    let sub = pl.code === "free" ? "para sempre" : period === "year" && std ? `${brl(std.amount_cents)} por ano` : "por mês";
    let btn;
    if (pl.code === "free") btn = `<a class="btn quiet" href="${esc(PITWALL.download)}">Baixar grátis</a>`;
    else if (cur) btn = `<span class="btn quiet" aria-disabled="true">Seu plano atual</span>`;
    else if (!session) btn = `<button class="btn go" data-go="entrar" id="needLogin">Entrar para assinar</button>`;
    else btn = `<button class="btn go" data-buy="${pl.code}" data-price="${(fund || std || {}).id || ""}">${fund ? "Assinar com preço Fundador" : "Assinar"}</button>`;
    return `<article class="plan ${pl.code === "pro" ? "hot" : ""}">
      ${pl.code === "pro" ? `<span class="plan-badge">Mais escolhido</span>` : ""}
      <h2>${esc(pl.name)}</h2><p class="plan-desc">${esc(pl.description)}</p>
      <div class="plan-price"><b>${amount}</b><span>${sub}</span></div>
      ${fund ? `<div class="fundador">Preço Fundador: <b>${brl(fund.amount_cents)}</b>/mês, e o valor não sobe para quem assinar agora.</div>` : ""}
      <ul>${feats}</ul>
      ${btn}
      ${pl.code === "pro" && !cur && myPlan.plan === "free" ? `<button class="btn quiet small" data-trial>Testar 10 dias grátis</button>` : ""}
    </article>`;
  };
  draw();
  const nl = $("#needLogin");
  if (nl) nl.onclick = (e) => { e.preventDefault(); loginGoogle("#/planos"); };
}

async function startTrialSite() {
  if (!session) return loginGoogle("#/planos");
  try {
    const r = await rpc("start_trial", { p_device: null });
    if (!r.ok) {
      alert({ trial_used: "O teste grátis já foi usado neste e-mail.", already_paid: "Você já tem um plano pago.", login: "Entre com o Google." }[r.error] || "Não foi possível começar o teste.");
      return;
    }
    await loadAccountFlags();
    alert("Teste grátis ativado por 10 dias! Abra o Pitwall e entre com o mesmo e-mail do Google (menu Plano) para liberar os recursos.");
    location.hash = "#/conta";
  } catch (e) { alert(e.message); }
}

async function buy(plan, priceId) {
  const html = `<div class="modal" id="buyModal"><div class="modal-box">
    <h2>Assinar o plano ${esc(PLAN_NAME[plan] || plan)}</h2>
    <p class="sub">Precisamos do nome e do CPF ou CNPJ para emitir a cobrança e a nota fiscal. O acesso é liberado no e-mail <b>${esc(session.user.email)}</b>.</p>
    <label>Nome completo ou razão social<input id="bName" type="text" autocomplete="name" value="${esc((profile && profile.name) || "")}"></label>
    <label>CPF ou CNPJ<input id="bDoc" type="text" inputmode="numeric" autocomplete="off" placeholder="somente números"></label>
    <div class="modal-err" id="bErr"></div>
    <div class="modal-actions"><button class="btn quiet" id="bCancel">Cancelar</button><button class="btn go" id="bGo">Ir para o pagamento</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  const close = () => $("#buyModal")?.remove();
  $("#bCancel").onclick = close;
  $("#bGo").onclick = async () => {
    const name = $("#bName").value.trim(), doc = $("#bDoc").value.replace(/\D/g, "");
    $("#bErr").textContent = "";
    $("#bGo").disabled = true; $("#bGo").textContent = "Gerando cobrança…";
    try {
      const { data: s } = await sb.auth.getSession();
      const r = await fetch(`${PITWALL.url}/functions/v1/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session.access_token}`, apikey: PITWALL.key },
        body: JSON.stringify({ plan, price_id: priceId || undefined, name, doc }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        const msg = { doc_invalido: "CPF ou CNPJ inválido.", nome: "Informe o nome completo.", payments_not_configured: "Os pagamentos ainda não foram ativados. Tente mais tarde.",
          preco_fora_do_prazo: "Esse preço não está mais disponível." }[j.error] || j.message || "Não foi possível gerar a cobrança.";
        throw new Error(msg);
      }
      location.href = j.url;
    } catch (e) {
      $("#bErr").textContent = e.message;
      $("#bGo").disabled = false; $("#bGo").textContent = "Ir para o pagamento";
    }
  };
}

// ---------------------------------------------------------------- minha conta
async function renderAccount() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  let a;
  try { a = await rpc("my_account"); } catch (e) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">${esc(e.message)}</div></div></section>`; return; }
  myPlan = a; window.PITWALL_NO_ADS = (a.features || []).includes("no_ads");
  const paid = a.plan !== "free";
  const left = days(a.ends_at);
  const far = a.ends_at && new Date(a.ends_at).getFullYear() > 2100;
  const { data: pays } = await sb.from("payments").select("*").order("created_at", { ascending: false }).limit(20);
  view.innerHTML = `
    <section class="sect"><div class="wrap acct">
      <span class="eyebrow">Minha conta</span>
      <h1 class="plans-h">${esc(a.email || "")}</h1>
      <div class="acct-grid">
        <div class="panel"><h2>Plano</h2>
          <div class="plan-chip2 ${paid ? "pro" : ""}">${esc(PLAN_NAME[a.plan] || a.plan)}</div>
          <span class="sub"> ${SRC_NAME[a.source] ? "· " + SRC_NAME[a.source] : ""}</span>
          <p>${paid ? (far ? "Sem data para acabar." : `Válido até <b>${dt(a.ends_at)}</b>${left != null && left <= 10 ? ` (faltam ${left} dia${left === 1 ? "" : "s"})` : ""}.`) : "Você está no plano Grátis."}</p>
          <div class="row-actions">
            ${paid && a.source !== "grant" ? "" : `<a class="btn go small" href="#/planos">${paid ? "Ver planos" : "Assinar o Pro"}</a>`}
            ${!paid && !a.trial ? `<button class="btn small" id="aTrial">Testar 10 dias grátis</button>` : ""}
          </div>
          ${a.trial ? `<p class="sub">Teste grátis: de ${dt(a.trial.started_at)} até ${dt(a.trial.ends_at)}.</p>` : ""}
        </div>
        <div class="panel"><h2>Chave de licença</h2>
          ${a.license_key ? `<code class="lickey" id="licKey">${esc(a.license_key)}</code><button class="btn small quiet" id="copyKey">Copiar</button>
            <p class="sub">No Pitwall: menu <b>Plano</b> &gt; “Tenho uma chave”. Se entrar com o mesmo e-mail do Google, não precisa da chave.</p>`
            : `<p class="sub">A chave aparece aqui quando você tiver um plano pago, uma cortesia ou o teste grátis.</p>`}
        </div>
        <div class="panel"><h2>Computadores (${(a.devices || []).length}/${a.max_devices || 1})</h2>
          ${(a.devices || []).length ? `<table class="tbl"><tbody>${a.devices.map((d) => `<tr><td>${esc(d.label || "Computador")}</td><td class="sub">visto ${dtt(d.last_seen)}</td>
            <td><button class="btn small quiet" data-rmdev="${d.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : `<p class="sub">Nenhum computador usando a licença ainda.</p>`}
        </div>
        <div class="panel"><h2>Pagamentos</h2>
          ${(pays || []).length ? `<table class="tbl"><tbody>${pays.map((p) => `<tr><td>${dt(p.paid_at || p.due_date || p.created_at)}</td><td>${brl(p.amount_cents)}</td>
            <td>${esc(STATUS_NAME[p.status] || p.status)}</td><td>${p.invoice_url ? `<a href="${esc(p.invoice_url)}" target="_blank" rel="noopener">Recibo</a>` : ""}</td></tr>`).join("")}</tbody></table>`
            : `<p class="sub">Nenhum pagamento ainda.</p>`}
          <p class="sub">Para cancelar ou trocar a forma de pagamento, use o link do e-mail de cobrança do Asaas ou fale com a gente.</p>
        </div>
      </div></div></section>`;
  const t = $("#aTrial"); if (t) t.onclick = startTrialSite;
  const c = $("#copyKey"); if (c) c.onclick = async () => { await navigator.clipboard.writeText(a.license_key); c.textContent = "Copiado!"; };
  view.querySelectorAll("[data-rmdev]").forEach((b) => b.onclick = async () => { await rpc("revoke_my_device", { p_id: b.dataset.rmdev }); renderAccount(); });
}

// ---------------------------------------------------------------- painel do administrador
const ADM_TABS = [["geral", "Visão geral"], ["usuarios", "Usuários e versões"], ["assinaturas", "Assinaturas"], ["pagamentos", "Pagamentos"], ["cortesias", "Cortesias"],
  ["testes", "Testes"], ["licencas", "Licenças e computadores"], ["precos", "Preços"], ["log", "Histórico"]];

// última versão publicada do app (para marcar quem está desatualizado)
let _latest = null;
async function latestVersion() {
  if (_latest) return _latest;
  for (const repo of ["devhygor/pitwall-releases", "devhygor/pitwall"]) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (r.ok) { const j = await r.json(); _latest = String(j.tag_name || "").replace(/^v/, ""); if (_latest) return _latest; }
    } catch (e) { /* tenta o próximo */ }
  }
  return null;
}
const verParts = (v) => String(v || "").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
function verOlder(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}

async function renderAdmin() {
  if (!isAdmin) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">Área restrita.</div></div></section>`; return; }
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  let D, U = [], LATEST = null;
  try { D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; LATEST = await latestVersion(); } catch (e) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">${esc(e.message)}</div></div></section>`; return; }
  let tab = store.get("pw.admTab") || "geral", q = "";
  const match = (o) => !q || JSON.stringify(o).toLowerCase().includes(q);
  const badge = (s) => `<span class="st st-${s}">${esc(STATUS_NAME[s] || s)}</span>`;
  const draw = () => {
    store.set("pw.admTab", tab);
    const c = D.counts;
    const body = {
      geral: () => `<div class="kpis">
          ${[["Assinantes ativos", c.active], ["Atrasadas", c.past_due], ["Cortesias", c.grants], ["Testes em andamento", c.trials], ["Usuários", c.users], ["Receita mensal (MRR)", brl(D.mrr_cents)]]
            .map(([t, v]) => `<div class="kpi"><small>${t}</small><b>${v}</b></div>`).join("")}</div>
        <div class="panel"><h2>Vencem nos próximos 10 dias</h2>${table(["E-mail", "Origem", "Plano", "Vence em"],
          [...D.subscriptions.filter((s) => s.status !== "canceled" && s.current_period_end).map((s) => [s.email, "Assinatura", PLAN_NAME[s.plan_code], s.current_period_end]),
           ...D.grants.filter((g) => !g.revoked_at && g.expires_at).map((g) => [g.email, "Cortesia", PLAN_NAME[g.plan_code], g.expires_at]),
           ...D.trials.map((t) => [t.email, "Teste", "Pro", t.ends_at])]
            .filter((r) => { const d = days(r[3]); return d != null && d >= 0 && d <= 10; }).sort((a, b) => new Date(a[3]) - new Date(b[3]))
            .map((r) => [esc(r[0]), r[1], r[2], `${dt(r[3])} <span class="sub">(${days(r[3])} d)</span>`]), true)}</div>`,
      usuarios: () => `<div class="panel"><h2>Quem usa o Pitwall</h2>
        <p class="sub">A versão aparece depois que a pessoa abre o app novo (0.1.45 ou mais recente) com o login do Google.${LATEST ? ` Última versão publicada: <b>${esc(LATEST)}</b>.` : ""}</p>
        ${table(["E-mail", "Plano", "Versão do app", "Último acesso do app", "Computadores", "Cadastro", "Último login"],
          U.filter(match).map((u) => [esc(u.email), `${PLAN_NAME[u.plan] || "Grátis"}${SRC_NAME[u.source] ? ` <small class="sub">(${SRC_NAME[u.source]})</small>` : ""}`,
            u.app_version ? `<b>${esc(u.app_version)}</b>${LATEST && verOlder(u.app_version, LATEST) ? ` <span class="st st-past_due">desatualizado</span>` : ` <span class="st st-active">em dia</span>`}` : `<span class="sub">ainda não apareceu</span>`,
            u.last_seen ? `${dtt(u.last_seen)}<br><small class="sub">${esc(u.device_label || "")}</small>` : "—", u.devices || 0, dt(u.created_at), dtt(u.last_sign_in_at)]), true)}</div>`,
      assinaturas: () => `<div class="panel">${table(["E-mail", "Nome / CPF-CNPJ", "Plano", "Status", "Vence", "Chave", ""],
        D.subscriptions.filter(match).map((s) => [esc(s.email), `${esc(s.name || "")}<br><small class="sub">${esc(s.doc || "")}</small>`,
          `${PLAN_NAME[s.plan_code]} ${s.period === "year" ? "anual" : "mensal"}`, badge(s.status) + (s.cancel_at_period_end ? ` <small class="sub">cancela no fim</small>` : ""),
          dt(s.current_period_end), `<code>${esc(s.license_key || "")}</code>`,
          `<button class="btn small quiet" data-ext="${s.id}" data-end="${s.current_period_end || ""}">+30 dias</button>
           <button class="btn small quiet" data-cancel="${s.id}">Cancelar</button>`]), true)}</div>`,
      pagamentos: () => `<div class="panel">${table(["Data", "E-mail", "Valor", "Status", "Forma", "Recibo"],
        D.payments.filter(match).map((p) => [dt(p.paid_at || p.due_date || p.created_at), esc(p.email || ""), brl(p.amount_cents), badge(p.status), esc(p.method || ""),
          p.invoice_url ? `<a href="${esc(p.invoice_url)}" target="_blank" rel="noopener">abrir</a>` : ""]), true)}</div>`,
      cortesias: () => `<div class="panel"><h2>Dar um plano de cortesia</h2>
        <div class="adm-form"><input id="gMail" type="email" placeholder="e-mail do amigo (o do Google dele)">
          <select id="gPlan"><option value="pro">Pro</option><option value="team">Equipe</option></select>
          <select id="gDays"><option value="30">30 dias</option><option value="90">90 dias</option><option value="365">1 ano</option><option value="">Sem data para acabar</option></select>
          <input id="gWhy" type="text" placeholder="motivo (opcional)"><button class="btn go small" id="gGo">Liberar</button></div>
        <p class="sub">A pessoa entra no Pitwall com esse e-mail do Google (ou usa a chave) e já recebe o plano.</p></div>
        <div class="panel">${table(["E-mail", "Plano", "Até", "Motivo", "Status", ""], D.grants.filter(match).map((g) => [esc(g.email), PLAN_NAME[g.plan_code],
          g.expires_at ? dt(g.expires_at) : "sem fim", esc(g.reason || ""), g.revoked_at ? `<span class="st st-canceled">Revogada</span>` : (!g.expires_at || new Date(g.expires_at) > new Date()) ? `<span class="st st-active">Ativa</span>` : `<span class="st st-expired">Vencida</span>`,
          g.revoked_at ? "" : `<button class="btn small quiet" data-rg="${g.id}">Revogar</button>`]), true)}</div>`,
      testes: () => `<div class="panel">${table(["E-mail", "Começou", "Termina", "", ""], D.trials.filter(match).map((t) => [esc(t.email), dt(t.started_at),
        `${dt(t.ends_at)} <span class="sub">(${days(t.ends_at)} d)</span>`, `<button class="btn small quiet" data-xt="${esc(t.email)}">+7 dias</button>`, ""]), true)}</div>`,
      licencas: () => `<div class="panel"><h2>Chaves</h2>${table(["Chave", "E-mail", "Criada", "Status", ""], D.licenses.filter(match).map((l) => [`<code>${esc(l.key)}</code>`, esc(l.email), dt(l.created_at),
        l.revoked_at ? `<span class="st st-canceled">Revogada</span>` : `<span class="st st-active">Ativa</span>`, l.revoked_at ? "" : `<button class="btn small quiet" data-rl="${esc(l.key)}">Revogar</button>`]), true)}</div>
        <div class="panel"><h2>Computadores</h2>${table(["E-mail", "Computador", "Versão", "Visto", ""], D.devices.filter(match).map((d) => [esc(d.email), esc(d.label || ""), esc(d.app_version || ""), dtt(d.last_seen),
        d.revoked_at ? `<span class="st st-canceled">Removido</span>` : `<button class="btn small quiet" data-rd="${d.id}">Remover</button>`]), true)}</div>`,
      precos: () => `<div class="panel">${table(["Plano", "Período", "Nome", "Valor (R$)", "Ativo", ""], D.prices.map((p) => [PLAN_NAME[p.plan_code], p.period === "year" ? "Anual" : "Mensal", esc(p.label || "Padrão"),
        `<input class="adm-num" data-pv="${p.id}" type="number" step="0.01" min="0" value="${(p.amount_cents / 100).toFixed(2)}">`,
        `<input type="checkbox" data-pa="${p.id}" ${p.active ? "checked" : ""}>`, `<button class="btn small" data-ps="${p.id}">Salvar</button>`]), true)}
        <p class="sub">Mudar o preço aqui vale para novas assinaturas. Quem já assina continua pagando o valor combinado no Asaas.</p></div>`,
      log: () => `<div class="panel">${table(["Quando", "Ação", "Alvo", "Detalhes"], D.log.map((l) => [dtt(l.created_at), esc(l.action), esc(l.target || ""), `<small class="sub">${esc(JSON.stringify(l.data || {}))}</small>`]), true)}</div>`,
    }[tab]();
    view.innerHTML = `<section class="sect"><div class="wrap adm">
      <span class="eyebrow">Administração</span>
      <div class="adm-bar"><div class="tabs">${ADM_TABS.map(([k, t]) => `<button class="btn small ${tab === k ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>
        <input id="admQ" type="search" placeholder="Buscar…" value="${esc(q)}"></div>
      ${body}</div></section>`;
    bind();
  };
  const table = (head, rows, raw) => rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="sub">Nada por aqui.</p>`;
  const reload = async () => { D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; draw(); };
  const act = async (fn) => { try { await fn(); await reload(); } catch (e) { alert(e.message); } };
  function bind() {
    view.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
    const sq = $("#admQ"); if (sq) { sq.oninput = (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const n = $("#admQ"); n.focus(); n.setSelectionRange(pos, pos); }; }
    view.querySelectorAll("[data-ext]").forEach((b) => b.onclick = () => act(() => {
      const base = b.dataset.end && new Date(b.dataset.end) > new Date() ? new Date(b.dataset.end) : new Date();
      base.setDate(base.getDate() + 30);
      return rpc("admin_set_subscription", { p_id: b.dataset.ext, p_status: "active", p_period_end: base.toISOString() });
    }));
    view.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = () => confirm("Cancelar esta assinatura agora?") && act(() => rpc("admin_set_subscription", { p_id: b.dataset.cancel, p_status: "canceled", p_period_end: new Date().toISOString() })));
    const g = $("#gGo"); if (g) g.onclick = () => act(() => rpc("admin_grant", { p_email: $("#gMail").value, p_plan: $("#gPlan").value, p_days: $("#gDays").value ? +$("#gDays").value : null, p_reason: $("#gWhy").value || null }));
    view.querySelectorAll("[data-rg]").forEach((b) => b.onclick = () => act(() => rpc("admin_revoke_grant", { p_id: b.dataset.rg })));
    view.querySelectorAll("[data-xt]").forEach((b) => b.onclick = () => act(() => rpc("admin_extend_trial", { p_email: b.dataset.xt, p_days: 7 })));
    view.querySelectorAll("[data-rl]").forEach((b) => b.onclick = () => confirm("Revogar esta chave?") && act(() => rpc("admin_revoke_license", { p_key: b.dataset.rl })));
    view.querySelectorAll("[data-rd]").forEach((b) => b.onclick = () => act(() => rpc("admin_revoke_device", { p_id: b.dataset.rd })));
    view.querySelectorAll("[data-ps]").forEach((b) => b.onclick = () => act(() => rpc("admin_set_price", {
      p_id: b.dataset.ps, p_amount_cents: Math.round(parseFloat($(`[data-pv="${b.dataset.ps}"]`).value) * 100), p_active: $(`[data-pa="${b.dataset.ps}"]`).checked })));
  }
  draw();
}
