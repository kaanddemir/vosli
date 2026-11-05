import { useEffect, useState } from 'preact/hooks';
import { MigrationFailedError, NewerSchemaError, openDatabase, type AppDatabase } from '../data/db';
import { t } from '../i18n/strings';
import { reloadWhenResetElsewhere } from '../data/reset';
import { requestPersistence } from '../storage';
import { Shell } from './components/Shell';
import { DbContext } from './dbContext';
import { usePlace, type Place } from './router';
import { CollectionsScreen, GroupScreen } from './screens/CollectionsScreen';
import { DictionaryScreen } from './screens/DictionaryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WordEditScreen, WordNewScreen } from './screens/WordFormScreen';
import { WordScreen } from './screens/WordScreen';

type DbState = { status: 'opening' } | { status: 'ready'; db: AppDatabase } | { status: 'error'; message: string };

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
      return <WordNewScreen />;
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

  useEffect(() => {
    let active = true;
    openDatabase({ onClosedByUpgrade: () => setState({ status: 'error', message: t.dbError.closed }) })
      .then((db) => {
        if (!active) return db.close();
        setState({ status: 'ready', db });
        void requestPersistence();
      })
      .catch((error: unknown) => active && setState({ status: 'error', message: messageFor(error) }));
    return () => {
      active = false;
    };
  }, []);

  useEffect(reloadWhenResetElsewhere, []);

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

  return (
    <DbContext.Provider value={state.db}>
      <Shell place={place}>
        <CurrentScreen place={place} />
      </Shell>
    </DbContext.Provider>
  );
}
