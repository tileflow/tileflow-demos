const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

// Coordinates are relative to the map canvas. Upper controls establish a
// minimum y. The lower legend establishes a maximum y only under its column.
export function placeBusCard({w, h, cw, ch, x, y, gap, lift, headerOffset, side, obstacles}) {
  const bottom = Math.max(14, h - ch - 42);
  const wantedTop = y - lift - headerOffset;
  function candidate(direction, rawLeft, preferredTop = wantedTop) {
    const left = clamp(rawLeft, 14, w - cw - 14);
    const across = obstacles.filter((r) => left < r.right + 8 && left + cw > r.left - 8);
    let min = 14,
      max = bottom;
    for (const r of across) {
      if (r.bottomAnchor) max = Math.min(max, r.top - ch - 10);
      else min = Math.max(min, r.bottom + 10);
    }
    if (preferredTop < min && y + lift - headerOffset <= max) preferredTop = y + lift - headerOffset;
    const top = min <= max ? clamp(preferredTop, min, max) : clamp(preferredTop, 14, bottom);
    const overlap = across.reduce(
      (area, r) =>
        area +
        Math.max(0, Math.min(left + cw, r.right + 8) - Math.max(left, r.left - 8)) *
          Math.max(0, Math.min(top + ch, r.bottom + 8) - Math.max(top, r.top - 8)),
      0,
    );
    const edgeDistance = direction === 1 ? left - x : x - left - cw;
    const endY = clamp(top + headerOffset, top + 18, top + ch - 18);
    const length = Math.hypot(edgeDistance, endY - y);
    return {left, top, side: direction, overlap, gap: edgeDistance, length};
  }
  function beside(direction) {
    return candidate(direction, direction === 1 ? x + gap : x - gap - cw);
  }
  const primary = beside(side);
  if (primary.overlap === 0 && primary.gap >= 8 && primary.length <= 265) return primary;
  const choices = [primary, beside(-side)];
  // A tall card can fill the entire space between header and summary. Its
  // nearest free column may start immediately to the right of the summary.
  for (const r of obstacles)
    if (r.bottomAnchor) {
      const left = clamp(r.right + 10, 14, w - cw - 14);
      choices.push(candidate(left + cw / 2 > x ? 1 : -1, left));
    }
  const penalty = (p) => Math.max(0, 8 - p.gap) * 5 + p.length + (p.side === side ? 0 : 28);
  return choices.reduce((best, p) =>
    p.overlap < best.overlap || (p.overlap === best.overlap && penalty(p) < penalty(best)) ? p : best,
  );
}

// A selected card lives in viewport coordinates. Only a changed viewport or
// UI obstacle can dislodge it, by the minimum distance needed to fit again.
export function constrainBusCard(position, {w, h, cw, ch, obstacles}) {
  const xMax = Math.max(14, w - cw - 14),
    yMax = Math.max(14, h - ch - 42);
  const left = clamp(position.left, 14, xMax),
    top = clamp(position.top, 14, yMax);
  const overlap = (x, y) =>
    obstacles.reduce(
      (total, r) =>
        total +
        Math.max(0, Math.min(x + cw, r.right + 8) - Math.max(x, r.left - 8)) *
          Math.max(0, Math.min(y + ch, r.bottom + 8) - Math.max(y, r.top - 8)),
      0,
    );
  let best = {left, top},
    leastOverlap = overlap(left, top),
    leastMove = 0;
  if (leastOverlap === 0) return best;
  const xs = [left],
    ys = [top];
  for (const r of obstacles) {
    xs.push(clamp(r.left - cw - 10, 14, xMax), clamp(r.right + 10, 14, xMax));
    ys.push(clamp(r.top - ch - 10, 14, yMax), clamp(r.bottom + 10, 14, yMax));
  }
  for (const x of xs)
    for (const y of ys) {
      const area = overlap(x, y),
        move = (x - position.left) ** 2 + (y - position.top) ** 2;
      if (area < leastOverlap || (area === leastOverlap && move < leastMove)) {
        best = {left: x, top: y};
        leastOverlap = area;
        leastMove = move;
      }
    }
  return best;
}

export function busConnector({x, y}, {left, top, width, height}) {
  const right = left + width,
    bottom = top + height;
  const inset = Math.min(16, height / 2, width / 2);
  const nearY = clamp(y, top + inset, bottom - inset);
  const nearX = clamp(x, left + inset, right - inset);
  const edges = [];
  if (x < left) edges.push({x: left, y: nearY, dx: -1, dy: 0});
  if (x > right) edges.push({x: right, y: nearY, dx: 1, dy: 0});
  if (y < top) edges.push({x: nearX, y: top, dx: 0, dy: -1});
  if (y > bottom) edges.push({x: nearX, y: bottom, dx: 0, dy: 1});
  if (!edges.length) return null;
  const distance = (e) => (e.x - x) ** 2 + (e.y - y) ** 2;
  const edge = edges.reduce((a, b) => (distance(a) <= distance(b) ? a : b));
  const distanceToSide = Math.abs(edge.dx ? x - edge.x : y - edge.y);
  const lip = Math.min(23, distanceToSide * 0.26);
  // A gently angled approach leaves the short final leg distinct.
  if (edge.dx) edge.y = clamp(y - Math.min(38, distanceToSide * 0.3), top + inset, bottom - inset);
  return {endX: edge.x, endY: edge.y, elbowX: edge.x + edge.dx * lip, elbowY: edge.y + edge.dy * lip};
}
