/** Also read by public/theme-boot.js, so a collapsed menu is already narrow on the first paint. */
const KEY = 'vosli.sidebar';

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(KEY, 'collapsed');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage may be blocked. The choice still applies for this visit.
  }
}

/** The stylesheet decides by this, and only from tablet width up: phones keep their tab bar. */
export function applySidebarCollapsed(collapsed: boolean): void {
  if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
}
