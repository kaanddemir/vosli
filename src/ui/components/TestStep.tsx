import { useEffect, useRef, useState } from 'preact/hooks';
import type { TestQuestion } from '../../core/practice/choices';
import type { TestPick } from '../../core/practice/test';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';
import { PracticeView } from './PracticeView';
import { GermanWord } from './WordList';

const KEYS = ['A', 'B', 'C', 'D'] as const;

interface TestStepProps {
  question: TestQuestion;
  /** Changes with every question. */
  stepKey: string;
  /** The question's place in the test, counting from zero. */
  at: number;
  total: number;
  /** The answer already given to this question, which is then shown with the right one. */
  answered: TestPick | null;
  /** Nothing follows this question but the results. */
  last: boolean;
  onPick: (at: number, option: number) => void;
  onBlank: (at: number) => void;
  onNext: (at: number) => void;
  onClose: () => void;
}

/**
 * One test question: the practice session's own card, progress and close, with options to choose from
 * in place of the typed answer. Choosing only selects; Cevapla answers once and shows at once whether it
 * was right, with the right option marked. Nothing names the right option before that.
 */
export function TestStep({ question, stepKey, at, total, answered, last, onPick, onBlank, onNext, onClose }: TestStepProps) {
  const [choice, setChoice] = useState<{ key: string; option: number } | null>(null);
  const selected = choice?.key === stepKey ? choice.option : null;
  const first = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const shown = answered !== null;

  // Holding Enter must not answer and then skip the answer just shown: a repeat never presses the way on.
  useEffect(() => {
    if (!shown) return undefined;
    const holdOff = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
    };
    addEventListener('keydown', holdOff, true);
    return () => removeEventListener('keydown', holdOff, true);
  }, [shown]);

  // A new question starts with focus on its first option, where the arrow keys work. Once answered, the
  // options are closed, so focus goes to the way on, and Enter moves on.
  useEffect(() => {
    const frame = requestAnimationFrame(() => (shown ? action.current : first.current)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [stepKey, shown]);

  const submit = () => {
    if (!shown && selected !== null) onPick(at, selected);
  };
  const blank = () => {
    if (!shown) onBlank(at);
  };
  const next = () => {
    if (shown) onNext(at);
  };

  const cue = t.practice.cue[question.kind];
  const optionLang = question.kind === 'de_tr' ? 'tr' : 'de';
  const right = question.options[question.correct]!;
  const verdict = answered === null ? null : answered === 'blank' ? { kind: 'revealed', title: t.practice.test.blanked } : answered === question.correct ? { kind: 'correct', title: t.practice.correct } : { kind: 'wrong', title: t.practice.wrong };
  const spoken = verdict
    ? [verdict.title, verdict.kind === 'correct' ? '' : `${t.practice.answerWas}: ${right.text}`].filter(Boolean).join('. ')
    : [t.practice.test.questionSpoken(String(at + 1), String(total)), `${cue}: ${question.prompt}`, question.detail ?? ''].filter(Boolean).join('. ');

  const options = (
    <>
      <fieldset
        class="choice-list"
        aria-describedby="practice-prompt"
        onKeyDown={(event) => {
          // Enter answers with what is chosen; a radio alone would not send the form everywhere.
          if (event.key !== 'Enter' || shown) return;
          event.preventDefault();
          if (!event.repeat) submit();
        }}
      >
        <legend class="visually-hidden">{t.practice.test.choices}</legend>
        {question.options.map((option, index) => {
          const isRight = shown && index === question.correct;
          const isWrong = shown && answered === index && !isRight;
          return (
            <label key={`${stepKey}:${index}`} class={`choice-row ${isRight ? 'choice-right' : isWrong ? 'choice-wrong' : ''}`} data-testid="test-option" data-result={isRight ? 'right' : isWrong ? 'wrong' : undefined}>
              <input ref={index === 0 ? first : null} type="radio" name="test-choice" value={index} checked={shown ? answered === index : selected === index} disabled={shown} onChange={() => setChoice({ key: stepKey, option: index })} />
              <span class="choice-key" aria-hidden="true">{isRight ? <Icon name="check" /> : isWrong ? <Icon name="close" /> : KEYS[index]}</span>
              <span class="choice-text" lang={optionLang}>{option.german ? <GermanWord word={option.german} /> : option.text}</span>
              {/* The marks above are drawn; a screen reader hears them said. */}
              {isRight && <span class="visually-hidden">, {t.practice.answerWas}</span>}
              {isWrong && <span class="visually-hidden">, {t.practice.test.chosen}</span>}
            </label>
          );
        })}
      </fieldset>
      {verdict ? (
        <div class={`feedback feedback-${verdict.kind}`} data-testid="practice-feedback">
          <span class="feedback-line">
            {verdict.kind !== 'revealed' && <Icon name={verdict.kind === 'correct' ? 'check' : 'close'} />}
            <span>{verdict.title}</span>
          </span>
        </div>
      ) : (
        <div class="practice-help">
          <button type="button" class="btn btn-quiet btn-small" data-testid="test-blank" onClick={blank}>{t.practice.test.blank}</button>
        </div>
      )}
    </>
  );

  return (
    <PracticeView
      done={shown ? at + 1 : at}
      total={total}
      cue={cue}
      question={question.prompt}
      questionLang={question.kind === 'tr_de' ? 'tr' : 'de'}
      {...(question.detail ? { detail: question.detail } : {})}
      answerArea={options}
      announcement={spoken}
      actionLabel={shown ? (last ? t.practice.test.results : t.practice.test.next) : t.practice.test.submit}
      actionDisabled={!shown && selected === null}
      actionRef={action}
      onAction={shown ? next : submit}
      onEnter={shown ? next : submit}
      onClose={onClose}
    />
  );
}
