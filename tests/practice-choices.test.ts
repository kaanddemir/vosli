import { describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import { evaluateAnswer, isAccepted, NO_DOUBT, type DictionaryDoubt, type Track } from '../src/core/practice/answers';
import type { Suggestion } from '../src/core/issues';
import { buildQuestion, canAsk, createChoicePool, testKindsFor, TRANSLATION_OPTIONS, type ChoicePool, type ChoiceWord, type TestQuestion } from '../src/core/practice/choices';
import { buildRound } from '../src/core/practice/selection';
import type { PartOfSpeech } from '../src/core/vocabulary';

/** A seeded random source, so every failure can be replayed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let next = 0;
function word(lemma: string, article: Article | null, meanings: string[], pos?: PartOfSpeech): ChoiceWord {
  return { id: `w${next++}`, lemma, article, meanings: meanings.map((text) => ({ text })), pos: pos ?? (article ? 'noun' : lemma.includes(' ') ? 'phrase' : 'other') };
}

/** Saved vocabulary chosen to trip a careless generator: shared meanings, one word inside another, same letters, same spelling. */
const TRICKY: ChoiceWord[] = [
  word('See', 'der', ['göl']),
  word('See', 'die', ['deniz']),
  word('Meer', 'das', ['deniz']),
  word('Ozean', 'der', ['okyanus']),
  word('Bank', 'die', ['banka']),
  word('Bank', 'die', ['sıra', 'bank']),
  word('essen', null, ['yemek yemek']),
  word('Essen', 'das', ['yemek']),
  word('kochen', null, ['yemek pişirmek']),
  word('Auto', 'das', ['araba']),
  word('Wagen', 'der', ['araba', 'vagon']),
  word('Straße', 'die', ['sokak']),
  word('Strasse', 'die', ['cadde']),
  word('Fuß', 'der', ['ayak']),
  word('Haus', 'das', ['ev']),
  word('Hausherr', 'der', ['ev sahibi']),
  word('schön', null, ['güzel']),
  word('schon', null, ['zaten']),
  word('hübsch', null, ['güzel', 'sevimli']),
  word('groß', null, ['büyük']),
  word('riesig', null, ['çok büyük']),
  word('gehen', null, ['gitmek']),
  word('fahren', null, ['gitmek (araçla)']),
  word('laufen', null, ['koşmak', 'yürümek']),
  word('Urlaub', 'der', ['tatil (tatile çıkmak vb.)']),
  word('Ferien', 'die', ['tatil']),
  word('danke', null, ['teşekkürler']),
  word('Danke', 'der', ['teşekkür']),
  word('kaufen', null, ['satın almak']),
  word('nehmen', null, ['almak']),
  word('Guten Morgen', null, ['günaydın']),
  word('Guten Tag', null, ['iyi günler']),
  word('Gute Nacht', null, ['iyi geceler']),
  word('Tschüss', null, ['hoşça kal/güle güle']),
  word('Auf Wiedersehen', null, ['güle güle']),
  word('Apfel', 'der', ['elma']),
  word('Birne', 'die', ['armut']),
  word('Kirsche', 'die', ['kiraz']),
  word('Tisch', 'der', ['masa']),
  word('Stuhl', 'der', ['sandalye']),
  word('Tür', 'die', ['kapı']),
  word('Tor', 'das', ['kapı', 'kale', 'gol']),
  word('Fenster', 'das', ['pencere']),
  word('Buch', 'das', ['kitap']),
  word('Hund', 'der', ['köpek']),
  word('Katze', 'die', ['kedi']),
  word('Brot', 'das', ['ekmek']),
  word('Wasser', 'das', ['su']),
  word('lesen', null, ['okumak']),
  word('schreiben', null, ['yazmak']),
  word('klein', null, ['küçük']),
  word('alt', null, ['yaşlı', 'eski']),
  word('neu', null, ['yeni']),
  word('kalt', null, ['soğuk']),
];

/* ---------- An independent check, written without the generator's helpers ---------- */

const plain = (text: string) => text.normalize('NFC').replace(/\([^)]*\)/gu, ' ').replace(/[?!.,;:]/gu, ' ').replace(/\s+(vb|vs|vd)\.?$/u, '').replace(/\s+/gu, ' ').trim();
const turkish = (text: string) => plain(text).toLocaleLowerCase('tr').split('/').map((part) => part.trim()).filter(Boolean);
const meaningsOf = (entry: ChoiceWord) => entry.meanings.flatMap((meaning) => turkish(meaning.text));
const german = (text: string) => plain(text).toLocaleLowerCase('de').replace(/ä/gu, 'ae').replace(/ö/gu, 'oe').replace(/ü/gu, 'ue').replace(/ß/gu, 'ss');
const share = (a: readonly string[], b: readonly string[]) => a.some((x) => b.some((y) => x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)));
const byId = (library: readonly ChoiceWord[]) => new Map(library.map((entry) => [entry.id, entry]));

