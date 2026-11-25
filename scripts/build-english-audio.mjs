#!/usr/bin/env node
/**
 * Builds the English pronunciation list the app reads, from the same Kaikki dump of German Wiktionary as
 * the German dictionary, and the Commons checks in scripts/data/commons-audio-en.tsv. Never goes online.
 *
 *   node scripts/build-english-audio.mjs <raw.jsonl.gz> public
 *
 * Writes, into pronunciation/en under the given public folder:
 *   recordings.txt  one line per English word with a usable recording (format in scripts/english-audio.mjs)
 *   credits.txt     the authors and licenses those lines point to, in the format of pronunciation/de/credits.txt
 * Recordings Commons has not been asked about yet are left out until npm run audio:sync -- <raw.jsonl.gz>
 * --language en checks them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonsCachePath, creditsText, creditTables, parseCache } from './dictionary-audio.mjs';
import { chooseEnglishAudio, englishAudioTag, readEnglishRecordings } from './english-audio.mjs';

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: build-english-audio.mjs <raw.jsonl.gz> <public folder>');
const CACHE = commonsCachePath('en');
if (!existsSync(CACHE)) throw new Error(`No Commons checks at ${CACHE}. Run npm run audio:sync -- <raw.jsonl.gz> --language en first.`);
const commons = parseCache(readFileSync(CACHE, 'utf8'));

const { recordings } = await readEnglishRecordings(source);
const choices = new Map();
const stats = { words: recordings.size, chosen: 0, ambiguous: 0, pendingWords: 0, us: 0, uk: 0 };
for (const [word, entries] of recordings) {
  const choice = chooseEnglishAudio(entries, (name) => commons.get(name));
  if (choice.ambiguous) stats.ambiguous++;
  if (choice.pending.length) stats.pendingWords++;
  const found = choice.chosen.get('*');
  if (!found || choice.ambiguous) continue;
  choices.set(word, choice);
  stats.chosen++;
  stats[found.variety]++;
}

const credits = creditTables([...choices.values()].map((choice) => choice.chosen.get('*')));
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lines = [...choices].sort(([a], [b]) => byCodeUnit(a, b)).map(([word, choice]) => `${word}\t${englishAudioTag(word, choice, credits.ids)}`);

const output = join(target, 'pronunciation', 'en');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'recordings.txt'), `${lines.join('\n')}\n`);
writeFileSync(join(output, 'credits.txt'), creditsText(credits));
console.log(JSON.stringify({ ...stats, authors: credits.authors.length, licenses: credits.licenses.length }));
if (stats.pendingWords) console.warn(`${stats.pendingWords} words wait for a Commons check and stay silent until npm run audio:sync -- <raw.jsonl.gz> --language en checks them.`);
