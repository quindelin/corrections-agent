// Step 4 and on: one whole market cycle, on its own branch in its own worktree.
//
//   pick ─► map ─► pack ─► baseline ─► improve ─► after ─► gate ─► report
//
// Tools run from this checkout. Everything they read and write (agent/, jurisdictions/, realdata/, runs-real/) lives in
// .market-worktrees/<place> on branch market/<place>, with its own agent name and its own MCP server, so nothing touches
// the checkout you're working in. It never pushes, never merges, and never changes evals/, the scorers or this policy.
// State is saved after each step, so rerunning a cycle picks up where it stopped and doesn't pay twice.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Source } from "./build.ts";
import type { Candidate } from "./discover.ts";
import { decide, readiness, type Decision, type PlaceRun, type Readiness } from "./gate.ts";
import { CANDIDATES, DATA, loadPolicy, logSpend, overBudget, type Policy, readJsonFile, REPO, REPORTS, spendRows, WORKTREES, writeJsonFile } from "./lib.ts";
import { onboard } from "./onboard.ts";

type Summary = { score: number | null; citation_chapter_or_better_pct: number | null; unsafe_routes: number; unparsed_letters: number; compliance_claims?: number };

export interface CycleState {
  place: string;
  dataset: string;
  started_at: string;
  branch: string;
  base_commit: string;
  built?: Record<string, number>;
  baseline?: string;
  regressions_before?: boolean;
  attempts: { run_after: string; decision: Decision; agent_commit: string; dropped: boolean }[];
  finished?: { verdict: Decision["verdict"] | "no_change"; readiness: Readiness; report: string };
}

const stateFile = (place: string) => join(DATA, "cycles", `${place}.json`);
const worktreeOf = (place: string) => join(WORKTREES, place);

function hostGit(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}
function git(place: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: worktreeOf(place), encoding: "utf8" }).trim();
}

/** The best tier A market we haven't built, or the one named. Tier B can't be scored, so it never gets here. */
export function pick(candidates: Candidate[], taken: string[], named?: string): Candidate | null {
  const usable = candidates.filter((c) => c.tier === "A" && !c.excluded && c.text_column);
  if (named) return usable.find((c) => c.place === named || c.dataset === named) ?? null;
  return usable.find((c) => !c.stale && !taken.includes(c.place)) ?? null;
}

function envFor(place: string, policy: Policy): NodeJS.ProcessEnv {
  return {
    ...process.env,
    REDLINE_HOME: worktreeOf(place),
    TF_AGENT_NAME: `redline-market-${place}`,
    TF_MCP_NAME: `permit-research-${place}`,
    TF_MCP_URL: `http://127.0.0.1:${policy.worktree.mcp_port}/mcp`,
    MCP_PORT: String(policy.worktree.mcp_port),
  };
}

function tool(place: string, policy: Policy, script: string, args: string[]): void {
  execFileSync(join(REPO, "node_modules", ".bin", "tsx"), [join(REPO, script), ...args], { cwd: REPO, env: envFor(place, policy), stdio: "inherit" });
}

async function startMcp(place: string, policy: Policy): Promise<ChildProcess> {
  const server = spawn(join(REPO, "node_modules", ".bin", "tsx"), [join(REPO, "mcp", "server.ts")], { cwd: REPO, env: envFor(place, policy), stdio: "ignore" });
  const url = `http://127.0.0.1:${policy.worktree.mcp_port}/health`;
  for (let i = 0; i < 60; i++) {
    if ((await fetch(url).catch(() => null))?.ok) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`The market's MCP server didn't start on port ${policy.worktree.mcp_port}.`);
}

function ensureWorktree(place: string, base: string): void {
  if (existsSync(worktreeOf(place))) return;
  mkdirSync(WORKTREES, { recursive: true });
  const branch = `market/${place}`;
  const exists = hostGit("branch", "--list", branch) !== "";
  hostGit("worktree", "add", "-q", ...(exists ? [worktreeOf(place), branch] : ["-b", branch, worktreeOf(place), base]));
  // Past comments are gitignored, so regression checks on other places need them copied in.
  for (const other of readdirSync(join(REPO, "jurisdictions"))) {
    const file = join(REPO, "jurisdictions", other, "comments.jsonl");
    if (existsSync(file) && existsSync(join(worktreeOf(place), "jurisdictions", other))) copyFileSync(file, join(worktreeOf(place), "jurisdictions", other, "comments.jsonl"));
  }
}

