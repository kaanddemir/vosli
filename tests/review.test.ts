import { describe, expect, it } from 'vitest';
import type { Article } from '../src/core/identity';
import { blankDraft, classifyEntry, indexKnown, countEditedRows, needsAttention, rowCorrections, rowOutcome, rowWarnings, tallyRows, reviewRows, rowRef, SEPARATE, type ImportDraft, type KnownEntry, type RowStatus } from '../src/core/review';

const known = (ref: string, lemma: string, article: Article | null, ...meanings: string[]): KnownEntry => ({ ref, lemma, article, meanings });
const classify = (lemma: string, article: Article | null, meanings: string[], entries: KnownEntry[]) => classifyEntry(lemma, article, meanings, indexKnown(entries));
const draft = (id: string, german: string, article: string, turkish: string, extra: Partial<ImportDraft> = {}) => blankDraft(id, 0, { german, article, turkish, ...extra });
const kinds = (statuses: { status: RowStatus }[]) => statuses.map((row) => row.status.kind);

describe('classifying one entry', () => {
  it('is new when nothing is spelled alike', () => {
    expect(classify('Apfel', 'der', ['elma'], [known('a', 'Birne', 'die', 'armut')])).toEqual({ kind: 'new' });
  });

  it('links the same word with a shared meaning, and lists meanings to add', () => {
    const apple = known('a', 'Apfel', 'der', 'elma');
    expect(classify('Apfel', 'der', ['Elma'], [apple])).toEqual({ kind: 'existing', entry: apple, newMeanings: [] });
    expect(classify('Apfel', 'der', ['elma', 'alma'], [apple])).toEqual({ kind: 'existing', entry: apple, newMeanings: ['alma'] });
  });

  it('asks when the same word has only a different meaning', () => {
    const bank = known('b', 'Bank', 'die', 'banka');
    expect(classify('Bank', 'die', ['sıra'], [bank])).toEqual({ kind: 'ambiguous', reason: 'meaning', candidates: [bank] });
  });

  it('does not treat dotted and dotless spellings of a meaning as equal', () => {
    expect(classify('Schmutz', 'der', ['kır'], [known('s', 'Schmutz', 'der', 'kir')])).toMatchObject({ kind: 'ambiguous', reason: 'meaning' });
  });

  it('finds the right sense among separate entries', () => {
    const banka = known('b1', 'Bank', 'die', 'banka');
    const sira = known('b2', 'Bank', 'die', 'sıra');
    expect(classify('Bank', 'die', ['sıra'], [banka, sira])).toMatchObject({ kind: 'existing', entry: sira });
  });

  it('keeps essen and das Essen apart, in both directions', () => {
    expect(classify('essen', null, ['yemek'], [known('e', 'Essen', 'das', 'yemek')])).toEqual({ kind: 'new' });
    expect(classify('Essen', 'das', ['yemek'], [known('e', 'essen', null, 'yemek')])).toEqual({ kind: 'new' });
    expect(classify('morgen', null, ['yarın'], [known('m', 'Morgen', 'der', 'sabah')])).toEqual({ kind: 'new' });
  });

  it('asks about a different article, even with the same letters', () => {
    expect(classify('See', 'die', ['deniz'], [known('s', 'See', 'der', 'göl')])).toMatchObject({ kind: 'ambiguous', reason: 'article' });
    expect(classify('Geldautomat', 'das', ['ATM'], [known('g', 'Geldautomat', 'der', 'ATM')])).toMatchObject({ kind: 'ambiguous', reason: 'article' });
  });

  it('asks when a capitalized word may just be missing its article', () => {
    expect(classify('Apfel', null, ['elma'], [known('a', 'Apfel', 'der', 'elma')])).toMatchObject({ kind: 'ambiguous', reason: 'article_missing' });
  });

  it('asks when only capitalization differs', () => {
    expect(classify('Morgen', null, ['yarın'], [known('m', 'morgen', null, 'yarın')])).toMatchObject({ kind: 'ambiguous', reason: 'case' });
  });

  it('treats closing punctuation as the same word', () => {
    expect(classify('Was', null, ['ne'], [known('w', 'Was?', null, 'ne')])).toMatchObject({ kind: 'existing' });
  });

  it('never matches words that differ by more than case', () => {
    expect(classify('schwul', null, ['x'], [known('s', 'schwül', null, 'y')])).toEqual({ kind: 'new' });
  });
});

