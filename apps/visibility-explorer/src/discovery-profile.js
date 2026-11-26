import {createObserverView} from './observer-view';
const numbers = new Map();
function format(value, decimals = 0) {
  if (!Number.isFinite(value)) return '—';
  if (!numbers.has(decimals))
    numbers.set(decimals, new Intl.NumberFormat('en-US', {maximumFractionDigits: decimals}));
  return numbers.get(decimals).format(value);
}
const distance = (meters) =>
  Number.isFinite(meters)
    ? meters >= 1000
      ? format(meters / 1000, 2) + ' km'
      : format(meters) + ' m'
    : '—';
const statuses = ['Hidden', 'Visible', 'Outside radius', 'Unknown'];
const statusKeys = ['hidden', 'visible', 'outside', 'unknown'];
function nearbyBlocker(meters, resolution) {
  return Number.isFinite(meters) && meters >= 0 && meters < resolution;
}
function blockerLabel(meters, resolution, in3D = false) {
  if (nearbyBlocker(meters, resolution)) return 'Blocked nearby';
  return 'Blocked at ' + distance(meters) + (in3D ? ' in 3D' : '');
}
function stepAbove(value) {
  const base = 10 ** Math.floor(Math.log10(Math.max(0.01, value)));
  return (
    base * ([1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => base * step >= value) || 10)
  );
}
function attach({onTry, onTrace, onHover, onClose, onToggleFixed, onSave} = {}) {
  const panel = document.createElement('section');
  panel.id = 'terrain-profile';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'profile-title');
  panel.innerHTML = `
    <header class="profile-header">
      <div class="profile-heading">
        <span id="profile-title" class="profile-sr">Terrain profile</span>
        <div class="profile-title-line">
          <strong class="profile-distance">—</strong><span id="profile-name"></span>
          <span class="profile-answer"></span>
        </div>
      </div>
      <div class="profile-tools">
        <button class="profile-lock icon" type="button" aria-label="Lock view" title="Lock view" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path class="lock-shackle" d="M9 10V7a4 4 0 0 1 7.8-1.2"/></svg>
        </button>
        <button class="profile-details icon" type="button" aria-label="Profile details" title="Profile details" aria-expanded="false" aria-controls="profile-extra">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.8v5.1m0-8.3v.3"/></svg>
        </button>
      </div>
    </header>
    <div id="profile-content">
      <div class="profile-visuals"><div class="profile-plot"><canvas role="slider" tabindex="0" aria-label="Explore the terrain profile" aria-valuemin="0"></canvas><output class="profile-cursor" aria-live="off" hidden></output></div>
      <p class="profile-empty" hidden></p></div>
      <div id="profile-extra" hidden>
        <div class="profile-keys"><span>Terrain</span><span>Line of sight</span></div>
        <label class="profile-compare"><input type="checkbox"> Show the line of sight at the minimum observer height</label>
        <p class="profile-obstacles"></p><p class="profile-model"></p>
        <div class="profile-more-actions"><button class="profile-try" type="button" hidden>Try this height</button><button class="profile-save" type="button" hidden>Save this place</button></div>
      </div>
    </div>
    <span class="profile-sr" role="status" aria-live="polite" aria-atomic="true"></span>`;
  const get = (selector) => panel.querySelector(selector);
  const eyeView = createObserverView(get('.profile-visuals'));
  eyeView.clear();
  const heading = get('#profile-name'),
    range = get('.profile-distance'),
    answer = get('.profile-answer');
  const content = get('#profile-content'),
    plot = get('.profile-plot'),
    canvas = get('canvas'),
    empty = get('.profile-empty');
  const cursorBadge = get('.profile-cursor'),
    legend = get('.profile-keys'),
    details = get('.profile-details');
  const extra = get('#profile-extra'),
    compare = get('.profile-compare input'),
    apply = get('.profile-try'),
    save = get('.profile-save');
  const lock = get('.profile-lock'),
    fold = document.getElementById('profile-fold'),
    live = get('[role="status"]');
  const card = document.getElementById('card');
  card.insertBefore(panel, document.getElementById('observer-actions'));
  let target = null,
    data = null,
    eye = 0,
    covered = false,
    fixed = false,
    collapsed = false;
  let profileAnswer = '', meshBlocker = null;
  let selected = null,
    frame = null,
    axis = null,
    layout = null,
    tracing = false,
    restoreDetails = false;

  function queueDraw() {
    if (frame === null)
      frame = requestAnimationFrame(() => {
        frame = null;
        draw();
      });
  }
  function syncVisibility() {
    panel.hidden = !target || covered;
    fold.hidden = panel.hidden;
    document.body.classList.toggle('discovery-profile-open', Boolean(target) && !covered);
    document.body.classList.toggle(
      'discovery-profile-compact',
      Boolean(target) && !covered && !collapsed,
    );
    panel.dataset.collapsed = String(collapsed);
    content.hidden = collapsed;
    fold.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Expand profile' : 'Collapse profile';
    fold.title = label;
    fold.setAttribute('aria-label', label);
    if (panel.hidden || collapsed) leavePlot();
    syncTrace();
    queueDraw();
  }
  function syncTrace() {
    if (data && !extra.hidden && !collapsed && !panel.hidden && data.points?.length > 1) {
      onTrace?.(data.points, data);
      tracing = true;
    } else if (tracing) {
      tracing = false;
      onTrace?.([], null);
    }
  }
  function titleFor(p) {
    heading.textContent = p?.name || '';
    heading.hidden = !heading.textContent;
    heading.title = heading.textContent;
  }
  function setFixed(value) {
    const wasFixed = fixed;
    fixed = Boolean(value);
    lock.setAttribute('aria-pressed', String(fixed));
    const label = fixed ? 'Resume exploring' : 'Lock view';
    lock.title = label;
    lock.setAttribute('aria-label', label);
    lock.querySelector('.lock-shackle').setAttribute('d', fixed ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M9 10V7a4 4 0 0 1 7.8-1.2');
    if (wasFixed !== fixed && target)
      live.textContent = fixed ? 'View locked. ' + answer.textContent : 'View unlocked.';
  }
  function nearSummit(p, result) {
    return p?.peakId && result.status === 0 && result.firstBlocker
      && result.distance - result.firstBlocker.distance < Math.min(100, result.distance * .02);
  }
  function clear() {
    const active = !!target;
    leavePlot();
    target = null;
    data = null;
    axis = null;
    layout = null;
    collapsed = false;
    covered = false;
    fixed = false;
    restoreDetails = false;
    extra.hidden = true;
    compare.checked = false;
    details.setAttribute('aria-expanded', 'false');
    live.textContent = '';
    setFixed(false);
    syncVisibility();
    if (active) onClose?.();
  }
  function pending(p, message = 'Calculating profile…') {
    if (!p) {
      clear();
      return;
    }
    if (data && p.lat === target?.lat && p.lon === target?.lon && message === 'Updating profile…') {
      target = p;
      panel.dataset.status = 'pending';
      answer.textContent = 'Updating · showing previous profile';
      apply.disabled = save.disabled = true;
      return;
    }
    target = p;
    data = null;
    layout = null;
    panel.dataset.status = 'pending';
    titleFor(p);
    range.textContent = '—';
    answer.textContent = message;
    plot.hidden = true;
    empty.hidden = true;
    legend.hidden = true;
    details.disabled = true;
    lock.disabled = false;
    restoreDetails = restoreDetails || !extra.hidden;
    extra.hidden = true;
    details.setAttribute('aria-expanded', 'false');
    leavePlot();
    syncVisibility();
  }
  function update(p, r, currentEye) {
    if (!p || !r) return;
    const preserveCursor =
      selected !== null && data?.points?.length > 1 ? selected / (data.points.length - 1) : null;
    const oldStatus = panel.dataset.status;
    target = p;
    data = r;
    meshBlocker = null;
    eye = currentEye;
    apply.disabled = save.disabled = false;
    titleFor(p);
    range.textContent = distance(r.distance);
    const status = r.reason === 'sector' ? 'Outside sector' : statuses[r.status] || 'Unknown';
    const atOrigin = Number.isFinite(r.distance) && r.distance < 0.1;
    const blocker = r.status === 0 && Number.isFinite(r.firstBlocker?.distance);
    profileAnswer = atOrigin
      ? 'At the observer’s location'
      : blocker
        ? blockerLabel(r.firstBlocker.distance, r.observerResolutionM)
        : status;
    if (nearSummit(p, r) && !nearbyBlocker(r.firstBlocker.distance, r.observerResolutionM))
      profileAnswer += ' · near summit';
    answer.textContent = profileAnswer;
    panel.dataset.status = statusKeys[r.status] || 'unknown';
    const informative =
      !atOrigin && r.points?.length > 1 && r.points.some((q) => Number.isFinite(q.corrected));
    plot.hidden = !informative;
    legend.hidden = !informative;
    empty.hidden = Boolean(informative);
    if (!informative)
      empty.textContent = atOrigin
        ? 'Move the target onto the terrain.'
        : r.status === 2
          ? r.reason === 'sector'
            ? 'Move the target inside the selected sector.'
            : 'Move the target inside the selected radius.'
          : 'Terrain data is missing along this profile.';
    lock.disabled = false;
    details.disabled = false;
    if (informative) {
      selected =
        preserveCursor !== null ? Math.round(preserveCursor * (r.points.length - 1)) : null;
      canvas.setAttribute('aria-valuemax', String(r.points.length - 1));
      const index = selected ?? r.points.length - 1;
      canvas.setAttribute('aria-valuenow', String(index));
      canvas.setAttribute('aria-valuetext', sampleLabel(r.points[index]));
      if (selected !== null) {
        cursorBadge.textContent = sampleLabel(r.points[index]);
        onHover?.(r.points[index]);
      }
    } else leavePlot();
    if (fixed && target && oldStatus !== panel.dataset.status)
      live.textContent = answer.textContent;
    if (restoreDetails) {
      extra.hidden = false;
      details.setAttribute('aria-expanded', 'true');
      restoreDetails = false;
    }
    if (!extra.hidden) updateDetails();
    syncVisibility();
  }
  function setMeshBlocker(hit) {
    if (!data || data.status !== 1 || panel.dataset.status === 'pending') return;
    meshBlocker = hit;
    const label = hit ? blockerLabel(hit.distanceM, data.observerResolutionM, true) : profileAnswer;
    const changed = answer.textContent !== label;
    answer.textContent = label;
    panel.dataset.status = hit ? 'hidden' : 'visible';
    if (fixed && changed) live.textContent = label;
    if (!extra.hidden) updateDetails();
  }
  function updateDetails() {
    if (!data) return;
    const r = data,
      minimum = r.minimumObserverHeightM,
      extraM = r.additionalObserverHeightM;
    const pieces = [];
    if (r.determiningBlocker && r.status === 0)
      pieces.push(
        (r.complete ? 'Height-limiting obstruction at ' : 'Largest known obstruction at ') +
          distance(r.determiningBlocker.distance),
      );
    if (Number.isFinite(r.clearance))
      pieces.push('Minimum clearance ' + format(r.clearance, 1) + ' m');
    if (Number.isFinite(minimum))
      pieces.push('Minimum observer height ' + format(minimum, 1) + ' m');
    if (Number.isFinite(extraM) && extraM > 0)
      pieces.push('Additional height needed ' + format(extraM, 1) + ' m');
    if (!Number.isFinite(minimum) && Number.isFinite(r.lowerBoundM) && r.lowerBoundM > eye)
      pieces.push(
        'Terrain data is incomplete. Raise the observer by at least ' +
          format(r.lowerBoundM - eye, 1) +
          ' m',
      );
    if (r.heightMode && r.cell)
      pieces.push(
        'Additional height in the 50 m cell ' +
          (Number.isFinite(r.cell.additionalObserverHeightM)
            ? format(r.cell.additionalObserverHeightM, 1) + ' m'
            : 'unknown'),
      );
    get('.profile-obstacles').textContent = pieces.join(' · ');
    let model =
      'Observer ' +
      format(eye, 1) +
      ' m · Target ' +
      format(r.targetHeightM ?? 0, 1) +
      ' m above ground.';
    if (r.points?.length)
      model +=
        ' The profile uses the selected curvature model. The map trace shows the path along the ground.';
    const firstDistance = meshBlocker?.distanceM ?? (r.status === 0 ? r.firstBlocker?.distance : null);
    if (nearbyBlocker(firstDistance, r.observerResolutionM)) {
      model += ' The ' + (meshBlocker ? '3D terrain' : 'terrain profile') + ' intersects the line of sight at '
        + format(firstDistance, 1) + ' m. Each elevation cell here is about ' + format(r.observerResolutionM, 1)
        + ' m across. The obstruction is on the slope immediately ahead.';
    } else if (meshBlocker)
      model += ' The rendered slope blocks the view at ' + distance(meshBlocker.distanceM)
        + '. The profile line uses the sampled elevation data.';
    if (r.nearTerrainStatus === 'coarse' || r.nearTerrainStatus === 'partial')
      model += ' Detailed elevation is incomplete near the observer. The profile uses the 50 m grid where needed.';
    else if (r.nativeTerrainStatus === 'coarse' || r.nativeTerrainStatus === 'partial')
      model += ' Detailed elevation is incomplete along this route. The overview grid fills gaps.';
    if (nearSummit(target, r))
      model += ' The modeled obstruction lies within ' + distance(r.distance - r.firstBlocker.distance)
        + ' of the summit. Small changes in summit position or terrain detail can change what you see on the skyline.';
    if (r.catalog) {
      const peak = r.catalog;
      model +=
        ' Catalog elevation ' +
        format(peak.catalogElevationM) +
        ' m · Terrain model elevation ' +
        format(r.elevation) +
        ' m.' +
        (peak.sensitiveToElevation ? ' The difference in elevation could change visibility.' : '');
    }
    get('.profile-model').textContent = model;
    compare.disabled = !Number.isFinite(minimum) || plot.hidden;
    apply.hidden = !(onTry && extraM > 0 && Number.isFinite(minimum));
    if (!apply.hidden)
      apply.textContent = 'Try ' + format(Math.ceil((minimum - 1e-9) * 10) / 10, 1) + ' m';
    save.hidden = !(
      onSave &&
      Number.isFinite(target?.lat) &&
      Number.isFinite(target?.lon) &&
      Number.isFinite(r.distance) &&
      r.distance >= 0.1 &&
      r.status !== 2
    );
  }
  function leavePlot() {
    if (selected !== null) {
      selected = null;
      onHover?.(null);
      queueDraw();
    }
    cursorBadge.hidden = true;
  }
  function sampleLabel(p) {
    return (
      distance(p.distance) +
      ' · Terrain ' +
      (Number.isFinite(p.elevation) ? format(p.elevation) + ' m' : 'no data')
    );
  }
  function cursor(index) {
    if (!data?.points?.length) return;
    index = Math.max(0, Math.min(data.points.length - 1, index));
    if (selected === index) return;
    selected = index;
    const p = data.points[selected],
      label = sampleLabel(p);
    cursorBadge.hidden = false;
    cursorBadge.textContent = label;
    canvas.setAttribute('aria-valuenow', String(index));
    canvas.setAttribute('aria-valuetext', label);
    onHover?.(p);
    queueDraw();
  }
  function scaleFor(lo, hi, D) {
    if (!axis) axis = {lo: NaN, hi: NaN, D: NaN};
    axis.D = D;
    const span = Math.max(12, hi - lo),
      q = stepAbove(span / 5);
    if (
      !Number.isFinite(axis.lo) ||
      lo < axis.lo ||
      hi > axis.hi ||
      span < (axis.hi - axis.lo) * 0.4
    ) {
      axis.lo = Math.floor((lo - span * 0.035) / q) * q;
      axis.hi = Math.ceil((hi + span * 0.035) / q) * q;
    }
    return axis;
  }
  const chartStyle = getComputedStyle(canvas);
  const color = (property, fallback) => chartStyle.getPropertyValue(property).trim() || fallback;
  const colors = {
    text: color('--profile-text', '#4d6458'),
    grid: color('--profile-grid', '#dce5d9'),
    fill: color('--profile-fill', 'rgba(123,164,132,.25)'),
    terrain: color('--profile-terrain', '#325e4c'),
    sight: color('--profile-sight', '#9d532e'),
    obstruction: color('--profile-obstruction', '#a75232'),
  };
  function draw() {
    if (panel.hidden || collapsed || plot.hidden || !data?.points?.length || !canvas.clientWidth)
      return;
    const samples = data.points,
      w = canvas.clientWidth,
      h = canvas.clientHeight,
      dpr = Math.min(2, devicePixelRatio || 1);
    const pw = Math.round(w * dpr),
      ph = Math.round(h * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const withMin = !extra.hidden && compare.checked && !compare.disabled;
    let min = Infinity,
      max = -Infinity;
    for (const p of samples) {
      for (const val of [p.corrected, p.sightline, withMin ? p.minimumSightline : null])
        if (Number.isFinite(val)) {
          min = Math.min(min, val);
          max = Math.max(max, val);
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const a = scaleFor(min, max, Math.max(1, samples.at(-1).distance));
    c.font = '11px "DM Sans", system-ui';
    const levels = h < 100 ? [a.lo, a.hi] : [a.lo, (a.lo + a.hi) / 2, a.hi];
    const labelWidth = Math.max(...levels.map((z) => c.measureText(format(z) + ' m').width));
    const top = 8,
      bottom = h - 18,
      left = Math.ceil(labelWidth) + 8,
      right = w - 13;
    const x = (p) => left + (p.distance / a.D) * (right - left),
      y = (z) => bottom - ((z - a.lo) / (a.hi - a.lo)) * (bottom - top);
    layout = {left, right, D: a.D};
    c.textBaseline = 'middle';
    c.lineWidth = 1;
    c.fillStyle = colors.text;
    c.setLineDash([]);
    for (const z of levels) {
      c.textAlign = 'right';
      c.fillText(format(z) + ' m', left - 5, y(z));
      c.strokeStyle = colors.grid;
      c.beginPath();
      c.moveTo(left, y(z));
      c.lineTo(right, y(z));
      c.stroke();
    }
    c.textAlign = 'left';
    c.fillText('0 m', left, h - 6);
    c.textAlign = 'right';
    c.fillText(distance(a.D), right, h - 6);
    c.fillStyle = colors.fill;
    c.beginPath();
    let last = null;
    for (const p of samples) {
      if (!Number.isFinite(p.corrected)) {
        if (last) {
          c.lineTo(x(last), bottom);
          c.closePath();
          last = null;
        }
        continue;
      }
      if (!last) c.moveTo(x(p), bottom);
      c.lineTo(x(p), y(p.corrected));
      last = p;
    }
    if (last) {
      c.lineTo(x(last), bottom);
      c.closePath();
    }
    c.fill();
    function line(key, color, dash, width) {
      c.setLineDash(dash);
      c.lineWidth = width;
      c.strokeStyle = color;
      c.beginPath();
      let run = false;
      for (const p of samples) {
        if (!Number.isFinite(p[key])) {
          run = false;
          continue;
        }
        if (run) c.lineTo(x(p), y(p[key]));
        else c.moveTo(x(p), y(p[key]));
        run = true;
      }
      c.stroke();
      c.setLineDash([]);
    }
    line('corrected', colors.terrain, [], 1.9);
    line('sightline', colors.sight, [5, 3], 1.6);
    if (withMin) line('minimumSightline', '#385c87', [2, 3], 1.6);
    function dot(p, key, color, shape) {
      if (!p || !Number.isFinite(p[key])) return;
      const px = x(p),
        py = y(p[key]);
      c.beginPath();
      c.fillStyle = color;
      c.strokeStyle = '#fffff8';
      c.lineWidth = 1;
      if (shape === 'diamond') {
        c.moveTo(px, py - 4);
        c.lineTo(px + 4, py);
        c.lineTo(px, py + 4);
        c.lineTo(px - 4, py);
        c.closePath();
      } else if (shape === 'square') c.rect(px - 3, py - 3, 6, 6);
      else c.arc(px, py, 2.7, 0, 2 * Math.PI);
      c.fill();
      c.stroke();
    }
    dot(samples.at(-1), 'sightline', colors.sight, 'circle');
    if (data.status === 0) {
      if (!extra.hidden) dot(samples[data.blockerIndex], 'corrected', '#385c87', 'square');
      dot(samples[data.firstIntersectionIndex], 'corrected', colors.obstruction, 'diamond');
    }
    if (selected !== null) {
      const p = samples[selected];
      c.strokeStyle = '#687f72';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x(p), top);
      c.lineTo(x(p), bottom);
      c.stroke();
      dot(p, 'corrected', colors.terrain, 'circle');
    }
  }
  function scrub(e) {
    if (!layout || !data?.points?.length) return;
    const at =
      Math.max(
        0,
        Math.min(
          1,
          (e.clientX - canvas.getBoundingClientRect().left - layout.left) /
            (layout.right - layout.left),
        ),
      ) * layout.D;
    let lo = 0,
      hi = data.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data.points[mid].distance < at) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && at - data.points[lo - 1].distance < data.points[lo].distance - at) lo--;
    cursor(lo);
  }
  canvas.onpointerdown = (e) => {
    if (e.pointerType === 'touch') canvas.setPointerCapture?.(e.pointerId);
    scrub(e);
  };
  canvas.onpointermove = scrub;
  canvas.onpointerleave = leavePlot;
  canvas.onblur = leavePlot;
  canvas.onpointercancel = leavePlot;
  canvas.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || !data?.points?.length)
      return;
    e.preventDefault();
    e.stopPropagation();
    const last = data.points.length - 1,
      i = selected ?? last;
    cursor(e.key === 'Home' ? 0 : e.key === 'End' ? last : i + (e.key === 'ArrowLeft' ? -1 : 1));
  };
  function setCollapsed(value) {
    collapsed = Boolean(value);
    if (collapsed) {
      extra.hidden = true;
      restoreDetails = false;
      details.setAttribute('aria-expanded', 'false');
    }
    syncVisibility();
  }
  fold.onclick = () => setCollapsed(!collapsed);
  lock.onclick = () => onToggleFixed?.(!fixed);
  details.onclick = () => {
    if (collapsed) setCollapsed(false);
    extra.hidden = !extra.hidden;
    details.setAttribute('aria-expanded', String(!extra.hidden));
    if (!extra.hidden) updateDetails();
    syncTrace();
    queueDraw();
  };
  apply.onclick = () => {
    if (Number.isFinite(data?.minimumObserverHeightM))
      onTry?.(Math.ceil((data.minimumObserverHeightM - 1e-9) * 10) / 10);
  };
  save.onclick = () => {
    if (!save.hidden && target) onSave?.(target);
  };
  compare.onchange = queueDraw;
  const observer = new ResizeObserver(queueDraw);
  observer.observe(canvas);
  syncVisibility();
  return {
    eyeView,
    pending,
    loading: pending,
    update,
    setMeshBlocker,
    clear,
    close: clear,
    setFixed,
    setCollapsed,
    setCovered: (value) => {
      covered = Boolean(value);
      syncVisibility();
    },
    target: () => target,
    isOpen: () => !panel.hidden,
  };
}
export default {attach};
