// npm run markets:test
// Offline, no model calls. Fixtures are shaped like real rows from the Seattle and Cincinnati datasets.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { citationsFor, findCitations, maskCitations, normalize as seattleNormalize, parent as seattleParent, type CitationStyle } from "../../realdata/citations.ts";
import { build, disciplineFromCitation, repair, routeFromCitation, splitLetter, validate, verifyFacts, type Row, type Source } from "../build.ts";
import { outcomes, pick } from "../cycle.ts";
import { assessText, isOnTopic, pickColumns, placeId, rank, type Candidate } from "../discover.ts";
import { decide, pairedDelta, readiness, type PlaceRun } from "../gate.ts";
import { loadPolicy, MARKETS_DIR, overBudget } from "../lib.ts";
import { measureText } from "../onboard.ts";
import { robotsAllows } from "../../outreach/research.ts";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ""}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const policy = loadPolicy();

// ---------- citations ----------

const style: CitationStyle = {
  families: [
    { code: "OBC", name: "Ohio Building Code", kind: "ibc", aliases: ["Ohio Building Code", "Building Code of Ohio"] },
    { code: "RCO", name: "Residential Code of Ohio", kind: "irc", aliases: [] },
    { code: "CBC", name: "Cincinnati Building Code", kind: "dashed_municipal", aliases: [] },
    { code: "CZC", name: "Cincinnati Zoning Code", kind: "dashed_municipal", aliases: [] },
  ],
  bare_section_family: "CZC",
};
const cites = citationsFor(style);

check("finds a plain model-code citation at section level", same(cites.find("OBC 1705.3 - Special inspections"), ["OBC 1705"]));
check("finds a short section", same(cites.find("OBC 106.1.1(7) - Information"), ["OBC 106"]));
check("finds a code by its full name", same(cites.find("2024 Ohio Building Code - 1705 - Special inspections"), ["OBC 1705"]));
check("takes the section after an abbreviation in brackets, not the edition year", same(cites.find("2017 Building Code of Ohio (OBC) 105.1.4 - Details"), ["OBC 105"]));
check("doesn't read a year as a section", same(cites.find("Comply with OBC 2019 edition"), []));
check("finds a dashed municipal citation", same(cites.find("CBC 1101-23.1 General: provide name"), ["CBC 1101-23"]));
check("assigns a bare section sign to its family", same(cites.find("Per §1425-15(a), parking may not be located"), ["CZC 1425-15"]));
check("also reads a bare section after Per or Section", same(cites.find("Per 1433-19(g), excavation should not exceed"), ["CZC 1433-19"]) && same(cites.find("Section 1405-07 applies"), ["CZC 1405-07"]));
check("doesn't read a phone-like or plain number as a section", same(cites.find("Provide 1433 square feet, call 513-555"), []));
check("chapter of a model code", cites.parent("OBC 1705") === "OBC 17" && cites.parent("OBC 106") === "OBC 1");
check("chapter of a dashed code", cites.parent("CZC 1425-15") === "CZC 1425");
check("normalizes what the agent replies", cites.normalize("OBC 1705") === "OBC 1705" && cites.normalize("nonsense") === null);

for (const text of ["OBC 1705.3 - Special inspections are required", "Per §1425-15(a), parking may not", "RCO Section 311.7 stairs", "301.2.1.1.1 Sunrooms: identify which", "Table 1604.5 risk category", "CBC 1101-23.1 General"]) {
  const masked = cites.mask(text);
  check(`masking leaves no citation: ${text.slice(0, 30)}`, cites.find(masked).length === 0 && !/\d{3,4}[.-]\d/.test(masked), masked);
}

