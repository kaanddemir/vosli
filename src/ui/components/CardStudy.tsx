import { useEffect, useRef, useState } from 'preact/hooks';
import { player } from '../../audio/pronunciation';
import { isCardsFinished, type CardSession } from '../../core/practice/cards';
import type { Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';
import { preparePronunciation, SpeakerButton } from './SpeakerButton';
import { GermanWord, meaningsOf, wordLabel } from './WordList';

/** Long text gets a smaller size, so a phrase does not fill the screen one word per line. */
const LONG_TEXT = 22;
const LONGER_TEXT = 48;

/** Arrow keys move between cards, unless something that takes text or choices has them. */
function ownsArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select, [role="slider"], [role="listbox"], [role="radiogroup"] *');
}

interface CardStudyProps {
  session: CardSession;
  /** The word on screen, read fresh when the card was reached. Null on the closing card. */
  word: Word | null;
  /** The dictionary doubts the article, so it is left out rather than taught. */
  doubtfulArticle: boolean;
  notice: string | null;
  onMove: (delta: -1 | 1) => void;
  onDirection: () => void;
  onHidden: () => void;
  onRestart: () => void;
  onSetup: () => void;
  onClose: () => void;
}

/**
 * One word at a time with both sides together. No answers, scores or schedules: moving on is not
 * answering, and nothing here is written anywhere but this tab's own place in the cards.
 */
