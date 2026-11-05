import type { ComponentChildren } from 'preact';
import { AUTOCORRECT_OFF } from '../inputProps';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { needsAttention, reviewRows, rowCorrections, rowWarnings, SEPARATE, tallyRows, WARNING_FLAGS, type ImportDraft, type KnownEntry, type ReviewedRow, type RowStatus } from '../../core/review';
import { dismissalKey, openIssues, UNCHECKED, type Issue, type Suggestion, type Validation } from '../../core/issues';
import { ARTICLES } from '../../core/vocabulary';
import { GROUP_NAME_MAX, GroupNameError, type GroupNameProblem } from '../../data/groups';
import { commitImport, ImportNotReadyError, type ImportSource, type ImportSummary, type ImportTarget, type SourceCollections } from '../../data/importCommit';
import { readDismissals } from '../../data/dismissals';
import { listActiveWords, listCustomGroups } from '../../data/repository';
import { knownEntryOf } from '../../data/words';
import { loadValidator } from '../../dictionary/loadDictionary';
import type { PdfNotice, PdfReviewInfo } from '../../pdf/importPdf';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { useDb } from '../dbContext';
import { useLoad } from '../useLoad';
import { Icon } from './Icon';
import { ConfirmDialog } from './Modal';
import { PopoverButton } from './PopoverButton';
import { IssueList, validationText } from './Validation';
import { LoadError, LoadingState, Screen } from './Screen';

const PAGE = 100;
const label = (entry: Pick<KnownEntry, 'article' | 'lemma'>) => (entry.article ? `${entry.article} ${entry.lemma}` : entry.lemma);
const describe = (entry: KnownEntry) => `${label(entry)} — ${entry.meanings.join(', ')}`;
const rowName = (row: ReviewedRow) => (row.lemma ? label(row) : t.import.emptyRow);

/** One problem gets one line: when the file already raised it, the dictionary only adds its offer of a fix. */
function repeatsSource(draft: ImportDraft, issue: Issue): boolean {
  const flags = rowWarnings(draft);
  return (issue.code === 'article_missing' && flags.includes('article_missing')) || (issue.code === 'capitalization' && flags.includes('article_lowercase'));
}

/** What helps a decision stays in view. What only explains a repair waits in the settings. */
const isBackground = (notice: PdfNotice) => notice.kind === 'repaired' || notice.kind === 'ignored';

function noticeText(notice: PdfNotice): string {
  const texts = t.import.notices;
  return notice.kind === 'repaired' ? texts.repaired(formatCount(notice.count)) : texts[notice.kind](notice.pages.map((page) => formatCount(page)).join(', '));
}

/** The collections a file's words will join, and the details behind them. Source and collections stay separate things. */
function PdfSettings({ source, info, collections, nameMissing, onChange }: { source: ImportSource; info: PdfReviewInfo; collections: SourceCollections; nameMissing: boolean; onChange: (next: SourceCollections) => void }) {
  const background = info.notices.filter(isBackground).map(noticeText);
  return (
    <>
      {info.namesCollection && (
        <div class="form-field">
          <label class="form-label" for="pdf-collection">{t.import.pdfCollection}</label>
          <input
            id="pdf-collection"
            class="field field-compact"
            type="text"
            value={collections.pdfName}
            maxLength={GROUP_NAME_MAX}
            autocomplete="off"
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? 'pdf-collection-error' : undefined}
            onInput={(event) => onChange({ ...collections, pdfName: event.currentTarget.value })}
          />
          {nameMissing && <p id="pdf-collection-error" class="form-error">{t.import.pdfCollectionEmpty}</p>}
        </div>
      )}
      {info.sections.map((section, index) => (
        <div class="form-field" key={section}>
          <label class="form-label" for={`lesson-${index}`}>{info.sections.length > 1 ? t.import.lessonSection(formatCount(index + 1)) : t.import.lessonName}</label>
          <input
            id={`lesson-${index}`}
            class="field field-compact"
            type="text"
            value={collections.lessons[section] ?? ''}
            maxLength={GROUP_NAME_MAX}
            autocomplete="off"
            onInput={(event) => onChange({ ...collections, lessons: { ...collections.lessons, [section]: event.currentTarget.value } })}
          />
        </div>
      ))}
      <ul class="pdf-notes" data-testid="pdf-details">
        <li>{t.import.pdfFile}: {source.fileName}</li>
        {background.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </>
  );
}

