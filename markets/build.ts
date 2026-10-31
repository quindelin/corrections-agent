// Step 3: turn a dataset and a source mapping into a jurisdiction pack and a frozen eval.
//
// Pure given its input rows, like realdata/build-seattle.ts: the same rows always give the same pack and the same letters.
// validate() is what stands between the model's proposal and the scorer. It tests the mapping on real rows, and its
// problems go back to the model word for word.

import { createHash } from "node:crypto";
import { citationsFor, MASK_TOKEN, scrubPeople, type Citations, type CodeFamily, type CodeKind } from "../realdata/citations.ts";
import { median, type Policy } from "./lib.ts";

export const DISCIPLINES = ["zoning", "egress", "fire", "structural", "accessibility", "energy", "mep", "interior_environment", "drainage", "geotech", "tree", "addressing", "admin"] as const;
export const ROUTES = ["licensed_review", "agent_draft", "client_input", "other_agency", "no_action"] as const;
export const CODE_KINDS: CodeKind[] = ["ibc", "irc", "model", "dotted_municipal", "dashed_municipal"];

export interface Source {
  id: string;
  name: string;
  authority: string;
  domain: string;
  dataset: string;
  fields: {
    permit: string;
    text: string;
    review_type: string;
    date: string;
    description: string;
    permit_class: string | null;
    zoning: string | null;
    subject: string | null;
    letter: string | null;
    cycle: string | null;
  };
  /** One row holds a whole letter (split on its numbering), or one row holds one comment. */
  shape: "row_per_letter" | "row_per_comment";
  /** The values of review_type that hold review comments. Everything else is left out. */
  review_types: string[];
  review_type_discipline: Record<string, string | null>;
  /** Empty for mapped places. Routes decide the unsafe-route check, so only code's own rule may set them. */
  review_type_route: Record<string, string | null>;
  families: CodeFamily[];
  bare_section_family: string | null;
  code_basis: string;
  hints: string[];
  retrieved?: string;
  /** What code changed in the model's proposal because the rows said otherwise, for a person to read. */
  repairs?: string[];
}

export type Row = Record<string, unknown>;

const text = (r: Row, f: string | null) => (f && typeof r[f] === "string" ? (r[f] as string) : "");
const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const SHEET = /\b(?:Sheet|Sheets|Page|Drawing)\s+([A-Z]{1,3}[-.]?\d[\d.]*[A-Z]?)/gi;
const RESOLVED = /\b(issues?|items?)\s+(?:has been |have been |was |were |is |are )?(resolved|addressed|cleared)\b|\bresolved\s+\d{1,2}\/\d{1,2}/i;

