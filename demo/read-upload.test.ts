// Files here are built in the test, so nothing real is stored. The PDFs are minimal hand-written files that pdf.js
// parses for real, and the .docx files are real zips, so the reading code runs end to end.

import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { cleanTruth, compare } from "./intake-compare.ts";
import { disallowedForAll } from "./robots.ts";
import { DocxError, documentText, readDocxText } from "./read-docx.ts";
import { looksGarbled, readPdf } from "./read-pdf.ts";
import { readUpload } from "./read-upload.ts";

// ---------- building PDFs ----------

function pdf(pageStreams: { content: string; image?: boolean }[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object numbers
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  add("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream");
  const kids: number[] = [];
  for (const p of pageStreams) {
    const stream = add(`<< /Length ${p.content.length} >>\nstream\n${p.content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${stream} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> >>`));
  }
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

const textPage = (lines: string[]) => ({ content: `BT /F1 11 Tf 40 760 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET` });
const fullPageImage = { content: "q 600 0 0 800 0 0 cm /Im1 Do Q" };
// A scan cut into strips: no single image covers the page, but together they do.
const stripImages = { content: Array.from({ length: 8 }, (_, i) => `q 600 0 0 100 0 ${i * 100} cm /Im1 Do Q`).join(" ") };
const smallLogo = { content: "q 60 0 0 60 40 700 cm /Im1 Do Q" };
const outlines = { content: Array.from({ length: 250 }, (_, i) => `${i} 10 m ${i} 20 l S`).join(" ") };
const LETTER = ["1. Revise the site plan so the front setback is dimensioned on it.", "2. Provide the drainage report for the new hard surface area."];
const b64 = (d: Uint8Array) => Buffer.from(d).toString("base64");

test("text PDF reads as text, and the upload parses into comments", async () => {
  const data = pdf([textPage(LETTER)]);
  assert.equal((await readPdf(data)).kind, "text");
  const r = await readUpload({ pdf_base64: b64(data) });
  assert.equal(r.error, undefined);
  assert.equal(r.comments?.length, 2);
});

test("full-page image with no text is a scan", async () => {
  const data = pdf([fullPageImage, fullPageImage]);
  const reading = await readPdf(data);
  assert.equal(reading.kind, "scan");
  assert.deepEqual(reading.no_text_pages, [1, 2]);
  const r = await readUpload({ pdf_base64: b64(data) });
  assert.equal(r.reason, "scan");
  assert.match(r.error ?? "", /is a scan/);
  assert.match(r.error ?? "", /paste/i);
});

test("a scan cut into strips is still a scan", async () => {
  assert.equal((await readPdf(pdf([stripImages]))).kind, "scan");
});

test("a scan with a short stamp in its text layer is still a scan", async () => {
  const stamped = { content: `${fullPageImage.content} BT /F1 11 Tf 40 760 Td (RECEIVED) Tj ET` };
  assert.equal((await readPdf(pdf([stamped]))).kind, "scan");
});

test("a scan someone already ran OCR on counts as text", async () => {
  const ocr = { content: `${fullPageImage.content} ${textPage(LETTER).content}` };
  assert.equal((await readPdf(pdf([ocr]))).kind, "text");
});

test("text flattened into shapes is treated like a scan", async () => {
  assert.equal((await readPdf(pdf([outlines]))).kind, "scan");
});

test("mixed letter keeps the text and names the scanned pages", async () => {
  const data = pdf([textPage(LETTER), fullPageImage]);
  const r = await readUpload({ pdf_base64: b64(data) });
  assert.equal(r.comments?.length, 2);
  assert.match(r.warnings?.join(" ") ?? "", /Page 2 of this PDF is a scan/);
});

test("a blank or logo-only page doesn't make a text letter look mixed", async () => {
  assert.equal((await readPdf(pdf([textPage(LETTER), { content: "" }, smallLogo]))).kind, "text");
});

test("a blank PDF isn't called a scan", async () => {
  assert.equal((await readPdf(pdf([{ content: "" }]))).kind, "empty");
  assert.match((await readUpload({ pdf_base64: b64(pdf([{ content: "" }])) })).error ?? "", /no text/);
});

test("broken character maps count as unreadable", () => {
  assert.equal(looksGarbled("".repeat(30)), true);
  assert.equal(looksGarbled("Revise the site plan so the front setback is dimensioned."), false);
  assert.equal(looksGarbled("Révisez le plan du site, s'il vous plaît, et 配置図を修正してください。"), false);
});

test("a damaged or misnamed PDF gets an explanation, not a crash", async () => {
  assert.equal((await readUpload({ pdf_base64: b64(Buffer.from("<html>not a pdf</html>")) })).reason, "wrong_type");
  assert.equal((await readUpload({ pdf_base64: b64(Buffer.from("%PDF-1.4\ngarbage")) })).reason, "damaged");
});

// ---------- building .docx files ----------

function zip(parts: Record<string, string>, store = false): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text, "utf8");
    const body = store ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += head.length + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}

const para = (text: string, numId?: number, level = 0) =>
  `<w:p>${numId === undefined ? "" : `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const doc = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
