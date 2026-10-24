/* Pitwall · planos, minha conta e painel do administrador.
   Usa os helpers do app.js ($, view, sb, esc, session, rpc) e as funções do Supabase
   (planos/preços públicos, my_account, start_trial, admin_*, e as funções de borda "checkout" e "license"). */
"use strict";

let TRIAL_DAYS = 10;
async function loadTrialDays() { try { const d = await rpc("trial_days"); if (d > 0) TRIAL_DAYS = d; } catch (e) { /* mantém */ } }
let isAffiliate = false, isAdmin = false, myPlan = { plan: "free", features: [] };

async function loadAccountFlags() {
  loadTrialDays();
  isAdmin = false; isAffiliate = false; myPlan = { plan: "free", features: [] };
  if (!session) { window.PITWALL_NO_ADS = false; return; }
  try { isAdmin = !!(await rpc("is_admin")); } catch (e) { /* ok */ }
  try { myPlan = (await rpc("my_account")) || myPlan; } catch (e) { /* ok */ }
  try { isAffiliate = !!(await rpc("my_affiliate")); } catch (e) { /* ok */ }
  window.PITWALL_NO_ADS = (myPlan.features || []).includes("no_ads");
}

// ---------------------------------------------------------------- comparativo de preços (mensal x anual, Pro x Equipe)
// std = preço padrão (sem rótulo), fund = preço Fundador. Devolve valores em centavos e os descontos reais.
function priceStats(prices) {
  const pick = (code, per, f) => (prices || []).filter((p) => p.active !== false && p.plan_code === code && p.period === per && (f ? p.label : !p.label))[0];
  const out = {};
  for (const code of ["pro", "team"]) {
    const m = pick(code, "month"), y = pick(code, "year"), fm = pick(code, "month", true);
    const mc = m && m.amount_cents, yc = y && y.amount_cents, fc = fm && fm.amount_cents;
    const year12 = mc ? mc * 12 : null;
    out[code] = { m: mc, y: yc, f: fc, year12, saveC: mc && yc ? year12 - yc : null, savePct: mc && yc ? Math.round((1 - yc / year12) * 1000) / 10 : null, yMonth: yc ? yc / 12 : null };
  }
  const P = out.pro, T = out.team, PEOPLE = 10;                                   // o plano Equipe vale Pro para 10 pessoas: o dono + 9 chaves
  const bundle = (pc, tc) => (pc && tc ? { all: pc * PEOPLE, save: pc * PEOPLE - tc, pct: Math.round((1 - tc / (pc * PEOPLE)) * 100), per: tc / PEOPLE, min: Math.ceil(tc / pc) } : null);
  out.people = PEOPLE; out.bm = bundle(P.m, T.m); out.by = bundle(P.y, T.y);
  out.diff = { m: P.m && T.m ? T.m - P.m : null, y: P.y && T.y ? T.y - P.y : null,
    mPct: P.m && T.m ? Math.round((T.m / P.m - 1) * 100) : null, yPct: P.y && T.y ? Math.round((T.y / P.y - 1) * 100) : null };
  return out;
}
const pctTxt = (n) => (n == null ? "—" : String(n).replace(".", ",") + "%");

const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const dtt = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const days = (iso) => iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null;
const PLAN_NAME = { free: "Grátis", pro: "Pro", team: "Equipe" };
const SRC_NAME = { subscription: "Assinatura", grant: "Cortesia", trial: "Teste grátis", team: "Chave da equipe", free: "" };
const STATUS_NAME = { active: "Ativa", pending: "Aguardando pagamento", past_due: "Atrasada", canceled: "Cancelada", expired: "Expirada",
  paid: "Pago", overdue: "Vencido", refunded: "Reembolsado", failed: "Falhou" };
const FEATURE_NAME = { voice_basic: "Engenheiro de voz básico", voice_full: "Engenheiro de voz completo", voice_online: "Voz online",
  voice_personality: "Personalidade do engenheiro", spotter: "Observador (carros ao lado)", video_unlimited: "Vídeos sem limite",
  setups_unlimited: "Setups sem limite", team_multi: "Várias equipes", no_ads: "Sem anúncios", team_admin: "Painel da equipe",
  overlay_styles: "Overlays completos", overlay_styles_team: "Modelos de transmissão (overlay)", team_seats: "Pro para a equipe (chaves)" };
const CP_ERR = { ja_tem_chave: "Você já usa uma chave de equipe.", ja_pago: "Você já tem um plano pago.", sem_plano: "Você precisa do plano Equipe ativo.", limite: "Você já criou todas as chaves. Revogue uma para criar outra.", invalido: "Código inválido.", expirado: "Esse código expirou.", esgotado: "Esse código já foi usado.", proprio: "Você não pode usar o seu próprio código.",
  plano_diferente: "Esse código não vale para este plano.", so_novos: "O desconto do link de indicação vale só para quem ainda não assinou.", use_no_checkout: "Esse é um código de presente: resgate em Minha conta.", ja_usado: "Você já resgatou esse código.", login: "Entre com o Google primeiro." };
// código de afiliado do link (?ref=): só aparece/vem preenchido nos planos nesta visita (aba aberta pelo link); digitar o código no checkout vale sempre
const getRef = () => { try { return sessionStorage.getItem("pw.refview") || ""; } catch (e) { return ""; } };
(function () { const m = (location.search + location.hash).match(/[?&]ref=([A-Za-z0-9_-]{3,40})/); if (m) { const c = m[1].toUpperCase(); store.set("pw.ref", c); try { sessionStorage.setItem("pw.refview", c); } catch (e) { /* ok */ } } })();   // link de afiliado: ?ref=CODIGO
const loginGoogle = (back) => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname + (back || "") } });