/** Splits one letter on its top-level numbering. "a)" sub-items stay with their parent. Unnumbered letters split on blank lines. */
export function splitLetter(body: string): string[] {
  const clean = body.replace(/\r/g, "");
  const numbered = clean.split(/\n(?=[ \t]*\(?\d{1,2}[.)][ \t])/).map((s) => s.trim()).filter(Boolean);
  const items = /^\s*\(?\d{1,2}[.)]\s/m.test(clean) && numbered.length >= 2 ? numbered : clean.split(/\n[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
  return items.map((s) => s.replace(/^\(?\d{1,2}[.)]\s+/, "").trim());
}

/** Is there still anything to answer once the citation is hidden? */
function worthAsking(masked: string): boolean {
  const words = masked.replace(new RegExp(MASK_TOKEN.replace(/[[\]]/g, "\\$&"), "g"), " ").replace(/\b(19|20)\d\d\b/g, " ").match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 5 && !/:\s*$/.test(masked.trim());
}

// I-code chapters are the same everywhere, so a hidden citation tells us the discipline without any city's say-so.
// Chapter 1 is left out: its "construction documents" section can be cited about anything, so it says nothing about the subject.
const IBC_DISCIPLINE: [RegExp, string][] = [[/^(7|9)$/, "fire"], [/^10$/, "egress"], [/^11$/, "accessibility"], [/^12$/, "interior_environment"], [/^13$/, "energy"], [/^(16|17|18|19|20|21|22|23)$/, "structural"], [/^(28|29)$/, "mep"]];
const IRC_SECTIONS: [RegExp, string][] = [[/^R?302/, "fire"], [/^R?31[0-2]/, "egress"], [/^R?314|^R?315/, "fire"], [/^R?11\d\d/, "energy"], [/^R?(4|5|6|7|8|9)\d\d/, "structural"]];

/** Discipline from a citation's code chapter. Null when the chapter says nothing certain. */
export function disciplineFromCitation(id: string, families: CodeFamily[]): string | null {
  const [code, body = ""] = id.split(" ");
  const family = families.find((f) => f.code === code);
  if (family?.kind === "ibc") {
    const digits = body.replace(/^[A-Z]/, "");
    const chapter = digits.length >= 4 ? digits.slice(0, 2) : digits.slice(0, 1);
    return IBC_DISCIPLINE.find(([re]) => re.test(chapter))?.[1] ?? null;
  }
  if (family?.kind === "irc") return IRC_SECTIONS.find(([re]) => re.test(body))?.[1] ?? null;
  return null;
}

/** Our rule, like Seattle's: only subjects with an obvious answer get a route label. Reported apart from city labels. */
export function routeFromCitation(id: string, families: CodeFamily[]): string | null {
  const [code, body = ""] = id.split(" ");
  const kind = families.find((f) => f.code === code)?.kind;
  if (kind === "ibc") return /^(16|18|19|21|22|23)\d\d$/.test(body) ? "licensed_review" : null;
  if (kind === "irc") return /^R?(302|310|311|312)$/.test(body) ? "licensed_review" : null;
  return null;
}

export interface EvalComment {
  id: string;
  text: string;
  labels: { discipline: string | null; citations: string[]; route: string | null; sheets: string[] };
}
export interface EvalLetter {
  id: string;
  holdout: boolean;
  review_type: string;
  source: { letter: string; permit: string; document_date?: string };
  project: { jurisdiction: string; address: string; description: string; reviewer: string };
  outcome: { review_cycles: number | null; days_out_for_corrections: number | null; days_city_review: number | null };
  comments: EvalComment[];
}

function labelComment(source: Source, cites: Citations, reviewType: string, raw: string, id: string): EvalComment | null {
  const clean = scrubPeople(raw).slice(0, 1200);
  const masked = cites.mask(clean);
  if (!worthAsking(masked) || RESOLVED.test(clean)) return null;
  const citations = cites.find(clean);
  const fromCity = source.review_type_discipline[reviewType] ?? null;
  const fromCode = citations.map((c) => disciplineFromCitation(c, source.families)).find(Boolean) ?? null;
  const route = source.review_type_route[reviewType] ?? citations.map((c) => routeFromCitation(c, source.families)).find(Boolean) ?? null;
  return { id, text: masked, labels: { discipline: fromCity ?? fromCode, citations, route, sheets: [...new Set([...clean.matchAll(SHEET)].map((m) => m[1].toUpperCase()))] } };
}

/** Rows grouped into candidate letters. A letter edited after the fact ("issue resolved") isn't what the applicant received, so it's dropped. */
function candidateLetters(source: Source, rows: Row[], cites: Citations, maxComments: number) {
  const { fields } = source;
  const allowed = new Set(source.review_types);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!allowed.has(text(r, fields.review_type)) || !text(r, fields.text).trim()) continue;
    const key = source.shape === "row_per_letter" ? `${text(r, fields.permit)}|${text(r, fields.date)}|${text(r, fields.review_type)}|${hash(text(r, fields.text)).slice(0, 8)}` : (text(r, fields.letter) || `${text(r, fields.permit)}|${text(r, fields.date).slice(0, 10)}|${text(r, fields.review_type)}`);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const letters: { key: string; first: Row; reviewType: string; comments: EvalComment[] }[] = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const reviewType = text(first, fields.review_type);
    const raws = source.shape === "row_per_letter" ? list.flatMap((r) => splitLetter(text(r, fields.text))) : list.map((r) => text(r, fields.text));
    if (raws.filter((s) => RESOLVED.test(s)).length * 3 > raws.length) continue;
    const comments = raws.map((raw) => labelComment(source, cites, reviewType, raw, "")).filter((c): c is EvalComment => !!c).map((c, i) => ({ ...c, id: `C${i + 1}` }));
    if (comments.length < 2 || comments.length > maxComments) continue;
    if (!comments.some((c) => c.labels.discipline || c.labels.citations.length)) continue;
    letters.push({ key, first, reviewType, comments });
  }
  return letters;
}

