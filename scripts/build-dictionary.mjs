#!/usr/bin/env node
/**
 * Builds the offline dictionary from the German Wiktionary, as extracted by Wiktextract/Kaikki.
 * Input is never committed: https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz
 *
 *   node scripts/build-dictionary.mjs <raw.jsonl.gz> public/dictionary
 *
 * After a new dump, update its date in public/dictionary/LICENSE.txt and in both READMEs.
 *
 * Output is sorted text files, read by src/core/dictionary.ts with a binary search:
 *   lemmas.txt         word TAB tags        every entry in its dictionary form
 *   forms.txt          form TAB lemma|^lemma  inflected forms; ^ marks a nominative plural
 *   audio-credits.txt  the authors and licenses the pronunciation tags in lemmas.txt point to
 * Tags are explained in src/core/dictionary.ts and scripts/dictionary-audio.mjs. Sorting is by UTF-16 code unit, as in JavaScript.
 *
 * Pronunciation recordings are used only once Wikimedia Commons has confirmed them, as recorded in
 * scripts/data/commons-audio.tsv. This script never goes online: `npm run audio:sync -- <raw.jsonl.gz>`
 * checks new recordings first.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioEntry, audioTags, chooseAudio, clean, creditsText, creditTables, FORM_TITLES, isClean, parseCache, POS } from './dictionary-audio.mjs';

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: build-dictionary.mjs <raw.jsonl.gz> <output folder>');

const GENDER = { masculine: 'm', feminine: 'f', neuter: 'n' };
/** A sense with one of these is not what a learner meets. A gender only they use is marked rare. */
const RARE = new Set(['archaic', 'obsolete', 'dated', 'derogatory', 'regional', 'dialectal', 'historical', 'rare', 'poetic', 'vulgar']);
const CACHE = join(dirname(fileURLToPath(import.meta.url)), 'data', 'commons-audio.tsv');
if (!existsSync(CACHE)) throw new Error(`No Commons checks at ${CACHE}. Run npm run audio:sync -- <raw.jsonl.gz> first.`);
const commons = parseCache(readFileSync(CACHE, 'utf8'));

const lemmas = new Map();
const forms = new Map();
const recordings = new Map();
const lemmaOf = (word) => {
  let entry = lemmas.get(word);
  if (!entry) lemmas.set(word, (entry = { pos: new Set(), genders: new Map(), pluralOnly: false, variants: new Set(), weight: 0, turkish: [], old: false, samePlural: false }));
  return entry;
};
const addForm = (form, lemma, plural = false) => {
  if (!isClean(form) || !isClean(lemma) || form === lemma || form.includes(' ')) return;
  let links = forms.get(form);
  if (!links) forms.set(form, (links = new Map()));
  links.set(lemma, plural || links.get(lemma) === true);
};
const isNominativePlural = (tags = []) => tags.includes('nominative') && tags.includes('plural');

const stats = { read: 0, german: 0 };
const genderRank = (entry, code, common) => {
  const old = entry.genders.get(code);
  entry.genders.set(code, old === 'common' || common ? 'common' : 'rare');
};

function take(record) {
  const word = clean(record.word);
  if (!isClean(word)) return;
  const title = record.pos_title;
  const senses = record.senses ?? [];
  const links = senses.flatMap((sense) => sense.form_of ?? []).map((link) => clean(link.word)).filter(Boolean);

  if (FORM_TITLES.has(title)) {
    for (const sense of senses) for (const link of sense.form_of ?? []) addForm(word, clean(link.word), isNominativePlural(sense.tags));
    return;
  }
  const entry = lemmaOf(word);
  const pos = POS[record.pos];
  const tags = record.tags ?? [];
  const translations = record.translations ?? [];
  entry.weight += translations.length;

  if (record.pos === 'unknown') {
    // Pages kept for spellings no longer valid, such as Fluß: the data marks them but names no target.
    if (tags.includes('alt-of') && tags.includes('no-gloss')) entry.old = true;
    for (const lemma of links) addForm(word, lemma);
    return;
  }
  if (pos) {
    entry.pos.add(pos);
    const audio = audioEntry(record);
    if (audio) (recordings.get(word) ?? recordings.set(word, []).get(word)).push(audio);
  }
  for (const form of record.forms ?? []) {
    const name = clean(form.form);
    const formTags = form.tags ?? [];
    if (formTags.includes('alternative') && isClean(name) && name !== word) entry.variants.add(name);
    if (record.pos === 'noun' || record.pos === 'verb' || record.pos === 'adj') {
      if (!/\s/u.test(name) && (formTags.includes('plural') || formTags.includes('singular') || record.pos !== 'noun')) addForm(name, word, record.pos === 'noun' && isNominativePlural(formTags));
    }
  }
  if (record.pos !== 'noun' && !(record.pos === 'abbrev' && tags.includes('noun'))) return;

  const common = senses.length === 0 || senses.some((sense) => !(sense.tags ?? []).some((tag) => RARE.has(tag)));
  const found = new Set(tags.flatMap((tag) => (GENDER[tag] ? [GENDER[tag]] : [])));
  const ownGenders = new Set(found);
  // Adjective nouns list der and die as words of their own: der Erwachsene, die Erwachsene.
  for (const form of record.forms ?? []) {
    const name = clean(form.form);
    const formTags = form.tags ?? [];
    if ((name === word || name === `${word}r`) && formTags.includes('masculine')) found.add('m');
    if (name === `der ${word}`) found.add('m');
    if (name === `die ${word}` && formTags.includes('singular')) found.add('f');
    if (name === `das ${word}`) found.add('n');
  }
  const plural = (record.forms ?? []).some((form) => clean(form.form) === word && (form.tags ?? []).includes('plural') && (form.tags ?? []).includes('nominative'));
  if (found.size === 0 && plural) entry.pluralOnly = true;
  // das Messer, die Messer: the plural looks the same, so die is right for it too.
  if (found.size > 0 && plural) entry.samePlural = true;
  // A partner form (der Beamte beside a rarely used die Beamte) is not rare because its partner is.
  for (const code of found) genderRank(entry, code, common || !ownGenders.has(code));
  if (found.size > 0) {
    const meanings = translations.filter((item) => item.lang_code === 'tr').map((item) => clean(item.word)).filter((text) => text && !/[\t|;:]/u.test(text));
    entry.turkish.push({ genders: [...found], meanings: [...new Set(meanings)] });
  }
}

