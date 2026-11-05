import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { AppDatabase } from '../data/db';

export const DbContext = createContext<AppDatabase | null>(null);

export function useDb(): AppDatabase {
  const db = useContext(DbContext);
  if (!db) throw new Error('Database is not available');
  return db;
}