export interface Built {
  letters: EvalLetter[];
  pastComments: { review_type: string | null; subject: string | null; cycle: number | null; text: string; citations: string[] }[];
  sections: { id: string; title: string; scope: string }[];
  counts: { rows: number; candidate_letters: number; comments: number; holdout_letters: number; holdout_comments: number; discipline_share: number; citation_share: number; route_share: number; code_entries: number };
}

export function build(source: Source, rows: Row[], policy: Policy): Built {
  const cites = citationsFor(source);
  const { fields } = source;
  const candidates = candidateLetters(source, rows, cites, policy.evaluation.max_comments_per_letter);

  // A stable shuffle, then each review type in proportion to how often it really happens, one letter per permit.
  // Every fourth letter is a holdout.
  const quotaOf = (type: string) => Math.max(2, Math.ceil((policy.evaluation.letters * candidates.filter((c) => c.reviewType === type).length) / Math.max(1, candidates.length)));
  const taken = new Map<string, number>();
  const permits = new Set<string>();
  const letters: EvalLetter[] = [];
  for (const c of [...candidates].sort((a, b) => hash(a.key).localeCompare(hash(b.key)))) {
    const permit = text(c.first, fields.permit);
    const n = taken.get(c.reviewType) ?? 0;
    if (letters.length >= policy.evaluation.letters || n >= quotaOf(c.reviewType) || permits.has(permit)) continue;
    const description = scrubPeople(text(c.first, fields.description));
    if (!description) continue;
    taken.set(c.reviewType, n + 1);
    permits.add(permit);
    letters.push({
      id: `${String(letters.length + 1).padStart(2, "0")}-${c.reviewType.toLowerCase().replace(/\W+/g, "-")}-${permit}`,
      holdout: letters.length % 4 === 3,
      review_type: c.reviewType,
      source: { letter: `https://${source.domain}/d/${source.dataset}`, permit, document_date: text(c.first, fields.date).slice(0, 10) },
      project: {
        jurisdiction: source.id,
        address: "Not given",
        description: `${description.slice(0, 400)} Permit class: ${text(c.first, fields.permit_class) || "unknown"}. Zoning: ${text(c.first, fields.zoning) || "unknown"}.`,
        reviewer: `${source.authority}, ${c.reviewType}`,
      },
      outcome: { review_cycles: null, days_out_for_corrections: null, days_city_review: null },
      comments: c.comments,
    });
  }

  // Past comments the agent can search: never the eval permits, and never with a reviewer's name.
  const allowed = new Set(source.review_types);
  const pastComments = rows
    .filter((r) => allowed.has(text(r, fields.review_type)) && text(r, fields.text).trim() && !permits.has(text(r, fields.permit)))
    .flatMap((r) => (source.shape === "row_per_letter" ? splitLetter(text(r, fields.text)) : [text(r, fields.text)]).map((raw) => ({ r, raw })))
    .filter(({ raw }) => !RESOLVED.test(raw))
    .map(({ r, raw }) => {
      const clean = scrubPeople(raw).slice(0, 700);
      return { review_type: text(r, fields.review_type) || null, subject: text(r, fields.subject) || null, cycle: Number(text(r, fields.cycle)) || null, text: clean, citations: cites.find(clean) };
    })
    .filter((c) => c.text.length >= 25);

  // The code index: sections reviewers have actually cited, with titles from the way they wrote them.
  const seen = new Map<string, { count: number; titles: Map<string, number>; types: Map<string, number> }>();
  for (const c of pastComments) {
    for (const id of c.citations) {
      const e = seen.get(id) ?? { count: 0, titles: new Map(), types: new Map() };
      e.count++;
      const after = c.text.match(new RegExp(`${id.split(" ")[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\w.()-]*\\s*[-–:]\\s*([A-Z][^.:\\n]{3,60})`))?.[1]?.trim();
      if (after) e.titles.set(after, (e.titles.get(after) ?? 0) + 1);
      if (c.review_type) e.types.set(c.review_type, (e.types.get(c.review_type) ?? 0) + 1);
      seen.set(id, e);
    }
  }
  // Letters' own citations stay out of past comments, but must be citable, or the right answer would score as "not in index".
  for (const l of letters) for (const c of l.comments) for (const id of c.labels.citations) if (!seen.has(id)) seen.set(id, { count: 0, titles: new Map(), types: new Map() });
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  const familyName = (id: string) => source.families.find((f) => f.code === id.split(" ")[0])?.name ?? id.split(" ")[0];
  const sections = [...seen]
    .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
    .map(([id, e]) => ({ id, title: top(e.titles) ?? familyName(id), scope: `${familyName(id)}. Cited ${e.count} time(s) in ${source.name} review comments${e.types.size ? `, by: ${[...e.types.keys()].slice(0, 3).join("; ")}` : ""}.` }));

  const comments = letters.flatMap((l) => l.comments);
  const share = (f: (c: EvalComment) => unknown) => (comments.length ? comments.filter(f).length / comments.length : 0);
  return {
    letters,
    pastComments,
    sections,
    counts: {
      rows: rows.length,
      candidate_letters: candidates.length,
      comments: comments.length,
      holdout_letters: letters.filter((l) => l.holdout).length,
      holdout_comments: letters.filter((l) => l.holdout).flatMap((l) => l.comments).length,
      discipline_share: share((c) => c.labels.discipline),
      citation_share: share((c) => c.labels.citations.length),
      route_share: share((c) => c.labels.route),
      code_entries: sections.length,
    },
  };
}

