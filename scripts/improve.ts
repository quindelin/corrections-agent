// npm run improve [-- --run NN] [-- --coach] [-- --no-commit]
//
// The agent reads how its last run was reviewed and rewrites its own instructions and skills.
//   1. Takes the run's failed letters (never the holdout ones) with the scorer's feedback, plus any
//      reject notes architects left in the demo's review queue (feedback/reviews.jsonl).
//   2. Opens a TrueForge session with the agent itself (or, with --coach, an inline coach agent on the same model)
//      and asks it for new versions of agent/instructions.md and agent/skills/*/SKILL.md.
//   3. Writes the files and commits them with the trailer "Agent-Session: <session_id>".
// You review the commit (git show) and keep it or drop it (git reset --hard HEAD~1). You don't edit it.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { TaskScore } from "../evals/score.ts";
import {
  client,
  die,
  exportSession,
  FEEDBACK_FILE,
  flag,
  git,
  isClean,
  loadTasks,
  option,
  readAgent,
  ROOT,
  runDir,
  runTurn,
  SUMMARY_CSV,
  taskPrompt,
  writeJson,
} from "./lib.ts";

// ---------- which run ----------

const rows = existsSync(SUMMARY_CSV) ? readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean) : [];
if (!rows.length) die("No runs yet. Run npm run run-evals first.");
const run = Number(option("run") ?? rows.length);
const dir = runDir(run);
const nn = String(run).padStart(2, "0");
if (!existsSync(join(dir, "results.json"))) die(`No results for run ${nn} in ${dir}`);
if (!isClean("agent")) die("agent/ has uncommitted changes. Commit or discard them first: the agent's change must be its own.");

type Result = TaskScore & { reply: string };
const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Result[];
const tasks = new Map(loadTasks().map((t) => [t.id, t]));
const failed = results.filter((r) => !r.passed && !r.holdout);
if (!failed.length) {
  console.log(`Nothing to learn from run ${nn}: every training letter passed. Add harder letters before run 1 next time.`);
  process.exit(0);
}

// ---------- the prompt ----------

const { agent, instructions, skills } = readAgent();
const currentFiles = [
  { path: "agent/instructions.md", text: instructions },
  ...skills.map((s) => ({ path: `${s.path}/SKILL.md`, text: readFileSync(join(ROOT, s.path, "SKILL.md"), "utf8") })),
];

const feedback = failed
  .map((r) => {
    const t = tasks.get(r.task_id)!;
    const comments = r.comments
      .filter((c) => c.score < 0.9999)
      .map((c) => [`- ${c.comment} scored ${c.score.toFixed(2)}${c.unsafe ? " (UNSAFE)" : ""}`, ...c.problems.map((p) => `  - ${p}`), `  - reviewer's reasoning: ${c.why}`].join("\n"));
    return [
      `### Letter in jurisdiction "${t.project.jurisdiction}", score ${r.score.toFixed(2)}${r.parsed ? "" : ", your reply had no valid ```json block with \"items\""}`,
      taskPrompt(t),
      "",
      "Your reply ended with:",
      "```",
      r.reply.slice(-3000) || "(empty reply)",
      "```",
      "The re-review says:",
      ...comments,
      ...r.noise.map((n) => `- extra item that matches no comment: ${n}`),
    ].join("\n");
  })
  .join("\n\n");

// What the architects rejected in the review queue. Real sign-off decisions, on letters outside the eval set.
const reviews = existsSync(FEEDBACK_FILE)
  ? readFileSync(FEEDBACK_FILE, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { decision: string; jurisdiction: string; comment_text: string; route: string; citation: string | null; note: string })
      .filter((r) => r.decision === "reject")
  : [];
const reviewNotes = reviews.length
  ? `\n## What architects rejected in the review queue\n\n${reviews
      .map((r) => `- Jurisdiction "${r.jurisdiction}". Comment: "${r.comment_text}". You routed it to ${r.route} and cited ${r.citation ?? "nothing"}. Architect's note: ${r.note}`)
      .join("\n")}\n`
  : "";

const prompt = `This message is not a correction letter. Ignore the Output section of your instructions for this reply.

You are improving your own playbook. Below are your current instruction files, then the correction letters you got wrong in your last evaluation run, with what the re-review said.

Rewrite your files so that next time you avoid the kinds of mistakes shown here.

