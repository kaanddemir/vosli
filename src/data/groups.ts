import Dexie from 'dexie';
import { normalizeText } from '../core/identity';
import { newId } from '../core/id';
import type { AppDatabase } from './db';
import type { Group, GroupMember } from './types';
import { purgeWords, wordTables } from './words';

export const GROUP_NAME_MAX = 80;

export type GroupNameProblem = 'empty' | 'taken' | 'too_long';

export class GroupNameError extends Error {
  override readonly name = 'GroupNameError';
  constructor(readonly problem: GroupNameProblem) {
    super(problem);
  }
}

/**
 * PDF and lesson collections record where words came from, so their words cannot be changed, only the whole
 * collection deleted. A PDF collection may be renamed, because a new import finds it by its source. A lesson
 * may not: lessons are found by name, so a renamed one would be split in two by the next import.
 */
export class ProtectedGroupError extends Error {
  override readonly name = 'ProtectedGroupError';
}

class GroupNotFoundError extends Error {
  override readonly name = 'GroupNotFoundError';
}

const nameKey = (name: string) => normalizeText(name).toLocaleLowerCase('tr');

/** Names are unique within their kind, as the importer keeps PDF names unique: a list may share a name with a PDF. */
async function checkName(db: AppDatabase, name: string, ownId: string | null, kind: 'custom' | 'pdf' = 'custom'): Promise<string> {
  const clean = normalizeText(name);
  if (!clean) throw new GroupNameError('empty');
  if (clean.length > GROUP_NAME_MAX) throw new GroupNameError('too_long');
  const taken = await db.groups.where('kind').equals(kind).filter((group) => group.id !== ownId && nameKey(group.name) === nameKey(clean)).count();
  if (taken) throw new GroupNameError('taken');
  return clean;
}

async function customGroup(db: AppDatabase, id: string): Promise<Group> {
  const group = await db.groups.get(id);
  if (!group) throw new GroupNotFoundError(id);
  if (group.kind !== 'custom') throw new ProtectedGroupError(id);
  return group;
}

export async function createCustomGroup(db: AppDatabase, name: string, now: number): Promise<Group> {
  return db.transaction('rw', db.groups, async () => {
    const clean = await checkName(db, name, null);
    const last = await db.groups.orderBy('order').last();
    const group: Group = { id: newId(), kind: 'custom', name: clean, order: (last?.order ?? -1) + 1, sourceId: null, createdAt: now };
    await db.groups.add(group);
    return group;
  });
}

export const canRename = (group: Pick<Group, 'kind'>): boolean => group.kind === 'custom' || group.kind === 'pdf';

/** Changes only the name. The id, the source and every membership stay, so nothing that points at the collection changes. */
export async function renameGroup(db: AppDatabase, id: string, name: string): Promise<void> {
  await db.transaction('rw', db.groups, async () => {
    const group = await db.groups.get(id);
    if (!group) throw new GroupNotFoundError(id);
    if (group.kind === 'lesson') throw new ProtectedGroupError(id);
    await db.groups.update(id, { name: await checkName(db, name, id, group.kind) });
  });
}

/**
 * Removes any collections, PDF and lesson ones included, with their memberships, all or none. Words, cards,
 * review logs, sources and import rows are outside the transaction, so they stay: a word shared with another
 * collection stays in it, and a PDF imported again is still recognized and gets its collection back.
 */
