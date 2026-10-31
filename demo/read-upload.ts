// Turns an uploaded letter (PDF, Word or text) into comments, or a clear explanation of what to do instead.
// The file type comes from the file's own bytes, not its name.

import { MAX_COMMENTS, parseLetterDetailed, type ParsedComment } from "./parse-letter.ts";
import { DocxError, readDocxText } from "./read-docx.ts";
import { MAX_PDF_PAGES, readPdf } from "./read-pdf.ts";

export interface UploadResult {
  text?: string;
  comments?: ParsedComment[];
  warnings?: string[];
  error?: string;
  /** Why it couldn't be read, so the page can offer the right next step. */
  reason?: "scan" | "unreadable" | "password" | "damaged" | "old_word" | "wrong_type";
}

const PASTE = "Or paste the comments below.";
const SCAN_HELP = `This PDF is a scan: a picture of the pages, with no text we can read. We don't run text recognition yet, and nothing was charged. To continue, ask the department for the original PDF, or make the scan searchable using "Recognize Text" in Adobe Acrobat or by opening it in Google Docs, then upload that. ${PASTE}`;
const UNREADABLE_HELP = `This PDF's text comes out as unreadable characters, usually because of how its fonts were saved. Ask the department for another copy, or make it searchable using "Recognize Text" in Adobe Acrobat, then upload that. ${PASTE}`;

function fromText(text: string, warnings: string[] = []): UploadResult {
  const { comments, truncated } = parseLetterDetailed(text);
  const notes = [...warnings];
  if (truncated.chars) notes.push("This letter is longer than we read at once, so comments near the end may be missing. Check them against your letter.");
  if (truncated.comments) notes.push(`We read the first ${MAX_COMMENTS} comments only. Run the rest as a separate letter.`);
  return { text, comments, warnings: notes };
}

async function fromPdf(data: Uint8Array): Promise<UploadResult> {
  let reading;
  try {
    reading = await readPdf(data);
  } catch (e) {
    if ((e as Error).name === "PasswordException") return { error: `This PDF is password-protected. Remove the password and upload it again. ${PASTE}`, reason: "password" };
    return { error: `We couldn't open this PDF. It may be damaged. ${PASTE}`, reason: "damaged" };
  }
  if (reading.kind === "scan") return { error: SCAN_HELP, reason: "scan" };
  if (reading.kind === "unreadable") return { error: UNREADABLE_HELP, reason: "unreadable" };
  if (reading.kind === "empty") return { error: `This PDF has no text in it. Check that it's the right file. ${PASTE}`, reason: "scan" };
  const warnings: string[] = [];
  if (reading.kind === "mixed") warnings.push(`Page${reading.no_text_pages.length === 1 ? "" : "s"} ${reading.no_text_pages.join(", ")} of this PDF ${reading.no_text_pages.length === 1 ? "is a scan" : "are scans"}, so we couldn't read ${reading.no_text_pages.length === 1 ? "it" : "them"}. Add any comments from ${reading.no_text_pages.length === 1 ? "that page" : "those pages"} yourself.`);
  if (reading.pages > reading.pages_read) warnings.push(`We read the first ${MAX_PDF_PAGES} of ${reading.pages} pages. Add any comments from the later pages yourself.`);
  return fromText(reading.text, warnings);
}

function fromDocx(data: Uint8Array): UploadResult {
  if (data.length >= 4 && Buffer.from(data.subarray(0, 4)).toString("hex") === "d0cf11e0") {
    return { error: `This is an older Word file or a password-protected one, which we can't read. In Word, remove any password and use Save As to save it as .docx or PDF. ${PASTE}`, reason: "old_word" };
  }
  try {
    const text = readDocxText(data);
    if (!text.trim()) return { error: `This Word file has no text in its body. ${PASTE}`, reason: "damaged" };
    return fromText(text);
  } catch (e) {
    if (!(e instanceof DocxError) && !/inflate|invalid|buffer|maxOutputLength|out of range/i.test((e as Error).message)) throw e;
    return { error: `We couldn't open this Word file. It may be damaged. Try saving it again as .docx or PDF. ${PASTE}`, reason: "damaged" };
  }
}

const base64 = (value: unknown) => new Uint8Array(Buffer.from(String(value), "base64"));

/** Reads whichever of pdf_base64, docx_base64 or text the request carries. */
export async function readUpload(b: Record<string, unknown>): Promise<UploadResult> {
  if (b.pdf_base64) {
    const data = base64(b.pdf_base64);
    if (!Buffer.from(data.subarray(0, 1024)).includes("%PDF-")) return { error: `This file isn't a PDF, even though it's named like one. ${PASTE}`, reason: "wrong_type" };
    return fromPdf(data);
  }
  if (b.docx_base64) return fromDocx(base64(b.docx_base64));
  return fromText(String(b.text ?? ""));
}
