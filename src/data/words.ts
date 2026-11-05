import Dexie from 'dexie';
import { classifyEntry, indexKnown, SEPARATE, type Classification, type KnownEntry } from '../core/review';
import { newId } from '../core/id';
import { affectedTracks } from '../core/scheduling/invalidation';
import { fieldsFor, meaningKey, type WordDraft } from '../core/vocabulary';
import type { AppDatabase } from './db';
import type { Meaning, Word } from './types';

export class WordNotFoundError extends Error {
  override readonly name = 'WordNotFoundError';
}

/** Another active word already has this identity. Nothing was changed. */
export class DuplicateWordError extends Error {
  override readonly name = 'DuplicateWordError';
  constructor(readonly existing: Word) {
    super(`Duplicate of ${existing.id}`);
  }
}

export const knownEntryOf = (word: Word): KnownEntry => ({ ref: word.id, lemma: word.lemma, article: word.article, meanings: word.meanings.map((meaning) => meaning.text) });

const toMeanings = (texts: readonly string[], previous: readonly Meaning[] = []): Meaning[] => {
  const notes = new Map(previous.map((meaning) => [meaningKey(meaning.text), meaning.note]));
  return texts.map((text) => ({ text, note: notes.get(meaningKey(text)) ?? null }));
};

/** Adds meanings to a word without touching anything else. */
export function withMeanings(word: Word, added: readonly string[], now: number): Word {
  const known = new Set(word.meanings.map((meaning) => meaningKey(meaning.text)));
  const fresh = added.filter((text) => !known.has(meaningKey(text)));
  if (fresh.length === 0) return word;
  const meanings = [...word.meanings, ...toMeanings(fresh)];
  const draft: WordDraft = { lemma: word.lemma, article: word.article, plural: word.plural, meanings: meanings.map((meaning) => meaning.text) };
  return { ...word, meanings, searchTokens: fieldsFor(draft, word.senseTag, word.pos).searchTokens, updatedAt: now };
}

/**
 * Removes a word and everything that exists only because of it, inside the caller's transaction.
 * Groups and sources stay, because they do not belong to one word; neither do accepted dictionary
 * warnings, which are about a text and may apply to another word or a later import.
 */
