// npm run demo
// The review workbench: run the agent on a correction letter, sign off each item, assemble the response.
// Each analysis is a TrueForge session. Reject notes go to feedback/reviews.jsonl, and npm run improve learns from them.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseItems } from "../evals/score.ts";
import { client, exportSession, FEEDBACK_FILE, headSha, readAgent, ROOT, runTurn, SUMMARY_CSV, syncAgent, taskPrompt, type Task } from "../scripts/lib.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT ?? 8792);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const letter = readJson(join(here, "letter.json")) as Pick<Task, "project" | "sheets" | "comments">;
const packDir = join(ROOT, "jurisdictions", letter.project.jurisdiction);

function runs() {
  if (!existsSync(SUMMARY_CSV)) return [];
  const [header, ...rows] = readFileSync(SUMMARY_CSV, "utf8").trim().split("\n");
  const keys = header.split(",");
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
}

async function analyze() {
  const tf = client();
  await syncAgent(tf, headSha());
  const { data: session } = await tf.sessions.create({ agent: { name: readAgent().agent.name }, metadata: { purpose: "demo" } });
  await tf.sessions.update(session.id, { title: `review: ${letter.project.address}` });
  const turn = await runTurn(tf, session.id, taskPrompt(letter), false);
  if (turn.status !== "done") throw new Error(turn.error ?? `The turn ended with status ${turn.status}`);
  const items = parseItems(turn.text);
  if (!items) throw new Error("The agent's reply had no valid JSON block.");
  const exp = await exportSession(tf, session.id);
  // The audit trail: every tool call the agent made in this session, as TrueForge recorded it.
  const trace = exp.turns.flatMap((t) =>
    t.events.flatMap((e) => (e.type === "model.message" ? (e.toolCalls ?? []).map((c) => ({ name: c.function.name, args: c.function.arguments })) : [])),
  );
  return { session_id: session.id, items, trace };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || "{}");
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(join(here, "index.html")));
    }
    if (req.method === "GET" && req.url === "/api/bootstrap") {
      return send(res, 200, {
        letter,
        profile: readJson(join(packDir, "profile.json")),
        code: readJson(join(packDir, "code.json")).sections,
        stats: readJson(join(packDir, "permit-stats.json")),
        runs: runs(),
      });
    }
    if (req.method === "POST" && req.url === "/api/analyze") return send(res, 200, await analyze());
    if (req.method === "POST" && req.url === "/api/review") {
      const b = await body(req);
      const comment = letter.comments.find((c) => c.id === b.comment);
      if (!comment || (b.decision !== "approve" && b.decision !== "reject")) return send(res, 400, { error: "Unknown comment or decision." });
      mkdirSync(dirname(FEEDBACK_FILE), { recursive: true });
      appendFileSync(
        FEEDBACK_FILE,
        JSON.stringify({ at: new Date().toISOString(), jurisdiction: letter.project.jurisdiction, comment: comment.id, comment_text: comment.text, decision: b.decision, route: b.route, citation: b.citation ?? null, note: b.note ?? "", session_id: b.session_id }) + "\n",
      );
      return send(res, 200, { ok: true });
    }
    res.writeHead(404).end();
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Redline demo on http://localhost:${PORT}`));
