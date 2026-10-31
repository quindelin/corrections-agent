// npx tsx demo/measure-intake.ts [--comments path] [--work dir] [--no-download] [--sample-only] [--details] [--seed s] [--size n]
//
// Measures intake against Seattle's Plan Comments dataset, which records each letter's PDF link and its true comments.
// 1. Takes a seeded random sample of letters, stratified by review type. Same data and seed, same sample.
// 2. Downloads the files one at a time, at least 1 second apart, into .cache/intake-sample/files (not committed).
//    Stops for good at the first sign of a block. It doesn't retry or disguise itself.
// 3. Runs the file through intake and compares the parsed comments with the dataset, using both the parser at
//    BASELINE_COMMIT ("before") and the current one ("after").
// 4. Writes per-letter numbers, with no letter text, to .cache/intake-sample/results.json, and prints markdown tables.
//
// 40% of each review type is held out. --details prints individual letters for the tuning part only, so rules are
// never written against the held-out letters.
// Downloaded files are untrusted: they are only ever parsed as data, and no code lives in the download folder.
//
// The site's robots.txt is checked first. It currently disallows /dpd/edms/, the path every letter is on, so this script
// won't download unless given --robots-approved, which is for the project owner to decide, not for an agent to assume.
// --sample-only prints the sample without any network request.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanTruth, compare, type Compared } from "./intake-compare.ts";
import { disallowedForAll } from "./robots.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_COMMIT = "8657ca3";
const GAP_MS = 1200;
const MAX_FILE_BYTES = 60_000_000;
const HOLDOUT_SHARE = 0.4;
const UPLOAD_LIMIT_BYTES = 10_000_000; // what demo/start.html accepts

const flag = (name: string) => process.argv.includes(name);
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const WORK = option("--work", join(ROOT, ".cache", "intake-sample"));
const FILES = join(WORK, "files");
const COMMENTS = option("--comments", join(ROOT, ".cache", "seattle", "comments.json"));
const SEED = option("--seed", "redline-intake-1");
const SIZE = Number(option("--size", "100"));

interface Row {
  url?: { url: string };
  comment?: string;
  commentsubject?: string;
  reviewtype?: string;
  documenttitle?: string;
}

interface Letter {
  doc_id: string;
  url: string;
  review_type: string;
  title_kind: "correction_letter" | "other_document";
  split: "tune" | "holdout";
  truth: string[];
}

// ---------- sampling ----------

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** The dataset's reviewtype, with rows the city's own extraction broke (such as "Author: x") grouped as unknown. */
function reviewType(rows: Row[]): string {
  const t = rows[0].reviewtype?.trim();
  return !t || /^(Author|Page Index):/i.test(t) ? "(none)" : t;
}

function buildSample(rows: Row[], skipUrls: Set<string>): Letter[] {
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) {
    const url = r.url?.url;
    if (url && !skipUrls.has(url)) byUrl.set(url, [...(byUrl.get(url) ?? []), r]);
  }
  const strata = new Map<string, string[]>();
  for (const [url, list] of byUrl) strata.set(reviewType(list), [...(strata.get(reviewType(list)) ?? []), url]);

  // Proportional to each review type's share, with at least 2 letters from any type that has 5 or more.
  const total = byUrl.size;
  const quota = new Map<string, number>();
  for (const [type, urls] of strata) quota.set(type, urls.length >= 5 ? Math.max(2, Math.floor((urls.length / total) * SIZE)) : 0);
  const ranked = [...strata.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  let spare = SIZE - [...quota.values()].reduce((a, b) => a + b, 0);
  for (let i = 0; spare > 0; i = (i + 1) % ranked.length, spare--) quota.set(ranked[i][0], (quota.get(ranked[i][0]) ?? 0) + 1);

  const sample: Letter[] = [];
  for (const [type, urls] of ranked) {
    const shuffled = [...urls].sort((a, b) => hash(`${SEED}|${a}`).localeCompare(hash(`${SEED}|${b}`)));
    const taken = shuffled.slice(0, quota.get(type) ?? 0);
    const held = Math.round(taken.length * HOLDOUT_SHARE);
    taken.forEach((url, i) => {
      const list = byUrl.get(url)!;
      sample.push({
        doc_id: new URL(url).searchParams.get("id") ?? hash(url).slice(0, 12),
        url,
        review_type: type,
        title_kind: /correction letter/i.test(list[0].documenttitle ?? "") ? "correction_letter" : "other_document",
        split: i < held ? "holdout" : "tune",
        truth: list.map(cleanTruth).filter(Boolean),
      });
    });
  }
  return sample;
}

