import type { Article } from './identity';

/**
 * The offline dictionary, read straight from its text files. Lines stay in one string and are found
 * by binary search, so even hundreds of thousands of entries create almost no objects in memory.
 *
 * lemmas.txt: word TAB tags. The first tag holds part-of-speech letters and may be empty.
 *   S noun, V verb, A adjective, D adverb, N name, P phrase, K abbreviation, Z number, O other words.
 *   g...   genders: m, f, n, with ? after one only rare or dated senses use
 *   pl     plural only          ps  the plural looks the same as the singular
 *   x      a spelling no longer valid          c  common enough to suggest
 *   ~word  an accepted variant spelling        tm=a|b  Turkish meanings of the masculine (or tf, tn) senses
 * forms.txt: inflected form TAB lemma|^lemma, where ^ marks a nominative plural
 */
export interface LemmaEntry {
  word: string;
  pos: string;
  genders: { article: Article; rare: boolean }[];
  pluralOnly: boolean;
  samePlural: boolean;
  old: boolean;
  common: boolean;
  variants: string[];
  turkish: Partial<Record<Article, string[]>>;
}

export interface Dictionary {
  lookup(word: string): LemmaEntry | null;
  formsOf(word: string): string[];
  /** The nouns this word is the nominative plural of: Bücher gives Buch, but Haus does not give Hau. */
  pluralOf(word: string): string[];
}

const ARTICLE_OF: Readonly<Record<string, Article>> = { m: 'der', f: 'die', n: 'das' };
const TAB = 9;
const NEWLINE = '\n';

/** Finds lines by their text before the tab. The file must be sorted by UTF-16 code unit. */
export class SortedLines {
  private readonly starts: Uint32Array;

  constructor(private readonly text: string) {
    let count = 0;
    for (let at = text.indexOf(NEWLINE); at !== -1; at = text.indexOf(NEWLINE, at + 1)) count++;
    const starts = new Uint32Array(count + 1);
    let line = 1;
    for (let at = text.indexOf(NEWLINE); at !== -1; at = text.indexOf(NEWLINE, at + 1)) starts[line++] = at + 1;
    this.starts = text.endsWith(NEWLINE) ? starts.subarray(0, count) : starts;
  }

  get size(): number {
    return this.starts.length;
  }

  private compare(start: number, key: string): number {
    const { text } = this;
    for (let i = 0; i < key.length; i++) {
      const code = text.charCodeAt(start + i);
      if (code === TAB) return -1;
      const diff = code - key.charCodeAt(i);
      if (diff !== 0) return diff;
    }
    return text.charCodeAt(start + key.length) === TAB ? 0 : 1;
  }

  /** The text after the tab, or null when the key is not there. */
  get(key: string): string | null {
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const start = this.starts[middle]!;
      const order = this.compare(start, key);
      if (order === 0) {
        const value = start + key.length + 1;
        const end = this.text.indexOf(NEWLINE, value);
        return this.text.slice(value, end === -1 ? undefined : end);
      }
      if (order < 0) low = middle + 1;
      else high = middle - 1;
    }
    return null;
  }
}

function parseEntry(word: string, line: string): LemmaEntry {
  const entry: LemmaEntry = { word, pos: '', genders: [], pluralOnly: false, samePlural: false, old: false, common: false, variants: [], turkish: {} };
  const [pos, ...tags] = line.split(' ');
  entry.pos = pos ?? '';
  for (const tag of tags) {
    if (tag === 'pl') entry.pluralOnly = true;
    else if (tag === 'ps') entry.samePlural = true;
    else if (tag === 'x') entry.old = true;
    else if (tag === 'c') entry.common = true;
    else if (tag.startsWith('~')) entry.variants.push(tag.slice(1));
    else if (/^t[mfn]=/u.test(tag)) entry.turkish[ARTICLE_OF[tag[1]!]!] = tag.slice(3).split('|').map((text) => text.replaceAll('_', ' '));
    else if (tag.startsWith('g')) {
      for (const match of tag.slice(1).matchAll(/([mfn])(\?)?/gu)) entry.genders.push({ article: ARTICLE_OF[match[1]!]!, rare: match[2] === '?' });
    }
  }
  return entry;
}

export function createDictionary(lemmasText: string, formsText: string): Dictionary {
  const lemmas = new SortedLines(lemmasText);
  const forms = new SortedLines(formsText);
  return {
    lookup(word) {
      const line = lemmas.get(word);
      return line === null ? null : parseEntry(word, line);
    },
    formsOf(word) {
      return forms.get(word)?.split('|').map((link) => link.replace('^', '')) ?? [];
    },
    pluralOf(word) {
      return forms.get(word)?.split('|').filter((link) => link.startsWith('^')).map((link) => link.slice(1)) ?? [];
    },
  };
}
