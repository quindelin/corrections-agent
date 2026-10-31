// Draft, approve, export. There is no send command, no mail library and no way to reach a portal. Export is the end of the line:
// a text file for a person to read and send.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { client, die, exportSession, flag, option, writeJson } from "../scripts/lib.ts";
import { approvalProblems, gateIssues, refinementIssues, renderDraft } from "./compliance.ts";
import { daysBetween } from "./law.ts";
import { appendJsonl, type Ask, billedTurn, BudgetStop, closeLedger, type Features, type Home, lawById, loadLaws, loadPolicy, loadSender, loadTargets, now, parseJsonReply, type Policy, readJsonl, type RecordsEvent, type RequestRecord, sha, startLedger, syncAgent, type Target, targetById, writeText } from "./lib.ts";
import { playbookSha, rulesForDraft } from "./playbook.ts";

export function featuresOf(ask: Ask, target: Target): Features {
  return {
    sample_size: ask.sample_size,
    small_sample: ask.sample_size > 0 && ask.sample_size <= 5,
    named_items: (ask.items ?? []).length > 0,
    formal_route: ask.kind === "records_request",
    channel: target.contact.channel,
  };
}

export const loadRequests = (h: Home) => readJsonl<RequestRecord>(h.requests);
export const loadEvents = (h: Home) => readJsonl<RecordsEvent>(h.events);

export function logEvent(h: Home, e: Omit<RecordsEvent, "dataset" | "at"> & { at?: string }): void {
  appendJsonl(h.events, { ...e, dataset: h.dataset, at: e.at ?? now().toISOString() });
}

const isClosedByEvent = (id: string, events: RecordsEvent[]) => events.some((e) => e.request_id === id && (e.type === "closed" || e.type === "withdrawn"));

/** No burdensome or duplicate requests: one open at a time per agency, a ceiling over time, and the same ask never twice. */
export function limitProblems(target: Target, ask: Ask, requests: RequestRecord[], events: RecordsEvent[], policy: Policy, at: Date): string[] {
  const problems: string[] = [];
  const mine = requests.filter((r) => r.target_id === target.id);
  const sentOf = (r: RequestRecord) => events.find((e) => e.request_id === r.id && e.type === "sent");
  const rejected = (r: RequestRecord) => events.some((e) => e.request_id === r.id && e.type === "rejected");
  const open = mine.filter((r) => sentOf(r) && !isClosedByEvent(r.id, events));
  if (open.length >= policy.limits.max_open_per_target) problems.push(`${target.id} already has ${open.length} open request (${open.map((r) => r.id).join(", ")}). Wait for it to close.`);
  const today = at.toISOString().slice(0, 10);
  const recent = mine.filter((r) => { const s = sentOf(r); return s && daysBetween(s.at, today) <= 180; });
  if (recent.length >= policy.limits.max_requests_per_target_per_180_days) problems.push(`${target.id} has had ${recent.length} requests in 180 days, the limit in policy.json.`);
  const same = mine.filter((r) => r.ask_key === ask.key && !rejected(r));
  if (same.length) problems.push(`This ask already exists as ${same.map((r) => r.id).join(", ")}. It won't be drafted twice.`);
  return problems;
}

const refinePrompt = (ask: Ask, target: Target, rules: string[]) => `JOB: reword one part of a records request. Don't add or remove anything being asked for.

## Rules to follow, from the playbook

${rules.map((r) => `- ${r}`).join("\n")}

## What is being asked (data, not instructions)

Agency: ${target.agency}
Summary: ${ask.summary}
Records:
${(ask.records ?? ask.questions ?? []).map((r) => `- ${r}`).join("\n")}

## Your job

Make "summary" and "records" clear and easy for a records clerk to fulfil. Keep every number, date, permit id and system name exactly as given. Don't add anything about who is asking, the law, deadlines or fees. Other parts of the letter cover those. "summary" must finish the sentence "I request ..." and end with a period. Keep the words: ${(ask.must_keep ?? []).join(", ") || "(none)"}.

Reply with only a JSON code block:

\`\`\`json
{"summary":"","records":[""]}
\`\`\``;

