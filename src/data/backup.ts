import type { AppDatabase } from './db';
import { SCHEMA_VERSION, TABLE_NAMES, type TableName } from './schema';
import { purgeMarkedWords } from './words';

const BACKUP_APP_ID = 'vosli';
const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  backupVersion: number;
  schemaVersion: number;
  exportedAt: number;
  tables: Record<TableName, Record<string, unknown>[]>;
}

type BackupErrorCode = 'not_json' | 'not_a_backup' | 'newer_format' | 'newer_schema' | 'older_schema' | 'invalid_record' | 'broken_reference' | 'duplicate_key';

export interface BackupError {
  code: BackupErrorCode;
  detail: string;
}

export type ParsedBackup = { ok: true; backup: BackupFile; counts: Record<TableName, number> } | { ok: false; errors: BackupError[] };

export async function createBackup(db: AppDatabase, now: number): Promise<BackupFile> {
  return db.transaction('r', db.tables, async () => {
    const entries = await Promise.all(TABLE_NAMES.map(async (name) => [name, await db.table(name).toArray()] as const));
    return {
      app: BACKUP_APP_ID,
      backupVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now,
      tables: Object.fromEntries(entries) as BackupFile['tables'],
    };
  });
}

/** Creates the file text and records the backup time. */
export async function exportBackupText(db: AppDatabase, now: number): Promise<string> {
  const backup = await createBackup(db, now);
  const text = JSON.stringify(backup);
  await db.meta.put({ key: 'lastBackupAt', value: now });
  return text;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value: unknown) => value === null || isNumber(value);
const isNullableString = (value: unknown) => value === null || isString(value);

const TRACKS = new Set(['de_tr', 'tr_de', 'article']);
const ARTICLES = new Set([null, 'der', 'die', 'das']);

function isFsrsState(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isNumber(value.stability) &&
    isNumber(value.difficulty) &&
    isNumber(value.dueAt) &&
    isNullableNumber(value.lastReviewAt) &&
    isNumber(value.state) &&
    isString(value.scheduleStatus) &&
    isNumber(value.reps) &&
    isNumber(value.lapses) &&
    isNumber(value.scheduledDays) &&
    isNumber(value.learningStep)
  );
}

const VALIDATORS: Record<TableName, (row: Record<string, unknown>) => boolean> = {
  words: (r) =>
    isString(r.id) &&
    r.id !== '' &&
    isString(r.identityKey) &&
    isString(r.lemma) &&
    r.lemma !== '' &&
    ARTICLES.has(r.article as string | null) &&
    isString(r.pos) &&
    isNullableString(r.plural) &&
    Array.isArray(r.meanings) &&
    r.meanings.every((m) => isObject(m) && isString(m.text) && isNullableString(m.note)) &&
    isNullableString(r.senseTag) &&
    Array.isArray(r.searchTokens) &&
    r.searchTokens.every(isString) &&
    isNullableNumber(r.favoritedAt) &&
    isNumber(r.createdAt) &&
    isNumber(r.updatedAt) &&
    isNullableNumber(r.deletedAt),
  cards: (r) => isString(r.wordId) && TRACKS.has(r.track as string) && isNumber(r.due) && isFsrsState(r.fsrs) && r.due === (r.fsrs as { dueAt: number }).dueAt && isString(r.schedulerVersion),
  reviewLogs: (r) => {
    const base = isNumber(r.seq) && isString(r.wordId) && TRACKS.has(r.track as string) && isNumber(r.at) && isString(r.typed) && isString(r.result) && isNumber(r.hintsUsed);
    if (!base) return false;
    if (r.mode === 'practice') return r.prevFsrs === undefined && r.grade === undefined && (r.sessionId === undefined || isString(r.sessionId)) && (r.retry === undefined || typeof r.retry === 'boolean');
    return r.mode === 'scheduled' && isString(r.grade) && isFsrsState(r.prevFsrs) && isString(r.schedulerVersion) && (r.sessionId === undefined || isString(r.sessionId)) && (r.retry === undefined || typeof r.retry === 'boolean');
  },
  groups: (r) => isString(r.id) && ['pdf', 'lesson', 'custom'].includes(r.kind as string) && isString(r.name) && isNumber(r.order) && isNullableString(r.sourceId) && isNumber(r.createdAt),
  groupMembers: (r) => isString(r.groupId) && isString(r.wordId) && isNumber(r.addedAt) && isNullableString(r.importRowId),
  sources: (r) => isString(r.id) && isString(r.fileName) && isString(r.fileHash) && isNumber(r.importedAt) && isNumber(r.pipelineVersion),
  importRows: (r) =>
    isString(r.id) &&
    isString(r.sourceId) &&
    isNumber(r.page) &&
    isNumber(r.rowIndex) &&
    isString(r.german) &&
    isString(r.article) &&
    isString(r.turkish) &&
    Array.isArray(r.flags) &&
    ['pending', 'new', 'existing', 'skipped'].includes(r.decision as string) &&
    isNullableString(r.wordId),
  meta: (r) => isString(r.key),
};

