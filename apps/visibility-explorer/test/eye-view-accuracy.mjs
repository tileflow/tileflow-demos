import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const url = process.env.MAP_URL || process.argv[2];
if (!url) throw new Error('Pass a Visibility Explorer URL.');
const output = process.env.SCREENSHOT_DIR;
if (output) await mkdir(output, {recursive: true});
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1180, height: 780}});
const readings = [];
const baseline = process.argv.includes('--measure-only');
page.setDefaultTimeout(45000);

// Observe the two real map instances in this isolated browser, including on a
// production build. Restore ordinary property behavior once both canvases exist.
await page.addInitScript(() => {
  const maps = [];
  Object.defineProperty(Object.prototype, '_canvas', {
    configurable: true,
    set(canvas) {
      Object.defineProperty(this, '_canvas', {value: canvas, configurable: true, writable: true, enumerable: true});
      if (canvas instanceof HTMLCanvasElement && this.getCanvas && this.getZoom) {
        maps.push(this);
        if (maps.length === 2) {
          delete Object.prototype._canvas;
          window.auditWorld = maps.find(map => map.getContainer().id === 'world');
          window.auditEye = maps.find(map => map.getContainer().classList.contains('eye-map'));
        }
      }
    },
  });
});

async function ready(peakName) {
  // ResizeObserver and the app's camera update are scheduled on animation frames.
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const target = peakName && await page.evaluate(async name => {
    const {features} = await window.auditWorld.getSource('discovered-summits').getData();
    const peak = features.find(f => f.properties.name === name);
    if (!peak) throw new Error('Missing analysis peak ' + name);
    return {name, coords: peak.geometry.coordinates};
  }, peakName);
  await page.waitForFunction(expected => {
    const map = window.auditEye, panel = document.querySelector('.eye-panel');
    if (!map?.getTerrain() || panel?.dataset.mapState !== 'ready') return false;
    const tr = map._camera.transform, frame = panel.querySelector('.eye-map');
    // Relocation updates the card before the distant site's terrain arrives.
    // A camera still in Madeira must never count as an Alpine reading.
    const center = map.getCenter();
    if (Math.abs(center.lat - Number(panel.dataset.observerLat)) > 1 ||
      Math.abs(((center.lng - Number(panel.dataset.observerLon) + 540) % 360) - 180) > 1) return false;
    if (Math.abs(tr.width - frame.clientWidth) >= 1 || Math.abs(tr.height - frame.clientHeight) >= 1 ||
      Math.abs(((map.getBearing() - Number(panel.dataset.heading) + 540) % 360) - 180) >= .1) return false;
    if (!expected) return true;
    if (document.querySelector('#profile-name').textContent !== expected.name) return false;
    const [lng, lat] = expected.coords;
    const r = Math.PI / 180, delta = (lng - Number(panel.dataset.observerLon)) * r;
    const a = Number(panel.dataset.observerLat) * r, b = lat * r;
    const azimuth = Math.atan2(Math.sin(delta) * Math.cos(b),
      Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / r;
    return Math.abs(((azimuth - map.getBearing() + 540) % 360) - 180) < .1;
  }, target, {timeout: 120000});
}

async function read(label, peakName) {
  await ready(peakName);
  const measure = await page.evaluate(async ({label, peakName}) => {
    const map = window.auditEye, tr = map._camera.transform;
    const panel = document.querySelector('.eye-panel');
    const from = {lng: Number(panel.dataset.observerLon), lat: Number(panel.dataset.observerLat)};
    const rad = Math.PI / 180;
    function metres(a, b) {
      const s = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
      return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, s)));
    }
    // In perspective projection the common apex of all eye rays projects to
    // the homogeneous clip vector (0,0,1,0). Inverting it yields the actual
    // eye, independently of the helper that requested the camera.
    const inv = new DOMMatrix(tr.modelViewProjectionMatrix).inverse();
    const v = new DOMPoint(0, 0, 1, 0).matrixTransform(inv);
    const x = v.x / v.w / tr.worldSize, y = v.y / v.w / tr.worldSize;
    const eye = {lng: x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / rad, altitudeM: v.z / v.w};
    const ground = map.queryTerrainElevation(eye);
    const heading = Number(panel.dataset.heading);
    const configuredHeightM = document.querySelector('#eye').valueAsNumber;
    const result = {
      label, observer: from, eye, horizontalErrorM: metres(eye, from),
      groundAtEyeM: ground, groundAtObserverM: map.queryTerrainElevation(from),
      heightAboveGroundM: eye.altitudeM - ground, configuredHeightM,
      heading, bearingErrorDeg: Math.abs(((map.getBearing() - heading + 540) % 360) - 180),
      pitch: map.getPitch(),
    };
    if (peakName) {
      const source = window.auditWorld.getSource('discovered-summits');
      const {features} = await source.getData();
      const peak = features.find(feature => feature.properties.name === peakName);
      if (!peak) throw new Error('Missing catalog peak ' + peakName);
      const [lng, lat] = peak.geometry.coordinates;
      const target = {lng, lat};
      const pixel = map.project(target);
      const hit = tr.screenTerrainPointToMercatorCoordinate(pixel, map.terrain);
      const targetM = metres(from, target);
      const eyeToTargetM = metres(eye, target);
      const sampled = hit ? tr.worldCoordinateHelper.lngLatFromWorld(hit.x, hit.y) : null;
      const targetAltitudeM = map.queryTerrainElevation(target);
      const sightAngleDeg = Math.atan2(targetAltitudeM - eye.altitudeM, eyeToTargetM) / rad;
      // Cross-check the renderer's first hit by sampling the displayed DEM
      // along the ray at 10 m intervals, tightening to 2 m near each endpoint.
      // Exclude the final contact with the target's own ground.
      let highestTerrainAngleDeg = -90, maxIntrusionM = -Infinity, obstacleDistanceM = null;
      let sampleCount = 0, coveredSamples = 0;
      const samplePoint = map.getCenter().wrap();
      for (let d = 2; d < eyeToTargetM - 2; d += d < 100 || eyeToTargetM - d < 100 ? 2 : 10) {
        const t = d / eyeToTargetM;
        samplePoint.lng = eye.lng + (lng - eye.lng) * t;
        samplePoint.lat = eye.lat + (lat - eye.lat) * t;
        const data = map.terrain.getElevationAndDEMStateForLngLat(samplePoint, tr.tileZoom);
        sampleCount++;
        if (data.demState !== 'loaded') continue;
        coveredSamples++;
        highestTerrainAngleDeg = Math.max(highestTerrainAngleDeg, Math.atan2(data.elevation - eye.altitudeM, d) / rad);
        const intrusion = data.elevation - (eye.altitudeM + (targetAltitudeM - eye.altitudeM) * t);
        if (intrusion > maxIntrusionM) { maxIntrusionM = intrusion; obstacleDistanceM = d; }
      }
      result.target = {
        name: peakName, profile: document.querySelector('.profile-answer').textContent, targetM,
        eyeToTargetM, hitM: sampled ? metres(eye, sampled) : null,
        hitToTargetM: sampled ? metres(sampled, target) : null,
        altitudeM: targetAltitudeM, sightAngleDeg, highestTerrainAngleDeg, maxIntrusionM, obstacleDistanceM,
        tiltErrorDeg: map.getPitch() - 90 - sightAngleDeg,
        coveredSamples, sampleCount,
        inFrame: pixel.x >= 0 && pixel.y >= 0 && pixel.x <= tr.width && pixel.y <= tr.height,
      };
    }
    return result;
  }, {label, peakName});
  readings.push(measure);
  console.log(JSON.stringify(measure));
  if (output) {
    await writeFile(path.join(output, 'eye-readings.json'), JSON.stringify(readings, null, 2) + '\n');
    await page.locator('.eye-frame').screenshot({path: path.join(output, label + '.png')});
  }
  return measure;
}

