import { de } from './de';
import { en } from './en';
import { applyLocale, currentLocale, DOCUMENT_LANG, loadLocale, onLocaleChange, type Locale } from './locale';
import { tr } from './tr';

/** Every interface language has exactly this shape: TypeScript rejects a missing, extra or mistyped key. */
export type Strings = typeof tr;

const STRINGS: Readonly<Record<Locale, Strings>> = { tr, en, de };

/**
 * All interface text. A live binding: it points at the current language, and screens read it while rendering,
 * so after a change the next render shows the new language without a reload.
 */
export let t: Strings = STRINGS[currentLocale()];

function applyToDocument(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = DOCUMENT_LANG[locale];
  document.title = STRINGS[locale].documentTitle;
}

onLocaleChange((locale) => {
  t = STRINGS[locale];
  applyToDocument(locale);
});

/** Applies the saved choice before the first render. */
export function initLocale(): void {
  applyLocale(loadLocale());
  applyToDocument(currentLocale());
}