/** The process lookup needs an entry, and this loop can't read a city's guidance. So the entry says exactly that, and nothing invented. */
export const UNKNOWN_PROCESS = "RESPONSE-PROCESS-NOT-RESEARCHED";

/** Writes the pack and frozen letters into the branch, and commits them before anything runs on them. */
function writePack(place: string, source: Source, rows: Record<string, unknown>[], policy: Policy, c: Candidate): Record<string, number> {
  const home = worktreeOf(place);
  const built = build(source, rows, policy);
  const pack = join(home, "jurisdictions", place);
  const write = (path: string, value: unknown) => writeJsonFile(path, value);
  write(join(pack, "profile.json"), {
    id: place,
    name: source.name,
    authority: source.authority,
    code_basis: source.code_basis,
    hints: source.hints,
    correction_process: { name: "Not researched", entry_id: UNKNOWN_PROCESS },
    data_source: c.page,
    status: "evaluating",
    evaluation_status: { kind: "city_comments", letters: built.letters.length, holdouts: built.counts.holdout_letters, reviewed_by_licensed_professional: false, label_mapping_reviewed_by_person: false },
    license: c.license,
  });
  write(join(pack, "code.json"), { note: `Mined from citations in ${source.name}'s public review comments, so it holds only sections reviewers have cited. Titles come from how reviewers wrote them. Spans code editions. Not code text.`, sections: [...built.sections, { id: UNKNOWN_PROCESS, title: "How to respond to review comments (not researched)", scope: `Not a code section. How ${source.name} wants a resubmittal returned hasn't been read yet. Answer each comment on its own, assume no particular form, marks or wording, and leave the format for the licensed professional to confirm.` }] });
  write(join(pack, "citations.json"), { families: source.families, bare_section_family: source.bare_section_family });
  writeFileSync(join(pack, "comments.jsonl"), built.pastComments.map((x) => JSON.stringify(x)).join("\n") + "\n");
  write(join(home, "realdata", place, "letters.json"), { note: `Real comments from ${source.name}'s public dataset (${source.domain}/${source.dataset}). Reviewers' citations are hidden in the text and kept as labels. Contact details and reviewer names removed.`, letters: built.letters });
  const skill = join(home, "agent", "skills", `local-${place}`, "SKILL.md");
  mkdirSync(join(skill, ".."), { recursive: true });
  writeFileSync(skill, `---\nname: local-${place}\ndescription: Rules learned for projects in ${source.name} (jurisdiction id "${place}"). Use only when the project's jurisdiction is ${place}.\n---\n\n# ${source.name} rules\n`);
  git(place, "add", join("jurisdictions", place), join("realdata", place), join("agent", "skills", `local-${place}`));
  git(place, "commit", "-q", "-m", `market: add ${place} pack and frozen letters, before its first run\n\nSource: ${c.page}`);
  return built.counts;
}

const lettersIn = (place: string, id: string, holdoutOnly: boolean): number => {
  const file = id === "chicago" ? null : join(worktreeOf(place), "realdata", id, "letters.json");
  if (!file) return 8;
  const letters = (JSON.parse(readFileSync(file, "utf8")) as { letters: { holdout: boolean }[] }).letters;
  return holdoutOnly ? letters.filter((l) => l.holdout).length : letters.length;
};

function checkBudget(state: CycleState, letters: number, policy: Policy): void {
  const why = overBudget(spendRows(), state.place, state.started_at, letters * policy.budget.estimated_usd_per_letter, policy);
  if (why) throw new BudgetStop(`Stopped before spending more: ${why}. Rerun to continue once the limit allows it.`);
}

export class BudgetStop extends Error {}

function latestRun(place: string, tag: string): string | null {
  const dir = join(worktreeOf(place), "runs-real", place);
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((n) => /^\d+-/.test(n) && n.endsWith(`-${tag}`)).sort().pop() ?? null;
}

function runLetters(state: CycleState, policy: Policy, tag: string, holdoutOnly = false): string {
  const place = state.place;
  const done = latestRun(place, tag);
  if (done) return done;
  checkBudget(state, lettersIn(place, place, holdoutOnly), policy);
  tool(place, policy, "realdata/run.ts", ["--place", place, "--focused", "--tag", tag, ...(holdoutOnly ? ["--holdout-only"] : [])]);
  const name = latestRun(place, tag)!;
  const score = JSON.parse(readFileSync(join(worktreeOf(place), "runs-real", place, name, "score.json"), "utf8")) as { cost_usd: number };
  logSpend({ place, step: `run ${tag}`, usd: score.cost_usd });
  git(place, "add", join("runs-real", place));
  git(place, "commit", "-q", "-m", `market: ${place} run ${name}`);
  return name;
}

