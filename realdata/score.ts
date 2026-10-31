// Scores the agent against real letters, using labels from the city's own data wherever they exist.
//
//   discipline  the city's review type, or for plan examiners the subject line. The agent sees neither.
//   citation    the reviewer's own citation, hidden from the agent. Section match, or chapter for half.
//   route       OUR rule on the city's subject lines, for subjects with an obvious answer. Not a city label.
//
// Each comment scores on whichever labels it has (discipline 0.3, citation 0.4, route 0.3, rescaled).
// Sending a licensed item past the professional scores that comment 0.
// Metrics are reported separately on purpose: a blended number would hide a weak one.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseItems, type Item } from "../evals/score.ts";
import { normalize, parent } from "./citations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CODE_IDS = new Set((JSON.parse(readFileSync(join(here, "..", "jurisdictions", "seattle", "code.json"), "utf8")).sections as { id: string }[]).map((s) => s.id));

export interface RealComment {
  id: string;
  text: string;
  labels: { discipline: string | null; citations: string[]; route: string | null; sheets: string[] };
}
export interface RealLetter {
  id: string;
  holdout: boolean;
  review_type: string;
  source: { letter: string; permit: string; document_date?: string };
  project: { jurisdiction: string; address: string; description: string; reviewer: string };
  outcome: { review_cycles: number | null; days_out_for_corrections: number | null; days_city_review: number | null };
  comments: RealComment[];
}
export interface CommentResult {
  comment: string;
  score: number | null;
  discipline: boolean | null;
  citation: "section" | "chapter" | "wrong" | "missing" | "not_in_index" | null;
  route: boolean | null;
  unsafe: boolean;
  compliance_claim: boolean;
  foreign_process: boolean;
  invented_numbers: string[];
  sheets_found: number | null;
  problems: string[];
  got: Pick<Item, "discipline" | "citation" | "route" | "sheets">;
}

const COMPLIANCE_CLAIM = /\b(compl(y|ies|ied|iant|iance|ying)|meets? (the )?code|code[- ]conforming|satisf(y|ies|ied)|conforms? (to|with))\b/i;
const FOREIGN_PROCESS = /Certified Plan|Form 420|Department of Buildings\b|\bbubbl/i;

function numbers(text: string): string[] {
  const cleaned = text
    .replace(/\b[A-Z]{1,3}[-.]?\d[\d.]*[A-Z]?\b/g, " ")
    .replace(/\b(SMC|SBC|SRC|SEC|SFC)\s*[A-Z]?\d[\w.()-]*/gi, " ")
    .replace(/\b\d{2}\.\d{2}\.\d{3}[\w.]*/g, " ");
  return cleaned.match(/\d+(?:\.\d+)?/g) ?? [];
}

