import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { blankDraft, rowRef, SEPARATE, type ImportDraft } from '../src/core/review';
import { createBackup, exportBackupText, parseBackup, restoreBackup } from '../src/data/backup';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { addWordsToGroup, createCustomGroup, deleteGroups, deleteGroupsWithWords, GroupNameError, previewGroupDeletion, ProtectedGroupError, removeWordFromGroup, renameCustomGroup, restoreGroupMember, setWordCustomGroups } from '../src/data/groups';
import { commitImport, ImportNotReadyError, TEXT_PIPELINE_VERSION, type ImportTarget } from '../src/data/importCommit';
import { getActiveWord, getGroupWithWords, listActiveWords, listGroupsOfWord, listGroupSummaries, listSourcesOfWord } from '../src/data/repository';
import { saveReview } from '../src/data/smartReview';
import { addWord, deleteWord, DuplicateWordError, setFavorite, updateWord, WordNotFoundError } from '../src/data/words';
import { T0, uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

const open: AppDatabase[] = [];
async function fresh(): Promise<AppDatabase> {
  const db = await openDatabase({ name: uniqueDbName() });
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

const entry = (lemma: string, article: 'der' | 'die' | 'das' | null, ...meanings: string[]) => ({ lemma, article, meanings, plural: null });

async function save(db: AppDatabase, ...args: Parameters<typeof entry>) {
  const outcome = await addWord(db, entry(...args), null, [], T0);
  if (outcome.kind !== 'saved') throw new Error('expected a save');
  return outcome.word;
}

/** Everything a word's learning history is made of. */
const history = async (db: AppDatabase, wordId: string) => ({
  cards: await db.cards.where('[wordId+track]').between([wordId, ''], [wordId, '￿']).toArray(),
  logs: await db.reviewLogs.where('wordId').equals(wordId).toArray(),
});

describe('creating words', () => {
  it('stores article and lemma separately, with a stable id', async () => {
    const db = await fresh();
    const word = await save(db, 'Apfel', 'der', 'elma');
    expect(word).toMatchObject({ lemma: 'Apfel', article: 'der', pos: 'noun', identityKey: 'Apfel|der', meanings: [{ text: 'elma', note: null }], deletedAt: null });
    expect(word.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await getActiveWord(db, word.id)).toEqual(word);
  });

  it('does not assume a word is a noun', async () => {
    const db = await fresh();
    expect((await save(db, 'schnell', null, 'hızlı')).pos).toBe('other');
    expect((await save(db, 'guten Tag', null, 'iyi günler')).pos).toBe('phrase');
  });

  it('keeps essen and das Essen as two records', async () => {
    const db = await fresh();
    const noun = await save(db, 'Essen', 'das', 'yemek');
    const verb = await save(db, 'essen', null, 'yemek yemek');
    expect(noun.id).not.toBe(verb.id);
    expect((await listActiveWords(db)).length).toBe(2);
  });

  it('refuses a duplicate and writes nothing until told what to do', async () => {
    const db = await fresh();
    const apple = await save(db, 'Apfel', 'der', 'elma');
    const outcome = await addWord(db, entry('Apfel', 'der', 'elma'), null, [], T0 + 1);
    expect(outcome).toMatchObject({ kind: 'conflict', found: { kind: 'existing', entry: { ref: apple.id }, newMeanings: [] } });
    expect(await db.words.count()).toBe(1);
    expect((await db.words.get(apple.id))?.updatedAt).toBe(T0);
  });

  it('joins an existing word when asked, adding the new meaning', async () => {
    const db = await fresh();
    const apple = await save(db, 'Apfel', 'der', 'elma');
    await addWord(db, entry('Apfel', 'der', 'elma', 'alma'), apple.id, [], T0);
    expect((await db.words.get(apple.id))?.meanings.map((m) => m.text)).toEqual(['elma', 'alma']);
    expect(await db.words.count()).toBe(1);
  });

  it('keeps a real homonym as a separate word through a sense tag', async () => {
    const db = await fresh();
    await save(db, 'Bank', 'die', 'banka');
    expect((await addWord(db, entry('Bank', 'die', 'sıra'), null, [], T0)).kind).toBe('conflict');
    const outcome = await addWord(db, entry('Bank', 'die', 'sıra'), SEPARATE, [], T0);
    expect(outcome).toMatchObject({ kind: 'saved', word: { senseTag: 'sıra', identityKey: 'Bank|die|sıra' } });
    expect((await listActiveWords(db)).length).toBe(2);
  });

  it('does not create a word when a chosen collection fails', async () => {
    const db = await fresh();
    const failing = () => {
      throw new Error('disk full');
    };
    const group = await createCustomGroup(db, 'Zor', T0);
    db.groupMembers.hook('creating', failing);
    await expect(addWord(db, entry('Apfel', 'der', 'elma'), null, [group.id], T0)).rejects.toThrow('disk full');
    db.groupMembers.hook('creating').unsubscribe(failing);
    expect(await db.words.count()).toBe(0);
  });

  it('assigns the chosen custom lists, and ignores protected ones', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const outcome = await addWord(db, entry('Birne', 'die', 'armut'), null, ['g-custom', 'g-pdf'], T0);
    if (outcome.kind !== 'saved') throw new Error('expected a save');
    expect((await listGroupsOfWord(db, outcome.word.id)).map((g) => g.id)).toEqual(['g-custom']);
  });
});

describe('editing words', () => {
  it('keeps the id and the whole learning history', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = await history(db, 'w-apfel');
    expect(before.logs.length).toBeGreaterThan(0);
    const updated = await updateWord(db, 'w-apfel', entry('Äpfelchen', 'das', 'elmacık'), T0 + 5);
    expect(updated).toMatchObject({ id: 'w-apfel', lemma: 'Äpfelchen', article: 'das', identityKey: 'Äpfelchen|das', createdAt: T0, updatedAt: T0 + 5 });
    const after = await history(db, 'w-apfel');
    expect(after.logs).toEqual(before.logs);
    // Word, meaning and article all changed, so this is now a different word to remember.
    expect(after.cards).toEqual([]);
  });

  it('keeps memberships, favorites and notes on meanings that stay', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await setFavorite(db, 'w-apfel', true, T0 + 1);
    await db.words.update('w-apfel', { meanings: [{ text: 'elma', note: 'meyve' }] });
    const updated = await updateWord(db, 'w-apfel', entry('Apfel', 'der', 'Elma', 'alma'), T0 + 2);
    expect(updated.favoritedAt).toBe(T0 + 1);
    expect(updated.meanings).toEqual([{ text: 'Elma', note: 'meyve' }, { text: 'alma', note: null }]);
    expect((await listGroupsOfWord(db, 'w-apfel')).map((g) => g.id)).toEqual(['g-pdf', 'g-custom']);
  });

  it('refuses to take the identity of another active word', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const error = await updateWord(db, 'w-fuss', entry('Apfel', 'der', 'x'), T0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateWordError);
    expect((error as DuplicateWordError).existing.id).toBe('w-apfel');
    expect((await db.words.get('w-fuss'))?.lemma).toBe('Fuß');
  });

  it('takes the identity of a word marked deleted by an older version, which is removed for good', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await db.words.update('w-apfel', { deletedAt: T0 });
    await updateWord(db, 'w-fuss', entry('Apfel', 'der', 'elma'), T0);
    expect((await db.words.get('w-fuss'))?.identityKey).toBe('Apfel|der');
    expect(await db.words.get('w-apfel')).toBeUndefined();
    expect(await history(db, 'w-apfel')).toEqual({ cards: [], logs: [] });
  });

  it('refuses a missing or deleted word', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await deleteWord(db, 'w-fuss');
    await expect(updateWord(db, 'w-fuss', entry('a', null, 'b'), T0)).rejects.toBeInstanceOf(WordNotFoundError);
    await expect(updateWord(db, 'nope', entry('a', null, 'b'), T0)).rejects.toBeInstanceOf(WordNotFoundError);
  });
});

