# Vosli

<div align="center">
  <img src="public/icons/icon-512.png" alt="Vosli fox icon" width="160" />

**A German vocabulary trainer for Turkish speakers.**

English · [Türkçe](README.tr.md)
</div>

## What Is Vosli?

Vosli makes it easy to add, import and study German vocabulary with spaced repetition. It runs entirely in the browser, with no server, account or paid service.

The interface is in Turkish.

## What Can It Do?

- Adds, edits, searches and favorites words, and organizes them into collections.
- Imports pasted text, CSV and text-based PDF files, with a preview first.
- Offers Free Practice by typing or with cards; these modes never change the review schedule.
- Schedules reviews in Smart Review with FSRS-6.
- Checks German spelling and articles against an offline dictionary.
- Plays real human pronunciation recordings.
- Backs up everything to one JSON file and works offline as an installable PWA.

## How Does It Work?

1. The learner enters words or imports them from a file.
2. Imported rows are reviewed before saving; the dictionary only warns and suggests.
3. Words are studied in Free Practice or Smart Review.
4. Smart Review schedules German-to-Turkish, Turkish-to-German and article skills separately for each word.
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
├── public/dictionary/   # offline dictionary
├── scripts/             # dictionary and pronunciation data tools
├── tests/               # unit tests
└── e2e/                 # browser tests
```

## Data Sources

The offline dictionary is built from the German Wiktionary dump of 1 November 2026, via [Kaikki.org](https://kaikki.org/dewiktionary/rawdata.html).

Pronunciation recordings are [Wikimedia Commons](https://commons.wikimedia.org/) files linked from Wiktionary entries. They are not bundled or stored; each one loads from Commons when its speaker is tapped. Pronunciation therefore needs an internet connection, and Wikimedia can see which word is played.

How to update the dictionary and pronunciation data is described at the top of [scripts/build-dictionary.mjs](scripts/build-dictionary.mjs) and [scripts/sync-commons-audio.mjs](scripts/sync-commons-audio.mjs).

## License

The dictionary data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [public/dictionary/LICENSE.txt](public/dictionary/LICENSE.txt). Pronunciation recordings carry their own licenses, shown on each word's page.

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a>.</p>
</div>