/** Which options someone holding the learner's own data could defend as right. */
function defensible(question: TestQuestion, library: readonly ChoiceWord[], doubt: DictionaryDoubt = NO_DOUBT): number[] {
  const words = byId(library);
  const target = words.get(question.wordId)!;
  return question.options.flatMap((option, index) => {
    if (question.kind === 'article') return option.text === target.article ? [index] : [];
    const source = option.wordId ? words.get(option.wordId)! : null;
    const byMeaning = question.kind === 'de_tr' ? share(turkish(option.text), meaningsOf(target)) : source !== null && share(meaningsOf(source), meaningsOf(target));
    const bySpelling = source !== null && german(source.lemma) === german(target.lemma);
    const byChecker = isAccepted(evaluateAnswer(target, question.kind, option.text, { library, doubt }).result);
    return byMeaning || bySpelling || byChecker || source?.id === target.id ? [index] : [];
  });
}

function expectSound(question: TestQuestion, library: readonly ChoiceWord[], doubt: DictionaryDoubt = NO_DOUBT) {
  const label = `${question.kind} ${question.prompt}: ${question.options.map((option) => option.text).join(' | ')}`;
  expect(defensible(question, library, doubt), label).toEqual([question.correct]);
  expect(question.options.length, label).toBe(question.kind === 'article' ? 3 : TRANSLATION_OPTIONS);
  expect(new Set(question.options.map((option) => option.text.toLocaleLowerCase('tr'))).size, label).toBe(question.options.length);
  if (question.kind !== 'article') {
    const sources = question.options.map((option) => byId(library).get(option.wordId!)!);
    expect(new Set(sources.map((entry) => entry.id)).size, label).toBe(TRANSLATION_OPTIONS);
    // No two options could be taken for one another either.
    sources.forEach((a, i) =>
      sources.slice(i + 1).forEach((b) => {
        expect(share(meaningsOf(a), meaningsOf(b)), `${label}: ${a.lemma} / ${b.lemma}`).toBe(false);
        expect(german(a.lemma) === german(b.lemma), `${label}: ${a.lemma} / ${b.lemma}`).toBe(false);
      }),
    );
  }
}

const KINDS: readonly Track[] = ['de_tr', 'tr_de', 'article'];

