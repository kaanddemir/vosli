import Dexie, { type Transaction } from 'dexie';

/**
 * Lesson collections were made by imports up to schema version 2: one per heading of a PDF, linking words the file
 * also put in its PDF collection. The app no longer has them. They are removed once, when a database reaches
 * version 3, and from every older backup before it is restored. Only the collections and their memberships go:
 * a word is never removed with them, even one that no other collection holds.
 */
export const LEGACY_LESSON_KIND = 'lesson';

type Row = Record<string, unknown>;

const isLesson = (group: unknown): boolean => typeof group === 'object' && group !== null && (group as Row).kind === LEGACY_LESSON_KIND;

/** Every table but the two a lesson lives in, groups and groupMembers. Their counts must not change. */
const OTHER_TABLES = ['words', 'cards', 'reviewLogs', 'sources', 'importRows', 'meta'] as const;

/**
 * The version 3 upgrade, in the upgrade's own transaction. Before it may finish it checks that only lessons and
 * their memberships are gone: a throw leaves the database at version 2 with everything in it.
 */
export async function removeLessonsFromDatabase(tx: Transaction): Promise<void> {
  const groups = tx.table('groups');
  const members = tx.table('groupMembers');
  const lessonIds = (await groups.where('kind').equals(LEGACY_LESSON_KIND).primaryKeys()) as string[];
  if (lessonIds.length === 0) return;

  const others = async () => Promise.all(OTHER_TABLES.map((name) => tx.table(name).count()));
  const [othersBefore, groupsBefore, membersBefore] = await Promise.all([others(), groups.count(), members.count()]);
  let removedMembers = 0;
  for (const id of lessonIds) removedMembers += await members.where('[groupId+wordId]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
  await groups.bulkDelete(lessonIds);

  const [othersAfter, groupsAfter, membersAfter, lessonsLeft] = await Promise.all([others(), groups.count(), members.count(), groups.where('kind').equals(LEGACY_LESSON_KIND).count()]);
  const kept = lessonsLeft === 0 && groupsAfter === groupsBefore - lessonIds.length && membersAfter === membersBefore - removedMembers && othersAfter.every((count, at) => count === othersBefore[at]);
  if (!kept) throw new Error('groups: lesson removal incomplete');
}

/**
 * The same for the tables of an older backup, already in the current shape: lesson collections and the memberships
 * that point at them are left out, every other row is kept as it is. A row that is not an object is kept, so the
 * checks that follow still refuse the file.
 */
export function withoutLessons(tables: Row): Row {
  const { groups, groupMembers } = tables;
  if (!Array.isArray(groups) || !Array.isArray(groupMembers)) return tables;
  const lessonIds = new Set(groups.filter(isLesson).map((group) => (group as Row).id));
  if (lessonIds.size === 0) return tables;
  return {
    ...tables,
    groups: groups.filter((group) => !isLesson(group)),
    groupMembers: groupMembers.filter((member) => !(typeof member === 'object' && member !== null && lessonIds.has((member as Row).groupId))),
  };
}
