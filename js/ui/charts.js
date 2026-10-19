
/* Skip artifact shell — fixed helpers served beside every artifact. */
(function () {
  "use strict";

  var fmt = {
    num: function (v, opts) { return new Intl.NumberFormat("pt-BR", opts || {}).format(v); },
    brl: function (v) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v); },
    pct: function (v) { return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(v); }
  };

  // axisFmt keeps axis tick labels short (compact notation) so long values
  // (e.g. full BRL amounts) never clip against the plot edge.
  function axisFmt(v) {
    return fmt.num(v, { notation: "compact", maximumFractionDigits: 1 });
  }

  // format accepts a function OR one of the fmt names ("num" | "brl" | "pct").
  function coerceFormat(spec) {
    if (typeof spec === "function") return spec;
    if (typeof spec === "string" && fmt[spec]) return fmt[spec];
    return function (v) { return fmt.num(v); };
  }

  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2563eb";
  }
  function mutedColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#5b6472";
  }
  function svgEl(tag, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function frame(el, w, h) {
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, role: "img" });
    el.innerHTML = "";
    el.appendChild(svg);
    return svg;
  }

  // maxOf guards the axis scale: empty values would give -Infinity (truthy,
  // so "|| 1" can't catch it) and a non-positive max would flip the chart.
  function maxOf(values) {
    var m = values.length ? Math.max.apply(null, values) : 0;
    return m > 0 ? m : 1;
  }

  // bar(el, {labels:[], values:[], color?, format?}) — vertical bar chart.
  function bar(el, cfg) {
    var W = 640, H = 280, padL = 46, padB = 30, padT = 12;
    var svg = frame(el, W, H);
    var max = maxOf(cfg.values);
    var n = cfg.values.length;
    var plotW = W - padL - 12, plotH = H - padT - padB;
    var step = plotW / n, bw = Math.min(step * 0.62, 64);
    var color = cfg.color || accent();
    var f = coerceFormat(cfg.format);
    for (var g = 0; g <= 4; g++) {
      var gy = padT + plotH - (plotH * g) / 4;
      svg.appendChild(svgEl("line", { x1: padL, y1: gy, x2: W - 12, y2: gy, stroke: "currentColor", "stroke-opacity": 0.08 }));
      var lbl = svgEl("text", { x: padL - 8, y: gy + 4, "text-anchor": "end", "font-size": 10, fill: mutedColor() });
      lbl.textContent = axisFmt((max * g) / 4);
      svg.appendChild(lbl);
    }
    cfg.values.forEach(function (v, i) {
      var bh = Math.max(0, (v / max) * plotH);
      var x = padL + i * step + (step - bw) / 2;
      var y = padT + plotH - bh;
      var r = svgEl("rect", { x: x, y: y, width: bw, height: bh, rx: 4, fill: color });
      var t = svgEl("title", {});
      t.textContent = cfg.labels[i] + ": " + f(v);
      r.appendChild(t);
      svg.appendChild(r);
      var tx = svgEl("text", { x: x + bw / 2, y: H - 10, "text-anchor": "middle", "font-size": 11, fill: mutedColor() });
      tx.textContent = cfg.labels[i];
      svg.appendChild(tx);
    });
  }

  // line(el, {labels:[], values:[], color?, format?}) — single-series line.
  function line(el, cfg) {
    var W = 640, H = 280, padL = 46, padB = 30, padT = 12;
    var svg = frame(el, W, H);
    var max = maxOf(cfg.values);
    var n = cfg.values.length;
    var plotW = W - padL - 16, plotH = H - padT - padB;
    var color = cfg.color || accent();
    var f = coerceFormat(cfg.format);
    for (var g = 0; g <= 4; g++) {
      var gy = padT + plotH - (plotH * g) / 4;
      svg.appendChild(svgEl("line", { x1: padL, y1: gy, x2: W - 16, y2: gy, stroke: "currentColor", "stroke-opacity": 0.08 }));
      var lbl = svgEl("text", { x: padL - 8, y: gy + 4, "text-anchor": "end", "font-size": 10, fill: mutedColor() });
      lbl.textContent = axisFmt((max * g) / 4);
      svg.appendChild(lbl);
    }
    var pts = cfg.values.map(function (v, i) {
      var x = padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
      var y = padT + plotH - (v / max) * plotH;
      return [x, y];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
    pts.forEach(function (p, i) {
      var c = svgEl("circle", { cx: p[0], cy: p[1], r: 3.5, fill: color });
      var t = svgEl("title", {});
      t.textContent = cfg.labels[i] + ": " + f(cfg.values[i]);
      c.appendChild(t);
      svg.appendChild(c);
      var tx = svgEl("text", { x: p[0], y: H - 10, "text-anchor": "middle", "font-size": 11, fill: mutedColor() });
      tx.textContent = cfg.labels[i];
      svg.appendChild(tx);
    });
  }

  // donut(el, {labels:[], values:[], colors?}) — donut with center total.
  function donut(el, cfg) {
    var W = 320, H = 280, cx = W / 2, cy = H / 2, R = 92, r = 58;
    var svg = frame(el, W, H);
    var total = cfg.values.reduce(function (a, b) { return a + b; }, 0) || 1;
    var palette = cfg.colors || [accent(), "#1baf7a", "#eda100", "#e34948", "#4a3aa7", "#e87ba4"];
    var a0 = -Math.PI / 2;
    cfg.values.forEach(function (v, i) {
      var a1 = a0 + (v / total) * Math.PI * 2;
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var p = ["M", cx + R * Math.cos(a0), cy + R * Math.sin(a0),
        "A", R, R, 0, large, 1, cx + R * Math.cos(a1), cy + R * Math.sin(a1),
        "L", cx + r * Math.cos(a1), cy + r * Math.sin(a1),
        "A", r, r, 0, large, 0, cx + r * Math.cos(a0), cy + r * Math.sin(a0), "Z"].join(" ");
      var path = svgEl("path", { d: p, fill: palette[i % palette.length] });
      var t = svgEl("title", {});
      t.textContent = cfg.labels[i] + ": " + fmt.num(v) + " (" + fmt.pct(v / total) + ")";
      path.appendChild(t);
      svg.appendChild(path);
      a0 = a1;
    });
    var center = svgEl("text", { x: cx, y: cy + 5, "text-anchor": "middle", "font-size": 20, "font-weight": 650, fill: "currentColor" });
    center.textContent = fmt.num(total);
    svg.appendChild(center);
  }

  window.skipShell = { fmt: fmt };
  window.skipChart = { bar: bar, line: line, donut: donut };
})();
