// npm run markets -- <command>
//   discover            search open-data catalogs, measure what's there, and write markets/reports/candidates.md
//   map --place id      propose and test a dataset mapping, and preview the letters, with no runs on them
//   cycle [--place id] [--base ref]  build, score and improve the best new market on its own branch
//   run                 discover, then cycle the best new market. This is the one to schedule.
//   report              rewrite the reports from the last discover
//   status              candidates, cycles and spend

import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { flag, option } from "../scripts/lib.ts";
import { build } from "./build.ts";
import { BudgetStop, cycle, pick, type CycleState } from "./cycle.ts";
import { discover, type Candidate } from "./discover.ts";
import { onboard } from "./onboard.ts";
import { CANDIDATES, DATA, loadPolicy, readJsonFile, REPO, REPORTS, spendRows } from "./lib.ts";

const command = process.argv[2];

/** What to ask a place for when rework is measured but its comments aren't public. A draft for a person to send. */
export function recordsRequest(c: Candidate): string {
  const evidence = Object.values(c.measures).filter((m) => /share|percent/i.test(m.definition)).map((m) => `${m.value}%: ${m.definition}`);
  return `To the public records officer for ${c.attribution ?? c.place}:

I'm requesting copies of plan review correction letters or review comments issued to applicants for building permits, for the 12 months before this request. Comments as text or as an export from your permitting system would be ideal, and I'd accept 50 recent examples if the full set is burdensome. Please remove personal contact details.

Context: your public dataset ${c.name} (${c.page}) shows review outcomes, but not the comments themselves.
${evidence.map((e) => `- ${e}`).join("\n")}

[Your name, organization and contact details]`;
}

export function writeCandidateReport(candidates: Candidate[], meta: { searched_at: string; datasets_searched: number; datasets_measured: number }): string {
  const policy = loadPolicy();
  const row = (c: Candidate) => {
    const m = c.measures;
    const link = (k: string, suffix = "") => (m[k] ? `[${m[k].value}${suffix}](${m[k].query})` : "-");
    return `| ${c.place} | [${c.name.slice(0, 50)}](${c.page}) | ${link("rows")} | ${link("rows_last_12_months")} | ${link("correction_share", "%")} | ${link("share_needing_2_plus_cycles", "%")} | ${link("share_sent_back", "%")} | ${c.stale ? "stale" : "current"}${c.excluded ? ", excluded" : ""} |`;
  };
  const table = (list: Candidate[]) => ["| Place | Dataset | Rows | Last 12 months | Reads as corrections | 2+ cycles | Sent back | Status |", "|---|---|---|---|---|---|---|---|", ...list.map(row)];
  const a = candidates.filter((c) => c.tier === "A");
  const b = candidates.filter((c) => c.tier === "B");
  const lines = [
    "# Market candidates",
    "",
    `Searched ${meta.searched_at.slice(0, 10)}: ${meta.datasets_searched} datasets from ${policy.discovery.catalogs.length} catalogs, ${meta.datasets_measured} about permits, ${candidates.length} showing corrections or rework. Every number links to the query behind it.`,
    "",
    "**How to read this.** Definitions differ between cities, so this isn't a league table of pain, and it doesn't measure market size or willingness to pay. It only covers cities publishing on Socrata, so a city missing here may simply publish elsewhere.",
    "",
    "## Tier A: correction text is public, so the agent can be built and scored here",
    "",
    ...table(a),
    "",
    "## Tier B: rework is measured, but the comments aren't public",
    "",
    "There's nothing here to score on, so the loop stops. Each needs real letters, from a design partner or a records request.",
    "",
    ...table(b),
    "",
  ];
  mkdirSync(REPORTS, { recursive: true });
  const file = join(REPORTS, "candidates.md");
  writeFileSync(file, lines.join("\n"));
  // No request where we already have letters, and one per place.
  const built = readdirSync(join(REPO, "jurisdictions"));
  const asking = b.filter((c, i) => !c.excluded && !built.includes(c.place) && b.findIndex((x) => x.place === c.place) === i);
  const requests = asking.slice(0, 5).map((c) => `## ${c.place}\n\n${recordsRequest(c)}\n`);
  writeFileSync(join(REPORTS, "records-requests.md"), `# Draft records requests\n\nDrafts for a person to read, change and send. The agent can't send anything, and hasn't checked each place's records process.\n\n${requests.join("\n")}`);
  return file;
}

async function runDiscover(): Promise<Candidate[]> {
  const candidates = await discover();
  const meta = readJsonFile<{ searched_at: string; datasets_searched: number; datasets_measured: number }>(CANDIDATES)!;
  console.log(`\n${candidates.filter((c) => c.tier === "A").length} tier A, ${candidates.filter((c) => c.tier === "B").length} tier B. Report: ${writeCandidateReport(candidates, meta)}`);
  return candidates;
}

function printCycle(state: CycleState): void {
  console.log(`\n${state.place}: ${state.finished?.verdict ?? "unfinished"}. ${state.finished?.readiness.ready ? "Passes" : "Doesn't pass"} the design-partner bar. Branch ${state.branch}. Report: ${state.finished?.report ?? "none yet"}`);
}

async function runCycle(place?: string): Promise<void> {
  try {
    printCycle(await cycle({ place, base: option("base") }));
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
    console.log(e.message);
  }
}

if (command === "report") {
  const list = readJsonFile<{ searched_at: string; datasets_searched: number; datasets_measured: number; candidates: Candidate[] }>(CANDIDATES);
  if (!list) throw new Error("No candidates yet. Run discover first.");
  console.log(writeCandidateReport(list.candidates, list));
} else if (command === "discover") {
  await runDiscover();
} else if (command === "map") {
  const list = readJsonFile<{ candidates: Candidate[] }>(CANDIDATES);
  const c = list && pick(list.candidates, [], option("place"));
  if (!c) throw new Error("Name a tier A candidate with --place. Run discover first.");
  const policy = loadPolicy();
  const { source, rows } = await onboard(c, policy);
  const built = build(source, rows, policy);
  console.log(JSON.stringify({ source, counts: built.counts }, null, 1));
  for (const l of built.letters.slice(0, 6)) {
    console.log(`\n${l.id}${l.holdout ? " (holdout)" : ""}\n  ${l.project.description.slice(0, 140)}`);
    for (const x of l.comments) console.log(`  ${x.id} [${x.labels.discipline ?? "-"} | ${x.labels.citations.join(", ") || "-"} | ${x.labels.route ?? "-"}] ${x.text.slice(0, 170).replace(/\n/g, " ")}`);
  }
} else if (command === "cycle") {
  await runCycle(option("place"));
} else if (command === "run") {
  await runDiscover();
  await runCycle(option("place"));
} else if (command === "status") {
  const list = readJsonFile<{ searched_at: string; candidates: Candidate[] }>(CANDIDATES);
  console.log(list ? `Candidates from ${list.searched_at.slice(0, 10)}: ${list.candidates.map((c) => `${c.place}(${c.tier})`).join(", ")}` : "No candidates yet.");
  const dir = join(DATA, "cycles");
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    // No cycle has run yet.
  }
  for (const n of names) {
    const s = readJsonFile<CycleState>(join(dir, n))!;
    console.log(`${s.place}: ${s.finished?.verdict ?? "in progress"}, ${s.attempts.length} attempt(s), branch ${s.branch}`);
  }
  const total = spendRows().reduce((sum, r) => sum + r.usd, 0);
  console.log(`Estimated spend so far: $${total.toFixed(2)}`);
} else if (!flag("help")) {
  console.log("Commands: discover, map --place id, cycle [--place id] [--base ref], run, status");
}
