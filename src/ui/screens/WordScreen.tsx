import { useState } from 'preact/hooks';
import { createCustomGroup, GROUP_NAME_MAX, GroupNameError, setWordCustomGroups, type GroupNameProblem } from '../../data/groups';
import { getActiveWord, listCustomGroups, listGroupsOfWord, listOriginsOfWord } from '../../data/repository';
import type { Group, Word } from '../../data/types';
import { deleteWord, setFavorite } from '../../data/words';
import { formatCount, formatDate } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { GroupChecks } from '../components/GroupChecks';
import { Icon } from '../components/Icon';
import { List, Row } from '../components/List';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, LoadError, Screen } from '../components/Screen';
import { PronunciationCredit, SpeakerButton } from '../components/SpeakerButton';
import { GermanWord, wordLabel } from '../components/WordList';
import { useDb } from '../dbContext';
import { hrefFor, hrefForGroup, hrefForWordEdit } from '../router';
import { useLoad } from '../useLoad';

function ListsDialog({ word, groups, onClose, onSaved }: { word: Word; groups: readonly Group[]; onClose: () => void; onSaved: () => void }) {
  const db = useDb();
  const customIds = groups.filter((group) => group.kind === 'custom').map((group) => group.id);
  const [selected, setSelected] = useState(new Set(customIds));
  const { state, reload } = useLoad(() => listCustomGroups(db), [db]);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<GroupNameProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const createList = async () => {
    try {
      const group = await createCustomGroup(db, name, Date.now());
      setName('');
      setNameError(null);
      await reload();
      setSelected((current) => new Set(current).add(group.id));
    } catch (error) {
      if (error instanceof GroupNameError) setNameError(error.problem);
      else setFailed(true);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await setWordCustomGroups(db, word.id, [...selected], Date.now());
      onSaved();
    } catch (error) {
      console.error(error);
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Modal titleId="lists-title" onClose={onClose} busy={busy}>
      <h2 id="lists-title">{t.collections.listsOf(wordLabel(word))}</h2>
      {state.status === 'ready' && (state.data.length > 0 ? (
        <div class="list dialog-list">
          <GroupChecks groups={state.data} selected={selected} onChange={setSelected} />
        </div>
      ) : (
        <p class="form-hint">{t.collections.noLists}</p>
      ))}
      <form
        class="inline-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void createList();
        }}
      >
        <label class="form-label" for="new-list-name">{t.collections.newList}</label>
        <div class="inline-form-row">
          <input id="new-list-name" class="field field-compact" type="text" value={name} maxLength={GROUP_NAME_MAX} autocomplete="off" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? 'new-list-error' : undefined} onInput={(event) => setName(event.currentTarget.value)} />
          <button type="submit" class="btn btn-small">{t.common.add}</button>
        </div>
        {nameError && <p id="new-list-error" class="form-error">{t.collections.nameErrors[nameError]}</p>}
      </form>
      {failed && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
      <div class="btn-row">
        <button type="button" class="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button>
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void save()}>{t.common.save}</button>
      </div>
    </Modal>
  );
}

export function WordScreen({ wordId, groupId }: { wordId: string; groupId?: string | undefined }) {
  const db = useDb();
  const [dialog, setDialog] = useState<'delete' | 'lists' | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = groupId ? { href: hrefForGroup(groupId), label: t.nav.collections } : { href: hrefFor('dictionary'), label: t.nav.dictionary };

  const { state, reload } = useLoad(async () => {
    const word = await getActiveWord(db, wordId);
    if (!word) return null;
    const [groups, origins] = await Promise.all([listGroupsOfWord(db, wordId), listOriginsOfWord(db, wordId)]);
    return { word, groups, origins };
  }, [db, wordId]);

  if (state.status === 'loading') return <Screen title={null} back={back} />;
  if (state.status === 'error') return <Screen title={t.nav.dictionary} back={back}><LoadError onRetry={() => void reload()} /></Screen>;
  if (!state.data) return <Screen title={t.dictionary.notFound} back={back}><EmptyState title={t.dictionary.notFound} /></Screen>;

  const { word, groups, origins } = state.data;
  const favorite = word.favoritedAt !== null;
  const favoriteLabel = favorite ? t.dictionary.favoriteOff : t.dictionary.favoriteOn;

  const toggleFavorite = async () => {
    try {
      await setFavorite(db, word.id, !favorite, Date.now());
      await reload();
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteWord(db, word.id);
      location.replace(back.href);
    } catch (error) {
      console.error(error);
      setFailed(true);
      setBusy(false);
    }
  };

  const actions = (
    <>
      <SpeakerButton word={word} />
      <button type="button" class={`icon-btn ${favorite ? 'icon-btn-on' : ''}`} aria-pressed={favorite} aria-label={favoriteLabel} title={favoriteLabel} onClick={() => void toggleFavorite()}>
        <Icon name="star" filled={favorite} />
      </button>
      <a class="icon-btn" href={hrefForWordEdit(word.id, groupId)} aria-label={t.dictionary.edit} title={t.dictionary.edit}>
        <Icon name="edit" />
      </a>
    </>
  );

  return (
    <Screen title={<GermanWord word={word} quiet={false} />} titleLang="de" eyebrow={t.dictionary.pos[word.pos] || undefined} back={back} actions={actions}>
      {failed && dialog === null && <p class="status-error" role="alert">{t.common.saveFailed}</p>}
      <List label={t.dictionary.meanings}>
        {word.meanings.map((meaning, index) => (
          <Row key={index} lang="tr" title={meaning.text} detail={meaning.note ?? undefined} />
        ))}
      </List>
      {word.plural && (
        <List>
          <Row title={t.dictionary.plural} value={<span lang="de">{word.plural}</span>} />
        </List>
      )}
      <List label={t.nav.collections}>
        {groups.map((group) => (
          <Row key={group.id} title={group.name} detail={t.collections.kind[group.kind]} href={hrefForGroup(group.id)} />
        ))}
        <Row action icon="edit" title={t.dictionary.manageLists} onClick={() => setDialog('lists')} />
      </List>
      {origins.length > 0 && (
        <List label={t.dictionary.sources}>
          {origins.map(({ source, pages }) => (
            <Row key={source.id} title={source.fileName || t.dictionary.pastedSource} detail={[pages.length ? t.import.page(pages.map((page) => formatCount(page)).join(', ')) : '', formatDate(source.importedAt)].filter(Boolean).join(' · ')} />
          ))}
        </List>
      )}
      <List>
        <Row action icon="trash" title={t.dictionary.deleteWord} onClick={() => setDialog('delete')} />
      </List>
      <PronunciationCredit word={word} />

      {dialog === 'lists' && (
        <ListsDialog
          word={word}
          groups={groups}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={t.dictionary.deleteTitle(wordLabel(word))}
          body={<p class="dialog-warning">{t.dictionary.deleteBody}</p>}
          confirmLabel={t.common.delete}
          error={failed ? t.common.saveFailed : null}
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setFailed(false);
            setDialog(null);
          }}
        />
      )}
    </Screen>
  );
}
