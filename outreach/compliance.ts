// The checks every message passes, in code rather than in a prompt: honest subject, sourced claims, sender identity,
// physical address, opt-out, suppression and contact limits. Not legal advice: see "Needs your legal judgment" in README.md.

import type { Claim, Issue, Message, OutreachEvent, Policy, Prospect, Sender, Suppression, Variant } from "./lib.ts";
import { messageState } from "./stats.ts";
import { sha } from "./lib.ts";

const TOKEN = /\{\{claim:([a-z0-9_]+)\}\}/g;

export function expandClaims(body: string, claims: Claim[]): string {
  return body.replace(TOKEN, (_, id: string) => claims.find((c) => c.id === id)?.wording ?? `[UNKNOWN CLAIM ${id}]`);
}

export function claimsIn(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1]))];
}

/** Each pattern is something Redline can't truthfully say, or that makes a message look like what it isn't. */
const BANNED: [RegExp, string][] = [
  [/city[- ]?(approved|accepted|certified)|(approved|accepted|certified) by (the )?(city|dob|department)|dob[- ]?(approved|accepted|certified)/i, "claims city acceptance"],
  [/approval[- ]rate|acceptance[- ]rate|first[- ](pass|cycle|round|time)|pass(es|ing)? (re-?)?review|get(s|ting)? (you |it |them )?approved/i, "claims approval results"],
  [/guarantee|proven|results show|shown to|data shows|studies show/i, "claims proof Redline doesn't have"],
  [/\bfaster\b|\bquicker\b|sav(e|es|ing) (you )?(\w+ )?(time|days|weeks|hours|money)|cuts? (your )?(\w+ )?(time|days|weeks|cycles|rounds)|reduc(e|es|ing) (your )?(\w+ )?(time|days|weeks|cycles|rounds|corrections)|fewer (cycles|rounds|corrections)/i, "promises a time or cycle saving with no evidence"],
  [/\bscor(e|es|ed|ing)\b|\baccura(te|cy)\b|\beval(s|uation)?\b|benchmark|\bpercent\b|\d\s*%/i, "cites a performance measure. Eval scores measure agreement with an unvalidated answer key"],
  [/\bvalidated\b|reviewed by (an? )?(licensed )?architects?|architect[- ](approved|reviewed|validated)|code[- ]compliant|ensures? compliance/i, "claims validation or compliance"],
  [/trusted by|our (customers|clients|users)|(firms|architects|expediters|customers|clients) (use|love|rely|are using)|testimonial|industry[- ]leading|best[- ]in[- ]class|state[- ]of[- ]the[- ]art|cutting[- ]edge|revolutioni[sz]/i, "implies traction or superiority with no source"],
  [/\bai agent\b|\bresponse packages?\b|\bdrafts? (a |the )?(response|repl)|\breads? (a |the )?(chicago )?(building )?(permit )?correction|\bwe wrote\b|\bonly (been )?tested\b/i, "describes Redline or its testing in its own words. Insert the claims instead"],
  [/\btakes? (just |only |about )?(a|an|one|two|\d+|few|\w+) (seconds?|minutes?|moments?)\b|\b(easy|quick|simple) to (redact|share|do|send)\b|won't take (long|much)/i, "promises how little effort this takes, which nobody knows"],
  [/\bfree\b|no (cost|charge)|complimentary|discount|\$\s*\d|gift card|\bpaid\b|\bpay you\b/i, "makes an offer nobody has approved"],
  [/as we discussed|as discussed|following up|per our|our (last )?(call|conversation|chat|meeting)|we (met|spoke|talked)|you (asked|requested|signed up)|thanks for your (time|interest)/i, "implies a relationship that doesn't exist"],
  [/unsubscribe|opt[- ]?out|mailing address|^sincerely|^best regards|^regards,/im, "writes the footer or sign-off, which code adds"],
  [/https?:\/\/|www\./i, "adds a link. Sources are added by code"],
  [/\[(name|firm|company|first ?name)\]|\{\{(?!claim:)/i, "left a placeholder"],
];

const SUBJECT_BANNED: [RegExp, string][] = [
  [/^\s*(re|fwd?|fw)\s*:/i, "pretends to be a reply or forward"],
  [/\b(urgent|important|action required|immediately|final notice|last chance|time[- ]sensitive)\b/i, "invents urgency"],
  [/\b(your|the) (permit|application|project|letter)\b/i, "reads like a message about their own permit, from the city or a client"],
  [/\b(city of|department of buildings|dob)\b/i, "could be mistaken for the city"],
  [/[A-Z]{5,}|!{1,}/, "shouts"],
];

/** Whether any significant word of a fact appears in the text. */
export function factUsed(value: string, text: string): boolean {
  return value.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 4).some((w) => text.toLowerCase().includes(w));
}

/** The deterministic gate on a model's draft. Anything with severity "block" can't reach the review queue. */
export function lintDraft(d: { subject: string; body: string; facts_used: string[] }, prospect: Prospect, variant: Variant, claims: Claim[]): Issue[] {
  const issues: Issue[] = [];
  const block = (code: string, message: string) => issues.push({ severity: "block", code, message });

  const subject = (d.subject ?? "").trim();
  if (!subject) block("subject_empty", "The subject is empty.");
  if (subject.length > 80) block("subject_long", "The subject is over 80 characters.");
  if (!/redline|correction/i.test(subject)) block("subject_content", 'The subject must say what the message is about: include "Redline" or "correction".');
  for (const [re, why] of SUBJECT_BANNED) if (re.test(subject)) block("subject_deceptive", `The subject ${why}: "${subject}".`);

  const used = claimsIn(d.body ?? "");
  for (const id of used) if (!claims.some((c) => c.id === id)) block("claim_unknown", `{{claim:${id}}} isn't in claims.json.`);
  for (const c of claims.filter((c) => c.required)) if (!used.includes(c.id)) block("claim_required_missing", `Every message must include {{claim:${c.id}}}.`);
  for (const id of variant.required_claims) if (!used.includes(id)) block("claim_variant_missing", `Variant ${variant.id} must include {{claim:${id}}}.`);

  // Everything below looks only at the model's own words. The approved claims are exempt because code controls them.
  const own = (d.body ?? "").replace(TOKEN, " ");
  for (const [re, why] of BANNED) {
    const m = own.match(re);
    if (m) block("banned_phrase", `The message ${why}: "${m[0]}".`);
  }
  // Restating an approved claim in the model's own words would get around the point of the tokens, and it reads badly.
  const wordsOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const ownText = ` ${wordsOf(own).join(" ")} `;
  for (const c of claims) {
    const w = wordsOf(c.wording);
    for (let i = 0; i + 4 <= w.length; i++) {
      const shingle = w.slice(i, i + 4).join(" ");
      if (ownText.includes(` ${shingle} `)) {
        block("claim_restated", `This restates claim ${c.id} in your own words ("${shingle}"). Insert {{claim:${c.id}}} and don't repeat what it says.`);
        break;
      }
    }
  }
  // A greeting by name must come from a fact the draft declares.
  const greeting = own.trim().match(/^(?:hi|hello|dear)\s+([A-Z][\w'-]+)/i)?.[1];
  if (greeting) {
    const known = [prospect.firm_name, ...(d.facts_used ?? []).map((id) => prospect.facts.find((f) => f.id === id)?.value ?? "")].join(" ").toLowerCase();
    if (!known.includes(greeting.toLowerCase())) block("name_unsourced", `The greeting uses "${greeting}", which isn't the firm's name or in a fact listed in facts_used.`);
  }
  const allowedNumbers = new Set(
    (d.facts_used ?? []).flatMap((id) => {
      const fact = prospect.facts.find((f) => f.id === id);
      return fact ? (fact.value.match(/\d[\d,.]*/g) ?? []) : [];
    }),
  );
  for (const num of own.match(/\d[\d,.]*/g) ?? []) {
    if (!allowedNumbers.has(num) && !allowedNumbers.has(num.replace(/[.,]$/, ""))) block("number_unsourced", `The number ${num} isn't in a fact you declared in facts_used.`);
  }
  for (const id of d.facts_used ?? []) {
    const fact = prospect.facts.find((f) => f.id === id);
    if (!fact) {
      block("fact_unknown", `Fact ${id} doesn't exist for this prospect.`);
    } else if (!factUsed(fact.value, own)) {
      block("fact_unused", `Fact ${id} is listed in facts_used, but nothing from it is in the message. Use it, or remove it from the list.`);
    }
  }
  const words = own.trim().split(/\s+/).filter(Boolean).length;
  if (words > 110) block("too_long", `${words} words of your own. The limit is 110.`);
  if (words < 15) block("too_short", `Only ${words} words of your own.`);
  return issues;
}

const FREEMAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "msn.com", "live.com", "comcast.net", "att.net", "sbcglobal.net"]);

export function isFreemail(domain: string): boolean {
  return FREEMAIL.has(domain.toLowerCase());
}

export function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/** True if this address or firm must never be contacted. Checked at research, draft, approval, export and logging. */
export function isSuppressed(target: { email?: string | null; domain?: string | null }, list: Suppression[]): Suppression | undefined {
  const email = target.email?.toLowerCase();
  const domain = (target.domain ?? (email ? domainOf(email) : "")).toLowerCase();
  const emailDomain = email ? domainOf(email) : "";
  return list.find((s) => (s.email && s.email.toLowerCase() === email) || (s.domain && (s.domain.toLowerCase() === domain || s.domain.toLowerCase() === emailDomain)));
}

export function validateSender(sender: Sender | null, dataset: string): Issue[] {
  const issues: Issue[] = [];
  const block = (code: string, message: string) => issues.push({ severity: "block", code, message });
  if (!sender) return [{ severity: "block", code: "sender_missing", message: "No sender.json. Copy outreach/sender.example.json to outreach/data/sender.json and fill it in." }];
  if (!sender.from_name?.trim()) block("sender_name", "from_name is empty.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender.from_email ?? "")) block("sender_email", "from_email isn't an email address.");
  if (!sender.organization?.trim()) block("sender_org", "organization is empty.");
  if (!/\b\d{5}(-\d{4})?\b/.test(sender.postal_address ?? "") || !/\d/.test((sender.postal_address ?? "").split(/\b\d{5}\b/)[0])) block("sender_address", "postal_address must be a full physical postal address with a street or box number and a ZIP code.");
  if (!sender.opt_out_mailbox_monitored) block("sender_optout", "Set opt_out_mailbox_monitored to true only once you're checking from_email for unsubscribe replies. The opt-out has to work.");
  if (dataset === "real" && /\.(example|test|invalid)$|example\.(com|org)$/i.test(sender.from_email ?? "")) block("sender_fictional", "A fictional sender can't be used in the real home.");
  return issues;
}

/** The whole message a person sends. The footer comes from code, so the model can't drop it or reword it. */
export function renderMessage(m: Pick<Message, "subject" | "body" | "to_email" | "contact_form_url" | "dataset">, sender: Sender, claims: Claim[]): string {
  const used = claimsIn(m.body).map((id) => claims.find((c) => c.id === id)).filter((c): c is Claim => Boolean(c));
  const sources = [...new Set(used.map((c) => c.source_url))];
  const banner = m.dataset === "test" ? "[FICTIONAL TEST DATA. DO NOT SEND.]\n\n" : "";
  return [
    `${banner}To: ${m.to_email ?? `(website form) ${m.contact_form_url}`}`,
    `From: ${sender.from_name} <${sender.from_email}>`,
    `Subject: ${sender.subject_prefix ?? ""}${m.subject.trim()}`,
    "",
    expandClaims(m.body, claims).trim(),
    "",
    sender.from_name,
    sender.organization,
    "",
    "--",
    `This email is an advertisement for ${sender.organization}'s product, Redline.`,
    sender.postal_address,
    `To stop hearing from me, reply with the word "unsubscribe" to ${sender.from_email}. I'll remove you and won't write again.`,
    `Sources: ${sources.join(" ")}`,
  ].join("\n");
}

export function renderedSha(rendered: string): string {
  return sha(rendered).slice(0, 12);
}

// ---------- contact limits ----------

const DAY = 86_400_000;

/** Messages this person may still send today, counting sends and anything already exported and waiting to go out. */
export function quota(policy: Policy, messages: Message[], events: OutreachEvent[], at: Date): { today: number; week: number; remaining: number } {
  const { max_per_day, max_per_week } = policy.contact_limits;
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  let today = 0;
  let week = 0;
  for (const m of messages) {
    const s = messageState(m.id, events);
    const sentAt = s.sent_at ? new Date(s.sent_at).getTime() : null;
    if (sentAt !== null) {
      if (sentAt >= start.getTime() && sentAt <= at.getTime()) today += 1;
      if (at.getTime() - sentAt < 7 * DAY && sentAt <= at.getTime()) week += 1;
    } else if (s.exported && !s.bounced) {
      today += 1;
      week += 1;
    }
  }
  return { today, week, remaining: Math.max(0, Math.min(max_per_day - today, max_per_week - week)) };
}

/** Why this firm can't get another message right now, if it can't. Unsent, rejected and blocked drafts don't count as contact. */
export function touchProblem(domain: string, policy: Policy, messages: Message[], events: OutreachEvent[], at: Date): string | null {
  const touches = messages.filter((m) => m.domain === domain).map((m) => messageState(m.id, events).sent_at).filter((s): s is string => Boolean(s));
  if (touches.length >= policy.contact_limits.max_touches_per_domain) return `already contacted ${touches.length} time(s), the limit is ${policy.contact_limits.max_touches_per_domain}`;
  const last = touches.sort().pop();
  if (last && at.getTime() - new Date(last).getTime() < policy.contact_limits.min_days_between_touches_same_domain * DAY) return `last contacted on ${last.slice(0, 10)}`;
  return null;
}
