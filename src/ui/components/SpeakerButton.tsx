import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AudioCredits, AudioIndex, PronunciationSource } from '../../audio/audioIndex';
import { player, type PlaybackStatus } from '../../audio/pronunciation';
import type { Word } from '../../data/types';
import { dictionaryText } from '../../dictionary/loadDictionary';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';

type WordForm = Pick<Word, 'lemma' | 'article' | 'pos'>;

/** A file read once for every speaker on screen, then kept. A failure is forgotten, so a later screen tries again. */
function sharedLoad<T>(load: () => Promise<T>) {
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
  const use = (): T | null => {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (value) return undefined;
      const done = () => rerender((count) => count + 1);
      waiting.add(done);
      void start();
      return () => void waiting.delete(done);
    }, []);
    return value;
  };
  return { start, use };
}

// Code and data both arrive on first need, as the dictionary's do, so neither weighs on starting the app.
const index = sharedLoad<AudioIndex>(async () => {
  const [{ createAudioIndex }, text] = await Promise.all([import('../../audio/audioIndex'), dictionaryText('lemmas.txt')]);
  return createAudioIndex(text);
});
const credits = sharedLoad<AudioCredits>(async () => {
  const [{ parseCredits }, text] = await Promise.all([import('../../audio/audioIndex'), dictionaryText('audio-credits.txt')]);
  return parseCredits(text);
});

/** Reads the index ahead, from the app's own files, so a speaker shown after an answer is ready at once. */
export const preparePronunciation = (): void => void index.start();

/** The recording for a word, or null while the index loads and for words without one. */
export function usePronunciation(word: WordForm | null): PronunciationSource | null {
  const audioIndex = index.use();
  return useMemo(() => (audioIndex && word ? audioIndex.sourceFor(word) : null), [audioIndex, word?.lemma, word?.article, word?.pos]);
}

export const useAudioCredits = (): AudioCredits | null => credits.use();

/** This recording's status. Only the speaker whose status changed renders again, not every row. */
function usePlaybackStatus(key: string | null): PlaybackStatus {
  const of = (state = player().getState()) => (key !== null && state.key === key ? state.status : 'idle');
  const [status, setStatus] = useState<PlaybackStatus>(() => of());
  useEffect(() => {
    setStatus(of());
    return player().subscribe((state) => setStatus(of(state)));
  }, [key]);
  return status;
}

const ICONS = { idle: 'speaker', loading: 'speaker', playing: 'speaker-on', error: 'speaker-off' } as const;

interface SpeakerButtonProps {
  word: WordForm;
  /** Keeps focus where it is, as the practice field must keep the phone keyboard open. */
  keepFocus?: boolean;
  class?: string;
}

/**
 * A quiet speaker beside a German word. It is only there when a confirmed recording exists, and the
 * screens only place it where the German is already in view, so it can never give an answer away.
 */
export function SpeakerButton({ word, keepFocus = false, class: extra = '' }: SpeakerButtonProps) {
  const source = usePronunciation(word);
  const status = usePlaybackStatus(source?.key ?? null);
  if (!source) return null;
  const label = t.pronunciation.listen(word.article ? `${word.article} ${word.lemma}` : word.lemma);
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
      <Icon name={ICONS[status]} />
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
 * Who made the recording and under which license, with its Commons page. Shown once, on the word's
 * own page, so lists and cards stay uncluttered. A license without a deed to link to is named plainly.
 */
export function PronunciationCredit({ word }: { word: WordForm }) {
  const source = usePronunciation(word);
  const table = useAudioCredits();
  if (!source || !table) return null;
  const author = table.author(source.author);
  const license = table.license(source.license);
  return (
    <p class="audio-credit" data-testid="audio-credit">
      {t.pronunciation.credit}: {author && <>{author} · </>}
      {license && (license.url ? <><a href={license.url} target="_blank" rel="noopener noreferrer">{license.name}</a> · </> : <>{license.name} · </>)}
      <a href={source.page} target="_blank" rel="noopener noreferrer">{t.pronunciation.source}</a>
    </p>
  );
}
