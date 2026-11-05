import type { Transaction } from 'dexie';

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
];

export const SCHEMA_VERSION = 1;
export const TABLE_NAMES = ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows', 'meta'] as const;
export type TableName = (typeof TABLE_NAMES)[number];
