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

export function IconShield() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>;
}

export function IconCoin() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5a2.5 2.5 0 1 1 4.5 1.5c-1 1-2.5 1-2.5 2.5M12 16.5v.01"/></svg>;
}

export function IconFamily() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 19a5 5 0 0 1 10 0M11 19a5 5 0 0 1 10 0"/></svg>;
}

export function IconUser() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="9" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>;
}

export function IconPaint() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M19 7.5a4 4 0 0 1-4 4H9.5a2 2 0 0 0-2 2V17a2 2 0 1 1-4 0v-1a8 8 0 0 1 8-8h3.5A4 4 0 0 1 19 4z"/></svg>;
}

export function IconInfo() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>;
}

export function IconTrendUp() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M4 16l5-5 4 4 7-8M14 7h6v6"/></svg>;
}

export function IconPlug() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0z M12 16v4"/></svg>;
}

export function IconKey() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="8" cy="14" r="4"/><path d="m11 11 8-8M16 6l3 3M14 8l3 3"/></svg>;
}

export function IconDatabase() {
  return <svg viewBox="0 0 24 24" {...s}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>;
}

export function IconDownload() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"/></svg>;
}

export function IconWarn() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M12 4 3 19h18z M12 10v4 M12 17v.01"/></svg>;
}

export function IconCheck() {
  return <svg viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="m4 12 5 5 11-11"/></svg>;
}

export function IconMail() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></svg>;
}

export function IconTrash() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>;
}

export function IconThemeLight() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
      <circle cx="12" cy="12" r="4.2" />
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M12 2.5v2.4" />
        <path d="M12 19.1v2.4" />
        <path d="M2.5 12h2.4" />
        <path d="M19.1 12h2.4" />
        <path d="m5.2 5.2 1.7 1.7" />
        <path d="m17.1 17.1 1.7 1.7" />
        <path d="m18.8 5.2-1.7 1.7" />
        <path d="m6.9 17.1-1.7 1.7" />
      </g>
    </svg>
  );
}

export function IconThemeDark() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
      <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a.6.6 0 0 1 .77.74A6.8 6.8 0 0 0 19.76 13.43a.6.6 0 0 1 .74.77z" />
    </svg>
  );
}

export function IconThemeAuto() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}
