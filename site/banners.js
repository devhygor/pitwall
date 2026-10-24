/* Pitwall · gerador de banners, stickers e GIFs de divulgação (afiliados e admin).
   Tudo é desenhado no navegador (canvas): PNG estático e GIF animado, com o código e o desconto da pessoa.
   Usa a biblioteca gifenc (import dinâmico do módulo ESM) e os helpers do app.js ($, esc, toast). */
"use strict";

const BN = (() => {
  const C = { chalk: "#eef2f7", fog: "#8e9bb2", green: "#2ee59d", blue: "#3b9cff", purple: "#a77bff" };
  const FONT = `"Barlow Condensed","Arial Narrow",sans-serif`;
  const fd = (s) => `italic 800 ${Math.round(s)}px ${FONT}`;                      // títulos
  const fb = (s, w = 600) => `${w} ${Math.round(s)}px "Barlow","Segoe UI",sans-serif`; // texto
  const TAU = Math.PI * 2;
  const LOOP = 14400;          // duração de um ciclo completo da animação (ms)
  let G = 0;                  // progresso do ciclo (0..1) do quadro que está sendo desenhado
  const LIVE = ["camera", "faixa", "canto", "quadradinho", "painel"];
  // recursos mostrados nas cenas "detalhes": título + duas linhas de apoio
  const FEATS = [
    { t: "ENGENHEIRO DE VOZ", s: ["Fala português e avisa", "tudo o que rola na pista"] },
    { t: "TELEMETRIA AUTOMÁTICA", s: ["Cada volta gravada sozinha", "com delta e comparação"] },
    { t: "OVERLAYS NO JOGO", s: ["Delta, pneus e mapa", "por cima do ACC e iRacing"] },
    { t: "SETUPS PRONTOS", s: ["Biblioteca e gerador", "com editor 3D do carro"] },
  ];
  const MARK_BOX = new Path2D("M10 3h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7H10a7 7 0 0 1-7-7V10a7 7 0 0 1 7-7z");
  const MARK_P = new Path2D("M10 22V10h6.5a4 4 0 0 1 0 8H10");

  const T = (x, s, X, Y, font, fill, align = "left", base = "alphabetic") => { x.font = font; x.textAlign = align; x.textBaseline = base; x.fillStyle = fill; x.fillText(s, X, Y); };
  const fit = (x, s, fn, maxW, size) => { while (size > 10) { x.font = fn(size); if (x.measureText(s).width <= maxW) break; size -= 2; } return size; };
  const wid = (x, s, font) => { x.font = font; return x.measureText(s).width; };
  // texto com degradê verde→azul→roxo que desliza devagar (volta ao início no fim do ciclo)
  function GT(x, s, X, Y, font, t, align = "left", base = "alphabetic") {
    const W = wid(x, s, font), x0 = align === "center" ? X - W / 2 : align === "right" ? X - W : X, sh = Math.sin(t * TAU) * W * .35;
    const g = x.createLinearGradient(x0 - W * .3 + sh, 0, x0 + W * 1.3 + sh, 0);
    g.addColorStop(0, C.green); g.addColorStop(.5, C.blue); g.addColorStop(1, C.purple);
    T(x, s, X, Y, font, g, align, base);
  }
  const rr = (x, X, Y, w, h, r) => { x.beginPath(); x.roundRect(X, Y, w, h, r); };

  // vira o conteúdo como uma carta: n "slides" por ciclo, fn(i) desenha o slide i
  function flip(x, X, Y, n, fn) {
    const k = G * n, i = Math.floor(k) % n, u = k - Math.floor(k), s = u < .16 ? u / .16 : u > .84 ? (1 - u) / .16 : 1;
    x.save(); x.translate(X, Y); x.scale(1, Math.max(.02, s)); x.translate(-X, -Y); fn(i); x.restore();
  }

  function bg(x, w, h, t) {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#0a101a"); g.addColorStop(1, "#18233a"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const a = t * TAU, R = Math.max(w, h) * .75;
    const blob = (X, Y, r, rgb, al) => { const q = x.createRadialGradient(X, Y, 0, X, Y, r); q.addColorStop(0, `rgba(${rgb},${al})`); q.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = q; x.fillRect(0, 0, w, h); };
    blob(w * (.2 + .15 * Math.cos(a)), h * (.25 + .2 * Math.sin(a)), R, "46,229,157", .30);
    blob(w * (.85 + .1 * Math.sin(a)), h * (.8 + .15 * Math.cos(a)), R, "59,156,255", .30);
    blob(w * (.6 + .2 * Math.cos(a + 2)), h * (.1 + .15 * Math.sin(a + 2)), R * .7, "167,123,255", .22);
    // faixas inclinadas que correm sem parar
    const P = Math.max(w, h) * .16, sk = h * .6;
    x.save(); x.fillStyle = "rgba(255,255,255,.05)";
    for (let i = 0; i < Math.ceil((w + sk) / P) + 2; i++) { const X = -sk + (i + t) * P; x.beginPath(); x.moveTo(X, 0); x.lineTo(X + P * .22, 0); x.lineTo(X + P * .22 - sk, h); x.lineTo(X - sk, h); x.fill(); }
    x.restore();
    const bar = x.createLinearGradient(0, 0, w, 0); bar.addColorStop(0, C.green); bar.addColorStop(.55, C.blue); bar.addColorStop(1, C.purple);
    x.fillStyle = bar; x.fillRect(0, 0, w, Math.max(4, h * .012));
  }
  function shine(x, w, h, t) {          // brilho que cruza o banner uma vez por ciclo
    if (t < .6 || t > .9) return;
    const p = (t - .6) / .3, X = -w * .3 + p * w * 1.6, bw = w * .16, sk = h * .5;
    const g = x.createLinearGradient(X, 0, X + bw, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, "rgba(255,255,255,.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.save(); x.fillStyle = g; x.beginPath(); x.moveTo(X + sk, 0); x.lineTo(X + sk + bw, 0); x.lineTo(X + bw, h); x.lineTo(X, h); x.fill(); x.restore();
  }
  function mark(x, X, Y, s) {
    x.save(); x.translate(X, Y); x.scale(s / 32, s / 32);
    const u = (G * 4) % 1, sx = u < .25 ? Math.cos(u / .25 * TAU) : 1;      // gira como uma moeda a cada cena
    x.translate(16, 0); x.scale(Math.abs(sx) < .04 ? .04 : sx, 1); x.translate(-16, 0);
    const g = x.createLinearGradient(3, 3, 29, 29); g.addColorStop(0, C.green); g.addColorStop(.55, C.blue); g.addColorStop(1, "#b98cff");
    x.strokeStyle = g; x.lineWidth = 2.5; x.lineJoin = "round"; x.stroke(MARK_BOX); x.stroke(MARK_P);
    x.fillStyle = "#b98cff"; x.beginPath(); x.arc(22, 22, 2.4, 0, TAU); x.fill(); x.restore();
  }
  function logo(x, X, Y, s) { mark(x, X, Y, s); T(x, "Pitwall", X + s * 1.2, Y + s * .52, fd(s * .95), C.chalk, "left", "middle"); return s * 1.2 + wid(x, "Pitwall", fd(s * .95)); }
  function pop(x, cx, cy, t, fn) { const k = 1 + .035 * Math.sin(t * TAU); x.save(); x.translate(cx, cy); x.scale(k, k); x.translate(-cx, -cy); fn(); x.restore(); }

  // caixa do código: borda tracejada que "anda" e brilho que pulsa
  function codeBox(x, X, Y, w, h, o, t) {
    const pulse = .5 + .5 * Math.sin(t * TAU), lbl = h >= 100;
    x.save(); rr(x, X, Y, w, h, h * .22); x.fillStyle = "rgba(46,229,157,.12)"; x.fill();
    x.shadowColor = `rgba(46,229,157,${.25 + .45 * pulse})`; x.shadowBlur = h * .25; x.strokeStyle = C.green; x.lineWidth = Math.max(2, h * .035);
    x.setLineDash([h * .12, h * .07]); x.lineDashOffset = -t * h * .19; x.stroke(); x.restore();
    const s = fit(x, o.code, fd, w * .86, h * (lbl ? .5 : .62));
    if (lbl) { T(x, "USE O CÓDIGO", X + w / 2, Y + h * .27, fb(h * .17, 700), C.fog, "center", "middle"); T(x, o.code, X + w / 2, Y + h * .68, fd(s), C.chalk, "center", "middle"); }
    else T(x, o.code, X + w / 2, Y + h / 2 + h * .03, fd(s), C.chalk, "center", "middle");
  }
  const durTxt = (o) => (o.duration === "forever" ? "enquanto for assinante" : "no primeiro pagamento");
  const link = "pitwall.hygor.com.br";

  // ----------------------------------------------------------------- formatos
  const FORMATS = [
    { id: "story", name: "Stories do Instagram", use: "Vertical 9:16 (Stories e Reels). O conteúdo fica na área segura.", w: 1080, h: 1920, gif: .35, n: 90, dl: 160, draw(x, o, t) {
      bg(x, 1080, 1920, t); logo(x, 80, 250, 96);
      const lines = ["SEU ENGENHEIRO", "DE CORRIDA", "EM PORTUGUÊS"], sz = Math.min(...lines.map((l) => fit(x, l, fd, 920, 140)));
      T(x, lines[0], 540, 520, fd(sz), C.chalk, "center"); T(x, lines[1], 540, 520 + sz * 1.0, fd(sz), C.chalk, "center"); GT(x, lines[2], 540, 520 + sz * 2.0, fd(sz), t, "center");
      T(x, "Telemetria, overlays e voz para ACC e iRacing", 540, 520 + sz * 2.0 + 70, fb(38), C.fog, "center");
      if (o.pct > 0) { pop(x, 540, 1040, t, () => GT(x, o.pct + "%", 540, 1090, fd(330), t, "center")); T(x, "DE DESCONTO", 540, 1180, fd(92), C.chalk, "center"); T(x, durTxt(o), 540, 1236, fb(38), C.fog, "center"); }
      codeBox(x, 120, 1280, 840, 190, o, t); T(x, link + "  ·  baixe grátis", 540, 1540, fb(38), C.fog, "center"); shine(x, 1080, 1920, t);
    } },
    { id: "quadrado", name: "Post quadrado", use: "Feed do Instagram, X, Discord e WhatsApp (1:1).", w: 1080, h: 1080, gif: .4, n: 90, dl: 160, draw(x, o, t) {
      bg(x, 1080, 1080, t); logo(x, 70, 64, 80);
      const sz = fit(x, "ENGENHEIRO DE CORRIDA", fd, 940, 130);
      T(x, "ENGENHEIRO DE CORRIDA", 70, 290, fd(sz), C.chalk); GT(x, "EM PORTUGUÊS", 70, 290 + sz * .98, fd(sz), t);
      T(x, "Telemetria, overlays e voz para ACC e iRacing", 70, 290 + sz * .98 + 56, fb(32), C.fog);
      if (o.pct > 0) { const nf = fd(290), W = wid(x, o.pct + "%", nf); pop(x, 70 + W / 2, 640, t, () => GT(x, o.pct + "%", 70, 770, nf, t));
        T(x, "DE", 70 + W + 30, 680, fd(70), C.chalk); T(x, "DESCONTO", 70 + W + 30, 755, fd(84), C.chalk); T(x, durTxt(o), 70, 825, fb(32), C.fog); }
      codeBox(x, 70, 850, 940, 150, o, t); T(x, link, 540, 1046, fb(28), C.fog, "center"); shine(x, 1080, 1080, t);
    } },
    { id: "camera", name: "Barra embaixo da câmera", use: "Barra fininha para colar logo abaixo da sua câmera na live (OBS, Streamlabs). Mesma proporção das da imagem.", w: 940, h: 180, gif: .6, alpha: true, r: 22, draw(x, o, t) {
      x.save(); rr(x, 0, 0, 940, 180, 22); x.clip(); bg(x, 940, 180, t);
      mark(x, 30, 26, 80); T(x, "PITWALL", 70, 140, fd(30), C.chalk, "center", "middle");
      const X0 = 150, W = 770, cx = X0 + W / 2;
      const offer = o.pct > 0 ? `${o.pct}% DE DESCONTO NA ASSINATURA` : "ENGENHEIRO DE CORRIDA EM PORTUGUÊS";
      GT(x, offer, cx, 70, fd(fit(x, offer, fd, W, 56)), t, "center", "middle");
      const a = "USE O CÓDIGO: ", sa = fit(x, a + o.code, fd, W, 70), w1 = wid(x, a, fd(sa)), w2 = wid(x, o.code, fd(sa * 1.08)), x1 = cx - (w1 + w2) / 2;
      T(x, a, x1, 132, fd(sa), C.chalk, "left", "middle");
      x.save(); x.shadowColor = `rgba(46,229,157,${.3 + .4 * (.5 + .5 * Math.sin(t * TAU))})`; x.shadowBlur = 22; T(x, o.code, x1 + w1, 132, fd(sa * 1.08), C.green, "left", "middle"); x.restore();
      shine(x, 940, 180, t); x.restore();
    } },
    { id: "faixa", name: "Faixa larga", use: "Faixa de uma ponta a outra, para o rodapé da live ou uma capa horizontal.", w: 1280, h: 200, gif: .6, draw(x, o, t) {
      bg(x, 1280, 200, t); logo(x, 36, 62, 72);
      const s = fit(x, "ENGENHEIRO DE CORRIDA", fd, 340, 44);
      T(x, "ENGENHEIRO DE CORRIDA", 340, 90, fd(s), C.chalk, "left", "middle"); GT(x, "EM PORTUGUÊS", 340, 90 + s * .95, fd(s), t, "left", "middle");
      if (o.pct > 0) { GT(x, o.pct + "% OFF", 700, 92, fd(fit(x, o.pct + "% OFF", fd, 230, 110)), t, "left", "middle"); T(x, durTxt(o), 702, 160, fb(22), C.fog); }
      codeBox(x, 950, 36, 300, 128, o, t); shine(x, 1280, 200, t);
    } },
    { id: "canto", name: "Fita no canto (diagonal)", use: "Fita diagonal com fundo transparente, para o canto da tela ou da câmera. Escolha o canto acima.", w: 500, h: 500, gif: .6, alpha: true, draw(x, o, t) {
      const S = 500, k = o.corner || "tl", cfg = { tl: [.31, .31, -45], tr: [.69, .31, 45], bl: [.31, .69, 45], br: [.69, .69, -45] }[k] || [.31, .31, -45];
      x.save(); x.translate(S * cfg[0], S * cfg[1]); x.rotate(cfg[2] * Math.PI / 180);
      const bh = 124; x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = 18; x.shadowOffsetY = 6;
      x.beginPath(); x.rect(-S, -bh / 2, S * 2, bh); x.clip();
      x.fillStyle = "#101826"; x.fillRect(-S, -bh / 2, S * 2, bh); x.shadowColor = "transparent";
      const g = x.createLinearGradient(-S, 0, S, 0); g.addColorStop(0, C.green); g.addColorStop(.5, C.blue); g.addColorStop(1, C.purple);
      x.fillStyle = g; x.fillRect(-S, -bh / 2, S * 2, 7); x.fillRect(-S, bh / 2 - 7, S * 2, 7);
      const W = 330, st = [[o.pct > 0 ? `PITWALL · ${o.pct}% OFF` : "PITWALL", "CÓDIGO: " + o.code, 1], [FEATS[0].t, "pitwall.hygor.com.br", 0], ["USE O CÓDIGO", o.code, 1], [FEATS[1].t, "baixe grátis", 0]];
      flip(x, 0, 0, 4, (i) => { const [l1, l2, hi] = st[i], s1 = fit(x, l1, fd, W, 46), s2 = fit(x, l2, fd, W, 52);
        T(x, l1, 0, -22, fd(s1), C.chalk, "center", "middle");
        x.save(); if (hi) { x.shadowColor = `rgba(46,229,157,${.3 + .4 * (.5 + .5 * Math.sin(t * TAU))})`; x.shadowBlur = 16; } T(x, l2, 0, 24, fd(s2), hi ? C.green : C.fog, "center", "middle"); x.restore(); });
      const p = t < .6 || t > .9 ? null : (t - .6) / .3;
      if (p != null) { const X = -S + p * S * 2, sg = x.createLinearGradient(X, 0, X + 90, 0); sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(.5, "rgba(255,255,255,.28)"); sg.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = sg; x.fillRect(X, -bh / 2, 90, bh); }
      x.restore();
    } },
    { id: "quadradinho", name: "Quadradinho", use: "Selo pequeno com cantos arredondados e fundo transparente. Coloque em cima ou ao lado da câmera.", w: 400, h: 400, gif: .75, alpha: true, r: 44, draw(x, o, t) {
      x.save(); rr(x, 0, 0, 400, 400, 44); x.clip(); bg(x, 400, 400, t); logo(x, 30, 28, 44);
      if (o.pct > 0) { pop(x, 200, 160, t, () => GT(x, o.pct + "%", 200, 235, fd(190), t, "center")); T(x, "DE DESCONTO", 200, 282, fd(46), C.chalk, "center"); }
      codeBox(x, 24, o.pct > 0 ? 306 : 190, 352, 72, o, t); shine(x, 400, 400, t); x.restore();
    } },
    { id: "painel", name: "Painel da Twitch", use: "Painel para colocar abaixo do vídeo no seu canal da Twitch (largura de 320 px, aqui em alta resolução).", w: 640, h: 260, gif: .75, draw(x, o, t) {
      bg(x, 640, 260, t); logo(x, 28, 22, 52);
      if (o.pct > 0) GT(x, o.pct + "% OFF", 612, 50, fd(fit(x, o.pct + "% OFF", fd, 250, 66)), t, "right", "middle");
      T(x, "Engenheiro de corrida em português", 28, 116, fb(25), C.fog); codeBox(x, 28, 140, 584, 88, o, t);
      T(x, link, 320, 246, fb(18), C.fog, "center"); shine(x, 640, 260, t);
    } },
    { id: "capa", name: "Capa do canal (Twitch / YouTube)", use: "Banner de perfil 1200×480 para a Twitch (serve também como capa de outras redes).", w: 1200, h: 480, gif: .6, draw(x, o, t) {
      bg(x, 1200, 480, t); logo(x, 60, 56, 88);
      const lines = ["SEU ENGENHEIRO", "DE CORRIDA"], sz = fit(x, "SEU ENGENHEIRO", fd, 620, 100);
      T(x, lines[0], 60, 220, fd(sz), C.chalk); T(x, lines[1], 60, 220 + sz * .95, fd(sz), C.chalk); GT(x, "EM PORTUGUÊS", 60, 220 + sz * 1.9, fd(sz), t);
      T(x, "Telemetria, overlays e voz para ACC e iRacing  ·  " + link, 60, 440, fb(26), C.fog);
      if (o.pct > 0) { pop(x, 930, 170, t, () => GT(x, o.pct + "%", 930, 262, fd(250), t, "center")); T(x, "DE DESCONTO", 930, 322, fd(58), C.chalk, "center"); }
      codeBox(x, 750, 340, 360, 100, o, t); shine(x, 1200, 480, t);
    } },
  ];

  FORMATS.forEach((f, i) => { f.fi = i; f.scenes = f.id !== "canto"; });

  // ----------------------------------------------------------------- cenas: o modelo inteiro troca de tempos em tempos
  // 0 oferta (o desenho principal do formato) · 1 recurso · 2 código gigante · 3 outro recurso
  const SCENES = [[0, 0], [1, 0], [2, 0], [1, 1]];
  function generic(x, f, o, t, v, feat) {
    const w = f.w, h = f.h, a = w / h, F = FEATS[feat], mode = a >= 3.5 ? "wide" : a >= 1.8 ? "mid" : "box", pulse = .5 + .5 * Math.sin(t * TAU);
    const glow = (fn) => { x.save(); x.shadowColor = `rgba(46,229,157,${.3 + .4 * pulse})`; x.shadowBlur = h * .06; fn(); x.restore(); };
    bg(x, w, h, t);
    if (mode === "wide") {
      mark(x, h * .22, h * .25, h * .5); const X0 = h * 1.05, W = w - X0 - h * .25;
      if (v === 1) { GT(x, F.t, X0, h * .36, fd(fit(x, F.t, fd, W, h * .36)), t, "left", "middle"); const sub = F.s.join(" "); T(x, sub, X0, h * .74, fb(fit(x, sub, fb, W, h * .17)), C.fog, "left", "middle"); }
      else { T(x, "USE O CÓDIGO", X0, h * .2, fb(h * .13, 700), C.fog, "left", "middle");
        const cs = fit(x, o.code, fd, W * .6, h * .62); glow(() => T(x, o.code, X0, h * .62, fd(cs), C.chalk, "left", "middle"));
        if (o.pct > 0) { const ps = o.pct + "% OFF"; GT(x, ps, w - h * .25, h * .42, fd(fit(x, ps, fd, W * .32, h * .5)), t, "right", "middle"); T(x, durTxt(o), w - h * .25, h * .78, fb(h * .1), C.fog, "right", "middle"); } }
    } else if (mode === "mid") {
      logo(x, w * .05, h * .08, h * .17);
      if (v === 1) { GT(x, F.t, w * .06, h * .46, fd(fit(x, F.t, fd, w * .88, h * .2)), t, "left", "middle");
        T(x, F.s[0], w * .06, h * .63, fb(h * .085), C.fog, "left", "middle"); T(x, F.s[1], w * .06, h * .74, fb(h * .085), C.fog, "left", "middle"); codeBox(x, w * .06, h * .81, w * .88, h * .14, o, t); }
      else { T(x, "USE O CÓDIGO", w / 2, h * .3, fb(h * .075, 700), C.fog, "center", "middle");
        const cs = fit(x, o.code, fd, w * .8, h * .36); glow(() => T(x, o.code, w / 2, h * .54, fd(cs), C.chalk, "center", "middle"));
        if (o.pct > 0) { const ps = `${o.pct}% DE DESCONTO`; GT(x, ps, w / 2, h * .77, fd(fit(x, ps, fd, w * .8, h * .12)), t, "center", "middle"); T(x, durTxt(o), w / 2, h * .9, fb(h * .06), C.fog, "center", "middle"); } }
    } else {
      logo(x, w * .07, a < .7 ? h * .13 : a < 1.1 && h > 500 ? h * .06 : h * .07, w * .09); const bh = Math.min(h * .14, w * .18), big = h > 500;
      if (v === 1) { GT(x, F.t, w / 2, h * .38, fd(fit(x, F.t, fd, w * .88, w * .16)), t, "center", "middle");
        const ss = fit(x, F.s[1], fb, w * .88, w * .05); T(x, F.s[0], w / 2, h * .38 + w * .1, fb(ss), C.fog, "center", "middle"); T(x, F.s[1], w / 2, h * .38 + w * .16, fb(ss), C.fog, "center", "middle");
        codeBox(x, w * .08, h * .64, w * .84, bh, o, t); if (big) T(x, link, w / 2, h * .64 + bh + w * .06, fb(w * .032), C.fog, "center", "middle"); }
      else { T(x, "USE O CÓDIGO", w / 2, h * .3, fb(w * .05, 700), C.fog, "center", "middle");
        const cs = fit(x, o.code, fd, w * .9, w * .22); glow(() => T(x, o.code, w / 2, h * .44, fd(cs), C.chalk, "center", "middle"));
        if (o.pct > 0) { const ps = `${o.pct}% DE DESCONTO`; GT(x, ps, w / 2, h * .58, fd(fit(x, ps, fd, w * .9, w * .1)), t, "center", "middle"); T(x, durTxt(o), w / 2, h * .58 + w * .085, fb(w * .036), C.fog, "center", "middle"); }
        if (big) T(x, link, w / 2, h * .72, fb(w * .034), C.fog, "center", "middle"); }
    }
    shine(x, w, h, t);
  }
  const drawScene = (x, f, o, t, i) => { const [v, fo] = SCENES[i]; if (v === 0) f.draw(x, o, t); else generic(x, f, o, t, v, (f.fi * 2 + fo) % FEATS.length); };
  function frame(x, f, o, g) {
    const t = (g * 10) % 1; G = g;
    if (!f.scenes) return f.draw(x, o, t);
    const n = SCENES.length, k = g * n, i = Math.floor(k) % n, u = k - Math.floor(k);
    x.save(); if (f.r) { rr(x, 0, 0, f.w, f.h, f.r); x.clip(); }
    if (u < .12) {                                           // transição: slide nas cenas ímpares, virada nas pares
      const p = 1 - Math.pow(1 - u / .12, 3), prev = (i + n - 1) % n;
      if (i % 2 === 1) { x.save(); x.translate(-p * f.w, 0); drawScene(x, f, o, t, prev); x.restore(); x.save(); x.translate((1 - p) * f.w, 0); drawScene(x, f, o, t, i); x.restore(); }
      else { const sc = p < .5 ? 1 - p * 2 : p * 2 - 1; x.translate(0, f.h / 2); x.scale(1, Math.max(.02, sc)); x.translate(0, -f.h / 2); drawScene(x, f, o, t, p < .5 ? prev : i); }
    } else drawScene(x, f, o, t, i);
    x.restore();
  }

  const ready = () => Promise.all([document.fonts.load(`italic 800 40px "Barlow Condensed"`), document.fonts.load(`600 20px Barlow`)]).catch(() => {});
  const opts = (o) => ({ code: (o.code || "SEUCODIGO").toUpperCase(), pct: Math.max(0, Math.min(100, +o.pct || 0)), duration: o.duration, corner: o.corner });
  function paint(cv, f, o, g, scale) {
    cv.width = Math.round(f.w * scale); cv.height = Math.round(f.h * scale);
    const x = cv.getContext("2d", { willReadFrequently: true }); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.scale(scale, scale); frame(x, f, o, g); return x;
  }
  const save = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const fname = (f, o, ext) => `pitwall-${o.code.toLowerCase()}-${f.id}.${ext}`;

  async function exportPng(f, o) {
    await ready(); const cv = document.createElement("canvas"); paint(cv, f, o, .1, 1);
    cv.toBlob((b) => save(b, fname(f, o, "png")), "image/png");
  }
  async function exportGif(f, o, prog) {
    await ready();
    const { GIFEncoder, quantize, applyPalette } = await import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js"), N = f.n || 120, dl = f.dl || 120, cv = document.createElement("canvas"), gif = GIFEncoder();
    for (let i = 0; i < N; i++) {
      const x = paint(cv, f, o, i / N, f.gif), { data } = x.getImageData(0, 0, cv.width, cv.height);
      if (f.alpha) {
        const pal = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true }), idx = applyPalette(data, pal, "rgba4444"), ti = pal.findIndex((c) => c[3] === 0);
        gif.writeFrame(idx, cv.width, cv.height, { palette: pal, delay: dl, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: 2 });
      } else {
        const pal = quantize(data, 256), idx = applyPalette(data, pal);
        gif.writeFrame(idx, cv.width, cv.height, { palette: pal, delay: dl });
      }
      prog && prog(Math.round(((i + 1) / N) * 100)); await new Promise((r) => setTimeout(r));
    }
    gif.finish(); save(new Blob([gif.bytes()], { type: "image/gif" }), fname(f, o, "gif"));
  }

  // GIF que aparece por `show` s e some por (every - show) s: o último quadro é transparente e dura o intervalo todo
  async function exportGifBlink(f, o, show, every, prog) {
    await ready();
    const { GIFEncoder, quantize, applyPalette } = await import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js");
    const dl = 100, n = Math.round(show * 1000 / dl), cv = document.createElement("canvas"), gif = GIFEncoder();
    for (let i = 0; i < n; i++) {
      const x = paint(cv, f, o, ((i * dl) % LOOP) / LOOP, f.gif), { data } = x.getImageData(0, 0, cv.width, cv.height);
      const pal = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true }), idx = applyPalette(data, pal, "rgba4444"), ti = pal.findIndex((c) => c[3] === 0);
      gif.writeFrame(idx, cv.width, cv.height, { palette: pal, delay: dl, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: 2 });
      prog && prog(Math.round(((i + 1) / n) * 100)); await new Promise((r) => setTimeout(r));
    }
    gif.writeFrame(new Uint8Array(cv.width * cv.height), cv.width, cv.height, { palette: [[0, 0, 0], [0, 0, 0]], transparent: true, transparentIndex: 0, delay: Math.max(500, (every - show) * 1000), dispose: 2 });
    gif.finish(); save(new Blob([gif.bytes()], { type: "image/gif" }), `pitwall-${o.code.toLowerCase()}-${f.id}-intermitente.gif`);
  }

  // ----------------------------------------------------------------- tela
  // cfg: { code, pct, duration, editable (admin pode trocar o código/desconto), affiliates (lista para escolher no admin) }
  async function studio(host, cfg) {
    const st = { code: cfg.code || "", pct: cfg.pct ?? 10, duration: cfg.duration || "once", corner: "tl" };
    const picker = cfg.editable && (cfg.affiliates || []).length
      ? `<select id="bnAf"><option value="">Escolher um afiliado…</option>${cfg.affiliates.map((a) => `<option value="${esc(a.code)}" data-pct="${a.discount_pct}" data-dur="${esc(a.discount_duration)}">${esc(a.name)} (${esc(a.code)})</option>`).join("")}</select>` : "";
    host.innerHTML = `<div class="panel bn"><h2>Banners e GIFs de divulgação</h2>
      <p class="sub">Imagens prontas com ${cfg.editable ? "o código que você digitar" : "o seu código"} e o desconto. Baixe em <b>PNG</b> (imagem parada) ou <b>GIF</b> (animado) e use na live (OBS: fonte de imagem/navegador), nos Stories, na Twitch ou mande para seus membros colocarem nas lives deles.</p>
      <div class="adm-form">${picker}
        <label class="bn-f">Código <input id="bnCode" type="text" maxlength="30" value="${esc(st.code)}" ${cfg.editable ? "" : "readonly"} placeholder="SEUCODIGO"></label>
        <label class="bn-f">Desconto % <input id="bnPct" type="number" min="0" max="100" value="${st.pct}" ${cfg.editable ? "" : "readonly"} style="width:80px"></label>
        <label class="bn-f">Valor do desconto <select id="bnDur" ${cfg.editable ? "" : "disabled"}><option value="once">no primeiro pagamento</option><option value="forever">em todos os pagamentos</option></select></label>
        <label class="bn-f">Canto da fita <select id="bnCorner"><option value="tl">Superior esquerdo</option><option value="tr">Superior direito</option><option value="bl">Inferior esquerdo</option><option value="br">Inferior direito</option></select></label></div>
      <div class="bn-grid">${FORMATS.map((f) => `<div class="bn-card" data-f="${f.id}"><div class="bn-prev ${f.alpha ? "chk" : ""}"><canvas></canvas></div>
        <h3>${esc(f.name)} <small class="sub">${f.w}×${f.h}</small></h3><p class="sub">${esc(f.use)}</p>
        <div class="row-actions"><button class="btn small" data-png>Baixar PNG</button><button class="btn go small" data-gif>Baixar GIF</button></div></div>`).join("")}</div></div>
      <div class="panel bn" style="margin-top:16px"><h2>Aparecer na live de tempos em tempos</h2>
        <p class="sub">Em vez de ficar parado na tela o tempo todo, o banner entra deslizando, fica alguns segundos e sai, e repete. Tem dois jeitos:</p>
        <div class="adm-form">
          <label class="bn-f">Formato <select id="bnLfmt">${LIVE.map((id) => `<option value="${id}">${FORMATS.find((q) => q.id === id).name}</option>`).join("")}</select></label>
          <label class="bn-f">Aparece a cada (segundos) <input id="bnEvery" type="number" min="10" max="3600" value="120" style="width:110px"></label>
          <label class="bn-f">Fica na tela (segundos) <input id="bnShow" type="number" min="3" max="60" value="15" style="width:110px"></label>
          <label class="bn-f">Posição <select id="bnPos"><option value="top">Em cima</option><option value="bottom">Embaixo</option></select></label></div>
        <h3 style="margin:10px 0 4px">1) Fonte de navegador do OBS (recomendado)</h3>
        <code class="lickey" id="bnUrl" style="word-break:break-all"></code>
        <div class="row-actions"><button class="btn go small" id="bnCopy">Copiar link</button><a class="btn small" id="bnTest" target="_blank" rel="noopener">Ver como fica</a></div>
        <p class="sub">No OBS: <b>Fontes → + → Navegador</b>, cole o link em <b>URL</b> e coloque a largura e a altura do formato (ex.: 940×180 na barra da câmera). Depois arraste a fonte para o lugar que quiser, por exemplo logo abaixo da câmera. O fundo já é transparente. Funciona igual no Streamlabs e no TikTok Live Studio.</p>
        <h3 style="margin:10px 0 4px">2) GIF que some sozinho</h3>
        <p class="sub">Um GIF só, que mostra o banner e depois fica invisível até repetir. Adicione como <b>Fonte de imagem</b> no OBS. Alguns programas ignoram pausas muito longas; se o seu fizer isso, use o link do OBS.</p>
        <div class="row-actions"><button class="btn small" id="bnBlink">Baixar GIF intermitente</button></div></div>`;
    $("#bnDur").value = st.duration;
    const liveUrl = (extra) => { const p = new URLSearchParams({ code: st.code, pct: st.pct, dur: st.duration, fmt: $("#bnLfmt").value, corner: st.corner, every: $("#bnEvery").value, show: $("#bnShow").value, pos: $("#bnPos").value });
      return location.origin + "/banner-live/?" + p + (extra || ""); };
    const refreshUrl = () => { $("#bnUrl").textContent = liveUrl(); $("#bnTest").href = liveUrl("&preview=1"); };
    $("#bnCopy").onclick = async () => { await navigator.clipboard.writeText(liveUrl()); $("#bnCopy").textContent = "Copiado!"; toast("Link copiado", "ok"); setTimeout(() => { $("#bnCopy").textContent = "Copiar link"; }, 2000); };
    $("#bnBlink").onclick = async (ev) => { const b = ev.currentTarget, old = b.textContent; b.disabled = true;
      try { const e = Math.max(10, +$("#bnEvery").value || 120), s = Math.min(e - 2, Math.max(3, +$("#bnShow").value || 15)); await exportGifBlink(FORMATS.find((q) => q.id === $("#bnLfmt").value), opts(st), s, e, (p) => { b.textContent = p + "%"; }); } catch (e) { toast(e.message, "err"); }
      b.textContent = old; b.disabled = false; };
    const read = () => { st.code = $("#bnCode").value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""); st.pct = +$("#bnPct").value || 0; st.duration = $("#bnDur").value; st.corner = $("#bnCorner").value; };
    ["bnCode", "bnPct", "bnDur", "bnCorner"].forEach((id) => { $("#" + id).oninput = () => { read(); refreshUrl(); }; });
    ["bnLfmt", "bnEvery", "bnShow", "bnPos"].forEach((id) => { $("#" + id).oninput = refreshUrl; });
    read(); refreshUrl();
    const af = $("#bnAf"); if (af) af.onchange = () => { const o = af.selectedOptions[0]; if (!o.value) return; $("#bnCode").value = o.value; $("#bnPct").value = o.dataset.pct; $("#bnDur").value = o.dataset.dur === "forever" ? "forever" : "once"; read(); refreshUrl(); };
    host.querySelectorAll(".bn-card").forEach((c) => {
      const f = FORMATS.find((q) => q.id === c.dataset.f);
      c.querySelector("[data-png]").onclick = async () => { try { exportPng(f, opts(st)); } catch (e) { toast(e.message, "err"); } };
      c.querySelector("[data-gif]").onclick = async (ev) => {
        const b = ev.currentTarget, old = b.textContent; b.disabled = true;
        try { await exportGif(f, opts(st), (p) => { b.textContent = p + "%"; }); } catch (e) { toast(e.message, "err"); }
        b.textContent = old; b.disabled = false;
      };
    });
    await ready();
    const cards = [...host.querySelectorAll(".bn-card")].map((c) => ({ cv: c.querySelector("canvas"), f: FORMATS.find((q) => q.id === c.dataset.f), el: c }));
    const tick = () => {
      if (!host.isConnected) return clearInterval(timer);
      const o = opts(st), t = (Date.now() % LOOP) / LOOP;
      for (const { cv, f, el } of cards) { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; paint(cv, f, o, t, Math.min(1, 520 / f.w)); }
    };
    const timer = setInterval(tick, 90); tick();
  }
  return { studio, paint, FORMATS, opts, ready, LOOP };
})();
