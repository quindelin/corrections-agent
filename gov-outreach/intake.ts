// When records arrive: store them privately, strip personal details, check the result, and turn it into test letters in the
// same shape as realdata/seattle/letters.json. Nothing here publishes anything, and everything stays in the gitignored data folder.
// A scrubber can't be perfect, so a person resolves anything name-like before a letter counts as usable.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { die, flag, option } from "../scripts/lib.ts";
import { MASK_TOKEN } from "../realdata/citations.ts";
import { findRequest } from "./draft.ts";
import { appendJsonl, gitIn, GOV_DIR, type Home, now, readJsonl, sha, writeText } from "./lib.ts";
import { type IntakeRecord, latestIntake } from "./stats.ts";

// ---------- scrubbing ----------

const WORD = "\\p{Lu}[\\p{Ll}'’]+(?:-\\p{Lu}?[\\p{Ll}'’]+)?";
const NAME = `(?:\\p{Lu}\\.\\s*)?${WORD}(?:\\s+\\p{Lu}\\.?)?(?:\\s+${WORD}){0,2}`;
const LABELS = "Thanks|Reviewer|Plan Examiner|Plans Examiner|Examiner|Inspector|Applicant|Owner|Agent|Contact|Contact Person|Architect|Engineer|Designer|Contractor|Prepared by|Reviewed by|Submitted by|Signed by|Attn|Attention|From|To|Dear|Cc|Sincerely|Regards|Respectfully|Thank you";
const EMAIL = /[\w.+'-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(?:\+?1[-. ]?)?(?:\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b(?:\s*(?:x|ext\.?)\s*\d+)?/gi;
const URL = /\bhttps?:\/\/[^\s)>\]]+/gi;
const SUFFIX = "St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Cir|Circle";
const STREET = new RegExp(`\\b\\d{1,6}\\s+(?:[NSEW]\\.?\\s+|(?:North|South|East|West)\\s+)?(?:[A-Z0-9][\\w'’.-]*\\s+){1,4}(?:${SUFFIX})\\b\\.?(?:,?\\s*(?:Suite|Ste\\.?|Unit|Apt\\.?|#)\\s*[\\w-]+)?(?:,\\s*[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*,?\\s*[A-Z]{2}\\s*\\d{5}(?:-\\d{4})?)?`, "g");
const LABELED = new RegExp(`\\b(${LABELS})\\b(\\s*[:,-]?\\s*)(${NAME})`, "gu");
const TITLED = new RegExp(`\\b(Mr|Mrs|Ms|Mx|Dr|Prof)\\.?\\s+${NAME}`, "gu");
const CREDENTIALED = new RegExp(`(?<![\\p{L}])${NAME},?\\s+(?:P\\.?E\\.?|R\\.?A\\.?|AIA|S\\.?E\\.?|CBO|LEED AP)(?![\\p{L}])`, "gu");
/** A short labeled line holds a name or a company, not a comment. "Applicant: please revise the plan" is a comment, so it stays. */
const LABEL_LINE = /^(\s*(?:Applicant|Owner|Agent|Contact(?: Person)?|Contractor|Architect|Engineer|Designer|Reviewer|Plans? Examiner|Examiner|Inspector|Attn|Attention|Cc|Prepared by|Reviewed by|Submitted by|Signed by)(?:'s)?(?: name| email| phone)?\s*[:#-]\s*)(?!please\b|provide\b|revise\b|show\b|add\b|update\b|submit\b|see\b)([^\n]{1,60}?)\s*$/gimu;
const LICENSE = /\b(?:License|Lic\.?|Registration|Reg\.?)\s*(?:No\.?|Number|#)?\s*:?\s*[A-Z0-9-]*\d[A-Z0-9-]*/gi;
/** Everything after a sign-off is a signature block. Names, titles and numbers live there. */
const SIGNOFF = /^\s*(sincerely|regards|best regards|respectfully|thank you|thanks)[,.]?\s*$/im;

const VOCAB = new Set(readFileSync(join(GOV_DIR, "agent", "review-vocabulary.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")));
const isVocab = (w: string) => ALLOW.has(w.replace(/[.,]$/, "")) || VOCAB.has(w.replace(/[.,]$/, "").toLowerCase());

/** Words in capitalized pairs that are building review vocabulary, not people. */
const ALLOW = new Set("Plan Plans Review Reviews Comment Comments Correction Corrections Building Code Codes Fire Zoning Structural Electrical Mechanical Plumbing Energy Accessibility Site Sheet Sheets Section Table Chapter Page Permit Permits Application Department City County State Street Avenue Road North South East West Public Works Planning Development Services Division Office Land Use Project Engineer Engineering Architect Architecture Drawing Drawings Detail Details Floor Roof Wall Walls Door Doors Window Windows Stair Stairs Egress Exit Exits Occupancy Group Type Construction Fire Life Safety Sprinkler Alarm Note Notes General Provide Revise Show Please Submit Update Add Remove Confirm Clarify See Per The This That These Those All Each Any Item Items Cycle Round Status Date Required Approved Denied Resubmit Requires International Residential Commercial Existing Proposed New Stormwater Drainage Grading Geotechnical Soils Report Letter Notice Notification Open Completed Review. Standard Certified Dynamic Portal Federal Illinois California Washington Oregon Colorado Arizona Fictional Testville".split(" "));

const STOPWORDS = new Set("the this that these those them they you your our for and with his her him she one any all each who what when".split(" "));

export interface ScrubResult {
  text: string;
  removed: Record<string, number>;
}

export function scrub(raw: string): ScrubResult {
  const removed: Record<string, number> = {};
  const count = (k: string, n = 1) => (removed[k] = (removed[k] ?? 0) + n);
  const replace = (s: string, re: RegExp, token: string, kind: string) => s.replace(re, () => (count(kind), token));
  const sign = raw.match(SIGNOFF);
  let t = raw;
  if (sign && sign.index !== undefined && sign.index > raw.length * 0.3) {
    t = raw.slice(0, sign.index).trimEnd() + "\n[signature block removed]\n";
    count("signature_block");
  }
  t = replace(t, EMAIL, "[email]", "email");
  t = replace(t, URL, "[link]", "link");
  t = replace(t, PHONE, "[phone]", "phone");
  t = replace(t, STREET, "[address]", "address");
  t = replace(t, LICENSE, "[license number]", "license");
  t = t.replace(LABEL_LINE, (m, label: string, rest: string) => {
    if (/[.;:!?]$/.test(rest) && !/^\p{Lu}\.\s*\p{Lu}/u.test(rest)) return m;
    count("labeled_line");
    return `${label}[removed]`;
  });
  t = replace(t, TITLED, "[name]", "name");
  t = replace(t, CREDENTIALED, "[name]", "name");
  t = t.replace(LABELED, (_m, label: string, sep: string, name: string) => {
    if (name.split(/\s+/).every((w) => ALLOW.has(w.replace(/[.,]$/, "")))) return `${label}${sep}${name}`;
    count("name");
    return `${label}${sep}[name]`;
  });
  return { text: t, removed };
}

export interface CheckHit {
  kind: string;
  text: string;
}

/** Reads scrubbed text afresh, with different and looser patterns from the scrubber. A hit needs a person's decision. */
export function checkScrubbed(text: string): CheckHit[] {
  const hits: CheckHit[] = [];
  const add = (kind: string, re: RegExp) => { for (const m of text.matchAll(re)) hits.push({ kind, text: m[0] }); };
  add("email", /[\w.+'-]+@[\w-]+\.[\w.-]+|[\w.-]+\s?\[at\]\s?[\w.-]+/g);
  add("phone", /\(?\b\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g);
  add("address", new RegExp(`\\b\\d{1,6}\\s+\\S+(?:\\s+\\S+){0,3}\\s+(?:${SUFFIX})\\b`, "g"));
  add("titled_name", /\b(Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+\p{Lu}[\p{L}'’-]+/gu);
  for (const m of text.matchAll(/(?<![\p{L}])(called|spoke with|spoke to|emailed|contact|per|see|ask for|signed|initials?)\s+(\p{Lu}[\p{Ll}'’-]{2,}(?:\s+\p{Lu}[\p{Ll}'’-]{2,})?)(?![\p{L}])/gu)) if (!m[2].split(/\s+/).every(isVocab)) hits.push({ kind: "name_context", text: m[0] });
  // Names in lowercase and first names only, in places a person's name tends to go.
  for (const m of text.matchAll(/(?<![\p{L}])(?:spoke with|spoke to|emailed|sent to|met with|talked to|discussion with|discussed with|call|ask|thanks,?|thank you,?)\s+(\p{L}[\p{L}'’-]{2,})(?![\p{L}])/giu)) if (!isVocab(m[1]) && !STOPWORDS.has(m[1].toLowerCase())) hits.push({ kind: "name_context", text: m[0] });
  for (const m of text.matchAll(/(?<![\p{L}])(\p{L}[\p{Ll}'’-]{2,})\s+(?:emailed|called|phoned|signed|initialed)(?![\p{L}])/gu)) if (!isVocab(m[1]) && !STOPWORDS.has(m[1].toLowerCase())) hits.push({ kind: "name_context", text: m[0] });
  add("initials", /\b[A-Z]{2,3}\s+(?:reviewed|noted|approved|initialed|signed)\b/g);
  for (const m of text.matchAll(/(?<![\p{L}])(\p{Lu}[\p{Ll}'’-]+)\s+(?:residence|family|home|house|property|building|project)(?![\p{L}])/gu)) if (!isVocab(m[1])) hits.push({ kind: "possible_name", text: m[0] });
  // Two or three capitalized words that aren't review vocabulary might be a person.
  for (const m of text.matchAll(/(?<![\p{L}])(\p{Lu}[\p{Ll}'’-]+)(\s+\p{Lu}\.)?\s+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}])/gu)) {
    if (![m[1], m[3]].every(isVocab)) hits.push({ kind: "possible_name", text: m[0] });
  }
  // A signature alone on a line: "J. Smith" or "Jane Smith" with nothing else.
  for (const m of text.matchAll(/^\s*(?:\p{Lu}\.\s*\p{Lu}[\p{Ll}'’-]+|\p{Lu}[\p{Ll}'’-]+\s+\p{Lu}[\p{Ll}'’-]+)\s*$/gmu)) if (!m[0].trim().split(/\s+/).every(isVocab)) hits.push({ kind: "signature_line", text: m[0].trim() });
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(`${h.kind}:${h.text}`) && seen.add(`${h.kind}:${h.text}`));
}

// ---------- turning scrubbed text into letters ----------

const CITATION = /\b(?:IBC|IRC|IEBC|IECC|IMC|IPC|IFC|CBC|CRC|NEC|NFPA\s*\d+|OSSC|ORSC|WSEC|UDC|ADA|ANSI\s*A117\.1|SMC|SBC|SRC)\b[\s:,.-]*(?:Section|Sec\.?|§|Table|Chapter)?\s*[A-Z]?\d[\w.()-]*|\b(?:Section|Sec\.|§)\s*[A-Z]?\d+(?:[.-]\d+)+[\w.()-]*|\b\d{1,2}[A-Z]-\d+-\d+(?:\.\d+)*\b/g;
const SHEET = /\b(?:sheet\s+)?([ACEFGLMPS][A-Z]?-?\d{1,3}(?:\.\d{1,3})?)\b/g;

export function splitComments(raw: string): string[] {
  const text = raw.replace(/\[signature block removed\]/g, "");
  const numbered = text.split(/\n(?=\s*(?:\d{1,3}[.)]|Comment\s+\d+[:.)]|Item\s+\d+[:.)]|[-•]\s))/i).map((c) => c.trim());
  const items = numbered.filter((c) => /^(?:\d{1,3}[.)]|Comment\s+\d+[:.)]|Item\s+\d+[:.)]|[-•]\s)/i.test(c));
  const pick = items.length ? items : text.split(/\n\s*\n/).map((c) => c.trim());
  return pick
    .map((c) => c.replace(/^(?:\d{1,3}[.)]|Comment\s+\d+[:.)]|Item\s+\d+[:.)]|[-•])\s*/i, "").replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 25);
}

/** The shape of realdata/score.ts's RealLetter, with provenance added. The reviewer's citations are hidden from the text and kept as labels, as for Seattle. */
export function toLetter(rec: IntakeRecord, scrubbed: string, description: string) {
  const comments = splitComments(scrubbed).map((text, i) => ({
    id: `C${String(i + 1).padStart(2, "0")}`,
    text: text.replace(CITATION, (c) => MASK_TOKEN + (c.match(/[.,;:]+$/)?.[0] ?? "")),
    labels: { discipline: null, citations: [...new Set((text.match(CITATION) ?? []).map((c) => c.trim().replace(/[.,;:]+$/, "")))], route: null, sheets: [...new Set([...text.matchAll(SHEET)].map((m) => m[1]))] },
  }));
  return {
    id: `${rec.place}-${rec.id}`,
    holdout: parseInt(sha(rec.raw_sha).slice(0, 8), 16) % 4 === 0,
    review_type: rec.review_type,
    source: { letter: `private:${basename(rec.raw_file)}`, permit: rec.permit ?? "", document_date: rec.document_date ?? undefined },
    project: { jurisdiction: rec.place, address: "[address removed]", description, reviewer: "[reviewer removed]" },
    outcome: { review_cycles: null, days_out_for_corrections: null, days_city_review: null },
    comments,
    provenance: {
      agency_target: rec.target_id,
      request_id: rec.request_id,
      received_date: rec.received_date,
      document_date: rec.document_date,
      source_note: rec.source_note,
      conditions: rec.conditions,
      publish_decision: rec.publish_decision,
      raw_sha: rec.raw_sha,
      dataset: rec.dataset,
    },
  };
}

// ---------- commands ----------

const records = (h: Home) => latestIntake(readJsonl<IntakeRecord>(h.intake));
const save = (h: Home, r: IntakeRecord) => appendJsonl(h.intake, { ...r, updated_at: now().toISOString() });

/** Records can't land anywhere git would pick up. This repo is public. */
export function assertPrivate(h: Home, path: string): void {
  let ignored = false;
  try {
    gitIn(h.dir, "check-ignore", "-q", path);
    ignored = true;
  } catch {
    ignored = false;
  }
  if (!ignored) die(`Refusing to write ${path}: git isn't ignoring it, and records must not reach a repo. This repo is public.`);
}

async function readRaw(path: string): Promise<string> {
  if (extname(path).toLowerCase() !== ".pdf") return readFileSync(path, "utf8");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => ("str" in x ? `${x.str}${x.hasEOL ? "\n" : " "}` : "")).join(""));
  }
  return pages.join("\n");
}

function csvComments(text: string, column: string): string {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { rows[rows.length - 1].push(cell); cell = ""; }
    else if (c === "\n") { rows[rows.length - 1].push(cell.replace(/\r$/, "")); cell = ""; rows.push([]); }
    else cell += c;
  }
  rows[rows.length - 1].push(cell);
  const idx = rows[0].findIndex((h) => h.trim().toLowerCase() === column.toLowerCase());
  if (idx < 0) die(`No column "${column}" in the CSV. Columns: ${rows[0].join(", ")}`);
  return rows.slice(1).map((r) => r[idx] ?? "").filter((x) => x.trim()).map((x, i) => `${i + 1}. ${x.trim()}`).join("\n");
}

export async function intake(h: Home): Promise<void> {
  const sub = process.argv[3];
  if (sub === "add") return intakeAdd(h);
  if (sub === "check") return intakeCheck(h);
  if (sub === "status") return intakeStatus(h);
  if (sub === "resolve") return intakeResolve(h);
  if (sub === "build") return intakeBuild(h);
  die("Usage: intake add|check|resolve|build|status");
}

async function intakeAdd(h: Home): Promise<void> {
  const req = findRequest(h, option("id"));
  const file = option("file");
  const received = option("received");
  const conditions = option("conditions");
  if (!file || !existsSync(file)) die("Give --file, the record as received. It's copied into the gitignored data folder.");
  if (!received) die("Give --received YYYY-MM-DD.");
  if (conditions === undefined) die(`Give --conditions, any conditions the agency put on use, in its words, or --conditions "none stated". Unknown isn't the same as allowed.`);
  const mayTest = option("may-test") ?? "unknown";
  if (!["yes", "no", "unknown"].includes(mayTest)) die("--may-test must be yes, no or unknown.");
  const bytes = readFileSync(file);
  const raw_sha = sha(bytes.toString("latin1"));
  if (records(h).some((r) => r.raw_sha === raw_sha)) die("This file is already registered. A duplicate would inflate the usable count.");
  const id = `L-${raw_sha.slice(0, 6)}`;
  const dest = join(h.received, `${id}${extname(file)}`);
  assertPrivate(h, dest);
  writeText(dest, "");
  copyFileSync(file, dest);
  const rec: IntakeRecord = {
    id, dataset: h.dataset, request_id: req.id, target_id: req.target_id, place: req.place, state: req.state,
    status: "registered", usable: false, comments: 0, raw_file: dest, raw_sha, received_date: received,
    document_date: option("doc-date") ?? null, source_note: option("source-note") ?? `Received from ${req.target_id} in response to ${req.id}.`,
    review_type: option("review-type") ?? "unknown",
    conditions: { text: conditions, may_test: mayTest as "yes" | "no" | "unknown", may_send_to_model: (option("may-send-to-model") ?? "unknown") as "yes" | "no" | "unknown", may_publish: (option("may-publish") ?? "unknown") as "yes" | "no" | "unknown" },
    publish_decision: "undecided", hits: [], out_file: null, permit: option("permit") ?? null, updated_at: "",
  };
  const rawText = await readRaw(dest);
  const sourceText = option("comment-column") ? csvComments(rawText, option("comment-column")!) : rawText;
  if (sourceText.replace(/\s+/g, "").length < 40) {
    save(h, { ...rec, status: "refused", hits: [{ kind: "no_text", text: "Little or no text. A scanned PDF needs OCR first.", resolved: false }] });
    die(`${id} has little or no readable text, so it's registered but not usable. A scanned PDF needs OCR first.`);
  }
  const { text, removed } = scrub(sourceText);
  const scrubbedPath = join(h.scrubbed, `${id}.txt`);
  assertPrivate(h, scrubbedPath);
  writeText(scrubbedPath, text);
  const hits = checkScrubbed(text).map((c) => ({ ...c, resolved: false }));
  save(h, { ...rec, status: hits.length ? "needs_review" : "passed", hits });
  console.log(`✓ ${id} registered. Stripped: ${JSON.stringify(removed)}.\nScrubbed copy: ${scrubbedPath}\n${hits.length ? `${hits.length} things need your decision before it can count:\n${hits.map((x) => `  ${x.kind}: "${x.text}"`).join("\n")}\nRead the scrubbed copy, then: intake resolve --letter ${id} --strip "exact text" or --keep "exact text"` : "The check found nothing. Read it anyway: the patterns can miss a lone surname or a name in lowercase."}`);
}

function findLetter(h: Home): IntakeRecord {
  const r = records(h).find((x) => x.id === option("letter"));
  if (!r) die(`No intake record ${option("letter") ?? "(give --letter)"}.`);
  return r;
}

function intakeCheck(h: Home): void {
  const r = findLetter(h);
  const text = readFileSync(join(h.scrubbed, `${r.id}.txt`), "utf8");
  const open = r.hits.filter((x) => !x.resolved);
  const fresh = checkScrubbed(text).filter((c) => !r.hits.some((x) => x.kind === c.kind && x.text === c.text));
  console.log(`${r.id}: status ${r.status}. Open hits: ${open.length}. New hits: ${fresh.length}.`);
  for (const x of [...open, ...fresh]) console.log(`  ${x.kind}: "${x.text}"`);
}

function intakeResolve(h: Home): void {
  const r = findLetter(h);
  const strip = option("strip");
  const keep = option("keep");
  const path = join(h.scrubbed, `${r.id}.txt`);
  let text = readFileSync(path, "utf8");
  if (flag("read-all-keep-rest")) {
    // The check is noisy on ordinary phrases, so a person who has read the whole copy can clear what's left in one go.
    const hits = r.hits.map((x) => ({ ...x, resolved: true }));
    save(h, { ...r, hits, status: "passed" });
    return void console.log(`✓ ${r.id}: you read it and kept ${r.hits.filter((x) => !x.resolved).length} remaining phrases.`);
  }
  if (strip) {
    if (!text.includes(strip)) die(`"${strip}" isn't in the scrubbed copy.`);
    text = text.split(strip).join("[removed]");
    writeFileSync(path, text);
  } else if (!keep) die('Give --strip "text" or --keep "text", or --read-all-keep-rest once you have read the whole scrubbed copy.');
  const fresh = checkScrubbed(text);
  const prior = new Map(r.hits.map((x) => [`${x.kind}:${x.text}`, x.resolved]));
  const hits = fresh.map((c) => ({ ...c, resolved: (prior.get(`${c.kind}:${c.text}`) ?? false) || c.text === keep }));
  const open = hits.filter((x) => !x.resolved);
  save(h, { ...r, hits, status: open.length ? "needs_review" : "passed" });
  console.log(`✓ ${r.id}: ${open.length} open hits remain.`);
}

/** Builds letters from everything that passed. Only this step can mark a record usable, so the metric can't be typed in. */
function intakeBuild(h: Home): void {
  const byPlace = new Map<string, ReturnType<typeof toLetter>[]>();
  for (const r of records(h)) {
    if (r.status === "refused") continue;
    const open = r.hits.filter((x) => !x.resolved);
    if (open.length) {
      console.log(`- ${r.id}: not built. ${open.length} hits are still open.`);
      continue;
    }
    if (r.conditions.may_test === "no") {
      console.log(`- ${r.id}: not built. The conditions on use say no testing: ${r.conditions.text}`);
      save(h, { ...r, usable: false, comments: 0 });
      continue;
    }
    const letter = toLetter(r, readFileSync(join(h.scrubbed, `${r.id}.txt`), "utf8"), option("description") ?? "");
    if (!letter.comments.length) {
      console.log(`- ${r.id}: not usable. No comments of at least 25 characters were found in it.`);
      save(h, { ...r, status: r.status, usable: false, comments: 0 });
      continue;
    }
    const list = byPlace.get(r.place) ?? [];
    list.push(letter);
    byPlace.set(r.place, list);
    const out = join(h.letters, `${r.place}.json`);
    save(h, { ...r, status: "passed", usable: true, comments: letter.comments.length, out_file: out });
    console.log(`✓ ${r.id}: usable, ${letter.comments.length} comments.${r.conditions.may_test === "unknown" ? " Conditions on testing are unknown: decide before running it." : ""}`);
  }
  for (const [place, letters] of byPlace) {
    const out = join(h.letters, `${place}.json`);
    assertPrivate(h, out);
    writeText(out, JSON.stringify({ note: `Real records obtained by request from ${place}${h.dataset === "test" ? " (FICTIONAL TEST DATA)" : ""}. Personal details stripped. Private: not published, and publishing needs the owner's decision.`, letters }, null, 1) + "\n");
    console.log(`Wrote ${out}. It isn't published, and nothing here can publish it.`);
  }
  if (flag("publish")) die("There is no publish step. Publishing records needs your decision, and it isn't built.");
}

function intakeStatus(h: Home): void {
  const rows = records(h);
  if (!rows.length) return void console.log("No records received yet.");
  for (const r of rows) console.log(`${r.id}  ${r.target_id}  ${r.status}  usable=${r.usable}  comments=${r.comments}  received ${r.received_date}  doc ${r.document_date ?? "unknown"}\n  Conditions: ${r.conditions.text} (test ${r.conditions.may_test}, model ${r.conditions.may_send_to_model}, publish ${r.conditions.may_publish}). Publishing: ${r.publish_decision}.`);
}
