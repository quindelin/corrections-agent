// A deterministic check on the agent's output. It runs before anything is saved or shown, whatever the model did.
// No model calls and no file reads: same items, letter and packs in, same result out.
//
// What it does to a draft is deliberately narrow. Text changes only where a fixed pattern is known to leave a sound
// sentence; everything else stays as written and gets a flag for the reviewer.
//
//   compliance claim   flagged. Rewritten only for "will be revised to comply with X" and its close relatives.
//   process wording    another place's wording is removed if the sentence shape is known, otherwise flagged.
//   citation           the citation field is cleared and flagged if it isn't in this place's index.
//                      One written into the draft is flagged, because cutting it could garble the sentence.
//   number             flagged only. A number may be legitimate.
//   route              a comment with clear signs of professional judgment moves to licensed_review, and is flagged.

import type { Item } from "../evals/score.ts";

export type GuardRule = "compliance_claim" | "foreign_process" | "citation_not_in_index" | "citation_in_draft" | "invented_number" | "route_forced" | "empty_draft" | "unknown_comment";

export interface GuardFlag {
  rule: GuardRule;
  /** What the guard did about it. */
  action: "rewritten" | "removed" | "cleared" | "flagged" | "rerouted";
  /** review: a person must look. info: a safe change was made, and is recorded so it can be checked. */
  level: "review" | "info";
  message: string;
  /** The wording or value that was changed or questioned. Not shown on a locked item. */
  before?: string;
  after?: string;
}

export type GuardedItem = Item & { flags: GuardFlag[]; agent_route?: string };

export interface GuardPack {
  profile: {
    id: string;
    process_wording?: { terms?: string[]; marking_phrases?: string[]; protocol_phrases?: string[] };
    citation_format?: { find?: string; section?: string };
  };
  code: { id: string }[];
}

