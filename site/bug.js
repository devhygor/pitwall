/* Pitwall · reportar um problema: título, descrição, logs e imagens vão para o e-mail do desenvolvedor. */
"use strict";

const BUG_MAX_IMGS = 5;
// reduz a imagem (lado maior 1600 px, JPEG) para o envio ficar leve; GIF e arquivos pequenos vão como estão
async function bugPrepImage(file) {
  const asData = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(blob); });
  if (file.type === "image/gif" || file.size < 600 * 1024) return { name: file.name, type: file.type, data: await asData(file), preview: URL.createObjectURL(file) };
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Não deu para abrir essa imagem.")); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  return { name: file.name.replace(/\.\w+$/, "") + ".jpg", type: "image/jpeg", data: await asData(blob), preview: URL.createObjectURL(blob) };
}

function renderBug() {
  const imgs = [];
  const mail = session ? session.user.email : "";
  view.innerHTML = `<section class="sect"><div class="wrap bug">
    <span class="eyebrow">Ajuda</span><h1 class="plans-h">Reportar um problema</h1>
    <p class="lede">Achou um bug ou algo estranho? Conte o que aconteceu. Quanto mais detalhe (passos, imagens e o texto do erro), mais rápido a gente resolve. A mensagem chega direto no e-mail do desenvolvedor.</p>
    <form class="panel" id="bugForm">
      <label class="pf-l" for="bgTitle">Resumo do problema</label><input class="field" id="bgTitle" maxlength="120" required placeholder="ex.: o overlay some quando troco de sessão">
      <label class="pf-l" for="bgDesc">O que aconteceu? Como repetir?</label>
      <textarea class="field" id="bgDesc" rows="6" maxlength="5000" required placeholder="1. Abri o ACC&#10;2. Entrei na pista&#10;3. O overlay ficou preto&#10;(o que você esperava e o que viu)"></textarea>
      <label class="pf-l" for="bgMail">Seu e-mail (para a gente poder responder)</label><input class="field" id="bgMail" type="email" maxlength="200" value="${esc(mail)}" placeholder="opcional">
      <label class="pf-l">Imagens (até ${BUG_MAX_IMGS}) <small class="sub">Escolha, arraste ou cole um print (Ctrl+V)</small></label>
      <div class="bug-drop" id="bgDrop"><input type="file" id="bgFile" accept="image/*" multiple hidden><button class="btn small" type="button" id="bgPick">Escolher imagens</button><div class="bug-thumbs" id="bgThumbs"></div></div>
      <label class="pf-l" for="bgLogs">Logs ou texto do erro <small class="sub">opcional · cole aqui ou anexe um .txt/.log</small></label>
      <textarea class="field" id="bgLogs" rows="5" placeholder="Cole aqui a mensagem de erro, se houver"></textarea>
      <div class="pf-row"><input type="file" id="bgLogFile" accept=".txt,.log,text/plain" hidden><button class="btn small quiet" type="button" id="bgLogPick">Anexar arquivo de log</button></div>
      <div class="pf-row"><button class="btn go" type="submit" id="bgGo">Enviar relato</button> <span class="sub" id="bgMsg"></span></div>
      <p class="sub" style="margin-top:10px">Enviamos junto o navegador e o tamanho da tela. No app do Pitwall, o botão “Reportar um problema” também anexa o log do programa.</p>
    </form></div></section>`;
  const thumbs = () => { $("#bgThumbs").innerHTML = imgs.map((m, i) => `<span class="bug-th"><img src="${m.preview}" alt=""><button type="button" data-rm="${i}" aria-label="Tirar">×</button></span>`).join("");
    thumbs.box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { imgs.splice(+b.dataset.rm, 1); thumbs(); }); };
  thumbs.box = $("#bugForm");
  const add = async (files) => {
    for (const f of files) {
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { toast("Só imagens PNG, JPG, WEBP ou GIF.", "err"); continue; }
      if (imgs.length >= BUG_MAX_IMGS) { toast(`No máximo ${BUG_MAX_IMGS} imagens.`, "err"); break; }
      try { const m = await bugPrepImage(f); if (m.data.length > 5.4e6) throw new Error("Imagem grande demais (até 4 MB)."); imgs.push(m); } catch (e) { toast(e.message, "err"); }
    }
    thumbs();
  };
  $("#bgPick").onclick = () => $("#bgFile").click();
  $("#bgFile").onchange = (e) => { add([...e.target.files]); e.target.value = ""; };
  const drop = $("#bgDrop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); };
  $("#bugForm").addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); add(f); } });
  $("#bgLogPick").onclick = () => $("#bgLogFile").click();
  $("#bgLogFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1.5e6) { toast("Arquivo grande demais (até 1,5 MB). Cole só o final do log.", "err"); return; }
    $("#bgLogs").value = (($("#bgLogs").value ? $("#bgLogs").value + "\n\n" : "") + await f.text()); e.target.value = "";
  };
  $("#bugForm").onsubmit = async (e) => {
    e.preventDefault();
    const go = $("#bgGo"); go.disabled = true; $("#bgMsg").textContent = "Enviando…";
    try {
      const headers = { "Content-Type": "application/json", apikey: PITWALL.key };
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      const r = await fetch(`${PITWALL.url}/functions/v1/report-bug`, { method: "POST", headers, body: JSON.stringify({
        title: $("#bgTitle").value, description: $("#bgDesc").value, email: $("#bgMail").value, name: (profile && profile.name) || null, source: "site",
        logs: $("#bgLogs").value, images: imgs.map((m) => ({ name: m.name, type: m.type, data: m.data })),
        context: { página: location.href.split("#")[0] + (location.hash || ""), navegador: navigator.userAgent, tela: `${innerWidth}x${innerHeight}`, idioma: navigator.language },
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || "Não foi possível enviar agora. Tente de novo.");
      view.innerHTML = `<section class="sect"><div class="wrap bug"><div class="panel"><h2>Recebemos o seu relato. Obrigado!</h2><p class="sub">Vamos olhar com carinho. Se precisar de mais detalhes, respondemos pelo e-mail que você informou.</p><a class="btn" href="#/">Voltar</a></div></div></section>`;
      toast("Relato enviado. Obrigado!", "ok");
    } catch (err) { go.disabled = false; $("#bgMsg").textContent = ""; toast(err.message, "err"); }
  };
}
