import { describe, expect, it } from 'vitest';
import type { TestQuestion } from '../src/core/practice/choices';
import { ALL_WORDS } from '../src/core/practice/selection';
import type { PracticeSettings } from '../src/core/practice/session';
import { createTest, currentQuestion, dropWord, isTestFinished, leaveBlank, nextTestQuestion, reviveTest, scoreTest, shownPick, submitPick, testHasProgress, type TestPick, type TestSession } from '../src/core/practice/test';

const settings: PracticeSettings = { mode: 'mixed', scope: ALL_WORDS, count: 10, includeFlagged: false };

const translation = (wordId: string, correct = 0): TestQuestion => ({
  wordId,
  kind: 'de_tr',
  prompt: `das ${wordId}`,
  detail: null,
  options: ['a', 'b', 'c', 'd'].map((letter) => ({ text: `${wordId}-${letter}`, wordId: `${wordId}${letter}` })),
  correct,
});
const german = (wordId: string, correct = 1): TestQuestion => ({
  wordId,
  kind: 'tr_de',
  prompt: `${wordId} anlamı`,
  detail: null,
  options: ['Apfel', 'Birne', 'Tisch', 'Stuhl'].map((lemma) => ({ text: `der ${lemma}`, wordId: lemma, german: { article: 'der' as const, lemma } })),
  correct,
});
const article = (wordId: string): TestQuestion => ({ wordId, kind: 'article', prompt: wordId, detail: 'elma', options: ['der', 'die', 'das'].map((text) => ({ text, wordId: null })), correct: 0 });

const start = (...questions: TestQuestion[]) => createTest('t1', settings, questions);
/** Answers the question on screen and moves on, as Cevapla then Sonraki soru do. */
const go = (test: TestSession, pick: TestPick) => nextTestQuestion(pick === 'blank' ? leaveBlank(test, test.at) : submitPick(test, test.at, pick), test.at);
/** Through JSON and back, as a reload does. */
const reload = (test: TestSession, active = ['a', 'b', 'c', 'd']) => reviveTest(JSON.parse(JSON.stringify(test)), new Set(active));

describe('answering', () => {
  it('starts on the first question, with nothing answered', () => {
    const test = start(translation('a'), german('b'), article('c'));
    expect(currentQuestion(test)?.wordId).toBe('a');
    expect(shownPick(test)).toBeNull();
    expect(isTestFinished(test)).toBe(false);
    expect(testHasProgress(test)).toBe(false);
  });

  it('a right answer stays on screen, shown, until the learner moves on', () => {
    let test = start(translation('a', 2), german('b'));
    test = submitPick(test, 0, 2);
    expect(test.picks).toEqual([2]);
    expect(currentQuestion(test)?.wordId).toBe('a');
    expect(shownPick(test)).toBe(2);
    expect(shownPick(test)).toBe(currentQuestion(test)!.correct);
    expect(testHasProgress(test)).toBe(true);
    test = nextTestQuestion(test, 0);
    expect(currentQuestion(test)?.wordId).toBe('b');
    expect(shownPick(test)).toBeNull();
  });

  it('a wrong answer is shown the same way, and cannot be changed once given', () => {
    let test = start(translation('a', 0), german('b'));
    test = submitPick(test, 0, 3);
    expect(shownPick(test)).toBe(3);
    expect(submitPick(test, 0, 0)).toBe(test);
    expect(leaveBlank(test, 0)).toBe(test);
    expect(scoreTest(test)).toMatchObject({ correct: 0, wrong: 1 });
  });

  it('a blank is an answer: the right one is then shown, and it cannot be changed', () => {
    let test = start(translation('a'), german('b'));
    test = leaveBlank(test, 0);
    expect(test.picks).toEqual(['blank']);
    expect(shownPick(test)).toBe('blank');
    expect(submitPick(test, 0, 0)).toBe(test);
    test = nextTestQuestion(test, 0);
    expect(currentQuestion(test)?.wordId).toBe('b');
  });

  it('cannot move on before answering, and a double press moves on once', () => {
    let test = start(translation('a'), german('b'), article('c'));
    expect(nextTestQuestion(test, 0)).toBe(test);
    test = nextTestQuestion(submitPick(test, 0, 1), 0);
    expect(nextTestQuestion(test, 0)).toBe(test);
    expect(test.at).toBe(1);
  });

  it('ignores answers for another question, and answers out of range', () => {
    const test = start(translation('a'), german('b'));
    expect(submitPick(test, 1, 0)).toBe(test);
    expect(submitPick(test, 0, 4)).toBe(test);
    expect(submitPick(test, 0, -1)).toBe(test);
    expect(submitPick(test, 0, 1.5)).toBe(test);
  });

  it('the last question shows its answer too, and only moving on finishes the test', () => {
    let test = go(start(translation('a'), article('b')), 0);
    test = submitPick(test, 1, 2);
    expect(isTestFinished(test)).toBe(false);
    expect(shownPick(test)).toBe(2);
    // Leaving now would still lose the test, so it still asks.
    expect(testHasProgress(test)).toBe(true);
    test = nextTestQuestion(test, 1);
    expect(isTestFinished(test)).toBe(true);
    expect(currentQuestion(test)).toBeNull();
    expect(testHasProgress(test)).toBe(false);
    expect(submitPick(test, 2, 0)).toBe(test);
    expect(nextTestQuestion(test, 2)).toBe(test);
  });
});

