// npm run real:build
// Builds the Seattle jurisdiction pack and the real-data eval from Seattle's public datasets:
//   Plan Comments   https://data.seattle.gov/Built-Environment/Plan-Comments/e285-aq8h
//   Building Permits https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr
//
// Output:
//   jurisdictions/seattle/code.json        code index, mined from what reviewers cite
//   jurisdictions/seattle/permit-stats.json  cycles and days, with definitions
//   jurisdictions/seattle/comments.jsonl   past comments for similar_comments; excludes eval permits (not committed)
//   realdata/seattle/letters.json          the frozen eval: real letters, with reviewers' citations hidden
//   realdata/seattle/insights.json         which corrections recur across review cycles
//
// Deterministic: same source data, same output. Don't rebuild letters.json between runs you want to compare.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCitations, maskCitations, scrub } from "./citations.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "seattle");
const PACK = join(ROOT, "jurisdictions", "seattle");
const OUT = join(ROOT, "realdata", "seattle");
const SOURCE = "https://data.seattle.gov/resource";
mkdirSync(CACHE, { recursive: true });

interface RawComment {
  permitnum: string;
  documenttitle?: string;
  url?: { url: string };
  commentsubject?: string;
  reviewtype?: string;
  reviewcycle?: string;
  comment?: string;
  documentdate?: string;
}
type RawPermit = Record<string, string>;

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const file = join(CACHE, name);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const value = await load();
  writeFileSync(file, JSON.stringify(value));
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const comments = await cached<RawComment[]>("comments.json", () =>
  fetchJson(`${SOURCE}/e285-aq8h.json?$limit=50000&$order=${encodeURIComponent("documentdate,:id")}`),
);
const permitNums = [...new Set(comments.map((c) => c.permitnum))];
const permits = await cached<RawPermit[]>("permits.json", async () => {
  const all: RawPermit[] = [];
  for (let i = 0; i < permitNums.length; i += 60) {
    const list = permitNums.slice(i, i + 60).map((p) => `'${p}'`).join(",");
    all.push(...(await fetchJson<RawPermit[]>(`${SOURCE}/76t5-zqzr.json?$limit=1000&$where=${encodeURIComponent(`permitnum in(${list})`)}`)));
  }
  return all;
});
const permitBy = new Map(permits.map((p) => [p.permitnum, p]));
console.log(`${comments.length} comments, ${permitNums.length} permits in comments, ${permits.length} permit records`);

const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// ---------- labels: only what the city's own data supports ----------

const REVIEW_DISCIPLINE: Record<string, string> = {
  Zoning: "zoning", MHA: "zoning", "Land Use": "zoning", "Design Review": "zoning",
  Drainage: "drainage", Energy: "energy", "ECA GeoTech": "geotech", "Geo Soils": "geotech",
  Tree: "tree", Revegetation: "tree", Addressing: "addressing", Fire: "fire",
  "Structural Engineer": "structural", Mechanical: "mep",
};

/** Plan examiners ("Ordinance") cover every discipline, so the subject line, which the agent doesn't see, decides. */
function disciplineLabel(c: RawComment): string | null {
  const subject = c.commentsubject ?? "";
  if (c.reviewtype === "Ordinance" || c.reviewtype === "Ordinance Structural") {
    if (/^(16\b|18\b|19\b|21\b|22\b|23\b)|Lateral|Gravity|Structural Design|Foundation|Retaining|Shoring/i.test(subject)) return "structural";
    if (/^(302|07|09|9|314|315)\b|Fire|Smoke|Carbon Monoxide/i.test(subject)) return "fire";
    if (/^(310|311|312|10)\b|Egress|Emergency Escape|Guards/i.test(subject)) return "egress";
    if (/^(11)\b|Accessib/i.test(subject)) return "accessibility";
    return null;
  }
  return REVIEW_DISCIPLINE[c.reviewtype ?? ""] ?? null;
}

/**
 * Route labels are OUR rule applied to the city's subject lines, not a city label, so they get reported apart.
 * Only subjects with an obvious answer are labeled; everything else is left unscored.
 */
function routeLabel(c: RawComment, text: string): string | null {
  const subject = c.commentsubject ?? "";
  if (/^00 Code Edition|^Code reviewed/i.test(subject) || /has been reviewed for conformance/i.test(text)) return "no_action";
  if (c.reviewtype === "Addressing") return "agent_draft";
  if (/Special Inspector nomination/i.test(subject)) return "client_input";
  if (/^16 |Engineered Lateral|Structural Design Criteria|^18 |Lateral Design|Gravity Design/i.test(subject)) return "licensed_review";
  if (/^(302|310|311|312) /.test(subject)) return "licensed_review";
  return null;
}

// ---------- group into real letters ----------

interface EvalComment {
  id: string;
  text: string;
  labels: { discipline: string | null; citations: string[]; route: string | null; sheets: string[] };
}
const SHEET = /\b(?:Sheet|Sheets|Page)\s+([A-Z]{1,3}[-.]?\d[\d.]*[A-Z]?)/gi;