describe('favorites', () => {
  it('marks and unmarks', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await setFavorite(db, 'w-apfel', true, T0 + 1);
    expect((await db.words.get('w-apfel'))?.favoritedAt).toBe(T0 + 1);
    expect((await db.words.where('favoritedAt').above(0).primaryKeys())).toEqual(['w-apfel']);
    await setFavorite(db, 'w-apfel', false, T0 + 2);
    expect((await db.words.get('w-apfel'))?.favoritedAt).toBeNull();
  });
});

describe('deleting words', () => {
  it('removes the word and everything that exists only because of it', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await deleteWord(db, 'w-apfel');
    expect(await db.words.get('w-apfel')).toBeUndefined();
    expect((await listActiveWords(db)).map((w) => w.id)).not.toContain('w-apfel');
    expect((await getGroupWithWords(db, 'g-custom'))?.words).toEqual([]);
    expect((await listGroupSummaries(db)).map((s) => s.wordCount)).toEqual([0, 0]);
    expect(await history(db, 'w-apfel')).toEqual({ cards: [], logs: [] });
    expect(await db.groupMembers.where('wordId').equals('w-apfel').count()).toBe(0);
    expect(await db.importRows.filter((row) => row.wordId === 'w-apfel').count()).toBe(0);
    expect(await listSourcesOfWord(db, 'w-apfel')).toEqual([]);
  });

  it('stops counting its cards as due', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const due = () => db.cards.where('due').belowOrEqual(T0 + 2 * 86_400_000).count();
    const before = await due();
    await deleteWord(db, 'w-fuss');
    expect(await due()).toBe(before - 1);
  });

  it('adding the same word again makes a fresh record with no history', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await deleteWord(db, 'w-apfel');
    const outcome = await addWord(db, entry('Apfel', 'der', 'kırmızı elma'), null, [], T0 + 10);
    if (outcome.kind !== 'saved') throw new Error('not saved');
    expect(outcome.word.id).not.toBe('w-apfel');
    expect(outcome.word).toMatchObject({ deletedAt: null, createdAt: T0 + 10, favoritedAt: null });
    expect(await history(db, outcome.word.id)).toEqual({ cards: [], logs: [] });
    expect(await db.words.count()).toBe(5);
  });

  it('a deleted word does not make a new entry ambiguous', async () => {
    const db = await fresh();
    const word = await save(db, 'See', 'der', 'göl');
    await deleteWord(db, word.id);
    expect((await addWord(db, entry('See', 'die', 'deniz'), null, [], T0)).kind).toBe('saved');
  });
});

