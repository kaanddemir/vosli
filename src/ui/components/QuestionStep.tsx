import { useEffect, useRef, useState } from 'preact/hooks';
import type { Issue } from '../../core/issues';
import { hintFor, type Track } from '../../core/practice/answers';
import { doubtFrom } from '../../core/practice/selection';
import type { Answered } from '../../core/practice/session';
import { meaningKey } from '../../core/vocabulary';
import type { Word } from '../../data/types';
import { t } from '../../i18n/strings';
import { player } from '../../audio/pronunciation';
import { PracticeView, type FeedbackLine, type FeedbackView } from './PracticeView';
import { preparePronunciation } from './SpeakerButton';
import { wordLabel } from './WordList';

const ARTICLE_CHOICES = ['der', 'die', 'das'] as const;
/** A quick second press of Enter is a double press, not someone who has read the feedback. */
const ENTER_SETTLE_MS = 250;

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

const bareOrFull = (word: Word, doubtful: boolean) => (doubtful ? word.lemma : wordLabel(word));
const meaningList = (word: Word) => word.meanings.map((meaning) => meaning.text).join(', ');

function feedbackFor(answered: Answered, track: Track, word: Word, issues: readonly Issue[]): FeedbackView {
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

interface QuestionStepProps {
  word: Word;
  track: Track;
  /** Open dictionary warnings on this word. */
  issues: readonly Issue[];
  /** Changes with every question and every answer. */
  stepKey: string;
  answered: Answered | null;
  hinted: boolean;
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
export function QuestionStep({ word, track, issues, stepKey, answered, hinted, done, total, retries, tag = null, lastStep, saveMessage = null, onSubmit, onNext, onHint, onClose }: QuestionStepProps) {
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

  const submit = (text: string) => {
    answeredAt.current = performance.now();
    onSubmit(text);
  };

  const onEnter = () => {
    if (answered) {
      if (performance.now() - answeredAt.current >= ENTER_SETTLE_MS) onNext();
    } else if (input.current?.value.trim()) {
      submit(input.current.value);
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
  const hint = hintFor(word, track);
  const question = track === 'tr_de' ? meaningList(word) : track === 'article' ? word.lemma : bareOrFull(word, doubt.article);
  const cue = track === 'tr_de' ? (word.article && !doubt.article ? t.practice.cue.tr_de_noun : t.practice.cue.tr_de) : t.practice.cue[track];
  const empty = typed.trim() === '';
  const say = feedback ? [feedback.title, feedback.answer ? `${t.practice.answerWas}: ${feedback.answer.text}` : '', ...(feedback.lines ?? []).map((line) => line.text), feedback.caution ?? '', saveMessage ?? ''].filter(Boolean).join('. ') : hinted && hint ? t.practice.hintShown(hint) : `${cue}: ${question}`;

  return (
    <PracticeView
      done={done}
      total={total}
      retries={retries}
      cue={cue}
      tag={tag}
      question={question}
      questionLang={track === 'tr_de' ? 'tr' : 'de'}
      {...(track === 'article' ? { detail: meaningList(word) } : {})}
      answer={answered ? answered.typed : typed}
      answerLang={track === 'de_tr' ? 'tr' : 'de'}
      feedback={feedback}
      hint={hinted ? hint : null}
      hintAvailable={hint !== null}
      showLetters={track === 'tr_de'}
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
      onHint={onHint}
      onReveal={() => submit('')}
      onLetter={insertLetter}
      onChoice={submit}
      onClose={onClose}
    />
  );
}