const byLetter = new Map<string, RawComment[]>();
for (const c of comments) {
  const key = c.url?.url;
  if (key && c.comment?.trim()) (byLetter.get(key) ?? byLetter.set(key, []).get(key)!).push(c);
}

const QUOTA: Record<string, number> = {
  "Ordinance Structural": 10, Zoning: 8, Drainage: 5, Energy: 5, Tree: 3, Ordinance: 3,
  "ECA GeoTech": 2, "Structural Engineer": 2, Addressing: 1, Fire: 1,
};
const taken = new Map<string, number>();
const usedPermits = new Set<string>();
const letters = [];
for (const [url, list] of [...byLetter].sort((a, b) => hash(a[0]).localeCompare(hash(b[0])))) {
  const first = list[0];
  const type = first.reviewtype ?? "";
  if ((taken.get(type) ?? 0) >= (QUOTA[type] ?? 0)) continue;
  if (list.length < 2 || list.length > 10 || usedPermits.has(first.permitnum)) continue;
  const permit = permitBy.get(first.permitnum);
  if (!permit?.description) continue;
  const built: EvalComment[] = list.map((c, i) => {
    const clean = scrub(c.comment!).slice(0, 1200);
    return {
      id: `C${i + 1}`,
      text: maskCitations(clean),
      labels: {
        discipline: disciplineLabel(c),
        citations: findCitations(clean),
        route: routeLabel(c, clean),
        sheets: [...new Set([...clean.matchAll(SHEET)].map((m) => m[1].toUpperCase()))],
      },
    };
  });
  if (!built.some((c) => c.labels.discipline)) continue;
  const n = taken.get(type) ?? 0;
  taken.set(type, n + 1);
  usedPermits.add(first.permitnum);
  letters.push({
    id: `${String(letters.length + 1).padStart(2, "0")}-${type.toLowerCase().replace(/\W+/g, "-")}-${first.permitnum}`,
    holdout: n % 4 === 3,
    review_type: type,
    source: { letter: url, permit: permit.link && typeof permit.link === "object" ? (permit.link as unknown as { url: string }).url : first.permitnum, document_date: first.documentdate?.slice(0, 10) },
    project: {
      jurisdiction: "seattle",
      address: permit.originaladdress1,
      description: `${scrub(permit.description).slice(0, 400)} Permit class: ${permit.permitclass ?? "unknown"}. Zoning: ${permit.zoning ?? "unknown"}.`,
      reviewer: `Seattle SDCI, ${first.documenttitle ?? "correction letter"}`,
    },
    outcome: { review_cycles: Number(permit.numberreviewcycles ?? 0) || null, days_out_for_corrections: Number(permit.daysoutcorrections ?? 0) || null, days_city_review: Number(permit.daysplanreviewcity ?? 0) || null },
    comments: built,
  });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "letters.json"), JSON.stringify({ note: "Real letters from Seattle's public Plan Comments dataset. Reviewers' code citations are hidden in the text and kept as labels. Contact details removed.", letters }, null, 1) + "\n");

// ---------- past comments the agent can search: never the eval permits ----------

const corpus = comments
  .filter((c) => c.comment?.trim() && !usedPermits.has(c.permitnum))
  .map((c) => ({ review_type: c.reviewtype ?? null, subject: c.commentsubject ?? null, cycle: Number(c.reviewcycle) || null, text: scrub(c.comment!).slice(0, 700), citations: findCitations(c.comment!) }));
mkdirSync(PACK, { recursive: true });
writeFileSync(join(PACK, "comments.jsonl"), corpus.map((c) => JSON.stringify(c)).join("\n") + "\n");

// ---------- code index: what reviewers actually cite ----------

const cites = new Map<string, { count: number; subjects: Map<string, number>; names: Map<string, number> }>();
for (const c of comments) {
  const text = c.comment ?? "";
  for (const id of findCitations(text)) {
    const e = cites.get(id) ?? { count: 0, subjects: new Map(), names: new Map() };
    e.count++;
    if (c.commentsubject) e.subjects.set(c.commentsubject, (e.subjects.get(c.commentsubject) ?? 0) + 1);
    const name = text.match(new RegExp(`${id.split(" ")[1].replace(/\./g, "\\.")}[\\w.()]*\\s*\\(([A-Z][^)]{3,50})\\)`))?.[1];
    if (name) e.names.set(name, (e.names.get(name) ?? 0) + 1);
    cites.set(id, e);
  }
}
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
const FAMILY_NAME: Record<string, string> = { SMC: "Seattle Municipal Code", SBC: "Seattle Building Code", SRC: "Seattle Residential Code", SEC: "Seattle Energy Code", SFC: "Seattle Fire Code" };
const sections = [...cites]
  .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
  .map(([id, e]) => ({
    id,
    title: top(e.names, 1)[0] ?? top(e.subjects, 1)[0] ?? FAMILY_NAME[id.split(" ")[0]],
    scope: `${FAMILY_NAME[id.split(" ")[0]]}. Cited ${e.count} time(s) in Seattle correction letters, on subjects: ${top(e.subjects, 4).join("; ") || "not recorded"}.`,
  }));