// Seattle's frozen letters must score the same through both paths.
const seattleStyle = citationsFor({ families: [{ code: "SMC", name: "Seattle Municipal Code", kind: "dotted_municipal" }, { code: "SBC", name: "Seattle Building Code", kind: "ibc" }, { code: "SRC", name: "Seattle Residential Code", kind: "irc" }, { code: "SEC", name: "Seattle Energy Code", kind: "model" }, { code: "SFC", name: "Seattle Fire Code", kind: "model" }] });
for (const text of ["SMC 23.44.041.B applies", "SRC Table R302.1(1)", "SBC 1011.5 stairs", "SEC Section C402.1"]) {
  check(`the general parser agrees with Seattle's: ${text}`, same(seattleStyle.find(text), findCitations(text)), { general: seattleStyle.find(text), seattle: findCitations(text) });
}
check("Seattle's parent is unchanged", seattleStyle.parent("SMC 23.44.041") === seattleParent("SMC 23.44.041") && seattleStyle.parent("SRC R302") === seattleParent("SRC R302"));
check("Seattle's own functions still work", seattleNormalize("SBC 1011.5") === "SBC 1011" && !findCitations(maskCitations("SBC 1011.5")).length);

// ---------- letters ----------

const numbered = "1.\t2017 Ohio Building Code (OBC)\n2.\tOBC 106.1 - Information on construction documents:\na)\tSpecify the governing code in the summary.\nb)\tSeparate approvals will be required for electric.\n3.\tOBC 1604 - Specify the design wind load in the general structural notes.";
const split = splitLetter(numbered);
check("splits a letter on its top-level numbers", split.length === 3, split);
check("keeps a) and b) with their parent", split[1].includes("a)") && split[1].includes("b)"));
check("splits an unnumbered letter on blank lines", splitLetter("Provide a site plan.\n\nShow the north arrow.").length === 2);
check("IBC chapter gives a discipline", disciplineFromCitation("OBC 1011", style.families) === "egress" && disciplineFromCitation("OBC 1604", style.families) === "structural");
check("the construction-documents chapter gives none, since it's cited about anything", disciplineFromCitation("OBC 106", style.families) === null && disciplineFromCitation("RCO 106", style.families) === null);
check("a section number opening a line is masked, but an edition year isn't", cites.mask("1004 Factory-Built Fireplace: show it").includes("[code reference removed]") && cites.mask("2019 Plan review is based").startsWith("2019"));
check("a municipal section gives no discipline by itself", disciplineFromCitation("CBC 1101-23", style.families) === null);
check("IRC stairs route to the professional", routeFromCitation("RCO 311", style.families) === "licensed_review");
check("a non-obvious section gets no route label", routeFromCitation("OBC 106", style.families) === null);

const source: Source = {
  id: "testville",
  name: "City of Testville",
  authority: "Testville Buildings",
  domain: "data.testville.example",
  dataset: "abcd-1234",
  fields: { permit: "number_key", text: "entry_comments", review_type: "item_id_desc", date: "entry_date", description: "desc_of_work", permit_class: "sub_type_desc", zoning: null, subject: null, letter: null, cycle: null },
  shape: "row_per_letter",
  review_types: ["BPE Review Letter Comments", "ZPE Review Letter Comments"],
  review_type_discipline: { "BPE Review Letter Comments": null, "ZPE Review Letter Comments": "zoning" },
  review_type_route: {},
  families: style.families,
  bare_section_family: "CZC",
  code_basis: "Ohio codes.",
  hints: ["Testville"],
};
const columns = ["number_key", "entry_comments", "item_id_desc", "entry_date", "desc_of_work", "sub_type_desc"];

