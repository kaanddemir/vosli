/**
 * Studying with cards: one word at a time, both sides together, moved through freely. Nothing here
 * asks, scores or schedules anything. It is plain data with pure changes, so it can be tested without
 * a screen and survive a reload, and it never touches the typed-answer engine.
 */
export type CardDirection = 'de_tr' | 'tr_de';

export interface CardSession {
  id: string;
  direction: CardDirection;
  /** The second side starts covered. Each card is uncovered on its own, on the screen. */
  hidden: boolean;
  wordIds: string[];
  /** The card on screen. Equal to wordIds.length once every card has been seen. */
  index: number;
}

export function createCardSession(id: string, direction: CardDirection, wordIds: readonly string[]): CardSession {
  return { id, direction, hidden: false, wordIds: [...new Set(wordIds)], index: 0 };
}

export const currentCard = (session: CardSession): string | null => session.wordIds[session.index] ?? null;
export const isCardsFinished = (session: CardSession): boolean => session.index >= session.wordIds.length;

/** Forward may step past the last card, onto the end. Back stops at the first. */
export function moveCard(session: CardSession, delta: -1 | 1): CardSession {
  const index = Math.min(Math.max(session.index + delta, 0), session.wordIds.length);
  return index === session.index ? session : { ...session, index };
}

export const restartCards = (session: CardSession): CardSession => ({ ...session, index: 0 });

/**
 * A word deleted during the session leaves it. The card on screen stays the same one where it can,
 * and the position moves back with the cards that went before it.
 */
export function dropCard(session: CardSession, wordId: string): CardSession {
  const at = session.wordIds.indexOf(wordId);
  if (at === -1) return session;
  const wordIds = session.wordIds.filter((id) => id !== wordId);
  return { ...session, wordIds, index: at < session.index ? session.index - 1 : Math.min(session.index, wordIds.length) };
}

/** A saved session comes back only if it is whole, and without words deleted since. */
export function reviveCardSession(saved: unknown, activeIds: ReadonlySet<string>): CardSession | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const value = saved as Partial<CardSession>;
  if (typeof value.id !== 'string' || !Array.isArray(value.wordIds) || typeof value.index !== 'number' || !Number.isInteger(value.index)) return null;
  if (value.direction !== 'de_tr' && value.direction !== 'tr_de') return null;
  let session: CardSession = { id: value.id, direction: value.direction, hidden: value.hidden === true, wordIds: value.wordIds.filter((id): id is string => typeof id === 'string'), index: Math.min(Math.max(value.index, 0), value.wordIds.length) };
  for (const id of [...session.wordIds]) if (!activeIds.has(id)) session = dropCard(session, id);
  return session.wordIds.length > 0 ? session : null;
}
