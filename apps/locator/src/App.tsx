import { Map } from "@tileflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Credits, DemoHeader, MapPanel, type Credit } from "@tileflow-demos/shared/ui";
import { useLiveService } from "@tileflow-demos/shared/service-client";
import { currentLocation, findAddress, type SearchOrigin } from "./location";
import { amenities, findStores, storeNumber, stores, type Amenity } from "./stores";
import "./styles.css";

export default function App() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Amenity | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<Credit[]>([]);
  const pending = useRef<AbortController | null>(null);
  const live = useLiveService();

  const results = useMemo(() => findStores(query, filter, origin?.point ?? null), [query, filter, origin]);
  const selected = results.find(({ store }) => store.id === selectedId)?.store;
  const annotations = useMemo(() => results.map(({ store }) => ({
    id: store.id, kind: "marker" as const, coordinate: store.point, ariaLabel: store.name,
    marker: { content: { kind: "view" as const, name: "shop" } },
    popup: { content: { kind: "view" as const, name: "hours" } },
    data: { name: store.name, district: store.district, hours: store.hours },
  })), [results]);

  useEffect(() => () => pending.current?.abort(), []);

  function cancelLookup() {
    pending.current?.abort();
    setBusy(false);
    setNotice("");
  }

  async function locate(source: "device" | "address") {
    cancelLookup();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);

    try {
      const result = source === "device"
        ? { place: await currentLocation(), credits: [] }
        : await findAddress(query.trim(), controller.signal);
      if (controller.signal.aborted) return;

      setCredits(result.credits);
      if (!result.place) {
        setOrigin(null);
        setNotice("No address found. Try another street or neighborhood.");
        return;
      }
      setOrigin(result.place);
      setQuery("");
      setSelectedId(null);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(source === "device" && error instanceof Error
        ? error.message : "Address search is unavailable. You can still find shops by name.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="app locator">
      <DemoHeader brand="Linha Coffee" section="Store finder" place="Lisbon, PT" />
      <main className="workspace">
        <section className="sidebar" aria-label="Store directory">
          <p className="eyebrow">Lisbon coffee shops</p>
          <h1>Find a shop.</h1>
          <label className="form-label" htmlFor="shop-search">Shop or neighborhood</label>
          <input id="shop-search" className="input" type="search" placeholder="Try Graça or Estufa" value={query}
            onChange={(event) => { cancelLookup(); setQuery(event.target.value); setSelectedId(null); }} />
          <div className="chips" role="group" aria-label="Filter by amenity">
            <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>All</button>
            {amenities.map((item) => <button key={item} className="chip" aria-pressed={filter === item}
              onClick={() => { setFilter(filter === item ? null : item); setSelectedId(null); }}>{item}</button>)}
          </div>
          <div className="actions">
            <button className="action" disabled={busy} onClick={() => void locate("device")}>Near me</button>
            {live && query.trim() && <button className="action" disabled={busy}
              onClick={() => void locate("address")}>Find near this address</button>}
            {origin && <button className="action" onClick={() => {
              cancelLookup(); setOrigin(null); setCredits([]);
            }}>Clear location</button>}
          </div>
          <p className="status" role="status">{busy ? "Finding location…" : notice || (origin && `Nearest to ${origin.label}`)}</p>
          <Credits entries={credits} />
          <section className="section">
            <div className="section-head"><h2>Shops</h2><span className="small muted" aria-live="polite">{results.length} of {stores.length}</span></div>
            {results.length === 0 && <div className="status-box">No shops match these filters.
              <div className="actions"><button className="action" onClick={() => {
                cancelLookup(); setQuery(""); setFilter(null);
              }}>Show all shops</button></div></div>}
            <ul className="entry-list">
              {results.map(({ store, distance }) => (
                <li key={store.id}>
                  <button className="entry" aria-pressed={selected?.id === store.id} onClick={() => setSelectedId(store.id)}>
                    <span className="shop-number">{storeNumber(store.id)}</span>
                    <span className="entry-main"><span className="entry-title">{store.name}</span>
                      <span className="row-sub">{store.district} · {store.hours}</span></span>
                    {distance !== null && <span className="small">{distance.toFixed(1)} km</span>}
                  </button>
                  {selected?.id === store.id && <p className="store-amenities">{store.amenities.join(" · ")}</p>}
                </li>
              ))}
            </ul>
          </section>
        </section>
        <MapPanel label="Coffee shop map">
          <Map source={{ map: "locator" }} height="100%" viewMode="2d" captureId="locator"
            center={selected?.point} zoom={selected ? 14.6 : undefined}
            annotations={annotations} interactionState={{ popup: selected ? { kind: "annotation", id: selected.id } : null }}
            onInteractionStateChange={({ popup }) => setSelectedId(popup?.kind === "annotation" ? popup.id : null)}
            renderMarker={({ annotation }) => <span className="shop-pin" data-selected={selected?.id === annotation.id}>
              {storeNumber(annotation.id)}</span>}
            renderPopup={({ annotation, close }) => <div className="shop-popup">
              <strong>{annotation.data.name}</strong><span>{annotation.data.district}</span>
              <span>Daily {annotation.data.hours}</span><button onClick={close}>Close</button></div>} />
        </MapPanel>
      </main>
    </div>
  );
}
