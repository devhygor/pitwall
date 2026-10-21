// Pitwall · recebe os avisos (webhooks) do Asaas e libera o plano sozinho.
//
// No painel do Asaas (Integrações > Webhooks) aponte para
//   https://<projeto>.supabase.co/functions/v1/payments-webhook
// e escolha o MESMO token que está no segredo ASAAS_WEBHOOK_TOKEN desta função.
// Eventos usados: PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_REFUNDED, PAYMENT_CHARGEBACK_REQUESTED,
// SUBSCRIPTION_INACTIVATED, SUBSCRIPTION_DELETED (os demais são só registrados).
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const asaasBase = () => (Deno.env.get("ASAAS_ENV") === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");

async function fetchCustomer(id: string) {
  const key = Deno.env.get("ASAAS_API_KEY");
  if (!key || !id) return null;
  const r = await fetch(`${asaasBase()}/customers/${id}`, { headers: { access_token: key, "User-Agent": "Pitwall" } });
  return r.ok ? await r.json() : null;
}

// comparação em tempo constante
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const secret = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!secret) return new Response("webhook não configurado", { status: 503 });
  const got = req.headers.get("asaas-access-token") || "";
  if (!same(got, secret)) return new Response("não autorizado", { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("json", { status: 400 }); }
  const event = String(body.event || "");
  const eventId = String(body.id || `${event}:${body.payment?.id || body.subscription?.id || crypto.randomUUID()}`);

  let { data, error } = await admin.rpc("apply_asaas_event", { p_event_id: eventId, p_event: event, p_payload: body, p_customer: null });
  if (!error && data === "needs_customer") {
    const customer = await fetchCustomer(body.payment?.customer || body.subscription?.customer);
    if (!customer) {
      await admin.from("webhook_events").update({ error: "assinatura desconhecida e sem como buscar o cliente (ASAAS_API_KEY?)" })
        .eq("provider", "asaas").eq("event_id", eventId);
      return new Response("ok", { status: 200 });          // 200 para o Asaas não ficar reenviando; o erro fica registrado
    }
    ({ data, error } = await admin.rpc("apply_asaas_event", { p_event_id: eventId, p_event: event, p_payload: body, p_customer: customer }));
  }
  if (error) {
    await admin.from("webhook_events").update({ error: error.message }).eq("provider", "asaas").eq("event_id", eventId);
    return new Response("erro", { status: 500 });          // o Asaas tenta de novo
  }
  // depois do 1º pagamento com desconto "só no primeiro mês", a assinatura volta ao preço normal nas próximas cobranças
  if ((event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") && body.payment?.subscription) {
    try {
      const { data: sub } = await admin.from("subscriptions").select("id, full_price_cents, discount_pct, discount_duration, full_restored")
        .eq("provider", "asaas").eq("provider_subscription_id", body.payment.subscription).maybeSingle();
      if (sub && sub.discount_pct > 0 && sub.discount_duration === "once" && !sub.full_restored && sub.full_price_cents) {
        const key = Deno.env.get("ASAAS_API_KEY");
        const r = await fetch(`${asaasBase()}/subscriptions/${body.payment.subscription}`, {
          method: "PUT", headers: { access_token: key || "", "Content-Type": "application/json", "User-Agent": "Pitwall" },
          body: JSON.stringify({ value: sub.full_price_cents / 100, updatePendingPayments: false }),
        });
        if (r.ok) await admin.from("subscriptions").update({ full_restored: true }).eq("id", sub.id);
        else await admin.from("webhook_events").update({ error: `não voltou ao preço normal (Asaas ${r.status})` }).eq("provider", "asaas").eq("event_id", eventId);
      }
    } catch (e) {
      await admin.from("webhook_events").update({ error: `preço normal: ${String((e as Error).message || e)}` }).eq("provider", "asaas").eq("event_id", eventId);
    }
  }
  return new Response(String(data), { status: 200 });
});
