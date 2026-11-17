// Solar position (NOAA) and time-zone helpers shared by the page and the worker.

const rad = Math.PI / 180;

/** Altitude and azimuth (degrees, azimuth clockwise from north) of the sun at an instant. */
export function solarPosition(when: Date, lat: number, lon: number): {altitude: number; azimuth: number} {
  const jd = when.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * rad;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(appLong * rad));
  const y = Math.tan((eps * rad) / 2) ** 2;
  const l0r = l0 * rad;
  const eqTime =
    (4 / rad) *
    (y * Math.sin(2 * l0r) -
      2 * e * Math.sin(mr) +
      4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * y * y * Math.sin(4 * l0r) -
      1.25 * e * e * Math.sin(2 * mr));
  const minutes = when.getUTCHours() * 60 + when.getUTCMinutes() + when.getUTCSeconds() / 60;
  const tst = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * rad;
  const latr = lat * rad;
  const cosZen = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) / rad + 180;
  return {altitude: 90 - zen / rad, azimuth: ((az % 360) + 360) % 360};
}

/** Minutes the time zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The instant of a local wall-clock time (minutes after midnight) on a date in a time zone. */
export function localInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, 0, minutes));
  const offset = zoneOffsetMinutes(timeZone, guess);
  const first = new Date(guess.getTime() - offset * 60000);
  const corrected = zoneOffsetMinutes(timeZone, first);
  return corrected === offset ? first : new Date(guess.getTime() - corrected * 60000);
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
