import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AudioIndex } from '../../audio/audioIndex';
import type { DictionaryDoubt, Track } from '../../core/practice/answers';
import { createChoicePool, testKindsFor, type ChoicePool } from '../../core/practice/choices';
import { ALL_WORDS, doubtFrom, questionsFor, wordsInScope, type PracticeMode, type PracticeScope } from '../../core/practice/selection';
import type { CardDirection } from '../../core/practice/cards';
import type { PracticeSettings } from '../../core/practice/session';
import type { PracticeData } from '../../data/practice';
import type { Group, GroupKind, Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import type { StudyChoice, StudyMode } from '../practiceStorage';
import { hrefFor } from '../router';
import { FlaggedWords } from './FlaggedWords';
import { Icon } from './Icon';
import { EmptyState, Screen } from './Screen';
import { useAudioIndex } from './SpeakerButton';

const MODES: readonly Exclude<PracticeMode, 'listen'>[] = ['tr_de', 'de_tr', 'article', 'mixed'];
const STUDIES: readonly StudyMode[] = ['typed', 'listen', 'cards', 'test'];
const DIRECTIONS: readonly CardDirection[] = ['de_tr', 'tr_de'];
const COUNTS: readonly (number | null)[] = [10, 20, 50, null];
const KINDS: readonly GroupKind[] = ['pdf', 'lesson', 'custom'];

export const DEFAULT_SETTINGS: PracticeSettings = { mode: 'tr_de', scope: ALL_WORDS, count: 20, includeFlagged: false };

interface Eligibility {
  inScope: Word[];
  flagged: Word[];
  eligible: Word[];
}

/** What a choice would actually ask about. A word with an open warning waits unless asked for. */
/**
 * Cards choose words the same way a typed round does: the same scope, the same held-back warnings,
 * and only words that have both sides to show. The direction stands in for the question type.
 */
export const settingsFor = (settings: PracticeSettings, study: StudyChoice): PracticeSettings =>
  study.study === 'cards' ? { ...settings, mode: study.direction } : study.study === 'listen' ? { ...settings, mode: 'listen' } : settings;

/**
 * Listening asks only words whose confirmed recording says the spelling saved, judged from the app's own
 * files without fetching any sound. Without the index, no word can be heard.
 */
export function eligibilityOf(data: PracticeData, settings: PracticeSettings, audio: AudioIndex | null = null): Eligibility {
  const inScope = wordsInScope(data.words, settings.scope, data.members, data.difficult);
  const flagged = inScope.filter((word) => data.flagged.has(word.id));
  const usable = settings.includeFlagged ? inScope : inScope.filter((word) => !data.flagged.has(word.id));
  const askable = usable.filter((word) => questionsFor(word, settings.mode, doubtFrom(data.flagged.get(word.id) ?? [])).length > 0);
  const eligible = settings.mode === 'listen' ? askable.filter((word) => audio !== null && audio.canDictate(word)) : askable;
  return { inScope, flagged, eligible };
}

export interface TestPlan {
  /** What a typed round would ask about with these settings. */
  askable: Word[];
  /** Those that can also be asked with safe options to choose from. */
  eligible: Word[];
  pool: ChoicePool;
  kindsOf: (word: Word) => Track[];
  doubtOf: (wordId: string) => DictionaryDoubt;
  /** The chosen selection, whose words are offered as options first. */
  preferred: ReadonlySet<string>;
}

/**
 * A test asks the words a typed round would, each in a way that has three safe wrong options. Those
 * options may come from any saved word, so a small collection still works; a word with an open
 * dictionary warning is never shown as an option, whatever the setting for asking it.
 */
export function testPlanOf(data: PracticeData, settings: PracticeSettings): TestPlan {
  const { inScope, eligible: askable } = eligibilityOf(data, settings);
  const doubtOf = (wordId: string) => doubtFrom(data.flagged.get(wordId) ?? []);
  const pool = createChoicePool(data.words, (wordId) => data.flagged.has(wordId));
  const mode = settings.mode === 'listen' ? 'mixed' : settings.mode;
  const kinds = new Map<string, Track[]>();
  const kindsOf = (word: Word) => {
    let known = kinds.get(word.id);
    if (!known) kinds.set(word.id, (known = testKindsFor(pool, word, mode, doubtOf(word.id))));
    return known;
  };
  return { askable, eligible: askable.filter((word) => kindsOf(word).length > 0), pool, kindsOf, doubtOf, preferred: new Set(inScope.map((word) => word.id)) };
}

/** False only when the browser knows it has no connection. True can still mean a connection that fails. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function ScopeRow({ label, count, checked, disabled = false, onChange }: { label: string; count: number; checked: boolean; disabled?: boolean; onChange: (checked: boolean, input: HTMLInputElement) => void }) {
  return (
    <li>
      <label class={`check-row ${disabled ? 'check-row-off' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked, event.currentTarget)} />
        <span class="check-label">{label}</span>
        <span class="check-count">{formatCount(count)}</span>
      </label>
    </li>
  );
}

function toggle(scope: PracticeScope, patch: Partial<PracticeScope>): PracticeScope {
  const next = { ...scope, all: false, ...patch };
  return next.favorites || next.difficult || next.groupIds.length > 0 ? next : ALL_WORDS;
}

export function PracticeSetup({ data, settings, study, onChange, onStudyChange, onStart }: { data: PracticeData; settings: PracticeSettings; study: StudyChoice; onChange: (settings: PracticeSettings) => void; onStudyChange: (study: StudyChoice) => void; onStart: () => void }) {
  const audio = useAudioIndex();
  const online = useOnline();
  const testing = study.study === 'test';
  // Worked out once per choice, not on every render: every word is checked against the whole library.
  const plan = useMemo(() => (testing && data.words.length > 0 ? testPlanOf(data, settings) : null), [testing, data, settings]);
  const close = (
    <a class="icon-btn" href={hrefFor('home')} aria-label={t.common.close} title={t.common.close}>
      <Icon name="close" />
    </a>
  );

  if (data.words.length === 0) {
    return (
      <Screen title={t.practice.title} actions={close}>
        <EmptyState title={t.practice.emptyTitle}>
          <a class="btn" href={hrefFor('import')}>{t.nav.import}</a>
        </EmptyState>
      </Screen>
    );
  }

  const { scope } = settings;
  const cards = study.study === 'cards';
  const listening = study.study === 'listen';
  const { flagged, eligible: practiceEligible } = eligibilityOf(data, settingsFor(settings, study), audio);
  const eligible = plan ? plan.eligible : practiceEligible;
  const questions = settings.count === null ? eligible.length : Math.min(settings.count, eligible.length);
  // A test may have fewer questions than asked for, when some words have no safe options: it says how many.
  const shortTest = plan !== null && questions > 0 && questions < (settings.count ?? plan.askable.length);
  const nothing = cards ? t.practice.noCards : listening ? t.practice.noRecordings : plan && plan.askable.length > 0 ? t.practice.test.notEnough : settings.mode === 'article' ? t.practice.noArticles : t.practice.noneInScope;
  // What stops a round from starting, or for listening, how many words can be heard and that it needs a connection.
  const blocked = listening && !online ? t.practice.listenOffline : listening && !audio ? t.practice.listenLoading : questions === 0 ? nothing : null;
  const startLine = blocked ?? (listening ? t.practice.listenCoverage(formatCount(eligible.length)) : shortTest ? t.practice.test.available(formatCount(questions)) : null);
  const favorites = data.words.filter((word) => word.favoritedAt !== null).length;
  const setScope = (next: PracticeScope) => onChange({ ...settings, scope: next });
  const groupsOf = (kind: GroupKind): Group[] => data.groups.filter((item) => item.group.kind === kind && item.wordCount > 0).map((item) => item.group);
  const countOf = (id: string) => data.groups.find((item) => item.group.id === id)?.wordCount ?? 0;

  return (
    <Screen title={t.practice.title} actions={close}>
      <form
        class="practice-setup"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked === null) onStart();
        }}
      >
        <fieldset class="setup-group">
          <legend class="list-label">{t.practice.studyLabel}</legend>
          <div class="segmented segmented-grid segmented-pairs">
            {STUDIES.map((option) => (
              <label key={option}>
                <input type="radio" name="practice-study" checked={study.study === option} onChange={() => onStudyChange({ ...study, study: option })} />
                <span>{t.practice.studies[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Keyed, so switching modes builds fresh radios rather than reusing the other group's checked state. */}
        {/* Listening has no question type: it always asks for the German that is heard. The typed choice is kept for later. */}
        {listening ? null : cards ? (
          <fieldset key="direction" class="setup-group">
            <legend class="list-label">{t.practice.directionLabel}</legend>
            <div class="segmented segmented-full">
              {DIRECTIONS.map((direction) => (
                <label key={direction}>
                  <input type="radio" name="card-direction" checked={study.direction === direction} onChange={() => onStudyChange({ ...study, direction })} />
                  <span>{t.practice.directions[direction]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <fieldset key="mode" class="setup-group">
            <legend class="list-label">{t.practice.modeLabel}</legend>
            <div class="segmented segmented-grid">
              {MODES.map((mode) => (
                <label key={mode}>
                  <input type="radio" name="practice-mode" checked={settings.mode === mode} onChange={() => onChange({ ...settings, mode })} />
                  <span>{t.practice.modes[mode]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset class="setup-group">
          <legend class="list-label">{cards ? t.practice.cardCountLabel : t.practice.countLabel}</legend>
          <div class="segmented segmented-full">
            {COUNTS.map((count) => (
              <label key={String(count)}>
                <input type="radio" name="practice-count" checked={settings.count === count} onChange={() => onChange({ ...settings, count })} />
                <span>{count === null ? t.practice.countAll : formatCount(count)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset class="setup-group">
          <legend class="list-label">{t.practice.scopeLabel}</legend>
          <ul class="list check-list">
            <ScopeRow
              label={t.practice.allWords}
              count={data.words.length}
              checked={scope.all}
              onChange={(checked, input) => {
                // Every word is what remains when nothing else is chosen, so this cannot simply be unticked.
                if (!checked && scope.all) input.checked = true;
                else setScope(ALL_WORDS);
              }}
            />
            <ScopeRow label={t.practice.favorites} count={favorites} checked={scope.favorites} disabled={favorites === 0} onChange={(checked) => setScope(toggle(scope, { favorites: checked }))} />
            <ScopeRow label={t.practice.difficult} count={data.difficult.size} checked={scope.difficult} disabled={data.difficult.size === 0} onChange={(checked) => setScope(toggle(scope, { difficult: checked }))} />
          </ul>
          {KINDS.map((kind) => {
            const groups = groupsOf(kind);
            if (groups.length === 0) return null;
            return (
              <div key={kind} class="setup-collections">
                <p class="list-label">{t.collections.kinds[kind]}</p>
                <ul class="list check-list">
                  {groups.map((group) => (
                    <ScopeRow
                      key={group.id}
                      label={group.name}
                      count={countOf(group.id)}
                      checked={scope.groupIds.includes(group.id)}
                      onChange={(checked) => setScope(toggle(scope, { groupIds: checked ? [...scope.groupIds, group.id] : scope.groupIds.filter((id) => id !== group.id) }))}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </fieldset>

        {flagged.length > 0 && <FlaggedWords words={flagged} issuesOf={(id) => data.flagged.get(id) ?? []} include={settings.includeFlagged} onInclude={(includeFlagged) => onChange({ ...settings, includeFlagged })} />}

        <div class="practice-start">
          {/* Only what stops a round from starting is worth a line here. */}
          {startLine && <p class="practice-start-line" role="status" data-testid={blocked ? 'practice-blocked' : 'practice-coverage'}>{startLine}</p>}
          <button type="submit" class="btn btn-primary btn-block" disabled={blocked !== null} data-questions={questions}>{cards ? t.practice.startCards : testing ? t.practice.test.start : t.practice.start}</button>
        </div>
      </form>
    </Screen>
  );
}
