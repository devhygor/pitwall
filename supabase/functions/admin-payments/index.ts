// Pitwall · o admin apaga ou estorna um pagamento também no Asaas.
//
// POST { id: uuid, action: "delete" | "refund" }
//   delete: cobrança pendente/vencida/falha -> cancela no Asaas (DELETE /payments/{id}) e esconde do painel e do cliente.
//           Cobrança já paga NÃO apaga: estorne antes (refund) para o dinheiro voltar ao cliente.
//   refund: cobrança paga -> estorna no Asaas (POST /payments/{id}/refund) e marca como "refunded".
// Authorization: Bearer <login do admin>. Segredos: ASAAS_API_KEY, ASAAS_ENV (sandbox/production).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const base = () => (Deno.env.get("ASAAS_ENV") === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");

async function asaas(path: string, init: RequestInit = {}) {
  const r = await fetch(`${base()}${path}`, {
    ...init,
    headers: { access_token: Deno.env.get("ASAAS_API_KEY")!, "Content-Type": "application/json", "User-Agent": "Pitwall", ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data, msg: data?.errors?.[0]?.description || `Asaas ${r.status}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "login" }, 401);

  // só administrador: o banco confere com o login de quem chamou
  const me = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: isAdm } = await me.rpc("is_admin");
  if (isAdm !== true) return json({ error: "sem_permissao" }, 403);

  let body: { id?: string; action?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "corpo" }, 400); }
  const action = body.action === "refund" ? "refund" : "delete";
  const { data: p } = await admin.from("payments").select("id,status,provider,provider_payment_id").eq("id", body.id || "").maybeSingle();
  if (!p) return json({ error: "nao_encontrado" }, 404);

  const asaasId = p.provider === "asaas" ? p.provider_payment_id : null;

  if (action === "refund") {
    if (p.status !== "paid") return json({ error: "nao_pago", message: "Só dá para estornar um pagamento já recebido." }, 400);
    if (!asaasId) return json({ error: "sem_asaas", message: "Este pagamento não tem cobrança no Asaas." }, 400);
    const r = await asaas(`/payments/${encodeURIComponent(asaasId)}/refund`, { method: "POST", body: "{}" });
    if (!r.ok) return json({ error: "asaas", message: r.msg }, 502);
    const { error } = await me.rpc("admin_mark_payment", { p_id: p.id, p_status: "refunded" });
    if (error) return json({ error: "banco", message: error.message }, 500);
    return json({ ok: true, refunded: true });
  }

  if (p.status === "paid") return json({ error: "pago", message: "Este pagamento já foi recebido. Estorne primeiro (devolve o dinheiro) e depois apague." }, 400);
  if (asaasId) {
    const r = await asaas(`/payments/${encodeURIComponent(asaasId)}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) return json({ error: "asaas", message: r.msg }, 502);   // 404: já não existe lá
  }
  const { error } = await me.rpc("admin_hide_payment", { p_id: p.id, p_action: "delete" });
  if (error) return json({ error: "banco", message: error.message }, 500);
  return json({ ok: true, deleted: true, asaas: !!asaasId });
});
