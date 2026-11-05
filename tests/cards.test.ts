import { describe, expect, it } from 'vitest';
import { createCardSession, currentCard, dropCard, isCardsFinished, moveCard, restartCards, reviveCardSession } from '../src/core/practice/cards';
import { DEFAULT_STUDY, parseStudyChoice } from '../src/ui/practiceStorage';

const session = () => createCardSession('s', 'de_tr', ['a', 'b', 'c']);

describe('card study session', () => {
  it('starts on the first card, uncovered, with each word once', () => {
    expect(createCardSession('s', 'tr_de', ['a', 'b', 'a'])).toEqual({ id: 's', direction: 'tr_de', hidden: false, wordIds: ['a', 'b'], index: 0 });
  });

  it('moves freely, stops at the first card, and steps past the last onto the end', () => {
    let current = session();
    expect(moveCard(current, -1)).toBe(current);
    current = moveCard(moveCard(current, 1), 1);
    expect(currentCard(current)).toBe('c');
    current = moveCard(current, 1);
    expect(isCardsFinished(current)).toBe(true);
    expect(currentCard(current)).toBeNull();
    expect(moveCard(current, 1)).toBe(current);
    expect(currentCard(moveCard(current, -1))).toBe('c');
    expect(restartCards(current).index).toBe(0);
  });

  it('drops a deleted word and keeps the place', () => {
    const onB = moveCard(session(), 1);
    expect(currentCard(dropCard(onB, 'a'))).toBe('b');
    expect(currentCard(dropCard(onB, 'b'))).toBe('c');
    expect(currentCard(dropCard(onB, 'c'))).toBe('b');
    const onC = moveCard(onB, 1);
    expect(isCardsFinished(dropCard(onC, 'c'))).toBe(true);
    expect(dropCard(onB, 'x')).toBe(onB);
  });

  it('revives only a whole saved session, without words deleted since', () => {
    const saved = { ...moveCard(session(), 1), hidden: true };
    expect(reviveCardSession(saved, new Set(['a', 'b', 'c']))).toEqual(saved);
    expect(reviveCardSession(saved, new Set(['b', 'c']))).toMatchObject({ wordIds: ['b', 'c'], index: 0, hidden: true });
    expect(reviveCardSession(saved, new Set())).toBeNull();
    expect(reviveCardSession({ ...saved, direction: 'sideways' }, new Set(['a']))).toBeNull();
    expect(reviveCardSession('x', new Set(['a']))).toBeNull();
    expect(reviveCardSession({ ...saved, index: 99 }, new Set(['a', 'b', 'c']))?.index).toBe(3);
  });
});

describe('study choice', () => {
  it('defaults to typed practice, German first for cards', () => {
    expect(parseStudyChoice(null)).toEqual(DEFAULT_STUDY);
    expect(DEFAULT_STUDY).toEqual({ study: 'typed', direction: 'de_tr' });
    expect(parseStudyChoice({ study: 'cards', direction: 'tr_de' })).toEqual({ study: 'cards', direction: 'tr_de' });
    expect(parseStudyChoice({ study: 'flip', direction: 1 })).toEqual(DEFAULT_STUDY);
  });
});
