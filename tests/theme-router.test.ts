import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTICLE_COLORS_STORAGE_KEY, parseArticleColors } from '../src/articleColors';
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from '../src/theme';
import { hrefFor, hrefForGroup, hrefForWord, placeFromHash } from '../src/ui/router';

describe('theme preference', () => {
  it('falls back to system for missing or unknown values', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('follows the system only when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('uses the same storage key as the pre-paint script', () => {
    expect(readFileSync(new URL('../public/theme-boot.js', import.meta.url), 'utf8')).toContain(THEME_STORAGE_KEY);
  });
});

describe('article colors preference', () => {
  it('is off unless explicitly turned on', () => {
    expect(parseArticleColors(null)).toBe(false);
    expect(parseArticleColors('true')).toBe(false);
    expect(parseArticleColors('on')).toBe(true);
  });

  it('uses the same storage key as the pre-paint script', () => {
    expect(readFileSync(new URL('../public/theme-boot.js', import.meta.url), 'utf8')).toContain(ARTICLE_COLORS_STORAGE_KEY);
  });

  it('is an app preference, so resetting the app clears it', () => {
    expect(ARTICLE_COLORS_STORAGE_KEY.startsWith('vosli.')).toBe(true);
  });
});

describe('routes', () => {
  const route = (hash: string) => placeFromHash(hash).route;

  it('maps hashes to screens and sends unknown paths home', () => {
    expect(route('')).toBe('home');
    expect(route('#/')).toBe('home');
    expect(route('#/dictionary')).toBe('dictionary');
    expect(route('#/nope')).toBe('home');
    expect(route('#/dictionary/a/b')).toBe('home');
    expect(route('#/settings/a')).toBe('home');
  });

  it('round trips every top-level route', () => {
    for (const name of ['home', 'dictionary', 'collections', 'practice', 'import', 'settings'] as const) {
      expect(route(hrefFor(name))).toBe(name);
    }
  });

  it('carries word and collection ids, including unusual characters', () => {
    expect(placeFromHash(hrefForWord('a/b ç'))).toEqual({ route: 'word', wordId: 'a/b ç' });
    expect(placeFromHash(hrefForGroup('g 1'))).toEqual({ route: 'group', groupId: 'g 1' });
    expect(placeFromHash(hrefForWord('w', 'g'))).toEqual({ route: 'word', groupId: 'g', wordId: 'w' });
    expect(placeFromHash('#/dictionary/%E0%A4%A')).toEqual({ route: 'word', wordId: '%E0%A4%A' });
  });
});
