import { isLearningLanguage, LEARNING_LANGUAGES, type LearningLanguage } from '../core/learningLanguage';
import { V1_VALIDATORS, validateV1 } from './backupV1';
import type { AppDatabase } from './db';
import { isOnboarding, LEARNING_LANGUAGE_KEY, learningMetaEntries, ONBOARDING_KEY, readLearningLanguage } from './learningMeta';
import { OWNED_TABLES, SCHEMA_VERSION, TABLE_NAMES, type TableName } from './schema';
import type { Onboarding } from './types';
import { purgeMarkedWords } from './words';

const BACKUP_APP_ID = 'vosli';
const BACKUP_FORMAT_VERSION = 1;
/** The schema backups were made under before learning languages. It is converted, never restored as it is. */
const LEGACY_SCHEMA_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  backupVersion: number;
  schemaVersion: number;
  exportedAt: number;
  tables: Record<TableName, Record<string, unknown>[]>;
}

type BackupErrorCode = 'not_json' | 'not_a_backup' | 'newer_format' | 'newer_schema' | 'older_schema' | 'invalid_record' | 'broken_reference' | 'duplicate_key' | 'invalid_language' | 'language_mismatch';

export interface BackupError {
  code: BackupErrorCode;
  detail: string;
}

/** What a backup holds, as the learner compares it with what is on the device. */
export interface BackupContents {
  /** Words that will be there after restoring: a word an older app only marked as deleted is not counted. */
  words: Record<LearningLanguage, number>;
  groups: number;
  reviewLogs: number;
  learningLanguage: LearningLanguage;
  /** Made before learning languages, and converted to German. */
  legacy: boolean;
}

export type ParsedBackup = { ok: true; backup: BackupFile; counts: Record<TableName, number>; contents: BackupContents } | { ok: false; errors: BackupError[] };

/**
 * Every table, both learning languages, read at one moment. The file always names its learning language, as every
 * restore requires: a database that has never recorded one is German, as it reads everywhere else.
 */
