import { describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import type { Evaluation, Track } from '../src/core/practice/answers';
import { applyGrade, createFsrsState, phaseOf, type FsrsState, type Grade } from '../src/core/scheduling/fsrs';
import { batchFrom, planReview, SESSION_SIZE, type PlanCard, type PlanWord } from '../src/core/scheduling/queue';
import { gradeFor } from '../src/core/scheduling/rating';
import { askItem, askedCount, createReviewSession, delayItem, dropItem, endSession, leaveFeedback, markReviewHint, MAX_ASKS, nextStep, recordAnswer, returningCount, RETURN_WINDOW_MS, reviveReviewSession, totalCount, verdictFor, type ReviewSession } from '../src/core/scheduling/reviewSession';
import { NO_DOUBT } from '../src/core/practice/answers';
import { T0 } from './support/fixtures';

const MIN = 60_000;
const DAY = 86_400_000;
const RIGHT: Evaluation = { result: 'correct', correct: true, note: null, other: null };
const WRONG: Evaluation = { result: 'wrong', correct: false, note: null, other: null };

const word = (id: string, article: Article | null = 'der', createdAt = T0): PlanWord => ({ id, lemma: id, article, meanings: [{ text: `${id}-tr` }], createdAt });

async function stateAfter(grades: Grade[]): Promise<FsrsState> {
  let state = await createFsrsState(T0);
  let at = T0;
  for (const grade of grades) {
    state = await applyGrade(state, grade, at);
    at = state.dueAt;
  }
  return state;
}
const REVIEW: Grade[] = ['good', 'good'];
const card = (wordId: string, track: Track, fsrs: FsrsState): PlanCard => ({ wordId, track, fsrs });
const at = (state: FsrsState, dueAt: number): FsrsState => ({ ...state, dueAt });

describe('rating rules', () => {
  it('maps every combination explicitly and never rewards a wrong answer', () => {
    expect(gradeFor(false, false)).toBe('again');
    expect(gradeFor(false, true)).toBe('again');
    expect(gradeFor(true, true)).toBe('hard');
    expect(gradeFor(true, false)).toBe('good');
  });
});

describe('scheduler phases, as used by the rules', () => {
  it('walks new, learning, review, relearning and back', async () => {
    const fresh = await createFsrsState(T0);
    expect(phaseOf(fresh)).toBe('new');
    const learning = await applyGrade(fresh, 'good', T0);
    expect(phaseOf(learning)).toBe('learning');
    expect(learning.dueAt - T0).toBe(10 * MIN);
    const review = await applyGrade(learning, 'good', learning.dueAt);
    expect(phaseOf(review)).toBe('review');
    const lapsed = await applyGrade(review, 'again', review.dueAt);
    expect(phaseOf(lapsed)).toBe('learning');
    expect(lapsed.state).toBe(3);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueAt - review.dueAt).toBe(10 * MIN);
    const back = await applyGrade(lapsed, 'good', lapsed.dueAt);
    expect(phaseOf(back)).toBe('review');
  });

  it('a first wrong answer returns sooner than a hinted one, which returns sooner than a clean one', async () => {
    const fresh = await createFsrsState(T0);
    const [again, hard, good] = await Promise.all((['again', 'hard', 'good'] as const).map((grade) => applyGrade(fresh, grade, T0)));
    expect(again!.dueAt).toBeLessThan(hard!.dueAt);
    expect(hard!.dueAt).toBeLessThan(good!.dueAt);
  });

  it('a hinted answer on a review card gives a shorter interval and no lapse', async () => {
    const review = await stateAfter(REVIEW);
    const [hard, good] = await Promise.all([applyGrade(review, 'hard', review.dueAt), applyGrade(review, 'good', review.dueAt)]);
    expect(hard.dueAt).toBeLessThan(good.dueAt);
    expect(hard.lapses).toBe(0);
    expect(phaseOf(hard)).toBe('review');
  });

  it('every step the rules can produce inside a session fits the return window', async () => {
    const states = [await createFsrsState(T0), await stateAfter(['again']), await stateAfter(['hard']), await stateAfter(['good']), await applyGrade(await stateAfter(REVIEW), 'again', T0 + 3 * DAY)];
    for (const state of states) {
      for (const grade of ['again', 'hard', 'good'] as const) {
        const now = Math.max(state.dueAt, state.lastReviewAt ?? 0);
        const next = await applyGrade(state, grade, now);
        if (phaseOf(next) === 'learning') expect(next.dueAt - now).toBeLessThanOrEqual(RETURN_WINDOW_MS);
      }
    }
  });

  it('a clock set back cannot break a review or move time backwards', async () => {
    const review = await stateAfter(REVIEW);
    const next = await applyGrade(review, 'good', review.lastReviewAt! - DAY);
    expect(next.lastReviewAt).toBeGreaterThanOrEqual(review.lastReviewAt!);
    expect(next.dueAt).toBeGreaterThan(review.lastReviewAt!);
  });
});

