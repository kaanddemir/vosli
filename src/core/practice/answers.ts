import { normalizeText, type Article } from '../identity';
import type { Suggestion } from '../issues';
import { foldForSearch } from '../search';
import { splitMeanings } from '../vocabulary';

/**
 * Decides whether a typed answer is right. Everything here is a fixed, tested rule: there is no
 * scoring and no guessing. A close answer is reported as close but is not counted as correct, so
 * the worst outcome of an uncertain case is one more practice question, not a wrong word learned.
 */
export type AnswerResult = 'correct' | 'article_wrong' | 'article_missing' | 'capitalization' | 'transliteration' | 'typo' | 'other_word' | 'also_valid' | 'unknown_accepted' | 'wrong';
export type Track = 'de_tr' | 'tr_de' | 'article';

/** The parts of a saved word that answers depend on. */
export interface AnswerWord {
  id: string;
  lemma: string;
  article: Article | null;
  meanings: readonly { text: string }[];
}

/** A saved word the typed text turned out to be, shown so the learner sees what they mixed up. */
interface OtherWord {
  lemma: string;
  article: Article | null;
  meanings: string[];
}

export interface Evaluation {
  result: AnswerResult;
  correct: boolean;
  /** Accepted, but with something worth saying: capital at the start, or the dictionary's form. */
  note: 'case' | 'dictionary' | null;
  other: OtherWord | null;
}

/** What the open dictionary warnings mean for one question. Empty for any word without one. */
export interface DictionaryDoubt {
  /** The saved article may be wrong, so the question must not depend on it. */
  article: boolean;
  /** Forms the dictionary offers. Accepted, never presented as the truth. */
  offers: readonly Suggestion[];
}

export const NO_DOUBT: DictionaryDoubt = { article: false, offers: [] };

const ACCEPTED: ReadonlySet<AnswerResult> = new Set<AnswerResult>(['correct', 'also_valid', 'unknown_accepted']);
export const isAccepted = (result: AnswerResult): boolean => ACCEPTED.has(result);

/** Words shorter than this have too many close neighbours to call one letter a slip. */
const MIN_TYPO_LENGTH = 4;

const hit = (result: AnswerResult, other: OtherWord | null = null, note: Evaluation['note'] = null): Evaluation => ({ result, correct: isAccepted(result), note, other });
const asOther = (word: AnswerWord): OtherWord => ({ lemma: word.lemma, article: word.article, meanings: word.meanings.map((meaning) => meaning.text) });

