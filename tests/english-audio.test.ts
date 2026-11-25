import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncCommons } from '../scripts/commons-sync.mjs';
import { audioEntry, cacheText, creditTables, parseCache, type Confirmed } from '../scripts/dictionary-audio.mjs';
import { chooseEnglishAudio, englishAudioEntry, englishAudioTag, englishCategory, englishFileCode, englishTitle, saysWord, varietyOf, type EnglishEntry, type EnglishRecord } from '../scripts/english-audio.mjs';
import { AUDIO_FILES, canDictate, createAudioIndex, parseAudioTags, saysLemma, spokenWord } from '../src/audio/audioIndex';
import { createPlayer, type AudioLike } from '../src/audio/pronunciation';
import { evaluateAnswer, hintsFor } from '../src/core/practice/answers';
import type { Word } from '../src/data/types';

type Sound = NonNullable<EnglishRecord['sounds']>[number];
const record = (word: string, sounds: Sound[], pos = 'noun'): EnglishRecord => ({ word, pos, sounds });
const us = (audio: string): Sound => ({ audio, tags: ['US'] });
const uk = (audio: string): Sound => ({ audio, tags: ['British'] });
const entries = (...records: EnglishRecord[]) => records.map(englishAudioEntry).filter((entry): entry is EnglishEntry => entry !== null);
const confirmed = (title: string, kind: string, author = 'Speaker', license = 'CC BY-SA 4.0'): Confirmed => ({ title, author, license, kind });
const english = (lemma: string, pos: Word['pos'] = 'other') => ({ lemma, pos, article: null, language: 'en' as const });
const german = (lemma: string, pos: Word['pos'], article: Word['article'] = null) => ({ lemma, pos, article, language: 'de' as const });

/** The line the build writes for one word, read back the way the app reads it. */
function line(word: string, records: EnglishRecord[], cache: Map<string, Confirmed | false>) {
  const choice = chooseEnglishAudio(entries(...records), (name) => cache.get(name));
  const credits = creditTables([...choice.chosen.values()]);
  const tag = englishAudioTag(word, choice, credits.ids);
  return { choice, text: tag ? `${word}\t${tag}\n` : '', credits };
}

describe('English recording titles', () => {
  it('read the word and the variety a title gives, and trust no other shape', () => {
    expect(englishTitle('En-us-apple.ogg')).toEqual({ word: 'apple', variety: 'us' });
    expect(englishTitle('En-uk-apple.ogg')).toEqual({ word: 'apple', variety: 'uk' });
    expect(englishTitle('En-gb-apple.ogg')).toEqual({ word: 'apple', variety: 'uk' });
    expect(englishTitle('En-au-go.ogg')).toEqual({ word: 'go', variety: 'other' });
    expect(englishTitle('LL-Q1860 (eng)-Vealhurl-pun.wav')).toEqual({ word: 'pun', variety: null });
    expect(englishTitle('LL-Q1860 (eng)-Wodencafe-give_up.wav')).toEqual({ word: 'give up', variety: null });
    // German recordings, files named for no language and other formats are not English recordings.
    expect(englishTitle('De-Apfel.ogg')).toBeNull();
    expect(englishTitle('LL-Q188 (deu)-Jeuwre-also.wav')).toBeNull();
    expect(englishTitle('News.ogg')).toBeNull();
    expect(englishTitle('En-us-apple.txt')).toBeNull();
  });

  it('say a word only when it is that word, case and apostrophe aside', () => {
    expect(saysWord('En-us-Monday.ogg', 'monday')).toBe(true);
    expect(saysWord('En-us-it’s.ogg', "it's")).toBe(true);
    expect(saysWord('En-us-read2.ogg', 'read')).toBe(true);
    expect(saysWord('En-us-wolves.ogg', 'wolf')).toBe(false);
    expect(saysWord('En-uk-to go.ogg', 'go')).toBe(false);
    expect(saysWord('En-uk-a wolf.ogg', 'wolf')).toBe(false);
    expect(saysWord('En-us-one.ogg', '1')).toBe(false);
  });
});

