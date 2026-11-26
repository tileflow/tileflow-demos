// The artwork is drawn in bus coordinates. Both sides use their own outward-reading lettering.
// References: VynedJ's Nobina 1526 photograph and the Yutong U12 Nordic product sheet.
import {CanvasTexture, SRGBColorSpace} from 'three';

export const LENGTH = 12.17;
export const WIDTH = 2.55;
export const HEIGHT = 3.19;
export const BLUE = '#107fc1';
const WHITE = '#edf2f3';
const INK = '#101c21';

function surface(width, height, columns, rows) {
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(columns / width, 0, 0, -rows / height, columns / 2, rows);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return {ctx, texture};
}

function path(ctx, d, color, width) {
  const shape = new Path2D(d);
  if (!width) {
    ctx.fillStyle = color;
    ctx.fill(shape);
    return;
  }
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke(shape);
}
function rect(ctx, x, y, w, h, radius, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}
function line(ctx, x, y, text, size, ink, mirror, weight = 600, align = 'center', maxWidth) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirror, -1);
  // Work at a full font pixel size for engines that round subpixel font sizes.
  ctx.scale(size / 100, size / 100);
  ctx.font = weight + ' 100px Arial, sans-serif';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  if (maxWidth) ctx.fillText(text, 0, 0, (100 * maxWidth) / size);
  else ctx.fillText(text, 0, 0);
  ctx.restore();
}

function hsl(ctx, x, y, size, mirror, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirror * size, size);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 0.075;
  ctx.beginPath();
  ctx.arc(-0.55, 0, 0.32, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.arc(-0.55 + 0.39 * Math.cos(a), 0.39 * Math.sin(a), 0.102, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(0.02, -0.43, 0.037, 0.86);
  line(ctx, 0.2, 0.2, 'HSL', 0.47, ink, 1, 650, 'left');
  line(ctx, 0.2, -0.21, 'HRT', 0.47, ink, 1, 650, 'left');
  ctx.restore();
}
function nobina(ctx, x, y, size, mirror) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size * mirror, size);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 0.078;
  ctx.beginPath();
  ctx.ellipse(0.23, 0, 0.43, 0.46, 0, -0.7 * Math.PI, 0.65 * Math.PI);
  ctx.stroke();
  line(ctx, -0.06, -0.01, 'Nobina', 0.49, WHITE, 1, 700);
  ctx.restore();
}
function serviceDots(ctx, x, y, mirror) {
  for (let i = 0; i < 3; i++) {
    const px = x - i * 0.11 * mirror;
    ctx.beginPath();
    ctx.fillStyle = '#107bbb';
    ctx.arc(px, y, 0.047, 0, 7);
    ctx.fill();
    ctx.lineWidth = 0.006;
    ctx.strokeStyle = WHITE;
    ctx.stroke();
    line(ctx, px, y, ['i', 'P', '+'][i], 0.067, WHITE, mirror);
  }
}
function sideCable(ctx) {
  // One continuous lead, seen across the glass, folding doors and painted skirt.
  const lead =
    'M -2.76 1.12 C -2.52 1.07 -2.76 .40 -2.11 .39 C -.85 .33 -.90 2.57 -.12 2.58 C .66 2.55 .48 .40 1.31 .36 C 1.99 .36 2.07 1.26 1.85 2.07 C 1.75 2.55 1.46 2.75 1.18 2.76 M 1.29 .39 Q 1.17 .27 .83 .23';
  path(ctx, lead, '#edeee5', 0.091);
  path(
    ctx,
    'M -2.93 1.47 L -2.88 1.12 Q -2.82 .97 -2.68 .99 Q -2.53 1.03 -2.54 1.16 L -2.57 1.49 Z',
    '#edeee5',
  );
  path(ctx, 'M -2.88 1.49 L -2.92 1.70 M -2.64 1.51 L -2.68 1.72', '#edeee5', 0.047);
}

