import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVocabularyPages, type PdfPageText, type PdfTextItem } from '../src/core/pdf/layout';
import { validateFields } from '../src/core/vocabulary';
import { readPdfText, type PdfLibrary } from '../src/pdf/readPdf';

/**
 * The real course PDFs stay out of the repository, so this suite runs only where they are present,
 * in tests/fixtures/local or the folder named by PDF_SAMPLES. What is committed reveals no course
 * content: file hashes, counts, and a hash of the rows as transcribed by hand from page images.
 */
const dir = process.env.PDF_SAMPLES ?? 'tests/fixtures/local';
const samples = {
  'konu.pdf': { sha: '640bd1f3d424ca21bfbd3e5b0eed422118490c6513341b9760cb2c2ed52417db', pages: [34, 11], truth: '8d071d87ef4f233c14da663d566b2d462ef40e8426bfbe11fc9381e067f98831', section: 'SELAMLAŞMA VE VEDALAŞMAK. - DIE GRUßFORMELN' },
  'bolum-1.pdf': { sha: 'f714a4041cd00004c931bd697256dcfc48a86e94f9361e02073b7000e3927c18', pages: [34, 34, 13, 0], truth: '009bf16b8bb9a1ab6d652f7ce701302481441798c6d5eef9357d7e2aee02a387', section: 'ALFABE - DAS ALPHABET' },
  'bolum-2.pdf': { sha: '57c4879bebf4a634fcd9b3475e8c06c282205ed98660660053e1ff8271166169', pages: [34, 34, 34, 34, 13], truth: '9105e611078cdbc76a4b938a77a4d1ba125b74fdeddb622b91d9eed31ac9846c', section: 'TELAFFUZ - DIE AUSSPRACHE' },
};
const available = Object.keys(samples).every((name) => existsSync(`${dir}/${name}`));
const fingerprint = (rows: readonly { german: string; article: string; turkish: string }[]) =>
  createHash('sha256').update(rows.map((row) => `${row.german}|${row.article || '-'}|${row.turkish}`).sort().join('\n')).digest('hex');

