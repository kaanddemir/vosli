import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AUTOCORRECT_OFF } from '../inputProps';
import { searchWords } from '../../core/search';
import { listActiveWords } from '../../data/repository';
import { deleteWords } from '../../data/words';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { Icon } from '../components/Icon';
import { EmptyFox } from '../components/EmptyFox';
import { ConfirmDialog } from '../components/Modal';
import { SelectionBar } from '../components/SelectionBar';
import { EmptyState, LoadError, LoadingState, Screen } from '../components/Screen';
import { WordList } from '../components/WordList';
import { useDb } from '../dbContext';
import { loadDictionaryView, saveDictionaryView, type DictionaryView } from '../dictionaryView';
import { hrefFor, hrefForNewWord } from '../router';
import { useLoad } from '../useLoad';

type Filter = 'all' | 'favorites';
const FILTERS: readonly Filter[] = ['all', 'favorites'];

export function DictionaryScreen() {
  const db = useDb();
  const { state, reload } = useLoad(() => listActiveWords(db), [db]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const selectButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(loadDictionaryView);
  // Rows uncovered one by one. Only while this screen is open, and never once the cover or the direction changes.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const changeView = (change: Partial<DictionaryView>) => {
    const next = { ...view, ...change };
    setView(next);
    saveDictionaryView(next);
    setRevealed(new Set());
  };
  const refocus = useRef(false);

  const words = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (filter === 'favorites' ? (words ?? []).filter((word) => word.favoritedAt !== null) : (words ?? [])), [words, filter]);
  const results = useMemo(() => searchWords(shown, query), [shown, query]);
  const searching = query.trim() !== '';
  // A word deleted elsewhere is no longer chosen, so the counts stay exact.
  const selected = useMemo(() => chosen && new Set((words ?? []).filter((word) => chosen.has(word.id)).map((word) => word.id)), [chosen, words]);
  const allResultsSelected = selected !== null && results.length > 0 && results.every((word) => selected.has(word.id));
  // A choice stays through a new search or filter, so it can be built up, and the dialog says if some are out of sight.
  const outOfSight = selected ? selected.size - results.filter((word) => selected.has(word.id)).length : 0;

  const toggleAll = () => {
    const next = new Set(selected);
    for (const word of results) {
      if (allResultsSelected) next.delete(word.id);
      else next.add(word.id);
    }
    setChosen(next);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await deleteWords(db, [...(selected ?? [])]);
      await reload();
      refocus.current = true;
      setConfirming(false);
      setChosen(null);
    } catch (error) {
      console.error(error);
      setDeleteFailed(true);
    }
    setDeleting(false);
  };

  // The button that opened the dialog has gone with the selection, so focus returns to the one that began it.
  useEffect(() => {
    if (refocus.current && !confirming) {
      refocus.current = false;
      selectButton.current?.focus();
    }
  }, [confirming]);

  const clear = () => {
    setQuery('');
    input.current?.focus();
  };

  const headerButtons = (
    <div class="header-buttons">
      {/* Ways of looking at the list. Choosing words to delete shows both sides, so they step aside meanwhile. */}
      {!selected && (
        <>
          <button
            type="button"
            class="btn btn-small btn-square btn-toggle"
            aria-pressed={view.direction === 'tr_de'}
            aria-label={t.dictionary.direction}
            title={t.dictionary.direction}
            data-testid="dictionary-direction"
            onClick={() => changeView({ direction: view.direction === 'tr_de' ? 'de_tr' : 'tr_de' })}
          >
            <Icon name="arrow-left-right" />
          </button>
          <button
            type="button"
            class="btn btn-small btn-square btn-toggle"
            aria-pressed={view.hidden}
            aria-label={t.dictionary.hideAnswers}
            title={t.dictionary.hideAnswers}
            data-testid="dictionary-hide"
            onClick={() => changeView({ hidden: !view.hidden })}
          >
            <Icon name={view.hidden ? 'eye-off' : 'eye'} />
          </button>
        </>
      )}
      {/* One button that changes its label, so focus stays on it. Only its icon shows in a narrow header. */}
      <button ref={selectButton} type="button" class={selected ? 'btn btn-small' : 'btn btn-small btn-icon-compact'} {...(selected ? {} : { 'aria-label': t.common.select, title: t.common.select })} onClick={() => setChosen(selected ? null : new Set())}>
        {!selected && <span class="btn-mark"><Icon name="select" /></span>}
        <span class="btn-label">{selected ? t.common.cancel : t.common.select}</span>
      </button>
      {!selected && (
        <a class="btn btn-small btn-icon-compact" href={hrefForNewWord()} aria-label={t.dictionary.addWord} title={t.dictionary.addWord}>
          <Icon name="plus" />
          <span class="btn-label">{t.dictionary.addWord}</span>
        </a>
      )}
    </div>
  );

  return (
    <Screen title={t.dictionary.title} eyebrow={words?.length ? t.common.words(formatCount(words.length)) : undefined} actions={words?.length ? headerButtons : undefined}>
      {selected && (
        <SelectionBar count={selected.size} canSelectAll={results.length > 1} allSelected={allResultsSelected} actionLabel={t.common.delete} onToggleAll={toggleAll} onAction={() => setConfirming(true)} />
      )}
      <div class="search">
        <Icon name="search" />
        <label class="visually-hidden" for="dictionary-search">{t.dictionary.searchLabel}</label>
        <input
          ref={input}
          id="dictionary-search"
          class="search-input"
          type="search"
          value={query}
          placeholder={t.dictionary.search}
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          autocorrect={AUTOCORRECT_OFF}
          spellcheck={false}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button type="button" class="icon-btn search-clear" aria-label={t.dictionary.clear} title={t.dictionary.clear} onClick={clear}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {words && words.length > 0 && (
        <div class="filter-row">
          <fieldset class="segmented" aria-label={t.dictionary.filterLabel}>
            {FILTERS.map((option) => (
              <label key={option}>
                <input type="radio" name="dictionary-filter" value={option} checked={filter === option} onChange={() => setFilter(option)} />
                <span>{option === 'all' ? t.dictionary.filterAll : t.dictionary.filterFavorites}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <p class="visually-hidden" role="status">{searching && words ? t.dictionary.results(formatCount(results.length)) : ''}</p>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <LoadError onRetry={() => void reload()} />}
      {words && words.length === 0 && !searching && (
        <EmptyState title={t.dictionary.emptyTitle} support={t.dictionary.emptySupport} art={<EmptyFox scene="book" />}>
          <div class="empty-actions">
            <a class="btn btn-primary" href={hrefForNewWord()}>{t.dictionary.addWord}</a>
            <a class="btn" href={hrefFor('import')}>{t.nav.import}</a>
          </div>
        </EmptyState>
      )}
      {words && searching && results.length === 0 && <EmptyState title={t.dictionary.noResults(query.trim())} />}
      {words && words.length > 0 && !searching && results.length === 0 && <EmptyState title={t.dictionary.noFavorites} support={t.dictionary.noFavoritesSupport} art={<EmptyFox scene="heart" />} />}
      {/* Keyed by what is shown, so a new search or filter starts again from the first page. */}
      {results.length > 0 && (
        <WordList
          key={`${filter}:${query}`}
          words={results}
          view={{ direction: view.direction, hidden: view.hidden, revealed, onReveal: (word) => setRevealed(new Set(revealed).add(word.id)) }}
          selection={
            selected
              ? {
                  ids: selected,
                  onToggle: (word, on) => {
                    const next = new Set(selected);
                    if (on) next.add(word.id);
                    else next.delete(word.id);
                    setChosen(next);
                  },
                }
              : undefined
          }
        />
      )}
      {confirming && selected && (
        <ConfirmDialog
          title={t.dictionary.bulkDeleteTitle(formatCount(selected.size))}
          body={
            <>
              <p class="dialog-warning">{t.dictionary.bulkDeleteBody}</p>
              {outOfSight > 0 && <p class="form-hint" data-testid="delete-hidden">{t.dictionary.bulkDeleteHidden(formatCount(outOfSight))}</p>}
            </>
          }
          confirmLabel={t.collections.deleteForeverConfirm}
          error={deleteFailed ? t.collections.deleteFailed : null}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleteFailed(false);
            setConfirming(false);
          }}
        />
      )}
    </Screen>
  );
}
