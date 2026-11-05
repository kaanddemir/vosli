import { newId } from '../core/id';
import { needsAttention, reviewRows, rowOutcome, rowRef, SEPARATE, type ImportDraft, type ReviewedRow } from '../core/review';
import { normalizeText } from '../core/identity';
import type { WordDraft } from '../core/vocabulary';
import type { AppDatabase } from './db';
import { createCustomGroup, GROUP_NAME_MAX, GroupNameError } from './groups';
import type { Group, ImportRow, Source, Word } from './types';
import { addDismissals } from './dismissals';
import { isDismissalKey } from '../core/issues';
import { insertWord, knownEntryOf, withMeanings } from './words';

/** Raised when the review needs an answer, such as after the library changed in another tab. Nothing was written. */
export class ImportNotReadyError extends Error {
  override readonly name = 'ImportNotReadyError';
}

export const TEXT_PIPELINE_VERSION = 1;

export interface ImportSource {
  /** Empty for pasted text. */
  fileName: string;
  fileHash: string;
  pipelineVersion: number;
}

export type ImportTarget = { kind: 'none' } | { kind: 'group'; id: string } | { kind: 'new_group'; name: string };

/** The collections a document's words belong to. Paste and CSV imports have none. */
export interface SourceCollections {
  /** Used the first time this source is imported; afterwards its collection is reused. */
  pdfName: string;
  /** Lesson name for each section of the source. An empty name means no lesson collection. */
  lessons: Readonly<Record<string, string>>;
}

export interface ImportSummary {
  /** Every row of the import. It equals created + existing + repeats + excluded + invalid. */
  rows: number;
  /** New words. */
  created: number;
  /** Rows matching a word that was already saved before this import. */
  existing: number;
  /** Rows repeating a word met earlier in this import. */
  repeats: number;
  excluded: number;
  /** Excluded rows that could not have been saved as they were. */
  invalid: number;
  /** How many already saved words gained a new source or collection. Part of existing, not added to it. */
  linked: number;
  meaningsAdded: number;
  group: Group | null;
  pdfGroup: Group | null;
  lessonGroups: Group[];
  /** This exact content was imported before. */
  sourceReused: boolean;
}

/** The answer a reviewed row resolves to: make a word, or use the word behind this ref. */
function plan(row: ReviewedRow): { create: true } | { create: false; ref: string } | null {
  const { status } = row;
  if (status.kind === 'new') return { create: true };
  if (status.kind === 'existing') return { create: false, ref: status.entry.ref };
  if (status.kind === 'ambiguous') return status.choice === SEPARATE ? { create: true } : { create: false, ref: status.choice! };
  return null;
}

const nameKey = (name: string) => normalizeText(name).toLocaleLowerCase('tr');
const rowKey = (row: Pick<ImportRow, 'page' | 'rowIndex'>) => `${row.page}:${row.rowIndex}`;

async function addSourceGroup(db: AppDatabase, kind: 'pdf' | 'lesson', name: string, sourceId: string, now: number): Promise<Group> {
  const last = await db.groups.orderBy('order').last();
  const group: Group = { id: newId(), kind, name, order: (last?.order ?? -1) + 1, sourceId, createdAt: now };
  await db.groups.add(group);
  return group;
}

/** One collection per source. A name already in use gets a number, so a changed file never looks like the original. */
async function pdfGroupFor(db: AppDatabase, source: Source, name: string, now: number): Promise<Group> {
  const own = await db.groups.where('kind').equals('pdf').filter((group) => group.sourceId === source.id).first();
  if (own) return own;
  const clean = normalizeText(name);
  if (!clean) throw new GroupNameError('empty');
  if (clean.length > GROUP_NAME_MAX) throw new GroupNameError('too_long');
  const taken = new Set((await db.groups.where('kind').equals('pdf').toArray()).map((group) => nameKey(group.name)));
  let unique = clean;
  for (let n = 2; taken.has(nameKey(unique)); n++) unique = `${clean} (${n})`;
  return addSourceGroup(db, 'pdf', unique, source.id, now);
}

