import { stripClosingPunctuation, type Article } from './identity';

/**
 * What the dictionary can honestly say about one entry. It only ever advises: nothing here changes a
 * word, and a word it does not know is not a wrong word. Turkish is used in one way only, as positive
 * evidence for which sense of a word with several genders is meant. Translations in general are not
 * judged, because the data has Turkish for too few words to call anything wrong.
 */
export type ValidationStatus = 'verified' | 'mismatch' | 'multiple' | 'not_found' | 'unchecked';
export type IssueCode = 'article_wrong' | 'article_sense' | 'article_missing' | 'not_a_noun' | 'capitalization' | 'spelling' | 'old_spelling';

export interface Suggestion {
  german: string;
  article: Article | null;
}

export interface Issue {
  code: IssueCode;
  suggestions: Suggestion[];
}

/** Background for the row's details. Never a warning. */
export type ValidationNote = { kind: 'articles'; articles: Article[] } | { kind: 'inflected'; of: string } | { kind: 'compound'; head: string } | { kind: 'plural' };

export interface Validation {
  status: ValidationStatus;
  issues: Issue[];
  note: ValidationNote | null;
}

export const UNCHECKED: Validation = { status: 'unchecked', issues: [], note: null };

/** What a person's "this is fine" is about: this issue on exactly this text. Other text may warn again. */
export const dismissalKey = (code: IssueCode, german: string, article: string): string => `dict:${code}|${article.trim().toLocaleLowerCase('de')}|${stripClosingPunctuation(german)}`;
export const isDismissalKey = (key: string): boolean => key.startsWith('dict:');

export function openIssues(validation: Validation, german: string, article: string, dismissed: ReadonlySet<string> | readonly string[]): Issue[] {
  const has = (key: string) => (dismissed instanceof Set ? dismissed.has(key) : (dismissed as readonly string[]).includes(key));
  return validation.issues.filter((item) => !has(dismissalKey(item.code, german, article)));
}
