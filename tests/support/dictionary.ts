import { readFileSync } from 'node:fs';
import { createDictionary, type Dictionary } from '../../src/core/dictionary';

let shared: Dictionary | null = null;

/** The real dictionary files, the ones the app ships. */
export function realDictionary(): Dictionary {
  shared ??= createDictionary(readFileSync('public/dictionary/lemmas.txt', 'utf8'), readFileSync('public/dictionary/forms.txt', 'utf8'));
  return shared;
}