const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  stats.read++;
  if (!line.includes('"lang_code": "de"')) continue;
  const record = JSON.parse(line);
  if (record.lang_code !== 'de') continue;
  stats.german++;
  take(record);
}

/** Enough translations, into any language, marks a word people actually need. Used only to rank spelling ideas. */
const COMMON_WEIGHT = 5;
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Pronunciation: choose first, then number the authors and licenses actually used.
const choices = new Map();
const audioStats = { words: 0, ambiguous: 0, pendingWords: 0, pendingFiles: new Set() };
for (const [word, entries] of recordings) {
  const entry = lemmas.get(word);
  if (!entry || (entry.pos.size === 0 && !entry.old)) continue;
  const choice = chooseAudio(entries, (name) => commons.get(name));
  if (choice.ambiguous) audioStats.ambiguous++;
  if (choice.pending.length) {
    audioStats.pendingWords++;
    for (const name of choice.pending) audioStats.pendingFiles.add(name);
  }
  if (choice.chosen.size) {
    audioStats.words++;
    choices.set(word, choice);
  }
}
const credits = creditTables([...choices.values()].flatMap((choice) => [...choice.chosen.values()]));

const lemmaLines = [];
for (const [word, entry] of lemmas) {
  if (entry.pos.size === 0 && !entry.old) continue;
  const parts = [[...entry.pos].sort().join('')];
  const genders = [...entry.genders].map(([code, rank]) => (rank === 'rare' ? `${code}?` : code)).join('');
  if (genders) parts.push(`g${genders}`);
  if (entry.pluralOnly) parts.push('pl');
  if (entry.samePlural) parts.push('ps');
  if (entry.old) parts.push('x');
  if (entry.weight >= COMMON_WEIGHT) parts.push('c');
  for (const name of entry.variants) if (lemmas.has(name)) parts.push(`~${name}`);
  // Only where a word has more than one gender, so the meaning can tell them apart.
  if (entry.genders.size > 1) {
    for (const code of entry.genders.keys()) {
      const meanings = [...new Set(entry.turkish.filter((item) => item.genders.length === 1 && item.genders[0] === code).flatMap((item) => item.meanings))].slice(0, 6);
      if (meanings.length) parts.push(`t${code}=${meanings.join('|').replaceAll(' ', '_')}`);
    }
  }
  const choice = choices.get(word);
  if (choice) parts.push(...audioTags(word, choice, credits.ids));
  lemmaLines.push(`${word}\t${parts.join(' ')}`);
}
lemmaLines.sort(byCodeUnit);

// Inflected forms of common words only: rarer ones cost megabytes and a learner seldom enters them.
const isCommon = (lemma) => (lemmas.get(lemma)?.weight ?? 0) >= COMMON_WEIGHT;
const formLines = [];
for (const [form, links] of forms) {
  const known = [...links].filter(([lemma]) => isCommon(lemma)).map(([lemma, plural]) => (plural ? `^${lemma}` : lemma));
  if (known.length) formLines.push(`${form}\t${known.join('|')}`);
}
formLines.sort(byCodeUnit);

mkdirSync(target, { recursive: true });
writeFileSync(join(target, 'lemmas.txt'), `${lemmaLines.join('\n')}\n`);
writeFileSync(join(target, 'forms.txt'), `${formLines.join('\n')}\n`);
writeFileSync(join(target, 'audio-credits.txt'), creditsText(credits));
console.log(JSON.stringify({ ...stats, lemmas: lemmaLines.length, forms: formLines.length, audio: { words: audioStats.words, ambiguous: audioStats.ambiguous, authors: credits.authors.length, licenses: credits.licenses.length } }));
// Not an error: these wait for a Commons check, and until then they have no recording rather than an unchecked one.
if (audioStats.pendingWords) console.warn(`${audioStats.pendingWords} words have recordings Commons has not confirmed yet (${audioStats.pendingFiles.size} files). They stay silent until npm run audio:sync -- <raw.jsonl.gz> checks them.`);
