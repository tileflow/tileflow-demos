const wrap=(body:string)=>`<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons:Record<string,string>={
bread:wrap('<path fill="#edbd6d" d="M5 10c-2 6 1 12 8 14 7 2 13-2 14-8l-5-1-3 4-5-1-3-6Z"/><path d="m9 12-2 5m8-2-2 7m8-6-2 6"/><path d="m5 10-3 4m25 2 3-3"/>'),
coffee:wrap('<path fill="#fff6dc" d="M6 12h17v8a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7Z"/><path d="M23 13h2a4 4 0 1 1-2 8M5 29h20M11 8c-3-3 3-3 0-6m7 6c-3-3 3-3 0-6"/>'),
flowers:wrap('<path d="m16 18 1 12m0-5-7-3m7 1 6-4"/><path fill="#eaa8c6" d="M16 5c6-7 9 0 7 3 9 0 8 8 3 9 3 8-5 10-9 4-4 7-12 2-8-3-8-1-8-9 0-10-2-6 5-9 7-3Z"/><circle cx="17" cy="13" r="4" fill="#f3d27f"/>'),
linen:wrap('<rect x="4" y="17" width="24" height="7" rx="3" fill="#ddd4f2"/><rect x="6" y="10" width="21" height="7" rx="3" fill="#f8f3ff"/><path d="M9 13h13m-13 8h14M21 5l3-3m-8 3V2"/>'),
food:wrap('<path d="M3 17h26M5 18a11 11 0 0 0 22 0M11 29h10M8 11c-4-4 3-4 0-8m8 8c-4-4 3-4 0-8m8 8c-4-4 3-4 0-8"/><path fill="#efb78d" d="M5 18h22a11 11 0 0 1-22 0Z"/>'),
paw:wrap('<g fill="currentColor" stroke="none"><ellipse cx="9" cy="9" rx="3.2" ry="4.2" transform="rotate(-22 9 9)"/><ellipse cx="18" cy="6" rx="3.2" ry="4.2"/><ellipse cx="25" cy="12" rx="3.2" ry="4.2"/><ellipse cx="4" cy="17" rx="2.7" ry="3.7"/><path d="M10 19c4-7 9-6 12 1 5 10-2 11-7 8C6 31 3 25 10 19Z"/></g>'),
heart:wrap('<path stroke="none" fill="#df7c89" d="M16 28C-8 13 4-1 16 9 28-1 40 13 16 28Z"/>'),
arrow:wrap('<path d="M6 16h20m-7-7 7 7-7 7"/>'),
watch:wrap('<circle cx="16" cy="18" r="10"/><path d="M16 8V4m-3 0h6m5 5 2-2m-10 5v7l4 2"/>'),
jump:wrap('<path d="M16 25V6m-7 7 7-7 7 7M7 27h18"/>'),
sprint:wrap('<path d="m6 8 8 8-8 8m12-16 8 8-8 8"/>'),
rest:wrap('<path d="M16 26S5 20 5 12a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 8-11 14-11 14Z"/>'),
target:wrap('<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3"/><path d="M16 2v5m0 18v5M2 16h5m18 0h5"/>'),
play:wrap('<path fill="currentColor" stroke="none" d="m10 6 16 10-16 10Z"/>'),
};
