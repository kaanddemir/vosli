/** Types for english-audio.mjs, so its tests are checked like the app. */
import type { AudioChoice, AudioEntry, Confirmed, SoundRecord } from './dictionary-audio.mjs';

export type EnglishVariety = 'us' | 'uk';
export interface EnglishEntry extends AudioEntry {
  /** What the editors and the title say about each file: us, uk, other or synthetic. */
  said: Map<string, Set<string>>;
}
export interface EnglishRecord extends SoundRecord {
  word: string;
}

export function englishKey(word: string): string;
export function englishTitle(title: string): { word: string; variety: EnglishVariety | 'other' | null } | null;
export function saysWord(title: string, word: string): boolean;
export function englishAudioEntry(record: EnglishRecord): EnglishEntry | null;
export function englishCategory(categories: unknown): 'us' | 'uk' | 'en' | 'other' | 'none';
export function varietyOf(kind: string | undefined, editors: Set<string>): EnglishVariety | null;
export function chooseEnglishAudio(entries: EnglishEntry[], lookup: (name: string) => Confirmed | false | undefined): AudioChoice & { chosen: Map<string, Confirmed & { variety: EnglishVariety }> };
export function englishFileCode(word: string, title: string, variety: EnglishVariety): string;
export function englishAudioTag(word: string, choice: AudioChoice, ids: (found: Confirmed) => [number, number]): string | null;
export function readEnglishRecordings(source: string): Promise<{ recordings: Map<string, EnglishEntry[]>; weight: Map<string, number> }>;
