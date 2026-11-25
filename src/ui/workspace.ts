import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { LearningLanguage } from '../core/learningLanguage';

/**
 * The learning language every screen reads and writes: the active workspace. It comes from meta.learningLanguage,
 * read once the database is open, and changes only through the switcher, the first-start welcome or a restore. It
 * never follows the interface language.
 */
interface Workspace {
  language: LearningLanguage;
  /** Saves the choice and starts every screen over in that language. Refused while work would be lost. */
  /** Resolves true once switched; false when nothing changed (already open, or something here is busy). */
  switchTo: (language: LearningLanguage) => Promise<boolean>;
}

export const WorkspaceContext = createContext<Workspace>({ language: 'de', switchTo: async () => false });

export const useWorkspace = (): Workspace => useContext(WorkspaceContext);
export const useLearningLanguage = (): LearningLanguage => useContext(WorkspaceContext).language;

/**
 * The language a learner's meanings are written in, for assistive technology. German workspaces have always held
 * Turkish meanings, and keep saying so. Nothing says what another workspace's are, so they claim no language of their
 * own and are read as the page around them.
 */
export const meaningLang = (language: LearningLanguage): string | undefined => (language === 'de' ? 'tr' : undefined);

/* ---------- Work that a switch would lose ---------- */

const holders = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** True while any screen holds work a switch would lose: a study session, an import or an unsaved edit. */
export const isBusy = (): boolean => holders.size > 0;

export function onBusyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Holds the workspace in place while active is true, and lets go when it turns false or the screen goes. */
export function useBusy(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const token = Symbol('busy');
    holders.add(token);
    notify();
    return () => {
      holders.delete(token);
      notify();
    };
  }, [active]);
}

export function useIsBusy(): boolean {
  const [busy, setBusy] = useState(isBusy);
  useEffect(() => {
    setBusy(isBusy());
    return onBusyChange(() => setBusy(isBusy()));
  }, []);
  return busy;
}

/* ---------- Other tabs ---------- */

const CHANNEL = 'vosli.workspace';
/** A tab hears its own broadcast, and must not act on what it just did itself. */
const TAB = Math.random().toString(36);

/** Tells other tabs that the learning language or the first-start choice changed. They read meta again. */
export function announceWorkspaceChange(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(TAB);
  channel.close();
}

export function onWorkspaceChangeElsewhere(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data !== TAB) listener();
  };
  return () => channel.close();
}
