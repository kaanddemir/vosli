import type { Article } from '../identity';
import { lemmasOf, meaningKeysOf, type Track } from '../practice/answers';

export interface WordText {
  lemma: string;
  article: Article | null;
  meanings: readonly { text: string }[];
}

const shareAny = (a: Iterable<string>, b: Iterable<string>) => {
  const seen = new Set(a);
  return [...b].some((item) => seen.has(item));
};

/**
 * Which schedules an edit makes worthless. Text is compared by the same rules that judge answers,
 * so what an answer could not notice does not count: spacing, punctuation, notes in parentheses,
 * Turkish capitals. Nothing here guesses how big a change is. Either an old answer is still accepted
 * or it is not.
 *
 *   German: no old form remains    -> Turkish to German
 *   Turkish: no old meaning remains -> German to Turkish, and Turkish to German, whose prompt it is
 *   article changed in any way     -> article, and Turkish to German, whose answer includes it
 *   German and Turkish both        -> all three: this is now a different word
 *
 * A meaning that was added, or removed while another remains, keeps every schedule.
 */
export function affectedTracks(before: WordText, after: WordText): Track[] {
  const german = !shareAny(lemmasOf(before), lemmasOf(after));
  const turkish = !shareAny(meaningKeysOf(before), meaningKeysOf(after));
  const article = before.article !== after.article;
  const tracks = new Set<Track>();
  if (german || turkish || article) tracks.add('tr_de');
  if (turkish) tracks.add('de_tr');
  if (article || (german && turkish)) tracks.add('article');
  return [...tracks];
}
