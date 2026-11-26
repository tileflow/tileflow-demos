// Cartographic colours for the live map. The same public line number keeps its identity in every view.
export const lineColors = [
  {body: '#38caff', ink: '#066783', light: '#93e4ff'},
  {body: '#ff488f', ink: '#a32b62', light: '#ff9dc1'},
  {body: '#6be598', ink: '#176b47', light: '#a9f5bf'},
  {body: '#ab8aff', ink: '#654297', light: '#d5bdff'},
  {body: '#ff9b54', ink: '#954617', light: '#ffd19a'},
  {body: '#46dbc6', ink: '#126b68', light: '#a3f3e7'},
];
const featured = new Map([
  ['23', 0],
  ['502', 2],
  ['71', 1],
  ['614', 3],
  ['66', 0],
  ['75', 1],
  ['21', 3],
]);
export function lineIndex(number) {
  const text = String(number ?? '')
    .trim()
    .toUpperCase();
  if (featured.has(text)) return featured.get(text);
  let hash = 0;
  for (const ch of text) hash = (Math.imul(31, hash) + ch.charCodeAt(0)) >>> 0;
  return hash % lineColors.length;
}
export const lineColor = (number) => lineColors[lineIndex(number)];
