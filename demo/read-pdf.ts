// Reads the text layer of a PDF letter. A scan has no text layer, so it returns little or nothing,
// and the caller asks the user to paste the text instead.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPdfText(data: Uint8Array): Promise<string> {
  const doc = await getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
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
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}
