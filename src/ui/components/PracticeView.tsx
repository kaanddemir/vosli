import type { Ref } from 'preact';
import { t } from '../../i18n/strings';
import type { Word } from '../../data/types';
import { AUTOCORRECT_OFF } from '../inputProps';
import { Icon } from './Icon';
import { PopoverButton } from './PopoverButton';
import { SpeakerButton } from './SpeakerButton';
import { GermanWord } from './WordList';

const LETTERS = ['ä', 'ö', 'ü', 'ß'] as const;
const noop = () => {};
/** A press on these must not take focus from the answer, or a phone would close its keyboard. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

export interface FeedbackLine {
  text: string;
  lang?: string;
  /** The same German word as text, drawn with its article on its own. Only ever set after an answer. */
  word?: Pick<Word, 'article' | 'lemma'>;
}

export interface FeedbackView {
  /** Revealed means the learner asked for the answer, which is not a mistake to mark in red. */
  kind: 'correct' | 'wrong' | 'revealed';
  title: string;
  /** The right answer, when it needs saying. */
  answer?: FeedbackLine;
  lines?: readonly FeedbackLine[];
  /** A dictionary doubt, kept apart from what the learner's own data says. */
  caution?: string;
  /** The German word to hear. Feedback exists only once the question is answered or shown, so it never gives an answer away. */
  speak?: Pick<Word, 'lemma' | 'article' | 'pos'>;
}

export interface PracticeViewProps {
  done: number;
  total: number;
  retries?: number;
  cue: string;
  /** A short word before the cue: this is a repeat, or a new word. */
  tag?: string | null;
  question: string;
  questionLang: string;
  /** A second line that decides the answer, such as the meaning behind an article. */
  detail?: string;
  answer?: string;
  answerLang?: string;
  feedback?: FeedbackView | null;
  hint?: string | null;
  hintAvailable?: boolean;
  showLetters?: boolean;
  choices?: readonly string[];
  /** Read out by screen readers whenever it changes. */
  announcement?: string;
  actionLabel: string;
  actionQuiet?: boolean;
  actionDisabled?: boolean;
  /** Why this answer did not count. */
  saveMessage?: string | null;
  inputRef?: Ref<HTMLInputElement>;
  onInput?: (text: string) => void;
  onEnter?: () => void;
  onAction?: () => void;
  onHint?: () => void;
  onReveal?: () => void;
  onLetter?: (letter: string, shift: boolean) => void;
  onChoice?: (choice: string) => void;
  onClose?: () => void;
}

/** Long text gets a smaller size, so a phrase does not fill the screen one word per line. */
const LONG_QUESTION = 22;

/**
 * The session layout from the flashcard reference: progress and close on top, the question, the answer,
 * then one primary action in thumb reach. The field stays in place through the feedback, so the phone
 * keyboard never closes between questions and Enter always does the next thing.
 */