describe('what can be asked', () => {
  it('a word nobody has studied has no schedule and is simply new, once', () => {
    const plan = planReview({ words: [word('Apfel')], cards: [], now: T0 });
    expect(plan.due).toEqual([]);
    expect(plan.fresh).toEqual([{ wordId: 'Apfel', track: 'de_tr', kind: 'new', since: T0 }]);
  });

  it('introduces skills one at a time, in order, and only when the last has left learning', async () => {
    const w = word('Apfel');
    const review = at(await stateAfter(REVIEW), T0 + 5 * DAY);
    const learning = at(await stateAfter(['good']), T0 + 5 * MIN);
    expect(planReview({ words: [w], cards: [card('Apfel', 'de_tr', learning)], now: T0 }).fresh).toEqual([]);
    expect(planReview({ words: [w], cards: [card('Apfel', 'de_tr', review)], now: T0 }).fresh[0]?.track).toBe('tr_de');
    expect(planReview({ words: [w], cards: [card('Apfel', 'de_tr', review), card('Apfel', 'tr_de', review)], now: T0 }).fresh[0]?.track).toBe('article');
    expect(planReview({ words: [w], cards: [card('Apfel', 'de_tr', review), card('Apfel', 'tr_de', review), card('Apfel', 'article', review)], now: T0 }).fresh).toEqual([]);
  });

  it('does not introduce a skill while another of the same word is due', async () => {
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    const plan = planReview({ words: [word('Apfel')], cards: [card('Apfel', 'de_tr', due)], now: T0 });
    expect(plan.due).toHaveLength(1);
    expect(plan.fresh).toEqual([]);
  });

  it('treats each skill separately: a due article does not make the other skills due', async () => {
    const later = at(await stateAfter(REVIEW), T0 + 5 * DAY);
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    const plan = planReview({ words: [word('Apfel')], cards: [card('Apfel', 'article', due), card('Apfel', 'de_tr', later), card('Apfel', 'tr_de', later)], now: T0 });
    expect(plan.due.map((item) => item.track)).toEqual(['article']);
  });

  it('never makes an article card for a word without an article, and ignores one left behind', async () => {
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    const later = at(await stateAfter(REVIEW), T0 + 5 * DAY);
    const bare = word('danke', null);
    const plan = planReview({ words: [bare], cards: [card('danke', 'article', due), card('danke', 'de_tr', later), card('danke', 'tr_de', later)], now: T0 });
    expect(plan.due).toEqual([]);
    expect(plan.fresh).toEqual([]);
  });

  it('does not pull a future card in to fill space', async () => {
    const future = at(await stateAfter(REVIEW), T0 + MIN);
    expect(planReview({ words: [word('Apfel')], cards: [card('Apfel', 'de_tr', future), card('Apfel', 'tr_de', future), card('Apfel', 'article', future)], now: T0 })).toEqual({ due: [], fresh: [] });
  });

  it('counts a card due at this exact moment', async () => {
    const due = at(await stateAfter(REVIEW), T0);
    expect(planReview({ words: [word('Apfel')], cards: [card('Apfel', 'de_tr', due)], now: T0 }).due).toHaveLength(1);
  });

  it('skips a word with no entry at all: a deleted word is not among the words given', async () => {
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    expect(planReview({ words: [], cards: [card('gone', 'de_tr', due)], now: T0 })).toEqual({ due: [], fresh: [] });
  });

  it('a word with a doubtful article loses its article card and keeps the rest', async () => {
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    const cards = [card('Apfel', 'article', due), card('Apfel', 'de_tr', due)];
    const plan = planReview({ words: [word('Apfel')], cards, doubtOf: () => ({ article: true, offers: [] }), now: T0 });
    expect(plan.due.map((item) => item.track)).toEqual(['de_tr']);
  });

  it('leaves a word out when asked to, and includes it otherwise', () => {
    const words = [word('Apfel')];
    expect(planReview({ words, cards: [], leftOut: () => true, now: T0 }).fresh).toEqual([]);
    expect(planReview({ words, cards: [], leftOut: () => false, now: T0 }).fresh).toHaveLength(1);
  });
});

