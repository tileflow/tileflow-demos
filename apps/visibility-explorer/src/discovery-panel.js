const byId = (id) => document.getElementById(id);
const normal = (a) => ((a % 360) + 360) % 360;
const delta = (a, b) => normal(a - b + 180) - 180;
const limit = (v, a, b) => Math.max(a, Math.min(b, v));
const decimal = new Intl.NumberFormat('en-US', {maximumFractionDigits: 1});
const integer = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
const distance = (m) =>
  !Number.isFinite(m)
    ? '—'
    : m < 1000
      ? integer.format(m) + ' m'
      : decimal.format(m / 1000) + ' km';
const height = (m) => (Number.isFinite(m) ? integer.format(m) + ' m' : '—');
const compass = (a) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(normal(a) / 45) % 8];
const direction = (a) =>
  Number.isFinite(a) ? compass(a) + ' ' + integer.format(normal(Math.round(a))) + '°' : '—';
const states = {visible: 'Visible', hidden: 'Hidden', unknown: 'Unknown'};
const normalizeText = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en');
const peakName = (p) => p.name || 'Unnamed peak';
const altitude = (p) =>
  Number.isFinite(p.catalogElevationM) ? p.catalogElevationM : p.modelElevationM;
function button(cls, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
}
function attach({map, onChoose, onHeading, onHorizonRequest, onPeek, onSkyChange, onTerrainPick}) {
  const skyButton = byId('sky-toggle'),
    sky = byId('sky');
  const listButton = button('subbutton', 'Visible peaks');
  listButton.id = 'peaks-toggle';
  listButton.setAttribute('aria-controls', 'discovery-list');
  listButton.setAttribute('aria-expanded', 'false');
  skyButton.before(listButton);
  skyButton.setAttribute('aria-controls', 'sky');
  const summary = document.createElement('p');
  summary.id = 'peak-summary';
  summary.className = 'small discovery-summary';
  byId('observer-stats').after(summary);
  const list = document.createElement('section');
  list.id = 'discovery-list';
  list.className = 'discovery-sheet discovery-list';
  list.hidden = true;
  list.setAttribute('aria-label', 'Catalog of identified peaks');
  list.innerHTML =
    '<header><div><h2>Identified peaks</h2><p class="d-sub" data-coverage></p></div><button type="button" class="d-close" aria-label="Close peak list">×</button></header><div class="d-filters"><input type="search" placeholder="Search peaks" aria-label="Search peaks"><select aria-label="Filter peaks by visibility"><option value="visible">Visible</option><option value="hidden">Hidden</option><option value="unknown">Unknown</option><option value="all">All</option></select><select aria-label="Sort peaks"><option value="distanceM">Distance</option><option value="altitude">Elevation</option><option value="azimuthDeg">Bearing</option></select></div><div class="d-rows"></div>';
  document.body.append(list);
  sky.className = 'discovery-sheet discovery-sky';
  sky.setAttribute('aria-label', '360-degree terrain horizon');
  sky.hidden = true;
  sky.innerHTML =
    '<header><div><h2>360° horizon</h2><p class="d-sub" id="sky-guide"></p></div><button type="button" class="d-close" aria-label="Close horizon">×</button></header><div class="d-stage"><canvas id="skyplot" role="slider" tabindex="0" aria-label="Horizon bearing" aria-valuemin="0" aria-valuemax="360"></canvas><div class="d-peak-labels"></div></div><div class="d-pan-tools"><p id="sky-info"></p><div class="d-pan-actions"><label><input type="checkbox" class="d-sync"> Rotate map</label><button type="button" class="d-zoom-out" aria-label="Widen field of view">−</button><span class="d-fov"></span><button type="button" class="d-zoom-in" aria-label="Narrow field of view">+</button></div></div>';
  document.body.append(sky);
  const rows = list.querySelector('.d-rows'),
    filter = list.querySelector('select'),
    order = list.querySelectorAll('select')[1],
    search = list.querySelector('input');
  const canvas = byId('skyplot'),
    stage = sky.querySelector('.d-stage'),
    labelLayer = sky.querySelector('.d-peak-labels');
  const skyInfo = byId('sky-info'),
    skyGuide = byId('sky-guide'),
    sync = sky.querySelector('.d-sync');
  const zin = sky.querySelector('.d-zoom-in'),
    zout = sky.querySelector('.d-zoom-out');
  let observer = null,
    peaks = [],
    selectedId = null,
    peekId = null,
    partial = false,
    loading = false,
    unavailable = false,
    catalog = {};
  let bins = [],
    radius = null,
    center = 0,
    fov = 120,
    windowType = null,
    request = 0,
    drag = null,
    hoverDegree = null,
    ready = false;
  let bounds = null,
    low = -1,
    high = 1;
  const keyed = new Map();
  function open(type, focus = false) {
    if (type && !observer) return;
    if (windowType === type) return;
    const old = windowType;
    windowType = type;
    list.hidden = type !== 'list';
    sky.hidden = type !== 'sky';
    listButton.setAttribute('aria-expanded', String(type === 'list'));
    skyButton.setAttribute('aria-expanded', String(type === 'sky'));
    document.body.classList.toggle('discovery-open', !!type);
    if (old === 'sky' || type === 'sky') onSkyChange?.(type === 'sky');
    hoverDegree = null;
    peek(null);
    drag = null;
    if (type === 'sky') {
      if (!ready) onHorizonRequest?.();
      onHeading?.(center);
      queueDraw();
      if (focus) canvas.focus({preventScroll: true});
    } else if (type === 'list') {
      listRows();
      if (focus) list.querySelector('.d-close').focus({preventScroll: true});
    } else if (focus) (old === 'sky' ? skyButton : listButton).focus({preventScroll: true});
  }
  listButton.onclick = () => open(windowType === 'list' ? null : 'list', true);
  skyButton.onclick = () => open(windowType === 'sky' ? null : 'sky', true);
  for (const close of [list, sky]) close.querySelector('.d-close').onclick = () => open(null, true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && windowType) {
        e.preventDefault();
        open(null, true);
      }
    },
    true,
  );
  function peek(p) {
    const id = p?.id ?? null;
    if (peekId === id) return;
    peekId = id;
    onPeek?.(p || null);
    queueDraw();
    const oldRow = rows.querySelector('.d-peek');
    if (oldRow) oldRow.classList.remove('d-peek');
    if (id !== null)
      for (const row of rows.children) {
        if (row.dataset.id === String(id)) {
          row.classList.add('d-peek');
          break;
        }
      }
  }
  function choose(p) {
    if (!p) return;
    select(p.id);
    onHeading?.(p.azimuthDeg);
    onChoose?.(p);
  }
  function report() {
    const visible = peaks.filter((p) => p.status === 'visible');
    const count = visible.length;
    summary.hidden = !observer;
    listButton.disabled = !observer;
    const countText =
      count + ' ' + (count === 1 ? 'visible peak identified' : 'visible peaks identified');
    const progress = catalog.progress;
    const loadingText =
      progress?.total > 0
        ? 'Finding peaks · ' + (progress.loaded + progress.failed) + '/' + progress.total + ' tiles'
        : 'Finding peaks…';
    const countLabel = loading
      ? loadingText
      : unavailable
        ? 'Peak catalog unavailable'
        : partial
          ? count
            ? countText + ' · partial coverage'
            : 'Partial peak coverage'
          : countText;
    const byHeight = visible
      .filter((p) => Number.isFinite(altitude(p)))
      .sort((a, b) => altitude(b) - altitude(a))[0];
    const farthest = visible
      .filter((p) => Number.isFinite(p.distanceM))
      .sort((a, b) => b.distanceM - a.distanceM)[0];
    summary.textContent =
      countLabel +
      (byHeight && !loading && !unavailable ? ' · ' + peakName(byHeight) + ' is the highest' : '');
    const info = [];
    if (!loading && !unavailable) {
      if (byHeight)
        info.push(
          (partial ? 'Highest identified peak' : 'Highest peak') +
            ' · ' +
            peakName(byHeight) +
            ' (' +
            height(altitude(byHeight)) +
            ')',
        );
      if (farthest && farthest.id !== byHeight?.id)
        info.push('Farthest · ' + peakName(farthest) + ' (' + distance(farthest.distanceM) + ')');
      if (partial && Number.isFinite(catalog.loadedTiles) && catalog.totalTiles > 0)
        info.push(catalog.loadedTiles + ' of ' + catalog.totalTiles + ' tiles available');
      if (catalog.notice) info.push(catalog.notice);
    }
    list.querySelector('[data-coverage]').textContent = [countLabel, ...info].join('. ');
  }
  function listRows() {
    const match = normalizeText(search.value.trim());
    const ordered = peaks.filter(
      (p) =>
        (filter.value === 'all' || p.status === filter.value) &&
        normalizeText(peakName(p)).includes(match),
    );
    const fn =
      order.value === 'altitude'
        ? (p) => (Number.isFinite(altitude(p)) ? -altitude(p) : Infinity)
        : (p) => (Number.isFinite(p[order.value]) ? p[order.value] : Infinity);
    ordered.sort((a, b) => fn(a) - fn(b) || peakName(a).localeCompare(peakName(b), 'en'));
    const prevFocus = rows.contains(document.activeElement)
      ? document.activeElement.dataset.id
      : undefined;
    const next = document.createDocumentFragment();
    if (!ordered.length) {
      const note = document.createElement('p');
      note.className = 'd-empty';
      note.textContent = loading
        ? 'Loading peak catalog…'
        : unavailable
          ? 'Could not load peaks for this area.'
          : partial
            ? 'No matching peaks in the available coverage.'
            : peaks.length
              ? 'No peaks match these filters.'
              : 'No peaks identified within this radius.';
      next.append(note);
    }
    for (const p of ordered) {
      const row = button('d-peak-row', '');
      row.dataset.id = String(p.id);
      row.setAttribute('aria-pressed', String(p.id === selectedId));
      const name = document.createElement('strong'),
        meta = document.createElement('span'),
        status = document.createElement('span');
      name.textContent = peakName(p);
      meta.className = 'd-peak-meta';
      meta.textContent = [
        distance(p.distanceM),
        direction(p.azimuthDeg),
        Number.isFinite(p.catalogElevationM)
          ? 'Elevation ' + height(p.catalogElevationM)
          : 'Modeled elevation ' + height(p.modelElevationM),
      ].join(' · ');
      status.className = 'd-status';
      status.dataset.state = p.status;
      status.textContent = states[p.status] || states.unknown;
      row.append(name, status, meta);
      row.onclick = () => choose(p);
      row.onpointerenter = () => peek(p);
      row.onfocus = () => peek(p);
      row.onblur = () => peek(null);
      next.append(row);
    }
    rows.replaceChildren(next);
    if (prevFocus !== undefined)
      for (const row of rows.children) {
        if (row.dataset.id === prevFocus) {
          row.focus({preventScroll: true});
          break;
        }
      }
  }
  rows.onpointerleave = () => peek(null);
  search.oninput = filter.onchange = order.onchange = listRows;
  function select(id) {
    selectedId = id ?? null;
    const p = peaks.find((p) => p.id === selectedId);
    if (p && Number.isFinite(p.azimuthDeg)) center = normal(p.azimuthDeg);
    for (const row of rows.querySelectorAll('button'))
      row.setAttribute('aria-pressed', String(row.dataset.id === String(selectedId)));
    hoverDegree = null;
    queueDraw();
  }
  function setObserver(p) {
    const changed = !p || !observer || p.lat !== observer.lat || p.lon !== observer.lon;
    observer = p;
    if (changed) {
      open(null);
      peaks = [];
      bins = [];
      radius = null;
      ready = false;
      partial = false;
      unavailable = false;
      loading = !!p;
      catalog = {};
      hoverDegree = null;
      peek(null);
      if (!p) selectedId = null;
    }
    listButton.disabled = !p;
    report();
    listRows();
    queueDraw();
  }
  function setPeaks(data = {}) {
    catalog = data;
    peaks = Array.isArray(data.peaks) ? data.peaks : [];
    loading = !!data.loading;
    partial = !!data.partial;
    unavailable = !!data.unavailable;
    if (!loading && !partial && !unavailable && !peaks.some((p) => p.id === selectedId))
      selectedId = null;
    const selected = peaks.find((p) => p.id === selectedId);
    if (selected && Number.isFinite(selected.azimuthDeg)) center = normal(selected.azimuthDeg);
    report();
    if (windowType === 'list') listRows();
    queueDraw();
  }
  function setHorizon(data) {
    bins = (data?.bins || [])
      .filter((b) => Number.isFinite(b.bearing))
      .slice()
      .sort((a, b) => a.bearing - b.bearing);
    ready = !!data;
    radius = data?.radius ?? null;
    bounds = null;
    low = 0;
    high = 0;
    for (const b of bins)
      if (Number.isFinite(b.angle)) {
        low = Math.min(low, b.angle);
        high = Math.max(high, b.angle);
      }
    const heightRange = Math.max(0.75, high - low);
    low -= 0.08 * heightRange;
    high += 0.26 * heightRange;
    queueDraw();
  }
  function queueDraw() {
    if (windowType === 'sky' && !request)
      request = requestAnimationFrame(() => {
        request = 0;
        if (windowType === 'sky') draw();
      });
  }
  function pan(deg, moveCamera = true) {
    if (!Number.isFinite(deg)) return;
    center = normal(deg);
    hoverDegree = null;
    onHeading?.(center);
    if (
      moveCamera &&
      sync.checked &&
      map?.getPitch?.() > 0 &&
      Math.abs(delta(center, map.getBearing())) > 0.15
    )
      map.setBearing(center);
    queueDraw();
  }
  function setMapBearing(deg) {
    if (
      windowType === 'sky' &&
      sync.checked &&
      map?.getPitch?.() > 0 &&
      Math.abs(delta(deg, center)) > 0.15
    )
      pan(deg, false);
  }
  map?.on?.('rotate', () => setMapBearing(map.getBearing()));
  sync.onchange = () => {
    if (sync.checked) pan(center);
  };
  function zoom(amount, anchor = 0.5) {
    const next = limit(fov * amount, 30, 360);
    if (next === fov) return;
    const correction = (anchor - 0.5) * (fov - next);
    fov = next;
    pan(center + correction);
  }
  zin.onclick = () => zoom(0.67);
  zout.onclick = () => zoom(1.5);
  function nearest(deg) {
    if (!bins.length) return null;
    const v = normal(deg);
    let l = 0,
      r = bins.length;
    while (l < r) {
      const m = (l + r) >> 1;
      if (bins[m].bearing < v) l = m + 1;
      else r = m;
    }
    const a = bins[l % bins.length],
      b = bins[(l + bins.length - 1) % bins.length];
    return Math.abs(delta(a.bearing, v)) <= Math.abs(delta(b.bearing, v)) ? a : b;
  }
  function renderLabels(ctx, xOf, yOf, w, h) {
    const selected = peaks.find((p) => p.id === selectedId),
      underPointer = peaks.find((p) => p.id === peekId);
    const want = peaks
      .filter(
        (p) =>
          Number.isFinite(p.angularElevationDeg) &&
          Number.isFinite(p.azimuthDeg) &&
          (p.status === 'visible' || p === selected),
      )
      .sort(
        (a, b) =>
          (b === selected) - (a === selected) ||
          (b === underPointer) - (a === underPointer) ||
          a.distanceM - b.distanceM,
      );
    const occupied = [],
      used = new Set();
    ctx.font = '600 11px system-ui';
    for (const p of want) {
      const x = xOf(p.azimuthDeg),
        y = yOf(p.angularElevationDeg);
      if (x < bounds.l || x > bounds.r || y < 3 || y > h - 22) continue;
      const label = peakName(p),
        readout = height(altitude(p)) + ' · ' + distance(p.distanceM);
      const width = Math.min(
        165,
        Math.max(67, ctx.measureText(label).width + 14, ctx.measureText(readout).width + 14),
      );
      const left = limit(x - width / 2, bounds.l, w - width - 2);
      let top = null;
      for (const dy of [-38, -64, 8]) {
        const candidate = limit(y + dy, 2, h - 56);
        if (
          occupied.every(
            (b) =>
              left + width + 4 < b.left ||
              b.right + 4 < left ||
              candidate + 31 < b.top ||
              b.bottom < candidate,
          )
        ) {
          top = candidate;
          break;
        }
      }
      if (top === null) continue;
      occupied.push({left, top, right: left + width, bottom: top + 33});
      used.add(p.id);
      let el = keyed.get(p.id);
      if (!el) {
        el = button('d-peak-label', '');
        el.append(document.createElement('strong'), document.createElement('small'));
        el.onclick = () => choose(el.peak);
        el.onpointerenter = el.onfocus = () => peek(el.peak);
        el.onpointerleave = el.onblur = () => peek(null);
        labelLayer.append(el);
        keyed.set(p.id, el);
      }
      el.peak = p;
      el.firstChild.textContent = label;
      el.lastChild.textContent = readout;
      el.setAttribute(
        'aria-label',
        label + ', ' + (states[p.status] || states.unknown) + ', ' + readout,
      );
      el.setAttribute('aria-pressed', String(p === selected));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.width = width + 'px';
      ctx.strokeStyle = p === selected ? '#9b482f' : '#486856';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = p === selected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(limit(x, left + 3, left + width - 3), top > y ? top : top + 29);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, p === selected ? 4 : 2.6, 0, 2 * Math.PI);
      ctx.fill();
    }
    for (const [id, el] of keyed)
      if (!used.has(id)) {
        el.remove();
        keyed.delete(id);
      }
  }
  function draw() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const d = Math.min(2, devicePixelRatio || 1),
      ctx = canvas.getContext('2d');
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
      canvas.width = Math.round(w * d);
      canvas.height = Math.round(h * d);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    bounds = {l: 30, r: w - 13, t: 8, b: h - 24};
    const {l, r, t, b} = bounds,
      from = center - fov / 2,
      to = center + fov / 2,
      xx = (a) => l + ((a - from) / fov) * (r - l);
    let floor = low,
      ceil = high;
    for (const p of peaks)
      if (
        (p.status === 'visible' || p.id === selectedId) &&
        Math.abs(delta(p.azimuthDeg, center)) <= fov / 2 &&
        Number.isFinite(p.angularElevationDeg)
      ) {
        floor = Math.min(floor, p.angularElevationDeg - 0.3);
        ceil = Math.max(ceil, p.angularElevationDeg + 0.4);
      }
    const yy = (a) => b - ((a - floor) / (ceil - floor)) * (b - t);
    const clipped = bins.some((v) => v.complete === false || !Number.isFinite(v.angle));
    skyGuide.textContent = ready
      ? 'Terrain within ' +
        distance(radius) +
        (clipped ? ' · partial coverage' : '') +
        ' · Drag to rotate'
      : 'Calculating terrain skyline…';
    sky.querySelector('.d-fov').textContent = integer.format(fov) + '°';
    zin.disabled = fov <= 30;
    zout.disabled = fov >= 360;
    const angle = hoverDegree ?? center,
      bin = nearest(angle);
    skyInfo.textContent =
      direction(angle) +
      (Number.isFinite(bin?.angle)
        ? ' · ' +
          decimal.format(bin.angle) +
          '° elevation · ' +
          distance(bin.distance) +
          (bin.complete === false ? ' · incomplete' : '')
        : ready
          ? ' · no data'
          : '');
    canvas.setAttribute('aria-valuenow', String(Math.round(normal(center)) % 360));
    canvas.setAttribute('aria-valuetext', direction(center));
    if (!ready || !bins.length) {
      for (const e of keyed.values()) e.remove();
      keyed.clear();
      return;
    }
    // Draw the sampled maxima, permitting gaps and an unwrapped pass through due north.
    ctx.save();
    ctx.beginPath();
    ctx.rect(l, 0, r - l, b + 1);
    ctx.clip();
    let run = [],
      complete;
    const flush = () => {
      if (run.length) {
        ctx.beginPath();
        ctx.moveTo(run[0][0], b);
        for (const [x, y] of run) ctx.lineTo(x, y);
        ctx.lineTo(run.at(-1)[0], b);
        ctx.closePath();
        ctx.fillStyle = complete ? '#d9e7dc' : '#e4e3d9';
        ctx.fill();
        ctx.beginPath();
        for (const [i, [x, y]] of run.entries()) i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = complete ? '#36624e' : '#746d59';
        ctx.setLineDash(complete ? [] : [4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      run = [];
    };
    const margin = 720 / bins.length;
    for (let world = Math.floor(from / 360) - 1; world <= Math.floor(to / 360) + 1; world++) {
      for (const bin of bins) {
        const a = bin.bearing + 360 * world;
        if (a < from - margin || a > to + margin) continue;
        if (!Number.isFinite(bin.angle)) {
          flush();
          continue;
        }
        const determinate = bin.complete !== false;
        if (run.length && complete !== determinate) {
          const previous = run.at(-1);
          flush();
          run.push(previous);
        }
        complete = determinate;
        run.push([xx(a), yy(bin.angle)]);
      }
    }
    flush();
    ctx.strokeStyle = '#677b70';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(l, yy(0));
    ctx.lineTo(r, yy(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#435a50';
    ctx.textAlign = 'right';
    ctx.fillText('0°', l - 5, limit(yy(0) + 3, t + 9, b));
    const tick = [5, 15, 30, 45, 90].find((s) => ((r - l) * s) / fov >= 44) || 90;
    ctx.textAlign = 'center';
    for (let a = Math.ceil(from / tick) * tick; a <= to; a += tick) {
      const x = xx(a),
        n = normal(a);
      ctx.beginPath();
      ctx.strokeStyle = '#9ba99d';
      ctx.moveTo(x, b + 2);
      ctx.lineTo(x, b + 6);
      ctx.stroke();
      ctx.fillText(n % 45 === 0 ? compass(n) : integer.format(n) + '°', x, b + 17);
    }
    const cursor = xx(center + delta(angle, center));
    ctx.strokeStyle = '#a56935';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cursor, t);
    ctx.lineTo(cursor, b);
    ctx.stroke();
    ctx.setLineDash([]);
    renderLabels(ctx, (v) => xx(center + delta(v, center)), yy, w, h);
  }
  function atPointer(e) {
    const left = canvas.getBoundingClientRect().left + (bounds?.l ?? 30),
      width = bounds ? bounds.r - bounds.l : stage.clientWidth - 43;
    const frac = limit((e.clientX - left) / width, 0, 1);
    return {frac, deg: normal(center + (frac - 0.5) * fov), width};
  }
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    drag = {id: e.pointerId, start: e.clientX, center, moved: false};
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    const p = atPointer(e);
    if (drag && drag.id === e.pointerId) {
      if (Math.abs(e.clientX - drag.start) > 3) drag.moved = true;
      if (drag.moved) pan(drag.center - ((e.clientX - drag.start) / p.width) * fov);
    } else if (e.pointerType !== 'touch') {
      hoverDegree = p.deg;
      onHeading?.(p.deg);
      queueDraw();
    }
  };
  canvas.onpointerup = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) {
      const {deg} = atPointer(e),
        sample = nearest(deg);
      pan(deg);
      if (sample?.where) onTerrainPick?.(sample.where);
    }
  };
  canvas.onpointercancel = canvas.onlostpointercapture = () => {
    drag = null;
  };
  canvas.onpointerleave = () => {
    if (!drag) {
      hoverDegree = null;
      onHeading?.(center);
      queueDraw();
    }
  };
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.16 : 1 / 1.16, atPointer(e).frac);
    },
    {passive: false},
  );
  canvas.onkeydown = (e) => {
    const step = e.shiftKey ? 15 : 2;
    if (e.key === 'ArrowRight') pan(center + step);
    else if (e.key === 'ArrowLeft') pan(center - step);
    else if (e.key === 'Home') pan(0);
    else if (['+', '=', 'ArrowUp'].includes(e.key)) zoom(0.67);
    else if (['-', 'ArrowDown'].includes(e.key)) zoom(1.5);
    else if (e.key === 'Enter') {
      const p = nearest(center);
      if (p?.where) onTerrainPick?.(p.where);
    } else return;
    e.preventDefault();
  };
  new ResizeObserver(queueDraw).observe(stage);
  setObserver(null);
  return {
    setObserver,
    setPeaks,
    setHorizon,
    select,
    setMapBearing,
    getSelectedId: () => selectedId,
    closeSky: () => {
      if (windowType === 'sky') open(null);
    },
    closePeaks: () => {
      if (windowType === 'list') open(null);
    },
    closePanels: () => open(null),
    isSkyOpen: () => windowType === 'sky',
    clear: () => setObserver(null),
  };
}
export default {attach};
