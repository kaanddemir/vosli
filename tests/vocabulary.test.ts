import { describe, expect, it } from 'vitest';
import { foldForSearch, searchWords } from '../src/core/search';
import { fieldsFor, meaningKey, parseArticle, posFor, searchTokensFor, splitArticle, splitMeanings, validateFields } from '../src/core/vocabulary';

describe('articles', () => {
  it('splits an article from a noun, in either position and any case', () => {
    expect(splitArticle('der Apfel')).toEqual({ article: 'der', lemma: 'Apfel' });
    expect(splitArticle('Die Bank')).toEqual({ article: 'die', lemma: 'Bank' });
    expect(splitArticle('  das   Essen ')).toEqual({ article: 'das', lemma: 'Essen' });
    expect(splitArticle('Apfel, der')).toEqual({ article: 'der', lemma: 'Apfel' });
  });

  it('does not mistake a sentence or phrase for an article and noun', () => {
    expect(splitArticle('Das ist gut')).toEqual({ article: null, lemma: 'Das ist gut' });
    expect(splitArticle('die deutsche Sprache')).toEqual({ article: null, lemma: 'die deutsche Sprache' });
    expect(splitArticle('Das Auto ist neu')).toEqual({ article: null, lemma: 'Das Auto ist neu' });
    expect(splitArticle('essen')).toEqual({ article: null, lemma: 'essen' });
    expect(splitArticle('der')).toEqual({ article: null, lemma: 'der' });
  });

  it('reads an article cell, and tells an unknown one apart from none', () => {
    expect(parseArticle('DER')).toBe('der');
    expect(parseArticle('')).toBeNull();
    expect(parseArticle('-')).toBeNull();
    expect(parseArticle('den')).toBeUndefined();
  });
});

describe('meanings', () => {
  it('splits on commas and semicolons, but not inside parentheses', () => {
    expect(splitMeanings('elma, armut; ayva')).toEqual(['elma', 'armut', 'ayva']);
    expect(splitMeanings('sabah (gün, vakit), yarın')).toEqual(['sabah (gün, vakit)', 'yarın']);
  });

  it('drops blanks and repeats', () => {
    expect(splitMeanings(' , elma,, Elma ,')).toEqual(['elma']);
    expect(splitMeanings('   ')).toEqual([]);
  });

  it('keeps Turkish dotted and dotless i apart', () => {
    expect(meaningKey('kir')).not.toBe(meaningKey('kır'));
    expect(meaningKey('IŞIK')).toBe(meaningKey('ışık'));
    expect(meaningKey('İNCE')).toBe(meaningKey('ince'));
  });

  it('treats composed and decomposed Unicode as the same text', () => {
    expect(meaningKey('çiçek')).toBe(meaningKey('çiçek'));
    expect(fieldsFor({ lemma: 'Müller', article: null, meanings: ['x'], plural: null }, null).lemma).toBe('Müller');
  });
});

describe('part of speech', () => {
  it('only an article proves a noun, and nothing else is guessed', () => {
    expect(posFor('Apfel', 'der')).toBe('noun');
    expect(posFor('essen', null)).toBe('other');
    expect(posFor('guten Tag', null)).toBe('phrase');
  });

  it('keeps a known part of speech and drops noun when the article goes', () => {
    expect(posFor('laufen', null, 'verb')).toBe('verb');
    expect(posFor('Apfel', null, 'noun')).toBe('other');
  });
});

describe('derived fields', () => {
  it('builds a stable identity that keeps case and article', () => {
    expect(fieldsFor({ lemma: ' Essen ', article: 'das', meanings: ['yemek'], plural: null }, null).identityKey).toBe('Essen|das');
    expect(fieldsFor({ lemma: 'essen', article: null, meanings: ['yemek yemek'], plural: null }, null).identityKey).toBe('essen|');
    expect(fieldsFor({ lemma: 'Bank', article: 'die', meanings: ['bank'], plural: null }, 'bank').identityKey).toBe('Bank|die|bank');
  });

  it('indexes search tokens without special letters', () => {
    expect(searchTokensFor({ lemma: 'Fuß', article: 'der', meanings: ['ayak', 'adım atmak'], plural: 'Füße' })).toEqual(['fuss', 'fusse', 'ayak', 'adim', 'atmak']);
  });
});

describe('validation', () => {
  it('names each problem', () => {
    expect(validateFields('Apfel', 'der', 'elma')).toEqual([]);
    expect(validateFields(' ', '', 'elma')).toEqual(['german_missing']);
    expect(validateFields('Apfel', '', ' , ')).toEqual(['turkish_missing']);
    expect(validateFields('Apfel', 'den', 'elma')).toEqual(['article_invalid']);
    expect(validateFields('x'.repeat(121), '', 'elma')).toEqual(['too_long']);
  });
});

describe('search across languages', () => {
  const word = (lemma: string, meaning: string, article: string | null = null) => ({ lemma, article, plural: null, meanings: [{ text: meaning }] });
  const words = [word('für', 'için'), word('Größe', 'boy', 'die'), word('Eis', 'dondurma', 'das'), word('Çay', 'çay')];
  const found = (query: string) => searchWords(words, query).map((w) => w.lemma);

  it('accepts ae, oe and ue for umlauts', () => {
    expect(found('fuer')).toEqual(['für']);
    expect(found('groesse')).toEqual(['Größe']);
    expect(found('fur')).toEqual(['für']);
  });

  it('matches regardless of case in both languages', () => {
    expect(found('GRÖSSE')).toEqual(['Größe']);
    expect(found('DONDURMA')).toEqual(['Eis']);
    expect(found('İÇİN')).toEqual(['für']);
    expect(found('ICIN')).toEqual(['für']);
  });

  it('matches decomposed input', () => {
    expect(foldForSearch('Größe')).toBe('grosse');
    expect(found('Größe')).toEqual(['Größe']);
  });
});
