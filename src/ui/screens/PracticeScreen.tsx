import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newId } from '../../core/id';
import { createCardSession, currentCard, dropCard, moveCard, restartCards, reviveCardSession, type CardSession } from '../../core/practice/cards';
import { evaluateAnswer, type AnswerWord } from '../../core/practice/answers';
import { buildQuestion, type TestQuestion } from '../../core/practice/choices';
import { ALL_WORDS, buildRound, doubtFrom, shuffled, type RoundItem } from '../../core/practice/selection';
import { createTest, currentQuestion, dropWord as dropTestWord, leaveBlank, nextTestQuestion, reviveTest, scoreTest, shownPick, submitPick, testHasProgress, type TestSession } from '../../core/practice/test';
import { createSession, currentItem, doneCount, dropWord, isFinished, markHintUsed, nextQuestion, retriesWaiting, reviveSession, roundSize, skipQuestion, submitAnswer, summarize, type PracticeSettings, type Session } from '../../core/practice/session';
import { validatorWithin } from '../../dictionary/loadDictionary';
import { loadPracticeData, type PracticeData } from '../../data/practice';
import { getActiveWord, recordPracticeAttempt } from '../../data/repository';
import { t } from '../../i18n/strings';
import { CardStudy } from '../components/CardStudy';
import { ConfirmDialog } from '../components/Modal';
import { DEFAULT_SETTINGS, eligibilityOf, PracticeSetup, settingsFor, testPlanOf } from '../components/PracticeSetup';
import { PracticeSummary } from '../components/PracticeSummary';
import { QuestionStep } from '../components/QuestionStep';
import { TestStep } from '../components/TestStep';
import { TestSummary } from '../components/TestSummary';
import { loadAudioIndex } from '../components/SpeakerButton';
import { player } from '../../audio/pronunciation';
import { LoadError, Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { readSavedCards, readSavedSession, readSavedSettings, readSavedTest, readStudyChoice, saveCards, saveSession, saveSettings, saveStudyChoice, saveTest, type StudyChoice } from '../practiceStorage';
import { hrefFor } from '../router';
import { useLoad } from '../useLoad';

/** Practice does not wait longer than this for the dictionary. Words then simply go unchecked. */
const DICTIONARY_WAIT_MS = 2000;

const goHome = () => {
  location.hash = hrefFor('home');
};

function restoreSettings(data: PracticeData): PracticeSettings {
  const saved = readSavedSettings() as Partial<PracticeSettings> | null;
  if (!saved || typeof saved !== 'object') return DEFAULT_SETTINGS;
  const known = new Set(data.groups.map((item) => item.group.id));
  const mode = (['tr_de', 'de_tr', 'article', 'mixed'] as const).find((item) => item === saved.mode) ?? DEFAULT_SETTINGS.mode;
  const count = saved.count === null || saved.count === 10 || saved.count === 20 || saved.count === 50 ? saved.count : DEFAULT_SETTINGS.count;
  const groupIds = Array.isArray(saved.scope?.groupIds) ? saved.scope.groupIds.filter((id) => known.has(id)) : [];
  const favorites = saved.scope?.favorites === true;
  const difficult = saved.scope?.difficult === true;
  const scope = favorites || difficult || groupIds.length > 0 ? { all: false, favorites, difficult, groupIds } : ALL_WORDS;
  return { mode, count, scope, includeFlagged: saved.includeFlagged === true };
}

export function PracticeScreen() {
  const db = useDb();
  const [storedSettings, setSettingsState] = useState<PracticeSettings>(DEFAULT_SETTINGS);
  const [session, setSessionState] = useState<Session | null>(null);
  const [closing, setClosing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const moving = useRef(false);
  const [study, setStudyState] = useState<StudyChoice>(readStudyChoice);
  const [cards, setCardsState] = useState<CardSession | null>(null);
  const cardsRef = useRef<CardSession | null>(null);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const [test, setTestState] = useState<TestSession | null>(null);
  const testRef = useRef<TestSession | null>(null);
  // Set once the learner has moved on from an answer: from then on a listening question plays as it appears.
  // A new round and a reloaded one start false, so their first recording waits for a tap.
  const [movedOn, setMovedOn] = useState(false);

  /** Card study keeps only its place in the cards, in this tab. Nothing is written to learning data. */
  const setCards = useCallback((next: CardSession | null) => {
    cardsRef.current = next;
    setCardsState(next);
    saveCards(next);
  }, []);

  /** A test keeps its questions and answers in this tab only. Nothing about it reaches the database. */
  const setTest = useCallback((next: TestSession | null) => {
    testRef.current = next;
    setTestState(next);
    saveTest(next);
  }, []);

  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
    saveSession(next);
  }, []);

  const readData = useCallback(async () => {
    return loadPracticeData(db, await validatorWithin(DICTIONARY_WAIT_MS));
  }, [db]);

  const { state, reload } = useLoad(async () => {
    const data = await readData();
    const active = new Set(data.words.map((word) => word.id));
    const restored = reviveSession(readSavedSession(), active);
    const restoredTest = restored ? null : reviveTest(readSavedTest(), active);
    testRef.current = restoredTest;
    setTestState(restoredTest);
    saveTest(restoredTest);
    const restoredCards = restored || restoredTest ? null : reviveCardSession(readSavedCards(), active);
    cardsRef.current = restoredCards;
    setCardsState(restoredCards);
    saveCards(restoredCards);
    sessionRef.current = restored;
    setSessionState(restored);
    saveSession(restored);
    setSettingsState(restored?.settings ?? restoredTest?.settings ?? restoreSettings(data));
    return data;
  }, [readData]);
  const [fresh, setFresh] = useState<PracticeData | null>(null);
  const data = fresh ?? (state.status === 'ready' ? state.data : null);

  const settings = useMemo(() => (data ? withKnownGroups(storedSettings, data) : storedSettings), [storedSettings, data]);

  const words = useMemo(() => new Map((data?.words ?? []).map((word) => [word.id, word])), [data]);
  const library = useMemo<readonly AnswerWord[]>(() => data?.words ?? [], [data]);
  const item = session ? currentItem(session) : null;
  const word = item ? words.get(item.wordId) ?? null : null;
  const answered = session?.answered ?? null;
  const hasProgress = session !== null && session.items.some((entry) => entry.attempts > 0);
  // Answers move it on, and so does a question passed over without one, which leaves the queue shorter.
  const stepKey = session ? `${session.id}:${session.items.reduce((sum, entry) => sum + entry.attempts, 0)}:${session.queue.length}:${answered ? 'a' : 'q'}` : '';

  const leave = useCallback(() => {
    player().stop();
    setSession(null);
    setCards(null);
    setTest(null);
    goHome();
  }, [setSession, setCards, setTest]);

  const askToClose = useCallback(() => {
    // A test asks the same as a round: once something is answered, leaving is confirmed first.
    if (testRef.current) {
      if (testHasProgress(testRef.current)) setClosing(true);
      else leave();
      return;
    }
    if (sessionRef.current && !isFinished(sessionRef.current) && sessionRef.current.items.some((entry) => entry.attempts > 0)) setClosing(true);
    else leave();
  }, [leave]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An open dialog or popover handles its own Escape.
      if (event.key === 'Escape' && !document.querySelector('dialog[open], :popover-open')) askToClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [askToClose]);

  const changeSettings = (next: PracticeSettings) => {
    setSettingsState(next);
    saveSettings(next);
  };

  const changeStudy = (next: StudyChoice) => {
    setStudyState(next);
    saveStudyChoice(next);
  };

  /** The same choice of words as a typed round, read fresh, then only the order is kept. */
  const beginCards = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const latest = await readData();
      const current = withKnownGroups(storedSettings, latest);
      if (current !== storedSettings) {
        setFresh(latest);
        changeSettings(current);
        return;
      }
      const chosen = settingsFor(current, study);
      const { eligible } = eligibilityOf(latest, chosen);
      const round = buildRound({ words: eligible, mode: chosen.mode, count: chosen.count, history: latest.history, doubtOf: (id) => doubtFrom(latest.flagged.get(id) ?? []), random: Math.random });
      setFresh(latest);
      setCardNotice(null);
      setTest(null);
      setCards(round.length > 0 ? createCardSession(newId(), study.direction, round.map((entry) => entry.wordId)) : null);
    } finally {
      setStarting(false);
    }
  };

  /**
   * Moves at once, so a quick run of presses is never dropped, then reads the card it landed on fresh:
   * an edited word shows its new text, and a deleted one leaves the cards for the next one along.
   */
  const [, setChecked] = useState(0);
  const checkCard = useCallback(async (delta: -1 | 1) => {
    for (;;) {
      const landed = cardsRef.current;
      const id = landed && currentCard(landed);
      if (!landed || !id) return;
      const latest = await getActiveWord(db, id);
      const now = cardsRef.current;
      // Moved on meanwhile: the newer move checks its own card.
      if (!now || now.id !== landed.id || currentCard(now) !== id) return;
      if (latest) {
        words.set(latest.id, latest);
        setChecked((value) => value + 1);
        return;
      }
      let next = dropCard(now, id);
      // Going back past a removed card lands on the one before it.
      if (delta === -1 && next.index === now.index && now.index > 0) next = { ...next, index: now.index - 1 };
      setCardNotice(t.practice.cards.removed);
      setCards(next.wordIds.length > 0 ? next : null);
    }
  }, [db, words, setCards]);

  const moveCards = useCallback((delta: -1 | 1) => {
    const current = cardsRef.current;
    if (!current) return;
    const next = moveCard(current, delta);
    if (next === current) return;
    setCardNotice(null);
    setCards(next);
    void checkCard(delta);
  }, [checkCard, setCards]);

  const beginRound = async (only: readonly RoundItem[] | null = null) => {
    if (starting) return;
    setStarting(true);
    try {
      const latest = await readData();
      const current = withKnownGroups(storedSettings, latest);
      // A collection this round was built from has gone. Asking about something else unannounced would be wrong, so the choice goes back to the learner.
      if (!only && current !== storedSettings) {
        setFresh(latest);
        changeSettings(current);
        setSession(null);
        return;
      }
      const lastAsked = sessionRef.current ? lastAskedOf(sessionRef.current) : null;
      // Listening is asked from the typed settings with only the question kind changed, and those settings are
      // what the round keeps, so the typed question type is still there afterwards.
      const chosen = study.study === 'listen' ? settingsFor(current, study) : current;
      const audio = chosen.mode === 'listen' ? await loadAudioIndex() : null;
      const { eligible } = eligibilityOf(latest, chosen, audio);
      const active = new Set(latest.words.map((entry) => entry.id));
      const round = only
        ? shuffled(only.filter((entry) => active.has(entry.wordId)), Math.random)
        : buildRound({ words: eligible, mode: chosen.mode, count: chosen.count, history: latest.history, doubtOf: (id) => doubtFrom(latest.flagged.get(id) ?? []), random: Math.random, lastAsked });
      setFresh(latest);
      setSaveFailed(false);
      setMovedOn(false);
      // Practising what a test missed is an ordinary typed round; the test itself is over.
      setTest(null);
      setSession(round.length > 0 ? createSession(newId(), current, round) : null);
    } finally {
      setStarting(false);
    }
  };

  /**
   * The same choice of words as a typed round, read fresh. Every question and its options are made
   * here, once, so the test never changes under the learner, not even after a reload.
   */
  const beginTest = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const latest = await readData();
      const current = withKnownGroups(storedSettings, latest);
      if (current !== storedSettings) {
        setFresh(latest);
        changeSettings(current);
        setTest(null);
        return;
      }
      const plan = testPlanOf(latest, current);
      const round = buildRound({ words: plan.eligible, mode: current.mode, count: current.count, history: latest.history, doubtOf: plan.doubtOf, random: Math.random, kindsOf: plan.kindsOf });
      const byId = new Map(latest.words.map((entry) => [entry.id, entry]));
      const questions = round.flatMap((entry): TestQuestion[] => {
        const target = byId.get(entry.wordId);
        if (!target || entry.track === 'listen') return [];
        const question = buildQuestion(plan.pool, target, entry.track, { doubt: plan.doubtOf(target.id), preferred: plan.preferred, random: Math.random });
        return question ? [question] : [];
      });
      setFresh(latest);
      setSession(null);
      setCards(null);
      setClosing(false);
      setTest(questions.length > 0 ? createTest(newId(), current, questions) : null);
    } finally {
      setStarting(false);
    }
  };

  /** Records the answer once, and the question stays on screen with its answer shown. */
  const answerTest = (at: number, option: number | 'blank') => {
    const current = testRef.current;
    if (!current) return;
    const next = option === 'blank' ? leaveBlank(current, at) : submitPick(current, at, option);
    if (next !== current) setTest(next);
  };

  /** Moves on, past any question whose word was deleted meanwhile. Only reads the database. */
  const advanceTest = async (at: number) => {
    const current = testRef.current;
    if (!current || moving.current) return;
    const next = nextTestQuestion(current, at);
    if (next === current) return;
    setTest(next);
    moving.current = true;
    try {
      for (let question = currentQuestion(next); question; ) {
        if (await getActiveWord(db, question.wordId)) break;
        const now = testRef.current;
        if (!now || now.id !== next.id) return;
        const settled = dropTestWord(now, question.wordId);
        setTest(settled);
        question = currentQuestion(settled);
      }
    } finally {
      moving.current = false;
    }
  };

  const answer = (text: string) => {
    const current = sessionRef.current;
    const currentEntry = current && currentItem(current);
    const currentWord = currentEntry && words.get(currentEntry.wordId);
    if (!current || !currentEntry || !currentWord || current.answered) return;
    const clean = text.trim();
    const evaluation = evaluateAnswer(currentWord, currentEntry.track, clean, { library, doubt: doubtFrom(data?.flagged.get(currentWord.id) ?? []) });
    const retry = currentEntry.attempts > 0;
    const next = submitAnswer(current, clean, evaluation);
    setSaveFailed(false);
    setSession(next);
    // Listening keeps its results in the round alone: nothing about it is written anywhere.
    if (currentEntry.track === 'listen') return;
    // Shown at once and saved behind it. This writes to the history table only, so it cannot touch a schedule.
    recordPracticeAttempt(db, { wordId: currentEntry.wordId, track: currentEntry.track, at: Date.now(), typed: clean, result: evaluation.result, hintsUsed: current.hinted ? 1 : 0, sessionId: current.id, ...(retry ? { retry: true } : {}) }).catch((error: unknown) => {
      console.error(error);
      setSaveFailed(true);
    });
  };

  /** Goes on, skipping a word deleted in the meantime and using its latest text if it was edited. */
  const advance = async () => {
    const current = sessionRef.current;
    if (!current?.answered || moving.current) return;
    await settleOn(nextQuestion(current));
  };

  /** Passes over a question whose recording will not play. It is not an answer, so nothing counts it. */
  const skip = async () => {
    const current = sessionRef.current;
    if (!current || current.answered || moving.current) return;
    await settleOn(skipQuestion(current));
  };

  const settleOn = async (start: Session) => {
    moving.current = true;
    try {
      let next = start;
      for (let entry = currentItem(next); entry; entry = currentItem(next)) {
        const latest = await getActiveWord(db, entry.wordId);
        if (latest) {
          words.set(latest.id, latest);
          break;
        }
        next = dropWord(next, entry.wordId);
      }
      setSaveFailed(false);
      setMovedOn(true);
      setSession(next);
    } finally {
      moving.current = false;
    }
  };

  if (state.status === 'loading' && !data) return <Screen title={null} />;
  if (state.status === 'error' || !data) {
    return (
      <Screen title={t.practice.title}>
        <LoadError onRetry={() => void reload()} />
      </Screen>
    );
  }

  if (cards) {
    const id = currentCard(cards);
    const cardWord = id ? words.get(id) ?? null : null;
    return (
      <CardStudy
        session={cards}
        word={cardWord}
        doubtfulArticle={cardWord ? doubtFrom(data.flagged.get(cardWord.id) ?? []).article : false}
        notice={cardNotice}
        onMove={moveCards}
        onDirection={() => setCards({ ...cards, direction: cards.direction === 'tr_de' ? 'de_tr' : 'tr_de' })}
        onHidden={() => setCards({ ...cards, hidden: !cards.hidden })}
        onRestart={() => {
          setCardNotice(null);
          setCards(restartCards(cards));
        }}
        onSetup={() => {
          setCardNotice(null);
          setCards(null);
        }}
        onClose={leave}
      />
    );
  }

  if (test) {
    const question = currentQuestion(test);
    if (!question) {
      const { missed } = scoreTest(test);
      return (
        <TestSummary test={test} onClose={leave}>
          <button type="button" class="btn btn-primary btn-block" onClick={() => void beginTest()}>{t.practice.test.again}</button>
          {missed.length > 0 && <button type="button" class="btn btn-block" onClick={() => void beginRound(missed.map(({ question: entry }) => ({ wordId: entry.wordId, track: entry.kind })))}>{t.practice.test.missedRound}</button>}
          <button type="button" class="btn btn-quiet btn-block" onClick={() => setTest(null)}>{t.practice.changeSettings}</button>
        </TestSummary>
      );
    }
    const { at } = test;
    return (
      <>
        <TestStep question={question} stepKey={`${test.id}:${at}`} at={at} total={test.questions.length} answered={shownPick(test)} last={at === test.questions.length - 1} onPick={answerTest} onBlank={(index) => answerTest(index, 'blank')} onNext={(index) => void advanceTest(index)} onClose={askToClose} />
        {closing && testHasProgress(test) && (
          <ConfirmDialog
            title={t.practice.test.closeTitle}
            body={<p class="dialog-warning">{t.practice.test.closeBody}</p>}
            confirmLabel={t.practice.closeConfirm}
            cancelLabel={t.practice.keepGoing}
            onConfirm={leave}
            onCancel={() => setClosing(false)}
          />
        )}
      </>
    );
  }

  if (session && isFinished(session)) {
    const summary = summarize(session);
    return (
      <PracticeSummary
        summary={summary}
        wordOf={(id) => words.get(id)}
        onClose={leave}
      >
        <button type="button" class="btn btn-primary btn-block" onClick={() => void beginRound()}>{t.practice.anotherRound}</button>
        {summary.toReview.length > 0 && <button type="button" class="btn btn-block" onClick={() => void beginRound(summary.toReview.map(({ wordId, track }) => ({ wordId, track })))}>{t.practice.missedRound}</button>}
        <button type="button" class="btn btn-quiet btn-block" onClick={() => setSession(null)}>{t.practice.changeSettings}</button>
      </PracticeSummary>
    );
  }

  if (!session || !item || !word) {
    return <PracticeSetup data={data} settings={settings} study={study} onChange={changeSettings} onStudyChange={changeStudy} onStart={() => void (study.study === 'cards' ? beginCards() : study.study === 'test' ? beginTest() : beginRound())} />;
  }

  return (
    <>
      <QuestionStep
        word={word}
        track={item.track}
        listen={item.track === 'listen' ? { autoplay: movedOn, onSkip: () => void skip(), onEnd: askToClose } : undefined}
        issues={data.flagged.get(word.id) ?? []}
        stepKey={stepKey}
        answered={answered}
        hints={session.hints}
        done={doneCount(session)}
        total={roundSize(session)}
        retries={retriesWaiting(session)}
        tag={(answered ? answered.retry : item.attempts > 0) ? t.practice.retry : null}
        lastStep={answered !== null && session.queue.length === 1}
        saveMessage={saveFailed ? t.practice.saveFailed : null}
        onSubmit={answer}
        onNext={() => void advance()}
        onHint={() => {
          if (sessionRef.current) setSession(markHintUsed(sessionRef.current));
        }}
        onClose={askToClose}
      />
      {closing && hasProgress && (
        <ConfirmDialog
          title={t.practice.closeTitle}
          body={<p class="dialog-warning">{session.items.every((entry) => entry.track === 'listen') ? t.practice.closeBodyListen : t.practice.closeBody}</p>}
          confirmLabel={t.practice.closeConfirm}
          cancelLabel={t.practice.keepGoing}
          onConfirm={leave}
          onCancel={() => setClosing(false)}
        />
      )}
    </>
  );
}

/** Drops collections deleted since the choice was made. The same object when nothing changed. */
function withKnownGroups(settings: PracticeSettings, data: PracticeData): PracticeSettings {
  const known = new Set(data.groups.map((item) => item.group.id));
  const groupIds = settings.scope.groupIds.filter((id) => known.has(id));
  if (groupIds.length === settings.scope.groupIds.length) return settings;
  const scope = settings.scope.favorites || settings.scope.difficult || groupIds.length > 0 ? { ...settings.scope, groupIds } : ALL_WORDS;
  return { ...settings, scope };
}

function lastAskedOf(session: Session): RoundItem | null {
  const last = session.items.filter((entry) => entry.attempts > 0).at(-1);
  return last ? { wordId: last.wordId, track: last.track } : null;
}

