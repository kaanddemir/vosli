import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockError, saveCache, syncCommons } from '../scripts/commons-sync.mjs';
import { audioEntry, cacheText, parseCache, type AudioEntry, type Confirmed } from '../scripts/dictionary-audio.mjs';

/** Three words, one recording each, so a batch of one is one word. */
const RECORDINGS = new Map<string, AudioEntry[]>(
  ['Apfel', 'Haus', 'Tür'].map((word) => [word, [audioEntry({ pos: 'noun', tags: ['neuter'], sounds: [{ audio: `De-${word}.ogg` }] })!]]),
);

/** Answers the way the Commons API does, for whichever file titles were asked. */
const answer = (body: URLSearchParams) => {
  const titles = body.get('titles')!.split('|');
  return { query: { pages: titles.map((title) => ({ title, imageinfo: [{ user: 'Uploader', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Jeuwre' } } }] })) } };
};
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

let dir: string;
let cachePath: string;
const quiet = () => {};
const instant = () => Promise.resolve();
const base = () => ({ cachePath, recordings: RECORDINGS, batch: 1, pauseMs: 0, sleep: instant, log: quiet });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vosli-commons-'));
  cachePath = join(dir, 'commons-audio.tsv');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A process id that existed a moment ago and is gone now. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

describe('the Commons sync', () => {
  it('checks every recording, writes the cache and releases its lock', async () => {
    const asked: string[] = [];
    const result = await syncCommons({
      ...base(),
      fetchImpl: async (_url, init) => {
        const body = init.body as URLSearchParams;
        asked.push(body.get('titles')!);
        // Nothing here may reach Wikimedia: every request is answered by this stand-in.
        return ok(answer(body));
      },
    });
    expect(result).toMatchObject({ requests: 3, checked: 3, stillToCheck: 0 });
    expect(asked).toHaveLength(3);
    expect(parseCache(readFileSync(cachePath, 'utf8')).get('De-Haus.ogg')).toEqual({ title: 'De-Haus.ogg', license: 'CC BY-SA 4.0', author: 'Jeuwre' });
    expect(existsSync(`${cachePath}.lock`)).toBe(false);
    expect(readdirSync(dir)).toEqual(['commons-audio.tsv']);
  });

  it('turns away a second run while the first holds the lock, and changes nothing', async () => {
    writeFileSync(cachePath, cacheText(new Map([['De-Apfel.ogg', { title: 'De-Apfel.ogg', license: 'CC0', author: 'A' }]])));
    const before = readFileSync(cachePath, 'utf8');
    const first = acquireLock(`${cachePath}.lock`);
    const lock = readFileSync(`${cachePath}.lock`, 'utf8');
    let called = false;
    await expect(
      syncCommons({
        ...base(),
        recordings: async () => {
          called = true;
          return { recordings: RECORDINGS };
        },
        fetchImpl: async () => {
          throw new Error('must not ask Commons');
        },
      }),
    ).rejects.toThrow(/Another Commons sync is running/u);
    // It stopped before reading anything: not the dump, not the cache.
    expect(called).toBe(false);
    expect(readFileSync(cachePath, 'utf8')).toBe(before);
    expect(readFileSync(`${cachePath}.lock`, 'utf8')).toBe(lock);
    first.release();
    expect(existsSync(`${cachePath}.lock`)).toBe(false);
  });

  it('keeps what Commons answered when a later request fails for good, and still reports the failure', async () => {
    let calls = 0;
    const run = syncCommons({
      ...base(),
      saveEvery: 100,
      fetchImpl: async (_url, init) => {
        calls++;
        if (calls <= 2) return ok(answer(init.body as URLSearchParams));
        throw new Error('network down');
      },
    });
    await expect(run).rejects.toThrow('network down');
    // Two answers arrived before the failure, and no checkpoint was due: the final save kept them.
    expect([...parseCache(readFileSync(cachePath, 'utf8')).keys()]).toHaveLength(2);
    expect(existsSync(`${cachePath}.lock`)).toBe(false);
    expect(readdirSync(dir)).toEqual(['commons-audio.tsv']);
  });

  it('honors Retry-After and keeps checkpointing as it goes', async () => {
    const waits: number[] = [];
    let calls = 0;
    const seenAtSecondRequest: string[] = [];
    await syncCommons({
      ...base(),
      saveEvery: 1,
      sleep: async (ms) => void waits.push(ms),
      fetchImpl: async (_url, init) => {
        calls++;
        if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
        if (calls === 3) seenAtSecondRequest.push(...parseCache(readFileSync(cachePath, 'utf8')).keys());
        return ok(answer(init.body as URLSearchParams));
      },
    });
    expect(waits).toContain(8000);
    // The first answer was on disk before the next request went out.
    expect(seenAtSecondRequest).toHaveLength(1);
  });

  it('writes the cache in one step: a failed write leaves the old cache whole', () => {
    const old = new Map<string, Confirmed | false>([['De-Apfel.ogg', { title: 'De-Apfel.ogg', license: 'CC0', author: 'A' }]]);
    saveCache(cachePath, old);
    const before = readFileSync(cachePath, 'utf8');
    // A directory where the temporary file would go makes that write fail.
    const blocker = `${cachePath}.${process.pid}.tmp`;
    mkdirSync(blocker);
    expect(() => saveCache(cachePath, new Map([...old, ['De-Haus.ogg', false]]))).toThrow();
    expect(readFileSync(cachePath, 'utf8')).toBe(before);
    rmSync(blocker, { recursive: true });
    saveCache(cachePath, new Map([...old, ['De-Haus.ogg', false]]));
    expect(parseCache(readFileSync(cachePath, 'utf8')).get('De-Haus.ogg')).toBe(false);
    expect(readdirSync(dir)).toEqual(['commons-audio.tsv']);
  });

  it('picks up after an interrupted run without asking again about what it already confirmed', async () => {
    let stop = false;
    const first: string[] = [];
    await syncCommons({
      ...base(),
      shouldStop: () => stop,
      fetchImpl: async (_url, init) => {
        const body = init.body as URLSearchParams;
        first.push(body.get('titles')!);
        stop = true; // Ctrl+C during the first request.
        return ok(answer(body));
      },
    });
    expect(first).toHaveLength(1);
    expect(existsSync(`${cachePath}.lock`)).toBe(false);
    const second: string[] = [];
    const result = await syncCommons({
      ...base(),
      fetchImpl: async (_url, init) => {
        const body = init.body as URLSearchParams;
        second.push(body.get('titles')!);
        return ok(answer(body));
      },
    });
    expect(second).toHaveLength(2);
    expect(second).not.toContain(first[0]);
    expect(result).toMatchObject({ checked: 3, stillToCheck: 0 });
  });
});

describe('the sync lock', () => {
  const lockPath = () => `${cachePath}.lock`;
  const write = (lock: object) => writeFileSync(lockPath(), JSON.stringify(lock));

  it('never takes over a lock whose process is running, however old', () => {
    write({ pid: process.pid, host: hostname(), startedAt: '2001-01-01T00:00:00.000Z', token: 'other' });
    expect(() => acquireLock(lockPath(), { recoverStale: true })).toThrow(LockError);
    expect(JSON.parse(readFileSync(lockPath(), 'utf8')).token).toBe('other');
  });

  it('never takes over a lock from another machine or one it cannot read', () => {
    write({ pid: deadPid(), host: 'another-machine', startedAt: '2001-01-01T00:00:00.000Z', token: 'remote' });
    expect(() => acquireLock(lockPath(), { recoverStale: true })).toThrow(/Another Commons sync is running/u);
    writeFileSync(lockPath(), 'not json');
    expect(() => acquireLock(lockPath(), { recoverStale: true })).toThrow(/cannot be read/u);
    expect(readFileSync(lockPath(), 'utf8')).toBe('not json');
  });

  it('names a stale lock and takes it over only when asked', () => {
    const left = { pid: deadPid(), host: hostname(), startedAt: new Date().toISOString(), token: 'gone' };
    write(left);
    expect(() => acquireLock(lockPath())).toThrow(/--recover-stale-lock/u);
    expect(JSON.parse(readFileSync(lockPath(), 'utf8'))).toEqual(left);
    const lock = acquireLock(lockPath(), { recoverStale: true });
    expect(JSON.parse(readFileSync(lockPath(), 'utf8')).pid).toBe(process.pid);
    lock.release();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('removes only its own lock on the way out', () => {
    const lock = acquireLock(lockPath());
    // Someone removed it by hand and another run started: that run's lock must survive.
    write({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token: 'newer' });
    lock.release();
    expect(JSON.parse(readFileSync(lockPath(), 'utf8')).token).toBe('newer');
  });
});
