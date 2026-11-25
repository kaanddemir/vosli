/**
 * The language a learner studies. It is never the interface language: that is a setting of the app's own text,
 * and the two never decide each other. Each learning language is a workspace of its own. Its words, collections
 * and sources are never compared with, merged into or linked to another language's.
 */
export type LearningLanguage = 'de' | 'en';

export const LEARNING_LANGUAGES: readonly LearningLanguage[] = ['de', 'en'];

export const isLearningLanguage = (value: unknown): value is LearningLanguage => LEARNING_LANGUAGES.includes(value as LearningLanguage);
