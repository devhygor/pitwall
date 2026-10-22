/* Avisos modernos (toast): sucesso, erro e informação, que somem sozinhos.
   toast("Salvo", "ok") · toast("Não deu", "err") · toast("Aviso", "info")
   Também troca o alert() do navegador por um aviso bonito (e mostra erros inesperados). */
"use strict";
(function () {
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>',
    err: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.5v.01"/></svg>',
  };
  const ERR = /(^|\s)(n[aã]o |erro|falh|inv[aá]lid|obrigat|precisa|preencha|limite|esgot|expir|j[aá] (foi|tem|usou|resgat)|negad|s[oó] [eé] |[eé] do plano|permiss|incorret|sem acesso|indispon)/i;
  const recent = new Map();
  function wrap() {
    let w = document.getElementById("toasts");
    if (!w) { w = document.createElement("div"); w.id = "toasts"; w.setAttribute("aria-live", "polite"); document.body.appendChild(w); }
    return w;
  }
  window.toast = function (msg, kind, ms) {
    if (typeof kind === "number") { ms = kind; kind = undefined; }
    msg = String(msg == null ? "" : msg).trim();
    if (!msg) return;
    if (!ICON[kind]) kind = ERR.test(msg) ? "err" : "info";             // sem tipo: erro se a frase parece erro
    const key = kind + "|" + msg, now = Date.now();
    if (recent.get(key) > now - 1500) return;                                   // o mesmo aviso duas vezes seguidas aparece uma só
    recent.set(key, now);
    const t = ms || Math.min(10000, (kind === "err" ? 5200 : 3200) + msg.length * 35);
    const el = document.createElement("div");
    el.className = "toast " + kind; el.setAttribute("role", kind === "err" ? "alert" : "status"); el.style.setProperty("--d", t + "ms");
    el.innerHTML = `<i>${ICON[kind]}</i><span></span><button type="button" aria-label="Fechar">×</button><u></u>`;
    el.querySelector("span").textContent = msg;
    const w = wrap(); w.appendChild(el);
    while (w.children.length > 4) w.firstChild.remove();
    let timer, left = t, started = Date.now();
    const close = () => { clearTimeout(timer); el.classList.add("out"); setTimeout(() => el.remove(), 260); };
    const arm = () => { started = Date.now(); timer = setTimeout(close, left); };
    el.querySelector("button").onclick = close;
    el.onmouseenter = () => { clearTimeout(timer); left -= Date.now() - started; el.classList.add("pause"); };
    el.onmouseleave = () => { el.classList.remove("pause"); arm(); };
    requestAnimationFrame(() => el.classList.add("in")); arm();
  };
  window.alert = (m) => window.toast(m, ERR.test(String(m)) ? "err" : "ok");        // alert() vira aviso moderno
  window.addEventListener("unhandledrejection", (e) => { const m = e.reason && (e.reason.message || String(e.reason)); if (m && !/abort|cancel|network|fetch/i.test(m)) window.toast("Algo deu errado: " + m, "err"); });
})();
