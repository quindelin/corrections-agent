// Step 2 and the human checkpoint: draft, review, approve, export, and log what happened.
//
// There is no send command and the agent has no tools. A draft becomes sendable only when a person approves its exact
// text at a terminal. The person sends it from their own mail client and logs the outcome here.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { client, die, flag, option } from "../scripts/lib.ts";
import { claimsIn, domainOf, expandClaims, factUsed, isFreemail, isSuppressed, lintDraft, quota, renderedSha, renderMessage, touchProblem, validateSender } from "./compliance.ts";
import { appendJsonl, billedTurn, BudgetStop, type Claim, closeLedger, type EventType, type Home, type Issue, loadClaims, loadPolicy, loadSender, type Message, now, type OutreachEvent, parseJsonReply, parseVariants, type Prospect, readJsonl, sha, startLedger, type Suppression, syncOutreachAgent, type Variant, variantSha, withoutStanding } from "./lib.ts";
import { guardrail, messageState } from "./stats.ts";

export function loadAll(h: Home) {
  return {
    prospects: readJsonl<Prospect>(h.prospects),
    messages: readJsonl<Message>(h.messages),
    events: readJsonl<OutreachEvent>(h.events),
    suppression: readJsonl<Suppression>(h.suppression),
    claims: loadClaims(h),
    policy: loadPolicy(h),
  };
}

/** Least-used active variant within the segment, so arms stay balanced and the model has no say. Ties are broken by a hash of the prospect id. */
export function assignVariant(prospect: Prospect, variants: Variant[], messages: Message[]): Variant | null {
  const options = variants.filter((v) => v.status === "active" && v.segments.includes(prospect.segment));
  if (!options.length) return null;
  const count = (v: Variant) => messages.filter((m) => m.variant_id === v.id && m.segment === prospect.segment && m.gate.status !== "blocked").length;
  const least = Math.min(...options.map(count));
  const tied = options.filter((v) => count(v) === least).sort((a, b) => a.id.localeCompare(b.id));
  return tied[parseInt(sha(prospect.id).slice(0, 8), 16) % tied.length];
}

/** Prospects a draft may be written for. Suppression and the touch limit apply even if a status says "ready". */
export function draftable(h: Home, s: ReturnType<typeof loadAll>, at: Date): Prospect[] {
  const taken = new Set(s.messages.filter((m) => !messageState(m.id, s.events).rejected && m.gate.status !== "blocked").map((m) => m.prospect_id));
  const reviewed = new Map(s.events.filter((e) => e.type === "prospect_review").map((e) => [e.prospect_id, e.note ?? ""]));
  return s.prospects.filter((p) => {
    const cleared = p.status === "needs_review" && reviewed.get(p.id)?.startsWith("ready");
    if (p.status !== "ready" && !cleared) return false;
    if (reviewed.get(p.id)?.startsWith("exclude")) return false;
    if (taken.has(p.id)) return false;
    if (isSuppressed({ email: p.to_email, domain: p.domain }, s.suppression)) return false;
    return !touchProblem(p.domain, s.policy, s.messages, s.events, at);
  });
}