const CHECKS = ["seattle", "chicago"];

function runCheck(state: CycleState, policy: Policy, other: string, when: string): void {
  const place = state.place;
  const out = join(worktreeOf(place), "runs-real", place, "checks", when, other);
  if (existsSync(join(out, "score.json"))) return;
  checkBudget(state, lettersIn(place, other, other !== "chicago"), policy);
  if (other === "chicago") tool(place, policy, "realdata/check-chicago.ts", ["--focused", "--out", out]);
  else tool(place, policy, "realdata/run.ts", ["--place", other, "--focused", "--holdout-only", "--out", out]);
  const score = JSON.parse(readFileSync(join(out, "score.json"), "utf8")) as { cost_usd?: number };
  logSpend({ place, step: `check ${other} ${when}`, usd: score.cost_usd ?? 0 });
}

export function outcomes(results: { letter_id: string; holdout: boolean; status?: string; comments: { comment: string; score: number | null; unsafe: boolean; compliance_claim?: boolean }[] }[], holdoutOnly: boolean): PlaceRun {
  // An unanswered letter can't be paired with its earlier answer, so it leaves the comparison and is counted on its own.
  const inScope = results.filter((r) => !holdoutOnly || r.holdout);
  const list = inScope.filter((r) => r.status === undefined || r.status === "done");
  const comments = list.flatMap((r) => r.comments.map((c) => ({ ...c, letter: r.letter_id })));
  const scored = comments.filter((c) => c.score !== null);
  return {
    score: scored.length ? (100 * scored.reduce((s, c) => s + (c.score ?? 0), 0)) / scored.length : null,
    unsafe_routes: comments.filter((c) => c.unsafe).length,
    compliance_claims: comments.filter((c) => c.compliance_claim).length,
    failed_letters: inScope.length - list.length,
    comments: comments.map((c) => ({ key: `${c.letter}/${c.comment}`, score: c.score })),
  };
}

function checkRun(state: CycleState, other: string, when: string): PlaceRun {
  const out = join(worktreeOf(state.place), "runs-real", state.place, "checks", when, other);
  const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as { task_id?: string; letter_id?: string; holdout: boolean; comments: { comment: string; score: number | null; unsafe: boolean; compliance_claim?: boolean }[] }[];
  return outcomes(results.map((r) => ({ ...r, letter_id: r.letter_id ?? r.task_id ?? "" })), false);
}

