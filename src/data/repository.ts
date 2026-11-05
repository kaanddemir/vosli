import Dexie from 'dexie';
import type { AppDatabase } from './db';
import type { Group, PracticeLog, Source, Word } from './types';

/**
 * Records a Free Practice attempt. The transaction does not include cards, so this cannot change
 * scheduled state: Dexie rejects any write outside the declared tables. A word deleted while its
 * question was on screen gets no entry, because history must not outlive its word.
 */
export async function recordPracticeAttempt(db: AppDatabase, attempt: Omit<PracticeLog, 'mode' | 'seq'>): Promise<void> {
  await db.transaction('rw', db.words, db.reviewLogs, async () => {
    const word = await db.words.get(attempt.wordId);
    if (word && word.deletedAt === null) await db.reviewLogs.add({ ...attempt, mode: 'practice' });
  });
}

export async function getLastBackupAt(db: AppDatabase): Promise<number | null> {
  const entry = await db.meta.get('lastBackupAt');
  return typeof entry?.value === 'number' ? entry.value : null;
}

const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

/** True once there is something to lose and no backup in the last 7 days. */
export function isBackupDue(wordCount: number, lastBackupAt: number | null, now: number): boolean {
  if (wordCount === 0) return false;
  return lastBackupAt === null || now - lastBackupAt >= BACKUP_REMINDER_MS;
}

const german = new Intl.Collator('de');

/** German alphabetical order. Equal spellings fall back to article and id, so the order never shifts between visits. */
function compareWords(a: Word, b: Word): number {
  return german.compare(a.lemma, b.lemma) || german.compare(a.article ?? '', b.article ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Active words in German alphabetical order. */
export async function listActiveWords(db: AppDatabase): Promise<Word[]> {
  const words = await db.words.filter((word) => word.deletedAt === null).toArray();
  return words.sort(compareWords);
}

export async function getActiveWord(db: AppDatabase, id: string): Promise<Word | null> {
  const word = await db.words.get(id);
  return word && word.deletedAt === null ? word : null;
}

export interface GroupSummary {
  group: Group;
  wordCount: number;
}

/** Every group in its saved order. Deleted words are not counted. */
export async function listGroupSummaries(db: AppDatabase): Promise<GroupSummary[]> {
  const [groups, members, words] = await Promise.all([db.groups.orderBy('order').toArray(), db.groupMembers.toArray(), listActiveWords(db)]);
  const active = new Set(words.map((word) => word.id));
  const counts = new Map<string, number>();
  for (const member of members) {
    if (active.has(member.wordId)) counts.set(member.groupId, (counts.get(member.groupId) ?? 0) + 1);
  }
  return groups.map((group) => ({ group, wordCount: counts.get(group.id) ?? 0 }));
}

export async function getGroupWithWords(db: AppDatabase, groupId: string): Promise<{ group: Group; words: Word[] } | null> {
  const group = await db.groups.get(groupId);
  if (!group) return null;
  const members = await db.groupMembers.where('[groupId+wordId]').between([groupId, Dexie.minKey], [groupId, Dexie.maxKey]).toArray();
  const found = await db.words.bulkGet(members.map((member) => member.wordId));
  const words = found.filter((word): word is Word => word !== undefined && word.deletedAt === null);
  return { group, words: words.sort(compareWords) };
}

export async function listGroupsOfWord(db: AppDatabase, wordId: string): Promise<Group[]> {
  const members = await db.groupMembers.where('wordId').equals(wordId).toArray();
  const groups = await db.groups.bulkGet(members.map((member) => member.groupId));
  return groups.filter((group): group is Group => group !== undefined).sort((a, b) => a.order - b.order);
}

export async function listCustomGroups(db: AppDatabase): Promise<Group[]> {
  return db.groups.where('kind').equals('custom').sortBy('order');
}

/** The ids of every word in a group, deleted or not. */
export async function listGroupWordIds(db: AppDatabase, groupId: string): Promise<string[]> {
  const members = await db.groupMembers.where('[groupId+wordId]').between([groupId, Dexie.minKey], [groupId, Dexie.maxKey]).toArray();
  return members.map((member) => member.wordId);
}

/** The imports a word came from. Read from import rows, so no collection change can alter it. */
export async function listSourcesOfWord(db: AppDatabase, wordId: string): Promise<Source[]> {
  const rows = await db.importRows.filter((row) => row.wordId === wordId).toArray();
  const sources = await db.sources.bulkGet([...new Set(rows.map((row) => row.sourceId))]);
  return sources.filter((source): source is Source => source !== undefined).sort((a, b) => a.importedAt - b.importedAt);
}

interface WordOrigin {
  source: Source;
  /** The pages it is listed on, in order. Empty when the source has no pages. */
  pages: number[];
}

/** Where a word came from, down to the page. */
export async function listOriginsOfWord(db: AppDatabase, wordId: string): Promise<WordOrigin[]> {
  const rows = await db.importRows.filter((row) => row.wordId === wordId).toArray();
  const sources = await listSourcesOfWord(db, wordId);
  return sources.map((source) => ({ source, pages: [...new Set(rows.filter((row) => row.sourceId === source.id && row.page > 0).map((row) => row.page))].sort((a, b) => a - b) }));
}
