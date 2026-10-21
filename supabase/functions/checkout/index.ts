// Pitwall · cria a assinatura no Asaas e devolve o link de pagamento (Pix, cartão ou boleto).
//
// POST { plan: "pro" | "team", period: "month" | "year", price_id?: uuid, name: string, doc: "CPF ou CNPJ" }
// Authorization: Bearer <login do site/app>  (a função exige login; o e-mail da assinatura é o do login)
// Segredos da função: ASAAS_API_KEY e, para testar, ASAAS_ENV=sandbox.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const base = () => (Deno.env.get("ASAAS_ENV") === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");

async function asaas(path: string, init: RequestInit = {}) {
  const r = await fetch(`${base()}${path}`, {
    ...init,
    headers: { access_token: Deno.env.get("ASAAS_API_KEY")!, "Content-Type": "application/json", "User-Agent": "Pitwall", ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.errors?.[0]?.description || `Asaas ${r.status}`);
  return data;
}

function validDoc(d: string) {
  d = d.replace(/\D/g, "");
  if (d.length === 11) {                               // CPF
    if (/^(\d)\1{10}$/.test(d)) return false;
    for (const n of [9, 10]) {
      let s = 0;
      for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
      if (((s * 10) % 11) % 10 !== +d[n]) return false;
    }
    return true;
  }
  if (d.length === 14) {                               // CNPJ
    if (/^(\d)\1{13}$/.test(d)) return false;
    for (const n of [12, 13]) {
      let s = 0, p = n - 7;
      for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; }
      if (((s % 11) < 2 ? 0 : 11 - (s % 11)) !== +d[n]) return false;
    }
    return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  // diagnóstico sem login: em qual ambiente do Asaas esta função está (não revela nenhum segredo)
  if (req.method === "GET") {
    return json({ ok: true, env: Deno.env.get("ASAAS_ENV") === "sandbox" ? "sandbox" : "production", key_configured: !!Deno.env.get("ASAAS_API_KEY"),
      key_kind: (Deno.env.get("ASAAS_API_KEY") || "").includes("_hmlg_") ? "sandbox" : (Deno.env.get("ASAAS_API_KEY") ? "production" : "none") });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!Deno.env.get("ASAAS_API_KEY")) return json({ error: "payments_not_configured" }, 503);

  const jwt = (req.headers.get("authorization") || "").replace(/^bearer /i, "").trim();
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u.user?.email) return json({ error: "login" }, 401);
  const email = u.user.email.toLowerCase();

  let b: any;
  try { b = await req.json(); } catch { return json({ error: "json" }, 400); }
  const name = String(b.name || "").trim().slice(0, 120);
  const doc = String(b.doc || "").replace(/\D/g, "");
  if (name.length < 3) return json({ error: "nome" }, 400);
  if (!validDoc(doc)) return json({ error: "doc_invalido" }, 400);

  // preço
  let q = admin.from("prices").select("*").eq("active", true);
  if (b.price_id) q = q.eq("id", b.price_id);
  else q = q.eq("plan_code", String(b.plan)).eq("period", String(b.period)).eq("label", "");
  const { data: prices } = await q.limit(1);
  const price = prices?.[0];
  if (!price || price.plan_code === "free") return json({ error: "preco" }, 400);
  const now = new Date();
  if ((price.starts_at && new Date(price.starts_at) > now) || (price.ends_at && new Date(price.ends_at) < now)) return json({ error: "preco_fora_do_prazo" }, 400);

  // cupom de desconto / código de afiliado
  let cp: any = null, pct = 0, aff: string | null = null;
  const couponCode = String(b.coupon || "").trim().toUpperCase();
  if (couponCode) {
    const bad = (reason: string) => json({ error: "cupom", reason }, 400);
    const { data: c } = await admin.from("coupons").select("*").eq("code", couponCode).maybeSingle();
    if (!c || !c.active) return bad("invalido");
    if (c.expires_at && new Date(c.expires_at) < now) return bad("expirado");
    if (c.max_uses != null && c.uses >= c.max_uses) return bad("esgotado");
    if (c.kind !== "discount") return bad("use_no_checkout");      // código de presente se resgata em Minha conta
    if (c.plan_code && c.plan_code !== price.plan_code) return bad("plano_diferente");
    if (c.affiliate_id) {
      const { data: a } = await admin.from("affiliates").select("*").eq("id", c.affiliate_id).maybeSingle();
      if (!a || !a.active) return bad("invalido");
      if (a.email && String(a.email).toLowerCase() === email) return bad("proprio");   // ninguém ganha comissão de si mesmo
      aff = a.id;
    }
    cp = c; pct = c.percent_off || 0;
  }
  const chargeCents = pct > 0 ? Math.max(500, Math.round(price.amount_cents * (100 - pct) / 100)) : price.amount_cents;

  try {
    // cliques repetidos em "Assinar" não podem empilhar cobranças: cancela as assinaturas ainda não pagas deste e-mail
    const { data: stale } = await admin.from("subscriptions").select("id, provider_subscription_id")
      .eq("email", email).eq("status", "pending").eq("provider", "asaas");
    for (const o of stale || []) {
      if (o.provider_subscription_id) { try { await asaas(`/subscriptions/${o.provider_subscription_id}`, { method: "DELETE" }); } catch { /* já não existe */ } }
      await admin.from("subscriptions").update({ status: "canceled" }).eq("id", o.id);
    }
    const { data: sub, error: se } = await admin.from("subscriptions").insert({
      email, user_id: u.user.id, name, doc, plan_code: price.plan_code, period: price.period, provider: "asaas", status: "pending",
      coupon_code: cp?.code ?? null, affiliate_id: aff, discount_pct: pct, discount_duration: pct > 0 ? cp.duration : null,
      full_price_cents: pct > 0 ? price.amount_cents : null,
    }).select("id").single();
    if (se) throw new Error(se.message);

    // reaproveita o cliente do Asaas se o mesmo CPF/CNPJ já assinou antes (evita cliente duplicado)
    let customer: any = null;
    try { customer = (await asaas(`/customers?cpfCnpj=${doc}&limit=1`))?.data?.[0] || null; } catch { /* cria novo */ }
    if (!customer) customer = await asaas("/customers", { method: "POST", body: JSON.stringify({ name, email, cpfCnpj: doc, externalReference: sub.id }) });
    const today = new Date().toISOString().slice(0, 10);
    const subBody: Record<string, unknown> = {
      customer: customer.id, billingType: "UNDEFINED", value: chargeCents / 100, nextDueDate: today,
      cycle: price.period === "year" ? "YEARLY" : "MONTHLY",
      description: `Pitwall ${price.plan_code === "team" ? "Equipe" : "Pro"} (${price.period === "year" ? "anual" : "mensal"})${cp ? ` · cupom ${cp.code}` : ""}`,
      externalReference: sub.id,
    };
    let subscription;
    try {   // depois de pagar, o Asaas devolve a pessoa para a conta do Pitwall
      subscription = await asaas("/subscriptions", { method: "POST", body: JSON.stringify({ ...subBody, callback: { successUrl: "https://pitwall.hygor.com.br/#/conta?pago=1", autoRedirect: true } }) });
    } catch {   // se o Asaas recusar o redirecionamento (domínio não cadastrado), cria sem ele
      subscription = await asaas("/subscriptions", { method: "POST", body: JSON.stringify(subBody) });
    }
    await admin.from("subscriptions").update({ provider_customer_id: customer.id, provider_subscription_id: subscription.id }).eq("id", sub.id);
    if (cp) {   // conta o uso do cupom
      await admin.from("coupons").update({ uses: (cp.uses || 0) + 1 }).eq("code", cp.code);
      await admin.from("coupon_redemptions").insert({ code: cp.code, email, user_id: u.user.id, kind: "discount", subscription_id: sub.id });
    }

    // link da primeira cobrança
    let url: string | null = null;
    for (let i = 0; i < 4 && !url; i++) {
      const pays = await asaas(`/subscriptions/${subscription.id}/payments`);
      url = pays?.data?.[0]?.invoiceUrl || null;
      if (!url) await new Promise((r) => setTimeout(r, 700));
    }
    if (!url) throw new Error("não consegui o link de pagamento");
    return json({ ok: true, url, subscription_id: sub.id, charged_cents: chargeCents, discount_pct: pct });
  } catch (e) {
    return json({ error: "asaas", message: String((e as Error).message || e) }, 502);
  }
});
