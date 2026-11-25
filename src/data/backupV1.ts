import type { BackupError } from './backup';

/**
 * The checks backups of schema version 1 were made under, frozen as they were released. A v1 backup is judged by
 * these alone before it is converted; the current checks then judge the result. Never edit this file: a change here
 * would accept or refuse old backups differently from the app that made them.
 */
export const V1_TABLE_NAMES = ['words', 'cards', 'reviewLogs', 'groups', 'groupMembers', 'sources', 'importRows', 'meta'] as const;
type V1TableName = (typeof V1_TABLE_NAMES)[number];
type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
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

export const V1_VALIDATORS: Readonly<Record<V1TableName, (row: Row) => boolean>> = {
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

function keyOf(table: V1TableName, row: Row): string[] {
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

/** Every problem with v1 tables, as the v1 app reported them: records first, then the links between them. */
export function validateV1(tables: Row): BackupError[] {
  const errors: BackupError[] = [];
  for (const name of V1_TABLE_NAMES) {
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
      for (const key of keyOf(name, row)) {
        if (seen.has(key)) errors.push({ code: 'duplicate_key', detail: `${name}: ${key}` });
        seen.add(key);
      }
    });
  }
  if (errors.length) return errors;

  const table = (name: V1TableName) => tables[name] as Row[];
  const wordIds = new Set(table('words').map((w) => w.id));
  const groupIds = new Set(table('groups').map((g) => g.id));
  const sourceIds = new Set(table('sources').map((s) => s.id));
  const check = (name: string, ok: boolean, detail: unknown) => {
    if (!ok) errors.push({ code: 'broken_reference', detail: `${name}: ${String(detail)}` });
  };
  for (const r of table('cards')) check('cards', wordIds.has(r.wordId), r.wordId);
  for (const r of table('reviewLogs')) check('reviewLogs', wordIds.has(r.wordId), r.wordId);
  for (const r of table('groupMembers')) {
    check('groupMembers', groupIds.has(r.groupId), r.groupId);
    check('groupMembers', wordIds.has(r.wordId), r.wordId);
  }
  for (const r of table('groups')) check('groups', r.sourceId === null || sourceIds.has(r.sourceId as string), r.sourceId);
  for (const r of table('importRows')) {
    check('importRows', sourceIds.has(r.sourceId), r.sourceId);
    check('importRows', r.wordId === null || wordIds.has(r.wordId), r.wordId);
  }
  return errors;
}
