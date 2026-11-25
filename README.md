# Vosli

<div align="center">
  <img src="public/icons/icon-512.png" alt="Vosli fox icon" width="160" />

**A vocabulary learning app.**

English · [Türkçe](README.tr.md)
</div>

## What Is Vosli?

Vosli is a vocabulary learning app. Add words with your own meanings or import them from a file, then study them with practice and spaced repetition. It runs in the browser, with no server, account or paid service.

Two separate choices, both in Settings:

- **Learning language:** German or English. Each is its own workspace with its own words, collections and progress.
- **Interface language:** English (default), Turkish or German. It changes only the app's text, never your words or progress.

## What Can It Do?

- Adds, edits, searches and favorites words, and organizes them into collections.
- Imports pasted text, CSV and text-based PDF files, with a preview first.
- Offers Free Practice by typing, listening, cards, or a multiple-choice test built from your own words. It never changes the review schedule.
- Schedules reviews in Smart Review with FSRS-6.
- For German: checks spelling and articles against an offline dictionary and practices articles (der, die, das). English words are not checked.
- Plays real human pronunciation recordings: German, and American or British English.
- Backs up both languages to one JSON file (older German-only backups still restore) and works offline as an installable PWA.

## How Does It Work?

1. You enter words or import them from a file.
2. Imported rows are reviewed before saving; for German, the dictionary only warns and suggests.
3. Words are studied in Free Practice or Smart Review.
4. Smart Review schedules word-to-meaning and meaning-to-word separately for each word, and German articles as a skill of their own.
5. Data stays on the device, in IndexedDB.

## Technologies

- **Frontend:** Preact, TypeScript, Vite
- **Data:** IndexedDB, Dexie
- **Scheduling:** ts-fsrs (FSRS-6)
- **PDF reading:** PDF.js
- **Offline:** vite-plugin-pwa
- **Tests:** Vitest, Playwright, axe

## Setup

Requirements:

- Node.js 24 (`.nvmrc`)

Install dependencies and start the app:

```bash
npm ci
npm run dev
```

Basic checks:

```bash
npm run typecheck && npm test && npm run build
```

For browser tests, run `npx playwright install` once, then `npm run test:e2e`. The production build is written to `dist` and runs on any static host.

## Project Structure

```text
vosli/
├── src/
│   ├── core/            # storage-independent logic and FSRS
│   ├── data/            # database, transactions and backups
│   ├── audio/           # pronunciation recordings and playback
│   ├── ui/              # screens and components
│   └── styles/          # design tokens and styles
├── public/
│   ├── dictionary/de/   # German dictionary (spelling and article checks)
│   └── pronunciation/   # pronunciation lists and credits, per language (de/, en/)
├── scripts/             # dictionary and pronunciation data tools
├── tests/               # unit tests
└── e2e/                 # browser tests
```

## Data Sources

- **Dictionary and pronunciation lists:** built from the German Wiktionary dump of 1 November 2026, via [Kaikki.org](https://kaikki.org/dewiktionary/rawdata.html).
- **Recordings:** [Wikimedia Commons](https://commons.wikimedia.org/) files linked from German Wiktionary's German and English entries. English recordings are used only if Commons files them as American or British English.
- **Privacy:** recordings are not bundled or stored. Each one loads from Commons when you tap its speaker, so pronunciation needs an internet connection and Wikimedia can see which word is played.

Update steps are at the top of [scripts/build-dictionary.mjs](scripts/build-dictionary.mjs), [scripts/sync-commons-audio.mjs](scripts/sync-commons-audio.mjs) (`--language en` for English) and [scripts/build-english-audio.mjs](scripts/build-english-audio.mjs).

## License

The dictionary and pronunciation list data are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [public/dictionary/de/LICENSE.txt](public/dictionary/de/LICENSE.txt), [public/pronunciation/de/LICENSE.txt](public/pronunciation/de/LICENSE.txt) and [public/pronunciation/en/LICENSE.txt](public/pronunciation/en/LICENSE.txt). Pronunciation recordings carry their own licenses, shown on each word's page.

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
