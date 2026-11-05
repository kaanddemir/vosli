export type Article = 'der' | 'die' | 'das';

/** NFC with trimmed, collapsed whitespace. Never changes case: morgen and Morgen are different words. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Removes closing ? and ! so the same word listed as "Was" and "Was?" stays one record. */
export function stripClosingPunctuation(value: string): string {
  return normalizeText(value).replace(/[?!]+$/u, '').trimEnd();
}

/**
 * The key that decides whether two vocabulary rows are the same word.
 * der See and die See differ by article; essen and das Essen differ by case and article.
 */
export function identityKey(lemma: string, article: Article | null, senseTag: string | null = null): string {
  const base = `${stripClosingPunctuation(lemma)}|${article ?? ''}`;
  return senseTag ? `${base}|${normalizeText(senseTag)}` : base;
}
