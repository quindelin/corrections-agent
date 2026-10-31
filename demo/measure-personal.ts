// npx tsx demo/measure-personal.ts [--comments path] [--tails]
//
// Measures personal-detail stripping on every comment in Seattle's Plan Comments dataset, grouped by letter, the way
// parseLetter does it. Prints counts only. --tails also lists the removed endings for hand review: those include real
// names, so don't paste that list anywhere that's kept.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectNames, stripPersonal, stripTrailingHeading } from "./strip-personal.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--comments");
const file = i >= 0 ? process.argv[i + 1] : join(ROOT, ".cache", "seattle", "comments.json");

interface Row {
  url?: { url: string };
  comment?: string;
  commentsubject?: string;
  reviewtype?: string;
}
const rows = (JSON.parse(readFileSync(file, "utf8")) as Row[]).filter((r) => r.comment);

const CHECKS: Record<string, RegExp> = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  phone: /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
  "Author: field": /\bAuthor:/,
  "Reviewer: <name>": /\b(?:Reviewer|Examiner)\s*:\s*[A-Z][a-z]+\s+[A-Z][a-z]+/,
  "ends in a group heading, such as X (5)": /\(\d{1,3}\)\s*$/,
};

const byUrl = new Map<string, Row[]>();
for (const r of rows) byUrl.set(r.url?.url ?? "", [...(byUrl.get(r.url?.url ?? "") ?? []), r]);

const before = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, 0]));
const after = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, 0]));
let heavy = 0;
let namesKnown = 0;
let namesLeft = 0;
const tails = new Map<string, number>();

for (const list of byUrl.values()) {
  const whole = list.map((r) => r.comment).join("\n");
  const names = collectNames(whole);
  for (const r of list) {
    const raw = r.comment!;
    const headings = [r.commentsubject ?? "", r.reviewtype ?? ""];
    const cut = stripTrailingHeading(raw, headings);
    const out = stripPersonal(cut, names);
    for (const [k, re] of Object.entries(CHECKS)) {
      if (re.test(raw)) before[k]++;
      if (re.test(out)) after[k]++;
    }
    if (cut.length < raw.length) {
      const tail = raw.slice(cut.length).trim();
      tails.set(tail, (tails.get(tail) ?? 0) + 1);
    }
    if (out.length < raw.length * 0.8) heavy++;
    for (const n of names) {
      if (raw.includes(n)) namesKnown++;
      if (out.includes(n)) namesLeft++;
    }
  }
}

console.log(JSON.stringify({ comments: rows.length, letters: byUrl.size, before, after, comments_losing_over_20pct_of_chars: heavy, labelled_name_occurrences: { before: namesKnown, after: namesLeft }, distinct_endings_removed: tails.size }, null, 1));
if (process.argv.includes("--tails")) {
  for (const [t, n] of [...tails.entries()].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${t}`);
}
