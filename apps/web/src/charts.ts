// Small SVG charts for tests: Elo and LLR as the games went by, the
// pentanomial distribution, and the main version's Elo over time. One series
// each (the title names it), thin marks, recessive axes, a hover title on
// every point.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

/** Round, readable tick values covering [min, max]. */
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export interface XYPoint {
  x: number;
  y: number;
  /** Error half-width: drawn as a band (line charts) or whiskers (dot charts). */
  err?: number;
  /** Hover text. */
  title?: string;
}

export interface LineChartOptions {
  points: XYPoint[];
  title: string;
  xLabel: string;
  /** Horizontal reference lines, e.g. the SPRT bounds. */
  rules?: { y: number; label: string; tone?: "pass" | "fail" | "zero" }[];
  /** Error as a shaded band around the line, or whiskers on each dot. */
  error?: "band" | "whiskers";
  /** Labels along x (one per point) instead of numbers. */
  xNames?: string[];
  digits?: number;
}

/** A line chart with an optional error band and reference lines. */
export function lineChart(o: LineChartOptions): HTMLElement {
  const w = 460;
  const h = 190;
  const pad = { l: 46, r: 14, t: 26, b: 30 };
  const pts = o.points.filter((p) => Number.isFinite(p.y));
  const fig = document.createElement("figure");
  fig.className = "chart";
  if (pts.length < 2) {
    fig.innerHTML = `<figcaption>${esc(o.title)}</figcaption><p class="chart-empty">The graph starts after the first results.</p>`;
    return fig;
  }
  const ys = pts.flatMap((p) => [p.y - (p.err ?? 0), p.y + (p.err ?? 0)]).concat((o.rules ?? []).map((r) => r.y));
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  const margin = (max - min) * 0.08 || 1;
  min -= margin;
  max += margin;
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const d = (sel: (p: XYPoint) => number) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(sel(p)).toFixed(1)}`).join(" ");
  const digits = o.digits ?? 1;
  let svg = "";
  for (const t of ticks(min, max)) {
    svg += `<line class="chart-grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="chart-tick" x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t === 0 ? "0" : fmt(t, Number.isInteger(t) ? 0 : digits)}</text>`;
  }
  if (o.xNames) {
    const first = o.xNames[0] ?? "";
    const last = o.xNames[o.xNames.length - 1] ?? "";
    svg += `<text class="chart-tick" x="${X(x0)}" y="${h - 10}">${esc(first)}</text><text class="chart-tick" x="${X(x1)}" y="${h - 10}" text-anchor="end">${esc(last)}</text>`;
  } else {
    for (const t of ticks(x0, x1, 4)) svg += `<text class="chart-tick" x="${X(t)}" y="${h - 12}" text-anchor="middle">${t}</text>`;
    svg += `<text class="chart-axis-label" x="${w - pad.r}" y="${h - 1}" text-anchor="end">${esc(o.xLabel)}</text>`;
  }
  for (const r of o.rules ?? []) {
    svg += `<line class="chart-rule chart-rule-${r.tone ?? "zero"}" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(r.y)}" y2="${Y(r.y)}"/>`;
    if (r.label) svg += `<text class="chart-rule-label" x="${pad.l + 4}" y="${Y(r.y) - 4}">${esc(r.label)}</text>`;
  }
  if (o.error === "band" && pts.some((p) => p.err)) {
    const upper = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y + (p.err ?? 0)).toFixed(1)}`).join(" ");
    const lower = [...pts].reverse().map((p) => `L${X(p.x).toFixed(1)},${Y(p.y - (p.err ?? 0)).toFixed(1)}`).join(" ");
    svg += `<path class="chart-band" d="${upper} ${lower} Z"/>`;
  }
  svg += `<path class="chart-line" d="${d((p) => p.y)}"/>`;
  const dots = pts.length <= 40 || o.error === "whiskers";
  pts.forEach((p, i) => {
    const title = esc(p.title ?? `${o.xNames?.[i] ?? `${p.x} ${o.xLabel}`}: ${fmt(p.y, digits)}${p.err ? ` ± ${p.err.toFixed(digits)}` : ""}`);
    if (o.error === "whiskers" && p.err) {
      svg += `<line class="chart-whisker" x1="${X(p.x)}" x2="${X(p.x)}" y1="${Y(p.y - p.err)}" y2="${Y(p.y + p.err)}"/><line class="chart-whisker" x1="${X(p.x) - 4}" x2="${X(p.x) + 4}" y1="${Y(p.y - p.err)}" y2="${Y(p.y - p.err)}"/><line class="chart-whisker" x1="${X(p.x) - 4}" x2="${X(p.x) + 4}" y1="${Y(p.y + p.err)}" y2="${Y(p.y + p.err)}"/>`;
    }
    if (dots) svg += `<circle class="chart-dot" cx="${X(p.x)}" cy="${Y(p.y)}" r="4"/>`;
    // A wide invisible target, so hovering near a point shows its value.
    svg += `<circle class="chart-hit" cx="${X(p.x)}" cy="${Y(p.y)}" r="10"><title>${title}</title></circle>`;
  });
  const lastPt = pts[pts.length - 1]!;
  svg += `<text class="chart-value" x="${Math.min(X(lastPt.x), w - pad.r)}" y="${Y(lastPt.y) - 9}" text-anchor="end">${fmt(lastPt.y, digits)}</text>`;
  fig.innerHTML = `<figcaption>${esc(o.title)}</figcaption><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.title)}">${svg}</svg>`;
  return fig;
}

/** The pentanomial distribution: how many game pairs scored 0, ½, 1, 1½ or 2 points for the new version. */
export function pentaChart(penta: number[]): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = "chart";
  const labels = ["0", "½", "1", "1½", "2"];
  const names = ["lost both", "lost one, drew one", "won one, lost one, or two draws", "won one, drew one", "won both"];
  const total = penta.reduce((a, b) => a + b, 0);
  const w = 460;
  const h = 190;
  const pad = { l: 16, r: 16, t: 26, b: 34 };
  const max = Math.max(1, ...penta);
  const slot = (w - pad.l - pad.r) / 5;
  const bw = Math.min(56, slot - 14);
  let svg = `<line class="chart-grid" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>`;
  penta.forEach((n, i) => {
    const bh = ((h - pad.t - pad.b) * n) / max;
    const x = pad.l + slot * i + (slot - bw) / 2;
    const y = h - pad.b - bh;
    const r = Math.min(4, bh / 2);
    // Rounded at the data end only, anchored square to the baseline.
    const path = bh > 0 ? `M${x},${h - pad.b} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${h - pad.b} Z` : "";
    const pct = total ? Math.round((n / total) * 100) : 0;
    svg += `<path class="chart-bar${i < 2 ? " chart-bar-lose" : i > 2 ? " chart-bar-win" : ""}" d="${path}"/>`;
    svg += `<text class="chart-value" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${n}</text>`;
    svg += `<text class="chart-tick" x="${x + bw / 2}" y="${h - pad.b + 15}" text-anchor="middle">${labels[i]}</text>`;
    svg += `<rect class="chart-hit" x="${x - 6}" y="${pad.t}" width="${bw + 12}" height="${h - pad.t - pad.b}"><title>${labels[i]} points (${names[i]}): ${n} pairs, ${pct}%</title></rect>`;
  });
  svg += `<text class="chart-axis-label" x="${w / 2}" y="${h - 3}" text-anchor="middle">points of the new version per game pair</text>`;
  fig.innerHTML = `<figcaption>Game pairs (pentanomial)</figcaption><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Pentanomial distribution: ${penta.join(", ")}">${svg}</svg>`;
  return fig;
}
