import { ALL_WORDS, doubtFrom, tracksFor, wordsInScope, type PracticeMode, type PracticeScope } from '../../core/practice/selection';
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

const MODES: readonly PracticeMode[] = ['tr_de', 'de_tr', 'article', 'mixed'];
const STUDIES: readonly StudyMode[] = ['typed', 'cards'];
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
export const settingsFor = (settings: PracticeSettings, study: StudyChoice): PracticeSettings => (study.study === 'cards' ? { ...settings, mode: study.direction } : settings);

export function eligibilityOf(data: PracticeData, settings: PracticeSettings): Eligibility {
  const inScope = wordsInScope(data.words, settings.scope, data.members, data.difficult);
  const flagged = inScope.filter((word) => data.flagged.has(word.id));
  const usable = settings.includeFlagged ? inScope : inScope.filter((word) => !data.flagged.has(word.id));
  const eligible = usable.filter((word) => tracksFor(word, settings.mode, doubtFrom(data.flagged.get(word.id) ?? [])).length > 0);
  return { inScope, flagged, eligible };
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
  const { flagged, eligible } = eligibilityOf(data, settingsFor(settings, study));
  const questions = settings.count === null ? eligible.length : Math.min(settings.count, eligible.length);
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
          if (questions > 0) onStart();
        }}
      >
        <fieldset class="setup-group">
          <legend class="list-label">{t.practice.studyLabel}</legend>
          <div class="segmented segmented-full">
            {STUDIES.map((option) => (
              <label key={option}>
                <input type="radio" name="practice-study" checked={study.study === option} onChange={() => onStudyChange({ ...study, study: option })} />
                <span>{t.practice.studies[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Keyed, so switching modes builds fresh radios rather than reusing the other group's checked state. */}
        {cards ? (
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
          {questions === 0 && <p class="practice-start-line" role="status" data-testid="practice-blocked">{cards ? t.practice.noCards : settings.mode === 'article' ? t.practice.noArticles : t.practice.noneInScope}</p>}
          <button type="submit" class="btn btn-primary btn-block" disabled={questions === 0} data-questions={questions}>{cards ? t.practice.startCards : t.practice.start}</button>
        </div>
      </form>
    </Screen>
  );
}