describe('custom collections', () => {
  it('creates, renames and refuses bad names', async () => {
    const db = await fresh();
    const group = await createCustomGroup(db, '  Zor   kelimeler ', T0);
    expect(group).toMatchObject({ kind: 'custom', name: 'Zor kelimeler', sourceId: null });
    await expect(createCustomGroup(db, 'ZOR KELİMELER', T0).catch((e: GroupNameError) => e.problem)).resolves.toBe('taken');
    await expect(createCustomGroup(db, 'zor kelimeler', T0).catch((e: GroupNameError) => e.problem)).resolves.toBe('taken');
    await expect(createCustomGroup(db, '   ', T0).catch((e: GroupNameError) => e.problem)).resolves.toBe('empty');
    await expect(createCustomGroup(db, 'x'.repeat(81), T0).catch((e: GroupNameError) => e.problem)).resolves.toBe('too_long');
    await renameCustomGroup(db, group.id, 'Kolay');
    expect((await db.groups.get(group.id))?.name).toBe('Kolay');
    await renameCustomGroup(db, group.id, 'kolay');
    expect((await db.groups.get(group.id))?.name).toBe('kolay');
  });

  it('a word can sit in several lists as one record, counted correctly', async () => {
    const db = await fresh();
    const word = await save(db, 'Apfel', 'der', 'elma');
    const [a, b] = [await createCustomGroup(db, 'A', T0), await createCustomGroup(db, 'B', T0)];
    await addWordsToGroup(db, a.id, [word.id], T0);
    await addWordsToGroup(db, b.id, [word.id, word.id], T0);
    expect(await db.words.count()).toBe(1);
    expect((await listGroupSummaries(db)).map((s) => s.wordCount)).toEqual([1, 1]);
    expect((await listGroupsOfWord(db, word.id)).map((g) => g.name)).toEqual(['A', 'B']);
  });

  it('removing from one list leaves other lists, the word and its history', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const second = await createCustomGroup(db, 'İkinci', T0);
    await addWordsToGroup(db, second.id, ['w-apfel'], T0);
    const before = await history(db, 'w-apfel');
    await removeWordFromGroup(db, 'g-custom', 'w-apfel');
    expect((await listGroupsOfWord(db, 'w-apfel')).map((g) => g.id)).toEqual(['g-pdf', second.id]);
    expect(await getActiveWord(db, 'w-apfel')).not.toBeNull();
    expect(await history(db, 'w-apfel')).toEqual(before);
  });

  it('undoing a removal restores the exact membership', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = await db.groupMembers.get(['g-custom', 'w-apfel']);
    const removed = await removeWordFromGroup(db, 'g-custom', 'w-apfel');
    await restoreGroupMember(db, removed!);
    expect(await db.groupMembers.get(['g-custom', 'w-apfel'])).toEqual(before);
  });

  it('deleting a list removes memberships only', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const words = await db.words.toArray();
    const cards = await db.cards.toArray();
    const logs = await db.reviewLogs.toArray();
    const rows = await db.importRows.toArray();
    const sources = await db.sources.toArray();
    await deleteGroups(db, ['g-custom']);
    expect(await db.groups.get('g-custom')).toBeUndefined();
    expect(await db.groupMembers.filter((member) => member.groupId === 'g-custom').count()).toBe(0);
    expect(await db.words.toArray()).toEqual(words);
    expect(await db.cards.toArray()).toEqual(cards);
    expect(await db.reviewLogs.toArray()).toEqual(logs);
    expect(await db.importRows.toArray()).toEqual(rows);
    expect(await db.sources.toArray()).toEqual(sources);
    expect(await db.groupMembers.get(['g-pdf', 'w-apfel'])).toBeTruthy();
  });

  it('deleting a source collection removes memberships only, and its source stays', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const words = await db.words.toArray();
    const rows = await db.importRows.toArray();
    const sources = await db.sources.toArray();
    await deleteGroups(db, ['g-pdf']);
    expect(await db.groups.get('g-pdf')).toBeUndefined();
    expect(await db.groupMembers.filter((member) => member.groupId === 'g-pdf').count()).toBe(0);
    expect(await db.groupMembers.get(['g-custom', 'w-apfel'])).toBeTruthy();
    expect(await db.words.toArray()).toEqual(words);
    expect(await db.importRows.toArray()).toEqual(rows);
    expect(await db.sources.toArray()).toEqual(sources);
  });

  it('a delete that fails partway changes nothing', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const failing = (key: string) => {
      if (key === 'g-custom') throw new Error('disk full');
    };
    db.groups.hook('deleting', failing);
    await expect(deleteGroups(db, ['g-pdf', 'g-custom'])).rejects.toThrow('disk full');
    db.groups.hook('deleting').unsubscribe(failing);
    expect(await db.groups.get('g-pdf')).toBeTruthy();
    expect(await db.groupMembers.get(['g-pdf', 'w-apfel'])).toBeTruthy();
    expect(await db.groupMembers.get(['g-custom', 'w-apfel'])).toBeTruthy();
  });

  it('counts words as their own only when no other collection holds them', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await addWordsToGroup(db, 'g-custom', ['w-fuss'], T0);
    expect(await previewGroupDeletion(db, ['g-custom'])).toEqual({ ownWordIds: ['w-fuss'], sharedCount: 1 });
    const both = await previewGroupDeletion(db, ['g-custom', 'g-pdf']);
    expect(both.ownWordIds.sort()).toEqual(['w-apfel', 'w-fuss']);
    expect(both.sharedCount).toBe(0);
  });

  it('deleting with words removes own words and everything of theirs, and nothing else', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await addWordsToGroup(db, 'g-custom', ['w-fuss'], T0);
    const others = (await db.words.toArray()).filter((word) => word.id !== 'w-fuss');
    const { ownWordIds } = await previewGroupDeletion(db, ['g-custom']);
    await deleteGroupsWithWords(db, ['g-custom'], ownWordIds);
    expect(await db.words.toArray()).toEqual(others);
    expect(await db.cards.where('wordId').equals('w-fuss').count()).toBe(0);
    expect(await db.cards.where('wordId').equals('w-apfel').count()).toBe(2);
    expect(await db.groups.get('g-custom')).toBeUndefined();
    expect(await db.groupMembers.get(['g-pdf', 'w-apfel'])).toBeTruthy();
    expect(await db.importRows.get('r1')).toBeTruthy();
  });

  it('a word not shown, or one that joined another list since, is never deleted', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await addWordsToGroup(db, 'g-custom', ['w-fuss', 'w-morgen'], T0);
    const { ownWordIds } = await previewGroupDeletion(db, ['g-custom']);
    const later = await createCustomGroup(db, 'Sonra', T0);
    await addWordsToGroup(db, later.id, ['w-fuss'], T0);
    await deleteGroupsWithWords(db, ['g-custom'], ownWordIds.filter((id) => id !== 'w-morgen').concat('w-spinat'));
    expect(await db.words.get('w-fuss')).toBeTruthy();
    expect(await db.words.get('w-morgen')).toBeTruthy();
    expect(await db.words.get('w-spinat')).toBeTruthy();
    expect(await db.groups.get('g-custom')).toBeUndefined();
  });

  it('deleting with words rolls back completely when any step fails', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = { words: await db.words.toArray(), cards: await db.cards.toArray(), logs: await db.reviewLogs.toArray(), rows: await db.importRows.toArray(), groups: await db.groups.toArray(), members: await db.groupMembers.toArray() };
    const failing = () => {
      throw new Error('disk full');
    };
    db.groups.hook('deleting', failing);
    await expect(deleteGroupsWithWords(db, ['g-pdf', 'g-custom'], ['w-apfel'])).rejects.toThrow('disk full');
    db.groups.hook('deleting').unsubscribe(failing);
    expect({ words: await db.words.toArray(), cards: await db.cards.toArray(), logs: await db.reviewLogs.toArray(), rows: await db.importRows.toArray(), groups: await db.groups.toArray(), members: await db.groupMembers.toArray() }).toEqual(before);
  });

  it('a missing collection is passed over, so another tab having deleted it first is no error', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await deleteGroups(db, ['gone', 'g-custom']);
    expect(await db.groups.get('g-custom')).toBeUndefined();
  });

  it('protects source collections from every edit', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await expect(renameCustomGroup(db, 'g-pdf', 'x')).rejects.toBeInstanceOf(ProtectedGroupError);
    await expect(addWordsToGroup(db, 'g-pdf', ['w-fuss'], T0)).rejects.toBeInstanceOf(ProtectedGroupError);
    await expect(removeWordFromGroup(db, 'g-pdf', 'w-apfel')).rejects.toBeInstanceOf(ProtectedGroupError);
    await expect(setWordCustomGroups(db, 'w-apfel', ['g-pdf'], T0)).rejects.toBeInstanceOf(ProtectedGroupError);
    expect(await db.groupMembers.get(['g-pdf', 'w-apfel'])).toMatchObject({ importRowId: 'r1' });
  });

  it('setting a word\'s lists leaves source memberships alone', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const second = await createCustomGroup(db, 'İkinci', T0);
    await setWordCustomGroups(db, 'w-apfel', [second.id], T0 + 1);
    expect((await listGroupsOfWord(db, 'w-apfel')).map((g) => g.id)).toEqual(['g-pdf', second.id]);
    await setWordCustomGroups(db, 'w-apfel', [], T0 + 1);
    expect((await listGroupsOfWord(db, 'w-apfel')).map((g) => g.id)).toEqual(['g-pdf']);
  });
});

