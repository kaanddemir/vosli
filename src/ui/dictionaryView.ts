/**
 * How the Dictionary list is shown while memorizing: which side comes first, and whether the other side is
 * covered. A way of looking, not a setting or learning data: it lasts for this tab, through moving between
 * screens and reloading, and is gone when the tab closes. Reset clears it with every other vosli. key.
 */
export type DictionaryDirection = 'de_tr' | 'tr_de';

export interface DictionaryView {
  direction: DictionaryDirection;
  hidden: boolean;
}

export const DICTIONARY_VIEW_KEY = 'vosli.dictionary-view';
export const DEFAULT_DICTIONARY_VIEW: DictionaryView = { direction: 'de_tr', hidden: false };

/** Anything unexpected falls back to the default: German first, every answer shown. */
export function parseDictionaryView(value: unknown): DictionaryView {
  if (typeof value !== 'object' || value === null) return DEFAULT_DICTIONARY_VIEW;
  const { direction, hidden } = value as Record<string, unknown>;
  return { direction: direction === 'tr_de' ? 'tr_de' : 'de_tr', hidden: hidden === true };
}

export function loadDictionaryView(): DictionaryView {
  try {
    const text = sessionStorage.getItem(DICTIONARY_VIEW_KEY);
    return parseDictionaryView(text === null ? null : JSON.parse(text));
  } catch {
    return DEFAULT_DICTIONARY_VIEW;
  }
}

export function saveDictionaryView(view: DictionaryView): void {
  try {
    if (view.direction === DEFAULT_DICTIONARY_VIEW.direction && view.hidden === DEFAULT_DICTIONARY_VIEW.hidden) sessionStorage.removeItem(DICTIONARY_VIEW_KEY);
    else sessionStorage.setItem(DICTIONARY_VIEW_KEY, JSON.stringify(view));
  } catch {
    /* Not remembered, which is fine. */
  }
}
