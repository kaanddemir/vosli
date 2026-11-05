import type { Dictionary, LemmaEntry } from './dictionary';
import { stripClosingPunctuation, type Article } from './identity';
import { UNCHECKED, type Issue, type IssueCode, type Suggestion, type Validation, type ValidationNote, type ValidationStatus } from './issues';
import { meaningKey, parseArticle, splitMeanings } from './vocabulary';


const result = (status: ValidationStatus, issues: Issue[] = [], note: ValidationNote | null = null): Validation => ({ status, issues, note });
const issue = (code: IssueCode, suggestions: Suggestion[]): Validation => result('mismatch', [{ code, suggestions }]);


const upperFirst = (word: string) => word.charAt(0).toLocaleUpperCase('de') + word.slice(1);
const lowerFirst = (word: string) => word.charAt(0).toLocaleLowerCase('de') + word.slice(1);
const isCapitalized = (word: string) => word !== lowerFirst(word);

const isNoun = (entry: LemmaEntry) => entry.genders.length > 0 || entry.pluralOnly;
const hasOtherUse = (entry: LemmaEntry) => /[VADOPZ]/u.test(entry.pos);
/** The genders worth offering: rare ones only when there is nothing else. */
function usualArticles(entry: LemmaEntry): Article[] {
  if (entry.pluralOnly) return ['die'];
  const usual = entry.genders.filter((gender) => !gender.rare);
  return (usual.length ? usual : entry.genders).map((gender) => gender.article);
}
const withArticles = (german: string, articles: readonly Article[]): Suggestion[] => articles.map((article) => ({ german, article }));

const LINKS = ['', 's', 'es', 'n', 'en', 'e', 'er', 'ens'];
const MIN_PART = 3;

function isCompoundPart(dict: Dictionary, part: string, depth: number): boolean {
  const known = (word: string) => {
    const entry = dict.lookup(word);
    return entry !== null && !entry.old && (isNoun(entry) || /[VA]/u.test(entry.pos));
  };
  if (known(part) || known(upperFirst(part)) || known(lowerFirst(part)) || known(`${lowerFirst(part)}en`) || known(`${lowerFirst(part)}n`)) return true;
  return depth > 0 && compoundHead(dict, upperFirst(part), depth - 1) !== null;
}

/** The last part of a word that splits fully into known words. German compounds take its gender. */
function compoundHead(dict: Dictionary, word: string, depth = 1): LemmaEntry | null {
  for (let split = MIN_PART; split <= word.length - MIN_PART; split++) {
    const head = dict.lookup(upperFirst(word.slice(split)));
    if (!head || head.old || !isNoun(head)) continue;
    const front = word.slice(0, split);
    for (const link of LINKS) {
      if (link && !front.endsWith(link)) continue;
      const part = link ? front.slice(0, -link.length) : front;
      if (part.length >= MIN_PART && isCompoundPart(dict, part, depth)) return head;
    }
  }
  return null;
}

const DIGRAPHS: readonly (readonly [string, string])[] = [['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü'], ['Ae', 'Ä'], ['Oe', 'Ö'], ['Ue', 'Ü'], ['ss', 'ß'], ['ß', 'ss']];
const LETTERS = 'abcdefghijklmnopqrstuvwxyzäöüßé';
const ACCENTED: Readonly<Record<string, string>> = { a: 'ä', o: 'ö', u: 'ü', e: 'é' };
/** More close words than this means the typing could have been aiming at anything. */
const MAX_SUGGESTIONS = 3;
const MIN_SPELL_LENGTH = 4;

function digraphVariants(word: string): string[] {
  const found = new Set<string>();
  for (const [from, to] of DIGRAPHS) {
    for (let at = word.indexOf(from); at !== -1; at = word.indexOf(from, at + 1)) found.add(word.slice(0, at) + to + word.slice(at + from.length));
  }
  return [...found];
}

/** Every word one typing slip away. Accent slips come first: Tur for Tür is likelier than Tor. */
function nearby(word: string): { accent: string[]; other: string[] } {
  const accent = new Set<string>();
  const other = new Set<string>();
  const first = word.charAt(0);
  const keepCase = (text: string) => (isCapitalized(first) ? upperFirst(text) : text);
  for (let i = 0; i < word.length; i++) {
    const before = word.slice(0, i);
    const after = word.slice(i + 1);
    const char = word.charAt(i);
    const mark = ACCENTED[char.toLocaleLowerCase('de')];
    if (mark) accent.add(keepCase(before + mark + after));
    other.add(keepCase(before + after));
    if (i + 1 < word.length) other.add(keepCase(before + word.charAt(i + 1) + char + word.slice(i + 2)));
    for (const letter of LETTERS) other.add(keepCase(before + letter + after));
  }
  for (let i = 0; i <= word.length; i++) for (const letter of LETTERS) other.add(keepCase(word.slice(0, i) + letter + word.slice(i)));
  other.delete(word);
  for (const seen of accent) other.delete(seen);
  return { accent: [...accent], other: [...other] };
}

