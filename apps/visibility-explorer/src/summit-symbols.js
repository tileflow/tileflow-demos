// MapLibre packs these small, high-resolution drawings into its style atlas.
// Filled peaks are visible, outlined peaks are blocked, and the flag marks a focus.
export function registerSummitSymbols(map) {
  const ratio = 3;
  const canvas = document.createElement('canvas');
  canvas.width = 28 * ratio;
  canvas.height = 27 * ratio;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.scale(ratio, ratio);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const mountain = new Path2D('M2.5 23.5 9.6 12.6 12 15.2 17.5 6.8 25.4 23.5Z');
  const snow = new Path2D('M13.6 15.1 17.45 9 21.05 15.8 17.8 14.1 16.2 15.8Z');
  const flag = new Path2D('M17.5 7V1.8L24.6 3.1 17.5 5.8');

  function draw(state, focused) {
    ctx.clearRect(0, 0, 28, 27);
    const color = state === 'visible' ? '#235744' : state === 'hidden' ? '#755447' : '#4d5350';
    ctx.strokeStyle = '#fffefa';
    ctx.lineWidth = 3.7;
    ctx.stroke(mountain);
    if (focused) ctx.stroke(flag);
    ctx.fillStyle = state === 'visible' || state === 'atlas' ? color : '#fffefa';
    ctx.fill(mountain);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.stroke(mountain);
    ctx.fillStyle = state === 'visible' || state === 'atlas' ? '#fffefa' : color;
    ctx.fill(snow);
    if (focused) {
      ctx.fillStyle = '#db7c2f';
      ctx.fill(flag);
      ctx.strokeStyle = '#5e3726';
      ctx.lineWidth = 1.15;
      ctx.stroke(flag);
    }
    const suffix = focused ? '-focus' : '';
    map.addImage('explorer-summit-' + state + suffix, ctx.getImageData(0, 0, canvas.width, canvas.height), {pixelRatio: ratio});
  }
  for (const state of ['atlas', 'visible', 'hidden', 'unknown']) {
    draw(state, false);
    if (state !== 'atlas') draw(state, true);
  }
}
