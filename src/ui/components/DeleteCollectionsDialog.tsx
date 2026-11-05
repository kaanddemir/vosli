import { useEffect, useRef, useState } from 'preact/hooks';
import { deleteGroups, deleteGroupsWithWords, previewGroupDeletion } from '../../data/groups';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { useDb } from '../dbContext';
import { useLoad } from '../useLoad';
import { ConfirmDialog } from './Modal';

/**
 * The one way collections are deleted, from a collection's page or from a selection. Keeping the words is
 * what is chosen until the learner says otherwise, and only the words counted here can be deleted.
 */
export function DeleteCollectionsDialog({ title, groupIds, onDeleted, onCancel }: { title: string; groupIds: readonly string[]; onDeleted: () => void | Promise<void>; onCancel: () => void }) {
  const db = useDb();
  const { state } = useLoad(() => previewGroupDeletion(db, groupIds), [db]);
  const [withWords, setWithWords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const warning = useRef<HTMLParagraphElement>(null);

  // On a small screen the warning may start below the fold. It must be read before the button beside it is pressed.
  useEffect(() => {
    if (withWords) warning.current?.scrollIntoView({ block: 'nearest' });
  }, [withWords]);

  if (state.status === 'loading') return null;
  const preview = state.status === 'ready' ? state.data : null;
  const ownCount = preview?.ownWordIds.length ?? 0;

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (withWords && preview) await deleteGroupsWithWords(db, groupIds, preview.ownWordIds);
      else await deleteGroups(db, groupIds);
      await onDeleted();
    } catch (error) {
      console.error(error);
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={title}
      body={
        <>
          <fieldset class="delete-options">
            <legend class="visually-hidden">{t.collections.deleteChoice}</legend>
            <label class="check-row">
              <input type="radio" name="delete-choice" checked={!withWords} disabled={busy} onChange={() => setWithWords(false)} />
              <span class="row-text">
                <span class="row-title">{t.collections.deleteOnlyCollections}</span>
                <span class="row-detail">{t.collections.deleteOnlyDetail}</span>
              </span>
            </label>
            <label class={`check-row ${ownCount === 0 ? 'check-row-off' : ''}`}>
              <input type="radio" name="delete-choice" checked={withWords} disabled={busy || ownCount === 0} onChange={() => setWithWords(true)} />
              <span class="row-text">
                <span class="row-title">{t.collections.deleteWithWords}</span>
                <span class="row-detail" data-testid="delete-counts">
                  {ownCount === 0 ? t.collections.deleteNoOwnWords : t.collections.deleteWithWordsDetail(formatCount(ownCount))}
                </span>
              </span>
            </label>
          </fieldset>
          {(preview?.sharedCount ?? 0) > 0 && <p class="form-hint" data-testid="delete-shared">{t.collections.deleteShared(formatCount(preview!.sharedCount))}</p>}
          {withWords && <p ref={warning} class="dialog-warning delete-warning">{t.collections.deleteForever}</p>}
        </>
      }
      confirmLabel={withWords ? t.collections.deleteForeverConfirm : t.common.delete}
      error={failed ? t.collections.deleteFailed : null}
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  );
}
