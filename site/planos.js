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
const CP_ERR = { invalido: "Código inválido.", expirado: "Esse código expirou.", esgotado: "Esse código já foi usado.", proprio: "Você não pode usar o seu próprio código.",
  plano_diferente: "Esse código não vale para este plano.", use_no_checkout: "Esse é um código de presente: resgate em Minha conta.", ja_usado: "Você já resgatou esse código.", login: "Entre com o Google primeiro." };
(function () { const m = (location.search + location.hash).match(/[?&]ref=([A-Za-z0-9_-]{3,40})/); if (m) store.set("pw.ref", m[1].toUpperCase()); })();   // link de afiliado: ?ref=CODIGO
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
    // com preço Fundador ativo, é ele que o botão cobra: mostramos esse valor e o normal ao lado
    let amount = pl.code === "free" ? "R$ 0" : fund ? brl(fund.amount_cents) : std ? brl(period === "year" ? std.amount_cents / 12 : std.amount_cents) : "—";
    let sub = pl.code === "free" ? "para sempre" : fund ? `por mês${std ? ` · depois ${brl(std.amount_cents)}` : ""}` : period === "year" && std ? `${brl(std.amount_cents)} por ano` : "por mês";
    let btn;
    if (pl.code === "free") btn = `<a class="btn quiet" href="${esc(PITWALL.download)}">Baixar grátis</a>`;
    else if (cur) btn = `<span class="btn quiet" aria-disabled="true">Seu plano atual</span>`;
    else if (!session) btn = `<button class="btn go" data-go="entrar" id="needLogin">Entrar para assinar</button>`;
    else btn = `<button class="btn go" data-buy="${pl.code}" data-price="${(fund || std || {}).id || ""}">${fund ? "Assinar com preço Fundador" : "Assinar"}</button>`;
    return `<article class="plan ${pl.code === "pro" ? "hot" : ""}">
      ${pl.code === "pro" ? `<span class="plan-badge">Mais escolhido</span>` : ""}
      <h2>${esc(pl.name)}</h2><p class="plan-desc">${esc(pl.description)}</p>
      <div class="plan-price"><b>${amount}</b><span>${sub}</span></div>
      ${fund ? `<div class="fundador"><b>Preço Fundador</b>: o valor de hoje não sobe para quem assinar agora.</div>` : ""}
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
    <label>Cupom ou código de afiliado (opcional)<input id="bCoupon" type="text" autocomplete="off" value="${esc(store.get("pw.ref") || "")}" placeholder="ex.: MEUCODIGO"></label>
    <div class="modal-ok" id="bCpHint"></div>
    <div class="modal-err" id="bErr"></div>
    <div class="modal-actions"><button class="btn quiet" id="bCancel">Cancelar</button><button class="btn go" id="bGo">Ir para o pagamento</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  const close = () => $("#buyModal")?.remove();
  $("#bCancel").onclick = close;
  let cpT = null;
  const checkCp = async () => {
    const code = $("#bCoupon").value.trim();
    const h = $("#bCpHint"); h.className = "modal-ok"; h.textContent = "";
    if (!code) return;
    try {
      const r = await rpc("check_coupon", { p_code: code, p_plan: plan });
      if (!r.ok) { h.className = "modal-err"; h.textContent = CP_ERR[r.error] || "Código inválido."; return; }
      if (r.kind === "grant") { h.className = "modal-err"; h.textContent = CP_ERR.use_no_checkout; return; }
      h.textContent = `✓ ${r.percent_off}% de desconto ${r.duration === "forever" ? "em todas as cobranças" : "no primeiro pagamento"}.`;
    } catch (e) { /* segue sem mostrar */ }
  };
  $("#bCoupon").addEventListener("input", () => { clearTimeout(cpT); cpT = setTimeout(checkCp, 350); });
  checkCp();
  $("#bGo").onclick = async () => {
    const name = $("#bName").value.trim(), doc = $("#bDoc").value.replace(/\D/g, "");
    $("#bErr").textContent = "";
    $("#bGo").disabled = true; $("#bGo").textContent = "Gerando cobrança…";
    try {
      const { data: s } = await sb.auth.getSession();
      const r = await fetch(`${PITWALL.url}/functions/v1/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session.access_token}`, apikey: PITWALL.key },
        body: JSON.stringify({ plan, price_id: priceId || undefined, name, doc, coupon: $("#bCoupon").value.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        if (j.error === "cupom") throw new Error(CP_ERR[j.reason] || "Cupom inválido.");
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
  // voltou do pagamento: espera o aviso do Asaas chegar e libera o plano na tela sozinho
  if (/[?&]pago=1/.test(location.hash) && a.plan === "free" && !(window._pagoTries > 12)) {
    window._pagoTries = (window._pagoTries || 0) + 1;
    view.innerHTML = `<section class="sect"><div class="wrap acct"><span class="eyebrow">Pagamento</span><h1 class="plans-h">Recebemos o seu pagamento!</h1>
      <p class="lede">Estamos liberando o seu plano, leva alguns segundos…</p></div></section>`;
    setTimeout(() => { if (location.hash.startsWith("#/conta")) renderAccount(); }, 2500);
    return;
  }
  if (/[?&]pago=1/.test(location.hash)) { window._pagoTries = 0; history.replaceState(null, "", "#/conta"); }
  const paid = a.plan !== "free";
  // a validade mostrada é a do que foi pago (o sistema dá 3 dias de tolerância por trás, sem aparecer)
  if (a.source === "subscription" && a.ends_at) a.ends_at = new Date(new Date(a.ends_at).getTime() - 3 * 86400000).toISOString();
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
        <div class="panel"><h2>Tenho um código</h2>
          <p class="sub">Ganhou um código de presente (sorteio, parceiro)? Resgate aqui e o plano é liberado na hora.</p>
          <div class="adm-form"><input id="rdCode" type="text" placeholder="PW-XXXXXXXX" autocomplete="off"><button class="btn go small" id="rdGo">Resgatar</button></div>
          <div class="modal-err" id="rdMsg"></div>
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
  $("#rdGo").onclick = async () => {
    const m = $("#rdMsg"); m.style.color = ""; m.textContent = "";
    try {
      const r = await rpc("redeem_code", { p_code: $("#rdCode").value });
      if (!r.ok) { m.textContent = CP_ERR[r.error] || "Não foi possível resgatar."; return; }
      alert(`Pronto! Você ganhou o plano ${PLAN_NAME[r.plan] || r.plan} por ${r.days} dias. Abra o Pitwall e entre com este e-mail do Google para liberar.`);
      renderAccount();
    } catch (e) { m.textContent = e.message; }
  };
  const t = $("#aTrial"); if (t) t.onclick = startTrialSite;
  const c = $("#copyKey"); if (c) c.onclick = async () => { await navigator.clipboard.writeText(a.license_key); c.textContent = "Copiado!"; };
  view.querySelectorAll("[data-rmdev]").forEach((b) => b.onclick = async () => { await rpc("revoke_my_device", { p_id: b.dataset.rmdev }); renderAccount(); });
}

// ---------------------------------------------------------------- painel do administrador
const ADM_TABS = [["geral", "Visão geral"], ["usuarios", "Usuários e versões"], ["assinaturas", "Assinaturas"], ["pagamentos", "Pagamentos"], ["afiliados", "Afiliados"], ["codigos", "Códigos e cupons"], ["comissoes", "Comissões"], ["cortesias", "Cortesias"],
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
  let D, U = [], LATEST = null, AF = { affiliates: [], coupons: [], commissions: [], redemptions: [] }, NEWCODES = "";
  try { D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; AF = (await rpc("admin_affiliates")) || AF; LATEST = await latestVersion(); } catch (e) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">${esc(e.message)}</div></div></section>`; return; }
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
      afiliados: () => `<div class="panel"><h2>Novo afiliado</h2>
        <div class="adm-form"><input id="afName" type="text" placeholder="nome"><input id="afMail" type="email" placeholder="e-mail do afiliado (evita comissão de si mesmo)">
          <input id="afCode" type="text" placeholder="código (ex.: JOAO10)"><input id="afPix" type="text" placeholder="chave Pix para pagar a comissão"></div>
        <div class="adm-form"><label class="sub">Desconto <input id="afDisc" class="adm-num" type="number" min="0" max="100" value="10">%</label>
          <select id="afDur"><option value="once">só no primeiro pagamento</option><option value="forever">em todas as cobranças</option></select>
          <label class="sub">Comissão <input id="afCom" class="adm-num" type="number" min="0" max="100" value="20">%</label>
          <select id="afMode"><option value="recurring">todo mês enquanto assinar</option><option value="first">só no primeiro pagamento</option></select>
          <button class="btn go small" id="afGo">Criar afiliado</button></div>
        <p class="sub">O link de divulgação é <code>${esc(location.origin)}/?ref=CODIGO</code>: o código já vem preenchido na hora de assinar.</p></div>
        <div class="panel">${table(["Afiliado", "Código e link", "Condições", "Clientes", "A receber", "Pago", ""], AF.affiliates.filter(match).map((a) => [
          `${esc(a.name)}<br><small class="sub">${esc(a.email || "")}</small><br><small class="sub">Pix: ${esc(a.pix_key || "—")}</small>`,
          `<code>${esc(a.code)}</code> <button class="btn small quiet" data-cl="${esc(location.origin)}/?ref=${esc(a.code)}">copiar link</button>`,
          `${a.discount_pct}% ${a.discount_duration === "forever" ? "sempre" : "no 1º mês"}<br>${a.commission_pct}% ${a.commission_mode === "first" ? "no 1º pagamento" : "todo mês"}`,
          `${a.clients_active} ativos / ${a.clients_total}`,
          `${brl(a.cents_approved)} <small class="sub">aprovada</small><br>${brl(a.cents_pending)} <small class="sub">em espera (7 dias)</small>`, brl(a.cents_paid),
          a.active ? `<button class="btn small quiet" data-af="${a.id}" data-act="0">Pausar</button>` : `<button class="btn small quiet" data-af="${a.id}" data-act="1">Ativar</button>`]), true)}</div>`,
      codigos: () => `<div class="panel"><h2>Gerar códigos de presente (sorteios)</h2>
        <div class="adm-form"><label class="sub">Quantidade <input id="gcQtd" class="adm-num" type="number" min="1" max="500" value="10"></label>
          <select id="gcPlan"><option value="pro">Pro</option><option value="team">Equipe</option></select>
          <label class="sub">dá <input id="gcDias" class="adm-num" type="number" min="1" value="30"> dias</label>
          <label class="sub">resgatar em até <input id="gcVal" class="adm-num" type="number" min="1" value="90"> dias</label>
          <input id="gcNote" type="text" placeholder="anotação (ex.: sorteio do Instagram)"><button class="btn go small" id="gcGo">Gerar</button></div>
        ${NEWCODES ? `<textarea id="gcOut" class="adm-codes" readonly rows="6">${esc(NEWCODES)}</textarea><button class="btn small" id="gcCopy">Copiar todos</button>` : ""}
        <p class="sub">Cada código vale para uma pessoa só. Ela resgata em <b>Minha conta</b> no site ou no menu <b>Plano</b> do app.</p></div>
        <div class="panel"><h2>Criar cupom ou código avulso</h2>
        <div class="adm-form"><input id="ccCode" type="text" placeholder="código (vazio = gera um)"><select id="ccKind"><option value="discount">Desconto no checkout</option><option value="grant">Presente (dá dias de plano)</option></select>
          <label class="sub">% <input id="ccPct" class="adm-num" type="number" min="1" max="100" value="15"></label>
          <select id="ccDur"><option value="once">só no 1º pagamento</option><option value="forever">em todas as cobranças</option></select>
          <select id="ccPlan"><option value="">todos os planos</option><option value="pro">Pro</option><option value="team">Equipe</option></select>
          <label class="sub">dias <input id="ccDias" class="adm-num" type="number" min="1" value="30"></label>
          <label class="sub">usos <input id="ccUsos" class="adm-num" type="number" min="1" placeholder="sem limite"></label>
          <label class="sub">vale por <input id="ccVal" class="adm-num" type="number" min="1" placeholder="sempre"> dias</label>
          <button class="btn go small" id="ccGo">Criar</button></div></div>
        <div class="panel"><h2>Códigos e cupons</h2>${table(["Código", "Tipo", "Regra", "Usos", "Vale até", "Anotação", ""], AF.coupons.filter(match).map((c) => [`<code>${esc(c.code)}</code>`,
          c.kind === "grant" ? "Presente" : "Desconto", c.kind === "grant" ? `${c.grant_days} dias de ${PLAN_NAME[c.plan_code] || c.plan_code}` : `${c.percent_off}% ${c.duration === "forever" ? "sempre" : "no 1º mês"}${c.plan_code ? " · " + PLAN_NAME[c.plan_code] : ""}`,
          `${c.uses}${c.max_uses ? "/" + c.max_uses : ""}`, c.expires_at ? dt(c.expires_at) : "sem prazo", `<small class="sub">${esc(c.note || "")}${c.batch ? " · lote " + esc(c.batch) : ""}</small>`,
          c.active ? `<button class="btn small quiet" data-ca="${esc(c.code)}" data-act="0">Desativar</button>` : `<button class="btn small quiet" data-ca="${esc(c.code)}" data-act="1">Ativar</button>`]), true)}</div>`,
      comissoes: () => { const sum = (f) => AF.commissions.filter(f).reduce((n, c) => n + c.amount_cents, 0);
        return `<div class="kpis">${[["A pagar (aprovadas)", brl(sum((c) => c.status === "pending" && c.approved))], ["Em espera (7 dias)", brl(sum((c) => c.status === "pending" && !c.approved))], ["Já pagas", brl(sum((c) => c.status === "paid"))]]
          .map(([t, v]) => `<div class="kpi"><small>${t}</small><b>${v}</b></div>`).join("")}</div>
        <div class="panel">${table(["Data", "Afiliado", "Cliente", "Base", "%", "Comissão", "Status", ""], AF.commissions.filter(match).map((c) => [dt(c.created_at),
          `${esc(c.affiliate_name)}<br><small class="sub">Pix: ${esc(c.pix_key || "—")}</small>`, esc(c.client_email || ""), brl(c.base_cents), c.pct + "%", `<b>${brl(c.amount_cents)}</b>`,
          c.status === "paid" ? `<span class="st st-active">Paga em ${dt(c.paid_at)}</span>` : c.status === "canceled" ? `<span class="st st-canceled">Cancelada</span> <small class="sub">${esc(c.note || "")}</small>`
            : c.approved ? `<span class="st st-active">Aprovada</span>` : `<span class="st st-pending">Em espera até ${dt(c.approve_at)}</span>`,
          c.status === "pending" ? (c.approved ? `<button class="btn small" data-cm="${c.id}" data-st="paid">Marcar como paga</button> ` : "") + `<button class="btn small quiet" data-cm="${c.id}" data-st="canceled">Cancelar</button>` : ""]), true)}
        <p class="sub">A comissão é calculada sobre o valor realmente pago (já com o desconto do cliente), sem descontar a taxa do Asaas. Reembolso cancela a comissão. Você paga o afiliado por Pix e marca aqui como paga.</p></div>`; },
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
  const reload = async () => { D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; AF = (await rpc("admin_affiliates")) || AF; draw(); };
  const act = async (fn) => { try { await fn(); await reload(); } catch (e) { alert(e.message); } };
  function bind() {
    view.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
    const sq = $("#admQ"); if (sq) { sq.oninput = (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const n = $("#admQ"); n.focus(); n.setSelectionRange(pos, pos); }; }
    view.querySelectorAll("[data-cl]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.cl); b.textContent = "copiado!"; });
    const af = $("#afGo"); if (af) af.onclick = () => act(() => rpc("admin_create_affiliate", { p_name: $("#afName").value, p_email: $("#afMail").value, p_code: $("#afCode").value,
      p_discount_pct: +$("#afDisc").value, p_discount_duration: $("#afDur").value, p_commission_pct: +$("#afCom").value, p_commission_mode: $("#afMode").value, p_pix: $("#afPix").value }));
    view.querySelectorAll("[data-af]").forEach((b) => b.onclick = () => { const a = AF.affiliates.find((x) => x.id === b.dataset.af);
      act(() => rpc("admin_update_affiliate", { p_id: a.id, p_active: b.dataset.act === "1", p_discount_pct: a.discount_pct, p_discount_duration: a.discount_duration, p_commission_pct: a.commission_pct, p_commission_mode: a.commission_mode, p_pix: a.pix_key })); });
    const gc = $("#gcGo"); if (gc) gc.onclick = async () => { try {
      const list = await rpc("admin_generate_codes", { p_count: +$("#gcQtd").value, p_plan: $("#gcPlan").value, p_grant_days: +$("#gcDias").value, p_valid_days: +$("#gcVal").value, p_note: $("#gcNote").value || null });
      NEWCODES = (list || []).join("\n"); await reload(); } catch (e) { alert(e.message); } };
    const gcc = $("#gcCopy"); if (gcc) gcc.onclick = async () => { await navigator.clipboard.writeText(NEWCODES); gcc.textContent = "Copiado!"; };
    const cc = $("#ccGo"); if (cc) cc.onclick = () => act(() => rpc("admin_create_coupon", { p_code: $("#ccCode").value, p_kind: $("#ccKind").value, p_percent_off: +$("#ccPct").value, p_duration: $("#ccDur").value,
      p_plan: $("#ccPlan").value, p_grant_days: +$("#ccDias").value, p_max_uses: $("#ccUsos").value ? +$("#ccUsos").value : null, p_valid_days: $("#ccVal").value ? +$("#ccVal").value : null, p_note: null }));
    view.querySelectorAll("[data-ca]").forEach((b) => b.onclick = () => act(() => rpc("admin_set_coupon_active", { p_code: b.dataset.ca, p_active: b.dataset.act === "1" })));
    view.querySelectorAll("[data-cm]").forEach((b) => b.onclick = () => (b.dataset.st !== "canceled" || confirm("Cancelar esta comissão?")) && act(() => rpc("admin_set_commission", { p_id: b.dataset.cm, p_status: b.dataset.st })));
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