describe.skipIf(!available)('the course PDFs', async () => {
  const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLibrary;
  const read = async (name: string) => parseVocabularyPages(await readPdfText(lib, new Uint8Array(readFileSync(`${dir}/${name}`))));

  for (const [name, sample] of Object.entries(samples)) {
    it(`${name} matches what was read by hand from its page images`, async () => {
      expect(createHash('sha256').update(readFileSync(`${dir}/${name}`)).digest('hex')).toBe(sample.sha);
      const result = await read(name);
      expect(result.pages.map((page) => page.rows)).toEqual(sample.pages);
      expect(fingerprint(result.rows)).toBe(sample.truth);
      expect(result.sections).toEqual([sample.section]);
      expect(result.rows.filter((row) => row.flags.length)).toEqual([]);
    });
  }

  it('total 275 rows', async () => {
    const counts = await Promise.all(Object.keys(samples).map(async (name) => (await read(name)).rows.length));
    expect(counts).toEqual([45, 81, 149]);
  });

  it('report the page of names as no table, and repair the broken i in each file', async () => {
    const one = await read('bolum-1.pdf');
    expect(one.pages[3]).toMatchObject({ mode: 'no_table', rows: 0 });
    expect(one.repairs.map((repair) => repair.count)).toEqual([109]);
    expect((await read('konu.pdf')).repairs.map((repair) => repair.count)).toEqual([32]);
    expect((await read('bolum-2.pdf')).repairs.map((repair) => repair.count)).toEqual([159]);
  });

  // A wrong row is acceptable only if the review shows or refuses it.
  it('never give a silently wrong row, however the page text is damaged', async () => {
    if (!existsSync(`${dir}/truth.json`)) return;
    const truth = JSON.parse(readFileSync(`${dir}/truth.json`, 'utf8')) as Record<string, { de: string; art: string; tr: string }[][]>;
    const base = new Map(await Promise.all(Object.keys(samples).map(async (name) => [name, await readPdfText(lib, new Uint8Array(readFileSync(`${dir}/${name}`)))] as const)));
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    type Pages = PdfPageText[];
    const each = (pages: Pages, change: (item: PdfTextItem, index: number) => void) => pages.forEach((page) => page.items.forEach(change));
    const scale = (factor: number) => (pages: Pages) => {
      each(pages, (item) => Object.assign(item, { x: item.x * factor, y: item.y * factor, width: item.width * factor, height: item.height * factor }));
    };
    const scenarios: Record<string, { damage: (pages: Pages) => void; minExact: number }> = {
      'y jitter 2pt': { damage: (pages) => each(pages, (item) => (item.y += random() * 4 - 2)), minExact: 275 },
      'y jitter 5pt': { damage: (pages) => each(pages, (item) => (item.y += random() * 10 - 5)), minExact: 0 },
      'x jitter 25pt': { damage: (pages) => each(pages, (item) => (item.x += random() * 50 - 25)), minExact: 275 },
      'scaled 0.6': { damage: scale(0.6), minExact: 275 },
      'scaled 0.25': { damage: scale(0.25), minExact: 275 },
      shuffled: { damage: (pages) => pages.forEach((page) => page.items.sort(() => random() - 0.5)), minExact: 275 },
      'no header': { damage: (pages) => pages.forEach((page) => (page.items = page.items.filter((item) => !/^(almanca|artikel|türkçe)$/i.test(item.text.trim())))), minExact: 275 },
      mirrored: { damage: (pages) => each(pages, (item) => (item.x = 595 - item.x - item.width)), minExact: 275 },
      'second bad glyph': { damage: (pages) => {
        let n = 0;
        each(pages, (item) => {
          if (item.text.includes('a') && n++ % 9 === 0) item.text = item.text.replace('a', '\u0015');
        });
      }, minExact: 0 },
      'real i mixed in': { damage: (pages) => each(pages, (item, index) => {
        if (index % 5 === 0) item.text = item.text.replace(/[\u001e\u001f]/g, 'i');
      }), minExact: 0 },
      'article cell deleted': { damage: (pages) => {
        let n = 0;
        pages.forEach((page) => (page.items = page.items.filter((item) => !(/^(der|d[\u001e\u001f]e|das)$/.test(item.text.trim()) && n++ % 10 === 0))));
      }, minExact: 0 },
      'meaning wrapped': { damage: (pages) => {
        let n = 0;
        pages.forEach((page) => {
          const added: PdfTextItem[] = [];
          for (const item of page.items) {
            if (item.x > 350 && item.y < 600 && item.text.includes(' ') && n++ % 3 === 0) {
              const [first, ...rest] = item.text.split(' ');
              item.text = first!;
              item.width *= 0.5;
              added.push({ ...item, text: rest.join(' '), y: item.y - 9 });
            }
          }
          page.items.push(...added);
        });
      }, minExact: 275 },
    };
    const report: string[] = [];
    for (const [label, { damage, minExact }] of Object.entries(scenarios)) {
      let exact = 0;
      const silent: string[] = [];
      for (const [name, pages] of base) {
        const left = new Map<string, number>();
        for (const row of truth[name]!.flat()) left.set(`${row.de}|${row.art}|${row.tr}`, (left.get(`${row.de}|${row.art}|${row.tr}`) ?? 0) + 1);
        const copy = structuredClone(pages);
        damage(copy);
        for (const row of parseVocabularyPages(copy).rows) {
          const key = `${row.german}|${row.article || '-'}|${row.turkish}`;
          if ((left.get(key) ?? 0) > 0) {
            left.set(key, left.get(key)! - 1);
            exact++;
          } else if (row.flags.length === 0 && validateFields(row.german, row.article, row.turkish, row.plural).length === 0) {
            silent.push(key);
          }
        }
      }
      report.push(`${label}: exact ${exact}, silent ${silent.length}`);
      expect(exact, label).toBeGreaterThanOrEqual(minExact);
      expect(silent, label).toEqual([]);
    }
    if (process.env.PDF_REPORT) writeFileSync(process.env.PDF_REPORT, `${report.join('\n')}\n`);
  });

  it('keep the doubtful source articles, unchanged', async () => {
    const rows = [...(await read('bolum-1.pdf')).rows, ...(await read('bolum-2.pdf')).rows];
    const article = (german: string) => rows.find((row) => row.german === german)?.article;
    expect([article('Geldautomat'), article('Moos'), article('Chor')]).toEqual(['das', 'der', 'das']);
  });
});
