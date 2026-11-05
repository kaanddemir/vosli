import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = block(':root {');
const dark = block(":root[data-theme='dark']");

describe('Berlin Modern tokens', () => {
  it('uses the specified light palette', () => {
    expect(light).toMatchObject({ bg: '#f7f5f1', surface: '#ffffff', text: '#272727', accent: '#b7473a', border: '#e9e5de' });
  });

  it('uses the specified dark palette', () => {
    expect(dark).toMatchObject({ bg: '#191919', surface: '#252525', text: '#f2eee8', accent: '#d56e61', border: '#41403e' });
  });

  it('defines each theme once', () => {
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('keeps every color and font weight in the token file', () => {
    const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(app.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(app.match(/font-weight:\s*\d+/g)).toBeNull();
    expect(app.match(/font-size:\s*[\d.]+(rem|px)/g)).toBeNull();
  });

  for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
    it(`gives input boundaries 3:1 contrast in ${name}`, () => {
      expect(contrast(palette['border-strong']!, palette.surface!)).toBeGreaterThanOrEqual(3);
      expect(contrast(palette['border-strong']!, palette.bg!)).toBeGreaterThanOrEqual(3);
    });
  }

  for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
    it(`meets WCAG AA text contrast in ${name}`, () => {
      expect(contrast(palette.text!, palette.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text!, palette.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette['text-muted']!, palette.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette['text-muted']!, palette.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette['on-accent']!, palette.accent!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette['on-accent']!, palette['accent-strong']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent!, palette.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent!, palette.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent!, palette['accent-soft']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text!, palette['accent-soft']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.success!, palette['success-soft']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.success!, palette.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text!, palette['success-soft']!)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
    it(`keeps article colors readable on every surface a word sits on in ${name}`, () => {
      for (const article of ['der', 'die', 'das']) {
        const color = palette[`article-${article}`]!;
        expect(color).toBeDefined();
        for (const surface of ['bg', 'surface', 'accent-soft', 'success-soft']) expect(contrast(color, palette[surface]!)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
