/**
 * Progressive hints: each press shows more letters of the expected answer, and never all of them.
 * Pure text work with no knowledge of words or tracks; answers.ts decides which text is hinted.
 */

/** Stands for one hidden letter. Spaces, hyphens, apostrophes and other marks stay as written. */
export const MASK = '•';

/** One letter with any combining marks after it, or any other single character. */
const TOKEN = /[\p{L}\p{N}]\p{M}*|[^]/gu;
const LETTER = /^[\p{L}\p{N}]/u;
/** What separates the words of a phrase or the parts of a compound like E-Mail. An apostrophe does not: geht's is one word. */
const BREAK = /^[\s\-‐‑–—]$/u;

export interface Hints {
  /** Letters in the answer, for saying how long it is. */
  letters: number;
  /** Each stage shows more than the one before, and the last still hides some letters. Empty when no hint can help. */
  stages: string[];
}

/**
 * How many letters each stage shows, for an answer of `letters` letters in `words` words:
 *   1. the first letter of each word,
 *   2. about a quarter of the letters,
 *   3. as many as can be shown while at least 30% (and at least two letters) stay hidden.
 * Short answers keep at least one letter hidden, so they get fewer stages: Tür and Ei get only one.
 * Stages that would show no more than the one before are left out.
 */
export function stageSizes(letters: number, words: number): number[] {
  if (letters < 2) return [];
  const hidden = Math.min(letters - 1, Math.max(2, Math.ceil((3 * letters) / 10)));
  const most = letters - hidden;
  const sizes: number[] = [];
  for (const size of [Math.min(Math.max(words, 1), most), Math.round(letters / 4), most]) {
    if (size >= 1 && size <= most && size > (sizes.at(-1) ?? 0)) sizes.push(size);
  }
  return sizes;
}

/**
 * Letters are shown word by word in turn: first letters, then second letters, and so on, so a phrase
 * gets a start on every word before any one of them fills in. A single word simply fills from the left.
 */
export function progressiveHints(text: string): Hints {
  const tokens = text.match(TOKEN) ?? [];
  const letters: { at: number; place: number }[] = [];
  let words = 0;
  let place = 0;
  tokens.forEach((token, at) => {
    if (BREAK.test(token)) place = 0;
    else if (LETTER.test(token)) {
      if (place === 0) words++;
      letters.push({ at, place: place++ });
    }
  });
  // Stable sort: within the same place in their words, letters keep reading order.
  const order = [...letters].sort((a, b) => a.place - b.place).map((letter) => letter.at);
  const stages = stageSizes(letters.length, words).map((size) => {
    const shown = new Set(order.slice(0, size));
    return tokens.map((token, at) => (LETTER.test(token) && !shown.has(at) ? MASK : token)).join('');
  });
  return { letters: letters.length, stages };
}

/** A stage as a screen reader should hear it: each run of hidden letters becomes one ellipsis. */
export const spokenStage = (stage: string): string => stage.replace(/•+/gu, '…');