function fixtureRows(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const bpe = i % 2 === 0;
    rows.push({
      number_key: `2024P${String(i).padStart(5, "0")}`,
      entry_date: `2024-${String((i % 12) + 1).padStart(2, "0")}-15T00:00:00.000`,
      item_id_desc: bpe ? "BPE Review Letter Comments" : "ZPE Review Letter Comments",
      desc_of_work: `Alter a building, job ${i}`,
      sub_type_desc: "Alter Commercial",
      entry_comments: bpe
        ? `1.\tOBC 1604.${i} - Specify the design wind load in the general structural notes on sheet S-100.\n2.\tOBC 1011.${i} - Provide stair details and headroom dimensions for the new exit stair.\n3.\tRCO 311.${i} - Show the stair rise and run on the drawings for the dwelling.\n4.\tCBC 1101-${i} General: provide the name and address of the person who prepared the drawings.\n5.\tSee reviewer jane.doe@example.gov or 513-555-0100 with questions about the required exit details.\nReviewed by Gailene Hill`
        : `1. Per §1425-${(i % 30) + 1}, parking may not be located in any front yard of this zoning district.\n2. Per §1405-${(i % 9) + 1}, the required rear yard setback applies and the proposed deck needs a variance.`,
    });
  }
  // Wrong review type, and a letter edited after the fact: neither may reach the eval.
  rows.push({ number_key: "2024P99998", entry_date: "2024-01-01T00:00:00.000", item_id_desc: "Internal Note", desc_of_work: "x", entry_comments: "1. OBC 1604 - Internal note about the job that is long enough.\n2. OBC 1011 - Another internal note about the same job here." });
  rows.push({ number_key: "2024P99999", entry_date: "2024-01-01T00:00:00.000", item_id_desc: "BPE Review Letter Comments", desc_of_work: "x", entry_comments: "1. OBC 106.1 - Issue resolved 2/27/23\n2. OBC 705.3 - Issues resolved 2/27/23\n3. OBC 1301 - Document how the building complies with the energy code." });
  return rows;
}

const rows = fixtureRows(200);
const built = build(source, rows, policy);
const allComments = built.letters.flatMap((l) => l.comments);
check("builds the number of letters asked for", built.letters.length === policy.evaluation.letters, built.counts);
check("building twice gives identical letters", same(built.letters, build(source, rows, policy).letters));
check("row order doesn't change the letters", same(built.letters, build(source, [...rows].reverse(), policy).letters));
check("every fourth letter is a holdout", built.counts.holdout_letters === Math.floor(policy.evaluation.letters / 4), built.counts);
check("each letter is a different permit", new Set(built.letters.map((l) => l.source.permit)).size === built.letters.length);
check("the agent can't see a citation", allComments.every((c) => !cites.find(c.text).length));
check("citations are kept as labels", allComments.some((c) => c.labels.citations.includes("OBC 1604")));
check("the city's review type gives zoning", allComments.some((c) => c.labels.discipline === "zoning"));
check("a code chapter gives the discipline for a general examiner", allComments.some((c) => c.labels.discipline === "structural") && allComments.some((c) => c.labels.discipline === "egress"));
check("contact details are gone", allComments.every((c) => !/@|555-0100/.test(c.text)));
check("reviewers' names are gone", allComments.every((c) => !/Gailene|jane\.doe/.test(c.text)) && built.pastComments.every((c) => !/Gailene|jane\.doe/.test(c.text)));
check("other review types stay out", !built.letters.some((l) => l.source.permit === "2024P99998") && !built.pastComments.some((c) => /Internal note/.test(c.text)));
check("a letter edited after the fact stays out", !built.letters.some((l) => l.source.permit === "2024P99999"));
const evalPermits = new Set(built.letters.map((l) => l.source.permit));
const pastText = new Set(built.pastComments.map((c) => c.text));
check("past comments exclude the eval permits", rows.filter((r) => evalPermits.has(r.number_key as string)).every((r) => !pastText.has(String(r.entry_comments).slice(0, 50))));
check("every label is citable, so a right answer can't score as not in the index", allComments.flatMap((c) => c.labels.citations).every((id) => built.sections.some((s) => s.id === id)));

