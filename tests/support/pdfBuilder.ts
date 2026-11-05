/** Writes small real PDFs, so tests exercise PDF.js itself without any course material. */
export interface PdfTextRun {
  text: string;
  x: number;
  y: number;
  size?: number;
  /** Degrees counter-clockwise. */
  angle?: number;
}

export interface PdfBuildOptions {
  /** Turns the document into one that asks for a password. */
  encrypted?: boolean;
  /** Character standing for the Turkish i glyph that has no Unicode value, as in the course PDFs. */
  brokenI?: string;
  rotate?: number;
}

// Single-byte font encoding: WinAnsi, plus Turkish letters placed on unused codes by glyph name.
const EXTRA: Readonly<Record<string, { code: number; glyph: string }>> = {
  ş: { code: 0x80, glyph: 'scedilla' },
  Ş: { code: 0x81, glyph: 'Scedilla' },
  ğ: { code: 0x82, glyph: 'gbreve' },
  Ğ: { code: 0x83, glyph: 'Gbreve' },
  ı: { code: 0x84, glyph: 'dotlessi' },
  İ: { code: 0x85, glyph: 'Idotaccent' },
  '–': { code: 0x86, glyph: 'endash' },
};

function encode(text: string, brokenI: string | undefined): string {
  let out = '';
  for (const char of text) {
    const extra = EXTRA[char];
    let code = extra ? extra.code : char.codePointAt(0)!;
    if (brokenI && char === 'i') code = brokenI.codePointAt(0)!;
    out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return out;
}

export function buildPdf(pages: readonly (readonly PdfTextRun[])[], options: PdfBuildOptions = {}): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 3;
  const differences = Object.values(EXTRA).map(({ code, glyph }) => `${code} /${glyph}`).join(' ');
  const broken = options.brokenI ? ` ${options.brokenI.codePointAt(0)} /i.loclTRK` : '';
  const font = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}${broken}] >> >>`);
  const kids: number[] = [];
  for (const runs of pages) {
    const content = runs
      .map(({ text, x, y, size = 10, angle = 0 }) => {
        const [cos, sin] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
        return `BT /F1 ${size} Tf ${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ${x} ${y} Tm (${encode(text, options.brokenI)}) Tj ET`;
      })
      .join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ${options.rotate ? `/Rotate ${options.rotate} ` : ''}/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const encrypt = options.encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -44 >>`) : null;

  const all = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] >>`, ...objects];
  let pdf = '%PDF-1.5\n';
  const offsets: number[] = [];
  all.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<00> <00>]` : ''} >>\nstartxref\n${start}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}

export type VocabRow = readonly [german: string, article: string, turkish: string];

/** One page laid out like the course PDFs: a slanted-free header, three centered columns, a fixed pitch. */
export function tablePage(rows: readonly VocabRow[], { heading, header = true, top = 700, pitch = 17 }: { heading?: string; header?: boolean; top?: number; pitch?: number } = {}): PdfTextRun[] {
  const center = (text: string, cx: number) => cx - text.length * 2.4;
  const runs: PdfTextRun[] = [];
  if (heading) runs.push({ text: heading, x: 40, y: top + 40, size: 10 });
  if (header) {
    runs.push({ text: 'ALMANCA', x: center('ALMANCA', 140), y: top, size: 12 }, { text: 'artikel', x: center('artikel', 310), y: top, size: 12 }, { text: 'türkçe', x: center('türkçe', 460), y: top, size: 12 });
  }
  rows.forEach(([german, article, turkish], index) => {
    const y = top - pitch * (index + 1);
    if (german) runs.push({ text: german, x: center(german, 140), y });
    if (article) runs.push({ text: article, x: center(article, 310), y });
    if (turkish) runs.push({ text: turkish, x: center(turkish, 460), y });
  });
  return runs;
}