describe('reviewing a batch', () => {
  it('folds a repeat into the earlier row and keeps its extra meaning', () => {
    const rows = reviewRows([draft('1', 'Apfel', 'der', 'elma'), draft('2', 'Apfel', 'der', 'elma, alma'), draft('3', 'Apfel', 'der', 'alma')], []);
    expect(kinds(rows)).toEqual(['new', 'existing', 'existing']);
    expect(rows[1]!.status).toMatchObject({ inBatch: true, newMeanings: ['alma'], entry: { ref: rowRef('1') } });
    expect(rows[2]!.status).toMatchObject({ newMeanings: [] });
  });

  it('asks about conflicts inside the batch', () => {
    const rows = reviewRows([draft('1', 'Bank', 'die', 'banka'), draft('2', 'Bank', 'die', 'sıra'), draft('3', 'See', 'der', 'göl'), draft('4', 'See', 'die', 'deniz')], []);
    expect(kinds(rows)).toEqual(['new', 'ambiguous', 'new', 'ambiguous']);
    expect(rows[1]!.status).toMatchObject({ reason: 'meaning', candidates: [{ ref: rowRef('1') }] });
    expect(rows[3]!.status).toMatchObject({ reason: 'article' });
  });

  it('checks stored words before the batch', () => {
    const rows = reviewRows([draft('1', 'Apfel', 'der', 'elma')], [known('w', 'Apfel', 'der', 'elma')]);
    expect(rows[0]!.status).toMatchObject({ kind: 'existing', inBatch: false, entry: { ref: 'w' } });
  });

  it('reports invalid rows and unblocks once corrected or excluded', () => {
    const invalid = reviewRows([draft('1', 'Apfel', 'der', ''), draft('2', '', '', 'elma'), draft('3', 'Birne', 'den', 'armut')], []);
    expect(invalid.map((row) => row.status)).toEqual([{ kind: 'invalid', errors: ['turkish_missing'] }, { kind: 'invalid', errors: ['german_missing'] }, { kind: 'invalid', errors: ['article_invalid'] }]);
    expect(invalid.every((row) => needsAttention(row.status))).toBe(true);
    expect(reviewRows([draft('1', 'Apfel', 'der', 'elma')], [])[0]!.status.kind).toBe('new');
    const excluded = reviewRows([draft('1', 'Apfel', 'der', '', { excluded: true })], []);
    expect(excluded[0]!.status.kind).toBe('excluded');
    expect(needsAttention(excluded[0]!.status)).toBe(false);
  });

  it('an excluded row no longer conflicts with later ones', () => {
    const rows = reviewRows([draft('1', 'See', 'der', 'göl', { excluded: true }), draft('2', 'See', 'die', 'deniz')], []);
    expect(kinds(rows)).toEqual(['excluded', 'new']);
  });

  it('a choice resolves ambiguity, and is forgotten when it stops making sense', () => {
    const base = [known('b', 'Bank', 'die', 'banka')];
    const linked = reviewRows([draft('1', 'Bank', 'die', 'sıra', { choice: 'b' })], base);
    expect(linked[0]!.status).toMatchObject({ kind: 'ambiguous', choice: 'b' });
    expect(needsAttention(linked[0]!.status)).toBe(false);
    const separate = reviewRows([draft('1', 'Bank', 'die', 'sıra', { choice: SEPARATE })], base);
    expect(needsAttention(separate[0]!.status)).toBe(false);
    const stale = reviewRows([draft('1', 'Bank', 'die', 'sıra', { choice: 'gone' })], base);
    expect(needsAttention(stale[0]!.status)).toBe(true);
  });

  it('a row kept separate can be matched by a later row', () => {
    const rows = reviewRows([draft('1', 'Bank', 'die', 'sıra', { choice: SEPARATE }), draft('2', 'Bank', 'die', 'sıra')], [known('b', 'Bank', 'die', 'banka')]);
    expect(rows[1]!.status).toMatchObject({ kind: 'existing', inBatch: true, entry: { ref: rowRef('1') } });
  });
});

