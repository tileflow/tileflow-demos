import {createTileflowBrandingLink} from '../runtime/tileflow.mjs';
import {attachRegionalCredits} from './world-credits.mjs?v=world-attribution-2';

export function attachMapFooter(container) {
  const doc = container.ownerDocument;
  const links = [...container.querySelectorAll('[data-source]')];
  const useWorldMap = attachRegionalCredits(container.querySelector('#regional-credits'));
  const compact = matchMedia('(max-width: 250px)');
  let mark;
  function fitBrand() {
    const focused = mark && doc.activeElement === mark;
    const next = createTileflowBrandingLink(doc, {compact: compact.matches});
    if (mark) mark.replaceWith(next);
    else container.prepend(next);
    mark = next;
    if (focused) mark.focus({preventScroll: true});
  }
  fitBrand();
  compact.addEventListener('change', fitBrand);

  return function showSources(sources, map) {
    useWorldMap(sources.includes('tileflow') ? map : undefined);
    for (const link of links) {
      const hidden = !sources.includes(link.dataset.source);
      if (link.hidden !== hidden) link.hidden = hidden;
    }
  };
}
