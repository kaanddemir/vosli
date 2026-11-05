import type { Issue } from '../core/issues';
import type { Word } from './types';

const KEY = 'vosli.flag-check';

/**
 * The last dictionary result on this device, kept out of the database so backups stay about learning
 * data. It lets the app open without parsing the whole dictionary. A private window can refuse storage,
 * and then the dictionary is simply read each time.
 */
export function checkSignature(words: readonly Pick<Word, 'id' | 'lemma' | 'article' | 'meanings'>[], dismissed: ReadonlySet<string>): string {
  let hash = 0x811c9dc5;
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  };
  for (const word of words) {
    add(word.id);
    add(word.lemma);
    add(word.article ?? '');
    for (const meaning of word.meanings) add(meaning.text);
  }
  for (const key of [...dismissed].sort()) add(key);
  return `${__BUILD_ID__}:${words.length}:${(hash >>> 0).toString(36)}`;
}

export function readCheckedFlags(signature: string): Map<string, Issue[]> | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { signature?: unknown; flagged?: [string, Issue[]][] } | null;
    return stored?.signature === signature && Array.isArray(stored.flagged) ? new Map(stored.flagged) : null;
  } catch {
    return null;
  }
}

export function saveCheckedFlags(signature: string, flagged: ReadonlyMap<string, Issue[]>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ signature, flagged: [...flagged] }));
  } catch {
    /* Not remembered, which is fine. */
  }
}
