/** Types for commons-sync.mjs, so its tests are checked like the app. */
import type { AudioEntry, Confirmed } from './dictionary-audio.mjs';

export class LockError extends Error {}
export function acquireLock(path: string, options?: { recoverStale?: boolean }): { release(): void };
export function saveCache(path: string, cache: Map<string, Confirmed | false>): void;

type Recordings = Map<string, AudioEntry[]>;
export interface SyncOptions {
  cachePath: string;
  recordings: Recordings | (() => Promise<{ recordings: Recordings; weight?: Map<string, number> }>);
  weight?: Map<string, number>;
  refresh?: boolean;
  recoverStale?: boolean;
  deadline?: number;
  shouldStop?: () => boolean;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  userAgent?: string;
  batch?: number;
  pauseMs?: number;
  saveEvery?: number;
  now?: () => number;
}
export function syncCommons(options: SyncOptions): Promise<{ requests: number; checked: number; stillToCheck: number; minutes: number }>;
