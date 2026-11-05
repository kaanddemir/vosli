import type { Validate } from '../core/validation';

const TIMEOUT_MS = 15_000;
const RETRY_MS = 1000;
let loading: Promise<Validate> | null = null;
const texts = new Map<string, Promise<string>>();

async function readText(name: string): Promise<string> {
  const response = await fetch(new URL(`dictionary/${name}`, document.baseURI), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return response.text();
}

/**
 * One copy of a dictionary file for everything that reads it: word checks and pronunciation share
 * lemmas.txt. A failed read is forgotten, so the next caller tries again.
 */
export function dictionaryText(name: string): Promise<string> {
  let text = texts.get(name);
  if (!text) {
    text = readText(name);
    texts.set(name, text);
    text.catch(() => texts.delete(name));
  }
  return text;
}

async function attempt(): Promise<Validate> {
  const [lemmas, forms, { createDictionary }, { createValidator }] = await Promise.all([dictionaryText('lemmas.txt'), dictionaryText('forms.txt'), import('../core/dictionary'), import('../core/validation')]);
  return createValidator(createDictionary(lemmas, forms));
}

/**
 * Safari fails requests the moment a page starts reloading. Waiting before the second try means the
 * page is gone by then, so a reload never reads as a dictionary that cannot load. A passing failure
 * gets a second chance too. A timeout does not: it has already waited long enough.
 */
async function load(): Promise<Validate> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    return attempt();
  }
}

/** Loads on first need, code and data together, not at startup. Null means unavailable: entries then stay unchecked, and nothing else changes. */
export async function loadValidator(): Promise<Validate | null> {
  loading ??= load();
  try {
    return await loading;
  } catch (error) {
    console.warn('Dictionary unavailable', error);
    loading = null;
    return null;
  }
}

/** The dictionary if it is ready within this time. Otherwise words go unchecked, and it keeps loading for next time. */
export function validatorWithin(ms: number): Promise<Validate | null> {
  return Promise.race([loadValidator(), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** The same, told apart from a dictionary that could not load: undefined means it is still on its way. */
export function peekValidator(ms: number): Promise<Validate | null | undefined> {
  return Promise.race([loadValidator(), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}
