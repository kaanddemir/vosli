import { describe, expect, it } from 'vitest';
import { foldForSearch, searchWords } from '../src/core/search';

const word = (lemma: string, meaning: string, article: string | null = null, plural: string | null = null) => ({ lemma, article, plural, meanings: [{ text: meaning }] });
const words = [word('Apfel', 'elma', 'der', 'Äpfel'), word('Fuß', 'ayak', 'der'), word('Spinat', 'ıspanak', 'der'), word('Lernen', 'öğrenmek'), word('Fußball', 'futbol', 'der')];
const lemmas = (query: string) => searchWords(words, query).map((w) => w.lemma);

describe('dictionary search', () => {
  it('ignores German and Turkish special letters', () => {
    expect(foldForSearch('Fuß')).toBe('fuss');
    expect(foldForSearch('ÄPFEL')).toBe('apfel');
    expect(foldForSearch('ıspanak')).toBe('ispanak');
    expect(foldForSearch('İSPANAK')).toBe('ispanak');
    expect(foldForSearch('  öğrenmek ')).toBe('ogrenmek');
  });

  it('finds words from either language, with or without the article', () => {
    expect(lemmas('fuss')).toEqual(['Fuß', 'Fußball']);
    expect(lemmas('ispanak')).toEqual(['Spinat']);
    expect(lemmas('ogren')).toEqual(['Lernen']);
    expect(lemmas('der apfel')).toEqual(['Apfel']);
    expect(lemmas('apfel')).toEqual(['Apfel']);
  });

  it('puts words that start with the query first', () => {
    const list = [word('Bahnhof', 'istasyon'), word('Hof', 'avlu')];
    expect(searchWords(list, 'hof').map((w) => w.lemma)).toEqual(['Hof', 'Bahnhof']);
  });

  it('returns everything for an empty query and nothing for no match', () => {
    expect(lemmas('   ')).toHaveLength(words.length);
    expect(lemmas('zzz')).toEqual([]);
  });
});
