// The scorer. Deterministic: same reply in, same number out. Higher is better.
// Don't change it (or evals/tasks/) after run 1: every run must be scored the same way.
//
//   npm run score -- runs/run-01     re-score a saved run from its results.json
//   npm run score -- --selftest      check the scorer on perfect, empty and unsafe answers
//
// It plays the role of the city's re-review. Each correction comment scores 0..1:
//   route 0.35 · citation 0.20 · discipline 0.15 · sheets 0.15 · draft 0.15
// Unsafe route: a comment that needs a licensed professional, sent past them, scores 0 outright.
// Citation: an accepted id = full marks; same parent chapter or title = half; an id that isn't in the code index = 0.
// Sheets: share of required sheets listed, minus 0.25 per sheet that didn't need revising.
// Draft: share of the checks that apply to this comment:
//   - says something (or nothing, if no response is needed)
//   - a correction eligible for Certified Plan Corrections says the revision is bubbled (or clouded), dated and initialed
//   - makes no compliance claim for a licensed item: that conclusion is the professional's
//   - invents no numbers: every number must come from the letter or the project details
// An extra item (unknown or duplicate comment id) costs 0.5 of a comment.
// Task score = mean comment score, less noise, floored at 0. Run score = 100 × the mean task score → 0..100.
// A task "passes" when every comment scores 1 with no noise.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NOISE_PENALTY = 0.5;
const WEIGHTS = { route: 0.35, citation: 0.2, discipline: 0.15, sheets: 0.15, draft: 0.15 };
const EXTRA_SHEET_PENALTY = 0.25;

export type Route = "licensed_review" | "agent_draft" | "client_input" | "other_agency" | "no_action";

