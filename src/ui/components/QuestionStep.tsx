import { useEffect, useRef, useState } from 'preact/hooks';
import type { Issue } from '../../core/issues';
import { hintsFor, type QuestionKind } from '../../core/practice/answers';
import { spokenStage } from '../../core/practice/hints';
import { doubtFrom } from '../../core/practice/selection';
import type { Answered } from '../../core/practice/session';
import { meaningKey } from '../../core/vocabulary';
import type { Word } from '../../data/types';
import { t } from '../../i18n/strings';
import { player } from '../../audio/pronunciation';
import { PracticeView, type FeedbackLine, type FeedbackView, type ListenPrompt } from './PracticeView';
import { preparePronunciation, usePlaybackStatus, usePronunciation, useAudioIndex } from './SpeakerButton';
import { wordLabel } from './WordList';

const ARTICLE_CHOICES = ['der', 'die', 'das'] as const;
/** A quick second press of Enter is a double press, not someone who has read the feedback. */
const ENTER_SETTLE_MS = 250;

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

const bareOrFull = (word: Word, doubtful: boolean) => (doubtful ? word.lemma : wordLabel(word));
const meaningList = (word: Word) => word.meanings.map((meaning) => meaning.text).join(', ');

function feedbackFor(answered: Answered, track: QuestionKind, word: Word, issues: readonly Issue[]): FeedbackView {
  const doubt = doubtFrom(issues);
  const { evaluation, typed, hinted } = answered;
  const lines: FeedbackLine[] = [];
  const stored = wordLabel(word);
  const shown = bareOrFull(word, doubt.article);
  const german = (text: string): FeedbackLine => ({ text, lang: 'de' });
  /** The answer as a word, so its article can take its color. A doubtful article is left out, as in the text. */
  const answerWord = (full: boolean): FeedbackLine => ({ text: full ? stored : shown, lang: 'de', word: full || !doubt.article ? word : { article: null, lemma: word.lemma } });
  // Heard only from feedback, after the answer. A doubted article is left out of its label, as it is from the text.
  const speak = doubt.article ? { lemma: word.lemma, article: null, pos: word.pos } : word;
  const otherLabel = evaluation.other ? `${evaluation.other.article ? `${evaluation.other.article} ` : ''}${evaluation.other.lemma}` : '';

  const offer = doubt.offers[0];
  const caution = issues.length === 0 ? {} : { caution: offer ? t.practice.dictionaryCaution(`${offer.article ? `${offer.article} ` : ''}${offer.german}`) : t.practice.dictionaryCautionPlain };

  // Heard, then checked: the spelling with its article and what it means are the answer, right or wrong.
  // The question's own button replays it, so no second speaker is added.
  if (track === 'listen') {
    const meaning: FeedbackLine = { text: t.practice.meaning(meaningList(word)), lang: 'tr' };
    if (evaluation.correct) {
      if (evaluation.note === 'case') lines.push(german(t.practice.caseNote(shown)));
      if (evaluation.note === 'dictionary') lines.push(german(t.practice.dictionaryNote(stored)));
      return { kind: 'correct', title: hinted ? t.practice.correctHinted : t.practice.correct, answer: answerWord(false), lines: [meaning, ...lines], ...caution };
    }
    if (typed === '') return { kind: 'revealed', title: t.practice.revealed, answer: answerWord(false), lines: [meaning], ...caution };
    const reason = evaluation.result in t.practice.reasons ? t.practice.reasons[evaluation.result as keyof typeof t.practice.reasons] : t.practice.wrong;
    if (evaluation.other) lines.push({ text: t.practice.otherMeaning(otherLabel, evaluation.other.meanings.join(', ')), lang: 'tr' });
    if (hinted) lines.push({ text: t.practice.hintUsed });
    return { kind: 'wrong', title: reason, answer: answerWord(false), lines: [meaning, ...lines], ...caution };
  }

  if (evaluation.correct) {
    if (evaluation.result === 'also_valid') lines.push(german(t.practice.alsoAsked(stored)));
    if (evaluation.note === 'case') lines.push(german(t.practice.caseNote(shown)));
    if (evaluation.note === 'dictionary') lines.push(german(t.practice.dictionaryNote(stored)));
    if (track === 'de_tr') {
      const rest = word.meanings.map((meaning) => meaning.text).filter((text) => meaningKey(text) !== meaningKey(typed));
      if (rest.length > 0 && rest.length < word.meanings.length) lines.push({ text: t.practice.alsoMeans(rest.join(', ')), lang: 'tr' });
    }
    return { kind: 'correct', title: hinted ? t.practice.correctHinted : t.practice.correct, ...(track === 'article' ? { answer: answerWord(true) } : {}), lines, ...caution, speak };
  }

  // Nothing typed means the learner asked to see it. That counts as not recalled, but it is not a mistake.
  if (typed === '') return { kind: 'revealed', title: t.practice.revealed, answer: track === 'de_tr' ? { text: meaningList(word), lang: 'tr' } : answerWord(track === 'article'), lines, ...caution, speak };

  const reason = evaluation.result in t.practice.reasons ? t.practice.reasons[evaluation.result as keyof typeof t.practice.reasons] : t.practice.wrong;
  if (evaluation.other) lines.push({ text: t.practice.otherMeaning(otherLabel, evaluation.other.meanings.join(', ')), lang: 'tr' });
  if (hinted) lines.push({ text: t.practice.hintUsed });
  return { kind: 'wrong', title: reason, answer: track === 'de_tr' ? { text: meaningList(word), lang: 'tr' } : answerWord(track === 'article'), lines, ...caution, speak };
}