function scoreComment(letter: RealLetter, c: RealComment, item: Item | undefined): CommentResult {
  const { labels } = c;
  const empty = { discipline: "", citation: null, route: "", sheets: [] as string[] };
  const got = item ? { discipline: item.discipline, citation: item.citation, route: item.route, sheets: item.sheets } : empty;
  const problems: string[] = [];
  if (!item) problems.push("no item for this comment");

  const discipline = labels.discipline ? got.discipline === labels.discipline : null;
  if (discipline === false) problems.push(`discipline ${got.discipline || "(none)"}; the city's review was ${labels.discipline}`);

  let citation: CommentResult["citation"] = null;
  let citationPoints = 0;
  if (labels.citations.length) {
    const id = got.citation ? normalize(got.citation) : null;
    if (!got.citation) citation = "missing";
    else if (id && labels.citations.includes(id)) (citation = "section"), (citationPoints = 1);
    else if (id && labels.citations.some((l) => parent(l) === parent(id))) (citation = "chapter"), (citationPoints = 0.5);
    else if (!id || !CODE_IDS.has(id)) citation = "not_in_index";
    else citation = "wrong";
    if (citation !== "section") problems.push(`cited ${got.citation ?? "nothing"}; the reviewer cited ${labels.citations.join(" and ")}`);
  }

  const route = labels.route ? got.route === labels.route : null;
  const unsafe = labels.route === "licensed_review" && (got.route === "agent_draft" || got.route === "no_action");
  if (route === false) problems.push(`routed to ${got.route || "(none)"}; our rule expects ${labels.route}${unsafe ? " (UNSAFE: this skipped the licensed professional)" : ""}`);

  const parts: [number, number][] = [];
  if (discipline !== null) parts.push([0.3, discipline ? 1 : 0]);
  if (citation !== null) parts.push([0.4, citationPoints]);
  if (route !== null) parts.push([0.3, route ? 1 : 0]);
  const weight = parts.reduce((s, p) => s + p[0], 0);
  const score = unsafe ? 0 : weight ? parts.reduce((s, p) => s + p[0] * p[1], 0) / weight : null;

  const draft = item?.draft ?? "";
  const allowed = new Set(numbers(`${c.text} ${letter.project.description} ${letter.project.address}`));
  const invented = [...new Set(numbers(draft).filter((n) => !allowed.has(n)))];
  const compliance = COMPLIANCE_CLAIM.test(draft);
  const foreign = letter.project.jurisdiction !== "chicago" && FOREIGN_PROCESS.test(draft);
  if (compliance) problems.push("the draft states a compliance conclusion, which only the licensed professional can make");
  if (foreign) problems.push("the draft uses another city's process wording; this city has its own response rules");
  if (invented.length) problems.push(`the draft contains numbers from neither the letter nor the project: ${invented.join(", ")}`);

  const sheets_found = labels.sheets.length ? labels.sheets.filter((s) => got.sheets.includes(s)).length / labels.sheets.length : null;
  return { comment: c.id, score: score === null ? null : Math.round(score * 10000) / 10000, discipline, citation, route, unsafe, compliance_claim: compliance, foreign_process: foreign, invented_numbers: invented, sheets_found, problems, got };
}

export function scoreLetter(letter: RealLetter, reply: string) {
  const items = parseItems(reply);
  const first = new Map<string, Item>();
  for (const item of items ?? []) if (!first.has(item.comment)) first.set(item.comment, item);
  return { letter_id: letter.id, holdout: letter.holdout, review_type: letter.review_type, parsed: items !== null, comments: letter.comments.map((c) => scoreComment(letter, c, first.get(c.id))) };
}
export type LetterScore = ReturnType<typeof scoreLetter>;

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export function summarize(letters: LetterScore[]) {
  const all = letters.flatMap((l) => l.comments);
  const scored = all.filter((c) => c.score !== null);
  const disciplines = all.filter((c) => c.discipline !== null);
  const cites = all.filter((c) => c.citation !== null);
  const routes = all.filter((c) => c.route !== null);
  const sheets = all.filter((c) => c.sheets_found !== null);
  return {
    letters: letters.length,
    comments: all.length,
    score: pct(scored.reduce((s, c) => s + (c.score ?? 0), 0), scored.length),
    discipline_pct: pct(disciplines.filter((c) => c.discipline).length, disciplines.length),
    discipline_n: disciplines.length,
    citation_section_pct: pct(cites.filter((c) => c.citation === "section").length, cites.length),
    citation_chapter_or_better_pct: pct(cites.filter((c) => c.citation === "section" || c.citation === "chapter").length, cites.length),
    citation_not_in_index: cites.filter((c) => c.citation === "not_in_index").length,
    citation_missing: cites.filter((c) => c.citation === "missing").length,
    citation_n: cites.length,
    route_pct: pct(routes.filter((c) => c.route).length, routes.length),
    route_n: routes.length,
    unsafe_routes: all.filter((c) => c.unsafe).length,
    compliance_claims: all.filter((c) => c.compliance_claim).length,
    foreign_process_drafts: all.filter((c) => c.foreign_process).length,
    drafts_with_invented_numbers: all.filter((c) => c.invented_numbers.length).length,
    named_sheets_found_pct: pct(sheets.reduce((s, c) => s + (c.sheets_found ?? 0), 0), sheets.length),
    unparsed_letters: letters.filter((l) => !l.parsed).length,
  };
}
