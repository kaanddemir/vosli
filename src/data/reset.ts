import type { AppDatabase } from './db';
import { SCHEMA_VERSION } from './schema';

const PREFIX = 'vosli.';
const NOTICE_KEY = `${PREFIX}reset-notice`;
const CHANNEL = `${PREFIX}reset`;
/** A tab hears its own broadcast, and must not clear the notice it just left for itself. */
const TAB = Math.random().toString(36);

export type ResetNotice = 'complete' | 'partial';

/** Only this app's keys: the origin's storage can be shared with other apps, and the offline files stay untouched. */
function clearStorage(storage: () => Storage): boolean {
  try {
    const area = storage();
    const keys = Array.from({ length: area.length }, (_, i) => area.key(i)).filter((key): key is string => key?.startsWith(PREFIX) === true);
    for (const key of keys) area.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Empties the database in one transaction, so a failure throws with every record still in place. Settings
 * are cleared only after that. If they fail, the learning data is already gone, so the result says so.
 */
export async function resetAllData(db: AppDatabase): Promise<ResetNotice> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
  const local = clearStorage(() => localStorage);
  const session = clearStorage(() => sessionStorage);
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(TAB);
    channel.close();
  }
  return local && session ? 'complete' : 'partial';
}

/** Another open tab holds screens and a session built on the old data, so it starts over too. */
export function reloadWhenResetElsewhere(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === TAB) return;
    clearStorage(() => sessionStorage);
    location.reload();
  };
  return () => channel.close();
}

export function saveResetNotice(notice: ResetNotice): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, notice);
  } catch {
    /* The empty Home screen still shows the result. */
  }
}

/** Shown once, on the Home screen the reset lands on. */
export function takeResetNotice(): ResetNotice | null {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return notice === 'complete' || notice === 'partial' ? notice : null;
  } catch {
    return null;
  }
}