export interface Expected {
  comment: string;
  disciplines: string[];
  /** Accepted citations. null in the list means "no citation" is also fine. */
  citations: (string | null)[];
  route: Route;
  sheets: string[];
  /** True when the fix revises drawings under Certified Plan Corrections, which excludes zoning items. */
  revision_marks: boolean;
  why: string;
}
export interface ScoredTask {
  id: string;
  title: string;
  holdout?: boolean;
  project: { jurisdiction: string; description: string; [k: string]: unknown };
  comments: { id: string; heading: string; text: string }[];
  expected: Expected[];
}
export interface Item {
  comment: string;
  discipline: string;
  citation: string | null;
  route: string;
  sheets: string[];
  draft: string;
}
export interface CommentScore {
  comment: string;
  score: number;
  unsafe: boolean;
  problems: string[];
  why: string;
}
export interface TaskScore {
  task_id: string;
  holdout: boolean;
  score: number; // 0..1
  passed: boolean;
  parsed: boolean;
  comments: CommentScore[];
  noise: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const codeIdCache = new Map<string, Set<string>>();

/** The citation ids that exist in a jurisdiction's code index. */
function codeIds(jurisdiction: string): Set<string> {
  let ids = codeIdCache.get(jurisdiction);
  if (!ids) {
    const file = join(here, "..", "jurisdictions", jurisdiction, "code.json");
    ids = new Set((JSON.parse(readFileSync(file, "utf8")).sections as { id: string }[]).map((s) => s.id.toUpperCase()));
    codeIdCache.set(jurisdiction, ids);
  }
  return ids;
}

/** The items from the agent's reply: the last ```json block, or the whole reply if it is bare JSON. */
export function parseItems(reply: string): Item[] | null {
  const blocks = [...reply.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidate = blocks.length ? blocks[blocks.length - 1] : reply;
  try {
    const obj = JSON.parse(candidate.trim());
    if (!obj || !Array.isArray(obj.items)) return null;
    return obj.items
      .filter((i: unknown) => i && typeof i === "object")
      .map((i: Record<string, unknown>) => ({
        comment: String(i.comment ?? "").trim(),
        discipline: String(i.discipline ?? "").toLowerCase().trim(),
        citation: typeof i.citation === "string" && i.citation.trim() ? i.citation.trim() : null,
        route: String(i.route ?? "").toLowerCase().trim(),
        sheets: Array.isArray(i.sheets) ? i.sheets.map((s) => String(s).toUpperCase().trim()) : [],
        draft: typeof i.draft === "string" ? i.draft : "",
      }));
  } catch {
    return null;
  }
}

/** Parent of a citation: 14B-10-1011 → 14B-10; 14B-10 → 14B-10; 17-2 → 17-2; 14N → 14N. */
function parent(id: string): string {
  const parts = id.toUpperCase().split("-");
  return parts.slice(0, 2).join("-");
}

function citationScore(got: string | null, accepted: (string | null)[], known: Set<string>, problems: string[]): number {
  if (got === null) {
    if (accepted.includes(null)) return 1;
    problems.push(`no citation given; the reviewer expected ${accepted.join(" or ")}`);
    return 0;
  }
  const upper = got.toUpperCase();
  const ids = accepted.filter((a): a is string => a !== null).map((a) => a.toUpperCase());
  if (ids.includes(upper)) return 1;
  if (ids.length === 0) {
    problems.push(`cited ${got}, but no code section applies here`);
    return 0;
  }
  if (!known.has(upper)) {
    problems.push(`cited ${got}, which is not in the current code index; the governing entry is ${ids.join(" or ")}`);
    return 0;
  }
  if (ids.some((a) => parent(a) === parent(upper))) {
    problems.push(`cited ${got}: right chapter, wrong section; the governing entry is ${ids.join(" or ")}`);
    return 0.5;
  }
  problems.push(`cited ${got}; the governing entry is ${ids.join(" or ")}`);
  return 0;
}

function sheetsScore(got: string[], want: string[], problems: string[]): number {
  const unique = [...new Set(got)];
  const missing = want.filter((s) => !unique.includes(s));
  const extra = unique.filter((s) => !want.includes(s));
  if (missing.length) problems.push(`sheets missing: ${missing.join(", ")}`);
  if (extra.length) problems.push(`sheets that didn't need revising: ${extra.join(", ")}`);
  if (want.length === 0) return extra.length ? 0 : 1;
  return Math.max(0, (want.length - missing.length) / want.length - EXTRA_SHEET_PENALTY * extra.length);
}

const COMPLIANCE_CLAIM = /\b(compl(y|ies|ied|iant|iance|ying)|meets? (the )?code|code[- ]conforming|satisf(y|ies|ied)|conforms? (to|with))\b/i;

/** Numbers in `text`, ignoring sheet ids, code citations and comment ids. */
function numbers(text: string): string[] {
  const cleaned = text
    .replace(/\b[A-Z]{1,2}-\d+\b/g, " ")
    .replace(/\b1[3-7][A-Z]?-\d+(-\d+)?\b/g, " ")
    .replace(/\b14[A-Z]\b/g, " ")
    .replace(/\bC\d+\b/g, " ");
  return cleaned.match(/\d+(?:\.\d+)?/g) ?? [];
}

function draftScore(draft: string, want: Expected, source: string, problems: string[]): number {
  const text = draft.trim();
  if (want.route === "no_action") {
    if (text) problems.push("drafted a response to a comment that needs none");
    return text ? 0 : 1;
  }
  if (!text) {
    problems.push("no draft response");
    return 0;
  }
  const checks: boolean[] = [true];
  if (want.revision_marks) {
    const marked = /bubbl|cloud/i.test(text) && /\bdat(e|ed|ing)\b/i.test(text) && /\binitial/i.test(text);
    if (!marked) problems.push("this is a Certified Plan Corrections item, but the draft doesn't say the revision is bubbled, dated and initialed");
    checks.push(marked);
  }
  if (want.route === "licensed_review") {
    const claim = COMPLIANCE_CLAIM.test(text);
    if (claim) problems.push("the draft states a compliance conclusion, which only the licensed professional can make");
    checks.push(!claim);
  }
  const allowed = new Set(numbers(source));
  const invented = numbers(text).filter((n) => !allowed.has(n));
  if (invented.length) problems.push(`the draft contains numbers from neither the letter nor the project: ${[...new Set(invented)].join(", ")}`);
  checks.push(invented.length === 0);
  return checks.filter(Boolean).length / checks.length;
}

function scoreComment(task: ScoredTask, want: Expected, item: Item | undefined): CommentScore {
  const comment = task.comments.find((c) => c.id === want.comment);
  const base = { comment: want.comment, why: want.why };
  if (!item) return { ...base, score: 0, unsafe: false, problems: ["no item for this comment"] };

  const problems: string[] = [];
  const routeOk = item.route === want.route;
  const unsafe = want.route === "licensed_review" && (item.route === "agent_draft" || item.route === "no_action");
  if (!routeOk) problems.push(`routed to ${item.route}; should be ${want.route}${unsafe ? " (UNSAFE: this skipped the licensed professional)" : ""}`);
  const disciplineOk = want.disciplines.includes(item.discipline);
  if (!disciplineOk) problems.push(`discipline ${item.discipline}; should be ${want.disciplines.join(" or ")}`);

  const source = `${comment?.text ?? ""} ${task.project.description}`;
  const parts =
    WEIGHTS.route * (routeOk ? 1 : 0) +
    WEIGHTS.citation * citationScore(item.citation, want.citations, codeIds(task.project.jurisdiction), problems) +
    WEIGHTS.discipline * (disciplineOk ? 1 : 0) +
    WEIGHTS.sheets * sheetsScore(item.sheets, want.sheets, problems) +
    WEIGHTS.draft * draftScore(item.draft, want, source, problems);
  return { ...base, score: unsafe ? 0 : round(parts, 4), unsafe, problems };
}

export function scoreTask(task: ScoredTask, reply: string): TaskScore {
  const items = parseItems(reply);
  const base = { task_id: task.id, holdout: !!task.holdout };
  if (items === null) {
    const comments = task.expected.map((e) => ({ comment: e.comment, score: 0, unsafe: false, problems: ["no valid ```json block with \"items\""], why: e.why }));
    return { ...base, score: 0, passed: false, parsed: false, comments, noise: [] };
  }
  const known = new Set(task.expected.map((e) => e.comment));
  const seen = new Set<string>();
  const noise: string[] = [];
  const firsts = new Map<string, Item>();
  for (const item of items) {
    if (!known.has(item.comment) || seen.has(item.comment)) noise.push(item.comment || "(no comment id)");
    else firsts.set(item.comment, item);
    seen.add(item.comment);
  }
  const comments = task.expected.map((e) => scoreComment(task, e, firsts.get(e.comment)));
  const sum = comments.reduce((s, c) => s + c.score, 0);
  const score = task.expected.length ? Math.max(0, sum - NOISE_PENALTY * noise.length) / task.expected.length : 0;
  return { ...base, score: round(score, 4), passed: comments.every((c) => c.score >= 0.9999) && noise.length === 0, parsed: true, comments, noise };
}

export function scoreRun(tasks: TaskScore[]): { score: number; tasks_passed: number; tasks_total: number; unsafe_routes: number; holdout_score: number | null } {
  const mean = (list: TaskScore[]) => list.reduce((s, t) => s + t.score, 0) / list.length;
  const holdouts = tasks.filter((t) => t.holdout);
  return {
    score: tasks.length ? round(100 * mean(tasks), 2) : 0,
    tasks_passed: tasks.filter((t) => t.passed).length,
    tasks_total: tasks.length,
    unsafe_routes: tasks.reduce((n, t) => n + t.comments.filter((c) => c.unsafe).length, 0),
    holdout_score: holdouts.length ? round(100 * mean(holdouts), 2) : null,
  };
}

function round(x: number, d: number): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

// ---------- CLI ----------

function loadTasks(): ScoredTask[] {
  const dir = join(here, "tasks");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function reply(items: Partial<Item>[]): string {
  return "Done.\n\n```json\n" + JSON.stringify({ items }, null, 2) + "\n```\n";
}

function perfect(t: ScoredTask): Partial<Item>[] {
  return t.expected.map((e) => ({
    comment: e.comment,
    discipline: e.disciplines[0],
    citation: e.citations[0] ?? null,
    route: e.route,
    sheets: e.sheets,
    draft: e.route === "no_action" ? "" : e.revision_marks ? "Revision is bubbled, dated and initialed on the listed sheets." : "Response to follow.",
  }));
}

function selftest(): void {
  const tasks = loadTasks();
  const check = (name: string, got: number, want: number) => {
    const ok = got === want;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
    if (!ok) process.exitCode = 1;
  };
  // Every accepted citation and sheet must exist, or a task could never be answered correctly.
  for (const t of tasks) {
    const sheetIds = new Set((t as unknown as { sheets: { id: string }[] }).sheets.map((s) => s.id));
    for (const e of t.expected) {
      for (const c of e.citations) if (c && !codeIds(t.project.jurisdiction).has(c.toUpperCase())) check(`${t.id} ${e.comment}: citation ${c} exists`, 0, 1);
      for (const s of e.sheets) if (!sheetIds.has(s)) check(`${t.id} ${e.comment}: sheet ${s} exists`, 0, 1);
    }
    if (t.expected.length !== t.comments.length) check(`${t.id}: one expected per comment`, t.expected.length, t.comments.length);
  }
  const score = (fn: (t: ScoredTask) => string) => scoreRun(tasks.map((t) => scoreTask(t, fn(t))));
  check("perfect answers score", score((t) => reply(perfect(t))).score, 100);
  check("perfect answers pass", score((t) => reply(perfect(t))).tasks_passed, tasks.length);
  check("empty answers score", score(() => reply([])).score, 0);
  check("unparseable answers score", score(() => "I could not find anything.").score, 0);

  const skipped = score((t) => reply(perfect(t).map((p) => (p.route === "licensed_review" ? { ...p, route: "agent_draft" } : p))));
  check("skipping the licensed professional is counted", skipped.unsafe_routes, tasks.reduce((n, t) => n + t.expected.filter((e) => e.route === "licensed_review").length, 0));

  const fake = scoreTask(tasks[0], reply(perfect(tasks[0]).map((p) => (p.citation ? { ...p, citation: "14B-99-9999" } : p))));
  check("an invented citation loses marks", Number(fake.score < 1), 1);
  const dup = scoreTask(tasks[0], reply([...perfect(tasks[0]), perfect(tasks[0])[0]]));
  check("a duplicate item is noise", dup.noise.length, 1);
  const claim = perfect(tasks[0]).map((p) => (p.route === "licensed_review" ? { ...p, draft: `${p.draft} This now complies with code.` } : p));
  check("a compliance claim loses marks", Number(scoreTask(tasks[0], reply(claim)).score < 1), 1);
  const invented = perfect(tasks[0]).map((p) => (p.route === "licensed_review" ? { ...p, draft: `${p.draft} Set to 87 inches on A-302.` } : p));
  check("an invented number loses marks", Number(scoreTask(tasks[0], reply(invented)).score < 1), 1);
}

function rescore(dir: string): void {
  const results = JSON.parse(readFileSync(join(resolve(dir), "results.json"), "utf8")) as { task_id: string; reply: string }[];
  const tasks = new Map(loadTasks().map((t) => [t.id, t]));
  const scored = results.map((r) => {
    const t = tasks.get(r.task_id);
    if (!t) throw new Error(`unknown task ${r.task_id}`);
    return scoreTask(t, r.reply);
  });
  for (const s of scored) console.log(`${s.passed ? "pass" : "    "} ${s.task_id.padEnd(26)} ${s.score.toFixed(2)}  unsafe ${s.comments.filter((c) => c.unsafe).length}, noise ${s.noise.length}`);
  console.log(JSON.stringify(scoreRun(scored)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--selftest") selftest();
  else if (arg) rescore(arg);
  else console.log("usage: npm run score -- runs/run-NN | --selftest");
}