export async function createBackup(db: AppDatabase, now: number): Promise<BackupFile> {
  return db.transaction('r', db.tables, async () => {
    const entries = await Promise.all(TABLE_NAMES.map(async (name) => [name, await db.table(name).toArray()] as const));
    const meta = entries.find(([name]) => name === 'meta')![1] as Row[];
    if (!isLearningLanguage(metaValue(meta, LEARNING_LANGUAGE_KEY))) meta.push({ key: LEARNING_LANGUAGE_KEY, value: await readLearningLanguage(db) });
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

type Row = Record<string, unknown>;
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOwned = (name: TableName): name is (typeof OWNED_TABLES)[number] => (OWNED_TABLES as readonly string[]).includes(name);
const metaValue = (rows: readonly Row[], key: string): unknown => rows.find((row) => row.key === key)?.value;

/**
 * The keys that must be unique in a table. A word's identity and a source's file are unique within one learning
 * language only, as the database enforces them.
 */
function keyOf(table: TableName, row: Row): string[] {
  switch (table) {
    case 'words':
      return [`id:${String(row.id)}`, `identity:${String(row.language)}|${String(row.identityKey)}`];
    case 'cards':
      return [`${String(row.wordId)}/${String(row.track)}`];
    case 'reviewLogs':
      return [String(row.seq)];
    case 'groupMembers':
      return [`${String(row.groupId)}/${String(row.wordId)}`];
    case 'meta':
      return [String(row.key)];
    case 'sources':
      return [`id:${String(row.id)}`, `hash:${String(row.language)}|${String(row.fileHash)}`];
    default:
      return [String(row.id)];
  }
}

/**
 * The current checks. Each record has the shape its table needs, as in version 1, and a learning language where it
 * owns one. Then every link is checked: it must point at a record that exists, of the same language. Nothing here
 * repairs anything: a backup that fails is refused whole.
 */
function validateCurrent(tables: Row): BackupError[] {
  const errors: BackupError[] = [];
  for (const name of TABLE_NAMES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) {
      errors.push({ code: 'invalid_record', detail: name });
      continue;
    }
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!isObject(row) || !V1_VALIDATORS[name](row)) {
        errors.push({ code: 'invalid_record', detail: `${name}[${index}]` });
        return;
      }
      if (isOwned(name) && !isLearningLanguage(row.language)) {
        errors.push({ code: 'invalid_language', detail: `${name}[${index}]` });
        return;
      }
      for (const key of keyOf(name, row)) {
        if (seen.has(key)) errors.push({ code: 'duplicate_key', detail: `${name}: ${key}` });
        seen.add(key);
      }
    });
  }
  if (errors.length) return errors;

  const table = (name: TableName) => tables[name] as Row[];
  const meta = table('meta');
  if (!isLearningLanguage(metaValue(meta, LEARNING_LANGUAGE_KEY))) errors.push({ code: 'invalid_language', detail: `meta: ${LEARNING_LANGUAGE_KEY}` });
  const onboarding = metaValue(meta, ONBOARDING_KEY);
  if (onboarding !== undefined && !isOnboarding(onboarding)) errors.push({ code: 'invalid_record', detail: `meta: ${ONBOARDING_KEY}` });

  const languageOf = (name: 'words' | 'groups' | 'sources') => new Map(table(name).map((row) => [row.id, row.language as LearningLanguage]));
  const words = languageOf('words');
  const groups = languageOf('groups');
  const sources = languageOf('sources');
  const exists = (name: string, ok: boolean, detail: unknown) => {
    if (!ok) errors.push({ code: 'broken_reference', detail: `${name}: ${String(detail)}` });
    return ok;
  };
  const same = (name: string, a: LearningLanguage | undefined, b: LearningLanguage | undefined, detail: unknown) => {
    if (a !== b) errors.push({ code: 'language_mismatch', detail: `${name}: ${String(detail)}` });
  };
  // German articles, and the skill of choosing one, belong to German words only.
  const articleFits = (name: string, wordId: unknown, track: unknown) => {
    if (track === 'article' && words.get(wordId) !== 'de') errors.push({ code: 'language_mismatch', detail: `${name}: ${String(wordId)}` });
  };

  for (const r of table('words')) if (r.article !== null && r.language !== 'de') errors.push({ code: 'language_mismatch', detail: `words: ${String(r.id)}` });
  for (const r of table('cards')) if (exists('cards', words.has(r.wordId), r.wordId)) articleFits('cards', r.wordId, r.track);
  for (const r of table('reviewLogs')) if (exists('reviewLogs', words.has(r.wordId), r.wordId)) articleFits('reviewLogs', r.wordId, r.track);
  for (const r of table('groupMembers')) {
    const group = exists('groupMembers', groups.has(r.groupId), r.groupId);
    const word = exists('groupMembers', words.has(r.wordId), r.wordId);
    if (group && word) same('groupMembers', groups.get(r.groupId), words.get(r.wordId), `${String(r.groupId)}/${String(r.wordId)}`);
  }
  for (const r of table('groups')) {
    if (r.sourceId !== null && exists('groups', sources.has(r.sourceId), r.sourceId)) same('groups', r.language as LearningLanguage, sources.get(r.sourceId), r.id);
  }
  for (const r of table('importRows')) {
    const source = exists('importRows', sources.has(r.sourceId), r.sourceId);
    const word = r.wordId === null || exists('importRows', words.has(r.wordId), r.wordId);
    if (source && word && r.wordId !== null) same('importRows', sources.get(r.sourceId), words.get(r.wordId), r.id);
  }
  return errors;
}

/**
 * Brings checked v1 tables to the current shape: every word, collection and source becomes German, the language
 * there was then, and the learning language becomes German too. Ids, text, meanings, schedules and history are
 * copied as they are. A v1 record that already names a language, or v1 meta holding what only later versions
 * write, did not come from the app; it is refused rather than guessed about.
 */
function convertV1(tables: Row, exportedAt: number): { tables: Row } | { errors: BackupError[] } {
  const errors: BackupError[] = [];
  for (const name of OWNED_TABLES) {
    (tables[name] as Row[]).forEach((row, index) => {
      if ('language' in row) errors.push({ code: 'invalid_record', detail: `${name}[${index}]` });
    });
  }
  for (const key of [LEARNING_LANGUAGE_KEY, ONBOARDING_KEY]) {
    if ((tables.meta as Row[]).some((row) => row.key === key)) errors.push({ code: 'invalid_record', detail: `meta: ${key}` });
  }
  if (errors.length) return { errors };

  const converted: Row = { ...tables };
  for (const name of OWNED_TABLES) converted[name] = (tables[name] as Row[]).map((row) => ({ ...row, language: 'de' }));
  converted.meta = [...(tables.meta as Row[]), ...learningMetaEntries('de', { via: 'restore', at: exportedAt })];
  return { tables: converted };
}

