// Draws every app icon from public/icons/vosli-mark.svg. Run with: node scripts/build-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const DIR = new URL('../public/icons/', import.meta.url);
const CREAM = '#F7F5F1';
const mark = readFileSync(new URL('vosli-mark.svg', DIR), 'utf8').trim().replace(/^<svg[^>]*>|<\/svg>$/g, '');

/** radius in the 512 grid; scale leaves room around the fox (maskable icons may be cropped to a circle). */
const icon = (radius, scale) => {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${CREAM}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${mark}</g></svg>`;
};

const rounded = icon(96, 0.8);
writeFileSync(new URL('icon.svg', DIR), `${rounded}\n`);

const browser = await chromium.launch();
for (const [file, size, svg] of [
  ['icon-192.png', 192, rounded],
  ['icon-512.png', 512, rounded],
  ['apple-touch-icon.png', 180, icon(0, 0.8)],
  ['icon-maskable-512.png', 512, icon(0, 0.68)],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
  writeFileSync(new URL(file, DIR), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
