import type { FsrsState } from '../core/scheduling/fsrs';
import type { Article } from '../core/identity';
import type { AnswerResult, Track } from '../core/practice/answers';
import type { PartOfSpeech } from '../core/vocabulary';

export type { AnswerResult, PartOfSpeech, Track };
export type GroupKind = 'pdf' | 'lesson' | 'custom';

export interface Meaning {
  text: string;
  note: string | null;
}

export interface Word {
  id: string;
  identityKey: string;
  lemma: string;
  article: Article | null;
  pos: PartOfSpeech;
  plural: string | null;
  meanings: Meaning[];
  senseTag: string | null;
  searchTokens: string[];
  favoritedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Scheduled state for one skill of one word. Created on first scheduled answer, never linked to a group, so importing or moving a word cannot change it. */
export interface Card {
  wordId: string;
  track: Track;
  due: number;
  fsrs: FsrsState;
  schedulerVersion: string;
}


interface LogBase {
  seq?: number;
  wordId: string;
  track: Track;
  at: number;
  typed: string;
  result: AnswerResult;
  hintsUsed: number;
}

export interface ScheduledLog extends LogBase {
  mode: 'scheduled';
  grade: 'again' | 'hard' | 'good';
  prevFsrs: FsrsState;
  schedulerVersion: string;
  /** Older records have neither. A repeat inside a session is a learning step, not a fresh recall. */
  sessionId?: string;
  retry?: boolean;
}

/** A Free Practice attempt: history only, with no scheduling fields. Older records have no session or retry. */
export interface PracticeLog extends LogBase {
  mode: 'practice';
  sessionId?: string;
  /** Asked again in the same round after the answer had been shown, so not a fresh recall. */
  retry?: boolean;
}

export type ReviewLog = ScheduledLog | PracticeLog;

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  order: number;
  sourceId: string | null;
  createdAt: number;
}

export interface GroupMember {
  groupId: string;
  wordId: string;
  addedAt: number;
  importRowId: string | null;
}

export interface Source {
  id: string;
  fileName: string;
  fileHash: string;
  importedAt: number;
  pipelineVersion: number;
}

export interface ImportRow {
  id: string;
  sourceId: string;
  page: number;
  rowIndex: number;
  german: string;
  article: string;
  turkish: string;
  flags: string[];
  decision: 'pending' | 'new' | 'existing' | 'skipped';
  wordId: string | null;
  /** What the source itself said, kept when a person changed the row. Older records do not have it. */
  extracted?: { german: string; article: string; turkish: string };
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
