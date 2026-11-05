import { useEffect, useState } from 'preact/hooks';
import { loadValidator, peekValidator } from '../../dictionary/loadDictionary';
import { getLastBackupAt, isBackupDue } from '../../data/repository';
import { takeResetNotice } from '../../data/reset';
import { loadReviewData, overviewOf, type ReviewOverview } from '../../data/smartReview';
import { formatCount, formatDay } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { HomeScene } from '../components/HomeScene';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { hrefFor } from '../router';

interface Summary extends ReviewOverview {
  backupDue: boolean;
  /**
   * Whether the warnings behind the numbers are known yet. A warning can only lower a count, so while
   * it is still being looked up the screen says what to do next without stating a number.
   */
  checking: boolean;
}

/** A dictionary already in memory answers at once, and a brief wait saves a visible change of title. */
const DICTIONARY_PEEK_MS = 120;
const DICTIONARY_PRELOAD_MS = 2000;

/** The size of the Dictionary. It counts words themselves, so schedules and collections have no say in it. */
const supportFor = (words: number): string => (words === 0 ? t.home.emptySupport : t.home.wordCount(formatCount(words)));

/** A quiet note on what Smart Review holds. Empty while the counts are unknown or there is nothing true to say. */
function statusFor({ due, fresh, flagged, studied, checking }: Summary): string | null {
  if (checking) return null;
  const waiting = [...(due > 0 ? [t.home.dueStatus(formatCount(due))] : []), ...(fresh > 0 ? [t.home.freshStatus(formatCount(fresh))] : [])];
  if (waiting.length > 0) return waiting.join(' · ');
  // Words a warning holds back are named rather than called done. Smart Review is where they are dealt with.
  if (flagged > 0) return t.home.flaggedStatus(formatCount(flagged));
  return studied ? t.home.doneStatus : null;
}

export function HomeScreen() {
  const db = useDb();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [now] = useState(() => Date.now());
  const [resetNotice] = useState(takeResetNotice);

  useEffect(() => {
    let active = true;
    let preload = 0;
    void (async () => {
      const lastBackupAt = await getLastBackupAt(db);
      const show = (overview: ReviewOverview, checking: boolean) => {
        if (active) setSummary({ ...overview, checking, backupDue: isBackupDue(overview.words, lastBackupAt, now) });
      };
      const stored = await loadReviewData(db, null);
      // An empty library has nothing to check, and a stored result for exactly these words is as good as a new one.
      if (stored.words.length === 0 || stored.checked) {
        const overview = overviewOf(stored, now);
        show(overview, false);
        // So that opening a session does not have to wait for it. Parsing takes a moment, so not while the screen is settling.
        if (overview.due + overview.fresh > 0) preload = window.setTimeout(() => void loadValidator(), DICTIONARY_PRELOAD_MS);
        return;
      }
      const quick = await peekValidator(DICTIONARY_PEEK_MS);
      if (quick === undefined) show(overviewOf(stored, now), true);
      // Null means the dictionary could not load. A session then holds nothing back either, so the numbers still match it.
      const validate = quick === undefined ? await loadValidator() : quick;
      if (active) show(overviewOf(await loadReviewData(db, validate), now), false);
    })();
    return () => {
      active = false;
      clearTimeout(preload);
    };
  }, [db, now]);

  const settings = (
    <a class="icon-btn only-compact" href={hrefFor('settings')} aria-label={t.nav.settings} title={t.nav.settings}>
      <Icon name="settings" />
    </a>
  );
  const status = summary && statusFor(summary);

  return (
    <Screen title={null} actions={settings} width="stage">
      {/* Nothing is drawn until the counts are known, so the statement never swaps or jumps. */}
      {summary && (
        <div class="today">
          <p class="eyebrow">{formatDay(now)}</p>
          <h1 class="today-title">{t.home.title}</h1>
          <p class="today-support">{supportFor(summary.words)}</p>
          {summary.words === 0 ? (
            // Both need words. They are shown, but only Import can be pressed, so only it carries the accent.
            <div class="today-actions">
              <button type="button" class="btn btn-block" disabled>{t.home.smartReview}</button>
              <div class="today-secondary">
                <button type="button" class="btn" disabled>{t.home.freePractice}</button>
                <a class="btn btn-primary" href={hrefFor('import')}>{t.nav.import}</a>
              </div>
            </div>
          ) : (
            <div class="today-actions">
              <a class="btn btn-primary btn-block" href={hrefFor('review')}>{t.home.smartReview}</a>
              <div class="today-secondary">
                <a class="btn" href={hrefFor('practice')}>{t.home.freePractice}</a>
                <a class="btn" href={hrefFor('import')}>{t.nav.import}</a>
              </div>
            </div>
          )}
          <div class="today-status">{status && <p>{status}</p>}</div>
          {summary.backupDue && (
            <a class="today-reminder" href={hrefFor('settings')}>
              <span>{t.home.backupDue}</span>
              <Icon name="forward" />
            </a>
          )}
          {resetNotice && (
            <p class={`today-notice ${resetNotice === 'partial' ? 'status-error' : 'status-ok'}`} role="status">
              {resetNotice === 'partial' ? t.settings.resetPartial : t.settings.resetDone}
            </p>
          )}
          <HomeScene />
        </div>
      )}
    </Screen>
  );
}
