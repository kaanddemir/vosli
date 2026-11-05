import Dexie from 'dexie';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AUTOCORRECT_OFF } from '../inputProps';
import type { Article } from '../../core/identity';
import { SEPARATE } from '../../core/review';
import { phaseOf } from '../../core/scheduling/fsrs';
import { affectedTracks } from '../../core/scheduling/invalidation';
import { dismissalKey, openIssues, UNCHECKED, type Suggestion, type Validation } from '../../core/issues';
import type { Validate } from '../../core/validation';
import { ARTICLES, parseArticle, splitArticle, splitMeanings, validateFields, type DraftError, type WordDraft } from '../../core/vocabulary';
import { addDismissals, readDismissals } from '../../data/dismissals';
import { loadValidator } from '../../dictionary/loadDictionary';
import { getActiveWord, listCustomGroups } from '../../data/repository';
import type { Group, Word } from '../../data/types';
import { addWord, DuplicateWordError, updateWord, type AddOutcome } from '../../data/words';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { GroupChecks } from '../components/GroupChecks';
import { PopoverButton } from '../components/PopoverButton';
import { IssueList, validationText } from '../components/Validation';
import { EmptyState, LoadError, LoadingState, Screen } from '../components/Screen';
import { meaningsOf, wordLabel } from '../components/WordList';
import { useDb } from '../dbContext';
import { hrefFor, hrefForWord } from '../router';
import { useLoad } from '../useLoad';

const LETTERS = ['ä', 'ö', 'ü', 'ß'] as const;
type ArticleChoice = Article | 'none';
const ARTICLE_CHOICES: readonly ArticleChoice[] = ['none', ...ARTICLES];

type Conflict = Extract<AddOutcome, { kind: 'conflict' }>['found'];

interface FormValues {
  german: string;
  article: ArticleChoice;
  turkish: string;
  plural: string;
}

interface WordFormProps {
  initial: FormValues;
  groups?: readonly Group[];
  cancelHref: string;
  /** What saving these values would do to learning progress, if anything. */
  noteFor?: (draft: WordDraft) => string | null;
  /** Returns a reason it could not save, or nothing after moving on. */
  onSave: (draft: WordDraft, groupIds: readonly string[], choice: string | null) => Promise<Conflict | { duplicate: Word } | void>;
}

/** Waits for a pause in typing, because a half-typed word is not a mistake. */
const CHECK_DELAY_MS = 350;

