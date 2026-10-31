// Finding, hiding and normalizing code citations in real correction comments.
// Reviewers write the same section many ways ("SMC 23.44.041.B", "SRC Table R302.1(1)"),
// so everything is compared at section level, with the chapter as a partial match.

const FAMILIES = "SMC|SBC|SRC|SEC|SFC";
const FAMILY_CITE = new RegExp(`\\b(${FAMILIES})\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*([A-Z]?\\d[\\w.\\-()]*)`, "gi");

// Everything that could give the citation away, including forms with no code name in front.
const MASKS = [
  new RegExp(`\\b(?:${FAMILIES}|SEBC|IRC|IBC|WSEC|WAC|RCW)\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*[A-Z]?\\d[\\w.\\-()]*`, "gi"),
  /\b(?:Section|Sec\.|§)\s*R?\d+\.\d[\d.]*\w*/gi,
  /\b\d{2}\.\d{2}\.\d{3}(?:\.[A-Z0-9]+)*\b/g,
  /\bTable\s+R?\d+\.\d[\w.()]*/gi,
  /\bR\d{3}(?:\.\d+)*\b/g,
];

export const MASK_TOKEN = "[code reference removed]";

/** Section-level id: SMC 23.44.041.B → SMC 23.44.041; SRC R302.1(1) → SRC R302; SBC 1011.5 → SBC 1011. */
export function normalize(raw: string): string | null {
  const m = raw.trim().match(new RegExp(`^(${FAMILIES})\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*([A-Z]?\\d[\\w.\\-()]*)`, "i"));
  if (!m) return null;
  const family = m[1].toUpperCase();
  const body = m[2].toUpperCase().replace(/[.\-]+$/, "");
  if (family === "SMC") {
    const parts = body.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{3}))?/);
    return parts ? `SMC ${parts.slice(1).filter(Boolean).join(".")}` : null;
  }
  const section = body.match(/^([A-Z]?\d{3,4})/);
  return section ? `${family} ${section[1]}` : null;
}

/** The chapter above a section: SMC 23.44.041 → SMC 23.44; SRC R302 → SRC R3; SBC 1011 → SBC 10. */
export function parent(id: string): string {
  const [family, body] = id.split(" ");
  if (family === "SMC") return `SMC ${body.split(".").slice(0, 2).join(".")}`;
  const digits = body.replace(/^[A-Z]/, "");
  const letter = body.match(/^[A-Z]/)?.[0] ?? "";
  return `${family} ${letter}${digits.length >= 4 ? digits.slice(0, 2) : digits.slice(0, 1)}`;
}

export function findCitations(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(FAMILY_CITE)) {
    const id = normalize(m[0]);
    if (id) found.add(id);
  }
  return [...found];
}

export function maskCitations(text: string): string {
  return MASKS.reduce((t, re) => t.replace(re, MASK_TOKEN), text);
}

/** Removes contact details. These are public records, but the agent has no use for them. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_TOKEN = "[name removed]";
const WORD = "[A-Z][a-z]+(?:[A-Z][a-z]+)?(?:-[A-Z][a-z]+)?";
const FULL_NAME = `${WORD} ${WORD}`;
// Firms and places sit in the same spots as people. They aren't personal, and past comments read better with them kept.
const NOT_A_PERSON = /^(?:The|Council)\b|\b(?:Ave|Avenue|St|Street|Place|Way|Bay|Park|Harbor|Beach|City|State|Washington|Tribe|Department|Group|Law|Labs|Programs|Solutions|Consultants|Engineers?|Engineering|Geotechnical|Geosciences)\b/;
const CAPITALIZED_PAIR = /(?<![A-Za-z])[A-Z][a-z]{2,} [A-Z][a-z]{2,}(?:-[A-Z][a-z]+)?(?![A-Za-z])/g;
// Where the letters put names. Each pattern captures any text to keep, then the name.
const NAME_PATTERNS = [
  // In place of a section heading, often run into the sentence before it.
  new RegExp(`()(${FULL_NAME}|[A-Z]{2}[a-z]{3,})(?= \\(\\d+\\))`, "g"),
  // After a label or a word that introduces a person.
  new RegExp(`\\b(Author: |Contact(?: \\(FYI Item\\):)? |Reviewer ?[-:] ?|(?:Best|Thanks|Regards|Sincerely),? |(?:[Pp]er|from|by|with|between|contact|email|to) )(${FULL_NAME})(?![A-Za-z])`, "g"),
  // Before a job title, a removed contact detail, or a verb seen with a person.
  new RegExp(`(?<![A-Za-z])()(${FULL_NAME})(?=,? *(?:\\[|- )? *(?:LU Planner|SDCI|P\\.?E\\.?\\b|S\\.?E\\.?\\b|(?:Building|Structural) Plans? Examiner|Permit Process))`, "g"),
  new RegExp(`(?<![A-Za-z])()(${FULL_NAME})(?=(?: at| -| Email ?[-:])? *\\(?\\[(?:email|phone) removed)`, "g"),
  new RegExp(`(?<![A-Za-z])()(${FULL_NAME})(?=,? (?:sent|the assigned|has transitioned))`, "g"),
];

/**
 * Removes people's names, for the same reason as scrub. A word counts as part of a name if the city never uses it in a
 * subject line or review type and rarely writes it in lowercase. So "Neighborhood Residential (2)" stays, and no list of
 * names has to live in this public repo. It can't catch a first name alone.
 *
 * `names` looks only where names tend to go. `namesAndRarePairs` also removes any two capitalized words in a row made only
 * of such words, wherever they are, unless the pair recurs like a phrase. That finds more people but also takes some plant
 * and product names, so it's for the large set of past comments. The eval letters were read through by hand and only use `names`.
 */
