/**
 * The interface language: what the menus, buttons and messages are written in. It is never the language being
 * learned, and nothing about a learner's words, answers or schedules depends on it.
 */
export type Locale = 'tr' | 'en' | 'de';

/** In the order Settings shows them. */
export const LOCALES: readonly Locale[] = ['tr', 'en', 'de'];
export const DEFAULT_LOCALE: Locale = 'en';

/** Also read by public/theme-boot.js, so the page has the right language before the app loads. */
export const LOCALE_STORAGE_KEY = 'vosli.locale';

/** Each name in its own language, so a learner can find theirs whichever one is showing. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { tr: 'Türkçe', en: 'English', de: 'Deutsch' };

/** For the document's lang attribute: the plain language, as index.html and the learner's German words carry it. */
export const DOCUMENT_LANG: Readonly<Record<Locale, string>> = { tr: 'tr', en: 'en', de: 'de' };

/** For Intl number and date formatting. */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US', de: 'de-DE' };

const isLocale = (value: string | null): value is Locale => LOCALES.includes(value as Locale);

/** The language the learner chose, or null if none was saved or the saved value is not a language. */
export function savedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Anything unknown reads as English, the default. A saved tr, en or de is always kept. */
export function loadLocale(): Locale {
  return savedLocale() ?? DEFAULT_LOCALE;
}

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export const currentLocale = (): Locale => current;

/** For interface text placed inside something marked German, which would otherwise be read in a German voice. */
export const interfaceLang = (): string => DOCUMENT_LANG[current];

/** Listeners run in the order they were added: the strings first, then the screens that show them. */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener(locale);
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be blocked. The choice still applies for this visit.
  }
  applyLocale(locale);
}
