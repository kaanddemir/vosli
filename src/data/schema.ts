import type { Transaction } from 'dexie';
import { removeLessonsFromDatabase } from './legacyLessons';
import { learningMetaEntries } from './learningMeta';

export const DB_NAME = 'vosli';

export interface Migration {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => Promise<void> | void;
}

/**
 * Append new versions here and never edit a released one. An upgrade runs in one
 * transaction: if it throws, the database stays at its previous version with data intact.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    stores: {
      words: '&id, &identityKey, *searchTokens, favoritedAt, deletedAt, updatedAt',
      cards: '[wordId+track], due, [track+due]',
      reviewLogs: '++seq, wordId, [wordId+track], at, mode',
      groups: '&id, kind, order',
      groupMembers: '[groupId+wordId], wordId',
      sources: '&id, &fileHash',
      importRows: '&id, sourceId',
      meta: '&key',
    },
  },
  {
    /**
     * Learning languages. Words, collections and sources say which language they belong to, and a word's identity
     * and a file's hash are unique within one language only, so der See or the same PDF can exist in two. Dexie
     * runs this only for a database that already existed, so everything in it is German and its owner a learner
     * from before languages, even with no words yet. Ids and every other field stay exactly as they were.
     */
    version: 2,
    stores: {
      words: '&id, &[language+identityKey], identityKey, language, *searchTokens, favoritedAt, deletedAt, updatedAt',
      groups: '&id, kind, order, language',
      sources: '&id, &[language+fileHash], fileHash',
    },
    upgrade: async (tx) => {
      for (const name of OWNED_TABLES) {
        const table = tx.table(name);
        const before = await table.count();
        await table.toCollection().modify((record: Record<string, unknown>) => {
          record.language = 'de';
        });
        // Checked before the upgrade is allowed to finish: a throw here leaves the database as it was.
        const after = await table.toArray();
        if (after.length !== before || after.some((record: Record<string, unknown>) => record.language !== 'de')) throw new Error(`${name}: language migration incomplete`);
      }
      await tx.table('meta').bulkPut(learningMetaEntries('de', { via: 'legacy', at: Date.now() }));
    },
  },
  {
    /**
     * Lessons removed. Lesson collections and their memberships are deleted; every word, card, history entry,
     * source, import row and other collection stays exactly as it was. No table or index changes: Dexie keeps the
     * version 2 stores. A new database has nothing to remove, and Dexie runs this only for one that already existed.
     */
    version: 3,
    stores: {},
    upgrade: removeLessonsFromDatabase,
  },
];

/** The tables whose records belong to one learning language. Everything else follows them through its links. */
export const OWNED_TABLES = ['words', 'groups', 'sources'] as const;

export const SCHEMA_VERSION = 3;
export const TABLE_NAMES = ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows', 'meta'] as const;
export type TableName = (typeof TABLE_NAMES)[number];