// ---------------------------------------------------------------- planos (público)
async function renderPlans() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  await loadTrialDays();
  const [{ data: plans }, { data: prices }] = await Promise.all([
    sb.from("plans").select("*").order("sort"), sb.from("prices").select("*").eq("active", true)]);
  let period = store.get("pw.period") === "year" ? "year" : "month";
  const ST = priceStats(prices);
  // descontos que a pessoa já tem: o código do link/afiliado (guardado em ?ref=) e o acumulado das indicações dela
  const refCode = getRef(), cpOff = {}, cpDur = {};
  let rwPct = 0, myRefCode = "";
  if (session) { try { const r = await rpc("my_referral"); if (r && r.ok) { rwPct = r.pct || 0; myRefCode = r.code; } } catch (e) { /* ok */ } }
  if (refCode && refCode !== myRefCode) {
    for (const p of ["pro", "team"]) {
      try {
        const r = session ? await rpc("check_coupon", { p_code: refCode, p_plan: p }) : await rpc("coupon_preview", { p_code: refCode });
        if (r && (session ? r.ok && r.kind === "discount" : r.plan == null || r.plan === p)) { cpOff[p] = r.percent_off || 0; cpDur[p] = r.duration; }
      } catch (e) { /* ok */ }
    }
  }
  const price = (code, per, fundador) => (prices || []).filter((p) => p.plan_code === code && p.period === per && (fundador ? p.label : !p.label))[0];
  const draw = () => {
    store.set("pw.period", period);
    view.innerHTML = `
      <section class="sect"><div class="wrap plans">
        <span class="eyebrow">Planos</span>
        <h1 class="plans-h">Comece de graça. Assine quando quiser mais.</h1>
        ${refCode && refCode !== myRefCode ? `<div class="cmp good ref-chip">Código <b>${esc(refCode)}</b> aplicado pelo link que você abriu. <button class="btn small quiet" id="refOff">Remover</button></div>` : ""}
        <p class="lede">Gravar, analisar e comparar as suas voltas é grátis. O Pro libera o engenheiro de voz completo e tira os anúncios.</p>
        <div class="period"><button class="btn small ${period === "month" ? "on" : ""}" data-per="month">Mensal</button>
          <button class="btn small ${period === "year" ? "on" : ""}" data-per="year">Anual${ST.pro.savePct > 0 ? ` <em>economize ${Math.round(ST.pro.savePct)}%</em>` : ""}</button></div>
        <div class="plan-grid">${(plans || []).map((pl) => planCard(pl)).join("")}</div>
        <p class="plans-note">Pagamento por Pix, cartão ou boleto, com renovação automática. Cancele quando quiser. Emitimos nota fiscal. O teste grátis de ${TRIAL_DAYS} dias não pede cartão.</p>
      </div></section>`;
    view.querySelectorAll("[data-per]").forEach((b) => b.onclick = () => { period = b.dataset.per; draw(); });
    const ro = $("#refOff"); if (ro) ro.onclick = () => { try { sessionStorage.removeItem("pw.refview"); } catch (e) { /* ok */ } toast("Código removido", "ok"); renderPlans(); };
    view.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => buy(b.dataset.buy, b.dataset.price, +b.dataset.base, b.dataset.per));
    view.querySelectorAll("[data-trial]").forEach((b) => b.onclick = () => startTrialSite(b.dataset.trial));
  };
  const planCard = (pl) => {
    const std = price(pl.code, period), fund = pl.code === "pro" && period === "month" ? price("pro", "month", true) : null;
    const cur = myPlan.plan === pl.code;
    const LISTS = {
      free: ["Gravar, analisar e comparar voltas", "Replay e overlays básicos no jogo (mapa simples, pedais, delta, pneus e curva enxutos)", "Engenheiro de voz: avisos e perguntas básicas", "Compare com amigos em 1 equipe", "Vídeos das últimas 5 sessões"],
      pro: ["Tudo do plano Grátis, e mais:", "Engenheiro de voz completo (pneus, freios, rivais, clima, box) e totalmente personalizável", "Voz online, mais natural", "Personalidade: humor, elogio e bronca", "Observador: carros ao lado, três de lado, livre", "Vídeos e setups sem limite", "Personalização completa de todos os overlays", "Todos os modelos dos overlays: pedais com gráfico e painel do piloto, delta completo e em barra larga, participantes completo e em torre, pneus como no ACC e em faixa, curva completa, mapa com asfalto, radar (de cima, circular e halo) com carrinhos por classe", "Gerador de setup: recomendações a partir das suas voltas e criação de versões", "Editor visual 3D do setup: ajuste clicando nas partes do carro e veja a suspensão em raio-x", "Setups da equipe: baixe o setup do melhor tempo dos companheiros e compartilhe os seus", "Várias equipes", "Sem anúncios no site"],
      team: ["Tudo do plano Pro, e mais:", "Pro para 10 pessoas: o seu e mais 9 chaves para dividir com a equipe. Todas vencem junto com o seu plano (quem ativar mais tarde não ganha dias a mais)", "Você gerencia as chaves na sua conta: pode revogar uma e passar para outra pessoa", "Até 3 computadores por licença"],
    };
    const feats = (LISTS[pl.code] || (pl.features || []).map((f) => FEATURE_NAME[f] || f)).map((t, i) => `<li${i === 0 && /^Tudo do/.test(t) ? ' class="all"' : ""}>${esc(t)}</li>`).join("");
    // com preço Fundador ativo, é ele que o botão cobra: mostramos esse valor e o normal ao lado
    let amount = pl.code === "free" ? "R$ 0" : fund ? brl(fund.amount_cents) : std ? brl(period === "year" ? std.amount_cents / 12 : std.amount_cents) : "—";
    let sub = pl.code === "free" ? "para sempre" : fund ? `por mês${std ? ` · depois ${brl(std.amount_cents)}` : ""}` : period === "year" && std ? `${brl(std.amount_cents)} por ano` : "por mês";
    // desconto: preço normal riscado e o valor com desconto, com quanto a pessoa economiza
    let was = "", discTxt = "";
    const cpP = cpOff[pl.code] || 0, offPct = pl.code === "free" || cur ? 0 : Math.min(60, cpP + rwPct), baseC = fund ? fund.amount_cents : std ? (period === "year" ? std.amount_cents / 12 : std.amount_cents) : 0;
    if (offPct > 0 && baseC) {
      was = `<s class="was">${brl(baseC)}</s>`;
      amount = brl(Math.max(500 / (period === "year" ? 12 : 1), Math.round(baseC * (100 - offPct) / 100)));
      const parts = [];
      if (cpP) parts.push(`${cpP}% com o código ${esc(refCode)}${cpDur[pl.code] === "forever" ? "" : " no 1º pagamento"}`);
      if (rwPct) parts.push(`${rwPct}% das suas indicações (próxima assinatura)`);
      discTxt = `<div class="disc-badge"><b>−${offPct}%</b> ${parts.join(" + ")}</div>`;
    }
    // comparativos reais: anual x mensal e Equipe x Pro
    let cmpTxt = "";
    const sPl = ST[pl.code];
    if (sPl && sPl.m && sPl.y) {
      if (sPl.saveC > 0 && period === "year") cmpTxt += `<div class="cmp good">Anual: <b>−${pctTxt(sPl.savePct)}</b> em relação a pagar 12 meses no mensal (${brl(sPl.year12)}) · você economiza ${brl(sPl.saveC)}</div>`;      // só aparece quando o Anual está selecionado
    }
    if (pl.code === "team" && ST.bm && ST.by) {
      const yr = period === "year", bd = yr ? ST.by : ST.bm, own = yr ? ST.team.y : ST.team.m, un = yr ? "ano" : "mês";
      cmpTxt += `<div class="team-box">
        <div class="tb-head">👥 Pro para <b>${ST.people} pessoas</b> <small>você + ${ST.people - 1} convidados</small></div>
        <div class="tb-per"><b>${brl(Math.round(bd.per))}</b> por pessoa / ${un}</div>
        <div class="tb-cmp">Cada um assinando o Pro separado: <s>${brl(bd.all)}</s> por ${un}.<br>Com o Equipe você paga ${brl(own)}: <b>economiza ${brl(bd.save)} (${bd.pct}%)</b>.</div>
        <div class="tb-foot">Já compensa a partir de <b>${bd.min} pessoas</b>. Todas as vagas vencem junto com o seu plano.</div></div>`;
    }
    let btn;
    if (pl.code === "free") btn = `<a class="btn quiet" href="${esc(PITWALL.download)}">Baixar grátis</a>`;
    else if (cur) btn = `<span class="btn quiet" aria-disabled="true">Seu plano atual</span>`;
    else if (!session) btn = `<button class="btn go" data-go="entrar" id="needLogin">Entrar para assinar</button>`;
    else btn = `<button class="btn go" data-buy="${pl.code}" data-price="${(fund || std || {}).id || ""}" data-base="${(fund || std || {}).amount_cents || 0}" data-per="${period}">${fund ? "Assinar com preço Fundador" : "Assinar"}</button>`;
    return `<article class="plan ${pl.code === "pro" ? "hot" : ""}">
      ${pl.code === "pro" ? `<span class="plan-badge">Mais escolhido</span>` : ""}
      <h2>${esc(pl.name)}</h2><p class="plan-desc">${esc(pl.description)}</p>
      <div class="plan-price">${was}<b>${amount}</b><span>${sub}</span></div>${discTxt}${cmpTxt}
      ${fund ? `<div class="fundador"><b>Preço Fundador</b>: o valor de hoje não sobe para quem assinar agora.</div>` : ""}
      <ul>${feats}</ul>
      ${btn}
      ${pl.code === "pro" && !cur && myPlan.plan === "free" ? `<button class="btn quiet small" data-trial="pro">Testar o Pro por ${TRIAL_DAYS} dias grátis</button>` : ""}
    </article>`;
  };
  draw();
  const nl = $("#needLogin");
  if (nl) nl.onclick = (e) => { e.preventDefault(); loginGoogle("#/planos"); };
}

