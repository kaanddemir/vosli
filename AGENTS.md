# AGENTS.md

Guidance for AI coding agents working on Vosli. For what the app does and how to set it up, see [README.md](README.md).

## Project Overview

Vosli is a vocabulary learning app. Learners study **German or English** (the *learning language*, one workspace each) and enter their own meanings. The UI is **English (default), Turkish or German** (the *interface language*). Both are chosen in Settings and apply without a reload; the learning language is also chosen on first start. Reset all data keeps a valid interface language and otherwise starts in English.

- Words are added by hand or imported (pasted text, CSV, text-based PDF) with a preview, then organized into favorites and collections.
- Study modes: **Free Practice** (typing, listening, cards, multiple-choice Test) and **Smart Review** (FSRS-6).
- German words are checked against an offline dictionary; English words are not. Pronunciation plays human recordings from Wikimedia Commons: German, and American or British English.
- No server or account. Data lives in IndexedDB, backs up to one JSON file, and the app works offline as an installable PWA.
- Stack: Preact, TypeScript, Vite, vite-plugin-pwa, Dexie, ts-fsrs, PDF.js; Vitest, Playwright and axe for tests.

## Architecture

| Area | Where | Rules |
| --- | --- | --- |
| Pure logic | `src/core/` | No storage, DOM or UI imports. Identity, validation, dictionary lookup, practice answers and selection, scheduling. |
| Persistence | `src/data/` | Dexie database (`db.ts`), migrations (`schema.ts`), backups, repositories. UI reads and writes through these modules; no new direct Dexie queries in components. |
| UI | `src/ui/` | Screens in `screens/`, shared pieces in `components/`. Reuse `List`, `WordList`, `Modal`, `PopoverButton`, `Icon` and similar before writing new ones. |
| Text | `src/i18n/` | All interface text; see **Interface text** below. |
| Styles | `src/styles/tokens.css`, `src/styles/app.css` | Tokens are the only source of visual values. |
| Audio | `src/audio/` | Pronunciation index (one per learning language) and the shared player. |