function draftPrompt(playbook: string, prospect: Prospect, variant: Variant, claims: Claim[], feedback: Issue[] | string[]): string {
  const facts = prospect.facts.filter((f) => f.kind !== "firm_name").map((f) => `- ${f.id} (${f.kind}): ${f.value}`);
  return `JOB: draft one outreach email.

Follow this playbook:

${withoutStanding(playbook)}

Variant to use (the code chose it, so don't switch):
${JSON.stringify({ id: variant.id, angle: variant.angle, ask: variant.ask }, null, 2)}

Recipient: ${prospect.firm_name}, segment ${prospect.segment}.
Verified facts you may use. Use nothing else about them:
${facts.join("\n") || "- none"}

Approved claims. These are the only factual statements you may make about Redline or about permit times. Insert one by writing its token exactly, as its own sentence. Code replaces the token with the wording shown, so the reader sees that wording once. Never also describe Redline, its testing or permit times in your own words: that would say it twice.
${claims.map((c) => `- {{claim:${c.id}}}${c.required || variant.required_claims.includes(c.id) ? " (REQUIRED in this message)" : ""}: "${c.wording}"`).join("\n")}

Shape of a good body, with about 60 words of your own in total:
1. One or two sentences: what you want, and why you're writing to this firm. If there's a project_fit or permit_count fact, say in your own short phrase what they do, using its words, and list it in facts_used. Don't praise it.
2. The claim tokens.
3. The ask, in one sentence, and an easy way to say no.

Hard rules:
- Greet by firm name or not at all, unless a fact you list in facts_used names the person. List only the facts you actually used.
- The subject must honestly say what this is, and include "Redline" or "correction". Don't write Re: or Fwd:, invent urgency, or make it look like news about their own permit or a message from the city.
- Write no signature, footer, address, opt-out line or links. Code adds those.
- No numbers except those inside a fact you list in facts_used.
- Don't say Redline saves time, reduces cycles, is accurate, or gets permits approved. There's no evidence for that yet.
- Don't mention scores, tests or evals beyond the approved claims. Don't mention customers, or offer money or free services.
${feedback.length ? `\nYour last draft was rejected for these reasons. Fix all of them:\n${feedback.map((f) => `- ${typeof f === "string" ? f : f.message}`).join("\n")}\n` : ""}
Reply with only a JSON block:
\`\`\`json
{"subject":"","body":"","facts_used":["F3"]}
\`\`\``;
}

function auditPrompt(subject: string, expanded: string, prospect: Prospect, claims: Claim[]): string {
  return `JOB: audit a draft email for unsupported claims. Be strict.

List every statement in the draft that asserts something as fact about Redline, permits, Chicago, or the recipient, and that isn't supported by the approved claims or the recipient facts below. Also list anything that implies Redline saves time, gets approvals, is accurate, has customers, or has been checked by an architect or a city. Requests, questions and statements of what the sender wants are fine.

Approved claims:
${claims.map((c) => `- ${c.wording}`).join("\n")}

Recipient facts:
- Firm name: ${prospect.firm_name}
${prospect.facts.map((f) => `- ${f.value}`).join("\n")}

Draft:
Subject: ${subject}
${expanded}

Reply with only a JSON block. Use an empty list if everything is supported:
\`\`\`json
{"unsupported":[{"sentence":"","why":""}]}
\`\`\``;
}

