import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AUTOCORRECT_OFF } from '../inputProps';
import { searchWords } from '../../core/search';
import { addWordsToGroup, canRename, createCustomGroup, GROUP_NAME_MAX, GroupNameError, removeWordsFromGroup, renameGroup, restoreGroupMembers, type GroupNameProblem } from '../../data/groups';
import { getGroupWithWords, listActiveWords, listGroupSummaries, listGroupWordIds } from '../../data/repository';
import type { Group, GroupKind, GroupMember, Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { DeleteCollectionsDialog } from '../components/DeleteCollectionsDialog';
import { EmptyFox } from '../components/EmptyFox';
import { Icon } from '../components/Icon';
import { List, Row } from '../components/List';
import { Modal } from '../components/Modal';
import { EmptyState, LoadError, LoadingState, Screen } from '../components/Screen';
import { SelectionBar } from '../components/SelectionBar';
import { GermanWord, meaningsOf, wordLabel } from '../components/WordList';
import { WordList } from '../components/WordList';
import { useDb } from '../dbContext';
import { hrefFor, hrefForGroup, hrefForNewWord } from '../router';
import { useLoad } from '../useLoad';

const KINDS: readonly GroupKind[] = ['pdf', 'lesson', 'custom'];

/** Names a new list, or renames a list or a PDF collection. */
function NameDialog({ title, label, initial, takenMessage = t.collections.nameErrors.taken, onSubmit, onClose }: { title: string; label: string; initial: string; takenMessage?: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<GroupNameProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(name);
    } catch (error) {
      if (error instanceof GroupNameError) setProblem(error.problem);
      else {
        console.error(error);
        setFailed(true);
      }
      setBusy(false);
    }
  };

  return (
    <Modal titleId="name-title" onClose={onClose} busy={busy}>
      <h2 id="name-title">{title}</h2>
      <form
        class="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="form-field">
          <label class="form-label" for="group-name">{label}</label>
          <input
            id="group-name"
            class="field"
            type="text"
            value={name}
            maxLength={GROUP_NAME_MAX}
            autocomplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'group-name-error' : undefined}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setProblem(null);
            }}
          />
          {problem && <p id="group-name-error" class="form-error">{problem === 'taken' ? takenMessage : t.collections.nameErrors[problem]}</p>}
        </div>
        {failed && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
        <div class="btn-row">
          <button type="button" class="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" class="btn btn-primary" disabled={busy}>{t.common.save}</button>
        </div>
      </form>
    </Modal>
  );
}

