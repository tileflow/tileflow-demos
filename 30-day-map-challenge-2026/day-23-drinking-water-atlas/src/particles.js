const TAU = 2 * Math.PI;
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const mix = (a, b, t) => a + (b - a) * t;
function ease(t) { t = clamp(t); return t * t * (3 - 2 * t); }
const smooth = (from, to, x) => ease((x - from) / (to - from));
function cubic(a, b, c, d, t) {
  const s = 1 - t;
  return s * s * (s * a + 3 * t * b) + t * t * (3 * s * c + t * d);
}
function randomFor(code) {
  let seed = [...code].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0), 73);
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function beadSprite(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(16, 16, 14.5, 0, TAU);
  g.fillStyle = color; g.fill();
  g.lineWidth = 2; g.strokeStyle = '#fffae7c9'; g.stroke();
  return c;
}
// Seat each population separately so even a single person remains in the correct band.
function populate(count, first, rows, total, rand) {
  const beads = [];
  const weight = r => mix(1, .78, (first + r + .5) / total);
  let sum = 0, used = 0;
  for (let r = 0; r < rows; r++) sum += weight(r);
  for (let r = 0; r < rows; r++) {
    used += count * weight(r) / sum;
    const n = Math.round(used) - beads.length;
    const span = Math.min(1, n / (1000 / total * weight(r) / .89));
    for (let c = 0; c < n; c++) {
      beads.push({
        u: .5 + ((c + .5 + (rand() - .5) * .65) / n - .5) * span,
        v: (r + .5 + (rand() - .5) * .57) / rows,
        phase: rand() * TAU, depth: rand(), scatter: rand(), lane: rand(), timing: rand(),
      });
    }
  }
  return beads;
}

function makeGlass(f) {
  const {cx, top, bottom, base, lip, oval, corner, heel, waterY, H} = f;
  const body = new Path2D();
  body.moveTo(cx - lip, top);
  body.ellipse(cx, top, lip, oval, 0, Math.PI, TAU);
  body.lineTo(cx + base, bottom - corner);
  body.arc(cx + base - corner, bottom - corner, corner, 0, Math.PI / 2);
  body.quadraticCurveTo(cx, bottom + 2 * heel, cx - base + corner, bottom);
  body.arc(cx - base + corner, bottom - corner, corner, Math.PI / 2, Math.PI);
  body.closePath();
  const lipLine = new Path2D();
  lipLine.ellipse(cx, top, lip, oval, 0, 0, Math.PI);
  const surface = new Path2D(), wetR = mix(lip, base, (waterY - top) / H);
  surface.moveTo(cx - wetR, waterY);
  surface.bezierCurveTo(cx - wetR * .54, waterY + oval * .37,
    cx + wetR * .46, waterY - oval * .32, cx + wetR, waterY);
  return {body, lip: lipLine, surface};
}
function paintGlass(ctx, f, opacity) {
  if (!opacity) return;
  const {body, lip, surface} = f.art;
  ctx.save(); ctx.globalAlpha = opacity;
  // A flat 6% wash preserves the coastline and details directly behind the glass.
  ctx.fillStyle = 'rgba(249,255,240,.06)'; ctx.fill(body);
  ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#21665fc4'; ctx.stroke(body);
  ctx.strokeStyle = '#26665c7d'; ctx.lineWidth = .9; ctx.stroke(lip);
  ctx.strokeStyle = '#267d6e67'; ctx.lineWidth = .85; ctx.stroke(surface);
  ctx.restore();
}