/** Apostrophes vanish (geht's, gehts). Other marks become spaces, so Hallo,wie stays two words. */
const stripMarks = (text: string): string => normalizeText(text.replace(/['’‘`]/gu, '').replace(/[?!.,;:…"„“”«»¿¡]/gu, ' '));

/** Text without its parentheses, then with their content kept: tatil (tatile çıkmak), (sich) freuen. */
function withoutNotes(text: string): string[] {
  if (!/[()]/u.test(text)) return [text];
  const bare = normalizeText(text.replace(/\([^)]*\)?/gu, ' '));
  const kept = normalizeText(text.replace(/[()]/gu, ' '));
  return bare ? [bare, kept] : [kept];
}

/** Every way of writing an entry that counts as writing it: slashes offer alternatives. */
function forms(text: string): string[] {
  return withoutNotes(text).flatMap((form) => form.split('/')).map(normalizeText).filter(Boolean);
}

/** Levenshtein with one swap of neighbours, which only asks whether the distance is at most 1. */
function oneSlip(a: string, b: string): boolean {
  const [x, y] = [[...a], [...b]];
  if (Math.abs(x.length - y.length) > 1 || a === b) return false;
  let at = 0;
  while (at < x.length && at < y.length && x[at] === y[at]) at++;
  const same = (i: number, j: number) => x.slice(i).join('') === y.slice(j).join('');
  if (x.length === y.length) return same(at + 1, at + 1) || (x[at] === y[at + 1] && x[at + 1] === y[at] && same(at + 2, at + 2));
  return x.length > y.length ? same(at + 1, at) : same(at, at + 1);
}

/* ---------- German ---------- */

interface Typed {
  article: Article | null;
  lemma: string;
}

/** der Apfel, Apfel, der and bare Apfel. Case on the article itself never matters. */
function parseTyped(text: string): Typed {
  const value = normalizeText(text);
  const before = /^(der|die|das)\s+(.+)$/iu.exec(value);
  if (before) return { article: before[1]!.toLowerCase() as Article, lemma: before[2]! };
  const after = /^(.+?),\s*(der|die|das)$/iu.exec(value);
  if (after) return { article: after[2]!.toLowerCase() as Article, lemma: after[1]! };
  return { article: null, lemma: value };
}

const lowerStart = (text: string) => text.charAt(0).toLocaleLowerCase('de') + text.slice(1);
const differsOnlyAtStart = (a: string, b: string) => a !== b && lowerStart(a) === lowerStart(b);
const lowerAll = (text: string) => text.toLocaleLowerCase('de');

const UMLAUTS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
const spelledOut = (text: string) => lowerAll(text).replace(/[äöüß]/gu, (letter) => UMLAUTS[letter]!);
const bareLetters = (text: string) => foldForSearch(text);

/** Fuss, Fuess, Fus and Tur for Tür: the letters are right but a German mark was dropped or spelled out. */
const sameWithoutMarks = (typed: string, target: string) => lowerAll(typed) !== lowerAll(target) && (spelledOut(typed) === spelledOut(target) || bareLetters(typed) === bareLetters(target));

/** Every German text that counts as the word. Punctuation and spacing do not change it; capitals do. */
export const lemmasOf = (word: Pick<AnswerWord, 'lemma'>) => forms(word.lemma).map(stripMarks);

/** Every Turkish text that counts as a meaning. Notes in parentheses, case and punctuation do not change it. */
export const meaningKeysOf = (word: Pick<AnswerWord, 'meanings'>) => new Set(word.meanings.flatMap((meaning) => turkishForms(meaning.text)));

function findSaved(typed: Typed, library: readonly AnswerWord[], self: AnswerWord): AnswerWord[] {
  const lemma = stripMarks(typed.lemma);
  return library.filter((word) => word.id !== self.id && lemmasOf(word).includes(lemma));
}

const samePair = (typed: Typed, word: AnswerWord) => typed.article === word.article;

function evaluateGerman(word: AnswerWord, text: string, requireArticle: boolean, library: readonly AnswerWord[], doubt: DictionaryDoubt): Evaluation {
  const targets = lemmasOf(word);
  // A saved phrase may itself start like an article: das ist gut has no article to take off.
  const whole = stripMarks(text);
  const isPhrase = word.article === null && targets.some((target) => target === whole || differsOnlyAtStart(whole, target));
  const typed = isPhrase ? { article: null, lemma: whole } : parseTyped(text);
  const lemma = stripMarks(typed.lemma);
  if (!lemma) return hit('wrong');

  const offered = doubt.offers.some((offer) => stripMarks(offer.german) === lemma && (offer.article === typed.article || (typed.article === null && doubt.article)));
  const isNoun = word.article !== null;
  const exact = targets.includes(lemma);
  // A capital at the start of a non-noun proves nothing: Danke, danke, Was, was. A noun's capital is spelling.
  const startOnly = !exact && !isNoun && targets.some((target) => differsOnlyAtStart(lemma, target));
  const saved = findSaved(typed, library, word);
  const exactSaved = saved.find((other) => samePair(typed, other)) ?? saved[0] ?? null;

  if (exact || startOnly) {
    if (startOnly && exactSaved) return hit('capitalization', asOther(exactSaved));
    const note = startOnly ? 'case' : null;
    if (word.article === null) {
      if (typed.article === null) return hit('correct', null, note);
      // The saved word has no article to check against, so the learner may well be right.
      return lemma === lowerStart(lemma) ? hit('wrong') : hit('unknown_accepted', null, note);
    }
    if (typed.article === word.article) return hit('correct', null, note);
    if (doubt.article) return hit('correct', null, 'dictionary');
    if (typed.article === null) return requireArticle ? hit('article_missing') : hit('correct', null, note);
    return hit('article_wrong', exactSaved ? asOther(exactSaved) : null);
  }

  if (offered) return hit('unknown_accepted', null, 'dictionary');

  // The same letters with the wrong capitals: der morgen is a misspelled der Morgen, whatever else is saved.
  if (targets.some((target) => target !== lemma && lowerAll(target) === lowerAll(lemma))) return hit('capitalization', exactSaved ? asOther(exactSaved) : null);

  // Another saved word: a real synonym is right, anything else is a mix-up worth naming.
  if (exactSaved) {
    const shared = meaningKeysOf(word);
    const related = [...meaningKeysOf(exactSaved)].some((key) => shared.has(key));
    if (related) {
      const articleFine = typed.article === exactSaved.article || (!requireArticle && typed.article === null);
      return articleFine ? hit('also_valid', asOther(exactSaved)) : hit(typed.article === null ? 'article_missing' : 'article_wrong', asOther(exactSaved));
    }
    return hit('other_word', asOther(exactSaved));
  }

  if (targets.some((target) => sameWithoutMarks(lemma, target))) return hit('transliteration');
  if (targets.some((target) => target.length >= MIN_TYPO_LENGTH && oneSlip(lowerAll(lemma), lowerAll(target)))) return hit('typo');
  return hit('wrong');
}

/* ---------- Turkish ---------- */

const turkishKey = (text: string) => stripMarks(text).toLocaleLowerCase('tr');

/** vb., vs. and vd. at the end only trail off: ev vb. is a way of saying ev. */
const withoutTrailOff = (key: string) => key.replace(/\s+(vb|vs|vd)$/u, '');

function turkishForms(text: string): string[] {
  return forms(text).map((form) => withoutTrailOff(turkishKey(form))).filter(Boolean);
}

function evaluateTurkish(word: AnswerWord, text: string, library: readonly AnswerWord[]): Evaluation {
  // Only what stands outside parentheses is the answer, as with the saved meanings.
  const parts = splitMeanings(text).flatMap((part) => (withoutNotes(part)[0] ?? '').split('/')).map((form) => withoutTrailOff(turkishKey(form))).filter(Boolean);
  if (parts.length === 0) return hit('wrong');

  const targets = meaningKeysOf(word);
  if (parts.every((part) => targets.has(part))) return hit('correct');

  const wrongPart = parts.find((part) => !targets.has(part))!;
  const other = library.find((candidate) => candidate.id !== word.id && meaningKeysOf(candidate).has(wrongPart));
  if (other) return hit('other_word', asOther(other));

  const list = [...targets];
  if (list.some((target) => foldForSearch(target) === foldForSearch(wrongPart))) return hit('transliteration');
  if (list.some((target) => [...target].length >= MIN_TYPO_LENGTH && oneSlip(wrongPart, target))) return hit('typo');
  return hit('wrong');
}

/* ---------- Article ---------- */

function evaluateArticle(word: AnswerWord, text: string): Evaluation {
  const value = normalizeText(text);
  const alone = /^(der|die|das)$/iu.exec(value);
  const typed = alone ? { article: alone[1]!.toLowerCase() as Article, lemma: '' } : parseTyped(value);
  if (!typed.article) return hit('wrong');
  if (typed.lemma && !lemmasOf(word).includes(stripMarks(typed.lemma))) return hit('wrong');
  return hit(typed.article === word.article ? 'correct' : 'article_wrong');
}

interface AnswerContext {
  /** All active words, for synonyms and mix-ups. */
  library: readonly AnswerWord[];
  doubt?: DictionaryDoubt;
}

export function evaluateAnswer(word: AnswerWord, track: Track, typed: string, { library, doubt = NO_DOUBT }: AnswerContext): Evaluation {
  if (track === 'article') return evaluateArticle(word, typed);
  if (track === 'tr_de') return evaluateGerman(word, typed, !doubt.article, library, doubt);
  return evaluateTurkish(word, typed, library);
}

/** The part of a meaning a learner is asked for, with its explanation left out. */
const coreOf = (text: string): string => forms(text)[0] ?? normalizeText(text);

/**
 * One first letter, or nothing when one letter would be the whole answer. It comes from the word and
 * never from the article, which is itself part of what is being asked.
 */
export function hintFor(word: AnswerWord, track: Track): string | null {
  if (track === 'article') return null;
  const source = track === 'tr_de' ? stripMarks(forms(word.lemma)[0] ?? word.lemma) : stripMarks(coreOf(word.meanings[0]?.text ?? ''));
  const letters = [...source];
  if (letters.length < 2) return null;
  return `${letters[0]}…`;
}