export interface GuardLetter {
  project: { jurisdiction: string; address: string; description: string; reviewer?: string };
  sheets?: { id: string; title?: string }[];
  comments: { id: string; text: string }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- sentences ----------

const ABBREVIATION = /(?:^|[\s(])(?:sec|nos?|dr|st|ave|inc|ltd|co|e\.g|i\.e|approx|min|max|vs|fig|vol|rev)\.$/i;

/** Splits into sentences and the whitespace after each, so unchanged text comes back exactly as it was. */
function splitSentences(text: string): { text: string; gap: string }[] {
  const out: { text: string; gap: string }[] = [];
  const boundary = /[.!?]['"”’)]*(\s+)(?=['"“‘(]?[A-Z0-9])/g;
  let start = 0;
  for (const m of text.matchAll(boundary)) {
    const end = m.index + m[0].length - m[1].length;
    if (ABBREVIATION.test(text.slice(start, end))) continue;
    out.push({ text: text.slice(start, end), gap: m[1] });
    start = end + m[1].length;
  }
  if (start < text.length) out.push({ text: text.slice(start), gap: "" });
  return out;
}

const joinSentences = (parts: { text: string; gap: string }[]) => parts.map((p, i) => p.text + (i < parts.length - 1 ? p.gap || " " : "")).join("");

// ---------- compliance claims ----------

// Everything the frozen scorer counts, plus wider wording it misses, so nothing it would catch can pass unexamined.
const COMPLIANCE_WORDS =
  /\b(compl(?:y|ies|ied|iant|iance|ying)|meet(?:s|ing)?(?: \w+){0,3} (?:code|codes|requirements?|standards?|criteria)|meet(?:s|ing)?(?: \w+){0,2} (?:required|applicable|minimum|maximum|allowable)\b|code[- ]conforming|satisf(?:y|ies|ied|ying)|demonstrat(?:e|es|ing) that [^.;]*\b(?:under|within|less than|at least|no more than|not exceed|maximum|minimum)\b|confirmed to (?:not exceed|be within)|conform(?:s|ed|ing|ance)?(?: (?:to|with))?|up to code|adher(?:es?|ing) to)\b/gi;

// Wording that uses those words without saying the plans meet code. Blanked out before looking for a claim.
const NOT_A_CLAIM: RegExp[] = [
  // The names of documents, forms and choices. "Compliance Certificate" says nothing about whether plans comply.
  /\b(?:compliance|conformance)\s+(?:certificates?|reports?|calculations?|calcs?|notes?|options?|paths?|pathways?|worksheets?|forms?|statements?|documentation|documents?|matrix|checklists?|summar(?:y|ies)|methods?)\b/gi,
  /\bPerformance[- ]Based Compliance\b/gi,
  /\b(?:statement|letter|note|certificate)\s+(?:regarding|of|on)\s+compliance\b/gi,
  /\b(?:used|option)\s+[^.;]{0,40}\bfor\s+[\w -]{0,50}\bcompliance\b/gi,
  /\b(?:reference|references)\s+to\s+[^.;]{0,40}\bcompliance\b/gi,
  // Saying something falls short, or that it must be fixed.
  /\bnon-?compl\w+/gi,
  /\b(?:does|do|did|would|will)\s+not\s+(?:comply|conform|meet|satisfy)\b/gi,
  /\bnot\s+(?:in\s+)?(?:compliance|compliant|conforming|conformance)\b/gi,
  /\bfails?\s+to\s+(?:comply|conform|meet|satisfy)\b/gi,
  /\b(?:must|shall|should|needs? to|has to|have to|required to)\s+(?:comply|conform|meet|satisfy)\b/gi,
  // A question about whether work is needed, not an answer: "confirming the need for updates to meet standards".
  /\b(?:need|needed|necessary)\b[^.;]{0,120}\bto\s+meet\b/gi,
  // The city's own notice, which some letters ask to have repeated on the plans.
  /\b(?:has|have|been)\s+(?:been\s+)?reviewed\s+for\b[^.;]*/gi,
  // Leaving the question open, or for the professional to answer.
  /\b(?:verify|verifying|determine|determining|check|checking|review|reviewing|reviewed|evaluate|evaluating|assess|assessing)\s+(?:\w+\s+){0,2}?(?:for\s+)?(?:\w+\s+)?(?:compliance|conformance)\b/gi,
  /\b(?:professional|architect|engineer|designer)\b[^.;]{0,40}\b(?:confirm|confirms|confirming)\s+(?:\w+\s+){0,2}?(?:compliance|conformance)\b/gi,
  /\bwhether\b[^.;]*\b(?:complies|comply|conforms|conform|meets|meet|satisfies|satisfy)\b/gi,
];

// A plain statement that something complies now, rather than a promise about a revision still to come.
const ASSERTION =
  /(?<!\b(?:to|will|shall|must|would|can|may|should|could|might|and|or)\s)\b(?:comply|conform|meet|satisfy)\b|\b(?:complies|complied|conforms|conformed|satisfies|satisfied|meets|adheres to|up to code)\b|\b(?:is|are|was|were|now|fully|been)\s+(?:\w+\s+)?(?:compliant|conforming|in\s+(?:full\s+)?(?:compliance|conformance))\b|\b(?:has|have|had)\s+been\s+\w+\s+to\s+(?:comply|conform|meet|satisfy)\b|\b(?:was|were)\s+\w+\s+to\s+(?:comply|conform|meet|satisfy)\b|\bbrought\s+into\s+(?:compliance|conformance)\b/i;

// The only rewrites. Each keeps the sentence's subject and object and says less, and the flag keeps the original.
const SAFE_REWRITES: [RegExp, string][] = [
  [/\bwill be revised to (?:comply with|demonstrate compliance with|show compliance with)\s+/i, "will be revised to address "],
  [/\bwill be provided (?:to demonstrate|demonstrating|showing) compliance with\s+/i, "will be provided to address "],
];
// An outcome promised elsewhere in the sentence would survive the rewrite, so those are left for the reviewer.
const UNSAFE_TO_REWRITE = /\b(?:ensur\w+|guarantee\w*|certif\w+)\b/i;

export type ComplianceKind = "assertion" | "promise";

/** The sentence with non-claims blanked out, including anything quoted word for word from the letter. */
function maskNonClaims(sentence: string, letterText: string): string {
  const unquoted = sentence.replace(/(['"“‘])([^'"”’]{8,})(?:['"”’])/g, (whole, _q, inner: string) => (letterText.includes(inner.trim().toLowerCase().replace(/[,.]$/, "")) ? " ".repeat(whole.length) : whole));
  return NOT_A_CLAIM.reduce((s, re) => s.replace(re, (m) => " ".repeat(m.length)), unquoted);
}
const claimWords = (sentence: string, letterText: string) => [...maskNonClaims(sentence, letterText).matchAll(COMPLIANCE_WORDS)].map((m) => m[0]);

/** Whether a sentence claims compliance, and how directly. null means it doesn't. Exported for the measurement. */
export function classifyCompliance(sentence: string, letterText = ""): ComplianceKind | null {
  if (!claimWords(sentence, letterText).length) return null;
  return ASSERTION.test(maskNonClaims(sentence, letterText)) ? "assertion" : "promise";
}

function guardCompliance(draft: string, letterText: string, flags: GuardFlag[]): string {
  const parts = splitSentences(draft);
  for (const part of parts) {
    const kind = classifyCompliance(part.text, letterText);
    if (!kind) continue;
    let rewritten: string | null = null;
    if (kind === "promise" && !UNSAFE_TO_REWRITE.test(part.text) && claimWords(part.text, letterText).length === 1) {
      for (const [re, to] of SAFE_REWRITES) {
        if (!re.test(part.text)) continue;
        const candidate = part.text.replace(re, to);
        if (!classifyCompliance(candidate, letterText)) rewritten = candidate;
        break;
      }
    }
    if (rewritten) {
      flags.push({ rule: "compliance_claim", action: "rewritten", level: "review", message: "Reworded a promise of code compliance. Only a licensed professional can state that conclusion; restore it once it has been checked.", before: part.text, after: rewritten });
      part.text = rewritten;
    } else {
      const message = kind === "assertion" ? "States that something meets code. Only a licensed professional can make that conclusion." : "Promises code compliance. Only a licensed professional can make that conclusion.";
      flags.push({ rule: "compliance_claim", action: "flagged", level: "review", message, before: part.text });
    }
  }
  return joinSentences(parts);
}

// ---------- another place's process wording ----------

function termRe(term: string): RegExp {
  const open = term.endsWith("*");
  const body = escapeRe(open ? term.slice(0, -1) : term).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${body}${open ? "\\w*" : "\\b"}`, "i");
}
const phraseSource = (phrase: string) => escapeRe(phrase).replace(/,\s+/g, ",?\\s+").replace(/\s+and\s+/g, ",?\\s+and\\s+").replace(/\s+(?![^(]*\))/g, "\\s+");
const alternation = (phrases: string[]) => [...phrases].sort((a, b) => b.length - a.length).map(phraseSource).join("|");

interface ForeignWording {
  terms: { term: string; re: RegExp }[];
  marking: string;
  protocol: string;
  /** True when this place has a pack, so we know the wording really isn't theirs. Otherwise it's only flagged. */
  removable: boolean;
}

function foreignWording(jurisdiction: string, packs: GuardPack[], letterText: string): ForeignWording {
  const own = packs.find((p) => p.profile.id === jurisdiction);
  const ownTerms = new Set((own?.profile.process_wording?.terms ?? []).map((t) => t.toLowerCase()));
  const others = packs.filter((p) => p.profile.id !== jurisdiction);
  // Wording the city itself used in this letter is its wording, whichever pack it's listed in.
  const inPlay = (t: string) => !ownTerms.has(t.toLowerCase()) && !termRe(t).test(letterText);
  const terms = others.flatMap((p) => p.profile.process_wording?.terms ?? []).filter(inPlay);
  const live = terms.map((term) => ({ term, re: termRe(term) }));
  const carriesLiveTerm = (phrase: string) => live.some((t) => t.re.test(phrase));
  return {
    terms: live,
    marking: alternation(others.flatMap((p) => p.profile.process_wording?.marking_phrases ?? []).filter(carriesLiveTerm)),
    protocol: alternation(others.flatMap((p) => p.profile.process_wording?.protocol_phrases ?? []).filter(carriesLiveTerm)),
    removable: Boolean(own),
  };
}

/** The sentence without the wording, or null to drop it whole, or undefined when no known shape fits. */
function withoutForeignWording(sentence: string, w: ForeignWording): string | null | undefined {
  const be = "(?:will\\s+be|shall\\s+be|must\\s+be|to\\s+be|is|are)";
  const proto = w.protocol ? `\\s+per\\s+(?:${w.protocol})` : "";
  const tail = `(?:${proto ? `${proto}|` : ""}\\s+to\\s+indicate\\s+[^.;]*|\\s+on\\s+[^.;]*)?`;
  const end = `([.!?]['"”’)]*)$`;
  const stillForeign = (s: string) => w.terms.some((t) => t.re.test(s));

  if (w.marking) {
    // "The revision will be bubbled, dated and initialed per Certified Plan Corrections protocol."
    const only = sentence.match(new RegExp(`^(.*?)\\s${be}\\s+(?:${w.marking})${tail}${end}`, "i"));
    if (only && !/\b(?:will|shall|must)\b/i.test(only[1]) && only[1].split(/\s+/).length <= 15) return null;

    // "... will be updated and will be bubbled, dated and initialed." Also "..., and the revision will be bubbled ..."
    const clause = new RegExp(`(,?)\\s+and\\s+(?:(?:the|this|these|all)(?:\\s+[\\w-]+){0,4}\\s+)?${be}\\s+(?:${w.marking})${tail}${end}`, "i");
    const m = sentence.match(clause);
    if (m) {
      const head = sentence.slice(0, m.index);
      // "uploaded to the portal, embedded in the set, and will be bubbled" would lose the "and" its list needs.
      if (m[1] && /,\s+\w+ed\b[^,]*$/.test(head)) return undefined;
      const result = head.replace(/,(['"”’])$/, "$1") + m[m.length - 1];
      return stillForeign(result) ? undefined : result;
    }
  }
  if (w.protocol) {
    // "... will be included in the resubmission, all marked per Certified Plan Corrections protocol."
    const trailing = new RegExp(`,?\\s+(?:all\\s+)?(?:marked\\s+)?per\\s+(?:${w.protocol})${end}`, "i");
    const m = sentence.match(trailing);
    if (m) {
      const result = sentence.slice(0, m.index) + m[m.length - 1];
      return stillForeign(result) ? undefined : result;
    }
  }
  return undefined;
}

function guardForeign(draft: string, wording: ForeignWording, flags: GuardFlag[]): string {
  const parts = splitSentences(draft);
  const kept: typeof parts = [];
  const removed: string[] = [];
  for (const part of parts) {
    const hits = wording.terms.filter((t) => t.re.test(part.text));
    if (!hits.length) {
      kept.push(part);
      continue;
    }
    const result = wording.removable ? withoutForeignWording(part.text, wording) : undefined;
    if (result === undefined) {
      flags.push({ rule: "foreign_process", action: "flagged", level: "review", message: `Uses wording from another city's process: ${hits.map((h) => h.term.replace(/\*$/, "")).join(", ")}. Check it against this city's rules.`, before: part.text });
      kept.push(part);
    } else {
      removed.push(part.text);
      if (result !== null) kept.push({ ...part, text: result });
    }
  }
  if (removed.length) flags.push({ rule: "foreign_process", action: "removed", level: "info", message: "Removed revision-marking wording from another city's process.", before: removed.join(" ") });
  return joinSentences(kept);
}

// ---------- citations ----------

// "SEC" alone is the Seattle Energy Code, so only "Sec." with its period counts as the word "section".
const clean = (raw: string) => raw.toUpperCase().replace(/\b(?:SECTION|SEC\.|TABLE|CHAPTER)\s*/g, "").replace(/§\s*/g, "").replace(/\s+/g, " ").trim();

/** Whether a citation is in the index. A subsection counts as its section, but a section doesn't count as its chapter. */
export function citationInIndex(raw: string, pack: GuardPack | undefined): boolean {
  if (!pack) return false;
  const ids = new Set(pack.code.map((s) => s.id.toUpperCase()));
  const id = clean(raw);
  if (ids.has(id)) return true;
  const section = pack.profile.citation_format?.section;
  const m = section ? id.match(new RegExp(section)) : null;
  // What follows the section has to be a subdivision, so SBC 1011999 isn't taken for SBC 1011.
  return Boolean(m && ids.has(m[1] ?? m[0]) && !/^[0-9A-Z]/.test(id.slice(m[0].length)));
}

function findCitations(text: string, pack: GuardPack | undefined): string[] {
  const find = pack?.profile.citation_format?.find;
  if (!find) return [];
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(find, "gi"))) {
    const raw = m[0].replace(/[.\-]+$/, "");
    const opens = (raw.match(/\(/g) ?? []).length;
    const closes = (raw.match(/\)/g) ?? []).length;
    found.push(closes > opens ? raw.replace(/\)+$/, "") : raw);
    // "SBC 704, 706 and 707": the later numbers belong to the same code.
    const family = raw.match(/^[A-Z]+\s/i)?.[0];
    if (!family) continue;
    const rest = text.slice(m.index + m[0].length);
    for (const more of rest.match(/^(?:(?:,|\s+and|\s+or|\s*&)\s*\d{3,4}\b)+/i)?.[0].matchAll(/\d{3,4}/g) ?? []) found.push(family + more[0]);
  }
  return found;
}

function guardCitationField(item: Item, pack: GuardPack | undefined, letterText: string, flags: GuardFlag[]): string | null {
  const raw = item.citation;
  if (!raw) return raw;
  const parts = findCitations(raw, pack);
  const several = parts.length > 1 ? parts : [raw];
  const good = several.filter((c) => citationInIndex(c, pack));
  if (good.length === several.length) return raw;
  const bad = several.filter((c) => !citationInIndex(c, pack));
  const mentioned = bad.some((c) => referenceKey(letterText).includes(referenceKey(c)));
  const where = pack ? "isn't in this city's code index" : "can't be checked, because there is no code index for this city";
  flags.push({
    rule: "citation_not_in_index",
    action: "cleared",
    level: "review",
    message: `Removed the citation ${bad.join(", ")}: it ${where}.${mentioned ? " The letter itself mentions it, so it may be right; confirm it before adding it back." : " Confirm the governing section."}`,
    before: raw,
    after: good.length ? good.join("; ") : undefined,
  });
  return good.length ? good.join("; ") : null;
}

// Reviewers punctuate references freely: "SDPWS - 4.3.6" and "SDPWS 4.3.6" are the same reference.
const referenceKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, "");

function guardCitationsInDraft(draft: string, pack: GuardPack | undefined, letterText: string, flags: GuardFlag[]) {
  const unknown = findCitations(draft, pack).filter((c) => !citationInIndex(c, pack));
  // Standards and rules the index doesn't hold at all: the letter is the only thing that can vouch for them.
  const outside = OUTSIDE_REFERENCES.flatMap((re) => [...draft.matchAll(re)].map((m) => m[0].replace(/[.,;:)]+$/, "")));
  const letterKey = referenceKey(letterText);
  const bad = [...new Set([...unknown, ...outside].filter((c) => !letterKey.includes(referenceKey(c))))];
  if (bad.length) flags.push({ rule: "citation_in_draft", action: "flagged", level: "review", message: `The draft cites ${bad.join(", ")}. ${bad.length === 1 ? "That isn't" : "Those aren't"} in this city's code index or the letter, so confirm before filing.`, before: bad.join(", ") });
}

// ---------- numbers ----------

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

// References to other documents. Their digits are identifiers, not values, and the citation check looks at the code ones.
const OUTSIDE_REFERENCES: RegExp[] = [
  /\b(?:RCW|WAC|IBC|IRC|IFC|IEBC|NEC|UPC|ASCE|ACI|AISC|ANSI|ASTM|ASHRAE|NFPA|NDS|SDPWS|AWC|ICC-ES|ESR|BMP|TIP|Tip|DR)[\s-]*[A-Z]?\d[\w.()/-]*(?:\s+\d[\d.]*)?/g,
  /\bDirector['’]?s\s+Rules?\s+\d[\w-]*(?:\s+(?:or|and)\s+\d[\w-]*)?/gi,
];
const REFERENCES: RegExp[] = [/\bhttps?:\/\/\S+/gi, ...OUTSIDE_REFERENCES, /\b(?:Section|Sec\.|Table|§)\s*[A-Z]?\d[\w.()-]*/gi];

const normalizeNumber = (n: string) => {
  const plain = n.replace(/,/g, "");
  return plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain;
};
// Things like A3.1, S-1 and R-21: a sheet or a design value, compared as a whole so R-10 doesn't pass because a 10 is nearby.
const LABELLED = /\b[A-Z]{1,3}-?\d+(?:[.-]\d+)*/g;
const PLAIN_NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const labelKey = (s: string) => s.toUpperCase().replace(/-/g, "");

function allowedNumbers(letterText: string): { values: Set<string>; labels: Set<string> } {
  const values = new Set<string>();
  const labels = new Set<string>();
  for (const m of letterText.matchAll(PLAIN_NUMBER)) values.add(normalizeNumber(m[0]));
  for (const m of letterText.toUpperCase().matchAll(LABELLED)) labels.add(labelKey(m[0]));
  NUMBER_WORDS.forEach((w, i) => {
    if (new RegExp(`\\b${w}\\b`, "i").test(letterText)) values.add(String(i));
  });
  return { values, labels };
}

/** Numbers in a draft that appear nowhere in the letter or project. Exported for the measurement. */
export function inventedNumbers(draft: string, letterText: string, pack?: GuardPack): string[] {
  const allowed = allowedNumbers(letterText);
  let text = draft;
  const find = pack?.profile.citation_format?.find;
  if (find) text = text.replace(new RegExp(`${find}(?:(?:,|\\s+and|\\s+or|\\s*&)\\s*\\d{3,4}\\b)*`, "gi"), " ");
  for (const re of REFERENCES) text = text.replace(re, " ");
  // List markers the agent added: "(1)", "1)" and a leading "1."
  text = text.replace(/\(\d{1,2}\)|(?:^|\s)\d{1,2}\)(?=\s)|(?:^|\s)\d{1,2}\.(?=\s+[A-Za-z])/g, " ");
  const out: string[] = [];
  text = text.replace(LABELLED, (token) => {
    if (!allowed.labels.has(labelKey(token))) out.push(token);
    return " ";
  });
  for (const m of text.matchAll(PLAIN_NUMBER)) if (!allowed.values.has(normalizeNumber(m[0]))) out.push(m[0]);
  return [...new Set(out)];
}

// ---------- route safety ----------

const WHOLE_COMMENT_FYI = /\b(?:FYI only|for information only|no (?:correction )?response (?:is )?required|no action (?:is )?required)\b(?! for\b)/i;
const FYI_SENTENCE = /\b(?:FYI|for your information)\b/i;
// Words here say what the comment is under, not what it asks for. "Ordinance Structural (4)" is a reviewer's heading,
// and "reviewed for structural conformance" is the code-edition notice.
const NOT_THE_REQUEST: RegExp[] = [/[^.]*\breviewed for (?:\w+ )?conformance\b[^.]*\.?/gi, /\b(?:Ordinance|Structural|Engineer|Energy|Fire|Zoning|Drainage|Geotech\w*)(?: \w+){0,3} \(\d+\)\s*$/i];
const DECLINED = /\b(?:not required|not needed|no longer|has been received|have been received|was received|were received|thank you|no (?:further )?(?:changes?|comments?|corrections?))\b/i;

const JUDGMENT_SIGNALS: [string, RegExp][] = [
  ["structural design", /\bshear ?walls?\b|\blateral (?:loads?|system|design|analysis|forces?)\b|\bload path\b|\bhold ?downs?\b|\buplift\b|\bseismic\b|\bgravity (?:loads?|design)\b|\bmember sizes?\b/i],
  ["structural work", /\bstructural (?:calculations?|calcs?|plans?|details?|alterations?|design|analysis|drawings?|engineer)\b|(?:^|[.:]\s*)structural\s*[-–:.]\s/i],
  ["geotechnical design", /\bearth pressures?\b|\bbearing capacity\b|\bgeotechnical (?:recommendations?|design)\b|\bdo(?:es)? not match the geotechnical report\b/i],
  ["fire-rated construction", /\b(?:fire|one|two|1|2)[- ](?:hour[- ])?(?:fire[- ])?rat(?:ed|ing)\b|\bfire[- ]resist\w+|\bfire separation\b|\bfire[- ]rating\b/i],
  ["egress", /\bemergency escape\b|\begress (?:windows?|doors?|widths?|paths?|routes?|stairs?)\b|\bprimary egress\b/i],
  ["a zoning calculation", /\b(?:FAR|floor area ratio|floor area|lot coverage|average grade|building height|structure height)\s+calculations?\b/i],
  ["a professional's seal", /\b(?:signed and (?:stamped|sealed)|(?:stamped|sealed) by|engineer of record|licensed (?:architect|engineer|professional)|professional engineer)\b/i],
];

/** The signs of professional judgment in a comment, ignoring headings and notices. Exported for the measurement. */
export function judgmentSignals(comment: string): string[] {
  if (WHOLE_COMMENT_FYI.test(comment)) return [];
  const request = NOT_THE_REQUEST.reduce((t, re) => t.replace(re, " "), comment);
  // Judged sentence by sentence, so a plain FYI in one sentence can't excuse a real request in the next.
  const sentences = splitSentences(request).map((s) => s.text).filter((s) => !DECLINED.test(s) && !FYI_SENTENCE.test(s));
  return JUDGMENT_SIGNALS.filter(([, re]) => sentences.some((s) => re.test(s))).map(([name]) => name);
}

function guardRoute(item: Item, comment: string | undefined, flags: GuardFlag[]): string {
  if ((item.route !== "agent_draft" && item.route !== "no_action") || !comment) return item.route;
  const signals = judgmentSignals(comment);
  if (!signals.length) return item.route;
  flags.push({ rule: "route_forced", action: "rerouted", level: "review", message: `Held for a licensed professional: this comment involves ${signals.join(" and ")}, but the agent marked it ${item.route === "no_action" ? "as needing no action" : "as routine"}.`, before: item.route, after: "licensed_review" });
  return "licensed_review";
}

// ---------- the guard ----------

/** Runs every rule on the agent's items. The input isn't changed. */
export function guardItems(items: Item[], letter: GuardLetter, packs: GuardPack[]): GuardedItem[] {
  const jurisdiction = letter.project.jurisdiction;
  const pack = packs.find((p) => p.profile.id === jurisdiction);
  const rawLetter = [letter.project.address, letter.project.description, ...(letter.sheets ?? []).flatMap((s) => [s.id, s.title ?? ""]), ...letter.comments.map((c) => c.text)].join(" ");
  const letterText = rawLetter.toLowerCase();
  const wording = foreignWording(jurisdiction, packs, rawLetter);

  return items.map((item) => {
    const flags: GuardFlag[] = [];
    // The agent sometimes splits C2 into C2a, C2b and C2c. The route check still has to read C2.
    const comment = letter.comments.find((c) => c.id === item.comment) ?? letter.comments.find((c) => c.id === item.comment.replace(/[a-z]+$/, ""));
    if (!letter.comments.some((c) => c.id === item.comment)) {
      flags.push({ rule: "unknown_comment", action: "flagged", level: "review", message: `The letter has no comment numbered ${item.comment}. Check which comment this answers.`, before: item.comment });
    }

    const hadDraft = Boolean(item.draft.trim());
    let draft = guardForeign(item.draft, wording, flags);
    draft = guardCompliance(draft, letterText, flags);
    const citation = guardCitationField(item, pack, letterText, flags);
    guardCitationsInDraft(draft, pack, letterText, flags);
    const invented = inventedNumbers(draft, rawLetter, pack);
    if (invented.length) flags.push({ rule: "invented_number", action: "flagged", level: "review", message: `Contains numbers that aren't in the letter or project details: ${invented.join(", ")}. They may be right; confirm them.`, before: invented.join(", ") });
    const route = guardRoute(item, comment?.text, flags);
    if (route !== item.route && !draft.trim()) flags[flags.length - 1].message += " There is no draft yet.";
    if (hadDraft && !draft.trim()) flags.push({ rule: "empty_draft", action: "flagged", level: "review", message: "Nothing was left of this draft after removing another city's wording. Write the response." });

    // What needs a person comes first, so a routine note can't bury it.
    flags.sort((a, b) => Number(a.level === "info") - Number(b.level === "info"));
    const guarded: GuardedItem = { ...item, citation, route, draft, flags };
    if (route !== item.route) guarded.agent_route = item.route;
    return guarded;
  });
}
