import type { WalkData } from "./trails";

export function ElevationChart({ samples }: Pick<WalkData, "samples">) {
  const heights = samples.flatMap(({ height }) => height === null ? [] : [height]);
  if (!heights.length) return <p className="status-box">No elevation samples for this walk.</p>;

  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const distance = samples.at(-1)?.meters ?? 0;
  const segments: string[] = [];
  let penUp = true;
  for (const { height, meters } of samples) {
    if (height === null) {
      penUp = true;
      continue;
    }
    const x = 4 + (meters / Math.max(1, distance)) * 292;
    const y = 79 - (height - low) / Math.max(1, high - low) * 68;
    segments.push(`${penUp ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    penUp = false;
  }

  return (
    <figure className="profile">
      <figcaption><strong>Elevation profile</strong><span>{Math.round(low)}–{Math.round(high)} m</span></figcaption>
      <svg viewBox="0 0 300 88" preserveAspectRatio="none" role="img" aria-label={`Elevation from ${Math.round(low)} to ${Math.round(high)} meters along the walk`}>
        <path d="M0 14 H300 M0 47 H300 M0 80 H300" fill="none" stroke="#cdd4b9" strokeDasharray="3 4" />
        <path d={segments.join(" ")} fill="none" stroke="#3e6548" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="profile-axis"><span>0 km</span><span>{(distance / 1000).toFixed(1)} km</span></div>
    </figure>
  );
}
