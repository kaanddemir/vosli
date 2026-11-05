import { describe, expect, it } from 'vitest';
import { DEFAULT_DICTIONARY_VIEW, DICTIONARY_VIEW_KEY, parseDictionaryView } from '../src/ui/dictionaryView';

describe('dictionary view', () => {
  it('defaults to German first with answers shown', () => {
    expect(DEFAULT_DICTIONARY_VIEW).toEqual({ direction: 'de_tr', hidden: false });
    expect(parseDictionaryView(null)).toEqual(DEFAULT_DICTIONARY_VIEW);
    expect(parseDictionaryView('tr_de')).toEqual(DEFAULT_DICTIONARY_VIEW);
  });

  it('keeps only known values', () => {
    expect(parseDictionaryView({ direction: 'tr_de', hidden: true })).toEqual({ direction: 'tr_de', hidden: true });
    expect(parseDictionaryView({ direction: 'sideways', hidden: 'yes' })).toEqual(DEFAULT_DICTIONARY_VIEW);
  });

  it('is cleared by reset, which removes every vosli. key', () => {
    expect(DICTIONARY_VIEW_KEY.startsWith('vosli.')).toBe(true);
  });
});