const NUMBERING = `<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

test(".docx automatic numbering reaches the parser, including across lists", async () => {
  const data = zip({
    "word/document.xml": doc(para("Correction notice") + para("Zoning") + para("Revise the site plan.", 1) + para("Show the setback.", 1) + para("Structural") + para("Provide calculations for the beam.", 3)),
    "word/numbering.xml": NUMBERING,
  });
  const r = await readUpload({ docx_base64: b64(data) });
  assert.equal(r.error, undefined);
  assert.equal(r.comments?.length, 3);
  assert.match(r.comments?.[1].text ?? "", /^Show the setback\./);
});

test(".docx sub-levels and bullets stay inside their comment", () => {
  const text = readDocxText(zip({ "word/document.xml": doc(para("Revise the plan.", 1) + para("Add a note.", 1, 1) + para("A bullet.", 2) + para("Second.", 1)), "word/numbering.xml": NUMBERING }));
  assert.equal(text, "1. Revise the plan.\n\n(1) Add a note.\n\n- A bullet.\n\n2. Second.");
});

test(".docx table rows read as one line each, so a number column works", async () => {
  const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`;
  const rows = [["No.", "Comment"], ["1", "Revise the site plan."], ["2", "Provide the drainage report."]].map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("");
  const r = await readUpload({ docx_base64: b64(zip({ "word/document.xml": doc(`<w:tbl>${rows}</w:tbl>`) })) });
  assert.deepEqual(r.comments?.map((c) => c.text), ["Revise the site plan.", "Provide the drainage report."]);
});

test(".docx plain paragraphs split by the fallback", async () => {
  const r = await readUpload({ docx_base64: b64(zip({ "word/document.xml": doc(para("Show the tree protection fencing on the plan.") + para("Provide an arborist report for the tree.")) }, true)) });
  assert.equal(r.comments?.length, 2);
});

test(".docx deleted text and fallbacks are skipped, entities decoded", () => {
  const body = `<w:p><w:r><w:t>Keep &amp; revise &#8211; now</w:t></w:r><w:del><w:r><w:delText>gone</w:delText><w:t>also gone</w:t></w:r></w:del><mc:Fallback><w:t>dup</w:t></mc:Fallback></w:p>`;
  assert.equal(documentText(doc(body)), "Keep & revise – now");
});

test(".docx author properties and headers aren't read", async () => {
  const data = zip({
    "docProps/core.xml": "<cp:coreProperties><dc:creator>Sam Sample</dc:creator></cp:coreProperties>",
    "word/header1.xml": doc(para("Sam Sample, Plan Examiner")),
    "word/document.xml": doc(para("Show the tree protection fencing on the plan.")),
  });
  assert.ok(!JSON.stringify(await readUpload({ docx_base64: b64(data) })).includes("Sam"));
});

test(".docx personal details are stripped like any other letter", async () => {
  const r = await readUpload({ docx_base64: b64(zip({ "word/document.xml": doc(para("Reviewer: Sam Sample, sam@seattle.gov, 206-555-0142. Show the setback on the plan.")) })) });
  const all = JSON.stringify(r.comments);
  assert.ok(!/Sam|seattle\.gov|555-0142/.test(all), all);
});

test("a bad Word file gets an explanation, not a crash", async () => {
  assert.equal((await readUpload({ docx_base64: b64(Buffer.from("not a zip at all, sorry about that")) })).reason, "damaged");
  assert.equal((await readUpload({ docx_base64: b64(zip({ "other.xml": "<a/>" })) })).reason, "damaged");
  assert.equal((await readUpload({ docx_base64: b64(Buffer.from("d0cf11e0a1b11ae1", "hex")) })).reason, "old_word");
  assert.throws(() => readDocxText(new Uint8Array([1, 2, 3])), DocxError);
});

test("a zip bomb is refused", async () => {
  const data = zip({ "word/document.xml": "a".repeat(40_000_000) });
  assert.equal((await readUpload({ docx_base64: b64(data) })).reason, "damaged");
});

// ---------- the download gate ----------

test("robots.txt rules are read for the * group only", () => {
  assert.deepEqual(disallowedForAll("User-agent: *\nDisallow: /dpd/edms/\n"), ["/dpd/edms/"]);
  assert.deepEqual(disallowedForAll("User-agent: Bot\nDisallow: /a\n\nUser-agent: *\nDisallow: /b\nDisallow:\n"), ["/b"]);
  assert.deepEqual(disallowedForAll(""), []);
});

// ---------- the accuracy score ----------

test("scoring: a perfect split matches everything", () => {
  const c = compare(["Revise the site plan now.", "Provide the drainage report."], ["Provide the drainage report.", "revise the site plan now"]);
  assert.deepEqual(c, { truth: 2, parsed: 2, matched: 2, found: 2, spurious: 0 });
});

test("scoring: merged comments are found but not matched", () => {
  const c = compare(["Revise the site plan so that it shows the setback.", "Provide the drainage report for the hard surface."], ["Revise the site plan so that it shows the setback. Provide the drainage report for the hard surface."]);
  assert.equal(c.matched, 0);
  assert.equal(c.found, 2);
  assert.equal(c.spurious, 1);
});

test("scoring: one parsed comment can't match two identical ones", () => {
  assert.equal(compare(["See the note on sheet A1.", "See the note on sheet A1."], ["See the note on sheet A1."]).matched, 1);
});

test("scoring: extra comments count as spurious", () => {
  assert.equal(compare(["Provide the report."], ["Provide the report.", "An equal opportunity employer."]).spurious, 1);
});

test("scoring: the heading the dataset appends is removed from the truth", () => {
  assert.equal(cleanTruth({ comment: "Update the plat.Zoning - General (4)", commentsubject: "Zoning - General" }), "Update the plat.");
  assert.equal(cleanTruth({ comment: "Update the plat.Drainage (2)", reviewtype: "Drainage" }), "Update the plat.");
  assert.equal(cleanTruth({ comment: "Update the plat. SamSample (2)" }), "Update the plat.");
});
