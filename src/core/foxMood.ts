/**
 * Vosli's mood comes only from the clock, never from reviews, scores or streaks, so it can not nag.
 * Nothing here is stored: a fox woken in the night stays awake until the app is reopened or the next night.
 */
export type FoxMood = 'mischievous' | 'curious' | 'sleepy';

const SLEEP_FROM = 23 * 60 + 30;
const SLEEP_UNTIL = 5 * 60 + 30;
const DAY_MS = 86_400_000;
/** One day in this many, Vosli has both eyes open. The wink stays the usual face, because it is the logo. */
const CURIOUS_EVERY = 4;

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

export function isSleepTime(date: Date): boolean {
  const minutes = minutesOf(date);
  return minutes >= SLEEP_FROM || minutes < SLEEP_UNTIL;
}

/** Names one night: the hours before and after midnight share it, so waking the fox lasts until morning. */
export function nightOf(date: Date): string {
  const evening = new Date(date);
  if (minutesOf(date) < SLEEP_UNTIL) evening.setDate(evening.getDate() - 1);
  return `${evening.getFullYear()}-${evening.getMonth() + 1}-${evening.getDate()}`;
}

/** The same all day, so moving between screens never changes the face. */
export function daytimeMood(date: Date): FoxMood {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  return day % CURIOUS_EVERY === 0 ? 'curious' : 'mischievous';
}

export function moodAt(date: Date, wokenNight: string | null): FoxMood {
  return isSleepTime(date) && nightOf(date) !== wokenNight ? 'sleepy' : daytimeMood(date);
}