describe('every question has exactly one defensible answer', () => {
  it('holds for every word, every way it can be asked, over many random draws', () => {
    const pool = createChoicePool(TRICKY);
    let asked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const random = seeded(seed);
      for (const target of TRICKY) {
        for (const kind of testKindsFor(pool, target, 'mixed')) {
          const question = buildQuestion(pool, target, kind, { random });
          expect(question, `${target.lemma} ${kind}`).not.toBeNull();
          expectSound(question!, TRICKY);
          asked++;
        }
      }
    }
    expect(asked).toBeGreaterThan(TRICKY.length * 60);
  });

  it('never offers a word that shares a meaning, a spelling or a part of one', () => {
    const pool = createChoicePool(TRICKY);
    const find = (lemma: string, article: Article | null) => TRICKY.find((entry) => entry.lemma === lemma && entry.article === article)!;
    const drawn = (target: ChoiceWord, kind: Track) => Array.from({ length: 200 }, (_, seed) => buildQuestion(pool, target, kind, { random: seeded(seed) })!.options);
    const offered = (target: ChoiceWord, kind: Track) => new Set(drawn(target, kind).flat().map((option) => option.text));
    const sources = (target: ChoiceWord, kind: Track) => new Set(drawn(target, kind).flat().map((option) => option.wordId));
    // das Meer and die See both mean deniz.
    expect(offered(find('Meer', 'das'), 'tr_de')).not.toContain('die See');
    expect(sources(find('Meer', 'das'), 'de_tr')).not.toContain(find('See', 'die').id);
    // der Wagen also means araba, so it is never wrong for das Auto, and araba is never wrong for it.
    expect(offered(find('Auto', 'das'), 'tr_de')).not.toContain('der Wagen');
    expect(sources(find('Wagen', 'der'), 'de_tr')).not.toContain(find('Auto', 'das').id);
    expect(sources(find('Auto', 'das'), 'de_tr')).not.toContain(find('Wagen', 'der').id);
    // ev sahibi contains ev; büyük is part of çok büyük; gitmek is the start of gitmek (araçla).
    expect(offered(find('Haus', 'das'), 'de_tr')).not.toContain('ev sahibi');
    expect(offered(find('groß', null), 'de_tr')).not.toContain('çok büyük');
    expect(offered(find('gehen', null), 'tr_de')).not.toContain('fahren');
    // Straße and Strasse are one spelling, whatever they were saved to mean.
    expect(offered(find('Straße', 'die'), 'tr_de')).not.toContain('die Strasse');
    // A word saved twice is never its own wrong option.
    expect(offered(find('See', 'der'), 'tr_de')).not.toContain('die See');
    expect(offered(find('Bank', 'die'), 'tr_de').size).toBeGreaterThan(0);
    expect([...offered(find('Bank', 'die'), 'tr_de')].filter((text) => text === 'die Bank')).toHaveLength(1);
  });

  it('rejects what the typed answer check would accept, even when the meanings look different', () => {
    // The dictionary offers Fuss as an accepted form of Fuß; a saved Fuss must then never be wrong.
    const fuss = word('Fussball', 'der', ['futbol']);
    const library = [...TRICKY, fuss];
    const target = TRICKY.find((entry) => entry.lemma === 'Fuß')!;
    const offer: Suggestion = { german: 'Fussball', article: 'der' };
    const doubt: DictionaryDoubt = { article: false, offers: [offer] };
    const pool = createChoicePool(library);
    for (let seed = 0; seed < 100; seed++) {
      const question = buildQuestion(pool, target, 'tr_de', { doubt, random: seeded(seed) })!;
      expect(question.options.map((option) => option.text)).not.toContain('der Fussball');
      expectSound(question, library, doubt);
    }
  });
});

describe('each safeguard holds on its own', () => {
  // Small libraries, where ranking by length or kind cannot hide a missing rule.
  it('an option the typed check would accept is never counted, even when nothing else rules it out', () => {
    const target = word('Fuß', 'der', ['ayak']);
    const library = [target, word('Fussball', 'der', ['futbol']), word('Tisch', 'der', ['masa']), word('Stuhl', 'der', ['sandalye'])];
    const offer: Suggestion = { german: 'Fussball', article: 'der' };
    const doubt: DictionaryDoubt = { article: false, offers: [offer] };
    const pool = createChoicePool(library);
    expect(canAsk(pool, target, 'tr_de', doubt)).toBe(false);
    expect(buildQuestion(pool, target, 'tr_de', { doubt, random: seeded(1) })).toBeNull();
    // Without the offer, Fussball is an ordinary wrong option.
    expect(canAsk(pool, target, 'tr_de')).toBe(true);
  });

  it('asked in German, a noun is only offered among nouns, even when that leaves too few', () => {
    const nouns = [word('Apfel', 'der', ['elma']), word('Birne', 'die', ['armut']), word('Kirsche', 'die', ['kiraz'])];
    const library = [...nouns, word('lesen', null, ['okumak']), word('schreiben', null, ['yazmak']), word('klein', null, ['küçük'])];
    const pool = createChoicePool(library);
    expect(canAsk(pool, nouns[0]!, 'tr_de')).toBe(false);
    expect(canAsk(pool, library[3]!, 'tr_de')).toBe(false);
    // Asked in Turkish, the options carry no article, so any saved word will do.
    expect(canAsk(pool, nouns[0]!, 'de_tr')).toBe(true);
    expectSound(buildQuestion(pool, nouns[0]!, 'de_tr', { random: seeded(2) })!, library);
  });
});