// ---------- downloading ----------

interface Fetched {
  status: "ok" | "failed" | "too_large" | "not_pdf";
  detail?: string;
  bytes?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileFor = (l: Letter) => join(FILES, `${l.doc_id.replace(/\D/g, "") || hash(l.url).slice(0, 12)}.bin`);

class Blocked extends Error {}

async function download(letter: Letter): Promise<Fetched> {
  const url = new URL(letter.url);
  if (url.protocol !== "https:" || url.hostname !== "web.seattle.gov") return { status: "failed", detail: "unexpected host" };
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { "user-agent": "redline-intake-measurement (one file at a time)" } });
  } catch (e) {
    return { status: "failed", detail: `network: ${(e as Error).name}` };
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) throw new Blocked(`HTTP ${res.status} for document ${letter.doc_id}`);
  if (new URL(res.url).hostname.split(".").slice(-2).join(".") !== "seattle.gov") throw new Blocked(`redirected away from seattle.gov for document ${letter.doc_id}`);
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return { status: "failed", detail: `HTTP ${res.status}` };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) return { status: "too_large", detail: `over ${MAX_FILE_BYTES / 1e6} MB`, bytes: size };
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const head = data.subarray(0, 1024).toString("latin1");
  if (!head.includes("%PDF-") && !head.startsWith("PK")) {
    if (/captcha|access denied|cloudflare|challenge|blocked/i.test(data.subarray(0, 4000).toString("latin1"))) throw new Blocked(`bot-check page for document ${letter.doc_id}`);
    return { status: "not_pdf", detail: (res.headers.get("content-type") ?? "unknown").slice(0, 40), bytes: size };
  }
  writeFileSync(fileFor(letter), data);
  return { status: "ok", bytes: size };
}

async function checkRobots(sample: Letter[]) {
  const res = await fetch("https://web.seattle.gov/robots.txt", { signal: AbortSignal.timeout(30_000) });
  if (res.status === 401 || res.status === 403 || res.status === 429) throw new Blocked(`HTTP ${res.status} for robots.txt`);
  const rules = res.ok ? disallowedForAll(await res.text()) : [];
  const path = sample.length ? new URL(sample[0].url).pathname : "/";
  const rule = rules.find((r) => path.startsWith(r));
  if (rule && !flag("--robots-approved")) throw new Blocked(`robots.txt disallows ${rule}, which covers ${path}. Needs the project owner's decision: see docs/intake-accuracy.md`);
}

async function downloadAll(sample: Letter[], log: Record<string, Fetched>, save: () => void) {
  await checkRobots(sample);
  mkdirSync(FILES, { recursive: true });
  let badRun = 0;
  for (const letter of sample) {
    if (log[letter.doc_id]?.status === "ok" && existsSync(fileFor(letter))) continue;
    if (log[letter.doc_id] && log[letter.doc_id].status !== "failed") continue;
    const result = await download(letter);
    log[letter.doc_id] = result;
    save();
    console.error(`${letter.doc_id} ${result.status} ${result.detail ?? ""} ${result.bytes ?? ""}`);
    badRun = result.status === "ok" || result.status === "too_large" ? 0 : badRun + 1;
    if (badRun >= 3) throw new Blocked(`${badRun} failures in a row, last: ${result.detail}`);
    await sleep(GAP_MS);
  }
}

// ---------- comparing ----------

