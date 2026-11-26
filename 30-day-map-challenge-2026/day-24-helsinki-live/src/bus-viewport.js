const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = rect => ({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2});
const marker = {left: 6, right: 6, top: 6, bottom: 6};

// A touching edge is visible. This lets a marker fit exactly between two panels.
function fits(point, bounds, blocks) {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom &&
    !blocks.some(r => point.x > r.left && point.x < r.right && point.y > r.top && point.y < r.bottom);
}

function clampTo(point, bounds) {
  return {x: clamp(point.x, bounds.left, bounds.right), y: clamp(point.y, bounds.top, bounds.bottom)};
}

function inset(rect, x, y = x) {
  return {left: rect.left + x, right: rect.right - x, top: rect.top + y, bottom: rect.bottom - y};
}

// The closest point in a rectilinear free region is the input itself, a perpendicular
// projection onto an edge, or a corner formed by two edges (possibly from different panels).
function nearest(point, bounds, blocks, previous) {
  if (bounds.left > bounds.right || bounds.top > bounds.bottom) return null;
  if (fits(point, bounds, blocks)) return point;
  const within = clampTo(point, bounds);
  const xs = new Set([within.x, bounds.left, bounds.right]);
  const ys = new Set([within.y, bounds.top, bounds.bottom]);
  for (const r of blocks) {
    for (const x of [r.left, r.right]) if (x >= bounds.left && x <= bounds.right) xs.add(x);
    for (const y of [r.top, r.bottom]) if (y >= bounds.top && y <= bounds.bottom) ys.add(y);
  }
  let best = null, score = Infinity;
  for (const x of xs) for (const y of ys) {
    const p = {x, y};
    if (!fits(p, bounds, blocks)) continue;
    // A small bias resolves near ties as a moving bus passes a corner.
    const cost = distance(p, point) + (previous ? Math.min(3, distance(p, previous) * .05) : 0);
    if (cost < score) { best = p; score = cost; }
  }
  return best;
}

// Center the bus in the largest unobstructed map rectangle. A floating panel
// only affects strips it actually overlaps. Run this search only on explicit recenter.
function largestFreeRect(bounds, blocks, previous) {
  if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) return null;
  const xs = [...new Set([bounds.left, bounds.right, ...blocks.flatMap(r => [
    clamp(r.left, bounds.left, bounds.right), clamp(r.right, bounds.left, bounds.right),
  ])])].sort((a, b) => a - b);
  const byY = [...blocks].sort((a, b) => a.top - b.top);
  const preferred = previous ?? middle(bounds);
  let best = null, maxArea = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const left = xs[i], right = xs[j];
      let y = bounds.top;
      function consider(bottom) {
        if (bottom <= y) return;
        const area = (right - left) * (bottom - y);
        const p = {x: (left + right) / 2, y: (y + bottom) / 2};
        if (area > maxArea || (area === maxArea && distance(p, preferred) < distance(middle(best), preferred))) {
          best = {left, right, top: y, bottom};
          maxArea = area;
        }
      }
      for (const r of byY) {
        if (r.left >= right || r.right <= left || r.bottom <= y || r.top >= bounds.bottom) continue;
        consider(r.top);
        y = Math.max(y, r.bottom);
        if (y >= bounds.bottom) break;
      }
      consider(bounds.bottom);
    }
  }
  return best;
}

// The DOM reads live in the caller. The canvas and obstacles use client coordinates;
// place() takes and returns coordinates relative to the canvas, in CSS pixels.
export function createBusViewport(canvas, obstacles = []) {
  const width = canvas.width ?? canvas.right - canvas.left;
  const height = canvas.height ?? canvas.bottom - canvas.top;
  const blocks = [];
  for (const r of obstacles) {
    if (!r) continue;
    const left = Math.max(0, r.left - canvas.left), top = Math.max(0, r.top - canvas.top);
    const right = Math.min(width, (r.right ?? r.left + r.width) - canvas.left);
    const bottom = Math.min(height, (r.bottom ?? r.top + r.height) - canvas.top);
    if (right > left && bottom > top) blocks.push({left, top, right, bottom});
  }

  function place(point, {mode = 'reveal', footprint = marker, previous, motion} = {}) {
    // Expand each obstacle by the opposite side of the vehicle. This handles a
    // projected roof/label reaching much further above its anchor than below it.
    const {left = 0, top = 0, right = 0, bottom = 0} = footprint;
    const bounds = {left, right: width - right, top, bottom: height - bottom};
    const blocked = blocks.map(r => ({
      left: r.left - right, top: r.top - bottom, right: r.right + left, bottom: r.bottom + top,
    }));
    const visible = fits(point, bounds, blocked);
    const stay = {x: point.x, y: point.y, visible, feasible: visible};
    if (mode === 'reveal' && visible) return stay;
    const marginX = Math.min(68, width * .12), marginY = Math.min(54, height * .12);
    // Leave a little room between the threshold and the target so the next GPS
    // update does not immediately start another camera movement.
    if (mode === 'follow' && visible && fits(point, inset(bounds, marginX * .8, marginY * .8),
      blocked.map(r => inset(r, -8)))) return stay;
    const inner = inset(bounds, marginX, marginY);
    const buffered = blocked.map(r => inset(r, -12));
    let target;
    if (mode === 'center') {
      const free = largestFreeRect(inner, buffered, previous) ?? largestFreeRect(bounds, blocked, previous);
      if (free) target = middle(free);
    } else {
      target = nearest(point, inner, buffered, previous);
      // A tiny, usable pocket must not cause a jump to the other side of a large panel.
      if (target && distance(target, point) > Math.max(marginX, marginY) + 12) {
        const closest = visible ? point : nearest(point, bounds, blocked, previous);
        if (closest && distance(target, point) > distance(closest, point) + Math.max(marginX, marginY) + 12) target = closest;
      }
      if (mode === 'follow' && visible && target && motion) {
        const approachingX = (target.x - point.x) * motion.x < 0;
        const approachingY = (target.y - point.y) * motion.y < 0;
        if (!approachingX && !approachingY) return stay;
      }
    }
    // Tight layouts can lack comfort margins and still have enough space for the
    // marker. If even the marker cannot fit, report it so the camera can stay still.
    target ??= nearest(point, bounds, blocked, previous);
    return {x: target?.x ?? point.x, y: target?.y ?? point.y, visible, feasible: Boolean(target)};
  }
  return {place, freeRect: () => largestFreeRect({left: 0, right: width, top: 0, bottom: height}, blocks)};
}
