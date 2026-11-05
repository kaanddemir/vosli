import type { PronunciationSource } from './audioIndex';

/**
 * One player for the whole app. A recording plays only from a tap, never on its own; a second tap on
 * the one playing starts it again, and a tap on another stops the first. Nothing is stored beyond what
 * the browser's own HTTP cache keeps, and nothing here touches the learner's data.
 */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'error';

export interface PlaybackState {
  /** The recording the status is about. Every other one is idle. */
  key: string | null;
  status: PlaybackStatus;
  /** Set with an error, so the message can say whether the connection is the reason. */
  offline: boolean;
}

/** The part of HTMLAudioElement the player uses, so tests can stand in for it. */
export interface AudioLike {
  src: string;
  currentTime: number;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  canPlayType(type: string): string;
  addEventListener(type: string, listener: () => void): void;
}

export interface PlayerOptions {
  createAudio: () => AudioLike;
  isOnline?: () => boolean;
  /** How long a recording may take to start before it counts as failed. */
  timeoutMs?: number;
  /** How long a failure shows before the button returns to normal. */
  errorMs?: number;
}

export interface Player {
  play(source: PronunciationSource): void;
  stop(): void;
  getState(): PlaybackState;
  subscribe(listener: (state: PlaybackState) => void): () => void;
}

const IDLE: PlaybackState = { key: null, status: 'idle', offline: false };

export function createPlayer({ createAudio, isOnline = () => true, timeoutMs = 10_000, errorMs = 3000 }: PlayerOptions): Player {
  let audio: AudioLike | null = null;
  let state = IDLE;
  // Every start gets a new number, so events and promises from an earlier one are ignored.
  let attempt = 0;
  let current: { source: PronunciationSource; urls: string[]; index: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(state: PlaybackState) => void>();

  const set = (next: PlaybackState) => {
    if (next.key === state.key && next.status === state.status && next.offline === state.offline) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  };
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  /** Lets go of the file, so a failed or finished request does not keep the connection busy. */
  const release = (element: AudioLike) => {
    element.pause();
    element.removeAttribute('src');
    element.load();
  };

  const fail = (id: number) => {
    if (id !== attempt || !current) return;
    clearTimer();
    const key = current.source.key;
    current = null;
    if (audio) release(audio);
    set({ key, status: 'error', offline: !isOnline() });
    timer = setTimeout(() => {
      if (id === attempt) set(IDLE);
    }, errorMs);
  };

  /** The next way to get the file, or a failure when there is none left. */
  const next = (id: number) => {
    if (id !== attempt || !current) return;
    current.index++;
    if (current.index < current.urls.length) start(id);
    else fail(id);
  };

  const start = (id: number) => {
    const element = audio!;
    const { urls, index, source } = current!;
    clearTimer();
    timer = setTimeout(() => fail(id), timeoutMs);
    set({ key: source.key, status: 'loading', offline: false });
    element.src = urls[index]!;
    // Called within the tap itself: iOS plays only what a gesture started.
    element.play().catch((error: unknown) => {
      // A newer start interrupts this one on purpose; that is not a failure.
      if (id !== attempt || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') fail(id);
      else next(id);
    });
  };

  const element = (): AudioLike => {
    if (audio) return audio;
    const created = createAudio();
    created.preload = 'none';
    created.addEventListener('playing', () => {
      if (!current) return;
      clearTimer();
      set({ key: current.source.key, status: 'playing', offline: false });
    });
    created.addEventListener('ended', () => {
      if (!current) return;
      current = null;
      set(IDLE);
    });
    created.addEventListener('error', () => next(attempt));
    audio = created;
    return created;
  };

  return {
    play(source) {
      const el = element();
      // Again while it plays: from the start, with no new download.
      if (current?.source.key === source.key && state.status === 'playing') {
        el.currentTime = 0;
        return;
      }
      // Still starting: one tap is enough, a second must not start a second download.
      if (current?.source.key === source.key && state.status === 'loading') return;
      const id = ++attempt;
      if (current) el.pause();
      const urls = [source.mp3];
      if (source.originalType && el.canPlayType(source.originalType) !== '') urls.push(source.original);
      current = { source, urls, index: 0 };
      start(id);
    },
    stop() {
      attempt++;
      clearTimer();
      if (current && audio) release(audio);
      current = null;
      set(IDLE);
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let shared: Player | null = null;

/** The app's player, made on first use so nothing is created before someone taps a speaker. */
export function player(): Player {
  shared ??= createPlayer({ createAudio: () => new Audio(), isOnline: () => navigator.onLine });
  return shared;
}
