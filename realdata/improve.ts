// npm run real:improve [-- --run NN-arm] [-- --no-commit]
//
// The agent learns from what real reviewers wrote: it reads where its answers on real letters differed from
// the city's labels, and rewrites its own skills. Holdout letters are never shown to it.
// Checks the change, writes it, and commits it with "Agent-Session: <id>". You review it; you don't edit it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { client, die, exportSession, flag, git, isClean, option, readAgent, ROOT, runTurn, writeJson } from "../scripts/lib.ts";
import type { LetterScore, RealLetter } from "./score.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REAL_RUNS = join(ROOT, "runs-real");
const names = readdirSync(REAL_RUNS).filter((n) => /^\d+-/.test(n)).sort();
const name = option("run") ?? names[names.length - 1];
if (!name || !existsSync(join(REAL_RUNS, name, "results.json"))) die("No real run to learn from. Run npm run real:run first.");
if (!isClean("agent")) die("agent/ has uncommitted changes. Commit or discard them first: the agent's change must be its own.");

const results = JSON.parse(readFileSync(join(REAL_RUNS, name, "results.json"), "utf8")) as (LetterScore & { reply: string })[];
const letters = new Map((JSON.parse(readFileSync(join(here, "seattle", "letters.json"), "utf8")) as { letters: RealLetter[] }).letters.map((l) => [l.id, l]));
const train = results.filter((r) => !r.holdout);

const { agent, instructions, skills } = readAgent();
const files = [
  { path: "agent/instructions.md", text: instructions },
  ...skills.map((s) => ({ path: `${s.path}/SKILL.md`, text: readFileSync(join(ROOT, s.path, "SKILL.md"), "utf8") })),
];

// The mistakes, worst comments first, capped so the prompt stays affordable.
const mistakes = train
  .flatMap((r) => r.comments.filter((c) => c.problems.length).map((c) => ({ c, letter: letters.get(r.letter_id)! })))
  .sort((a, b) => (a.c.score ?? 1) - (b.c.score ?? 1))
  .slice(0, 45)
  .map(({ c, letter }) => {
    const text = letter.comments.find((x) => x.id === c.comment)?.text ?? "";
    return `- Project: ${letter.project.description.slice(0, 120)}\n  Comment: ${text.slice(0, 400)}\n  Your answer: discipline ${c.got.discipline}, citation ${c.got.citation}, route ${c.got.route}\n  ${c.problems.join("\n  ")}`;
  })
  .join("\n");

const prompt = `This message is not a correction letter. Ignore the Output section of your instructions for this reply.

You are improving your own playbook from real results. Below are your current files, then comments from real Seattle correction letters where your answer differed from what the city's own records show. Discipline and citation labels come from the city. Route labels are a simple rule on the city's subject lines, so treat them as weaker evidence.

Rewrite your files so you make fewer of these kinds of mistakes on letters you have never seen.

Rules:
- Write rules that generalize. Never quote these comments or name these projects or addresses.
- Sort what you learn by where it holds. Rules that would hold in any city go in agent/skills/correction-playbook/SKILL.md, and that file must not name any city, agency, local program or code title. Rules about one place go in that place's file: agent/skills/local-chicago/SKILL.md or agent/skills/local-seattle/SKILL.md. If the shared playbook already contains a rule about one place, move it to that place's file.
- A response letter must be true: don't add required wording to items it doesn't apply to, and look up a process with get_section or search_code before writing a rule about it.
- Keep what works. Keep the Output section of instructions.md exactly as it is.
- Short beats long: a checklist item is one line.
- You may edit agent/instructions.md and any agent/skills/<name>/SKILL.md (keep the frontmatter). Leave out files you don't change.

Reply with each changed file in full, in this format, and nothing else:

<<<FILE agent/skills/correction-playbook/SKILL.md
(the whole new file)
>>>
<<<LEARNED
(one sentence: what you learned)
>>>

## Your current files

${files.map((f) => `<<<FILE ${f.path}\n${f.text.trim()}\n>>>`).join("\n\n")}

## Where you differed from the record (run ${name})

${mistakes}
`;

const tf = client();
const { data: session } = await tf.sessions.create({ agent: { name: agent.name }, metadata: { purpose: "real-improve", learned_from: name } });
await tf.sessions.update(session.id, { title: `improve from real letters ${name}` });
console.log(`Asking "${agent.name}" to learn from real letters in ${name} (session ${session.id})…`);
const turn = await runTurn(tf, session.id, prompt, false);
if (turn.status !== "done") die(`The turn ended with status ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);

const proposed = [...turn.text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({ path: normalize(m[1].trim()), text: m[2].trimEnd() + "\n" }));
const learned = turn.text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
if (!proposed.length) die(`The agent proposed no files. Its reply:\n\n${turn.text.slice(0, 2000)}`);

const allowed = /^agent\/(instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;
const problems: string[] = [];
for (const f of proposed) {
  if (!allowed.test(f.path)) problems.push(`it tried to write ${f.path}`);
  if (f.path.endsWith("/SKILL.md") && !/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text)) problems.push(`${f.path} lost its frontmatter`);
  if (f.path === "agent/instructions.md" && !f.text.includes('"items"')) problems.push("instructions.md dropped the output format");
  // Enforced because the agent ignored this rule when it was only in the prompt.
  if (f.path.endsWith("correction-playbook/SKILL.md")) {
    const local = f.text.match(/Chicago|Seattle|SDCI|Department of Buildings|Certified Plan|Zoning Board|\bSMC\b|\bSBC\b|\bSRC\b|\bSEC\b|\b14[A-Z]-|\bbubbl/gi);
    if (local) problems.push(`the shared playbook names local terms: ${[...new Set(local)].join(", ")}`);
  }
  // Overfitting guard: no eight-word run copied from a real letter.
  for (const l of letters.values()) {
    for (const c of l.comments) {
      const words = c.text.split(" ");
      for (let i = 0; i + 8 <= words.length; i += 4) {
        if (f.text.includes(words.slice(i, i + 8).join(" "))) problems.push(`${f.path} quotes a letter: "${words.slice(i, i + 8).join(" ")}"`);
      }
    }
  }
}
if (problems.length) die(`The change didn't pass its checks. Run real:improve again.\n  ${[...new Set(problems)].join("\n  ")}`);

for (const f of proposed) {
  mkdirSync(dirname(join(ROOT, f.path)), { recursive: true });
  writeFileSync(join(ROOT, f.path), f.text);
}
writeJson(join(REAL_RUNS, name, "improve-session.json"), await exportSession(tf, session.id));
if (isClean("agent")) {
  console.log("The agent sent back its files unchanged. Nothing to commit.");
  process.exit(0);
}
console.log(git("diff", "--stat", "--", "agent"));
const message = `agent: learn from real letters ${name}\n\n${learned || "(no summary given)"}\n\nAgent-Session: ${session.id}`;
if (flag("no-commit")) {
  console.log(`\nFiles written, not committed.\n${message}`);
} else {
  git("add", "agent", join(REAL_RUNS, name, "improve-session.json"));
  git("commit", "-q", "-m", message);
  console.log(`\n✓ Committed the agent's change (Agent-Session: ${session.id}).`);
}
