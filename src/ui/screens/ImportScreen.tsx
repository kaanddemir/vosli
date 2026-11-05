import { useEffect, useRef, useState } from 'preact/hooks';
import { AUTOCORRECT_OFF } from '../inputProps';
import { hashText, newId } from '../../core/id';
import { blankDraft, countEditedRows, type ImportDraft } from '../../core/review';
import { assignRole, decodeBytes, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, mappingIsComplete, parseImportText, rowsFromTable, type ColumnMapping, type ColumnRole, type ParsedRow } from '../../core/tabular';
import { TEXT_PIPELINE_VERSION, type ImportSource, type ImportSummary, type SourceCollections } from '../../data/importCommit';
import { preparePdfImport, type PdfReviewInfo } from '../../pdf/importPdf';
import { loadPdfLibrary } from '../../pdf/loadPdf';
import { MAX_PDF_BYTES, PdfCancelled, PdfReadError } from '../../pdf/readPdf';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { Icon } from '../components/Icon';
import { ImportReview } from '../components/ImportReview';
import { List, Row } from '../components/List';
import { ConfirmDialog } from '../components/Modal';
import { useDb } from '../dbContext';
import { Screen } from '../components/Screen';
import { hrefFor, hrefForGroup } from '../router';

interface TableInput {
  table: string[][];
  mapping: ColumnMapping;
}

type Step =
  | { step: 'input' }
  | ({ step: 'map'; source: ImportSource } & TableInput)
  | { step: 'reading'; fileName: string; done: number; total: number }
  | { step: 'review'; source: ImportSource; original: ImportDraft[]; drafts: ImportDraft[]; tableInput?: TableInput; pdf?: { info: PdfReviewInfo; collections: SourceCollections } }
  | { step: 'done'; summary: ImportSummary };

/** Survives leaving the screen, so looking something up in the dictionary does not lose a review in progress. */
let inProgress: Step = { step: 'input' };

const ROLES: readonly ColumnRole[] = ['german', 'article', 'turkish', 'plural', 'ignore'];

/** Starts a review; the first copy of the rows is what later edits are measured against. */
const reviewStep = (source: ImportSource, drafts: ImportDraft[], tableInput?: TableInput, pdf?: { info: PdfReviewInfo; collections: SourceCollections }): Step => ({ step: 'review', source, original: drafts, drafts, ...(tableInput ? { tableInput } : {}), ...(pdf ? { pdf } : {}) });

/** The collections the imported words joined, named, so the summary shows where they went. */
function groupNames(summary: ImportSummary): string[] {
  return [summary.pdfGroup, ...summary.lessonGroups, summary.group].flatMap((group) => (group ? [group.name] : []));
}

const toDrafts = (rows: readonly ParsedRow[]): ImportDraft[] => rows.map((row) => blankDraft(newId(), row.rowIndex, row));

