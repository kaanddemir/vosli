/**
 * The Commons check behind sync-commons-audio.mjs, apart from reading the dump, so it can be tested with
 * a stand-in for Commons and a temporary cache.
 *
 * Two promises it keeps for the cache in scripts/data/commons-audio.tsv:
 * - Progress survives failure. Checks are written every few requests, and once more however the run ends,
 *   short of the process being killed outright. Each write goes to a temporary file that then replaces the
 *   cache in one rename, so the cache is never half written.
 * - One run at a time. A lock file beside the cache is made before the cache is read, and only ever by
 *   creating it new. A second run finds it and stops without touching anything.
 */
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authorFrom, cacheText, chooseAudio, parseCache, plainText } from './dictionary-audio.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';

export class LockError extends Error {}

/** Whether a process with this id is running on this machine. A process owned by someone else still counts. */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const readLock = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Takes the lock, or throws a LockError that says what to do. The lock is only ever created new, never
 * written over. A lock is called stale only when it was made on this machine and its process is gone;
 * its age alone says nothing, since a full run takes hours. Even then it is removed only when asked to.
 */
export function acquireLock(path, { recoverStale = false } = {}) {
  const token = randomUUID();
  const content = JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token });
  const create = () => {
    const fd = openSync(path, 'wx');
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
  };
  try {
    create();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const held = readLock(path);
    const stale = held !== null && held.host === hostname() && Number.isInteger(held.pid) && !isRunning(held.pid);
    if (!stale) {
      const who = held ? `process ${held.pid} on ${held.host}, since ${held.startedAt}` : 'a lock file that cannot be read';
      throw new LockError(`Another Commons sync is running (${who}). Wait for it to finish. If you are sure none is running, remove ${path} and try again.`);
    }
    if (!recoverStale) {
      throw new LockError(`A Commons sync stopped without cleaning up: process ${held.pid} left ${path} and is no longer running. Run again with --recover-stale-lock to take it over, or remove the file.`);
    }
    // Set aside under a name of its own, then checked: if another run took it meanwhile, it is put back.
    const aside = `${path}.stale-${token}`;
    renameSync(path, aside);
    if (JSON.stringify(readLock(aside)) !== JSON.stringify(held)) {
      renameSync(aside, path);
      throw new LockError(`Another Commons sync took over ${path} at the same moment. Nothing was changed.`);
    }
    unlinkSync(aside);
    create();
  }
  return {
    /** Removes the lock only if it is still this run's own. */
    release() {
      if (readLock(path)?.token === token) unlinkSync(path);
    },
  };
}

/** Writes the whole cache to a temporary file, then puts it in place with one rename. */
export function saveCache(path, cache) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, cacheText(cache));
  renameSync(temporary, path);
}

/**
 * Checks recordings with Commons until none are left, time runs out or stopping is asked for.
 * recordings maps each word to its audioEntry results, or is a function that reads them, called only once
 * the lock is held, so a second run stops at once instead of reading the dump first. weight orders the
 * words, most used first.
 */
