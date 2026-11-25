import { SortedLines } from '../core/dictionary';
import type { LearningLanguage } from '../core/learningLanguage';
import type { Word } from '../data/types';
import { md5 } from './md5';

/**
 * Which recording says a word. German recordings are read from the a= tag in dictionary/de/lemmas.txt (written by
 * scripts/dictionary-audio.mjs), English ones from pronunciation/en/recordings.txt (written by
 * scripts/english-audio.mjs). Only recordings Wikimedia Commons has confirmed are there, and a word with
 * two pronunciations that cannot be told apart has none. Each language has its own index: a word is only
 * ever looked up in the index of its own learning language.
 */
export type Variety = 'us' | 'uk';

export interface Recording {
  /** The canonical Commons file title, with spaces. */
  title: string;
  /** Indexes into the language's credits file. */
  author: number;
  license: number;
  /** For English: American or British English, as Commons and Wiktionary's editors agree. */
  variety?: Variety;
}

export interface PronunciationSource extends Recording {
  /** The learning language the recording is in. */
  language: LearningLanguage;
  /** Tells recordings apart, so the same one tapped again restarts rather than starts over. Holds the language. */
  key: string;
  /** Commons' MP3 copy, which every browser plays. */
  mp3: string;
  /** The uploaded file, tried only if the MP3 fails and the browser says it can play it. */
  original: string;
  originalType: string;
  /** The file's page on Commons: its author, license and history. */
  page: string;
}

/** A word as the index needs it. One that says its language is only found in that language's index. */
type WordForm = Pick<Word, 'lemma' | 'article' | 'pos'> & { language?: LearningLanguage };
/** The paths the app reads each language's recordings and credits from. */
export const AUDIO_FILES: Readonly<Record<LearningLanguage, { recordings: string; credits: string }>> = {
  de: { recordings: 'dictionary/de/lemmas.txt', credits: 'pronunciation/de/credits.txt' },
  en: { recordings: 'pronunciation/en/recordings.txt', credits: 'pronunciation/en/credits.txt' },
};

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

const VARIETY_OF: Readonly<Record<string, Variety>> = { u: 'us', b: 'uk' };
const ENGLISH_PREFIX: Readonly<Record<Variety, string>> = { us: 'En-us-', uk: 'En-uk-' };

function decodeFile(lemma: string, value: string, language: LearningLanguage): Recording | null {
  const [code = '', credit = ''] = value.split('#');
  const [author = '0', license = '0'] = credit ? credit.split('.') : [];
  const credits = { author: Number(author), license: Number(license) };
  if (language === 'en') {
    // A letter for the variety, then nothing for the usual En-us-<word>.ogg or = and the whole title.
    const variety = VARIETY_OF[code[0] ?? ''];
    if (!variety || (code.length > 1 && code[1] !== '=')) return null;
    const title = code.length === 1 ? `${ENGLISH_PREFIX[variety]}${lemma}.ogg` : code.slice(2).replaceAll('_', ' ');
    return { title, ...credits, variety };
  }
  const base = `De-${lemma}`;
  const title = code === '' ? `${base}.ogg` : /^\d$/u.test(code) ? `${base}${code}.ogg` : code.slice(1).replaceAll('_', ' ');
  return { title, ...credits };
}

/** The recordings of one line, by key, or null when it has none. lemma is the line's own word. */
export function parseAudioTags(lemma: string, line: string, language: LearningLanguage = 'de'): { recordings: Map<string, Recording>; ambiguous: boolean } | null {
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
    const recording = decodeFile(lemma, item.slice(colon + 1), language);
    if (recording) recordings.set(item.slice(0, colon), recording);
  }
  return recordings.size ? { recordings, ambiguous } : null;
}

/**
 * The recording for a word as the learner saved it. Its own part of speech, with the noun's gender,
 * comes first. When that key is absent, a recording still fits if every key of the word shares it,
 * since then the spelling is said one way whatever it means.
 */
