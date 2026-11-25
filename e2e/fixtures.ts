import { expect, test as base } from '@playwright/test';

/**
 * Every spec runs as a learner who used Vosli before learning languages, in German, unless it asks otherwise: the
 * welcome is a first-start question, and these specs are about everything after it. The database is opened once,
 * empty, before the app loads, exactly as an older release would have left one. The app's own upgrade then finds an
 * existing database and records it as German and settled, through the same migration real learners go through, and
 * the interface language stays unsaved. A database that already exists is only opened and closed again.
 *
 * Specs about the first start set existingLearner to false and meet the welcome as a new learner does.
 */
export const test = base.extend<{ existingLearner: boolean }>({
  existingLearner: [true, { option: true }],
  context: async ({ context, existingLearner }, use) => {
    if (existingLearner) {
      await context.addInitScript(() => {
        try {
          const request = indexedDB.open('vosli');
          request.onsuccess = () => request.result.close();
        } catch {
          // No IndexedDB here: the app shows its own message, as it would for anyone.
        }
      });
    }
    await use(context);
  },
});

export { expect };