describe('choosing English recordings at build time', () => {
  it('keeps only links that say the entry’s word in American or British English, American first', () => {
    const entry = englishAudioEntry(
      record('wolf', [{ ipa: '[wʊlf]' }, uk('En-uk-a wolf.ogg'), uk('En-uk-wolf.ogg'), us('En-us-wolves.ogg'), us('En-us-wolf.ogg'), { audio: 'En-au-wolf.ogg', tags: ['Australian'] }, { audio: 'De-Wolf.ogg' }, { audio: 'LL-Q1860 (eng)-Nattes à chat-wolf.wav' }]),
    )!;
    // Lingua Libre's file names no variety: it is kept last, for Commons or nobody to vouch for.
    expect(entry.files).toEqual(['En-us-wolf.ogg', 'En-uk-wolf.ogg', 'LL-Q1860 (eng)-Nattes à chat-wolf.wav']);
    expect(entry.keys).toEqual(['*']);
  });

  it('leaves out other varieties, a link and title that disagree, and anything synthesized', () => {
    expect(englishAudioEntry(record('go', [{ audio: 'En-au-go.ogg', tags: ['Australian'] }]))).toBeNull();
    expect(englishAudioEntry(record('go', [{ audio: 'En-us-go.ogg', tags: ['Canadian'] }]))).toBeNull();
    expect(englishAudioEntry(record('go', [{ audio: 'LL-Q1860 (eng)-Bot-go.wav', raw_tags: ['kanadisch, synthesized'] }]))).toBeNull();
    expect(englishAudioEntry(record('go', [{ audio: 'LL-Q1860 (eng)-Someone-go.wav', raw_tags: ['amerikanisch'] }]))!.files).toEqual(['LL-Q1860 (eng)-Someone-go.wav']);
  });

  it('reads what Commons files a recording under', () => {
    expect(englishCategory('U.S. English pronunciation|GFDL|Self-published work')).toBe('us');
    expect(englishCategory('British English pronunciation|Audio files from Shtooka Project (English)')).toBe('uk');
    expect(englishCategory('Lingua Libre pronunciation by Vealhurl|Lingua Libre pronunciation-eng')).toBe('en');
    expect(englishCategory('Australian English pronunciation|Self-published work')).toBe('other');
    expect(englishCategory('U.S. English pronunciation|British English pronunciation')).toBe('other');
    expect(englishCategory('German pronunciation|Lingua Libre pronunciation-deu')).toBe('none');
    expect(englishCategory(undefined)).toBe('none');
  });

  it('takes the variety from Commons, from the editors only where Commons names none, and nothing on disagreement', () => {
    expect(varietyOf('us', new Set(['us']))).toBe('us');
    expect(varietyOf('us', new Set())).toBe('us');
    expect(varietyOf('us', new Set(['uk']))).toBeNull();
    expect(varietyOf('en', new Set(['uk']))).toBe('uk');
    expect(varietyOf('en', new Set())).toBeNull();
    expect(varietyOf('en', new Set(['us', 'uk']))).toBeNull();
    expect(varietyOf('other', new Set(['us']))).toBeNull();
    expect(varietyOf('none', new Set(['us']))).toBeNull();
    expect(varietyOf(undefined, new Set(['us']))).toBeNull();
  });

  it('uses American, falls back to British when Commons does not vouch for it, and waits for unchecked files', () => {
    const cake = record('cake', [uk('En-uk-cake.ogg'), us('En-us-cake.ogg')]);
    expect(chooseEnglishAudio(entries(cake), (name) => new Map([['En-us-cake.ogg', confirmed('En-us-cake.ogg', 'us')], ['En-uk-cake.ogg', confirmed('En-uk-cake.ogg', 'uk')]]).get(name)).chosen.get('*')).toMatchObject({ title: 'En-us-cake.ogg', variety: 'us' });
    // Commons files the American link as Australian: the British one is used instead.
    const fallback = new Map([['En-us-cake.ogg', confirmed('En-us-cake.ogg', 'other')], ['En-uk-cake.ogg', confirmed('En-uk-cake.ogg', 'uk')]]);
    expect(chooseEnglishAudio(entries(cake), (name) => fallback.get(name)).chosen.get('*')).toMatchObject({ title: 'En-uk-cake.ogg', variety: 'uk' });
    expect(chooseEnglishAudio(entries(cake), () => undefined)).toMatchObject({ pending: ['En-us-cake.ogg'] });
    // Commons moved En-us-they're.ogg to En-us-there.ogg: that is another word's recording, so the British one is used.
    const theyre = record("they're", [us("En-us-they're.ogg"), uk("En-uk-they're.ogg")]);
    const moved = new Map([["En-us-they're.ogg", confirmed('En-us-there.ogg', 'us')], ["En-uk-they're.ogg", confirmed("En-uk-they're.ogg", 'uk')]]);
    expect(chooseEnglishAudio(entries(theyre), (name) => moved.get(name)).chosen.get('*')).toMatchObject({ title: "En-uk-they're.ogg", variety: 'uk' });
    // A move that only changes the spelling of the same name, or adds a take number, is still that word.
    const renamed = new Map([['En-us-cake.ogg', confirmed('En-us-cake2.ogg', 'us')], ['En-uk-cake.ogg', confirmed('En-uk-cake.ogg', 'uk')]]);
    expect(chooseEnglishAudio(entries(cake), (name) => renamed.get(name)).chosen.get('*')).toMatchObject({ title: 'En-us-cake2.ogg', variety: 'us' });
    // A Lingua Libre file that Commons only calls English, and the editors do not place, is never used.
    const libre = record('pun', [{ audio: 'LL-Q1860 (eng)-Nattes à chat-pun.wav' }]);
    expect(chooseEnglishAudio(entries(libre), () => confirmed('LL-Q1860 (eng)-Nattes à chat-pun.wav', 'en')).chosen.size).toBe(0);
    const placed = record('pun', [{ audio: 'LL-Q1860 (eng)-Vealhurl-pun.wav', tags: ['British'] }]);
    expect(chooseEnglishAudio(entries(placed), () => confirmed('LL-Q1860 (eng)-Vealhurl-pun.wav', 'en')).chosen.get('*')).toMatchObject({ variety: 'uk' });
  });

  it('gives a spelling said two ways no recording, and one said one way a single one', () => {
    const metal = record('lead', [{ ipa: '[lɛd]' }, us('En-us-lead-metal.ogg'), us('En-us-lead.ogg')]);
    const guide = record('lead', [{ ipa: '[liːd]' }, us('En-us-lead2.ogg')], 'verb');
    const cache = (name: string) => confirmed(name, 'us');
    expect(chooseEnglishAudio(entries(metal, guide), cache)).toMatchObject({ ambiguous: true });
    expect(chooseEnglishAudio(entries(metal, guide), cache).chosen.size).toBe(0);
    const man = record('man', [{ ipa: '[mæn]' }, us('En-us-man.ogg'), uk('En-uk-man.ogg')]);
    const toMan = record('man', [{ ipa: '[mæn]' }, { audio: 'En-uk-man.ogg' }], 'verb');
    expect(chooseEnglishAudio(entries(man, toMan), cache)).toMatchObject({ ambiguous: false });
    expect(chooseEnglishAudio(entries(man, toMan), cache).chosen.get('*')?.title).toBe('En-us-man.ogg');
  });

  it('writes the usual titles by one letter and any other in full', () => {
    expect(englishFileCode('apple', 'En-us-apple.ogg', 'us')).toBe('u');
    expect(englishFileCode('apple', 'En-uk-apple.ogg', 'uk')).toBe('b');
    expect(englishFileCode('give up', 'En-us-give up.ogg', 'us')).toBe('u');
    expect(englishFileCode('pun', 'LL-Q1860 (eng)-Vealhurl-pun.wav', 'uk')).toBe('b=LL-Q1860_(eng)-Vealhurl-pun.wav');
    expect(englishFileCode('Monday', 'En-us-monday.ogg', 'us')).toBe('u=En-us-monday.ogg');
  });

  it('keeps what Commons files each recording under in its own cache, beside the German one unchanged', () => {
    const cache = new Map<string, Confirmed | false>([['En-us-apple.ogg', confirmed('En-us-apple.ogg', 'us')], ['En-au-go.ogg', confirmed('En-au-go.ogg', 'other')], ['En-us-gone.ogg', false]]);
    const text = cacheText(cache, { categories: true });
    expect(text).toContain('En-us-apple.ogg\t\tCC BY-SA 4.0\tSpeaker\tus\n');
    expect(text).toContain('En-us-gone.ogg\t-\n');
    expect(parseCache(text)).toEqual(cache);
    const germanCache = new Map<string, Confirmed | false>([['De-Apfel.ogg', { title: 'De-Apfel.ogg', license: 'CC BY-SA 4.0', author: 'Jeuwre' }]]);
    expect(cacheText(germanCache)).toContain('De-Apfel.ogg\t\tCC BY-SA 4.0\tJeuwre\n');
  });
});