export function recordingFor(word: WordForm, line: string, language: LearningLanguage = 'de', lineWord = word.lemma): Recording | null {
  const parsed = parseAudioTags(lineWord, line, language);
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

/**
 * The word a recording's title says it holds: De-Apfel.ogg, De-Apfel2.ogg, DE-Apfel.wav and
 * LL-Q188 (deu)-Speaker-Apfel.wav all say Apfel. Null for a title in any other shape, which is then
 * not trusted to match anything.
 */
export function spokenWord(title: string, language: LearningLanguage = 'de'): string | null {
  const name = title.replace(/\.[a-z0-9]+$/iu, '');
  const word =
    language === 'en'
      ? (/^en-(?:us|uk|gb)-(.+)$/iu.exec(name)?.[1] ?? /^LL-Q1860 \(eng\)-[^-]+-(.+)$/u.exec(name)?.[1])
      : (/^de-(.+)$/iu.exec(name)?.[1] ?? /^LL-Q188 \(deu\)-[^-]+-(.+)$/u.exec(name)?.[1]);
  return word === undefined ? null : word.replace(/\d+$/u, '').replaceAll('_', ' ').trim() || null;
}

/** English is compared with one kind of apostrophe and without the German case rules. */
const english = (text: string) => text.normalize('NFC').trim().replace(/[’ʼ]/gu, "'").toLocaleLowerCase('en');

/**
 * A recording fit for dictation: the title says the spelling the learner saved, case aside, so writing
 * what is heard can be right. Ein-Zimmer-Wohnung recorded as Einzimmerwohnung is not, nor is Slovenisch
 * recorded as Slowenisch. danke recorded as Danke is: the sound and the letters are the same.
 */
export function saysLemma(recording: Pick<Recording, 'title'>, lemma: string, language: LearningLanguage = 'de'): boolean {
  const said = spokenWord(recording.title, language);
  if (said === null) return false;
  if (language === 'en') return english(said) === english(lemma);
  return said.toLocaleLowerCase('de') === lemma.normalize('NFC').trim().toLocaleLowerCase('de');
}

export interface AudioIndex {
  /** The learning language every recording of this index is in. */
  readonly language: LearningLanguage;
  sourceFor(word: WordForm): PronunciationSource | null;
  /** A word that can be asked by ear. On the index itself, so callers need not load this module up front. */
  canDictate(word: WordForm): boolean;
}

/**
 * The line for a word. German looks up the lemma exactly, as the dictionary does. English tries the word as
 * saved, with a straight apostrophe, then in lower case and with a capital first letter, so monday finds Monday;
 * a spelling English tells apart by case alone, Polish and polish, still finds its own line first.
 */
function lineFor(lines: SortedLines, lemma: string, language: LearningLanguage): { word: string; line: string } | null {
  if (language !== 'en') {
    const line = lines.get(lemma);
    return line === null ? null : { word: lemma, line };
  }
  const saved = lemma.normalize('NFC').trim().replace(/[’ʼ]/gu, "'");
  const lower = saved.toLocaleLowerCase('en');
  for (const word of new Set([saved, lower, lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1)])) {
    const line = word ? lines.get(word) : null;
    if (line !== null) return { word, line };
  }
  return null;
}

export function createAudioIndex(text: string, language: LearningLanguage = 'de'): AudioIndex {
  const lines = new SortedLines(text);
  const index: AudioIndex = {
    language,
    sourceFor(word) {
      // A word of another language is never looked up here, however it is spelled.
      if (word.language !== undefined && word.language !== language) return null;
      const found = lineFor(lines, word.lemma, language);
      const recording = found === null ? null : recordingFor(word, found.line, language, found.word);
      return recording ? { ...recording, language, key: `${language}:${recording.title}`, ...commonsUrls(recording.title) } : null;
    },
    canDictate: (word) => canDictate(index, word),
  };
  return index;
}

export interface AudioCredits {
  author(index: number): string;
  license(index: number): { name: string; url: string } | null;
}

/** A word that can be asked by ear: it has a confirmed recording, and the recording says its spelling. */
export function canDictate(index: Pick<AudioIndex, 'sourceFor'>, word: WordForm): boolean {
  const source = index.sourceFor(word);
  return source !== null && saysLemma(source, word.lemma, source.language);
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