sections.push({
  id: "SDCI-RESPONSE",
  title: "How to respond to review comments (SDCI process)",
  scope: "Not a code section. Wait for all reviews to finish, reply to each comment in the plan set, cloud the changes, upload both a response set and a clean set, and cite code if you decline a change. Source: seattle.gov/construction-and-inspections/permits/how-to-respond-to-review-comments.",
});
writeFileSync(join(PACK, "code.json"), JSON.stringify({ note: "Mined from citations in Seattle's public Plan Comments dataset, so it holds only sections reviewers have cited, and titles come from reviewers' subject lines rather than the code. Spans code editions. Not code text.", sections }, null, 1) + "\n");

// ---------- permit stats, with definitions attached ----------

const withCycles = permits.filter((p) => Number(p.numberreviewcycles) >= 1);
const statRows = [...new Set(withCycles.map((p) => p.permitclass ?? "Unknown"))]
  .map((cls) => {
    const group = withCycles.filter((p) => (p.permitclass ?? "Unknown") === cls);
    const nums = (k: string) => group.map((p) => Number(p[k])).filter((n) => Number.isFinite(n));
    return { review_type: cls, permits: group.length, median_cycles: median(nums("numberreviewcycles")), avg_days: median(nums("daysoutcorrections")), median_days_city: median(nums("daysplanreviewcity")) };
  })
  .sort((a, b) => b.permits - a.permits);
writeFileSync(
  join(PACK, "permit-stats.json"),
  JSON.stringify({ source: "City of Seattle Open Data, Building Permits (76t5-zqzr), for permits in the Plan Comments dataset", url: "https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr", filter: `${withCycles.length} permits with at least one recorded review cycle`, measure: "avg_days here is the median days out for corrections, with the applicant. This is a sample, not all Seattle permits.", retrieved: new Date().toISOString().slice(0, 10), rows: statRows }, null, 2) + "\n",
);

// ---------- what recurs: a comment on the same subject and permit, with similar wording, in a later cycle ----------

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(1, a.size + b.size - shared);
};
const bySubject = new Map<string, { first: number; recurred: number; permits: Set<string> }>();
const byPermitSubject = new Map<string, RawComment[]>();
for (const c of comments) {
  if (!c.commentsubject || !Number(c.reviewcycle) || /Code Edition|Code reviewed/i.test(c.commentsubject)) continue;
  const key = `${c.permitnum}|${c.reviewtype}|${c.commentsubject}`;
  (byPermitSubject.get(key) ?? byPermitSubject.set(key, []).get(key)!).push(c);
}
for (const [key, list] of byPermitSubject) {
  const [permit, type, subject] = key.split("|");
  const label = `${type}: ${subject}`;
  const s = bySubject.get(label) ?? { first: 0, recurred: 0, permits: new Set<string>() };
  const firsts = list.filter((c) => Number(c.reviewcycle) === 1);
  const later = list.filter((c) => Number(c.reviewcycle) > 1).map((c) => tokens(c.comment ?? ""));
  for (const c of firsts) {
    s.first++;
    s.permits.add(permit);
    const words = tokens(c.comment ?? "");
    if (later.some((w) => overlap(words, w) >= 0.5)) s.recurred++;
  }
  bySubject.set(label, s);
}
const recurrence = [...bySubject]
  .filter(([, s]) => s.first >= 30)
  .map(([subject, s]) => ({ subject, first_cycle_comments: s.first, permits: s.permits.size, recurred: s.recurred, recurred_share: Math.round((1000 * s.recurred) / s.first) / 10 }))
  .sort((a, b) => b.recurred_share - a.recurred_share);
const types = new Map<string, number>();
for (const c of comments) types.set(c.reviewtype ?? "Not recorded", (types.get(c.reviewtype ?? "Not recorded") ?? 0) + 1);
writeFileSync(
  join(OUT, "insights.json"),
  JSON.stringify({ note: "A first-cycle comment counts as recurring when a later cycle on the same permit, review type and subject has wording that overlaps at least 50%. This undercounts rewritten comments and can't say why it recurred.", comments: comments.length, permits: permitNums.length, letters: byLetter.size, by_review_type: [...types].sort((a, b) => b[1] - a[1]).map(([review_type, count]) => ({ review_type, count })), recurrence }, null, 1) + "\n",
);

const scored = letters.flatMap((l) => l.comments);
console.log(`letters: ${letters.length} (${letters.filter((l) => l.holdout).length} holdout), comments: ${scored.length}`);
console.log(`labeled: discipline ${scored.filter((c) => c.labels.discipline).length}, citation ${scored.filter((c) => c.labels.citations.length).length}, route ${scored.filter((c) => c.labels.route).length}`);
console.log(`code index: ${sections.length} entries; searchable past comments: ${corpus.length}`);
console.log(`still contains a visible citation after masking: ${scored.filter((c) => findCitations(c.text).length).length}`);
