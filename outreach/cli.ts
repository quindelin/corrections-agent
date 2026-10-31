// npx tsx outreach/cli.ts <command> [--home <dir>]. Commands are listed in usage() below, and outreach/README.md explains them.

import { client, die, flag, option } from "../scripts/lib.ts";
import { quota, validateSender } from "./compliance.ts";
import { learn } from "./learn.ts";
import { loadSender, now, openHome, parseVariants, totalSpend } from "./lib.ts";
import { approve, draft, draftable, exportOutbox, loadAll, logOutcome, reject, resume, review, reviewProspect, suppress } from "./messages.ts";
import { buildCandidates, research } from "./research.ts";
import { computeVerdict, messageState } from "./stats.ts";
import { readFileSync } from "node:fs";
import { initTestHome } from "./tests/fixtures.ts";

function usage(): never {
  die(`Usage: npx tsx outreach/cli.ts <command>

Research
  candidates [--since YYYY-MM-DD] [--top N]    who files small residential permits, from City data
  research [--limit N] [--seeds file]          read seeded websites and build the prospect list
  review-prospect --id P --decision ready|exclude --reason "..."

Draft and review. Nothing here sends anything.
  draft [--limit N]                            write drafts for ready prospects
  review                                       read every draft with its sources
  approve --id M                               you, at a terminal, approve the exact text
  reject --id M --reason "..."
  export                                       write approved messages to data/outbox/ for you to send

After you send
  log --id M --event sent|replied|positive|bounced|unsubscribed [--note "..."] [--at DATE]
  suppress --email X | --domain X --reason "..."
  resume --reason "..."                        lift a guardrail pause after looking into it

Learn
  learn [--commit]                             rewrite the playbook. Reports sample sizes and refuses thin data.

Status
  status                                       what's waiting, limits, suppression, verdict, spend
  spend                                        estimated cost of every session on this TrueForge server

Testing
  init-test --dir DIR                          make a scratch home of clearly fictional data`);
}

function status(): void {
  const h = openHome();
  const s = loadAll(h);
  const at = now();
  const states = s.messages.map((m) => ({ m, st: messageState(m.id, s.events) }));
  const q = quota(s.policy, s.messages, s.events, at);
  console.log(`Home: ${h.dir} (dataset: ${h.dataset}${h.dataset === "test" ? ", FICTIONAL" : ""})`);
  const count = (p: string) => s.prospects.filter((x) => x.status === p).length;
  console.log(`Prospects: ${s.prospects.length} (ready ${count("ready")}, needs review ${count("needs_review")}, no contact ${count("no_contact")}, blocked ${count("blocked")}, excluded ${count("excluded")}). Draftable now: ${draftable(h, s, at).length}.`);
  console.log(`Messages: ${states.filter(({ m, st }) => !st.approved && !st.rejected && m.gate.status === "pending_review").length} waiting for review, ${states.filter(({ m }) => m.gate.status === "blocked").length} blocked by checks, ${states.filter(({ st }) => st.rejected).length} rejected, ${states.filter(({ st }) => st.approved && !st.sent_at).length} approved and unsent, ${states.filter(({ st }) => st.sent_at).length} sent.`);
  console.log(`Contact limits: ${q.today}/${s.policy.contact_limits.max_per_day} today, ${q.week}/${s.policy.contact_limits.max_per_week} in 7 days. ${q.remaining} more allowed now.`);
  console.log(`Suppression list: ${s.suppression.length} entries.`);
  const unverified = s.claims.filter((c) => !c.verified_by_human);
  if (unverified.length) console.log(`Claims nobody has verified yet (approval is blocked in a real home): ${unverified.map((c) => c.id).join(", ")}`);
  for (const i of validateSender(loadSender(h), h.dataset)) console.log(`Sender: ${i.message}`);
  const v = computeVerdict(s.messages, s.events, parseVariants(readFileSync(h.playbook, "utf8")), s.policy, at);
  console.log(`Verdict: ${v.status}. ${v.reason}`);
  if (v.paused) console.log(`PAUSED: ${v.paused.reason}`);
  console.log(`Estimated model spend in this home: $${totalSpend(h).toFixed(4)}.`);
}

/** TrueForge's own estimate for every session on the server, evals included. It's not the gateway's invoice. */
async function spend(): Promise<void> {
  const tf = client();
  const byPurpose = new Map<string, { sessions: number; usd: number; tokens: number }>();
  let sessions = 0;
  for await (const session of await tf.sessions.list()) {
    sessions += 1;
    const purpose = String((session.metadata as Record<string, unknown> | undefined)?.purpose ?? "other");
    const row = byPurpose.get(purpose) ?? { sessions: 0, usd: 0, tokens: 0 };
    row.sessions += 1;
    for await (const t of await tf.sessions.listTurns(session.id)) {
      const metrics = "metrics" in t.state ? t.state.metrics : undefined;
      row.usd += metrics?.totalCostInUsd ?? 0;
      row.tokens += metrics?.totalTokens ?? 0;
    }
    byPurpose.set(purpose, row);
    if (sessions >= Number(option("max-sessions") ?? 500)) break;
  }
  let total = 0;
  for (const [purpose, r] of [...byPurpose].sort()) {
    console.log(`${purpose.padEnd(22)} ${String(r.sessions).padStart(4)} sessions  ${String(r.tokens).padStart(9)} tokens  ~$${r.usd.toFixed(4)}`);
    total += r.usd;
  }
  console.log(`${"total".padEnd(22)} ${String(sessions).padStart(4)} sessions  ${"".padStart(16)}~$${total.toFixed(4)}  (TrueForge's estimate, not the gateway's invoice)`);
}

const command = process.argv[2];
if (!command || flag("help")) usage();

switch (command) {
  case "candidates":
    await buildCandidates(openHome());
    break;
  case "research":
    await research(openHome());
    break;
  case "review-prospect":
    reviewProspect(openHome());
    break;
  case "draft":
    await draft(openHome());
    break;
  case "review":
    review(openHome());
    break;
  case "approve":
    await approve(openHome());
    break;
  case "reject":
    reject(openHome());
    break;
  case "export":
    exportOutbox(openHome());
    break;
  case "log":
    logOutcome(openHome());
    break;
  case "suppress":
    suppress(openHome());
    break;
  case "resume":
    resume(openHome());
    break;
  case "learn":
    await learn(openHome());
    break;
  case "status":
    status();
    break;
  case "spend":
    await spend();
    break;
  case "init-test":
    initTestHome(option("dir") ?? die("Give --dir, a scratch directory outside your real data."));
    break;
  default:
    usage();
}
