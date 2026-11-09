import type { Credit } from "./geo";
import { Fragment, useCallback, useState, type ReactNode } from "react";

export function DemoHeader({ brand, section, place }: { brand: string; section: string; place: string }) {
  return (
    <header className="masthead">
      <div className="masthead-name">
        <span className="brand-mark" aria-hidden="true" />
        <strong>{brand}</strong>
        <span className="masthead-section">{section}</span>
      </div>
      <span className="masthead-place">{place}</span>
    </header>
  );
}

interface MapPanelProps {
  label: string;
  children: (onLoad: () => void) => ReactNode;
  legend?: ReactNode;
}

export function MapPanel({ label, children, legend }: MapPanelProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);

  return (
    <section className="map-panel" aria-label={label}>
      <Fragment key={attempt}>{children(onLoad)}</Fragment>
      {!loaded && <>
        <p className="map-loading" role="status">Loading map…</p>
        <div className="map-error" role="status">
          <strong>Map unavailable</strong>
          <button type="button" onClick={() => setAttempt(count => count + 1)}>Retry map</button>
        </div>
      </>}
      {legend && <div className="map-legend">{legend}</div>}
    </section>
  );
}

export function Credits({ entries }: { entries: Credit[] }) {
  if (entries.length === 0) return null;

  return (
    <p className="credits">
      {entries.map(({ label, url }, index) => (
        <Fragment key={label + index}>
          {index > 0 && " · "}
          {url ? <a href={url} rel="noreferrer">{label}</a> : label}
        </Fragment>
      ))}
    </p>
  );
}