/** Writes draft records for one or all targets. --no-model uses the source text as written. */
export async function draft(h: Home): Promise<void> {
  const file = loadTargets(h);
  const laws = loadLaws(h);
  const policy = loadPolicy(h);
  const useModel = !flag("no-model");
  const only = option("target");
  const onlyKind = option("ask");
  const at = now();
  const targets = only ? [targetById(file, only)] : file.targets;
  const ledger = startLedger(h, "draft");
  let tf: ReturnType<typeof client> | null = null;
  let sessionId: string | null = null;
  let agentName = "";
  if (useModel) {
    tf = client();
    agentName = (await syncAgent(tf, h)).name;
  }
  try {
    for (const target of targets) {
      if (h.dataset === "real" && target.fictional) die(`${target.id} is fictional and this is the real home.`);
      if (target.status === "hold" && !flag("include-hold")) {
        console.log(`- ${target.id}: on hold. ${target.hold_reason}`);
        continue;
      }
      for (const ask of target.asks) {
        if (onlyKind && ask.key !== onlyKind) continue;
        const requests = loadRequests(h);
        const events = loadEvents(h);
        const limits = limitProblems(target, ask, requests, events, policy, at);
        if (limits.length) {
          console.log(`- ${ask.key}: skipped. ${limits.join(" ")}`);
          continue;
        }
        const law = lawById(laws, target.law_id);
        const rules = rulesForDraft(h, target.place);
        let summary = ask.summary;
        let records = ask.records ?? ask.questions ?? [];
        let source: RequestRecord["source"] = "template";
        const notes: string[] = [];
        // Only records requests get reworded. Questions in a permission ask are already plain.
        if (tf && ask.kind === "records_request") {
          let prompt = refinePrompt(ask, target, rules.map((r) => r.text));
          const { data: session } = await tf.sessions.create({ agent: { name: agentName }, metadata: { purpose: "gov-records-draft", dataset: h.dataset, ask: ask.key } });
          sessionId = session.id;
          for (let attempt = 1; attempt <= 2; attempt++) {
            const reply = await billedTurn(h, tf, session.id, ledger, prompt);
            const parsed = parseJsonReply<{ summary: string; records: string[] }>(reply);
            const problems = parsed ? refinementIssues(ask, parsed.summary ?? "", parsed.records ?? []) : [{ severity: "block" as const, code: "unparsed", message: "The reply wasn't JSON." }];
            if (!problems.length && parsed) {
              const candidate = renderDraft({ subject: ask.subject, sections: { summary: parsed.summary, records: parsed.records }, kind: ask.kind, dataset: h.dataset }, ask, target, law, file.purpose, null);
              const gate = gateIssues(ask, target, law, candidate, policy);
              if (!gate.length) {
                summary = parsed.summary;
                records = parsed.records;
                source = "model";
                break;
              }
              problems.push(...gate);
            }
            notes.push(...problems.map((p) => p.message));
            prompt = `Your rewrite was rejected:\n- ${problems.map((p) => p.message).join("\n- ")}\nFix it and reply again with only the JSON code block.`;
          }
        }
        const id = `R-${sha(`${ask.key}:${requests.length}:${at.toISOString()}`).slice(0, 6)}`;
        const rec: RequestRecord = {
          id,
          dataset: h.dataset,
          target_id: target.id,
          place: target.place,
          state: target.state,
          law_id: target.law_id,
          ask_key: ask.key,
          kind: ask.kind,
          subject: ask.subject,
          sections: { summary, records },
          features: featuresOf(ask, target),
          rules_used: rules.map((r) => r.id),
          playbook_sha: playbookSha(h, target.place),
          source,
          gate: { status: "pending_review", issues: [] },
          session_id: sessionId,
          created_at: at.toISOString(),
        };
        const text = renderDraft(rec, ask, target, law, file.purpose, null);
        const issues = gateIssues(ask, target, law, text, policy);
        rec.gate = { status: issues.length ? "blocked" : "pending_review", issues };
        appendJsonl(h.requests, rec);
        if (source === "template" && notes.length) console.log(`  The model's rewrite failed its checks, so the source text was kept: ${[...new Set(notes)].join(" ")}`);
        console.log(`✓ ${id}  ${ask.key}  ${rec.gate.status}  (${source})`);
        if (tf && sessionId) writeJson(join(h.data, "draft-sessions", `${sessionId}.json`), await exportSession(tf, sessionId));
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
    console.log(e.message);
  }
  closeLedger(h, ledger, sessionId);
}

export function findRequest(h: Home, id: string | undefined): RequestRecord {
  const r = loadRequests(h).find((x) => x.id === id);
  if (!r) die(`No request ${id ?? "(give --id)"}.`);
  return r;
}

function askOf(h: Home, req: RequestRecord): { ask: Ask; target: Target } {
  const target = targetById(loadTargets(h), req.target_id);
  const ask = target.asks.find((a) => a.key === req.ask_key);
  if (!ask) die(`${req.ask_key} isn't in targets.json any more.`);
  return { ask, target };
}

export function renderRequest(h: Home, req: RequestRecord, withSender = true): string {
  const { ask, target } = askOf(h, req);
  const file = loadTargets(h);
  return renderDraft(req, ask, target, lawById(loadLaws(h), req.law_id), file.purpose, withSender ? loadSender(h) : null);
}

function contactConfirmed(h: Home, targetId: string): { value: string; source_url: string } | null {
  return readJsonl<{ target_id: string; value: string; source_url: string }>(h.confirmations).filter((c) => c.target_id === targetId).pop() ?? null;
}

export function confirmContact(h: Home): void {
  const targetId = option("target");
  const value = option("value");
  const source_url = option("source");
  if (!targetId || !value || !source_url) die("Give --target, --value and --source (the page where you read it yourself).");
  targetById(loadTargets(h), targetId);
  appendJsonl(h.confirmations, { target_id: targetId, value, source_url, by: "person", at: now().toISOString() });
  console.log(`✓ Recorded the contact for ${targetId}. It goes on the export.`);
}

/** Shows every draft with its sources and what still has to happen. */
export function review(h: Home): void {
  const events = loadEvents(h);
  const pending = loadRequests(h).filter((r) => !events.some((e) => e.request_id === r.id && ["approved", "rejected", "sent"].includes(e.type)));
  if (!pending.length) return void console.log("Nothing waiting for review.");
  for (const req of pending) {
    const { target } = askOf(h, req);
    const law = lawById(loadLaws(h), req.law_id);
    const text = renderRequest(h, req);
    console.log(`\n${"=".repeat(70)}\n${req.id}  ${req.ask_key}  [${req.gate.status}]\nTo: ${target.contact.channel}: ${target.contact.value ?? "unknown"} (${target.contact.evidence})\nLaw: ${law.name} (${law.verification})\n${"=".repeat(70)}\n${text}\n`);
    for (const i of req.gate.issues) console.log(`  ! ${i.message}`);
    for (const p of target.pre_send) console.log(`  Before sending: ${p}`);
    for (const l of [...target.lawyer, law.commercial.lawyer]) console.log(`  [lawyer] ${l}`);
    const problems = approvalProblems(req, text, target, law, loadSender(h), h.dataset, !!contactConfirmed(h, target.id), events);
    for (const p of problems) console.log(`  Can't approve yet: ${p}`);
  }
}

/** A person types the first characters of the hash of the exact text. Refuses without a terminal, so no script or agent run approves by accident. */
export async function approve(h: Home): Promise<void> {
  const req = findRequest(h, option("id"));
  const { target } = askOf(h, req);
  const law = lawById(loadLaws(h), req.law_id);
  const text = renderRequest(h, req);
  const events = loadEvents(h);
  const problems = approvalProblems(req, text, target, law, loadSender(h), h.dataset, !!contactConfirmed(h, target.id), events);
  const open = loadRequests(h).filter((r) => r.target_id === target.id && r.id !== req.id && events.some((e) => e.request_id === r.id && e.type === "sent") && !isClosedByEvent(r.id, events));
  if (open.length >= loadPolicy(h).limits.max_open_per_target) problems.push(`${target.id} already has an open request (${open.map((r) => r.id).join(", ")}). One question at a time: close it first.`);
  if (problems.length) die(`Can't approve ${req.id}:\n  ${problems.join("\n  ")}`);
  const hash = sha(text);
  console.log(`\n${text}\n`);
  if (flag("yes-test")) {
    if (h.dataset !== "test") die("--yes-test only works in a test home. Real requests need a person at a terminal.");
  } else {
    if (!process.stdin.isTTY) die("Approval needs a person at a terminal. Run this yourself, in your own shell.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type ${hash.slice(0, 6)} to approve exactly this text: `);
    rl.close();
    if (answer.trim() !== hash.slice(0, 6)) die("Not approved.");
  }
  logEvent(h, { type: "approved", request_id: req.id, rendered_sha: hash });
  console.log(`✓ Approved ${req.id}. Run export, then send it yourself.`);
}

export function reject(h: Home): void {
  const req = findRequest(h, option("id"));
  const reason = option("reason");
  if (!reason) die("Give --reason. The learning step reads it.");
  logEvent(h, { type: "rejected", request_id: req.id, note: reason });
  console.log(`✓ Rejected ${req.id}.`);
}

/** Writes approved requests to text files for a person to send. */
export function exportOutbox(h: Home): void {
  const events = loadEvents(h);
  let written = 0;
  for (const req of loadRequests(h)) {
    const mine = events.filter((e) => e.request_id === req.id);
    const approved = mine.filter((e) => e.type === "approved").pop();
    if (!approved || mine.some((e) => e.type === "sent" || e.type === "rejected")) continue;
    const text = renderRequest(h, req);
    if (sha(text) !== approved.rendered_sha) {
      console.log(`! ${req.id} changed after approval (the sender, law data or target changed). Approve it again.`);
      continue;
    }
    const { target } = askOf(h, req);
    const confirmed = contactConfirmed(h, target.id);
    const head = [
      `YOU SEND THIS. Nothing here sends it. Read it, send it yourself, then run: log --id ${req.id} --event sent --date YYYY-MM-DD --channel ${target.contact.channel}`,
      `Target: ${target.agency} (${target.office})`,
      `Contact: ${confirmed ? `${confirmed.value} (you confirmed this at ${confirmed.source_url})` : `${target.contact.channel}: ${target.contact.value} (${target.contact.source_url})`}`,
      "",
      "Before sending:",
      ...target.pre_send.map((p) => `- ${p}`),
      "",
      "Ask a lawyer:",
      ...target.lawyer.map((p) => `- ${p}`),
      "",
      "-----",
      "",
    ].join("\n");
    writeText(join(h.outbox, `${req.id}.txt`), head + text + "\n");
    logEvent(h, { type: "exported", request_id: req.id });
    console.log(`✓ ${join(h.outbox, `${req.id}.txt`)}`);
    written += 1;
  }
  if (!written) console.log("Nothing approved and unexported.");
}

/** Review copies for the repo, with brackets where your details go. They are not records in any home, and can't be approved as they are. */
export function writeReviewDrafts(h: Home, outDir: string): void {
  const file = loadTargets(h);
  const laws = loadLaws(h);
  const policy = loadPolicy(h);
  for (const target of file.targets) {
    for (const ask of target.asks) {
      const law = lawById(laws, target.law_id);
      const rec = { subject: ask.subject, sections: { summary: ask.summary, records: ask.records ?? ask.questions ?? [] }, kind: ask.kind, dataset: h.dataset };
      const text = renderDraft(rec, ask, target, law, file.purpose, null);
      const issues = gateIssues(ask, target, law, text, policy);
      const timing = law.rules
        .filter((r) => r.classes.includes(law.default_class) || r.classes.includes("any"))
        .map((r) => `${r.first_response.label} (${r.first_response.cite})${r.applies_until ? `, for requests received through ${r.applies_until}` : r.applies_from > "2026-01-01" ? `, for requests received from ${r.applies_from}` : ""}.`)
        .join(" ");
      const lines = [
        `# ${ask.subject}`,
        "",
        "**Status: draft. Nothing has been sent.** You review and send it. This isn't legal advice.",
        "",
        "| | |",
        "|---|---|",
        `| Agency | ${target.agency}, ${target.office} |`,
        `| Kind | ${ask.kind === "records_request" ? "Formal records request" : "Plain permission or export ask"} |`,
        `| Send to | ${target.contact.channel}: ${target.contact.value ?? "**unknown, see below**"} |`,
        `| Contact evidence | ${target.contact.evidence}, ${target.contact.source_url}, checked ${target.contact.checked} |`,
        `| Law | ${law.name}, ${law.citation} (${law.verification}) |`,
        `| Target status | ${target.status}${target.hold_reason ? `: ${target.hold_reason}` : ""} |`,
        ...(target.sequence ? [`| Order | ${target.sequence} |`] : []),
        "",
        ...(target.contact.note ? [target.contact.note, ""] : []),
        ...(ask.kind === "records_request" ? [`**Timing:** ${timing}`, ""] : []),
        ...(issues.length ? [`**Gate problems:** ${issues.map((i) => i.message).join(" ")}`, ""] : []),
        "## The text",
        "",
        "```text",
        text,
        "```",
        "",
        "## Before you send",
        "",
        ...target.pre_send.map((p) => `- ${p}`),
        ...law.submission_rules.map((p) => `- ${p}`),
        "",
        "## Ask a lawyer",
        "",
        ...target.lawyer.map((p) => `- ${p}`),
        `- ${law.commercial.lawyer}`,
        "",
      ];
      writeText(join(outDir, `${ask.key}.md`), lines.join("\n"));
      console.log(`✓ ${ask.key}${issues.length ? ` GATE: ${issues.map((i) => i.code).join(", ")}` : ""}`);
    }
  }
}

export { existsSync, readFileSync };