- **Preact + TypeScript:** hooks and function components. Keep strict types; `npm run typecheck` must stay clean.
- **Interface text:** `tr.ts` (Turkish, and the shape every language must match), `en.ts` (US English), `de.ts` (German, informal du), `strings.ts` (the live `t`), `locale.ts` (the saved choice), `format.ts` (numbers and dates, always in the device's time zone).
  - No hardcoded interface text in components. Every key exists in every language; counts are passed as numbers so each language pluralizes them.
  - A learner's word goes into a sentence exactly as saved (`der Apfel`): German templates quote it („…“) or put it after a colon, never re-inflect it.
  - Read `t` while rendering, never at module level, or a language change will not reach it.
- **Vite + PWA:** Workbox precaches the build output, including `public/dictionary/de/*.txt` and `public/pronunciation/<language>/*.txt`. Everything the app needs offline must be in the build; the only runtime network call is pronunciation playback.
- **Dexie/IndexedDB:** schema changes are a new entry appended to `MIGRATIONS` in `src/data/schema.ts`; never edit a released migration. Backups (`src/data/backup.ts`) check the schema version and must keep reading older ones: a v1 backup is checked by the frozen rules in `src/data/backupV1.ts` (never edit it), converted to German, then checked by the current rules. A restore replaces every table in one transaction, then the app reloads.
- **Learning languages:**
  - Data: words, groups and sources carry `language: 'de' | 'en'` (`src/core/learningLanguage.ts`). Word identity and source file hash are unique per language (`[language+identityKey]`, `[language+fileHash]`). Cards, logs, memberships and import rows follow their word or source. Data functions take the language explicitly; writes refuse cross-language links (`LanguageMismatchError`). `meta` holds `learningLanguage` and `onboarding` (`src/data/learningMeta.ts`).
  - UI: `useLearningLanguage()` (`src/ui/workspace.ts`) gives the open workspace; screens are keyed by it. Saved sessions and settings are per language (`src/ui/practiceStorage.ts`). A switch waits while a study session, an import or an unsaved edit is open. Settings asks before switching (`WorkspaceSwitcher`); the welcome and a backup restore do not.
  - German only: article colors, the article choice and letters, dictionary checks, the import review's filter, Article/Plural import columns (`columnRolesFor`, `draftsFor`).
  - Per-workspace visuals: Home's scene (`HomeScene`) is Berlin with black, red and gold bunting for German and London with navy, red and off-white for English, around the same fox. The Dictionary's empty-state letters (`EmptyFox`) are ä/ß or A/Z.
- **Vocabulary identity:** `identityKey()` in `src/core/identity.ts` decides when two rows are the same word (lemma, article, optional sense tag; case-sensitive), within one learning language. Duplicate detection and imports go through it.
- **FSRS:** `src/core/scheduling/fsrs.ts` is the only module that imports ts-fsrs. The scheduler version is pinned on purpose. Cards are scheduled per word and track: `de_tr` (word to meaning), `tr_de` (meaning to word) and, German only, `article`. The track names are historical and also used for English.
- **Study modes:**
  - Smart Review (`src/data/smartReview.ts`) is the only path that changes cards and writes `scheduled` logs.
  - Free Practice writes `practice` logs (history only, no scheduling fields).
  - Listening keeps its results in the round and writes no logs.
  - Card Study is unscored and writes nothing to scheduling.
  - Test (`src/core/practice/choices.ts`, `test.ts`) is read-only: options come only from saved words; its state lives in `sessionStorage`.
- **Language data layout:** one folder or file per learning language code:
  - `public/dictionary/de/`: the German dictionary (English has none).
  - `public/pronunciation/<language>/`: `credits.txt` and `LICENSE.txt`, plus `recordings.txt` for English.
  - `scripts/data/commons-audio-<language>.tsv`: Commons checks (`commonsCachePath` in `scripts/dictionary-audio.mjs`).
  - The build scripts take the `public` folder and write their language's folders. Generated files are never hand-edited.
- **Dictionary:** sorted text files read by binary search (`src/core/dictionary.ts`), built by `scripts/build-dictionary.mjs` from a Kaikki/Wiktionary dump. It only warns and suggests; it never silently changes a learner's words.
- **Pronunciation:**
  - German: recordings are chosen at dictionary build time and stored as tags in `public/dictionary/de/lemmas.txt`.
  - English: `public/pronunciation/en/recordings.txt`, built by `scripts/build-english-audio.mjs`. Rules (`scripts/english-audio.mjs`): the title, and any Commons redirect target, must say the word; Commons must file it as American or British English; American first. `tests/english-audio-data.test.ts` checks the shipped lists and layout.
  - Each language has its own index, and a word is only looked up in its own language's (`AUDIO_FILES` in `src/audio/audioIndex.ts`).
  - Playback streams from Commons through one shared player (`src/audio/pronunciation.ts`), only after a tap on `SpeakerButton`; switching workspace stops it. No TTS, no audio caching, no guessed filenames.
- **Commons metadata sync:** `npm run audio:sync` (`scripts/sync-commons-audio.mjs`, logic in `scripts/commons-sync.mjs`) is an explicit, rate-limited, resumable command that writes `scripts/data/commons-audio-de.tsv` under a lock; `-- --language en` checks English recordings and their Commons categories into `commons-audio-en.tsv`. Builds read these files offline and leave unconfirmed recordings silent.

## Adding New Learning Languages

**Current implementation:** German and English. Only `de` may have articles or `article` cards. German-specific: articles (`der`/`die`/`das`), gender, the `article` track, noun capitalization, German answer checking, the dictionary format and Commons `De-` recording names. English has no articles and no dictionary check, and its own answer rules (case-insensitive with a note, apostrophes kept).

**Guidelines for when that work is requested:**

- Do not assume German grammar applies elsewhere; articles and gender must not become required fields or universal tracks.
- Keep language-specific rules (identity, validation, answer checking, dictionary parsing) apart from shared functionality (collections, imports, backups, scheduling, UI shell).
- Account for other scripts, capitalization rules (or none), inflection and pronunciation sources.
- Each language has its own vocabulary identity. Never deduplicate across languages: the same spelling in two languages is two words.
- Keep each language's data files and sources separate, with their own licenses and credits.
- Offer only question types that make sense for the language.
- Keep the FSRS engine language-agnostic; tracks are what vary per language.
- Extend shared abstractions only when a real language needs them.

**Interface language vs. learning language:** the *interface language* is the UI locale (all text in `src/i18n`). The *learning language* is what is studied (vocabulary, grammar, pronunciation, exercises). They are chosen independently: a German interface is not a German learning language. Meanings are the learner's own (`meaningLang()` tags them `lang="tr"` in the German workspace only).

- Never infer one from the other.
- Keep UI translations out of vocabulary data, grammar rules, pronunciation and learning logic.
- A new interface language must not require a new learning language, and a new learning language must not require translating the whole interface.
- Switching the interface language must never change vocabulary, FSRS schedules, review history or progress.
- Comparison, normalization and answer validation belong to the learning language, never to the UI locale.

## Design & UX

- **Berlin Modern identity:** a warm, calm palette with one red accent, Fira Sans, and restrained surfaces. Every color, size, space, radius and motion value comes from `src/styles/tokens.css`; `tests/tokens.test.ts` checks contrast.
- **Consistency first:** extend existing patterns and components. No redesigns, new visual styles or extra components unless asked. Remove noise rather than add decoration.
- **Themes:** light and dark are both first-class; check both. `public/theme-boot.js` sets `data-theme` before paint.
- **Responsive:** mobile-first. Layouts must hold from 320 px wide to desktop and at 200% text size; sizes that hold text are in `rem`.
- **Accessibility:** real buttons and links, visible focus, full keyboard use, correct labels and live regions for screen readers, adequate tap targets. Concealed answers must not leak through `aria-*` text, titles or styling.
- **Motion:** short and purposeful; honor `prefers-reduced-motion` and forced colors, as `app.css` does.

## Design Skills

These skills may be installed; use the relevant ones for UI and design work:

- `apple-design` — product-level polish, clarity, interaction quality, accessibility.
- `emil-design-eng` — implementation craft, visual consistency, layout, responsive behavior.
- `break-ui` — adversarial review with worst-case data: overflow, edge cases, accessibility problems.
- `mobile-native` — touch targets, small screens, mobile browser behavior.

Pick the ones that fit the change; a small non-UI change needs none. If a skill is not available, follow the principles above and continue without blocking.

## Development & Validation

Use Node.js 24 (`.nvmrc`, `engines`).

| Script | Use |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run typecheck` | TypeScript check |
| `npm test` | All unit tests (Vitest) |
| `npm run build` | Typecheck and production build |
| `npm run test:e2e` | All Playwright projects (large) |
| `npm run test:smoke` | Chromium `@smoke` tests |
| `npm run verify` | Everything above in sequence |
| `npm run audio:sync` | Commons metadata sync (`-- --language en` for English); only when explicitly asked |

- Run focused tests for targeted changes: `npx vitest run tests/<file>.test.ts`, `npx playwright test e2e/<file>.spec.ts --project=chromium`.
- Run `npm run typecheck` and `npm run build` when code changes.
- Use browser tests for interaction, layout or responsive changes. Do not run the full E2E suite for minor edits.
- Never weaken, skip or delete a test to make it pass; fix the cause or report it.
- Keep dependencies minimal and pinned; do not add one without a clear need and approval.
- Preserve offline behavior and do not change unrelated functionality.

## Data Safety

- Never silently delete or rewrite learner words, review history, cards or collections.
- Keep migrations append-only and backups compatible unless a change is explicitly authorized.
- Only Smart Review may change FSRS state (see **Study modes**); nothing else touches cards or scheduled logs.
- Do not reveal hidden answers through audio, visual styling or accessibility metadata. Speakers appear only when the learner's word is visible or the answer has been revealed, and only play recordings of that word's own learning language.
- Never store pronunciation audio in IndexedDB, caches or JSON backups.
- `npm run build`, `npm run dev` and CI must never contact Wikimedia Commons.
- Run expensive external syncs (`npm run audio:sync`) only on explicit request, and never alongside another run.

## Git & Change Management

- Never commit or push without explicit approval. Never force-push or rewrite history without explicit authorization.
- Keep changes scoped to the task.
- Do not commit dumps, large datasets, audio files, scratch output, lock or temp files, or local PDF samples (`tests/fixtures/local`).
- After implementing, summarize what changed and which checks ran, including any failures.
