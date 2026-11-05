import { SortedLines } from '../core/dictionary';
import type { Word } from '../data/types';
import { md5 } from './md5';

/**
 * Which recording says a word, read from the a= tag in lemmas.txt (written by
 * scripts/dictionary-audio.mjs). Only recordings Wikimedia Commons has confirmed are there, and a
 * word whose part of speech has two pronunciations that cannot be told apart has none.
 */
export interface Recording {
  /** The canonical Commons file title, with spaces. */
  title: string;
  /** Indexes into audio-credits.txt. */
  author: number;
  license: number;
}

export interface PronunciationSource extends Recording {
  /** Tells recordings apart, so the same one tapped again restarts rather than starts over. */
  key: string;
  /** Commons' MP3 copy, which every browser plays. */
  mp3: string;
  /** The uploaded file, tried only if the MP3 fails and the browser says it can play it. */
  original: string;
  originalType: string;
  /** The file's page on Commons: its author, license and history. */
  page: string;
}

type WordForm = Pick<Word, 'lemma' | 'article' | 'pos'>;

const GENDER = { der: 'm', die: 'f', das: 'n' } as const;
const POS_KEY: Readonly<Record<Word['pos'], string>> = { noun: 'n', verb: 'v', adjective: 'a', adverb: 'd', phrase: 'p', other: 'o' };
const TYPES: Readonly<Record<string, string>> = { ogg: 'audio/ogg; codecs="vorbis"', oga: 'audio/ogg; codecs="vorbis"', wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg' };
const MEDIA = 'https://upload.wikimedia.org/wikipedia/commons';

/** Commons stores a file under the first one and two hex digits of the MD5 of its name. */
export function commonsUrls(title: string): Pick<PronunciationSource, 'mp3' | 'original' | 'originalType' | 'page'> {
  const name = title.replaceAll(' ', '_');
  const hash = md5(name);
  const path = `${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(name)}`;
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return {
    mp3: `${MEDIA}/transcoded/${path}/${encodeURIComponent(name)}.mp3`,
    original: `${MEDIA}/${path}`,
    originalType: TYPES[extension] ?? '',
    page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`,
  };
}

function decodeFile(lemma: string, value: string): Recording {
  const [code = '', credit = ''] = value.split('#');
  const [author = '0', license = '0'] = credit ? credit.split('.') : [];
  const base = `De-${lemma}`;
  const title = code === '' ? `${base}.ogg` : /^\d$/u.test(code) ? `${base}${code}.ogg` : code.slice(1).replaceAll('_', ' ');
  return { title, author: Number(author), license: Number(license) };
}

/** The recordings of one lemma line, by key, or null when it has none. */
export function parseAudioTags(lemma: string, line: string): { recordings: Map<string, Recording>; ambiguous: boolean } | null {
  let tag: string | undefined;
  let ambiguous = false;
  for (const part of line.split(' ')) {
    if (part.startsWith('a=')) tag = part.slice(2);
    else if (part === 'a!') ambiguous = true;
  }
  if (!tag) return null;
  const recordings = new Map<string, Recording>();
  for (const item of tag.split('|')) {
    const colon = item.indexOf(':');
    recordings.set(item.slice(0, colon), decodeFile(lemma, item.slice(colon + 1)));
  }
  return { recordings, ambiguous };
}

/**
 * The recording for a word as the learner saved it. Its own part of speech, with the noun's gender,
 * comes first. When that key is absent, a recording still fits if every key of the word shares it,
 * since then the spelling is said one way whatever it means.
 */
export function recordingFor(word: WordForm, line: string): Recording | null {
  const parsed = parseAudioTags(word.lemma, line);
  if (!parsed) return null;
  const { recordings, ambiguous } = parsed;
  const pos = POS_KEY[word.pos];
  const key = pos === 'n' && word.article ? `n${GENDER[word.article]}` : pos;
  const own = recordings.get(key) ?? recordings.get('*');
  if (own) return own;
  if (ambiguous) return null;
  const titles = new Set([...recordings.values()].map((recording) => recording.title));
  return titles.size === 1 ? [...recordings.values()][0]! : null;
}

export interface AudioIndex {
  sourceFor(word: WordForm): PronunciationSource | null;
}

export function createAudioIndex(lemmasText: string): AudioIndex {
  const lines = new SortedLines(lemmasText);
  return {
    sourceFor(word) {
      const line = lines.get(word.lemma);
      const recording = line === null ? null : recordingFor(word, line);
      return recording ? { ...recording, key: recording.title, ...commonsUrls(recording.title) } : null;
    },
  };
}

export interface AudioCredits {
  author(index: number): string;
  license(index: number): { name: string; url: string } | null;
}

export function parseCredits(text: string): AudioCredits {
  const authors: string[] = [];
  const licenses: { name: string; url: string }[] = [];
  for (const line of text.split('\n')) {
    const [kind, index, name = '', url = ''] = line.split('\t');
    if (kind === 'A') authors[Number(index)] = name;
    else if (kind === 'L') licenses[Number(index)] = { name, url };
  }
  return { author: (index) => authors[index] ?? '', license: (index) => licenses[index] ?? null };
}
