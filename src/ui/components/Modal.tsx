import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/strings';

/**
 * A native modal dialog. It exists only while open, and it returns focus to whatever opened it. Escape closes it,
 * unless busy. The browser may also close it by itself (Chrome does, for Escape pressed again without a click in
 * between, with no cancel event first): that is Escape too, so the screen hears of it and never holds a dialog it
 * thinks is open. Its own closing, as it leaves the page, says nothing.
 */
export function Modal({ titleId, onClose, busy = false, children }: { titleId: string; onClose: () => void; busy?: boolean; children: ComponentChildren }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leaving = useRef(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    // Closed before the focus goes back: while a modal dialog is open, everything behind it refuses focus, and the
    // dialog is still in the page when this runs.
    return () => {
      leaving.current = true;
      if (node?.open) node.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (leaving.current) return;
        // Busy work cannot be left: the dialog comes straight back.
        if (busy) dialog.current?.showModal();
        else onClose();
      }}
    >
      <div class="dialog-body">{children}</div>
    </dialog>
  );
}

/** Cancel comes first, so it holds the initial focus and Enter never confirms by accident. */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = t.common.cancel, error, busy = false, onConfirm, onCancel }: { title: string; body?: ComponentChildren; confirmLabel: string; cancelLabel?: string; error?: string | null; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal titleId="confirm-title" onClose={onCancel} busy={busy}>
      <h2 id="confirm-title">{title}</h2>
      {body}
      {error && <p class="status-error" role="alert">{error}</p>}
      <div class="btn-row">
        <button type="button" class="btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" class="btn btn-primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