type Cause =
  | "pass"
  | "download_failed"
  | "not_a_pdf"
  | "too_large_to_fetch"
  | "over_upload_limit"
  | "read_error"
  | "scan"
  | "no_comments_parsed"
  | "too_few_comments"
  | "too_many_comments"
  | "right_count_wrong_text";

function causeOf(c: Compared): Cause {
  if (c.parsed === 0) return "no_comments_parsed";
  if (c.parsed < c.truth) return "too_few_comments";
  if (c.parsed > c.truth) return "too_many_comments";
  return c.matched === c.truth ? "pass" : "right_count_wrong_text";
}

// ---------- the two pipelines ----------

interface Pipeline {
  parse: (raw: string) => { text: string }[];
  read: (data: Uint8Array) => Promise<{ text: string; kind?: string }>;
}

async function baselinePipeline(): Promise<Pipeline> {
  // The "before" parser, restored from git, so the before numbers can always be re-run. It stays out of the download folder.
  const dir = join(ROOT, ".cache", "intake-baseline");
  mkdirSync(dir, { recursive: true });
  for (const name of ["parse-letter.ts", "read-pdf.ts"]) {
    writeFileSync(join(dir, name), execFileSync("git", ["show", `${BASELINE_COMMIT}:demo/${name}`], { cwd: ROOT }));
  }
  const { parseLetter } = (await import(pathToFileURL(join(dir, "parse-letter.ts")).href)) as { parseLetter: Pipeline["parse"] };
  const { readPdfText } = (await import(pathToFileURL(join(dir, "read-pdf.ts")).href)) as { readPdfText: (data: Uint8Array) => Promise<string> };
  return { parse: parseLetter, read: async (data) => ({ text: await readPdfText(data) }) };
}

async function currentPipeline(): Promise<Pipeline> {
  const { parseLetter } = await import("./parse-letter.ts");
  const { readPdf } = await import("./read-pdf.ts");
  return { parse: parseLetter, read: readPdf };
}

interface LetterResult extends Compared {
  doc_id: string;
  review_type: string;
  title_kind: Letter["title_kind"];
  split: Letter["split"];
  bytes: number | null;
  chars: number;
  pdf_kind: string | null; // the reader's own verdict, where the pipeline gives one
  cause: Cause;
}

const isScanned = (kind: string | null, text: string) => (kind ? kind === "scan" || kind === "unreadable" || kind === "empty" : text.replace(/\s/g, "").length < 40);

async function evaluate(sample: Letter[], log: Record<string, Fetched>, p: Pipeline): Promise<{ results: LetterResult[]; texts: Map<string, { text: string; parsed: string[] }> }> {
  const results: LetterResult[] = [];
  const texts = new Map<string, { text: string; parsed: string[] }>();
  for (const l of sample) {
    // A file placed in the folder by hand counts, whether or not this script fetched it.
    const f: Fetched | undefined = log[l.doc_id] ?? (existsSync(fileFor(l)) ? { status: "ok" } : undefined);
    const base = { doc_id: l.doc_id, review_type: l.review_type, title_kind: l.title_kind, split: l.split, bytes: f?.bytes ?? null, chars: 0, pdf_kind: null as string | null };
    const none: Compared = { truth: l.truth.length, parsed: 0, matched: 0, found: 0, spurious: 0 };
    if (!f || f.status === "failed") {
      results.push({ ...base, ...none, cause: "download_failed" });
      continue;
    }
    if (f.status === "too_large") {
      results.push({ ...base, ...none, cause: "too_large_to_fetch" });
      continue;
    }
    if (f.status === "not_pdf") {
      results.push({ ...base, ...none, cause: "not_a_pdf" });
      continue;
    }
    const data = new Uint8Array(readFileSync(fileFor(l)));
    if (data[0] === 0x50 && data[1] === 0x4b) {
      results.push({ ...base, ...none, cause: "not_a_pdf" });
      continue;
    }
    let text: string;
    try {
      const reading = await p.read(data);
      text = reading.text;
      base.pdf_kind = reading.kind ?? null;
    } catch {
      results.push({ ...base, ...none, cause: "read_error" });
      continue;
    }
    base.chars = text.length;
    if (isScanned(base.pdf_kind, text)) {
      results.push({ ...base, ...none, cause: "scan" });
      continue;
    }
    const parsed = p.parse(text).map((c) => c.text);
    texts.set(l.doc_id, { text, parsed });
    const c = compare(l.truth, parsed);
    let cause = causeOf(c);
    if (cause === "pass" && data.length > UPLOAD_LIMIT_BYTES) cause = "over_upload_limit";
    results.push({ ...base, ...c, cause });
  }
  return { results, texts };
}