export async function deleteGroups(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await db.transaction('rw', db.groups, db.groupMembers, async () => {
    for (const id of ids) {
      await db.groupMembers.where('[groupId+wordId]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
      await db.groups.delete(id);
    }
  });
}

export interface GroupDeletionPreview {
  /** Active words in these collections and no others. */
  ownWordIds: string[];
  /** Active words in these collections that another collection also holds. They always stay. */
  sharedCount: number;
}

/** Runs inside the caller's transaction when there is one. */
export async function previewGroupDeletion(db: AppDatabase, ids: readonly string[]): Promise<GroupDeletionPreview> {
  const chosen = new Set(ids);
  const members = await db.groupMembers.toArray();
  const inChosen = new Set(members.filter((member) => chosen.has(member.groupId)).map((member) => member.wordId));
  const elsewhere = new Set(members.filter((member) => !chosen.has(member.groupId)).map((member) => member.wordId));
  const active = (await db.words.bulkGet([...inChosen])).filter((word) => word !== undefined && word.deletedAt === null).map((word) => word!.id);
  return { ownWordIds: active.filter((id) => !elsewhere.has(id)), sharedCount: active.filter((id) => elsewhere.has(id)).length };
}

/**
 * Removes collections and, permanently, the words only they hold, all or none. Only words the learner was
 * shown are removed, and each is checked again here: one that joined another list since then stays.
 */
export async function deleteGroupsWithWords(db: AppDatabase, ids: readonly string[], confirmedWordIds: readonly string[]): Promise<void> {
  await db.transaction('rw', [db.groups, ...wordTables(db)], async () => {
    const confirmed = new Set(confirmedWordIds);
    const { ownWordIds } = await previewGroupDeletion(db, ids);
    await purgeWords(db, ownWordIds.filter((id) => confirmed.has(id)));
    await deleteGroups(db, ids);
  });
}

export async function addWordsToGroup(db: AppDatabase, groupId: string, wordIds: readonly string[], now: number): Promise<void> {
  await db.transaction('rw', db.groups, db.groupMembers, db.words, async () => {
    await customGroup(db, groupId);
    for (const wordId of wordIds) {
      const word = await db.words.get(wordId);
      if (!word || word.deletedAt !== null) continue;
      // An existing membership keeps its date and its link to an import row.
      if (!(await db.groupMembers.get([groupId, wordId]))) await db.groupMembers.add({ groupId, wordId, addedAt: now, importRowId: null });
    }
  });
}

/**
 * Takes words out of one list, all or none, and returns the memberships removed so they can be put back
 * exactly. Only memberships change: the words, their other collections, cards and history are outside the
 * transaction, so Dexie would refuse any write to them. A word no longer in the list is passed over.
 */
export async function removeWordsFromGroup(db: AppDatabase, groupId: string, wordIds: readonly string[]): Promise<GroupMember[]> {
  return db.transaction('rw', db.groups, db.groupMembers, async () => {
    await customGroup(db, groupId);
    const found = await db.groupMembers.bulkGet([...new Set(wordIds)].map((wordId) => [groupId, wordId]));
    const members = found.filter((member): member is GroupMember => member !== undefined);
    await db.groupMembers.bulkDelete(members.map((member) => [member.groupId, member.wordId]));
    return members;
  });
}

/** Returns the removed membership, so it can be put back exactly. */
export async function removeWordFromGroup(db: AppDatabase, groupId: string, wordId: string): Promise<GroupMember | null> {
  return (await removeWordsFromGroup(db, groupId, [wordId]))[0] ?? null;
}

/**
 * Puts removed memberships back exactly as they were, all or none. A word deleted in the meantime is
 * passed over, so no membership ever points at a word that is gone. Words are only read here.
 */
export async function restoreGroupMembers(db: AppDatabase, members: readonly GroupMember[]): Promise<void> {
  await db.transaction('rw', db.groups, db.groupMembers, db.words, async () => {
    for (const groupId of new Set(members.map((member) => member.groupId))) await customGroup(db, groupId);
    const words = await db.words.bulkGet(members.map((member) => member.wordId));
    await db.groupMembers.bulkPut(members.filter((_, at) => words[at] !== undefined && words[at]!.deletedAt === null));
  });
}

export const restoreGroupMember = (db: AppDatabase, member: GroupMember): Promise<void> => restoreGroupMembers(db, [member]);

/** Makes a word's custom-list memberships match the choice. Memberships of PDF and lesson collections are left alone. */
export async function setWordCustomGroups(db: AppDatabase, wordId: string, groupIds: readonly string[], now: number): Promise<void> {
  await db.transaction('rw', db.groups, db.groupMembers, async () => {
    const wanted = new Set(groupIds);
    for (const id of wanted) await customGroup(db, id);
    const custom = new Set(await db.groups.where('kind').equals('custom').primaryKeys());
    const members = await db.groupMembers.where('wordId').equals(wordId).toArray();
    for (const member of members) {
      if (custom.has(member.groupId) && !wanted.has(member.groupId)) await db.groupMembers.delete([member.groupId, wordId]);
    }
    const current = new Set(members.map((member) => member.groupId));
    for (const id of wanted) if (!current.has(id)) await db.groupMembers.add({ groupId: id, wordId, addedAt: now, importRowId: null });
  });
}