describe('scoring', () => {
  it('counts right, wrong and blank, and lists what was missed with what was chosen', () => {
    let test = start(translation('a', 0), german('b', 1), article('c'), translation('d', 3));
    for (const pick of [0, 2, 'blank', 3] as const) test = go(test, pick);
    const score = scoreTest(test);
    expect(score).toMatchObject({ correct: 2, wrong: 1, blank: 1, scored: 4, accuracy: 0.5 });
    expect(score.missed.map(({ question, pick }) => [question.wordId, pick])).toEqual([['b', 2], ['c', 'blank']]);
    expect(score.missed[0]!.question.options[score.missed[0]!.question.correct]!.text).toBe('der Birne');
  });

  it('scores nothing answered as nothing, without dividing by zero', () => {
    expect(scoreTest(start(translation('a')))).toMatchObject({ correct: 0, wrong: 0, blank: 0, scored: 0, accuracy: 0, missed: [] });
  });

  it('scores only the questions answered', () => {
    const test = go(start(translation('a'), translation('b'), translation('c')), 0);
    expect(scoreTest(test)).toMatchObject({ correct: 1, scored: 1, accuracy: 1 });
    // An answer on screen counts already: it can no longer change.
    expect(scoreTest(submitPick(test, 1, 2))).toMatchObject({ correct: 1, wrong: 1, scored: 2 });
  });
});

describe('a deleted word', () => {
  it('leaves the questions still to come, and keeps the answers already given', () => {
    let test = start(translation('a'), german('b'), article('a'), translation('c'));
    test = go(test, 1);
    test = dropWord(test, 'a');
    expect(test.questions.map((question) => question.wordId)).toEqual(['a', 'b', 'c']);
    expect(test.picks).toEqual([1]);
    expect(currentQuestion(test)?.wordId).toBe('b');
    expect(dropWord(test, 'zzz')).toBe(test);
  });

  it('keeps an answered question on screen, even if its word is deleted while its answer is shown', () => {
    const test = dropWord(submitPick(start(translation('a'), german('b')), 0, 2), 'a');
    expect(currentQuestion(test)?.wordId).toBe('a');
    expect(shownPick(test)).toBe(2);
  });
});