/**
 * Validates a whole file before anything is written, and reports what is wrong instead of skipping rows. Only
 * the backup format and schema versions this app knows are read: a v1 backup is checked by the rules it was made
 * under, converted, then checked again by the current ones. A file never says which learning language it is from
 * by its name or the interface language it was saved in, only by what it holds.
 */
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
  // Exactly the versions this app knows, as whole numbers. Anything else is refused, never read as the nearest one.
  const { backupVersion, schemaVersion, exportedAt } = data;
  if (Number.isInteger(backupVersion) && (backupVersion as number) > BACKUP_FORMAT_VERSION) return { ok: false, errors: [{ code: 'newer_format', detail: String(backupVersion) }] };
  if (backupVersion !== BACKUP_FORMAT_VERSION || !Number.isInteger(schemaVersion) || !isNumber(exportedAt)) return { ok: false, errors: [{ code: 'not_a_backup', detail: '' }] };
  if ((schemaVersion as number) > SCHEMA_VERSION) return { ok: false, errors: [{ code: 'newer_schema', detail: String(schemaVersion) }] };
  if (schemaVersion !== SCHEMA_VERSION && schemaVersion !== LEGACY_SCHEMA_VERSION) return { ok: false, errors: [{ code: 'older_schema', detail: String(schemaVersion) }] };

  const legacy = schemaVersion === LEGACY_SCHEMA_VERSION;
  let tables: Row = data.tables;
  if (legacy) {
    const oldErrors = validateV1(tables);
    if (oldErrors.length) return { ok: false, errors: oldErrors };
    const converted = convertV1(tables, exportedAt);
    if ('errors' in converted) return { ok: false, errors: converted.errors };
    tables = converted.tables;
  }

  const errors = validateCurrent(tables);
  if (errors.length) return { ok: false, errors };

  // A backup from before the first-start choice has no record of it. Restoring one settles it, so no welcome
  // appears straight after a restore.
  const meta = tables.meta as Row[];
  if (metaValue(meta, ONBOARDING_KEY) === undefined) {
    const settled: Onboarding = { via: 'restore', at: exportedAt };
    tables = { ...tables, meta: [...meta, { key: ONBOARDING_KEY, value: settled }] };
  }

  const backup: BackupFile = { app: BACKUP_APP_ID, backupVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt, tables: tables as BackupFile['tables'] };
  const counts = Object.fromEntries(TABLE_NAMES.map((name) => [name, backup.tables[name].length])) as Record<TableName, number>;
  return { ok: true, backup, counts, contents: contentsOf(backup, legacy) };
}

function contentsOf(backup: BackupFile, legacy: boolean): BackupContents {
  const words = Object.fromEntries(LEARNING_LANGUAGES.map((language) => [language, 0])) as Record<LearningLanguage, number>;
  for (const word of backup.tables.words) if (word.deletedAt === null) words[word.language as LearningLanguage]++;
  return { words, groups: backup.tables.groups.length, reviewLogs: backup.tables.reviewLogs.length, learningLanguage: metaValue(backup.tables.meta, LEARNING_LANGUAGE_KEY) as LearningLanguage, legacy };
}

/**
 * Replaces all data, every learning language, in one transaction: nothing is merged. If anything fails, the existing
 * data stays exactly as it was. The backup is one that parseBackup accepted, so it is in the current shape, and
 * everything it needs is worked out before the transaction begins: inside it, only the database is waited for.
 * The learning language, how it was settled and the last backup time are written in the same transaction. The last
 * backup time is the backup's own, since that file holds exactly what is now on the device. An older backup may hold
 * words marked as deleted; they were deleted when it was made, so they stay deleted.
 */
export async function restoreBackup(db: AppDatabase, backup: BackupFile): Promise<void> {
  const meta = backup.tables.meta;
  const language = metaValue(meta, LEARNING_LANGUAGE_KEY);
  if (!isLearningLanguage(language)) throw new Error('Backup has no learning language');
  const stored = metaValue(meta, ONBOARDING_KEY);
  const onboarding: Onboarding = isOnboarding(stored) ? stored : { via: 'restore', at: backup.exportedAt };

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const table = db.table(name);
      await table.clear();
      if (backup.tables[name].length) await table.bulkAdd(backup.tables[name]);
    }
    await db.meta.bulkPut([...learningMetaEntries(language, onboarding), { key: 'lastBackupAt', value: backup.exportedAt }, { key: 'schemaVersion', value: SCHEMA_VERSION }]);
    await purgeMarkedWords(db);
  });
}