export function sideArt(side, fleet, nobinaLivery) {
  const {ctx, texture} = surface(LENGTH, HEIGHT, 2048, 544);
  const flip = -side;
  rect(ctx, -6.1, 0, 12.2, HEIGHT, 0, WHITE);
  path(
    ctx,
    'M -6.2 0 L 1.53 0 C 2.31 .57 2.65 1.47 2.67 2.04 C 2.68 2.61 2.50 2.98 2.12 3.2 L -6.2 3.2 Z',
    BLUE,
  );
  rect(ctx, -6.1, 1.3, 12.2, 1.59, 0.04, INK);
  // Glazing is a separate curved, tinted surface. Remove the window bays, keeping their gaskets.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const seams = [-5.79, -4.45, -3.41, -1.79, -0.2, 1.08, 2.63, 4.03, 5.79];
  for (let i = 1; i < seams.length; i++) {
    rect(ctx, seams[i - 1] + 0.033, 1.35, seams[i] - seams[i - 1] - 0.066, 1.22, 0.045, 'black');
  }
  ctx.restore();
  // Door leaves own a continuous strip cut from this drawing; the seal and bottom surround remain.
  if (side === 1)
    for (const [z, width] of [
      [-5.1, 1.33],
      [0.44, 1.34],
      [4.63, 0.78],
    ]) {
      rect(ctx, z - width / 2, 0.21, width, 2.42, 0.025, INK);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      const panes = z > 4 ? 1 : 2;
      for (let i = 0; i < panes; i++) {
        rect(
          ctx,
          z - width / 2 + (i * width) / panes + 0.062,
          0.49,
          width / panes - 0.124,
          1.99,
          0.04,
          'black',
        );
      }
      ctx.restore();
      rect(ctx, z - width / 2 + 0.018, 0.215, width - 0.036, 0.026, 0, '#a5afb0');
      rect(ctx, z - width / 2 - 0.03, 2.61, width + 0.06, 0.057, 0.018, '#32424a');
    }
  if (nobinaLivery) sideCable(ctx);
  ctx.save();
  ctx.setLineDash([0.02, 0.06]);
  path(ctx, 'M 2.62 1.35 C 2.72 2.03 2.56 2.58 2.33 2.88', BLUE, 0.021);
  ctx.restore();
  // Service hatches and markers follow the sill around the wheel openings.
  for (const z of [-3.9, -2.27, -0.53, 2.12, 3.68, 5.41]) {
    path(ctx, 'M ' + z + ' .28 L ' + z + ' 1.23', 'rgba(27,52,60,.38)', 0.009);
  }
  for (const z of [-4.04, -1.08, 1.7, 3.6, 5.59]) rect(ctx, z, 0.33, 0.086, 0.034, 0.012, '#e9963e');
  for (let i = 0; i < 9; i++)
    for (let n = 0; n < 4; n++) {
      rect(ctx, 5.42 + i * 0.027, 0.49 + n * 0.024, 0.015, 0.014, 0.006, '#667575');
    }
  if (nobinaLivery) {
    nobina(ctx, -5.13, 2.78, 0.22, flip);
    nobina(ctx, 5.02, 2.79, 0.2, flip);
  }
  line(ctx, -3.39, 1.19, fleet, 0.13, WHITE, flip, 650);
  hsl(ctx, -4.04, 0.94, 0.225, flip, WHITE);
  serviceDots(ctx, -4.12, 1.39, flip);
  return texture;
}