/**
 * Keeps a stated fact only if the data backs it. A family's full name must appear word for word in the rows, the
 * authority likewise, and the place's name must match who published the dataset. Anything else falls back to what's
 * known, so a wrong guess can't reach a tool result or a customer's draft.
 */
export function verifyFacts(source: Source, rows: Row[], publisher: string | null, place: string): Source {
  const corpus = rows.map((r) => text(r, source.fields.text)).join("\n").toLowerCase().replace(/\s+/g, " ");
  const said = (phrase: string | null | undefined) => !!phrase && corpus.includes(phrase.toLowerCase().replace(/\s+/g, " "));
  const city = place.replace(/-/g, " ");
  const known = `${publisher ?? ""} ${source.domain}`.toLowerCase().replace(/[-.]/g, " ");
  const name = source.name && source.name.toLowerCase().includes(city) && known.includes(city) ? source.name : publisher ?? `City of ${city}`;
  const codes = new Set(source.families.map((f) => f.code.toLowerCase()));
  const hints = [...new Set([city, ...(source.hints ?? [])].map((h) => h.toLowerCase()))].filter((h) => h.length > 3 && !codes.has(h) && name.toLowerCase().includes(h));
  return {
    ...source,
    id: place,
    name,
    authority: said(source.authority) ? source.authority : publisher ?? name,
    families: source.families.map((f) => ({ ...f, name: said(f.name) ? f.name : `${f.code} (full name not confirmed)`, aliases: (f.aliases ?? []).filter(said) })),
    code_basis: `Reviewers in the sampled comments cite: ${source.families.map((f) => f.code).join(", ")}. Editions vary by application date and aren't resolved here.`,
    hints,
  };
}

const sectionForm = (code: string) => new RegExp(`\\b${code}\\b[\\s:,.\\-()]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*([A-Z]?\\d[\\w.\\-]*)`, "g");

const measuredKind = (forms: string[]): CodeKind | null => {
  if (!forms.length) return null;
  if (forms.filter((x) => /^\d{3,4}-\d/.test(x)).length / forms.length >= 0.5) return "dashed_municipal";
  if (forms.filter((x) => /^\d{1,2}\.\d{2}\.\d{3}/.test(x)).length / forms.length >= 0.5) return "dotted_municipal";
  return null;
};

