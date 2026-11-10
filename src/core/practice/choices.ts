import { ARTICLES, type PartOfSpeech } from '../vocabulary';
import { normalizeText, type Article } from '../identity';
import { evaluateAnswer, isAccepted, lemmasOf, meaningKeysOf, NO_DOUBT, type AnswerWord, type DictionaryDoubt, type Track } from './answers';
import { shuffled, tracksFor, type PracticeMode } from './selection';

/**
 * Multiple-choice questions for a test, built only from the learner's own saved words. A wrong option
 * is shown only when nothing in the saved data says it could also be right: it is spelled differently,
 * means something else, and the typed-answer check would not accept it either. When a word does not
 * have three such options, it is simply not asked that way. Nothing is ever filled in to make up four.
 */
export interface ChoiceWord extends AnswerWord {
  pos: PartOfSpeech;
}

export interface ChoiceOption {
  text: string;
  /** The saved word this option came from. Null for an article, which is not a word of its own. */
  wordId: string | null;
  /** A German option, drawn as a German word so its article looks as it does everywhere else. */
  german?: { article: Article | null; lemma: string };
}

/** One question, fixed when the test begins, so it reads the same after a reload or an edit. */
export interface TestQuestion {
  wordId: string;
  kind: Track;
  prompt: string;
  /** A second line that decides the answer: the meaning behind an article. */
  detail: string | null;
  options: ChoiceOption[];
  correct: number;
}

export const TRANSLATION_OPTIONS = 4;
const WRONG_OPTIONS = TRANSLATION_OPTIONS - 1;

type Category = 'noun' | 'phrase' | 'word';

interface Entry {
  word: ChoiceWord;
  /** Every spelling the word is written as, without case, umlauts or accents. */
  german: string[];
  /** Every Turkish meaning, as the answer check reads it. */
  meanings: string[];
  noun: boolean;
  category: Category;
}

export interface ChoicePool {
  /** Words that may stand as wrong options. */
  candidates: readonly Entry[];
  entryOf(word: ChoiceWord): Entry;
}

const UMLAUTS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
/** Fuß and Fuss, Café and Cafe are one spelling here. schon and schön stay two. */
const spellingKey = (text: string) =>
  text
    .toLocaleLowerCase('de')
    .replace(/[äöüß]/gu, (letter) => UMLAUTS[letter]!)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const categoryOf = (word: ChoiceWord): Category => (word.article ? 'noun' : /\s/u.test(normalizeText(word.lemma)) ? 'phrase' : 'word');

function entryFor(word: ChoiceWord): Entry {
  return { word, german: [...new Set(lemmasOf(word).map(spellingKey))], meanings: [...meaningKeysOf(word)], noun: word.article !== null, category: categoryOf(word) };
}

/** ev and ev sahibi, almak and satın almak: one is part of the other, so neither is safely wrong. */
const overlaps = (a: string, b: string) => a === b || ` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `);
const meaningsClash = (x: Entry, y: Entry) => x.meanings.some((a) => y.meanings.some((b) => overlaps(a, b)));
const spellingsClash = (x: Entry, y: Entry) => x.german.some((a) => y.german.includes(a));

/** The words a test may draw options from: saved, with a meaning, and with no open doubt about their text. */
export function createChoicePool(words: readonly ChoiceWord[], blocked: (wordId: string) => boolean = () => false): ChoicePool {
  const entries = new Map<string, Entry>();
  for (const word of words) entries.set(word.id, entryFor(word));
  const candidates = words.filter((word) => word.meanings.length > 0 && !blocked(word.id)).map((word) => entries.get(word.id)!);
  return { candidates, entryOf: (word) => entries.get(word.id) ?? entryFor(word) };
}

const meaningList = (word: AnswerWord) => word.meanings.map((meaning) => normalizeText(meaning.text)).join(', ');
/** The one meaning an option shows. Every meaning is still checked. */
const shownMeaning = (word: AnswerWord) => normalizeText(word.meanings[0]?.text ?? '');
const germanLabel = (word: AnswerWord, bare: boolean) => (word.article && !bare ? `${word.article} ${word.lemma}` : word.lemma);
const displayKey = (text: string) => normalizeText(text).toLocaleLowerCase('tr');

function optionOf(word: ChoiceWord, kind: 'de_tr' | 'tr_de', bare: boolean): ChoiceOption {
  if (kind === 'de_tr') return { text: shownMeaning(word), wordId: word.id };
  const article = bare ? null : word.article;
  return { text: germanLabel(word, bare), wordId: word.id, german: { article, lemma: word.lemma } };
}

interface Ask {
  target: Entry;
  kind: 'de_tr' | 'tr_de';
  doubt: DictionaryDoubt;
  /** A doubted article is left out of every German option, so no option stands out by having one. */
  bare: boolean;
}

/** Would the typed answer check accept this text for the asked word? Then it cannot be a wrong option. */
function accepted(ask: Ask, text: string, other: ChoiceWord | null): boolean {
  const library = other ? [ask.target.word, other] : [ask.target.word];
  return isAccepted(evaluateAnswer(ask.target.word, ask.kind, text, { library, doubt: ask.doubt }).result);
}

