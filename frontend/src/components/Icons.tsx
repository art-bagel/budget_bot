const s = { width: '100%', height: '100%', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconDashboard() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>;
}


export function IconClock() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
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


export function IconPortfolio() {
  return <svg viewBox="0 0 24 24" {...s}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
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

export function IconCredit() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/><circle cx="17" cy="15" r="1" fill="currentColor" stroke="none"/></svg>;
}


export function IconChevronRight() {
  return <svg viewBox="0 0 24 24" {...s}><path d="m9 18 6-6-6-6"/></svg>;
}


export function IconPlus() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M12 5v14M5 12h14"/></svg>;
}

export function IconArrowRightLeft() {
  return <svg viewBox="0 0 24 24" {...s}><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>;
}

export function IconRefreshCw() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 3v6h-6" />
      <path d="M3 21v-6h6" />
      <path d="M20 9a8 8 0 0 0-13.66-3.66L3 8" />
      <path d="M4 15a8 8 0 0 0 13.66 3.66L21 16" />
    </svg>
  );
}


export function IconTag() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <circle cx="7" cy="7" r="1.25" fill="currentColor" stroke="none"/>
    </svg>
  );
}


export function IconChartPie() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" />
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </svg>
  );
}
