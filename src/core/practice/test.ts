import { ARTICLES } from '../vocabulary';
import type { Track } from './answers';
import { TRANSLATION_OPTIONS, type ChoiceOption, type TestQuestion } from './choices';
import type { PracticeSettings } from './session';

/**
 * A multiple-choice test as plain data. Every question and its options are fixed when it begins. An
 * answer, once given, is kept and cannot change; the question then stays on screen with its answer
 * shown until the learner moves on. Nothing here is a practice attempt, a card or a log: a test only
 * reads what the learner has saved.
 */
export type TestPick = number | 'blank';

export interface TestSession {
  id: string;
  settings: PracticeSettings;
  questions: TestQuestion[];
  /** One per answered question, in order. */
  picks: TestPick[];
  /** The question on screen. Answered when picks reaches past it, which is when its answer is shown. */
  at: number;
}

export function createTest(id: string, settings: PracticeSettings, questions: readonly TestQuestion[]): TestSession {
  return { id, settings, questions: [...questions], picks: [], at: 0 };
}

export const currentQuestion = (test: TestSession): TestQuestion | null => test.questions[test.at] ?? null;
/** The answer given to the question on screen, once there is one. */
export const shownPick = (test: TestSession): TestPick | null => (test.picks.length > test.at ? test.picks[test.at]! : null);
export const isTestFinished = (test: TestSession): boolean => test.at >= test.questions.length;
/** Something has been answered, so leaving would lose it. */
export const testHasProgress = (test: TestSession): boolean => test.picks.length > 0 && !isTestFinished(test);

/**
 * Answers the question on screen, once. at is the question the answer was given for, so a second
 * press, or one arriving after the test has moved on, answers nothing.
 */
function answer(test: TestSession, at: number, pick: TestPick): TestSession {
  const question = currentQuestion(test);
  if (!question || at !== test.at || test.picks.length !== test.at) return test;
  if (pick !== 'blank' && !(Number.isInteger(pick) && pick >= 0 && pick < question.options.length)) return test;
  return { ...test, picks: [...test.picks, pick] };
}

export const submitPick = (test: TestSession, at: number, option: number): TestSession => answer(test, at, option);
export const leaveBlank = (test: TestSession, at: number): TestSession => answer(test, at, 'blank');

/** Moves on from an answered question. at is the question being left, so a double press moves once. */
export function nextTestQuestion(test: TestSession, at: number): TestSession {
  if (at !== test.at || shownPick(test) === null) return test;
  return { ...test, at: test.at + 1 };
}

/**
 * Takes out the questions still to come about a word deleted during the test. Questions already
 * answered stay as they were asked, since they are only text now.
 */
export function dropWord(test: TestSession, wordId: string): TestSession {
  const done = test.picks.length;
  const questions = test.questions.filter((question, index) => index < done || question.wordId !== wordId);
  return questions.length === test.questions.length ? test : { ...test, questions };
}

export interface MissedQuestion {
  question: TestQuestion;
  pick: TestPick;
}

export interface TestScore {
  correct: number;
  wrong: number;
  blank: number;
  /** correct + wrong + blank. */
  scored: number;
  /** Between 0 and 1. Zero when nothing was scored. */
  accuracy: number;
  missed: MissedQuestion[];
}

export function scoreTest(test: TestSession): TestScore {
  let correct = 0;
  let blank = 0;
  const missed: MissedQuestion[] = [];
  test.picks.forEach((pick, index) => {
    const question = test.questions[index]!;
    if (pick === question.correct) correct++;
    else {
      if (pick === 'blank') blank++;
      missed.push({ question, pick });
    }
  });
  const scored = test.picks.length;
  return { correct, wrong: scored - correct - blank, blank, scored, accuracy: scored === 0 ? 0 : correct / scored, missed };
}

/* ---------- Bringing a saved test back ---------- */

const KINDS: readonly Track[] = ['de_tr', 'tr_de', 'article'];
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function validOption(value: unknown, kind: Track): value is ChoiceOption {
  if (typeof value !== 'object' || value === null) return false;
  const option = value as Partial<ChoiceOption>;
  if (!isText(option.text)) return false;
  if (kind === 'article') return option.wordId === null && option.german === undefined;
  if (!isText(option.wordId)) return false;
  if (kind === 'de_tr') return option.german === undefined;
  const german = option.german;
  return typeof german === 'object' && german !== null && isText(german.lemma) && (german.article === null || ARTICLES.includes(german.article));
}

function validQuestion(value: unknown): value is TestQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const question = value as Partial<TestQuestion>;
  if (!isText(question.wordId) || !KINDS.includes(question.kind as Track) || !isText(question.prompt)) return false;
  if (!(question.detail === null || isText(question.detail))) return false;
  const kind = question.kind as Track;
  const options = question.options;
  if (!Array.isArray(options) || !options.every((option) => validOption(option, kind))) return false;
  if (kind === 'article' ? options.map((option) => option.text).join() !== ARTICLES.join() : options.length !== TRANSLATION_OPTIONS) return false;
  if (new Set(options.map((option) => option.text.toLocaleLowerCase('tr'))).size !== options.length) return false;
  return Number.isInteger(question.correct) && question.correct! >= 0 && question.correct! < options.length;
}

/** The settings a test was made with, which become the setup's again after it. */
function validSettings(value: unknown): value is PracticeSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Partial<PracticeSettings>;
  const scope = settings.scope;
  return (
    ['tr_de', 'de_tr', 'article', 'mixed'].includes(settings.mode as string) &&
    (settings.count === null || (Number.isInteger(settings.count) && settings.count! > 0)) &&
    typeof settings.includeFlagged === 'boolean' &&
    typeof scope === 'object' &&
    scope !== null &&
    typeof scope.all === 'boolean' &&
    typeof scope.favorites === 'boolean' &&
    typeof scope.difficult === 'boolean' &&
    Array.isArray(scope.groupIds) &&
    scope.groupIds.every((id) => typeof id === 'string')
  );
}

/** A saved test comes back only if it is whole. Questions still to come about a deleted word are left out. */
export function reviveTest(raw: unknown, activeIds: ReadonlySet<string>): TestSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<TestSession>;
  if (!isText(value.id) || !validSettings(value.settings)) return null;
  if (!Array.isArray(value.questions) || !value.questions.every(validQuestion)) return null;
  if (!Array.isArray(value.picks) || value.picks.length > value.questions.length) return null;
  // The question on screen is the next unanswered one, or the last answered one with its answer shown.
  const at = value.at === undefined ? value.picks.length : value.at;
  if (!Number.isInteger(at) || at < 0 || at > value.questions.length || (value.picks.length !== at && value.picks.length !== at + 1)) return null;
  const questions = value.questions;
  if (!value.picks.every((pick, index) => pick === 'blank' || (Number.isInteger(pick) && pick >= 0 && pick < questions[index]!.options.length))) return null;
  let test: TestSession = { id: value.id, settings: value.settings, questions, picks: value.picks, at };
  for (const wordId of new Set(questions.map((question) => question.wordId))) {
    if (!activeIds.has(wordId)) test = dropWord(test, wordId);
  }
  return test.questions.length > 0 ? test : null;
}