/** A word that is wrong for this question on its own, before it is compared with the other options. */
function safeAlone(ask: Ask, entry: Entry): boolean {
  if (entry.word.id === ask.target.word.id) return false;
  // Asked in German, every option shows an article or none does.
  if (ask.kind === 'tr_de' && entry.noun !== ask.target.noun) return false;
  if (spellingsClash(entry, ask.target) || meaningsClash(entry, ask.target)) return false;
  const option = optionOf(entry.word, ask.kind, ask.bare);
  if (!option.text) return false;
  return !accepted(ask, option.text, entry.word);
}

/** Two options that could be taken for one another would let either be ruled out, or both be right. */
const safeTogether = (ask: Ask, a: Entry, b: Entry) => !spellingsClash(a, b) && !meaningsClash(a, b) && displayKey(optionOf(a.word, ask.kind, ask.bare).text) !== displayKey(optionOf(b.word, ask.kind, ask.bare).text);

/** The first three that fit together, in the order given. */
function pickThree(ask: Ask, ordered: Iterable<Entry>, correctText: string): Entry[] {
  const chosen: Entry[] = [];
  for (const entry of ordered) {
    if (!safeAlone(ask, entry)) continue;
    if (displayKey(optionOf(entry.word, ask.kind, ask.bare).text) === displayKey(correctText)) continue;
    if (!chosen.every((other) => safeTogether(ask, entry, other))) continue;
    chosen.push(entry);
    if (chosen.length === WRONG_OPTIONS) break;
  }
  return chosen;
}

function askOf(pool: ChoicePool, target: ChoiceWord, kind: 'de_tr' | 'tr_de', doubt: DictionaryDoubt): Ask {
  return { target: pool.entryOf(target), kind, doubt, bare: doubt.article };
}

/** The right option, if the saved data makes it plainly right. Otherwise the question is not asked. */
function correctOption(ask: Ask): ChoiceOption | null {
  if (ask.target.word.meanings.length === 0) return null;
  const option = optionOf(ask.target.word, ask.kind, ask.bare);
  return option.text && accepted(ask, option.text, null) ? option : null;
}

/** Whether a word can be asked this way in a test, decided the same way every time. */
export function canAsk(pool: ChoicePool, target: ChoiceWord, kind: Track, doubt: DictionaryDoubt = NO_DOUBT): boolean {
  if (kind === 'article') return target.article !== null && !doubt.article;
  const ask = askOf(pool, target, kind, doubt);
  const correct = correctOption(ask);
  return correct !== null && pickThree(ask, pool.candidates, correct.text).length === WRONG_OPTIONS;
}

/** The question types a word can honestly be asked in a test. */
export const testKindsFor = (pool: ChoicePool, word: ChoiceWord, mode: Exclude<PracticeMode, 'listen'>, doubt: DictionaryDoubt = NO_DOUBT): Track[] => tracksFor(word, mode, doubt).filter((kind) => canAsk(pool, word, kind, doubt));

interface BuildOptions {
  doubt?: DictionaryDoubt;
  /** Words from the learner's chosen selection, offered as options first. */
  preferred?: ReadonlySet<string>;
  random: () => number;
}

const lengthGap = (a: ChoiceOption, b: ChoiceOption) => {
  const gap = Math.abs([...a.text].length - [...b.text].length);
  return gap <= 3 ? 0 : gap <= 8 ? 1 : 2;
};

/**
 * One question, or null when it cannot be asked fairly. Options are drawn at random, from the chosen
 * selection first, then words of the same kind and a similar length; whenever canAsk says yes, this
 * finds three.
 */
export function buildQuestion(pool: ChoicePool, target: ChoiceWord, kind: Track, { doubt = NO_DOUBT, preferred, random }: BuildOptions): TestQuestion | null {
  if (kind === 'article') {
    if (!target.article || doubt.article) return null;
    return { wordId: target.id, kind, prompt: normalizeText(target.lemma), detail: meaningList(target) || null, options: ARTICLES.map((article) => ({ text: article, wordId: null })), correct: ARTICLES.indexOf(target.article) };
  }
  const ask = askOf(pool, target, kind, doubt);
  const correct = correctOption(ask);
  if (!correct) return null;
  const rank = (entry: Entry) => [preferred?.has(entry.word.id) ? 0 : 1, entry.category === ask.target.category ? 0 : 1, lengthGap(optionOf(entry.word, kind, ask.bare), correct)] as const;
  const ranked = shuffled(pool.candidates, random)
    .map((entry) => ({ entry, rank: rank(entry) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
    .map(({ entry }) => entry);
  let wrong = pickThree(ask, ranked, correct.text);
  // A preferred order can paint itself into a corner; the plain order canAsk used cannot.
  if (wrong.length < WRONG_OPTIONS) wrong = pickThree(ask, pool.candidates, correct.text);
  if (wrong.length < WRONG_OPTIONS) return null;
  const options = shuffled([correct, ...wrong.map((entry) => optionOf(entry.word, kind, ask.bare))], random);
  const prompt = kind === 'tr_de' ? meaningList(target) : germanLabel(target, ask.bare);
  return { wordId: target.id, kind, prompt, detail: null, options, correct: options.indexOf(correct) };
}
