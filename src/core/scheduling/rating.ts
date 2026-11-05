import type { Grade } from './fsrs';

/**
 * The whole rating policy, chosen by the app so a typed answer never needs a second tap:
 *
 *   not accepted by the answer rules, whatever the reason -> Again
 *   accepted after a hint                                 -> Hard
 *   accepted with no help                                 -> Good
 *
 * Easy is never given. A typed answer shows that something was recalled, not how effortless that
 * was, and guessing from speed would punish slow typing on a phone.
 */
export function gradeFor(correct: boolean, hinted: boolean): Grade {
  if (!correct) return 'again';
  return hinted ? 'hard' : 'good';
}