async function startTrialSite(plan) {
  plan = plan === "team" ? "team" : "pro";
  if (!session) return loginGoogle("#/planos");
  try {
    const r = await rpc("start_trial", { p_device: null, p_plan: plan });
    if (!r.ok) {
      alert({ trial_used: "O teste grátis já foi usado neste e-mail.", already_paid: "Você já tem um plano pago.", login: "Entre com o Google." }[r.error] || "Não foi possível começar o teste.");
      return;
    }
    await loadAccountFlags();
    alert(`Teste grátis ativado por ${r.days || TRIAL_DAYS} dias! Abra o Pitwall e entre com o mesmo e-mail do Google (menu Plano) para liberar os recursos.`);
    location.hash = "#/conta";
  } catch (e) { alert(e.message); }
}

async function buy(plan, priceId, baseCents, per) {
  let rwBuy = 0;
  try { const r = await rpc("my_referral"); if (r && r.ok) rwBuy = r.pct || 0; } catch (e) { /* ok */ }
  const html = `<div class="modal" id="buyModal"><div class="modal-box">
    <h2>Assinar o plano ${esc(PLAN_NAME[plan] || plan)}</h2>
    <p class="sub">Precisamos do nome e do CPF ou CNPJ para emitir a cobrança e a nota fiscal. O acesso é liberado no e-mail <b>${pii(session.user.email, "email")}</b>.</p>
    <label>Nome completo ou razão social<input id="bName" type="text" autocomplete="name" value="${esc((profile && profile.name) || "")}"></label>
    <label>CPF ou CNPJ<input id="bDoc" type="text" inputmode="numeric" autocomplete="off" placeholder="somente números"></label>
    <label>Cupom ou código de afiliado (opcional)<input id="bCoupon" type="text" autocomplete="off" value="${esc(getRef())}" placeholder="ex.: MEUCODIGO"></label>
    <div class="modal-ok" id="bCpHint"></div>
    <div class="buy-price" id="bPrice"></div>
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
    // resumo do valor da primeira cobrança: preço normal riscado, o que a pessoa economiza e o total
    const showPrice = (cpPct, cpTxt) => {
      const total = Math.min(60, (cpPct || 0) + rwBuy), pr = $("#bPrice");
      if (!pr || !baseCents) return;
      const final = total > 0 ? Math.max(500, Math.round(baseCents * (100 - total) / 100)) : baseCents;
      pr.innerHTML = total > 0 ? `<div class="bp-row"><span>${per === "year" ? "Plano anual" : "Plano mensal"}</span><s class="was">${brl(baseCents)}</s></div>
        ${cpPct ? `<div class="bp-row sub"><span>${cpTxt}</span><b>−${cpPct}%</b></div>` : ""}${rwBuy ? `<div class="bp-row sub"><span>Desconto das suas indicações</span><b>−${rwBuy}%</b></div>` : ""}
        <div class="bp-row tot"><span>Primeiro pagamento</span><b>${brl(final)}</b></div><div class="sub">Você economiza ${brl(baseCents - final)} (−${total}%).</div>` : `<div class="bp-row tot"><span>Primeiro pagamento</span><b>${brl(baseCents)}</b></div>`;
    };
    if (!code) { showPrice(0); return; }
    try {
      const r = await rpc("check_coupon", { p_code: code, p_plan: plan });
      if (!r.ok) { h.className = "modal-err"; h.textContent = CP_ERR[r.error] || "Código inválido."; showPrice(0); return; }
      if (r.kind === "grant") { h.className = "modal-err"; h.textContent = CP_ERR.use_no_checkout; return; }
      h.textContent = `✓ ${r.percent_off}% de desconto ${r.duration === "forever" ? "em todas as cobranças" : "no primeiro pagamento"}.`;
      showPrice(r.percent_off, `Código ${code.toUpperCase()}`);
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
      try { sessionStorage.removeItem("pw.refview"); } catch (e) { /* ok */ } location.href = j.url;
    } catch (e) {
      $("#bErr").textContent = e.message;
      $("#bGo").disabled = false; $("#bGo").textContent = "Ir para o pagamento";
    }
  };
}

// ---------------------------------------------------------------- minha conta
// chaves do plano Equipe: o dono divide com a equipe; todas valem até o fim do plano dele
function seatsPanel(s) {
  if (!s || !s.ok) return "";
  if (!s.is_owner) {
    return s.holder ? `<div class="panel"><h2>Chave da equipe</h2><p>Seu Pro vem da chave de <b>${esc(s.holder.owner)}</b> e vale até <b>${dt(s.holder.ends_at)}</b>, o mesmo prazo do plano dele.</p>
      <p class="sub">O prazo é o mesmo para todos: ativar a chave mais tarde não dá dias a mais.</p></div>` : "";
  }
  const keys = s.keys || [], free = s.capacity - keys.length;
  return `<div class="panel seats"><h2>Vagas da equipe: ${keys.length + 1}/${s.capacity + 1}</h2>
    <p class="sub">O plano Equipe vale Pro para <b>10 pessoas</b>: a sua vaga (você já está dentro) e <b>${s.capacity} chaves</b> para dividir. Cada chave libera o <b>Pro</b> para uma pessoa. <b>Todas vencem junto com o seu plano (${dt(s.ends_at)})</b>: quem ativar no último dia não ganha dias a mais. Para trocar de pessoa, revogue a chave e passe outra.</p>
    ${keys.length ? `<table class="tbl"><tbody>${keys.map((k) => `<tr><td><code>${pii(k.code, "key")}</code></td>
      <td>${k.redeemed_email ? `${pii(k.redeemed_email, "email")}<br><small class="sub">ativada em ${dt(k.redeemed_at)}</small>` : `<span class="sub">livre</span>`}</td>
      <td><button class="btn small quiet" data-seatcopy="${esc(k.code)}">Copiar</button> <button class="btn small quiet" data-seatrev="${k.id}">Revogar</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="sub">Nenhuma chave criada ainda.</p>`}
    <div class="row-actions">${free > 0 ? `<button class="btn go small" id="seatNew">Gerar chave (${free} restante${free === 1 ? "" : "s"})</button>` : `<span class="sub">Todas as chaves foram criadas.</span>`}</div></div>`;
}

async function renderAccount() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  await loadTrialDays();
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
  let seats = null;
  try { seats = await rpc("my_seats"); } catch (e) { /* ok */ }
  view.innerHTML = `
    <section class="sect"><div class="wrap acct">
      <span class="eyebrow">Minha conta</span>
      <h1 class="plans-h">${pii(a.email || "", "email")}</h1>
      <div class="acct-grid">
        <div class="panel"><h2>Plano</h2>
          <div class="plan-chip2 ${paid ? "pro" : ""}">${esc(PLAN_NAME[a.plan] || a.plan)}</div>
          <span class="sub"> ${SRC_NAME[a.source] ? "· " + SRC_NAME[a.source] : ""}</span>
          <p>${paid ? (far ? "Sem data para acabar." : `Válido até <b>${dt(a.ends_at)}</b>${left != null && left <= 10 ? ` (faltam ${left} dia${left === 1 ? "" : "s"})` : ""}.`) : "Você está no plano Grátis."}</p>
          <div class="row-actions">
            ${paid && a.source !== "grant" ? "" : `<a class="btn go small" href="#/planos">${paid ? "Ver planos" : "Assinar o Pro"}</a>`}
            ${!paid && !a.trial ? `<button class="btn small" id="aTrial">Testar o Pro por ${TRIAL_DAYS} dias</button>` : ""}
          </div>
          ${a.trial ? `<p class="sub">Teste grátis: de ${dt(a.trial.started_at)} até ${dt(a.trial.ends_at)}.</p>` : ""}
        </div>
        <div class="panel"><h2>Chave de licença</h2>
          ${a.license_key ? `<code class="lickey" id="licKey">${pii(a.license_key, "key")}</code><button class="btn small quiet" id="copyKey">Copiar</button>
            <p class="sub">No Pitwall: menu <b>Plano</b> &gt; “Tenho uma chave”. Se entrar com o mesmo e-mail do Google, não precisa da chave.</p>`
            : `<p class="sub">A chave aparece aqui quando você tiver um plano pago, uma cortesia ou o teste grátis.</p>`}
        </div>
        ${seatsPanel(seats)}
        <div class="panel"><h2>Tenho um código</h2>
          <p class="sub">Ganhou um código de presente (sorteio, parceiro) ou uma chave de equipe (PWT-…)? Resgate aqui e o plano é liberado na hora.</p>
          <div class="adm-form"><input id="rdCode" type="text" placeholder="PW-… ou PWT-…" autocomplete="off"><button class="btn go small" id="rdGo">Resgatar</button></div>
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
      alert(r.seat ? `Chave da equipe ativada! Você tem o Pro até ${dt(r.ends_at)}, o mesmo prazo do plano de quem te passou a chave. Abra o Pitwall e entre com este e-mail do Google para liberar.`
        : `Pronto! Você ganhou o plano ${PLAN_NAME[r.plan] || r.plan} por ${r.days} dias. Abra o Pitwall e entre com este e-mail do Google para liberar.`);
      renderAccount();
    } catch (e) { m.textContent = e.message; }
  };
  const sn = $("#seatNew"); if (sn) sn.onclick = async () => { const r = await rpc("create_seat_key"); if (!r.ok) alert(CP_ERR[r.error] || "Não foi possível criar a chave."); renderAccount(); };
  view.querySelectorAll("[data-seatcopy]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.seatcopy); b.textContent = "Copiada!"; toast("Chave copiada", "ok"); });
  view.querySelectorAll("[data-seatrev]").forEach((b) => b.onclick = async () => {
    if (!confirm("Revogar esta chave? Quem a usa perde o Pro agora, e você pode passar uma chave nova para outra pessoa.")) return;
    await rpc("revoke_seat_key", { p_id: b.dataset.seatrev }); renderAccount();
  });
  const t = $("#aTrial"); if (t) t.onclick = () => startTrialSite("pro");
  const t2 = $("#aTrialTeam"); if (t2) t2.onclick = () => startTrialSite("team");
  const c = $("#copyKey"); if (c) c.onclick = async () => { await navigator.clipboard.writeText(a.license_key); c.textContent = "Copiado!"; toast("Chave copiada", "ok"); };
  view.querySelectorAll("[data-rmdev]").forEach((b) => b.onclick = async () => { await rpc("revoke_my_device", { p_id: b.dataset.rmdev }); renderAccount(); });
}

// ---------------------------------------------------------------- indique e ganhe
async function claimReferral() {                      // quem entrou por um link de indicação: registra uma vez (só conta nova)
  const code = store.get("pw.ref");
  if (!code || store.get("pw.refclaimed") === code) return;
  try { await rpc("claim_referral", { p_code: code }); } catch (e) { return; }
  store.set("pw.refclaimed", code);
}
async function renderReferral() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  let r;
  try { r = await rpc("my_referral"); } catch (e) { view.innerHTML = `<div class="wrap"><p class="modal-err">${esc(e.message)}</p></div>`; return; }
  if (!r || !r.ok) { view.innerHTML = `<div class="wrap"><p>Entre com o Google para ver o seu link.</p></div>`; return; }
  const link = `https://pitwall.hygor.com.br/?ref=${r.code}`;
  const pctBar = Math.min(100, Math.round((r.available / 100) * 100));
  const ST = { confirmado: "Confirmado", pendente: "Aguardando usar o Pitwall", usado: "Já virou desconto" };
  view.innerHTML = `
    <section class="sect"><div class="wrap acct">
      <span class="eyebrow">Indique e ganhe</span>
      <h1 class="plans-h">Traga amigos e ganhe até 50% de desconto</h1>
      <p class="lede">Compartilhe o seu link. Quem entrar por ele ganha <b>${r.invite_pct}% de desconto</b> no primeiro pagamento, e você ganha <b>1% de desconto</b> na sua próxima assinatura a cada 2 amigos que começarem a usar o Pitwall, até <b>${r.max_pct}%</b> com 100 amigos.</p>
      <div class="acct-grid">
        <div class="panel"><h2>O seu link</h2>
          <code class="lickey" id="refLink">${esc(link)}</code>
          <div class="row-actions"><button class="btn go small" id="refCopy">Copiar link</button>
            <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("Testa o Pitwall (telemetria e engenheiro de voz para ACC e iRacing): " + link)}">Enviar no WhatsApp</a></div>
          <p class="sub">Seu código: <b>${esc(r.code)}</b></p>
        </div>
        <div class="panel"><h2>Seu desconto</h2>
          <div class="ref-big">${r.pct}%</div>
          <div class="ref-bar"><i style="width:${Math.max(r.available ? 2 : 0, pctBar)}%"></i></div>
          <p class="sub">${r.pct >= r.max_pct ? "Você chegou ao máximo de 50%!" : `Faltam <b>${r.need_next}</b> amigo${r.need_next === 1 ? "" : "s"} para chegar a ${r.pct + 1}%.`}
            O desconto vale na <b>próxima assinatura</b> que você fizer (primeiro pagamento) e depois zera para recomeçar.</p>
        </div>
        <div class="panel"><h2>Seus amigos</h2>
          <div class="ref-stats"><div><b>${r.total}</b><span>entraram pelo link</span></div><div><b>${r.confirmed}</b><span>já usaram o Pitwall</span></div><div><b>${r.used}</b><span>já viraram desconto</span></div></div>
          ${(r.list || []).length ? `<table class="tbl"><tbody>${r.list.map((x) => `<tr><td>${esc(x.who)}</td><td class="sub">${dt(x.at)}</td><td>${ST[x.status] || x.status}</td></tr>`).join("")}</tbody></table>` : `<p class="sub">Ninguém entrou pelo seu link ainda.</p>`}
        </div>
        <div class="panel"><h2>Como funciona</h2>
          <ul class="ref-rules">
            <li>Seu amigo entra pelo link e faz login com o Google: ele ganha ${r.invite_pct}% no primeiro pagamento do Pro ou Equipe.</li>
            <li>Ele conta para você quando começa a usar o Pitwall (abre o app com o e-mail dele, começa um teste ou assina).</li>
            <li>A cada 2 amigos assim, +1% no seu desconto, até 50%.</li>
            <li>O desconto é usado no primeiro pagamento da sua próxima assinatura. Depois zera e você pode juntar de novo.</li>
            <li>Vale só para contas novas, e não vale indicar a si mesmo.</li>
          </ul>
        </div>
      </div></div></section>`;
  $("#refCopy").onclick = async () => { await navigator.clipboard.writeText(link); $("#refCopy").textContent = "Copiado!"; toast("Link copiado", "ok"); };
}