function statusBadge(status: RowStatus): { text: string; attention: boolean; quiet?: boolean } {
  const names = t.import.status;
  switch (status.kind) {
    case 'new':
      return { text: names.new, attention: false, quiet: true };
    case 'existing':
      return { text: status.inBatch ? names.repeat : status.newMeanings.length ? names.meaning : names.existing, attention: false };
    case 'ambiguous':
      if (status.choice === null) return { text: names.ambiguous, attention: true };
      return { text: status.inBatch ? names.repeat : names.chosen, attention: false };
    case 'invalid':
      return { text: names.invalid, attention: true };
    default:
      return { text: names.excluded, attention: false };
  }
}

function RowEditor({ row, validation, onChange }: { row: ReviewedRow; validation: Validation; onChange: (patch: Partial<ImportDraft>) => void }) {
  const { draft } = row;
  const origin = [draft.page > 0 ? t.import.rowOrigin(formatCount(draft.page), formatCount(draft.rowIndex)) : '', ...rowCorrections(draft).map((flag) => t.import.corrections[flag])].filter(Boolean);
  const checked = validationText(validation);
  const known = ARTICLES.includes(draft.article.toLowerCase() as (typeof ARTICLES)[number]) || draft.article === '';
  return (
    <div class="review-editor">
      <div class="form-field review-article">
        <label class="form-label" for={`article-${draft.id}`}>{t.import.articleField}</label>
        <select id={`article-${draft.id}`} class="field field-compact" lang="de" value={known ? draft.article.toLowerCase() : draft.article} onChange={(event) => onChange({ article: event.currentTarget.value })}>
          <option value="">–</option>
          {ARTICLES.map((article) => <option key={article} value={article}>{article}</option>)}
          {!known && <option value={draft.article}>{draft.article}</option>}
        </select>
      </div>
      <div class="form-field review-german">
        <label class="form-label" for={`german-${draft.id}`}>{t.import.germanField}</label>
        <input id={`german-${draft.id}`} class="field field-compact" type="text" lang="de" value={draft.german} autocomplete="off" autocapitalize="off" autocorrect={AUTOCORRECT_OFF} spellcheck={false} onInput={(event) => onChange({ german: event.currentTarget.value })} />
      </div>
      <div class="form-field review-turkish">
        <label class="form-label" for={`turkish-${draft.id}`}>{t.import.turkishField}</label>
        <input id={`turkish-${draft.id}`} class="field field-compact" type="text" lang="tr" value={draft.turkish} autocomplete="off" onInput={(event) => onChange({ turkish: event.currentTarget.value })} />
      </div>
      {origin.length > 0 && <p class="review-origin" data-testid="row-origin">{origin.join(' · ')}</p>}
      {checked && <p class="review-origin" data-testid="row-check">{checked}</p>}
    </div>
  );
}