describe('English recordings in the app', () => {
  const cache = new Map<string, Confirmed | false>([
    ['En-us-apple.ogg', confirmed('En-us-apple.ogg', 'us', 'Dvortygirl', 'CC BY-SA 3.0')],
    ['En-uk-pun.ogg', confirmed('En-uk-pun.ogg', 'uk', 'Shtooka', 'CC BY 3.0 us')],
    ['En-us-Polish.ogg', confirmed('En-us-Polish.ogg', 'us')],
    ['En-us-polish.ogg', confirmed('En-us-polish.ogg', 'us')],
    ['En-us-Monday.ogg', confirmed('En-us-Monday.ogg', 'us')],
    ["En-us-it's.ogg", confirmed("En-us-it's.ogg", 'us')],
    ['LL-Q1860 (eng)-Vealhurl-cake.wav', confirmed('LL-Q1860 (eng)-Vealhurl-cake.wav', 'en')],
  ]);
  const words: [string, EnglishRecord][] = [
    ['Monday', record('Monday', [us('En-us-Monday.ogg')])],
    ['Polish', record('Polish', [us('En-us-Polish.ogg')], 'adj')],
    ['apple', record('apple', [us('En-us-apple.ogg')])],
    ['cake', record('cake', [{ audio: 'LL-Q1860 (eng)-Vealhurl-cake.wav', tags: ['British'] }])],
    ["it's", record("it's", [us("En-us-it's.ogg")], 'phrase')],
    ['polish', record('polish', [us('En-us-polish.ogg')], 'verb')],
    ['pun', record('pun', [uk('En-uk-pun.ogg')])],
  ];
  const lines = words.map(([word, item]) => line(word, [item], cache));
  // One credits table for the whole file, as the build makes it.
  const credits = creditTables(lines.map((item) => item.choice.chosen.get('*')!));
  const text = words.map(([word], i) => `${word}\t${englishAudioTag(word, lines[i]!.choice, credits.ids)}`).join('\n') + '\n';
  const index = createAudioIndex(text, 'en');

  it('reads its own files, apart from the German dictionary', () => {
    expect(AUDIO_FILES.en).toEqual({ recordings: 'pronunciation/en/recordings.txt', credits: 'pronunciation/en/credits.txt' });
    expect(AUDIO_FILES.de).toEqual({ recordings: 'dictionary/de/lemmas.txt', credits: 'pronunciation/de/credits.txt' });
  });

  it('finds the recording for a saved word, with its variety and credits, whatever its part of speech', () => {
    expect(index.sourceFor(english('apple'))).toMatchObject({ title: 'En-us-apple.ogg', variety: 'us', language: 'en', key: 'en:En-us-apple.ogg', page: 'https://commons.wikimedia.org/wiki/File:En-us-apple.ogg' });
    expect(index.sourceFor(english('pun', 'phrase'))).toMatchObject({ title: 'En-uk-pun.ogg', variety: 'uk' });
    expect(index.sourceFor(english('cake'))).toMatchObject({ title: 'LL-Q1860 (eng)-Vealhurl-cake.wav', variety: 'uk' });
    const source = index.sourceFor(english('apple'))!;
    expect(credits.authors[source.author]).toBe('Dvortygirl');
    expect(credits.licenses[source.license]).toBe('CC BY-SA 3.0');
  });

  it('finds a word typed in another case or with a curly apostrophe, and keeps Polish apart from polish', () => {
    expect(index.sourceFor(english('monday'))?.title).toBe('En-us-Monday.ogg');
    expect(index.sourceFor(english('APPLE'))?.title).toBe('En-us-apple.ogg');
    expect(index.sourceFor(english('it’s'))?.title).toBe("En-us-it's.ogg");
    expect(index.sourceFor(english('Polish'))?.title).toBe('En-us-Polish.ogg');
    expect(index.sourceFor(english('polish'))?.title).toBe('En-us-polish.ogg');
    expect(index.sourceFor(english('pear'))).toBeNull();
  });

  it('never plays across languages: each index answers only for words of its own language', () => {
    const germanIndex = createAudioIndex(['Apfel\tNS gm c a=*:', 'also\tD c a=*:', 'apple\tS a=*:', ''].join('\n'), 'de');
    // The same spelling saved in the other language is another word, and gets nothing from this index.
    expect(germanIndex.sourceFor({ ...english('apple') })).toBeNull();
    expect(germanIndex.sourceFor(english('also'))).toBeNull();
    expect(index.sourceFor(german('apple', 'noun', 'der'))).toBeNull();
    expect(germanIndex.sourceFor(german('Apfel', 'noun', 'der'))).toMatchObject({ language: 'de', key: 'de:De-Apfel.ogg' });
    // A German line read as English, or the other way round, names no recording at all rather than a wrong one.
    expect(parseAudioTags('apple', 'a=*:', 'en')).toBeNull();
    expect(parseAudioTags('apple', 'a=*:x=Some.ogg', 'en')).toBeNull();
    expect(parseAudioTags('apple', 'a=*:u', 'en')?.recordings.get('*')).toMatchObject({ title: 'En-us-apple.ogg', variety: 'us' });
  });

  it('asks by ear only a word its recording says, as saved', () => {
    expect(spokenWord('En-us-apple.ogg', 'en')).toBe('apple');
    expect(spokenWord('LL-Q1860 (eng)-Vealhurl-cake.wav', 'en')).toBe('cake');
    expect(spokenWord('De-Apfel.ogg', 'en')).toBeNull();
    expect(spokenWord('En-us-apple.ogg', 'de')).toBeNull();
    expect(saysLemma({ title: 'En-us-Monday.ogg' }, 'monday', 'en')).toBe(true);
    expect(saysLemma({ title: "En-us-it's.ogg" }, 'it’s', 'en')).toBe(true);
    expect(saysLemma({ title: 'En-us-colour.ogg' }, 'colour/color', 'en')).toBe(false);
    expect(canDictate(index, english('apple'))).toBe(true);
    expect(canDictate(index, english('monday'))).toBe(true);
    expect(canDictate(index, english('pear'))).toBe(false);
    expect(canDictate(index, german('apple', 'noun', 'der'))).toBe(false);
  });

  it('checks a listening answer as an English answer, with hints from the saved word', () => {
    const apple = { id: 'apple', language: 'en' as const, lemma: 'apple', article: null, pos: 'other' as const, meanings: [{ text: 'elma' }] };
    expect(evaluateAnswer(apple, 'listen', 'apple', { library: [apple] })).toMatchObject({ result: 'correct', note: null });
    expect(evaluateAnswer(apple, 'listen', 'Apple', { library: [apple] })).toMatchObject({ result: 'correct', note: 'case' });
    expect(evaluateAnswer(apple, 'listen', 'appel', { library: [apple] }).result).toBe('typo');
    expect(evaluateAnswer(apple, 'listen', 'der apple', { library: [apple] }).correct).toBe(false);
    expect(hintsFor(apple, 'listen').stages.length).toBeGreaterThan(0);
  });

  it('keeps an empty list valid: no word has a recording until Commons has vouched for one', () => {
    const empty = createAudioIndex('', 'en');
    expect(empty.sourceFor(english('apple'))).toBeNull();
    expect(empty.canDictate(english('apple'))).toBe(false);
    expect(readFileSync('public/pronunciation/en/recordings.txt', 'utf8').split('\n').filter(Boolean).every((item) => /^[^\t]+\ta=\*:[ub](=[^\t#]+)?(#\d+\.\d+)?$/u.test(item))).toBe(true);
  });
});

describe('playing English recordings', () => {
  class FakeAudio implements AudioLike {
    src = '';
    currentTime = 0;
    preload = '';
    plays: string[] = [];
    listeners = new Map<string, (() => void)[]>();
    play() {
      this.plays.push(this.src);
      return Promise.resolve();
    }
    pause() {}
    load() {}
    removeAttribute(name: string) {
      if (name === 'src') this.src = '';
    }
    canPlayType() {
      return '';
    }
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string) {
      for (const listener of this.listeners.get(type) ?? []) listener();
    }
  }
  const index = createAudioIndex('apple\ta=*:u\n', 'en');

  it('streams Commons’ MP3 of the English file and says when it fails offline', () => {
    const audio = new FakeAudio();
    let online = true;
    const player = createPlayer({ createAudio: () => audio, isOnline: () => online, timeoutMs: 1000, errorMs: 500 });
    const source = index.sourceFor(english('apple'))!;
    player.play(source);
    expect(audio.plays).toEqual([source.mp3]);
    expect(source.mp3).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/transcoded\/.+\/En-us-apple\.ogg\/En-us-apple\.ogg\.mp3$/u);
    audio.emit('playing');
    expect(player.getState()).toEqual({ key: 'en:En-us-apple.ogg', status: 'playing', offline: false });
    online = false;
    player.play(index.sourceFor(english('APPLE'))!);
    // The same recording again while it plays starts over; a failure is told apart by the connection.
    player.stop();
    player.play(source);
    audio.emit('error');
    expect(player.getState()).toEqual({ key: 'en:En-us-apple.ogg', status: 'error', offline: true });
  });

  it('tells a German and an English recording of one title apart', () => {
    const germanSource = createAudioIndex('apple\tS a=*:=En-us-apple.ogg\n', 'de').sourceFor(german('apple', 'noun'))!;
    expect(germanSource.key).not.toBe(index.sourceFor(english('apple'))!.key);
  });
});

describe('the English Commons check', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vosli-commons-en-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const CATEGORIES: Record<string, string> = {
    'File:En-us-cake.ogg': 'Australian English pronunciation',
    'File:En-uk-cake.ogg': 'British English pronunciation',
    'File:En-us-apple.ogg': 'U.S. English pronunciation|GFDL',
  };
  const answer = (body: URLSearchParams) => ({
    query: {
      pages: body
        .get('titles')!
        .split('|')
        .map((title) => ({ title, imageinfo: [{ user: 'Uploader', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Speaker' }, Categories: { value: CATEGORIES[title] ?? '' } } }] })),
    },
  });

  it('reads the categories, keeps them with each check, and moves on from a file Commons files elsewhere', async () => {
    const filters: string[] = [];
    const asked: string[] = [];
    const recordings = new Map([
      ['cake', entries(record('cake', [us('En-us-cake.ogg'), uk('En-uk-cake.ogg')]))],
      ['apple', entries(record('apple', [us('En-us-apple.ogg')]))],
    ]);
    const cachePath = join(dir, 'commons-audio-en.tsv');
    await syncCommons({
      cachePath,
      recordings,
      batch: 50,
      pauseMs: 0,
      sleep: () => Promise.resolve(),
      log: () => {},
      categorize: englishCategory,
      choose: chooseEnglishAudio as never,
      fetchImpl: async (_url, init) => {
        const body = init.body as URLSearchParams;
        filters.push(body.get('iiextmetadatafilter')!);
        asked.push(...body.get('titles')!.split('|'));
        return new Response(JSON.stringify(answer(body)), { status: 200 });
      },
    });
    expect(filters.every((filter) => filter === 'LicenseShortName|Artist|Categories')).toBe(true);
    // The Australian file is not used, so the British one is asked about next.
    expect(asked).toEqual(['File:En-us-apple.ogg', 'File:En-us-cake.ogg', 'File:En-uk-cake.ogg']);
    const cache = parseCache(readFileSync(cachePath, 'utf8'));
    expect(cache.get('En-us-cake.ogg')).toMatchObject({ kind: 'other' });
    expect(cache.get('En-uk-cake.ogg')).toMatchObject({ kind: 'uk' });
    expect(chooseEnglishAudio(recordings.get('cake')!, (name) => cache.get(name)).chosen.get('*')).toMatchObject({ title: 'En-uk-cake.ogg', variety: 'uk' });
  });

  it('leaves the German check as it was: no categories asked for, four columns written', async () => {
    const filters: string[] = [];
    const cachePath = join(dir, 'commons-audio.tsv');
    await syncCommons({
      cachePath,
      recordings: new Map([['Apfel', [audioEntry({ pos: 'noun', tags: ['masculine'], sounds: [{ audio: 'De-Apfel.ogg' }] })!]]]),
      pauseMs: 0,
      sleep: () => Promise.resolve(),
      log: () => {},
      fetchImpl: async (_url, init) => {
        const body = init.body as URLSearchParams;
        filters.push(body.get('iiextmetadatafilter')!);
        return new Response(JSON.stringify(answer(body)), { status: 200 });
      },
    });
    expect(filters).toEqual(['LicenseShortName|Artist']);
    expect(readFileSync(cachePath, 'utf8')).toContain('De-Apfel.ogg\t\tCC BY-SA 4.0\tSpeaker\n');
  });
});