describe('options look alike, so none stands out', () => {
  it('asked in German, every option of a noun has an article and every other option has none', () => {
    const pool = createChoicePool(TRICKY);
    for (let seed = 0; seed < 40; seed++) {
      for (const target of TRICKY) {
        if (!canAsk(pool, target, 'tr_de')) continue;
        const question = buildQuestion(pool, target, 'tr_de', { random: seeded(seed) })!;
        for (const option of question.options) expect(option.german!.article !== null, `${target.lemma}: ${option.text}`).toBe(target.article !== null);
      }
    }
  });

  it('a doubted article leaves every German option bare, and is never asked as an article', () => {
    const pool = createChoicePool(TRICKY);
    const target = TRICKY.find((entry) => entry.lemma === 'Apfel')!;
    const doubt: DictionaryDoubt = { article: true, offers: [] };
    const question = buildQuestion(pool, target, 'tr_de', { doubt, random: seeded(1) })!;
    expect(question.options.every((option) => option.german!.article === null)).toBe(true);
    expect(question.options[question.correct]!.text).toBe('Apfel');
    expect(buildQuestion(pool, target, 'de_tr', { doubt, random: seeded(1) })!.prompt).toBe('Apfel');
    expect(canAsk(pool, target, 'article', doubt)).toBe(false);
    expect(buildQuestion(pool, target, 'article', { doubt, random: seeded(1) })).toBeNull();
    expectSound(question, TRICKY, doubt);
  });

  it('shows one meaning per Turkish option, so the right one is not the long one', () => {
    const pool = createChoicePool(TRICKY);
    const tor = TRICKY.find((entry) => entry.lemma === 'Tor')!;
    const question = buildQuestion(pool, tor, 'de_tr', { random: seeded(3) })!;
    expect(question.options[question.correct]!.text).toBe('kapı');
    expect(question.prompt).toBe('das Tor');
  });
});

describe('small libraries and doubtful words', () => {
  it('a word without three safe options is not asked, and nothing is filled in', () => {
    const tiny = [word('Apfel', 'der', ['elma']), word('Birne', 'die', ['armut']), word('Kirsche', 'die', ['kiraz'])];
    const pool = createChoicePool(tiny);
    for (const target of tiny) {
      expect(canAsk(pool, target, 'de_tr')).toBe(false);
      expect(canAsk(pool, target, 'tr_de')).toBe(false);
      expect(buildQuestion(pool, target, 'de_tr', { random: seeded(1) })).toBeNull();
      expect(testKindsFor(pool, target, 'mixed')).toEqual(['article']);
    }
  });

  it('options that clash with one another do not count toward the three', () => {
    // Three nouns all meaning deniz are one option at most, so the fourth word cannot be asked.
    const library = [word('Apfel', 'der', ['elma']), word('Meer', 'das', ['deniz']), word('See', 'die', ['deniz']), word('Ozean', 'der', ['deniz', 'okyanus']), word('Birne', 'die', ['armut'])];
    const pool = createChoicePool(library);
    expect(canAsk(pool, library[0]!, 'tr_de')).toBe(false);
    library.push(word('Kirsche', 'die', ['kiraz']));
    expect(canAsk(createChoicePool(library), library[0]!, 'tr_de')).toBe(true);
  });

  it('a small selection draws its options from the rest of the library, its own words first', () => {
    const pool = createChoicePool(TRICKY);
    const chosen = TRICKY.filter((entry) => ['Apfel', 'Birne', 'Kirsche', 'Tisch'].includes(entry.lemma));
    const preferred = new Set(chosen.map((entry) => entry.id));
    for (let seed = 0; seed < 50; seed++) {
      const question = buildQuestion(pool, chosen[0]!, 'de_tr', { preferred, random: seeded(seed) })!;
      expect(question.options.every((option) => preferred.has(option.wordId!))).toBe(true);
    }
    // Two words chosen: the other options come from elsewhere in the library.
    const two = new Set(chosen.slice(0, 2).map((entry) => entry.id));
    const question = buildQuestion(pool, chosen[0]!, 'de_tr', { preferred: two, random: seeded(4) })!;
    expect(question.options.filter((option) => two.has(option.wordId!))).toHaveLength(2);
    expectSound(question, TRICKY);
  });

  it('never shows a word with an open dictionary warning as an option', () => {
    const blocked = new Set(TRICKY.filter((entry) => ['Birne', 'Kirsche', 'Tisch', 'Stuhl', 'Fenster'].includes(entry.lemma)).map((entry) => entry.id));
    const pool = createChoicePool(TRICKY, (id) => blocked.has(id));
    for (let seed = 0; seed < 100; seed++) {
      for (const kind of ['de_tr', 'tr_de'] as const) {
        const question = buildQuestion(pool, TRICKY.find((entry) => entry.lemma === 'Apfel')!, kind, { random: seeded(seed) })!;
        expect(question.options.some((option) => blocked.has(option.wordId!))).toBe(false);
      }
    }
  });

  it('long saved values are kept whole', () => {
    const long = word('Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherungsanstaltsbeschwerdestellenleiterin', 'die', ['t'.repeat(10) + ' ' + 'çok uzun bir açıklama '.repeat(12).trim()]);
    const library = [...TRICKY, long];
    const pool = createChoicePool(library);
    const question = buildQuestion(pool, long, 'tr_de', { random: seeded(2) })!;
    expect(question.options[question.correct]!.text).toBe(`die ${long.lemma}`);
    expect(question.prompt).toBe(long.meanings[0]!.text);
    expectSound(question, library);
  });
});

