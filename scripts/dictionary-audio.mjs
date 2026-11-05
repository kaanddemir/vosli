/**
 * Pronunciation recordings for the offline dictionary, shared by build-dictionary.mjs and
 * sync-commons-audio.mjs.
 *
 * Recordings come only from the links German Wiktionary editors put on each entry, never from a
 * filename that merely looks right. Each one is checked against Wikimedia Commons before it is used:
 * the check gives the canonical title (a link may be a redirect), the license and the author. Those
 * checks live in scripts/data/commons-audio.tsv, so a dictionary build never needs the network.
 *
 * In lemmas.txt a word with a recording gets one tag:
 *   a=KEY:FILE[#AUTHOR.LICENSE]|KEY:FILE...
 * KEY is the part of speech, with the gender for nouns: nm nf nn n v a d p o, or * for every one.
 * FILE is empty for De-<word>.ogg, a digit for De-<word><digit>.ogg, or =<canonical title>, spaces as _.
 * AUTHOR and LICENSE index audio-credits.txt; both 0 is left out. A tag a! marks a word where one part
 * of speech has two pronunciations that cannot be told apart, so no other recording stands in for it.
 */

export const FORM_TITLES = new Set(['Deklinierte Form', 'Konjugierte Form', 'Dekliniertes Gerundivum', 'Erweiterter Infinitiv', 'Partizip I', 'Partizip II', 'Komparativ', 'Superlativ']);
export const POS = { noun: 'S', verb: 'V', adj: 'A', adv: 'D', name: 'N', phrase: 'P', abbrev: 'K', num: 'Z', pron: 'O', prep: 'O', conj: 'O', particle: 'O', det: 'O', intj: 'O', postp: 'O' };
const CLEAN = /^[\p{L}\p{N}][\p{L}\p{N} .'’\-!?,]*$/u;
export const clean = (word) => (typeof word === 'string' ? word.normalize('NFC').trim() : '');
export const isClean = (word) => word.length >= 1 && word.length <= 60 && CLEAN.test(word) && !word.includes('\t');

const AUDIO_POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'd', phrase: 'p' };
const GENDER = { masculine: 'm', feminine: 'f', neuter: 'n' };
/** Wiktionary marks these explicitly. The default should be the standard pronunciation a learner hears in Germany. */
const REGIONAL_TAGS = new Set(['Austrian German', 'Swiss German', 'Bavarian', 'US', 'British', 'Australian', 'Canadian', 'Colombian', 'Parisian']);
const REGIONAL_RAW = /österreich|schweiz|bair|bayr|belg|latein|languedok|paris|amerikan/iu;
/** Files that name another variety or language before the word, such as De-at- or Bar-. */
const REGIONAL_PREFIX = /^(bar|by|en|fr|gt|de-at|de-ch|de-by)[-_ ]/iu;
const INVISIBLE = /[​-‏‪-‮⁠﻿]/gu;

/** A Commons file name as a link gives it, without the invisible marks some links carry. */
export const fileName = (name) => name.normalize('NFC').replace(INVISIBLE, '').replaceAll('_', ' ').trim();

const isStandard = (sound) => !(sound.tags ?? []).some((tag) => REGIONAL_TAGS.has(tag)) && !(sound.raw_tags ?? []).some((tag) => REGIONAL_RAW.test(tag)) && !REGIONAL_PREFIX.test(sound.audio);

/** De- recordings first, Ogg before other formats, then Lingua Libre's, keeping Wiktionary's order within each. */
const rank = (name) => (/^de-/iu.test(name) ? (/\.(ogg|oga)$/iu.test(name) ? 0 : 1) : name.startsWith('LL-Q188') ? 2 : 3);

/** Keys a record's recordings belong to: a noun under each gender it has. */
function keysOf(record) {
  const pos = AUDIO_POS[record.pos] ?? 'o';
  if (pos !== 'n') return [pos];
  const genders = [...new Set((record.tags ?? []).map((tag) => GENDER[tag]).filter(Boolean))].sort();
  return genders.length ? genders.map((gender) => `n${gender}`) : ['n'];
}

/** Stress marks stay: umfahren [ʊmˈfaːʁən] and [ˈʊmˌfaːʁən] differ only there. */
const ipaOf = (record) => new Set((record.sounds ?? []).filter((sound) => sound.ipa && !sound.ipa.includes('…')).map((sound) => sound.ipa.replace(/[[\]/.\s]/gu, '')));

/** One dictionary record's part in the choice, or null when it has no standard recording. */
export function audioEntry(record) {
  const names = [];
  for (const sound of record.sounds ?? []) {
    if (!sound.audio || !isStandard(sound)) continue;
    const name = fileName(sound.audio);
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return null;
  const files = names.map((name, index) => ({ name, index })).sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index).map((item) => item.name);
  return { keys: keysOf(record), ipa: ipaOf(record), files };
}

const disjoint = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((ipa) => b.has(ipa));

/**
 * Picks one recording for each key of a word. A key whose records say different things, with
 * different recordings, has no safe answer and gets none. Otherwise the first recording Commons
 * confirms is used; one Commons has not been asked about yet holds the key back, so a build never
 * skips ahead to a recording that was not the editors' first choice.
 *
 * lookup(name) gives { title, author, license } for a confirmed file, false for a missing one,
 * and undefined when it has not been checked.
 */
