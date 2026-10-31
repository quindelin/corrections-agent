// What the learning step may change, enforced in code. This repo learned why: a shared-playbook rule that only suited one city
// caused a regression, and a self-improvement run deleted another city's rule. Prompts didn't stop either.

import type { Law, Target } from "./lib.ts";
import type { Claim, Rule } from "./playbook.ts";
import type { EvidenceRow } from "./stats.ts";

export interface ProposedOp {
  op: "add" | "retire";
  scope: string;
  kind?: string;
  text?: string;
  rule_id?: string;
  based_on: string[];
  claim?: string | null;
  why?: string;
}

const STATE_NAMES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
const LOCAL_TERMS = /\b(FOIA|CORA|CPRA|PRA|RCW|ILCS|A\.R\.S|ORS|C\.R\.S|Gov\.? Code|PAC|Public Access Counselor|SDCI|NextRequest|GovQA|ProjectDox|Hansen|Accela|Laserfiche|mycusthelp|Socrata|TDC|PRO)\b|\b\d+\(\d+\)(\([a-z]+\))?|\b\d+-\d+\.\d+|\bsection \d/;
const USPS = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

/** Names any place, agency or local system. Terms come from the data, so adding a target extends the check. */
export function localTerms(text: string, targets: Target[], laws: Law[]): string[] {
  const found = new Set<string>();
  const words = new Set<string>(STATE_NAMES);
  for (const t of targets) {
    words.add(t.place.replace(/-(co|county|or|wa|az|ca|il)$/i, "").replace(/-/g, " "));
    const stripped = t.agency.replace(/^(City|County|Town|Village) of /, "").split(/[,(]/)[0].trim();
    for (const piece of stripped.split(/\s+(?:Department|Open|Planning|Community)\b/)) if (piece.trim().length >= 4) words.add(piece.trim());
  }
  for (const l of laws) words.add(l.name);
  for (const w of words) if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) found.add(w);
  const m = text.match(LOCAL_TERMS);
  if (m) found.add(m[0]);
  const u = text.match(USPS);
  if (u) found.add(u[0]);
  return [...found];
}

/** The hard limits. Outcomes might suggest that hiding the commercial purpose gets faster answers, and no result may change these. */
const HARD_LIMITS: [RegExp, string][] = [
  [/\b(omit|hide|remove|drop|avoid|skip|downplay|soften|without (mentioning|disclosing|stating)|don'?t (mention|disclose|state|say))\b[^.]{0,60}\b(commercial|purpose|who('s| is) asking|paid|charge|product|company|for[- ]profit|business)\b/i, "suggests hiding who's asking or why"],
  [/\b(commercial|purpose|paid|for[- ]profit)\b[^.]{0,40}\b(omit|hide|remove|drop|avoid|skip|leave out|downplay|soften|unnecessary|optional|delays?|slows?)\b/i, "suggests the purpose statement should go or be softened"],
  [/\b(do not|don'?t|doesn'?t|does not|not|without|never|no)\s+(mention\w*|disclos\w*|stat\w*|say\w*|includ\w*|referenc\w*|declar\w*)\b[^.]{0,60}\b(commercial|purpose|paid|for[- ]profit|business use)\b/i, "passes along a preference for not stating the purpose"],
  [/\b(student|journalist|reporter|press|academic|university|non-?profit|researcher|government|non-?commercial)\b/i, "implies an affiliation or a non-commercial purpose"],
  [/\b(crawl|scrap\w+|automat\w+|bot\b|bypass|captcha|robots\.txt|get around|work around|log ?in|someone else'?s (account|login))\b/i, "suggests automated access or getting around a block"],
  [/\b(send|submit|file)\b[^.]{0,30}\b(automatic\w*|without (review|approval|a person)|directly)\b/i, "suggests sending without a person"],
  [/\b(more requests|multiple requests|many requests|repeat(ed)? requests?|resend|flood|every (week|day)|split\w* (the|a|into))\b/i, "suggests more or repeated requests, which limits forbid"],
];

const CONCLUSION = /\b(proven|shows that|data shows|results show|works? best|works? better|always|never|every agency|all agencies|guarantee\w*|significantly|because of|caused|leads? to|results? in)\b/i;
const RATES = /\d+(\.\d+)?\s*%|\b\d+ (of|out of) \d+\b|\b\d+\/\d+\b/;
const LAW_STATEMENT = /\b(is exempt|are exempt|the law|statute|legally|by law|deadline is|must respond|required to respond|illegal|unlawful|violat\w+)\b/i;
const CONTACT = /[\w.+-]+@[\w-]+\.\w+|\b\d{3}[-. )]\s?\d{3}[-. ]\d{4}\b/;

export function claimHolds(claim: string, r: EvidenceRow): boolean {
  if (claim === "usable") return r.usable_records > 0;
  if (claim === "no_usable") return r.closed && r.usable_records === 0;
  if (claim === "denied") return r.denied;
  if (claim === "fee_quoted") return r.fee_quoted_usd !== null;
  if (claim === "responded") return r.responded;
  if (claim === "no_response") return r.closed && !r.responded;
  if (claim === "narrowed_then_usable") return r.narrowed && r.usable_records > 0;
  if (claim.startsWith("exemption:")) return r.exemptions.some((e) => e.toLowerCase().includes(claim.slice(10).toLowerCase()));
  return false;
}

