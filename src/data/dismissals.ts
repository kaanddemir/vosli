import type { AppDatabase } from './db';

const KEY = 'dictionaryDismissals';

/** Warnings someone looked at and accepted. They live in meta, so backups keep them and re-imports respect them. */
export async function readDismissals(db: AppDatabase): Promise<ReadonlySet<string>> {
  const entry = await db.meta.get(KEY);
  return new Set(Array.isArray(entry?.value) ? (entry.value as unknown[]).filter((item): item is string => typeof item === 'string') : []);
}

/** Runs inside the caller's transaction when there is one. */
export async function addDismissals(db: AppDatabase, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const current = await readDismissals(db);
  await db.meta.put({ key: KEY, value: [...new Set([...current, ...keys])] });
}