export function chooseAudio(entries, lookup) {
  const groups = new Map();
  for (const entry of entries) for (const key of entry.keys) (groups.get(key) ?? groups.set(key, []).get(key)).push(entry);
  const chosen = new Map();
  const pending = [];
  let ambiguous = false;
  for (const [key, group] of groups) {
    const firsts = new Set(group.map((entry) => entry.files[0]));
    if (firsts.size > 1 && group.some((a, i) => group.slice(i + 1).some((b) => a.files[0] !== b.files[0] && disjoint(a.ipa, b.ipa)))) {
      ambiguous = true;
      continue;
    }
    const candidates = [...new Set(group.flatMap((entry) => entry.files))];
    for (const name of candidates) {
      const found = lookup(name);
      if (found === undefined) {
        pending.push(name);
        break;
      }
      if (found) {
        chosen.set(key, found);
        break;
      }
    }
  }
  return { chosen, ambiguous, pending };
}

const underscored = (text) => text.replaceAll(' ', '_');

/** How a chosen title is written in the tag, shortest for the usual De-<word>.ogg. */
export function fileCode(word, title) {
  const name = underscored(title);
  const base = `De-${underscored(word)}`;
  if (name === `${base}.ogg`) return '';
  const numbered = name.startsWith(base) ? /^(\d)\.ogg$/u.exec(name.slice(base.length)) : null;
  return numbered ? numbered[1] : `=${name}`;
}

const KEY_ORDER = ['nm', 'nf', 'nn', 'n', 'v', 'a', 'd', 'p', 'o'];

/** The lemmas.txt tags for a word's choice. ids(found) gives [author, license] indexes. */
export function audioTags(word, choice, ids) {
  if (choice.chosen.size === 0) return [];
  const coded = new Map();
  for (const [key, found] of choice.chosen) {
    const [author, license] = ids(found);
    coded.set(key, `${fileCode(word, found.title)}${author || license ? `#${author}.${license}` : ''}`);
  }
  const values = new Set(coded.values());
  const tag = values.size === 1 && !choice.ambiguous ? `a=*:${[...values][0]}` : `a=${[...coded].sort(([a], [b]) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)).map(([key, value]) => `${key}:${value}`).join('|')}`;
  return choice.ambiguous ? [tag, 'a!'] : [tag];
}

/** Numbers authors and licenses by how often they are used, so the most common pair needs no tag text. */
export function creditTables(found) {
  const order = (counts) => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name]) => name);
  const authors = new Map();
  const licenses = new Map();
  for (const item of found) {
    authors.set(item.author, (authors.get(item.author) ?? 0) + 1);
    licenses.set(item.license, (licenses.get(item.license) ?? 0) + 1);
  }
  const authorList = order(authors);
  const licenseList = order(licenses);
  const authorIndex = new Map(authorList.map((name, index) => [name, index]));
  const licenseIndex = new Map(licenseList.map((name, index) => [name, index]));
  return { authors: authorList, licenses: licenseList, ids: (item) => [authorIndex.get(item.author), licenseIndex.get(item.license)] };
}

/** The deed for a Creative Commons license name as Commons writes it, such as "CC BY-SA 3.0 de". */
export function licenseUrl(name) {
  const cc = /^CC (BY(?:-SA)?) (\d\.\d)(?: ([a-z]{2}))?$/iu.exec(name);
  if (cc) return `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/${cc[3] ? `${cc[3].toLowerCase()}/` : ''}`;
  if (/^CC0( 1\.0)?$/iu.test(name)) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  return '';
}

export function creditsText({ authors, licenses }) {
  return [...licenses.map((name, index) => `L\t${index}\t${name}\t${licenseUrl(name)}`), ...authors.map((name, index) => `A\t${index}\t${name}`)].join('\n') + '\n';
}

// ---------- The Commons check cache: scripts/data/commons-audio.tsv ----------

const CACHE_HEADER = '# Wikimedia Commons checks for dictionary recordings. Written by sync-commons-audio.mjs.\n# requested name\tcanonical title (empty if the same)\tlicense\tauthor   |   requested name\t- when missing or without a license\n';
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Authors Commons cannot name. The uploader stands in for them. */
const UNNAMED = /^(myself|own work|self|ich|selbst|eigenes werk|unknown|anonymous|no machine-readable author.*|uploader)$/iu;

export function plainText(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/giu, (whole, code) => (code[0] === '#' ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? whole)))
    .replace(/[\t\n\r]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
}

/** The name to credit: the stated author, or the uploader when the file names no one. Empty if neither is known. */
export function authorFrom(artist, uploader) {
  const named = plainText(artist);
  if (named && !UNNAMED.test(named)) return named;
  return plainText(uploader);
}

export function parseCache(text) {
  const cache = new Map();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length === 2 && parts[1] === '-') cache.set(parts[0], false);
    else if (parts.length === 4 && parts[2]) cache.set(parts[0], { title: parts[1] || parts[0], license: parts[2], author: parts[3] });
    else throw new Error(`commons-audio.tsv line ${index + 1} is not valid: ${JSON.stringify(line)}`);
  }
  return cache;
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function cacheText(cache) {
  const lines = [...cache.keys()].sort(byCodeUnit).map((name) => {
    const found = cache.get(name);
    return found ? `${name}\t${found.title === name ? '' : found.title}\t${found.license}\t${found.author}` : `${name}\t-`;
  });
  return CACHE_HEADER + lines.join('\n') + '\n';
}
