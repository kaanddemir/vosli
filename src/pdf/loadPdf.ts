import type { PdfLibrary } from './readPdf';
import { PdfReadError } from './readPdf';

let library: Promise<PdfLibrary> | null = null;

/**
 * PDF.js is about a third of a megabyte plus a large worker, so it loads on the first PDF only.
 * The legacy build also runs on phones a few years old. The service worker caches both for offline use.
 */
export function loadPdfLibrary(): Promise<PdfLibrary> {
  library ??= (async () => {
    try {
      const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.min.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib as unknown as PdfLibrary;
    } catch (error) {
      library = null;
      console.error(error);
      throw new PdfReadError('reader_failed');
    }
  })();
  return library;
}