describe('committing an import', () => {
  const source = { fileName: 'liste.csv', fileHash: 'hash-a', pipelineVersion: TEXT_PIPELINE_VERSION };
  const draft = (id: string, german: string, article: string, turkish: string, extra: Partial<ImportDraft> = {}) => blankDraft(id, Number(id), { german, article, turkish, ...extra });
  const commit = (db: AppDatabase, drafts: ImportDraft[], target: ImportTarget = { kind: 'none' }, fileHash = 'hash-a') => commitImport(db, { source: { ...source, fileHash }, drafts, target }, T0);

  it('creates new words, links existing ones and records the source', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = await history(db, 'w-apfel');
    const summary = await commit(db, [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Apfel', 'der', 'elma, alma'), draft('3', 'x', '', '', { excluded: true })]);
    expect(summary).toMatchObject({ rows: 3, created: 1, existing: 1, repeats: 0, linked: 1, meaningsAdded: 1, excluded: 0, invalid: 1, group: null });
    expect(await db.words.where('identityKey').equals('Apfel|der').count()).toBe(1);
    expect((await db.words.get('w-apfel'))?.meanings.map((m) => m.text)).toEqual(['elma', 'alma']);
    expect(await history(db, 'w-apfel')).toEqual(before);
    expect((await listSourcesOfWord(db, 'w-apfel')).map((s) => s.fileName).sort()).toEqual(['bolum-1.pdf', 'liste.csv']);
    const rows = await db.importRows.filter((row) => row.german === 'Birne').toArray();
    expect(rows[0]).toMatchObject({ decision: 'new', article: 'die', turkish: 'armut', rowIndex: 1, page: 0 });
    expect(await db.importRows.filter((row) => row.decision === 'skipped').count()).toBe(1);
  });

  it('makes one record for repeats in a batch, keeping every meaning', async () => {
    const db = await fresh();
    const summary = await commit(db, [draft('1', 'Apfel', 'der', 'elma'), draft('2', 'Apfel', 'der', 'elma, alma')]);
    expect(summary).toMatchObject({ rows: 2, created: 1, existing: 0, repeats: 1, linked: 0 });
    expect((await listActiveWords(db)).map((w) => w.meanings.map((m) => m.text))).toEqual([['elma', 'alma']]);
  });

  it('applies answers to ambiguous rows', async () => {
    const db = await fresh();
    const bank = await save(db, 'Bank', 'die', 'banka');
    const see = await save(db, 'See', 'der', 'göl');
    const summary = await commit(db, [draft('1', 'Bank', 'die', 'sıra', { choice: SEPARATE }), draft('2', 'See', 'die', 'deniz', { choice: SEPARATE }), draft('3', 'Bank', 'die', 'kurum', { choice: bank.id })]);
    expect(summary).toMatchObject({ created: 2, existing: 1, repeats: 0, linked: 1, meaningsAdded: 1 });
    expect((await db.words.get(bank.id))?.meanings.map((m) => m.text)).toEqual(['banka', 'kurum']);
    expect((await db.words.get(see.id))?.meanings.map((m) => m.text)).toEqual(['göl']);
    expect((await listActiveWords(db)).length).toBe(4);
  });

  it('joins a batch row when asked', async () => {
    const db = await fresh();
    const summary = await commit(db, [draft('1', 'Bank', 'die', 'banka'), draft('2', 'Bank', 'die', 'sıra', { choice: rowRef('1') })]);
    expect(summary).toMatchObject({ created: 1, existing: 0, repeats: 1, linked: 0, meaningsAdded: 1 });
    expect((await listActiveWords(db))[0]?.meanings.map((m) => m.text)).toEqual(['banka', 'sıra']);
  });

  it('refuses unresolved or invalid rows and writes nothing', async () => {
    const db = await fresh();
    await save(db, 'Bank', 'die', 'banka');
    await expect(commit(db, [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Bank', 'die', 'sıra')])).rejects.toBeInstanceOf(ImportNotReadyError);
    await expect(commit(db, [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Elma', '', '')])).rejects.toBeInstanceOf(ImportNotReadyError);
    expect(await db.words.count()).toBe(1);
    expect(await db.sources.count()).toBe(0);
    expect(await db.importRows.count()).toBe(0);
  });

  it('judges again at commit time, so a stale review cannot duplicate', async () => {
    const db = await fresh();
    const drafts = [draft('1', 'Apfel', 'der', 'elma')];
    await save(db, 'Apfel', 'der', 'elma');
    expect(await commit(db, drafts)).toMatchObject({ created: 0, existing: 1, linked: 1 });
    expect(await db.words.count()).toBe(1);
  });

  it('rolls everything back when a write fails', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const before = await createBackup(db, T0);
    const failing = () => {
      throw new Error('disk full');
    };
    let calls = 0;
    const failSecond = () => {
      if (++calls === 2) failing();
    };
    db.importRows.hook('creating', failSecond);
    await expect(commit(db, [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Apfel', 'der', 'elma, alma'), draft('3', 'Kirsche', 'die', 'kiraz')], { kind: 'new_group', name: 'Yeni' })).rejects.toThrow('disk full');
    db.importRows.hook('creating').unsubscribe(failSecond);
    expect(await createBackup(db, T0)).toEqual(before);
  });

  it('puts words in a chosen or new list, without changing source collections', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const summary = await commit(db, [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Apfel', 'der', 'elma')], { kind: 'new_group', name: 'Meyveler' });
    expect(summary.group?.name).toBe('Meyveler');
    const opened = await getGroupWithWords(db, summary.group!.id);
    expect(opened?.words.map((w) => w.lemma)).toEqual(['Apfel', 'Birne']);
    expect(await db.groupMembers.get(['g-pdf', 'w-apfel'])).toMatchObject({ importRowId: 'r1' });
    const again = await commit(db, [draft('1', 'Kirsche', 'die', 'kiraz')], { kind: 'group', id: 'g-custom' }, 'hash-b');
    expect(again.group?.id).toBe('g-custom');
    await expect(commit(db, [draft('1', 'Pflaume', 'die', 'erik')], { kind: 'group', id: 'g-pdf' }, 'hash-c')).rejects.toBeInstanceOf(ImportNotReadyError);
    expect(await db.words.filter((w) => w.lemma === 'Pflaume').count()).toBe(0);
  });

  it('removing a word from a list keeps its source', async () => {
    const db = await fresh();
    const summary = await commit(db, [draft('1', 'Birne', 'die', 'armut')], { kind: 'new_group', name: 'Meyveler' });
    const [word] = await listActiveWords(db);
    await removeWordFromGroup(db, summary.group!.id, word!.id);
    expect((await listSourcesOfWord(db, word!.id)).map((s) => s.fileName)).toEqual(['liste.csv']);
    await deleteGroups(db, [summary.group!.id]);
    expect((await listSourcesOfWord(db, word!.id)).map((s) => s.fileName)).toEqual(['liste.csv']);
  });

  it('importing the same source twice reuses its record and adds no duplicates', async () => {
    const db = await fresh();
    const drafts = [draft('1', 'Birne', 'die', 'armut'), draft('2', 'Apfel', 'der', 'elma')];
    await commit(db, drafts);
    const again = await commit(db, drafts);
    expect(again).toMatchObject({ created: 0, existing: 2, linked: 0, sourceReused: true });
    expect(await db.sources.count()).toBe(1);
    expect(await db.importRows.count()).toBe(2);
    expect(await db.words.count()).toBe(2);
  });

  it('counts every row once: saved words, batch repeats, excluded and invalid stay apart', async () => {
    const db = await fresh();
    await seedLibrary(db);
    const summary = await commit(db, [
      draft('1', 'Apfel', 'der', 'elma'),
      draft('2', 'Apfel', 'der', 'elma'),
      draft('3', 'Birne', 'die', 'armut'),
      draft('4', 'Birne', 'die', 'armut'),
      draft('5', 'Kirsche', 'die', 'kiraz', { excluded: true }),
      draft('6', 'Pflaume', 'die', '', { excluded: true }),
    ]);
    expect(summary).toMatchObject({ rows: 6, created: 1, existing: 1, repeats: 2, excluded: 1, invalid: 1, linked: 1 });
    expect(summary.created + summary.existing + summary.repeats + summary.excluded + summary.invalid).toBe(summary.rows);
  });

  it('counts a saved word as linked only when it gains a source or a collection', async () => {
    const db = await fresh();
    const drafts = [draft('1', 'Apfel', 'der', 'elma')];
    await save(db, 'Apfel', 'der', 'elma');
    expect(await commit(db, drafts)).toMatchObject({ existing: 1, linked: 1 });
    expect(await commit(db, drafts)).toMatchObject({ existing: 1, linked: 0 });
    expect(await commit(db, drafts, { kind: 'new_group', name: 'Meyveler' })).toMatchObject({ existing: 1, linked: 1 });
  });

  it('keeps every place a word is listed in, without doubling them on a second import', async () => {
    const db = await fresh();
    const drafts = [draft('1', 'Apfel', 'der', 'elma'), draft('2', 'Apfel', 'der', 'elma')];
    await commit(db, drafts);
    expect((await db.importRows.toArray()).map((row) => row.rowIndex).sort()).toEqual([1, 2]);
    await commit(db, drafts);
    expect(await db.importRows.count()).toBe(2);
  });

  it('makes a fresh word from a deleted one, with no history, instead of colliding', async () => {
    const db = await fresh();
    await seedLibrary(db);
    await deleteWord(db, 'w-apfel');
    expect(await commit(db, [draft('1', 'Apfel', 'der', 'elma')])).toMatchObject({ created: 1 });
    const again = (await listActiveWords(db)).find((word) => word.lemma === 'Apfel')!;
    expect(again.id).not.toBe('w-apfel');
    expect(await history(db, again.id)).toEqual({ cards: [], logs: [] });
  });

  it('keeps German and Turkish characters exactly', async () => {
    const db = await fresh();
    await commit(db, [draft('1', 'Größe', 'die', 'büyüklük, ıspanak, İnce')]);
    const [word] = await listActiveWords(db);
    expect(word).toMatchObject({ lemma: 'Größe', meanings: [{ text: 'büyüklük' }, { text: 'ıspanak' }, { text: 'İnce' }] });
  });
});

describe('collections, sources and warnings in backups', () => {
  it('survives a full round trip with history, and the restored data still behaves', async () => {
    const source = await fresh();
    await seedLibrary(source);
    await setFavorite(source, 'w-apfel', true, T0 + 1);
    const list = await createCustomGroup(source, 'Şık kelimeler', T0);
    const bank = await save(source, 'Bank', 'die', 'banka');
    await addWord(source, entry('Bank', 'die', 'sıra'), SEPARATE, [list.id], T0);
    await commitImport(source, { source: { fileName: '', fileHash: 'paste-1', pipelineVersion: 1 }, drafts: [blankDraft('1', 0, { german: 'Größe', article: 'die', turkish: 'boy' }), blankDraft('2', 1, { german: 'Apfel', article: 'der', turkish: 'elma, alma' })], target: { kind: 'group', id: list.id } }, T0);
    await deleteWord(source, 'w-fuss');

    const before = await createBackup(source, T0);
    const parsed = parseBackup(await exportBackupText(source, T0));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const target = await fresh();
    await restoreBackup(target, parsed.backup);
    const after = await createBackup(target, T0);

    for (const table of ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows'] as const) expect(after.tables[table], table).toEqual(before.tables[table]);

    expect((await target.words.get('w-apfel'))?.favoritedAt).toBe(T0 + 1);
    expect((await target.words.get(bank.id))?.article).toBe('die');
    expect(await target.words.get('w-fuss')).toBeUndefined();
    expect((await listSourcesOfWord(target, 'w-apfel')).map((s) => s.fileName).sort()).toEqual(['', 'bolum-1.pdf']);
    const again = await addWord(target, entry('Fuß', 'der', 'ayak'), null, [], T0);
    if (again.kind !== 'saved') throw new Error('not saved');
    await saveReview(target, { word: again.word, track: 'tr_de', expected: null, typed: 'ayak', result: 'correct', correct: true, hinted: false, at: T0, sessionId: 's1', retry: false });
    expect(await target.reviewLogs.where('wordId').equals(again.word.id).count()).toBe(1);
  });

  it('accepts an older backup without those records', async () => {
    const source = await fresh();
    await seedLibrary(source);
    const parsed = parseBackup(await exportBackupText(source, T0));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = await fresh();
    await restoreBackup(target, parsed.backup);
    // The seed was never saved by the current code, like a backup from an older version.
    expect((await updateWord(target, 'w-apfel', entry('Apfel', 'der', 'elma'), T0)).id).toBe('w-apfel');
  });
});

describe('sorting', () => {
  it('is alphabetical in German and stable for equal spellings', async () => {
    const db = await fresh();
    await save(db, 'Zebra', 'das', 'zebra');
    await save(db, 'Äpfel', null, 'elmalar');
    await save(db, 'See', 'die', 'deniz');
    await addWord(db, entry('See', 'der', 'göl'), SEPARATE, [], T0);
    await save(db, 'Apfel', 'der', 'elma');
    const list = await listActiveWords(db);
    expect(list.map((w) => `${w.article ?? ''} ${w.lemma}`.trim())).toEqual(['der Apfel', 'Äpfel', 'der See', 'die See', 'das Zebra']);
  });
});