export function endArt(front, fleet, plate, nobinaLivery) {
  const {ctx, texture} = surface(WIDTH, HEIGHT, 576, 720);
  const flip = front ? -1 : 1;
  rect(ctx, -1.3, 0, 2.6, 3.2, 0, front ? BLUE : WHITE);
  const base = front ? 0.99 : 1.15;
  rect(ctx, -1.24, base, 2.48, 3.003 - base, 0.17, '#101a1e');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  rect(ctx, -1.16, base + 0.1, 2.32, front ? 1.45 : 1.19, 0.12, 'black');
  ctx.restore();
  if (front) {
    hsl(ctx, 0.54, 0.61, 0.22, flip, WHITE);
    line(ctx, -0.74, 0.6, fleet, 0.148, WHITE, flip);
    if (nobinaLivery) line(ctx, 0, 0.895, 'Y  U  T  O  N  G', 0.059, '#dedfdd', flip, 600);
    for (const [i, y] of [0.79, 0.67, 0.55].entries()) {
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.arc(1.16, y, 0.041, 0, 7);
      ctx.stroke();
      line(ctx, 1.16, y, ['i', 'P', '+'][i], 0.053, WHITE, flip);
    }
  } else {
    hsl(ctx, -0.38, 0.91, 0.25, flip, BLUE);
    line(ctx, 0.69, 0.81, fleet, 0.14, INK, flip);
    if (nobinaLivery) {
      line(ctx, 0, 1.03, 'Y U T O N G', 0.069, '#475354', flip);
      nobina(ctx, -0.81, 2.9, 0.28, flip);
    }
    for (let n = 0; n < 15; n++) rect(ctx, -0.98, 0.4 + n * 0.029, 0.27, 0.013, 0.005, '#616963');
  }
  if (plate) {
    rect(ctx, -0.242, 0.335, 0.484, 0.139, 0.013, '#2b3741');
    rect(ctx, -0.232, 0.345, 0.464, 0.118, 0.009, '#eef0e9');
    rect(ctx, flip * -0.207 - 0.02, 0.345, 0.038, 0.117, 0, '#1a5095');
    line(ctx, flip * 0.016, 0.403, plate, 0.085, '#12222d', flip, 750);
    line(ctx, flip * -0.208, 0.371, 'FIN', 0.018, '#fff', flip);
  }
  return texture;
}

export function glassTexture() {
  const {ctx, texture} = surface(1, 1, 512, 256);
  const tint = ctx.createLinearGradient(0, 0, 0, 1);
  tint.addColorStop(0, 'rgba(23,42,52,.70)');
  tint.addColorStop(0.29, 'rgba(30,48,58,.65)');
  tint.addColorStop(0.47, 'rgba(53,78,90,.58)');
  tint.addColorStop(0.6, 'rgba(29,48,59,.67)');
  tint.addColorStop(0.86, 'rgba(67,89,101,.70)');
  tint.addColorStop(1, 'rgba(98,119,128,.70)');
  ctx.fillStyle = tint;
  ctx.fillRect(-0.5, 0, 1, 1);
  path(
    ctx,
    'M -.5 .83 Q -.1 .81 .09 .79 T .5 .84 L .5 .88 Q .08 .83 -.22 .85 L -.5 .88 Z',
    'rgba(163,188,195,.11)',
  );
  return texture;
}

export function signArt(lineName, destination, back = false) {
  const {ctx, texture} = surface(1, 1, back ? 192 : 768, 96);
  ctx.resetTransform();
  const {width: w, height: h} = ctx.canvas;
  ctx.fillStyle = '#101711';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f7ffe8';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 100px Arial, sans-serif';
  ctx.fillText(String(lineName || ''), 13, h * 0.55, back ? w - 26 : w * 0.27);
  if (!back) {
    const offset = Math.min(w * 0.3, Math.max(w * 0.14, ctx.measureText(String(lineName || '')).width + 37));
    ctx.font = '600 65px Arial, sans-serif';
    ctx.fillText(String(destination || ''), offset, h * 0.55, w - offset - 12);
  }
  // Break the luminous face into LEDs. At normal zoom these blend into the pale white sign.
  ctx.fillStyle = 'rgba(12,29,21,.28)';
  for (let x = 0; x < w; x += 5) ctx.fillRect(x, 0, 0.85, h);
  for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 0.85);
  return texture;
}
