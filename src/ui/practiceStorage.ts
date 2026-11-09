import type { CardDirection } from '../core/practice/cards';
import type { PracticeSettings } from '../core/practice/session';

const SETTINGS_KEY = 'vosli.practice-settings';
const SESSION_KEY = 'vosli.practice-session';
const REVIEW_SESSION_KEY = 'vosli.review-session';
const REVIEW_FLAGGED_KEY = 'vosli.review-include-flagged';
const STUDY_KEY = 'vosli.practice-study';
const CARD_SESSION_KEY = 'vosli.card-session';

/** A private window can refuse storage. Practice must work the same, only without remembering. */
function read(storage: () => Storage, key: string): unknown {
  try {
    const text = storage().getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    /* Not remembered, which is fine. */
  }
}

/** The last choices on this device. Kept out of the database, so backups stay about learning data. */
export const readSavedSettings = (): unknown => read(() => localStorage, SETTINGS_KEY);
export const saveSettings = (settings: PracticeSettings): void => write(() => localStorage, SETTINGS_KEY, settings);

/** The open round, so a reload or a step away from the screen does not lose the learner's place. */
export const readSavedSession = (): unknown => read(() => sessionStorage, SESSION_KEY);
export const saveSession = (session: unknown): void => write(() => sessionStorage, SESSION_KEY, session);

/** The open Smart Review session. Only the place in the list: every schedule is already on its card. */
export const readSavedReview = (): unknown => read(() => sessionStorage, REVIEW_SESSION_KEY);
export const saveReviewSession = (session: unknown): void => write(() => sessionStorage, REVIEW_SESSION_KEY, session);

export const readReviewIncludeFlagged = (): boolean => read(() => localStorage, REVIEW_FLAGGED_KEY) === true;
export const saveReviewIncludeFlagged = (include: boolean): void => write(() => localStorage, REVIEW_FLAGGED_KEY, include);

/** How Free Practice studies: by typing answers, by looking through cards, or by typing what is heard; and which side cards show first. */
export type StudyMode = 'typed' | 'cards' | 'listen';
export interface StudyChoice {
  study: StudyMode;
  direction: CardDirection;
}
export const DEFAULT_STUDY: StudyChoice = { study: 'typed', direction: 'de_tr' };

export function parseStudyChoice(value: unknown): StudyChoice {
  if (typeof value !== 'object' || value === null) return DEFAULT_STUDY;
  const { study, direction } = value as Record<string, unknown>;
  return { study: study === 'cards' || study === 'listen' ? study : 'typed', direction: direction === 'tr_de' ? 'tr_de' : 'de_tr' };
}

/** Kept apart from the typed settings, so a saved typed round reads exactly as before. */
export const readStudyChoice = (): StudyChoice => parseStudyChoice(read(() => localStorage, STUDY_KEY));
export const saveStudyChoice = (choice: StudyChoice): void => write(() => localStorage, STUDY_KEY, choice);

/** A card session lasts through a reload, like a typed round, and ends with the tab. */
export const readSavedCards = (): unknown => read(() => sessionStorage, CARD_SESSION_KEY);
export const saveCards = (session: unknown): void => write(() => sessionStorage, CARD_SESSION_KEY, session);