export function CardStudy({ session, word, doubtfulArticle, notice, onMove, onDirection, onHidden, onRestart, onSetup, onClose }: CardStudyProps) {
  const total = session.wordIds.length;
  const finished = isCardsFinished(session) || !word;
  const position = Math.min(session.index + 1, total);
  const turkishFirst = session.direction === 'tr_de';
  // Uncovering belongs to one card in one direction. Anything else covers it again.
  const cardKey = `${session.index}:${session.direction}:${session.hidden}`;
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const revealed = !session.hidden || revealedKey === cardKey;
  const answerRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusAnswer = useRef(false);

  useEffect(() => {
    if (focusAnswer.current && revealed) {
      focusAnswer.current = false;
      answerRef.current?.focus();
    }
  }, [revealed]);

  // The buttons that led here are gone at the end, so focus goes to what replaced them.
  useEffect(() => {
    if (finished) doneRef.current?.focus();
  }, [finished]);

  useEffect(preparePronunciation, []);

  // Any move, turn or cover starts the card covered again, even when it comes back to the same place.
  // A recording still playing belongs to the card left behind, so it stops; the next one never starts by itself.
  const move = (delta: -1 | 1) => {
    setRevealedKey(null);
    player().stop();
    onMove(delta);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ownsArrows(event.target) || document.querySelector('dialog[open]')) return;
      if (event.key === 'ArrowRight' && !finished) {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowLeft' && session.index > 0) {
        event.preventDefault();
        move(-1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const german = word ? (doubtfulArticle ? word.lemma : <GermanWord word={word} quiet={false} />) : null;
  // A doubted article is not taught here, so the speaker's label leaves it out too.
  const spoken = word ? (doubtfulArticle ? { ...word, article: null } : word) : null;
  const germanText = word ? (doubtfulArticle ? word.lemma : wordLabel(word)) : '';
  const meaning = word ? meaningsOf(word) : '';
  const front = turkishFirst ? { node: meaning, text: meaning, lang: 'tr' } : { node: german, text: germanText, lang: 'de' };
  const back = turkishFirst ? { node: german, text: germanText, lang: 'de' } : { node: meaning, text: meaning, lang: 'tr' };
  const revealLabel = turkishFirst ? t.practice.cards.revealGerman : t.practice.cards.revealMeaning;
  // Read out only what can be seen: a covered side is never in the announcement either.
  const announcement = finished ? t.practice.cards.doneTitle : [`${t.practice.cards.position} ${position} / ${total}`, front.text, revealed ? back.text : ''].filter(Boolean).join('. ');

  return (
    <div class="practice practice-session card-study" data-testid="card-study">
      <h1 class="visually-hidden">{t.practice.title}</h1>
      <p class="visually-hidden" role="status" data-testid="card-announcement">{announcement}</p>
      <div class="practice-bar">
        <div class="progress" role="progressbar" aria-label={t.practice.cards.position} aria-valuemin={1} aria-valuemax={Math.max(total, 1)} aria-valuenow={position} aria-valuetext={`${position} / ${total}`}>
          <div class="progress-fill" style={{ transform: `scaleX(${total ? (finished ? 1 : position / total) : 0})` }} />
        </div>
        <span class="count" data-testid="card-position" aria-hidden="true">{position} / {total}</span>
        {!finished && (
          <>
            <button type="button" class="btn btn-small btn-square btn-toggle" aria-pressed={turkishFirst} aria-label={t.practice.cards.direction} title={t.practice.cards.direction} data-testid="card-direction" onClick={() => {
                setRevealedKey(null);
                player().stop();
                onDirection();
              }}>
              <Icon name="arrow-left-right" />
            </button>
            <button type="button" class="btn btn-small btn-square btn-toggle" aria-pressed={session.hidden} aria-label={t.practice.cards.hide} title={t.practice.cards.hide} data-testid="card-hide" onClick={() => {
                setRevealedKey(null);
                player().stop();
                onHidden();
              }}>
              <Icon name={session.hidden ? 'eye-off' : 'eye'} />
            </button>
          </>
        )}
        <button type="button" class="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {finished ? (
        <section class="practice-card study-card study-done">
          <h2 ref={doneRef} class="study-done-title" tabIndex={-1}>{t.practice.cards.doneTitle}</h2>
          <p class="muted">{t.practice.cards.doneSupport(formatCount(total))}</p>
        </section>
      ) : (
        <section class="practice-card study-card" aria-label={`${t.practice.cards.position} ${position} / ${total}`} data-testid="card">
          <p class={`study-front ${front.text.length > LONGER_TEXT ? 'study-front-long study-front-longer' : front.text.length > LONG_TEXT ? 'study-front-long' : ''}`} lang={front.lang} data-testid="card-front">{front.node}</p>
          {/* German in front is always in view, so its speaker is too. Under the word, so the word stays centered. */}
          {!turkishFirst && spoken && <SpeakerButton word={spoken} class="study-speaker" />}
          <span class="study-rule" aria-hidden="true" />
          {/* One height whether covered or not, so the card never jumps when uncovered. */}
          <div class="study-back-slot">
            {revealed ? (
              <div class="study-back-row">
                <p ref={answerRef} class="study-back" lang={back.lang} tabIndex={-1} data-testid="card-back">{back.node}</p>
                {/* German on the back gets its speaker only once it is in view: covered, there is nothing to hear. */}
                {turkishFirst && spoken && <SpeakerButton word={spoken} class="study-speaker" />}
              </div>
            ) : (
              // Only a label: the covered side is not in the page, so neither its text nor its article color can show.
              <button
                type="button"
                class="btn btn-quiet study-reveal"
                aria-label={revealLabel}
                data-testid="card-reveal"
                onClick={() => {
                  focusAnswer.current = true;
                  setRevealedKey(cardKey);
                }}
              >
                <Icon name="eye" />
                <span aria-hidden="true">{t.practice.cards.reveal}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {notice && <p class="study-notice" role="status">{notice}</p>}

      {finished ? (
        <div class="study-actions">
          <button type="button" class="btn btn-primary btn-block" onClick={onRestart}>{t.practice.cards.restart}</button>
          <button type="button" class="btn btn-quiet btn-block" onClick={onSetup}>{t.practice.changeSettings}</button>
        </div>
      ) : (
        <div class="study-nav">
          <button type="button" class="btn" disabled={session.index === 0} data-testid="card-previous" onClick={() => move(-1)}>
            <Icon name="back" />
            <span>{t.practice.cards.previous}</span>
          </button>
          <button type="button" class="btn btn-primary" data-testid="card-next" onClick={() => move(1)}>
            <span>{position === total ? t.practice.cards.finish : t.practice.cards.next}</span>
            {position < total && <Icon name="forward" />}
          </button>
        </div>
      )}
    </div>
  );
}
