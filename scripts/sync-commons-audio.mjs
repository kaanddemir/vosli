#!/usr/bin/env node
/**
 * Checks the dictionary's pronunciation recordings against Wikimedia Commons and records the result
 * in scripts/data/commons-audio.tsv, which build-dictionary.mjs reads offline. Nothing else runs this:
 * not the app build, not the dev server, not CI.
 *
 *   npm run audio:sync -- <raw.jsonl.gz> [--minutes N] [--refresh] [--contact <url or email>] [--recover-stale-lock]
 *
 * Only recordings not checked yet are asked about, most used words first, 50 to a request, one request
 * at a time. Commons throttles anything faster: a full first run takes hours, later runs minutes.
 * Stopping (Ctrl+C, --minutes running out, or an error) keeps everything checked so far; run it again to go on.
 * --refresh asks again about every recording the dictionary would use, for renamed or deleted files.
 * Only one run at a time: a second one stops at once (see commons-sync.mjs for the lock).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LockError, syncCommons } from './commons-sync.mjs';
import { audioEntry, clean, FORM_TITLES, isClean, POS } from './dictionary-audio.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const source = args.find((arg, index) => !arg.startsWith('--') && !['--minutes', '--contact'].includes(args[index - 1]));
if (!source) throw new Error('Usage: sync-commons-audio.mjs <raw.jsonl.gz> [--minutes N] [--refresh] [--contact <url or email>] [--recover-stale-lock]');
const minutes = Number(option('--minutes') ?? Infinity);
const contact = option('--contact');

/** The same records build-dictionary.mjs takes recordings from. */
async function readRecordings() {
  const recordings = new Map();
  const weight = new Map();
  const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"lang_code": "de"')) continue;
    const record = JSON.parse(line);
    if (record.lang_code !== 'de') continue;
    const word = clean(record.word);
    if (!isClean(word) || FORM_TITLES.has(record.pos_title) || !POS[record.pos]) continue;
    weight.set(word, (weight.get(word) ?? 0) + (record.translations ?? []).length);
    const audio = audioEntry(record);
    if (audio) (recordings.get(word) ?? recordings.set(word, []).get(word)).push(audio);
  }
  return { recordings, weight };
}

// Ctrl+C or a polite kill finishes the request under way, saves, releases the lock and exits.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping after this request…');
  });
}

try {
  const result = await syncCommons({
    cachePath: join(dirname(fileURLToPath(import.meta.url)), 'data', 'commons-audio.tsv'),
    recordings: readRecordings,
    refresh: args.includes('--refresh'),
    recoverStale: args.includes('--recover-stale-lock'),
    deadline: Date.now() + minutes * 60_000,
    shouldStop: () => stopping,
    // Wikimedia asks automated clients to say who they are.
    userAgent: `VosliDictionaryBuild/1.0 (pronunciation metadata check${contact ? `; ${contact}` : ''})`,
  });
  console.log(JSON.stringify(result));
  if (result.stillToCheck) console.log('Not finished. Run the same command again to continue; finished checks are kept.');
} catch (error) {
  if (error instanceof LockError) console.error(error.message);
  else console.error(`Commons sync failed: ${error.message}. Everything checked before the failure was saved; run the same command again to continue.`);
  process.exitCode = 1;
}
