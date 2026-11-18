// The chart on a phone: the same bars as a ruler that slides under a fixed needle, dragged with the
// thumb (hours of the day, days of the month, or months), and one row of buttons under it: play, the
// scale, and the date, which opens the months and turns the ruler into the days of the month.

import {type ChartHandlers, clock12, daysIn, drawCompass, MONTH_NAMES, MONTHS, type Scope, series, type When, withDay, withMonth} from './when';

const NS = 'http://www.w3.org/2000/svg';
const BAR_H = 64;
const TOP = 26; // room for the needle's label
const SCOPES: Scope[] = ['hour', 'day', 'month'];
const SCOPE_NAMES: Record<Scope, string> = {hour: 'Hour', day: 'Day', month: 'Month'};

const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

/** What the ruler shows: hours (at the hour, unless the date is open), days, or months. */
type Kind = 'hours' | 'days' | 'months';

export function phoneChart(root: HTMLElement, handlers: ChartHandlers) {
  const ruler = root.querySelector<SVGSVGElement>('#ruler')!;
  const months = root.querySelector<HTMLElement>('#months')!;
  const scopeButton = root.querySelector<HTMLButtonElement>('#m-scope')!;
  const scopeMenu = root.querySelector<HTMLElement>('#scope-menu')!;
  const dateButton = root.querySelector<HTMLButtonElement>('#m-date')!;
  const compass = root.querySelector<SVGSVGElement>('#m-compass')!;
  let state: When | undefined;
  let dateOpen = false;
  /** While the thumb is on the ruler, the unsnapped position it is at, in bars. */
  let dragging: number | undefined;

  const kind = (): Kind => (state?.scope === 'month' ? 'months' : state?.scope === 'day' || dateOpen ? 'days' : 'hours');
  const unit = () => (kind() === 'hours' ? 42 : kind() === 'days' ? 40 : 46);

  /** The values under the ruler, the position of the needle in bars, and the needle's label. */
  const reading = () => {
    const w = state!;
    const k = kind();
    const s = series(k === 'hours' ? {...w, scope: 'hour'} : k === 'days' ? {...w, scope: 'day'} : {...w, scope: 'month'});
    const day = Number(w.date.slice(8, 10)), month = Number(w.date.slice(5, 7)) - 1;
    const at = k === 'hours' ? w.minutes / 60 : k === 'days' ? day - 0.5 : month + 0.5;
    const label = k === 'hours' ? clock12(w.minutes) : k === 'days' ? `${day} ${MONTHS[month]}` : MONTH_NAMES[month];
    const tick = (i: number) => (k === 'hours' ? (i % 3 === 0 ? String(i) : '') : k === 'days' ? ((i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '') : MONTHS[i][0]);
    return {values: s.values, at, label, tick, selected: s.selected};
  };

  const drawRuler = () => {
    const w = ruler.clientWidth || 393;
    ruler.setAttribute('viewBox', `0 0 ${w} ${TOP + BAR_H + 22}`);
    ruler.replaceChildren();
    const r = reading();
    const at = dragging ?? r.at;
    const u = unit(), bw = u - 8, cx = w / 2;
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const selected = dragging === undefined ? r.selected : Math.max(0, Math.min(r.values.length - 1, Math.floor(at)));
    r.values.forEach((v, i) => {
      const x = cx + (i + 0.5 - at) * u;
      if (x < -u || x > w + u) return;
      const on = i === selected;
      const bg = el('rect', {x: x - bw / 2, y: TOP, width: bw, height: BAR_H, rx: 4, fill: color('--track')});
      if (on) bg.setAttribute('style', `fill:color-mix(in srgb, ${color('--ink')} 15%, transparent)`);
      ruler.append(bg);
      if (v > 0) {
        const h = Math.max(3, v * BAR_H);
        ruler.append(el('rect', {x: x - bw / 2, y: TOP + BAR_H - h, width: bw, height: h, rx: 4, fill: on ? color('--sun') : color('--sun-soft')}));
      }
      const t = r.tick(i);
      if (t && !on) ruler.append(el('text', {x, y: TOP + BAR_H + 17, 'font-size': 11.5, 'text-anchor': 'middle', fill: color('--muted')}, t));
    });
    ruler.append(el('line', {x1: cx, x2: cx, y1: TOP - 6, y2: TOP + BAR_H + 6, stroke: color('--ink'), 'stroke-width': 2}));
    ruler.append(el('text', {x: cx, y: TOP - 11, 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle', fill: color('--ink')}, r.label));
    ruler.setAttribute('aria-valuetext', r.label);
  };

  const drawMonths = () => {
    const month = Number(state!.date.slice(5, 7)) - 1;
    months.hidden = !dateOpen || state!.scope === 'month';
    for (const [i, b] of [...months.children].entries()) b.setAttribute('aria-pressed', String(i === month));
  };

  const draw = () => {
    if (!state) return;
    drawRuler();
    drawMonths();
    const day = Number(state.date.slice(8, 10)), month = Number(state.date.slice(5, 7)) - 1;
    scopeButton.firstChild!.textContent = SCOPE_NAMES[state.scope] + ' ';
    dateButton.hidden = state.scope === 'month';
    dateButton.firstChild!.textContent = (state.scope === 'hour' ? `${day} ${MONTHS[month]}` : MONTH_NAMES[month]) + ' ';
    dateButton.setAttribute('aria-expanded', String(dateOpen));
    dateButton.classList.toggle('on', dateOpen);
    drawCompass(compass, state);
  };

  // the months, as buttons that scroll sideways
  months.replaceChildren(
    ...MONTHS.map((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = m;
      b.addEventListener('click', () => state && handlers.date(withMonth(state.date, i)));
      return b;
    }),
  );
  const showMonth = () => {
    const month = Number(state!.date.slice(5, 7)) - 1;
    (months.children[month] as HTMLElement | undefined)?.scrollIntoView({inline: 'center', block: 'nearest'});
  };

  // the ruler: drag it under the needle; a tap picks the bar tapped
  const emit = (pos: number) => {
    if (!state) return;
    const k = kind();
    if (k === 'hours') handlers.minutes(Math.min(1435, Math.max(0, Math.round((pos * 60) / 5) * 5)));
    else if (k === 'days') handlers.date(withDay(state.date, Math.min(daysIn(state.date), Math.max(1, Math.floor(pos) + 1))));
    else handlers.date(withMonth(state.date, Math.min(11, Math.max(0, Math.floor(pos)))));
  };
  let start: {x: number; at: number; moved: boolean} | undefined;
  const limit = (pos: number) => Math.max(0, Math.min(reading().values.length - 0.001, pos));
  ruler.addEventListener('pointerdown', (e) => {
    if (!state) return;
    ruler.setPointerCapture(e.pointerId);
    start = {x: e.clientX, at: reading().at, moved: false};
  });
  ruler.addEventListener('pointermove', (e) => {
    if (!start || !ruler.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 6) start.moved = true;
    if (!start.moved) return;
    dragging = limit(start.at - dx / unit());
    emit(dragging);
    drawRuler();
  });
  const release = (e: PointerEvent) => {
    if (!start) return;
    if (!start.moved && state) {
      // a tap: the bar under the finger
      const box = ruler.getBoundingClientRect();
      const i = Math.floor(start.at + (e.clientX - box.left - box.width / 2) / unit());
      const n = reading().values.length;
      if (i >= 0 && i < n) emit(kind() === 'hours' ? i + (start.at % 1) : i + 0.5);
    }
    start = undefined;
    dragging = undefined;
    draw();
  };
  ruler.addEventListener('pointerup', release);
  ruler.addEventListener('pointercancel', release);
  ruler.addEventListener('keydown', (e) => {
    if (!state || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    emit(reading().at + step * (kind() === 'hours' ? 0.25 : 1));
  });

  // the buttons
  root.querySelector('#m-play')!.addEventListener('click', handlers.play);
  scopeButton.addEventListener('click', () => {
    scopeMenu.hidden = !scopeMenu.hidden;
    scopeButton.setAttribute('aria-expanded', String(!scopeMenu.hidden));
  });
  scopeMenu.replaceChildren(
    ...SCOPES.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = SCOPE_NAMES[s];
      b.dataset.scope = s;
      b.addEventListener('click', () => {
        scopeMenu.hidden = true;
        scopeButton.setAttribute('aria-expanded', 'false');
        handlers.scope(s);
      });
      return b;
    }),
  );
  dateButton.addEventListener('click', () => {
    dateOpen = !dateOpen;
    draw();
    if (dateOpen) showMonth();
  });
  addEventListener('resize', draw);

  return {
    update(next: When) {
      const monthChanged = state?.date.slice(0, 7) !== next.date.slice(0, 7);
      state = next;
      for (const b of scopeMenu.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === next.scope));
      if (dragging === undefined) draw();
      if (monthChanged && dateOpen) showMonth();
    },
  };
}