export async function purgeWords(db: AppDatabase, ids: readonly string[]): Promise<void> {
  const removed = new Set<string | null>(ids);
  // Import rows have no index on the word, so they are gone through once rather than once per word.
  await db.importRows.filter((row) => removed.has(row.wordId)).delete();
  for (const id of ids) {
    await db.cards.where('[wordId+track]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
    await db.reviewLogs.where('wordId').equals(id).delete();
    await db.groupMembers.where('wordId').equals(id).delete();
    await db.words.delete(id);
  }
}

const purgeWord = (db: AppDatabase, id: string) => purgeWords(db, [id]);

/** The tables purgeWord writes to, for transactions that may need it. */
export const wordTables = (db: AppDatabase) => [db.words, db.cards, db.reviewLogs, db.groupMembers, db.importRows];

/**
 * Words hidden by earlier versions of the app, which only marked them as deleted. A marked word was
 * deleted by the person, so it goes the same way as any other. Safe to run again at any time.
 */
export async function purgeMarkedWords(db: AppDatabase): Promise<number> {
  return db.transaction('rw', wordTables(db), async () => {
    const ids = await db.words.where('deletedAt').above(-1).primaryKeys();
    for (const id of ids) await purgeWord(db, id);
    return ids.length;
  });
}

/**
 * Creates a word inside the caller's transaction, which must include the tables purgeWord uses. Words
 * start with no history. If an active word holds the identity, the first meaning becomes a sense tag
 * and the two stay separate.
 */
export async function insertWord(db: AppDatabase, draft: WordDraft, now: number): Promise<Word> {
  let fields = fieldsFor(draft, null);
  let holder = await db.words.where('identityKey').equals(fields.identityKey).first();
  if (holder && holder.deletedAt === null) {
    fields = fieldsFor(draft, draft.meanings[0] ?? null);
    holder = await db.words.where('identityKey').equals(fields.identityKey).first();
    if (holder && holder.deletedAt === null) throw new DuplicateWordError(holder);
  }
  if (holder) await purgeWord(db, holder.id);
  const word: Word = { ...fields, id: newId(), meanings: toMeanings(draft.meanings), favoritedAt: null, createdAt: now, updatedAt: now, deletedAt: null };
  await db.words.add(word);
  return word;
}

export type AddOutcome = { kind: 'saved'; word: Word } | { kind: 'conflict'; found: Exclude<Classification, { kind: 'new' }> };

/**
 * Saves a manual entry, or reports what it collides with and writes nothing. Pass the person's
 * answer as choice: SEPARATE, or the id of the word to join. Runs in one transaction with the
 * collection choice, so a word never appears without the collections asked for.
 */
export async function addWord(db: AppDatabase, draft: WordDraft, choice: string | null, groupIds: readonly string[], now: number): Promise<AddOutcome> {
  return db.transaction('rw', [...wordTables(db), db.groups], async (): Promise<AddOutcome> => {
    const active = await db.words.filter((word) => word.deletedAt === null).toArray();
    const found = classifyEntry(draft.lemma, draft.article, draft.meanings, indexKnown(active.map(knownEntryOf)));

    let word: Word;
    if (found.kind === 'new' || (found.kind === 'ambiguous' && choice === SEPARATE)) {
      word = await insertWord(db, draft, now);
    } else {
      const target = found.kind === 'existing' ? (choice === found.entry.ref ? found.entry.ref : null) : found.candidates.find((entry) => entry.ref === choice)?.ref ?? null;
      const existing = target ? active.find((candidate) => candidate.id === target) : undefined;
      if (!existing) return { kind: 'conflict', found };
      word = withMeanings(existing, draft.meanings, now);
      if (word !== existing) await db.words.put(word);
    }

    for (const groupId of groupIds) {
      const group = await db.groups.get(groupId);
      if (group?.kind !== 'custom') continue;
      if (!(await db.groupMembers.get([groupId, word.id]))) await db.groupMembers.add({ groupId, wordId: word.id, addedAt: now, importRowId: null });
    }
    return { kind: 'saved', word };
  });
}

/**
 * Changes what a word says, never what it is: the id stays and review history is kept. Schedules
 * measuring memory of an answer that is no longer right are removed in the same transaction, and
 * those skills start again as new. affectedTracks holds the rules.
 */
export async function updateWord(db: AppDatabase, id: string, draft: WordDraft, now: number): Promise<Word> {
  return db.transaction('rw', wordTables(db), async () => {
    const word = await db.words.get(id);
    if (!word || word.deletedAt !== null) throw new WordNotFoundError(id);
    const fields = fieldsFor(draft, word.senseTag, word.pos);
    const holder = await db.words.where('identityKey').equals(fields.identityKey).first();
    if (holder && holder.id !== id) {
      if (holder.deletedAt === null) throw new DuplicateWordError(holder);
      await purgeWord(db, holder.id);
    }
    const updated: Word = { ...word, ...fields, meanings: toMeanings(draft.meanings, word.meanings), updatedAt: now };
    await db.words.put(updated);
    for (const track of affectedTracks(word, updated)) await db.cards.delete([id, track]);
    return updated;
  });
}

export async function setFavorite(db: AppDatabase, id: string, favorite: boolean, now: number): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(id);
    if (!word || word.deletedAt !== null) throw new WordNotFoundError(id);
    await db.words.put({ ...word, favoritedAt: favorite ? now : null, updatedAt: now });
  });
}

/** Permanent and atomic: the word and its learning data are all gone, or nothing changed. Only a restored backup can bring it back. */
/** Permanently removes several words, all or none. One already gone is passed over. */
export async function deleteWords(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await db.transaction('rw', wordTables(db), () => purgeWords(db, ids));
}

export async function deleteWord(db: AppDatabase, id: string): Promise<void> {
  await db.transaction('rw', wordTables(db), async () => {
    if (!(await db.words.get(id))) throw new WordNotFoundError(id);
    await purgeWord(db, id);
  });
}
