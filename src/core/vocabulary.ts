import { identityKey, normalizeText, type Article } from './identity';
import { foldForSearch } from './search';

const LEMMA_MAX = 120;
const MEANING_MAX = 300;
const PLURAL_MAX = 120;

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'other';

export const ARTICLES: readonly Article[] = ['der', 'die', 'das'];

/** What a person or a parser supplies for one vocabulary entry. */
export interface WordDraft {
  lemma: string;
  article: Article | null;
  meanings: string[];
  plural: string | null;
}

/** null means no article; undefined means the text is not an article at all. */
export function parseArticle(value: string): Article | null | undefined {
  const cleaned = normalizeText(value).toLocaleLowerCase('de');
  if (cleaned === '' || cleaned === '-' || cleaned === '–' || cleaned === '—') return null;
  return ARTICLES.find((article) => article === cleaned);
}

const startsUppercase = (text: string) => {
  const first = text.charAt(0);
  return first !== first.toLocaleLowerCase('de');
};

/**
 * Splits der Apfel and Apfel, der into article and word. An article is only recognized before a
 * capitalized word of at most two parts, so Das ist gut and die deutsche Sprache stay whole.
 */
export function splitArticle(text: string): { article: Article | null; lemma: string } {
  const value = normalizeText(text);
  const after = /^(.+?),\s*(der|die|das)$/iu.exec(value);
  if (after) return { article: after[2]!.toLowerCase() as Article, lemma: after[1]! };
  const before = /^(der|die|das)\s+(.+)$/iu.exec(value);
  if (before && startsUppercase(before[2]!) && before[2]!.split(' ').length <= 2) {
    return { article: before[1]!.toLowerCase() as Article, lemma: before[2]! };
  }
  return { article: null, lemma: value };
}

/** Compares meanings the Turkish way: kir (dirt) and kır (countryside) stay different. */
export const meaningKey = (text: string): string => normalizeText(text).toLocaleLowerCase('tr');

/** Commas and semicolons separate meanings, except inside parentheses: sabah (gün, vakit) is one. */
export function splitMeanings(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if ((char === ',' || char === ';') && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  const seen = new Set<string>();
  const meanings: string[] = [];
  for (const part of parts) {
    const meaning = normalizeText(part);
    const key = meaningKey(meaning);
    if (meaning && !seen.has(key)) {
      seen.add(key);
      meanings.push(meaning);
    }
  }
  return meanings;
}

/** An article proves a noun, and a known part of speech stays. Nothing else is guessed from spelling. */
export function posFor(lemma: string, article: Article | null, previous: PartOfSpeech | null = null): PartOfSpeech {
  if (article) return 'noun';
  if (previous && previous !== 'noun') return previous;
  return lemma.includes(' ') ? 'phrase' : 'other';
}

export function searchTokensFor(draft: WordDraft): string[] {
  const text = [draft.lemma, draft.plural ?? '', ...draft.meanings].join(' ');
  return [...new Set(foldForSearch(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

interface WordFields {
  identityKey: string;
  lemma: string;
  article: Article | null;
  pos: PartOfSpeech;
  plural: string | null;
  senseTag: string | null;
  searchTokens: string[];
}

/** Everything derived from the draft. Identity fields of the stored record are never set here. */
export function fieldsFor(draft: WordDraft, senseTag: string | null, previousPos: PartOfSpeech | null = null): WordFields {
  const lemma = normalizeText(draft.lemma);
  const clean = { ...draft, lemma };
  return {
    identityKey: identityKey(lemma, draft.article, senseTag),
    lemma,
    article: draft.article,
    pos: posFor(lemma, draft.article, previousPos),
    plural: draft.plural ? normalizeText(draft.plural) || null : null,
    senseTag,
    searchTokens: searchTokensFor(clean),
  };
}

export type DraftError = 'german_missing' | 'turkish_missing' | 'article_invalid' | 'too_long' | 'unreadable';

/** Control and private-use characters, or a replacement mark: text a source failed to decode. */
const UNREADABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/u;
export const hasUnreadableText = (text: string): boolean => UNREADABLE.test(text);

export function validateFields(german: string, article: string, turkish: string, plural = ''): DraftError[] {
  const errors: DraftError[] = [];
  if (!normalizeText(german)) errors.push('german_missing');
  if (parseArticle(article) === undefined) errors.push('article_invalid');
  if (splitMeanings(turkish).length === 0) errors.push('turkish_missing');
  if (normalizeText(german).length > LEMMA_MAX || normalizeText(turkish).length > MEANING_MAX || normalizeText(plural).length > PLURAL_MAX) errors.push('too_long');
  if ([german, article, turkish, plural].some(hasUnreadableText)) errors.push('unreadable');
  return errors;
}
