// Pitwall · emite o token de licença assinado (Ed25519) para o app.
//
// POST { action: "activate" | "refresh" | "trial" | "pubkey",
//        key?: "PW-XXXX-XXXX-XXXX-XXXX",          // chave de licença (para quem pagou com outro e-mail)
//        device: { hash, label }, app_version }
// Authorization: Bearer <token do login com Google>  (opcional; sem ele precisa da chave)
//
// O token vale poucos dias; o app renova toda vez que abre com internet. A chave privada fica numa tabela
// que só o service role lê (public.license_signing_keys) e é criada sozinha na primeira chamada.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_DAYS = 4;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signingKey() {
  let { data } = await admin.from("license_signing_keys").select("private_jwk, public_x").eq("id", 1).maybeSingle();
  if (!data) {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
    await admin.from("license_signing_keys").upsert({ id: 1, private_jwk: priv, public_x: pub.x }, { ignoreDuplicates: true });
    ({ data } = await admin.from("license_signing_keys").select("private_jwk, public_x").eq("id", 1).single());
  }
  const key = await crypto.subtle.importKey("jwk", data!.private_jwk, { name: "Ed25519" }, false, ["sign"]);
  return { key, publicX: data!.public_x as string };
}

async function sign(payload: Record<string, unknown>) {
  const { key } = await signingKey();
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(body));
  return `${body}.${b64u(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const action = String(body.action || "activate");

  if (action === "pubkey") return json({ ok: true, alg: "Ed25519", x: (await signingKey()).publicX });

  const device = body.device || {};
  const hash = String(device.hash || "").slice(0, 128);
  if (!hash) return json({ ok: false, error: "device" }, 400);

  // --- quem é: login com Google (JWT) ou chave de licença
  let email = "";
  let userId: string | null = null;
  let jwt = "";
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    jwt = auth.slice(7).trim();
    const { data, error } = await admin.auth.getUser(jwt);
    if (!error && data.user?.email) { email = data.user.email.toLowerCase(); userId = data.user.id; }
  }
  if (!email && body.key) {
    const { data } = await admin.from("licenses").select("email").eq("key", String(body.key).trim().toUpperCase()).is("revoked_at", null).maybeSingle();
    if (data) email = String(data.email).toLowerCase();
  }
  if (!email) return json({ ok: false, error: body.key ? "key_invalid" : "auth" }, 401);

  // --- teste grátis (precisa de login)
  if (action === "trial") {
    if (!userId) return json({ ok: false, error: "login" }, 401);
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
    });
    const { data, error } = await user.rpc("start_trial", { p_device: hash });
    if (error || !data?.ok) return json({ ok: false, error: data?.error || "trial_failed" }, 409);
  }

  const { data: ent, error: entErr } = await admin.rpc("resolve_entitlement", { p_email: email });
  if (entErr || !ent?.length) return json({ ok: false, error: "entitlement" }, 500);
  const e = ent[0];

  // --- dispositivos: todo mundo é registrado (versão do app e último acesso aparecem no painel do admin),
  // mas o LIMITE de computadores só vale para quem tem plano pago.
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: list } = await admin.from("devices").select("id, device_hash, label, last_seen")
    .eq("email", email).is("revoked_at", null).gte("last_seen", since);
  const known = (list || []).find((d: any) => d.device_hash === hash);
  if (e.plan_code !== "free" && !known && (list || []).length >= e.max_devices) {
    return json({
      ok: false, error: "device_limit", max_devices: e.max_devices,
      devices: (list || []).map((d: any) => ({ label: d.label, last_seen: d.last_seen })),
    }, 403);
  }
  await admin.from("devices").upsert({
    email, device_hash: hash, label: String(device.label || "").slice(0, 80), app_version: String(body.app_version || "").slice(0, 20),
    last_seen: new Date().toISOString(), revoked_at: null,
  }, { onConflict: "email,device_hash" });
  const devices: unknown[] = list || [];

  const now = Math.floor(Date.now() / 1000);
  const endsAt = new Date(e.ends_at).getTime() / 1000;
  const exp = Math.min(now + TOKEN_DAYS * 86400, Math.floor(endsAt));
  const token = await sign({
    v: 1, email, plan: e.plan_code, features: e.features, src: e.source, dev: hash, iat: now, exp,
  });
  const { data: lic } = await admin.from("licenses").select("key").eq("email", email).is("revoked_at", null).maybeSingle();
  return json({
    ok: true, token, plan: e.plan_code, source: e.source, ends_at: e.ends_at, features: e.features,
    email, license_key: lic?.key || null, max_devices: e.max_devices, devices_in_use: devices.length,
  });
});
