import {lineColor} from './line-colors.js';

// The symbols use the same screen-space roof bounds as the 3D model. Projected
// GPS points cannot account for either the vehicle's height or its turn.
export function createFleetBadges(map, selectBus) {
  const layer = document.createElement('div');
  layer.className = 'fleet-badges';
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Bus lines');
  map.getCanvasContainer().append(layer);
  const active = new Map();
  const pool = [];
  const widths = new Map();
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '750 13px Geist, sans-serif';
  document.fonts?.ready.then(() => widths.clear());

  layer.addEventListener('click', event => {
    const button = event.target.closest('button[data-bus]');
    if (!button) return;
    event.stopPropagation();
    selectBus(button.dataset.bus);
  });
  layer.addEventListener('dblclick', event => event.stopPropagation());

  function draw(vehicles, roofPoint) {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const kept = new Set();
    const cells = new Map();
    const cellSize = 48, columns = Math.ceil(width / cellSize) + 2;
    const rank = bus => bus.selected ? 0 : active.has(bus.id) ? 1 : 2;
    // Keep the previous winner when nearby vehicles move a few pixels.
    // The open trip shows its number in the card. Leave its label space to nearby buses.
    const ordered = vehicles.filter(bus => !bus.fullTrip && !bus.secondary).sort((a, b) => rank(a) - rank(b));
    for (const bus of ordered) {
      const roof = roofPoint(bus.id);
      if (!roof || roof.x < 0 || roof.x > width || roof.y < 0 || roof.y > height) continue;
      const line = String(bus.line);
      if (!widths.has(line)) widths.set(line, Math.max(24, Math.ceil(measure.measureText(line).width) + 15));
      const w = widths.get(line), h = 22;
      const left = Math.round(Math.max(1, Math.min(width - w - 1, roof.x - w / 2)));
      const above = roof.top - 5 - h;
      const top = Math.round(above >= 1 ? above : Math.max(1, Math.min(height - h - 1, roof.bottom + 5)));
      const box = {x1:left - 2, x2:left + w + 2, y1:top - 2, y2:top + h + 2};
      const keys = [];
      let occupied = false;
      for (let y = Math.floor(box.y1 / cellSize); y <= Math.floor(box.y2 / cellSize) && !occupied; y++) {
        for (let x = Math.floor(box.x1 / cellSize); x <= Math.floor(box.x2 / cellSize); x++) {
          const key = y * columns + x;
          if (cells.get(key)?.some(b => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1)) {
            occupied = true;
            break;
          }
          keys.push(key);
        }
      }
      if (occupied) continue;
      for (const key of keys) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box);
      }
      kept.add(bus.id);
      let button = active.get(bus.id);
      if (!button) {
        button = pool.pop() ?? document.createElement('button');
        button.className = 'bus-label';
        button.type = 'button';
        button.dataset.bus = bus.id;
        active.set(bus.id, button);
        layer.append(button);
      }
      if (button.textContent !== line) {
        button.textContent = line;
        button.style.setProperty('--line-body', lineColor(line).body);
      }
      const name = 'Line ' + line + (bus.destination ? ' to ' + bus.destination : ', bus ' + bus.id);
      if (button.getAttribute('aria-label') !== name) button.setAttribute('aria-label', name);
      const position = 'translate(' + left + 'px, ' + top + 'px)';
      if (button.style.transform !== position) button.style.transform = position;
    }
    for (const [id, button] of active) {
      if (kept.has(id)) continue;
      button.remove();
      active.delete(id);
      if (pool.length < 24) pool.push(button);
    }
  }
  map.on('remove', () => {
    layer.remove();
    active.clear();
    pool.length = 0;
  });
  return {draw, has: id => active.has(id)};
}
