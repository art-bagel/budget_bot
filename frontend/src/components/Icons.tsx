const s = { width: '100%', height: '100%', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconDashboard() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="15" r="1.5" fill="currentColor" stroke="none"/></svg>;
}

export function IconOperations() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>;
}

export function IconClock() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function IconPlusCircle() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconAnalyticsDonut() {
  // Donut ring at r=6.5, circumference ≈ 40.8
  // Highlighted segment ~25% ≈ 10.2, gap = 30.6
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.3" />
      <circle
        cx="12" cy="12" r="6.5"
        stroke="currentColor" strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="10.2 30.6"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function IconExchange() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>;
}

export function IconPortfolio() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5V3h8v2"/><path d="M3 10h18"/><path d="M8 14h3"/><path d="M13 14h3"/><path d="M8 17h8"/></svg>;
}

export function IconSettings() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
}

export function IconSun() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>;
}

export function IconMoon() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>;
}

export function IconMonitor() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
}

export function IconFamily() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a5 5 0 015-5h2"/><circle cx="17" cy="10" r="2.5"/><path d="M13 21v-1.5a3.5 3.5 0 017 0V21"/></svg>;
}