// Side-by-side layouts approach the lip in an arc from the country. On a tall
// screen the country sits above the glass, so the stream can descend directly.
function planBead(p, f, origin, w, h) {
  const {cx, top, H, lip, oval} = f;
  const above = origin.y < top + H * .05 && Math.abs(origin.x - cx) < lip * 2.5;
  const side = origin.x <= cx ? -1 : 1;
  const spread = .20 + .80 * Math.sqrt(p.depth);
  const far = Math.max(8, (side < 0 ? cx : w - cx) - 8), near = Math.min(lip * 1.12, far);
  const radius = Math.min(lip * .74, (far - near) * .46);
  const distance = clamp(Math.abs(origin.x - cx), near + radius, far - radius);
  const sourceX = above ? clamp(origin.x + Math.cos(p.phase) * lip * spread * .74, 8, w - 8)
    : cx + side * (distance + Math.cos(p.phase) * radius * spread);
  const sourceBand = above ? Math.min(H * .17, (top - 10) * .24) : H * .19;
  const sourceCenterY = above ? Math.min(origin.y, top - sourceBand - Math.max(5, f.oval)) : origin.y;
  const sourceY = clamp(sourceCenterY + Math.sin(p.phase) * sourceBand * spread, 8, h - 8);
  const mouthX = cx + lip * ((p.scatter - .5) * 1.5 + Math.sin(p.phase) * .065);
  const mouthY = top + (p.lane - .5) * oval * .40;
  const crestX = cx + side * lip * (1.05 + p.scatter * .22);
  const rise = Math.min(Math.max(6, top - 10), H * (.13 + .12 * p.lane));
  const drop = Math.min(rise * .73, H * .11);
  const launch = .10 + p.timing * .46;
  const duration = .31 + .10 * p.depth;
  return {
    above, side, sourceX, sourceY,
    crestX, crestY: top - rise, mouthX, mouthY, drop, launch, duration,
  };
}
function fly(p, f, targetX, targetY, t) {
  const {above, side, sourceX, sourceY, crestX, crestY, mouthX, mouthY, drop} = p.trip;
  const progress = ease(t), cross = above ? .52 : .59;
  let x, y;
  if (above && progress < cross) {
    const u = progress / cross;
    x = cubic(sourceX, sourceX + side * f.lip * (.11 + .24 * p.lane), mouthX, mouthX, u);
    y = cubic(sourceY, mix(sourceY, mouthY, .32), mouthY - drop, mouthY, u);
  } else if (!above && progress < .30) {
    const u = progress / .30;
    x = cubic(sourceX, sourceX, crestX + side * f.lip * .26, crestX, u);
    y = cubic(sourceY, mix(sourceY, crestY, .54), crestY, crestY, u);
  } else if (progress < cross) {
    const u = (progress - .30) / (cross - .30);
    x = cubic(crestX, crestX - side * f.lip * .26 * ((cross - .30) / .30), mouthX, mouthX, u);
    y = cubic(crestY, crestY, mouthY - drop, mouthY, u);
  } else {
    const u = (progress - cross) / (1 - cross);
    const previousSpan = above ? cross : cross - .30;
    // Matching derivatives on both sides of the lip keeps the crossing continuous.
    x = cubic(mouthX, mouthX, mix(targetX, mouthX, .19) + (p.lane - .5) * f.lip * .10, targetX, u);
    y = cubic(mouthY, mouthY + drop * (1 - cross) / previousSpan, mix(targetY, mouthY, .15), targetY, u);
  }
  return {x, y, scale: mix(.77, 1, smooth(.12, .78, t)), alpha: smooth(0, .13, t)};
}

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d');
  const card = document.querySelector('.card'), notes = document.querySelector('#annotations');
  const labels = [document.querySelector('#safe-label'), document.querySelector('#other-label')];
  const sprites = [beadSprite('#047b60'), beadSprite('#e56849')];
  let groups = [[], []], split = 0, geometry, w = 0, h = 0, labelW, labelH, portrait;
  let displayed = false, labelAlpha = -1, anchorsDirty = true, flightDirty = true, originHint;

  function configure(row) {
    const good = Math.round(row.value * 10), totalRows = 37, rand = randomFor(row.code);
    const fraction = good / 1000;
    const areaHeight = fraction * 1.78 / (1 + Math.sqrt(1 - (1 - .78 * .78) * fraction));
    const upperRows = good === 0 ? 0 : good === 1000 ? totalRows : clamp(Math.round(totalRows * areaHeight), 1, totalRows - 1);
    split = upperRows / totalRows;
    groups = [populate(good, 0, upperRows, totalRows, rand), populate(1000 - good, upperRows, totalRows - upperRows, totalRows, rand)];
    for (let k = 0; k < 2; k++) {
      const count = groups[k].length, value = k ? 100 - row.value : row.value, proxy = row.method === 'proxy';
      labels[k].classList.toggle('four-digits', count === 1000);
      labels[k].querySelector('strong').textContent = count.toLocaleString('en');
      labels[k].querySelector('.annotation-value span').textContent = (proxy ? '≈' : '') +
        value.toLocaleString('en', {minimumFractionDigits: proxy ? 0 : 1, maximumFractionDigits: proxy ? 0 : 1}) + '%';
    }
    anchorsDirty = flightDirty = true;
  }
  function setOrigin(point) {
    originHint = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.visible !== false
      ? {x: point.x / Math.max(1, w), y: point.y / Math.max(1, h)} : null;
    flightDirty = true;
  }
  function resize() {
    const r = canvas.getBoundingClientRect(), c = card.getBoundingClientRect();
    w = r.width; h = r.height;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!w || !h) { geometry = null; return; }
    portrait = w / h < .98 || w < 620;
    const compact = w <= 700 || h <= 510;
    labelW = compact ? 123 : 144; labelH = compact ? 48 : 61;
    const room = Math.max(70, w - c.right - 2 * labelW - 54);
    const H = Math.max(64, portrait ? Math.min(w * .78, h * .39, Math.max(68, h - Math.min(c.bottom, h * .32) - 2 * labelH - 48))
      : Math.min(h * .60, room / .70));
    const lip = H * .35, base = lip * .78, oval = lip * .068, heel = H * .008;
    const cx = portrait ? w * .5 : clamp(w * .72, c.right + labelW + 24 + lip, w - labelW - 24 - lip);
    const cy = portrait ? clamp(h * .675, Math.min(c.bottom, h * .32) + labelH + H / 2 + 14, h - labelH - 24 - H / 2) : h * .51;
    const top = cy - H / 2;
    geometry = {cx, top, bottom: top + H, lip, base, oval, heel, H, corner: lip * .095, waterY: top + H * .098};
    geometry.art = makeGlass(geometry);
    displayed = false; anchorsDirty = flightDirty = true;
  }
  function positionNotes(edges) {
    const f = geometry;
    f.leaders = [];
    for (let k = 0; k < 2; k++) {
      const sign = k ? 1 : -1, ay = (edges[k] + edges[k + 1]) / 2;
      const ax = f.cx + sign * (mix(f.lip, f.base, clamp((ay - f.top) / f.H)) + 2);
      const lx = portrait ? clamp(k ? f.cx + f.base - labelW + 9 : f.cx - f.lip - 9, 6, w - labelW - 6)
        : clamp(k ? ax + 19 : ax - 19 - labelW, 6, w - labelW - 6);
      const ly = portrait ? clamp(k ? f.bottom + f.heel + 13 : f.top - f.oval - labelH - 12, 4, h - labelH - 5)
        : clamp(ay - labelH * .5, 7, h - labelH - 7);
      labels[k].style.transform = 'translate(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px)';
      const line = new Path2D(); line.moveTo(ax, ay);
      const toX = portrait ? lx + labelW * .5 : k ? lx : lx + labelW;
      const toY = portrait ? k ? ly : ly + labelH - 3 : ly + labelH * .5;
      if (portrait) {
        const x = f.cx + sign * (f.lip + 9); line.lineTo(x, ay); line.lineTo(x, toY + (k ? -5 : 5));
      }
      line.lineTo(toX, toY); f.leaders.push({line, ax, ay});
    }
    anchorsDirty = false;
  }
  function draw(phase, time = 0) {
    if (phase <= 0 || !geometry) {
      if (displayed) ctx.clearRect(0, 0, w, h);
      displayed = false; notes.hidden = true; return;
    }
    displayed = true; ctx.clearRect(0, 0, w, h);
    const f = geometry;
    paintGlass(ctx, f, smooth(0, .14, phase));
    const upper = f.waterY + 3, lower = f.bottom - Math.max(4, f.H * .018);
    const edges = [upper, mix(upper, lower, split), lower];
    const baseR = clamp(Math.min(f.lip / 43, f.H / 135), 1.05, 3.55);
    if (phase < 1 && flightDirty) {
      const origin = originHint ? {x: originHint.x * w, y: originHint.y * h}
        : portrait ? {x: w * .45, y: h * .32} : {x: w * .38, y: h * .51};
      for (const group of groups) for (const p of group) p.trip = planBead(p, f, origin, w, h);
      flightDirty = false;
    }
    for (let k = 0; k < 2; k++) {
      const a = edges[k], b = edges[k + 1];
      for (const p of groups[k]) {
        if (phase < 1 && phase <= p.trip.launch) continue;
        let u = p.u, v = p.v;
        const du = 2 * u - 1, dv = 2 * v - 1, rr = du * du + dv * dv;
        if (rr < 1) {
          const angle = (k ? -1 : 1) * (1 - rr) ** 2 * (time * .41 + .72);
          const cs = Math.cos(angle), sn = Math.sin(angle);
          u = .5 + .5 * (du * cs - dv * sn); v = .5 + .5 * (du * sn + dv * cs);
        }
        u = clamp(u + Math.sin(Math.PI * u) * .024 * Math.sin(TAU * v - time * .61 + p.depth * .65), .010, .990);
        v = clamp(v + Math.sin(Math.PI * v) * .011 * Math.sin(TAU * u + time * .53 + p.phase * .12), .008, .992);
        let y = mix(a, b, v), x = f.cx + (2 * u - 1) * mix(f.lip, f.base, clamp((y - f.top) / f.H)) * .95;
        let r = baseR * (.87 + .23 * p.depth), alpha = 1;
        if (phase < 1 && phase < p.trip.launch + p.trip.duration) {
          const point = fly(p, f, x, y, (phase - p.trip.launch) / p.trip.duration);
          x = point.x; y = point.y; r *= point.scale; alpha = point.alpha;
        }
        if (ctx.globalAlpha !== alpha) ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[k], x - r, y - r, 2 * r, 2 * r);
      }
    }
    ctx.globalAlpha = 1;
    const alpha = smooth(.74, .96, phase);
    if (alpha < .01) { notes.hidden = true; return; }
    if (anchorsDirty) positionNotes(edges);
    notes.hidden = false;
    const opacity = Math.round(alpha * 100) / 100;
    if (opacity !== labelAlpha) { notes.style.opacity = String(opacity); labelAlpha = opacity; }
    for (let k = 0; k < 2; k++) {
      const {line, ax, ay} = f.leaders[k];
      ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.strokeStyle = k ? '#a85840' : '#186d58'; ctx.stroke(line);
      ctx.beginPath(); ctx.arc(ax, ay, 1.9, 0, TAU); ctx.fillStyle = k ? '#d65c40' : '#05795d'; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return {configure, resize, draw, setOrigin};
}
