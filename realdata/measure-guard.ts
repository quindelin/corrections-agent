// npx tsx realdata/measure-guard.ts <results.json>... [--dump file.json] [--sample file.txt]
// Replays saved agent output through demo/guard.ts and scores it before and after with the frozen scorer.
// Offline and read-only: no model calls, and it writes nothing unless --dump is given.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardItems, judgmentSignals, type GuardedItem, type GuardPack } from "../demo/guard.ts";
import { parseItems, type Item } from "../evals/score.ts";
import { scoreLetter, summarize, type LetterScore, type RealLetter } from "./score.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const packs: GuardPack[] = ["chicago", "seattle"].map((id) => ({ profile: readJson(join(ROOT, "jurisdictions", id, "profile.json")), code: readJson(join(ROOT, "jurisdictions", id, "code.json")).sections }));
const letters: RealLetter[] = readJson(join(ROOT, "realdata", "seattle", "letters.json")).letters;

// The scorer's own patterns, copied rather than imported because score.ts doesn't export them.
const SCORER_COMPLIANCE = /\b(compl(y|ies|ied|iant|iance|ying)|meets? (the )?code|code[- ]conforming|satisf(y|ies|ied)|conforms? (to|with))\b/i;
const SCORER_FOREIGN = /Certified Plan|Form 420|Department of Buildings\b|\bbubbl/i;
const GARBLE: [string, RegExp][] = [
  ["double space", / {2,}/],
  ["comma before period", /,\s*[.!?]/],
  ["space before punctuation", /\s[.,;:](?:\s|$)/],
  ["double period", /\.\.(?!\.)/],
  ["dangling conjunction", /\b(?:and|or|but|with|per|to)\s*[.!?]\s*(?:$|[A-Z])/],
  ["no closing punctuation", /[^.!?'"”’)\s]\s*$/],
  ["starts lowercase", /^\s*[a-z]/],
];

const replyOf = (items: Item[]) => "```json\n" + JSON.stringify({ items }) + "\n```";
const count = (rows: unknown[]) => rows.length;

interface Row {
  letter: string;
  holdout: boolean;
  comment: string;
  text: string;
  label: string | null;
  labelCitations: string[];
  before: Item;
  after: GuardedItem;
  scoreBefore: LetterScore["comments"][number] | undefined;
  scoreAfter: LetterScore["comments"][number] | undefined;
}

function measure(path: string) {
  const saved = readJson(path) as { letter_id: string; reply: string; comments: LetterScore["comments"] }[];
  const before: LetterScore[] = [];
  const after: LetterScore[] = [];
  const rows: Row[] = [];
  let reproduced = true;
  for (const run of saved) {
    const letter = letters.find((l) => l.id === run.letter_id);
    if (!letter) throw new Error(`No letter for ${run.letter_id}`);
    const b = scoreLetter(letter, run.reply);
    if (JSON.stringify(b.comments) !== JSON.stringify(run.comments)) reproduced = false;
    const items = parseItems(run.reply) ?? [];
    const guarded = guardItems(items, letter, packs);
    const a = scoreLetter(letter, replyOf(guarded));
    before.push(b);
    after.push(a);
    items.forEach((item, i) => {
      const c = letter.comments.find((x) => x.id === item.comment);
      rows.push({ letter: letter.id, holdout: letter.holdout, comment: item.comment, text: c?.text ?? "", label: c?.labels.route ?? null, labelCitations: c?.labels.citations ?? [], before: item, after: guarded[i], scoreBefore: b.comments.find((x) => x.comment === item.comment), scoreAfter: a.comments.find((x) => x.comment === item.comment) });
    });
  }

  const has = (r: Row, rule: string, action?: string) => r.after.flags.some((f) => f.rule === rule && (!action || f.action === action));
  const changedText = rows.filter((r) => r.before.draft !== r.after.draft);
  const scorerClean = (r: Row) => !SCORER_COMPLIANCE.test(r.before.draft) && !SCORER_FOREIGN.test(r.before.draft);
  const flagged = (r: Row) => r.after.flags.length > 0;
  const reviewFlagged = (r: Row) => r.after.flags.some((f) => f.level === "review");
  const garbled = rows.filter((r) => r.before.draft !== r.after.draft && r.after.draft.trim()).flatMap((r) => GARBLE.filter(([, re]) => re.test(r.after.draft) && !re.test(r.before.draft)).map(([name]) => ({ letter: r.letter, comment: r.comment, problem: name, draft: r.after.draft })));
  const compliance = rows.filter((r) => SCORER_COMPLIANCE.test(r.before.draft));
  const foreign = rows.filter((r) => SCORER_FOREIGN.test(r.before.draft));
  const forced = rows.filter((r) => has(r, "route_forced"));
  const cleared = rows.filter((r) => has(r, "citation_not_in_index"));
  const sum = (s: LetterScore[]) => {
    const { score, route_pct, route_n, unsafe_routes, compliance_claims, foreign_process_drafts, drafts_with_invented_numbers, citation_section_pct, citation_chapter_or_better_pct, citation_not_in_index, citation_missing, citation_n } = summarize(s);
    return { score, route_pct, route_n, unsafe_routes, compliance_claims, foreign_process_drafts, drafts_with_invented_numbers, citation_section_pct, citation_chapter_or_better_pct, citation_not_in_index, citation_missing, citation_n };
  };
  // Rules that rarely fire on saved output still have to work, so plant the problem in every draft and count catches.
  const planted = (mutate: (i: Item) => Item, rule: string) => {
    let caught = 0;
    let total = 0;
    for (const run of saved) {
      const letter = letters.find((l) => l.id === run.letter_id)!;
      const items = (parseItems(run.reply) ?? []).filter((i) => i.draft.trim());
      const guarded = guardItems(items.map(mutate), letter, packs);
      total += guarded.length;
      caught += guarded.filter((g) => g.flags.some((f) => f.rule === rule)).length;
    }
    return `${caught}/${total}`;
  };
  const signalRows = rows.filter((r) => r.text);
  const fires = (r: Row) => judgmentSignals(r.text).length > 0;
  const labelled = signalRows.filter((r) => r.label);

  return {
    report: {
      path,
      saved_scores_reproduced: reproduced,
      items: rows.length,
      before: sum(before),
      after: sum(after),
      holdout_before: sum(before.filter((l) => l.holdout)),
      holdout_after: sum(after.filter((l) => l.holdout)),
      compliance: {
        scorer_hits_before: count(compliance),
        flagged_by_guard: count(compliance.filter((r) => has(r, "compliance_claim"))),
        rewritten_by_guard: count(compliance.filter((r) => has(r, "compliance_claim", "rewritten"))),
        passed_as_not_a_claim: count(compliance.filter((r) => !has(r, "compliance_claim"))),
        assertions: count(rows.filter((r) => r.after.flags.some((f) => f.rule === "compliance_claim" && f.message.startsWith("States")))),
        drafts_flagged_beyond_scorer: count(rows.filter((r) => has(r, "compliance_claim") && !SCORER_COMPLIANCE.test(r.before.draft))),
      },
      foreign: {
        scorer_hits_before: count(foreign),
        removed: count(foreign.filter((r) => has(r, "foreign_process", "removed") && !has(r, "foreign_process", "flagged"))),
        left_in_and_flagged: count(foreign.filter((r) => has(r, "foreign_process", "flagged"))),
        silent_after: count(rows.filter((r) => SCORER_FOREIGN.test(r.after.draft) && !has(r, "foreign_process", "flagged"))),
        emptied: count(rows.filter((r) => has(r, "empty_draft"))),
      },
      citations: {
        cleared: cleared.map((r) => ({ letter: r.letter, comment: r.comment, citation: r.before.citation, reviewer: r.labelCitations, scorer_before: r.scoreBefore?.citation })),
        flagged_in_draft: count(rows.filter((r) => has(r, "citation_in_draft"))),
      },
      numbers: {
        drafts_flagged: count(rows.filter((r) => has(r, "invented_number"))),
        scorer_hits_not_flagged: rows.filter((r) => r.scoreBefore?.invented_numbers.length && !has(r, "invented_number")).map((r) => ({ letter: r.letter, comment: r.comment, numbers: r.scoreBefore?.invented_numbers })),
      },
      routes: {
        forced: forced.map((r) => ({ letter: r.letter, holdout: r.holdout, comment: r.comment, from: r.before.route, label: r.label, signals: judgmentSignals(r.text), text: r.text.slice(0, 200) })),
        forced_against_a_label: count(forced.filter((r) => r.label && r.label !== "licensed_review")),
        signal_on_labelled_licensed: `${count(labelled.filter((r) => r.label === "licensed_review" && fires(r)))}/${count(labelled.filter((r) => r.label === "licensed_review"))}`,
        signal_on_labelled_other: `${count(labelled.filter((r) => r.label !== "licensed_review" && fires(r)))}/${count(labelled.filter((r) => r.label !== "licensed_review"))}`,
        signal_on_agent_licensed: `${count(signalRows.filter((r) => r.before.route === "licensed_review" && fires(r)))}/${count(signalRows.filter((r) => r.before.route === "licensed_review"))}`,
        signal_on_agent_agent_draft_or_no_action: `${count(signalRows.filter((r) => ["agent_draft", "no_action"].includes(r.before.route) && fires(r)))}/${count(signalRows.filter((r) => ["agent_draft", "no_action"].includes(r.before.route)))}`,
        signal_missed_labelled_licensed: labelled.filter((r) => r.label === "licensed_review" && !fires(r)).map((r) => `${r.letter.slice(0, 2)} ${r.comment}: ${r.text.slice(0, 120)}`),
      },
      clean: {
        drafts_with_text: count(rows.filter((r) => r.before.draft.trim())),
        text_changed: count(changedText),
        text_changed_where_scorer_saw_nothing: changedText.filter(scorerClean).map((r) => ({ letter: r.letter, comment: r.comment })),
        scorer_clean_with_text: count(rows.filter((r) => r.before.draft.trim() && scorerClean(r))),
        scorer_clean_flagged_for_review: count(rows.filter((r) => r.before.draft.trim() && scorerClean(r) && reviewFlagged(r))),
        items_with_any_flag: count(rows.filter(flagged)),
        items_with_review_flag: count(rows.filter(reviewFlagged)),
      },
      planted: {
        assertion: planted((i) => ({ ...i, draft: `${i.draft} The revised plans now comply with the code.` }), "compliance_claim"),
        number: planted((i) => ({ ...i, draft: `${i.draft} The minimum clear width will be 9173 inches.` }), "invented_number"),
        citation: planted((i) => ({ ...i, citation: "SMC 99.99.999" }), "citation_not_in_index"),
        citation_in_draft: planted((i) => ({ ...i, draft: `${i.draft} See SMC 99.99.999.` }), "citation_in_draft"),
      },
      flags_by_rule: Object.fromEntries(Object.entries(rows.flatMap((r) => r.after.flags).reduce<Record<string, number>>((n, f) => ((n[`${f.rule}/${f.action}`] = (n[`${f.rule}/${f.action}`] ?? 0) + 1), n), {})).sort()),
      garble_lint: garbled,
    },
    rows,
  };
}

const args = process.argv.slice(2);
const at = args.indexOf("--dump");
const dump = at >= 0 ? args.splice(at, 2)[1] : null;
const sampleAt = args.indexOf("--sample");
const sampleFile = sampleAt >= 0 ? args.splice(sampleAt, 2)[1] : null;
const results = args.map(measure);
console.log(JSON.stringify(results.map((r) => r.report), null, 1));
if (dump) writeFileSync(dump, JSON.stringify(results.map((r) => ({ path: r.report.path, rows: r.rows }))));
// For reading by hand: every 7th changed draft, and every rewrite, because rewrites carry the most risk.
if (sampleFile) {
  const lines = results.flatMap((r) => {
    const changed = r.rows.filter((x) => x.before.draft !== x.after.draft);
    const pick = changed.filter((x, i) => i % 7 === 0 || x.after.flags.some((f) => f.action === "rewritten"));
    return pick.map((x) => `[${r.report.path.split("/").at(-2)} ${x.letter} ${x.comment}]\nBEFORE: ${x.before.draft}\nAFTER:  ${x.after.draft}\n`);
  });
  writeFileSync(sampleFile, lines.join("\n"));
}
