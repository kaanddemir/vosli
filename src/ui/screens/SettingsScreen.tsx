import { useEffect, useRef, useState } from 'preact/hooks';
import { loadArticleColors, saveArticleColors } from '../../articleColors';
import { exportBackupText, parseBackup, restoreBackup, type BackupError, type BackupFile } from '../../data/backup';
import { getLastBackupAt } from '../../data/repository';
import { resetAllData, saveResetNotice } from '../../data/reset';
import type { TableName } from '../../data/schema';
import { formatCount, formatDateTime } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { loadThemePreference, saveThemePreference, type ThemePreference } from '../../theme';
import { List, Row } from '../components/List';
import { ConfirmDialog } from '../components/Modal';
import { Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { hrefFor } from '../router';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function downloadText(text: string, now: number): void {
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `vosli-yedek-${stamp}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One plain sentence per kind of problem. Record ids and table names mean nothing to the learner. */
function describeErrors(errors: readonly BackupError[]): string {
  return [...new Set(errors.map((error) => t.restore.errors[error.code]))].join(' · ');
}

interface Pending {
  backup: BackupFile;
  counts: Record<TableName, number>;
}

export function SettingsScreen() {
  const db = useDb();
  const [theme, setTheme] = useState(loadThemePreference);
  const [articleColors, setArticleColors] = useState(loadArticleColors);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreInProgress = useRef(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const resetInProgress = useRef(false);
  const closedByApp = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    void getLastBackupAt(db).then(setLastBackup);
  }, [db]);

  useEffect(() => {
    if (pending) {
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      closedByApp.current = true;
      dialog.current.close();
      restoreButton.current?.focus();
    }
  }, [pending]);

  const download = async () => {
    const now = Date.now();
    downloadText(await exportBackupText(db, now), now);
    setLastBackup(now);
  };

  const onDownload = async () => {
    try {
      await download();
      setStatus({ text: t.settings.downloaded, error: false });
    } catch {
      setStatus({ text: t.settings.downloadFailed, error: true });
    }
  };

  const onFileChosen = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (parsed.ok) {
      setStatus(null);
      setPending({ backup: parsed.backup, counts: parsed.counts });
    } else {
      console.warn('Backup rejected', parsed.errors);
      setStatus({ text: `${t.restore.rejected} ${describeErrors(parsed.errors)}`, error: true });
    }
  };

  const onConfirmRestore = async () => {
    // A ref, because a double click fires twice before state can update.
    if (!pending || restoreInProgress.current) return;
    restoreInProgress.current = true;
    setRestoring(true);
    try {
      await download();
      await restoreBackup(db, pending.backup);
      setLastBackup(await getLastBackupAt(db));
      setStatus({ text: t.restore.done, error: false });
    } catch {
      setStatus({ text: t.restore.failed, error: true });
    }
    restoreInProgress.current = false;
    setRestoring(false);
    setPending(null);
  };

  const onConfirmReset = async () => {
    // A ref, because a double click fires twice before state can update.
    if (resetInProgress.current) return;
    resetInProgress.current = true;
    setResetting(true);
    setResetFailed(false);
    try {
      saveResetNotice(await resetAllData(db));
      // A fresh start leaves no screen, cache or theme from before. The dialog stays busy until then.
      // Not location.hash: Home would open first, for a moment, and use up the notice.
      history.replaceState(null, '', hrefFor('home'));
      location.reload();
    } catch (error) {
      console.warn('Reset failed', error);
      resetInProgress.current = false;
      setResetting(false);
      setResetFailed(true);
    }
  };

  return (
    <Screen title={t.settings.title} back={{ href: hrefFor('home'), label: t.nav.home, compactOnly: true }}>
      <List label={t.settings.appearance}>
        <li class="list-item">
          <div class="row row-wrap">
            <span class="row-title" id="theme-label">{t.settings.theme}</span>
            <fieldset class="segmented" aria-labelledby="theme-label">
              {THEMES.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    checked={theme === option}
                    onChange={() => {
                      setTheme(option);
                      saveThemePreference(option);
                    }}
                  />
                  <span>{t.settings.themes[option]}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </li>
        <li class="list-item">
          <label class="row switch-row">
            <span class="row-text">
              <span class="row-title">{t.settings.articleColors}</span>
              {/* A live sample, so the choice shows what it does before leaving Settings. */}
              <span class="row-detail" lang="de" aria-hidden="true">
                <span class="article-der">der</span>{' · '}<span class="article-die">die</span>{' · '}<span class="article-das">das</span>
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              checked={articleColors}
              data-testid="article-colors"
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setArticleColors(on);
                saveArticleColors(on);
              }}
            />
          </label>
        </li>
      </List>

      <List
        label={t.settings.backup}
        footer={<p class={`list-footer ${status?.error ? 'status-error' : status ? 'status-ok' : ''}`} role="status">{status?.text}</p>}
      >
        <Row title={t.settings.lastBackup} value={lastBackup === null ? t.settings.never : formatDateTime(lastBackup)} valueTestId="last-backup" />
        <Row action icon="download" title={t.settings.download} onClick={onDownload} />
        <Row action icon="upload" title={t.settings.restore} onClick={() => fileInput.current?.click()} buttonRef={restoreButton} />
      </List>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label={t.settings.restore} onChange={onFileChosen} />

      <List label={t.settings.dataManagement}>
        <Row action icon="trash" title={t.settings.reset} onClick={() => setResetDialog(true)} />
      </List>

      <List label={t.settings.sources}>
        <li class="list-item">
          <div class="row source-credit">
            <span class="row-text">
              <span class="row-title">{t.settings.dictionaryData}</span>
              <span class="row-detail">
                <a href="https://de.wiktionary.org/" target="_blank" rel="noopener noreferrer">{t.settings.dictionarySource}</a>
                {' · '}
                <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">{t.settings.dictionaryLicense}</a>
              </span>
            </span>
          </div>
        </li>
        <li class="list-item">
          <div class="row source-credit">
            <span class="row-text">
              <span class="row-title">{t.settings.pronunciationData}</span>
              <span class="row-detail">
                <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">{t.settings.pronunciationSource}</a>
                {' · '}
                {t.settings.pronunciationLicenses}
              </span>
              <span class="row-detail" data-testid="pronunciation-privacy">{t.settings.pronunciationPrivacy}</span>
            </span>
          </div>
        </li>
      </List>

      <dialog
        ref={dialog}
        aria-labelledby="restore-title"
        onCancel={(event) => restoring && event.preventDefault()}
        onClose={() => {
          // The close event arrives later. If the app closed the dialog, another file may
          // already be waiting for confirmation, and this late event must not cancel it.
          if (closedByApp.current) {
            closedByApp.current = false;
            return;
          }
          setPending(null);
          restoreButton.current?.focus();
        }}
      >
        {pending && (
          <div class="dialog-body">
            <h2 id="restore-title">{t.restore.title}</h2>
            <dl class="summary">
              <dt class="muted">{t.restore.from}</dt>
              <dd>{formatDateTime(pending.backup.exportedAt)}</dd>
              <dt class="muted">{t.restore.words}</dt>
              <dd>{formatCount(pending.counts.words)}</dd>
              <dt class="muted">{t.restore.cards}</dt>
              <dd>{formatCount(pending.counts.cards)}</dd>
              <dt class="muted">{t.restore.logs}</dt>
              <dd>{formatCount(pending.counts.reviewLogs)}</dd>
              <dt class="muted">{t.restore.groups}</dt>
              <dd>{formatCount(pending.counts.groups)}</dd>
            </dl>
            <p class="dialog-warning">{t.restore.warning}</p>
            <div class="btn-row">
              <button type="button" class="btn" disabled={restoring} onClick={() => setPending(null)}>{t.common.cancel}</button>
              <button type="button" class="btn btn-primary" disabled={restoring} onClick={onConfirmRestore}>{t.restore.confirm}</button>
            </div>
          </div>
        )}
      </dialog>

      {resetDialog && (
        <ConfirmDialog
          title={t.settings.resetTitle}
          body={<p class="dialog-warning">{t.settings.resetBody}</p>}
          confirmLabel={t.settings.resetConfirm}
          error={resetFailed ? t.settings.resetFailed : null}
          busy={resetting}
          onConfirm={() => void onConfirmReset()}
          onCancel={() => {
            setResetFailed(false);
            setResetDialog(false);
          }}
        />
      )}
    </Screen>
  );
}
