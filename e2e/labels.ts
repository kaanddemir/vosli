/**
 * Patterns built from the interface text itself, for labels with a blank in them. A test then follows whichever
 * language it reads its strings from, instead of holding one language's wording.
 */
export const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BLANK = '\u0000';

/** A label with text filled in, such as editRow(name), for any text. */
export const anyText = (make: (text: string) => string): string => escapeRe(make(BLANK)).replace(BLANK, '.*');

/** A label with a count, such as commit(n), for any count, singular or plural. */
export const anyCount = (make: (count: number) => string): string => [1, 2].map((n) => escapeRe(make(n)).replace(String(n), '[\\d.,]+')).join('|');

/** Matches any of the patterns. */
export const label = (...patterns: string[]): RegExp => new RegExp(patterns.join('|'));
