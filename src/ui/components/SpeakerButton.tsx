import { useEffect, useMemo, useState } from 'preact/hooks';
import { AUDIO_FILES, type AudioCredits, type AudioIndex, type PronunciationSource } from '../../audio/audioIndex';
import { player, type PlaybackStatus } from '../../audio/pronunciation';
import type { LearningLanguage } from '../../core/learningLanguage';
import type { Word } from '../../data/types';
import { appText } from '../../dictionary/loadDictionary';
import { t } from '../../i18n/strings';
import { useLearningLanguage } from '../workspace';
import { Icon } from './Icon';

type WordForm = Pick<Word, 'lemma' | 'article' | 'pos'> & { language?: Word['language'] };

interface Shared<T> {
  start(): Promise<T | null>;
  value(): T | null;
  wait(done: () => void): () => void;
}

/** A file read once for every speaker on screen, then kept. A failure is forgotten, so a later screen tries again. */
function sharedLoad<T>(load: () => Promise<T>): Shared<T> {
  let value: T | null = null;
  let loading: Promise<T | null> | null = null;
  const waiting = new Set<() => void>();
  const start = () => {
    loading ??= load().then(
      (result) => (value = result),
      (error: unknown) => {
        console.warn('Pronunciation data unavailable', error);
        loading = null;
        return null;
      },
    );
    void loading.then(() => waiting.forEach((done) => done()));
    return loading;
  };
  return {
    start,
    value: () => value,
    wait(done) {
      waiting.add(done);
      void start();
      return () => void waiting.delete(done);
    },
  };
}

/** The loaded value of one shared file, or null until it is there. Follows the file it is given. */
function useShared<T>(shared: Shared<T>): T | null {
  const [, rerender] = useState(0);
  useEffect(() => (shared.value() ? undefined : shared.wait(() => rerender((count) => count + 1))), [shared]);
  return shared.value();
}

// One index and one credits table per learning language, each from its own files: a word is only ever looked up
// among recordings of its own language. Code and data arrive on first need, so neither weighs on starting the app.
const byLanguage = <T,>(load: (language: LearningLanguage) => Promise<T>): Readonly<Record<LearningLanguage, Shared<T>>> => ({ de: sharedLoad(() => load('de')), en: sharedLoad(() => load('en')) });
const indexes = byLanguage<AudioIndex>(async (language) => {
  const [{ createAudioIndex }, text] = await Promise.all([import('../../audio/audioIndex'), appText(AUDIO_FILES[language].recordings)]);
  return createAudioIndex(text, language);
});
const creditTables = byLanguage<AudioCredits>(async (language) => {
  const [{ parseCredits }, text] = await Promise.all([import('../../audio/audioIndex'), appText(AUDIO_FILES[language].credits)]);
  return parseCredits(text);
});

/** Reads the workspace's index ahead, from the app's own files, so a speaker shown after an answer is ready at once. */
export function usePreparedPronunciation(): void {
  const language = useLearningLanguage();
  useEffect(() => void indexes[language].start(), [language]);
}

/** One language's index, for choosing words that can be heard. Null if the app's own file could not be read. */
export const loadAudioIndex = (language: LearningLanguage): Promise<AudioIndex | null> => indexes[language].start();

/** The workspace's index once it has loaded, or null until then. */
export const useAudioIndex = (): AudioIndex | null => useShared(indexes[useLearningLanguage()]);

/**
 * The recording for a word, or null while the index loads and for words without one. Only a word of the workspace's
 * own language is looked up, and only among that language's recordings: English also is not German also, however it
 * is spelled, and a recording never plays for a word of another language.
 */
export function usePronunciation(word: WordForm | null): PronunciationSource | null {
  const language = useLearningLanguage();
  const audioIndex = useShared(indexes[language]);
  const own = (word?.language ?? language) === language;
  return useMemo(() => (audioIndex && word && own && audioIndex.language === language ? audioIndex.sourceFor({ ...word, language }) : null), [audioIndex, own, language, word?.lemma, word?.article, word?.pos]);
}

export const useAudioCredits = (): AudioCredits | null => useShared(creditTables[useLearningLanguage()]);

/** This recording's status. Only the speaker whose status changed renders again, not every row. */
export function usePlaybackStatus(key: string | null): PlaybackStatus {
  const of = (state = player().getState()) => (key !== null && state.key === key ? state.status : 'idle');
  const [status, setStatus] = useState<PlaybackStatus>(() => of());
  useEffect(() => {
    setStatus(of());
    return player().subscribe((state) => setStatus(of(state)));
  }, [key]);
  return status;
}

export const SPEAKER_ICONS = { idle: 'speaker', loading: 'speaker', playing: 'speaker-on', error: 'speaker-off' } as const;

interface SpeakerButtonProps {
  word: WordForm;
  /** Keeps focus where it is, as the practice field must keep the phone keyboard open. */
  keepFocus?: boolean;
  class?: string;
}

/**
 * A quiet speaker beside a learner's word. It is only there when a confirmed recording in the word's own language
 * exists, and the screens only place it where the word is already in view, so it can never give an answer away.
 */
export function SpeakerButton({ word, keepFocus = false, class: extra = '' }: SpeakerButtonProps) {
  const source = usePronunciation(word);
  const status = usePlaybackStatus(source?.key ?? null);
  if (!source) return null;
  const label = t.lang[source.language].listen(word.article ? `${word.article} ${word.lemma}` : word.lemma);
  return (
    <button
      type="button"
      class={`icon-btn speaker-btn ${extra}`}
      data-status={status}
      data-testid="speaker"
      aria-label={label}
      title={label}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onClick={(event) => {
        // A separate target: never the row's link, never a card's or a form's own action.
        event.stopPropagation();
        player().play(source);
      }}
    >
      <Icon name={SPEAKER_ICONS[status]} />
    </button>
  );
}

/**
 * One place that says a recording failed, for screen readers. Rendered once, by the shell. A polite live
 * region rather than a second status role, so each screen keeps its own status the only one it has.
 */
export function PronunciationStatus() {
  const [message, setMessage] = useState('');
  useEffect(
    () =>
      player().subscribe((state) => {
        setMessage(state.status === 'error' ? (state.offline ? t.pronunciation.offline : t.pronunciation.failed) : '');
      }),
    [],
  );
  return <p class="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="pronunciation-status">{message}</p>;
}

/**
 * Who made the recording and under which license, with its Commons page; for English, also whether it is American
 * or British. Shown once, on the word's own page, so lists and cards stay uncluttered. A license without a deed to
 * link to is named plainly.
 */
export function PronunciationCredit({ word }: { word: WordForm }) {
  const source = usePronunciation(word);
  const table = useAudioCredits();
  if (!source || !table) return null;
  const author = table.author(source.author);
  const license = table.license(source.license);
  return (
    <p class="audio-credit" data-testid="audio-credit">
      {source.variety ? t.pronunciation.creditVariety(t.pronunciation.varieties[source.variety]) : t.pronunciation.credit}: {author && <>{author} · </>}
      {license && (license.url ? <><a href={license.url} target="_blank" rel="noopener noreferrer">{license.name}</a> · </> : <>{license.name} · </>)}
      <a href={source.page} target="_blank" rel="noopener noreferrer">{t.pronunciation.source}</a>
    </p>
  );
}