describe('building a session', () => {
  const none = () => 0.5;

  it('asks learning first, then the most overdue reviews, then new words', async () => {
    const review = await stateAfter(REVIEW);
    const learning = await stateAfter(['good']);
    const cards = [card('Old', 'de_tr', at(review, T0 - 9 * DAY)), card('Recent', 'de_tr', at(review, T0 - DAY)), card('Step', 'de_tr', at(learning, T0 - 1))];
    const batch = batchFrom(planReview({ words: [word('Old'), word('Recent'), word('Step'), word('Fresh')], cards, now: T0 }), none);
    expect(batch.map((item) => item.wordId)).toEqual(['Step', 'Old', 'Recent', 'Fresh']);
    expect(batch.map((item) => item.kind)).toEqual(['learning', 'review', 'review', 'new']);
  });

  it('asks one card per word, so the answer to one skill cannot give away another', async () => {
    const due = at(await stateAfter(REVIEW), T0 - DAY);
    const batch = batchFrom(planReview({ words: [word('Apfel')], cards: [card('Apfel', 'de_tr', due), card('Apfel', 'tr_de', due), card('Apfel', 'article', due)], now: T0 }), none);
    expect(batch).toHaveLength(1);
  });

  it('is finite, and takes the rest next time, with no limit on how often', async () => {
    const words = Array.from({ length: SESSION_SIZE * 2 + 5 }, (_, index) => word(`w${index}`));
    const batch = batchFrom(planReview({ words, cards: [], now: T0 }), none);
    expect(batch).toHaveLength(SESSION_SIZE);
    const learned = await stateAfter(REVIEW);
    const cards = batch.map((item) => card(item.wordId, item.track, at(learned, T0 + 5 * DAY)));
    const remaining = words.filter((entry) => !batch.some((item) => item.wordId === entry.id));
    const next = batchFrom(planReview({ words: remaining, cards, now: T0 }), none);
    expect(next).toHaveLength(SESSION_SIZE);
    expect(next.every((item) => !batch.some((earlier) => earlier.wordId === item.wordId))).toBe(true);
  });

  it('introduces older words first', () => {
    const batch = batchFrom(planReview({ words: [word('Newer', 'der', T0 + 5), word('Older', 'der', T0)], cards: [], now: T0 }), none);
    expect(batch.map((item) => item.wordId)).toEqual(['Older', 'Newer']);
  });

  it('is empty when there is nothing to do', () => {
    expect(batchFrom({ due: [], fresh: [] }, none)).toEqual([]);
  });
});

const items = (...ids: string[]) => ids.map((wordId) => ({ wordId, track: 'de_tr' as const, kind: 'new' as const, since: T0 }));
const open = (...ids: string[]) => createReviewSession('s', false, items(...ids));

function ask(session: ReviewSession, now = T0) {
  const step = nextStep(session, now);
  if (step.kind !== 'question') throw new Error(step.kind);
  return askItem(session, step.index);
}
const answer = (session: ReviewSession, due: number, now = T0, evaluation = RIGHT) => recordAnswer(session, 'x', evaluation, { status: 'saved', dueAt: due }, now);