// ---------------------------------------------------------------- painel do afiliado (comissão em dinheiro)
async function renderAffiliate() {
  view.innerHTML = `<div class="loading">Carregando…</div>`;
  let a;
  try { a = await rpc("my_affiliate"); } catch (e) { view.innerHTML = `<div class="wrap"><p class="modal-err">${esc(e.message)}</p></div>`; return; }
  if (!a) { view.innerHTML = `<section class="sect"><div class="wrap"><h1 class="plans-h">Painel do afiliado</h1><p class="lede">Este e-mail não está cadastrado como afiliado. Se você combinou uma parceria, fale com a gente para cadastrar o e-mail que você usa no Google.</p></div></section>`; return; }
  const link = `https://pitwall.hygor.com.br/?ref=${a.code}`;
  const ST = { pending: "Em espera", approved: "Aprovada, a pagar", paid: "Paga", canceled: "Cancelada" };
  const SUB = { active: "Ativa", past_due: "Atrasada", canceled: "Cancelada", expired: "Expirada" };
  view.innerHTML = `
    <section class="sect"><div class="wrap acct">
      <span class="eyebrow">Painel do afiliado</span>
      <h1 class="plans-h">Olá, ${esc(a.name)}</h1>
      <p class="lede">Você ganha <b>${a.commission_pct}%</b> de cada pagamento dos clientes que vierem pelo seu link${a.commission_mode === "first" ? " (só do primeiro pagamento)" : ", todo mês enquanto eles continuarem assinando"}. Quem usa o seu código ganha <b>${a.discount_pct}% de desconto</b>${a.discount_duration === "forever" ? "" : " no primeiro pagamento"}.</p>
      <div class="acct-grid">
        <div class="panel"><h2>Seu link</h2>
          <code class="lickey">${esc(link)}</code>
          <div class="row-actions"><button class="btn go small" id="afCopy">Copiar link</button></div>
          <p class="sub">Seu código: <b>${esc(a.code)}</b> (o cliente também pode digitar no checkout).</p>
        </div>
        <div class="panel"><h2>Resumo</h2>
          <div class="ref-stats"><div><b>${a.clients_total}</b><span>clientes trazidos</span></div><div><b>${a.clients_active}</b><span>assinaturas ativas</span></div></div>
          <table class="tbl"><tbody>
            <tr><td>Em espera (7 dias de segurança)</td><td><b>${brl(a.cents_pending)}</b></td></tr>
            <tr><td>Aprovada, a receber</td><td><b>${brl(a.cents_approved)}</b></td></tr>
            <tr><td>Já paga a você</td><td><b>${brl(a.cents_paid)}</b></td></tr></tbody></table>
        </div>
        <div class="panel"><h2>Como você recebe</h2>
          <p class="sub">O pagamento é feito por Pix, manualmente, para a chave abaixo. A comissão fica 7 dias em espera e depois é aprovada; reembolso cancela a comissão.</p>
          <div class="adm-form">${piiField("afPix", a.pix_key || "", "Sua chave Pix")}<button class="btn small" id="afPixSave">Salvar</button></div>
          <div class="modal-err" id="afMsg"></div>
        </div>
        <div id="afBanners" style="grid-column:1/-1"></div>
        <div class="panel"><h2>Comissões</h2>
          ${(a.commissions || []).length ? `<table class="tbl"><tbody>${a.commissions.map((m) => `<tr><td>${dt(m.at)}</td><td class="sub">${esc(m.who)}</td><td>${brl(m.amount_cents)}</td><td>${esc(ST[m.status] || m.status)}</td></tr>`).join("")}</tbody></table>` : `<p class="sub">Nenhuma comissão ainda.</p>`}
        </div>
        <div class="panel"><h2>Clientes</h2>
          ${(a.clients || []).length ? `<table class="tbl"><tbody>${a.clients.map((c) => `<tr><td>${esc(c.who)}</td><td>${esc(PLAN_NAME[c.plan] || c.plan)} ${c.period === "year" ? "anual" : "mensal"}</td><td>${esc(SUB[c.status] || c.status)}</td><td class="sub">${dt(c.at)}</td></tr>`).join("")}</tbody></table>` : `<p class="sub">Ninguém assinou pelo seu link ainda.</p>`}
        </div>
      </div></div></section>`;
  BN.studio($("#afBanners"), { code: a.code, pct: a.discount_pct, duration: a.discount_duration });
  $("#afCopy").onclick = async () => { await navigator.clipboard.writeText(link); $("#afCopy").textContent = "Copiado!"; toast("Link copiado", "ok"); };
  $("#afPixSave").onclick = async () => {
    const m = $("#afMsg");
    try { await rpc("set_my_affiliate_pix", { p_pix: $("#afPix").value }); m.style.color = "var(--good, #3ee08f)"; m.textContent = "Chave salva."; } catch (e) { m.style.color = ""; m.textContent = e.message; }
  };
}