check("a good mapping passes", validate(source, rows, columns, policy).length === 0, validate(source, rows, columns, policy));
const has = (bad: Partial<Source>, re: RegExp, data = rows) => validate({ ...source, ...bad }, data, columns, policy).some((p) => re.test(p));
check("rejects a column that doesn't exist", has({ fields: { ...source.fields, text: "nope" } }, /isn't a column/));
check("rejects a review type not in the data", has({ review_types: ["Made Up"] }, /isn't a value/));
check("rejects a discipline outside the list", has({ review_type_discipline: { "ZPE Review Letter Comments": "vibes" } }, /Allowed/));
check("rejects a route outside the list", has({ review_type_route: { "ZPE Review Letter Comments": "skip_it" } }, /Allowed/));
check("rejects an id that's already a place", validate(source, rows, columns, policy, ["testville"]).some((p) => /already/.test(p)));
check("rejects a family that never matches", has({ families: [...source.families, { code: "XYZ", name: "x", kind: "model" }] }, /never matched/));
check("names a code family the mapping missed", validate(source, fixtureRows(200).map((r) => ({ ...r, entry_comments: String(r.entry_comments).replace(/OBC 1604/g, "OEBC 1604") })), columns, policy).some((p) => /also cite "OEBC"/.test(p)));
check("rejects a family code that isn't a code name", has({ families: [...source.families, { code: "Sec.", name: "x", kind: "dashed_municipal" }] }, /capital letters/));
const measured = measureText([numbered, "OBC 1705 - Provide special inspections.", "Per §1425-15(a), parking may not be here. See SHEET 12."]);
check("measures code names by share of rows", measured.codes.OBC === 67 && !("SHEET" in measured.codes), measured);
check("measures numbered letters and section signs", measured.numbered_share === 33 && measured.bare_section_signs === 33, measured);
check("rejects a dashed code declared as a model code", has({ families: source.families.map((f) => (f.code === "CBC" ? { ...f, kind: "ibc" as const } : f)) }, /should be "dashed_municipal"/));
check("rejects a model code declared as dashed", has({ families: source.families.map((f) => (f.code === "OBC" ? { ...f, kind: "dashed_municipal" as const } : f)) }, /aren't written that way/));
check("rejects a missing family for bare sections", has({ bare_section_family: null, families: source.families.filter((f) => f.code !== "CZC") }, /no code name/));
check("rejects a review type that rarely holds a letter", has({ review_types: [...source.review_types, "Short Note"] }, /isn't where comment letters live/, [...rows, ...Array.from({ length: 30 }, (_, i) => ({ number_key: `N${i}`, entry_date: "2024-01-01", item_id_desc: "Short Note", desc_of_work: "x", entry_comments: "See line 11." }))]));
check("rejects a review type that barely cites code", has({ review_types: [...source.review_types, "Other Agency"] }, /barely be scored/, [...rows, ...Array.from({ length: 30 }, (_, i) => ({ number_key: `W${i}`, entry_date: "2024-01-01", item_id_desc: "Other Agency", desc_of_work: "x", entry_comments: "Owner will need to upgrade the existing water service branch to current standards." }))]));
check("the model can't set a route label", !/review_type_route/.test(readFileSync(join(MARKETS_DIR, "onboard.ts"), "utf8").split("function promptFor")[1].split("async function fetchRows")[0]));
const bad: Source = { ...source, review_types: [...source.review_types, "Other Agency"], bare_section_family: null, families: [{ code: "OBC", name: "x", kind: "dashed_municipal" }, { code: "CBC", name: "y", kind: "ibc" }, { code: "RCO", name: "z", kind: "irc" }, { code: "NEVER", name: "n", kind: "model" }, { code: "Sec.", name: "s", kind: "model" }] };
const otherRows: Row[] = [...rows, ...Array.from({ length: 30 }, (_, i) => ({ number_key: `W${i}`, entry_date: "2024-01-01", item_id_desc: "Other Agency", desc_of_work: "x", entry_comments: "Owner will need to upgrade the existing water service branch." }))];
const fixed = repair(bad, otherRows, policy);
const kindOf = (c: string) => fixed.families.find((f) => f.code === c)?.kind;
check("repair sets each code's kind from how it's written", kindOf("CBC") === "dashed_municipal" && kindOf("OBC") === "model", fixed.families);
check("repair adds a family for bare sections, and says the name isn't known", fixed.bare_section_family === "LOCAL" && /don't name/.test(fixed.families.find((f) => f.code === "LOCAL")!.name));
check("repair removes codes that never match, and malformed ones", !fixed.families.some((f) => f.code === "NEVER" || f.code === "Sec."));
check("repair removes a type that can't be scored", !fixed.review_types.includes("Other Agency") && fixed.review_types.length === 2, fixed.review_types);
check("repair notes what it changed", (fixed.repairs ?? []).length >= 4, fixed.repairs);
check("a repaired mapping validates", validate(fixed, otherRows, columns, policy).length === 0, validate(fixed, otherRows, columns, policy));
const wrong: Source = { ...source, id: "testville", name: "City of Testville, Ohio", authority: "Building and Planning Enforcement", families: [{ code: "CBC", name: "Columbus Building Code", kind: "dashed_municipal", aliases: ["Made Up Name"] }, { code: "OBC", name: "Ohio Building Code", kind: "ibc", aliases: [] }], hints: ["Testville", "OBC", "BPE"] };
const checked = verifyFacts(wrong, [{ entry_comments: "Comply with the Ohio Building Code and CBC 1101-2.", item_id_desc: "x" }], "City of Testville", "testville");
check("a guessed code name doesn't survive", checked.families[0].name === "CBC (full name not confirmed)" && !checked.families[0].aliases?.length, checked.families[0]);
check("a name in the data does", checked.families[1].name === "Ohio Building Code");
check("a guessed department falls back to the publisher", checked.authority === "City of Testville");
check("hints are the place, not code initials another city would share", same(checked.hints, ["testville"]), checked.hints);
check("the place's name must match the publisher", verifyFacts({ ...wrong, name: "City of Columbus, Ohio" }, [], "City of Testville", "testville").name === "City of Testville");
check("rejects too few letters", has({}, /letters could be built/, fixtureRows(10)));
check("rejects families that leave citations unlabeled", has({ families: [{ code: "ZZZ", name: "z", kind: "model" }], bare_section_family: null }, /citation label/));

// ---------- discovery, on columns and text from the real datasets ----------

const seattleColumns = { name: "Plan Comments", columns: ["comment", "url", "documentdate", "reviewtype", "commentsubject", "permitnum", "reviewcycle", "documenttitle"], column_types: ["text", "url", "calendar_date", "text", "text", "text", "number", "text"] };
const cincinnati = { name: "Cincinnati Building Permits (Combo) w/ Plan Review Comments", columns: ["number_key", "entry_comments", "item_id_desc", "entry_date", "desc_of_work"], column_types: ["text", "text", "text", "calendar_date", "text"] };
check("a plan comments dataset is on topic", isOnTopic(seattleColumns) && isOnTopic(cincinnati));
check("food inspections aren't", !isOnTopic({ name: "Food Service Establishment Inspections", columns: ["permit", "review", "comment"] }));
check("a fiscal performance table isn't", !isOnTopic({ name: "168- FY 2019 Proposed, Performance Metrics", columns: ["permit_review"] }));
check("finds Seattle's text, cycle and review type columns", pickColumns(seattleColumns).text[0] === "comment" && same(pickColumns(seattleColumns).cycle, ["reviewcycle"]) && pickColumns(seattleColumns).review_type === "reviewtype");
check("finds Cincinnati's text column", same(pickColumns(cincinnati).text, ["entry_comments"]) && pickColumns(cincinnati).review_type === "item_id_desc");

const realCorrections = ["Provide a demolition plan so it is evident what construction is existing to remain.", "Specify the design wind load in the general structural notes on the drawings.", "Per the code, you must either revise the plans or obtain relief from the requirements."];
const kansasCityStyle = ["Construct new S/F residence per plans reviewed for code compliance including sidewalk.", "Remodel of existing single family residence per plans reviewed for code compliance.", "Reframing of front porch deck under existing covered roof per plans reviewed."];
check("corrections read as corrections", assessText(realCorrections).correction_share === 1);
check("work descriptions don't", assessText(kansasCityStyle).correction_share === 0, assessText(kansasCityStyle));
check("place ids read cleanly", placeId("data.cincinnati-oh.gov") === "cincinnati" && placeId("cos-data.seattle.gov") === "seattle" && placeId("data.cityoforlando.net") === "orlando" && placeId("data.norfolk.gov") === "norfolk", [placeId("data.cincinnati-oh.gov"), placeId("cos-data.seattle.gov"), placeId("data.cityoforlando.net"), placeId("data.norfolk.gov")]);

check("an excluded place's id matches its exclusion", placeId("datahub.austintexas.gov") === "austin" && placeId("citydata.mesaaz.gov") === "mesa", [placeId("datahub.austintexas.gov"), placeId("citydata.mesaaz.gov")]);
const candidate = (place: string, tier: "A" | "B", recent: number, extra: Partial<Candidate> = {}): Candidate => ({ place, tier, excluded: null, stale: false, text_column: tier === "A" ? "comment" : null, date_column: null, review_type_column: null, measures: { rows_last_12_months: { value: recent, definition: "", query: "" } }, checked_at: "", domain: "", dataset: place, name: place, attribution: null, license: null, updated_at: null, columns: [], column_types: [], page: "", ...extra });
const ranked = rank([candidate("b-big", "B", 90000), candidate("a-small", "A", 10), candidate("a-stale", "A", 99999, { stale: true }), candidate("a-big", "A", 500)]);
check("ranks scoreable, then fresh, then recent volume", same(ranked.map((c) => c.place), ["a-big", "a-small", "a-stale", "b-big"]));
check("pick skips places already built", pick(ranked, ["a-big"])?.place === "a-small");
check("pick skips stale and tier B", pick(ranked, ["a-big", "a-small"]) === null);
check("pick skips excluded places", pick([candidate("denver", "A", 900, { excluded: "competitor" }), candidate("x", "A", 1)], [])?.place === "x");
check("naming a place can't pick an excluded one", pick([candidate("denver", "A", 900, { excluded: "competitor" })], [], "denver") === null);

// ---------- the gate ----------

const comments = (scores: (number | null)[]) => scores.map((score, i) => ({ key: `L/C${i}`, score }));
const run = (scores: (number | null)[], extra: Partial<PlaceRun> = {}): PlaceRun => ({ score: 0, unsafe_routes: 0, compliance_claims: 0, comments: comments(scores), ...extra });
const low = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.5 : 0.25));
const high = low.map((x) => x + 0.3);
const noisy = low.map((x, i) => x + (i % 2 ? 0.2 : -0.18));

check("the interval is the same every time", same(pairedDelta(comments(low), comments(noisy), 0.025, 2000), pairedDelta(comments(low), comments(noisy), 0.025, 2000)));
const paired = pairedDelta(comments([0.5, null, 1]), comments([1, 1, null]), 0.05, 500);
check("only comments scored on both sides count", paired.n === 1 && paired.points === 50, paired);

const base = { place: "x", others: {}, minComments: 25 };
check("a clear rise is kept", decide({ ...base, before: run(low), after: run(high) }, policy).verdict === "kept");
check("a rise inside the noise is inconclusive", decide({ ...base, before: run(low), after: run(noisy) }, policy).verdict === "inconclusive", decide({ ...base, before: run(low), after: run(noisy) }, policy));
check("a big rise on a small holdout is inconclusive", decide({ ...base, before: run(low.slice(0, 10)), after: run(high.slice(0, 10)) }, policy).verdict === "inconclusive");
check("no rise is rejected", decide({ ...base, before: run(low), after: run(low) }, policy).verdict === "rejected");
check("a new unsafe route is rejected, however good the score", decide({ ...base, before: run(low), after: run(high, { unsafe_routes: 1 }) }, policy).verdict === "rejected");
check("more compliance claims are rejected", decide({ ...base, before: run(low), after: run(high, { compliance_claims: 3 }) }, policy).verdict === "rejected");
const hurt = { seattle: { before: run(high), after: run(low) } };
check("hurting another place is rejected", decide({ ...base, others: hurt, before: run(low), after: run(high) }, policy).verdict === "rejected");
check("an unsafe route in another place is rejected", decide({ ...base, others: { chicago: { before: run(low), after: run(low, { unsafe_routes: 1 }) } }, before: run(low), after: run(high) }, policy).verdict === "rejected");
check("noise in another place doesn't reject", decide({ ...base, others: { seattle: { before: run(low), after: run(noisy) } }, before: run(low), after: run(high) }, policy).verdict === "kept");

check("a rewrite that leaves letters unanswered is rejected, however good the score", decide({ ...base, before: run(low), after: run(high, { failed_letters: 2 }) }, policy).verdict === "rejected");
check("one blip isn't enough to reject", decide({ ...base, before: run(low), after: run(high, { failed_letters: 1 }) }, policy).verdict === "kept");
const letterResult = (id: string, status: string, score: number) => ({ letter_id: id, holdout: true, status, comments: [{ comment: "C1", score, unsafe: false }] });
const counted = outcomes([letterResult("a", "done", 1), letterResult("b", "error", 0), letterResult("c", "failed", 0)], true);
check("a failed turn is counted on its own, not as a wrong answer", counted.comments.length === 1 && counted.score === 100 && counted.failed_letters === 2, counted);
check("a task without a status still counts", outcomes([{ letter_id: "t", holdout: false, comments: [{ comment: "C1", score: 0.5, unsafe: false }] }], false).comments.length === 1);
const passing = { score: 80, citation_chapter_or_better_pct: 70, unsafe_routes: 0, unparsed_letters: 0 };
check("meets the bar", readiness(passing, policy).ready);
check("an unsafe route fails the bar", !readiness({ ...passing, unsafe_routes: 1 }, policy).ready);
check("a missing score fails the bar", !readiness({ ...passing, score: null }, policy).ready);

// ---------- budget ----------

const at = (hoursAgo: number) => new Date(Date.parse("2026-10-31T12:00:00Z") - hoursAgo * 3600000).toISOString();
const now = new Date("2026-10-31T12:00:00Z");
const spent = [{ at: at(1), place: "x", step: "run", usd: 11 }];
check("stops before passing the cycle limit", !!overBudget(spent, "x", at(2), 2, policy, now));
check("allows what fits", overBudget(spent, "x", at(2), 0.5, policy, now) === null);
check("an earlier cycle doesn't count against this one", overBudget(spent, "x", at(0.5), 2, policy, now) === null);
check("the daily limit covers every place", !!overBudget([{ at: at(3), place: "y", step: "run", usd: 14.5 }], "x", at(1), 1, policy, now));
check("yesterday doesn't count against the daily limit", overBudget([{ at: at(30), place: "y", step: "run", usd: 14.5 }], "x", at(1), 1, policy, now) === null);

// ---------- robots ----------

const socrataRobots = "User-agent: *\nCrawl-delay: 1\nDisallow: /browse?*&q=\nDisallow: /browse/*?*&q=\n";
check("Socrata's rules allow the data API", robotsAllows(socrataRobots, "/resource/thvx-5mem.json?$limit=1", "redlinemarketscout"));
check("a host that shuts out every agent is refused", !robotsAllows("User-agent: *\nDisallow: /\n", "/resource/x.json", "redlinemarketscout"));

// ---------- what the agent can't touch ----------

const cycleCode = readFileSync(join(MARKETS_DIR, "cycle.ts"), "utf8");
check("the loop's code never pushes or merges", !/["'`]push["'`]|["'`]merge["'`]/.test(cycleCode));
check("the market agent has no tools", /mcpServers: \[\]/.test(readFileSync(join(MARKETS_DIR, "onboard.ts"), "utf8")));

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
