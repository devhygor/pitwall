/* Pitwall · caixinha de valores em todos os gráficos (uPlot): ao passar o mouse mostra o valor de cada linha naquela posição.
   Carregar logo depois do uPlot. Gráficos que já têm leitura própria (cursor sincronizado) ficam como estão.
   Para um gráfico não ganhar a caixinha: opts.noTip = true. Para formatar um valor: series[i].value = (u, v) => "texto". */
"use strict";
(function () {
  const U = window.uPlot;
  if (!U || U.__tip) return;
  const fmtNum = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)).replace(".", ",");

  function tipPlugin(userSeries, uopts) {
    let tip, over;
    const axisFor = (u, scale) => u.axes.findIndex((a) => a.scale === scale);
    const fmtY = (u, i, v) => {
      const mine = userSeries && userSeries[i] && userSeries[i].value;
      if (typeof mine === "function") return mine(u, v, i, u.cursor.idx);
      const s = u.series[i], ai = axisFor(u, s.scale || "y"), ax = u.axes[ai];
      if (ax && typeof ax.values === "function") {
        try { const t = ax.values(u, [v], ai, 0, 1)[0]; if (t != null && t !== "") return String(t); } catch (e) { /* cai no número */ }
      }
      return fmtNum(v);
    };
    const fmtX = (u, x) => {
      const ax = u.axes[0];
      if (u.scales.x.time) return new Date(x * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      if (ax && typeof ax.values === "function") {
        try { const t = ax.values(u, [x], 0, 0, 1)[0]; if (t != null && t !== "") return String(t); } catch (e) { /* cai no número */ }
      }
      return fmtNum(x);
    };
    return {
      hooks: {
        init: (u) => {
          over = u.over;
          tip = document.createElement("div");
          tip.className = "ctip"; tip.hidden = true;
          over.appendChild(tip);
        },
        setCursor: (u) => {
          const i = u.cursor.idx, left = u.cursor.left;
          if (i == null || left == null || left < 0) { tip.hidden = true; return; }
          const x = u.data[0][i];
          let rows = "";
          for (let s = 1; s < u.series.length; s++) {
            const ser = u.series[s], v = u.data[s][i];
            if (!ser.show || v == null) continue;
            const col = (typeof ser.stroke === "function" ? ser.stroke(u, s) : ser.stroke) || "#fff";
            const c = typeof col === "string" ? col : "#fff";
            rows += `<div class="ctip-r"><i style="background:${c}"></i><span>${ser.label && ser.label !== "Value" ? ser.label : ""}</span><b>${fmtY(u, s, v)}</b></div>`;
          }
          if (!rows) { tip.hidden = true; return; }
          tip.innerHTML = `<div class="ctip-x">${uopts && uopts.xTip ? uopts.xTip(i) : fmtX(u, x)}</div>${rows}`;
          tip.hidden = false;
          const w = tip.offsetWidth, h = tip.offsetHeight, ow = over.clientWidth, oh = over.clientHeight;
          let tx = left + 14, ty = (u.cursor.top || 0) + 14;
          if (tx + w > ow) tx = left - w - 14;
          if (ty + h > oh) ty = Math.max(0, oh - h);
          tip.style.transform = `translate(${Math.max(0, tx)}px, ${Math.max(0, ty)}px)`;
        },
      },
    };
  }

  function PW(opts, data, el, cb) {
    const c = opts.cursor || {};
    if (!opts.noTip && c.show !== false && !c.sync) opts.plugins = [...(opts.plugins || []), tipPlugin(opts.series, opts)];
    return new U(opts, data, el, cb);
  }
  Object.assign(PW, U);
  PW.prototype = U.prototype;
  PW.__tip = true;
  window.uPlot = PW;
})();