export async function draft(h: Home): Promise<void> {
  const s = loadAll(h);
  const at = now();
  const paused = guardrail(s.messages, s.events, s.policy);
  if (paused) die(`Outreach is paused. ${paused.reason} After you've looked into it: resume --reason "..."`);
  const playbook = readFileSync(h.playbook, "utf8");
  const variants = parseVariants(playbook);
  const limit = Number(option("limit") ?? s.policy.contact_limits.max_per_day);
  const queue = draftable(h, s, at).slice(0, limit);
  if (!queue.length) {
    console.log("Nothing to draft: no ready prospects without a message, after suppression and contact limits.");
    return;
  }
  const ledger = startLedger(h, "draft");
  const tf = client();
  const agent = await syncOutreachAgent(tf);
  const { data: session } = await tf.sessions.create({ agent: { name: agent.name }, metadata: { purpose: "outreach-draft", dataset: h.dataset } });
  await tf.sessions.update(session.id, { title: `outreach drafts (${h.dataset})` });

  const written: Message[] = [...s.messages];
  try {
    for (const prospect of queue) {
      const variant = assignVariant(prospect, variants, written);
      if (!variant) {
        console.log(`- ${prospect.firm_name}: no active variant for ${prospect.segment}`);
        continue;
      }
      let result: { subject: string; body: string; facts_used: string[] } | null = null;
      let issues: Issue[] = [];
      let audit = "not run";
      let feedback: (Issue | string)[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const reply = await billedTurn(h, tf, session.id, ledger, draftPrompt(playbook, prospect, variant, s.claims, feedback as string[]));
        result = parseJsonReply(reply);
        if (!result?.body || !result.subject) {
          issues = [{ severity: "block", code: "unparsable", message: "The model's reply had no valid JSON draft." }];
          feedback = issues;
          continue;
        }
        // An unused fact in the list is harmless, so drop it. An unknown id still fails the gate.
        const body = result.body;
        result.facts_used = (result.facts_used ?? []).filter((id) => {
          const fact = prospect.facts.find((f) => f.id === id);
          return !fact || factUsed(fact.value, body);
        });
        issues = lintDraft(result, prospect, variant, s.claims);
        if (issues.length) {
          feedback = issues;
          continue;
        }
        // The regex gate can't read meaning, so a second pass checks for claims it can't see. It fails closed.
        const auditReply = await billedTurn(h, tf, session.id, ledger, auditPrompt(result.subject, expandClaims(result.body, s.claims), prospect, s.claims));
        const parsed = parseJsonReply<{ unsupported: { sentence: string; why: string }[] }>(auditReply);
        if (!parsed || !Array.isArray(parsed.unsupported)) {
          audit = "audit reply unparsable";
          issues = [{ severity: "block", code: "audit_failed", message: "The audit reply couldn't be parsed, so the draft isn't cleared." }];
          feedback = issues;
          continue;
        }
        if (parsed.unsupported.length) {
          audit = "failed";
          issues = parsed.unsupported.map((u) => ({ severity: "block" as const, code: "audit_unsupported", message: `Unsupported: "${u.sentence}" (${u.why})` }));
          feedback = issues;
          continue;
        }
        audit = "passed";
        break;
      }
      const message: Message = {
        id: `M-${randomUUID().slice(0, 8)}`,
        dataset: h.dataset,
        prospect_id: prospect.id,
        firm_name: prospect.firm_name,
        domain: prospect.domain,
        to_email: prospect.to_email,
        contact_form_url: prospect.contact_form_url,
        segment: prospect.segment,
        variant_id: variant.id,
        variant_sha: variantSha(variant),
        playbook_sha: sha(playbook).slice(0, 12),
        subject: result?.subject ?? "",
        body: result?.body ?? "",
        claims_used: claimsIn(result?.body ?? ""),
        facts_used: result?.facts_used ?? [],
        gate: { status: issues.length ? "blocked" : "pending_review", issues, audit },
        session_id: session.id,
        created_at: at.toISOString(),
      };
      appendJsonl(h.messages, message);
      written.push(message);
      console.log(`- ${message.id} ${prospect.firm_name} [${variant.id}]: ${message.gate.status}${issues.length ? ` (${issues.map((i) => i.code).join(", ")})` : ""}`);
    }
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
    console.log(e.message);
  }
  console.log(`Nothing was sent. Review drafts with: review`);
  closeLedger(h, ledger, session.id);
}

// ---------- the human checkpoint ----------

/** Everything that must hold at approval time, against the current suppression list, sender and claims. */
export function approvalProblems(h: Home, m: Message, s: ReturnType<typeof loadAll>): string[] {
  const problems: string[] = [];
  const state = messageState(m.id, s.events);
  if (m.dataset !== h.dataset) problems.push(`This message is ${m.dataset} data in a ${h.dataset} home.`);
  if (m.gate.status === "blocked") problems.push(`The draft failed its checks: ${m.gate.issues.map((i) => i.message).join(" ")}`);
  if (state.rejected) problems.push("This draft was rejected.");
  if (state.sent_at) problems.push("This message is already logged as sent.");
  if (isSuppressed({ email: m.to_email, domain: m.domain }, s.suppression)) problems.push("This recipient is on the suppression list.");
  for (const i of validateSender(loadSender(h), h.dataset)) problems.push(i.message);
  if (h.dataset === "real") {
    for (const id of claimsIn(m.body)) {
      const claim = s.claims.find((c) => c.id === id);
      if (!claim?.verified_by_human) problems.push(`Open the source for claim ${id} and set verified_by_human in claims.json: ${claim?.source_url ?? "unknown claim"}`);
    }
    if (m.to_email && /\.(example|test|invalid)$/i.test(m.to_email)) problems.push("A fictional recipient can't be used in the real home.");
  }
  const paused = guardrail(s.messages, s.events, s.policy);
  if (paused) problems.push(`Outreach is paused. ${paused.reason}`);
  return problems;
}

function findMessage(s: ReturnType<typeof loadAll>, id: string | undefined): Message {
  if (!id) die("Give a message id: --id M-xxxx");
  const m = s.messages.find((x) => x.id === id);
  if (!m) die(`No message ${id}.`);
  return m;
}