// quadro do painel (Preços): desconto do anual sobre o mensal e diferença entre Pro e Equipe, sempre com os preços atuais
function priceCompare(prices) {
  const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const S = priceStats(prices), rows = [];
  for (const [code, nm] of [["pro", "Pro"], ["team", "Equipe"]]) {
    const s = S[code];
    if (!s.m && !s.y) continue;
    const warn = s.saveC != null && s.saveC < 0;
    rows.push([nm, s.m ? brl(s.m) : "—", s.y ? brl(s.y) : "—", s.year12 ? brl(s.year12) : "—",
      s.saveC == null ? "—" : warn ? `<span class="st st-past_due">${brl(-s.saveC)} a MAIS (${pctTxt(-s.savePct)})</span>` : `<b>${brl(s.saveC)}</b> (−${pctTxt(s.savePct)})`,
      s.yMonth ? brl(Math.round(s.yMonth)) + "/mês" : "—"]);
    if (s.f) rows.push([nm + " · Fundador", brl(s.f), "—", brl(s.f * 12), s.y ? `anual ${s.y < s.f * 12 ? "<b>−" + pctTxt(Math.round((1 - s.y / (s.f * 12)) * 1000) / 10) + "</b>" : "sem desconto"} vs Fundador` : "—", ""]);
  }
  const d = S.diff;
  const warnTeam = S.team.saveC != null && S.team.saveC < 0 ? `<p class="modal-err" style="margin:8px 0">Atenção: o anual do Equipe (${brl(S.team.y)}) está mais caro que 12 meses no mensal (${brl(S.team.year12)}). Se não foi de propósito, ajuste o preço acima.</p>` : "";
  return `<div class="panel"><h2>Descontos e comparativo</h2>
    <p class="sub">Calculado com os preços ativos acima (sem cupons). “Economia” = quanto o anual custa a menos que pagar 12 meses no mensal.</p>
    ${tbl(["Plano", "Mensal", "Anual", "12 × mensal", "Economia do anual", "Anual por mês"], rows, true)}
    ${warnTeam}
    <h3 style="margin:14px 0 6px">Equipe x Pro: o Equipe vale Pro para ${S.people} pessoas (dono + ${S.people - 1} chaves)</h3>
    ${d.m != null ? tbl(["", "Mensal", "Anual"], [
      ["1 Pro", brl(S.pro.m), brl(S.pro.y)],
      [`${S.people} Pros avulsos (cada um assinando)`, S.bm ? brl(S.bm.all) : "—", S.by ? brl(S.by.all) : "—"],
      ["Equipe (as mesmas " + S.people + " pessoas)", brl(S.team.m), brl(S.team.y)],
      ["<b>Economia do Equipe</b>", S.bm ? `<b>${brl(S.bm.save)}</b> (${S.bm.pct}%)` : "—", S.by ? `<b>${brl(S.by.save)}</b> (${S.by.pct}%)` : "—"],
      ["Custo por pessoa no Equipe", S.bm ? brl(Math.round(S.bm.per)) + " por mês" : "—", S.by ? brl(Math.round(S.by.per)) + " por ano" : "—"],
      ["O Equipe compensa a partir de", S.bm ? `${S.bm.min} pessoas` : "—", S.by ? `${S.by.min} pessoas` : "—"]], true) : `<p class="sub">Falta o preço mensal ou anual de um dos planos.</p>`}
    <p class="sub">O desconto de 10% de cupom ou afiliado vem por cima disso, no primeiro pagamento (veja a aba Afiliados).</p></div>`;
}

