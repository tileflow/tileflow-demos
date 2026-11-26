import {intersects, viewport} from './cover.mjs';
import bundledCredits from './world-credit-data.mjs';

const noticeUrl = 'https://api.tileflow.dev/tiles/world/attribution-notice.json';

function validCredit(row) {
  return row && typeof row.exact === 'string' && row.exact.length > 0 &&
    typeof row.href === 'string' && /^https:\/\/[^\s]+$/.test(row.href) &&
    Array.isArray(row.regions) && row.regions.every(box =>
      Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) &&
      box[0] <= box[2] && box[1] <= box[3]);
}

export function attachRegionalCredits(panel) {
  const doc = panel.ownerDocument;
  const list = panel.querySelector('div');
  const summary = panel.querySelector('summary');
  let credits = bundledCredits;
  let displayed = [];
  let activeMap;
  let timer;
  let nextRefresh = 0;
  let fetching = false;
  // Start open for the first region. The user's disclosure choice survives panning and zooming.
  panel.open = true;

  function render() {
    clearTimeout(timer);
    timer = undefined;
    let visible = [];
    if (activeMap) {
      const bounds = activeMap.getBounds();
      const view = viewport([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], 0);
      visible = credits.filter(row => row.regions.some(box => intersects(box, view)));
    }
    if (visible.length === displayed.length &&
        visible.every((row, i) => row.href === displayed[i].href && row.exact === displayed[i].exact)) return;
    const focus = list.contains(doc.activeElement) ? doc.activeElement : null;
    const links = visible.map(row => {
      const link = doc.createElement('a');
      link.href = row.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = row.exact;
      return link;
    });
    list.replaceChildren(...links);
    panel.hidden = !links.length;
    if (focus && links.length) {
      const replacement = links.find(link => link.href === focus.href && link.textContent === focus.textContent);
      (replacement || summary).focus({preventScroll: true});
    }
    displayed = visible;
  }

  async function refreshNotice() {
    if (fetching || Date.now() < nextRefresh) return;
    fetching = true;
    try {
      const response = await fetch(noticeUrl, {credentials: 'omit', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('World attribution notice unavailable');
      const notice = await response.json();
      if (notice.kind !== 'tileflow-world-attribution-notice' ||
          !Array.isArray(notice.regionalObligations) || !notice.regionalObligations.every(validCredit)) {
        throw Error('Invalid World attribution notice');
      }
      credits = notice.regionalObligations;
      nextRefresh = Date.now() + 300000;
      if (activeMap) render();
    } catch {
      // Keep the last complete notice on screen while connectivity recovers.
      nextRefresh = Date.now() + 60000;
    } finally {
      fetching = false;
    }
  }

  function moving() {
    if (!timer) timer = setTimeout(render, 125);
  }
  function settled() {
    render();
    refreshNotice();
  }
  return function useWorldMap(map) {
    if (map === activeMap) return;
    activeMap?.off('move', moving);
    activeMap?.off('moveend', settled);
    activeMap?.off('resize', settled);
    activeMap = map;
    render();
    if (map) {
      map.on('move', moving);
      map.on('moveend', settled);
      map.on('resize', settled);
      refreshNotice();
    }
  };
}