/** Lessons are found by name, so two files of the same lesson share one collection. */
async function lessonGroupFor(db: AppDatabase, name: string, sourceId: string, now: number): Promise<Group> {
  const clean = normalizeText(name);
  if (clean.length > GROUP_NAME_MAX) throw new GroupNameError('too_long');
  const found = await db.groups.where('kind').equals('lesson').filter((group) => nameKey(group.name) === nameKey(clean)).first();
  return found ?? addSourceGroup(db, 'lesson', clean, sourceId, now);
}

/**
 * Writes a reviewed import in one transaction: any failure leaves every table as it was. The rows
 * are judged again against the words stored right now, so a stale review cannot create duplicates.
 * Import rows are the permanent record of where a word came from; custom lists never touch them.
 */
export async function commitImport(db: AppDatabase, input: { source: ImportSource; drafts: readonly ImportDraft[]; target: ImportTarget; collections?: SourceCollections | undefined }, now: number): Promise<ImportSummary> {
  return db.transaction('rw', [db.words, db.cards, db.reviewLogs, db.groups, db.groupMembers, db.sources, db.importRows, db.meta], async () => {
    const active = await db.words.filter((word) => word.deletedAt === null).toArray();
    const reviewed = reviewRows(input.drafts, active.map(knownEntryOf));
    if (reviewed.some((row) => needsAttention(row.status))) throw new ImportNotReadyError();

    let source: Source | undefined = await db.sources.where('fileHash').equals(input.source.fileHash).first();
    const isRepeat = source !== undefined;
    if (!source) {
      source = { id: newId(), fileName: input.source.fileName, fileHash: input.source.fileHash, importedAt: now, pipelineVersion: input.source.pipelineVersion };
      await db.sources.add(source);
    }
    const sourceId = source.id;

    // What this source already recorded, so importing it again adds no row and no link twice.
    const prior = isRepeat ? await db.importRows.where('sourceId').equals(sourceId).toArray() : [];
    const recorded = new Map<string, ImportRow[]>();
    for (const row of prior) recorded.set(rowKey(row), [...(recorded.get(rowKey(row)) ?? []), row]);
    const wordsOfSource = new Set(prior.map((row) => row.wordId));

    let group: Group | null = null;
    if (input.target.kind === 'new_group') group = await createCustomGroup(db, input.target.name, now);
    if (input.target.kind === 'group') {
      group = (await db.groups.get(input.target.id)) ?? null;
      if (group?.kind !== 'custom') throw new ImportNotReadyError();
    }

    const collections = input.collections;
    const savesWords = reviewed.some((row) => plan(row) !== null);
    const pdfGroup = collections && savesWords ? await pdfGroupFor(db, source, collections.pdfName, now) : null;
    const lessonBySection = new Map<string, Group>();

    const words = new Map(active.map((word) => [word.id, word]));
    const made = new Map<string, Word>();
    const linked = new Set<string>();
    const summary: ImportSummary = { rows: reviewed.length, created: 0, existing: 0, repeats: 0, excluded: 0, invalid: 0, linked: 0, meaningsAdded: 0, group, pdfGroup, lessonGroups: [], sourceReused: isRepeat };

    const join = async (target: Group, wordId: string, importRowId: string | null): Promise<boolean> => {
      if (await db.groupMembers.get([target.id, wordId])) return false;
      await db.groupMembers.add({ groupId: target.id, wordId, addedAt: now, importRowId });
      return true;
    };

    for (const row of reviewed) {
      const action = plan(row);
      const flags = [...row.draft.flags, ...(row.draft.edited ? ['edited'] : []), ...(row.draft.dismissed.length ? ['reviewed'] : [])];
      const base = { id: newId(), sourceId, page: row.draft.page, rowIndex: row.draft.rowIndex, german: normalizeText(row.draft.german), article: normalizeText(row.draft.article), turkish: normalizeText(row.draft.turkish), flags, ...(row.draft.edited ? { extracted: row.draft.extracted } : {}) };
      const outcome = rowOutcome(row);

      if (!action) {
        if (outcome === 'invalid') summary.invalid++;
        else summary.excluded++;
        if (!recorded.has(rowKey(base)) && (base.german || base.turkish)) await db.importRows.add({ ...base, decision: 'skipped', wordId: null });
        continue;
      }

      let word: Word;
      if (action.create) {
        const draft: WordDraft = { lemma: row.lemma, article: row.article, meanings: row.meanings, plural: normalizeText(row.draft.plural) || null };
        word = await insertWord(db, draft, now);
        words.set(word.id, word);
        made.set(rowRef(row.draft.id), word);
        summary.created++;
      } else {
        const existing = made.get(action.ref) ?? words.get(action.ref);
        if (!existing) throw new ImportNotReadyError();
        const merged = withMeanings(existing, row.meanings, now);
        const plural = row.draft.linked ? '' : normalizeText(row.draft.plural);
        const updated = plural && !merged.plural ? { ...merged, plural, updatedAt: now } : merged;
        if (updated !== existing) await db.words.put(updated);
        summary.meaningsAdded += updated.meanings.length - existing.meanings.length;
        word = updated;
        words.set(word.id, word);
        if (action.ref.startsWith('row:')) made.set(action.ref, word);
        if (outcome === 'repeat') summary.repeats++;
        else summary.existing++;
      }

      // One record per row of the source, so a word listed on two pages keeps both places.
      const sameRow = recorded.get(rowKey(base)) ?? [];
      let rowId = sameRow.find((entry) => entry.wordId === word.id)?.id ?? null;
      if (!rowId) {
        const skipped = sameRow.find((entry) => entry.wordId === null);
        const importRow: ImportRow = { ...base, id: skipped?.id ?? base.id, decision: action.create ? 'new' : 'existing', wordId: word.id };
        await db.importRows.put(importRow);
        rowId = importRow.id;
        recorded.set(rowKey(base), [...sameRow.filter((entry) => entry !== skipped), importRow]);
      }
      const newToSource = !wordsOfSource.has(word.id);
      wordsOfSource.add(word.id);

      let joined = false;
      if (group && (await join(group, word.id, rowId))) joined = true;
      if (pdfGroup && (await join(pdfGroup, word.id, rowId))) joined = true;
      const lessonName = collections?.lessons[row.draft.section] ?? '';
      if (normalizeText(lessonName)) {
        let lesson = lessonBySection.get(row.draft.section);
        if (!lesson) {
          lesson = await lessonGroupFor(db, lessonName, sourceId, now);
          lessonBySection.set(row.draft.section, lesson);
        }
        if (await join(lesson, word.id, rowId)) joined = true;
      }
      if (!made.has(rowRef(row.draft.id)) && outcome === 'existing' && (newToSource || joined)) linked.add(word.id);
    }
    await addDismissals(db, reviewed.filter((row) => !row.draft.excluded).flatMap((row) => row.draft.dismissed.filter(isDismissalKey)));
    summary.linked = linked.size;
    summary.lessonGroups = [...new Map([...lessonBySection.values()].map((lesson) => [lesson.id, lesson])).values()];
    return summary;
  });
}

/**
 * Importing a file again: rows a person corrected in the review, and which still say what they said
 * then, point at the word they became, so that answer is not asked for or undone. Other rows are judged
 * as usual, which asks about any word changed later in the dictionary.
 */
export async function linkEarlierRows(db: AppDatabase, sourceId: string, drafts: readonly ImportDraft[]): Promise<ImportDraft[]> {
  const earlier = await db.importRows.where('sourceId').equals(sourceId).toArray();
  const byPlace = new Map<string, ImportRow[]>();
  for (const row of earlier) if (row.wordId) byPlace.set(rowKey(row), [...(byPlace.get(rowKey(row)) ?? []), row]);
  return drafts.map((draft) => {
    const match = byPlace.get(rowKey(draft))?.find(({ extracted }) => extracted && extracted.german === draft.extracted.german && extracted.article === draft.extracted.article && extracted.turkish === draft.extracted.turkish);
    return match ? { ...draft, linked: match.wordId } : draft;
  });
}