function suggestionFor(entry: LemmaEntry, article: Article | null): Suggestion {
  if (!isNoun(entry)) return { german: entry.word, article: null };
  const usual = usualArticles(entry);
  const kept = article && (usual.includes(article) || entry.genders.some((gender) => gender.article === article));
  return { german: entry.word, article: kept ? article : usual[0] ?? null };
}

/** Likely intended words, best first, or nothing when no one word stands out. */
function spellingIdeas(dict: Dictionary, word: string, article: Article | null): Suggestion[] {
  if (word.length < MIN_SPELL_LENGTH) return [];
  const usable = (entry: LemmaEntry | null): entry is LemmaEntry => entry !== null && !entry.old && entry.pos !== '';
  const close = nearby(word);
  const accurate = (entry: LemmaEntry) => entry.common && entry.pos !== 'N' && entry.pos !== 'K' && (!article || isNoun(entry));
  const accents = close.accent.map((text) => dict.lookup(text)).filter(usable).filter(accurate);
  if (accents.length) return accents.slice(0, MAX_SUGGESTIONS).map((entry) => suggestionFor(entry, article));

  const others = close.other.map((text) => dict.lookup(text)).filter(usable).filter(accurate);
  // The article narrows things down: der Kaffe has many neighbours, but few of them are masculine.
  const fitting = others.filter((entry) => article && entry.genders.some((gender) => gender.article === article));
  const best = fitting.length ? fitting : others;
  if (best.length === 0 || best.length > MAX_SUGGESTIONS) return [];
  return best.map((entry) => suggestionFor(entry, article));
}

function currentSpelling(dict: Dictionary, word: string, article: Article | null): Suggestion[] {
  const usable = (entry: LemmaEntry | null): entry is LemmaEntry => entry !== null && !entry.old && entry.pos !== '';
  const direct = word.includes('ß') ? dict.lookup(word.replaceAll('ß', 'ss')) : null;
  if (usable(direct)) return [suggestionFor(direct, article)];
  const close = nearby(word);
  const found = [...close.accent, ...close.other].map((text) => dict.lookup(text)).filter(usable);
  const best = found.some((entry) => entry.common) ? found.filter((entry) => entry.common) : found;
  return best.length <= MAX_SUGGESTIONS ? best.map((entry) => suggestionFor(entry, article)) : [];
}

/** The meaning points at another gender's sense only if it matches there and not here. */
function otherSense(entry: LemmaEntry, article: Article, turkish: string): Article[] {
  const meanings = new Set(splitMeanings(turkish).map(meaningKey));
  const matches = (which: Article) => (entry.turkish[which] ?? []).some((text) => meanings.has(meaningKey(text)));
  if (matches(article)) return [];
  return entry.genders.map((gender) => gender.article).filter((other) => other !== article && matches(other));
}

function checkWithArticle(dict: Dictionary, word: string, article: Article, turkish: string): Validation {
  const entry = dict.lookup(word);
  if (entry?.old) return issue('old_spelling', currentSpelling(dict, word, article));

  if (entry && isNoun(entry)) {
    if (entry.pluralOnly) return article === 'die' ? result('verified', [], { kind: 'plural' }) : issue('article_wrong', withArticles(word, ['die']));
    const listed = entry.genders.some((gender) => gender.article === article);
    if (listed) {
      const others = otherSense(entry, article, turkish);
      if (others.length) return issue('article_sense', withArticles(word, others));
      return entry.genders.length > 1 ? result('multiple', [], { kind: 'articles', articles: entry.genders.map((gender) => gender.article) }) : result('verified');
    }
    if (article === 'die' && entry.samePlural) return result('multiple', [], { kind: 'plural' });
    if (article === 'die' && dict.pluralOf(word).some((lemma) => dict.lookup(lemma)?.genders.length)) return result('verified', [], { kind: 'plural' });
    return issue('article_wrong', withArticles(word, usualArticles(entry)));
  }

  // A noun written small: das essen, der apfel.
  if (!isCapitalized(word)) {
    const noun = dict.lookup(upperFirst(word));
    if (noun && isNoun(noun)) return issue('capitalization', [suggestionFor(noun, article)]);
    if (dict.formsOf(upperFirst(word)).length) return issue('capitalization', [{ german: upperFirst(word), article }]);
  }

  if (entry) {
    if (hasOtherUse(entry) && !isCapitalized(word)) return issue('not_a_noun', [{ german: word, article: null }]);
    return UNCHECKED;
  }

  const lemmas = dict.formsOf(word);
  const nouns = lemmas.map((lemma) => dict.lookup(lemma)).filter((found): found is LemmaEntry => found !== null && isNoun(found));
  if (nouns.length) {
    const plurals = article === 'die' ? dict.pluralOf(word) : [];
    if (plurals.length || nouns.some((noun) => noun.genders.some((gender) => gender.article === article))) return result('verified', [], { kind: 'inflected', of: plurals[0] ?? nouns[0]!.word });
    // Der Kaffe is a form of das Kaff by accident. A near word that fits the article was far likelier meant.
    const fitting = spellingIdeas(dict, word, article).filter((idea) => idea.article === article);
    if (fitting.length) return issue('spelling', fitting);
    return issue('article_wrong', [...(dict.pluralOf(word).length ? [{ german: word, article: 'die' as const }] : []), ...nouns.slice(0, 2).map((noun) => suggestionFor(noun, article))]);
  }
  if (lemmas.length && !isCapitalized(word)) return issue('not_a_noun', [{ german: word, article: null }]);

  // Any verb can be a noun, and it is always das: das Gehen.
  const small = dict.lookup(lowerFirst(word));
  if (isCapitalized(word) && small?.pos.includes('V')) return article === 'das' ? result('verified', [], { kind: 'inflected', of: small.word }) : issue('article_wrong', withArticles(word, ['das']));
  if (isCapitalized(word) && small?.pos.includes('A')) return result('not_found');

  return checkUnknown(dict, word, article);
}

