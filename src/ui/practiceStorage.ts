import type { LearningLanguage } from '../core/learningLanguage';
import type { CardDirection } from '../core/practice/cards';
import type { PracticeSettings } from '../core/practice/session';

const SETTINGS_KEY = 'vosli.practice-settings';
const SESSION_KEY = 'vosli.practice-session';
const REVIEW_SESSION_KEY = 'vosli.review-session';
const REVIEW_FLAGGED_KEY = 'vosli.review-include-flagged';
const STUDY_KEY = 'vosli.practice-study';
const CARD_SESSION_KEY = 'vosli.card-session';
const TEST_SESSION_KEY = 'vosli.test-session';

/**
 * Every saved round, session and choice belongs to one learning language, so a German test can never resume in the
 * English workspace or the other way round. German keeps the names it always had, so nothing saved before is lost.
 */
const keyFor = (key: string, language: LearningLanguage) => (language === 'de' ? key : `${key}.${language}`);

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
export const readSavedSettings = (language: LearningLanguage): unknown => read(() => localStorage, keyFor(SETTINGS_KEY, language));
export const saveSettings = (language: LearningLanguage, settings: PracticeSettings): void => write(() => localStorage, keyFor(SETTINGS_KEY, language), settings);

/** The open round, so a reload or a step away from the screen does not lose the learner's place. */
export const readSavedSession = (language: LearningLanguage): unknown => read(() => sessionStorage, keyFor(SESSION_KEY, language));
export const saveSession = (language: LearningLanguage, session: unknown): void => write(() => sessionStorage, keyFor(SESSION_KEY, language), session);

/** The open Smart Review session. Only the place in the list: every schedule is already on its card. */
export const readSavedReview = (language: LearningLanguage): unknown => read(() => sessionStorage, keyFor(REVIEW_SESSION_KEY, language));
export const saveReviewSession = (language: LearningLanguage, session: unknown): void => write(() => sessionStorage, keyFor(REVIEW_SESSION_KEY, language), session);

export const readReviewIncludeFlagged = (): boolean => read(() => localStorage, REVIEW_FLAGGED_KEY) === true;
export const saveReviewIncludeFlagged = (include: boolean): void => write(() => localStorage, REVIEW_FLAGGED_KEY, include);

/** How Free Practice studies: by typing answers, by typing what is heard, by looking through cards, or by choosing in a test; and which side cards show first. */
export type StudyMode = 'typed' | 'listen' | 'cards' | 'test';
export interface StudyChoice {
  study: StudyMode;
  direction: CardDirection;
}
export const DEFAULT_STUDY: StudyChoice = { study: 'typed', direction: 'de_tr' };

const STUDIES: readonly StudyMode[] = ['typed', 'listen', 'cards', 'test'];
/**
 * The ways each learning language can be studied. Both have recordings of their own, so both can be studied by ear;
 * a language added without recordings would leave listen out here, and never resume in it.
 */
const STUDIES_OF: Readonly<Record<LearningLanguage, readonly StudyMode[]>> = { de: STUDIES, en: STUDIES };
export const studiesFor = (language: LearningLanguage): readonly StudyMode[] => STUDIES_OF[language];

export function parseStudyChoice(value: unknown, language: LearningLanguage = 'de'): StudyChoice {
  if (typeof value !== 'object' || value === null) return DEFAULT_STUDY;
  const { study, direction } = value as Record<string, unknown>;
  const known = studiesFor(language).find((option) => option === study);
  return { study: known ?? 'typed', direction: direction === 'tr_de' ? 'tr_de' : 'de_tr' };
}

/** Kept apart from the typed settings, so a saved typed round reads exactly as before. */
export const readStudyChoice = (language: LearningLanguage): StudyChoice => parseStudyChoice(read(() => localStorage, keyFor(STUDY_KEY, language)), language);
export const saveStudyChoice = (language: LearningLanguage, choice: StudyChoice): void => write(() => localStorage, keyFor(STUDY_KEY, language), choice);

/** A card session lasts through a reload, like a typed round, and ends with the tab. */
export const readSavedCards = (language: LearningLanguage): unknown => read(() => sessionStorage, keyFor(CARD_SESSION_KEY, language));
export const saveCards = (language: LearningLanguage, session: unknown): void => write(() => sessionStorage, keyFor(CARD_SESSION_KEY, language), session);

/** An open test, its questions and answers so far, kept through a reload in this tab only. Never in the database. */
export const readSavedTest = (language: LearningLanguage): unknown => read(() => sessionStorage, keyFor(TEST_SESSION_KEY, language));
export const saveTest = (language: LearningLanguage, session: unknown): void => write(() => sessionStorage, keyFor(TEST_SESSION_KEY, language), session);
