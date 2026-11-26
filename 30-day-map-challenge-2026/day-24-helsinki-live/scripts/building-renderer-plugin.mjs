// Streets alpha.55 batches many buildings in one tile draw. This map's adapter
// lets the bus cutaway split that same draw into opaque and translucent index
// ranges. The installed SDK, its shader, and all other demos are untouched.
export function helsinkiBuildingRenderer() {
  return {
    name: 'helsinki-building-occlusion',
    transform(code, id) {
      if (!/[/\\]@tileflow[/\\]core[/\\]dist[/\\]3d\.js(?:\?|$)/.test(id)) return;
      function adapt(anchor, next) {
        const index = code.indexOf(anchor);
        if (index < 0 || code.indexOf(anchor, index + anchor.length) !== -1) {
          throw new Error(
            'Recheck the Helsinki building adapter against the installed @tileflow/core version: ' +
              anchor,
          );
        }
        code = code.replace(anchor, next);
      }
      adapt(
        'const { vertices, indices, contact } = entry.data;',
        'const { vertices, indices, contact } = entry.data;\n      map.hslBuildingOcclusion?.register(entry, vertices, indices);',
      );
      adapt(
        'const drawBuildings = () => {',
        'const cutaway = map.hslBuildingOcclusion;\n    cutaway?.begin();\n    const drawBuildings = (glass = false) => {',
      );
      adapt(
        'const ranges = viewRanges(args, tile);',
        [
          'const visible = viewRanges(args, tile);',
          'if (!visible.length) continue;',
          'const ranges = cutaway ? cutaway.ranges(glass, entry, visible, x3, y2, camera.zoom,',
          '  () => args.getProjectionData({tileID:{canonical:{x:x3,y:y2,z:camera.zoom},wrap:0}}), shown) : visible;',
        ].join('\n        '),
      );
      adapt(
        'if (appearing.length > 0) map.triggerRepaint();',
        [
          'cutaway?.defer(() => drawBuildingOpacity(context, .22 * buildingsOpacity, () => drawBuildings(true)));',
          'if (appearing.length > 0) map.triggerRepaint();',
        ].join('\n    '),
      );
      return {code, map: null};
    },
  };
}
