import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { TestQuestion } from '../../core/practice/choices';
import { scoreTest, type TestPick, type TestSession } from '../../core/practice/test';
import { formatCount, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';
import { List, Row } from './List';
import { Screen } from './Screen';

/** Enough to see what went wrong at a glance. The rest waits for a tap, so a long test stays readable. */
const FIRST_MISSED = 10;

const optionLang = (question: TestQuestion) => (question.kind === 'de_tr' ? 'tr' : 'de');

function MissedRow({ question, pick }: { question: TestQuestion; pick: TestPick }) {
  const lang = optionLang(question);
  const chosen = pick === 'blank' ? null : question.options[pick]!.text;
  return (
    <Row
      lang={question.kind === 'tr_de' ? 'tr' : 'de'}
      title={question.prompt}
      detail={
        <span class="test-answers" data-testid="test-missed">
          {question.detail && <span class="test-answer" lang="tr">{question.detail}</span>}
          <span class="test-answer">{t.practice.test.yourAnswer}: {chosen === null ? t.practice.test.blankAnswer : <span lang={lang}>{chosen}</span>}</span>
          <span class="test-answer">{t.practice.test.rightAnswer}: <strong lang={lang}>{question.options[question.correct]!.text}</strong></span>
        </span>
      }
    />
  );
}

/** The end of a test, and the only place its answers are judged. */
export function TestSummary({ test, onClose, children }: { test: TestSession; onClose: () => void; children: ComponentChildren }) {
  const score = scoreTest(test);
  const [showAll, setShowAll] = useState(false);
  const missed = showAll ? score.missed : score.missed.slice(0, FIRST_MISSED);
  const close = (
    <button type="button" class="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={onClose}>
      <Icon name="close" />
    </button>
  );
  const facts = [
    { label: t.practice.test.correct, value: score.correct, id: 'test-correct' },
    { label: t.practice.test.wrong, value: score.wrong, id: 'test-wrong' },
    { label: t.practice.test.blankCount, value: score.blank, id: 'test-blank-count' },
  ];

  return (
    <Screen title={t.practice.test.summaryTitle} actions={close}>
      <div class="practice-summary" data-testid="test-summary">
        <p class="summary-score">
          <strong data-testid="test-accuracy">{formatPercent(score.accuracy)}</strong>
          <span data-testid="test-score">{t.practice.test.score(formatCount(score.correct), formatCount(score.scored))}</span>
        </p>
        <List>
          {facts.map((fact) => <Row key={fact.id} title={fact.label} value={formatCount(fact.value)} valueTestId={fact.id} />)}
        </List>
        {score.missed.length > 0 && (
          <List
            label={t.practice.test.missed}
            footer={
              !showAll && score.missed.length > FIRST_MISSED ? (
                <button type="button" class="btn btn-quiet btn-small test-show-all" onClick={() => setShowAll(true)}>{t.practice.test.showAll(formatCount(score.missed.length))}</button>
              ) : null
            }
          >
            {missed.map(({ question, pick }, index) => <MissedRow key={`${question.wordId}|${question.kind}|${index}`} question={question} pick={pick} />)}
          </List>
        )}
        <div class="summary-actions">{children}</div>
      </div>
    </Screen>
  );
}
