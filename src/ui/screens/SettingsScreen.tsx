import { useEffect, useRef, useState } from 'preact/hooks';
import { loadArticleColors, saveArticleColors } from '../../articleColors';
import { LEARNING_LANGUAGES, type LearningLanguage } from '../../core/learningLanguage';
import { exportBackupText, parseBackup, restoreBackup, type BackupContents, type BackupError, type BackupFile } from '../../data/backup';
import { countLibrary, getLastBackupAt, type LanguageCounts } from '../../data/repository';
import { afterDataReplaced, resetAllData, saveResetNotice } from '../../data/reset';
import { formatCount, formatDateTime, formatFileStamp } from '../../i18n/format';
import { currentLocale, LOCALE_NAMES, LOCALE_STORAGE_KEY, LOCALES, DOCUMENT_LANG, saveLocale, savedLocale } from '../../i18n/locale';
import { t } from '../../i18n/strings';
import { loadThemePreference, saveThemePreference, type ThemePreference } from '../../theme';
import { List, Row } from '../components/List';
import { ConfirmDialog } from '../components/Modal';
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher';
import { Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { hrefFor } from '../router';
import { useLearningLanguage } from '../workspace';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function downloadText(text: string, now: number): void {
  // Local time, as the computer's clock shows it: the backup itself stores the moment in UTC (exportedAt).
  const stamp = formatFileStamp(now);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  // Only the name follows the interface language. The file inside is the same either way, and restores under both.
  link.download = t.settings.backupFileName(stamp);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One plain sentence per kind of problem. Record ids and table names mean nothing to the learner. */
function describeErrors(errors: readonly BackupError[]): string {
  return [...new Set(errors.map((error) => t.restore.errors[error.code]))].join(' · ');
}

interface Pending {
  backup: BackupFile;
  contents: BackupContents;
  /** What the device holds now, read when the backup was chosen. A restore replaces it whatever it is. */
  current: LanguageCounts;
}

/** Languages whose words would all be gone: some now, none in the backup. */
const emptiedBy = ({ contents, current }: Pending): LearningLanguage[] => LEARNING_LANGUAGES.filter((language) => current.words[language] > 0 && contents.words[language] === 0);

export function SettingsScreen() {
  const db = useDb();
  // Article colors are about der, die and das, so only a German workspace offers them. The choice is kept either way.
  const german = useLearningLanguage() === 'de';
  const [theme, setTheme] = useState(loadThemePreference);
  const [articleColors, setArticleColors] = useState(loadArticleColors);
  const locale = currentLocale();
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
      try {
        setPending({ backup: parsed.backup, contents: parsed.contents, current: await countLibrary(db) });
      } catch (error) {
        // Without what is on the device now there is nothing honest to compare, so nothing is offered.
        console.warn('Could not count current data', error);
        setStatus({ text: t.restore.failed, error: true });
      }
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
    } catch {
      setStatus({ text: t.restore.failed, error: true });
      restoreInProgress.current = false;
      setRestoring(false);
      setPending(null);
      return;
    }
    // Every screen, saved session and other tab was built on the data just replaced, so all of them start over,
    // as after a reset. The dialog stays busy until the reload; Home then says the backup was restored.
    afterDataReplaced();
    saveResetNotice('restored');
    history.replaceState(null, '', hrefFor('home'));
    location.reload();
  };

  const onConfirmReset = async () => {
    // A ref, because a double click fires twice before state can update.
    if (resetInProgress.current) return;
    resetInProgress.current = true;
    setResetting(true);
    setResetFailed(false);
    try {
      // The chosen interface language stays, so the empty app and its notice are in a language the learner reads.
      saveResetNotice(await resetAllData(db, savedLocale() ? [LOCALE_STORAGE_KEY] : []));
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
      <List label={t.settings.language}>
        <li class="list-item">
          <div class="row row-wrap">
            <span class="row-title" id="language-label">{t.settings.appLanguage}</span>
            <fieldset class="segmented" aria-labelledby="language-label">
              {LOCALES.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="language"
                    value={option}
                    checked={locale === option}
                    onChange={() => {
                      // A message written in the old language would stay behind otherwise.
                      setStatus(null);
                      saveLocale(option);
                    }}
                  />
                  {/* Each name in its own language, and read in that language. */}
                  <span lang={DOCUMENT_LANG[option]}>{LOCALE_NAMES[option]}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </li>
        <WorkspaceSwitcher />
      </List>

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
        {german && (
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
        )}
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

      {/* The same two rows in both workspaces. Both come from the same German Wiktionary dump: for German, the
          dictionary that checks words and the recording each one plays; for English, which has no dictionary, only
          the recording list. The recordings themselves are on Wikimedia Commons, under their own licenses. */}
      <List label={t.settings.sources}>
        <li class="list-item">
          <div class="row source-credit">
            <span class="row-text">
              <span class="row-title">{german ? t.settings.dictionaryData : t.settings.recordingList}</span>
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
        aria-describedby="restore-replaces"
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
            </dl>
            <div class="restore-compare-box">
            {/* Explicit roles, so the table stays a table to assistive technology when a narrow screen stacks it. */}
            <table class="restore-compare" role="table" data-testid="restore-compare">
              <caption class="visually-hidden">{t.restore.compare}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">{t.restore.data}</th>
                  <th scope="col" role="columnheader">{t.restore.current}</th>
                  <th scope="col" role="columnheader">{t.restore.backup}</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {(
                  [
                    [t.restore.germanWords, pending.current.words.de, pending.contents.words.de],
                    [t.restore.englishWords, pending.current.words.en, pending.contents.words.en],
                    [t.restore.groups, pending.current.groups, pending.contents.groups],
                    [t.restore.logs, pending.current.reviewLogs, pending.contents.reviewLogs],
                  ] as const
                ).map(([label, now, after]) => (
                  <tr key={label} role="row">
                    <th scope="row" role="rowheader">{label}</th>
                    <td role="cell" data-label={t.restore.current}>{formatCount(now)}</td>
                    <td role="cell" data-label={t.restore.backup}>{formatCount(after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p class="dialog-warning" id="restore-replaces">{t.restore.replaces}</p>
            <p class="dialog-warning" data-testid="restore-continue">{t.lang[pending.contents.learningLanguage].continueIn}</p>
            {emptiedBy(pending).map((language) => (
              <p key={language} class="dialog-warning status-error" data-testid="restore-removed">{t.restore.removed(pending.current.words[language], language)}</p>
            ))}
            <p class="dialog-warning muted">{t.restore.safetyCopy}</p>
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