function MapStep({ input, onChange, onNext, onBack }: { input: TableInput; onChange: (mapping: ColumnMapping) => void; onNext: () => void; onBack: () => void }) {
  const { table, mapping } = input;
  const complete = mappingIsComplete(mapping);
  const samples = table.slice(mapping.hasHeader ? 1 : 0, (mapping.hasHeader ? 1 : 0) + 3);

  return (
    <>
      <List>
        <li class="list-item">
          <label class="check-row">
            <input type="checkbox" checked={mapping.hasHeader} onChange={(event) => onChange({ ...mapping, hasHeader: event.currentTarget.checked })} />
            <span>{t.import.hasHeader}</span>
          </label>
        </li>
      </List>
      <ul class="list">
        {mapping.roles.map((role, column) => {
          const heading = mapping.hasHeader && table[0]?.[column] ? table[0][column] : t.import.column(formatCount(column + 1));
          const sample = samples.map((row) => row[column]).filter(Boolean).join(', ');
          return (
            <li key={column} class="list-item">
              <div class="row row-wrap map-row">
                <span class="row-text">
                  <label class="row-title" for={`column-${column}`}>{heading}</label>
                  <span class="row-detail">{sample || '–'}</span>
                </span>
                <select id={`column-${column}`} class="field field-compact map-select" value={role} onChange={(event) => onChange(assignRole(mapping, column, event.currentTarget.value as ColumnRole))}>
                  {ROLES.map((option) => <option key={option} value={option}>{t.import.roles[option]}</option>)}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      {!complete && <p class="form-hint">{t.import.mapHint}</p>}
      <div class="btn-row">
        <button type="button" class="btn" onClick={onBack}>{t.import.back}</button>
        <button type="button" class="btn btn-primary" disabled={!complete} onClick={onNext}>{t.import.next}</button>
      </div>
    </>
  );
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/iu.test(file.name);

function ReadingStep({ done, total, onCancel }: { done: number; total: number; onCancel: () => void }) {
  return (
    <div class="form">
      <p class="count" role="status" data-testid="pdf-progress">{total ? t.import.pageOf(formatCount(done), formatCount(total)) : t.import.preparing}</p>
      <div class="progress progress-reading" role="progressbar" aria-label={t.import.reading} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}>
        <div class="progress-fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </div>
      <button type="button" class="btn btn-block" onClick={onCancel}>{t.common.cancel}</button>
    </div>
  );
}

function InputStep({ initialProblem, onParsed, onPdf }: { initialProblem: string | null; onParsed: (text: string, origin: 'paste' | 'file', fileName: string) => Promise<string | null>; onPdf: (file: File) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(initialProblem);
  const fileInput = useRef<HTMLInputElement>(null);

  const chosen = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (isPdf(file)) {
      if (file.size > MAX_PDF_BYTES) return setProblem(t.import.pdfErrors.too_large);
      return onPdf(file);
    }
    if (file.size > MAX_IMPORT_BYTES) return setProblem(t.import.fileTooLarge);
    try {
      // A .txt file is written like pasted lines; the rest are tables.
      const origin = /\.txt$/i.test(file.name) ? 'paste' : 'file';
      setProblem(await onParsed(decodeBytes(new Uint8Array(await file.arrayBuffer())), origin, file.name));
    } catch (error) {
      console.error(error);
      setProblem(t.import.fileUnreadable);
    }
  };

  return (
    <form
      class="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onParsed(text, 'paste', '').then(setProblem);
      }}
    >
      <div class="form-field">
        <label class="form-label" for="import-text">{t.import.pasteLabel}</label>
        <textarea
          id="import-text"
          class="field field-area"
          rows={5}
          value={text}
          placeholder={t.import.pastePlaceholder}
          autocomplete="off"
          autocapitalize="off"
          autocorrect={AUTOCORRECT_OFF}
          spellcheck={false}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setProblem(null);
          }}
        />
      </div>
      <button type="submit" class="btn btn-primary btn-block" disabled={!text.trim()}>{t.import.next}</button>
      {problem && <p class="status-error" role="alert">{problem}</p>}
      <p class="form-divider">{t.import.or}</p>
      <button type="button" class="btn btn-block" onClick={() => fileInput.current?.click()}>
        <Icon name="file" />
        <span>{t.import.chooseFile}</span>
      </button>
      <input ref={fileInput} type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain" hidden aria-label={t.import.chooseFile} onChange={chosen} />
    </form>
  );
}

function DoneStep({ summary, onAgain }: { summary: ImportSummary; onAgain: () => void }) {
  return (
    <>
      <List>
        <Row title={t.import.created} value={formatCount(summary.created)} valueTestId="summary-created" />
        {summary.existing > 0 && <Row title={t.import.existing} value={formatCount(summary.existing)} valueTestId="summary-existing" />}
        {summary.existing > 0 && <Row title={t.import.linked} value={formatCount(summary.linked)} valueTestId="summary-linked" />}
        {summary.meaningsAdded > 0 && <Row title={t.import.meaningsAdded} value={formatCount(summary.meaningsAdded)} valueTestId="summary-meanings" />}
        {summary.repeats > 0 && <Row title={t.import.repeats} value={formatCount(summary.repeats)} valueTestId="summary-repeats" />}
        {summary.excluded > 0 && <Row title={t.import.excludedRows} value={formatCount(summary.excluded)} valueTestId="summary-excluded" />}
        {summary.invalid > 0 && <Row title={t.import.invalidRows} value={formatCount(summary.invalid)} valueTestId="summary-invalid" />}
        <Row title={t.import.totalRows} value={formatCount(summary.rows)} valueTestId="summary-rows" />
      </List>
      {groupNames(summary).length > 0 && <p class="meta-line" data-testid="summary-groups">{groupNames(summary).join(' · ')}</p>}
      <div class="btn-row">
        {summary.group ? (
          <a class="btn btn-primary" href={hrefForGroup(summary.group.id)}>{t.import.toGroup}</a>
        ) : summary.pdfGroup ? (
          <a class="btn btn-primary" href={hrefForGroup(summary.pdfGroup.id)}>{t.import.toPdfGroup}</a>
        ) : (
          <a class="btn btn-primary" href={hrefFor('dictionary')}>{t.import.toDictionary}</a>
        )}
        <button type="button" class="btn" onClick={onAgain}>{t.import.another}</button>
      </div>
    </>
  );
}

