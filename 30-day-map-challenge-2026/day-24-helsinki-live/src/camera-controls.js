export function attachCameraControls(map, controller) {
  const byId = id => document.getElementById(id);
  const toggle = byId('map-view');
  const tilt = byId('map-tilt');
  const dial = byId('north-dial');
  const controls = byId('camera-controls');
  let threeD = true;
  let lastTilt = 48;
  let frame;

  function syncTilt() {
    frame = undefined;
    const limit = map.getMaxPitch();
    const pitch = Math.min(Math.round(map.getPitch()), limit);
    tilt.max = String(limit);
    tilt.value = String(pitch);
    tilt.disabled = !threeD || limit === 0;
    tilt.setAttribute('aria-valuetext', pitch + ' degrees');
  }
  function scheduleTilt() {
    frame ??= requestAnimationFrame(syncTilt);
  }
  function syncNorth() {
    dial.style.transform = 'rotate(' + (-map.getBearing()) + 'deg)';
  }
  function switchView(enabled) {
    threeD = enabled;
    controller.update({viewMode: enabled ? '3d' : '2d'});
    const next = enabled ? '2D' : '3D';
    toggle.textContent = next;
    toggle.title = 'Switch to ' + next;
    toggle.setAttribute('aria-label', toggle.title);
    tilt.parentElement.hidden = !enabled;
    syncTilt();
  }

  toggle.onclick = () => {
    if (threeD && map.getPitch() > 0) lastTilt = map.getPitch();
    switchView(!threeD);
    map.easeTo({pitch: threeD ? Math.min(lastTilt, map.getMaxPitch()) : 0, duration: 500});
  };
  tilt.oninput = () => map.jumpTo({pitch: Number(tilt.value)});
  byId('north').onclick = () => map.resetNorth();
  byId('plus').onclick = () => map.zoomIn();
  byId('minus').onclick = () => map.zoomOut();
  for (const button of controls.querySelectorAll('button')) button.disabled = false;
  syncTilt();
  syncNorth();
  map.on('pitch', scheduleTilt);
  map.on('zoom', scheduleTilt);
  map.on('styledata', scheduleTilt);
  map.on('rotate', syncNorth);
  map.on('pitchstart', event => {
    if (!threeD && event.originalEvent) switchView(true);
  });
  map.once('remove', () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  // Presets and Back respect a flat view selected from the toolbar.
  return pitch => threeD ? pitch : 0;
}
