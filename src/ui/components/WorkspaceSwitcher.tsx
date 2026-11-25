import { useId, useState } from 'preact/hooks';
import { LEARNING_LANGUAGES, type LearningLanguage } from '../../core/learningLanguage';
import { t } from '../../i18n/strings';
import { hrefFor } from '../router';
import { useIsBusy, useWorkspace } from '../workspace';
import { ConfirmDialog } from './Modal';

/**
 * The learning-language row of Settings, built like the interface-language row above it: two real radio buttons, so
 * arrow keys and screen readers work as everywhere else. The two settings never decide each other. Choosing the other
 * language asks first, because the whole app changes under the learner; the radio keeps showing the open workspace
 * until they confirm, and Cancel leaves everything as it was. A confirmed choice is saved, and Home opens on it.
 * While something would be lost, such as a study session or an unsaved edit, it waits, and says why.
 * The welcome and a restored backup choose the language their own way, so neither ever sees this question.
 */
export function WorkspaceSwitcher() {
  const { language, switchTo } = useWorkspace();
  const busy = useIsBusy();
  const id = useId();
  const [asked, setAsked] = useState<LearningLanguage | null>(null);
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = () => {
    setAsked(null);
    setFailed(false);
  };

  const confirm = (next: LearningLanguage) => {
    setSwitching(true);
    setFailed(false);
    switchTo(next)
      .then((switched) => {
        setSwitching(false);
        setAsked(null);
        if (switched) location.hash = hrefFor('home');
      })
      .catch((error: unknown) => {
        console.warn('Could not switch the learning language', error);
        setSwitching(false);
        setFailed(true);
      });
  };

  return (
    <li class="list-item" data-testid="workspace-switcher">
      <div class="row row-wrap">
        <span class="row-text workspace-text">
          <span class="row-title" id={`${id}-label`}>{t.workspace.label}</span>
          {/* Said only when it matters: while switching waits for work elsewhere. */}
          {busy && <span class="row-detail" id={`${id}-hint`}>{t.workspace.busy}</span>}
        </span>
        <fieldset class="segmented" aria-labelledby={`${id}-label`} aria-describedby={busy ? `${id}-hint` : undefined} disabled={busy}>
          {LEARNING_LANGUAGES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`${id}-language`}
                value={option}
                checked={language === option}
                onChange={(event) => {
                  // Not chosen yet: the open workspace stays selected until the dialog is confirmed.
                  event.currentTarget.checked = false;
                  if (option !== language) setAsked(option);
                }}
              />
              <span>{t.lang[option].name}</span>
            </label>
          ))}
        </fieldset>
      </div>
      {asked && (
        <ConfirmDialog
          title={t.lang[asked].switchTitle}
          body={<p>{t.lang[asked].switchKeeps}</p>}
          confirmLabel={t.workspace.switch}
          error={failed ? t.common.saveFailed : null}
          busy={switching}
          onConfirm={() => confirm(asked)}
          onCancel={close}
        />
      )}
    </li>
  );
}
