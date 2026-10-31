// npm run real:check-chicago
// Scores the current agent on the fictional Chicago letters, to catch a change for one city breaking another.
// It reuses the challenge's letters and scorer, but writes nothing to runs/ and never counts as a challenge run.

import { scoreRun, scoreTask } from "../evals/score.ts";
import { buildManifest, client, headSha, loadTasks, runTurn, syncAgent, taskPrompt } from "../scripts/lib.ts";

const tf = client();
await syncAgent(tf, headSha());
const { data: session } = await tf.sessions.create({ agent: { spec: buildManifest(headSha()) }, metadata: { purpose: "chicago-check" } });
await tf.sessions.update(session.id, { title: `Chicago regression check @ ${headSha().slice(0, 7)}` });

const results = [];
for (const task of loadTasks()) {
  const turn = await runTurn(tf, session.id, taskPrompt(task));
  const scored = scoreTask(task, turn.text);
  results.push(scored);
  console.log(`  ${task.id.padEnd(24)} ${scored.score.toFixed(2)}${task.holdout ? "  holdout" : ""}`);
}
const marksMissing = results.flatMap((r) => r.comments).filter((c) => c.problems.some((p) => p.includes("bubbled, dated and initialed"))).length;
console.log(JSON.stringify({ ...scoreRun(results), revision_marks_missing: marksMissing, session_id: session.id }));
