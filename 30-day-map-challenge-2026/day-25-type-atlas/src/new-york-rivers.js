import riverLines from './data/river-lines.json';
import shoreline from './data/banks.json';
import {mercator} from './type-layout.js';

function indexLines(collection) {
  return collection.features.flatMap(feature => feature.geometry.coordinates.map(line => {
    const coords = line.map(mercator);
    const xs = coords.map(point => point[0]), ys = coords.map(point => point[1]);
    return {...feature.properties, coords, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]};
  }));
}

export const rivers = indexLines(riverLines);
export const banks = indexLines(shoreline);
