import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { audioEntry, audioTags, authorFrom, cacheText, chooseAudio, creditTables, fileCode, licenseUrl, parseCache, type Confirmed, type SoundRecord } from '../scripts/dictionary-audio.mjs';
import { commonsUrls, createAudioIndex, parseAudioTags, parseCredits, recordingFor } from '../src/audio/audioIndex';
import { md5 } from '../src/audio/md5';
import { createPlayer, type AudioLike } from '../src/audio/pronunciation';
import type { Word } from '../src/data/types';

const ok = (title: string, author = 'Jeuwre', license = 'CC BY-SA 4.0'): Confirmed => ({ title, author, license });
const noun = (genders: string[], files: string[], ipa = '[ˈapfl̩]'): SoundRecord => ({ pos: 'noun', tags: genders, sounds: [{ ipa }, ...files.map((audio) => ({ audio }))] });
const verb = (files: string[], ipa: string): SoundRecord => ({ pos: 'verb', sounds: [{ ipa }, ...files.map((audio) => ({ audio }))] });
const entries = (...records: SoundRecord[]) => records.map(audioEntry).filter((entry) => entry !== null);
const word = (lemma: string, pos: Word['pos'], article: Word['article'] = null) => ({ lemma, pos, article });

/** The tag the build writes, read back the way the app reads it. */
function roundTrip(lemma: string, records: SoundRecord[], cache: Map<string, Confirmed | false>) {
  const choice = chooseAudio(entries(...records), (name) => cache.get(name));
  const credits = creditTables([...choice.chosen.values()]);
  return { choice, line: ['S', ...audioTags(lemma, choice, credits.ids)].join(' '), credits };
}

describe('md5 and Commons URLs', () => {
  it('matches node for ASCII, umlauts, ß and long names', () => {
    for (const text of ['', 'De-Apfel.ogg', 'De-Tür.ogg', 'De-Straße.ogg', 'LL-Q188_(deu)-Sebastian_Wallroth-Fahrrad.wav', 'x'.repeat(200)]) {
      expect(md5(text)).toBe(createHash('md5').update(text, 'utf8').digest('hex'));
    }
  });

  it('builds the MP3 transcode, original and page URLs Commons serves', () => {
    // Checked against the Commons API in Phase 0.
    expect(commonsUrls('De-Apfel.ogg')).toEqual({
      mp3: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/5/57/De-Apfel.ogg/De-Apfel.ogg.mp3',
      original: 'https://upload.wikimedia.org/wikipedia/commons/5/57/De-Apfel.ogg',
      originalType: 'audio/ogg; codecs="vorbis"',
      page: 'https://commons.wikimedia.org/wiki/File:De-Apfel.ogg',
    });
    expect(commonsUrls('De-Tür.ogg').mp3).toBe('https://upload.wikimedia.org/wikipedia/commons/transcoded/2/24/De-T%C3%BCr.ogg/De-T%C3%BCr.ogg.mp3');
    // Spaces become underscores before hashing, as on Commons.
    expect(commonsUrls('LL-Q188 (deu)-Sebastian Wallroth-Golf.wav')).toMatchObject({ originalType: 'audio/wav', page: 'https://commons.wikimedia.org/wiki/File:LL-Q188_(deu)-Sebastian_Wallroth-Golf.wav' });
  });
});

