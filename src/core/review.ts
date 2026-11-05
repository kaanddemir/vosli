import { normalizeText, stripClosingPunctuation, type Article } from './identity';
import { meaningKey, parseArticle, splitMeanings, validateFields, type DraftError } from './vocabulary';

/** An entry something can be compared with: a stored word, or an earlier row of the same import. */
export interface KnownEntry {
  ref: string;
  lemma: string;
  article: Article | null;
  meanings: string[];
}

type AmbiguityReason = 'meaning' | 'article' | 'article_missing' | 'case';

export type Classification =
  | { kind: 'new' }
  | { kind: 'existing'; entry: KnownEntry; newMeanings: string[] }
  | { kind: 'ambiguous'; reason: AmbiguityReason; candidates: KnownEntry[] };

const lemmaKey = (lemma: string) => stripClosingPunctuation(lemma).toLocaleLowerCase('de');
const isCapitalized = (lemma: string) => lemma.charAt(0) !== lemma.charAt(0).toLocaleLowerCase('de');

type KnownIndex = Map<string, KnownEntry[]>;

export function indexKnown(entries: readonly KnownEntry[]): KnownIndex {
  const index: KnownIndex = new Map();
  for (const entry of entries) addKnown(index, entry);
  return index;
}

function addKnown(index: KnownIndex, entry: KnownEntry): void {
  const key = lemmaKey(entry.lemma);
  const list = index.get(key);
  if (list) list.push(entry);
  else index.set(key, [entry]);
}

/** essen and das Essen: one has an article and a capital, the other neither. A real grammatical difference. */
function isVerbAndNoun(a: Pick<KnownEntry, 'lemma' | 'article'>, b: Pick<KnownEntry, 'lemma' | 'article'>): boolean {
  const pair = (noun: typeof a, other: typeof a) => noun.article !== null && isCapitalized(noun.lemma) && other.article === null && !isCapitalized(other.lemma);
  return pair(a, b) || pair(b, a);
}

/**
 * The one rule for whether an entry is new, the same as a known one, or needs a person.
 * Same spelling, article and a shared meaning is the same word. Same letters with any other
 * difference is never merged automatically, because it may be a real distinction or a typo.
 */
export function classifyEntry(lemma: string, article: Article | null, meanings: readonly string[], index: KnownIndex): Classification {
  const same = index.get(lemmaKey(lemma)) ?? [];
  const spelled = stripClosingPunctuation(lemma);
  const exact = same.filter((entry) => stripClosingPunctuation(entry.lemma) === spelled && entry.article === article);

  if (exact.length) {
    const keys = new Set(meanings.map(meaningKey));
    const match = exact.find((entry) => entry.meanings.some((meaning) => keys.has(meaningKey(meaning))));
    if (!match) return { kind: 'ambiguous', reason: 'meaning', candidates: exact };
    const known = new Set(match.meanings.map(meaningKey));
    return { kind: 'existing', entry: match, newMeanings: meanings.filter((meaning) => !known.has(meaningKey(meaning))) };
  }

  const incoming = { lemma, article };
  const candidates = same.filter((entry) => !isVerbAndNoun(entry, incoming));
  if (candidates.length === 0) return { kind: 'new' };
  const differentArticle = article !== null && candidates.some((entry) => entry.article !== null && entry.article !== article);
  const missingArticle = candidates.some((entry) => (entry.article === null) !== (article === null));
  return { kind: 'ambiguous', reason: differentArticle ? 'article' : missingArticle ? 'article_missing' : 'case', candidates };
}

/** Choosing "separate" keeps both entries; any other choice is the ref of the entry to join. */
export const SEPARATE = 'separate';