describe('review session', () => {
  it('goes through the list and finishes when nothing returns', () => {
    let s = open('a', 'b');
    s = leaveFeedback(answer(ask(s), T0 + 5 * DAY));
    s = leaveFeedback(answer(ask(s), T0 + 5 * DAY));
    expect(nextStep(s, T0)).toEqual({ kind: 'finished' });
    expect(askedCount(s)).toBe(2);
    expect(returningCount(s)).toBe(0);
  });

  it('brings a card back only when the scheduler says so, not before', () => {
    let s = open('a');
    s = leaveFeedback(answer(ask(s), T0 + 10 * MIN));
    expect(nextStep(s, T0 + 9 * MIN)).toEqual({ kind: 'waiting', until: T0 + 10 * MIN, count: 1 });
    expect(nextStep(s, T0 + 10 * MIN)).toEqual({ kind: 'question', index: 0 });
  });

  it('never asks the same card twice in a row while it has time to run and others are waiting', () => {
    let s = open('a', 'b');
    s = leaveFeedback(answer(ask(s), T0 + MIN, T0, WRONG));
    expect(nextStep(s, T0 + 1000)).toEqual({ kind: 'question', index: 1 });
  });

  it('a card whose time has come goes before unasked ones', () => {
    let s = open('a', 'b');
    s = leaveFeedback(answer(ask(s), T0 + MIN));
    expect(nextStep(s, T0 + MIN)).toEqual({ kind: 'question', index: 0 });
  });

  it('a card scheduled beyond the session leaves it', () => {
    let s = open('a');
    s = leaveFeedback(answer(ask(s), T0 + RETURN_WINDOW_MS + 1));
    expect(nextStep(s, T0)).toEqual({ kind: 'finished' });
  });

  it('a card that keeps failing stops after a fixed number of answers, so a session always ends', () => {
    let s = open('a');
    let now = T0;
    for (let i = 0; i < MAX_ASKS; i++) {
      s = leaveFeedback(answer(ask(s, now), now + MIN, now, WRONG));
      now += MIN;
    }
    expect(s.items[0]!.attempts).toBe(MAX_ASKS);
    expect(nextStep(s, now + 60 * MIN)).toEqual({ kind: 'finished' });
  });

  it('counts the first answer as the outcome and keeps the last separately', () => {
    let s = open('a');
    s = leaveFeedback(answer(ask(s), T0 + MIN, T0, WRONG));
    s = answer(ask(s, T0 + MIN), T0 + 5 * DAY, T0 + MIN);
    expect(s.items[0]).toMatchObject({ first: 'wrong', last: 'clean', attempts: 2 });
  });

  it('records a hint as part of the answer', () => {
    let s = markReviewHint(ask(open('a')));
    expect(s.hinted).toBe(true);
    s = answer(s, T0 + 5 * DAY);
    expect(s.items[0]!.first).toBe('hinted');
    expect(s.answered?.hinted).toBe(true);
  });

  it('keeps a hint through a reload of the same question, so a reload cannot clear it from the rating', () => {
    const s = markReviewHint(ask(open('a')));
    expect(askItem(s, 0).hinted).toBe(true);
    const more = markReviewHint(markReviewHint(s));
    expect(askItem(more, 0)).toMatchObject({ hinted: true, hints: 3 });
    expect(reviveReviewSession(JSON.parse(JSON.stringify(more)))).toMatchObject({ hinted: true, hints: 3 });
    const { hints: _, ...older } = s;
    expect(reviveReviewSession(JSON.parse(JSON.stringify(older)))).toMatchObject({ hinted: true, hints: 1 });
  });

  it('more hint stages are still one hinted answer, and the rating is the same as for one', () => {
    const s = answer(markReviewHint(markReviewHint(markReviewHint(ask(open('a'))))), T0 + 5 * DAY);
    expect(s.answered?.hinted).toBe(true);
    expect(s.items[0]).toMatchObject({ first: 'hinted', attempts: 1 });
    expect(markReviewHint(s)).toBe(s);
  });

  it('starts the next question without the last one\'s hint', () => {
    let s = markReviewHint(markReviewHint(ask(open('a', 'b'))));
    s = leaveFeedback(answer(s, T0 + 5 * DAY));
    expect(s).toMatchObject({ hinted: false, hints: 0 });
    expect(ask(s)).toMatchObject({ hinted: false, hints: 0 });
    expect(askItem(markReviewHint(ask(open('a', 'b'))), 1)).toMatchObject({ hinted: false, hints: 0 });
  });

  it('ignores a second answer to the same question', () => {
    const once = answer(ask(open('a')), T0 + MIN);
    expect(recordAnswer(once, 'y', WRONG, { status: 'saved', dueAt: T0 }, T0)).toBe(once);
  });

  it('an answer that was not saved does not count, and the card leaves the session', () => {
    for (const status of ['conflict', 'failed'] as const) {
      const s = recordAnswer(ask(open('a', 'b')), 'x', RIGHT, { status }, T0);
      expect(s.answered?.save).toBe(status);
      expect(s.items[0]).toMatchObject({ attempts: 0, first: null, returnsAt: null, gone: true });
      expect(totalCount(s)).toBe(1);
    }
  });

  it('a dropped card leaves the progress unless it was already answered', () => {
    let s = open('a', 'b', 'c');
    s = leaveFeedback(answer(ask(s), T0 + MIN));
    s = dropItem(s, 0);
    s = dropItem(s, 1);
    expect(s.items[0]).toMatchObject({ attempts: 1, returnsAt: null });
    expect(totalCount(s)).toBe(2);
    expect(nextStep(s, T0)).toEqual({ kind: 'question', index: 2 });
  });

  it('dropping the card on screen clears its feedback and hint', () => {
    const s = dropItem(markReviewHint(ask(open('a', 'b'))), 0);
    expect(s).toMatchObject({ current: null, hinted: false, hints: 0, answered: null });
  });

  it('a card another tab answered waits for its new time', () => {
    const s = delayItem(open('a'), 0, T0 + 5 * MIN);
    expect(nextStep(s, T0)).toEqual({ kind: 'waiting', until: T0 + 5 * MIN, count: 1 });
  });

  it('ending keeps what was answered and stops asking', () => {
    const s = endSession(answer(ask(open('a', 'b')), T0 + MIN));
    expect(nextStep(s, T0 + 60 * MIN)).toEqual({ kind: 'finished' });
    expect(askedCount(s)).toBe(1);
    expect(returningCount(s)).toBe(1);
  });

  it('survives a trip through JSON', () => {
    const s = answer(markReviewHint(ask(open('a', 'b'))), T0 + MIN);
    expect(reviveReviewSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('refuses a damaged saved session', () => {
    const good = open('a');
    const damaged: unknown[] = [null, 4, 'x', {}, { ...good, id: 3 }, { ...good, items: [{ wordId: 1 }] }, { ...good, queue: [9] }, { ...good, current: 9 }, { ...good, items: [{ ...good.items[0], track: 'nope' }] }, { ...good, items: [{ ...good.items[0], returnsAt: 'soon' }] }];
    for (const value of damaged) expect(reviveReviewSession(value)).toBeNull();
  });
});

describe('checking a card before asking', () => {
  const w = word('Apfel');
  const base = { word: w, card: null, doubt: NO_DOUBT, leftOut: false };

  it('asks a new card', () => {
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, base, T0).kind).toBe('ask');
  });

  it('drops a deleted word, a word now left out, and a skill no longer possible', () => {
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, { ...base, word: null }, T0).kind).toBe('drop');
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, { ...base, leftOut: true }, T0).kind).toBe('drop');
    expect(verdictFor({ track: 'article', attempts: 0 }, { ...base, word: word('danke', null) }, T0).kind).toBe('drop');
    expect(verdictFor({ track: 'article', attempts: 0 }, { ...base, doubt: { article: true, offers: [] } }, T0).kind).toBe('drop');
  });

  it('asks a due card and passes over one already answered, which is what prevents a replay', async () => {
    const review = await stateAfter(REVIEW);
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, { ...base, card: { fsrs: at(review, T0) } }, T0).kind).toBe('ask');
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, { ...base, card: { fsrs: at(review, T0 + 5 * DAY) } }, T0).kind).toBe('drop');
  });

  it('a new card someone else has just started is not asked again', async () => {
    const learning = await stateAfter(['good']);
    expect(verdictFor({ track: 'de_tr', attempts: 0 }, { ...base, card: { fsrs: at(learning, T0 + 5 * MIN) } }, T0).kind).toBe('drop');
  });

  it('a returning card whose time moved waits for the stored time', async () => {
    const learning = await stateAfter(['good']);
    expect(verdictFor({ track: 'de_tr', attempts: 1 }, { ...base, card: { fsrs: at(learning, T0 + 5 * MIN) } }, T0)).toEqual({ kind: 'later', dueAt: T0 + 5 * MIN });
  });

  it('a returning card that lost its schedule, because its article changed, starts over later', () => {
    expect(verdictFor({ track: 'article', attempts: 1 }, base, T0).kind).toBe('drop');
  });
});
