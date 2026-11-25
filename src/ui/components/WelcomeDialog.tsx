import { useEffect, useRef, useState } from 'preact/hooks';
import { LEARNING_LANGUAGES, type LearningLanguage } from '../../core/learningLanguage';
import { applyLocale, currentLocale, DOCUMENT_LANG, LOCALE_NAMES, type Locale } from '../../i18n/locale';
import { t } from '../../i18n/strings';

export interface WelcomeChoice {
  locale: Locale;
  language: LearningLanguage;
}

/** The interface languages in the order the welcome offers them: English, the default, first. */
const WELCOME_LOCALES: readonly Locale[] = ['en', 'tr', 'de'];

/**
 * The first-start choice, over the real Home screen: the interface language and the language to learn, two separate
 * questions. Trying an interface language translates the dialog at once, but only Continue saves it. Nothing closes
 * the dialog except finishing it: not Escape, not the backdrop, not a browser's repeated Escape.
 */
export function WelcomeDialog({ onDone }: { onDone: (choice: WelcomeChoice) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const finished = useRef(false);
  const [locale, setLocale] = useState<Locale>(currentLocale);
  const [language, setLanguage] = useState<LearningLanguage | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Where supported, the browser offers no way to close it at all.
    element.setAttribute('closedby', 'none');
    element.showModal();
    // The chosen interface language holds the focus, so the first arrow key moves between languages.
    element.querySelector<HTMLInputElement>('input[name="welcome-locale"]:checked')?.focus();
  }, []);

  const tryLocale = (next: Locale) => {
    setLocale(next);
    setFailed(false);
    applyLocale(next);
  };

  const finish = async () => {
    if (!language || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onDone({ locale, language });
      finished.current = true;
    } catch (error) {
      console.warn('Could not save the first-start choice', error);
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      class="welcome-dialog"
      aria-labelledby="welcome-title"
      onCancel={(event) => event.preventDefault()}
      onClose={() => {
        // Some browsers close a dialog on a second Escape whatever the page says. It comes straight back.
        if (!finished.current) dialog.current?.showModal();
      }}
    >
      <div class="dialog-body">
        <img class="welcome-fox" src="./icons/vosli-mark.svg" alt="" />
        <h2 id="welcome-title">{t.welcome.title}</h2>
        <div class="welcome-group">
          <span class="welcome-label" id="welcome-interface">{t.welcome.interface}</span>
          <fieldset class="segmented segmented-full" aria-labelledby="welcome-interface">
            {WELCOME_LOCALES.map((option) => (
              <label key={option}>
                <input type="radio" name="welcome-locale" value={option} checked={locale === option} disabled={saving} onChange={() => tryLocale(option)} />
                {/* Each name in its own language, and read in that language. */}
                <span lang={DOCUMENT_LANG[option]}>{LOCALE_NAMES[option]}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div class="welcome-group">
          <span class="welcome-label" id="welcome-learning">{t.welcome.learning}</span>
          <fieldset class="segmented segmented-full" aria-labelledby="welcome-learning">
            {LEARNING_LANGUAGES.map((option) => (
              <label key={option}>
                <input type="radio" name="welcome-language" value={option} checked={language === option} disabled={saving} onChange={() => setLanguage(option)} />
                <span>{t.lang[option].name}</span>
              </label>
            ))}
          </fieldset>
        </div>
        {failed && <p class="status-error" role="alert">{t.welcome.failed}</p>}
        <button type="button" class="btn btn-primary" disabled={!language || saving} onClick={() => void finish()} data-testid="welcome-continue">
          {t.welcome.continue}
        </button>
      </div>
    </dialog>
  );
}
