import { useState } from "react";
import { DemoHeader, MapPanel } from "@tileflow-demos/shared/ui";
import { TerritoryMap } from "./TerritoryMap";
import { bands, formatCount, metricNames, metricValue, percentage, regionColor, regions, type Metric } from "./regions";
import "./styles.css";

const total = regions.reduce((sum, region) => sum + region.deliveries, 0);
const onTime = regions.reduce((sum, region) => sum + region.onTime, 0);

export default function App() {
  const [metric, setMetric] = useState<Metric>("deliveries");
  const [id, setId] = useState<string | null>("pearl");
  const selected = regions.find((region) => region.id === id);
  const ranked = [...regions].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));

  const legend = (
    <>
      <p className="legend-title">{metricNames[metric]}</p>
      <ul className="swatches">{bands[metric].map(({ label, color }) => <li key={label}>
        <i style={{ backgroundColor: color }} aria-hidden="true" /><span>{label}</span>
      </li>)}</ul>
    </>
  );

  return (
    <div className="app territories">
      <DemoHeader brand="Dispatch" section="Territories" place="Portland, OR" />
      <main className="workspace">
        <section className="sidebar" aria-label="Territory performance">
          <p className="eyebrow">Week of October 5, 2026</p>
          <h1>Delivery areas</h1>
          <dl className="metric-grid totals">
            <div className="metric"><dt>Total deliveries</dt><dd>{formatCount(total)}</dd></div>
            <div className="metric"><dt>On time</dt><dd>{percentage(onTime, total).toFixed(1)}%</dd></div>
          </dl>
          <div className="section">
            <h2>Map metric</h2>
            <div className="chips" role="group" aria-label="Map metric">
              <button className="chip" aria-pressed={metric === "deliveries"} onClick={() => setMetric("deliveries")}>Deliveries</button>
              <button className="chip" aria-pressed={metric === "onTime"} onClick={() => setMetric("onTime")}>On-time rate</button>
            </div>
          </div>
          <section className="region-detail" aria-live="polite" aria-label="Selected territory">
            {selected ? <>
              <div className="section-head"><h2>{selected.name}</h2>
                <button className="link-button" onClick={() => setId(null)}>Clear selection</button></div>
              <dl className="metric-grid">
                <div className="metric"><dt>Deliveries</dt><dd>{formatCount(selected.deliveries)}</dd></div>
                <div className="metric"><dt>Late</dt><dd>{selected.deliveries - selected.onTime}</dd></div>
                <div className="metric"><dt>Riders</dt><dd>{selected.riders}</dd></div>
              </dl>
              <p className="small">{formatCount(selected.onTime)} delivered on time · {percentage(selected.onTime, selected.deliveries).toFixed(1)}%</p>
            </> : <p className="small">Select a territory on the map or in the list to inspect its deliveries.</p>}
          </section>
          <section className="section">
            <div className="section-head"><h2>Territories</h2><span className="small muted">{metricNames[metric]}</span></div>
            <ul className="entry-list">{ranked.map((region) => <li key={region.id}>
              <button className="entry" aria-pressed={id === region.id} onClick={() => setId(region.id)}>
                <span className="region-dot" style={{ backgroundColor: regionColor(region, metric) }} />
                <span className="entry-main"><span className="entry-title">{region.name}</span></span>
                <span className="region-value">{metric === "deliveries"
                  ? formatCount(region.deliveries) : metricValue(region, metric).toFixed(1) + "%"}</span>
              </button>
            </li>)}</ul>
            <p className="credits">Illustrative service areas and weekly totals · Tileflow</p>
          </section>
        </section>
        <MapPanel label="Portland delivery territories" legend={legend}>
          {(onLoad) => <TerritoryMap metric={metric} id={id} select={setId} onLoad={onLoad} />}
        </MapPanel>
      </main>
    </div>
  );
}
