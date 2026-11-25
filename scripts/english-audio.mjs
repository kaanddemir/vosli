/**
 * English pronunciation recordings, shared by build-english-audio.mjs and sync-commons-audio.mjs --language en.
 *
 * The recordings come from the links German Wiktionary editors put on its English entries, as the German
 * ones do from its German entries. A link alone is not trusted. Before a recording is used:
 * - Its title must say the entry's word, in the English naming Commons uses (En-us-word.ogg, En-uk-word.ogg,
 *   LL-Q1860 (eng)-Speaker-word.wav). A plural, a phrase such as "to go", or a file in another language's
 *   naming is left out, so a learner never hears another word or another language.
 * - Wikimedia Commons must file it as English pronunciation (its categories), and it must be American or
 *   British English. Commons' category names the variety where it has one ("U.S. English pronunciation",
 *   "British English pronunciation"); Lingua Libre files only say English, and then the editors' own tag
 *   (US, British) on the link decides. Any disagreement between the two, another variety (Australian,
 *   Canadian…), or a recording marked as synthesized leaves the file out.
 * - Commons must name its license and author, as for German.
 *
 * One recording per word, chosen the same way every build: American before British, then the editors' order.
 * Two entries of one spelling that are said differently (lead, the metal, and lead, to guide) get none.
 *
 * recordings.txt, one line per word, sorted by UTF-16 code unit:
 *   word TAB a=*:CODE[#AUTHOR.LICENSE]
 * CODE is u for En-us-<word>.ogg, b for En-uk-<word>.ogg, or u=<title> / b=<title> for any other title,
 * spaces as _. The letter is the variety: u American, b British. AUTHOR and LICENSE index credits.txt;
 * both 0 is left out.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { chooseAudio, clean, fileName, isClean } from './dictionary-audio.mjs';

const APOSTROPHE = /[’ʼ]/gu;
/** Words are looked up with a straight apostrophe, however they were typed. */
export const englishKey = (word) => clean(word).replace(APOSTROPHE, "'");

const FORMAT = /\.(ogg|oga|wav|flac|mp3)$/iu;
const VARIETY_PREFIX = { us: 'us', uk: 'uk', gb: 'uk' };

/**
 * What a title says about itself: the word it holds and the variety its name gives, or null for a title in
 * any other shape. En-au-go.ogg holds go, in another variety ('other'); a Lingua Libre file names none.
 */
export function englishTitle(title) {
  const name = fileName(title);
  if (!FORMAT.test(name)) return null;
  const bare = name.replace(FORMAT, '');
  const named = /^en-([a-z]{2})-(.+)$/iu.exec(bare);
  if (named) return { word: named[2].trim(), variety: VARIETY_PREFIX[named[1].toLowerCase()] ?? 'other' };
  const libre = /^LL-Q1860 \(eng\)-[^-]+-(.+)$/u.exec(bare);
  return libre ? { word: libre[1].trim(), variety: null } : null;
}

const fold = (text) => text.replace(APOSTROPHE, "'").toLocaleLowerCase('en');

/** The title says this word, case and apostrophe style aside. A number after it only tells takes apart. */
export function saysWord(title, word) {
  const said = englishTitle(title)?.word;
  if (!said) return false;
  const target = fold(word);
  return fold(said) === target || (!/\d$/u.test(target) && fold(said.replace(/\s*\d+$/u, '')) === target);
}

const TAG_VARIETY = { US: 'us', British: 'uk' };
const OTHER_TAGS = new Set(['Australian', 'Canadian', 'New Zealand', 'Irish', 'Scottish', 'Indian', 'South African', 'Welsh']);

/** What the editors said about one link: us, uk, other, synthetic, or nothing at all. */
function editorsSay(sound) {
  const said = new Set();
  for (const tag of sound.tags ?? []) {
    if (TAG_VARIETY[tag]) said.add(TAG_VARIETY[tag]);
    else if (OTHER_TAGS.has(tag)) said.add('other');
  }
  for (const raw of sound.raw_tags ?? []) {
    if (/synth|künstlich|computer/iu.test(raw)) said.add('synthetic');
    else if (/amerik|^amer\b|^US\b|nordamerika/iu.test(raw)) said.add('us');
    else if (/brit|^UK\b|england/iu.test(raw)) said.add('uk');
    else if (/kanad|austral|neusee|schott|irisch|ind(ien|isch)|südafrika|walis/iu.test(raw)) said.add('other');
  }
  return said;
}

/** Recordings with a variety come first, American before British, then those whose variety Commons must give. */
const RANK = { us: 0, uk: 1, unknown: 2 };

/**
 * One English record's part in the choice, or null when none of its links can be used. Every spelling has
 * one key, *: a learner's English word carries no part of speech to tell entries apart, so entries said
 * differently make the word ambiguous instead.
 */
