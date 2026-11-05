import { describe, expect, it } from 'vitest';
import { identityKey, normalizeText, stripClosingPunctuation } from '../src/core/identity';

describe('identityKey', () => {
  it('keeps words that differ by case or article apart', () => {
    expect(identityKey('morgen', null)).not.toBe(identityKey('Morgen', 'der'));
    expect(identityKey('essen', null)).not.toBe(identityKey('Essen', 'das'));
    expect(identityKey('See', 'der')).not.toBe(identityKey('See', 'die'));
    expect(identityKey('gut', null)).not.toBe(identityKey('Gut', 'das'));
  });

  it('does not merge a plural with its singular', () => {
    expect(identityKey('Äpfel', 'die')).not.toBe(identityKey('Apfel', 'der'));
  });

  it('treats the same word from another list as one record', () => {
    expect(identityKey('Was?', null)).toBe(identityKey('Was', null));
    expect(identityKey('  Auf   Wiedersehen! ', null)).toBe(identityKey('Auf Wiedersehen', null));
  });

  it('treats composed and decomposed umlauts as the same word', () => {
    expect(identityKey('Äpfel', 'die')).toBe(identityKey('Äpfel', 'die'));
    expect(identityKey('Fuß', 'der')).toBe('Fuß|der');
  });

  it('separates senses of the same form only when tagged', () => {
    expect(identityKey('Bank', 'die')).not.toBe(identityKey('Bank', 'die', 'oturak'));
  });
});

describe('normalization helpers', () => {
  it('collapses whitespace and keeps case', () => {
    expect(normalizeText('  der   Apfel ')).toBe('der Apfel');
  });

  it('removes only closing question and exclamation marks', () => {
    expect(stripClosingPunctuation('Tschüss!')).toBe('Tschüss');
    expect(stripClosingPunctuation('Wie?')).toBe('Wie');
    expect(stripClosingPunctuation('z.B.')).toBe('z.B.');
  });
});