describe('counting rows', () => {
  it('counts a stored word met twice once as saved, then as a repeat', () => {
    const stored = [{ ref: 'a', lemma: 'Apfel', article: 'der' as const, meanings: ['elma'] }];
    const rows = reviewRows([draft('1', 'Apfel', 'der', 'elma'), draft('2', 'Apfel', 'der', 'elma'), draft('3', 'Birne', 'die', 'armut'), draft('4', 'Birne', 'die', 'armut')], stored);
    expect(rows.map(rowOutcome)).toEqual(['existing', 'repeat', 'create', 'repeat']);
    expect(tallyRows(rows)).toMatchObject({ create: 1, existing: 1, repeat: 2 });
  });

  it('counts an answered row by what the answer does', () => {
    const stored = [{ ref: 'b', lemma: 'Bank', article: 'die' as const, meanings: ['banka'] }];
    const rows = reviewRows([draft('1', 'Bank', 'die', 'sıra', { choice: 'b' }), draft('2', 'Bank', 'die', 'kurum', { choice: 'b' }), draft('3', 'Bank', 'die', 'masa')], stored);
    expect(rows.map(rowOutcome)).toEqual(['existing', 'repeat', 'pending']);
  });

  it('tells excluded rows from excluded invalid rows', () => {
    const rows = reviewRows([draft('1', 'Apfel', 'der', 'elma', { excluded: true }), draft('2', 'Apfel', 'der', '', { excluded: true })], []);
    expect(rows.map(rowOutcome)).toEqual(['excluded', 'invalid']);
  });

  it('blocks text a source could not decode', () => {
    const [row] = reviewRows([draft('1', 'L\u001ebe', 'die', 'aşk')], []);
    expect(row!.status).toMatchObject({ kind: 'invalid', errors: ['unreadable'] });
  });
});

describe('noticing edits', () => {
  const start = [draft('1', 'Apfel', 'der', 'elma'), draft('2', 'Birne', 'die', 'armut')];

  it('sees nothing in an untouched review', () => {
    expect(countEditedRows(start, start)).toBe(0);
  });

  it('counts corrected, excluded and answered rows', () => {
    expect(countEditedRows(start, [{ ...start[0]!, german: 'Äpfel' }, start[1]!])).toBe(1);
    expect(countEditedRows(start, [{ ...start[0]!, excluded: true }, { ...start[1]!, choice: 'separate' }])).toBe(2);
  });

  it('sees nothing once a change is undone', () => {
    expect(countEditedRows(start, [{ ...start[0]!, german: 'Apfel', edited: true }, start[1]!])).toBe(0);
  });
});

describe('warnings follow the text', () => {
  const flagged = (flags: string[], extra: Partial<ImportDraft> = {}) => draft('1', 'Haus', '', 'ev', { flags, ...extra });

  it('holds a warning until its cause is fixed, not until any edit', () => {
    expect(rowWarnings(flagged(['article_missing']))).toEqual(['article_missing']);
    expect(rowWarnings(flagged(['article_missing'], { turkish: 'konut', edited: true }))).toEqual(['article_missing']);
    expect(rowWarnings(flagged(['article_missing'], { article: 'das', edited: true }))).toEqual([]);
  });

  it('clears the lowercase warning by either fix', () => {
    const row = draft('1', 'apfel', 'der', 'elma', { flags: ['article_lowercase'] });
    expect(rowWarnings(row)).toEqual(['article_lowercase']);
    expect(rowWarnings({ ...row, german: 'Apfel' })).toEqual([]);
    expect(rowWarnings({ ...row, article: '' })).toEqual([]);
  });

  it('clears a split word once the word is whole', () => {
    const row = draft('1', 'Kranken haus', 'das', 'hastane', { flags: ['wrapped_word'] });
    expect(rowWarnings(row)).toEqual(['wrapped_word']);
    expect(rowWarnings({ ...row, german: 'Krankenhaus' })).toEqual([]);
  });

  it('reports several warnings for one row, and accepting one leaves the other', () => {
    const row = draft('1', 'Kranken haus', '', 'hastane', { flags: ['wrapped', 'wrapped_word', 'article_missing'] });
    expect(rowWarnings(row)).toEqual(['article_missing', 'wrapped_word']);
    expect(rowWarnings({ ...row, dismissed: ['article_missing'] })).toEqual(['wrapped_word']);
  });

  it('asks nothing about an excluded row', () => {
    expect(rowWarnings(flagged(['article_missing'], { excluded: true }))).toEqual([]);
  });

  it('treats successful repairs as history, never as a warning', () => {
    const row = draft('1', 'Krankenhaus', 'das', 'hastane', { flags: ['wrapped', 'dehyphenated'] });
    expect(rowWarnings(row)).toEqual([]);
    expect(rowCorrections(row)).toEqual(['wrapped', 'dehyphenated']);
  });

  it('does not block saving', () => {
    const [row] = reviewRows([flagged(['article_missing'])], []);
    expect(needsAttention(row!.status)).toBe(false);
  });

  it('counts accepting a warning as an edit', () => {
    const start = [flagged(['article_missing'])];
    expect(countEditedRows(start, [{ ...start[0]!, dismissed: ['article_missing'] }])).toBe(1);
  });
});