/** Compounds gain nothing from a head this short: Alpinist does not end in the word Ist. */
const MIN_HEAD_FOR_GENDER = 4;

function checkUnknown(dict: Dictionary, word: string, article: Article | null): Validation {
  // A surname is not what someone typing Schuele was after.
  const digraphs = digraphVariants(word).map((text) => dict.lookup(text)).filter((entry): entry is LemmaEntry => entry !== null && !entry.old && entry.pos !== '' && entry.pos !== 'N');
  if (digraphs.length) return issue('spelling', digraphs.slice(0, MAX_SUGGESTIONS).map((entry) => suggestionFor(entry, article)));

  const head = isCapitalized(word) ? compoundHead(dict, word) : null;
  if (head) {
    const note: ValidationNote = { kind: 'compound', head: head.word };
    if (!article) return result('not_found', [], note);
    const fits = head.pluralOnly ? article === 'die' : head.genders.some((gender) => gender.article === article);
    return fits || head.word.length < MIN_HEAD_FOR_GENDER ? result('not_found', [], note) : result('mismatch', [{ code: 'article_wrong', suggestions: withArticles(word, usualArticles(head)) }], note);
  }

  const ideas = spellingIdeas(dict, word, article);
  return ideas.length ? issue('spelling', ideas) : result('not_found');
}

function checkWithoutArticle(dict: Dictionary, word: string): Validation {
  const entry = dict.lookup(word);
  if (entry?.old) return issue('old_spelling', currentSpelling(dict, word, null));

  // A capital may only mean the start of a line: Hallo, Was?, Danke.
  const small = isCapitalized(word) ? dict.lookup(lowerFirst(word)) : null;
  const smallForm = isCapitalized(word) && dict.formsOf(lowerFirst(word)).length > 0;

  if (entry) {
    if (hasOtherUse(entry)) return entry && isNoun(entry) ? result('multiple', [], { kind: 'articles', articles: usualArticles(entry) }) : result('verified');
    // Only a word that could really start a line. A verb like lampen, or a rare word, does not explain Lampe.
    if (small && !small.old && (small.common || !isNoun(entry))) return result(isNoun(entry) ? 'multiple' : 'verified');
    if (isNoun(entry)) {
      // Many nouns are also surnames, which says nothing about Lampe alone. An abbreviation is often used bare.
      if (entry.pos.includes('K')) return result('multiple', [], { kind: 'articles', articles: usualArticles(entry) });
      return issue('article_missing', withArticles(word, usualArticles(entry)));
    }
    return result('verified');
  }

  if (small && !small.old) return result('verified');
  const lemmas = dict.formsOf(word);
  if (lemmas.length) return result('verified', [], { kind: 'inflected', of: lemmas[0]! });
  if (smallForm) return result('verified', [], { kind: 'inflected', of: dict.formsOf(lowerFirst(word))[0]! });

  // A noun written small: tür.
  if (!isCapitalized(word)) {
    const noun = dict.lookup(upperFirst(word));
    if (noun && !noun.old && noun.pos !== '') return issue('capitalization', [suggestionFor(noun, null)]);
    if (dict.formsOf(upperFirst(word)).length) return issue('capitalization', [{ german: upperFirst(word), article: null }]);
  }
  return checkUnknown(dict, word, null);
}

/** Judges one entry. Phrases are looked up whole but never taken apart. */
export function validateEntry(dict: Dictionary, german: string, articleText: string, turkish: string): Validation {
  const word = stripClosingPunctuation(german);
  const article = parseArticle(articleText);
  if (!word || article === undefined || /\d/u.test(word)) return UNCHECKED;
  if (word.includes(' ')) {
    const found = [word, lowerFirst(word), upperFirst(word)].some((text) => dict.lookup(text) !== null);
    return found ? result('verified') : UNCHECKED;
  }
  return article ? checkWithArticle(dict, word, article, turkish) : checkWithoutArticle(dict, word);
}

/** Remembers answers, so unchanged rows are not checked again each time another row changes. */
export type Validate = (german: string, article: string, turkish: string) => Validation;

export function createValidator(dict: Dictionary): Validate {
  const known = new Map<string, Validation>();
  return (german, article, turkish) => {
    const key = `${german}\t${article}\t${turkish}`;
    let answer = known.get(key);
    if (!answer) known.set(key, (answer = validateEntry(dict, german, article, turkish)));
    return answer;
  };
}