/** One row on its way in. The same shape serves paste, CSV and PDF extraction. */
export interface ImportDraft {
  id: string;
  /** 0 when the source has no pages. */
  page: number;
  rowIndex: number;
  german: string;
  article: string;
  turkish: string;
  plural: string;
  flags: string[];
  excluded: boolean;
  choice: string | null;
  /** The part of the source this row belongs to, such as a lesson heading. Empty when there is none. */
  section: string;
  /** Someone changed the text; kept with the row's record of where it came from. */
  edited: boolean;
  /** Warnings someone looked at and accepted. */
  dismissed: readonly string[];
  /** What the source said, before anyone changed the row. */
  extracted: { german: string; article: string; turkish: string };
  /** The word this same row of this same file became last time. That earlier answer stands. */
  linked: string | null;
}

export type RowStatus =
  | { kind: 'excluded'; invalid: boolean }
  | { kind: 'invalid'; errors: DraftError[] }
  | { kind: 'new' }
  | { kind: 'existing'; entry: KnownEntry; newMeanings: string[]; inBatch: boolean }
  | { kind: 'ambiguous'; reason: AmbiguityReason; candidates: KnownEntry[]; choice: string | null; inBatch: boolean };

export interface ReviewedRow {
  draft: ImportDraft;
  status: RowStatus;
  lemma: string;
  article: Article | null;
  meanings: string[];
}

export const rowRef = (draftId: string): string => `row:${draftId}`;
const isRowRef = (ref: string) => ref.startsWith('row:');

/** Rows are judged in order, against stored words and against the rows before them. */
export function reviewRows(drafts: readonly ImportDraft[], stored: readonly KnownEntry[]): ReviewedRow[] {
  const index = indexKnown(stored);
  const batch = new Map<string, KnownEntry>();
  // A stored word met twice in one import counts once as saved and then as a repeat.
  const used = new Set<string>();
  const firstUse = (ref: string) => {
    const repeat = isRowRef(ref) || used.has(ref);
    used.add(ref);
    return !repeat;
  };

  const remember = (draft: ImportDraft, lemma: string, article: Article | null, meanings: string[]) => {
    const entry: KnownEntry = { ref: rowRef(draft.id), lemma, article, meanings: [...meanings] };
    batch.set(entry.ref, entry);
    addKnown(index, entry);
  };
  const absorb = (ref: string, meanings: readonly string[]) => {
    const entry = batch.get(ref);
    if (!entry) return;
    const known = new Set(entry.meanings.map(meaningKey));
    for (const meaning of meanings) if (!known.has(meaningKey(meaning))) entry.meanings.push(meaning);
  };

  return drafts.map((draft) => {
    const lemma = normalizeText(draft.german);
    const meanings = splitMeanings(draft.turkish);
    const article = parseArticle(draft.article) ?? null;
    const base = { draft, lemma, article, meanings };
    // An earlier import already answered this row, and the word may have been corrected since. It stays as it is now.
    const link = draft.linked && !draft.excluded ? stored.find((entry) => entry.ref === draft.linked) : undefined;
    if (link) return { draft, lemma: link.lemma, article: link.article, meanings: [], status: { kind: 'existing', entry: link, newMeanings: [], inBatch: !firstUse(link.ref) } };
    const errors = validateFields(draft.german, draft.article, draft.turkish, draft.plural);
    if (draft.excluded) return { ...base, status: { kind: 'excluded', invalid: errors.length > 0 } };
    if (errors.length) return { ...base, status: { kind: 'invalid', errors } };

    const found = classifyEntry(lemma, article, meanings, index);
    if (found.kind === 'new') {
      remember(draft, lemma, article, meanings);
      return { ...base, status: { kind: 'new' } };
    }
    if (found.kind === 'existing') {
      absorb(found.entry.ref, meanings);
      return { ...base, status: { ...found, inBatch: !firstUse(found.entry.ref) } };
    }
    const valid = draft.choice === SEPARATE || found.candidates.some((entry) => entry.ref === draft.choice);
    const choice = valid ? draft.choice : null;
    if (choice === SEPARATE) remember(draft, lemma, article, meanings);
    else if (choice) absorb(choice, meanings);
    const inBatch = choice !== null && choice !== SEPARATE && !firstUse(choice);
    return { ...base, status: { ...found, choice, inBatch } };
  });
}

