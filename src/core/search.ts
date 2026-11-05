const FOLDS: Record<string, string> = { ß: 'ss', ı: 'i' };

/**
 * Lets a learner search without special letters: fuss finds Fuß, ispanak finds ıspanak, cicek finds çiçek.
 * Turkish İ is handled by removing its combining dot after lowercasing.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[ßı]/g, (letter) => FOLDS[letter]!)
    .replace(/\s+/g, ' ')
    .trim();
}

const SPELLED_OUT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Fuer finds für: the usual way to type German on a keyboard without umlauts. */
const spelledOut = (value: string): string => foldForSearch(value.normalize('NFC').toLowerCase().replace(/[äöüß]/g, (letter) => SPELLED_OUT[letter]!));

interface Searchable {
  lemma: string;
  article: string | null;
  plural: string | null;
  meanings: readonly { text: string }[];
}

/** 0 when the German word starts with the query, 1 for any other match, null for no match. */
function searchRank(word: Searchable, foldedQuery: string): 0 | 1 | null {
  const lemma = foldForSearch(word.lemma);
  if (lemma.startsWith(foldedQuery)) return 0;
  if (spelledOut(word.lemma).startsWith(foldedQuery)) return 0;
  const others = [word.article ? `${word.article} ${word.lemma}` : '', word.plural ?? '', ...word.meanings.map((meaning) => meaning.text)];
  return lemma.includes(foldedQuery) || spelledOut(word.lemma).includes(foldedQuery) || others.some((text) => foldForSearch(text).includes(foldedQuery)) ? 1 : null;
}

/** Keeps matches in their existing order, with words that start with the query first. */
export function searchWords<T extends Searchable>(words: readonly T[], query: string): readonly T[] {
  const folded = foldForSearch(query);
  if (!folded) return words;
  const first: T[] = [];
  const rest: T[] = [];
  for (const word of words) {
    const rank = searchRank(word, folded);
    if (rank === 0) first.push(word);
    else if (rank === 1) rest.push(word);
  }
  return [...first, ...rest];
}