export function CollectionsScreen() {
  const db = useDb();
  const { state, reload } = useLoad(() => listGroupSummaries(db), [db]);
  const [creating, setCreating] = useState(false);
  const groups = state.status === 'ready' ? state.data : null;
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const allSelected = selected?.size === groups?.length;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const newList = (primary: boolean) => (
    <button type="button" class={primary ? 'btn btn-primary' : 'btn btn-small btn-icon-compact'} {...(primary ? {} : { 'aria-label': t.collections.create, title: t.collections.create })} onClick={() => setCreating(true)}>
      {!primary && <Icon name="plus" />}
      <span class="btn-label">{t.collections.create}</span>
    </button>
  );

  return (
    <Screen
      title={t.collections.title}
      eyebrow={groups?.length ? t.collections.count(formatCount(groups.length)) : undefined}
      actions={
        groups?.length ? (
          <div class="header-buttons">
            {/* One button that changes its label, so focus stays on it. */}
            <button type="button" class={selected ? 'btn btn-small' : 'btn btn-small btn-icon-compact'} {...(selected ? {} : { 'aria-label': t.common.select, title: t.common.select })} onClick={() => setSelected(selected ? null : new Set())}>
              {!selected && <span class="btn-mark"><Icon name="select" /></span>}
              <span class="btn-label">{selected ? t.common.cancel : t.common.select}</span>
            </button>
            {!selected && newList(false)}
            {!selected && (
              <a class="btn btn-small btn-icon-compact" href={hrefFor('import')} aria-label={t.nav.import} title={t.nav.import}>
                <Icon name="upload" />
                <span class="btn-label">{t.nav.import}</span>
              </a>
            )}
          </div>
        ) : undefined
      }
    >
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <LoadError onRetry={() => void reload()} />}
      {groups?.length === 0 && (
        <EmptyState title={t.collections.emptyTitle} support={t.collections.emptySupport} art={<EmptyFox scene="box" />}>
          <div class="empty-actions">
            {newList(true)}
            <a class="btn" href={hrefFor('import')}>{t.nav.import}</a>
          </div>
        </EmptyState>
      )}
      {selected && groups && (
        <SelectionBar
          count={selected.size}
          canSelectAll={groups.length > 1}
          allSelected={allSelected}
          onToggleAll={() => setSelected(allSelected ? new Set() : new Set(groups.map(({ group }) => group.id)))}
          actionLabel={t.common.delete}
          onAction={() => setConfirming(true)}
        />
      )}
      {KINDS.map((kind) => {
        const ofKind = groups?.filter(({ group }) => group.kind === kind) ?? [];
        return (
          ofKind.length > 0 && (
            <List key={kind} label={t.collections.kinds[kind]}>
              {ofKind.map(({ group, wordCount }) =>
                selected ? (
                  <li key={group.id} class="list-item">
                    <label class="check-row select-row">
                      <input type="checkbox" checked={selected.has(group.id)} onChange={(event) => toggle(group.id, event.currentTarget.checked)} />
                      <span class="row-text"><span class="row-title">{group.name}</span></span>
                      <span class="row-value">{formatCount(wordCount)}</span>
                    </label>
                  </li>
                ) : (
                  <Row key={group.id} title={group.name} value={formatCount(wordCount)} href={hrefForGroup(group.id)} />
                ),
              )}
            </List>
          )
        );
      })}
      {confirming && selected && (
        <DeleteCollectionsDialog
          title={t.collections.bulkDeleteTitle(formatCount(selected.size))}
          groupIds={[...selected]}
          onDeleted={async () => {
            await reload();
            setConfirming(false);
            setSelected(null);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {creating && (
        <NameDialog
          title={t.collections.create}
          label={t.collections.listName}
          initial=""
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const group = await createCustomGroup(db, name, Date.now());
            location.hash = hrefForGroup(group.id);
          }}
        />
      )}
    </Screen>
  );
}

/** Chooses words to add to a list. Words already in it are not offered. */
function WordPicker({ group, onClose, onAdded }: { group: Group; onClose: () => void; onAdded: () => void }) {
  const db = useDb();
  const { state, reload } = useLoad(async () => {
    const [words, inGroup] = await Promise.all([listActiveWords(db), listGroupWordIds(db, group.id)]);
    const present = new Set(inGroup);
    return words.filter((word) => !present.has(word.id));
  }, [db, group.id]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(100);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const words = state.status === 'ready' ? state.data : null;
  const results = useMemo(() => searchWords(words ?? [], query), [words, query]);

  const toggle = (word: Word, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(word.id);
    else next.delete(word.id);
    setSelected(next);
  };

  const add = async () => {
    setBusy(true);
    try {
      await addWordsToGroup(db, group.id, [...selected], Date.now());
      onAdded();
    } catch (error) {
      console.error(error);
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Modal titleId="picker-title" onClose={onClose} busy={busy}>
      <h2 id="picker-title">{t.collections.addWordsTitle(group.name)}</h2>
      {state.status === 'error' && <LoadError onRetry={() => void reload()} />}
      {words?.length === 0 && <p class="form-hint">{t.collections.allAdded}</p>}
      {words && words.length > 0 && (
        <>
          <div class="search search-static">
            <Icon name="search" />
            <label class="visually-hidden" for="picker-search">{t.dictionary.searchLabel}</label>
            <input
              id="picker-search"
              class="search-input"
              type="search"
              value={query}
              placeholder={t.dictionary.search}
              enterkeyhint="search"
              autocomplete="off"
              autocapitalize="off"
              autocorrect={AUTOCORRECT_OFF}
              spellcheck={false}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setShown(100);
              }}
            />
          </div>
          <div class="list dialog-list">
            {results.length === 0 && <p class="dialog-list-empty">{t.dictionary.noResults(query.trim())}</p>}
            <ul class="check-list">
              {results.slice(0, shown).map((word) => (
                <li key={word.id}>
                  <label class="check-row">
                    <input type="checkbox" checked={selected.has(word.id)} onChange={(event) => toggle(word, event.currentTarget.checked)} />
                    <span class="row-text">
                      <span class="row-title" lang="de"><GermanWord word={word} /></span>
                      <span class="row-detail" lang="tr">{meaningsOf(word)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {results.length > shown && <button type="button" class="btn btn-quiet btn-block" onClick={() => setShown(shown + 100)}>{t.common.more}</button>}
          </div>
        </>
      )}
      {failed && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
      {/* A word not in the dictionary yet is made in the usual form, with this list already ticked. */}
      <a class="btn btn-quiet btn-block" href={hrefForNewWord(group.id)}>
        <Icon name="plus" />
        <span>{t.collections.createWord}</span>
      </a>
      <div class="btn-row">
        <button type="button" class="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button>
        <button type="button" class="btn btn-primary" disabled={busy || selected.size === 0} onClick={() => void add()}>{t.collections.addSelected(formatCount(selected.size))}</button>
      </div>
    </Modal>
  );
}

type GroupDialog = 'add' | 'rename' | 'delete' | null;

/**
 * One collection. A list can be renamed, given words and have words taken out; a PDF collection can only be
 * renamed; a lesson is read-only. Any of them can be deleted. Taking words out is a selection, as elsewhere,
 * and only ever removes them from this list: the words, their other collections and their progress stay.
 */
export function GroupScreen({ groupId }: { groupId: string }) {
  const db = useDb();
  const { state, reload } = useLoad(() => getGroupWithWords(db, groupId), [db, groupId]);
  const [dialog, setDialog] = useState<GroupDialog>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [removed, setRemoved] = useState<{ members: GroupMember[]; label: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const back = { href: hrefFor('collections'), label: t.nav.collections };

  const words = state.status === 'ready' ? state.data?.words ?? null : null;
  // A word gone from the list in the meantime is no longer chosen, so the count stays exact.
  const selected = useMemo(() => chosen && new Set((words ?? []).filter((word) => chosen.has(word.id)).map((word) => word.id)), [chosen, words]);

  // The bar that held the action has gone with the selection, so focus returns to the button that began it.
  useEffect(() => {
    if (refocus.current && !selected) {
      refocus.current = false;
      selectButton.current?.focus();
    }
  }, [selected]);

  if (state.status === 'loading') return <Screen title={null} back={back} />;
  if (state.status === 'error') return <Screen title={t.collections.title} back={back}><LoadError onRetry={() => void reload()} /></Screen>;
  if (!state.data) return <Screen title={t.collections.notFound} back={back}><EmptyState title={t.collections.notFound} /></Screen>;

  const { group } = state.data;
  const list = state.data.words;
  const custom = group.kind === 'custom';
  const allSelected = selected !== null && list.length > 0 && selected.size === list.length;

  const removeSelected = async () => {
    if (!selected || selected.size === 0 || busy) return;
    const chosenWords = list.filter((word) => selected.has(word.id));
    setBusy(true);
    setFailed(false);
    try {
      const members = await removeWordsFromGroup(db, group.id, chosenWords.map((word) => word.id));
      const only = members.length === 1 ? chosenWords.find((word) => word.id === members[0]!.wordId) : undefined;
      setRemoved(members.length ? { members, label: only ? t.collections.removed(wordLabel(only)) : t.collections.removedMany(formatCount(members.length)) } : null);
      await reload();
      refocus.current = true;
      setChosen(null);
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    setBusy(false);
  };

  const undo = async () => {
    if (!removed) return;
    setFailed(false);
    try {
      await restoreGroupMembers(db, removed.members);
      setRemoved(null);
      await reload();
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
  };

  const addButton = (primary: boolean) => (
    <button type="button" class={primary ? 'btn btn-primary' : 'btn btn-small btn-icon-compact'} {...(primary ? {} : { 'aria-label': t.collections.addWords, title: t.collections.addWords })} onClick={() => setDialog('add')}>
      {!primary && <Icon name="plus" />}
      <span class="btn-label">{t.collections.addWords}</span>
    </button>
  );

  const headerButtons =
    custom && list.length > 0 ? (
      <div class="header-buttons">
        {/* One button that changes its label, so focus stays on it. */}
        <button ref={selectButton} type="button" class={selected ? 'btn btn-small' : 'btn btn-small btn-icon-compact'} {...(selected ? {} : { 'aria-label': t.common.select, title: t.common.select })} onClick={() => setChosen(selected ? null : new Set())}>
          {!selected && <span class="btn-mark"><Icon name="select" /></span>}
          <span class="btn-label">{selected ? t.common.cancel : t.common.select}</span>
        </button>
        {!selected && addButton(false)}
      </div>
    ) : undefined;

  return (
    <Screen title={group.name} eyebrow={`${t.collections.kind[group.kind]} · ${t.common.words(formatCount(list.length))}`} back={back} actions={headerButtons}>
      {selected && (
        <SelectionBar
          count={selected.size}
          canSelectAll={list.length > 1}
          allSelected={allSelected}
          actionLabel={t.collections.removeSelected}
          onToggleAll={() => setChosen(allSelected ? new Set() : new Set(list.map((word) => word.id)))}
          onAction={() => void removeSelected()}
        />
      )}
      <p class="list-footer status-line" role="status">
        {removed && (
          <>
            <span>{removed.label}</span>
            <button type="button" class="link-btn" onClick={() => void undo()}>{t.common.undo}</button>
          </>
        )}
      </p>
      {failed && dialog === null && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
      {list.length === 0 ? (
        <EmptyState title={t.collections.emptyGroup}>
          {custom && (
            <div class="empty-actions">
              {addButton(true)}
              <a class="btn" href={hrefForNewWord(group.id)}>{t.collections.createWord}</a>
            </div>
          )}
        </EmptyState>
      ) : (
        <WordList
          words={list}
          groupId={group.id}
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
      {!selected && (
        <List>
          {canRename(group) && <Row action icon="edit" title={custom ? t.collections.renameList : t.collections.renameCollection} onClick={() => setDialog('rename')} />}
          <Row action icon="trash" title={custom ? t.collections.deleteList : t.collections.deleteCollection} onClick={() => setDialog('delete')} />
        </List>
      )}

      {dialog === 'add' && (
        <WordPicker
          group={group}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            setRemoved(null);
            void reload();
          }}
        />
      )}
      {dialog === 'rename' && (
        <NameDialog
          title={custom ? t.collections.renameList : t.collections.renameCollection}
          label={custom ? t.collections.listName : t.collections.collectionName}
          initial={group.name}
          {...(custom ? {} : { takenMessage: t.collections.pdfNameTaken })}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameGroup(db, group.id, name);
            setDialog(null);
            await reload();
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteCollectionsDialog
          title={t.collections.deleteTitle(group.name)}
          groupIds={[group.id]}
          onDeleted={() => location.replace(back.href)}
          onCancel={() => setDialog(null)}
        />
      )}
    </Screen>
  );
}
