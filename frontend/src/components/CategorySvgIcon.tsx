const s = {
  viewBox: '0 0 24 24',
  width: '100%',
  height: '100%',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const CATEGORY_SVG_ICONS: Record<string, () => JSX.Element> = {
  cart:      () => <svg {...s}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
  basket:    () => <svg {...s}><path d="M6 2l-4 6h20l-4-6"/><rect x="2" y="8" width="20" height="13" rx="2"/><path d="M9 8v3m6-3v3"/></svg>,
  home:      () => <svg {...s}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  building:  () => <svg {...s}><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><path d="M9 7h1m5 0h-1M9 10h1m5 0h-1"/></svg>,
  key:       () => <svg {...s}><circle cx="8" cy="15" r="4"/><path d="M15 8l6 6m-4-2l2 2m-4-4l2 2"/></svg>,
  wrench:    () => <svg {...s}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  car:       () => <svg {...s}><path d="M5 17H3a1 1 0 01-1-1v-5l2.5-6h13L20 11v5a1 1 0 01-1 1h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>,
  plane:     () => <svg {...s}><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>,
  bike:      () => <svg {...s}><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 100-2 1 1 0 000 2zm-3 11.5L9 11l3-1.5 3 5 2.5-5h3"/></svg>,
  train:     () => <svg {...s}><rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 2m10-2l2 2M8 19h8"/><circle cx="8.5" cy="14.5" r="1.5"/><circle cx="15.5" cy="14.5" r="1.5"/></svg>,
  heart:     () => <svg {...s}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
  pill:      () => <svg {...s}><path d="M10.5 20.5L3.5 13.5a5 5 0 017.07-7.07l7 7a5 5 0 01-7.07 7.07z"/><line x1="8.5" y1="11.5" x2="15.5" y2="11.5"/></svg>,
  dumbbell:  () => <svg {...s}><path d="M6.5 6.5h1m9 9h1m-11 0h-1m11-9h1"/><line x1="3" y1="12" x2="21" y2="12"/><rect x="5.5" y="5.5" width="3" height="13" rx="1"/><rect x="15.5" y="5.5" width="3" height="13" rx="1"/></svg>,
  sparkle:   () => <svg {...s}><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>,
  film:      () => <svg {...s}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5m10 0h5M2 15h5m10 0h5"/></svg>,
  music:     () => <svg {...s}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  book:      () => <svg {...s}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
  gamepad:   () => <svg {...s}><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18.5" cy="13" r="1" fill="currentColor" stroke="none"/></svg>,
  wallet:    () => <svg {...s}><path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/><path d="M16 12a2 2 0 110 4 2 2 0 010-4zm0 0h6"/></svg>,
  chart:     () => <svg {...s}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  scissors:  () => <svg {...s}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>,
  phone:     () => <svg {...s}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>,
  globe:     () => <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  paw:       () => <svg {...s}><circle cx="12" cy="13" r="4"/><circle cx="5" cy="9" r="2"/><circle cx="19" cy="9" r="2"/><circle cx="8.5" cy="5" r="2"/><circle cx="15.5" cy="5" r="2"/></svg>,
  utensils:  () => <svg {...s}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><line x1="7" y1="2" x2="7" y2="22"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
  coffee:    () => <svg {...s}><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>,
  baby:      () => <svg {...s}><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0112 0v2"/><path d="M10 8h.01M14 8h.01"/></svg>,
  star:      () => <svg {...s}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  gift:      () => <svg {...s}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
  sun:       () => <svg {...s}><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  leaf:      () => <svg {...s}><path d="M17 8C8 10 5.9 16.17 3.82 22"/><path d="M17 8c0 10-11 14-11 14"/><path d="M17 8c2-2 3-4 3-8-4 0-6 1-8 3"/></svg>,
};

export const CATEGORY_SVG_ICON_GROUPS: { label: string; codes: string[] }[] = [
  { label: 'Покупки', codes: ['cart', 'basket', 'utensils', 'coffee', 'gift'] },
  { label: 'Жильё', codes: ['home', 'building', 'key', 'wrench', 'leaf'] },
  { label: 'Транспорт', codes: ['car', 'plane', 'bike', 'train'] },
  { label: 'Здоровье', codes: ['heart', 'pill', 'dumbbell', 'sparkle'] },
  { label: 'Досуг', codes: ['film', 'music', 'book', 'gamepad', 'scissors'] },
  { label: 'Финансы', codes: ['wallet', 'chart', 'star', 'sun'] },
  { label: 'Прочее', codes: ['phone', 'globe', 'paw', 'baby'] },
];

export function CategorySvgIcon({ code, className }: { code: string; className?: string }) {
  const Icon = CATEGORY_SVG_ICONS[code];
  if (!Icon) return null;
  return <span className={className} style={{ display: 'inline-flex', width: '100%', height: '100%' }}><Icon /></span>;
}
