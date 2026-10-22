/* Dados sensíveis (e-mail, chave de licença, Pix, CPF/CNPJ) ficam mascarados até clicar no olho.
   Uso: pii(valor, "email" | "key" | "doc" | "txt") devolve o HTML; o clique no olho mostra e esconde (e esconde sozinho depois de 20 s). */
"use strict";

const PII_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const PII_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function piiMask(v, kind) {
  v = String(v == null ? "" : v);
  if (!v) return "";
  if (kind === "email" || (kind !== "key" && kind !== "doc" && /^[^\s@]+@[^\s@]+$/.test(v))) {
    const [u, d = ""] = v.split("@"), dm = d.split(".");
    return u.slice(0, 2) + "•••@" + (dm[0] || "").slice(0, 1) + "•••" + (dm.length > 1 ? "." + dm.slice(1).join(".") : "");
  }
  if (kind === "key") return v.slice(0, 3) + "•".repeat(Math.max(4, v.length - 7)) + v.slice(-4);
  if (kind === "doc") return "•".repeat(Math.max(3, v.length - 2)) + v.slice(-2);
  return v.slice(0, 2) + "•".repeat(Math.max(3, v.length - 4)) + v.slice(-2);
}
function pii(v, kind) {
  const s = String(v == null ? "" : v);
  if (!s) return "";
  const a = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<span class="pii" data-v="${a(s)}" data-m="${a(piiMask(s, kind))}"><span class="piiv">${a(piiMask(s, kind))}</span><button type="button" class="eye" title="Mostrar ou esconder" aria-label="Mostrar ou esconder">${PII_ON}</button></span>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".pii .eye");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const w = b.closest(".pii"), shown = w.classList.toggle("shown");
  w.querySelector(".piiv").textContent = shown ? w.dataset.v : w.dataset.m;
  b.innerHTML = shown ? PII_OFF : PII_ON;
  clearTimeout(w._t);
  if (shown) w._t = setTimeout(() => { w.classList.remove("shown"); w.querySelector(".piiv").textContent = w.dataset.m; b.innerHTML = PII_ON; }, 20000);
});
// campo de texto escondido (ex.: chave Pix): olho alterna entre password e text
function piiField(id, value, placeholder) {
  const a = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<span class="pii-field"><input id="${id}" type="password" autocomplete="off" placeholder="${a(placeholder || "")}" value="${a(value || "")}"><button type="button" class="eye" data-eye="${id}" title="Mostrar ou esconder" aria-label="Mostrar ou esconder">${PII_ON}</button></span>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button[data-eye]");
  if (!b) return;
  const i = document.getElementById(b.dataset.eye);
  if (!i) return;
  const show = i.type === "password";
  i.type = show ? "text" : "password"; b.innerHTML = show ? PII_OFF : PII_ON;
});
