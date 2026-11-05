import type { PdfPageText, PdfTextItem } from '../core/pdf/layout';

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;

type PdfProblem = 'too_large' | 'too_many_pages' | 'password' | 'corrupt' | 'no_text' | 'no_table' | 'too_many_rows' | 'reader_failed';

export class PdfReadError extends Error {
  override readonly name = 'PdfReadError';
  constructor(readonly problem: PdfProblem) {
    super(problem);
  }
}

export class PdfCancelled extends Error {
  override readonly name = 'PdfCancelled';
}

/** The small part of PDF.js used here, so the browser and the test runner can each supply their build. */
export interface PdfLibrary {
  getDocument(source: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{
        getViewport(options: { scale: number }): { transform: number[]; height: number };
        getTextContent(): Promise<{ items: object[] }>;
        cleanup(): void;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

const isText = (item: object): item is RawItem => 'str' in item;

/**
 * Viewport coordinates hold for rotated and cropped pages alike; y is turned back to grow upward.
 * Text not running along the line, such as a watermark, is left out.
 */
function toItem(raw: RawItem, viewport: { transform: number[]; height: number }): PdfTextItem | null {
  const [a, b, c, d, e, f] = viewport.transform as [number, number, number, number, number, number];
  const [ta, tb, , , tx, ty] = raw.transform as [number, number, number, number, number, number];
  // The course PDFs slant their table headers by 3.6°, so only text clearly off the horizontal counts as rotated.
  const across = ta * a + tb * c;
  const down = ta * b + tb * d;
  if (Math.abs(down) > Math.abs(across) * 0.25) return null;
  return { text: raw.str, x: tx * a + ty * c + e, y: viewport.height - (tx * b + ty * d + f), width: raw.width, height: raw.height, font: raw.fontName };
}

/** Why PDF.js refused a file. Its error classes are not reachable across builds, but their names are stable. */
function problemOf(error: unknown): PdfProblem {
  return (error as { name?: string } | null)?.name === 'PasswordException' ? 'password' : 'corrupt';
}

interface ReadOptions {
  signal?: AbortSignal | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/**
 * Reads positioned text from a PDF, one page at a time, inside PDF.js's worker. No page is kept
 * in memory after it has been read, and the worker always ends here, also on failure or cancel.
 */
export async function readPdfText(lib: PdfLibrary, bytes: Uint8Array, { signal, onProgress }: ReadOptions = {}): Promise<PdfPageText[]> {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfReadError('too_large');
  if (signal?.aborted) throw new PdfCancelled();

  const task = lib.getDocument({ data: bytes, verbosity: 0, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: false });
  const cancel = () => void task.destroy();
  signal?.addEventListener('abort', cancel, { once: true });
  const cancelled = () => {
    if (signal?.aborted) throw new PdfCancelled();
  };

  try {
    const document = await task.promise;
    cancelled();
    if (document.numPages > MAX_PDF_PAGES) throw new PdfReadError('too_many_pages');
    const pages: PdfPageText[] = [];
    onProgress?.(0, document.numPages);
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      cancelled();
      const items = content.items.filter(isText).map((item) => toItem(item, viewport)).filter((item): item is PdfTextItem => item !== null);
      pages.push({ page: number, items });
      page.cleanup();
      onProgress?.(number, document.numPages);
    }
    return pages;
  } catch (error) {
    if (signal?.aborted) throw new PdfCancelled();
    if (error instanceof PdfReadError || error instanceof PdfCancelled) throw error;
    console.warn('PDF could not be read', error);
    throw new PdfReadError(problemOf(error));
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy().catch(() => undefined);
  }
}
