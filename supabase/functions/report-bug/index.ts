// Pitwall · recebe o relato de um bug (site ou app) com logs e imagens, guarda no banco e manda por e-mail.
//
// POST { title, description, email?, name?, source: "site"|"app", app_version?, context?: {}, logs?: string,
//        images?: [{ name, type, data: base64 }] }
// Authorization: Bearer <login> é opcional (se vier um login válido, o relato fica ligado à conta).
// Segredos: RESEND_API_KEY (envio do e-mail), BUG_REPORT_TO (padrão: o e-mail do dono), BUG_REPORT_FROM (padrão: onboarding@resend.dev).
// Sem RESEND_API_KEY o relato fica guardado e aparece em Admin > Bugs; o e-mail só não sai.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const OK_IMG: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMG = 4 * 1024 * 1024, MAX_LOGS = 300 * 1024;

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pw-bug|" + s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: "corpo", message: "Pedido inválido." }, 400); }

  const title = String(b.title || "").trim().slice(0, 120), description = String(b.description || "").trim().slice(0, 5000);
  if (title.length < 3) return json({ error: "titulo", message: "Dê um título curto ao problema." }, 400);
  if (description.length < 10) return json({ error: "descricao", message: "Conte o que aconteceu (pelo menos uma frase)." }, 400);
  const source = b.source === "app" ? "app" : "site";
  let logs = typeof b.logs === "string" ? b.logs : "";
  if (logs.length > MAX_LOGS) logs = "[… início cortado …]\n" + logs.slice(-MAX_LOGS);
  const images = Array.isArray(b.images) ? b.images.slice(0, 5) : [];

  // quem é (opcional) e limite de uso para ninguém lotar a caixa de entrada
  let uid: string | null = null, mail = String(b.email || "").trim().slice(0, 200) || null, name = String(b.name || "").trim().slice(0, 80) || null;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (jwt) {
    const { data } = await admin.auth.getUser(jwt);
    if (data?.user) { uid = data.user.id; mail = mail || data.user.email || null; }
  }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const ipHash = await sha(ip);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("bug_reports").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
  if ((count || 0) >= 5) return json({ error: "limite", message: "Muitos relatos seguidos. Tente de novo em uma hora." }, 429);

  const id = crypto.randomUUID();
  const files: { name: string; type: string; bytes: Uint8Array; data: string }[] = [];
  for (const [i, im] of images.entries()) {
    const type = String(im?.type || "");
    if (!OK_IMG[type]) return json({ error: "imagem", message: "Só imagens PNG, JPG, WEBP ou GIF." }, 400);
    let bytes: Uint8Array;
    try { bytes = b64(String(im.data || "")); } catch { return json({ error: "imagem", message: "Imagem inválida." }, 400); }
    if (bytes.length > MAX_IMG) return json({ error: "imagem", message: "Cada imagem pode ter até 4 MB." }, 400);
    files.push({ name: `imagem-${i + 1}.${OK_IMG[type]}`, type, bytes, data: String(im.data) });
  }
  const attachments: { path: string; name: string; type: string; size: number }[] = [];
  for (const f of files) {
    const path = `${id}/${f.name}`;
    const { error } = await admin.storage.from("bug-reports").upload(path, f.bytes, { contentType: f.type, upsert: true });
    if (!error) attachments.push({ path, name: f.name, type: f.type, size: f.bytes.length });
  }
  const context = b.context && typeof b.context === "object" ? b.context : {};
  const { error: insErr } = await admin.from("bug_reports").insert({
    id, user_id: uid, email: mail, name, title, description, source, app_version: String(b.app_version || "").slice(0, 40) || null,
    context, logs: logs || null, attachments, ip_hash: ipHash,
  });
  if (insErr) return json({ error: "banco", message: "Não foi possível salvar o relato." }, 500);

  // e-mail
  let emailErr: string | null = null;
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) emailErr = "RESEND_API_KEY não configurada";
  else {
    const ctx = Object.entries(context).map(([k, v]) => `<tr><td style="color:#888;padding:2px 10px 2px 0">${esc(k)}</td><td>${esc(typeof v === "string" ? v : JSON.stringify(v))}</td></tr>`).join("");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2 style="margin:0 0 6px">🐞 ${esc(title)}</h2>
      <p style="color:#666;margin:0 0 14px">${source === "app" ? "App" : "Site"}${b.app_version ? " · versão " + esc(b.app_version) : ""} · de ${esc(name || "anônimo")} ${mail ? "&lt;" + esc(mail) + "&gt;" : ""}</p>
      <div style="white-space:pre-wrap;border-left:3px solid #2ee59d;padding:6px 12px;background:#f6faf8">${esc(description)}</div>
      ${ctx ? `<table style="margin-top:14px;font-size:13px">${ctx}</table>` : ""}
      <p style="color:#888;font-size:12px;margin-top:16px">${files.length} imagem(ns) e ${logs ? "logs" : "sem logs"} em anexo · id ${id} · também em Admin &gt; Bugs no site.</p></div>`;
    const att = files.map((f) => ({ filename: f.name, content: f.data }));
    if (logs) att.push({ filename: "logs.txt", content: btoa(unescape(encodeURIComponent(logs))) });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("BUG_REPORT_FROM") || "Pitwall <onboarding@resend.dev>",
        to: [Deno.env.get("BUG_REPORT_TO") || "hygor.k92@gmail.com"],
        reply_to: mail || undefined, subject: `[Pitwall bug] ${title}`, html, attachments: att,
      }),
    });
    if (!r.ok) emailErr = `Resend ${r.status}: ${(await r.text()).slice(0, 300)}`;
  }
  await admin.from("bug_reports").update(emailErr ? { email_error: emailErr } : { emailed_at: new Date().toISOString() }).eq("id", id);
  return json({ ok: true, id, emailed: !emailErr });
});
