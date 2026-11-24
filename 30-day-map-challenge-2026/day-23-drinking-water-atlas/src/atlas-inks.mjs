// Paper, coast and sea inks are shared by the compiled Tileflow style and the
// offline orthographic Canvas renderer. Depths are metres below sea level.
export const atlasInks = {
  shelf: "#b9e6d8",
  graticule: "#297f92",
  coast: "#f1f8d8",
  boundary: "#f3f6dc",
  province: "#5c8271",
  river: "#4aa7ba",
  lake: "#85d7d8",
  selection: "#18665e",
  missing: "#c4d5c8",
  coverage: ["#fa8871", "#f9b77c", "#f5da78", "#a6dba4", "#41b69a"],
};
export const oceanBands = [
  { depth: 200, ink: "#90d9d5" },
  { depth: 1000, ink: "#72cdd2" },
  { depth: 3000, ink: "#54bccb" },
  { depth: 5000, ink: "#45aabd" },
];

// Small-scale isobaths become quiet in the detailed map. Every band converges
// on the same open-water ink at z8.6, beyond this dataset's display scale.
const closeWater = "#89d4d7";
const seaStops = [
  [0, 1],
  [3.1, 1],
  [4.8, 0.58],
  [6, 0.3],
  [7.2, 0.11],
  [8.6, 0],
];
function mixSea(color, amount) {
  const rgb = [1, 3, 5].map((i) => {
    const near = parseInt(closeWater.slice(i, i + 2), 16),
      far = parseInt(color.slice(i, i + 2), 16);
    return Math.round(near + (far - near) * amount);
  });
  return `rgb(${rgb.join(",")})`;
}
export function seaPaint(color) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...seaStops.flatMap(([zoom, value]) => [zoom, mixSea(color, value)]),
  ];
}
export function seaAtZoom(color, zoom) {
  if (zoom <= seaStops[0][0]) return color;
  for (let i = 1; i < seaStops.length; i++) {
    const [z, alpha] = seaStops[i],
      [prevZ, prevAlpha] = seaStops[i - 1];
    if (zoom <= z)
      return mixSea(
        color,
        prevAlpha + ((zoom - prevZ) / (z - prevZ)) * (alpha - prevAlpha),
      );
  }
  return closeWater;
}
