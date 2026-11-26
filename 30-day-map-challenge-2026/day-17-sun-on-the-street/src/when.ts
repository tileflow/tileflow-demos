// The chart under the headline: bars of light for the chosen scale (hours of a day, days of a month,
// months of a year), a strip of months to move along the year, and a quiet compass at the hour.
// Bars stand in a track up to their total: the sun overhead for an hour, 24 hours for a day or month.

import {localInstant, solarPosition} from './sun';

export type Scope = 'hour' | 'day' | 'month';

export type When = {
  scope: Scope;
  /** YYYY-MM-DD; the year never shows (the sun repeats each year to within a minute). */
  date: string;
  minutes: number;
  lat: number;
  lon: number;
  timeZone: string;
  sun: {azimuth: number; altitude: number};
  bearing: number;
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NS = 'http://www.w3.org/2000/svg';
const BAR_H = 64;

export const daysIn = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const pad = (n: number) => String(n).padStart(2, '0');
export const withDay = (date: string, day: number) => `${date.slice(0, 8)}${pad(Math.min(day, daysIn(date)))}`;
export const withMonth = (date: string, month: number) => {
  const y = date.slice(0, 4);
  const day = Number(date.slice(8, 10));
  const first = `${y}-${pad(month + 1)}-01`;
  return withDay(first, day);
};
export const monthName = (date: string) => MONTH_NAMES[Number(date.slice(5, 7)) - 1];
export function clock12(minutes: number) {
  const h = Math.floor(minutes / 60) % 24, m = Math.round(minutes % 60);
  if (h === 12 && m === 0) return 'noon';
  const hh = h % 12 || 12;
  return `${hh}${m ? ':' + pad(m) : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** Minutes with the sun above the horizon on a date, every ten minutes. */
function daylight(date: string, lat: number, lon: number, timeZone: string) {
  let up = 0;
  for (let t = 5; t < 1440; t += 10) if (solarPosition(localInstant(date, t, timeZone), lat, lon).altitude > 0) up += 10;
  return up;
}

export type Series = {values: number[]; selected: number; ticks: Record<number, string>; label: string};
const cache = new Map<string, number[]>();

export function series(w: When): Series {
  const month = Number(w.date.slice(5, 7)) - 1;
  const day = Number(w.date.slice(8, 10));
  const where = `${w.lat.toFixed(1)},${w.lon.toFixed(1)},${w.timeZone}`;
  const memo = (key: string, make: () => number[]) => {
    let v = cache.get(key);
    if (!v) {
      v = make();
      cache.set(key, v);
      if (cache.size > 60) cache.delete(cache.keys().next().value!);
    }
    return v;
  };
  if (w.scope === 'hour') {
    const values = memo(`h|${w.date}|${where}`, () =>
      Array.from({length: 24}, (_, h) => Math.max(0, solarPosition(localInstant(w.date, h * 60 + 30, w.timeZone), w.lat, w.lon).altitude) / 90),
    );
    return {values, selected: Math.min(23, Math.floor(w.minutes / 60)), ticks: {0: '0', 6: '6', 12: '12', 18: '18', 23: '23'}, label: clock12(w.minutes)};
  }
  if (w.scope === 'day') {
    const n = daysIn(w.date);
    const values = memo(`d|${w.date.slice(0, 7)}|${where}`, () => Array.from({length: n}, (_, d) => daylight(withDay(w.date, d + 1), w.lat, w.lon, w.timeZone) / 1440));
    return {values, selected: day - 1, ticks: {0: '1', 6: '7', 13: '14', 20: '21', 27: '28'}, label: String(day)};
  }
  const values = memo(`m|${w.date.slice(0, 4)}|${where}`, () => MONTHS.map((_, m) => daylight(`${w.date.slice(0, 4)}-${pad(m + 1)}-15`, w.lat, w.lon, w.timeZone) / 1440));
  return {values, selected: month, ticks: Object.fromEntries(MONTHS.map((m, i) => [i, m])), label: MONTHS[month]};
}

const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

function drawBars(svg: SVGSVGElement, s: Series) {
  const w = svg.clientWidth || 470;
  svg.setAttribute('viewBox', `0 0 ${w} ${BAR_H + 20}`);
  svg.replaceChildren();
  const n = s.values.length;
  const gap = n > 20 ? 3 : 6;
  const bw = (w - gap * (n - 1)) / n;
  const r = Math.min(3, bw / 3);
  const style = getComputedStyle(document.documentElement);
  const track = style.getPropertyValue('--track').trim();
  const sun = style.getPropertyValue('--sun').trim();
  const soft = style.getPropertyValue('--sun-soft').trim();
  const ink = style.getPropertyValue('--ink').trim();
  const muted = style.getPropertyValue('--muted').trim();
  s.values.forEach((v, i) => {
    const x = i * (bw + gap);
    const bg = el('rect', {x, y: 0, width: bw, height: BAR_H, rx: r, fill: track});
    if (i === s.selected) bg.setAttribute('style', `fill:color-mix(in srgb, ${ink} 14%, transparent)`);
    svg.append(bg);
    const h = Math.max(2.5, v * BAR_H);
    svg.append(el('rect', {x, y: BAR_H - h, width: bw, height: h, rx: r, fill: i === s.selected ? sun : v > 0 ? soft : track}));
  });
  const labels: Record<number, string> = {...s.ticks};
  for (const i of Object.keys(labels).map(Number)) if (i !== s.selected && Math.abs(i - s.selected) <= (n > 20 ? 2 : 0)) delete labels[i];
  labels[s.selected] = s.label;
  for (const [i, t] of Object.entries(labels)) {
    const on = Number(i) === s.selected;
    const x = Math.min(w - 4, Math.max(4, Number(i) * (bw + gap) + bw / 2));
    svg.append(el('text', {x, y: BAR_H + 15, 'font-size': on ? 12 : 10.5, 'text-anchor': 'middle', fill: on ? ink : muted, 'font-weight': on ? 700 : 450}, t));
  }
  return {n, bw, gap};
}

/** Twelve month pills; at the hour the chosen month opens to show its days. */
function stripLayout(width: number, w: When) {
  const gap = 3;
  const open = w.scope === 'hour' ? Number(w.date.slice(5, 7)) - 1 : -1;
  const wide = open >= 0 ? Math.min(150, width * 0.32) : 0;
  const narrow = (width - wide - gap * 11) / (open >= 0 ? 11 : 12);
  const cells: {x: number; w: number}[] = [];
  let x = 0;
  for (let m = 0; m < 12; m++) {
    const cw = m === open ? wide : narrow;
    cells.push({x, w: cw});
    x += cw + gap;
  }
  return {cells, open};
}

function drawStrip(svg: SVGSVGElement, w: When, hover: number) {
  const width = svg.clientWidth || 470;
  svg.setAttribute('viewBox', `0 0 ${width} 34`);
  svg.replaceChildren();
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue('--ink').trim();
  const muted = style.getPropertyValue('--muted').trim();
  const month = Number(w.date.slice(5, 7)) - 1;
  const day = Number(w.date.slice(8, 10));
  const {cells, open} = stripLayout(width, w);
  cells.forEach(({x, w: cw}, m) => {
    const on = m === month;
    const fill = on && open < 0 ? ink : m === hover ? 'color-mix(in srgb, currentColor 18%, transparent)' : 'color-mix(in srgb, currentColor 8%, transparent)';
    const pill = el('rect', {x, y: 0, width: cw, height: 14, rx: 4});
    pill.setAttribute('style', `fill:${fill};color:${ink}`);
    svg.append(pill);
    if (m === open) {
      const n = daysIn(w.date);
      const dw = (cw - 6) / n;
      for (let d = 1; d <= n; d++) {
        const sel = d === day;
        const tick = el('rect', {x: x + 3 + (d - 1) * dw + (sel ? 0 : dw * 0.25), y: sel ? 2 : 4, width: sel ? dw : dw * 0.5, height: sel ? 10 : 6, rx: 1});
        tick.setAttribute('style', `fill:${sel ? ink : `color-mix(in srgb, ${ink} 30%, transparent)`}`);
        svg.append(tick);
      }
      svg.append(el('text', {x: x + 3 + (day - 0.5) * dw, y: 29, 'font-size': 11.5, 'text-anchor': 'middle', fill: ink, 'font-weight': 700}, `${day} ${MONTHS[m]}`));
    } else {
      svg.append(el('text', {x: x + cw / 2, y: 29, 'font-size': on ? 11.5 : 10.5, 'text-anchor': 'middle', fill: on ? ink : muted, 'font-weight': on ? 700 : 450}, on ? MONTHS[m] : MONTHS[m][0]));
    }
  });
}

export function drawCompass(svg: SVGSVGElement, w: When) {
  svg.classList.toggle('off', w.scope !== 'hour');
  svg.replaceChildren();
  const c = 20, r = 15;
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue('--ink').trim();
  const paper = style.getPropertyValue('--paper').trim();
  const at = (deg: number, rr: number): [number, number] => {
    const a = ((deg - w.bearing - 90) * Math.PI) / 180;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
  };
  svg.append(el('circle', {cx: c, cy: c, r: r + 4, fill: `rgb(${paper} / 0.7)`}));
  svg.append(el('circle', {cx: c, cy: c, r, fill: 'none', stroke: ink, 'stroke-opacity': 0.28}));
  const [tx, ty] = at(0, r - 7), [nx, ny] = at(0, r + 1), [lx, ly] = at(0, r + 9);
  svg.append(el('line', {x1: tx, y1: ty, x2: nx, y2: ny, stroke: ink, 'stroke-width': 1.4}));
  svg.append(el('text', {x: lx, y: ly + 3, 'font-size': 8.5, 'font-weight': 600, 'text-anchor': 'middle', fill: ink}, 'N'));
  if (w.sun.altitude <= 0.5) return;
  const [hx, hy] = at(w.sun.azimuth + 180, r * 0.62), [sx, sy] = at(w.sun.azimuth, r);
  svg.append(el('line', {x1: c, y1: c, x2: hx, y2: hy, stroke: '#4263eb', 'stroke-opacity': 0.75, 'stroke-width': 3, 'stroke-linecap': 'round'}));
  svg.append(el('line', {x1: c, y1: c, x2: sx, y2: sy, stroke: '#f5a100', 'stroke-dasharray': '1.5 2'}));
  svg.append(el('circle', {cx: sx, cy: sy, r: 4.2, fill: '#f5a100', stroke: '#fff', 'stroke-width': 1.5}));
}

export type ChartHandlers = {
  scope: (s: Scope) => void;
  minutes: (m: number) => void;
  date: (d: string) => void;
  play: () => void;
};

/** Draws the chart for a moment and wires its controls once. */
export function chart(root: HTMLElement, handlers: ChartHandlers) {
  const bars = root.querySelector<SVGSVGElement>('#bars')!;
  const strip = root.querySelector<SVGSVGElement>('#strip')!;
  const compass = root.querySelector<SVGSVGElement>('#compass')!;
  const title = root.querySelector<HTMLElement>('#chart-title')!;
  const tip = root.querySelector<HTMLElement>('#tip')!;
  let state: When | undefined;
  let hover = -1;
  let layout = {n: 24, bw: 1, gap: 0};

  const draw = () => {
    if (!state) return;
    const s = series(state);
    layout = drawBars(bars, s);
    drawStrip(strip, state, hover);
    drawCompass(compass, state);
    title.textContent = state.scope === 'hour' ? 'Height of the sun' : 'Hours of light';
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-scope]')) b.setAttribute('aria-checked', String(b.dataset.scope === state.scope));
    bars.setAttribute('aria-valuetext', s.label);
  };

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-scope]')) b.addEventListener('click', () => handlers.scope(b.dataset.scope as Scope));
  root.querySelector('#play')!.addEventListener('click', handlers.play);

  // the bars: press and drag along them
  const pickBar = (e: PointerEvent) => {
    if (!state) return;
    const box = bars.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (e.clientX - box.left) / box.width));
    if (state.scope === 'hour') handlers.minutes(Math.min(1435, Math.round((f * 1440) / 5) * 5));
    else if (state.scope === 'day') handlers.date(withDay(state.date, Math.floor(f * layout.n) + 1));
    else handlers.date(withMonth(state.date, Math.floor(f * 12)));
  };
  // the strip: a month, or a day inside the open month
  const stripAt = (e: PointerEvent) => {
    if (!state) return;
    const box = strip.getBoundingClientRect();
    const x = e.clientX - box.left;
    const {cells, open} = stripLayout(box.width, state);
    let m = cells.findIndex((c) => x < c.x + c.w + 1.5);
    if (m < 0) m = 11;
    return {m, open, cell: cells[m], x};
  };
  const pickStrip = (e: PointerEvent) => {
    const at = stripAt(e);
    if (!at || !state) return;
    if (at.m === at.open) {
      const n = daysIn(state.date);
      const d = Math.min(n, Math.max(1, Math.floor(((at.x - at.cell.x - 3) / (at.cell.w - 6)) * n) + 1));
      handlers.date(withDay(state.date, d));
    } else handlers.date(withMonth(state.date, at.m));
  };
  const drag = (target: SVGSVGElement, pick: (e: PointerEvent) => void) => {
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      pick(e);
    });
    target.addEventListener('pointermove', (e) => {
      if (target.hasPointerCapture(e.pointerId)) pick(e);
    });
  };
  drag(bars, pickBar);
  // on the strip, a drag stays on the kind of thing it started on: days inside the open month, or months
  let stripMode: 'day' | 'month' | undefined;
  strip.addEventListener('pointerdown', (e) => {
    strip.setPointerCapture(e.pointerId);
    const at = stripAt(e);
    stripMode = at && at.m === at.open ? 'day' : 'month';
    pickStrip(e);
  });
  strip.addEventListener('pointermove', (e) => {
    const at = stripAt(e);
    if (strip.hasPointerCapture(e.pointerId) && at && state) {
      if (stripMode === 'day' && at.open >= 0) {
        const n = daysIn(state.date);
        const cell = at.open === at.m ? at.cell : stripLayout(strip.getBoundingClientRect().width, state).cells[at.open];
        const d = Math.min(n, Math.max(1, Math.floor(((at.x - cell.x - 3) / (cell.w - 6)) * n) + 1));
        handlers.date(withDay(state.date, d));
      } else if (at.m !== Number(state.date.slice(5, 7)) - 1) handlers.date(withMonth(state.date, at.m));
    }
    // the month's name over the pill under the pointer
    if (at && at.m !== at.open) {
      if (hover !== at.m) {
        hover = at.m;
        draw();
      }
      const box = strip.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
      tip.textContent = MONTH_NAMES[at.m];
      tip.style.left = `${box.left - rootBox.left + at.cell.x + at.cell.w / 2}px`;
      tip.style.top = `${box.top - rootBox.top - 6}px`;
      tip.hidden = false;
    } else tip.hidden = true;
  });
  strip.addEventListener('pointerleave', () => {
    tip.hidden = true;
    hover = -1;
    draw();
  });
  // keys: left and right along the bars, or along the months
  bars.addEventListener('keydown', (e) => {
    if (!state || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    if (state.scope === 'hour') handlers.minutes(Math.min(1435, Math.max(0, state.minutes + step * (e.shiftKey ? 60 : 15))));
    else if (state.scope === 'day') handlers.date(withDay(state.date, Math.min(daysIn(state.date), Math.max(1, Number(state.date.slice(8, 10)) + step))));
    else handlers.date(withMonth(state.date, (Number(state.date.slice(5, 7)) - 1 + step + 12) % 12));
  });
  strip.addEventListener('keydown', (e) => {
    if (!state || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    handlers.date(withMonth(state.date, (Number(state.date.slice(5, 7)) - 1 + (e.key === 'ArrowLeft' ? -1 : 1) + 12) % 12));
  });
  addEventListener('resize', draw);

  return {
    update(next: When) {
      state = next;
      draw();
    },
  };
}