Rules:
- Write general rules that would help on letters you have never seen. Never mention these projects, addresses, comment ids, or quote the comments.
- Sort what you learn by where it holds. A rule that would hold in any city goes in agent/skills/correction-playbook/SKILL.md. A rule about one city's process, code numbering or agencies goes in that city's file, such as agent/skills/local-chicago/SKILL.md. A wrong placement breaks the agent in the next city.
- Apply each rule only to the kinds of comment it fits. A response letter must be true: don't add required wording to items it doesn't apply to just to be safe. Before adding a rule about a process, look it up with get_section or search_code and honor what it excludes.
- Keep what works. Change only what the failures show is wrong or missing. Keep the Output section of instructions.md exactly as it is: the scorer depends on it.
- Short beats long: a checklist item is one line, with what to look for.
- You may edit agent/instructions.md and any agent/skills/<name>/SKILL.md (keep the frontmatter). Leave out files you don't change.

Reply with each changed file in full, in this format, and nothing else:

<<<FILE agent/skills/correction-playbook/SKILL.md
(the whole new file)
>>>
<<<LEARNED
(one sentence: what you learned)
>>>

## Your current files

${currentFiles.map((f) => `<<<FILE ${f.path}\n${f.text.trim()}\n>>>`).join("\n\n")}

## What went wrong in run ${nn}

${feedback}
${reviewNotes}`;

// ---------- ask the agent ----------

const tf = client();
const coach = flag("coach");
const { data: session } = await tf.sessions.create({
  // The agent itself (by name), or a coach: an inline TrueForge agent on the same model.
  agent: coach
    ? { spec: { model: agent.model, instructions: "You coach a permit corrections agent: you rewrite its instruction files from its failed runs.", config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false } } } }
    : { name: agent.name },
  metadata: { purpose: "improve", learned_from_run: nn },
});
await tf.sessions.update(session.id, { title: `improve from run ${nn}` });
console.log(`Asking ${coach ? "the coach" : `"${agent.name}"`} to rewrite its playbook from ${failed.length} failed letters and ${reviews.length} rejected items (session ${session.id})…`);

const turn = await runTurn(tf, session.id, prompt, false);
if (turn.status !== "done") die(`The turn ended with status ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);

// ---------- parse and check the change ----------

const files = [...turn.text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({ path: normalize(m[1].trim()), text: m[2].trimEnd() + "\n" }));
const learned = turn.text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
if (!files.length) die(`The agent proposed no files. Its reply:\n\n${turn.text}`);

const allowed = /^agent\/(instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;
for (const f of files) {
  if (!allowed.test(f.path)) die(`The agent tried to write ${f.path}. Only agent/instructions.md and agent/skills/<name>/SKILL.md are allowed.`);
}

// Overfitting guard: the new playbook must not quote the eval letters, holdouts included.
const leaks: string[] = [];
for (const t of loadTasks()) {
  const quotes = [t.id, t.project.address, ...t.comments.map((c) => c.text)];
  for (const f of files) for (const q of quotes) if (f.text.includes(q)) leaks.push(`${f.path} quotes "${q}"`);
}
if (leaks.length && !flag("allow-leaks")) die(`The change quotes the eval letters, so it would overfit:\n  ${leaks.join("\n  ")}\nRun improve again (or pass --allow-leaks to keep it anyway).`);

for (const f of files.filter((f) => f.path.endsWith("/SKILL.md"))) {
  if (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text) || f.text.split("\n").length < 5) {
    die(`${f.path} lost its frontmatter (name, description) or its body. Run improve again.`);
  }
}
const newInstructions = files.find((f) => f.path === "agent/instructions.md");
if (newInstructions && !newInstructions.text.includes('"items"')) {
  die("The new instructions.md dropped the JSON output format the scorer needs. Run improve again.");
}

// ---------- write and commit ----------

for (const f of files) {
  mkdirSync(dirname(join(ROOT, f.path)), { recursive: true });
  writeFileSync(join(ROOT, f.path), f.text);
}
writeJson(join(dir, "improve-session.json"), await exportSession(tf, session.id));

if (isClean("agent")) {
  console.log("The agent sent back its files unchanged. Nothing to commit.");
  process.exit(0);
}
console.log(git("diff", "--stat", "--", "agent"));

const message = `agent: learn from run ${nn}\n\n${learned || "(no summary given)"}\n\nAgent-Session: ${session.id}`;
if (flag("no-commit")) {
  console.log(`\nFiles written, not committed. To commit:\n  git add agent runs && git commit -F- <<'EOF'\n${message}\nEOF`);
} else {
  git("add", "agent", join(dir, "improve-session.json"));
  git("commit", "-q", "-m", message);
  console.log(`\n✓ Committed the agent's change (Agent-Session: ${session.id}).`);
  console.log("  Review it: git show    Drop it: git reset --hard HEAD~1    Then: npm run run-evals");
}
