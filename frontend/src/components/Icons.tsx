const s = { width: '100%', height: '100%', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconDashboard() {
  return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/></svg>;
}

export function IconOperations() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/></svg>;
}

export function IconExchange() {
  return <svg viewBox="0 0 24 24" {...s}><path d="M7 10l-3 3 3 3"/><path d="M4 13h13"/><path d="M17 14l3-3-3-3"/><path d="M20 11H7"/></svg>;
}

export function IconSettings() {
  return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>;
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
