import {Popup} from 'maplibre-gl';
import {platformInfo} from './stop-call.js';

const symbols = {
  doors: '<path d="M3 4h18v16H3zM10 6 6 8v9l4 1zm4 0 4 2v9l-4 1z"/>',
  at: '<path d="M8 5v14m8-14v14" stroke-width="3.5"/>',
  approaching: '<path d="m5 12 13 0m-6-6 6 6-6 6"/>',
  next: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
};
const states = {doors: 'Doors open', at: 'At stop', approaching: 'Approaching', next: 'Next stop'};
export const statusIcon = (state) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  symbols[state] +
  '</svg>';

export function createStopCard(map, stops, openStop) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'platform-card';
  const heading = document.createElement('span'),
    title = document.createElement('strong');
  const status = document.createElement('span'),
    footer = document.createElement('span');
  heading.className = 'platform-card-heading';
  status.className = 'platform-card-state';
  footer.className = 'platform-card-footer';
  heading.append(title, status);
  button.append(heading, footer);
  const popup = new Popup({
    className: 'platform-popup',
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    offset: {
      bottom: [0, -35],
      'bottom-left': [5, -30],
      'bottom-right': [-5, -30],
      top: [0, 7],
      'top-left': [5, 5],
      'top-right': [-5, 5],
      left: [17, -12],
      right: [-17, -12],
    },
    maxWidth: '255px',
  }).setDOMContent(button);
  let call;
  button.onclick = (e) => {
    e.stopPropagation();
    if (call) openStop(call.id);
  };
  function visibility() {
    if (!call || map.getZoom() < 15.3) {
      if (popup.isOpen()) popup.remove();
    } else if (!popup.isOpen()) popup.addTo(map);
  }
  map.on('zoom', visibility);
  return {
    update(next, amenities) {
      call = next;
      if (call) {
        const stop = stops[call.id];
        title.textContent = (call.line ? call.line + ' · ' : '') + stop.name;
        status.hidden = !call.state;
        if (call.state) status.innerHTML = statusIcon(call.state) + states[call.state];
        const facts = platformInfo(stop, amenities[call.id]);
        if (!facts.length) facts.push(stop.code);
        if (call.next) facts.push('Next: ' + call.next);
        footer.textContent = facts.join(' · ');
        button.dataset.state = call.state || 'stop';
        button.setAttribute(
          'aria-label',
          [title.textContent, states[call.state], footer.textContent, 'View departures']
            .filter(Boolean)
            .join('. '),
        );
        popup.setLngLat(stop.coordinate);
      }
      visibility();
    },
    nearBus(coordinate) {
      return (
        call && popup.isOpen() && map.project(coordinate).dist(map.project(stops[call.id].coordinate)) < 120
      );
    },
  };
}
