import { describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import type { Evaluation } from '../src/core/practice/answers';
import { ALL_WORDS, buildRound, doubtFrom, findDifficult, questionableIssues, tracksFor, wordsInScope, type HistoryEntry, type PracticeMode, type RoundItem, type SelectableWord } from '../src/core/practice/selection';
import { createSession, currentItem, doneCount, dropWord, isFinished, markHintUsed, MAX_ATTEMPTS, nextQuestion, retriesWaiting, reviveSession, submitAnswer, summarize, type PracticeSettings, type Session } from '../src/core/practice/session';

const RIGHT: Evaluation = { result: 'correct', correct: true, note: null, other: null };
const WRONG: Evaluation = { result: 'wrong', correct: false, note: null, other: null };
const settings: PracticeSettings = { mode: 'tr_de', scope: ALL_WORDS, count: 20, includeFlagged: false };
const round = (...ids: string[]): RoundItem[] => ids.map((wordId) => ({ wordId, track: 'tr_de' }));
const start = (...ids: string[]) => createSession('s', settings, round(...ids));

/** Plays a round through, returning what was asked in order. */
function play(session: Session, answer: (wordId: string, attempt: number) => 'right' | 'wrong' | 'hinted', limit = 500) {
  let state = session;
  const asked: string[] = [];
  while (!isFinished(state) && asked.length < limit) {
    const item = currentItem(state)!;
    asked.push(item.wordId);
    const how = answer(item.wordId, item.attempts);
    if (how === 'hinted') state = markHintUsed(state);
    state = nextQuestion(submitAnswer(state, 'x', how === 'wrong' ? WRONG : RIGHT));
  }
  return { state, asked };
}

describe('same-session retries', () => {
  it('a wrong answer comes back after a few other questions', () => {
    const { asked } = play(start('a', 'b', 'c', 'd', 'e', 'f'), (id, attempt) => (id === 'a' && attempt === 0 ? 'wrong' : 'right'));
    expect(asked).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f']);
  });

  it('a correct answer does not come back', () => {
    const { asked } = play(start('a', 'b', 'c'), () => 'right');
    expect(asked).toEqual(['a', 'b', 'c']);
  });

  it('never repeats a question straight away, for any round size', () => {
    for (let size = 2; size <= 8; size++) {
      const ids = Array.from({ length: size }, (_, i) => `w${i}`);
      for (const pattern of [() => 'wrong', (_: string, n: number) => (n === 0 ? 'wrong' : 'right'), (_: string, n: number) => (n < 2 ? 'hinted' : 'right')] as const) {
        const { asked } = play(start(...ids), pattern as () => 'wrong');
        asked.forEach((id, index) => {
          if (index > 0) expect(id, asked.join()).not.toBe(asked[index - 1]);
        });
      }
    }
  });

  it('can never loop: a question is asked at most three times and the round ends', () => {
    for (let size = 1; size <= 10; size++) {
      const ids = Array.from({ length: size }, (_, i) => `w${i}`);
      const { state, asked } = play(start(...ids), () => 'wrong');
      expect(isFinished(state)).toBe(true);
      expect(asked.length).toBeLessThanOrEqual(size * MAX_ATTEMPTS);
      for (const id of ids) expect(asked.filter((seen) => seen === id).length).toBeLessThanOrEqual(MAX_ATTEMPTS);
    }
  });

  it('a question alone in its round simply ends rather than repeating at once', () => {
    const { state, asked } = play(start('only'), () => 'wrong');
    expect(asked).toEqual(['only']);
    expect(summarize(state)).toMatchObject({ total: 1, firstWrong: 1, unresolved: 1 });
  });

  it('the last question of a round still gets its retry, with an earlier one asked between', () => {
    const { asked } = play(start('a', 'b', 'c'), (id, attempt) => (id === 'c' && attempt === 0 ? 'wrong' : 'right'));
    expect(asked.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(asked.at(-1)).toBe('c');
    expect(asked).toHaveLength(5);
  });

  it('two words are enough to space out retries', () => {
    const { asked } = play(start('a', 'b'), (id, attempt) => (id === 'a' && attempt === 0 ? 'wrong' : 'right'));
    expect(asked).toEqual(['a', 'b', 'a']);
  });

  it('a correct answer after a hint is asked again, because it was not unaided', () => {
    const { state, asked } = play(start('a', 'b', 'c'), (id, attempt) => (id === 'a' && attempt === 0 ? 'hinted' : 'right'));
    expect(asked.filter((id) => id === 'a')).toHaveLength(2);
    expect(summarize(state)).toMatchObject({ firstClean: 2, firstHinted: 1, firstWrong: 0, recovered: 1, unresolved: 0 });
  });

  it('a hint belongs to one attempt only', () => {
    let state = markHintUsed(start('a', 'b'));
    expect(state.hinted).toBe(true);
    state = submitAnswer(state, 'x', RIGHT);
    expect(state.answered?.hinted).toBe(true);
    state = nextQuestion(state);
    expect(state.hinted).toBe(false);
  });
});

describe('progress and summary', () => {
  it('progress counts original questions, and retries are counted apart', () => {
    let state = start('a', 'b', 'c');
    expect(doneCount(state)).toBe(0);
    state = submitAnswer(state, 'x', WRONG);
    expect(doneCount(state)).toBe(1);
    expect(state.answered?.retry).toBe(false);
    expect(retriesWaiting(state)).toBe(1);
    state = nextQuestion(state);
    for (let i = 0; i < 2; i++) state = nextQuestion(submitAnswer(state, 'x', RIGHT));
    expect(doneCount(state)).toBe(3);
    expect(currentItem(state)?.wordId).toBe('a');
    state = submitAnswer(state, 'x', RIGHT);
    expect(state.answered?.retry).toBe(true);
    expect(doneCount(state)).toBe(3);
    expect(retriesWaiting(state)).toBe(0);
  });

  it('answering twice, or moving on without an answer, changes nothing', () => {
    const asked = start('a', 'b');
    expect(nextQuestion(asked)).toBe(asked);
    const once = submitAnswer(asked, 'x', WRONG);
    expect(submitAnswer(once, 'y', RIGHT)).toBe(once);
    expect(once.items[0]).toMatchObject({ attempts: 1, first: 'wrong' });
  });

  it('the summary keeps first tries apart from what repeats fixed', () => {
    const { state } = play(start('good', 'hint', 'fixed', 'stuck'), (id, attempt) => {
      if (id === 'good') return 'right';
      if (id === 'hint') return attempt === 0 ? 'hinted' : 'right';
      if (id === 'fixed') return attempt === 0 ? 'wrong' : 'right';
      return 'wrong';
    });
    const summary = summarize(state);
    expect(summary).toMatchObject({ total: 4, firstClean: 1, firstHinted: 1, firstWrong: 2, recovered: 2, unresolved: 1 });
    expect(summary.repeats).toBeGreaterThanOrEqual(4);
    expect(summary.toReview.map((item) => item.wordId).sort()).toEqual(['fixed', 'hint', 'stuck']);
  });

  it('a clean question asked again only as a spacer, then missed, is not hidden', () => {
    const { state } = play(start('a', 'b'), (id, attempt) => (id === 'b' && attempt === 0 ? 'wrong' : id === 'a' && attempt >= 1 ? 'wrong' : 'right'));
    expect(summarize(state)).toMatchObject({ firstClean: 1, unresolved: 1 });
    expect(summarize(state).toReview.map((item) => item.wordId)).toContain('a');
  });
});

describe('saved rounds', () => {
  const active = (...ids: string[]) => new Set(ids);

  it('survives a trip through JSON', () => {
    const state = submitAnswer(start('a', 'b', 'c'), 'x', WRONG);
    const revived = reviveSession(JSON.parse(JSON.stringify(state)), active('a', 'b', 'c'));
    expect(revived).toEqual(state);
  });

  it('a word deleted since then is gone, and the rest keep their progress', () => {
    const state = nextQuestion(submitAnswer(start('a', 'b', 'c'), 'x', WRONG));
    const revived = reviveSession(JSON.parse(JSON.stringify(state)), active('b', 'c'))!;
    expect(revived.items.map((item) => item.wordId)).toEqual(['b', 'c']);
    expect(currentItem(revived)?.wordId).toBe('b');
    const { asked } = play(revived, () => 'right');
    expect(asked).not.toContain('a');
  });

  it('deleting the word on screen clears its answer as well', () => {
    const state = dropWord(markHintUsed(submitAnswer(start('a', 'b'), 'x', WRONG)), 'a');
    expect(state.answered).toBeNull();
    expect(state.hinted).toBe(false);
    expect(currentItem(state)?.wordId).toBe('b');
  });

  it('nothing is left when every word is gone, and damaged data is refused', () => {
    expect(reviveSession(JSON.parse(JSON.stringify(start('a'))), active())).toBeNull();
    for (const bad of [null, 'x', {}, { id: 's', items: 'no', queue: [], settings }, { id: 's', items: [{ wordId: 'a', track: 'x', attempts: 0, first: null, last: null }], queue: [0], settings }, { id: 's', items: [], queue: [4], settings }]) {
      expect(reviveSession(bad, active('a'))).toBeNull();
    }
  });
});

const makeWord = (id: string, article: Article | null = null, favorite = false): SelectableWord => ({ id, lemma: id, article, meanings: [{ text: `${id} tr` }], favoritedAt: favorite ? 1 : null });
const sequence = (seed = 7) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
};

describe('modes', () => {
  const noun = makeWord('noun', 'der');
  const verb = makeWord('verb');

  it('each mode offers only what a word can honestly be asked', () => {
    expect(tracksFor(noun, 'tr_de')).toEqual(['tr_de']);
    expect(tracksFor(noun, 'de_tr')).toEqual(['de_tr']);
    expect(tracksFor(noun, 'article')).toEqual(['article']);
    expect(tracksFor(verb, 'article')).toEqual([]);
    expect(tracksFor(noun, 'mixed')).toEqual(['tr_de', 'de_tr', 'article']);
    expect(tracksFor(verb, 'mixed')).toEqual(['tr_de', 'de_tr']);
  });

  it('a disputed article is not asked about, while the word itself still can be', () => {
    const doubt = { article: true, offers: [] };
    expect(tracksFor(noun, 'article', doubt)).toEqual([]);
    expect(tracksFor(noun, 'mixed', doubt)).toEqual(['tr_de', 'de_tr']);
  });

  it('article rounds leave out words with no article', () => {
    const items = buildRound({ words: [noun, verb, makeWord('n2', 'die')], mode: 'article', count: null, history: [], doubtOf: () => ({ article: false, offers: [] }), random: sequence() });
    expect(items.map((item) => item.wordId).sort()).toEqual(['n2', 'noun']);
    expect(items.every((item) => item.track === 'article')).toBe(true);
  });

  it('mixed rounds keep the question types within one of each other, and ask each word once', () => {
    const words = Array.from({ length: 30 }, (_, i) => makeWord(`w${i}`, i % 3 === 0 ? null : 'das'));
    for (const seed of [3, 11, 29]) {
      const items = buildRound({ words, mode: 'mixed', count: 30, history: [], doubtOf: () => ({ article: false, offers: [] }), random: sequence(seed) });
      expect(new Set(items.map((item) => item.wordId)).size).toBe(30);
      const counts = (['tr_de', 'de_tr', 'article'] as const).map((track) => items.filter((item) => item.track === track).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it.each<PracticeMode>(['tr_de', 'de_tr', 'article', 'mixed'])('%s rounds respect the count and use real words only', (mode) => {
    const words = Array.from({ length: 12 }, (_, i) => makeWord(`w${i}`, 'der'));
    const items = buildRound({ words, mode, count: 5, history: [], doubtOf: () => ({ article: false, offers: [] }), random: sequence() });
    expect(items).toHaveLength(5);
    for (const item of items) expect(words.some((word) => word.id === item.wordId)).toBe(true);
  });

  it('rounds work through everything before repeating, and there is no limit on them', () => {
    const words = Array.from({ length: 9 }, (_, i) => makeWord(`w${i}`));
    const history: HistoryEntry[] = [];
    const seen: string[][] = [];
    for (let run = 0; run < 3; run++) {
      const items = buildRound({ words, mode: 'tr_de', count: 3, history, doubtOf: () => ({ article: false, offers: [] }), random: sequence(run + 1) });
      seen.push(items.map((item) => item.wordId));
      for (const item of items) history.push({ wordId: item.wordId, track: item.track, at: history.length + 1, result: 'correct', hintsUsed: 0 });
    }
    expect(new Set(seen.flat()).size).toBe(9);
    for (let run = 0; run < 50; run++) expect(buildRound({ words, mode: 'tr_de', count: 3, history, doubtOf: () => ({ article: false, offers: [] }), random: sequence(run + 1) })).toHaveLength(3);
  });

  it('a new round does not open with the question that just ended the last one', () => {
    const words = [makeWord('a'), makeWord('b')];
    for (let seed = 1; seed < 30; seed++) {
      const items = buildRound({ words, mode: 'tr_de', count: null, history: [], doubtOf: () => ({ article: false, offers: [] }), random: sequence(seed), lastAsked: { wordId: 'a', track: 'tr_de' } });
      expect(items[0]!.wordId).toBe('b');
    }
  });
});

describe('scope', () => {
  const words = [makeWord('a', null, true), makeWord('b'), makeWord('c'), makeWord('d')];
  const members = [{ groupId: 'g1', wordId: 'b' }, { groupId: 'g2', wordId: 'b' }, { groupId: 'g2', wordId: 'c' }, { groupId: 'g1', wordId: 'gone' }];
  const ids = (scope: Parameters<typeof wordsInScope>[1], difficult: ReadonlySet<string> = new Set()) => wordsInScope(words, scope, members, difficult).map((word) => word.id);
  const none = { all: false, favorites: false, difficult: false, groupIds: [] as string[] };

  it('all means all', () => {
    expect(ids(ALL_WORDS)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('a word in two chosen collections appears once', () => {
    expect(ids({ ...none, groupIds: ['g1', 'g2'] })).toEqual(['b', 'c']);
  });
  it('favorites and difficult words join what else is chosen', () => {
    expect(ids({ ...none, favorites: true })).toEqual(['a']);
    expect(ids({ ...none, difficult: true }, new Set(['d']))).toEqual(['d']);
    expect(ids({ ...none, favorites: true, difficult: true, groupIds: ['g2'] }, new Set(['d']))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('a member that is not an active word never appears', () => {
    expect(ids({ ...none, groupIds: ['g1'] })).not.toContain('gone');
  });
});

describe('difficult words', () => {
  const entry = (wordId: string, result: HistoryEntry['result'], hintsUsed = 0, retry = false): HistoryEntry => ({ wordId, track: 'tr_de', at: 1, result, hintsUsed, retry });

  it('there is no difficulty information without history', () => {
    expect(findDifficult([]).size).toBe(0);
  });
  it('the latest try being wrong or hinted makes a word difficult', () => {
    expect(findDifficult([entry('a', 'correct'), entry('a', 'wrong')]).has('a')).toBe(true);
    expect(findDifficult([entry('b', 'correct', 1)]).has('b')).toBe(true);
  });
  it('a clean answer clears one miss but not two', () => {
    expect(findDifficult([entry('a', 'wrong'), entry('a', 'correct')]).has('a')).toBe(false);
    expect(findDifficult([entry('a', 'wrong'), entry('a', 'typo'), entry('a', 'correct')]).has('a')).toBe(true);
  });
  it('old misses fall out of the window', () => {
    expect(findDifficult([entry('a', 'wrong'), entry('a', 'wrong'), ...Array.from({ length: 5 }, () => entry('a', 'correct'))]).has('a')).toBe(false);
  });
  it('a repeat in a session does not count either way', () => {
    expect(findDifficult([entry('a', 'correct'), entry('a', 'wrong', 0, true)]).has('a')).toBe(false);
    expect(findDifficult([entry('a', 'wrong'), entry('a', 'correct', 0, true)]).has('a')).toBe(true);
  });
});

describe('dictionary warnings', () => {
  it('a missing article is not a doubt about what the word teaches', () => {
    expect(questionableIssues([{ code: 'article_missing', suggestions: [] }])).toEqual([]);
    expect(questionableIssues([{ code: 'article_wrong', suggestions: [] }, { code: 'spelling', suggestions: [] }])).toHaveLength(2);
  });
  it('only article warnings take the article out of a question', () => {
    expect(doubtFrom([]).article).toBe(false);
    expect(doubtFrom([{ code: 'spelling', suggestions: [{ german: 'x', article: null }] }])).toEqual({ article: false, offers: [{ german: 'x', article: null }] });
    for (const code of ['article_wrong', 'article_sense', 'not_a_noun'] as const) expect(doubtFrom([{ code, suggestions: [] }]).article).toBe(true);
  });
});
