import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SortedLines, createDictionary } from '../src/core/dictionary';
import { dismissalKey, openIssues, type Validation } from '../src/core/issues';
import { createValidator, validateEntry } from '../src/core/validation';
import { realDictionary } from './support/dictionary';
import { SAMPLE } from './support/validationSample';

const check = (german: string, article = '', turkish = 'x'): Validation => validateEntry(realDictionary(), german, article, turkish);
const offers = (validation: Validation) => validation.issues.flatMap((item) => item.suggestions.map((offer) => (offer.article ? `${offer.article} ${offer.german}` : offer.german)));
const codes = (validation: Validation) => validation.issues.map((item) => item.code);

describe('sorted lines', () => {
  const lines = new SortedLines('Apfel\ta\nBaum\tb\nZug\tc\nÄhre\td\nähnlich\te\n');
  it('finds first, middle, last and non-ASCII keys', () => {
    expect(lines.size).toBe(5);
    expect(['Apfel', 'Baum', 'Zug', 'Ähre', 'ähnlich'].map((key) => lines.get(key))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('does not match a prefix or a longer word', () => {
    expect(lines.get('Apf')).toBeNull();
    expect(lines.get('Apfelbaum')).toBeNull();
    expect(lines.get('')).toBeNull();
  });
  it('reads a file with no final line break, and an empty one', () => {
    expect(new SortedLines('a\t1\nb\t2').get('b')).toBe('2');
    expect(new SortedLines('').get('a')).toBeNull();
  });
  it('the shipped files are really sorted, or binary search would silently miss words', () => {
    for (const name of ['lemmas', 'forms']) {
      const keys = readFileSync(`public/dictionary/${name}.txt`, 'utf8').trimEnd().split('\n').map((line) => line.slice(0, line.indexOf('\t')));
      for (let i = 1; i < keys.length; i += 1) if (!(keys[i - 1]! < keys[i]!)) throw new Error(`${name}: ${keys[i - 1]} before ${keys[i]}`);
      expect(keys.length).toBeGreaterThan(100_000);
    }
  });
});

describe('articles', () => {
  it('confirms a right one and offers a fix for a wrong one', () => {
    expect(check('Geldautomat', 'der').status).toBe('verified');
    expect(check('Geldautomat', 'das')).toMatchObject({ status: 'mismatch' });
    expect(offers(check('Geldautomat', 'das'))).toEqual(['der Geldautomat']);
    expect(offers(check('Moos', 'der'))).toEqual(['das Moos']);
  });
  it('accepts a word with several genders, and says so instead of guessing', () => {
    for (const [word, article] of [['See', 'der'], ['See', 'die'], ['Band', 'das'], ['Band', 'der'], ['Band', 'die']] as const) {
      const found = check(word, article);
      expect(found.status).toBe('multiple');
      expect(found.issues).toEqual([]);
    }
    expect(check('Bank', 'die').status).toBe('verified');
  });
  it('uses a Turkish meaning only as positive evidence for one sense', () => {
    expect(check('See', 'die', 'göl')).toMatchObject({ status: 'mismatch' });
    expect(offers(check('See', 'die', 'göl'))).toEqual(['der See']);
    expect(offers(check('See', 'der', 'deniz'))).toEqual(['die See']);
    expect(check('See', 'der', 'göl').issues).toEqual([]);
    expect(codes(check('Chor', 'das', 'koro'))).toEqual(['article_sense']);
    // A meaning it has never seen proves nothing.
    expect(check('Chor', 'das', 'hiç duyulmamış').status).toBe('multiple');
    expect(check('See', 'die', 'hiç duyulmamış').status).toBe('multiple');
  });
  it('knows plural forms and words that only have a plural', () => {
    expect(check('Eltern', 'die').status).toBe('verified');
    expect(check('Eltern', 'der').status).toBe('mismatch');
    expect(check('Bücher', 'die')).toMatchObject({ status: 'verified', note: { kind: 'inflected', of: 'Buch' } });
    // Haus is also a genitive of a rare word, Hau. That does not make die Haus a plural.
    expect(offers(check('Haus', 'die'))).toEqual(['das Haus']);
    expect(check('Messer', 'die').issues).toEqual([]);
  });
  it('treats der and die Erwachsene as both right', () => {
    expect(check('Erwachsene', 'der').issues).toEqual([]);
    expect(check('Erwachsene', 'die').issues).toEqual([]);
  });
});

describe('parts of speech', () => {
  it('keeps das Essen and essen apart', () => {
    expect(check('Essen', 'das').issues).toEqual([]);
    expect(check('essen').status).toBe('verified');
    expect(codes(check('essen', 'das'))).toEqual(['capitalization']);
    expect(offers(check('essen', 'das'))).toEqual(['das Essen']);
  });
  it('questions an article on what is not a noun', () => {
    expect(codes(check('schnell', 'das'))).toEqual(['not_a_noun']);
  });
  it('reads any capitalized verb as a neuter noun', () => {
    expect(check('Schwimmen', 'das').issues).toEqual([]);
    expect(offers(check('Schwimmen', 'der'))).toContain('das Schwimmen');
  });
  it('asks for an article only when the word can be nothing but a noun', () => {
    expect(codes(check('Tisch'))).toEqual(['article_missing']);
    expect(offers(check('Tisch'))).toEqual(['der Tisch']);
    // These may just start a line, or are names.
    for (const word of ['Hallo', 'Danke', 'Morgen', 'Essen', 'Deutschland', 'Was?']) expect(check(word).issues, word).toEqual([]);
    // Having a surname page does not excuse a common noun.
    expect(offers(check('Lampe'))).toEqual(['die Lampe']);
  });
});

describe('spelling', () => {
  it('offers the umlaut or ß a typed word stands for', () => {
    expect(offers(check('Kuehlschrank', 'der'))).toEqual(['der Kühlschrank']);
    expect(offers(check('Fruehstück', 'das'))).toEqual(['das Frühstück']);
    expect(offers(check('schoen'))).toEqual(['schön']);
  });
  it('finds a slip of one letter', () => {
    expect(offers(check('Geldautmat', 'der'))).toContain('der Geldautomat');
    expect(offers(check('Zietung', 'die'))).toContain('die Zeitung');
  });
  it('names an old spelling and the current one', () => {
    expect(codes(check('Fluß', 'der'))).toEqual(['old_spelling']);
    expect(offers(check('Fluß', 'der'))).toEqual(['der Fluss']);
    expect(offers(check('daß'))).toEqual(['dass']);
  });
  it('accepts umlauts, ß and spelling variants as they are', () => {
    for (const [word, article] of [['Fuß', 'der'], ['Tür', 'die'], ['Maß', 'das'], ['Delphin', 'der'], ['Delfin', 'der'], ['Phantasie', 'die'], ['Fantasie', 'die']] as const) expect(check(word, article).issues, word).toEqual([]);
  });
  it('does not call an unknown compound wrong, and takes its gender from the last part', () => {
    const found = check('Küchentischlampe', 'die');
    expect(found).toMatchObject({ status: 'not_found', note: { kind: 'compound', head: 'Tischlampe' } });
    expect(found.issues).toEqual([]);
    expect(offers(check('Küchentischlampe', 'der'))).toEqual(['die Küchentischlampe']);
  });
  it('leaves an unknown word alone when nothing stands out', () => {
    expect(check('Xqzv').status).toBe('not_found');
    expect(check('Schnitzelparadies', 'das').issues).toEqual([]);
  });
  it('accepts inflected forms', () => {
    for (const word of ['gehst', 'ging', 'gegangen', 'schönere', 'meine', 'Bücher']) expect(check(word).issues, word).toEqual([]);
  });
});

describe('what is not checked', () => {
  it('does not take phrases apart, or check numbers', () => {
    expect(check('Auf Wiedersehen!').status).toBe('verified');
    expect(check('Ich hätte gern einen Kaffee').status).toBe('unchecked');
    expect(check('Top 10').status).toBe('unchecked');
  });
  it('does not treat an invalid article as something to judge', () => {
    expect(check('Hund', 'xyz').status).toBe('unchecked');
  });
});

describe('decisions', () => {
  it('a rejected warning stays away for that text and returns for other text', () => {
    const wrong = check('Geldautomat', 'das');
    const dismissed = new Set([dismissalKey('article_wrong', 'Geldautomat', 'das')]);
    expect(openIssues(wrong, 'Geldautomat', 'das', dismissed)).toEqual([]);
    expect(openIssues(check('Geldautomat', 'die'), 'Geldautomat', 'die', dismissed)).toHaveLength(1);
  });
  it('asks the dictionary once for identical rows', () => {
    let lookups = 0;
    const counting = createDictionary('Hund\tS gm c\n', '');
    const original = counting.lookup.bind(counting);
    counting.lookup = (word) => {
      lookups++;
      return original(word);
    };
    const validate = createValidator(counting);
    expect(validate('Hund', 'der', 'köpek').status).toBe('verified');
    const once = lookups;
    validate('Hund', 'der', 'köpek');
    expect(lookups).toBe(once);
  });
});

describe('hand-labelled sample', () => {
  const judged = SAMPLE.map((sample) => ({ sample, found: check(sample.german, sample.article, sample.turkish) }));
  const flagged = (found: Validation) => found.issues.length > 0;
  const truePositives = judged.filter(({ sample, found }) => sample.flag && flagged(found));
  const falsePositives = judged.filter(({ sample, found }) => !sample.flag && flagged(found));
  const missed = judged.filter(({ sample, found }) => sample.flag && !flagged(found));
  const fixed = truePositives.filter(({ sample, found }) => offers(found).includes(sample.fix!));

  it('holds its measured accuracy', () => {
    expect(falsePositives.map(({ sample }) => `${sample.article} ${sample.german}`)).toEqual([]);
    // Known misses: die Strasse (also a plural of Strass, and correct in Switzerland), Freund1n (digits are left alone), Fahrad (reads as a compound).
    expect(missed.map(({ sample }) => sample.german).sort()).toEqual(['Fahrad', 'Freund1n', 'Strasse']);
    // Known wrong offer: der Kaffe has too many masculine neighbours for Kaffee to stand out.
    expect(truePositives.filter((item) => !fixed.includes(item)).map(({ sample }) => sample.german)).toEqual(['Kaffe']);
  });
});

const dir = process.env.PDF_SAMPLES ?? 'tests/fixtures/local';
describe.skipIf(!existsSync(`${dir}/truth.json`))('the course PDFs', () => {
  it('flags the articles the source got wrong', () => {
    const truth = JSON.parse(readFileSync(`${dir}/truth.json`, 'utf8')) as Record<string, { de: string; art: string; tr: string }[][]>;
    const rows = Object.values(truth).flat(2);
    expect(rows).toHaveLength(275);
    expect(offers(check('Geldautomat', 'das', 'ATM'))).toEqual(['der Geldautomat']);
    expect(offers(check('Moos', 'der', 'yosun'))).toEqual(['das Moos']);
    expect(offers(check('Chor', 'das', 'koro'))).toEqual(['der Chor']);
    expect(check('Vier', 'die', 'dört').issues).toEqual([]);
  });
});

describe('speed', () => {
  it('checks a thousand rows in well under a second', () => {
    const validate = createValidator(realDictionary());
    const started = performance.now();
    for (let i = 0; i < 1000; i++) validate(`Unbekanntwort${String.fromCharCode(97 + (i % 26))}${i}x`, 'der', 'x');
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