/** Runs one whole cycle. Returns its finished state, or throws BudgetStop with progress saved. */
export async function cycle(opts: { place?: string; base?: string; log?: typeof console.log }): Promise<CycleState> {
  const log = opts.log ?? console.log;
  const policy = loadPolicy();
  const list = readJsonFile<{ candidates: Candidate[] }>(CANDIDATES);
  if (!list) throw new Error("No candidates yet. Run: npm run markets -- discover");
  const taken = readdirSync(join(REPO, "jurisdictions"));
  const c = pick(list.candidates, taken, opts.place);
  if (!c) throw new Error(opts.place ? `"${opts.place}" isn't a tier A candidate.` : "No new tier A market to build. Tier B markets need letters from a person. See the report.");
  const { source, rows } = await onboard(c, policy, log, taken);
  const place = source.id;

  let state = readJsonFile<CycleState>(stateFile(place));
  if (!state) {
    state = { place, dataset: c.dataset, started_at: new Date().toISOString(), branch: `market/${place}`, base_commit: hostGit("rev-parse", opts.base ?? "HEAD"), attempts: [] };
  }
  const save = () => writeJsonFile(stateFile(place), state);
  save();
  log(`\nMarket: ${source.name} on branch ${state.branch} (${rows.length} rows)`);
  ensureWorktree(place, state.base_commit);
  if (!state.built) {
    state.built = writePack(place, source, rows, policy, c);
    save();
    log(`Pack built: ${JSON.stringify(state.built)}`);
  }

  const mcp = await startMcp(place, policy);
  try {
    state.baseline = runLetters(state, policy, "baseline");
    save();
    for (const other of CHECKS) runCheck(state, policy, other, "before");
    state.regressions_before = true;
    save();

    while (state.attempts.length < policy.gate.max_improve_attempts && state.attempts.at(-1)?.decision.verdict !== "kept") {
      const n = state.attempts.length + 1;
      const head = git(place, "rev-parse", "HEAD");
      // A rerun after a stop may find a rewrite that was committed but never scored. Score that one, rather than pay for another.
      const unscored = git(place, "log", "-1", "--format=%s").startsWith("agent: ") && !state.attempts.some((a) => a.agent_commit === head);
      if (!unscored) {
        // "After" runs cover holdouts only, so training mistakes always come from the baseline. If the last attempt fell short, hear why.
        const last = state.attempts.at(-1);
        tool(place, policy, "realdata/improve.ts", ["--place", place, "--run", state.baseline, ...(last ? ["--note", last.decision.reasons.join("; ")] : [])]);
        if (git(place, "rev-parse", "HEAD") === head) {
          log("The agent proposed no change.");
          break;
        }
      }
      const agentCommit = git(place, "rev-parse", "HEAD");
      // Only the shared files can move another place, so a local-only change doesn't pay for regression checks.
      const touched = git(place, "diff", "--name-only", `${agentCommit}^`, agentCommit).split("\n").filter((f) => f.startsWith("agent/"));
      const sharedChanged = touched.some((f) => !f.includes(`local-${place}/`));
      // The verdict reads only holdouts, so that's all this pays for.
      const runAfter = runLetters(state, policy, `after${n}`, true);
      if (sharedChanged) for (const other of CHECKS) runCheck(state, policy, other, `after${n}`);

      const results = (name: string) => JSON.parse(readFileSync(join(worktreeOf(place), "runs-real", place, name, "results.json"), "utf8"));
      const others = sharedChanged ? Object.fromEntries(CHECKS.map((o) => [o, { before: checkRun(state!, o, "before"), after: checkRun(state!, o, `after${n}`) }])) : {};
      const decision = decide({ place, before: outcomes(results(state.baseline), true), after: outcomes(results(runAfter), true), others, minComments: policy.evaluation.min_holdout_comments }, policy);
      log(`\nAttempt ${n}: ${decision.verdict}. ${decision.reasons.join("; ")}`);
      const dropped = decision.verdict === "rejected";
      // Revert rather than reset, so the failed attempt stays in the branch's history for review.
      if (dropped) git(place, "revert", "--no-edit", agentCommit);
      state.attempts.push({ run_after: runAfter, decision, agent_commit: agentCommit, dropped });
      save();
    }
  } finally {
    mcp.kill();
  }

  const best = [...state.attempts].reverse().find((a) => !a.dropped) ?? null;
  const summaryOf = (name: string) => (JSON.parse(readFileSync(join(worktreeOf(place), "runs-real", place, name, "score.json"), "utf8")) as { holdout: Summary }).holdout;
  const final = summaryOf(best?.run_after ?? state.baseline);
  const ready = readiness(final, policy);
  const verdict = best?.decision.verdict ?? (state.attempts.length ? "rejected" : "no_change");
  const report = writeReport(state, source, c, summaryOf(state.baseline), final, ready, verdict);
  state.finished = { verdict, readiness: ready, report };
  save();
  const profilePath = join(worktreeOf(place), "jurisdictions", place, "profile.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  profile.evaluation_status = { ...profile.evaluation_status, holdout_score: final.score, citation_chapter_or_better_pct: final.citation_chapter_or_better_pct, unsafe_routes: final.unsafe_routes, verdict, ready_for_design_partner: ready.ready, evaluated_at: new Date().toISOString().slice(0, 10) };
  writeJsonFile(profilePath, profile);
  git(place, "add", join("jurisdictions", place, "profile.json"), join("runs-real", place));
  git(place, "commit", "-q", "-m", `market: ${place} cycle finished: ${verdict}`);
  return state;
}

/** Scorers can't catch a false rule, so the rules still standing go in the report for a person to read. */
function rulesToRead(state: CycleState): string[] {
  const skill = join(worktreeOf(state.place), "agent", "skills", `local-${state.place}`, "SKILL.md");
  const body = readFileSync(skill, "utf8").replace(/^---[\s\S]*?---\n/, "").trim();
  const shared = git(state.place, "diff", "--stat", state.base_commit, "HEAD", "--", "agent/instructions.md", "agent/skills/correction-playbook", "agent/skills/local-chicago", "agent/skills/local-seattle");
  return ["## Rules the agent wrote: read these", "", "Scorers can't tell a false rule from a true one, so a person has to read them.", "", "```markdown", body, "```", "", shared ? `It also changed shared files:\n\n\`\`\`\n${shared}\n\`\`\`` : "It changed no shared files.", ""];
}

function writeReport(state: CycleState, source: Source, c: Candidate, before: Summary, after: Summary, ready: Readiness, verdict: string): string {
  const spent = spendRows().filter((r) => r.place === state.place && r.at >= state.started_at).reduce((s, r) => s + r.usd, 0);
  const lines = [
    `# Market cycle: ${source.name}`,
    "",
    `**Verdict: ${verdict}.** ${ready.ready ? "It passes the design-partner bar." : "It doesn't pass the design-partner bar yet."} Branch \`${state.branch}\` holds the work. Nothing has been pushed or merged, and the pack stays marked \`evaluating\`, so customers aren't offered it.`,
    "",
    `| Holdout, ${state.built?.holdout_comments ?? "?"} comments | Before | After |`,
    "|---|---|---|",
    `| Score | ${before.score ?? "-"} | ${after.score ?? "-"} |`,
    `| Citations at chapter or better | ${before.citation_chapter_or_better_pct ?? "-"}% | ${after.citation_chapter_or_better_pct ?? "-"}% |`,
    `| Unsafe routes | ${before.unsafe_routes} | ${after.unsafe_routes} |`,
    `| Drafts stating a compliance conclusion | ${before.compliance_claims ?? "-"} | ${after.compliance_claims ?? "-"} |`,
    "",
    ...rulesToRead(state),
    "## Attempts",
    "",
    ...(state.attempts.length ? state.attempts.map((a, i) => `${i + 1}. **${a.decision.verdict}**${a.dropped ? " (reverted)" : ""}: ${a.decision.reasons.join("; ")}. Commit \`${a.agent_commit.slice(0, 7)}\`.${Object.keys(a.decision.regressions).length ? ` Other places: ${Object.entries(a.decision.regressions).map(([p, d]) => `${p} ${d.points} points (${d.low} to ${d.high}, n=${d.n})`).join("; ")}.` : " Only this place's own skill changed, so other places weren't re-run."}`) : ["None. The agent proposed no change."]),
    "",
    "## Design-partner bar",
    "",
    ...ready.checks.map((x) => `- ${x.passed ? "Pass" : "Fail"}: ${x.name} is ${x.value ?? "unknown"}, needs ${x.needed}.`),
    "",
    "## Where the data came from",
    "",
    `[${c.name}](${c.page}), ${c.license ?? "license not stated in the catalog"}. Letters: ${state.built?.comments ?? "?"} comments in ${state.built?.holdout_letters ?? "?"} holdout letters plus training letters, frozen in the commit before the first run. Evidence:`,
    "",
    ...Object.entries(c.measures).map(([, m]) => `- ${m.value}: ${m.definition}. [Query](${m.query})`),
    "",
    "## What a person still has to check",
    "",
    ...(source.repairs?.length ? [`- **Code corrected the model's mapping in these places:** ${source.repairs.join("; ")}.`] : []),
    "- **The label mapping was proposed by a model and tested by code, but no person has read it.** See `markets/sources/" + state.place + ".json`, above all `review_types` and `review_type_discipline`.",
    "- **A score here means agreement with what this city's reviewers cited.** It doesn't show a city would accept a response, and no licensed professional has reviewed the output.",
    "- **The code index holds only sections reviewers have cited, across editions.** It has no edition by date yet, so a current letter could get a citation from a superseded edition.",
    "- **Response format isn't learned from this data.** How this city wants a resubmittal returned needs reading from its own guidance before a customer uses this.",
    "- **Competition and pre-check tools weren't researched for this place,** because this loop has no web search.",
    `- Data terms: check them before relying on the dataset commercially.`,
    "",
    `Estimated spend this cycle: $${spent.toFixed(2)}.`,
    "",
  ];
  mkdirSync(REPORTS, { recursive: true });
  const file = join(REPORTS, `${state.place}.md`);
  writeFileSync(file, lines.join("\n"));
  return file;
}
