// Step 1: find markets. Searches public open-data catalogs for permit datasets, then measures each one by querying it.
//
// No model runs here. Every number comes from a query, and the query is stored next to the number so anyone can rerun it.
// A candidate's tier says what we can do with it, not how big the market is:
//   A  correction text is public, so the corrections agent can be built and scored here without anyone's help.
//   B  rework is measured (cycles, or disapprovals), but the text isn't public. Real demand signal, nothing to score on.
// Definitions differ between cities, so these numbers rank what's possible. They aren't a league table of pain.

import { CANDIDATES, getJson, loadPolicy, median, type Policy, quoteSoql, soql, writeJsonFile } from "./lib.ts";

export interface CatalogResource {
  domain: string;
  dataset: string;
  name: string;
  attribution: string | null;
  license: string | null;
  updated_at: string | null;
  columns: string[];
  column_types: string[];
  page: string;
}

export interface Measure {
  value: number;
  definition: string;
  query: string;
}

export interface Candidate extends CatalogResource {
  place: string;
  tier: "A" | "B";
  excluded: string | null;
  stale: boolean;
  text_column: string | null;
  date_column: string | null;
  review_type_column: string | null;
  measures: Record<string, Measure>;
  checked_at: string;
}

// Permit work, not inspections of restaurants, surveys, or land records.
const ON_TOPIC = /permit|plan review|plan check|plan comment|development review|building review|site plan|\bplans?\b.*review/i;
const OFF_TOPIC = /food|restaurant|retail|liquor|cannabis|survey|water rate|grocery|childcare|pool|hazard|\bwell\b|floodplain|flood|noise|encampment|sidewalk|street|right.of.way|taxi|vendor|parking|traffic control|licen[sc]e|gazetteer|violation|complaint|code enforcement|assess|tax|fire prevention|performance metric|performance measure|\bfy\b|fiscal year|budget/i;
const TEXT_COLUMN = /comment|correction|remark|condition/i;
const NOT_TEXT = /count|number|date|\bid\b|_id$|^id|flag|type|status|_cd$|code$|computed_region/i;
const CYCLE_COLUMN = /cycle|resubmi/i;
const RESULT_COLUMN = /^(status|result|outcome|disposition|review_status|review_result|reviewstatus|reviewresult)$/i;
const REWORK = /disapprov|denied|correction|resubmit|revis|additional info|rejected|incomplete|not approved|deficien/i;
const DATE_NAME = /(entry|document|review|completed|applied|application|processed|submit|filing|issue|status).*date|date.*(entry|document|review|completed|applied|application|processed|submit|filing|issue)/i;
const REVIEW_TYPE_NAME = /review_?type|item_id_desc|review_?name|^type$|discipline|department|division|reviewer_?group/i;

// Language that asks an applicant to do something, which is what makes a comment a correction.
const ASKS = /\b(provide|submit|revise|resubmit|show|indicate|specify|required?|must|shall|please|correct|missing|clarify|identify|update|add|remove|document|comply)\b/i;

export function isOnTopic(r: Pick<CatalogResource, "name" | "columns">): boolean {
  if (OFF_TOPIC.test(r.name)) return false;
  const columns = r.columns.join(" ");
  return ON_TOPIC.test(r.name) || (/permit|plan_?review/i.test(columns) && /review|cycle/i.test(columns));
}

export function pickColumns(r: Pick<CatalogResource, "columns" | "column_types">) {
  const typed = r.columns.map((name, i) => ({ name, type: r.column_types[i] ?? "" }));
  const named = (re: RegExp) => typed.filter((c) => re.test(c.name) && !c.name.startsWith(":"));
  return {
    text: named(TEXT_COLUMN).filter((c) => !NOT_TEXT.test(c.name) && /text|^$/i.test(c.type)).map((c) => c.name),
    cycle: named(CYCLE_COLUMN).filter((c) => /number|text|^$/i.test(c.type) && !/date|comment|due/i.test(c.name)).map((c) => c.name),
    result: named(RESULT_COLUMN).map((c) => c.name),
    date: named(DATE_NAME).filter((c) => /calendar|date|^$/i.test(c.type)).map((c) => c.name)[0] ?? null,
    review_type: named(REVIEW_TYPE_NAME).filter((c) => /text|^$/i.test(c.type)).map((c) => c.name)[0] ?? null,
  };
}

/** How much of a sample of a text column reads like corrections. Pure, so it's tested on real samples. */
export function assessText(samples: string[]): { correction_share: number; median_length: number; distinct_share: number } {
  const clean = samples.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return { correction_share: 0, median_length: 0, distinct_share: 0 };
  return {
    correction_share: clean.filter((s) => s.length >= 40 && ASKS.test(s)).length / clean.length,
    median_length: median(clean.map((s) => s.length)) ?? 0,
    distinct_share: new Set(clean.map((s) => s.toLowerCase())).size / clean.length,
  };
}

