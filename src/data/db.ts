import Dexie, { type Table } from 'dexie';
import { DB_NAME, MIGRATIONS, type Migration } from './schema';
import { purgeMarkedWords } from './words';
import type { Card, Group, GroupMember, ImportRow, MetaEntry, ReviewLog, Source, Word } from './types';

export class AppDatabase extends Dexie {
  words!: Table<Word, string>;
  cards!: Table<Card, [string, string]>;
  reviewLogs!: Table<ReviewLog, number>;
  groups!: Table<Group, string>;
  groupMembers!: Table<GroupMember, [string, string]>;
  sources!: Table<Source, string>;
  importRows!: Table<ImportRow, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name: string, migrations: readonly Migration[]) {
    super(name);
    for (const migration of migrations) {
      const version = this.version(migration.version).stores(migration.stores);
      if (migration.upgrade) version.upgrade(migration.upgrade);
    }
  }
}

/** The stored data was written by a newer app version. Nothing is changed. */
export class NewerSchemaError extends Error {
  override readonly name = 'NewerSchemaError';
  constructor(
    readonly storedVersion: number,
    readonly appVersion: number,
  ) {
    super(`Database version ${storedVersion} is newer than app version ${appVersion}`);
  }
}

/** The upgrade failed and rolled back, so the previous data is still there. */
export class MigrationFailedError extends Error {
  override readonly name = 'MigrationFailedError';
}

/** IndexedDB could not be opened, for example in a restricted private window. */
class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError';
}

const STORAGE_ERROR_NAMES = new Set(['MissingAPIError', 'OpenFailedError', 'InvalidStateError', 'SecurityError', 'UnknownError', 'QuotaExceededError', 'NotFoundError', 'VersionError', 'AbortError', 'TimeoutError']);

interface OpenOptions {
  name?: string;
  migrations?: readonly Migration[];
  /** Another tab is upgrading the database. This connection has closed and the page must reload. */
  onClosedByUpgrade?: () => void;
}

export async function openDatabase(options: OpenOptions = {}): Promise<AppDatabase> {
  const migrations = options.migrations ?? MIGRATIONS;
  const appVersion = Math.max(...migrations.map((m) => m.version));
  const db = new AppDatabase(options.name ?? DB_NAME, migrations);

  db.on('versionchange', () => {
    db.close();
    options.onClosedByUpgrade?.();
    return false;
  });

  try {
    await db.open();
  } catch (error) {
    db.close();
    const name = (error as { name?: string }).name ?? '';
    if (STORAGE_ERROR_NAMES.has(name)) throw new StorageUnavailableError(String((error as Error).message));
    throw new MigrationFailedError(String((error as Error).message));
  }

  // Dexie lets older code open a newer database, so the version check has to happen here.
  // Dexie stores its version multiplied by 10.
  const storedVersion = db.backendDB().version / 10;
  if (storedVersion > appVersion) {
    db.close();
    throw new NewerSchemaError(storedVersion, appVersion);
  }

  await db.meta.put({ key: 'schemaVersion', value: appVersion });
  // Tidying only. Everything that reads words skips marked ones anyway, so a failure here can wait.
  await purgeMarkedWords(db).catch((error: unknown) => console.warn('Could not remove marked words', error));
  return db;
}
