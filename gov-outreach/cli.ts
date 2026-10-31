// npx tsx gov-outreach/cli.ts <command> [--home <dir>]. Commands are listed in usage() below, and gov-outreach/README.md explains them.
// There is no send command. Nothing in this folder can send, submit or file anything.

import { join } from "node:path";
import { client, die, option } from "../scripts/lib.ts";
import { approve, confirmContact, draft, exportOutbox, loadEvents, loadRequests, reject, review, writeReviewDrafts } from "./draft.ts";
import { intake } from "./intake.ts";
import { deadlines } from "./law.ts";
import { currentRows, currentVerdicts, learn, spotcheck } from "./learn.ts";
import { GOV_DIR, gitIn, lawById, loadLaws, loadPolicy, loadTargets, now, openHome, totalSpend } from "./lib.ts";
import { metricsText } from "./stats.ts";
import { initTestHome } from "./tests/fixtures.ts";
import { dueReport, followup, logOutcome, stateOf } from "./track.ts";

function usage(): never {
  die(`Usage: npx tsx gov-outreach/cli.ts <command>

Who and what
  targets                                      agencies, what they hold, contact and evidence, status
  laws                                         each law, how it was checked, and its clocks

Draft and review. Nothing here sends anything.
  draft [--target ID] [--ask KEY] [--no-model] [--include-hold]    write draft requests
  write-drafts [--out DIR]                     review copies, with brackets, into drafts/
  review                                       read every draft with its checks and lawyer flags
  confirm-contact --target ID --value "..." --source URL           you confirm a contact you read yourself
  approve --id R                               you, at a terminal, approve the exact text
  reject --id R --reason "..."
  export                                       write approved requests to data/outbox/ for you to send

After you send
  log --id R --event sent --date YYYY-MM-DD --channel portal|email|mail|form
  log --id R --event acknowledged|estimate|extension|classified|clarification_requested|clarification_answered|
      fee_quote|fee_response|narrowed|partial_grant|records_received|denial|no_records|appeal_filed|appeal_decided|withdrawn|closed
      [--on YYYY-MM-DD] [--due YYYY-MM-DD] [--amount N] [--count N] [--exemption "..."] [--final true|false] [--as commercial|noncommercial] [--outcome "..."] [--note "..."]
  due                                          what's due or overdue, and appeal windows
  followup --id R --kind status|overdue|narrowing|appeal           a draft for you to review

When records arrive. Everything stays in the gitignored data folder.
  intake add --id R --file PATH --received DATE --conditions "..." [--doc-date DATE] [--may-test yes|no|unknown] [--review-type X] [--permit X] [--comment-column NAME]
  intake check --letter L
  intake resolve --letter L --strip "text" | --keep "text" | --read-all-keep-rest
  intake build [--description "..."]           build test letters, and count what's usable
  intake status

Learn
  metrics                                      usable records per request, and what can't be concluded yet
  learn [--commit]                             propose playbook changes, as a git diff
  spotcheck                                    read new rules against the raw evidence
  spotcheck --rule ID --verdict true|false|unclear --note "..."

Status
  status                                       counts, spend and repo check
  check-repo                                   confirm no records are tracked by git

Testing
  init-test --dir DIR                          make a scratch home of clearly fictional data`);
}

const h = () => openHome();

function targets(): void {
  const home = h();
  const laws = loadLaws(home);
  for (const t of loadTargets(home).targets) {
    console.log(`\n${t.id}  [${t.status}]  ${t.agency}\n  Holds: ${t.holds}\n  Why: ${t.why}\n  Law: ${lawById(laws, t.law_id).name} (${lawById(laws, t.law_id).verification})\n  Contact: ${t.contact.channel}: ${t.contact.value ?? "unknown"} (${t.contact.evidence}; ${t.contact.source_url}; ${t.contact.checked})`);
    for (const a of t.access) console.log(`  Access: ${a.host}: ${a.rule}. ${a.finding}`);
    if (t.hold_reason) console.log(`  Hold: ${t.hold_reason}`);
    console.log(`  Asks: ${t.asks.map((a) => a.key).join(", ")}`);
  }
}

