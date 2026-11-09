import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newId } from '../../core/id';
import { evaluateAnswer, type AnswerWord } from '../../core/practice/answers';
import { doubtFrom } from '../../core/practice/selection';
import { summarize } from '../../core/practice/session';
import type { FsrsState } from '../../core/scheduling/fsrs';
import { batchFrom } from '../../core/scheduling/queue';
import { askItem, askedCount, createReviewSession, delayItem, dropItem, endSession, leaveFeedback, markReviewHint, nextStep, recordAnswer, returningCount, reviveReviewSession, totalCount, verdictFor, type ReviewSession, type SaveResult } from '../../core/scheduling/reviewSession';
import { loadValidator } from '../../dictionary/loadDictionary';
import { flaggedWaiting, issuesFor, loadReviewData, planFrom, readCardState, saveReview, waitingCards, type ReviewData } from '../../data/smartReview';
import type { Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { FlaggedWords } from '../components/FlaggedWords';
import { Icon } from '../components/Icon';
import { PracticeSummary } from '../components/PracticeSummary';
import { QuestionStep } from '../components/QuestionStep';
import { EmptyState, LoadError, LoadingState, Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { readReviewIncludeFlagged, readSavedReview, saveReviewIncludeFlagged, saveReviewSession } from '../practiceStorage';
import { hrefFor } from '../router';
import { useLoad } from '../useLoad';


const goHome = () => {
  location.hash = hrefFor('home');
};

interface Shown {
  word: Word;
  /** The card as it stood when the question appeared. An answer only counts against this state. */
  expected: FsrsState | null;
}

/**
 * Smart Review. Each answer is saved before its feedback appears, so there is never an answer on screen
 * that the card does not know about, and leaving at any moment loses nothing.
 */
export function ReviewScreen() {
  const db = useDb();
  const [session, setSessionState] = useState<ReviewSession | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [includeFlagged, setIncludeFlagged] = useState(readReviewIncludeFlagged);
  const [data, setData] = useState<ReviewData | null>(null);
  const [starting, setStarting] = useState(false);
  const sessionRef = useRef<ReviewSession | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const dataRef = useRef<ReviewData | null>(null);
  const busy = useRef(false);

  const setSession = useCallback((next: ReviewSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    saveReviewSession(next);
  }, []);

  const show = useCallback((next: Shown | null) => {
    shownRef.current = next;
    setShown(next);
  }, []);

  const readData = useCallback(async () => {
    // Waits for the dictionary, because a disputed article must not be asked as fact. It gives up by itself if it cannot load.
    const latest = await loadReviewData(db, await loadValidator());
    dataRef.current = latest;
    setData(latest);
    return latest;
  }, [db]);

  /**
   * Finds the next question that can still honestly be asked, checking each card against the database
   * first. A card deleted, changed or already answered elsewhere is passed over, so nothing is replayed.
   */
  const settle = useCallback(async (start: ReviewSession) => {
    const reference = dataRef.current;
    let next = start;
    for (;;) {
      if (next.ended) break;
      if (next.current !== null && next.answered) {
        const { word } = await readCardState(db, next.items[next.current]!.wordId, next.items[next.current]!.track);
        if (word) {
          show({ word, expected: null });
          break;
        }
        next = dropItem(next, next.current);
        continue;
      }
      const now = Date.now();
      const step = nextStep(next, now);
      if (step.kind !== 'question') {
        show(null);
        break;
      }
      const item = next.items[step.index]!;
      const { word, card } = await readCardState(db, item.wordId, item.track);
      const issues = word && reference ? issuesFor(word, reference) : [];
      const verdict = verdictFor(item, { word, card, doubt: doubtFrom(issues), leftOut: issues.length > 0 && !next.includeFlagged }, now);
      if (verdict.kind === 'ask') {
        next = askItem(next, step.index);
        show({ word: word!, expected: card?.fsrs ?? null });
        break;
      }
      next = verdict.kind === 'drop' ? dropItem(next, step.index) : delayItem(next, step.index, verdict.dueAt);
    }
    const finished = nextStep(next, Date.now()).kind === 'finished';
    // What can follow depends on what was just answered, so the summary opens with fresh counts.
    if (nextStep(next, Date.now()).kind !== 'question') await readData();
    // Every card turned out to be gone before anything was asked: there is no session to report on.
    setSession(!finished || next.items.some((item) => item.attempts > 0) ? next : null);
  }, [db, readData, setSession, show]);

  const begin = useCallback(async (include: boolean, latest: ReviewData) => {
    const batch = batchFrom(planFrom(latest, include, Date.now()), Math.random);
    if (batch.length === 0) return setSession(null);
    return settle(createReviewSession(newId(), include, batch));
  }, [setSession, settle]);

  const { state, reload } = useLoad(async () => {
    const latest = await readData();
    const restored = reviveReviewSession(readSavedReview());
    if (restored) await settle(restored);
    // Warnings are the one thing to decide before starting. With none open, the question comes straight away.
    else if (flaggedWaiting(latest, Date.now()).length === 0) await begin(includeFlagged, latest);
  }, [readData]);

  /** What became due in this session goes first. Otherwise a new session starts. */
  const continueOn = () => {
    const current = sessionRef.current;
    if (current && !current.ended && nextStep(current, Date.now()).kind === 'question') void settle(current);
    else void startFresh();
  };

  const startFresh = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await begin(includeFlagged, await readData());
    } finally {
      setStarting(false);
    }
  };

  const library = useMemo<readonly AnswerWord[]>(() => data?.words ?? [], [data]);

  const answer = async (text: string) => {
    const current = sessionRef.current;
    const question = shownRef.current;
    // A second press finds this set, or a session that already holds the answer.
    if (!current || current.current === null || current.answered || !question || busy.current) return;
    busy.current = true;
    try {
      const item = current.items[current.current]!;
      const clean = text.trim();
      const issues = dataRef.current ? issuesFor(question.word, dataRef.current) : [];
      const evaluation = evaluateAnswer(question.word, item.track, clean, { library, doubt: doubtFrom(issues) });
      const at = Date.now();
      let result: SaveResult;
      try {
        const saved = await saveReview(db, { word: question.word, track: item.track, expected: question.expected, typed: clean, result: evaluation.result, correct: evaluation.correct, hinted: current.hinted, at, sessionId: current.id, retry: item.attempts > 0 });
        result = saved.status === 'saved' ? { status: 'saved', dueAt: saved.next.dueAt } : { status: 'conflict' };
      } catch (error) {
        console.error(error);
        result = { status: 'failed' };
      }
      setSession(recordAnswer(current, clean, evaluation, result, at));
    } finally {
      busy.current = false;
    }
  };

  const advance = async () => {
    const current = sessionRef.current;
    if (!current?.answered || busy.current) return;
    busy.current = true;
    try {
      await settle(leaveFeedback(current));
    } finally {
      busy.current = false;
    }
  };

  const leave = useCallback(() => {
    setSession(null);
    goHome();
  }, [setSession]);

  /** Everything answered is already saved, so closing never needs a warning. Only the place in the list ends. */
  const close = useCallback(() => {
    // An answer still being saved is about to change the session, so it finishes first.
    if (busy.current) return;
    const current = sessionRef.current;
    // On the summary, closing leaves. From a question, it stops and shows what was done.
    if (current && !current.ended && current.current !== null && askedCount(current) > 0) void settle(endSession(current));
    else leave();
  }, [leave, settle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An open dialog or popover handles its own Escape.
      if (event.key === 'Escape' && !document.querySelector('dialog[open], :popover-open')) close();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [close]);

  const closeButton = (
    <button type="button" class="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={close}>
      <Icon name="close" />
    </button>
  );

  if (state.status === 'error') {
    return (
      <Screen title={t.review.title}>
        <LoadError onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!data || state.status === 'loading') return <Screen title={null}><LoadingState /></Screen>;

  if (session) {
    const step = nextStep(session, Date.now());
    if (step.kind === 'question' && session.current !== null && shown) {
      const item = session.items[session.current]!;
      const answered = session.answered;
      const issues = issuesFor(shown.word, data);
      const followed = nextStep(leaveFeedback(session), Date.now()).kind !== 'finished';
      return (
        <QuestionStep
          word={shown.word}
          track={item.track}
          issues={issues}
          stepKey={`${session.id}:${session.current}:${item.attempts}:${answered ? 'a' : 'q'}`}
          answered={answered}
          hints={session.hints}
          done={askedCount(session)}
          total={totalCount(session)}
          retries={returningCount(session)}
          tag={(answered ? answered.retry : item.attempts > 0) ? t.practice.retry : item.kind === 'new' ? t.review.newTag : null}
          lastStep={answered !== null && !followed}
          saveMessage={answered?.save === 'conflict' ? t.review.conflict : answered?.save === 'failed' ? t.review.notSaved : null}
          onSubmit={(text) => void answer(text)}
          onNext={() => void advance()}
          onHint={() => {
            if (sessionRef.current) setSession(markReviewHint(sessionRef.current));
          }}
          onClose={close}
        />
      );
    }
    if (session.current === null || step.kind !== 'question') return <Finished session={session} data={data} onContinue={continueOn} onClose={leave} />;
    return <Screen title={null} />;
  }

  const now = Date.now();
  if (data.words.length === 0) {
    return (
      <Screen title={t.review.title} actions={closeButton}>
        <EmptyState title={t.practice.emptyTitle}>
          <a class="btn" href={hrefFor('import')}>{t.nav.import}</a>
        </EmptyState>
      </Screen>
    );
  }

  const plan = planFrom(data, includeFlagged, now);
  const questions = batchFrom(plan, () => 0).length;
  const flagged = flaggedWaiting(data, now);
  return (
    <Screen title={t.review.title} actions={closeButton}>
      {questions === 0 && flagged.length === 0 ? (
        <EmptyState title={t.review.emptyTitle}>
          <a class="btn" href={hrefFor('practice')}>{t.home.freePractice}</a>
        </EmptyState>
      ) : (
        <div class="practice-summary">
          {flagged.length > 0 && (
            <FlaggedWords
              words={flagged}
              issuesOf={(id) => data.flagged.get(id) ?? []}
              include={includeFlagged}
              onInclude={(include) => {
                setIncludeFlagged(include);
                saveReviewIncludeFlagged(include);
              }}
            />
          )}
          <p role="status" data-testid="review-ready">{questions > 0 ? t.review.ready(formatCount(questions)) : t.review.emptyTitle}</p>
          <div class="summary-actions">
            <button type="button" class="btn btn-primary btn-block" disabled={questions === 0 || starting} onClick={() => void startFresh()}>{t.practice.start}</button>
          </div>
        </div>
      )}
    </Screen>
  );
}

/**
 * The one screen between questions: what was done and the way on. It never
 * brings a question forward. The way on appears once something is really ready, and nothing starts by
 * itself while the learner is reading. A background tab's timer can run late, so coming back checks too.
 */
function Finished({ session, data, onContinue, onClose }: { session: ReviewSession; data: ReviewData; onContinue: () => void; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = waitingCards(data, session.includeFlagged, now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  // A reload keeps the summary, but going elsewhere closes a finished one: coming back means a new session.
  const over = session.ended || returningCount(session) === 0;
  useEffect(
    () => () => {
      // Continuing has already saved the next session, which must stay.
      if (over && (readSavedReview() as { id?: unknown } | null)?.id === session.id) saveReviewSession(null);
    },
    [session.id, over],
  );
  const plan = planFrom(data, session.includeFlagged, now);
  const more = plan.due.length + plan.fresh.length;
  const words = new Map(data.words.map((word) => [word.id, word]));
  return (
    <PracticeSummary summary={summarize(session)} wordOf={(id) => words.get(id)} title={waiting > 0 || more > 0 ? t.review.summaryWaitingTitle : t.review.summaryTitle} onClose={onClose}>
      {more > 0 && <button type="button" class="btn btn-primary btn-block" onClick={onContinue} data-testid="review-continue">{t.review.continueWith(formatCount(more))}</button>}
      <a class={`btn btn-block ${more > 0 ? '' : 'btn-primary'}`} href={hrefFor('practice')}>{t.home.freePractice}</a>
    </PracticeSummary>
  );
}
