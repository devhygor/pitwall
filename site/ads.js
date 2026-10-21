/* Pitwall · anúncios (Google AdSense) só no site, só para quem não tem plano pago e só depois do aviso de cookies.
   Para ligar: preencha PITWALL.adsense em config.js (client = "ca-pub-XXXXXXXXXXXXXXXX" e os ids dos blocos).
   Enquanto estiver vazio, nada é carregado e nenhum espaço é reservado.
   Regras que seguimos: nenhum anúncio perto de botões de pagamento ou de login, poucos blocos por página,
   e o plano Pro (recurso "no_ads") remove todos. */
"use strict";

(function () {
  const cfg = () => (window.PITWALL && window.PITWALL.adsense) || {};
  const KEY = "pw.consent";
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* ok */ } };
  const enabled = () => !!cfg().client && !window.PITWALL_NO_ADS;
  let loaded = false;

  window.adSlot = function (name) {
    const id = (cfg().slots || {})[name];
    if (!enabled() || !id) return "";
    return `<aside class="adwrap" aria-label="Publicidade"><small>Publicidade · <a href="#/planos">remova com o plano Pro</a></small><div class="adslot" data-slot="${id}"></div></aside>`;
  };

  function loadScript() {
    if (loaded) return;
    loaded = true;
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg().client)}`;
    s.crossOrigin = "anonymous";
    document.head.appendChild(s);
  }

  function fill() {
    if (!enabled() || get() !== "yes") return;
    const slots = document.querySelectorAll(".adslot:not([data-done])");
    if (!slots.length) return;
    loadScript();
    slots.forEach((el) => {
      el.dataset.done = "1";
      el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg().client}" data-ad-slot="${el.dataset.slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* bloqueado */ }
    });
  }

  function banner() {
    if (!cfg().client || get() || document.getElementById("consent")) return;
    document.body.insertAdjacentHTML("beforeend", `<div id="consent" class="consent" role="dialog" aria-label="Cookies e anúncios">
      <p>O Pitwall mostra anúncios do Google no site para se manter de pé. Eles usam cookies. Você pode recusar e continuar usando normalmente.
        Quem assina o plano Pro não vê anúncios.</p>
      <div><button class="btn small quiet" id="consentNo">Só o essencial</button><button class="btn small go" id="consentYes">Aceitar</button></div></div>`);
    document.getElementById("consentYes").onclick = () => { set("yes"); document.getElementById("consent").remove(); fill(); };
    document.getElementById("consentNo").onclick = () => { set("no"); document.getElementById("consent").remove(); };
  }

  new MutationObserver(() => fill()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("DOMContentLoaded", () => { banner(); fill(); });
})();