function keyOf(table: TableName, row: Record<string, unknown>): string[] {
  switch (table) {
    case 'words':
      return [`id:${String(row.id)}`, `identity:${String(row.identityKey)}`];
    case 'cards':
      return [`${String(row.wordId)}/${String(row.track)}`];
    case 'reviewLogs':
      return [String(row.seq)];
    case 'groupMembers':
      return [`${String(row.groupId)}/${String(row.wordId)}`];
    case 'meta':
      return [String(row.key)];
    case 'sources':
      return [`id:${String(row.id)}`, `hash:${String(row.fileHash)}`];
    default:
      return [String(row.id)];
  }
}

/** Validates a whole file before anything is written. Reports what is wrong instead of skipping rows. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: [{ code: 'not_json', detail: '' }] };
  }
  if (!isObject(data) || data.app !== BACKUP_APP_ID || !isObject(data.tables)) {
    return { ok: false, errors: [{ code: 'not_a_backup', detail: '' }] };
  }
  if (!isNumber(data.backupVersion) || data.backupVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: [{ code: 'newer_format', detail: String(data.backupVersion) }] };
  }
  if (!isNumber(data.schemaVersion) || !isNumber(data.exportedAt)) {
    return { ok: false, errors: [{ code: 'not_a_backup', detail: '' }] };
  }
  if (data.schemaVersion > SCHEMA_VERSION) return { ok: false, errors: [{ code: 'newer_schema', detail: String(data.schemaVersion) }] };
  if (data.schemaVersion < SCHEMA_VERSION) return { ok: false, errors: [{ code: 'older_schema', detail: String(data.schemaVersion) }] };

  const errors: BackupError[] = [];
  const tables = data.tables;
  for (const name of TABLE_NAMES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) {
      errors.push({ code: 'invalid_record', detail: name });
      continue;
    }
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!isObject(row) || !VALIDATORS[name](row)) {
        errors.push({ code: 'invalid_record', detail: `${name}[${index}]` });
        return;
      }
      for (const key of keyOf(name, row)) {
        if (seen.has(key)) errors.push({ code: 'duplicate_key', detail: `${name}: ${key}` });
        seen.add(key);
      }
    });
  }
  if (errors.length) return { ok: false, errors };

  const backup = data as unknown as BackupFile;
  const wordIds = new Set(backup.tables.words.map((w) => w.id));
  const groupIds = new Set(backup.tables.groups.map((g) => g.id));
  const sourceIds = new Set(backup.tables.sources.map((s) => s.id));
  const check = (table: string, ok: boolean, detail: unknown) => {
    if (!ok) errors.push({ code: 'broken_reference', detail: `${table}: ${String(detail)}` });
  };
  for (const r of backup.tables.cards) check('cards', wordIds.has(r.wordId), r.wordId);
  for (const r of backup.tables.reviewLogs) check('reviewLogs', wordIds.has(r.wordId), r.wordId);
  for (const r of backup.tables.groupMembers) {
    check('groupMembers', groupIds.has(r.groupId), r.groupId);
    check('groupMembers', wordIds.has(r.wordId), r.wordId);
  }
  for (const r of backup.tables.groups) check('groups', r.sourceId === null || sourceIds.has(r.sourceId), r.sourceId);
  for (const r of backup.tables.importRows) {
    check('importRows', sourceIds.has(r.sourceId), r.sourceId);
    check('importRows', r.wordId === null || wordIds.has(r.wordId), r.wordId);
  }
  if (errors.length) return { ok: false, errors };

  const counts = Object.fromEntries(TABLE_NAMES.map((name) => [name, backup.tables[name].length])) as Record<TableName, number>;
  return { ok: true, backup, counts };
}

/**
 * Replaces all data in one transaction. If anything fails, the existing data stays as it was. An older
 * backup may hold words marked as deleted; they were deleted when it was made, so they stay deleted.
 */
export async function restoreBackup(db: AppDatabase, backup: BackupFile): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const table = db.table(name);
      await table.clear();
      if (backup.tables[name].length) await table.bulkAdd(backup.tables[name]);
    }
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    await purgeMarkedWords(db);
  });
}
