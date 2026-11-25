import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import type { LearningLanguage } from '../src/core/learningLanguage';
import { evaluateAnswer, isAccepted, type AnswerWord, type QuestionKind } from '../src/core/practice/answers';
import { buildQuestion, createChoicePool, testKindsFor, type ChoiceWord } from '../src/core/practice/choices';
import { tracksFor } from '../src/core/practice/selection';
import { blankDraft, draftsFor } from '../src/core/review';
import { affectedTracks } from '../src/core/scheduling/invalidation';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { loadPracticeData } from '../src/data/practice';
import { getActiveWord, getGroupWithWords } from '../src/data/repository';
import { loadReviewData } from '../src/data/smartReview';
import { parseStudyChoice, readSavedSession, readStudyChoice, saveSession, saveStudyChoice } from '../src/ui/practiceStorage';
import { makeWord, T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const word = (id: string, lemma: string, meanings: string[], language: LearningLanguage = 'en', article: Article | null = null): ChoiceWord => ({
  id,
  language,
  lemma,
  article,
  pos: article ? 'noun' : lemma.includes(' ') ? 'phrase' : 'other',
  meanings: meanings.map((text) => ({ text })),
});
const check = (target: AnswerWord, track: QuestionKind, typed: string, library: readonly AnswerWord[] = [target]) => evaluateAnswer(target, track, typed, { library });

describe('English answers', () => {
  const apple = word('apple', 'apple', ['elma']);
  const monday = word('monday', 'Monday', ['pazartesi']);
  const dieOut = word('die-out', 'die out', ['nesli tükenmek']);
  const its = word('its', 'its', ['onun']);
  const itIs = word('it-s', 'it’s', ['o']);
  const colour = word('colour', 'colour/color', ['renk']);

  it('accept the word as saved, any of its slash forms, and a capital slip with a note', () => {
    expect(check(apple, 'tr_de', 'apple')).toMatchObject({ result: 'correct', note: null });
    expect(check(apple, 'tr_de', 'Apple')).toMatchObject({ result: 'correct', note: 'case' });
    expect(check(monday, 'tr_de', 'monday')).toMatchObject({ result: 'correct', note: 'case' });
    expect(check(colour, 'tr_de', 'color').correct).toBe(true);
    expect(check(colour, 'tr_de', 'colour').correct).toBe(true);
  });

  it('never read the start of an English answer as a German article', () => {
    expect(check(dieOut, 'tr_de', 'die out')).toMatchObject({ result: 'correct' });
    expect(check(apple, 'tr_de', 'der apple').correct).toBe(false);
  });

  it('keep apostrophes: its and it’s are two words, and either apostrophe writes the same one', () => {
    expect(check(its, 'tr_de', "it's").correct).toBe(false);
    expect(check(itIs, 'tr_de', "it's")).toMatchObject({ result: 'correct' });
    expect(check(itIs, 'tr_de', 'its').correct).toBe(false);
  });

  it('name a slip, a mix-up and a synonym only among the learner’s own English words', () => {
    expect(check(apple, 'tr_de', 'appel').result).toBe('typo');
    const pear = word('pear', 'pear', ['armut']);
    expect(check(apple, 'tr_de', 'pear', [apple, pear]).result).toBe('other_word');
    const fall = word('fall', 'fall', ['sonbahar']);
    const autumn = word('autumn', 'autumn', ['sonbahar']);
    expect(check(autumn, 'tr_de', 'fall', [autumn, fall]).result).toBe('also_valid');
    // The same spelling saved as a German word says nothing about an English answer.
    const germanAlso = word('de-also', 'also', ['yani'], 'de');
    const englishSo = word('so', 'so', ['yani']);
    expect(check(englishSo, 'tr_de', 'also', [englishSo, germanAlso]).result).toBe('wrong');
  });

  it('check meanings in any language: a capital I may be either I, while kir and kır stay apart', () => {
    const idea = word('idea', 'idea', ['Idea of something']);
    expect(check(idea, 'de_tr', 'idea of something').correct).toBe(true);
    const dirt = word('dirt', 'dirt', ['kir']);
    expect(check(dirt, 'de_tr', 'kır').correct).toBe(false);
    expect(check(dirt, 'de_tr', 'KİR').correct).toBe(true);
  });

  it('leave German meaning checks exactly as they were', () => {
    const fikir = word('fikir', 'Idee', ['Idea'], 'de', 'die');
    // Read the Turkish way, as before: I lowers to ı, so idea is a different text.
    expect(check(fikir, 'de_tr', 'idea').correct).toBe(false);
    expect(check(fikir, 'de_tr', 'Idea').correct).toBe(true);
  });

  it('are never asked as an article, and an article answer is never right', () => {
    expect(tracksFor(apple, 'mixed')).toEqual(['tr_de', 'de_tr']);
    expect(tracksFor(apple, 'article')).toEqual([]);
    expect(isAccepted(check(apple, 'article', 'der').result)).toBe(false);
  });

  it('see an edit the way the answers do', () => {
    const before = { language: 'en' as const, lemma: 'its', article: null, meanings: [{ text: 'onun' }] };
    expect(affectedTracks(before, { ...before, lemma: "it's" })).toEqual(['tr_de']);
    expect(affectedTracks(before, { ...before, lemma: 'Its' })).toEqual([]);
  });
});

describe('an English test', () => {
  const words = ['apple', 'pear', 'plum', 'cherry', 'grape'].map((lemma, i) => word(lemma, lemma, [['elma', 'armut', 'erik', 'kiraz', 'üzüm'][i]!]));

  it('asks both directions and never an article, with options from English words only', () => {
    const pool = createChoicePool(words);
    expect(testKindsFor(pool, words[0]!, 'mixed')).toEqual(['tr_de', 'de_tr']);
    const question = buildQuestion(pool, words[0]!, 'tr_de', { random: () => 0.5 })!;
    expect(question.options).toHaveLength(4);
    expect(question.options.every((option) => option.german?.article === null)).toBe(true);
    expect(new Set(question.options.map((option) => option.wordId)).size).toBe(4);
    expect(buildQuestion(pool, words[0]!, 'article', { random: () => 0.5 })).toBeNull();
  });
});

describe('imports into English', () => {
  it('keep each row whole: an article a German parser took off goes back, and German warnings go', () => {
    const rows = [blankDraft('1', 0, { german: 'Apfel', article: 'der', turkish: 'elma', flags: ['article_lowercase', 'wrapped'] }), blankDraft('2', 1, { german: 'give up', turkish: 'vazgeçmek', flags: ['wrapped_word', 'article_missing'] })];
    const english = draftsFor('en', rows);
    expect(english.map((row) => [row.german, row.article, row.flags])).toEqual([
      ['der Apfel', '', ['wrapped']],
      ['give up', '', []],
    ]);
    expect(english[0]!.extracted).toEqual(rows[0]!.extracted);
    expect(draftsFor('de', rows)).toEqual(rows);
  });

  it('keep no German plural, which an English word could neither show nor edit', () => {
    const rows = [blankDraft('1', 0, { german: 'mouse', turkish: 'fare', plural: 'mice' })];
    expect(draftsFor('en', rows)[0]).toMatchObject({ german: 'mouse', article: '', plural: '' });
    expect(draftsFor('de', [blankDraft('2', 0, { german: 'Maus', article: 'die', turkish: 'fare', plural: 'Mäuse' })])[0]!.plural).toBe('Mäuse');
  });
});

describe('opening a record by its id', () => {
  let db: AppDatabase;
  beforeEach(async () => {
    db = await openDatabase({ name: uniqueDbName() });
    await seedLibrary(db);
    await db.words.add(makeWord('en-apple', 'apple', null, 'elma', 'en'));
    await db.groups.add({ id: 'g-en', language: 'en', kind: 'custom', name: 'Fruit', order: 9, sourceId: null, createdAt: T0 });
    await db.groupMembers.add({ groupId: 'g-en', wordId: 'en-apple', addedAt: T0, importRowId: null });
  });
  afterEach(() => db.close());

  it('finds a word or collection only in its own workspace', async () => {
    expect(await getActiveWord(db, 'en-apple', 'en')).toMatchObject({ lemma: 'apple' });
    expect(await getActiveWord(db, 'en-apple', 'de')).toBeNull();
    expect(await getActiveWord(db, 'w-apfel', 'en')).toBeNull();
    expect((await getGroupWithWords(db, 'g-en', 'en'))?.words.map((w) => w.id)).toEqual(['en-apple']);
    expect(await getGroupWithWords(db, 'g-en', 'de')).toBeNull();
    expect(await getGroupWithWords(db, 'g-custom', 'en')).toBeNull();
  });

  it('never asks the German dictionary about English words, even when it is at hand', async () => {
    const validate = () => ({ status: 'mismatch' as const, issues: [{ code: 'spelling' as const, suggestions: [] }], note: null });
    const practice = await loadPracticeData(db, validate, 'en');
    expect(practice.flagged.size).toBe(0);
    const review = await loadReviewData(db, validate, 'en');
    expect(review.validate).toBeNull();
    expect(review.flagged.size).toBe(0);
  });
});

describe('saved study state', () => {
  class MemoryStorage {
    items = new Map<string, string>();
    get length() {
      return this.items.size;
    }
    key = (i: number) => [...this.items.keys()][i] ?? null;
    getItem = (key: string) => this.items.get(key) ?? null;
    setItem = (key: string, value: string) => void this.items.set(key, value);
    removeItem = (key: string) => void this.items.delete(key);
    clear = () => this.items.clear();
  }
  let local: MemoryStorage;
  let session: MemoryStorage;
  beforeEach(() => {
    local = new MemoryStorage();
    session = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('belongs to one language: German keeps the names it always had, English has its own', () => {
    saveSession('de', { id: 'german' });
    saveSession('en', { id: 'english' });
    expect([...session.items.keys()].sort()).toEqual(['vosli.practice-session', 'vosli.practice-session.en']);
    expect(readSavedSession('de')).toEqual({ id: 'german' });
    expect(readSavedSession('en')).toEqual({ id: 'english' });
    saveSession('en', null);
    expect(readSavedSession('de')).toEqual({ id: 'german' });
  });

  it('keeps each language’s way of studying, Listening too, without touching the other’s', () => {
    saveStudyChoice('en', { study: 'listen', direction: 'de_tr' });
    expect(readStudyChoice('en').study).toBe('listen');
    expect(readStudyChoice('de').study).toBe('typed');
    saveStudyChoice('de', { study: 'cards', direction: 'tr_de' });
    expect(readStudyChoice('en')).toEqual({ study: 'listen', direction: 'de_tr' });
    expect(readStudyChoice('de')).toEqual({ study: 'cards', direction: 'tr_de' });
    expect(parseStudyChoice({ study: 'cards', direction: 'tr_de' }, 'en')).toEqual({ study: 'cards', direction: 'tr_de' });
    expect(parseStudyChoice({ study: 'spoken', direction: 'de_tr' }, 'en').study).toBe('typed');
  });

  it('keeps a Listening round in the language it was started in', () => {
    saveSession('en', { id: 'english-listening', items: [{ track: 'listen' }] });
    expect(readSavedSession('de')).toBeNull();
    expect(readSavedSession('en')).toMatchObject({ id: 'english-listening' });
  });
});
