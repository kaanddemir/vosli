import { describe, expect, it } from 'vitest';
import { daytimeMood, isSleepTime, moodAt, nightOf } from '../src/core/foxMood';

const at = (hours: number, minutes: number, day = 5) => new Date(2026, 10, day, hours, minutes);

describe('fox mood', () => {
  it('sleeps from 23:30 until 05:30', () => {
    expect(isSleepTime(at(23, 29))).toBe(false);
    expect(isSleepTime(at(23, 30))).toBe(true);
    expect(isSleepTime(at(0, 0))).toBe(true);
    expect(isSleepTime(at(5, 29))).toBe(true);
    expect(isSleepTime(at(5, 30))).toBe(false);
  });

  it('treats both sides of midnight as one night', () => {
    expect(nightOf(at(23, 45, 5))).toBe(nightOf(at(3, 0, 6)));
    expect(nightOf(at(23, 45, 5))).not.toBe(nightOf(at(23, 45, 6)));
  });

  it('crosses a month boundary', () => {
    expect(nightOf(new Date(2026, 11, 1, 1, 0))).toBe(nightOf(new Date(2026, 10, 30, 23, 45)));
  });

  it('stays awake for the night it was woken, and sleeps again the next', () => {
    const woken = nightOf(at(23, 45, 5));
    expect(moodAt(at(23, 45, 5), null)).toBe('sleepy');
    expect(moodAt(at(23, 45, 5), woken)).not.toBe('sleepy');
    expect(moodAt(at(3, 0, 6), woken)).not.toBe('sleepy');
    expect(moodAt(at(23, 45, 6), woken)).toBe('sleepy');
  });

  it('keeps one face all day, and winks on most days', () => {
    expect(daytimeMood(at(6, 0))).toBe(daytimeMood(at(22, 0)));
    const year = Array.from({ length: 365 }, (_, i) => daytimeMood(new Date(2026, 0, i + 1)));
    const winking = year.filter((mood) => mood === 'mischievous').length;
    expect(winking).toBeGreaterThan(250);
    expect(year).toContain('curious');
    expect(year).not.toContain('sleepy');
  });
});
