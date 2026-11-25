import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { player } from '../audio/pronunciation';
import type { LearningLanguage } from '../core/learningLanguage';
import { MigrationFailedError, NewerSchemaError, openDatabase, type AppDatabase } from '../data/db';
import { completeOnboarding, readLearningLanguage, readOnboarding, saveLearningLanguage } from '../data/learningMeta';
import { currentLocale, onLocaleChange, saveLocale } from '../i18n/locale';
import { t } from '../i18n/strings';
import { reloadWhenResetElsewhere } from '../data/reset';
import { requestPersistence } from '../storage';
import { Shell } from './components/Shell';
import { DbContext } from './dbContext';
import { WelcomeDialog, type WelcomeChoice } from './components/WelcomeDialog';
import { hrefFor, usePlace, type Place } from './router';
import { announceWorkspaceChange, isBusy, onBusyChange, onWorkspaceChangeElsewhere, useBusy, WorkspaceContext } from './workspace';
import { CollectionsScreen, GroupScreen } from './screens/CollectionsScreen';
import { DictionaryScreen } from './screens/DictionaryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WordEditScreen, WordNewScreen } from './screens/WordFormScreen';
import { WordScreen } from './screens/WordScreen';

type DbState = { status: 'opening' } | { status: 'ready'; db: AppDatabase; language: LearningLanguage; onboarded: boolean } | { status: 'error'; message: string };

/** The active workspace and whether the first-start choice is settled, as meta says now. */
async function readWorkspace(db: AppDatabase): Promise<{ language: LearningLanguage; onboarded: boolean }> {
  const [language, onboarding] = await Promise.all([readLearningLanguage(db), readOnboarding(db)]);
  return { language, onboarded: onboarding !== null };
}

/** A word or collection belongs to one workspace. After a switch its section's list opens instead. */
function sectionAfterSwitch(place: Place): string | null {
  if (place.route === 'group') return hrefFor('collections');
  if (place.route === 'word' || place.route === 'wordEdit' || place.route === 'wordNew') return hrefFor(place.groupId ? 'collections' : 'dictionary');
  return null;
}

function messageFor(error: unknown): string {
  if (error instanceof NewerSchemaError) return t.dbError.newer;
  if (error instanceof MigrationFailedError) return t.dbError.migration;
  return t.dbError.storage;
}

function CurrentScreen({ place }: { place: Place }) {
  switch (place.route) {
    case 'dictionary':
      return <DictionaryScreen />;
    case 'word':
      return <WordScreen key={place.wordId} wordId={place.wordId!} groupId={place.groupId} />;
    case 'wordNew':
      return <WordNewScreen key={place.groupId ?? ''} groupId={place.groupId} />;
    case 'wordEdit':
      return <WordEditScreen key={place.wordId} wordId={place.wordId!} groupId={place.groupId} />;
    case 'collections':
      return <CollectionsScreen />;
    case 'group':
      return <GroupScreen key={place.groupId} groupId={place.groupId!} />;
    case 'practice':
      return <PracticeScreen />;
    case 'review':
      return <ReviewScreen />;
    case 'import':
      return <ImportScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <HomeScreen />;
  }
}

export function App() {
  const place = usePlace();
  const [state, setState] = useState<DbState>({ status: 'opening' });
  // Every screen reads its text while rendering, so rendering again from here is all a language change needs.
  // Nothing is remounted: focus, scroll and anything typed stay where they were.
  const [, setLocale] = useState(currentLocale);
  useEffect(() => onLocaleChange(setLocale), []);

  useEffect(() => {
    let active = true;
    openDatabase({ onClosedByUpgrade: () => setState({ status: 'error', message: t.dbError.closed }) })
      .then(async (db) => {
        const workspace = await readWorkspace(db);
        if (!active) return db.close();
        setState({ status: 'ready', db, ...workspace });
        void requestPersistence();
      })
      .catch((error: unknown) => active && setState({ status: 'error', message: messageFor(error) }));
    return () => {
      active = false;
    };
  }, []);

  useEffect(reloadWhenResetElsewhere, []);

  const db = state.status === 'ready' ? state.db : null;
  const language = state.status === 'ready' ? state.language : 'de';
  const onboarded = state.status === 'ready' && state.onboarded;
  const apply = useCallback((next: { language: LearningLanguage; onboarded: boolean }) => setState((current) => (current.status === 'ready' ? { ...current, ...next } : current)), []);

  // A study session holds its workspace: its screens have no menu, and a change from another tab waits for it.
  useBusy(place.route === 'practice' || place.route === 'review');

  // Another tab switched or finished the welcome. Applied at once, or as soon as nothing here would be lost.
  useEffect(() => {
    if (!db) return;
    let pending = false;
    const follow = async () => {
      if (isBusy()) {
        pending = true;
        return;
      }
      pending = false;
      apply(await readWorkspace(db));
    };
    const stopBusy = onBusyChange(() => {
      if (pending && !isBusy()) void follow();
    });
    const stopChannel = onWorkspaceChangeElsewhere(() => void follow());
    return () => {
      stopBusy();
      stopChannel();
    };
  }, [db, apply]);

  // A record of one language never shows in another: leave it for its section's list. A recording of the language
  // left behind stops too, here or switched from another tab, so it never plays on in the other workspace.
  // Counted from the workspace the app opened in, not the German it shows while the database opens, so an English
  // word's own address still opens that word.
  const shown = useRef<LearningLanguage | null>(null);
  useEffect(() => {
    if (!db) return;
    if (shown.current === null) shown.current = language;
    if (shown.current === language) return;
    shown.current = language;
    player().stop();
    const to = sectionAfterSwitch(place);
    if (to) location.hash = to;
  }, [db, language, place]);

  const switchTo = useCallback(
    async (next: LearningLanguage) => {
      if (!db || next === language || isBusy()) return false;
      await saveLearningLanguage(db, next);
      announceWorkspaceChange();
      apply({ language: next, onboarded: true });
      return true;
    },
    [db, language, apply],
  );
  const workspace = useMemo(() => ({ language, switchTo }), [language, switchTo]);

  const finishWelcome = async (choice: WelcomeChoice) => {
    if (!db) return;
    await completeOnboarding(db, choice.language, Date.now());
    // The interface language is saved only once the welcome is: until then it was tried, not chosen.
    saveLocale(choice.locale);
    announceWorkspaceChange();
    apply(await readWorkspace(db));
  };

  if (state.status === 'opening') return <p class="loading muted" role="status">{t.appName}</p>;

  if (state.status === 'error') {
    return (
      <main class="app-main app-main-alone">
        <div class="screen screen-content" role="alert">
          <h1>{t.dbError.title}</h1>
          <p data-testid="db-error">{state.message}</p>
          <button type="button" class="btn btn-primary" onClick={() => location.reload()}>{t.common.reload}</button>
        </div>
      </main>
    );
  }

  // Until the first-start choice is made, the welcome sits over Home, whatever address the page opened at.
  const shownPlace: Place = onboarded ? place : { route: 'home' };
  return (
    <DbContext.Provider value={state.db}>
      <WorkspaceContext.Provider value={workspace}>
        <Shell place={shownPlace}>
          {/* Keyed by language, so a switch starts every screen over with the other workspace's data. */}
          <CurrentScreen key={language} place={shownPlace} />
        </Shell>
        {!onboarded && <WelcomeDialog onDone={finishWelcome} />}
      </WorkspaceContext.Provider>
    </DbContext.Provider>
  );
}