describe('choosing recordings at build time', () => {
  it('keeps standard German and drops regional or dialect recordings', () => {
    const entry = audioEntry({ pos: 'adj', sounds: [{ audio: 'De-at-schön.ogg', tags: ['Austrian German'] }, { audio: 'Bar-schön.ogg' }, { audio: 'De-schön.ogg' }, { audio: 'De-schön2.ogg', raw_tags: ['österreichisch'] }] });
    expect(entry?.files).toEqual(['De-schön.ogg']);
    expect(audioEntry({ pos: 'adj', sounds: [{ audio: 'De-at-x.ogg', tags: ['Austrian German'] }] })).toBeNull();
  });

  it('prefers De- Ogg files, then other formats, and removes invisible marks from links', () => {
    const entry = audioEntry({ pos: 'noun', tags: ['neuter'], sounds: [{ audio: 'LL-Q188 (deu)-X-Fahrrad.wav' }, { audio: 'De-Fahrrad.ogg‎‎' }, { audio: 'De-Fahrrad2.ogg' }] });
    expect(entry).toMatchObject({ keys: ['nn'], files: ['De-Fahrrad.ogg', 'De-Fahrrad2.ogg', 'LL-Q188 (deu)-X-Fahrrad.wav'] });
  });

  it('keeps nouns apart by gender and words apart by part of speech', () => {
    const cache = new Map([['De-Rentier.ogg', ok('De-Rentier.ogg')], ['De-Rentier2.ogg', ok('De-Rentier2.ogg')]]);
    const { line } = roundTrip('Rentier', [noun(['masculine'], ['De-Rentier.ogg'], '[ʁɑ̃ˈti̯eː]'), noun(['neuter'], ['De-Rentier2.ogg'], '[ˈʁeːnˌtiːɐ̯]')], cache);
    expect(recordingFor(word('Rentier', 'noun', 'der'), line)?.title).toBe('De-Rentier.ogg');
    expect(recordingFor(word('Rentier', 'noun', 'das'), line)?.title).toBe('De-Rentier2.ogg');
    // Different recordings, and the word gives no way to choose: silence rather than a guess.
    expect(recordingFor(word('Rentier', 'other'), line)).toBeNull();

    const modern = new Map([['De-modern.ogg', ok('De-modern.ogg')], ['De-modern2.ogg', ok('De-modern2.ogg')]]);
    const both = roundTrip('modern', [{ pos: 'adj', sounds: [{ ipa: '[moˈdɛʁn]' }, { audio: 'De-modern.ogg' }] }, verb(['De-modern2.ogg'], '[ˈmoːdɐn]')], modern);
    expect(recordingFor(word('modern', 'adjective'), both.line)?.title).toBe('De-modern.ogg');
    expect(recordingFor(word('modern', 'verb'), both.line)?.title).toBe('De-modern2.ogg');
  });

  it('suppresses a homograph whose pronunciations differ only in stress', () => {
    const cache = new Map([['De-umfahren.ogg', ok('De-umfahren.ogg')], ['De-umfahren2.ogg', ok('De-umfahren2.ogg')]]);
    const { choice, line } = roundTrip('umfahren', [verb(['De-umfahren.ogg'], '[ʊmˈfaːʁən]'), verb(['De-umfahren2.ogg'], '[ˈʊmˌfaːʁən]')], cache);
    expect(choice.ambiguous).toBe(true);
    expect(choice.chosen.size).toBe(0);
    expect(recordingFor(word('umfahren', 'verb'), line)).toBeNull();
  });

  it('does not suppress senses that share one pronunciation and one recording', () => {
    const cache = new Map([['De-Kiefer.ogg', ok('De-Kiefer.ogg')]]);
    const { choice, line } = roundTrip('Kiefer', [noun(['feminine'], ['De-Kiefer.ogg'], '[ˈkiːfɐ]'), noun(['masculine'], ['De-Kiefer.ogg'], '[ˈkiːfɐ]')], cache);
    expect(choice.ambiguous).toBe(false);
    expect(line).toBe('S a=*:');
    expect(recordingFor(word('Kiefer', 'noun', 'die'), line)?.title).toBe('De-Kiefer.ogg');
  });

  it('uses the canonical title of a redirected link and moves past a missing file', () => {
    const cache = new Map<string, Confirmed | false>([['De-Tür.OGG', ok('De-Tür.ogg')], ['De-Vogel.ogg', false], ['De-Vogel2.ogg', ok('De-Vogel2.ogg')]]);
    expect(roundTrip('Tür', [noun(['feminine'], ['De-Tür.OGG'])], cache).line).toBe('S a=*:');
    expect(roundTrip('Vogel', [noun(['masculine'], ['De-Vogel.ogg', 'De-Vogel2.ogg'])], cache).line).toBe('S a=*:2');
  });

  it('waits for Commons rather than skip to a recording that was not the first choice', () => {
    const cache = new Map([['De-Haus2.ogg', ok('De-Haus2.ogg')]]);
    const { choice, line } = roundTrip('Haus', [noun(['neuter'], ['De-Haus.ogg', 'De-Haus2.ogg'])], cache);
    expect(choice.pending).toEqual(['De-Haus.ogg']);
    expect(line).toBe('S');
  });

  it('writes unusual titles in full and credits other authors and licenses by number', () => {
    expect(fileCode('Band', 'De-Band.oga')).toBe('=De-Band.oga');
    expect(fileCode('1. Weltkrieg', 'De-1. Weltkrieg.ogg')).toBe('');
    const cache = new Map([['De-Apfel.ogg', ok('De-Apfel.ogg', 'Kampy', 'CC BY-SA 3.0')], ['De-Apfel2.ogg', ok('De-Apfel2.ogg')]]);
    const choice = chooseAudio(entries(noun(['masculine'], ['De-Apfel.ogg'])), (name) => cache.get(name));
    // Jeuwre and CC BY-SA 4.0 are the most common, so they are 0 and left out.
    const ids = creditTables([ok('a'), ok('b'), ok('c', 'Kampy', 'CC BY-SA 3.0')]).ids;
    const line = ['S', ...audioTags('Apfel', choice, ids)].join(' ');
    expect(line).toBe('S a=*:#1.1');
    expect(recordingFor(word('Apfel', 'noun', 'der'), line)).toEqual({ title: 'De-Apfel.ogg', author: 1, license: 1 });
  });

  it('reads and writes the Commons cache, and names the uploader when the author field names no one', () => {
    const cache = new Map<string, Confirmed | false>([['De-Tür.OGG', ok('De-Tür.ogg')], ['De-Gone.ogg', false], ['De-Apfel.ogg', ok('De-Apfel.ogg')]]);
    expect(parseCache(cacheText(cache))).toEqual(cache);
    expect(() => parseCache('De-X.ogg\tbroken')).toThrow(/line 1/u);
    expect(authorFrom('<a href="//commons.wikimedia.org/wiki/User:Jeuwre">Jeuwre</a>', 'Someone')).toBe('Jeuwre');
    expect(authorFrom('Own work', 'Uploader')).toBe('Uploader');
    expect(authorFrom('No machine-readable author provided. X assumed (based on copyright claims).', 'X')).toBe('X');
    expect(licenseUrl('CC BY 3.0 us')).toBe('https://creativecommons.org/licenses/by/3.0/us/');
    expect(licenseUrl('CC0')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(licenseUrl('Public domain')).toBe('');
  });
});

describe('looking up a word in the app', () => {
  const lemmas = ['Apfel\tNS gm c a=*:#1.1', 'Hochzeit\tS gf c', 'so\tDO c a=d:|a! ', 'Tür\tS gf c a=*:', ''].join('\n');

  it('finds recordings by lemma, and none for words without one', () => {
    const index = createAudioIndex(lemmas);
    expect(index.sourceFor(word('Apfel', 'noun', 'der'))).toMatchObject({ title: 'De-Apfel.ogg', author: 1, license: 1, key: 'De-Apfel.ogg', page: 'https://commons.wikimedia.org/wiki/File:De-Apfel.ogg' });
    expect(index.sourceFor(word('Hochzeit', 'noun', 'die'))).toBeNull();
    expect(index.sourceFor(word('Quatschwort', 'noun', 'das'))).toBeNull();
    // Another part of speech of a word marked ambiguous gets nothing, even though one key has a recording.
    expect(index.sourceFor(word('so', 'other'))).toBeNull();
    expect(index.sourceFor(word('so', 'adverb'))?.title).toBe('De-so.ogg');
  });

  it('reads the credit tables', () => {
    const credits = parseCredits('L\t0\tCC BY-SA 4.0\thttps://creativecommons.org/licenses/by-sa/4.0/\nL\t1\tPublic domain\t\nA\t0\tJeuwre\n');
    expect(credits.author(0)).toBe('Jeuwre');
    expect(credits.license(1)).toEqual({ name: 'Public domain', url: '' });
    expect(credits.license(7)).toBeNull();
    expect(parseAudioTags('Apfel', 'NS gm c')).toBeNull();
  });
});

/** Stands in for HTMLAudioElement: records what was asked and lets a test play the browser's part. */
class FakeAudio implements AudioLike {
  src = '';
  currentTime = 0;
  preload = '';
  plays: string[] = [];
  playResult: () => Promise<void> = () => Promise.resolve();
  canPlay = '';
  private listeners = new Map<string, (() => void)[]>();
  play() {
    this.plays.push(this.src);
    return this.playResult();
  }
  pause() {}
  load() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  canPlayType() {
    return this.canPlay;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const source = (title: string) => ({ title, author: 0, license: 0, key: title, ...commonsUrls(title) });

describe('the shared player', () => {
  const setup = (options: { online?: boolean } = {}) => {
    const audio = new FakeAudio();
    let made = 0;
    const player = createPlayer({ createAudio: () => (made++, audio), isOnline: () => options.online ?? true, timeoutMs: 1000, errorMs: 500 });
    const states: string[] = [];
    player.subscribe((state) => states.push(`${state.key ?? '-'}:${state.status}`));
    return { audio, player, states, made: () => made };
  };

  it('creates nothing until the first tap, and plays the MP3 inside it', () => {
    const { audio, player, made } = setup();
    expect(made()).toBe(0);
    player.play(source('De-Apfel.ogg'));
    expect(made()).toBe(1);
    expect(audio.plays).toEqual([source('De-Apfel.ogg').mp3]);
    expect(audio.preload).toBe('none');
    expect(player.getState()).toMatchObject({ key: 'De-Apfel.ogg', status: 'loading' });
    audio.emit('playing');
    expect(player.getState().status).toBe('playing');
    audio.emit('ended');
    expect(player.getState()).toMatchObject({ key: null, status: 'idle' });
  });

  it('restarts the same recording instead of downloading it twice, and ignores taps while it starts', () => {
    const { audio, player } = setup();
    player.play(source('De-Apfel.ogg'));
    player.play(source('De-Apfel.ogg'));
    expect(audio.plays).toHaveLength(1);
    audio.emit('playing');
    audio.currentTime = 0.4;
    player.play(source('De-Apfel.ogg'));
    expect(audio.currentTime).toBe(0);
    expect(audio.plays).toHaveLength(1);
    // Played to the end, a tap plays it again.
    audio.emit('ended');
    player.play(source('De-Apfel.ogg'));
    expect(audio.plays).toHaveLength(2);
  });

  it('plays only one recording: another word stops the first', () => {
    const { audio, player, states } = setup();
    const pause = vi.spyOn(audio, 'pause');
    player.play(source('De-Apfel.ogg'));
    audio.emit('playing');
    player.play(source('De-Haus.ogg'));
    expect(pause).toHaveBeenCalled();
    expect(audio.src).toBe(source('De-Haus.ogg').mp3);
    expect(player.getState()).toMatchObject({ key: 'De-Haus.ogg', status: 'loading' });
    expect(states).toEqual(['De-Apfel.ogg:loading', 'De-Apfel.ogg:playing', 'De-Haus.ogg:loading']);
  });

  it('tries the original when the MP3 fails and the browser can play it, then reports the failure', async () => {
    vi.useFakeTimers();
    const { audio, player } = setup();
    audio.canPlay = 'probably';
    player.play(source('De-Apfel.ogg'));
    audio.emit('error');
    expect(audio.src).toBe(source('De-Apfel.ogg').original);
    audio.emit('error');
    expect(player.getState()).toMatchObject({ key: 'De-Apfel.ogg', status: 'error', offline: false });
    vi.advanceTimersByTime(500);
    expect(player.getState().status).toBe('idle');
    vi.useRealTimers();
  });

  it('does not offer a format the browser cannot play', () => {
    const { audio, player } = setup();
    player.play(source('De-Apfel.ogg'));
    audio.emit('error');
    expect(audio.plays).toHaveLength(1);
    expect(player.getState().status).toBe('error');
  });

  it('gives up on a recording that does not start in time, and says when the device is offline', () => {
    vi.useFakeTimers();
    const { audio, player } = setup({ online: false });
    player.play(source('De-Apfel.ogg'));
    vi.advanceTimersByTime(1000);
    expect(player.getState()).toMatchObject({ status: 'error', offline: true });
    expect(audio.src).toBe('');
    // A late start from the abandoned request changes nothing.
    audio.emit('playing');
    expect(player.getState().status).toBe('error');
    vi.useRealTimers();
  });

  it('treats a refused start as a failure and an interrupted one as nothing', async () => {
    const { audio, player } = setup();
    audio.playResult = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    player.play(source('De-Apfel.ogg'));
    await Promise.resolve();
    await Promise.resolve();
    expect(player.getState().status).toBe('error');

    const second = setup();
    second.audio.playResult = () => Promise.reject(new DOMException('replaced', 'AbortError'));
    second.player.play(source('De-Apfel.ogg'));
    await Promise.resolve();
    await Promise.resolve();
    expect(second.player.getState().status).toBe('loading');
  });

  it('stops on request, so a card or question left behind goes quiet', () => {
    const { audio, player } = setup();
    player.play(source('De-Apfel.ogg'));
    audio.emit('playing');
    player.stop();
    expect(player.getState()).toMatchObject({ key: null, status: 'idle' });
    expect(audio.src).toBe('');
    audio.emit('ended');
    expect(player.getState().status).toBe('idle');
  });
});