function event(h: Home, type: EventType, fields: Partial<OutreachEvent>): void {
  appendJsonl(h.events, { type, dataset: h.dataset, at: now().toISOString(), ...fields });
}

export function review(h: Home): void {
  const s = loadAll(h);
  const sender = loadSender(h) ?? { from_name: "(no sender yet)", from_email: "unset@invalid", organization: "(no sender yet)", postal_address: "(no address yet)", opt_out_mailbox_monitored: false };
  const pending = s.messages.filter((m) => {
    const st = messageState(m.id, s.events);
    return !st.approved && !st.rejected && !st.sent_at;
  });
  if (!pending.length) console.log("Nothing waiting for review.");
  for (const m of pending) {
    const prospect = s.prospects.find((p) => p.id === m.prospect_id);
    console.log(`\n========== ${m.id} | ${m.firm_name} | ${m.variant_id} | ${m.gate.status} | audit: ${m.gate.audit} ==========`);
    console.log(renderMessage(m, sender, s.claims));
    console.log("\nFacts used, with sources:");
    for (const id of m.facts_used) {
      const f = prospect?.facts.find((x) => x.id === id);
      if (f) console.log(`  ${f.id} ${f.value}\n     ${f.source_url}\n     evidence: ${f.evidence}`);
    }
    const c = prospect?.emails.find((e) => e.email === m.to_email);
    if (c) console.log(`Address source: ${c.source_url}\n     evidence: ${c.evidence}`);
    for (const i of approvalProblems(h, m, s)) console.log(`  ! Can't approve yet: ${i}`);
  }
}

/** A person types the first characters of the hash of the exact text. Refuses without a terminal, so no script or agent run approves by accident. */
export async function approve(h: Home): Promise<void> {
  const s = loadAll(h);
  const m = findMessage(s, option("id"));
  const problems = approvalProblems(h, m, s);
  if (problems.length) die(`Can't approve ${m.id}:\n  ${problems.join("\n  ")}`);
  const rendered = renderMessage(m, loadSender(h)!, s.claims);
  const hash = renderedSha(rendered);
  if (flag("yes-test")) {
    if (h.dataset !== "test") die("--yes-test only works in a test home. Real messages need a person at a terminal.");
  } else {
    if (!process.stdin.isTTY) die("Approval needs a person at a terminal. Run this yourself, in your own shell.");
    console.log(`\n${rendered}\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type ${hash.slice(0, 6)} to approve exactly this text: `);
    rl.close();
    if (answer.trim() !== hash.slice(0, 6)) die("Not approved.");
  }
  event(h, "approved", { message_id: m.id, rendered_sha: hash });
  console.log(`✓ Approved ${m.id} (${hash}). It isn't sent. Run export, send it yourself, then: log --id ${m.id} --event sent`);
}

export function reject(h: Home): void {
  const s = loadAll(h);
  const m = findMessage(s, option("id"));
  const reason = option("reason");
  if (!reason) die('Say why, so the playbook can learn from it: --reason "..."');
  event(h, "rejected", { message_id: m.id, note: reason });
  console.log(`✓ Rejected ${m.id}. The prospect can be drafted again.`);
}

/** Writes approved messages to text files, up to today's limit. This is the end of the line for the code. */
export function exportOutbox(h: Home): void {
  const s = loadAll(h);
  const at = now();
  const sender = loadSender(h);
  if (validateSender(sender, h.dataset).length) die("The sender details aren't complete. See sender.example.json.");
  const paused = guardrail(s.messages, s.events, s.policy);
  if (paused) die(`Outreach is paused. ${paused.reason}`);
  let { remaining } = quota(s.policy, s.messages, s.events, at);
  mkdirSync(h.outbox, { recursive: true });
  let written = 0;
  let held = 0;
  const events = [...s.events];
  for (const m of s.messages) {
    const st = messageState(m.id, events);
    if (!st.approved || st.sent_at || st.rejected || st.exported) continue;
    if (isSuppressed({ email: m.to_email, domain: m.domain }, s.suppression)) {
      console.log(`- ${m.id}: skipped, recipient is on the suppression list.`);
      continue;
    }
    const domainProblem = touchProblem(m.domain, s.policy, s.messages, events, at);
    if (domainProblem) {
      console.log(`- ${m.id}: skipped, ${m.domain} ${domainProblem}.`);
      continue;
    }
    const rendered = renderMessage(m, sender!, s.claims);
    if (renderedSha(rendered) !== st.approved_sha) {
      console.log(`- ${m.id}: skipped, the text changed since approval (sender or claim wording). Approve it again.`);
      continue;
    }
    if (remaining <= 0) {
      held += 1;
      continue;
    }
    const file = join(h.outbox, `${m.id}.txt`);
    writeFileSync(file, rendered + "\n");
    event(h, "exported", { message_id: m.id });
    events.push({ type: "exported", dataset: h.dataset, message_id: m.id, at: at.toISOString() });
    remaining -= 1;
    written += 1;
    console.log(`- ${file}`);
  }
  console.log(`✓ Wrote ${written} message(s) for you to send yourself.${held ? ` ${held} held back by the contact limits; export again later.` : ""}`);
}