/** A short id from a catalog domain: data.cincinnati-oh.gov → cincinnati. */
export function placeId(domain: string): string {
  const parts = domain.toLowerCase().replace(/^(www|data|datahub|cos-data|citydata|opendata|open|stat|internal\.open|dashboard|performance|datacatalog|catalog|highways)\./, "").split(".");
  return parts[0].replace(/^(cityof|city-of|countyof)/, "").replace(/-(oh|va|il|wa|or|ca|tx|fl|ny|md|mo|la|az|ma|nj|pa|co|ut|nc|sc|ga|ct|ri|hi)$/, "").replace(/(county)?(md|va|wa|oh|az|texas)$/, "") || parts[0];
}

interface SocrataHit {
  resource: { id: string; name: string; attribution?: string | null; data_updated_at?: string; updatedAt?: string; columns_field_name?: string[]; columns_datatype?: string[]; type?: string };
  metadata: { domain: string; license?: string };
  permalink?: string;
}

export async function searchCatalogs(policy: Policy, log = console.log): Promise<CatalogResource[]> {
  const seen = new Map<string, CatalogResource>();
  for (const catalog of policy.discovery.catalogs) {
    for (const q of policy.discovery.queries) {
      const url = `${catalog}?q=${encodeURIComponent(q)}&only=datasets&limit=${policy.discovery.max_results_per_query}`;
      const reply = await getJson<{ results: SocrataHit[] }>(url).catch((e: Error) => {
        log(`  ! ${e.message}`);
        return { results: [] as SocrataHit[] };
      });
      for (const hit of reply.results) {
        // The same dataset is often listed under more than one federated domain.
        const key = hit.resource.id;
        if (seen.has(key)) continue;
        seen.set(key, {
          domain: hit.metadata.domain,
          dataset: hit.resource.id,
          name: hit.resource.name,
          attribution: hit.resource.attribution ?? null,
          license: hit.metadata.license ?? null,
          updated_at: hit.resource.data_updated_at ?? hit.resource.updatedAt ?? null,
          columns: hit.resource.columns_field_name ?? [],
          column_types: hit.resource.columns_datatype ?? [],
          page: hit.permalink ?? `https://${hit.metadata.domain}/d/${hit.resource.id}`,
        });
      }
    }
  }
  return [...seen.values()];
}

