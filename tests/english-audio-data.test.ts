import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_FILES, createAudioIndex, parseAudioTags, parseCredits, saysLemma } from '../src/audio/audioIndex';
import { LEARNING_LANGUAGES } from '../src/core/learningLanguage';

/**
 * The English pronunciation list as shipped, built offline from the Commons check: every line must be one the app can
 * read, name an American or British English recording that says the word, and have its credits. German's list is
 * read the same way, so it is seen to be untouched by English.
 */
const publicFile = (path: string) => readFileSync(join(import.meta.dirname, '..', 'public', path), 'utf8');
const recordingsText = publicFile(AUDIO_FILES.en.recordings);
const credits = parseCredits(publicFile(AUDIO_FILES.en.credits));
const lines = recordingsText.split('\n').filter(Boolean);
// Commons titles vary in case: En-us-, En-US-, En-uk-, En-GB-.
const ENGLISH_TITLE = /^(En-(us|uk|gb)-|LL-Q1860 \(eng\)-)/iu;

describe('the English recordings list', () => {
  it('holds real recordings, sorted for lookup, one line per word', () => {
    expect(lines.length).toBeGreaterThan(9000);
    const words = lines.map((line) => line.split('\t')[0]!);
    expect(new Set(words).size).toBe(words.length);
    // Sorted by UTF-16 code unit, which binary search needs.
    for (let i = 1; i < words.length; i++) expect(words[i - 1]! < words[i]!, words[i]).toBe(true);
  });

  it('names, for every word, an American or British English recording that says it, with its author and license', () => {
    const index = createAudioIndex(recordingsText, 'en');
    const varieties = { us: 0, uk: 0 };
    for (const line of lines) {
      const [word, tags] = line.split('\t') as [string, string];
      const parsed = parseAudioTags(word, tags, 'en');
      expect(parsed, word).not.toBeNull();
      const recording = parsed!.recordings.get('*')!;
      expect(recording.title, word).toMatch(ENGLISH_TITLE);
      expect(recording.title, word).not.toMatch(/^De-/u);
      expect(saysLemma(recording, word, 'en'), recording.title).toBe(true);
      expect(credits.author(recording.author), recording.title).not.toBe('');
      expect(credits.license(recording.license), recording.title).not.toBeNull();
      varieties[recording.variety!]++;
      // Found by its own word through the index the app uses.
      expect(index.sourceFor({ lemma: word, article: null, pos: 'other', language: 'en' })?.title, word).toBe(recording.title);
    }
    expect(varieties.us).toBeGreaterThan(0);
    expect(varieties.uk).toBeGreaterThan(0);
    expect(varieties.us + varieties.uk).toBe(lines.length);
  });

  it('plays common words in English, and never for a German word of the same spelling', () => {
    const index = createAudioIndex(recordingsText, 'en');
    const apple = index.sourceFor({ lemma: 'apple', article: null, pos: 'other', language: 'en' });
    expect(apple).toMatchObject({ language: 'en', key: `en:${apple!.title}` });
    expect(apple!.title).toMatch(ENGLISH_TITLE);
    expect(index.sourceFor({ lemma: 'also', article: null, pos: 'other', language: 'de' })).toBeNull();
  });
});

describe('the German recordings list, beside it', () => {
  const german = createAudioIndex(publicFile(AUDIO_FILES.de.recordings), 'de');

  it('still plays German words from German recordings only', () => {
    expect(german.sourceFor({ lemma: 'Apfel', article: 'der', pos: 'noun', language: 'de' })).toMatchObject({ title: 'De-Apfel.ogg', language: 'de', key: 'de:De-Apfel.ogg' });
    expect(german.sourceFor({ lemma: 'Apfel', article: 'der', pos: 'noun', language: 'en' })).toBeNull();
  });

  it('shares no recording with the English list', () => {
    const english = new Set(lines.map((line) => parseAudioTags(line.split('\t')[0]!, line.split('\t')[1]!, 'en')!.recordings.get('*')!.title));
    expect([...english].some((title) => title.startsWith('De-'))).toBe(false);
    expect(german.sourceFor({ lemma: 'Haus', article: 'das', pos: 'noun', language: 'de' })?.title).toMatch(/^De-/u);
  });
});

describe('the shipped language data, one folder per language', () => {
  it('has every file the app reads, with its license beside it', () => {
    for (const language of LEARNING_LANGUAGES) {
      for (const path of Object.values(AUDIO_FILES[language])) expect(existsSync(join(import.meta.dirname, '..', 'public', path)), path).toBe(true);
      // Every credits file reads, and names authors and licenses.
      const credits = parseCredits(publicFile(AUDIO_FILES[language].credits));
      expect(credits.license(0), language).not.toBeNull();
      expect(existsSync(join(import.meta.dirname, '..', 'public', 'pronunciation', language, 'LICENSE.txt')), language).toBe(true);
    }
    expect(readdirSync(join(import.meta.dirname, '..', 'public', 'dictionary')).sort()).toEqual(['de']);
    expect(readdirSync(join(import.meta.dirname, '..', 'public', 'dictionary', 'de')).sort()).toEqual(['LICENSE.txt', 'forms.txt', 'lemmas.txt']);
    expect(readdirSync(join(import.meta.dirname, '..', 'public', 'pronunciation')).sort()).toEqual(['de', 'en']);
  });
});
