import {tileflowSunPosition} from '@tileflow/core/browser';

export function helsinkiTimeOfDay(instant) {
  const sun = tileflowSunPosition(instant, [24.94, 60.17]);
  // Use civil twilight and a short golden hour. Even the low midwinter sun in
  // Helsinki reaches the day palette around noon.
  return sun.altitude < -6 ? 'night' : sun.altitude >= 3 ? 'day' : sun.azimuth < 180 ? 'dawn' : 'dusk';
}
