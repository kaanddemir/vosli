import { isLearningLanguage, type LearningLanguage } from '../core/learningLanguage';
import type { AppDatabase } from './db';
import type { Onboarding } from './types';

/**
 * Two records in meta that belong together: which learning language is active, and how that was settled. Both are
 * learning data, so a backup carries them and a reset removes them. The interface language is not here: it is a
 * setting of this device, kept in localStorage.
 */
export const LEARNING_LANGUAGE_KEY = 'learningLanguage';
export const ONBOARDING_KEY = 'onboarding';

const ONBOARDING_VIA: ReadonlySet<string> = new Set<Onboarding['via']>(['legacy', 'default', 'welcome', 'restore']);

export function isOnboarding(value: unknown): value is Onboarding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { via, at } = value as Record<string, unknown>;
  return typeof via === 'string' && ONBOARDING_VIA.has(via) && typeof at === 'number' && Number.isFinite(at);
}

/** The records to write together, in one transaction. */
export const learningMetaEntries = (language: LearningLanguage, onboarding: Onboarding) => [
  { key: LEARNING_LANGUAGE_KEY, value: language },
  { key: ONBOARDING_KEY, value: onboarding },
];

/** The stored learning language. Anything missing or unknown reads as German, the only one there was before. */
export async function readLearningLanguage(db: AppDatabase): Promise<LearningLanguage> {
  const entry = await db.meta.get(LEARNING_LANGUAGE_KEY);
  return isLearningLanguage(entry?.value) ? entry.value : 'de';
}

export async function readOnboarding(db: AppDatabase): Promise<Onboarding | null> {
  const entry = await db.meta.get(ONBOARDING_KEY);
  return isOnboarding(entry?.value) ? entry.value : null;
}

/** Switches the active workspace. How the first choice was made stays as it was. */
export async function saveLearningLanguage(db: AppDatabase, language: LearningLanguage): Promise<void> {
  await db.meta.put({ key: LEARNING_LANGUAGE_KEY, value: language });
}

/**
 * The first-start choice: the learning language and the record that it was made, together or not at all. A database
 * that already has a record keeps it, so a second tab finishing the same welcome changes nothing that is settled.
 */
export async function completeOnboarding(db: AppDatabase, language: LearningLanguage, now: number): Promise<Onboarding> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await readOnboarding(db);
    if (existing) return existing;
    const onboarding: Onboarding = { via: 'welcome', at: now };
    await db.meta.bulkPut(learningMetaEntries(language, onboarding));
    return onboarding;
  });
}
