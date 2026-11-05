import { describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import { evaluateAnswer, hintFor, type AnswerWord, type DictionaryDoubt, type Track } from '../src/core/practice/answers';

let serial = 0;
const word = (lemma: string, article: Article | null, ...meanings: string[]): AnswerWord => ({ id: `w${serial++}`, lemma, article, meanings: meanings.map((text) => ({ text })) });

const apfel = word('Apfel', 'der', 'elma');
const fuss = word('Fuß', 'der', 'ayak');
const tuer = word('Tür', 'die', 'kapı');
const tor = word('Tor', 'das', 'kale');
const urlaub = word('Urlaub', 'der', 'tatil (tatile çıkmak vb.)');
const ferien = word('Ferien', 'die', 'tatil (kurban bayramı tatili vs.)');
const seeM = word('See', 'der', 'göl');
const seeF = word('See', 'die', 'deniz');
const morgenN = word('Morgen', 'der', 'sabah');
const morgen = word('morgen', null, 'yarın');
const danke = word('danke', null, 'teşekkürler');
const hallo = word('Hallo', null, 'Selam, merhaba'.split(', ')[0]!, 'merhaba');
const was = word('Was?', null, 'Ne?', 'ne');
const wiedersehen = word('Auf Wiedersehen!', null, 'Görüşmek üzere!');
const phrase = word('das ist gut', null, 'bu iyi');
const freuen = word('(sich) freuen', null, 'sevinmek');
const lampe = word('Lampe', null, 'lamba');
const reis = word('Reis', 'der', 'pirinç', 'pilav');
const kir = word('kır', null, 'kır');
const kirli = word('Schmutz', 'der', 'kir');
const library = [apfel, fuss, tuer, tor, urlaub, ferien, seeM, seeF, morgenN, morgen, danke, hallo, was, wiedersehen, phrase, freuen, lampe, reis, kir, kirli];

const check = (target: AnswerWord, track: Track, typed: string, doubt?: DictionaryDoubt) => evaluateAnswer(target, track, typed, { library, ...(doubt ? { doubt } : {}) });
const german = (target: AnswerWord, typed: string, doubt?: DictionaryDoubt) => check(target, 'tr_de', typed, doubt);
const turkish = (target: AnswerWord, typed: string) => check(target, 'de_tr', typed);

describe('German answers', () => {
  it('accepts the exact answer, in any harmless spacing and in decomposed Unicode', () => {
    for (const typed of ['der Apfel', '  der   Apfel ', 'Der Apfel', 'Apfel, der']) expect(german(apfel, typed)).toMatchObject({ result: 'correct', correct: true });
    expect(german(fuss, 'der Fuß'.normalize('NFD'))).toMatchObject({ result: 'correct' });
  });

  it('requires the article and never accepts a wrong one', () => {
    expect(german(apfel, 'Apfel')).toMatchObject({ result: 'article_missing', correct: false });
    expect(german(apfel, 'die Apfel')).toMatchObject({ result: 'article_wrong', correct: false });
    expect(german(apfel, 'das Apfel')).toMatchObject({ result: 'article_wrong', correct: false });
  });

  it('a word saved with both articles keeps them apart and names the other one', () => {
    const answer = german(seeM, 'die See');
    expect(answer).toMatchObject({ result: 'article_wrong', correct: false });
    expect(answer.other).toMatchObject({ article: 'die', meanings: ['deniz'] });
  });

  it('capitalization is spelling on a noun', () => {
    expect(german(apfel, 'der apfel')).toMatchObject({ result: 'capitalization', correct: false });
    expect(german(apfel, 'DER APFEL')).toMatchObject({ result: 'capitalization', correct: false });
    expect(german(fuss, 'der FUß')).toMatchObject({ result: 'capitalization', correct: false });
  });

  it('a capital at the start of a non-noun is accepted, and said', () => {
    expect(german(danke, 'Danke')).toMatchObject({ result: 'correct', correct: true, note: 'case' });
    expect(german(hallo, 'hallo')).toMatchObject({ result: 'correct', correct: true, note: 'case' });
    expect(german(danke, 'DANKE')).toMatchObject({ result: 'capitalization', correct: false });
  });

  it('but not when that capital makes it a different saved word', () => {
    const answer = german(morgen, 'Morgen');
    expect(answer).toMatchObject({ result: 'capitalization', correct: false });
    expect(answer.other).toMatchObject({ article: 'der', meanings: ['sabah'] });
    expect(german(morgenN, 'der morgen')).toMatchObject({ result: 'capitalization', correct: false });
  });

  it('umlauts and ß are letters of their own', () => {
    expect(german(fuss, 'der Fuss')).toMatchObject({ result: 'transliteration', correct: false });
    expect(german(fuss, 'der Fus')).toMatchObject({ result: 'wrong', correct: false });
    for (const typed of ['die Tuer', 'die Tur']) expect(german(tuer, typed)).toMatchObject({ result: 'transliteration', correct: false });
    const tschuess = word('Tschüss!', null, 'hoşça kal');
    expect(german(tschuess, 'Tschüß')).toMatchObject({ result: 'transliteration', correct: false });
  });

  it('a slip is called close but not correct, and anything further is simply wrong', () => {
    expect(german(apfel, 'der Apfle')).toMatchObject({ result: 'typo', correct: false });
    expect(german(apfel, 'der Apel')).toMatchObject({ result: 'typo', correct: false });
    expect(german(apfel, 'der Afpell')).toMatchObject({ result: 'wrong', correct: false });
    expect(german(word('Ei', 'das', 'yumurta'), 'das Eo')).toMatchObject({ result: 'wrong', correct: false });
  });

  it('another saved word is named as a mix-up, not called a typo', () => {
    const answer = german(tuer, 'das Tor');
    expect(answer).toMatchObject({ result: 'other_word', correct: false });
    expect(answer.other).toMatchObject({ lemma: 'Tor' });
  });

  it('a saved word with a shared meaning is a right answer, with its own article', () => {
    expect(german(urlaub, 'die Ferien')).toMatchObject({ result: 'also_valid', correct: true });
    expect(german(urlaub, 'der Ferien')).toMatchObject({ result: 'article_wrong', correct: false });
    expect(german(urlaub, 'Ferien')).toMatchObject({ result: 'article_missing', correct: false });
  });

  it('punctuation is never required, or in the way', () => {
    for (const typed of ['Was', 'Was?', 'was', 'Was ?']) expect(german(was, typed).correct).toBe(true);
    for (const typed of ['Auf Wiedersehen', 'auf Wiedersehen', 'Auf Wiedersehen!!']) expect(german(wiedersehen, typed).correct).toBe(true);
    expect(german(wiedersehen, 'auf wiedersehen')).toMatchObject({ result: 'capitalization', correct: false });
    expect(german(word("Wie geht's?", null, 'nasılsın'), 'Wie gehts')).toMatchObject({ correct: true });
  });

  it('a saved phrase that starts like an article is not taken apart', () => {
    expect(german(phrase, 'das ist gut')).toMatchObject({ result: 'correct', correct: true });
    expect(german(phrase, 'Das ist gut')).toMatchObject({ result: 'correct', correct: true, note: 'case' });
  });

  it('optional parts in parentheses may be left out or written', () => {
    expect(german(freuen, 'freuen').correct).toBe(true);
    expect(german(freuen, 'sich freuen').correct).toBe(true);
  });

  it('an article typed on a word saved without one cannot be judged, so it is not counted against the learner', () => {
    expect(german(lampe, 'die Lampe')).toMatchObject({ result: 'unknown_accepted', correct: true });
    expect(german(lampe, 'Lampe')).toMatchObject({ result: 'correct', correct: true });
    expect(german(danke, 'das danke')).toMatchObject({ result: 'wrong', correct: false });
  });

  it('nothing typed, or only an article, is not an answer', () => {
    for (const typed of ['', '   ', '?!']) expect(german(apfel, typed).correct).toBe(false);
    expect(german(apfel, 'der').correct).toBe(false);
  });
});

describe('Turkish answers', () => {
  it('accepts any saved meaning, in any case and with harmless punctuation', () => {
    for (const typed of ['pirinç', 'pilav', 'PİRİNÇ', ' pilav. ', 'Pilav!']) expect(turkish(reis, typed)).toMatchObject({ result: 'correct', correct: true });
    for (const typed of ['ne', 'Ne?', 'NE']) expect(turkish(was, typed).correct).toBe(true);
  });

  it('several meanings at once are fine only if all of them are right', () => {
    expect(turkish(reis, 'pirinç, pilav').correct).toBe(true);
    expect(turkish(reis, 'pirinç, makarna').correct).toBe(false);
  });

  it('does not require the explanation in parentheses, and allows it', () => {
    expect(turkish(urlaub, 'tatil')).toMatchObject({ result: 'correct' });
    expect(turkish(urlaub, 'tatil (tatile çıkmak vb.)')).toMatchObject({ result: 'correct' });
    expect(turkish(urlaub, 'tatil (kısa)')).toMatchObject({ result: 'correct' });
    // The words inside are an explanation, not a meaning.
    expect(turkish(urlaub, 'tatile çıkmak').correct).toBe(false);
  });

  it('a meaning written with a trailing vb. or a slash counts in its short forms', () => {
    const ev = word('Haus', 'das', 'ev vb.');
    expect(turkish(ev, 'ev').correct).toBe(true);
    const izin = word('Pause', 'die', 'mola/ara');
    expect(turkish(izin, 'mola').correct).toBe(true);
    expect(turkish(izin, 'ara').correct).toBe(true);
    expect(turkish(izin, 'mola/ara').correct).toBe(true);
  });

  it('keeps Turkish letters apart: kir is not kır', () => {
    const answer = turkish(kir, 'kir');
    expect(answer).toMatchObject({ result: 'other_word', correct: false });
    expect(answer.other).toMatchObject({ lemma: 'Schmutz' });
    const city = word('Blume', 'die', 'çiçek');
    expect(turkish(city, 'cicek')).toMatchObject({ result: 'transliteration', correct: false });
  });

  it('a meaning from another saved word stays wrong, and is named', () => {
    const answer = turkish(apfel, 'kapı');
    expect(answer).toMatchObject({ result: 'other_word', correct: false });
    expect(answer.other).toMatchObject({ lemma: 'Tür' });
    expect(turkish(seeM, 'deniz')).toMatchObject({ result: 'other_word', correct: false });
    expect(turkish(morgen, 'sabah')).toMatchObject({ result: 'other_word', correct: false });
  });

  it('a slip is close, an unrelated word is wrong, and neither is correct', () => {
    expect(turkish(word('Schule', 'die', 'okul'), 'okl').correct).toBe(false);
    expect(turkish(word('Fenster', 'das', 'pencere'), 'pencre')).toMatchObject({ result: 'typo', correct: false });
    expect(turkish(apfel, 'armut')).toMatchObject({ result: 'wrong', correct: false });
    expect(turkish(apfel, '')).toMatchObject({ result: 'wrong', correct: false });
  });
});

describe('Article answers', () => {
  it('takes the article, in any case, alone or with its word', () => {
    for (const typed of ['der', 'Der', ' DER ', 'der Apfel']) expect(check(apfel, 'article', typed)).toMatchObject({ result: 'correct', correct: true });
  });

  it('refuses another article and anything that is not one', () => {
    expect(check(apfel, 'article', 'die')).toMatchObject({ result: 'article_wrong', correct: false });
    expect(check(apfel, 'article', 'den')).toMatchObject({ result: 'wrong', correct: false });
    expect(check(apfel, 'article', 'der Birne')).toMatchObject({ result: 'wrong', correct: false });
    expect(check(apfel, 'article', '')).toMatchObject({ result: 'wrong', correct: false });
  });
});

describe('dictionary doubts', () => {
  const automat = word('Geldautomat', 'das', 'bankamatik');
  const doubt: DictionaryDoubt = { article: true, offers: [{ german: 'Geldautomat', article: 'der' }] };

  it('the question no longer depends on a saved article the dictionary disputes', () => {
    expect(german(automat, 'Geldautomat', doubt)).toMatchObject({ correct: true });
    expect(german(automat, 'das Geldautomat', doubt)).toMatchObject({ result: 'correct', note: null });
    expect(german(automat, 'der Geldautomat', doubt)).toMatchObject({ correct: true, note: 'dictionary' });
  });

  it('a dispute does not make everything acceptable', () => {
    expect(german(automat, 'der Automat', doubt).correct).toBe(false);
    expect(german(automat, 'Geldautomatt', doubt).correct).toBe(false);
  });

  it('a spelling offer is accepted and marked, the saved spelling stays right', () => {
    const kaffe = word('Kaffe', 'der', 'kahve');
    const spelling: DictionaryDoubt = { article: false, offers: [{ german: 'Kaffee', article: 'der' }] };
    expect(german(kaffe, 'der Kaffee', spelling)).toMatchObject({ result: 'unknown_accepted', correct: true, note: 'dictionary' });
    expect(german(kaffe, 'der Kaffe', spelling)).toMatchObject({ result: 'correct', correct: true });
    expect(german(kaffe, 'die Kaffee', spelling).correct).toBe(false);
  });
});

describe('hints', () => {
  it('gives the first letter of the word, never of its article, and never the whole answer', () => {
    expect(hintFor(apfel, 'tr_de')).toBe('A…');
    expect(hintFor(tuer, 'tr_de')).toBe('T…');
    expect(hintFor(word('Äpfel', 'die', 'elmalar'), 'tr_de')).toBe('Ä…');
    expect(hintFor(apfel, 'de_tr')).toBe('e…');
    expect(hintFor(word('(sich) freuen', null, 'sevinmek'), 'tr_de')).toBe('f…');
    expect(hintFor(urlaub, 'de_tr')).toBe('t…');
    expect(hintFor(word('X', null, 'x harfi'), 'tr_de')).toBeNull();
  });

  it('has nothing to offer on an article question', () => {
    expect(hintFor(apfel, 'article')).toBeNull();
  });
});