function useWordCheck(german: string, article: string, turkish: string) {
  const db = useDb();
  const [validate, setValidate] = useState<Validate | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [validation, setValidation] = useState<Validation>(UNCHECKED);

  useEffect(() => {
    let live = true;
    void Promise.all([loadValidator(), readDismissals(db)]).then(([validator, stored]) => {
      if (!live) return;
      setDismissed(stored);
      setValidate(() => validator);
    });
    return () => {
      live = false;
    };
  }, [db]);

  useEffect(() => {
    if (!validate) return;
    const timer = setTimeout(() => setValidation(validate(german, article, turkish)), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [validate, german, article, turkish]);

  const issues = openIssues(validation, german, article, dismissed);
  const accept = () => {
    const keys = issues.map((item) => dismissalKey(item.code, german, article));
    setDismissed(new Set([...dismissed, ...keys]));
    void addDismissals(db, keys);
  };
  return { validation, issues, accept };
}

const placeForWord = (id: string, groupId?: string) => location.replace(hrefForWord(id, groupId));

function WordForm({ initial, groups = [], cancelHref, noteFor, onSave }: WordFormProps) {
  const [values, setValues] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<readonly DraftError[]>([]);
  const [conflict, setConflict] = useState<Conflict | { duplicate: Word } | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const germanInput = useRef<HTMLInputElement>(null);
  const turkishInput = useRef<HTMLInputElement>(null);
  const conflictPanel = useRef<HTMLDivElement>(null);

  const check = useWordCheck(values.german, values.article === 'none' ? '' : values.article, values.turkish);
  const typed = values.german.trim() !== '';
  const checkNote = typed && check.issues.length === 0 && check.validation.status !== 'verified' && check.validation.status !== 'unchecked' && check.validation.status !== 'mismatch' ? validationText(check.validation) : '';

  const saveNote = noteFor?.({ lemma: values.german, article: values.article === 'none' ? null : values.article, meanings: splitMeanings(values.turkish), plural: null }) ?? null;

  const change = (patch: Partial<FormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setConflict(null);
    setFailed(false);
  };

  /** der Apfel typed into the word field is the article and the word. */
  const adoptArticle = (current: FormValues): FormValues => {
    if (current.article !== 'none') return current;
    const split = splitArticle(current.german);
    return split.article ? { ...current, german: split.lemma, article: split.article } : current;
  };

  const insertLetter = (letter: string) => {
    const input = germanInput.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    change({ german: `${input.value.slice(0, start)}${letter}${input.value.slice(end)}` });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + letter.length, start + letter.length);
    });
  };

  useEffect(() => {
    if (conflict) conflictPanel.current?.focus();
  }, [conflict]);

  const submit = async (choice: string | null) => {
    const current = adoptArticle(values);
    setValues(current);
    const article = current.article === 'none' ? '' : current.article;
    const found = validateFields(current.german, article, current.turkish, current.plural);
    setErrors(found);
    if (found.includes('german_missing') || found.includes('too_long')) return germanInput.current?.focus();
    if (found.length) return turkishInput.current?.focus();

    setSaving(true);
    setFailed(false);
    try {
      const draft: WordDraft = { lemma: current.german, article: parseArticle(article) ?? null, meanings: splitMeanings(current.turkish), plural: current.plural.trim() || null };
      setConflict((await onSave(draft, [...selected], choice)) ?? null);
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    setSaving(false);
  };

  const germanError = errors.find((error) => error === 'german_missing' || error === 'too_long');
  const turkishError = errors.includes('turkish_missing');

  return (
    <form
      class="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit(null);
      }}
    >
      <fieldset class="form-field">
        <legend class="form-label">{t.wordForm.article}</legend>
        <div class="segmented segmented-full">
          {ARTICLE_CHOICES.map((choice) => (
            <label key={choice}>
              <input type="radio" name="article" value={choice} checked={values.article === choice} onChange={() => change({ article: choice })} />
              <span lang={choice === 'none' ? 'tr' : 'de'}>{choice === 'none' ? t.wordForm.noArticle : choice}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div class="form-field">
        <div class="field-head">
          <label class="form-label" for="word-german">{t.wordForm.german}</label>
          {typed && check.issues.length > 0 && (
            <PopoverButton id="word-check" icon="warning" attention label={t.validation.label(values.german.trim())}>
              <IssueList
                issues={check.issues}
                onApply={(suggestion: Suggestion) => {
                  germanInput.current?.focus();
                  change({ german: suggestion.german, article: suggestion.article ?? 'none' });
                }}
              >
              <button
                type="button"
                class="btn btn-small"
                onClick={() => {
                  germanInput.current?.focus();
                  check.accept();
                }}
              >
                {t.import.warningAccept}
              </button>
              </IssueList>
            </PopoverButton>
          )}
        </div>
        <input
          ref={germanInput}
          id="word-german"
          class="field"
          type="text"
          lang="de"
          value={values.german}
          maxLength={140}
          autocomplete="off"
          autocapitalize="off"
          autocorrect={AUTOCORRECT_OFF}
          spellcheck={false}
          aria-invalid={germanError ? true : undefined}
          aria-describedby={germanError ? 'word-german-error' : undefined}
          onInput={(event) => change({ german: event.currentTarget.value })}
          onBlur={() => setValues(adoptArticle)}
        />
        {germanError && <p id="word-german-error" class="form-error">{t.wordForm.errors[germanError]}</p>}
        {checkNote && <p class="form-hint" data-testid="word-check-note">{checkNote}</p>}
        <div class="letters" role="group" aria-label={t.wordForm.letters}>
          {LETTERS.map((letter) => (
            <button key={letter} type="button" class="letter" lang="de" aria-label={t.wordForm.insert(letter)} onPointerDown={(event) => event.preventDefault()} onClick={() => insertLetter(letter)}>{letter}</button>
          ))}
        </div>
      </div>

      <div class="form-field">
        <label class="form-label" for="word-turkish">{t.wordForm.turkish}</label>
        <input
          ref={turkishInput}
          id="word-turkish"
          class="field"
          type="text"
          lang="tr"
          value={values.turkish}
          maxLength={320}
          autocomplete="off"
          aria-invalid={turkishError ? true : undefined}
          aria-describedby={turkishError ? 'word-turkish-error word-turkish-hint' : 'word-turkish-hint'}
          onInput={(event) => change({ turkish: event.currentTarget.value })}
        />
        {turkishError && <p id="word-turkish-error" class="form-error">{t.wordForm.errors.turkish_missing}</p>}
        <p id="word-turkish-hint" class="form-hint">{t.wordForm.turkishHint}</p>
      </div>

      {values.article !== 'none' && (
        <div class="form-field">
          <label class="form-label" for="word-plural">{t.wordForm.plural}</label>
          <input id="word-plural" class="field" type="text" lang="de" value={values.plural} maxLength={120} autocomplete="off" autocapitalize="off" autocorrect={AUTOCORRECT_OFF} spellcheck={false} onInput={(event) => change({ plural: event.currentTarget.value })} />
        </div>
      )}

      {groups.length > 0 && (
        <fieldset class="form-field">
          <legend class="form-label">{t.wordForm.lists}</legend>
          <div class="list">
            <GroupChecks groups={groups} selected={selected} onChange={setSelected} />
          </div>
        </fieldset>
      )}

      {conflict && (
        <div ref={conflictPanel} class="conflict" role="alert" tabIndex={-1}>
          <ConflictBody conflict={conflict} hasLists={selected.size > 0} saving={saving} onChoose={(choice) => void submit(choice)} />
        </div>
      )}
      {failed && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
      {saveNote && <p class="form-hint" role="status" data-testid="word-reset-note">{saveNote}</p>}

      <div class="btn-row">
        <a class="btn" href={cancelHref}>{t.common.cancel}</a>
        <button type="submit" class="btn btn-primary" disabled={saving}>{t.common.save}</button>
      </div>
    </form>
  );
}

function ConflictBody({ conflict, hasLists, saving, onChoose }: { conflict: Conflict | { duplicate: Word }; hasLists: boolean; saving: boolean; onChoose: (choice: string) => void }) {
  if ('duplicate' in conflict) {
    return (
      <>
        <p class="conflict-title">{t.wordForm.exists}</p>
        <a class="conflict-word" lang="de" href={hrefForWord(conflict.duplicate.id)}>{wordLabel(conflict.duplicate)}</a>
      </>
    );
  }
  if (conflict.kind === 'existing') {
    const { entry, newMeanings } = conflict;
    return (
      <>
        <p class="conflict-title">{newMeanings.length ? t.wordForm.existsNewMeaning(newMeanings.join(', ')) : t.wordForm.exists}</p>
        <a class="conflict-word" href={hrefForWord(entry.ref)}>
          <span lang="de">{wordLabel(entry)}</span> <span class="muted" lang="tr">{entry.meanings.join(', ')}</span>
        </a>
        {newMeanings.length > 0 && <button type="button" class="btn btn-small" disabled={saving} onClick={() => onChoose(entry.ref)}>{t.wordForm.addMeaning}</button>}
        {newMeanings.length === 0 && hasLists && <button type="button" class="btn btn-small" disabled={saving} onClick={() => onChoose(entry.ref)}>{t.wordForm.addToLists}</button>}
      </>
    );
  }
  return (
    <>
      <p class="conflict-title">{t.wordForm.reasons[conflict.reason]}</p>
      <ul class="conflict-list">
        {conflict.candidates.map((entry) => (
          <li key={entry.ref} class="conflict-item">
            <a class="conflict-word" href={hrefForWord(entry.ref)}>
              <span lang="de">{wordLabel(entry)}</span> <span class="muted" lang="tr">{entry.meanings.join(', ')}</span>
            </a>
            <button type="button" class="btn btn-small" disabled={saving} onClick={() => onChoose(entry.ref)}>{t.wordForm.join}</button>
          </li>
        ))}
      </ul>
      <button type="button" class="btn btn-small" disabled={saving} onClick={() => onChoose(SEPARATE)}>{t.wordForm.separate}</button>
    </>
  );
}

const BLANK: FormValues = { german: '', article: 'none', turkish: '', plural: '' };

export function WordNewScreen() {
  const db = useDb();
  const { state, reload } = useLoad(() => listCustomGroups(db), [db]);
  const back = { href: hrefFor('dictionary'), label: t.nav.dictionary };

  return (
    <Screen title={t.wordForm.newTitle} back={back}>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <LoadError onRetry={() => void reload()} />}
      {state.status === 'ready' && (
        <WordForm
          initial={BLANK}
          groups={state.data}
          cancelHref={back.href}
          onSave={async (draft, groupIds, choice) => {
            const outcome = await addWord(db, draft, choice, groupIds, Date.now());
            if (outcome.kind === 'conflict') return outcome.found;
            placeForWord(outcome.word.id);
          }}
        />
      )}
    </Screen>
  );
}

export function WordEditScreen({ wordId, groupId }: { wordId: string; groupId?: string | undefined }) {
  const db = useDb();
  const { state, reload } = useLoad(async () => {
    const [word, cards] = await Promise.all([getActiveWord(db, wordId), db.cards.where('[wordId+track]').between([wordId, Dexie.minKey], [wordId, Dexie.maxKey]).toArray()]);
    return word && { word, tracks: new Set(cards.filter((card) => phaseOf(card.fsrs) !== 'new').map((card) => card.track)) };
  }, [db, wordId]);
  const cancelHref = hrefForWord(wordId, groupId);
  const back = { href: cancelHref, label: t.dictionary.notFound };

  if (state.status === 'loading') return <Screen title={t.wordForm.editTitle}><LoadingState /></Screen>;
  if (state.status === 'error') return <Screen title={t.wordForm.editTitle}><LoadError onRetry={() => void reload()} /></Screen>;
  if (!state.data) return <Screen title={t.dictionary.notFound}><EmptyState title={t.dictionary.notFound} /></Screen>;
  const { word, tracks } = state.data;

  return (
    <Screen title={t.wordForm.editTitle} back={{ ...back, label: wordLabel(word) }}>
      <WordForm
        initial={{ german: word.lemma, article: word.article ?? 'none', turkish: meaningsOf(word), plural: word.plural ?? '' }}
        cancelHref={cancelHref}
        noteFor={(draft) => {
          // Half-typed fields are not an edit yet.
          if (!draft.lemma.trim() || draft.meanings.length === 0) return null;
          const lost = affectedTracks(word, { ...draft, meanings: draft.meanings.map((text) => ({ text })) }).filter((track) => tracks.has(track)).length;
          return lost > 0 ? t.wordForm.resetNote(formatCount(lost)) : null;
        }}
        onSave={async (draft) => {
          try {
            await updateWord(db, wordId, draft, Date.now());
          } catch (error) {
            if (error instanceof DuplicateWordError) return { duplicate: error.existing };
            throw error;
          }
          placeForWord(wordId, groupId);
        }}
      />
    </Screen>
  );
}
