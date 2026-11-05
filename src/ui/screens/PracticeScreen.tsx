import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newId } from '../../core/id';
import { createCardSession, currentCard, dropCard, moveCard, restartCards, reviveCardSession, type CardSession } from '../../core/practice/cards';
import { evaluateAnswer, type AnswerWord } from '../../core/practice/answers';
import { ALL_WORDS, buildRound, doubtFrom, shuffled, type RoundItem } from '../../core/practice/selection';
import { createSession, currentItem, doneCount, dropWord, isFinished, markHintUsed, nextQuestion, retriesWaiting, reviveSession, submitAnswer, summarize, type PracticeSettings, type Session } from '../../core/practice/session';
import { validatorWithin } from '../../dictionary/loadDictionary';
import { loadPracticeData, type PracticeData } from '../../data/practice';
import { getActiveWord, recordPracticeAttempt } from '../../data/repository';
import { t } from '../../i18n/strings';
import { CardStudy } from '../components/CardStudy';
import { ConfirmDialog } from '../components/Modal';
import { DEFAULT_SETTINGS, eligibilityOf, PracticeSetup, settingsFor } from '../components/PracticeSetup';
import { PracticeSummary } from '../components/PracticeSummary';
import { QuestionStep } from '../components/QuestionStep';
import { LoadError, Screen } from '../components/Screen';
import { useDb } from '../dbContext';
import { readSavedCards, readSavedSession, readSavedSettings, readStudyChoice, saveCards, saveSession, saveSettings, saveStudyChoice, type StudyChoice } from '../practiceStorage';
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

  /** Card study keeps only its place in the cards, in this tab. Nothing is written to learning data. */
  const setCards = useCallback((next: CardSession | null) => {
    cardsRef.current = next;
    setCardsState(next);
    saveCards(next);
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
    const restoredCards = restored ? null : reviveCardSession(readSavedCards(), active);
    cardsRef.current = restoredCards;
    setCardsState(restoredCards);
    saveCards(restoredCards);
    sessionRef.current = restored;
    setSessionState(restored);
    saveSession(restored);
    setSettingsState(restoredSettings(restored, data));
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
  const stepKey = session ? `${session.id}:${session.items.reduce((sum, entry) => sum + entry.attempts, 0)}:${answered ? 'a' : 'q'}` : '';

  const leave = useCallback(() => {
    setSession(null);
    setCards(null);
    goHome();
  }, [setSession, setCards]);

  const askToClose = useCallback(() => {
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
      const { eligible } = eligibilityOf(latest, current);
      const active = new Set(latest.words.map((entry) => entry.id));
      const round = only
        ? shuffled(only.filter((entry) => active.has(entry.wordId)), Math.random)
        : buildRound({ words: eligible, mode: current.mode, count: current.count, history: latest.history, doubtOf: (id) => doubtFrom(latest.flagged.get(id) ?? []), random: Math.random, lastAsked });
      setFresh(latest);
      setSaveFailed(false);
      setSession(round.length > 0 ? createSession(newId(), current, round) : null);
    } finally {
      setStarting(false);
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
    moving.current = true;
    try {
      let next = nextQuestion(current);
      for (let entry = currentItem(next); entry; entry = currentItem(next)) {
        const latest = await getActiveWord(db, entry.wordId);
        if (latest) {
          words.set(latest.id, latest);
          break;
        }
        next = dropWord(next, entry.wordId);
      }
      setSaveFailed(false);
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
    return <PracticeSetup data={data} settings={settings} study={study} onChange={changeSettings} onStudyChange={changeStudy} onStart={() => void (study.study === 'cards' ? beginCards() : beginRound())} />;
  }

  return (
    <>
      <QuestionStep
        word={word}
        track={item.track}
        issues={data.flagged.get(word.id) ?? []}
        stepKey={stepKey}
        answered={answered}
        hinted={session.hinted}
        done={doneCount(session)}
        total={session.items.length}
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
          body={<p class="dialog-warning">{t.practice.closeBody}</p>}
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

function restoredSettings(session: Session | null, data: PracticeData): PracticeSettings {
  return session?.settings ?? restoreSettings(data);
}

function lastAskedOf(session: Session): RoundItem | null {
  const last = session.items.filter((entry) => entry.attempts > 0).at(-1);
  return last ? { wordId: last.wordId, track: last.track } : null;
}