describe('order and position', () => {
  it('puts the right answer in every position about equally often', () => {
    const pool = createChoicePool(TRICKY);
    const target = TRICKY.find((entry) => entry.lemma === 'Hund')!;
    const counts = [0, 0, 0, 0];
    const draws = 4000;
    for (let seed = 0; seed < draws; seed++) counts[buildQuestion(pool, target, 'de_tr', { random: seeded(seed) })!.correct]!++;
    for (const count of counts) expect(count / draws).toBeGreaterThan(0.21);
    for (const count of counts) expect(count / draws).toBeLessThan(0.29);
  });

  it('an article question always offers der, die, das in that order', () => {
    const pool = createChoicePool(TRICKY);
    for (const target of TRICKY.filter((entry) => entry.article)) {
      const question = buildQuestion(pool, target, 'article', { random: seeded(9) })!;
      expect(question.options.map((option) => option.text)).toEqual(['der', 'die', 'das']);
      expect(question.options[question.correct]!.text).toBe(target.article);
      expect(question.detail).toBe(target.meanings.map((meaning) => meaning.text).join(', '));
      expectSound(question, TRICKY);
    }
    expect(canAsk(pool, TRICKY.find((entry) => entry.lemma === 'gehen')!, 'article')).toBe(false);
  });

  it('the same random draws give the same question, so nothing depends on when it is built', () => {
    const pool = createChoicePool(TRICKY);
    const target = TRICKY.find((entry) => entry.lemma === 'Katze')!;
    expect(buildQuestion(pool, target, 'tr_de', { random: seeded(77) })).toEqual(buildQuestion(pool, target, 'tr_de', { random: seeded(77) }));
  });
});

describe('a mixed test', () => {
  it('balances the three kinds of question, and asks each word only a way it can be asked', () => {
    const pool: ChoicePool = createChoicePool(TRICKY);
    const kindsOf = (entry: ChoiceWord) => testKindsFor(pool, entry, 'mixed');
    const totals = new Map<string, number>();
    for (let seed = 0; seed < 30; seed++) {
      const round = buildRound({ words: TRICKY, mode: 'mixed', count: 30, history: [], doubtOf: () => NO_DOUBT, random: seeded(seed), kindsOf });
      expect(round).toHaveLength(30);
      for (const item of round) {
        const target = TRICKY.find((entry) => entry.id === item.wordId)!;
        expect(kindsOf(target)).toContain(item.track);
        totals.set(item.track, (totals.get(item.track) ?? 0) + 1);
      }
    }
    expect([...totals.keys()].sort()).toEqual([...KINDS].sort());
    const counts = [...totals.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(30 * 30 * 0.1);
  });

  it('a typed round that does not pass kindsOf is unchanged', () => {
    const plain = buildRound({ words: TRICKY, mode: 'mixed', count: 20, history: [], doubtOf: () => NO_DOUBT, random: seeded(5) });
    const same = buildRound({ words: TRICKY, mode: 'mixed', count: 20, history: [], doubtOf: () => NO_DOUBT, random: seeded(5) });
    expect(plain).toEqual(same);
    expect(plain.some((item) => item.track === 'article')).toBe(true);
  });
});