/**
 * Only the visible part of the page counts while a phone keyboard is open. Fitting the session to it
 * keeps the question, the field and the next step on screen together. Zooming in is left alone.
 */
function useVisibleHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = () => {
      if (viewport.scale > 1.01) return root.style.removeProperty('--session-height');
      root.style.setProperty('--session-height', `${viewport.height}px`);
      if (viewport.offsetTop > 0) scrollTo(0, 0);
    };
    apply();
    viewport.addEventListener('resize', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      root.style.removeProperty('--session-height');
    };
  }, []);
}

/** What only a listening question needs from the screen. */
export interface ListenOptions {
  /** Play as the question appears. Only after moving on from an answer, never for the first question or after a reload. */
  autoplay: boolean;
  onSkip: () => void;
  onEnd: () => void;
}

/** Failures in a row before ending the session is offered. */
const FAILURES_BEFORE_END = 2;

interface QuestionStepProps {
  word: Word;
  track: QuestionKind;
  listen?: ListenOptions | undefined;
  /** Open dictionary warnings on this word. */
  issues: readonly Issue[];
  /** Changes with every question and every answer. */
  stepKey: string;
  answered: Answered | null;
  /** Hint stages shown for this attempt. */
  hints: number;
  done: number;
  total: number;
  retries: number;
  tag?: string | null;
  /** Nothing follows this feedback. */
  lastStep: boolean;
  saveMessage?: string | null;
  onSubmit: (text: string) => void;
  onNext: () => void;
  onHint: () => void;
  onClose: () => void;
}

/**
 * One question and its feedback, the same for Free Practice and Smart Review. The screens decide what
 * an answer does; this decides how it is asked. It stays mounted between questions, so the field keeps
 * focus and a phone keeps its keyboard.
 */
