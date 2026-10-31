// Reads the text layer of a PDF letter, and says whether each page actually had one.
// A scan is a picture of a page, so looking at the amount of text alone can't tell a scan from a blank page or a cover
// sheet. This also checks how much of a low-text page is covered by images or drawn shapes.
// Files are untrusted: pdf.js runs with eval off, and only text and drawing operators are read.

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_PAGES = 40;
const MIN_PAGE_CHARS = 40; // fewer than this is a stamp or page number, not a page of text
const MIN_IMAGE_COVERAGE = 0.5;
const MIN_OUTLINE_PATHS = 200; // text flattened into shapes, as some CAD exports do

export type PageKind = "text" | "no_text" | "blank";
export type PdfKind = "text" | "scan" | "mixed" | "unreadable" | "empty";

export interface PdfReading {
  text: string;
  kind: PdfKind;
  pages: number; // pages in the file
  pages_read: number;
  no_text_pages: number[]; // 1-based pages that have content we can't read
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);

/** How much of the page images cover (0 to 1), and how many shapes it draws. Strip-based scans add up across images. */
export function measureOperators(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, pageArea: number) {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let imageArea = 0;
  let paths = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && args) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0])) ctm = multiply(ctm, args[0] as unknown as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (IMAGE_OPS.has(fn)) imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]); // an image fills the unit square
    else if (fn === OPS.constructPath) paths++;
  }
  return { coverage: pageArea > 0 ? Math.min(1, imageArea / pageArea) : 0, paths };
}

/** Fonts with no character map come out as control or private-use characters: a text layer that isn't real text. */
export function looksGarbled(text: string): boolean {
  const chars = text.replace(/\s/g, "");
  if (chars.length < MIN_PAGE_CHARS) return false;
  const readable = chars.match(/[\p{L}\p{N}\p{P}\p{S}]/gu)?.length ?? 0;
  const broken = chars.match(/[\p{Cc}\p{Co}\p{Cn}�]/gu)?.length ?? 0;
  return broken / chars.length > 0.1 || readable / chars.length < 0.7;
}

export async function readPdf(data: Uint8Array): Promise<PdfReading> {
  // pdf.js takes over the buffer it's given and empties it, so it gets a copy.
  const doc = await getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    const kinds: PageKind[] = [];
    const pagesRead = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= pagesRead; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.trim());
          line = "";
        }
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = "";
        }
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      const pageText = lines.join("\n");
      pages.push(pageText);
      if (pageText.replace(/\s/g, "").length >= MIN_PAGE_CHARS) {
        kinds.push("text");
      } else {
        // Only low-text pages pay for reading the drawing operators.
        const { fnArray, argsArray } = await page.getOperatorList();
        const { width, height } = page.getViewport({ scale: 1 });
        const { coverage, paths } = measureOperators(fnArray, argsArray, width * height);
        kinds.push(coverage >= MIN_IMAGE_COVERAGE || paths >= MIN_OUTLINE_PATHS ? "no_text" : "blank");
      }
      page.cleanup();
    }
    const text = pages.join("\n\n");
    const noText = kinds.flatMap((k, i) => (k === "no_text" ? [i + 1] : []));
    const hasText = kinds.includes("text");
    const kind: PdfKind = hasText && looksGarbled(text) ? "unreadable" : hasText && noText.length ? "mixed" : hasText ? "text" : noText.length ? "scan" : "empty";
    return { text, kind, pages: doc.numPages, pages_read: pagesRead, no_text_pages: noText };
  } finally {
    await doc.destroy();
  }
}

export async function readPdfText(data: Uint8Array): Promise<string> {
  return (await readPdf(data)).text;
}
