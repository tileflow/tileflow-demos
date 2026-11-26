import {MercatorCoordinate} from 'maplibre-gl';

const RAD = Math.PI / 180;
const TILE_SIZE = 512;
const DEFAULT_FOV = 2 * Math.atan(1 / 3) / RAD;
const PIVOT_DISTANCE_M = 160;
// MapLibre 6.16's Mercator projection bounds the pitch at this angle when
// projecting the distance from the camera to sea level for terrain fog.
const MERCATOR_HORIZON_DEG = 89.25;

// MapLibre orbits a target. Put that mathematical target along the sightline
// and choose its elevation and scale so the optical origin is the hiker's eye.
// Its distance affects tile detail; it doesn't move the eye or set the view angle.
export function observerMapCamera({
  point, bearing, groundElevation, eyeHeight, height, elevationAngle = 0, fov = DEFAULT_FOV,
}) {
  const heading = ((bearing % 360) + 360) % 360;
  // On a perfectly level ray the tile directly under the eye has zero
  // vertical and horizontal distance to the pivot plane, making MapLibre's
  // terrain LOD evaluate atan(0 / 0). Tilt 1.75 mm per km for that case.
  const angle = Math.abs(elevationAngle) < 0.0001 ? -0.0001 : elevationAngle;
  const pitch = 90 + Math.max(-90, Math.min(90, angle));
  const observer = MercatorCoordinate.fromLngLat([point.lon, point.lat]);
  const distance = PIVOT_DISTANCE_M * observer.meterInMercatorCoordinateUnits();
  const horizontal = distance * Math.sin(pitch * RAD);
  const pivot = new MercatorCoordinate(
    observer.x + horizontal * Math.sin(heading * RAD),
    observer.y - horizontal * Math.cos(heading * RAD),
  );
  const center = pivot.toLngLat().wrap();
  // The renderer converts altitude to world units at the target's latitude.
  const slantM = distance / pivot.meterInMercatorCoordinateUnits();
  const elevation = groundElevation + eyeHeight - slantM * Math.cos(pitch * RAD);
  const focalPixels = height / (2 * Math.tan(fov * RAD / 2));
  return {center, elevation, bearing: heading, pitch, zoom: Math.log2(focalPixels / (TILE_SIZE * distance))};
}

export function applyObserverCamera(map, pose) {
  const fov = map.getVerticalFieldOfView();
  const camera = observerMapCamera({...pose, fov});
  // In MapLibre 6.16 the default far plane is sized for overhead maps and
  // can clip nearby hills for a level camera at the coast. The pinned engine
  // exposes its clip distances in world pixels on the active transform.
  // Set these before jumpTo so its terrain collision check uses them too.
  const worldPixels = TILE_SIZE * 2 ** camera.zoom;
  const pxPerM = MercatorCoordinate.fromLngLat(camera.center).meterInMercatorCoordinateUnits() * worldPixels;
  const nearM = Math.max(0.005, Math.min(0.1, pose.eyeHeight * 0.05));
  const near = nearM * pxPerM;
  // The fog projection has its own near plane at sea level along the view.
  // A far plane in front of that plane inverts its depth and bleaches slopes
  // to white. Give it room for all the relief in the analysis area as well.
  const focalPixels = pose.height / (2 * Math.tan(fov * RAD / 2));
  const pitchCos = Math.cos(Math.min(camera.pitch, MERCATOR_HORIZON_DEG) * RAD);
  const fogNear = Math.max(focalPixels / 2, focalPixels + camera.elevation * pxPerM / pitchCos);
  const far = fogNear + Math.hypot(pose.radius, 10000 + pose.eyeHeight) * pxPerM;
  const target = map._camera.getTransformForUpdate();
  if (target.nearFarZOverride?.nearZ !== near || target.nearFarZOverride?.farZ !== far) {
    target.overrideNearFarZ(near, far);
  }
  map.jumpTo(camera);
  const rendered = map._camera.transform;
  const actual = rendered.getCameraLngLat();
  // Small-angle distance stays precise below a centimetre, where the
  // spherical law of cosines can round identical coordinates to 0.1 m.
  const deltaLon = ((actual.lng - pose.point.lon + 540) % 360) - 180;
  const positionErrorM = 6371008.8 * RAD * Math.hypot(
    actual.lat - pose.point.lat, deltaLon * Math.cos(pose.point.lat * RAD),
  );
  return {
    longitude: actual.lng, latitude: actual.lat, pitch: rendered.pitch,
    positionErrorM,
    altitudeM: rendered.getCameraAltitude(),
    pitchErrorDeg: Math.abs(rendered.pitch - camera.pitch),
  };
}
