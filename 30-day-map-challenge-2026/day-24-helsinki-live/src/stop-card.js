const symbols = {
  doors: '<path d="M3 4h18v16H3zM10 6 6 8v9l4 1zm4 0 4 2v9l-4 1z"/>',
  at: '<path d="M8 5v14m8-14v14" stroke-width="3.5"/>',
  approaching: '<path d="m5 12 13 0m-6-6 6 6-6 6"/>',
  next: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
};
export const statusIcon = (state) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  symbols[state] +
  '</svg>';