// ---------- reporting ----------

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

/** Wilson 95% interval, because a percentage from 60 letters is not as firm as it looks. */
function wilson(n: number, d: number): string {
  if (!d) return "n/a";
  const z = 1.96;
  const phat = n / d;
  const denom = 1 + (z * z) / d;
  const mid = (phat + (z * z) / (2 * d)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / d + (z * z) / (4 * d * d))) / denom;
  return `${(100 * Math.max(0, mid - half)).toFixed(0)}-${(100 * Math.min(1, mid + half)).toFixed(0)}%`;
}

function summary(r: LetterResult[]) {
  const sum = (key: keyof Compared) => r.reduce((a, x) => a + x[key], 0);
  const exact = r.filter((x) => x.parsed === x.truth).length;
  const clean = r.filter((x) => x.cause === "pass").length;
  return {
    letters: r.length,
    exact_count: exact,
    exact_count_pct: pct(exact, r.length),
    exact_count_ci: wilson(exact, r.length),
    all_comments_matched: clean,
    all_comments_matched_pct: pct(clean, r.length),
    truth_comments: sum("truth"),
    matched: sum("matched"),
    matched_pct: pct(sum("matched"), sum("truth")),
    found_in_text: sum("found"),
    found_pct: pct(sum("found"), sum("truth")),
    parsed_comments: sum("parsed"),
    spurious: sum("spurious"),
    spurious_pct: pct(sum("spurious"), sum("parsed")),
  };
}

const causes = (r: LetterResult[]) => {
  const out: Record<string, number> = {};
  for (const x of r) out[x.cause] = (out[x.cause] ?? 0) + 1;
  return out;
};

function table(rows: Record<string, ReturnType<typeof summary>>): string {
  const lines = [
    "| Group | Letters | Exact count | 95% CI | All comments matched | Comments matched | Words found | Spurious parsed |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const [name, s] of Object.entries(rows)) {
    lines.push(`| ${name} | ${s.letters} | ${s.exact_count} (${s.exact_count_pct}) | ${s.exact_count_ci} | ${s.all_comments_matched} (${s.all_comments_matched_pct}) | ${s.matched}/${s.truth_comments} (${s.matched_pct}) | ${s.found_in_text}/${s.truth_comments} (${s.found_pct}) | ${s.spurious}/${s.parsed_comments} (${s.spurious_pct}) |`);
  }
  return lines.join("\n");
}

// ---------- main ----------

const rows = JSON.parse(readFileSync(COMMENTS, "utf8")) as Row[];
// The 40 letters in the frozen eval are left out, so the sample is independent of letters earlier work looked at.
const evalLetters = JSON.parse(readFileSync(join(ROOT, "realdata", "seattle", "letters.json"), "utf8")).letters as { source: { letter: string } }[];
const sample = buildSample(rows, new Set(evalLetters.map((l) => l.source.letter)));
mkdirSync(WORK, { recursive: true });
const logPath = join(WORK, "downloads.json");
const log: Record<string, Fetched> = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : {};
const saveLog = () => writeFileSync(logPath, JSON.stringify(log, null, 1));

