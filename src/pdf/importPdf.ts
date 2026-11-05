import { hashBytes, newId } from '../core/id';
import { parseVocabularyPages, type PdfParseResult } from '../core/pdf/layout';
import { blankDraft, reviewRows, tallyRows, type ImportDraft } from '../core/review';
import { MAX_IMPORT_ROWS } from '../core/tabular';
import type { AppDatabase } from '../data/db';
import { GROUP_NAME_MAX } from '../data/groups';
import { linkEarlierRows, type ImportSource, type SourceCollections } from '../data/importCommit';
import { listActiveWords } from '../data/repository';
import { knownEntryOf } from '../data/words';
import { PdfCancelled, PdfReadError, readPdfText, MAX_PDF_BYTES, type PdfLibrary } from './readPdf';

const PDF_PIPELINE_VERSION = 1;

export type PdfNotice = { kind: 'no_table' | 'no_text' | 'guessed' | 'plain' | 'ignored'; pages: number[] } | { kind: 'repaired'; count: number };

/** What the review shows about a PDF, next to its rows. */
export interface PdfReviewInfo {
  pageCount: number;
  notices: PdfNotice[];
  /** Exactly this content was imported before. Its source record is what recognizes it, whatever is left of its words. */
  reused: boolean;
  /** How much of what that import saved is still in the dictionary. Deleted words leave no trace, so they read as new. */
  remaining: 'none' | 'some' | 'all';
  /** Rows the import would save as new words. Their learning history, if they had any, is not coming back. */
  missingWords: number;
  /** No collection of this file exists, so saving creates one and it needs a name. */
  namesCollection: boolean;
  /** Another PDF with this name, but different content, was imported before. */
  sameNameDifferent: boolean;
  /** The headings found in the file, or one empty entry when there are none. */
  sections: string[];
}

export interface PdfImport {
  source: ImportSource;
  drafts: ImportDraft[];
  info: PdfReviewInfo;
  collections: SourceCollections;
}

/** The URL-style name that course downloads have: Konu+sonu+kelime+listesi.pdf reads as words. */
export function collectionNameOf(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/iu, '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
  return (stem || fileName).slice(0, GROUP_NAME_MAX);
}

function noticesOf(parsed: PdfParseResult): PdfNotice[] {
  const pagesWith = (test: (page: PdfParseResult['pages'][number]) => boolean) => parsed.pages.filter(test).map((page) => page.page);
  const notices: PdfNotice[] = [];
  const add = (kind: 'no_table' | 'no_text' | 'guessed' | 'plain' | 'ignored', pages: number[]) => {
    if (pages.length) notices.push({ kind, pages });
  };
  add('no_table', pagesWith((page) => page.mode === 'no_table'));
  add('no_text', pagesWith((page) => page.mode === 'no_text'));
  add('guessed', pagesWith((page) => page.mode === 'inferred' || page.mode === 'inherited'));
  add('plain', pagesWith((page) => page.mode === 'lines'));
  add('ignored', pagesWith((page) => page.rows > 0 && page.mode !== 'inferred' && page.ignoredLines > 0));
  const repaired = parsed.repairs.reduce((sum, repair) => sum + repair.count, 0);
  if (repaired) notices.push({ kind: 'repaired', count: repaired });
  return notices;
}

interface PdfImportOptions {
  signal?: AbortSignal | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/**
 * PDF → text → rows → drafts ready for the review. It only reads the database, to recognize a file
 * seen before; everything is written later by the commit, after a person has confirmed.
 */
export async function preparePdfImport(db: AppDatabase, lib: PdfLibrary, fileName: string, bytes: Uint8Array<ArrayBuffer>, options: PdfImportOptions = {}): Promise<PdfImport> {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfReadError('too_large');
  // First: PDF.js takes the buffer away to its worker.
  const fileHash = await hashBytes(bytes);
  if (options.signal?.aborted) throw new PdfCancelled();

  const parsed = parseVocabularyPages(await readPdfText(lib, bytes, options));
  if (parsed.pages.every((page) => page.mode === 'no_text')) throw new PdfReadError('no_text');
  if (parsed.rows.length === 0) throw new PdfReadError('no_table');
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new PdfReadError('too_many_rows');

  const known = await db.sources.where('fileHash').equals(fileHash).first();
  const sameName = known ? 0 : await db.sources.filter((source) => source.fileName === fileName).count();
  const lessons = known ? await db.groups.where('kind').equals('lesson').filter((group) => group.sourceId === known.id).toArray() : [];

  const sections = parsed.sections.length ? parsed.sections : [''];
  const lessonNames: Record<string, string> = {};
  for (const section of sections) {
    // A second import repeats the choice made the first time, including no lesson at all.
    if (known) lessonNames[section] = sections.length === 1 ? (lessons[0]?.name ?? '') : (lessons.find((lesson) => lesson.name === section.slice(0, GROUP_NAME_MAX))?.name ?? '');
    else lessonNames[section] = section.slice(0, GROUP_NAME_MAX);
  }

  const drafts = parsed.rows.map((row) => blankDraft(newId(), row.rowIndex, { page: row.page, german: row.german, article: row.article, turkish: row.turkish, plural: row.plural, flags: row.flags, section: row.section }));

  const prepared = known ? await linkEarlierRows(db, known.id, drafts) : drafts;
  const stillLinked = known ? await db.importRows.where('sourceId').equals(known.id).filter((row) => row.wordId !== null).count() : 0;
  const ownGroup = known ? await db.groups.where('kind').equals('pdf').filter((group) => group.sourceId === known.id).count() : 0;
  const missingWords = known ? tallyRows(reviewRows(prepared, (await listActiveWords(db)).map(knownEntryOf))).create : 0;

  return {
    source: { fileName, fileHash, pipelineVersion: PDF_PIPELINE_VERSION },
    drafts: prepared,
    info: {
      pageCount: parsed.pages.length,
      notices: noticesOf(parsed),
      reused: known !== undefined,
      remaining: stillLinked === 0 ? 'none' : missingWords > 0 ? 'some' : 'all',
      missingWords,
      namesCollection: ownGroup === 0,
      sameNameDifferent: sameName > 0,
      sections,
    },
    collections: { pdfName: collectionNameOf(fileName), lessons: lessonNames },
  };
}
