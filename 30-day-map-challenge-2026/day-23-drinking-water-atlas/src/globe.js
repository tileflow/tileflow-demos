import { attachTileflowAtmosphere } from "@tileflow/core/browser";
import { Map as LibreMap, setWorkerUrl, setWorkerCount } from "maplibre-gl";
import {
  geoArea,
  geoBounds,
  geoContains,
  geoDistance,
  geoGraticule,
  geoInterpolate,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import { feature as unpack, mesh } from "topojson-client";
import { atlasInks as ink, oceanBands, seaAtZoom } from "./atlas-inks.mjs";
import { bathymetry } from "./ocean-bands.js";
import world from "./world.topo.json";
import lattice from "./globe-dots.json";
import detail from "./detail.topo.json";
import { countryFrame } from "./country-framing.js";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

const start = [-10, 18];
const tau = Math.PI * 2,
  rad = Math.PI / 180,
  fieldOfView = 6;
const yes = "#087d79",
  no = "#c94e31";
const base = unpack(world, world.objects.countries);
const layers = Object.fromEntries(
  Object.entries(detail.objects).map(([name, object]) => [
    name,
    unpack(detail, object),
  ]),
);
layers.lakes.features = layers.lakes.features.filter(
  (f) => geoArea(f) < Math.PI * 2,
);
const detailBounds = new WeakMap();
const coastline = {
  type: "Feature",
  properties: {},
  geometry: mesh(
    world,
    world.objects.countries,
    (left, right) => left === right,
  ),
};
const seabedByDepth = oceanBands.map(({ depth, ink: color }) => ({
  color,
  features: bathymetry.features.filter((f) => f.properties.depth === depth),
}));
const graticule = geoGraticule().step([15, 15]).precision(2)();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const collection = (features) => ({ type: "FeatureCollection", features });
const point = (coordinates, properties) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});
export function coverageColor(n) {
  return n == null
    ? ink.missing
    : ink.coverage[n < 25 ? 0 : n < 50 ? 1 : n < 75 ? 2 : n < 90 ? 3 : 4];
}
const highlight = Object.fromEntries(
  ink.coverage.map((color, i) => [color, ink.hover[i]]),
);
highlight[ink.missing] = "#cedcd1";
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return (n ^ (n >>> 15)) >>> 0;
}
function mapData(rows) {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const shapes = base.features.map((f, i) => ({
    ...f,
    id: i + 1,
    properties: {
      code: f.properties.code,
      color: coverageColor(byCode.get(f.properties.code)?.value),
      hoverColor:
        highlight[coverageColor(byCode.get(f.properties.code)?.value)],
    },
  }));
  const byArea = new Map();
  for (const f of shapes)
    byArea.set(
      f.properties.code,
      (byArea.get(f.properties.code) || 0) + geoArea(f),
    );
  const islands = rows
    .filter(
      (row) =>
        Number.isFinite(row.lon) &&
        Number.isFinite(row.lat) &&
        (byArea.get(row.code) || 0) < 0.000012,
    )
    .map((row, i) => ({
      ...point([row.lon, row.lat], {
        code: row.code,
        color: coverageColor(row.value),
        hoverColor: highlight[coverageColor(row.value)],
      }),
      id: i + 1,
    }));
  const dots = [];
  for (const [code, coords] of Object.entries(lattice)) {
    const value = byCode.get(code)?.value;
    const ranked = coords
      .map((coordinate, i) => ({
        coordinate,
        key: hash(i + code.charCodeAt(0) * 967 + code.charCodeAt(2) * 51),
      }))
      .sort((a, b) => a.key - b.key);
    const good = Math.round((value * ranked.length) / 100);
    for (const [i, dot] of ranked.entries())
      dots.push(
        point(dot.coordinate, {
          code,
          ink: value == null ? "#88a79f" : i < good ? yes : no,
        }),
      );
  }
  return {
    ...layers,
    coast: coastline,
    seabed: bathymetry,
    byCode,
    countries: collection(shapes),
    islands: collection(islands),
    dots: collection(dots),
    graticule: { type: "Feature", properties: {}, geometry: graticule },
  };
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
function viewport(container) {
  const w = Math.max(1, container.clientWidth),
    h = Math.max(1, container.clientHeight),
    r0 = Math.min(w, h) * (w < h ? 0.43 : 0.445);
  const depth = h / (2 * Math.tan((fieldOfView * rad) / 2));
  return {
    w,
    h,
    cx: w / 2,
    cy: h / 2,
    r0,
    r: r0,
    worldRadius: r0 * (Math.hypot(1, r0 / depth) + r0 / depth),
  };
}
// Reserve the largest unobstructed region beside the glass (above it on phones).
// Its dimensions determine both the maximum scale and the camera composition.
function inspectionFrame(view, focus, card) {
  const { w, h, worldRadius } = view;
  const portrait = w / h < 0.98 || w < 620;
  const margin = Math.max(10, Math.min(w, h) * 0.025);
  const right = portrait ? w - margin : w * 0.54;
  const bottom = portrait ? h * 0.39 : h - margin;
  const slots = [
    [Math.max(margin, card.right + margin), margin, right, bottom],
    [margin, Math.max(margin, card.bottom + margin), right, bottom],
  ];
  const bearing = portrait ? -5 : -7;
  const angle = Math.abs(bearing) * rad;
  const [a, b] = focus?.extent || [1.25, 1];
  const width = a * Math.cos(angle) + b * Math.sin(angle);
  const height = b * Math.cos(angle) + a * Math.sin(angle);
  const scale = (box) =>
    Math.min((box[2] - box[0]) / width, (box[3] - box[1]) / height);
  const box = scale(slots[1]) > scale(slots[0]) ? slots[1] : slots[0];
  const cap = clamp(
    Math.log2(Math.max(1, scale(box) * 0.9) / worldRadius),
    0.87,
    7.65,
  );
  return {
    cap,
    fit: cap - 0.48,
    bearing,
    pixel: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
  };
}
const latitudeFactor = (latitude) =>
  Math.cos(Math.min(85, Math.abs(latitude)) * rad);
const zoomAt = (level, latitude, v) =>
  level + Math.log2((v.worldRadius * tau * latitudeFactor(latitude)) / 512);
function coordinateInBounds([lon, lat], [[west, south], [east, north]]) {
  return (
    lat >= south &&
    lat <= north &&
    (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east)
  );
}
function positionElement(tag, parent) {
  const e = document.createElement(tag);
  e.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  parent.append(e);
  return e;
}

export async function createGlobe(
  container,
  {
    rows = [],
    onPick = () => {},
    onReady = () => {},
    onView = () => {},
    onHover = () => {},
  } = {},
) {
  const data = mapData(rows);
  const features = data.countries.features.map((f) => ({
    f,
    bbox: geoBounds(f),
  }));
  const byFeature = new Map();
  for (const f of data.countries.features) {
    const code = f.properties.code;
    if (!byFeature.has(code)) byFeature.set(code, []);
    byFeature.get(code).push(f);
  }
  const projection = geoOrthographic().clipAngle(90).precision(0.55);
  let center = start.slice(),
    level = 0,
    selected = null,
    hovered = null,
    view = viewport(container),
    zoom = zoomAt(0, center[1], view);
  let map = null,
    native = false,
    webgl = false,
    loaded = false,
    destroyed = false,
    frame = 0,
    notifyFrame = 0,
    flight = 0;
  let focus = null,
    locked = false,
    bearing = 0,
    pendingLock = 0;
  let suspendedInputs = [];
  const card = document.querySelector(".card");
  let composition = inspectionFrame(view, focus, card.getBoundingClientRect());
  const focusCache = new Map();
  const host = positionElement("div", container);
  host.style.pointerEvents = "auto";
  host.style.touchAction = "none";
  host.style.cursor = "grab";
  host.style.overflow = "hidden";
  const canvas = positionElement("canvas", host);
  const ctx = canvas.getContext("2d");
  const mount = positionElement("div", host);
  mount.style.opacity = "0";
  mount.style.pointerEvents = "auto";
  mount.setAttribute("aria-hidden", "true");
  const shield = positionElement("div", host);
  shield.style.touchAction = "none";
  function notifyView() {
    if (!notifyFrame && !destroyed)
      notifyFrame = requestAnimationFrame(() => {
        notifyFrame = 0;
        if (!destroyed) onView();
      });
  }
  function fallback() {
    native = webgl = false;
    canvas.style.visibility = "visible";
    mount.style.opacity = "0";
    mount.style.pointerEvents = "none";
    schedule();
    notifyView();
  }
  function project(lon, lat) {
    const ll = [lon, lat];
    if (native) {
      const p = map.project(ll);
      return {
        x: p.x,
        y: p.y,
        visible: level > 4 || geoDistance(center, ll) < Math.PI / 2 - 0.028,
      };
    }
    const [x, y] = projection(ll);
    return { x, y, visible: geoDistance(center, ll) < Math.PI / 2 };
  }
  function mark(code, key, value) {
    if (!loaded || !native || !code) return;
    for (const f of byFeature.get(code) || [])
      map.setFeatureState({ source: "countries", id: f.id }, { [key]: value });
    for (const f of data.islands.features)
      if (f.properties.code === code)
        map.setFeatureState({ source: "islands", id: f.id }, { [key]: value });
  }
  function updateProjection() {
    view.r = view.r0 * 2 ** level;
    projection
      .scale(view.r)
      .clipExtent([
        [0, 0],
        [view.w, view.h],
      ])
      .clipAngle(
        Math.min(
          90,
          Math.asin(Math.min(1, Math.hypot(view.w, view.h) / 2 / view.r)) /
            rad +
            1.5,
        ),
      )
      .translate([view.cx, view.cy])
      .rotate([-center[0], -center[1]])
      .angle(bearing);
  }
  function readCamera(event) {
    if (!native) return;
    const c = map.getCenter();
    center = [c.lng, c.lat];
    const previousZoom = zoom;
    zoom = map.getZoom();
    bearing = map.getBearing();
    level = zoom - zoomAt(0, c.lat, view);
    if (
      !locked &&
      !pendingLock &&
      event?.originalEvent &&
      zoom > previousZoom &&
      level >= composition.cap - 0.001
    ) {
      pendingLock = requestAnimationFrame(() => {
        pendingLock = 0;
        if (!destroyed && !locked) setStage(3);
      });
    }
    updateProjection();
    schedule();
    notifyView();
  }
  function render() {
    frame = 0;
    if (destroyed) return;
    if (webgl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1),
      pw = Math.round(view.w * dpr),
      ph = Math.round(view.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    const path = geoPath(projection, ctx);
    ctx.save();
    if (view.r < Math.hypot(view.w, view.h)) {
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, view.r, 0, tau);
      ctx.clip();
    }
    ctx.fillStyle = seaAtZoom(ink.shelf, zoom);
    ctx.fillRect(0, 0, view.w, view.h);
    const cornerDistance = Math.min(
      90,
      Math.asin(Math.min(1, (Math.hypot(view.w, view.h) * 0.53) / view.r)) /
        rad +
        1,
    );
    const region =
      cornerDistance < 63
        ? {
            n: center[1] + cornerDistance,
            s: center[1] - cornerDistance,
            lon: center[0],
            dl:
              cornerDistance /
              Math.max(
                0.01,
                Math.cos((Math.abs(center[1]) + cornerDistance) * rad),
              ),
          }
        : null;
    function inView(b) {
      if (!region) return true;
      const [[w, s], [e, n]] = b;
      if (n < region.s || s > region.n) return false;
      if (region.dl >= 180 || e < w) return true;
      const x = (((w + e) / 2 - region.lon + 540) % 360) - 180;
      return Math.abs(x) <= (e - w) / 2 + region.dl;
    }
    if (zoom < 8.6)
      for (const band of seabedByDepth) {
        ctx.beginPath();
        for (const f of band.features) {
          let b = detailBounds.get(f);
          if (!b) {
            b = geoBounds(f);
            detailBounds.set(f, b);
          }
          if (inView(b)) path(f);
        }
        ctx.fillStyle = seaAtZoom(band.color, zoom);
        ctx.fill();
      }
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = ink.graticule;
    ctx.lineWidth = 0.65;
    ctx.globalAlpha = 0.36;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    path(coastline);
    ctx.strokeStyle = ink.coast;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const { f, bbox } of features) {
      if (!inView(bbox)) continue;
      ctx.beginPath();
      path(f);
      ctx.fillStyle =
        f.properties.code === hovered
          ? f.properties.hoverColor
          : f.properties.color;
      ctx.fill();
      ctx.strokeStyle = ink.boundary;
      ctx.lineWidth = 0.74;
      ctx.stroke();
    }
    if (zoom >= 2.6) {
      for (const [name, style, width] of [
        ["provinces", "rgba(92,130,113,.48)", 0.78],
        ["rivers", "rgba(74,167,186,.92)", 0.92],
        ["lakes", ink.lake, 0],
      ]) {
        ctx.beginPath();
        for (const f of layers[name].features) {
          let b = detailBounds.get(f);
          if (!b) {
            b = geoBounds(f);
            detailBounds.set(f, b);
          }
          if (inView(b)) path(f);
        }
        if (width) {
          ctx.strokeStyle = style;
          ctx.lineWidth = width;
          ctx.stroke();
        } else {
          ctx.fillStyle = style;
          ctx.fill();
        }
      }
    }
    function drawDot(p, radius) {
      const c = p.geometry.coordinates;
      if (geoDistance(center, c) > cornerDistance * rad) return;
      const [x, y] = projection(c);
      if (x < 0 || x > view.w || y < 0 || y > view.h) return;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, tau);
      ctx.fillStyle = p.properties.ink;
      ctx.fill();
    }
    for (const p of data.dots.features) drawDot(p, 1.08);
    for (const p of data.islands.features) {
      const c = p.geometry.coordinates;
      if (geoDistance(center, c) > Math.PI / 2) continue;
      const [x, y] = projection(c);
      ctx.beginPath();
      const active =
        p.properties.code === selected || p.properties.code === hovered;
      ctx.arc(x, y, active ? 3.4 : 2.15, 0, tau);
      ctx.fillStyle =
        p.properties.code === hovered
          ? p.properties.hoverColor
          : p.properties.color;
      ctx.fill();
      ctx.strokeStyle = active ? "#004946" : "#f0fff4";
      ctx.lineWidth = active ? 1.65 : 0.65;
      ctx.stroke();
    }
    if (selected || hovered) {
      for (const { f } of features)
        if (f.properties.code === selected || f.properties.code === hovered) {
          ctx.beginPath();
          path(f);
          ctx.strokeStyle = ink.selection;
          ctx.lineWidth = 2.15;
          ctx.stroke();
        }
    }
    ctx.restore();
  }
  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(render);
  }
  function setFallbackCamera(c, l) {
    center = [wrap(c[0]), clamp(c[1], -85, 85)];
    level = clamp(
      l,
      -5 - zoomAt(0, center[1], view),
      21 - zoomAt(0, center[1], view),
    );
    zoom = zoomAt(level, center[1], view);
    updateProjection();
    schedule();
    notifyView();
  }
  function resize() {
    const next = viewport(container);
    if (next.w === view.w && next.h === view.h) return;
    view = next;
    composition = inspectionFrame(view, focus, card.getBoundingClientRect());
    if (native) {
      map.resize();
      readCamera();
    } else {
      level = zoom - zoomAt(0, center[1], view);
      setFallbackCamera(center, level);
    }
    if (locked) setStage(3, { animate: false });
  }
  function setStage(stage, { animate = true } = {}) {
    stage = clamp(Math.round(stage), 0, 3);
    cancelAnimationFrame(pendingLock);
    pendingLock = 0;
    locked = stage >= 2;
    shield.style.pointerEvents = locked ? "auto" : "none";
    host.style.cursor = locked ? "default" : "grab";
    if (locked || stage === 0) {
      mark(hovered, "hover", false);
      hovered = null;
    }
    const target = focus?.center || (stage ? [3, 35] : start);
    const to = locked ? composition.cap : stage ? composition.fit : 0;
    const duration = animate && !reduced() ? (locked ? 690 : 400) : 0;
    const targetBearing = locked ? composition.bearing : 0;
    const offset = locked
      ? [composition.pixel[0] - view.cx, composition.pixel[1] - view.cy]
      : [0, 0];
    if (native) {
      map.stop();
      if (locked && !suspendedInputs.length) {
        suspendedInputs = [
          map.dragPan,
          map.dragRotate,
          map.touchZoomRotate,
          map.touchPitch,
          map.scrollZoom,
          map.doubleClickZoom,
          map.keyboard,
          map.boxZoom,
        ].filter((handler) => handler?.isEnabled());
        for (const handler of suspendedInputs) handler.disable();
      } else if (!locked && suspendedInputs.length) {
        for (const handler of suspendedInputs) handler.enable();
        suspendedInputs = [];
      }
      const targetZoom = zoomAt(to, target[1], view);
      map.setMaxZoom(locked ? targetZoom : 21);
      map.easeTo({
        center: target,
        zoom: targetZoom,
        bearing: targetBearing,
        pitch: 0,
        roll: 0,
        offset,
        duration,
        easing: (t) => t * t * (3 - 2 * t),
      });
      notifyView();
      return;
    }
    cancelAnimationFrame(flight);
    const destination = locked
      ? anchorCamera(target, to, composition.pixel, targetBearing, target[0])
      : target;
    const fromBearing = bearing;
    if (!duration) {
      bearing = targetBearing;
      setFallbackCamera(destination, to);
      return;
    }
    const now = performance.now(),
      from = level,
      interp = geoInterpolate(center, destination);
    function tick(t) {
      const q = clamp((t - now) / duration, 0, 1),
        u = q * q * (3 - 2 * q);
      bearing = fromBearing + (targetBearing - fromBearing) * u;
      setFallbackCamera(interp(u), from + (to - from) * u);
      if (q < 1) flight = requestAnimationFrame(tick);
    }
    flight = requestAnimationFrame(tick);
    notifyView();
  }
  function setCountry(
    code,
    { center: recenter = true, animate = true, stage = code ? 1 : 0 } = {},
  ) {
    code = data.byCode.has(code) ? code : null;
    if (locked && !recenter) return;
    if (selected !== code) {
      mark(selected, "selected", false);
      selected = code;
      if (code && !focusCache.has(code))
        focusCache.set(
          code,
          countryFrame(data.byCode.get(code), byFeature.get(code) || []),
        );
      focus = focusCache.get(code) || null;
      composition = inspectionFrame(view, focus, card.getBoundingClientRect());
      mark(code, "selected", true);
      schedule();
      notifyView();
    }
    if (recenter) setStage(stage, { animate });
  }
  function findCountry(x, y) {
    if (native && loaded) {
      const hits = map.queryRenderedFeatures([x, y], {
        layers: ["islas", "lagos", "pais"],
      });
      for (const f of hits) {
        if (f.layer.id === "lagos") return null;
        if (data.byCode.has(f.properties.code)) return f.properties.code;
      }
      return null;
    }
    if (Math.hypot(x - view.cx, y - view.cy) > view.r + 1) return null;
    let nearest = null,
      dist = 6;
    for (const island of data.islands.features) {
      const p = project(...island.geometry.coordinates),
        gap = Math.hypot(p.x - x, p.y - y);
      if (p.visible && gap < dist) {
        nearest = island.properties.code;
        dist = gap;
      }
    }
    if (nearest) return nearest;
    const coord = projection.invert([x, y]);
    if (zoom >= 2.6 && layers.lakes.features.some(lake => {
      const bounds = detailBounds.get(lake);
      return (!bounds || coordinateInBounds(coord, bounds)) && geoContains(lake, coord);
    })) return null;
    for (const { f, bbox } of features)
      if (
        data.byCode.has(f.properties.code) &&
        coordinateInBounds(coord, bbox) &&
        geoContains(f, coord)
      )
        return f.properties.code;
    return null;
  }
  function hover(code, xy) {
    if (locked || pendingLock) return;
    if (code !== hovered) {
      mark(hovered, "hover", false);
      hovered = code;
      mark(hovered, "hover", true);
      if (!native) schedule();
    }
    host.style.cursor = code ? "pointer" : "grab";
    onHover(code, xy);
  }
  function where(e) {
    const b = host.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }
  // Solve the north-up orthographic inverse for the camera center. This keeps
  // exactly the same coordinate under a wheel cursor or the moving pinch midpoint.
  function anchorCamera(
    ll,
    toLevel,
    toPixel,
    angle = bearing,
    referenceLon = center[0],
  ) {
    const r = view.r0 * 2 ** toLevel,
      [lon, lat] = ll,
      a = lat * rad,
      dx = (toPixel[0] - view.cx) / r,
      dy = (view.cy - toPixel[1]) / r,
      turn = angle * rad,
      px = dx * Math.cos(turn) + dy * Math.sin(turn),
      py = dy * Math.cos(turn) - dx * Math.sin(turn);
    const spread = Math.asin(clamp(px / Math.max(0.00001, Math.cos(a)), -1, 1));
    const old = wrap(lon - referenceLon) * rad;
    const alternatives = [
      spread,
      spread >= 0 ? Math.PI - spread : -Math.PI - spread,
    ];
    const delta = alternatives.reduce((best, x) =>
      Math.abs(wrap((x - old) / rad)) < Math.abs(wrap((best - old) / rad))
        ? x
        : best,
    );
    const depth = Math.cos(a) * Math.cos(delta),
      direction = Math.atan2(Math.sin(a), depth),
      magnitude = Math.hypot(Math.sin(a), depth);
    return [
      wrap(lon - delta / rad),
      clamp(
        wrap((direction - Math.asin(clamp(py / magnitude, -1, 1))) / rad),
        -85,
        85,
      ),
    ];
  }
  function anchorAt(xy) {
    return Math.hypot(xy[0] - view.cx, xy[1] - view.cy) <= view.r
      ? projection.invert(xy)
      : null;
  }
  function zoomAtPoint(xy, delta) {
    if (delta > 0 && level + delta >= composition.cap) {
      setStage(3);
      return;
    }
    cancelAnimationFrame(flight);
    const next = clamp(
      level + delta,
      -5 - zoomAt(0, center[1], view),
      21 - zoomAt(0, center[1], view),
    );
    const ll = anchorAt(xy);
    setFallbackCamera(ll ? anchorCamera(ll, next, xy) : center, next);
  }
  const pointers = new Map();
  let gesture = null;
  function currentGesture() {
    const p = [...pointers.values()];
    if (!p.length) return null;
    const a = p[0].xy,
      b = p[1]?.xy || a;
    return {
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
      count: p.length,
    };
  }
  function startGesture() {
    const g = currentGesture();
    gesture = g
      ? { ...g, anch: anchorAt(g.mid), center: center.slice(), level }
      : null;
  }
  function down(e) {
    if (locked || native || e.button !== 0) return;
    cancelAnimationFrame(flight);
    const xy = where(e);
    pointers.set(e.pointerId, { xy, start: xy, moved: false });
    startGesture();
    host.setPointerCapture(e.pointerId);
    host.style.cursor = "grabbing";
  }
  function move(e) {
    if (locked || pendingLock) return;
    if (native) {
      if (!e.buttons && e.pointerType !== "touch") {
        const [x, y] = where(e);
        hover(findCountry(x, y), { x, y });
      }
      return;
    }
    const xy = where(e),
      p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== "touch")
        hover(findCountry(...xy), { x: xy[0], y: xy[1] });
      return;
    }
    p.xy = xy;
    p.moved ||= Math.hypot(xy[0] - p.start[0], xy[1] - p.start[1]) >= 3;
    const g = currentGesture();
    if (!gesture || !(p.moved || g.count > 1)) return;
    const next =
      gesture.level +
      (g.count > 1 && g.distance && gesture.distance
        ? Math.log2(g.distance / gesture.distance)
        : 0);
    if (g.count > 1 && next > level && next >= composition.cap) {
      setStage(3);
      return;
    }
    const c = gesture.anch
      ? anchorCamera(gesture.anch, next, g.mid)
      : [
          gesture.center[0] -
            (g.mid[0] - gesture.mid[0]) /
              view.r /
              rad /
              Math.max(0.1, latitudeFactor(center[1])),
          gesture.center[1] + (g.mid[1] - gesture.mid[1]) / view.r / rad,
        ];
    setFallbackCamera(c, next);
  }
  function up(e) {
    if (native) return;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
    startGesture();
    if (!locked && !pointers.size) host.style.cursor = "grab";
  }
  // At the last scale this transparent surface freezes the selected map. Reverse
  // wheel and pinch gestures return to exploration, as do the location controls.
  shield.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY > 0) setStage(selected ? 1 : 0);
    },
    { passive: false },
  );
  shield.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (e.shiftKey) setStage(selected ? 1 : 0);
  });
  const contacts = new Map();
  let pinchGap = 0, tap = null;
  const separation = () => {
    const [a, b] = contacts.values();
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  // Detect taps on both the live map and the locked shield. A drag or pinch
  // cancels selection, even if the gesture changes which surface is on top.
  host.addEventListener(
    "pointerdown",
    (e) => {
      const xy = where(e);
      tap = e.isPrimary && e.button === 0 ? { id: e.pointerId, xy } : null;
      if (e.pointerType !== "touch") return;
      contacts.set(e.pointerId, xy);
      if (contacts.size === 2) pinchGap = separation();
    },
    true,
  );
  host.addEventListener(
    "pointermove",
    (e) => {
      const xy = where(e);
      if (tap?.id === e.pointerId && Math.hypot(xy[0] - tap.xy[0], xy[1] - tap.xy[1]) >= 4)
        tap = null;
      if (!contacts.has(e.pointerId)) return;
      contacts.set(e.pointerId, xy);
      if (contacts.size === 2) {
        const gap = separation();
        if (locked && gap < pinchGap * 0.955) setStage(selected ? 1 : 0);
        pinchGap = locked ? Math.max(pinchGap, gap) : gap;
      }
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel"]) {
    host.addEventListener(
      type,
      (e) => {
        contacts.delete(e.pointerId);
        if (tap?.id !== e.pointerId) return;
        const [x, y] = where(e);
        const distance = Math.hypot(x - tap.xy[0], y - tap.xy[1]);
        tap = null;
        if (type !== "pointerup" || distance >= 4) return;
        const code = findCountry(x, y);
        if (code || anchorAt([x, y])) onPick(code, x, y);
      },
      true,
    );
  }
  function lockKeys(e) {
    if (!locked || e.target.closest?.("select,details,a")) return;
    if (["-", "_", "PageDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      setStage(selected ? 1 : 0);
    } else if (
      [
        "+",
        "=",
        "PageUp",
        "ArrowUp",
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  window.addEventListener("keydown", lockKeys, true);
  // These listeners own only the Canvas fallback. A live MapLibre canvas receives
  // its original input events untouched, including wheel, pinch and drag inertia.
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("pointerleave", () => {
    if (hovered) hover(null, { x: 0, y: 0 });
  });
  host.addEventListener(
    "wheel",
    (e) => {
      if (native) return;
      e.preventDefault();
      const [x, y] = where(e),
        code = findCountry(x, y);
      if (code !== hovered) hover(code, { x, y });
      const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      zoomAtPoint(where(e), -e.deltaY * units * (e.ctrlKey ? 0.01 : 0.003));
    },
    { passive: false },
  );
  host.addEventListener("dblclick", (e) => {
    if (locked || native) return;
    e.preventDefault();
    zoomAtPoint(where(e), e.shiftKey ? -1 : 1);
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(flight);
    cancelAnimationFrame(notifyFrame);
    cancelAnimationFrame(pendingLock);
    window.removeEventListener("keydown", lockKeys, true);
    observer.disconnect();
    map?.remove();
    host.remove();
  }
  const api = {
    setCountry,
    setStage,
    isLocked: () => locked,
    glassOrigin: () => ({ x: composition.pixel[0], y: composition.pixel[1] }),
    getProgress: () => (locked ? 3 : clamp(level / composition.fit, 0, 1)),
    countryAt: findCountry,
    getView: () => ({ lon: center[0], lat: center[1], zoom, bearing }),
    project,
    resize,
    destroy,
  };
  updateProjection();
  render();
  try {
    setWorkerUrl(workerUrl);
    setWorkerCount(1);
    const style = structuredClone(__ATLAS_STYLE__);
    for (const [name, source] of Object.entries(style.sources)) {
      source.data = data[name];
      if (name === "countries" || name === "coast") {
        source.maxzoom = 12;
        source.tolerance = 0.55;
      } else if (name === "seabed") {
        source.maxzoom = 8;
        source.tolerance = 0.5;
      }
    }
    for (const layer of style.layers) {
      if (layer.id === "pais" || layer.id === "islas")
        layer.paint[layer.id === "pais" ? "fill-color" : "circle-color"] = [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          ["get", "hoverColor"],
          ["get", "color"],
        ];
      if (layer.id === "pais-activo")
        layer.paint["line-opacity"] = [
          "case",
          [
            "any",
            ["boolean", ["feature-state", "selected"], false],
            ["boolean", ["feature-state", "hover"], false],
          ],
          1,
          0,
        ];
    }
    map = new LibreMap({
      container: mount,
      style,
      center,
      zoom,
      minZoom: -5,
      maxZoom: 21,
      interactive: true,
      attributionControl: false,
      canvasContextAttributes: { antialias: true, alpha: true },
      fadeDuration: 0,
      renderWorldCopies: false,
    });
    native = true;
    map.setVerticalFieldOfView(fieldOfView);
    attachTileflowAtmosphere(map);
    const css = document.createElement("style");
    css.textContent =
      ".atlas-geo-viewport .maplibregl-canvas-container,.atlas-geo-viewport .maplibregl-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none}.atlas-geo-viewport .maplibregl-control-container{display:none}";
    host.append(css);
    mount.classList.add("atlas-geo-viewport");
    map.on("move", readCamera);
    map.on("wheel", (e) => {
      if (!locked && !map.isZooming()) {
        const [x, y] = where(e.originalEvent),
          code = findCountry(x, y);
        if (code !== hovered) hover(code, { x, y });
      }
    });
    function ready() {
      if (destroyed) return;
      native = webgl = loaded = true;
      mount.style.pointerEvents = "auto";
      mount.style.opacity = "1";
      canvas.style.visibility = "hidden";
      mark(selected, "selected", true);
      mark(hovered, "hover", true);
      readCamera();
    }
    map.once("load", ready);
    map.on("webglcontextlost", fallback);
    map.on("webglcontextrestored", () => {
      if (destroyed) return;
      native = true;
      map.jumpTo({ center, zoom });
      map.once("idle", ready);
    });
  } catch {
    fallback();
  }
  queueMicrotask(() => {
    if (!destroyed) onReady();
  });
  return api;
}