export function nameStripper(comments: { comment?: string; commentsubject?: string; reviewtype?: string }[]) {
  const cityWords = new Set(comments.flatMap((c) => `${c.commentsubject ?? ""} ${c.reviewtype ?? ""}`.toLowerCase().match(/[a-z]+/g) ?? []));
  const lowercase = new Map<string, number>();
  for (const c of comments) for (const w of scrub(c.comment ?? "").match(/(?<![A-Za-z])[a-z]+(?![A-Za-z])/g) ?? []) lowercase.set(w, (lowercase.get(w) ?? 0) + 1);
  for (const [w, n] of lowercase) if (n >= 3) cityWords.add(w);
  // Text runs together in these letters, so "PlanAddressing" and "BZoning" have to be read as separate words.
  const isName = (s: string) => {
    const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b([A-Z])([A-Z][a-z])/g, "$1 $2");
    return !NOT_A_PERSON.test(spaced) && spaced.split(/[\s-]+/).some((w) => w.length > 1 && !cityWords.has(w.toLowerCase()));
  };
  const names = (text: string) => NAME_PATTERNS.reduce((t, re) => t.replace(re, (m, label: string, name: string) => (isName(name) ? label + NAME_TOKEN : m)), text);
  const pairCounts = new Map<string, number>();
  for (const c of comments) for (const [pair] of names(scrub(c.comment ?? "")).matchAll(CAPITALIZED_PAIR)) pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  const isRarePair = (s: string) => (pairCounts.get(s) ?? 0) < 10 && !NOT_A_PERSON.test(s) && s.split(/[\s-]+/).every((w) => !cityWords.has(w.toLowerCase()));
  return { names, namesAndRarePairs: (text: string) => names(text).replace(CAPITALIZED_PAIR, (m) => (isRarePair(m) ? NAME_TOKEN : m)) };
}

