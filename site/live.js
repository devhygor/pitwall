/* Pitwall · aviso "o criador está ao vivo" (site e app).
   Pergunta de tempos em tempos se o canal da Twitch está no ar e, se estiver, mostra um cartãozinho no canto da tela.
   Usa o serviço público decapi.me (sem chave); se ele falhar, o aviso simplesmente não aparece. */
"use strict";
(function () {
  const CHANNEL = "HRochaTV", URL_TW = "https://www.twitch.tv/" + CHANNEL, EVERY = 3 * 60 * 1000;
  const get = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ok */ } };
  let box = null;

  const css = document.createElement("style");
  css.textContent = `
  #pwLive { position: fixed; left: 16px; bottom: 16px; z-index: 9998; width: min(300px, calc(100vw - 32px)); display: flex; gap: 12px; align-items: center; padding: 12px 36px 12px 12px;
    border-radius: 14px; background: rgba(22,30,45,.96); border: 1px solid #2a3548; box-shadow: 0 10px 30px rgba(0,0,0,.45); color: #eef2f7; font: 14px/1.35 "Barlow", system-ui, sans-serif;
    transform: translateY(24px); opacity: 0; transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .4s; }
  #pwLive.on { transform: none; opacity: 1; }
  #pwLive .pwl-dot { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #9146ff; position: relative; }
  #pwLive .pwl-dot::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #9146ff; opacity: 0; animation: pwlPing 1.8s ease-out infinite; }
  @keyframes pwlPing { 0% { transform: scale(.85); opacity: .8; } 100% { transform: scale(1.4); opacity: 0; } }
  #pwLive b { display: block; font: italic 800 17px/1.1 "Barlow Condensed", sans-serif; letter-spacing: .3px; }
  #pwLive .pwl-live { display: inline-block; background: #e5383b; color: #fff; font: 700 10px/1 "Barlow", sans-serif; letter-spacing: .6px; padding: 3px 5px; border-radius: 4px; margin-right: 6px; vertical-align: 2px; }
  #pwLive small { display: block; color: #8e9bb2; margin-top: 2px; }
  #pwLive a.pwl-go { display: inline-block; margin-top: 6px; padding: 5px 10px; border-radius: 8px; background: #2ee59d; color: #04140d; font-weight: 700; text-decoration: none; }
  #pwLive button { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: #8e9bb2; font-size: 18px; line-height: 1; cursor: pointer; }
  #pwLive button:hover { color: #eef2f7; background: rgba(255,255,255,.08); }`;
  document.head.appendChild(css);

  const text = async (u) => { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error("http " + r.status); return (await r.text()).trim(); };
  async function status() {
    const up = await text("https://decapi.me/twitch/uptime/" + CHANNEL.toLowerCase() + "?offline_msg=OFFLINE");
    if (up === "OFFLINE" || !/(second|minute|hour|day)/i.test(up)) return null;       // fora do ar (ou resposta inesperada)
    let game = ""; try { game = await text("https://decapi.me/twitch/game/" + CHANNEL.toLowerCase()); if (/not found|error|offline|no game/i.test(game)) game = ""; } catch (e) { /* ok */ }
    return { up, game };
  }
  function show(s) {
    if (get("pw.liveHide") === "1") return;
    if (!box) {
      box = document.createElement("div"); box.id = "pwLive";
      box.innerHTML = `<div class="pwl-dot"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" aria-hidden="true"><path d="M4.3 3 3 6.5v13h4.5V22h2.7l2.5-2.5h3.7L21 14.2V3H4.3zm14.9 10.2-3 3h-4.7l-2.5 2.5v-2.5H6.7V4.8h12.5v8.4zM16.4 7.5h-1.8v5h1.8v-5zm-4.8 0H9.8v5h1.8v-5z"/></svg></div>
        <div><b><span class="pwl-live">AO VIVO</span>O criador do Pitwall está online!</b><small id="pwlSub"></small><a class="pwl-go" href="${URL_TW}" target="_blank" rel="noopener">Assistir na Twitch</a></div>
        <button type="button" aria-label="Fechar">×</button>`;
      box.querySelector("button").onclick = () => { set("pw.liveHide", "1"); hide(); };
      document.body.appendChild(box); requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("on")));
    }
    box.querySelector("#pwlSub").textContent = s.game ? `${CHANNEL} · jogando ${s.game}` : `${CHANNEL} está transmitindo agora`;
  }
  function hide() { if (!box) return; const b = box; box = null; b.classList.remove("on"); setTimeout(() => b.remove(), 600); }

  let busy = false;
  async function check() {
    if (busy || document.hidden) return; busy = true;
    try { const s = await status(); if (s) show(s); else { hide(); set("pw.liveHide", "0"); } } catch (e) { /* sem rede ou serviço fora: não mostra nada */ }
    busy = false;
  }
  setTimeout(check, 4000); setInterval(check, EVERY);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();
