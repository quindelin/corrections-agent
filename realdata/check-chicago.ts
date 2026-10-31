// npm run real:check-chicago
// Scores the current agent on the fictional Chicago letters, to catch a change for one city breaking another.
// It reuses the challenge's letters and scorer, but writes nothing to runs/ and never counts as a challenge run.

import { scoreRun, scoreTask } from "../evals/score.ts";
import { buildManifest, client, exportSession, flag, headSha, loadTasks, option, runTurn, syncAgent, taskPrompt, writeJson } from "../scripts/lib.ts";

const tf = client();
await syncAgent(tf, headSha());
const { data: session } = await tf.sessions.create({ agent: { spec: buildManifest(headSha(), flag("focused") ? { place: "chicago" } : {}) }, metadata: { purpose: "chicago-check" } });
await tf.sessions.update(session.id, { title: `Chicago regression check @ ${headSha().slice(0, 7)}` });

const results = [];
for (const task of loadTasks()) {
  const turn = await runTurn(tf, session.id, taskPrompt(task));
  const scored = scoreTask(task, turn.text);
  results.push(scored);
  console.log(`  ${task.id.padEnd(24)} ${scored.score.toFixed(2)}${task.holdout ? "  holdout" : ""}`);
}
const marksMissing = results.flatMap((r) => r.comments).filter((c) => c.problems.some((p) => p.includes("bubbled, dated and initialed"))).length;
const summary = { ...scoreRun(results), revision_marks_missing: marksMissing, session_id: session.id };
console.log(JSON.stringify(summary));
const out = option("out");
if (out) {
  const exp = await exportSession(tf, session.id);
  const cost_usd = exp.turns.reduce((sum, t) => sum + (("metrics" in t.state ? (t.state.metrics as { totalCostInUsd?: number } | undefined)?.totalCostInUsd : 0) ?? 0), 0);
  writeJson(`${out}/results.json`, results);
  writeJson(`${out}/score.json`, { ...summary, cost_usd });
}