/** Rows that stop an import until someone fixes or excludes them. */
export const needsAttention = (status: RowStatus): boolean => status.kind === 'invalid' || (status.kind === 'ambiguous' && status.choice === null);

export function blankDraft(id: string, rowIndex: number, fields: Partial<ImportDraft>): ImportDraft {
  const german = fields.german ?? '';
  const article = fields.article ?? '';
  const turkish = fields.turkish ?? '';
  return { id, page: 0, rowIndex, german, article, turkish, plural: '', flags: [], excluded: false, choice: null, section: '', edited: false, dismissed: [], extracted: { german: normalizeText(german), article: normalizeText(article), turkish: normalizeText(turkish) }, linked: null, ...fields };
}

/** What a row adds up to. Every row has exactly one outcome, so the counts always add up to the rows. */
type RowOutcome = 'create' | 'existing' | 'repeat' | 'excluded' | 'invalid' | 'pending';

export function rowOutcome({ status }: Pick<ReviewedRow, 'status'>): RowOutcome {
  switch (status.kind) {
    case 'new':
      return 'create';
    case 'existing':
      return status.inBatch ? 'repeat' : 'existing';
    case 'ambiguous':
      if (status.choice === null) return 'pending';
      if (status.choice === SEPARATE) return 'create';
      return status.inBatch ? 'repeat' : 'existing';
    case 'excluded':
      return status.invalid ? 'invalid' : 'excluded';
    case 'invalid':
      return 'pending';
  }
}

type ImportTally = Record<RowOutcome, number>;

export function tallyRows(rows: readonly Pick<ReviewedRow, 'status'>[]): ImportTally {
  const tally: ImportTally = { create: 0, existing: 0, repeat: 0, excluded: 0, invalid: 0, pending: 0 };
  for (const row of rows) tally[rowOutcome(row)]++;
  return tally;
}

/** Automatic repairs that worked. They are history, shown with a row's details, and never ask for anything. */
const CORRECTION_FLAGS = ['wrapped', 'dehyphenated'] as const;
type CorrectionFlag = (typeof CORRECTION_FLAGS)[number];

/** Reasons to look at a row. Saving is still allowed; a warning means check, not wrong. */
export const WARNING_FLAGS = ['article_missing', 'article_lowercase', 'wrapped_word'] as const;
type WarningFlag = (typeof WARNING_FLAGS)[number];

/** Each warning holds for as long as the text it is about: fixing the text is what clears it. */
const STILL_APPLIES: Readonly<Record<WarningFlag, (draft: ImportDraft) => boolean>> = {
  article_missing: (draft) => normalizeText(draft.article) === '',
  article_lowercase: (draft) => normalizeText(draft.article) !== '' && /^\p{Ll}/u.test(normalizeText(draft.german)),
  wrapped_word: (draft) => /\s\p{Ll}/u.test(normalizeText(draft.german)),
};

export function rowWarnings(draft: ImportDraft): WarningFlag[] {
  if (draft.excluded) return [];
  return WARNING_FLAGS.filter((flag) => draft.flags.includes(flag) && !draft.dismissed.includes(flag) && STILL_APPLIES[flag](draft));
}

export const rowCorrections = (draft: ImportDraft): CorrectionFlag[] => CORRECTION_FLAGS.filter((flag) => draft.flags.includes(flag));

const sameDecisions = (a: ImportDraft, b: ImportDraft) => a.german === b.german && a.article === b.article && a.turkish === b.turkish && a.plural === b.plural && a.excluded === b.excluded && a.choice === b.choice && a.dismissed.length === b.dismissed.length;

/** How many rows differ from what the source gave. Changing a row and changing it back counts as nothing. */
export function countEditedRows(original: readonly ImportDraft[], current: readonly ImportDraft[]): number {
  const before = new Map(original.map((draft) => [draft.id, draft]));
  let edited = 0;
  for (const draft of current) {
    const first = before.get(draft.id);
    if (first !== draft && (!first || !sameDecisions(first, draft))) edited++;
  }
  return edited;
}