export function englishAudioEntry(record) {
  const word = englishKey(record.word);
  const files = [];
  const said = new Map();
  for (const sound of record.sounds ?? []) {
    if (!sound.audio) continue;
    const name = fileName(sound.audio);
    const title = englishTitle(name);
    if (!title || !saysWord(name, word)) continue;
    const indications = editorsSay(sound);
    if (title.variety) indications.add(title.variety);
    const known = said.get(name) ?? new Set();
    for (const item of indications) known.add(item);
    said.set(name, known);
    if (!files.includes(name)) files.push(name);
  }
  const usable = files.filter((name) => !said.get(name).has('other') && !said.get(name).has('synthetic'));
  if (!usable.length) return null;
  const rankOf = (name) => {
    const known = said.get(name);
    return known.has('us') && !known.has('uk') ? RANK.us : known.has('uk') && !known.has('us') ? RANK.uk : RANK.unknown;
  };
  const ordered = usable.map((name, index) => ({ name, index })).sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.index - b.index).map((item) => item.name);
  const ipa = new Set((record.sounds ?? []).filter((sound) => sound.ipa && !sound.ipa.includes('…')).map((sound) => sound.ipa.replace(/[[\]/.\s]/gu, '')));
  return { keys: ['*'], ipa, files: ordered, said };
}

/**
 * The variety Commons gives a file, from its categories: us, uk, en (English, no variety named), other
 * (another variety, or more than one) or none (not filed as English pronunciation at all).
 */
export function englishCategory(categories) {
  const names = String(categories ?? '').split('|').map((name) => name.trim());
  const varieties = new Set();
  let english = false;
  for (const name of names) {
    if (/^(U\.S\.|US|American) English pronunciation$/iu.test(name)) varieties.add('us');
    else if (/^(British|UK) English pronunciation$/iu.test(name)) varieties.add('uk');
    else if (/^English pronunciation$/iu.test(name) || /^Lingua Libre pronunciation-eng$/u.test(name)) english = true;
    else if (/^[\w. -]+ English pronunciation$/iu.test(name)) varieties.add('other');
  }
  if (varieties.size > 1) return 'other';
  if (varieties.size === 1) return [...varieties][0];
  return english ? 'en' : 'none';
}

/**
 * Picks one recording for an English word from its records. lookup(name) is the Commons cache, as for German,
 * with kind set from englishCategory. A confirmed file is used only when Commons and the editors agree that it
 * is American or British English; the found recording carries that variety.
 */
export function chooseEnglishAudio(entries, lookup) {
  const said = new Map();
  for (const entry of entries) {
    for (const [name, items] of entry.said) {
      const known = said.get(name) ?? new Set();
      for (const item of items) known.add(item);
      said.set(name, known);
    }
  }
  return chooseAudio(entries, (name) => {
    const found = lookup(name);
    if (!found) return found;
    // Commons may have moved the file: En-us-they're.ogg now redirects to En-us-there.ogg. The title that is played
    // must say the same word as the one linked, or it is another word's recording.
    if (found.title.replaceAll(' ', '_') !== name.replaceAll(' ', '_') && !saysWord(found.title, englishTitle(name)?.word.replace(/\s*\d+$/u, '') ?? '')) return false;
    const editors = said.get(name) ?? new Set();
    const variety = varietyOf(found.kind, editors);
    return variety ? { ...found, variety } : false;
  });
}

/** Commons first, the editors where Commons names no variety. Any disagreement means no recording. */
export function varietyOf(kind, editors) {
  if (editors.has('other') || editors.has('synthetic')) return null;
  if (kind === 'us' || kind === 'uk') return editors.has(kind === 'us' ? 'uk' : 'us') ? null : kind;
  if (kind !== 'en') return null;
  const us = editors.has('us');
  const uk = editors.has('uk');
  return us !== uk ? (us ? 'us' : 'uk') : null;
}

const STANDARD = { us: 'En-us-', uk: 'En-uk-' };
const LETTER = { us: 'u', uk: 'b' };

/** How a chosen title is written in the line, shortest for the usual En-us-<word>.ogg. */
export function englishFileCode(word, title, variety) {
  const name = title.replaceAll(' ', '_');
  return name === `${STANDARD[variety]}${word.replaceAll(' ', '_')}.ogg` ? LETTER[variety] : `${LETTER[variety]}=${name}`;
}

/** The recordings.txt tag for a word's choice, or null when it has none. ids(found) gives [author, license] indexes. */
export function englishAudioTag(word, choice, ids) {
  const found = choice.chosen.get('*');
  if (!found || choice.ambiguous) return null;
  const [author, license] = ids(found);
  return `a=*:${englishFileCode(word, found.title, found.variety)}${author || license ? `#${author}.${license}` : ''}`;
}

/**
 * Every English record of the dump with a recording that may be used, by word. weight orders the Commons
 * checks, most translated first, as for German.
 */
export async function readEnglishRecordings(source) {
  const recordings = new Map();
  const weight = new Map();
  const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"lang_code": "en"')) continue;
    const record = JSON.parse(line);
    if (record.lang_code !== 'en') continue;
    const word = englishKey(record.word);
    if (!isClean(word)) continue;
    weight.set(word, (weight.get(word) ?? 0) + (record.translations ?? []).length + 1);
    const audio = englishAudioEntry(record);
    if (audio) (recordings.get(word) ?? recordings.set(word, []).get(word)).push(audio);
  }
  return { recordings, weight };
}