export async function syncCommons({
  cachePath,
  recordings,
  weight = new Map(),
  refresh = false,
  recoverStale = false,
  deadline = Infinity,
  shouldStop = () => false,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  userAgent = 'VosliDictionaryBuild/1.0 (pronunciation metadata check)',
  batch = 50,
  pauseMs = 1000,
  saveEvery = 20,
  now = Date.now,
}) {
  mkdirSync(dirname(cachePath), { recursive: true });
  const lock = acquireLock(`${cachePath}.lock`, { recoverStale });
  try {
    if (typeof recordings === 'function') {
      const loaded = await recordings();
      recordings = loaded.recordings;
      weight = loaded.weight ?? weight;
    }
    const cache = existsSync(cachePath) ? parseCache(readFileSync(cachePath, 'utf8')) : new Map();
    let unsaved = 0;
    const checkpoint = () => {
      if (unsaved === 0) return;
      saveCache(cachePath, cache);
      unsaved = 0;
    };
    try {
      return await run(cache, () => unsaved++, checkpoint);
    } finally {
      // However the run ends, what Commons already answered is kept. An error still goes on to the caller.
      checkpoint();
    }
  } finally {
    lock.release();
  }

  async function run(cache, changed, checkpoint) {
    // Most translated first: a run that stops early has still covered the words learners meet.
    const words = [...recordings.keys()].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    log(`${words.length} words with recordings, ${cache.size} recordings checked before`);
    const rechecked = new Set();

    /** What the next round must ask about: the first unchecked recording of each key, or with refresh every chosen one once. */
    const needed = () => {
      const names = [];
      const seen = new Set();
      const lookup = (name) => (refresh && !rechecked.has(name) && cache.get(name) !== undefined ? undefined : cache.get(name));
      for (const word of words) {
        for (const name of chooseAudio(recordings.get(word), lookup).pending) {
          if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        }
      }
      return names;
    };

    const ask = async (names) => {
      const body = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        redirects: '1',
        maxlag: '5',
        prop: 'imageinfo',
        iiprop: 'user|extmetadata',
        iiextmetadatafilter: 'LicenseShortName|Artist',
        titles: names.map((name) => `File:${name}`).join('|'),
      });
      for (let failures = 0; ; ) {
        try {
          const response = await fetchImpl(API, { method: 'POST', body, headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent }, signal: AbortSignal.timeout(60_000) });
          if (response.status === 429 || response.status >= 500) {
            const wait = Number(response.headers.get('retry-after')) || 15;
            log(`Commons asked to wait ${wait}s (${response.status})`);
            await sleep(wait * 1000 + 1000);
            continue;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (data.error?.code === 'maxlag') {
            await sleep((Number(response.headers.get('retry-after')) || 5) * 1000);
            continue;
          }
          if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
          return data.query;
        } catch (error) {
          if (++failures >= 5) throw error;
          log(`Request failed (${error.message}), trying again`);
          await sleep(5000 * failures);
        }
      }
    };

    /** Maps every answer back to the name the link used, through Commons' normalizing and redirects. */
    const record = (names, query) => {
      const original = new Map();
      for (const item of query.normalized ?? []) original.set(item.to, original.get(item.from) ?? item.from);
      for (const item of query.redirects ?? []) original.set(item.to, original.get(item.from) ?? item.from);
      const answered = new Set();
      for (const page of query.pages ?? []) {
        const asked = (original.get(page.title) ?? page.title).replace(/^File:/u, '');
        const name = names.includes(asked) ? asked : (names.find((candidate) => `File:${candidate}` === page.title) ?? asked);
        answered.add(name);
        rechecked.add(name);
        const info = page.imageinfo?.[0];
        const license = plainText(info?.extmetadata?.LicenseShortName?.value);
        // Missing, or without a license to follow: either way not a recording to use.
        if (page.missing !== undefined || page.invalid !== undefined || !info || !license) cache.set(name, false);
        else cache.set(name, { title: page.title.replace(/^File:/u, ''), license, author: authorFrom(info.extmetadata?.Artist?.value, info.user) });
        changed();
      }
      // A name Commons did not mention at all is left unchecked, to be asked again next time.
      return names.filter((name) => !answered.has(name));
    };

    const started = now();
    let requests = 0;
    let round = needed();
    const unanswered = new Set();
    const going = () => !shouldStop() && now() < deadline;
    while (round.length && going()) {
      log(`${round.length} recordings to check`);
      for (let at = 0; at < round.length && going(); at += batch) {
        const names = round.slice(at, at + batch);
        for (const name of record(names, await ask(names))) unanswered.add(name);
        if (++requests % saveEvery === 0) {
          checkpoint();
          log(`${requests} requests, ${cache.size} checked, ${Math.round((now() - started) / 60_000)} min`);
        }
        await sleep(pauseMs);
      }
      // A missing first choice makes the next recording of that key the one to check.
      round = needed().filter((name) => !unanswered.has(name));
    }
    return { requests, checked: cache.size, stillToCheck: needed().length, minutes: Math.round((now() - started) / 60_000) };
  }
}