/** Counted by code from every request in the scope, so counterexamples can't be left out. */
export function tallyFor(claim: string, scope: string, rows: EvidenceRow[]): string {
  const inScope = rows.filter((r) => scope === "general" || r.place === scope);
  const k = inScope.filter((r) => claimHolds(claim, r)).length;
  return `Claim "${claim}" held on ${k} of ${inScope.length} sent requests in this scope. Few requests: treat as a lead, not a finding.`;
}

export interface ScopeContext {
  rules: Rule[];
  places: string[];
  rows: EvidenceRow[];
  targets: Target[];
  laws: Law[];
  privateStrings: string[];
  recordTexts: string[];
  minPlaces: number;
  minStates: number;
}

/** Why an op can't be applied. Empty means it can. */
export function opProblems(op: ProposedOp, ctx: ScopeContext): string[] {
  const problems: string[] = [];
  const isGeneral = op.scope === "general";
  if (!isGeneral && !ctx.places.includes(op.scope)) problems.push(`"${op.scope}" isn't a known place. A place file exists only for a target in targets.json.`);
  const byId = new Map(ctx.rows.map((r) => [r.id, r]));
  const evidence = (op.based_on ?? []).map((id) => byId.get(id));
  if (!op.based_on?.length) problems.push("It cites no requests. Every change needs evidence.");
  (op.based_on ?? []).forEach((id, i) => { if (!evidence[i]) problems.push(`It cites ${id}, which isn't a sent request.`); });
  const found = evidence.filter((e): e is EvidenceRow => !!e);
  if (!isGeneral) for (const e of found) if (e.place !== op.scope) problems.push(`A rule for ${op.scope} can't rest on ${e.id} from ${e.place}. Evidence from one place says nothing about another.`);

  if (op.op === "retire") {
    const rule = ctx.rules.find((r) => r.id === op.rule_id);
    if (!rule) return [...problems, `There's no rule ${op.rule_id}.`];
    if (rule.scope !== op.scope) problems.push(`Rule ${rule.id} belongs to ${rule.scope}. It can't be retired from ${op.scope}.`);
    if (rule.locked) problems.push(`Rule ${rule.id} is locked. Only a person can change it, by hand.`);
    if (rule.status === "retired") problems.push(`Rule ${rule.id} is already retired.`);
    if (rule.kind === "principle" && !rule.locked && rule.scope === "general") problems.push(`Rule ${rule.id} is a starting principle. Only a verdict or a person retires it, not a few outcomes.`);
    if (rule.scope === "general") {
      const places = new Set(found.map((e) => e.place));
      if (places.size < ctx.minPlaces) problems.push(`Retiring a general rule needs evidence from ${ctx.minPlaces} places, not ${places.size}. If it fails only in one place, add an exception to that place's file.`);
    }
    return problems;
  }

  const text = (op.text ?? "").trim();
  if (!text) problems.push("It has no text.");
  if (text.length > 240) problems.push("It's over 240 characters. A rule is one line.");
  if (!op.kind || !["hypothesis", "observation"].includes(op.kind)) problems.push(op.kind === "learned" ? "Only code declares a rule learned, and only when the verdict supports it." : `Kind must be hypothesis or observation, not "${op.kind}".`);
  for (const [re, why] of HARD_LIMITS) if (re.test(text)) problems.push(`It ${why}, which no result can change: "${text.slice(0, 100)}".`);
  if (CONCLUSION.test(text)) problems.push(`It states a conclusion these numbers can't support: "${text.match(CONCLUSION)?.[0]}". Write it as something to try.`);
  if (RATES.test(text)) problems.push("It quotes a rate or a count. Code writes tallies.");
  if (LAW_STATEMENT.test(text)) problems.push("It states law. Law lives in laws.json, which a person maintains.");
  if (CONTACT.test(text)) problems.push("It contains contact details.");
  const lower = text.toLowerCase();
  for (const s of ctx.privateStrings) if (s.length >= 4 && lower.includes(s.toLowerCase())) problems.push(`It contains private text ("${s}").`);
  for (const record of ctx.recordTexts) {
    const words = record.split(/\s+/);
    for (let i = 0; i + 8 <= words.length; i += 4) if (text.includes(words.slice(i, i + 8).join(" "))) problems.push(`It quotes a received record: "${words.slice(i, i + 8).join(" ")}".`);
  }

  if (op.claim) {
    const claim = op.claim as Claim;
    for (const e of found) if (!claimHolds(claim, e)) problems.push(`False evidence: it says "${claim}" but ${e.id} doesn't show that.`);
  } else {
    problems.push(`It needs a claim that code can check against the cited requests, such as "usable", "denied" or "exemption:<text>".`);
  }

  if (isGeneral) {
    const terms = localTerms(text, ctx.targets, ctx.laws);
    if (terms.length) problems.push(`A general rule can't name a place, agency, law or local system (${terms.join(", ")}). Put it in that place's file.`);
    if (op.kind === "observation") problems.push("An observation records what one place did, so it goes in that place's file.");
    const places = new Set(found.map((e) => e.place));
    const states = new Set(found.map((e) => e.state));
    if (places.size < ctx.minPlaces || states.size < ctx.minStates) problems.push(`A general rule needs evidence from ${ctx.minPlaces} places in ${ctx.minStates} states, and this has ${places.size} and ${states.size}. Put it in that place's file.`);
  }
  return problems;
}