if (flag("--sample-only")) {
  const count = (key: (l: Letter) => string) => {
    const out: Record<string, number> = {};
    for (const l of sample) out[key(l)] = (out[key(l)] ?? 0) + 1;
    return out;
  };
  console.log(JSON.stringify({ seed: SEED, letters: sample.length, comments: sample.reduce((a, l) => a + l.truth.length, 0), split: count((l) => l.split), review_type: count((l) => l.review_type), title: count((l) => l.title_kind), doc_ids: sample.map((l) => l.doc_id).join(" ") }, null, 1));
  process.exit(0);
}

let blocked: string | null = null;
if (!flag("--no-download")) {
  try {
    await downloadAll(sample, log, saveLog);
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    blocked = e.message;
    console.error(`STOPPED DOWNLOADING: ${blocked}`);
  }
}

const before = await evaluate(sample, log, await baselinePipeline());
const after = await evaluate(sample, log, await currentPipeline());

if (flag("--details")) {
  // Tuning letters only. Held-out letters are never printed one by one. Holds letter text, so it goes to a gitignored folder.
  const lines: string[] = [];
  for (const r of after.results.filter((x) => x.split === "tune")) {
    const l = sample.find((s) => s.doc_id === r.doc_id)!;
    lines.push(`\n===== ${r.doc_id} ${r.review_type} ${r.title_kind} cause=${r.cause} truth=${r.truth} parsed=${r.parsed} matched=${r.matched} chars=${r.chars} bytes=${r.bytes}`);
    if (r.cause !== "pass") {
      l.truth.forEach((t, i) => lines.push(`  T${i + 1}: ${t.slice(0, 160)}`));
      after.texts.get(r.doc_id)?.parsed.forEach((t, i) => lines.push(`  P${i + 1}: ${t.slice(0, 160)}`));
    }
  }
  writeFileSync(join(WORK, "details-tune.txt"), lines.join("\n"));
  for (const r of after.results.filter((x) => x.split === "tune")) writeFileSync(join(WORK, `text-tune-${r.doc_id}.txt`), after.texts.get(r.doc_id)?.text ?? "");
}

const groups = (r: LetterResult[]) => ({
  All: summary(r),
  Tuning: summary(r.filter((x) => x.split === "tune")),
  "Held out": summary(r.filter((x) => x.split === "holdout")),
});
const report = {
  seed: SEED,
  sample_size: sample.length,
  blocked,
  downloads: {
    attempted: Object.keys(log).filter((id) => sample.some((s) => s.doc_id === id)).length,
    ok: sample.filter((s) => existsSync(fileFor(s))).length,
  },
  sample_by_review_type: Object.fromEntries([...new Set(sample.map((s) => s.review_type))].map((t) => [t, sample.filter((s) => s.review_type === t).length])),
  sample_by_title: { correction_letter: sample.filter((s) => s.title_kind === "correction_letter").length, other_document: sample.filter((s) => s.title_kind === "other_document").length },
  before: { ...groups(before.results), causes_all: causes(before.results), causes_tune: causes(before.results.filter((x) => x.split === "tune")), causes_holdout: causes(before.results.filter((x) => x.split === "holdout")) },
  after: { ...groups(after.results), causes_all: causes(after.results), causes_tune: causes(after.results.filter((x) => x.split === "tune")), causes_holdout: causes(after.results.filter((x) => x.split === "holdout")) },
};
writeFileSync(join(WORK, "results.json"), JSON.stringify({ ...report, letters_before: before.results, letters_after: after.results }, null, 1));

console.log("## Before\n");
console.log(table(groups(before.results)));
console.log(`\nCauses: ${JSON.stringify(report.before.causes_all)}\n`);
console.log("## After\n");
console.log(table(groups(after.results)));
console.log(`\nCauses: ${JSON.stringify(report.after.causes_all)}`);
console.log(`\nSample: ${sample.length} letters, ${report.downloads.ok} downloaded. ${JSON.stringify(report.sample_by_review_type)} ${JSON.stringify(report.sample_by_title)}`);
if (blocked) console.log(`\nBLOCKED: ${blocked}`);