export function ImportScreen() {
  const db = useDb();
  const [current, setCurrent] = useState<Step>(inProgress);
  const [inputProblem, setInputProblem] = useState<string | null>(null);
  const reader = useRef<AbortController | null>(null);

  // Reading is tied to this screen: leaving cancels it, and nothing half-read is kept.
  useEffect(() => {
    inProgress = current.step === 'done' || current.step === 'reading' ? { step: 'input' } : current;
  }, [current]);
  useEffect(() => () => reader.current?.abort(), []);

  const readPdf = async (file: File) => {
    if (reader.current) return;
    const control = new AbortController();
    reader.current = control;
    setInputProblem(null);
    setCurrent({ step: 'reading', fileName: file.name, done: 0, total: 0 });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const lib = await loadPdfLibrary();
      const prepared = await preparePdfImport(db, lib, file.name, bytes, {
        signal: control.signal,
        onProgress: (done, total) => setCurrent({ step: 'reading', fileName: file.name, done, total }),
      });
      if (control.signal.aborted) throw new PdfCancelled();
      setCurrent(reviewStep(prepared.source, prepared.drafts, undefined, { info: prepared.info, collections: prepared.collections }));
    } catch (error) {
      if (!(error instanceof PdfCancelled)) {
        if (!(error instanceof PdfReadError)) console.error(error);
        setInputProblem(error instanceof PdfReadError ? t.import.pdfErrors[error.problem] : t.import.fileUnreadable);
      }
      setCurrent({ step: 'input' });
    } finally {
      reader.current = null;
    }
  };

  const parse = async (text: string, origin: 'paste' | 'file', fileName: string): Promise<string | null> => {
    const parsed = parseImportText(text, origin);
    const source: ImportSource = { fileName, fileHash: await hashText(text), pipelineVersion: TEXT_PIPELINE_VERSION };
    const size = parsed.kind === 'lines' ? parsed.rows.length : parsed.table.length;
    if (size === 0) return t.import.nothingFound;
    if (size > MAX_IMPORT_ROWS) return t.import.tooManyRows(formatCount(MAX_IMPORT_ROWS));
    if (parsed.kind === 'lines') setCurrent(reviewStep(source, toDrafts(parsed.rows)));
    else if (parsed.confident) setCurrent(reviewStep(source, toDrafts(rowsFromTable(parsed.table, parsed.mapping)), { table: parsed.table, mapping: parsed.mapping }));
    else setCurrent({ step: 'map', source, table: parsed.table, mapping: parsed.mapping });
    return null;
  };

  const restart = () => {
    setInputProblem(null);
    setCurrent({ step: 'input' });
  };

  const editedRows = current.step === 'review' ? countEditedRows(current.original, current.drafts) : 0;
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  /** Corrections are the only thing a review could lose; with none, leaving needs no question. */
  const leaveReview = (next: () => void) => {
    if (editedRows > 0) setLeaving(() => next);
    else next();
  };

  // A reload or a closed tab would lose corrections too, and only the browser can ask about those.
  useEffect(() => {
    if (editedRows === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editedRows > 0]);

  const back = { href: hrefFor('collections'), label: t.nav.collections };

  switch (current.step) {
    case 'input':
      return (
        <Screen title={t.import.title} back={back}>
          <InputStep key={inputProblem} initialProblem={inputProblem} onParsed={parse} onPdf={(file) => void readPdf(file)} />
        </Screen>
      );
    case 'reading':
      return (
        <Screen title={t.import.reading} eyebrow={current.fileName} eyebrowClip back={back}>
          <ReadingStep done={current.done} total={current.total} onCancel={() => reader.current?.abort()} />
        </Screen>
      );
    case 'map':
      return (
        <Screen title={t.import.mapTitle} eyebrow={current.source.fileName || undefined} eyebrowClip back={back}>
          <MapStep
            input={current}
            onChange={(mapping) => setCurrent({ ...current, mapping })}
            onBack={restart}
            onNext={() => setCurrent(reviewStep(current.source, toDrafts(rowsFromTable(current.table, current.mapping)), { table: current.table, mapping: current.mapping }))}
          />
        </Screen>
      );
    case 'review':
      return (
        <ImportReview
          title={t.import.reviewTitle}
          eyebrow={current.source.fileName || undefined}
          back={back}
          cancel={
            current.tableInput ? (
              <button type="button" class="btn btn-small" onClick={() => leaveReview(() => setCurrent({ step: 'map', source: current.source, ...current.tableInput! }))}>{t.import.changeColumns}</button>
            ) : (
              <button type="button" class="btn btn-small" onClick={() => leaveReview(restart)}>{t.common.cancel}</button>
            )
          }
          drafts={current.drafts}
          source={current.source}
          pdf={current.pdf ? { ...current.pdf, onCollections: (collections) => setCurrent({ ...current, pdf: { ...current.pdf!, collections } }) } : undefined}
          onChange={(drafts) => setCurrent({ ...current, drafts })}
          onDone={(summary) => setCurrent({ step: 'done', summary })}
        >
          {current.tableInput && <button type="button" class="btn btn-quiet btn-block" onClick={() => leaveReview(restart)}>{t.common.cancel}</button>}
          {leaving && (
            <ConfirmDialog
              title={t.import.discardTitle}
              body={<p>{t.import.discardBody(formatCount(editedRows))}</p>}
              cancelLabel={t.import.keepEditing}
              confirmLabel={t.import.discard}
              onCancel={() => setLeaving(null)}
              onConfirm={() => {
                setLeaving(null);
                leaving();
              }}
            />
          )}
        </ImportReview>
      );
    case 'done':
      return (
        <Screen title={t.import.doneTitle} back={back}>
          <DoneStep summary={current.summary} onAgain={restart} />
        </Screen>
      );
  }
}