describe('a reload', () => {
  it('brings back the same questions, options, order and answers', () => {
    let test = start(translation('a', 2), german('b', 3), article('c'), translation('d', 1));
    test = go(go(test, 2), 'blank');
    const back = reload(test)!;
    expect(back).toEqual(test);
    expect(currentQuestion(back)?.wordId).toBe('c');
    expect(scoreTest(back)).toEqual(scoreTest(test));
  });

  it('brings back an answer on screen as shown, and it still cannot be answered twice', () => {
    const test = submitPick(go(start(translation('a'), german('b', 3), article('c')), 0), 1, 0);
    const back = reload(test)!;
    expect(currentQuestion(back)?.wordId).toBe('b');
    expect(shownPick(back)).toBe(0);
    expect(submitPick(back, 1, 3)).toBe(back);
    expect(nextTestQuestion(back, 1).at).toBe(2);
  });

  it('reads a test saved before the place on screen was kept as its next question', () => {
    const { at: _ignored, ...older } = go(start(translation('a'), german('b')), 0);
    const back = reviveTest(JSON.parse(JSON.stringify(older)), new Set(['a', 'b']))!;
    expect(back.at).toBe(1);
    expect(shownPick(back)).toBeNull();
  });

  it('brings back a finished test, so its results survive a reload too', () => {
    const test = go(start(translation('a')), 3);
    const back = reload(test)!;
    expect(isTestFinished(back)).toBe(true);
    expect(scoreTest(back).wrong).toBe(1);
  });

  it('leaves out questions still to come about words deleted since, and gives up when none are left', () => {
    const test = go(start(translation('a'), german('b'), translation('c')), 0);
    const back = reload(test, ['a', 'c'])!;
    expect(back.questions.map((question) => question.wordId)).toEqual(['a', 'c']);
    expect(reload(start(translation('a')), [])).toBeNull();
    // An answered question stays, even if its word is gone.
    expect(reload(test, ['b', 'c'])!.questions.map((question) => question.wordId)).toEqual(['a', 'b', 'c']);
  });

  it('rejects anything damaged or from another shape, rather than guessing', () => {
    const good = JSON.parse(JSON.stringify(go(start(translation('a'), german('b'), article('c')), 1))) as Record<string, unknown>;
    const ids = new Set(['a', 'b', 'c']);
    const broken = (change: (value: any) => void) => {
      const copy = JSON.parse(JSON.stringify(good));
      change(copy);
      return reviveTest(copy, ids);
    };
    expect(reviveTest(good, ids)).not.toBeNull();
    expect(reviveTest(null, ids)).toBeNull();
    expect(reviveTest('test', ids)).toBeNull();
    expect(broken((value) => delete value.id)).toBeNull();
    expect(broken((value) => (value.settings = null))).toBeNull();
    expect(broken((value) => (value.settings.mode = 'listen'))).toBeNull();
    expect(broken((value) => (value.settings.scope = {}))).toBeNull();
    expect(broken((value) => (value.questions = {}))).toBeNull();
    expect(broken((value) => (value.questions[0].kind = 'listen'))).toBeNull();
    expect(broken((value) => (value.questions[0].correct = 4))).toBeNull();
    expect(broken((value) => value.questions[0].options.pop())).toBeNull();
    expect(broken((value) => (value.questions[0].options[1].text = value.questions[0].options[0].text))).toBeNull();
    expect(broken((value) => (value.questions[0].options[0].text = '  '))).toBeNull();
    expect(broken((value) => (value.questions[1].options[0].german = undefined))).toBeNull();
    expect(broken((value) => (value.questions[2].options = [{ text: 'der', wordId: null }, { text: 'das', wordId: null }, { text: 'die', wordId: null }]))).toBeNull();
    expect(broken((value) => (value.questions[2].options[0].wordId = 'x'))).toBeNull();
    expect(broken((value) => (value.picks = [7]))).toBeNull();
    expect(broken((value) => (value.picks = ['skip']))).toBeNull();
    expect(broken((value) => (value.picks = [0, 0, 0, 0]))).toBeNull();
    // The place on screen must agree with the answers: on the next question, or on the last one answered.
    expect(broken((value) => (value.at = 0))).not.toBeNull();
    expect(broken((value) => (value.at = 2))).toBeNull();
    expect(broken((value) => (value.at = -1))).toBeNull();
    expect(broken((value) => (value.at = 'one'))).toBeNull();
  });
});
