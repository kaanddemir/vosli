import { useEffect, useState } from 'preact/hooks';

export type Route = 'home' | 'dictionary' | 'word' | 'wordNew' | 'wordEdit' | 'collections' | 'group' | 'practice' | 'review' | 'import' | 'settings';

/** A word or group address carries its record id; a word opened from a collection also keeps that collection. */
export interface Place {
  route: Route;
  wordId?: string;
  groupId?: string;
}

const STATIC: Record<string, Route> = {
  '': 'home',
  '/': 'home',
  '/dictionary': 'dictionary',
  '/dictionary/new': 'wordNew',
  '/collections': 'collections',
  '/practice': 'practice',
  '/review': 'review',
  '/import': 'import',
  '/settings': 'settings',
};

export function placeFromHash(hash: string): Place {
  const path = hash.replace(/^#/, '');
  const known = STATIC[path];
  if (known) return { route: known };
  const [, section, first, second, third, extra] = path.split('/').map(decodeSegment);
  if (extra !== undefined || !first) return { route: 'home' };
  if (section === 'dictionary' && third === undefined) {
    if (second === undefined) return { route: 'word', wordId: first };
    if (second === 'edit') return { route: 'wordEdit', wordId: first };
  }
  if (section === 'collections') {
    if (second === undefined) return { route: 'group', groupId: first };
    // Record ids are hex, so a word can never be called new.
    if (second === 'new' && third === undefined) return { route: 'wordNew', groupId: first };
    if (third === undefined) return { route: 'word', groupId: first, wordId: second };
    if (third === 'edit') return { route: 'wordEdit', groupId: first, wordId: second };
  }
  return { route: 'home' };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function hrefFor(route: Exclude<Route, 'word' | 'wordEdit' | 'wordNew' | 'group'>): string {
  return route === 'home' ? '#/' : `#/${route}`;
}

/** A new word made from a list starts in that list and returns to it. */
export const hrefForNewWord = (groupId?: string): string => (groupId ? `#/collections/${encodeURIComponent(groupId)}/new` : '#/dictionary/new');

export const hrefForGroup = (groupId: string): string => `#/collections/${encodeURIComponent(groupId)}`;

export const hrefForWord = (wordId: string, groupId?: string): string =>
  groupId ? `${hrefForGroup(groupId)}/${encodeURIComponent(wordId)}` : `#/dictionary/${encodeURIComponent(wordId)}`;

export const hrefForWordEdit = (wordId: string, groupId?: string): string => `${hrefForWord(wordId, groupId)}/edit`;

export function usePlace(): Place {
  const [place, setPlace] = useState(() => placeFromHash(location.hash));
  useEffect(() => {
    const onChange = () => setPlace(placeFromHash(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return place;
}
