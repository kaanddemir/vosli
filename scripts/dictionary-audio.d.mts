/** Types for dictionary-audio.mjs, so its tests are checked like the app. */
export interface Confirmed {
  title: string;
  license: string;
  author: string;
}
export interface AudioEntry {
  keys: string[];
  ipa: Set<string>;
  files: string[];
}
export interface AudioChoice {
  chosen: Map<string, Confirmed>;
  ambiguous: boolean;
  pending: string[];
}
export interface SoundRecord {
  pos?: string;
  tags?: string[];
  sounds?: { audio?: string; ipa?: string; tags?: string[]; raw_tags?: string[] }[];
}
export const FORM_TITLES: Set<string>;
export const POS: Record<string, string>;
export function clean(word: unknown): string;
export function isClean(word: string): boolean;
export function fileName(name: string): string;
export function audioEntry(record: SoundRecord): AudioEntry | null;
export function chooseAudio(entries: AudioEntry[], lookup: (name: string) => Confirmed | false | undefined): AudioChoice;
export function fileCode(word: string, title: string): string;
export function audioTags(word: string, choice: AudioChoice, ids: (found: Confirmed) => [number, number]): string[];
export function creditTables(found: Confirmed[]): { authors: string[]; licenses: string[]; ids: (found: Confirmed) => [number, number] };
export function licenseUrl(name: string): string;
export function creditsText(tables: { authors: string[]; licenses: string[] }): string;
export function plainText(html: unknown): string;
export function authorFrom(artist: unknown, uploader: unknown): string;
export function parseCache(text: string): Map<string, Confirmed | false>;
export function cacheText(cache: Map<string, Confirmed | false>): string;