/** Measures one dataset. Returns null when nothing in it shows corrections or rework. */
export async function assess(r: CatalogResource, policy: Policy, now = new Date()): Promise<Candidate | null> {
  const d = policy.discovery;
  const picked = pickColumns(r);
  const measures: Record<string, Measure> = {};
  const count = async (where?: string) => {
    const query = soql(r.domain, r.dataset, where ? { select: "count(*) as n", where } : { select: "count(*) as n" });
    const [row] = await getJson<{ n: string }[]>(query);
    return { n: Number(row?.n ?? 0), query };
  };

  const total = await count();
  if (total.n < d.min_rows) return null;
  measures.rows = { value: total.n, definition: "All rows in the dataset", query: total.query };

  // Text: does some comment column read like corrections?
  let textColumn: string | null = null;
  for (const column of picked.text) {
    const query = soql(r.domain, r.dataset, { select: column, where: `${column} is not null`, limit: 400, ...(picked.date ? { order: `${picked.date} DESC` } : {}) });
    const rows = await getJson<Record<string, unknown>[]>(query).catch(() => []);
    const samples = rows.map((x) => (typeof x[column] === "string" ? (x[column] as string) : ""));
    const t = assessText(samples);
    if (t.correction_share >= d.min_correction_share && t.median_length >= d.min_median_text_length && t.distinct_share >= 0.3) {
      const withText = await count(`${column} is not null`);
      if (withText.n < d.min_rows) continue;
      textColumn = column;
      measures.rows_with_text = { value: withText.n, definition: `Rows with text in ${column}`, query: withText.query };
      measures.correction_share = { value: Math.round(t.correction_share * 1000) / 10, definition: `Percent of up to 400 recent ${column} rows at least 40 characters long that ask the applicant to do something (keyword match)`, query };
      measures.median_text_length = { value: t.median_length, definition: `Median characters in those rows`, query };
      break;
    }
  }

  // Cycles: how many rounds does a filing take?
  for (const column of picked.cycle) {
    const query = soql(r.domain, r.dataset, { select: `${column} as cycles,count(*) as n`, where: `${column} is not null`, group: column, limit: 60 });
    const rows = await getJson<{ cycles?: string; n: string }[]>(query).catch(() => []);
    const numeric = rows.map((x) => ({ c: Number(x.cycles), n: Number(x.n) })).filter((x) => Number.isInteger(x.c) && x.c >= 1 && x.c < 60);
    const n = numeric.reduce((s, x) => s + x.n, 0);
    // A column of ids or years would pass "is a number". Real cycle counts are mostly small.
    if (n < d.min_cycle_rows || numeric.some((x) => x.c > 40 && x.n > n * 0.02)) continue;
    const many = numeric.filter((x) => x.c >= 2).reduce((s, x) => s + x.n, 0);
    measures.filings_with_cycle_count = { value: n, definition: `Rows with a positive count in ${column}`, query };
    measures.share_needing_2_plus_cycles = { value: Math.round((1000 * many) / n) / 10, definition: `Percent of those with 2 or more in ${column}. Includes every permit type in the dataset, and open filings.`, query };
    break;
  }

  // Results: how many review steps came back with something to fix?
  for (const column of picked.result) {
    const query = soql(r.domain, r.dataset, { select: `${column} as result,count(*) as n`, where: `${column} is not null`, group: column, limit: 60 });
    const rows = await getJson<{ result?: string; n: string }[]>(query).catch(() => []);
    const rework = rows.filter((x) => REWORK.test(x.result ?? "")).reduce((s, x) => s + Number(x.n), 0);
    const approved = rows.filter((x) => /approv/i.test(x.result ?? "") && !REWORK.test(x.result ?? "")).reduce((s, x) => s + Number(x.n), 0);
    const done = rework + approved;
    // With hardly any approvals, this column is a permit's status rather than a review's outcome, and the share means nothing.
    if (done < d.min_cycle_rows || rework < done * 0.02 || approved < done * 0.1) continue;
    measures.review_steps_decided = { value: done, definition: `Review steps approved or sent back, by ${column}`, query };
    measures.share_sent_back = { value: Math.round((1000 * rework) / done) / 10, definition: `Percent of those sent back (${rows.filter((x) => REWORK.test(x.result ?? "")).map((x) => x.result).join(", ")})`, query };
    break;
  }

  const hasRework = "share_needing_2_plus_cycles" in measures || "share_sent_back" in measures;
  if (!textColumn && !hasRework) return null;
  if (picked.date) {
    const since = new Date(now.getTime() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const recent = await count(`${picked.date}>='${since}' AND ${picked.date}<='${now.toISOString().slice(0, 10)}'${textColumn ? ` AND ${textColumn} is not null` : ""}`).catch(() => null);
    if (recent) measures.rows_last_12_months = { value: recent.n, definition: `Rows dated in the last 12 months by ${picked.date}${textColumn ? `, with text in ${textColumn}` : ""}`, query: recent.query };
  }

  const place = placeId(r.domain);
  const updated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
  return {
    ...r,
    place,
    tier: textColumn ? "A" : "B",
    excluded: policy.exclude[place] ?? null,
    // A catalog date can move with no new rows, so a dated dataset with nothing in the last year is stale too.
    stale: !updated || now.getTime() - updated > d.stale_after_days * 24 * 3600 * 1000 || measures.rows_last_12_months?.value === 0,
    text_column: textColumn,
    date_column: picked.date,
    review_type_column: picked.review_type,
    measures,
    checked_at: now.toISOString(),
  };
}

/** A fixed order: can we score it, is it fresh, how much recent data is there. Pure, so it can't be argued with. */
export function rank(candidates: Candidate[]): Candidate[] {
  const recent = (c: Candidate) => c.measures.rows_last_12_months?.value ?? 0;
  return [...candidates].sort((a, b) => a.tier.localeCompare(b.tier) || Number(a.stale) - Number(b.stale) || recent(b) - recent(a) || (b.measures.rows?.value ?? 0) - (a.measures.rows?.value ?? 0));
}

export async function discover(log = console.log): Promise<Candidate[]> {
  const policy = loadPolicy();
  const all = await searchCatalogs(policy, log);
  const topical = all.filter(isOnTopic);
  log(`Catalog search: ${all.length} datasets, ${topical.length} about permits. Measuring them…`);
  const found: Candidate[] = [];
  for (const r of topical) {
    const c = await assess(r, policy).catch((e: Error) => {
      log(`  ! ${r.domain}/${r.dataset}: ${e.message}`);
      return null;
    });
    if (c) {
      found.push(c);
      log(`  ${c.tier} ${c.place.padEnd(18)} ${c.name.slice(0, 60)}`);
    }
  }
  const ranked = rank(found);
  writeJsonFile(CANDIDATES, { searched_at: new Date().toISOString(), datasets_searched: all.length, datasets_measured: topical.length, candidates: ranked });
  return ranked;
}

export { quoteSoql };
