// Renders Practice states with worst-case words, without needing a session to reach them. Served by the dev server only.
import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-ext-400.css';
import '@fontsource/fira-sans/latin-500.css';
import '@fontsource/fira-sans/latin-ext-500.css';
import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/fira-sans/latin-ext-600.css';
import '../src/styles/tokens.css';
import '../src/styles/app.css';
import { render } from 'preact';
import { t } from '../src/i18n/strings';
import { PracticeView, type PracticeViewProps } from '../src/ui/components/PracticeView';

const STATES: Record<string, PracticeViewProps> = {
  question: { done: 12, total: 20, cue: t.practice.cue.tr_de_noun, question: 'ayak', questionLang: 'tr', showLetters: true, hintAvailable: true, actionLabel: t.practice.check, actionDisabled: true },
  typing: { done: 12, total: 20, retries: 2, cue: t.practice.cue.tr_de_noun, tag: t.practice.retry, question: 'ayak', questionLang: 'tr', answer: 'der F', showLetters: true, hint: 'F••', hintSpoken: t.practice.hintSpoken('F…', '3'), hintAvailable: true, actionLabel: t.practice.check },
  hint: { done: 12, total: 20, cue: t.practice.cue.tr_de_noun, question: 'Tuna buharlı gemi işletmeciliği şirketi', questionLang: 'tr', showLetters: true, hint: 'Donaudampf••••••••••••••••••••••••', hintSpoken: t.practice.hintSpoken('Donaudampf…', '34'), hintMore: true, hintAvailable: true, actionLabel: t.practice.check, actionDisabled: true },
  article: { done: 3, total: 10, cue: t.practice.cue.article, question: 'Geldautomat', questionLang: 'de', detail: 'bankamatik', choices: ['der', 'die', 'das'], actionLabel: t.practice.check, actionDisabled: true },
  correct: { done: 13, total: 20, cue: t.practice.cue.de_tr, question: 'lernen', questionLang: 'de', answer: 'öğrenmek', answerLang: 'tr', feedback: { kind: 'correct', title: t.practice.correct }, actionLabel: t.practice.next },
  wrong: { done: 13, total: 20, cue: t.practice.cue.de_tr, question: 'der Fuß', questionLang: 'de', answer: 'bacak', answerLang: 'tr', feedback: { kind: 'wrong', title: t.practice.wrong, answer: { text: 'ayak', lang: 'tr' } }, actionLabel: t.practice.next },
  revealed: { done: 4, total: 20, cue: t.practice.cue.de_tr, question: 'der Fuß', questionLang: 'de', answerLang: 'tr', feedback: { kind: 'revealed', title: t.practice.revealed, answer: { text: 'ayak', lang: 'tr' } }, actionLabel: t.practice.next },
  long: { done: 1284, total: 1284, retries: 12, cue: t.practice.cue.tr_de_noun, tag: t.practice.retry, question: 'Tuna buharlı gemi işletmeciliği şirketi, uzun bir Türkçe karşılık (ayrıca açıklama)', questionLang: 'tr', answer: 'die Donaudampfschiffahrtsgesellschaft', feedback: { kind: 'wrong', title: t.practice.reasons.typo, answer: { text: 'die Donaudampfschifffahrtsgesellschaft', lang: 'de' }, lines: [{ text: t.practice.otherMeaning('die Donaudampfschifffahrtsgesellschaftskapitänsmütze', 'kaptan şapkası'), lang: 'tr' }, { text: t.practice.hintUsed }], caution: t.practice.dictionaryCaution('der Donaudampfschifffahrtsgesellschaftskapitän') }, actionLabel: t.practice.seeSummary },
};

const state = new URLSearchParams(location.search).get('state') ?? 'question';
render(
  <div class="app app-focused">
    <main class="app-main">
      <PracticeView {...STATES[state]!} />
    </main>
  </div>,
  document.getElementById('app')!,
);