async function action(name) {
  const more = page.getByRole('button', {name:'More',exact:true});
  if (await more.getAttribute('aria-expanded') === 'false') await more.click();
  await page.locator('#observer-actions').getByRole('button', {name,exact:true}).click();
}

async function choosePeak(name) {
  await action('Visible peaks');
  await page.getByRole('combobox',{name:'Filter peaks by visibility'}).selectOption('all');
  const choice = page.getByRole('button',{name:new RegExp(name)}).first();
  await choice.focus();
  await choice.press('Enter');
  await page.locator('#profile-name').filter({hasText:name}).waitFor();
  await page.waitForFunction(() => /^(Visible|Blocked)/.test(document.querySelector('.profile-answer').textContent));
}

async function changeHeight(value) {
  await action('Settings');
  await page.locator('#eye').fill(String(value));
  await page.locator('#eye').press('Tab');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
}

try {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await read('madeira-compact');
  await page.locator('.observer-view').click();
  await read('madeira-expanded');
  for (const [name, label] of [
    ['Pico do Cedro', 'cedro'], ['Pico Ruivo','ruivo'], ['Eirinhas','eirinhas'],
    ['Chiqueiros da Queimada','chiqueiros'],
  ]) {
    await choosePeak(name);
    await read('madeira-' + label, name);
  }
  await changeHeight(10);
  await choosePeak('Pico Ruivo');
  await read('madeira-raised-10m', 'Pico Ruivo');
  await changeHeight(1.7);
  const search = page.getByRole('combobox',{name:'Search for a mountain or enter coordinates'});
  await search.fill('Gornergrat');
  await page.getByRole('option',{name:/Gornergrat/}).first().click();
  await page.getByRole('button',{name:'Place observer here',exact:true}).click();
  await page.getByRole('heading',{name:'Gornergrat',exact:true}).waitFor();
  await read('alps-gornergrat');
  if (!baseline) {
    for (const row of readings) {
      assert.ok(row.horizontalErrorM < 0.1, row.label + ' camera is displaced horizontally');
      assert.ok(Math.abs(row.heightAboveGroundM - row.configuredHeightM) < 0.05,
        row.label + ' camera clearance disagrees with the eye-height setting');
      assert.ok(row.bearingErrorDeg < 0.1, row.label + ' camera bearing disagrees with the hiker');
    }
    for (const row of readings.filter(row => row.target)) {
      const t = row.target;
      assert.ok(t.inFrame, t.name + ' is outside the frame in its own bearing');
      assert.ok(Math.abs(t.tiltErrorDeg) < .5, t.name + ' is off the intended vertical sightline');
      if (row.label === 'madeira-ruivo' || row.label === 'madeira-chiqueiros') {
        assert.match(t.profile, /^Blocked nearby\b/, t.name + ' has an obstruction within one source pixel');
        assert.doesNotMatch(t.profile, /\d\s*m\b/, 'The compact verdict must not imply metre-scale precision');
        assert.ok(t.hitM > 0 && t.hitM < 16.5, t.name + ' should hit the foreground inside a DEM pixel');
      }
      if (row.label === 'madeira-raised-10m') {
        assert.match(t.profile, /^Blocked at\b/, 'Raising the eye clears the nearby ridge');
        assert.ok(t.hitM > 2800 && t.hitM < t.targetM, 'The remaining obstruction is near Pico Ruivo');
      }
      const endpointToleranceM = Math.max(3, t.targetM * .002);
      if (t.profile.startsWith('Blocked')) {
        const foregroundHit = t.hitM > 0 && t.hitM < t.eyeToTargetM - endpointToleranceM;
        if (!foregroundHit) {
          // A 16 m analysis cell and the displayed LOD can put a grazing ray
          // on opposite sides of the last ridge. Require the user-facing
          // qualification and independent evidence that it really is grazing.
          assert.match(t.profile, /near summit/i, t.name + ' lacks a foreground hit or a qualification');
          assert.equal(t.coveredSamples, t.sampleCount);
          assert.ok(Math.abs(t.sightAngleDeg - t.highestTerrainAngleDeg) < .15 &&
            t.obstacleDistanceM > t.targetM * .9, t.name + ' has a material visibility disagreement');
        }
      } else {
        // On a skyline the geometric ray may miss the last terrain triangle and
        // continue into the sky or to a slope *behind* the peak; both are clear.
        assert.equal(t.coveredSamples, t.sampleCount, t.name + ' needs coverage to establish visibility');
        assert.ok(t.hitM === null || t.hitM >= t.eyeToTargetM - endpointToleranceM,
          t.name + ' should be visible on the rendered landscape');
      }
    }
    const targets = readings.map(row => row.target).filter(Boolean);
    assert.ok(targets.some(t => t.profile.startsWith('Visible') && t.hitM !== null &&
      Math.abs(t.hitM - t.eyeToTargetM) < 3), 'No clear-view positive control was verified.');
    assert.ok(targets.some(t => t.profile.startsWith('Blocked') && t.hitM > 0 &&
      t.hitM < t.eyeToTargetM / 2), 'No foreground obstruction was verified.');
  }
} finally {
  await browser.close();
}