export function QuestionStep({ word, track, listen, issues, stepKey, answered, hints, done, total, retries, tag = null, lastStep, saveMessage = null, onSubmit, onNext, onHint, onClose }: QuestionStepProps) {
  const [draft, setDraft] = useState({ key: stepKey, text: '' });
  const input = useRef<HTMLInputElement>(null);
  const answeredAt = useRef(0);
  const typed = draft.key === stepKey ? draft.text : '';
  const setTyped = (text: string) => setDraft({ key: stepKey, text });

  useVisibleHeight();

  // Ready before the first answer, so the speaker appears with the feedback rather than a moment later.
  useEffect(preparePronunciation, []);

  // A recording still playing belongs to the question just left. It stops as the next one appears.
  useEffect(() => () => player().stop(), [stepKey]);

  // Each new question starts with an empty field and the cursor in it. A phone answering by article keeps its keyboard down.
  useEffect(() => {
    if (answered) return;
    const field = input.current;
    if (!field) return;
    if (!isCoarse() || track !== 'article' || document.activeElement === field) {
      const frame = requestAnimationFrame(() => field.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [stepKey]);

  /* ---------- Listening ---------- */
  const listening = track === 'listen';
  const audioIndex = useAudioIndex();
  const source = usePronunciation(listening ? word : null);
  const status = usePlaybackStatus(source?.key ?? null);
  // Kept for the question it happened on, so a new question starts clean while a failure stays until dealt with.
  const [failedAt, setFailedAt] = useState<{ key: string; offline: boolean } | null>(null);
  const [heardAt, setHeardAt] = useState<string | null>(null);
  const failuresInRow = useRef(0);

  useEffect(() => {
    if (!listening) return;
    if (status === 'playing') {
      failuresInRow.current = 0;
      setHeardAt(stepKey);
    }
    if (status === 'error') {
      failuresInRow.current++;
      setFailedAt({ key: stepKey, offline: player().getState().offline });
    }
  }, [status]);

  const play = (auto = false) => {
    if (!source) return;
    setFailedAt(null);
    player().play(source, { auto });
  };

  // Moving on plays the next recording, if the browser allows it. Declared after the stop above, so it runs after it.
  useEffect(() => {
    if (listening && listen?.autoplay && !answered && source) play(true);
  }, [stepKey]);

  // A word edited or removed from the dictionary since the round began has nothing left to play.
  const unavailable = listening && audioIndex !== null && source === null;
  const failed = failedAt?.key === stepKey ? failedAt : null;
  const listenPrompt: ListenPrompt | undefined = listening && listen
    ? {
        label: heardAt === stepKey || answered ? t.practice.listenAgain : t.practice.listen,
        status,
        ready: source !== null,
        failure: failed ? (failed.offline ? t.pronunciation.offline : t.pronunciation.failed) : unavailable ? t.pronunciation.failed : null,
        canEnd: failuresInRow.current >= FAILURES_BEFORE_END,
        onPlay: () => play(),
        onSkip: listen.onSkip,
        onEnd: listen.onEnd,
      }
    : undefined;

  const submit = (text: string) => {
    answeredAt.current = performance.now();
    onSubmit(text);
  };

  const onEnter = () => {
    if (answered) {
      if (performance.now() - answeredAt.current >= ENTER_SETTLE_MS) onNext();
    } else if (input.current?.value.trim()) {
      submit(input.current.value);
    } else if (listening) {
      // Nothing typed yet: Enter hears it again.
      play();
    }
  };

  /** Writes where the cursor is. Writing to the field itself keeps the cursor there through the next render. */
  const insertLetter = (letter: string, shift: boolean) => {
    const field = input.current;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const wantsCapital = letter !== 'ß' && (shift || (word.article != null && /(^|\s)$/u.test(field.value.slice(0, start)) && !/^(der|die|das)$/iu.test(field.value.slice(0, start))));
    field.setRangeText(wantsCapital ? letter.toLocaleUpperCase('de') : letter, start, end, 'end');
    setTyped(field.value);
    field.focus();
  };

  const doubt = doubtFrom(issues);
  const feedback = answered ? feedbackFor(answered, track, word, issues) : null;
  const { letters, stages } = hintsFor(word, track);
  // A hinted question always shows at least the first stage, whatever count it was saved with.
  const level = hints > 0 ? Math.min(hints, stages.length) : 0;
  const hint = level > 0 ? stages[level - 1]! : null;
  const hintMore = level < stages.length;
  const hintSpoken = hint ? t.practice.hintSpoken(spokenStage(hint), String(letters)) : null;

  const askHint = () => {
    if (answered || !hintMore) return;
    // The last stage is plain text, so a keyboard press on the button would leave focus nowhere. It goes back to the answer.
    const fromButton = level + 1 === stages.length && document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('practice-hint');
    onHint();
    if (fromButton) requestAnimationFrame(() => input.current?.focus());
  };
  // Asked by ear, the question has no text at all: only the instruction, which says whether a capital is due.
  const question = listening ? '' : track === 'tr_de' ? meaningList(word) : track === 'article' ? word.lemma : bareOrFull(word, doubt.article);
  const cue = listening ? (word.article || word.pos === 'noun' ? t.practice.listenCue.noun : t.practice.listenCue.word) : track === 'tr_de' ? (word.article && !doubt.article ? t.practice.cue.tr_de_noun : t.practice.cue.tr_de) : t.practice.cue[track];
  const empty = typed.trim() === '';
  const say = feedback ? [feedback.title, feedback.answer ? `${t.practice.answerWas}: ${feedback.answer.text}` : '', ...(feedback.lines ?? []).map((line) => line.text), feedback.caution ?? '', saveMessage ?? ''].filter(Boolean).join('. ') : hintSpoken ?? (listening ? cue : `${cue}: ${question}`);

  return (
    <PracticeView
      done={done}
      total={total}
      retries={retries}
      cue={cue}
      tag={tag}
      question={question}
      questionLang={track === 'tr_de' ? 'tr' : 'de'}
      listen={listenPrompt}
      {...(track === 'article' ? { detail: meaningList(word) } : {})}
      answer={answered ? answered.typed : typed}
      answerLang={track === 'de_tr' ? 'tr' : 'de'}
      feedback={feedback}
      hint={hint}
      hintSpoken={hintSpoken}
      hintMore={hintMore}
      hintAvailable={stages.length > 0}
      showLetters={track === 'tr_de' || listening}
      {...(track === 'article' ? { choices: ARTICLE_CHOICES } : {})}
      announcement={say}
      actionLabel={answered ? (lastStep ? t.practice.seeSummary : t.practice.next) : t.practice.check}
      actionDisabled={!answered && empty}
      saveMessage={saveMessage}
      inputRef={input}
      onInput={setTyped}
      onEnter={onEnter}
      onAction={() => {
        if (answered) onNext();
        else submit(input.current?.value ?? '');
      }}
      onHint={askHint}
      onReveal={() => submit('')}
      onLetter={insertLetter}
      onChoice={submit}
      onClose={onClose}
    />
  );
}
