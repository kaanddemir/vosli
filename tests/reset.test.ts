import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/data/db';
import { readOnboarding } from '../src/data/learningMeta';
import { afterDataReplaced, resetAllData, saveResetNotice, takeResetNotice } from '../src/data/reset';
import { SCHEMA_VERSION } from '../src/data/schema';
import { uniqueDbName } from './support/fixtures';
import { seedLibrary } from './support/seed';

/** A storage area like the browser's, so a test can see exactly which keys a reset leaves. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  entries() {
    return Object.fromEntries(this.items);
  }
}

let db: AppDatabase;
let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(async () => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  db = await openDatabase({ name: uniqueDbName() });
  await seedLibrary(db);
  local.setItem('vosli.theme', 'dark');
  local.setItem('vosli.practice-settings', '{}');
  local.setItem('other-app.key', 'keep');
  session.setItem('vosli.review-session', '{}');
});

afterEach(() => {
  db.close();
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('resetting all data', () => {
  for (const locale of ['tr', 'en', 'de']) {
    test(`keeps the interface language ${locale} when asked, and clears everything else`, async () => {
      local.setItem('vosli.locale', locale);
      expect(await resetAllData(db, ['vosli.locale'])).toBe('complete');
      expect(local.entries()).toEqual({ 'vosli.locale': locale, 'other-app.key': 'keep' });
      expect(session.entries()).toEqual({});
      expect(await db.words.count()).toBe(0);
    });
  }

  test('clears every Vosli setting when nothing is kept', async () => {
    local.setItem('vosli.locale', 'de');
    await resetAllData(db);
    expect(local.entries()).toEqual({ 'other-app.key': 'keep' });
  });

  test('keeps only the keys named, never a session key of the same name', async () => {
    session.setItem('vosli.locale', 'de');
    await resetAllData(db, ['vosli.locale']);
    expect(session.entries()).toEqual({});
  });
});

describe('a fresh start and the learning language', () => {
  test('a reset removes both workspaces, the learning language and the first-start record, keeping the interface language, so the welcome returns', async () => {
    const name = db.name;
    await db.meta.bulkPut([
      { key: 'learningLanguage', value: 'en' },
      { key: 'onboarding', value: { via: 'legacy', at: 1 } },
    ]);
    local.setItem('vosli.locale', 'de');
    await resetAllData(db, ['vosli.locale']);
    expect(await db.meta.toArray()).toEqual([{ key: 'schemaVersion', value: SCHEMA_VERSION }]);
    expect(await db.words.count()).toBe(0);
    expect(local.getItem('vosli.locale')).toBe('de');
    db.close();
    db = await openDatabase({ name });
    expect(await readOnboarding(db)).toBeNull();
  });
});

describe('after a restored backup', () => {
  test('clears every saved session in this tab, keeps settings, and tells the other tabs', () => {
    const sent: unknown[] = [];
    class Channel {
      constructor(readonly name: string) {}
      postMessage(message: unknown) {
        sent.push([this.name, message]);
      }
      close() {}
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: Channel, configurable: true, writable: true });
    try {
      for (const key of ['vosli.practice-session', 'vosli.card-session', 'vosli.test-session']) session.setItem(key, '{}');
      local.setItem('vosli.locale', 'tr');
      afterDataReplaced();
      expect(session.entries()).toEqual({});
      expect(local.entries()).toMatchObject({ 'vosli.locale': 'tr', 'vosli.theme': 'dark', 'other-app.key': 'keep' });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual(['vosli.reset', expect.any(String)]);
      saveResetNotice('restored');
      expect(takeResetNotice()).toBe('restored');
      expect(takeResetNotice()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'BroadcastChannel', original);
      else Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    }
  });
});