function ReviewItem({ row, validation, issues, onChange }: { row: ReviewedRow; validation: Validation; issues: readonly Issue[]; onChange: (patch: Partial<ImportDraft>) => void }) {
  const { draft, status } = row;
  const invalid = status.kind === 'invalid';
  const [editing, setEditing] = useState(invalid);
  const badge = statusBadge(status);
  const name = rowName(row);
  const warnings = rowWarnings(draft);
  const count = warnings.length + issues.filter((item) => !repeatsSource(draft, item)).length;
  const editButton = useRef<HTMLButtonElement>(null);

  // Opens by itself when a row needs fixing, and stays open once fixed: it must not close mid-typing.
  useEffect(() => {
    if (invalid) setEditing(true);
  }, [invalid]);

  return (
    <li class={`list-item review-row ${status.kind === 'excluded' ? 'review-row-excluded' : ''}`} data-testid="review-row">
      <div class="review-line">
        <label class="review-check">
          <input type="checkbox" checked={!draft.excluded} aria-label={t.import.include(name)} onChange={(event) => onChange({ excluded: !event.currentTarget.checked })} />
        </label>
        <div class="row-text">
          <span class="row-title" lang="de">
            {row.article && <span class="article">{row.article} </span>}
            {row.lemma || t.import.emptyRow}
          </span>
          <span class="row-detail" lang="tr">{draft.turkish || '–'}</span>
        </div>
        <span class={`badge ${badge.attention ? 'badge-attention' : ''} ${badge.quiet ? 'badge-quiet' : ''}`}>{badge.text}</span>
        {count > 0 && (
          <PopoverButton id={`warning-${draft.id}`} icon="warning" attention label={t.import.warningLabel(name, formatCount(count))}>
            {warnings.map((warning) => <span key={warning} class="popover-line">{t.import.warnings[warning]}</span>)}
            <IssueList
              issues={issues}
              silent={issues.filter((item) => repeatsSource(draft, item)).map((item) => item.code)}
              onApply={(suggestion: Suggestion) => {
                editButton.current?.focus({ preventScroll: true });
                onChange({ german: suggestion.german, article: suggestion.article ?? '' });
              }}
            >
            <button
              type="button"
              class="btn btn-small"
              onClick={() => {
                // The button is about to go away, and focus must not go with it.
                editButton.current?.focus({ preventScroll: true });
                onChange({ dismissed: [...draft.dismissed, ...warnings, ...issues.map((item) => dismissalKey(item.code, draft.german, draft.article))] });
              }}
            >
              {t.import.warningAccept}
            </button>
            </IssueList>
          </PopoverButton>
        )}
        {!invalid && (
          <button ref={editButton} type="button" class="icon-btn" aria-expanded={editing} aria-label={t.import.editRow(name)} title={t.import.editRow(name)} onClick={() => setEditing(!editing)}>
            <Icon name="edit" />
          </button>
        )}
      </div>

      {status.kind === 'invalid' && <p class="review-message status-error">{status.errors.map((error) => t.import.errors[error]).join(' · ')}</p>}
      {status.kind === 'existing' && status.newMeanings.length > 0 && <p class="review-message">{t.import.newMeanings(status.newMeanings.join(', '))}</p>}
      {status.kind === 'ambiguous' && (
        <div class="review-choice">
          <p class="review-message">{t.import.reasons[status.reason]}</p>
          <div class="form-field">
            <label class="form-label" for={`choice-${draft.id}`}>{t.import.choiceLabel}</label>
            <select id={`choice-${draft.id}`} class="field field-compact" value={status.choice ?? ''} onChange={(event) => onChange({ choice: event.currentTarget.value || null })}>
              <option value="">{t.import.choose}</option>
              {status.candidates.map((entry) => {
                const text = describe(entry) + (entry.ref.startsWith('row:') ? ` (${t.import.inThisList})` : '');
                return <option key={entry.ref} value={entry.ref}>{status.reason === 'meaning' ? t.import.joinMeaning(text) : t.import.join(text)}</option>;
              })}
              <option value={SEPARATE}>{t.import.keepSeparate}</option>
            </select>
          </div>
        </div>
      )}
      {editing && <RowEditor row={row} validation={validation} onChange={onChange} />}
    </li>
  );
}

type Filter = 'all' | 'problems' | 'warnings';
const NEW_LIST = '__new__';

interface ImportReviewProps {
  drafts: ImportDraft[];
  source: ImportSource;
  pdf?: { info: PdfReviewInfo; collections: SourceCollections; onCollections: (next: SourceCollections) => void } | undefined;
  onChange: (next: ImportDraft[]) => void;
  onDone: (summary: ImportSummary) => void;
  /** The screen around the review. Its header holds the counts, which only the review can make. */
  title: string;
  eyebrow?: string | undefined;
  back: { href: string; label: string };
  cancel: ComponentChildren;
  children?: ComponentChildren;
}