/** Reviewers' own names too, for new places. Kept apart from scrub so Seattle's frozen letters rebuild the same. */
export function scrubPeople(text: string): string {
  return scrub(text)
    .replace(/\b(reviewed|prepared|updated|revised|entered) by:?\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'-]+/gi, "$1 by [name removed]")
    .replace(/\bby\s+[a-z]+\.[a-z'-]+-?(?=\s|$)/g, "by [name removed]");
}

// ---------- any place: the same operations, built from a pack's citations.json ----------

export type CodeKind = "ibc" | "irc" | "model" | "dotted_municipal" | "dashed_municipal";
export interface CodeFamily {
  code: string;
  name: string;
  kind: CodeKind;
  aliases?: string[];
}
export interface CitationStyle {
  families: CodeFamily[];
  /** The family a bare "§ 1425-19" belongs to, when reviewers leave the code name off. */
  bare_section_family?: string | null;
}
export interface Citations {
  find(text: string): string[];
  mask(text: string): string;
  normalize(raw: string): string | null;
  parent(id: string): string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEAD = "[\\s:,.\\-()]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*";
const isYear = (body: string) => /^(19|20)\d\d$/.test(body);

function sectionId(family: CodeFamily, rawBody: string): string | null {
  const body = rawBody.toUpperCase().replace(/[.\-]+$/, "");
  if (isYear(body)) return null;
  if (family.kind === "dashed_municipal") {
    const m = body.match(/^(\d{3,4})-(\d+)/);
    return m ? `${family.code} ${m[1]}-${m[2]}` : null;
  }
  if (family.kind === "dotted_municipal") {
    const m = body.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{3}))?/);
    return m ? `${family.code} ${m.slice(1).filter(Boolean).join(".")}` : null;
  }
  const m = body.match(/^([A-Z]?\d{3,4})/);
  return m ? `${family.code} ${m[1]}` : null;
}

export function citationsFor(style: CitationStyle): Citations {
  const byCode = new Map(style.families.map((f) => [f.code.toUpperCase(), f]));
  const names = style.families.flatMap((f) => [f.code, ...(f.aliases ?? [])].map((n) => ({ n, f })));
  const ownerOf = (name: string) => names.find((x) => x.n.toLowerCase() === name.toLowerCase())?.f;
  const pattern = names.map((x) => esc(x.n)).sort((a, b) => b.length - a.length).join("|");
  const cite = new RegExp(`(?<![\\w])(${pattern})(?![\\w])${LEAD}([A-Z]?\\d[\\w.\\-()]*)`, "gi");
  const bare = style.bare_section_family ? byCode.get(style.bare_section_family.toUpperCase()) : undefined;
  const bareCite = /(?:§+|\b(?:Sections?|Sec\.|[Pp]er|[Uu]nder|[Oo]f)\b)\s*(\d{3,4}-\d+[\w.()]*)/g;

  const hasModelCode = style.families.some((f) => ["ibc", "irc", "model"].includes(f.kind));
  const masks = [
    new RegExp(`(?<![\\w])(?:${pattern})(?![\\w])${LEAD}[A-Z]?\\d[\\w.\\-()]*`, "gi"),
    /(?:\bSection|\bSec\.|§+)\s*[A-Z]?\d[\w.\-()]*/gi,
    /\bTable\s+[A-Z]?\d+\.\d[\w.()]*/gi,
    ...(style.families.some((f) => f.kind === "dashed_municipal") ? [/\b\d{3,4}-\d{1,3}(?:\.\d+)?(?:\([a-z0-9]+\))*/g] : []),
    ...(style.families.some((f) => f.kind === "dotted_municipal") ? [/\b\d{1,2}\.\d{2}\.\d{3}(?:\.[A-Z0-9]+)*\b/g] : []),
    // A model-code section with no code name in front, like "1705.3 Soils".
    ...(hasModelCode ? [/\b[A-Z]?\d{3,4}\.\d[\d.]*(?:\(\d+\))?/g, /\bR\d{3}\b/g, /^\s*(?!19\d\d|20\d\d)[A-Z]?\d{3,4}(?=\s+[A-Z][a-z])/gm] : []),
  ];

  const find = (text: string) => {
    const found = new Set<string>();
    for (const m of text.matchAll(cite)) {
      const f = ownerOf(m[1]);
      const id = f && sectionId(f, m[2]);
      if (id) found.add(id);
    }
    if (bare) {
      for (const m of text.matchAll(bareCite)) {
        const id = sectionId(bare, m[1]);
        if (id) found.add(id);
      }
    }
    return [...found];
  };
  return {
    find,
    mask: (text) => masks.reduce((t, re) => t.replace(re, MASK_TOKEN), text),
    normalize: (raw) => find(raw)[0] ?? null,
    parent: (id) => {
      const [code, body = ""] = id.split(" ");
      const kind = byCode.get(code.toUpperCase())?.kind;
      if (kind === "dashed_municipal") return `${code} ${body.split("-")[0]}`;
      if (kind === "dotted_municipal") return `${code} ${body.split(".").slice(0, 2).join(".")}`;
      const digits = body.replace(/^[A-Z]/, "");
      const letter = body.match(/^[A-Z]/)?.[0] ?? "";
      return `${code} ${letter}${digits.length >= 4 ? digits.slice(0, 2) : digits.slice(0, 1)}`;
    },
  };
}
