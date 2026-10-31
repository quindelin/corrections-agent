// Reads the body text of a .docx letter with no new dependencies: a .docx is a zip of XML files.
// Word stores automatic numbering apart from the text, so numbers are written back in for the parser to find.
// Only the body is read. Headers, footers, comments and the file's author properties are left out, and deleted
// tracked changes are skipped. Files are untrusted, so sizes are capped and the XML is tokenized, never resolved
// (no DOCTYPE or external entities).

import { inflateRawSync } from "node:zlib";

const MAX_ENTRIES = 5000;
const MAX_PART_BYTES = 30_000_000;

export class DocxError extends Error {}

function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  // End of central directory: the last 22 bytes, plus a comment of up to 65535.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocxError("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new DocxError("too many parts");
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new DocxError("damaged zip directory");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (flags & 1) throw new DocxError("encrypted");
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new DocxError("damaged zip entry");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + compressed);
    if (method === 0) return body;
    if (method !== 8) throw new DocxError("unsupported compression");
    return inflateRawSync(body, { maxOutputLength: MAX_PART_BYTES });
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (whole, dec, hex, named) => {
    if (named) return ENTITIES[named.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const TOKEN = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<[?!][^>]*>|([^<]+)/g;
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1];

/** Which list ids are bullets. Everything else is treated as numbered, whatever its format. */
function bulletLists(numberingXml: string | null): Set<string> {
  const bullets = new Set<string>();
  if (!numberingXml) return bullets;
  const abstractBullet = new Map<string, boolean>();
  for (const m of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const firstLevel = m[2].match(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/)?.[0] ?? "";
    abstractBullet.set(m[1], /<w:numFmt\s+w:val="(?:bullet|none)"/.test(firstLevel));
  }
  for (const m of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId\s+w:val="(\d+)"/g)) {
    if (abstractBullet.get(m[2])) bullets.add(m[1]);
  }
  return bullets;
}

interface Paragraph {
  text: string;
  numId?: string;
  level: number;
}

/** Turns document.xml into plain text: paragraphs separated by blank lines, table rows on one line each. */
export function documentText(xml: string, bullets: Set<string> = new Set()): string {
  const out: string[] = [];
  const open: Paragraph[] = [];
  let tableDepth = 0;
  let row: string[] = [];
  let skip = 0; // inside deleted text or a duplicate fallback
  let inText = false;
  let ordinal = 0; // runs on across lists, so a letter with one list per section still numbers 1, 2, 3
  const subCounts = new Map<string, number>();

  const finish = (p: Paragraph) => {
    let text = p.text.replace(/[ \t]+/g, " ").trim();
    if (!text) return;
    if (p.numId && p.numId !== "0") {
      if (bullets.has(p.numId)) text = `- ${text}`;
      else if (p.level === 0) {
        text = `${++ordinal}. ${text}`;
        subCounts.clear();
      } else {
        const key = `${p.level}`;
        const n = (subCounts.get(key) ?? 0) + 1;
        subCounts.set(key, n);
        text = `(${n}) ${text}`;
      }
    }
    if (tableDepth > 0) row.push(text);
    else out.push(text);
  };

  for (const m of xml.matchAll(TOKEN)) {
    const [, closing, tag, attrs, selfClosing, chars] = m;
    if (chars !== undefined) {
      if (inText && !skip && open.length) open[open.length - 1].text += decode(chars);
      continue;
    }
    if (!tag) continue;
    if (tag === "w:del" || tag === "w:moveFrom" || tag === "mc:Fallback") {
      if (!selfClosing) skip += closing ? -1 : 1;
      continue;
    }
    if (skip) continue;
    if (closing) {
      if (tag === "w:t") inText = false;
      else if (tag === "w:p" && open.length) finish(open.pop()!);
      else if (tag === "w:tr" && tableDepth === 1) {
        if (row.length) out.push(row.join(" "));
        row = [];
      } else if (tag === "w:tbl") tableDepth = Math.max(0, tableDepth - 1);
      continue;
    }
    if (tag === "w:p") {
      if (!selfClosing) open.push({ text: "", level: 0 });
    } else if (tag === "w:t") inText = !selfClosing;
    else if (tag === "w:tbl") tableDepth++;
    else if (open.length) {
      const p = open[open.length - 1];
      if (tag === "w:tab") p.text += " ";
      else if (tag === "w:br" || tag === "w:cr") p.text += "\n";
      else if (tag === "w:numId") p.numId = attr(attrs, "w:val");
      else if (tag === "w:ilvl") p.level = Number(attr(attrs, "w:val") ?? 0);
    }
  }
  return out.join("\n\n");
}

/** Reads a .docx. Throws DocxError if the file can't be read as one. */
export function readDocxText(data: Uint8Array): string {
  const zip = Buffer.from(data);
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) throw new DocxError("not a zip file");
  const body = readZipEntry(zip, "word/document.xml");
  if (!body) throw new DocxError("no document body");
  const numbering = readZipEntry(zip, "word/numbering.xml");
  return documentText(body.toString("utf8"), bulletLists(numbering ? numbering.toString("utf8") : null));
}