/** Works on drafts from any parser: it never knows whether they came from a paste, a CSV file or a PDF. */
export function ImportReview({ drafts, source, pdf, onChange, onDone, title, eyebrow, back, cancel, children }: ImportReviewProps) {
  const db = useDb();
  const { state, reload } = useLoad(async () => {
    const [words, groups, dismissed, dictionary] = await Promise.all([listActiveWords(db), listCustomGroups(db), readDismissals(db), loadValidator()]);
    return { known: words.map(knownEntryOf), groups, dismissed, validate: dictionary, available: dictionary !== null };
  }, [db]);

  const known = state.status === 'ready' ? state.data.known : null;
  const rows = useMemo(() => (known ? reviewRows(drafts, known) : []), [drafts, known]);
  const problems = rows.filter((row) => needsAttention(row.status));

  const ready = state.status === 'ready' ? state.data : null;
  /** Rows already answered, rows that cannot be saved as they are, and rows left out have nothing to advise on. */
  const validationOf = (row: ReviewedRow): Validation => (!ready || row.draft.linked || row.status.kind === 'invalid' || row.status.kind === 'excluded' || !ready.validate ? UNCHECKED : ready.validate(row.draft.german, row.draft.article, row.draft.turkish));
  const issuesOf = (row: ReviewedRow): Issue[] => openIssues(validationOf(row), row.draft.german, row.draft.article, ready ? new Set([...ready.dismissed, ...row.draft.dismissed]) : row.draft.dismissed);
  const hasWarning = (row: ReviewedRow) => issuesOf(row).length > 0 || rowWarnings(row.draft).length > 0;
  const warned = rows.filter(hasWarning);
  const hasFlag = (draft: ImportDraft) => draft.flags.some((flag) => (WARNING_FLAGS as readonly string[]).includes(flag));
  // Rows with nothing to warn about never need this filter. Once it has been needed it stays, so it can say none are left.
  const everWarned = useRef(false);
  everWarned.current ||= warned.length > 0;
  const canWarn = drafts.some(hasFlag) || everWarned.current;

  const [filter, setFilter] = useState<Filter | null>(null);
  // A row being fixed stays on screen until the filter changes, instead of vanishing mid-typing.
  const [pinned, setPinned] = useState<ReadonlySet<string> | null>(null);
  // What the file itself may have got wrong opens first. Dictionary advice waits in its filter, so a list never opens half hidden.
  const activeFilter: Filter = filter ?? (problems.length ? 'problems' : rows.some((row) => rowWarnings(row.draft).length > 0) ? 'warnings' : 'all');
  const matching = (which: Filter) => (which === 'warnings' ? warned : which === 'problems' ? problems : rows);
  const pins = pinned ?? new Set(matching(activeFilter).map((row) => row.draft.id));
  const visible = activeFilter === 'all' ? rows : rows.filter((row) => pins.has(row.draft.id) || (activeFilter === 'warnings' ? hasWarning(row) : needsAttention(row.status)));

  const filterRadio = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(PAGE);
  const [target, setTarget] = useState('');
  const [listName, setListName] = useState('');
  const [nameProblem, setNameProblem] = useState<GroupNameProblem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (id: string, change: Partial<ImportDraft>) => {
    // The view holds still while rows are being fixed, even when the last problem goes away.
    if (filter === null) setFilter(activeFilter);
    // Accepting a warning or excluding its row is a finished decision, so that row may leave the warnings view.
    const settled = activeFilter === 'warnings' && ('dismissed' in change || change.excluded === true);
    setPinned(settled ? new Set([...pins].filter((pin) => pin !== id)) : pinned ?? pins);
    // That row takes its controls away, so focus moves to the filter instead of being lost.
    if (settled) filterRadio.current?.focus({ preventScroll: true });
    const edited = 'german' in change || 'article' in change || 'turkish' in change || 'plural' in change;
    // Changing a row's text makes it a new answer, no longer the one given last time.
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...change, edited: draft.edited || edited, linked: edited ? null : draft.linked } : draft)));
  };

  const chooseFilter = (next: Filter) => {
    setFilter(next);
    setPinned(new Set(matching(next).map((row) => row.draft.id)));
    setShown(PAGE);
  };

  const excludeProblems = () => {
    const ids = new Set(problems.map((row) => row.draft.id));
    onChange(drafts.map((draft) => (ids.has(draft.id) ? { ...draft, excluded: true } : draft)));
    setFilter('all');
    setPinned(new Set());
  };

  const counts = tallyRows(rows);
  const excluded = counts.excluded + counts.invalid;
  const saving = counts.create + counts.existing + counts.repeat;

  const tally = [
    counts.create && t.import.tallies.new(formatCount(counts.create)),
    counts.existing && t.import.tallies.existing(formatCount(counts.existing)),
    counts.repeat && t.import.tallies.repeat(formatCount(counts.repeat)),
    excluded && t.import.tallies.excluded(formatCount(excluded)),
    pdf && t.import.pdfFacts(formatCount(pdf.info.pageCount), formatCount(rows.length)),
  ].filter(Boolean);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const askToCommit = () => {
    if (pdf && pdf.info.namesCollection && !pdf.collections.pdfName.trim()) {
      setSettingsOpen(true);
      return setNameMissing(true);
    }
    setConfirming(true);
  };

  const notes = [...(pdf ? [...pdf.info.notices.filter((notice) => !isBackground(notice)).map(noticeText), ...(pdf.info.remaining === 'all' ? [t.import.notices.reused] : []), ...(pdf.info.remaining === 'some' ? [t.import.notices.reusedPartly(formatCount(pdf.info.missingWords))] : []), ...(pdf.info.sameNameDifferent ? [t.import.notices.sameName] : [])] : []), ...(ready && !ready.available ? [t.validation.unavailable] : [])];

  const commit = async () => {
    setBusy(true);
    setError(null);
    const importTarget: ImportTarget = target === NEW_LIST ? { kind: 'new_group', name: listName } : target ? { kind: 'group', id: target } : { kind: 'none' };
    try {
      onDone(await commitImport(db, { source, drafts, target: importTarget, collections: pdf?.collections }, Date.now()));
    } catch (failure) {
      setBusy(false);
      setConfirming(false);
      if (failure instanceof GroupNameError) setNameProblem(failure.problem);
      else if (failure instanceof ImportNotReadyError) {
        setError(t.import.notReady);
        void reload();
      } else {
        console.error(failure);
        setError(t.common.saveFailed);
      }
    }
  };

  const targetField = (
    <>
      <div class="form-field">
        <label class="form-label" for="import-target">{pdf ? t.import.targetExtra : t.import.target}</label>
        <select
          id="import-target"
          class="field field-compact"
          value={target}
          onChange={(event) => {
            setTarget(event.currentTarget.value);
            setNameProblem(null);
          }}
        >
          <option value="">{t.import.targetNone}</option>
          {(state.status === 'ready' ? state.data.groups : []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          <option value={NEW_LIST}>{t.import.targetNew}</option>
        </select>
      </div>
      {target === NEW_LIST && (
        <div class="form-field">
          <label class="form-label" for="import-list-name">{t.import.targetName}</label>
          <input
            id="import-list-name"
            class="field field-compact"
            type="text"
            value={listName}
            maxLength={100}
            autocomplete="off"
            aria-invalid={nameProblem ? true : undefined}
            aria-describedby={nameProblem ? 'import-list-error' : undefined}
            onInput={(event) => {
              setListName(event.currentTarget.value);
              setNameProblem(null);
            }}
          />
          {nameProblem && <p id="import-list-error" class="form-error">{t.collections.nameErrors[nameProblem]}</p>}
        </div>
      )}
    </>
  );

  const shell = { title, eyebrow, eyebrowClip: true, back };
  if (state.status === 'loading') return <Screen {...shell} actions={cancel}><LoadingState /></Screen>;
  if (state.status === 'error') return <Screen {...shell} actions={cancel}><LoadError onRetry={() => void reload()} /></Screen>;

  const info = (
    <PopoverButton id="import-info" icon="info" attention={notes.length > 0} label={t.import.infoLabel}>
      <span class="popover-line popover-lead" data-testid="review-tally">{tally.join(' · ')}</span>
      {notes.length > 0 && (
        <span class="pdf-notes" data-testid="pdf-notes">
          {notes.map((note) => <span key={note} class="popover-line">{note}</span>)}
        </span>
      )}
    </PopoverButton>
  );

  return (
    <Screen {...shell} actions={<>{info}{cancel}</>}>
      <div class="form review-commit">
        {!pdf && targetField}
        {error && <p class="status-error" role="alert">{error}</p>}
        {problems.length > 0 && <p class="form-hint">{t.import.waiting(formatCount(problems.length))}</p>}
        <div class="review-actions">
          {pdf && (
            <button type="button" class="btn" aria-expanded={settingsOpen} aria-controls="pdf-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
              <span>{t.import.pdfSettings}</span>
              <span class={`disclosure-mark ${settingsOpen ? 'disclosure-mark-open' : ''}`}><Icon name="forward" /></span>
            </button>
          )}
          <button type="button" class="btn btn-primary" disabled={problems.length > 0 || saving === 0} onClick={askToCommit}>{t.import.commit(formatCount(saving))}</button>
        </div>
        {pdf && (
          <div id="pdf-settings" class="form review-settings" hidden={!settingsOpen}>
            <PdfSettings source={source} info={pdf.info} collections={pdf.collections} nameMissing={nameMissing && !pdf.collections.pdfName.trim()} onChange={pdf.onCollections} />
            {targetField}
          </div>
        )}
      </div>

      <div class="review-toolbar">
        <fieldset class="segmented" aria-label={t.import.filterLabel}>
          {([...['problems' as const], ...(canWarn ? ['warnings' as const] : []), 'all' as const]).map((option) => (
            <label key={option}>
              <input ref={activeFilter === option ? filterRadio : null} type="radio" name="review-filter" value={option} checked={activeFilter === option} onChange={() => chooseFilter(option)} />
              <span>{option === 'all' ? t.import.filterAll : option === 'warnings' ? `${t.import.filterWarnings} (${formatCount(warned.length)})` : `${t.import.filterProblems} (${formatCount(problems.length)})`}</span>
            </label>
          ))}
        </fieldset>
        {problems.length > 0 && <button type="button" class="btn btn-small btn-quiet" onClick={excludeProblems}>{t.import.excludeProblems}</button>}
      </div>

      {visible.length === 0 ? (
        <p class="review-empty">{activeFilter === 'warnings' ? t.import.noWarnings : t.import.noProblems}</p>
      ) : (
        <ul class="list">
          {visible.slice(0, shown).map((row) => <ReviewItem key={row.draft.id} row={row} validation={validationOf(row)} issues={issuesOf(row)} onChange={(change) => patch(row.draft.id, change)} />)}
        </ul>
      )}
      {visible.length > shown && <button type="button" class="btn btn-quiet btn-block" onClick={() => setShown(shown + PAGE)}>{t.common.more}</button>}

      {confirming && (
        <ConfirmDialog
          title={t.import.confirmTitle(formatCount(saving))}
          body={
            <dl class="summary">
              <dt>{t.import.confirmCreate}</dt>
              <dd>{formatCount(counts.create)}</dd>
              <dt>{t.import.confirmExisting}</dt>
              <dd>{formatCount(counts.existing)}</dd>
              <dt>{t.import.confirmRepeat}</dt>
              <dd>{formatCount(counts.repeat)}</dd>
              <dt>{t.import.confirmSkip}</dt>
              <dd>{formatCount(excluded)}</dd>
              {warned.length > 0 && (
                <>
                  <dt>{t.import.confirmWarnings}</dt>
                  <dd>{formatCount(warned.length)}</dd>
                </>
              )}
            </dl>
          }
          confirmLabel={t.common.save}
          busy={busy}
          onConfirm={() => void commit()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {children}
    </Screen>
  );
}
