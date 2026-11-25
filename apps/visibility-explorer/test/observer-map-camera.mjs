import assert from 'node:assert/strict';
import test from 'node:test';
import {MercatorCoordinate} from 'maplibre-gl';
import {applyObserverCamera, observerMapCamera} from '../src/observer-map-camera.js';

const rad = Math.PI / 180;
const home = {point: {lon: -16.9289, lat: 32.7355}, groundElevation: 1790, eyeHeight: 1.7, bearing: 333, height: 168};

function assertSamePoint(actual, point) {
  assert.ok(Math.abs(actual.lat - point.lat) < 1e-9);
  assert.ok(Math.abs(((actual.lng - point.lon + 540) % 360) - 180) < 1e-9);
}

// Independently reconstruct the pinhole's location from the returned orbit.
// MapLibre's default vertical field of view puts the focal length at 1.5h.
function opticalOrigin(pose) {
  const camera = observerMapCamera(pose);
  const center = MercatorCoordinate.fromLngLat(camera.center);
  const distance = 1.5 * pose.height / (512 * 2 ** camera.zoom);
  const tilt = camera.pitch * rad, heading = camera.bearing * rad;
  const eye = new MercatorCoordinate(
    center.x - distance * Math.sin(tilt) * Math.sin(heading),
    center.y + distance * Math.sin(tilt) * Math.cos(heading),
  );
  return {
    location: eye.toLngLat().wrap(),
    altitude: camera.elevation + distance * Math.cos(tilt) / center.meterInMercatorCoordinateUnits(),
    camera,
  };
}

test('turning, resizing and changing the analysis radius leave the optical center at the hiker', () => {
  for (const point of [home.point, {lon: 7.785, lat: 45.983}, {lon: 179.9998, lat: 72}, {lon: -179.9998, lat: -62}]) {
    for (const bearing of [0, 45, 90, 165, 225, 270, 333, 710]) {
      for (const height of [75, 168, 330]) {
        for (const radius of [1000, 10000]) {
          const {location, altitude, camera} = opticalOrigin({...home, point, height, bearing, radius});
          assertSamePoint(location, point);
          assert.ok(Math.abs(altitude - (home.groundElevation + home.eyeHeight)) < 0.001);
          assert.ok(Math.abs(camera.pitch - 90) < .00011 && camera.pitch !== 90);
          assert.equal(camera.bearing, ((bearing % 360) + 360) % 360);
        }
      }
    }
  }
});

test('absolute eye altitude follows ground and eye settings, including below mean sea level', () => {
  for (const groundElevation of [-430, 0, 1790, 3100, 8800]) {
    for (const eyeHeight of [0, 0.4, 1.7, 8, 200]) {
      const {altitude, location} = opticalOrigin({...home, groundElevation, eyeHeight});
      assert.ok(Math.abs(altitude - groundElevation - eyeHeight) < 0.001);
      assertSamePoint(location, home.point);
    }
  }
});

test('looking up or down turns about the eye while preserving its position and altitude', () => {
  for (const elevationAngle of [-80, -23.5, -3, 0, 8.5, 45, 80]) {
    const {camera, altitude, location} = opticalOrigin({...home, elevationAngle});
    assert.ok(Math.abs(camera.pitch - (90 + elevationAngle)) < .00011);
    assertSamePoint(location, home.point);
    assert.ok(Math.abs(altitude - (home.groundElevation + home.eyeHeight)) < 0.001);
  }
});

test('depth planes include the near terrain and leave a valid fog projection above high mountains', () => {
  for (const groundElevation of [-430, 0, 1790, 8800]) {
    for (const elevationAngle of [-22, -4.72, 0, 45]) {
      const pose = {...home, groundElevation, elevationAngle, radius: 1000};
      let near, far, camera;
      const tr = {
        overrideNearFarZ(n, f) { near = n; far = f; },
        getCameraLngLat: () => ({lng: pose.point.lon, lat: pose.point.lat}),
        getCameraAltitude: () => groundElevation + pose.eyeHeight,
      };
      const map = {
        _camera: {transform: tr, getTransformForUpdate: () => tr},
        getVerticalFieldOfView: () => 2 * Math.atan(1 / 3) / rad,
        jumpTo(options) { camera = options; tr.pitch = options.pitch; },
      };
      applyObserverCamera(map, pose);
      const pxPerM = MercatorCoordinate.fromLngLat(camera.center).meterInMercatorCoordinateUnits() * 512 * 2 ** camera.zoom;
      const f = 1.5 * pose.height;
      const nativeFogOrigin = Math.max(f / 2, f + camera.elevation * pxPerM / Math.cos(Math.min(camera.pitch, 89.25) * rad));
      assert.ok(near / pxPerM <= 0.1);
      assert.ok(far > nativeFogOrigin + pose.radius * pxPerM);
    }
  }
});
