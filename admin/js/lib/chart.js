/* ==========================================================================
   HOUSE OF ALDEN ADMIN — "Total sales over time" chart
   --------------------------------------------------------------------------
   One plain SVG line chart, no library. This period is the solid 2px line
   with a 10% wash beneath it; the previous period is a dashed line one step
   lighter on the same blue ramp (validated as an ordinal pair — dash is the
   second cue, so the two never depend on colour alone). Hairline grid, one
   axis. A crosshair follows the pointer or the arrow keys and lists both
   values; the same numbers are in the "View as table" disclosure.
   ========================================================================== */

import { h, uid } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";
const M = { top: 10, right: 12, bottom: 26, left: 52 };
const HEIGHT = 240;

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

/* A step of 1, 2, 2.5 or 5 × 10ⁿ that splits the range into about four. */
function niceStep(max) {
  const raw = Math.max(max, 1) / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * @param {object} o
 * @param {number[]} o.current        one value per bucket
 * @param {number[]|null} o.previous  same length, or null
 * @param {string[]} o.labels         axis label per bucket ("17 Oct")
 * @param {string[]} o.longLabels     tooltip label per bucket ("17 Oct 2026")
 * @param {(n:number)=>string} o.format      value → "₹8,900"
 * @param {(n:number)=>string} o.formatTick  value → "₹9K"
 * @param {string} o.summary          one-sentence description for screen readers
 */
export function salesChart({ current, previous, labels, longLabels, format, formatTick, summary,
  names = ["This period", "Previous period"] }) {
  const n = current.length;
  const liveId = uid("chart-live");
  const live = h("p", { class: "visually-hidden", id: liveId, "aria-live": "polite" });
  const tooltip = h("div", { class: "chart-tip", hidden: true });
  const plot = h("div", {
    class: "chart-plot",
    tabindex: "0",
    role: "group",
    "aria-label": `${summary} Use the left and right arrow keys to read each point.`,
    "aria-describedby": liveId,
  });
  const canvas = svg("svg", { class: "chart-svg", "aria-hidden": "true", height: HEIGHT });
  plot.append(canvas, tooltip);

  const legend = previous
    ? h("div", { class: "chart-legend" },
      h("span", { class: "legend-item" }, h("span", { class: "legend-key legend-key--current" }), names[0]),
      h("span", { class: "legend-item" }, h("span", { class: "legend-key legend-key--previous" }), names[1]))
    : null;

  const table = h("details", { class: "chart-table" },
    h("summary", null, "View as table"),
    h("div", { class: "table-wrap" },
      h("table", { class: "table table--compact" },
        h("thead", null, h("tr", null,
          h("th", { scope: "col" }, "Date"),
          h("th", { scope: "col", class: "num" }, names[0]),
          previous && h("th", { scope: "col", class: "num" }, names[1]))),
        h("tbody", null, current.map((v, i) => h("tr", null,
          h("td", null, longLabels[i]),
          h("td", { class: "num" }, format(v)),
          previous && h("td", { class: "num" }, format(previous[i] || 0))))))));

  const max = Math.max(1, ...current, ...(previous || []));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;

  let width = 0;
  let xs = [];
  let y = () => 0;
  let active = -1;
  let cross;
  let dotCurrent;
  let dotPrevious;

  function draw() {
    width = Math.max(280, Math.round(plot.clientWidth || 600));
    canvas.setAttribute("width", width);
    canvas.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
    canvas.replaceChildren();
    const innerW = width - M.left - M.right;
    const innerH = HEIGHT - M.top - M.bottom;
    xs = current.map((_, i) => M.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1)));
    y = (v) => M.top + innerH - (innerH * v) / top;

    const grid = svg("g", { class: "chart-grid" });
    for (let t = 0; t <= top + step / 2; t += step) {
      const yy = Math.round(y(t)) + 0.5;
      grid.append(svg("line", { x1: M.left, x2: width - M.right, y1: yy, y2: yy, class: t === 0 ? "chart-baseline" : "chart-gridline" }));
      const label = svg("text", { x: M.left - 8, y: yy + 4, class: "chart-tick", "text-anchor": "end" });
      label.textContent = formatTick(t);
      grid.append(label);
    }
    canvas.append(grid);

    /* About six date labels, always the first and last. */
    const every = Math.max(1, Math.ceil(n / 6));
    const xAxis = svg("g", { class: "chart-xaxis" });
    current.forEach((_, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every / 2) return; // keep the last label clear
      const t = svg("text", { x: xs[i], y: HEIGHT - 6, class: "chart-tick",
        "text-anchor": i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle" });
      t.textContent = labels[i];
      xAxis.append(t);
    });
    canvas.append(xAxis);

    const path = (values) => values.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(v || 0).toFixed(1)}`).join("");
    const base = y(0).toFixed(1);
    const line = path(current);
    canvas.append(svg("path", { d: `${line}L${xs[n - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`, class: "chart-area" }));
    if (previous) canvas.append(svg("path", { d: path(previous), class: "chart-line chart-line--previous" }));
    canvas.append(svg("path", { d: line, class: "chart-line chart-line--current" }));

    cross = svg("line", { y1: M.top, y2: HEIGHT - M.bottom, class: "chart-cross", visibility: "hidden" });
    dotPrevious = previous ? svg("circle", { r: 4, class: "chart-dot chart-dot--previous", visibility: "hidden" }) : null;
    dotCurrent = svg("circle", { r: 4, class: "chart-dot chart-dot--current", visibility: "hidden" });
    canvas.append(cross);
    if (dotPrevious) canvas.append(dotPrevious);
    canvas.append(dotCurrent);
    if (active > -1) show(active);
  }

  function row(value, name, kind) {
    return h("div", { class: "chart-tip-row" },
      h("span", { class: `legend-key legend-key--${kind}` }),
      h("strong", null, format(value)),
      h("span", null, name));
  }

  function show(i) {
    if (!cross || !xs.length) return; // not drawn yet
    active = Math.max(0, Math.min(n - 1, i));
    const x = xs[active];
    cross.setAttribute("x1", x);
    cross.setAttribute("x2", x);
    cross.setAttribute("visibility", "visible");
    dotCurrent.setAttribute("cx", x);
    dotCurrent.setAttribute("cy", y(current[active] || 0));
    dotCurrent.setAttribute("visibility", "visible");
    if (dotPrevious) {
      dotPrevious.setAttribute("cx", x);
      dotPrevious.setAttribute("cy", y(previous[active] || 0));
      dotPrevious.setAttribute("visibility", "visible");
    }
    tooltip.replaceChildren(
      h("p", { class: "chart-tip-date" }, longLabels[active]),
      row(current[active] || 0, names[0], "current"),
      previous && row(previous[active] || 0, names[1], "previous"));
    tooltip.hidden = false;
    const tipW = tooltip.offsetWidth || 160;
    const left = x + 12 + tipW > width ? x - 12 - tipW : x + 12;
    tooltip.style.transform = `translate(${Math.max(0, left)}px, ${M.top}px)`;
    live.textContent = `${longLabels[active]}: ${format(current[active] || 0)}${previous ? `, previous period ${format(previous[active] || 0)}` : ""}.`;
  }

  function hide() {
    active = -1;
    tooltip.hidden = true;
    [cross, dotCurrent, dotPrevious].forEach((el) => el && el.setAttribute("visibility", "hidden"));
  }

  /* The crosshair finds the nearest date — nobody has to hit a 2px line. */
  plot.addEventListener("pointermove", (e) => {
    const rect = plot.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i;
    });
    show(best);
  });
  plot.addEventListener("pointerleave", () => {
    if (document.activeElement !== plot) hide();
  });
  plot.addEventListener("focus", () => show(active > -1 ? active : n - 1));
  plot.addEventListener("blur", hide);
  plot.addEventListener("keydown", (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (e.key === "Escape") return hide();
    if (!(e.key in moves)) return;
    e.preventDefault();
    const d = moves[e.key];
    show(d === -Infinity ? 0 : d === Infinity ? n - 1 : (active < 0 ? n - 1 : active + d));
  });

  const resize = new ResizeObserver(() => {
    if (Math.round(plot.clientWidth) !== width) draw();
  });
  resize.observe(plot);
  requestAnimationFrame(draw);

  const figure = h("figure", { class: "chart" }, legend, plot, live, table);
  figure.destroy = () => resize.disconnect();
  return figure;
}
