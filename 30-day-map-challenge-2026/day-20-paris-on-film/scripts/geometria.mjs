import fs from 'node:fs';
import path from 'node:path';
import {VectorTile, classifyRings} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';

const directory = process.argv[2];
const tileDirectory = process.argv[3] ?? directory;
for (const name of fs.readdirSync(tileDirectory).filter(n => /^\d+[-_]\d+\.pbf$/.test(n))) {
  const tile = new VectorTile(new PbfReader(fs.readFileSync(path.join(tileDirectory, name))));
  const result = { buildings: [], roads: [], bridges: [], parks: [], water: [], trees: [] };
  for (const kind of ['building','landuse','water','road','canopy']) {
    const layer = tile.layers[kind];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i), p = feature.properties;
      if (p.underground || (p.layer ?? 0) < 0 || p.structure === 'tunnel') continue;
      const isPark = ['park','garden','wood','grass','forest','cemetery','recreation_ground','pitch','meadow'];
      if (kind === 'landuse' && ![p.type,p.class].some(v => isPark.includes(v))) continue;
      const rings = feature.loadGeometry();
      const coords = line => line.map(v => [Math.round(v.x * 4096 / layer.extent), Math.round(v.y * 4096 / layer.extent)]);
      if (kind === 'canopy') {
        for (const ring of rings) result.trees.push(...coords(ring));
      } else if (kind === 'road' && feature.type === 2) {
        if (p.class === 'transit') continue;
        const width = ({motorway:19,trunk:17,primary:14,secondary:11,tertiary:9,street:6,path:2,pedestrian:4})[p.class] || 4;
        for (const line of rings) result.roads.push([width,coords(line)]);
      } else if (feature.type === 3 && (kind !== 'road' || p.class === 'bridge')) {
        for (const polygon of classifyRings(rings, 0)) {
          const geometry = polygon.map(coords);
          if (kind === 'building') result.buildings.push([Number(p.height) || 12,geometry]);
          else if (kind === 'road') result.bridges.push(geometry);
          else result[kind === 'water' ? 'water' : 'parks'].push(geometry);
        }
      }
    }
  }
  fs.writeFileSync(path.join(directory,name.replace('-','_').replace('.pbf','.json')),JSON.stringify(result));
}
