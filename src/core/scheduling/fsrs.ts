import { DefaultScheduler, Rating } from 'ts-fsrs';

/**
 * The only module that talks to ts-fsrs. Everything else uses plain, JSON-safe state, so
 * stored cards and backups contain no Date objects and a library upgrade stays contained.
 *
 * The model is pinned on purpose: DefaultScheduler() alone would select FSRS-7, which
 * sends a first correct answer straight to a multi-day interval and skips learning steps.
 */
export const SCHEDULER_VERSION = 'ts-fsrs@6.0.0/FSRS-6/v1';

const CONFIG = {
  version: 'FSRS-6',
  desiredRetention: 0.9,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  enableFuzz: false,
  maximumInterval: 36_500,
} as const;

export type Grade = 'again' | 'hard' | 'good';

const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good } as const;

export interface FsrsState {
  stability: number;
  difficulty: number;
  dueAt: number;
  lastReviewAt: number | null;
  state: number;
  scheduleStatus: string;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep: number;
}

type Scheduler = Awaited<ReturnType<typeof createLibraryScheduler>>;
type LibraryCard = ReturnType<Scheduler['newCard']>;

function createLibraryScheduler() {
  return DefaultScheduler({ ...CONFIG, learningSteps: [...CONFIG.learningSteps], relearningSteps: [...CONFIG.relearningSteps] });
}

let schedulerPromise: Promise<Scheduler> | undefined;
function getScheduler(): Promise<Scheduler> {
  return (schedulerPromise ??= createLibraryScheduler());
}

function toState(card: LibraryCard): FsrsState {
  const { stability, difficulty, dueAt, lastReviewAt, state, scheduleStatus, reps, lapses, scheduledDays, learningStep } = card;
  return {
    stability,
    difficulty,
    dueAt: dueAt.getTime(),
    lastReviewAt: lastReviewAt ? lastReviewAt.getTime() : null,
    state,
    scheduleStatus,
    reps,
    lapses,
    scheduledDays,
    learningStep,
  };
}

function toLibraryCard(scheduler: Scheduler, state: FsrsState, now: number): LibraryCard {
  return {
    ...scheduler.newCard({ now: new Date(now) }),
    ...state,
    dueAt: new Date(state.dueAt),
    lastReviewAt: state.lastReviewAt === null ? null : new Date(state.lastReviewAt),
  } as LibraryCard;
}

export async function createFsrsState(now: number): Promise<FsrsState> {
  const scheduler = await getScheduler();
  return toState(scheduler.newCard({ now: new Date(now) }));
}

/** Pure with respect to its input: returns the next state and leaves `state` untouched. */
export async function applyGrade(state: FsrsState, grade: Grade, now: number): Promise<FsrsState> {
  const scheduler = await getScheduler();
  // The library refuses a review dated before the last one, which a device clock set back would cause.
  const at = Math.max(now, state.lastReviewAt ?? now);
  const { card } = scheduler.review({ card: toLibraryCard(scheduler, state, at), grade: RATINGS[grade], now: new Date(at) });
  return toState(card);
}

/** Where a card stands, in the library's terms: New 0, Learning 1, Review 2, Relearning 3. */
type CardPhase = 'new' | 'learning' | 'review';

export function phaseOf(state: Pick<FsrsState, 'state'>): CardPhase {
  if (state.state === 0) return 'new';
  return state.state === 2 ? 'review' : 'learning';
}
