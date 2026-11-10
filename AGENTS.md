# AGENTS.md

Guidance for AI coding agents working on Vosli. For what the app does and how to set it up, see [README.md](README.md).

## Project Overview

Vosli is a local-first German vocabulary trainer for Turkish speakers. The learning language is **German only**; the interface language is **Turkish only**.

- Words are added by hand or imported (pasted text, CSV, text-based PDF) with a preview, then organized into favorites and collections.
- Study modes: **Free Practice** (Yazarak typing, Dinleyerek listening, Kartlarla cards, or a multiple-choice Test) and **Smart Review** (FSRS-6 scheduling).
- An offline dictionary checks spelling and articles; pronunciation plays human recordings from Wikimedia Commons on demand.
- There is no server or account. Data lives in IndexedDB, can be backed up to one JSON file, and the app works offline as an installable PWA.
- Stack: Preact, TypeScript, Vite, vite-plugin-pwa, Dexie, ts-fsrs, PDF.js; Vitest, Playwright and axe for tests.

## Architecture

| Area | Where | Rules |
| --- | --- | --- |
| Pure logic | `src/core/` | No storage, DOM or UI imports. Identity, validation, dictionary lookup, practice answers and selection, scheduling. |
| Persistence | `src/data/` | Dexie database (`db.ts`), migrations (`schema.ts`), backups, repositories. UI should read and write through these modules; do not add new direct Dexie queries in components. |
| UI | `src/ui/` | Screens in `screens/`, shared pieces in `components/`. Reuse `List`, `WordList`, `Modal`, `PopoverButton`, `Icon` and similar before writing new ones. |
| Text | `src/i18n/strings.ts` | All interface text lives here. No hardcoded Turkish in components. |
| Styles | `src/styles/tokens.css`, `src/styles/app.css` | Tokens are the only source of visual values. |
| Audio | `src/audio/` | Pronunciation index and player. |

- **Preact + TypeScript:** hooks and function components. Keep strict types; `npm run typecheck` must stay clean.
- **Vite + PWA:** Workbox precaches the build output, including `public/dictionary/*.txt`. Anything the app needs offline must be part of the build; nothing at runtime may depend on a network call except pronunciation playback.
- **Dexie/IndexedDB:** schema changes are a new entry appended to `MIGRATIONS` in `src/data/schema.ts`. Never edit a released migration. Backup import/export (`src/data/backup.ts`) checks the schema version and must keep reading older backups.
- **Vocabulary identity:** `identityKey()` in `src/core/identity.ts` decides when two rows are the same word (lemma, article, optional sense tag; case-sensitive). Duplicate detection and imports go through it.
- **FSRS:** `src/core/scheduling/fsrs.ts` is the only module that imports ts-fsrs. The scheduler version is pinned on purpose; do not switch models casually. Cards are scheduled per word and per track (`de_tr`, `tr_de`, `article`).
- **Study modes:**
  - Smart Review (`src/data/smartReview.ts`) is the only path that changes cards and writes `scheduled` logs.
  - Free Practice writes `practice` logs (history only, no scheduling fields).
  - Listening keeps its results in the round only and writes no logs.
  - Card Study is unscored and writes nothing to scheduling.
  - Test (`src/core/practice/choices.ts`, `test.ts`) is read-only: options come only from saved words, and its state lives in `sessionStorage`.
- **Dictionary:** `public/dictionary/` holds generated, sorted text files read by binary search (`src/core/dictionary.ts`). They are produced by `scripts/build-dictionary.mjs` from a Kaikki/Wiktionary dump; do not hand-edit them. The dictionary only warns and suggests; it never silently changes a learner's words.
- **Pronunciation:** recordings are selected at dictionary build time and stored as tags in `lemmas.txt`; credits are in `audio-credits.txt`. The app streams audio from Commons through one shared player (`src/audio/pronunciation.ts`) only after an explicit tap, using `SpeakerButton`. No TTS, no audio caching, no guessed filenames.
- **Commons metadata sync:** `npm run audio:sync` (`scripts/sync-commons-audio.mjs`, logic in `scripts/commons-sync.mjs`) is a separate, explicit, rate-limited, resumable command that writes `scripts/data/commons-audio.tsv` under a lock. The dictionary build reads that file offline and leaves unconfirmed recordings silent.

## Adding New Learning Languages

**Current implementation:** German is hard-wired. Articles (`der`/`die`/`das`), gender, the `article` track, noun capitalization, the dictionary format and the Commons `De-` recording conventions are all German-specific. There is no language abstraction, and none should be added unless a task asks for a second language.

**Guidelines for when that work is requested:**

- Do not assume German grammar applies elsewhere. Articles and grammatical gender must not become required fields or universal practice tracks.
- Keep language-specific rules (identity, validation, answer checking, dictionary parsing) separate from shared functionality (collections, imports, backups, scheduling, UI shell).
- Account for different scripts and writing systems, capitalization rules (or none), inflection and pronunciation sources.
- Give each language its own vocabulary identity. Never deduplicate across languages: the same spelling in two languages is two words.
- Keep each language's dictionary files and sources separate, with their own licenses and credits.
- Offer only question types that make sense for the language (no article track where there are no articles).
- Keep the FSRS engine language-agnostic; tracks are what vary per language.
- Introduce the abstraction with the second language, shaped by real needs, not ahead of it.

**Interface language vs. learning language (future guideline, not implemented):** the *interface language* is the UI locale (navigation, buttons, settings, instructions, all text in `src/i18n`). The *learning language* is what the user studies (vocabulary, grammar rules, pronunciation, language-specific exercises). Today both are fixed (Turkish UI, German learning). In future they must vary independently: German or French could each be studied with a Turkish or English interface.

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
- **Motion:** short and purposeful; honor `prefers-reduced-motion` and forced colors, as `app.css` already does.

## Design Skills

These skills may be installed in your environment. Use the relevant ones for UI and design work:

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
| `npm run audio:sync` | Commons metadata sync; only when explicitly asked |

- Run focused tests for targeted changes: `npx vitest run tests/<file>.test.ts`, `npx playwright test e2e/<file>.spec.ts --project=chromium`.
- Run `npm run typecheck` and `npm run build` when code changes.
- Use browser tests for interaction, layout or responsive changes. Do not run the full E2E suite for minor edits.
- Never weaken, skip or delete a test to make it pass; fix the cause or report it.
- Keep dependencies minimal and pinned; do not add one without a clear need and approval.
- Preserve offline behavior and do not change unrelated functionality.

## Data Safety

- Never silently delete or rewrite learner words, review history, cards or collections.
- Keep migrations append-only and backups compatible unless a change is explicitly authorized.
- Only Smart Review may change FSRS state. Free Practice, Card Study and Test must never touch cards or scheduled logs.
- Do not reveal hidden answers through audio, visual styling or accessibility metadata. Speakers appear only when the German side is visible or the answer has been revealed.
- Never store pronunciation audio in IndexedDB, caches or JSON backups.
- `npm run build`, `npm run dev` and CI must never contact Wikimedia Commons.
- Run expensive external syncs (`npm run audio:sync`) only on explicit request, and never alongside another run.

## Git & Change Management

- Never commit or push without explicit approval. Never force-push or rewrite history without explicit authorization.
- Keep changes scoped to the task.
- Do not commit dumps, large datasets, audio files, scratch output, lock or temp files, or local PDF samples (`tests/fixtures/local`).
- After implementing, summarize what changed and which checks ran, including any failures.
