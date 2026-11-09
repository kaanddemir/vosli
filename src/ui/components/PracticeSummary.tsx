import type { ComponentChildren } from 'preact';
import type { RoundSummary } from '../../core/practice/session';
import type { QuestionKind } from '../../core/practice/answers';
import type { Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';
import { List, Row } from './List';
import { Screen } from './Screen';
import { meaningsOf, wordLabel } from './WordList';

interface PracticeSummaryProps {
  summary: RoundSummary;
  wordOf: (wordId: string) => Word | undefined;
  title?: string;
  onClose: () => void;
  /** The ways forward. */
  children: ComponentChildren;
}

const ORDER: Readonly<Record<QuestionKind, number>> = { tr_de: 0, de_tr: 1, article: 2, listen: 3 };

/** Counts only: an open-ended practice has no percentage of anything to report. */
export function PracticeSummary({ summary, wordOf, title = t.practice.summaryTitle, onClose, children }: PracticeSummaryProps) {
  const close = (
    <button type="button" class="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={onClose}>
      <Icon name="close" />
    </button>
  );
  const facts = [
    { label: t.practice.firstHinted, value: summary.firstHinted },
    { label: t.practice.firstWrong, value: summary.firstWrong },
    { label: t.practice.recovered, value: summary.recovered },
    { label: t.practice.unresolved, value: summary.unresolved },
  ].filter((fact) => fact.value > 0);
  const review = [...summary.toReview].sort((a, b) => Number(a.last === 'clean') - Number(b.last === 'clean') || ORDER[a.track] - ORDER[b.track]);

  return (
    <Screen title={title} actions={close}>
      <div class="practice-summary" data-testid="practice-summary">
        <p class="summary-score">
          <strong data-testid="practice-score">{t.practice.firstTry(formatCount(summary.firstClean), formatCount(summary.total))}</strong>
          <span>{t.practice.firstTryLabel}</span>
        </p>
        {facts.length > 0 && (
          <List>
            {facts.map((fact) => <Row key={fact.label} title={fact.label} value={formatCount(fact.value)} />)}
          </List>
        )}
        {review.length > 0 && (
          <List label={t.practice.toReview}>
            {review.map((item) => {
              const word = wordOf(item.wordId);
              return word ? <Row key={`${item.wordId}|${item.track}`} lang="de" title={wordLabel(word)} detail={<span lang="tr">{meaningsOf(word)}</span>} value={item.last === 'clean' ? <><Icon name="check" /><span class="visually-hidden">{t.practice.recovered}</span></> : undefined} /> : null;
            })}
          </List>
        )}
        <div class="summary-actions">{children}</div>
      </div>
    </Screen>
  );
}
