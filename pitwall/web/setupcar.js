/* Pitwall · editor visual de setup: o carro (desenhado de acordo com a marca) com pontos clicáveis em cada parte.
   Passar o mouse mostra os valores e a recomendação do Pitwall; clicar abre os ajustes daquela parte.
   As alterações viram uma lista de mudanças (em cliques) que o servidor aplica numa versão nova ou no próprio setup. */
"use strict";
(function () {
  // ------------------------------------------------------------------ perfis por marca
  // layout: onde fica o motor (rear = traseiro, mid = central, front = dianteiro) -> muda a posição da cabine
  // nose: pointed | round | wide · hw: meia-largura · wing: swan (pescoço de cisne) | std
  const BRANDS = {
    porsche:    { layout: "rear",  nose: "round",   hw: 100, noseX: 796, wing: "swan", accent: "#d7dde6", name: "Porsche" },
    ferrari:    { layout: "mid",   nose: "pointed", hw: 102, noseX: 812, wing: "std",  accent: "#ef3340", name: "Ferrari" },
    lamborghini:{ layout: "mid",   nose: "wide",    hw: 106, noseX: 806, wing: "std",  accent: "#9be000", name: "Lamborghini" },
    mclaren:    { layout: "mid",   nose: "pointed", hw: 101, noseX: 814, wing: "std",  accent: "#ff8a00", name: "McLaren" },
    audi:       { layout: "mid",   nose: "wide",    hw: 103, noseX: 804, wing: "std",  accent: "#ef2b2d", name: "Audi" },
    honda:      { layout: "mid",   nose: "pointed", hw: 100, noseX: 806, wing: "std",  accent: "#e4252e", name: "Honda" },
    bmw:        { layout: "front", nose: "wide",    hw: 102, noseX: 812, wing: "std",  accent: "#3b9cff", name: "BMW" },
    mercedes:   { layout: "front", nose: "round",   hw: 104, noseX: 818, wing: "std",  accent: "#a8b3c2", name: "Mercedes-AMG" },
    aston:      { layout: "front", nose: "round",   hw: 102, noseX: 816, wing: "std",  accent: "#2ee59d", name: "Aston Martin" },
    ford:       { layout: "front", nose: "wide",    hw: 106, noseX: 812, wing: "std",  accent: "#3b9cff", name: "Ford" },
    corvette:   { layout: "front", nose: "pointed", hw: 104, noseX: 814, wing: "std",  accent: "#ffd400", name: "Chevrolet" },
    nissan:     { layout: "front", nose: "wide",    hw: 104, noseX: 806, wing: "std",  accent: "#c8102e", name: "Nissan" },
    lexus:      { layout: "front", nose: "wide",    hw: 102, noseX: 808, wing: "std",  accent: "#a9b4c4", name: "Lexus" },
    bentley:    { layout: "front", nose: "round",   hw: 108, noseX: 806, wing: "std",  accent: "#3fd68b", name: "Bentley" },
    generic:    { layout: "front", nose: "round",   hw: 102, noseX: 808, wing: "std",  accent: "#2ee59d", name: "GT" },
  };
  const brandOf = (car) => {
    const c = String(car || "").toLowerCase();
    for (const [k, rx] of [["porsche", /porsche/], ["ferrari", /ferrari/], ["lamborghini", /lambo|huracan/], ["mclaren", /mclaren/], ["audi", /audi/], ["honda", /honda|nsx/],
      ["bmw", /bmw/], ["mercedes", /mercedes|amg_gt/], ["aston", /amr|aston/], ["ford", /ford|mustang/], ["corvette", /corvette|chevrolet/], ["nissan", /nissan|gt_r|gtr/],
      ["lexus", /lexus/], ["bentley", /bentley/]]) if (rx.test(c)) return k;
    return "generic";
  };

  // ------------------------------------------------------------------ desenho
  // curva suave (Catmull-Rom -> Bézier) por uma lista de pontos
  const smooth = (pts, closed = true) => {
    const n = pts.length, P = (i) => pts[(i + n) % n];
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = closed ? P(i - 1) : pts[Math.max(0, i - 1)], p1 = P(i), p2 = closed ? P(i + 1) : pts[i + 1], p3 = closed ? P(i + 2) : pts[Math.min(n - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d + (closed ? "Z" : "");
  };

  const CY = 210, TAIL = 96, FRONT_AXLE = 640, REAR_AXLE = 285;
  function geometry(p) {
    const nw = { pointed: 34, round: 56, wide: 76 }[p.nose], noseX = p.noseX;
    const cab = { rear: { cx: 466, len: 196 }, mid: { cx: 500, len: 176 }, front: { cx: 392, len: 206 } }[p.layout];
    return { nw, noseX, cab, hw: p.hw };
  }

  function bodyPath(p, g) {
    const hw = g.hw, n = g.nw;
    const up = [[TAIL, 66], [TAIL + 26, 88], [REAR_AXLE - 40, hw - 2], [REAR_AXLE + 40, hw + 2], [g.cab.cx, hw - 12], [FRONT_AXLE - 30, hw - 3],
      [FRONT_AXLE + 56, hw - 12], [g.noseX - 70, n + 30], [g.noseX - 22, n + 4], [g.noseX, n * 0.4]];
    const pts = [...up.map(([x, w]) => [x, CY - w]), ...[...up].reverse().map(([x, w]) => [x, CY + w])];
    return smooth(pts);
  }

  function carSvg(p, accent) {
    const g = geometry(p), hw = g.hw, c = g.cab, ac = accent || p.accent;
    const wheel = (ax, side) => {
      const y = CY + side * (hw - 6);
      return `<g class="whl"><rect x="${ax - 44}" y="${y - 17}" width="88" height="34" rx="9" fill="#090c11" stroke="#2c3644" stroke-width="1.5"/>
        <rect x="${ax - 30}" y="${y - 11}" width="60" height="22" rx="6" fill="#141b24" stroke="#3a4656" stroke-width="1"/>
        <line x1="${ax - 24}" y1="${y}" x2="${ax + 24}" y2="${y}" stroke="#2c3644" stroke-width="1"/></g>`;
    };
    const louvers = p.layout === "front"
      ? [0, 1, 2, 3, 4].map((i) => `<path d="M${c.cx + c.len / 2 + 46 + i * 15},${CY - 46} l12,10 M${c.cx + c.len / 2 + 46 + i * 15},${CY + 46} l12,-10" stroke="#3a4656" stroke-width="2" fill="none" stroke-linecap="round"/>`).join("")
      : [0, 1, 2, 3, 4, 5].map((i) => `<line x1="${TAIL + 70 + i * 17}" y1="${CY - 52}" x2="${TAIL + 70 + i * 17}" y2="${CY + 52}" stroke="#2a3341" stroke-width="3" stroke-linecap="round"/>`).join("")
        + `<ellipse cx="${c.cx - c.len / 2 + 6}" cy="${CY - hw + 20}" rx="26" ry="9" fill="#06090d" stroke="#2a3341"/><ellipse cx="${c.cx - c.len / 2 + 6}" cy="${CY + hw - 20}" rx="26" ry="9" fill="#06090d" stroke="#2a3341"/>`;
    const wingHalf = p.wing === "swan" ? 126 : 116;
    const wing = `<g class="wing">
      <line x1="${TAIL - 2}" y1="${CY - 38}" x2="${TAIL + 34}" y2="${CY - 38}" stroke="#3a4656" stroke-width="${p.wing === "swan" ? 5 : 3}"/><line x1="${TAIL - 2}" y1="${CY + 38}" x2="${TAIL + 34}" y2="${CY + 38}" stroke="#3a4656" stroke-width="${p.wing === "swan" ? 5 : 3}"/>
      <rect x="${TAIL - 22}" y="${CY - wingHalf}" width="30" height="${wingHalf * 2}" rx="6" fill="#161d27" stroke="${ac}" stroke-opacity=".55" stroke-width="1.6"/>
      <rect x="${TAIL - 22}" y="${CY - wingHalf - 3}" width="34" height="8" rx="3" fill="#0d1218" stroke="#3a4656"/><rect x="${TAIL - 22}" y="${CY + wingHalf - 5}" width="34" height="8" rx="3" fill="#0d1218" stroke="#3a4656"/></g>`;
    const splitter = `<rect x="${g.noseX - 44}" y="${CY - g.nw - 40}" width="52" height="${(g.nw + 40) * 2}" rx="12" fill="#10161e" stroke="${ac}" stroke-opacity=".55" stroke-width="1.4"/>
      <line x1="${g.noseX - 30}" y1="${CY - g.nw - 30}" x2="${g.noseX - 30}" y2="${CY + g.nw + 30}" stroke="#2a3341"/>`;
    const headlights = [-1, 1].map((s) => `<path d="M${g.noseX - 66},${CY + s * (g.nw + 14)} L${g.noseX - 24},${CY + s * (g.nw * 0.55 + 6)} L${g.noseX - 28},${CY + s * (g.nw * 0.55 + 16)} L${g.noseX - 64},${CY + s * (g.nw + 26)} Z" fill="#d9ecff" fill-opacity=".9" stroke="#8cbcea" stroke-width="1"/>`).join("");
    const sig = ({
      ferrari: [-1, 1].map((s) => `<path d="M${c.cx + c.len / 2 + 40},${CY + s * 20} L${g.noseX - 80},${CY + s * 14}" stroke="${ac}" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>`).join(""),
      porsche: [-1, 1].map((s) => `<ellipse cx="${REAR_AXLE + 18}" cy="${CY + s * (hw - 4)}" rx="42" ry="9" fill="none" stroke="${ac}" stroke-opacity=".45" stroke-width="1.5"/>`).join(""),
      lamborghini: [-1, 1].map((s) => `<path d="M${g.noseX - 70},${CY + s * (g.nw + 10)} l18,${s * -14} l14,0" fill="none" stroke="${ac}" stroke-opacity=".8" stroke-width="2.4"/>`).join(""),
      bmw: [-1, 1].map((s) => `<rect x="${g.noseX - 28}" y="${CY + (s < 0 ? -22 : 6)}" width="14" height="16" rx="4" fill="#06090d" stroke="${ac}" stroke-opacity=".6"/>`).join(""),
      mercedes: `<rect x="${g.noseX - 32}" y="${CY - 22}" width="16" height="44" rx="6" fill="#06090d" stroke="${ac}" stroke-opacity=".6"/>`,
      mclaren: [-1, 1].map((s) => `<path d="M${c.cx - c.len / 2 - 40},${CY + s * (hw - 6)} q22,${s * -34} 62,${s * -30}" fill="none" stroke="${ac}" stroke-opacity=".75" stroke-width="3" stroke-linecap="round"/>`).join(""),
      audi: [-1, 1].map((s) => `<line x1="${g.noseX - 76}" y1="${CY + s * 30}" x2="${g.noseX - 40}" y2="${CY + s * 30}" stroke="${ac}" stroke-opacity=".6" stroke-width="3"/>`).join(""),
    })[p.key] || "";
    const doors = [-1, 1].map((s) => `<path d="M${c.cx - 24},${CY + s * (hw - 14)} Q${c.cx + 30},${CY + s * (hw - 8)} ${c.cx + c.len / 2 - 10},${CY + s * (hw - 18)}" fill="none" stroke="#3a4656" stroke-width="1.5"/>`).join("");
    const tail = `<rect x="${TAIL + 4}" y="${CY - 56}" width="9" height="112" rx="4" fill="#ff3b30" fill-opacity=".85"/><rect x="${TAIL + 4}" y="${CY - 56}" width="9" height="112" rx="4" fill="none" stroke="#ff8a80" stroke-width="1"/>`;
    const glassX = c.cx - c.len / 2;
    return `<defs><linearGradient id="scBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26303d"/><stop offset=".5" stop-color="#1a222c"/><stop offset="1" stop-color="#141a22"/></linearGradient>
        <radialGradient id="scGlow" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="${ac}" stop-opacity=".14"/><stop offset="1" stop-color="${ac}" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="450" cy="${CY + 8}" rx="400" ry="120" fill="url(#scGlow)"/>
      ${wheel(REAR_AXLE, -1)}${wheel(REAR_AXLE, 1)}${wheel(FRONT_AXLE, -1)}${wheel(FRONT_AXLE, 1)}
      ${wing}${splitter}
      <path d="${bodyPath(p, g)}" fill="url(#scBody)" stroke="${ac}" stroke-opacity=".7" stroke-width="2"/>
      <path d="M${TAIL + 40},${CY} L${g.noseX - 30},${CY}" stroke="${ac}" stroke-opacity=".28" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
      ${louvers}
      <rect x="${glassX}" y="${CY - hw + 30}" width="${c.len}" height="${(hw - 30) * 2}" rx="40" fill="#0b1118" stroke="#3a4656" stroke-width="1.5"/>
      <rect x="${glassX + 26}" y="${CY - hw + 44}" width="${c.len - 70}" height="${(hw - 44) * 2}" rx="26" fill="#222c39" stroke="#34404f"/>
      <path d="M${glassX + c.len - 44},${CY - hw + 46} L${glassX + c.len - 4},${CY - hw + 58} L${glassX + c.len - 4},${CY + hw - 58} L${glassX + c.len - 44},${CY + hw - 46} Z" fill="#0f1720" stroke="#3a4656"/>
      <rect x="${glassX + 52}" y="${CY - 26}" width="56" height="52" rx="10" fill="#0b1118" stroke="${ac}" stroke-opacity=".4"/>
      <path d="M${glassX + c.len - 36},${CY - hw + 26} l16,-12 l8,6 l-10,10 Z M${glassX + c.len - 36},${CY + hw - 26} l16,12 l8,-6 l-10,-10 Z" fill="#161d27" stroke="#3a4656"/>
      ${doors}${sig}${headlights}${tail}`;
  }

  // posição de cada ponto clicável no desenho
  function spotPos(p, g) {
    const hw = g.hw, off = hw + 40;
    return {
      aero_f: [g.noseX + 4, CY], aero_r: [TAIL - 10, CY], w0: [FRONT_AXLE, CY - off], w1: [FRONT_AXLE, CY + off], w2: [REAR_AXLE, CY - off], w3: [REAR_AXLE, CY + off],
      axle_f: [FRONT_AXLE - 70, CY], axle_r: [REAR_AXLE + 4, CY], cockpit: [g.cab.cx + 18, CY], fuel: [p.layout === "front" ? REAR_AXLE - 60 : g.cab.cx - g.cab.len / 2 - 56, CY],
    };
  }

  // ------------------------------------------------------------------ valores e editor
  const dispVal = (kind, raw) => (kind === "psi" ? (20.3 + 0.1 * raw).toFixed(1).replace(".", ",") : kind === "+1" ? String(raw + 1) : String(raw));
  const MIRROR = { w0: "w1", w1: "w0", w2: "w3", w3: "w2" };
  const mirrorPath = (path) => { const m = path.match(/^(.*)\[(\d)\]$/); return m ? `${m[1]}[${{ 0: 1, 1: 0, 2: 3, 3: 2 }[+m[2]]}]` : null; };

  let adviceCache = {};
  async function loadAdvice(id) {
    if (adviceCache[id]) return adviceCache[id];
    try { adviceCache[id] = await api(`/api/setups/${id}/advice?target=26.5`); } catch (e) { adviceCache[id] = { changes: [], findings: [], error: e.message }; }
    return adviceCache[id];
  }

  async function open(info, ctx) {
    document.getElementById("scOverlay")?.remove();
    const brandKey = brandOf(info.car), prof = { ...BRANDS[brandKey], key: brandKey }, g = geometry(prof), pos = spotPos(prof, g);
    const items = info.editable || [], byPath = Object.fromEntries(items.map((x) => [x.path, x]));
    const spots = info.spots || {};
    const edits = {};                                    // caminho -> delta em cliques
    let sel = null, advice = { changes: [], findings: [] }, mirror = false;
    const adviceBySpot = () => { const m = {}; for (const ch of advice.changes || []) { const it = byPath[ch.path]; if (it) (m[it.spot] = m[it.spot] || []).push(ch); } return m; };
    const cnt = (spot) => items.filter((x) => x.spot === spot && edits[x.path]).length;
    const total = () => Object.values(edits).filter(Boolean).length;
    const cur = (it) => Math.max(0, it.raw + (edits[it.path] || 0));

    const root = document.createElement("div");
    root.id = "scOverlay"; root.className = "sc-ov";
    root.innerHTML = `<div class="sc-top"><div><b>Editor visual</b> <span class="sub">${esc(info.name)}</span><div class="sub">${esc(pretty(info.car))} · ${esc(pretty(info.track))}</div></div>
        <span class="spacer"></span><button class="btn sm quiet" id="scClose">✕ Fechar</button></div>
      <div class="sc-main">
        <div class="sc-stage"><div id="scFind" class="sc-find"></div>
          <div class="sc-svgwrap"><svg id="scSvg" viewBox="0 0 900 420" role="img" aria-label="Carro">${carSvg(prof)}
            ${Object.entries(pos).map(([k, [x, y]]) => `<g class="sc-spot" data-spot="${k}" tabindex="0" role="button" aria-label="${esc(spots[k] || k)}" transform="translate(${x},${y})">
              <circle class="ring" r="20"/><circle class="dot" r="7"/><g class="bd" style="display:none"><circle r="10" cx="17" cy="-17"/><text x="17" y="-13" text-anchor="middle"></text></g></g>`).join("")}</svg>
            <div id="scTip" class="sc-tip" hidden></div></div>
          <div class="sc-legend">Passe o mouse nos pontos para ver os valores e a recomendação. Clique para ajustar. <span class="sub">${esc(prof.name)} · desenho ilustrativo</span></div></div>
        <aside class="sc-panel" id="scPanel"></aside></div>
      <div class="sc-bar" id="scBar"></div>`;
    document.body.appendChild(root);
    const $q = (s) => root.querySelector(s);
    const close = () => { document.removeEventListener("keydown", onKey, true); root.remove(); };
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".cb-pop")) { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey, true);
    $q("#scClose").onclick = () => { if (!total() || confirm("Fechar o editor e descartar as alterações?")) close(); };

    // ---- dica ao passar o mouse
    const tip = $q("#scTip"), wrap = $q(".sc-svgwrap");
    const tipHtml = (k) => {
      const its = items.filter((x) => x.spot === k);
      const key = its.filter((x) => ["Pneu", "Alinhamento", "Aerodinâmica", "Equilíbrio", "Eletrônica", "Estratégia", "Freios"].includes(x.section)).slice(0, 5);
      const recs = adviceBySpot()[k] || [];
      const lock = ctx.genLock;
      return `<b>${esc(spots[k] || k)}</b>
        <div class="tv">${(key.length ? key : its.slice(0, 5)).map((x) => `<div><span>${esc(x.label)}${x.side ? " " + esc(x.side) : ""}</span><b>${esc(dispVal(x.kind, cur(x)))}${x.unit ? " " + x.unit : ""}${edits[x.path] ? ` <em>(era ${esc(dispVal(x.kind, x.raw))})</em>` : ""}</b></div>`).join("")}</div>
        ${lock ? `<div class="tr lock">🔒 Recomendações do Pitwall: plano Pro</div>`
          : recs.length ? `<div class="tr">${recs.slice(0, 3).map((c) => `<div>💡 <b>${esc(c.label)}</b>: ${c.delta > 0 ? "+" : ""}${c.delta} clique(s)<small>${esc((c.reasons || [])[0] || "")}</small></div>`).join("")}</div>`
            : `<div class="tr none">${advice.error ? "Sem voltas suas para analisar ainda." : "Sem recomendação para esta parte."}</div>`}
        <div class="th">Clique para ajustar</div>`;
    };
    root.querySelectorAll(".sc-spot").forEach((el) => {
      const show = () => {
        tip.innerHTML = tipHtml(el.dataset.spot); tip.hidden = false;
        const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        let x = r.left - w.left + r.width + 10, y = r.top - w.top - 8;
        if (x + 270 > w.width) x = r.left - w.left - 270 - 6;
        tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, Math.min(y, w.height - tip.offsetHeight - 4)) + "px";
      };
      el.onmouseenter = show; el.onfocus = show; el.onmouseleave = () => { tip.hidden = true; }; el.onblur = () => { tip.hidden = true; };
      el.onclick = () => select(el.dataset.spot);
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(el.dataset.spot); } };
    });

    // ---- painel de ajustes da parte escolhida
    function paintBadges() {
      root.querySelectorAll(".sc-spot").forEach((el) => {
        const k = el.dataset.spot, n = cnt(k), bd = el.querySelector(".bd");
        bd.style.display = n ? "" : "none"; if (n) bd.querySelector("text").textContent = n;
        el.classList.toggle("on", sel === k); el.classList.toggle("chg", !!n);
        el.classList.toggle("rec", !ctx.genLock && !!(adviceBySpot()[k] || []).length);
      });
    }
    function paintBar() {
      const n = total();
      $q("#scBar").innerHTML = `<div class="sc-sum">${n ? `<b>${n}</b> ajuste${n === 1 ? "" : "s"} pendente${n === 1 ? "" : "s"}` : "Nenhuma alteração ainda"}</div><span class="spacer"></span>
        ${ctx.genLock ? `<span class="sub">Salvar versões é do plano <b>Pro</b> ou <b>Equipe</b> <a href="#/plano">Ver planos</a></span>` : `<input id="scName" value="${esc(info.next_name || "")}" title="Nome da versão nova (padrão: Pitwall + pista + carro + Q/R + versão)">`}
        <button class="btn sm quiet" id="scReset" ${n ? "" : "disabled"}>Desfazer tudo</button>
        <button class="btn sm" id="scUpd" ${n && !ctx.genLock ? "" : "disabled"} title="Aplica no próprio arquivo, com backup do original">Atualizar este setup</button>
        <button class="btn primary sm" id="scNew" ${n && !ctx.genLock ? "" : "disabled"}>Criar versão nova</button>`;
      $q("#scReset").onclick = () => { for (const k of Object.keys(edits)) delete edits[k]; paintAll(); };
      const chg = () => Object.entries(edits).filter(([, d]) => d).map(([path, delta]) => ({ path, delta }));
      const done = (r, what) => { toast(what, "ok"); close(); ctx.onSaved && ctx.onSaved(r); };
      const nb = $q("#scNew"); if (nb && !ctx.genLock) nb.onclick = async () => {
        nb.disabled = true;
        try {
          const r = await api("/api/setups/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_id: info.id, name: $q("#scName").value, changes: chg() }) });
          done(r, r.already ? `Esse setup já existe: ${r.name}` : `Versão criada: ${r.name}`);
        } catch (e) { nb.disabled = false; toast(e.message, "err"); }
      };
      const ub = $q("#scUpd"); if (ub && !ctx.genLock) ub.onclick = async () => {
        if (!confirm("Aplicar os ajustes direto no arquivo deste setup? Guardo um backup do original antes.")) return;
        ub.disabled = true;
        try {
          const r = await api(`/api/setups/${info.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "update", changes: chg() }) });
          done(r, "Setup atualizado (backup do original guardado)");
        } catch (e) { ub.disabled = false; toast(e.message, "err"); }
      };
    }
    function paintPanel() {
      const p = $q("#scPanel");
      if (!sel) {
        p.innerHTML = `<div class="sc-empty"><b>Escolha uma parte do carro</b><span>Clique em um ponto verde para ver e mudar os ajustes dela. Os pontos com anel amarelo têm uma recomendação do Pitwall para o seu estilo de pilotagem.</span></div>`;
        return;
      }
      const its = items.filter((x) => x.spot === sel), recs = Object.fromEntries((adviceBySpot()[sel] || []).map((c) => [c.path, c]));
      const sections = [...new Set(its.map((x) => x.section))];
      p.innerHTML = `<div class="sc-ph"><h3>${esc(spots[sel] || sel)}</h3>${MIRROR[sel] ? `<label class="sc-mir"><input type="checkbox" id="scMir" ${mirror ? "checked" : ""}> Espelhar no ${sel === "w0" || sel === "w2" ? "lado direito" : "lado esquerdo"}</label>` : ""}</div>
        ${sections.map((sc) => `<div class="sc-sec"><h4>${esc(sc)}</h4>${its.filter((x) => x.section === sc).map((x) => {
          const c = recs[x.path], d = edits[x.path] || 0;
          return `<div class="sc-row ${d ? "chg" : ""}" data-p="${esc(x.path)}">
            <div class="sc-lab"><span>${esc(x.label)}${x.side ? ` <small>${esc(x.side)}</small>` : ""}</span><small class="hint">${esc(x.hint)}</small>
              ${c ? `<button class="sc-sug" data-sug="${esc(x.path)}" title="${esc((c.reasons || []).join(" · "))}">💡 Sugestão: ${c.delta > 0 ? "+" : ""}${c.delta} · aplicar</button>` : ""}</div>
            <div class="sc-step"><button data-d="-1" aria-label="Diminuir">−</button><b>${esc(dispVal(x.kind, cur(x)))}${x.unit ? ` <small>${x.unit}</small>` : ""}</b><button data-d="1" aria-label="Aumentar">+</button>
              ${d ? `<button class="rst" data-r="1" title="Voltar ao valor original (${esc(dispVal(x.kind, x.raw))})">↺</button>` : ""}</div></div>`;
        }).join("")}</div>`).join("")}`;
      const mi = $q("#scMir"); if (mi) mi.onchange = (e) => { mirror = e.target.checked; };
      const bump = (path, delta) => {
        const it = byPath[path]; if (!it) return;
        const nv = Math.max(0, it.raw + (edits[path] || 0) + delta);
        edits[path] = nv - it.raw;
        if (!edits[path]) delete edits[path];
      };
      p.querySelectorAll(".sc-row").forEach((row) => {
        const path = row.dataset.p;
        row.querySelectorAll("[data-d]").forEach((b) => b.onclick = () => {
          const delta = +b.dataset.d; bump(path, delta);
          if (mirror) { const mp = mirrorPath(path); if (mp && byPath[mp]) bump(mp, delta); }
          paintAll(true);
        });
        const r = row.querySelector("[data-r]"); if (r) r.onclick = () => { delete edits[path]; const mp = mirror && mirrorPath(path); if (mp) delete edits[mp]; paintAll(true); };
      });
      p.querySelectorAll("[data-sug]").forEach((b) => b.onclick = () => { const c = (advice.changes || []).find((x) => x.path === b.dataset.sug); if (c) { edits[c.path] = c.delta; paintAll(true); } });
    }
    function paintAll(keepScroll) {
      const sc = $q("#scPanel").scrollTop;
      paintPanel(); paintBadges(); paintBar();
      if (keepScroll) $q("#scPanel").scrollTop = sc;
    }
    function select(k) { sel = k; paintAll(); }
    paintAll();

    // recomendações (Pro): carregam depois de abrir, sem travar a tela
    if (!ctx.genLock) {
      advice = await loadAdvice(info.id);
      const f = (advice.findings || []).filter((x) => x.kind !== "ok").slice(0, 2);
      $q("#scFind").innerHTML = f.length ? f.map((x) => `<span class="sc-fd" title="${esc(x.detail || "")}">⚠ ${esc(x.title)}</span>`).join("")
        : advice.error ? `<span class="sc-fd muted">${esc(advice.error)}</span>` : `<span class="sc-fd ok">✓ Nada fora do normal nas suas últimas voltas</span>`;
      paintAll();
    } else $q("#scFind").innerHTML = `<span class="sc-fd muted">🔒 Editar e salvar são do plano Pro ou Equipe. Você pode explorar o carro e ver os valores.</span>`;
  }

  window.SetupCar = { open, brandOf, BRANDS };
})();