// ---------- outcomes and suppression ----------

const OUTCOMES: EventType[] = ["sent", "replied", "positive", "bounced", "unsubscribed"];

export function logOutcome(h: Home): void {
  const s = loadAll(h);
  const m = findMessage(s, option("id"));
  const type = option("event") as EventType | undefined;
  if (!type || !OUTCOMES.includes(type)) die(`--event must be one of ${OUTCOMES.join(", ")}`);
  const state = messageState(m.id, s.events);
  const at = option("at") ? new Date(option("at")!) : now();
  if (type === "sent") {
    if (!state.approved) die(`${m.id} was never approved, and approval comes before sending. If you haven't sent it, approve it first. If it already went out, that skipped the checkpoint, so check the text against the rules and suppress the recipient if needed.`);
    if (state.sent_at) die(`${m.id} is already logged as sent.`);
    const hit = isSuppressed({ email: m.to_email, domain: m.domain }, s.suppression);
    if (hit) console.log(`! This recipient is on the suppression list (${hit.reason}). Don't send to them again.`);
    const q = quota(s.policy, s.messages.filter((x) => x.id !== m.id), s.events, at);
    const over = q.remaining <= 0;
    if (over) console.log("! This goes over the contact limit in policy.json. It's logged, because it happened.");
    event(h, "sent", { message_id: m.id, at: at.toISOString(), note: option("note"), over_limit: over || undefined });
  } else {
    if (!state.sent_at) die(`${m.id} isn't logged as sent yet.`);
    event(h, type, { message_id: m.id, at: at.toISOString(), note: option("note") });
  }
  if (type === "unsubscribed" || type === "bounced") {
    const email = m.to_email ?? undefined;
    const domain = type === "unsubscribed" && !(email && isFreemail(domainOf(email))) ? m.domain : undefined;
    appendJsonl(h.suppression, { email, domain, dataset: h.dataset, reason: type, at: at.toISOString() } satisfies Suppression);
    console.log(`✓ Added ${[email, domain].filter(Boolean).join(" and ")} to the suppression list.`);
  }
  console.log(`✓ Logged ${type} for ${m.id}.`);
}

export function suppress(h: Home): void {
  const email = option("email");
  const domain = option("domain");
  if (!email && !domain) die("Give --email or --domain, and a --reason.");
  appendJsonl(h.suppression, { email, domain, dataset: h.dataset, reason: option("reason") ?? "manual", at: now().toISOString() } satisfies Suppression);
  console.log(`✓ Suppressed ${[email, domain].filter(Boolean).join(" and ")}.`);
}

export function resume(h: Home): void {
  const reason = option("reason");
  if (!reason) die('Say what you checked: --reason "..."');
  event(h, "resumed", { note: reason });
  console.log("✓ Outreach resumed. The guardrail now counts only sends after this moment.");
}

export function reviewProspect(h: Home): void {
  const id = option("id");
  const decision = option("decision");
  const reason = option("reason");
  if (!id || !decision || !["ready", "exclude"].includes(decision) || !reason) die('Use: review-prospect --id P-xxxx --decision ready|exclude --reason "..."');
  if (!readJsonl<Prospect>(h.prospects).some((p) => p.id === id)) die(`No prospect ${id}.`);
  event(h, "prospect_review", { prospect_id: id, note: `${decision}: ${reason}` });
  console.log(`✓ ${id}: ${decision}.`);
}