function laws(): void {
  const file = loadLaws(h());
  const today = now().toISOString().slice(0, 10);
  for (const l of file.laws) {
    console.log(`\n${l.name} (${l.citation})\n  Checked: ${l.verification}. ${l.verification_note}\n  Commercial purpose: ${l.commercial.disclosure}. ${l.commercial.basis}`);
    for (const r of l.rules) {
      const d = deadlines(l, r.classes[0], r.applies_from > today ? r.applies_from : today, 10);
      console.log(`  Rule ${r.id} (${r.classes.join("/")}, from ${r.applies_from}${r.applies_until ? ` to ${r.applies_until}` : ""}): ${r.first_response.label} [${r.first_response.cite}]. If received ${r.applies_from > today ? r.applies_from : today}: ${d.first_due ?? "no fixed date"}.`);
      for (const a of r.appeals) console.log(`    Appeal: ${a.forum}. Window: ${a.window_days ? `${a.window_days} ${a.window_unit} days` : "none found"}.`);
    }
  }
}

function metrics(): void {
  const home = h();
  const today = now().toISOString().slice(0, 10);
  const rows = currentRows(home, today);
  console.log(`Dataset: ${home.dataset}${home.dataset === "test" ? " (FICTIONAL)" : ""}. As of ${today}.\n`);
  console.log(metricsText(rows, currentVerdicts(home, rows)));
}

/** No records in git. This repo is public, so this fails loudly if anything under data/ is tracked. */
function checkRepo(): void {
  const home = h();
  const tracked = gitIn(home.dir, "ls-files", "--", "data");
  if (tracked) die(`These are tracked by git and must not be:\n${tracked}`);
  console.log("✓ Nothing under data/ is tracked by git.");
}

function status(): void {
  const home = h();
  const requests = loadRequests(home);
  const events = loadEvents(home);
  const file = loadLaws(home);
  const has = (id: string, t: string) => events.some((e) => e.request_id === id && e.type === t);
  console.log(`Home: ${home.dir} (dataset: ${home.dataset}${home.dataset === "test" ? ", FICTIONAL" : ""})`);
  console.log(`Targets: ${loadTargets(home).targets.length}. Requests: ${requests.length} drafted, ${requests.filter((r) => has(r.id, "approved")).length} approved, ${requests.filter((r) => has(r.id, "sent")).length} sent, ${requests.filter((r) => stateOf(r, events, lawById(file, r.law_id)).closed).length} closed.`);
  console.log(`Limits: ${JSON.stringify(loadPolicy(home).limits)}`);
  console.log(`Estimated model spend in this home: $${totalSpend(home).toFixed(4)}.`);
  checkRepo();
}

const cmd = process.argv[2];
try {
  switch (cmd) {
    case "targets": targets(); break;
    case "laws": laws(); break;
    case "draft": await draft(h()); break;
    case "write-drafts": writeReviewDrafts(h(), option("out") ?? join(GOV_DIR, "drafts")); break;
    case "review": review(h()); break;
    case "confirm-contact": confirmContact(h()); break;
    case "approve": await approve(h()); break;
    case "reject": reject(h()); break;
    case "export": exportOutbox(h()); break;
    case "log": logOutcome(h()); break;
    case "due": dueReport(h()); break;
    case "followup": followup(h()); break;
    case "intake": await intake(h()); break;
    case "metrics": metrics(); break;
    case "learn": await learn(h()); break;
    case "spotcheck": await spotcheck(h()); break;
    case "status": status(); break;
    case "check-repo": checkRepo(); break;
    case "init-test": initTestHome(option("dir") ?? die("Give --dir.")); break;
    default: usage();
  }
} catch (e) {
  die((e as Error).message);
}

export { client };
