// npx tsx outreach/tests/e2e.ts --dir <empty scratch dir>
// The whole loop on FICTIONAL TEST DATA, in throwaway homes with their own git repos. It makes a few small model calls.
// Contacts nobody: every recipient uses a reserved .example domain, and the code has no way to send.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { die, option } from "../../scripts/lib.ts";
import { gitIn, type Message, openHome, OUTREACH_DIR, type OutreachEvent, parseVariants, readJsonl, type Suppression } from "../lib.ts";
import { initTestHome, seedOutcomes } from "./fixtures.ts";

const root = option("dir") ?? die("Give --dir, an empty scratch directory.");
const realPlaybookBefore = readFileSync(join(OUTREACH_DIR, "agent", "playbook.md"), "utf8");
const cli = join(OUTREACH_DIR, "cli.ts");
const results: string[] = [];
let failed = 0;

function run(home: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync("npx", ["tsx", cli, ...args, "--home", home], { encoding: "utf8", cwd: join(OUTREACH_DIR, ".."), input: "" });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}
function check(name: string, ok: boolean, detail = ""): void {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n      ${detail.slice(0, 600)}` : ""}`);
  if (!ok) failed += 1;
}

console.log("FICTIONAL TEST DATA. Nobody is contacted.\n");

// ---------- flow: draft, checkpoint, export, outcomes, suppression ----------

const flow = join(root, "flow");
initTestHome(flow, 4);
const h = openHome(flow);
const drafted = run(flow, "draft", "--limit", "4");
console.log(drafted.out);
check("draft ran", drafted.code === 0, drafted.out);
const messages = readJsonl<Message>(h.messages);
const passing = messages.filter((m) => m.gate.status === "pending_review");
check("drafts were written, with a variant each", messages.length === 4 && messages.every((m) => m.variant_id), `${messages.length}`);
check("at least two drafts pass the checks", passing.length >= 2, messages.map((m) => m.gate.issues.map((i) => i.message).join(" ")).join(" | "));
check("variants are balanced among drafts that passed", Math.abs(passing.filter((m) => m.variant_id.startsWith("V1")).length - passing.filter((m) => m.variant_id.startsWith("V2")).length) <= 1, passing.map((m) => m.variant_id).join());
check("no event happens without a person", readJsonl<OutreachEvent>(h.events).length === 0);

const [a, b, c] = passing;
if (a && b) {
  check("export before approval writes nothing", !run(flow, "export").out.includes(".txt"));
  check("logging sent before approval is refused", run(flow, "log", "--id", a.id, "--event", "sent").code !== 0);
  check("approval without a terminal is refused", run(flow, "approve", "--id", a.id).code !== 0);
  check("rejecting without a reason is refused", run(flow, "reject", "--id", b.id).code !== 0);
  check("approval with the test flag works here", run(flow, "approve", "--id", a.id, "--yes-test").code === 0);
  check("reject with a reason works", run(flow, "reject", "--id", b.id, "--reason", "Too long, and the ask comes too late.").code === 0);
  const exported = run(flow, "export");
  check("export writes the approved message only", exported.out.includes(`${a.id}.txt`) && !exported.out.includes(`${b.id}.txt`), exported.out);
  const text = readFileSync(join(h.outbox, `${a.id}.txt`), "utf8");
  check("the exported message is labeled, with sender, address, ad notice and opt-out", text.includes("FICTIONAL TEST DATA") && text.includes("Test Sender (fictional)") && text.includes("100 Example Street") && text.includes("advertisement") && text.includes("unsubscribe"), text);
  check("the exported message has the limits claim", text.includes("no city has reviewed its output"), text);
  check("logging sent works", run(flow, "log", "--id", a.id, "--event", "sent", "--note", "fictional").code === 0);
  check("logging sent twice is refused", run(flow, "log", "--id", a.id, "--event", "sent").code !== 0);
  check("logging a reply works", run(flow, "log", "--id", a.id, "--event", "replied").code === 0);
  check("unsubscribe is logged", run(flow, "log", "--id", a.id, "--event", "unsubscribed").code === 0);
  const suppression = readJsonl<Suppression>(h.suppression);
  check("unsubscribe adds to the suppression list", suppression.some((s) => s.email === a.to_email && s.domain === a.domain));
  const again = run(flow, "status");
  check("the suppressed firm is no longer draftable", /Suppression list: 1/.test(again.out), again.out);
  if (c) {
    run(flow, "suppress", "--domain", c.domain, "--reason", "fictional manual opt-out");
    const blocked = run(flow, "approve", "--id", c.id, "--yes-test");
    check("a suppressed recipient can't be approved", blocked.code !== 0 && blocked.out.includes("suppression"), blocked.out);
  }
  const printed = readFileSync(h.playbook, "utf8");
  check("the flow didn't change the playbook", printed === readFileSync(join(OUTREACH_DIR, "agent", "playbook.md"), "utf8"));
}

// ---------- learn on too little data: refuses, even with a tempting gap and a reviewer note ----------

