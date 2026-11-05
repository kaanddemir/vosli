import { describe, expect, it } from 'vitest';
import { applyGrade, createFsrsState, SCHEDULER_VERSION, type FsrsState, type Grade } from '../src/core/scheduling/fsrs';
import { T0 } from './support/fixtures';

const MIN = 60_000;
const DAY = 86_400_000;

async function walk(grades: Grade[]) {
  let state = await createFsrsState(T0);
  let now = T0;
  const intervals: number[] = [];
  for (const grade of grades) {
    state = await applyGrade(state, grade, now);
    intervals.push(state.dueAt - now);
    now = state.dueAt;
  }
  return { state, intervals };
}

describe('FSRS integration', () => {
  it('is pinned to FSRS-6 and declares it', () => {
    expect(SCHEDULER_VERSION).toContain('FSRS-6');
  });

  it('matches the validated chain (FSRS-6, not the FSRS-7 default)', async () => {
    const { intervals } = await walk(['good', 'good', 'good', 'good', 'good', 'good', 'good']);
    expect(intervals[0]).toBe(10 * MIN);
    expect(intervals.slice(1).map((ms) => Math.round(ms / DAY))).toEqual([2, 11, 46, 163, 498, 1348]);
  });

  it('keeps a new word in learning steps after a first correct answer', async () => {
    const state = await applyGrade(await createFsrsState(T0), 'good', T0);
    expect(state.dueAt - T0).toBeLessThan(DAY);
  });

  it('returns a failed card within minutes and counts the lapse', async () => {
    const { state, intervals } = await walk(['good', 'good', 'good', 'good', 'again']);
    expect(intervals.at(-1)).toBe(10 * MIN);
    expect(state.lapses).toBe(1);
  });

  it('gives shorter intervals for hard than good', async () => {
    const base = (await walk(['good', 'good', 'good'])).state;
    const now = base.dueAt;
    const hard = await applyGrade(base, 'hard', now);
    const good = await applyGrade(base, 'good', now);
    expect(hard.dueAt).toBeLessThan(good.dueAt);
  });

  it('is deterministic for the same history', async () => {
    const grades: Grade[] = ['good', 'good', 'again', 'hard', 'good', 'good', 'again', 'good', 'good'];
    expect((await walk(grades)).state).toEqual((await walk(grades)).state);
  });

  it('does not change the state it receives, so a saved state can restore an undo', async () => {
    const before = await createFsrsState(T0);
    const snapshot = structuredClone(before);
    const after = await applyGrade(before, 'good', T0);
    expect(before).toEqual(snapshot);
    expect(after).not.toEqual(before);
  });

  it('produces JSON-safe state that continues identically after a round trip', async () => {
    const { state } = await walk(['good', 'good', 'hard', 'good']);
    const revived = JSON.parse(JSON.stringify(state)) as FsrsState;
    expect(revived).toEqual(state);
    expect(typeof state.dueAt).toBe('number');
    const now = state.dueAt;
    expect(await applyGrade(revived, 'good', now)).toEqual(await applyGrade(state, 'good', now));
  });
});
