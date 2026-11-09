import { Map } from "@tileflow/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Credits, DemoHeader, MapPanel } from "@tileflow-demos/shared/ui";
import { requestLive, useLiveService } from "@tileflow-demos/shared/service-client";
import { ElevationChart } from "./ElevationChart";
import { showRoute } from "./route-layer";
import { pointAt, savedWalk, trails, type WalkData } from "./trails";
import "./styles.css";

export default function App() {
  const [trail, setTrail] = useState(trails[0]);
  const saved = useMemo(() => savedWalk(trail), [trail]);
  const [liveWalk, setLiveWalk] = useState<WalkData | null>(null);
  const walk = liveWalk ?? saved;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const liveEnabled = useLiveService();
  const pending = useRef<AbortController | null>(null);

  const annotations = useMemo(() => trail.stops.map(({ index, name, note }) => ({
    id: `stop-${index}`, kind: "marker" as const, coordinate: pointAt(trail, index), ariaLabel: name,
    marker: { color: "#38563a" }, popup: { content: { kind: "text" as const, text: name + " · " + note } },
  })), [trail]);

  useEffect(() => {
    if (map) showRoute(map, walk.coordinates);
  }, [map, walk.coordinates]);
  useEffect(() => () => pending.current?.abort(), []);

  async function recalculate() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setNotice("");
    setBusy(true);
    try {
      const result = await requestLive<WalkData | null>(trail.id, controller.signal);
      if (!controller.signal.aborted) {
        setLiveWalk(result);
        if (!result) setNotice("No walking route found. Showing the saved walk.");
      }
    } catch {
      if (!controller.signal.aborted) {
        setLiveWalk(null);
        setNotice("Live routing or elevation is unavailable. Showing the saved walk.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function chooseTrail(id: string) {
    const next = trails.find((item) => item.id === id);
    if (!next) return;

    pending.current?.abort();
    setTrail(next);
    setStopId(null);
    setLiveWalk(null);
    setBusy(false);
    setNotice("");
  }

  return (
    <div className="app field">
      <DemoHeader brand="Headlands" section="Field guide" place="Marin, CA" />
      <main className="workspace field-workspace">
        <div className="walk-heading">
          <h1>Trail notebook</h1>
          <label className="form-label" htmlFor="trail">Choose a walk</label>
          <select id="trail" value={trail.id} onChange={(event) => chooseTrail(event.target.value)}>
            {trails.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <section className="walk-details">
          <p className="eyebrow">{trail.terrain}</p>
          <h2 className="walk-name">{trail.name}</h2>
          <p className="intro">{trail.description}</p>
          <dl className="metric-grid">
            <div className="metric"><dt>Distance</dt><dd>{(walk.distance / 1000).toFixed(1)} km</dd></div>
            <div className="metric"><dt>Ascent</dt><dd>{walk.ascent === null ? "—" : Math.round(walk.ascent) + " m"}</dd></div>
            <div className="metric"><dt>Walk time</dt><dd>{walk.minutes} min</dd></div>
          </dl>
          <ElevationChart samples={walk.samples} />
          <div className="section">
            <div className="section-head"><h2>Waypoints</h2><span className="small muted">{trail.stops.length} stops</span></div>
            <ol className="entry-list">
              {trail.stops.map(({ index, name, note }, i) => <li key={index}>
                <button className="entry" aria-pressed={stopId === `stop-${index}`} onClick={() => setStopId(`stop-${index}`)}>
                  <span className="waypoint-index">{i + 1}</span>
                  <span className="entry-main"><span className="entry-title">{name}</span><span className="row-sub">{note}</span></span>
                </button>
              </li>)}
            </ol>
          </div>
          <p className="credits">{liveWalk ? "Live walking route and terrain profile." : "Illustrative track and elevation by Tileflow · CC0"}</p>
          <Credits entries={walk.credits} />
          {liveEnabled && <div className="actions"><button className="action" disabled={busy} onClick={() => void recalculate()}>
            {busy ? "Calculating…" : "Calculate live walk"}</button></div>}
          <p className="status" role="status">{notice}</p>
        </section>
        <MapPanel label="Headlands trail map">
          <Map source={{ map: "field" }} captureId="field" height="100%" onLoad={setMap}
            annotations={annotations} interactionState={{ popup: stopId ? { kind: "annotation", id: stopId } : null }}
            onInteractionStateChange={({ popup }) => setStopId(popup?.kind === "annotation" ? popup.id : null)} />
        </MapPanel>
      </main>
    </div>
  );
}
