import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';

/**
 * What a selection mode shows above its rows: how many are chosen, choosing them all, and the one action.
 * The action names what it does, so taking words out of a list can never read as deleting them.
 */
export function SelectionBar({ count, canSelectAll, allSelected, actionLabel, onToggleAll, onAction }: { count: number; canSelectAll: boolean; allSelected: boolean; actionLabel: string; onToggleAll: () => void; onAction: () => void }) {
  return (
    <div class="selection-bar">
      <p class="selection-count" role="status">{t.common.selected(formatCount(count))}</p>
      {canSelectAll && (
        <button type="button" class="link-btn" onClick={onToggleAll}>
          {allSelected ? t.common.clearSelection : t.common.selectAll}
        </button>
      )}
      <button type="button" class="btn btn-small btn-primary" disabled={count === 0} onClick={onAction}>{actionLabel}</button>
    </div>
  );
}
