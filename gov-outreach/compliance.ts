// What a draft says and what it may not say. Code assembles the legal and identity paragraphs from laws.json and targets.json.
// The model can only reword the description of the records, and the gate reads the finished text.

import type { Ask, Issue, Law, Policy, RequestRecord, RecordsEvent, Sender, Target } from "./lib.ts";

/** Reasons a person can't honestly claim to be something else. Each is an affiliation we don't have, or a way to imply one. */
const FALSE_AFFILIATION = /\b(journalist|reporter|newsroom|news media|press|student|university|professor|academic|scholarly|thesis|dissertation|non-?profit|charity|government (agency|employee|official)|city official|state official|on behalf of (the )?(city|county|state|department|government)|public interest|fee waiver|attorney|law firm|counsel)\b/i;
const HIDES_PURPOSE = /\b(not for (a )?commercial|non-?commercial|no commercial|(?:is|are|it\'s) for (?:my |our )?personal use|for my own (use|interest)|private citizen|for research purposes|purely research|research project|curious|just wondering)\b/i;
const THREAT = /\b(sue|lawsuit|litigation|legal action|court|violat\w+|penalt\w+|failure to comply|we will (file|pursue))\b/i;
const FALSE_URGENCY = /\b(urgent|immediately|asap|final notice)\b/i;
const CLAIMS_ABOUT_PRODUCT = /\b(accura\w+|validated|proven|approved by|endorsed|partnership|customers?|time saved|saves? time)\b/i;
const OVERBROAD = /\b(any and all|all records|every record|all plan review|all correction|complete (database|dump)|entire database)\b/i;

export const PLACEHOLDER = /\[[^\]\n]{2,80}\]/g;

export function gateIssues(ask: Ask, target: Target, law: Law, text: string, policy: Policy): Issue[] {
  const issues: Issue[] = [];
  const block = (code: string, message: string) => issues.push({ severity: "block", code, message });
  const hit = (re: RegExp) => text.match(re)?.[0] ?? null;

  let m: string | null;
  if ((m = hit(FALSE_AFFILIATION))) block("false_affiliation", `Implies an affiliation we don't have: "${m}".`);
  if ((m = hit(HIDES_PURPOSE))) block("hides_purpose", `Misstates or softens the purpose: "${m}".`);
  if ((m = hit(THREAT))) block("threat", `A first request doesn't threaten anything: "${m}".`);
  if ((m = hit(FALSE_URGENCY))) block("false_urgency", `Invented urgency: "${m}".`);
  if ((m = hit(CLAIMS_ABOUT_PRODUCT))) block("product_claim", `Makes a claim about the product: "${m}".`);
  if ((m = hit(OVERBROAD))) block("overbroad", `Too broad to be easy to fulfil: "${m}".`);
  if (!/intends to charge for it/.test(text) || !/test and improve/.test(text)) block("purpose_missing", "The statement of who's asking and why is missing.");

  if (ask.kind === "records_request") {
    if (ask.sample_size > policy.limits.max_sample_first_request) block("sample_too_big", `Asks for ${ask.sample_size} records. The first-request limit is ${policy.limits.max_sample_first_request}.`);
    if (law.commercial.disclosure !== "not_required" && !/commercial purpose/i.test(text)) block("commercial_missing", `${law.name} requires the commercial purpose statement, and it's missing.`);
    if (!/Not asking for|What I am not asking for/i.test(text)) block("exclusion_missing", "The list of what's excluded is missing.");
    if (!/too much/i.test(text)) block("narrowing_missing", "The offer to narrow is missing.");
    if (!text.includes(law.citation)) block("citation_missing", `The citation ${law.citation} is missing.`);
    for (const k of ask.must_keep ?? []) if (!text.toLowerCase().includes(k.toLowerCase())) block("record_type_lost", `The rewrite lost the record type "${k}".`);
    for (const item of ask.items ?? []) if (!text.includes(item)) block("item_lost", `The list lost "${item}".`);
  } else {
    // A permission ask must not read like automation already happening.
    if (!/would not do this without a yes|we don't fetch|We haven't crawled/i.test(text)) block("access_statement_missing", "It must say we haven't done the thing we're asking about.");
  }
  return issues;
}

/** The model may reword records, not add to them. Any number or item not in the source is an invention. */
export function refinementIssues(ask: Ask, summary: string, records: string[]): Issue[] {
  const issues: Issue[] = [];
  const source = [ask.subject, ask.summary, ...(ask.records ?? []), ask.format_note ?? "", ask.exclude ?? "", ...(ask.items ?? [])].join(" ");
  const numbers = (s: string) => s.match(/\d[\d,./-]*/g) ?? [];
  const allowed = new Set(numbers(source));
  for (const n of numbers([summary, ...records].join(" "))) if (!allowed.has(n)) issues.push({ severity: "block", code: "invented_number", message: `The rewrite added "${n}", which isn't in the source ask.` });
  if ((ask.records ?? []).length && records.length > (ask.records ?? []).length + 1) issues.push({ severity: "block", code: "scope_creep", message: "The rewrite asks for more kinds of record than the source ask." });
  if (!summary.trim() || !records.length) issues.push({ severity: "block", code: "empty", message: "The rewrite is empty." });
  if (/^\s*I (hereby )?request\b/i.test(summary)) issues.push({ severity: "block", code: "doubled_opening", message: 'The summary must finish "I request ...", so it can\'t start with those words.' });
  if (summary.trim() && !/[.]$/.test(summary.trim())) issues.push({ severity: "block", code: "no_period", message: "The summary must end with a period." });
  return issues;
}

export function validateSender(s: Sender | null, dataset: string): string[] {
  if (!s) return ["data/sender.json is missing. Copy sender.example.json and fill it in."];
  const problems: string[] = [];
  for (const k of ["full_name", "entity", "mailing_address", "email"] as const) if (!s[k]?.trim() || PLACEHOLDER.test(s[k])) problems.push(`sender.json: fill in ${k}.`);
  PLACEHOLDER.lastIndex = 0;
  if (!(s.fee_notice_usd >= 0)) problems.push("sender.json: set fee_notice_usd, the amount above which the agency should ask you first.");
  if (dataset === "real" && [s.full_name, s.entity, s.email].some((v) => /fictional|\.example\b/i.test(v))) problems.push("sender.json has a fictional identity, and this is the real home.");
  if (FALSE_AFFILIATION.test(s.entity)) problems.push(`sender.json: the entity "${s.entity}" implies an affiliation. Use your real entity name, and if you have one of these affiliations, take this up with a lawyer rather than this tool.`);
  return problems;
}

function purposeText(template: string, sender: Sender | null, withPromise: boolean): string {
  const promise = !withPromise ? "" : sender ? (sender.no_republish_promise ? " The records will not be resold or republished as a collection." : "") : " [The records will not be resold or republished as a collection. Keep this only if you will keep it.]";
  return template.replace("{{entity}}", sender?.entity ?? "[Entity name]") + promise;
}

/** The exact text a person reviews. Bracketed parts must be gone before approval. */
export function renderDraft(req: Pick<RequestRecord, "subject" | "sections" | "kind" | "dataset">, ask: Ask, target: Target, law: Law, purpose: string, sender: Sender | null): string {
  const lines: string[] = [];
  const signature = sender
    ? [sender.full_name, sender.entity, sender.mailing_address, sender.email, sender.phone].filter(Boolean)
    : ["[Your full name]", "[Entity name, if any]", "[Mailing address]", "[Email]", "[Phone]"];
  const who = purposeText(purpose, sender, req.kind === "records_request");
  if (req.dataset === "test") lines.push("FICTIONAL TEST DATA. Not a real request. Nobody receives this.", "");
  lines.push(`Subject: ${req.subject}`, "", target.salutation, "");
  if (req.kind === "records_request") {
    const feeAmount = sender ? `$${sender.fee_notice_usd}` : "$[amount]";
    lines.push(`Under the ${law.request_name} (${law.citation}), I request ${req.sections.summary}`, "");
    lines.push("**What I am asking for:**", "");
    req.sections.records.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push("");
    if (ask.format_note) lines.push(ask.format_note, "");
    lines.push(`**What I am not asking for:** ${ask.exclude}`, "");
    lines.push("**Redactions:** I do not need the name, email, phone number, signature or seal of any private person, so please redact them. A reviewer's discipline is enough in place of the reviewer's name. If you withhold or redact anything else, please release the rest and state the exemption and the factual basis for it.", "");
    if (target.extra_ask) lines.push(target.extra_ask, "");
    lines.push(law.commercial.paragraph.replace("{{purpose}}", who), "");
    lines.push(`**Format and fees:** Please send the records electronically to the email address below. Please tell me before incurring fees above ${feeAmount}.`, "");
    lines.push(`**If this is too much to do at once:** ${ask.narrowing}`, "");
    if (ask.items?.length) {
      lines.push(`**${ask.items_label}:**`, "");
      for (const i of ask.items) lines.push(i);
      lines.push("");
    }
  } else {
    lines.push(`My name is ${sender?.full_name ?? "[Your full name]"}. ${who}`, "");
    lines.push(`I'm writing about ${req.sections.summary}. To test the software on real comments rather than ones we wrote, we would like to use them. I'm asking you rather than assuming.`, "");
    lines.push(ask.access_so_far ?? "", "");
    lines.push("**Three questions:**", "");
    req.sections.records.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push("");
    lines.push("We would remove personal names and contact details before testing, and we wouldn't republish the comments without asking.", "");
    lines.push(`${ask.fallback} A short answer is plenty, and I'm happy to talk by phone.`, "");
  }
  lines.push("Thank you.", "", ...signature);
  return lines.join("\n");
}

/** What stands between a draft and approval. Contacts seen only in search excerpts must be confirmed by a person first. */
export function approvalProblems(req: RequestRecord, rendered: string, target: Target, law: Law, sender: Sender | null, dataset: string, contactConfirmed: boolean, events: RecordsEvent[]): string[] {
  const problems = [...validateSender(sender, dataset)];
  if (req.gate.status === "blocked") problems.push(`Blocked by the checks: ${req.gate.issues.map((i) => i.message).join(" ")}`);
  const brackets = rendered.match(PLACEHOLDER);
  if (brackets) problems.push(`Unfilled brackets: ${[...new Set(brackets)].join(", ")}`);
  if (target.contact.evidence !== "read_directly" && target.contact.evidence !== "fictional" && !contactConfirmed) problems.push(`The contact for ${target.id} came from ${target.contact.evidence === "unknown" ? "nowhere yet" : "a search excerpt"}. Open ${target.contact.source_url}, then run confirm-contact.`);
  if (law.verification === "unconfirmed") problems.push(`${law.name} hasn't been checked against any source.`);
  if (target.status === "hold") problems.push(`${target.id} is on hold: ${target.hold_reason}`);
  if (events.some((e) => e.request_id === req.id && (e.type === "rejected" || e.type === "sent"))) problems.push("This draft was already rejected or sent.");
  return problems;
}