const thin = join(root, "thin");
initTestHome(thin, 0);
const thinHome = openHome(thin);
seedOutcomes(thinHome, [{ variant: "V1-time-share", sent: 12, replied: 7, positive: 5 }, { variant: "V2-need-real-letters", sent: 12, replied: 1, positive: 0 }]);
const before = parseVariants(readFileSync(thinHome.playbook, "utf8"));
const thinLearn = run(thin, "learn", "--as-of", "2026-10-31");
console.log(thinLearn.out);
check("thin data: learn refuses a winner and reports sample sizes", thinLearn.code === 0 && /insufficient_data/.test(thinLearn.out) && /No winner can be declared/.test(thinLearn.out) && /V1-time-share 12/.test(thinLearn.out), thinLearn.out);
const thinAfter = readFileSync(thinHome.playbook, "utf8");
check("thin data: no variant changed status", JSON.stringify(parseVariants(thinAfter)) === JSON.stringify(before));
check("thin data: Standing is written, marked as test data", /FICTIONAL TEST DATA/.test(thinAfter) && /insufficient_data/.test(thinAfter));
check("thin data: no model call without notes", !existsSync(join(thinHome.data, "learn-sessions")));
check("thin data: the change is an uncommitted diff", gitIn(thin, "status", "--porcelain", "--", "agent/playbook.md") !== "" && gitIn(thin, "log", "--oneline").split("\n").length === 1);

// ---------- thin data with a reviewer note: the model may edit prose, and may not conclude ----------

const noted = join(root, "noted");
initTestHome(noted, 0);
const notedHome = openHome(noted);
const seeded = seedOutcomes(notedHome, [{ variant: "V1-time-share", sent: 12, replied: 7, positive: 5 }, { variant: "V2-need-real-letters", sent: 12, replied: 1, positive: 0 }]);
run(noted, "log", "--id", seeded.messages[8].id, "--event", "replied", "--note", "Fictional reply: the email was too long to read on a phone, and the ask should come first.");
const notedLearn = run(noted, "learn", "--as-of", "2026-10-31");
console.log(notedLearn.out);
const notedAfter = readFileSync(notedHome.playbook, "utf8");
check("thin data with a note: the rewrite passes validation", notedLearn.code === 0, notedLearn.out);
check("thin data with a note: the verdict is still no winner", /insufficient_data/.test(notedLearn.out), notedLearn.out);
check("thin data with a note: the prose changed", gitIn(noted, "diff", "--stat", "--", "agent/playbook.md") !== "", notedLearn.out);
check("thin data with a note: no variant changed status", parseVariants(notedAfter).filter((v) => v.status === "active").map((v) => v.id).join() === "V1-time-share,V2-need-real-letters");

// ---------- learn on enough data: the code declares a winner, and the commit is reviewable ----------

const big = join(root, "big");
initTestHome(big, 0);
const bigHome = openHome(big);
seedOutcomes(bigHome, [{ variant: "V1-time-share", sent: 60, replied: 24, positive: 16 }, { variant: "V2-need-real-letters", sent: 60, replied: 9, positive: 2 }]);
const bigLearn = run(big, "learn", "--as-of", "2026-10-31", "--commit");
console.log(bigLearn.out);
check("enough data: a winner is declared", /Verdict: winner/.test(bigLearn.out) && /V1-time-share beat/.test(bigLearn.out), bigLearn.out);
if (bigLearn.code === 0) {
  const vs = parseVariants(readFileSync(bigHome.playbook, "utf8"));
  check("enough data: the loser is retired by code", vs.find((v) => v.id === "V2-need-real-letters")?.status === "retired");
  check("enough data: the winner stays active", vs.find((v) => v.id === "V1-time-share")?.status === "active");
  const show = gitIn(big, "show", "--stat", "--format=%B");
  console.log(show);
  check("enough data: the commit has the session trailer and is labeled as test data", /Agent-Session: /.test(show) && /FICTIONAL TEST DATA/.test(show), show);
  check("enough data: the commit touches only the playbook and the report", /agent\/playbook\.md/.test(show) && /reports\/learn-01\.md/.test(show) && !/data\//.test(show), show);
  check("enough data: frozen variant text is unchanged", gitIn(big, "show", "HEAD:agent/playbook.md").includes("Open by saying you need real correction letters"));
} else {
  check("enough data: rewrite validated", false, bigLearn.out);
}

// ---------- a stop signal, on little data ----------

const stop = join(root, "stop");
initTestHome(stop, 2);
seedOutcomes(openHome(stop), [{ variant: "V1-time-share", sent: 20, bounced: 4 }], "2026-10-01T15:00:00.000Z");
const stopped = run(stop, "draft");
check("a high bounce rate stops drafting until a person looks", stopped.code !== 0 && /paused/.test(stopped.out), stopped.out);
run(stop, "resume", "--reason", "fictional: cleaned the list");
check("resume lifts the pause", !/PAUSED/.test(run(stop, "status").out));

// ---------- the walls ----------

check("the real playbook is untouched by all of this", readFileSync(join(OUTREACH_DIR, "agent", "playbook.md"), "utf8") === realPlaybookBefore && !readdirSync(OUTREACH_DIR).includes("reports"));
const spendRows = [flow, thin, noted, big, stop].flatMap((d) => readJsonl<{ usd: number }>(openHome(d).spend));
const usd = spendRows.reduce((x, r) => x + r.usd, 0);

console.log("\n" + results.join("\n"));
console.log(`\n${results.length - failed} passed, ${failed} failed. Estimated model spend: $${usd.toFixed(4)}.`);
process.exit(failed ? 1 : 0);
