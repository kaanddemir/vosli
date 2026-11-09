import { describe, expect, it } from 'vitest';
import { MASK, progressiveHints, spokenStage, stageSizes } from '../src/core/practice/hints';

const stages = (text: string) => progressiveHints(text).stages;
const shownLetters = (stage: string) => [...stage.matchAll(/[\p{L}\p{N}]/gu)].length;

describe('progressive hints', () => {
  it('reveal a long word step by step, from the left', () => {
    expect(stages('Schmetterling')).toEqual(['S••••••••••••', 'Sch••••••••••', 'Schmetter••••']);
  });

  it('give short words fewer stages instead of giving them away', () => {
    expect(stages('')).toEqual([]);
    expect(stages('X')).toEqual([]);
    expect(stages('Ei')).toEqual(['E•']);
    expect(stages('Tür')).toEqual(['T••']);
    expect(stages('Haus')).toEqual(['H•••', 'Ha••']);
    expect(stages('Apfel')).toEqual(['A••••', 'Apf••']);
    expect(stages('Banane')).toEqual(['B•••••', 'Ba••••', 'Bana••']);
  });

  it('never repeat a stage, never show the whole answer, and always keep enough hidden', () => {
    for (let letters = 0; letters <= 60; letters++) {
      for (let words = 1; words <= Math.max(1, letters); words++) {
        const sizes = stageSizes(letters, words);
        expect(sizes.length).toBeLessThanOrEqual(3);
        sizes.forEach((size, at) => {
          expect(size).toBeGreaterThan(at === 0 ? 0 : sizes[at - 1]!);
          expect(size).toBeLessThan(letters);
          if (letters >= 4) expect(letters - size).toBeGreaterThanOrEqual(Math.max(2, Math.ceil((3 * letters) / 10)));
        });
        if (letters >= 2) expect(sizes[0]).toBeGreaterThan(0);
      }
    }
    const long = stages('Donaudampfschifffahrtsgesellschaft');
    expect(long.map(shownLetters)).toEqual([1, 9, 23]);
    for (const stage of long) expect(stage).toHaveLength(34);
  });

  it('handle German and Turkish letters as single letters, in any case', () => {
    expect(stages('Übermäßig').at(-1)).toBe('Übermä•••');
    expect(stages('ağaç')).toEqual(['a•••', 'ağ••']);
    expect(stages('İstanbul')).toEqual(['İ•••••••', 'İs••••••', 'İstan•••']);
    expect(stages('ışık')[0]).toBe('ı•••');
    expect(stages('şöyle böyle')[0]).toBe('ş•••• b••••');
    // A decomposed umlaut is one letter, not a letter and a mark.
    expect(stages('Tür')).toEqual(['T••']);
  });

  it('keep spaces, hyphens and apostrophes, and start every word of a phrase', () => {
    expect(stages('guten Morgen')).toEqual(['g•••• M•••••', 'gu••• M•••••', 'gute• Mor•••']);
    expect(stages('E-Mail')).toEqual(['E-M•••', 'E-Ma••']);
    expect(stages('das ist gut')).toEqual(['d•• i•• g••', 'da• is• gu•']);
    expect(stages("Wie geht's?")[0]).toBe("W•• g•••'•?");
    expect(stages('a b c')).toEqual(['a • •']);
  });

  it('count letters for a screen reader and read hidden runs as one pause', () => {
    expect(progressiveHints('guten Morgen').letters).toBe(11);
    expect(spokenStage('gu••• M•••••')).toBe('gu… M…');
    expect(spokenStage(`E-M${MASK.repeat(3)}`)).toBe('E-M…');
  });
});
