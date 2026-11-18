// The card shown when a sidewalk is clicked: its sun on the chosen day and through the year.

import type {PointResult} from './worker';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const hours = (minutes: number) => (minutes / 60).toFixed(1).replace(/\.0$/, '');

/** Per month, the average minutes of sun and of daylight per day. */
function months(r: PointResult) {
  const out = MONTHS.map(() => ({sun: 0, daylight: 0, days: 0}));
  for (let d = 0; d < r.sun.length; d++) {
    const month = new Date(Date.UTC(r.year, 0, 1 + d)).getUTCMonth();
    out[month].sun += r.sun[d];
    out[month].daylight += r.daylight[d];
    out[month].days++;
  }
  return out.map((m) => ({sun: m.sun / m.days, daylight: m.daylight / m.days}));
}

/** The day as a strip: night, daylight in shade, and the minutes on the spot in sun. */
function dayStrip(today: Uint8Array, now: number): string {
  const w = 288, h = 14;
  let rects = '';
  for (let slot = 0; slot < today.length; slot++) {
    if (!today[slot]) continue;
    rects += `<rect x="${slot}" y="0" width="1.05" height="${h}" class="${today[slot] === 2 ? 'sun' : 'up'}"/>`;
  }
  const ticks = [6, 12, 18]
    .map((hh) => `<line x1="${hh * 12}" x2="${hh * 12}" y1="${h}" y2="${h + 3}"/><text x="${hh * 12}" y="${h + 12}">${hh}:00</text>`)
    .join('');
  return `<svg class="strip" viewBox="0 -1 ${w} ${h + 14}" preserveAspectRatio="none" role="img" aria-label="Sun on this spot through the day">
    <rect x="0" y="0" width="${w}" height="${h}" rx="3" class="night"/>${rects}
    <line class="now" x1="${now / 5}" x2="${now / 5}" y1="-1" y2="${h + 1}"/>${ticks}</svg>`;
}

/** Twelve bars: the average daily sun of each month, over a track of its daylight. */
function monthChart(rows: {sun: number; daylight: number}[], current: number): string {
  const w = 288, h = 92, gap = 6, bw = (w - gap * 11) / 12;
  const max = Math.max(...rows.map((r) => r.daylight), 1);
  const bars = rows
    .map((r, i) => {
      const x = i * (bw + gap);
      const th = (r.daylight / max) * h, sh = (r.sun / max) * h;
      const tip = `${MONTHS[i]}: ${hm(r.sun)} of sun a day, of ${hours(r.daylight)} h of daylight`;
      return `<g class="bar${i === current ? ' current' : ''}" data-tip="${tip}">
        <rect class="hit" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${h + 14}"/>
        <rect class="track" x="${x}" y="${h - th}" width="${bw}" height="${th}" rx="3"/>
        ${sh > 0.5 ? `<rect class="sunbar" x="${x}" y="${h - sh}" width="${bw}" height="${sh}" rx="3"/>` : ''}
        <text x="${x + bw / 2}" y="${h + 12}">${MONTHS[i][0]}</text></g>`;
    })
    .join('');
  return `<svg class="months" viewBox="0 0 ${w} ${h + 14}" role="img" aria-label="Hours of sun a day on this spot, by month">${bars}</svg>`;
}

export function spotLoading(): string {
  return `<div class="spot"><div class="spot-title">This sidewalk</div><p class="spot-muted">Following the sun through the year…</p></div>`;
}

/** How the spot's day compares with the sidewalks in view, by length. */
export type SpotRank = {sunnierThan: number} | {sunless: number} | undefined;

export function spotCard(r: PointResult, input: {date: string; now: number; rank: SpotRank}): string {
  const rows = months(r);
  const month = Number(input.date.slice(5, 7)) - 1;
  let todaySun = 0, todayUp = 0;
  for (const s of r.today) {
    if (s) todayUp += 5;
    if (s === 2) todaySun += 5;
  }
  const yearSun = r.sun.reduce((a, b) => a + b, 0), yearLight = r.daylight.reduce((a, b) => a + b, 0);
  const sunless = r.sun.reduce((a, b) => a + (b < 15 ? 1 : 0), 0);
  const best = rows.reduce((b, row, i) => (row.sun > rows[b].sun ? i : b), 0);
  const worst = rows.reduce((b, row, i) => (row.sun < rows[b].sun ? i : b), 0);
  const day = new Date(`${input.date}T12:00:00Z`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const rank = !input.rank
    ? ''
    : 'sunless' in input.rank
      ? `<p class="spot-muted">No sun here on ${day}, like ${input.rank.sunless}% of the sidewalks in view.</p>`
      : input.rank.sunnierThan >= 99
        ? `<p class="spot-muted">One of the sunniest sidewalks in view on ${day}.</p>`
        : `<p class="spot-muted">Sunnier than ${input.rank.sunnierThan}% of the sidewalks in view on ${day}.</p>`;
  const lead = todaySun
    ? `<b>${hm(todaySun)}</b> of direct sun <span class="spot-muted">of ${hm(todayUp)} of daylight</span>`
    : `<b>No direct sun</b> <span class="spot-muted">in ${hm(todayUp)} of daylight</span>`;
  return `<div class="spot">
    <div class="spot-title">This sidewalk <span>${day}</span></div>
    <p class="spot-lead">${lead}</p>
    ${dayStrip(r.today, input.now)}
    ${rank}
    <div class="spot-year"><b>${Math.round(yearSun / 60)} h</b> of sun a year <span class="spot-muted">· ${Math.round((100 * yearSun) / Math.max(1, yearLight))}% of daylight</span></div>
    ${monthChart(rows, month)}
    <p class="spot-tip spot-muted">Sun a day, over the day's daylight. Sunniest in ${MONTHS[best]} (${hm(rows[best].sun)}), darkest in ${MONTHS[worst]} (${hm(rows[worst].sun)}). ${sunless ? `${sunless} days a year without sun.` : 'Some sun every day of the year.'}</p>
  </div>`;
}

/** Hovering a month's bar reads its numbers in the line under the chart. */
export function bindSpot(root: HTMLElement) {
  const tip = root.querySelector<HTMLElement>('.spot-tip');
  if (!tip) return;
  const rest = tip.textContent;
  for (const bar of root.querySelectorAll<SVGGElement>('.months .bar')) {
    bar.addEventListener('mouseenter', () => (tip.textContent = bar.dataset.tip ?? rest));
    bar.addEventListener('mouseleave', () => (tip.textContent = rest));
  }
}