export function PracticeView({ done, total, retries = 0, cue, tag = null, question, questionLang, detail, answer = '', answerLang = 'de', feedback = null, hint = null, hintAvailable = false, showLetters = false, choices, announcement = '', actionLabel, actionQuiet = false, actionDisabled = false, saveMessage = null, inputRef, onInput = noop, onEnter = noop, onAction = noop, onHint = noop, onReveal = noop, onLetter = noop, onChoice = noop, onClose = noop }: PracticeViewProps) {
  return (
    <form
      class="practice practice-session"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onEnter();
      }}
    >
      <h1 class="visually-hidden">{t.practice.title}</h1>
      <p class="visually-hidden" role="status" data-testid="practice-announcement">{announcement}</p>
      <div class="practice-bar">
        <div class="progress" role="progressbar" aria-label={t.practice.progress} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={done} aria-valuetext={`${done} / ${total}`}>
          <div class="progress-fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
        </div>
        <span class="count" data-testid="practice-count">
          <span aria-hidden="true">{done} / {total}</span>
          {retries > 0 && (
            <span class="count-retries">
              <span aria-hidden="true"> +{retries}</span>
              <span class="visually-hidden">{t.practice.retriesLeft(String(retries))}</span>
            </span>
          )}
        </span>
        <button type="button" class="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <section class={`practice-card practice-question ${feedback?.caution ? 'practice-question-flagged' : ''}`}>
        {feedback?.caution && (
          <span class="practice-caution">
            <PopoverButton id="practice-caution" icon="warning" label={t.practice.cautionLabel} attention keepFocus>
              <span class="popover-line" data-testid="practice-caution">{feedback.caution}</span>
            </PopoverButton>
          </span>
        )}
        <p class="eyebrow" data-testid="practice-cue">{tag && <span class="practice-retry">{tag} · </span>}{cue}</p>
        <p id="practice-prompt" class={question.length > LONG_QUESTION ? 'question question-long' : 'question'} lang={questionLang} data-testid="practice-question">{question}</p>
        {detail && <p class="question-detail" lang="tr" data-testid="practice-detail">{detail}</p>}
        {/*
          In the card's corner, and only once the answer is in: before that it is not on the page at all, so it
          cannot be seen, focused or read out. It keeps focus off itself, so the field keeps the phone keyboard
          and Enter still moves on.
        */}
        {feedback?.speak && <SpeakerButton word={feedback.speak} keepFocus class="question-speaker" />}
      </section>

      <section class="practice-card practice-answer">
        <label class="visually-hidden" for="practice-answer">{t.practice.answerLabel}</label>
        <input
          ref={inputRef ?? null}
          id="practice-answer"
          class={`field field-answer ${feedback ? `field-${feedback.kind}` : ''}`}
          type="text"
          lang={answerLang}
          value={answer}
          readOnly={feedback !== null}
          placeholder={feedback ? '' : t.practice.answerPlaceholder}
          aria-describedby="practice-prompt"
          enterkeyhint={feedback ? 'next' : 'done'}
          autocomplete="off"
          autocapitalize="off"
          autocorrect={AUTOCORRECT_OFF}
          spellcheck={false}
          onInput={(event) => onInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Holding Enter must not answer and then skip the feedback.
            if (event.key === 'Enter' && event.repeat) event.preventDefault();
          }}
        />
        {feedback ? (
          <div class={`feedback feedback-${feedback.kind}`} data-testid="practice-feedback">
            <span class="feedback-line">
              {feedback.kind !== 'revealed' && <Icon name={feedback.kind === 'correct' ? 'check' : 'close'} />}
              <span>{feedback.title}</span>
            </span>
            {feedback.answer && (
              <p class="feedback-answer" data-testid="practice-answer-shown">{t.practice.answerWas}: <strong lang={feedback.answer.lang}>{feedback.answer.word ? <GermanWord word={feedback.answer.word} quiet={false} /> : feedback.answer.text}</strong></p>
            )}
            {feedback.lines?.map((line) => <p key={line.text} class="feedback-note" lang={line.lang}>{line.text}</p>)}
            {saveMessage && <p class="feedback-note" role="alert" data-testid="practice-save-message">{saveMessage}</p>}
          </div>
        ) : (
          <div class="practice-tools">
            {choices ? (
              <div class="letters article-choices" role="group" aria-label={t.practice.articles}>
                {choices.map((choice) => (
                  <button key={choice} type="button" class="letter article-choice" lang="de" onMouseDown={keepFocus} onClick={() => onChoice(choice)}>{choice}</button>
                ))}
              </div>
            ) : showLetters ? (
              <div class="letters" role="group" aria-label={t.practice.letters}>
                {LETTERS.map((letter) => (
                  <button key={letter} type="button" class="letter" lang="de" aria-label={t.practice.insert(letter)} onMouseDown={keepFocus} onClick={(event) => onLetter(letter, event.shiftKey)}>{letter}</button>
                ))}
              </div>
            ) : null}
            <div class="practice-help">
              <button type="button" class="btn btn-quiet btn-small" data-testid="practice-reveal" onMouseDown={keepFocus} onClick={onReveal}>{t.practice.reveal}</button>
              {hint ? (
                <span class="hint-shown" data-testid="practice-hint">{t.practice.hintShown(hint)}</span>
              ) : hintAvailable ? (
                <button type="button" class="btn btn-quiet btn-small practice-hint" onMouseDown={keepFocus} onClick={onHint}>
                  <Icon name="hint" />
                  <span>{t.practice.hint}</span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <button type="button" class={`btn btn-block practice-action ${actionQuiet ? '' : 'btn-primary'}`} data-testid="practice-action" disabled={actionDisabled} onMouseDown={keepFocus} onClick={onAction}>
        {actionLabel}
      </button>
    </form>
  );
}