/** Corrects whatever the rows settle, so the model is only asked for judgment. Each change is noted for a person to read. */
export function repair(proposal: Source, rows: Row[], policy: Policy): Source {
  const repairs: string[] = [];
  const source: Source = { ...proposal, families: [...(proposal.families ?? [])].filter((f) => /^[A-Z]{2,8}$/.test(f.code ?? "")), review_types: [...(proposal.review_types ?? [])] };
  const bodiesOf = (types: string[]) => rows.filter((r) => types.includes(text(r, source.fields.review_type))).map((r) => text(r, source.fields.text));
  const fixKinds = () => {
    const bodies = bodiesOf(source.review_types);
    source.families = source.families.flatMap((f) => {
      const forms = bodies.flatMap((b) => [...b.matchAll(sectionForm(f.code))].map((m) => m[1]));
      const kind = measuredKind(forms);
      if (forms.length && kind && kind !== f.kind) {
        repairs.push(`${f.code}: kind ${f.kind} changed to ${kind}, from how its sections are written`);
        return [{ ...f, kind }];
      }
      if (forms.length >= 10 && !kind && f.kind.endsWith("municipal")) {
        repairs.push(`${f.code}: kind ${f.kind} changed to model, from how its sections are written`);
        return [{ ...f, kind: "model" as const }];
      }
      return [f];
    });
  };
  fixKinds();

  // Sections with a "§" and no code name still need a family, and the rows don't say which code they belong to.
  const named = source.bare_section_family && source.families.some((f) => f.code === source.bare_section_family);
  const bareShare = (type: string) => {
    const b = bodiesOf([type]);
    return b.length ? b.filter((t) => /(?:§+|\b(?:Sections?|Sec\.|[Pp]er)\b)\s*\d{3,4}-\d/.test(t)).length / b.length : 0;
  };
  if (!named) {
    source.bare_section_family = null;
    if (source.review_types.some((t) => bareShare(t) >= 0.1)) {
      source.families.push({ code: "LOCAL", name: "Local code section (the comments don't name the code)", kind: "dashed_municipal", aliases: [] });
      source.bare_section_family = "LOCAL";
      repairs.push(`LOCAL: added for sections cited with only a "§"`);
    }
  }

  // Code names reviewers put before a section that the mapping missed.
  const seen = new Map<string, number>();
  for (const b of bodiesOf(source.review_types)) {
    for (const name of new Set([...b.matchAll(/\b([A-Z]{3,6})\b[\s:,.\-()]*(?:Section|Sec\.?|§|Table|Chapter)?\s*[A-Z]?\d{3,4}(?:[.\-]\d+)+/g)].map((m) => m[1]))) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  const rowCount = bodiesOf(source.review_types).length;
  for (const [code, n] of seen) {
    if (n / Math.max(1, rowCount) >= 0.01 && !source.families.some((f) => f.code === code)) {
      source.families.push({ code, name: `${code} (full name not confirmed)`, kind: "model", aliases: [] });
      repairs.push(`${code}: added, cited in ${n} rows`);
    }
  }
  fixKinds();

  const cites = citationsFor(source);
  source.families = source.families.filter((f) => {
    const used = bodiesOf(source.review_types).some((b) => cites.find(b).some((id) => id.startsWith(`${f.code} `)));
    if (!used) repairs.push(`${f.code}: removed, it never matched a comment`);
    return used;
  });
  if (source.bare_section_family && !source.families.some((f) => f.code === source.bare_section_family)) source.bare_section_family = null;

  // Keep the types that can be scored, as long as one remains.
  const pruned = citationsFor(source);
  const keep = source.review_types.filter((type) => {
    const list = rows.filter((r) => text(r, source.fields.review_type) === type);
    if (list.length < 20) return true;
    const citing = list.filter((r) => pruned.find(text(r, source.fields.text)).length).length / list.length;
    const letters = candidateLetters({ ...source, review_types: [type] }, list, pruned, policy.evaluation.max_comments_per_letter).length / list.length;
    if (citing >= 0.15 && letters >= 0.1) return true;
    repairs.push(`"${type}": removed from review types, ${Math.round(citing * 100)}% of rows cite a code and ${Math.round(letters * 100)}% hold a usable letter`);
    return false;
  });
  if (keep.length) source.review_types = keep;
  return { ...source, repairs };
}

/** What the rows themselves say against the mapping: how sections are really written, and which types really hold letters. */
function evidenceProblems(source: Source, rows: Row[], policy: Policy): string[] {
  const problems: string[] = [];
  const allowed = new Set(source.review_types);
  const chosen = rows.filter((r) => allowed.has(text(r, source.fields.review_type)));
  if (!chosen.length) return problems;
  const bodies = chosen.map((r) => text(r, source.fields.text));
  for (const f of source.families) {
    const forms = bodies.flatMap((b) => [...b.matchAll(sectionForm(f.code))].map((m) => m[1]));
    if (forms.length < 10) continue;
    const dashed = forms.filter((x) => /^\d{3,4}-\d/.test(x)).length / forms.length;
    const dotted = forms.filter((x) => /^\d{1,2}\.\d{2}\.\d{3}/.test(x)).length / forms.length;
    if (dashed >= 0.5 && f.kind !== "dashed_municipal") problems.push(`family ${f.code} is kind "${f.kind}", but ${Math.round(dashed * 100)}% of its sections are written like 1101-23, so it should be "dashed_municipal"`);
    else if (dotted >= 0.5 && f.kind !== "dotted_municipal") problems.push(`family ${f.code} is kind "${f.kind}", but ${Math.round(dotted * 100)}% of its sections are written like 23.44.041, so it should be "dotted_municipal"`);
    else if (dashed < 0.2 && dotted < 0.2 && f.kind.endsWith("municipal")) problems.push(`family ${f.code} is kind "${f.kind}", but its sections aren't written that way, for example "${forms[0]}"`);
  }
  for (const type of source.review_types) {
    const list = chosen.filter((r) => text(r, source.fields.review_type) === type);
    const bare = list.filter((r) => /(?:§+|\b(?:Sections?|Sec\.|[Pp]er)\b)\s*\d{3,4}-\d/.test(text(r, source.fields.text))).length;
    if (list.length && bare / list.length >= 0.1 && !source.bare_section_family) problems.push(`${Math.round((100 * bare) / list.length)}% of "${type}" rows cite "§ nnnn-nn" with no code name, so those citations go unlabeled. Add a family for that code, kind "dashed_municipal", and name it in bare_section_family.`);
    const cites = citationsFor(source);
    const citing = list.filter((r) => cites.find(text(r, source.fields.text)).length).length;
    if (list.length >= 20 && citing / list.length < 0.15) problems.push(`only ${Math.round((100 * citing) / list.length)}% of "${type}" rows cite a code, so comments of this type can barely be scored. Remove it from review_types.`);
    const letters = candidateLetters({ ...source, review_types: [type] }, list, cites, policy.evaluation.max_comments_per_letter);
    if (list.length >= 20 && letters.length / list.length < 0.1) problems.push(`only ${Math.round((100 * letters.length) / list.length)}% of "${type}" rows hold a usable letter, so it isn't where comment letters live. Remove it from review_types.`);
  }
  return problems;
}

const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;

/** Everything wrong with a proposed source, tested on real rows. An empty list means it can be built and scored. */
export function validate(source: Source, rows: Row[], columns: string[], policy: Policy, taken: string[] = []): string[] {
  const problems: string[] = [];
  const ev = policy.evaluation;
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(source.id ?? "")) problems.push(`id "${source.id}" must be lowercase letters, numbers and hyphens`);
  if (taken.includes(source.id)) problems.push(`id "${source.id}" is already a jurisdiction`);
  if (source.shape !== "row_per_letter" && source.shape !== "row_per_comment") problems.push(`shape must be row_per_letter or row_per_comment, not "${source.shape}"`);

  const fields = source.fields ?? ({} as Source["fields"]);
  for (const f of ["permit", "text", "review_type", "date", "description"] as const) if (!fields[f]) problems.push(`fields.${f} is required`);
  for (const [name, column] of Object.entries(fields)) if (column && !columns.includes(column)) problems.push(`fields.${name} is "${column}", which isn't a column. Columns: ${columns.join(", ")}`);

  const present = new Set(rows.map((r) => text(r, fields.review_type)));
  if (!source.review_types?.length) problems.push("review_types is empty");
  for (const t of source.review_types ?? []) if (!present.has(t)) problems.push(`review_types has "${t}", which isn't a value of ${fields.review_type} in the data`);
  for (const [t, d] of Object.entries(source.review_type_discipline ?? {})) if (d && !(DISCIPLINES as readonly string[]).includes(d)) problems.push(`review_type_discipline["${t}"] is "${d}". Allowed: ${DISCIPLINES.join(", ")}`);
  for (const [t, r] of Object.entries(source.review_type_route ?? {})) if (r && !(ROUTES as readonly string[]).includes(r)) problems.push(`review_type_route["${t}"] is "${r}". Allowed: ${ROUTES.join(", ")}`);

  if (!source.families?.length) problems.push("families is empty: name the code families reviewers cite");
  for (const f of source.families ?? []) {
    if (!CODE_KINDS.includes(f.kind)) problems.push(`family ${f.code} has kind "${f.kind}". Allowed: ${CODE_KINDS.join(", ")}`);
    if (!/^[A-Z]{2,8}$/.test(f.code ?? "")) problems.push(`family code "${f.code}" must be capital letters only, like the code names reviewers write`);
  }
  if (source.bare_section_family && !source.families?.some((f) => f.code === source.bare_section_family)) problems.push(`bare_section_family "${source.bare_section_family}" isn't one of the families`);
  if (!source.hints?.length) problems.push("hints is empty: give words that identify this place on a letter");
  if (problems.length) return problems;

  problems.push(...evidenceProblems(source, rows, policy));
  const built = build(source, rows, policy);
  const { counts } = built;
  if (built.letters.length < ev.min_letters) problems.push(`only ${built.letters.length} letters could be built from ${rows.length} rows (${counts.candidate_letters} candidates); at least ${ev.min_letters} are needed. Check shape, review_types and the field mapping.`);
  if (counts.holdout_comments < ev.min_holdout_comments) problems.push(`only ${counts.holdout_comments} holdout comments; at least ${ev.min_holdout_comments} are needed`);
  if (counts.discipline_share < ev.min_discipline_labels) problems.push(`only ${Math.round(counts.discipline_share * 100)}% of comments have a discipline label; at least ${Math.round(ev.min_discipline_labels * 100)}% are needed. Check review_type_discipline and each family's kind.`);
  if (counts.citation_share < ev.min_citation_labels) problems.push(`only ${Math.round(counts.citation_share * 100)}% of comments have a citation label; at least ${Math.round(ev.min_citation_labels * 100)}% are needed. Check the family codes and aliases against how reviewers write them.`);

  const cites = citationsFor(source);
  const comments = built.letters.flatMap((l) => l.comments);
  const leaks = comments.filter((c) => cites.find(c.text).length);
  if (leaks.length) problems.push(`${leaks.length} comments still show a citation after masking, so the agent could read the answer. Example: "${leaks[0].text.slice(0, 160)}"`);
  const contact = comments.find((c) => CONTACT.test(c.text));
  if (contact) problems.push("a comment still contains contact details");
  // A code name left in front of a masked citation is a family the mapping missed.
  const missed = new Map<string, number>();
  for (const c of comments) for (const m of c.text.matchAll(/\b([A-Z]{2,6})\s+\[code reference removed\]/g)) if (!source.families.some((f) => f.code === m[1])) missed.set(m[1], (missed.get(m[1]) ?? 0) + 1);
  for (const [code, n] of missed) if (n >= Math.max(2, comments.length * 0.01)) problems.push(`reviewers also cite "${code}" (${n} comments), which isn't in families. Add it, with its kind.`);
  const counted = new Map<string, number>();
  for (const c of comments) for (const id of c.labels.citations) counted.set(id.split(" ")[0], (counted.get(id.split(" ")[0]) ?? 0) + 1);
  for (const f of source.families) if (!counted.has(f.code) && !built.pastComments.some((c) => c.citations.some((id) => id.startsWith(`${f.code} `)))) problems.push(`family ${f.code} never matched a comment. Remove it or fix its aliases.`);
  if (median(comments.map((c) => c.text.length)) === null) problems.push("no comments were produced");
  return problems;
}
