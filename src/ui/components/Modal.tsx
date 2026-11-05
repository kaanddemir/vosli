import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/strings';

/**
 * A native modal dialog. It exists only while open, so no close event can arrive late, and it
 * returns focus to whatever opened it. Escape closes it, unless busy.
 */
export function Modal({ titleId, onClose, busy = false, children }: { titleId: string; onClose: () => void; busy?: boolean; children: ComponentChildren }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => opener?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
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