// ---------------------------------------------------------------- painel do administrador
const ADM_TABS = [["geral", "Visão geral"], ["usuarios", "Usuários e versões"], ["assinaturas", "Assinaturas"], ["pagamentos", "Pagamentos"], ["afiliados", "Afiliados"], ["codigos", "Códigos e cupons"], ["banners", "Banners e GIFs"], ["comissoes", "Comissões"], ["cortesias", "Cortesias"],
  ["testes", "Testes"], ["licencas", "Licenças e computadores"], ["precos", "Preços"], ["bugs", "Bugs"], ["log", "Histórico"]];

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
  let D, U = [], BUGS = [], LATEST = null, AF = { affiliates: [], coupons: [], commissions: [], redemptions: [] }, NEWCODES = "";
  try { D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; AF = (await rpc("admin_affiliates")) || AF; LATEST = await latestVersion(); BUGS = (await sb.from("bug_reports").select("*").order("created_at", { ascending: false }).limit(100)).data || []; } catch (e) { view.innerHTML = `<section class="sect"><div class="wrap"><div class="panel">${esc(e.message)}</div></div></section>`; return; }
  let tab = store.get("pw.admTab") || "geral", q = "";
  const match = (o) => !q || JSON.stringify(o).toLowerCase().includes(q);
  const badge = (s) => `<span class="st st-${s}">${esc(STATUS_NAME[s] || s)}</span>`;
  const GROUPS = [["Resumo", ["geral"]], ["Pessoas", ["usuarios", "cortesias", "testes", "licencas"]], ["Dinheiro", ["assinaturas", "pagamentos", "precos", "comissoes"]], ["Divulgação", ["afiliados", "codigos", "banners"]], ["Sistema", ["bugs", "log"]]];
  const grpOf = (t) => (GROUPS.find((g) => g[1].includes(t)) || GROUPS[0]);
  const TABNAME = Object.fromEntries(ADM_TABS);
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
            .map((r) => [pii(r[0], "email"), r[1], r[2], `${dt(r[3])} <span class="sub">(${days(r[3])} d)</span>`]), true)}</div>`,
      usuarios: () => `<div class="panel"><h2>Quem usa o Pitwall</h2>
        <p class="sub">A versão aparece depois que a pessoa abre o app novo (0.1.45 ou mais recente) com o login do Google.${LATEST ? ` Última versão publicada: <b>${esc(LATEST)}</b>.` : ""}</p>
        ${table(["E-mail", "Plano", "Versão do app", "Último acesso do app", "Computadores", "Cadastro", "Último login", ""],
          U.filter(match).map((u) => [pii(u.email, "email"), `${PLAN_NAME[u.plan] || "Grátis"}${SRC_NAME[u.source] ? ` <small class="sub">(${SRC_NAME[u.source]})</small>` : ""}`,
            u.app_version ? `<b>${esc(u.app_version)}</b>${LATEST && verOlder(u.app_version, LATEST) ? ` <span class="st st-past_due">desatualizado</span>` : ` <span class="st st-active">em dia</span>`}` : `<span class="sub">ainda não apareceu</span>`,
            u.last_seen ? `${dtt(u.last_seen)}<br><small class="sub">${esc(u.device_label || "")}</small>` : "—", u.devices || 0, dt(u.created_at), dtt(u.last_sign_in_at),
            `<button class="btn small" data-um="${esc(u.email)}">Gerenciar</button>`]), true)}</div>`,
      banners: () => `<div id="bnHost"></div>`,
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
          `${esc(a.name)}<br><small class="sub">${pii(a.email, "email")}</small><br><small class="sub">Pix: ${pii(a.pix_key || "", "txt") || "—"}</small>`,
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
          `${esc(c.affiliate_name)}<br><small class="sub">Pix: ${pii(c.pix_key || "", "txt") || "—"}</small>`, pii(c.client_email, "email"), brl(c.base_cents), c.pct + "%", `<b>${brl(c.amount_cents)}</b>`,
          c.status === "paid" ? `<span class="st st-active">Paga em ${dt(c.paid_at)}</span>` : c.status === "canceled" ? `<span class="st st-canceled">Cancelada</span> <small class="sub">${esc(c.note || "")}</small>`
            : c.approved ? `<span class="st st-active">Aprovada</span>` : `<span class="st st-pending">Em espera até ${dt(c.approve_at)}</span>`,
          c.status === "pending" ? (c.approved ? `<button class="btn small" data-cm="${c.id}" data-st="paid">Marcar como paga</button> ` : "") + `<button class="btn small quiet" data-cm="${c.id}" data-st="canceled">Cancelar</button>` : ""]), true)}
        <p class="sub">A comissão é calculada sobre o valor realmente pago (já com o desconto do cliente), sem descontar a taxa do Asaas. Reembolso cancela a comissão. Você paga o afiliado por Pix e marca aqui como paga.</p></div>`; },
      assinaturas: () => `<div class="panel">${table(["E-mail", "Nome / CPF-CNPJ", "Plano", "Status", "Vence", "Chave", ""],
        D.subscriptions.filter(match).map((s) => [pii(s.email, "email"), `${esc(s.name || "")}<br><small class="sub">${pii(s.doc || "", "doc")}</small>`,
          `${PLAN_NAME[s.plan_code]} ${s.period === "year" ? "anual" : "mensal"}`, badge(s.status) + (s.cancel_at_period_end ? ` <small class="sub">cancela no fim</small>` : ""),
          dt(s.current_period_end), `<code>${pii(s.license_key || "", "key")}</code>`,
          `<button class="btn small quiet" data-ext="${s.id}" data-end="${s.current_period_end || ""}">+30 dias</button>
           <button class="btn small quiet" data-cancel="${s.id}">Cancelar</button>`]), true)}</div>`,
      pagamentos: () => `<div class="panel">${table(["Data", "E-mail", "Valor", "Status", "Forma", "Recibo", ""],
        D.payments.filter(match).map((p) => [dt(p.paid_at || p.due_date || p.created_at), pii(p.email, "email"), brl(p.amount_cents), badge(p.status), esc(p.method || ""),
          p.invoice_url ? `<a href="${esc(p.invoice_url)}" target="_blank" rel="noopener">abrir</a>` : "",
          p.status === "paid" ? `<button class="btn small quiet" data-pr="${p.id}" title="Devolve o dinheiro ao cliente pelo Asaas">Estornar</button>` : `<button class="btn small quiet danger" data-pd="${p.id}" title="Cancela no Asaas e tira do painel">Apagar</button>`]), true)}
        <p class="sub">Apagar cancela a cobrança no Asaas e a tira daqui e da conta do cliente. Pagamento já recebido não pode ser apagado: estorne antes (o dinheiro volta ao cliente).</p></div>`,
      cortesias: () => `<div class="panel"><h2>Dar um plano de cortesia</h2>
        <div class="adm-form"><input id="gMail" type="email" placeholder="e-mail do amigo (o do Google dele)">
          <select id="gPlan"><option value="pro">Pro</option><option value="team">Equipe</option></select>
          <select id="gDays"><option value="30">30 dias</option><option value="90">90 dias</option><option value="365">1 ano</option><option value="">Sem data para acabar</option></select>
          <input id="gWhy" type="text" placeholder="motivo (opcional)"><button class="btn go small" id="gGo">Liberar</button></div>
        <p class="sub">A pessoa entra no Pitwall com esse e-mail do Google (ou usa a chave) e já recebe o plano.</p></div>
        <div class="panel">${table(["E-mail", "Plano", "Até", "Motivo", "Status", ""], D.grants.filter(match).map((g) => [pii(g.email, "email"), PLAN_NAME[g.plan_code],
          g.expires_at ? dt(g.expires_at) : "sem fim", esc(g.reason || ""), g.revoked_at ? `<span class="st st-canceled">Revogada</span>` : (!g.expires_at || new Date(g.expires_at) > new Date()) ? `<span class="st st-active">Ativa</span>` : `<span class="st st-expired">Vencida</span>`,
          g.revoked_at ? "" : `<button class="btn small quiet" data-rg="${g.id}">Revogar</button>`]), true)}</div>`,
      testes: () => `<div class="panel">${table(["E-mail", "Começou", "Termina", "", ""], D.trials.filter(match).map((t) => [pii(t.email, "email"), dt(t.started_at),
        `${dt(t.ends_at)} <span class="sub">(${days(t.ends_at)} d)</span>`, `<button class="btn small quiet" data-xt="${esc(t.email)}">+7 dias</button>`, ""]), true)}</div>`,
      licencas: () => `<div class="panel"><h2>Chaves</h2>${table(["Chave", "E-mail", "Criada", "Status", ""], D.licenses.filter(match).map((l) => [`<code>${pii(l.key, "key")}</code>`, pii(l.email, "email"), dt(l.created_at),
        l.revoked_at ? `<span class="st st-canceled">Revogada</span>` : `<span class="st st-active">Ativa</span>`, l.revoked_at ? "" : `<button class="btn small quiet" data-rl="${esc(l.key)}">Revogar</button>`]), true)}</div>
        <div class="panel"><h2>Computadores</h2>${table(["E-mail", "Computador", "Versão", "Visto", ""], D.devices.filter(match).map((d) => [pii(d.email, "email"), esc(d.label || ""), esc(d.app_version || ""), dtt(d.last_seen),
        d.revoked_at ? `<span class="st st-canceled">Removido</span>` : `<button class="btn small quiet" data-rd="${d.id}">Remover</button>`]), true)}</div>`,
      precos: () => `<div class="panel">${table(["Plano", "Período", "Nome", "Valor (R$)", "Ativo", ""], D.prices.map((p) => [PLAN_NAME[p.plan_code], p.period === "year" ? "Anual" : "Mensal", esc(p.label || "Padrão"),
        `<input class="adm-num" data-pv="${p.id}" type="number" step="0.01" min="0" value="${(p.amount_cents / 100).toFixed(2)}">`,
        `<input type="checkbox" data-pa="${p.id}" ${p.active ? "checked" : ""}>`, `<button class="btn small" data-ps="${p.id}">Salvar</button>`]), true)}
        <p class="sub">Mudar o preço aqui vale para novas assinaturas. Quem já assina continua pagando o valor combinado no Asaas.</p></div>
        ${priceCompare(D.prices)}
        <div class="panel"><h2>Teste grátis</h2>
          <p class="sub">Quantos dias vale o teste grátis (Pro ou Equipe, um por e-mail). Vale para os próximos testes; quem já está testando mantém a data atual.</p>
          <div class="adm-form"><label class="sub">Dias do teste <input class="adm-num" id="trialDays" type="number" min="1" max="365" step="1" value="${TRIAL_DAYS}"></label><button class="btn small go" id="trialSave">Salvar</button></div>
        </div>`,
      bugs: () => `<div class="panel"><h2>Bugs reportados</h2>
        <p class="sub">Chegam também por e-mail. Aqui ficam guardados com as imagens e os logs.</p>
        ${BUGS.filter(match).length ? BUGS.filter(match).map((b) => `<div class="bug-item ${b.status}">
          <div class="bug-h"><b>${esc(b.title)}</b> ${b.status === "resolvido" ? `<span class="st st-active">Resolvido</span>` : b.status === "em_andamento" ? `<span class="st st-past_due">Em andamento</span>` : `<span class="st st-canceled">Novo</span>`}
            <span class="sub">${b.source === "app" ? "app" : "site"}${b.app_version ? " " + esc(b.app_version) : ""} · ${dtt(b.created_at)} · ${pii(b.email || "anônimo", "email")}${b.email_error ? ` · <span title="${esc(b.email_error)}">e-mail não enviado</span>` : ""}</span></div>
          <div class="bug-d">${esc(b.description)}</div>
          ${(b.attachments || []).length ? `<div class="bug-att">${b.attachments.map((a) => `<button class="btn small quiet" data-bimg="${esc(a.path)}">🖼 ${esc(a.name)}</button>`).join("")}</div>` : ""}
          ${b.logs ? `<details><summary>Logs (${Math.round(b.logs.length / 1024)} KB)</summary><pre class="bug-pre">${esc(b.logs)}</pre></details>` : ""}
          ${b.context && Object.keys(b.context).length ? `<details><summary>Detalhes técnicos</summary><pre class="bug-pre">${esc(JSON.stringify(b.context, null, 2))}</pre></details>` : ""}
          <div class="bug-act">${["novo", "em_andamento", "resolvido"].filter((s) => s !== b.status).map((s) => `<button class="btn small quiet" data-bst="${b.id}:${s}">${{ novo: "Reabrir", em_andamento: "Em andamento", resolvido: "Marcar resolvido" }[s]}</button>`).join("")}</div>
        </div>`).join("") : `<p class="sub">Nenhum relato ainda.</p>`}</div>`,
      log: () => `<div class="panel">${table(["Quando", "Ação", "Alvo", "Detalhes"], D.log.map((l) => [dtt(l.created_at), esc(l.action), esc(l.target || ""), `<small class="sub">${esc(JSON.stringify(l.data || {}))}</small>`]), true)}</div>`,
    }[tab]();
    view.innerHTML = `<section class="sect"><div class="wrap adm">
      <span class="eyebrow">Administração</span>
      <div class="adm-bar"><div class="tabs">${GROUPS.map(([g, ts]) => `<button class="btn small ${grpOf(tab)[0] === g ? "on" : ""}" data-tab="${ts[0]}">${g}</button>`).join("")}</div>
        <input id="admQ" type="search" placeholder="Buscar…" value="${esc(q)}"></div>
      ${grpOf(tab)[1].length > 1 ? `<div class="adm-sub">${grpOf(tab)[1].map((k) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${TABNAME[k]}</button>`).join("")}</div>` : ""}
      ${body}</div></section>`;
    bind();
  };
  const table = (head, rows, raw) => rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="sub">Nada por aqui.</p>`;
  const reload = async () => { BUGS = (await sb.from("bug_reports").select("*").order("created_at", { ascending: false }).limit(100)).data || []; D = await rpc("admin_overview"); U = (await rpc("admin_users")) || []; AF = (await rpc("admin_affiliates")) || AF; draw(); };
  const act = async (fn) => { try { await fn(); await reload(); } catch (e) { alert(e.message); } };
  const callAdminPay = async (id, action) => {
    const r = await fetch(`${PITWALL.url}/functions/v1/admin-payments`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: PITWALL.key }, body: JSON.stringify({ id, action }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || "Não foi possível concluir (" + (j.error || r.status) + ").");
    toast(action === "refund" ? "Pagamento estornado no Asaas" : "Pagamento apagado (e cancelado no Asaas)", "ok");
  };
  const userModal = (email) => {
    document.getElementById("umModal")?.remove();
    const em = email.toLowerCase(), u = U.find((x) => x.email.toLowerCase() === em) || { email };
    const gs = D.grants.filter((g) => g.email.toLowerCase() === em && !g.revoked_at);
    const subs = D.subscriptions.filter((x) => x.email.toLowerCase() === em && x.status !== "canceled");
    const ds = D.devices.filter((d) => d.email.toLowerCase() === em && !d.revoked_at);
    const tr = D.trials.find((t) => t.email.toLowerCase() === em);
    document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="umModal"><div class="modal-box">
      <h2>${pii(u.email, "email")}</h2>
      <p class="sub">Plano agora: <b>${PLAN_NAME[u.plan] || "Grátis"}</b>${SRC_NAME[u.source] ? ` (${SRC_NAME[u.source]})` : ""}${u.app_version ? ` · app ${esc(u.app_version)}` : ""}</p>
      <h3>Dar um plano</h3>
      <div class="adm-form"><select id="umPlan"><option value="pro">Pro</option><option value="team">Equipe</option></select>
        <select id="umDays"><option value="30">30 dias</option><option value="90">90 dias</option><option value="365">1 ano</option><option value="">Sem data para acabar</option></select>
        <input id="umWhy" type="text" placeholder="motivo (opcional)"><button class="btn go small" id="umGive">Liberar</button></div>
      ${gs.length ? `<h3>Cortesias ativas</h3>${gs.map((g) => `<div class="um-row"><span>${PLAN_NAME[g.plan_code]} até ${g.expires_at ? dt(g.expires_at) : "sem fim"}${g.reason ? ` · ${esc(g.reason)}` : ""}</span><button class="btn small quiet" data-umrg="${g.id}">Revogar</button></div>`).join("")}` : ""}
      ${subs.length ? `<h3>Assinaturas</h3>${subs.map((x) => `<div class="um-row"><span>${PLAN_NAME[x.plan_code]} ${x.period === "year" ? "anual" : "mensal"} · ${badge(x.status)} · vence ${dt(x.current_period_end)}</span>
        <span><button class="btn small quiet" data-umx="${x.id}" data-end="${x.current_period_end || ""}">+30 dias</button> <button class="btn small quiet danger" data-umc="${x.id}">Cancelar</button></span></div>`).join("")}` : ""}
      ${tr ? `<h3>Teste grátis</h3><div class="um-row"><span>termina em ${dt(tr.ends_at)}</span><button class="btn small quiet" id="umTr">+7 dias</button></div>` : ""}
      ${ds.length ? `<h3>Computadores</h3>${ds.map((d) => `<div class="um-row"><span>${esc(d.label || "")} <small class="sub">${esc(d.app_version || "")} · ${dtt(d.last_seen)}</small></span><button class="btn small quiet" data-umd="${d.id}">Remover</button></div>`).join("")}` : ""}
      <div class="modal-actions"><button class="btn quiet" id="umClose">Fechar</button></div></div></div>`);
    const m = document.getElementById("umModal"), q = (x) => m.querySelectorAll(x);
    const go = (fn) => async () => { try { await fn(); await reload(); userModal(email); } catch (e) { alert(e.message); } };
    m.querySelector("#umClose").onclick = () => m.remove();
    m.querySelector("#umGive").onclick = go(() => rpc("admin_grant", { p_email: email, p_plan: m.querySelector("#umPlan").value, p_days: m.querySelector("#umDays").value ? +m.querySelector("#umDays").value : null, p_reason: m.querySelector("#umWhy").value || null }));
    q("[data-umrg]").forEach((b) => b.onclick = go(() => rpc("admin_revoke_grant", { p_id: b.dataset.umrg })));
    q("[data-umx]").forEach((b) => b.onclick = go(() => { const base = b.dataset.end && new Date(b.dataset.end) > new Date() ? new Date(b.dataset.end) : new Date(); base.setDate(base.getDate() + 30);
      return rpc("admin_set_subscription", { p_id: b.dataset.umx, p_status: "active", p_period_end: base.toISOString() }); }));
    q("[data-umc]").forEach((b) => b.onclick = () => confirm("Cancelar esta assinatura agora?") && go(() => rpc("admin_set_subscription", { p_id: b.dataset.umc, p_status: "canceled", p_period_end: new Date().toISOString() }))());
    const t7 = m.querySelector("#umTr"); if (t7) t7.onclick = go(() => rpc("admin_extend_trial", { p_email: email, p_days: 7 }));
    q("[data-umd]").forEach((b) => b.onclick = go(() => rpc("admin_revoke_device", { p_id: b.dataset.umd })));
  };
  function bind() {
    const bh = $("#bnHost"); if (bh) BN.studio(bh, { editable: true, code: store.get("pw.bnCode") || "PITWALL", pct: 10, affiliates: AF.affiliates.filter((a) => a.active) });
    view.querySelectorAll("[data-bst]").forEach((b) => b.onclick = () => { const [id, st] = b.dataset.bst.split(":"); act(() => rpc("admin_set_bug_status", { p_id: id, p_status: st })); });
    view.querySelectorAll("[data-bimg]").forEach((b) => b.onclick = async () => {
      const { data, error } = await sb.storage.from("bug-reports").createSignedUrl(b.dataset.bimg, 600);
      if (error) { toast(error.message, "err"); return; } window.open(data.signedUrl, "_blank", "noopener");
    });
    view.querySelectorAll("[data-um]").forEach((b) => b.onclick = () => userModal(b.dataset.um));
    view.querySelectorAll("[data-pd]").forEach((b) => b.onclick = () => confirm("Apagar este pagamento? A cobrança será cancelada no Asaas e sairá do painel.") && act(() => callAdminPay(b.dataset.pd, "delete")));
    view.querySelectorAll("[data-pr]").forEach((b) => b.onclick = () => confirm("Estornar este pagamento? O dinheiro volta ao cliente pelo Asaas. Isso não dá para desfazer.") && act(() => callAdminPay(b.dataset.pr, "refund")));
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
    const gcc = $("#gcCopy"); if (gcc) gcc.onclick = async () => { await navigator.clipboard.writeText(NEWCODES); gcc.textContent = "Copiado!"; toast("Chave copiada", "ok"); };
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
    const ts = $("#trialSave"); if (ts) ts.onclick = async () => { const n = Math.round(+$("#trialDays").value); try { await rpc("admin_set_trial_days", { p_days: n }); TRIAL_DAYS = n; alert(`Teste grátis agora vale ${n} dias.`); } catch (e) { alert(e.message); } };
    view.querySelectorAll("[data-ps]").forEach((b) => b.onclick = () => act(() => rpc("admin_set_price", {
      p_id: b.dataset.ps, p_amount_cents: Math.round(parseFloat($(`[data-pv="${b.dataset.ps}"]`).value) * 100), p_active: $(`[data-pa="${b.dataset.ps}"]`).checked })));
  }
  draw();
}
