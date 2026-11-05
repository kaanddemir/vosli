export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

/** Also read by public/theme-boot.js before the app loads. */
export const THEME_STORAGE_KEY = 'vosli.theme';

const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#F7F5F1', dark: '#191919' };

export function parseThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light';
  return preference;
}

const systemDark = () => matchMedia('(prefers-color-scheme: dark)');

export function loadThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function apply(preference: ThemePreference): void {
  const theme = resolveTheme(preference, systemDark().matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be blocked. The choice still applies for this visit.
  }
  apply(preference);
}

/** Applies the saved choice and keeps "System" in step with the operating system while the app is open. */
export function initTheme(): void {
  apply(loadThemePreference());
  systemDark().addEventListener('change', () => apply(loadThemePreference()));
}
