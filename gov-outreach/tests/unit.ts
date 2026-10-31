// npx tsx gov-outreach/tests/unit.ts
// Offline, no model calls. Deadlines, compliance rules, the scope checks, the learning verdict and the scrubber.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { approvalProblems, gateIssues, refinementIssues, renderDraft, validateSender } from "../compliance.ts";
import { featuresOf, limitProblems } from "../draft.ts";
import { checkScrubbed, scrub, splitComments, toLetter } from "../intake.ts";
import { summaryProblem } from "../learn.ts";
import { addBusinessDays, addDays, deadlines, federalHolidays, isBusinessDay, ruleFor, toDate } from "../law.ts";
import { GOV_DIR, type Law, lawById, type LawFile, type RecordsEvent, type TargetFile } from "../lib.ts";
import { type Rule } from "../playbook.ts";
import { claimHolds, localTerms, opProblems, type ProposedOp, type ScopeContext, tallyFor } from "../scope.ts";
import { featureVerdict, type IntakeRecord, summarize } from "../stats.ts";
import { dueItems, followupText, stateOf } from "../track.ts";
import { FICTIONAL_LAWS, FICTIONAL_POLICY, FICTIONAL_TARGETS, fictionalRequest, row, TEST_SENDER } from "./fixtures.ts";

const laws = JSON.parse(readFileSync(join(GOV_DIR, "agent", "laws.json"), "utf8")) as LawFile;
const targets = JSON.parse(readFileSync(join(GOV_DIR, "agent", "targets.json"), "utf8")) as TargetFile;
const policy = JSON.parse(readFileSync(join(GOV_DIR, "agent", "policy.json"), "utf8")) as typeof FICTIONAL_POLICY;
const law = (id: string) => lawById(laws, id);

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`);
  }
}

// ---------- date arithmetic ----------

test("business days skip weekends", () => assert.equal(addBusinessDays("2026-03-06", 5), "2026-03-13")); // a Friday
test("day one is the day after receipt", () => assert.equal(addBusinessDays("2026-03-09", 1), "2026-03-10"));
test("business days skip a federal holiday (Thanksgiving 2026)", () => {
  assert.ok(federalHolidays(2026).has("2026-11-26"));
  assert.equal(addBusinessDays("2026-11-25", 1), "2026-11-27");
});
test("a holiday on Saturday is observed on Friday (July 4, 2026)", () => assert.ok(federalHolidays(2026).has("2026-07-03")));
test("a holiday on Sunday is observed on Monday (Nov 11, 2029)", () => assert.ok(federalHolidays(2029).has("2029-11-12")));
test("New Year's Day 2028, a Saturday, is observed on December 31, 2027", () => assert.ok(federalHolidays(2027).has("2027-12-31")));
test("Memorial Day 2026 and Labor Day 2026", () => {
  assert.ok(federalHolidays(2026).has("2026-05-25"));
  assert.ok(federalHolidays(2026).has("2026-09-07"));
});
test("a weekend isn't a business day", () => assert.equal(isBusinessDay(toDate("2026-10-31")), false));
test("calendar days count every day", () => assert.equal(addDays("2026-02-20", 10, "calendar"), "2026-03-02"));

// ---------- each state's clock, from the data ----------

test("Illinois commercial: 21 working days, no extension", () => {
  const d = deadlines(law("us-il"), "commercial", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-12-03"); // Nov 26 and Nov 11 are holidays
  assert.equal(d.extended_max, null);
});
test("Illinois non-commercial: 5 + 5 business days", () => {
  const d = deadlines(law("us-il"), "noncommercial", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-11-09");
  assert.equal(d.extended_max, "2026-11-17"); // Nov 11 is a holiday
});
test("Illinois: a commercial requester gets only limited Public Access Counselor review", () => {
  const appeal = ruleFor(law("us-il"), "commercial", "2026-11-02").appeals.find((a) => /Public Access/.test(a.forum))!;
  assert.equal(appeal.requires, "agency_classified_commercial");
  assert.equal(appeal.window_days, 60);
  const open = ruleFor(law("us-il"), "noncommercial", "2026-11-02").appeals.find((a) => /Public Access/.test(a.forum))!;
  assert.equal(open.requires, null);
});
test("Arizona has no fixed number of days, and gives a reminder that isn't a deadline", () => {
  const d = deadlines(law("us-az"), "commercial", "2026-11-02", 10);
  assert.equal(d.first_due, null);
  assert.equal(d.checkin, "2026-11-17");
});
test("Washington: 5 business days, and the agency sets the estimate", () => {
  const d = deadlines(law("us-wa"), "any", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-11-09");
  assert.ok(d.rule.agency_estimate);
});
test("Oregon: acknowledge in 5, complete by 10 business days after that deadline", () => {
  const d = deadlines(law("us-or"), "any", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-11-09");
  assert.equal(d.second_due, "2026-11-24");
});
test("Colorado: 3 working days, extendable by 7", () => {
  const d = deadlines(law("us-co"), "any", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-11-05");
  assert.equal(d.extended_max, "2026-11-17");
});
test("California in 2026: 10 calendar days, plus 14", () => {
  const d = deadlines(law("us-ca"), "any", "2026-11-02", 10);
  assert.equal(d.first_due, "2026-11-12");
  assert.equal(d.extended_max, "2026-11-26");
});
test("California from 2027: 10 business days, as read in AB 1821", () => {
  const d = deadlines(law("us-ca"), "any", "2027-01-04", 10);
  assert.equal(d.rule.id, "ca-after-ab1821");
  assert.equal(d.first_due, "2027-01-19"); // Jan 18 is a holiday
});
test("no rule for a date before the data starts is an error, not a guess", () => assert.throws(() => ruleFor(law("us-il"), "commercial", "2020-01-01")));

test("no state's rule is written in code", () => {
  for (const f of ["law.ts", "track.ts", "stats.ts", "draft.ts"]) {
    const code = readFileSync(join(GOV_DIR, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /us-(il|az|wa|or|co|ca)|ILCS|RCW|Illinois|Arizona|Oregon|Colorado/, `${f} names a state`);
  }
});

// ---------- real data is honest ----------

test("every law has sources, and every cited source exists", () => {
  for (const l of laws.laws) {
    assert.ok(l.sources.length, `${l.id} has no sources`);
    for (const s of [...l.sources, ...l.rules.flatMap((r) => r.sources)]) assert.ok(laws.sources[s], `${l.id} cites unknown source ${s}`);
  }
  for (const s of Object.values(laws.sources)) assert.equal(s.checked, "2026-10-31");
});
test("every target has a law, a source and a stated evidence level", () => {
  for (const t of targets.targets) {
    assert.ok(laws.laws.some((l) => l.id === t.law_id), t.id);
    assert.ok(t.contact.source_url, t.id);
    assert.ok(["read_directly", "search_excerpt", "unknown"].includes(t.contact.evidence), t.id);
    if (t.contact.evidence === "unknown") assert.equal(t.contact.value, null, `${t.id}: unknown contact must stay null`);
    assert.ok(t.asks.length, t.id);
    assert.ok(t.lawyer.length, t.id);
  }
});
test("the seeded targets are all present", () => {
  const places = new Set(targets.targets.map((t) => t.place));
  for (const p of ["chicago", "tucson", "santa-cruz-county", "seattle", "puyallup", "everett", "salem", "louisville-co"]) assert.ok(places.has(p), p);
  assert.equal(targets.targets.filter((t) => t.place === "seattle").length, 2);
});
test("no real target carries a contact we were told not to fetch as though we read it", () => {
  for (const id of ["salem-or", "everett-clerk", "puyallup-clerk"]) assert.notEqual(targets.targets.find((t) => t.id === id)!.contact.evidence, "read_directly", id);
});
test("blocked hosts are recorded as blocked", () => {
  const rules = targets.targets.flatMap((t) => t.access).filter((a) => a.rule === "do_not_fetch").map((a) => a.host);
  for (const h of ["egov.cityofsalem.net/PACPortal", "laserfiche.louisvilleco.gov", "permits.puyallupwa.gov", "web.seattle.gov/dpd/edms/", "lfportal.everettwa.gov"]) assert.ok(rules.includes(h), h);
  const noBulk = targets.targets.flatMap((t) => t.access).filter((a) => a.rule === "no_bulk_until_user_decides").map((a) => a.host);
  assert.ok(noBulk.includes("pro.tucsonaz.gov"));
});
test("every real ask passes the gate as drafted", () => {
  for (const t of targets.targets) {
    const l = law(t.law_id);
    for (const ask of t.asks) {
      const text = renderDraft({ subject: ask.subject, sections: { summary: ask.summary, records: ask.records ?? ask.questions ?? [] }, kind: ask.kind, dataset: "real" }, ask, t, l, targets.purpose, null);
      assert.deepEqual(gateIssues(ask, t, l, text, policy).map((i) => i.message), [], ask.key);
    }
  }
});
test("Illinois and Arizona drafts state the commercial purpose outright; every draft says who's asking", () => {
  for (const t of targets.targets) {
    const l = law(t.law_id);
    const ask = t.asks.find((a) => a.kind === "records_request");
    if (!ask) continue;
    const text = renderDraft({ subject: ask.subject, sections: { summary: ask.summary, records: ask.records! }, kind: ask.kind, dataset: "real" }, ask, t, l, targets.purpose, null);
    assert.match(text, /intends to charge for it/, t.id);
    if (l.commercial.disclosure !== "not_required") assert.match(text, /for a commercial purpose/, t.id);
  }
});
test("the Chicago draft starts small, and every permit is inline", () => {
  const ask = targets.targets.find((t) => t.id === "chicago-dob")!.asks[0];
  assert.equal(ask.sample_size, 5);
  assert.equal(ask.items!.length, 5);
  const doc = readFileSync(join(GOV_DIR, "..", "docs", "chicago-foia-request.md"), "utf8");
  for (const item of ask.items!) assert.ok(doc.includes(item), `${item} isn't in the docs' sample`);
});

// ---------- the gate ----------

const fxT = FICTIONAL_TARGETS[0];
const fxLaw = FICTIONAL_LAWS[0];
const fxAsk = fxT.asks[0];
const PURPOSE = "{{entity}} builds software that helps architects and permit expediters respond to plan review correction comments, and intends to charge for it. The records would be used to test and improve that software on real comments.";
const good = () => renderDraft({ subject: fxAsk.subject, sections: { summary: fxAsk.summary, records: fxAsk.records! }, kind: fxAsk.kind, dataset: "test" }, fxAsk, fxT, fxLaw, PURPOSE, TEST_SENDER);
const codes = (text: string) => gateIssues(fxAsk, fxT, fxLaw, text, FICTIONAL_POLICY).map((i) => i.code);

test("a good draft passes", () => assert.deepEqual(codes(good()), []));
for (const [name, add, code] of [
  ["press", "I am a reporter with a local paper.", "false_affiliation"],
  ["student", "As a student I am studying this.", "false_affiliation"],
  ["academic", "This is for an academic study.", "false_affiliation"],
  ["nonprofit", "We are a nonprofit.", "false_affiliation"],
  ["government", "I'm writing on behalf of the city.", "false_affiliation"],
  ["fee waiver", "Please grant a fee waiver.", "false_affiliation"],
  ["non-commercial claim", "This is not for a commercial purpose.", "hides_purpose"],
  ["personal use", "It is for personal use.", "hides_purpose"],
  ["research framing", "It's for research purposes.", "hides_purpose"],
  ["threat", "We will sue if denied.", "threat"],
  ["fake urgency", "This is urgent.", "false_urgency"],
  ["product claim", "Our software is proven and accurate.", "product_claim"],
  ["overbroad", "Please send any and all records.", "overbroad"],
] as [string, string, string][]) {
  test(`the gate blocks ${name}`, () => assert.ok(codes(`${good()}\n${add}`).includes(code), code));
}
test("the gate blocks a missing purpose", () => assert.ok(codes(good().replace("intends to charge for it", "does work")).includes("purpose_missing")));
test("the gate blocks a missing commercial statement where the law asks for it", () => assert.ok(codes(good().replace(/commercial purpose/gi, "x")).includes("commercial_missing")));
test("the gate blocks a dropped permit", () => assert.ok(codes(good().replace("FIC-0002", "")).includes("item_lost")));
test("the gate blocks a sample over the limit", () => {
  const big = { ...fxAsk, sample_size: 500 };
  assert.ok(gateIssues(big, fxT, fxLaw, good(), FICTIONAL_POLICY).some((i) => i.code === "sample_too_big"));
});
test("the model can't add a number", () => assert.ok(refinementIssues(fxAsk, "500 letters.", ["x"]).some((i) => i.code === "invented_number")));
test("the model can't add kinds of record", () => assert.ok(refinementIssues(fxAsk, "letters.", ["a", "b", "c", "d"]).some((i) => i.code === "scope_creep")));
test("the model can't double the opening", () => assert.ok(refinementIssues(fxAsk, "I request 5 letters.", ["x"]).some((i) => i.code === "doubled_opening")));
test("a real home refuses a fictional sender", () => assert.ok(validateSender(TEST_SENDER, "real").some((p) => /fictional/.test(p))));
test("a sender can't claim a press or academic entity", () => assert.ok(validateSender({ ...TEST_SENDER, entity: "Daily Press University" }, "test").some((p) => /affiliation/.test(p))));
test("a placeholder sender isn't complete", () => assert.ok(validateSender({ ...TEST_SENDER, full_name: "[Your full name]" }, "test").length));

// ---------- approval and limits ----------

const fxReq = fictionalRequest(fxT, 1);
test("approval refuses unfilled brackets", () => {
  const p = approvalProblems(fxReq, "[Your full name]", fxT, fxLaw, TEST_SENDER, "test", false, []);
  assert.ok(p.some((x) => /brackets/.test(x)));
});
test("approval refuses a contact seen only in a search excerpt until a person confirms it", () => {
  const t = { ...fxT, contact: { ...fxT.contact, evidence: "search_excerpt" as const } };
  assert.ok(approvalProblems(fxReq, good(), t, fxLaw, TEST_SENDER, "test", false, []).some((x) => /excerpt/.test(x)));
  assert.equal(approvalProblems(fxReq, good(), t, fxLaw, TEST_SENDER, "test", true, []).length, 0);
});
test("approval refuses a target on hold", () => assert.ok(approvalProblems(fxReq, good(), { ...fxT, status: "hold", hold_reason: "x" }, fxLaw, TEST_SENDER, "test", false, []).some((x) => /hold/.test(x))));
const ev = (type: RecordsEvent["type"], at: string, extra: Partial<RecordsEvent> = {}, id = fxReq.id): RecordsEvent => ({ type, dataset: "test", request_id: id, at: `${at}T12:00:00.000Z`, ...extra });
test("only one open request per agency", () => {
  assert.ok(limitProblems(fxT, fxT.asks[1], [fxReq], [ev("sent", "2026-10-01")], FICTIONAL_POLICY, new Date("2026-10-05")).some((p) => /open/.test(p)));
});
test("the same ask is never drafted twice", () => {
  const same = { ...fxReq, ask_key: fxAsk.key };
  assert.ok(limitProblems(fxT, fxAsk, [same], [], FICTIONAL_POLICY, new Date("2026-10-05")).some((p) => /won't be drafted twice/.test(p)));
});
test("a ceiling applies over 180 days even after requests close", () => {
  const a = fictionalRequest(fxT, 2);
  const b = fictionalRequest(fxT, 3);
  const events = [ev("sent", "2026-08-01", {}, a.id), ev("closed", "2026-08-10", {}, a.id), ev("sent", "2026-09-01", {}, b.id), ev("closed", "2026-09-10", {}, b.id)];
  assert.ok(limitProblems(fxT, fxAsk, [a, b], events, FICTIONAL_POLICY, new Date("2026-10-05")).some((p) => /180 days/.test(p)));
});
test("features come from the ask", () => {
  const f = featuresOf(fxAsk, fxT);
  assert.equal(f.small_sample, true);
  assert.equal(f.named_items, true);
  assert.equal(f.formal_route, true);
});

// ---------- tracking ----------

const fxDue = (events: RecordsEvent[], today: string, l: Law = fxLaw) => dueItems(fxReq, events, l, FICTIONAL_POLICY, today);
test("nothing is due until a person logs it as sent", () => assert.deepEqual(fxDue([], "2026-11-01"), []));
test("a statutory deadline shows up after sending", () => {
  const [i] = fxDue([ev("sent", "2026-11-02")], "2026-11-03");
  assert.equal(i.kind, "first_response");
  assert.equal(i.due, "2026-11-09");
  assert.equal(i.status, "upcoming");
  assert.equal(i.statutory, true);
});
test("due soon, then a grace day, then overdue", () => {
  const sent = [ev("sent", "2026-11-02")];
  assert.equal(fxDue(sent, "2026-11-08")[0].status, "due_soon");
  assert.equal(fxDue(sent, "2026-11-10")[0].status, "due_soon");
  assert.equal(fxDue(sent, "2026-11-11")[0].status, "overdue");
  assert.match(fxDue(sent, "2026-11-11")[0].next!, /overdue/);
});
test("an extension moves the date", () => {
  const [i] = fxDue([ev("sent", "2026-11-02"), ev("extension", "2026-11-05", { date: "2026-11-18", note: "storage" })], "2026-11-06");
  assert.equal(i.kind, "extended_response");
  assert.equal(i.due, "2026-11-18");
});
test("an extension past the legal maximum is pointed out", () => {
  const [i] = fxDue([ev("sent", "2026-11-02"), ev("extension", "2026-11-05", { date: "2027-02-01" })], "2026-11-06");
  assert.match(i.note, /later than the most the law allows/);
});
test("an estimate from the agency is tracked, and marked not statutory", () => {
  const [i] = fxDue([ev("sent", "2026-11-02"), ev("acknowledged", "2026-11-03", { date: "2026-12-15" })], "2026-11-04");
  assert.equal(i.kind, "estimate");
  assert.equal(i.statutory, false);
});
test("a law with no fixed days gets a reminder marked not statutory", () => {
  const [i] = fxDue([ev("sent", "2026-11-02")], "2026-11-03", FICTIONAL_LAWS[2]);
  assert.equal(i.kind, "checkin");
  assert.equal(i.statutory, false);
  assert.match(i.note, /not a legal deadline/);
});
test("a fee quote waits on you", () => {
  const items = fxDue([ev("sent", "2026-11-02"), ev("fee_quote", "2026-11-04", { amount_usd: 120 })], "2026-11-05");
  assert.ok(items.some((i) => i.kind === "fee_waiting_on_you" && i.status === "waiting_on_you" && /\$120/.test(i.note)));
});
test("a clarification request waits on you", () => assert.ok(fxDue([ev("sent", "2026-11-02"), ev("clarification_requested", "2026-11-03")], "2026-11-04").some((i) => i.kind === "clarification_waiting_on_you")));
test("a denial starts the appeal window", () => {
  const items = fxDue([ev("sent", "2026-11-02"), ev("denial", "2026-11-05", { exemption: "fictional 7(k)" })], "2026-11-06");
  const w = items.find((i) => i.kind === "appeal_window")!;
  assert.equal(w.due, "2026-12-05");
  assert.ok(items.some((i) => i.kind === "appeal_available"));
  assert.ok(!items.some((i) => i.kind === "first_response"));
});
test("a closed appeal window disappears", () => assert.ok(!fxDue([ev("sent", "2026-11-02"), ev("denial", "2026-11-05")], "2027-02-01").some((i) => i.kind === "appeal_window")));
test("a partial grant also starts the appeal window, and counts documents", () => {
  const events = [ev("sent", "2026-11-02"), ev("partial_grant", "2026-11-05", { count: 3, exemption: "fictional 7(k)" })];
  assert.ok(fxDue(events, "2026-11-06").some((i) => i.kind === "appeal_window"));
  assert.equal(stateOf(fxReq, events, fxLaw).records_received, 3);
});
test("Illinois: a self-declared commercial request isn't offered Public Access Counselor review", () => {
  const req = { ...fxReq, law_id: "us-il" };
  const items = dueItems(req, [ev("sent", "2026-11-02"), ev("denial", "2026-12-05")], law("us-il"), FICTIONAL_POLICY, "2026-12-06");
  assert.ok(!items.some((i) => /Public Access/.test(i.note)));
  assert.ok(items.some((i) => /Circuit court/.test(i.note)));
  const classified = dueItems(req, [ev("sent", "2026-11-02"), ev("classified", "2026-11-03", { as: "commercial" }), ev("denial", "2026-12-05")], law("us-il"), FICTIONAL_POLICY, "2026-12-06");
  assert.ok(classified.some((i) => /Public Access/.test(i.note) && i.due === "2027-02-03"));
});
test("reclassifying to non-commercial changes the Illinois clock", () => {
  const req = { ...fxReq, law_id: "us-il" };
  const [i] = dueItems(req, [ev("sent", "2026-11-02"), ev("classified", "2026-11-03", { as: "noncommercial" })], law("us-il"), FICTIONAL_POLICY, "2026-11-04");
  assert.equal(i.due, "2026-11-09");
});
test("follow-ups don't accuse anyone", () => {
  const s = stateOf(fxReq, [ev("sent", "2026-11-02")], fxLaw);
  for (const kind of ["status", "overdue", "narrowing"] as const) {
    const text = followupText(fxReq, s, fxLaw, kind, fxT.agency, "2026-12-01", "1 letter first.");
    assert.doesNotMatch(text, /\b(violat|sue|lawsuit|illegal|must respond|required by law)/i, kind);
    assert.match(text, /\[Your full name\]/);
  }
});
test("an overdue follow-up hedges on the date, and cites data", () => assert.match(followupText(fxReq, stateOf(fxReq, [ev("sent", "2026-11-02")], fxLaw), fxLaw, "overdue", fxT.agency, "2026-12-01", null), /By my count.*Fictional sec\. 1.*I may have that date wrong/s));
test("appeal options are labeled as not advice, and mark what's closed", () => {
  const events = [ev("sent", "2026-11-02"), ev("denial", "2026-12-05", { exemption: "x" })];
  const req = { ...fxReq, law_id: "us-il" };
  const text = followupText(req, stateOf(req, events, law("us-il")), law("us-il"), "appeal", "Agency", "2026-12-06", null);
  assert.match(text, /isn't legal advice/);
  assert.match(text, /NOT OPEN to this request/);
  assert.match(text, /Window: none found/);
});

// ---------- the scope checks ----------

const rulesFx: Rule[] = [
  { id: "G-001", scope: "general", kind: "principle", status: "active", locked: true, text: "Say truthfully who is asking.", based_on: [], source: "seed", added: "2026-10-31" },
  { id: "G-006", scope: "general", kind: "principle", status: "active", text: "Ask for a small sample.", based_on: [], source: "seed", added: "2026-10-31" },
  { id: "G-050", scope: "general", kind: "hypothesis", status: "active", text: "Try naming the record type.", based_on: [], source: "learn-01", added: "2026-10-31" },
  { id: "TESTVILLE-001", scope: "testville", kind: "observation", status: "active", text: "Use the desk.", based_on: [], source: "seed", added: "2026-10-31" },
  { id: "SAMPLETON-001", scope: "sampleton", kind: "observation", status: "active", text: "Use the portal.", based_on: [], source: "seed", added: "2026-10-31" },
];
const rowsFx = [
  row("R-t1", "testville-bldg", "testville", "ZA", true, 3, { denied: false }),
  row("R-t2", "testville-bldg", "testville", "ZA", true, 0, { denied: true, exemptions: ["fictional 7(k)"] }),
  row("R-s1", "sampleton-bldg", "sampleton", "ZB", true, 2),
  row("R-d1", "demoport-bldg", "demoport", "ZB", true, 1),
  row("R-m1", "mockburg-bldg", "mockburg", "ZC", false, 0, { responded: false }),
];
const ctx: ScopeContext = { rules: rulesFx, places: ["testville", "sampleton", "demoport", "mockburg"], rows: rowsFx, targets: FICTIONAL_TARGETS, laws: FICTIONAL_LAWS, privateStrings: ["Test Requester", "secret-name"], recordTexts: ["the door schedule on sheet A101 does not match the door hardware table shown elsewhere"], minPlaces: 2, minStates: 2 };
const opOk = (o: Partial<ProposedOp>) => assert.deepEqual(opProblems({ op: "add", scope: "testville", kind: "observation", text: "Staff asked for a clearer date range.", based_on: ["R-t1"], claim: "usable", ...o }, ctx), []);
const opBad = (o: Partial<ProposedOp>, re: RegExp) => assert.ok(opProblems({ op: "add", scope: "testville", kind: "observation", text: "Staff asked for a clearer date range.", based_on: ["R-t1"], claim: "usable", ...o }, ctx).some((p) => re.test(p)), `expected ${re}, got ${JSON.stringify(opProblems({ op: "add", scope: "testville", kind: "observation", text: "Staff asked for a clearer date range.", based_on: ["R-t1"], claim: "usable", ...o }, ctx))}`);

test("a good place rule is allowed", () => opOk({}));
test("a general rule can't name a place", () => opBad({ scope: "general", kind: "hypothesis", text: "In Testville, ask for fewer letters.", based_on: ["R-t1", "R-s1"] }, /can't name/));
test("a general rule can't name a state", () => opBad({ scope: "general", kind: "hypothesis", text: "In Illinois, ask for fewer letters.", based_on: ["R-t1", "R-s1"] }, /can't name/));
test("a general rule can't name a law or system", () => {
  for (const t of ["Cite FOIA in the opening.", "Ask for a ProjectDox export.", "Mention section 7(1)(k) up front."]) opBad({ scope: "general", kind: "hypothesis", text: t, based_on: ["R-t1", "R-s1"] }, /can't name/);
});
test("a general rule resting on one place goes to that place's file", () => opBad({ scope: "general", kind: "hypothesis", text: "Try a clearer date range.", based_on: ["R-t1"] }, /needs evidence from 2 places/));
test("a general rule resting on two places in one state is refused", () => opBad({ scope: "general", kind: "hypothesis", text: "Try a clearer date range.", based_on: ["R-s1", "R-d1"] }, /in 2 states/));
test("a general hypothesis across two states is allowed", () => opOk({ scope: "general", kind: "hypothesis", text: "Try a clearer date range.", based_on: ["R-t1", "R-s1"] }));
test("a rule for one place can't rest on another place's request", () => opBad({ scope: "testville", based_on: ["R-s1"] }, /Evidence from one place/));
test("an observation can't be general", () => opBad({ scope: "general", kind: "observation", based_on: ["R-t1", "R-s1"] }, /observation records what one place/));
test("the model can't declare anything learned", () => opBad({ kind: "learned" }, /Only code declares/));
test("evidence must exist", () => opBad({ based_on: ["R-nope"] }, /isn't a sent request/));
test("evidence is required", () => opBad({ based_on: [] }, /cites no requests/));
test("a claim is required", () => opBad({ claim: null }, /needs a claim/));
test("a false claim is caught by code", () => opBad({ based_on: ["R-t2"], claim: "usable" }, /False evidence/));
test("an unknown place is refused", () => opBad({ scope: "nowhere" }, /isn't a known place/));
for (const [name, text] of [
  ["hiding the purpose", "Omit the commercial purpose paragraph to speed up replies."],
  ["softening the purpose", "The commercial statement delays answers, so soften it."],
  ["an affiliation", "Describe yourself as a researcher."],
  ["a non-commercial framing", "Frame requests as non-commercial."],
  ["passing along a preference against stating the purpose", "The office said staff prefer requests that do not mention commercial use."],
  ["leaving out the purpose", "Requests without mentioning the commercial purpose got further."],
  ["automation", "Automate retrieval from the portal."],
  ["scraping", "Scrape the permit site at night."],
  ["a workaround", "Work around the bot check."],
  ["unattended sending", "Send follow-ups automatically."],
  ["repeat requests", "Send multiple requests to raise the odds."],
] as [string, string][]) {
  test(`no result can justify ${name}`, () => opBad({ text }, /which no result can change/));
}
test("a rule can't state a conclusion", () => opBad({ text: "Smaller samples always work best here." }, /conclusion/));
test("a rule can't quote rates", () => opBad({ text: "Got replies on 3 of 4 tries." }, /rate or a count/));
test("a rule can't state law", () => opBad({ text: "Comments here are exempt by law." }, /states law/));
test("a rule can't hold contact details", () => opBad({ text: "Ask clerk@somewhere.example for help." }, /contact details/));
test("a rule can't hold private text", () => opBad({ text: "Tell them secret-name asked." }, /private text/));
test("a rule can't quote a record", () => opBad({ text: "the door schedule on sheet A101 does not match the door hardware table" }, /quotes a received record/));
test("evidence from one place can't retire another place's rule", () => {
  const p = opProblems({ op: "retire", scope: "sampleton", rule_id: "SAMPLETON-001", based_on: ["R-t1"], why: "x" }, ctx);
  assert.ok(p.some((x) => /Evidence from one place/.test(x)), JSON.stringify(p));
});
test("a rule can't be retired from the wrong scope", () => {
  const p = opProblems({ op: "retire", scope: "testville", rule_id: "SAMPLETON-001", based_on: ["R-t1"], why: "x" }, ctx);
  assert.ok(p.some((x) => /belongs to sampleton/.test(x)), JSON.stringify(p));
});
test("a place can retire its own rule with its own evidence", () => assert.deepEqual(opProblems({ op: "retire", scope: "testville", rule_id: "TESTVILLE-001", based_on: ["R-t2"], why: "x" }, ctx), []));
test("one place's failure can't retire a general rule", () => {
  const p = opProblems({ op: "retire", scope: "general", rule_id: "G-050", based_on: ["R-t2"], why: "x" }, ctx);
  assert.ok(p.some((x) => /needs evidence from 2 places/.test(x)), JSON.stringify(p));
});
test("a general hypothesis can be retired with evidence from two places", () => assert.deepEqual(opProblems({ op: "retire", scope: "general", rule_id: "G-050", based_on: ["R-t2", "R-m1"], why: "x" }, ctx), []));
test("a locked rule can't be retired", () => assert.ok(opProblems({ op: "retire", scope: "general", rule_id: "G-001", based_on: ["R-t2", "R-m1"], why: "x" }, ctx).some((x) => /locked/.test(x))));
test("a starting principle can't be retired on a few outcomes", () => assert.ok(opProblems({ op: "retire", scope: "general", rule_id: "G-006", based_on: ["R-t2", "R-m1"], why: "x" }, ctx).some((x) => /starting principle/.test(x))));
test("localTerms reads the data, so new targets extend the check", () => {
  assert.ok(localTerms("Ask Mockburg first", FICTIONAL_TARGETS, FICTIONAL_LAWS).length);
  assert.equal(localTerms("Ask for a smaller sample first.", FICTIONAL_TARGETS, FICTIONAL_LAWS).length, 0);
});
test("the claim check reads the row", () => {
  assert.ok(claimHolds("exemption:7(k)", rowsFx[1]));
  assert.ok(!claimHolds("exemption:other", rowsFx[1]));
  assert.ok(claimHolds("no_response", rowsFx[4]));
});
test("a model's summary can't carry a number or a result", () => {
  assert.ok(summaryProblem("With only 12 requests, nothing was warranted."));
  assert.ok(summaryProblem("Small samples always work best."));
  assert.equal(summaryProblem("Nothing was warranted, because too few requests have closed."), null);
});
test("tallies count counterexamples", () => assert.match(tallyFor("usable", "testville", rowsFx), /held on 1 of 2/));

// ---------- the learning verdict ----------

const armRows = (prefix: string, small: boolean, spec: [string, string, string, number][]) => spec.flatMap(([t, p, s, usable], i) => [row(`${prefix}-${i}`, t, p, s, small, usable)]);
function balanced(aUsable: number, bUsable: number, n = 12, places: [string, string][] = [["a1", "ZA"], ["a2", "ZB"], ["a3", "ZC"], ["a4", "ZA"]]) {
  const rows: ReturnType<typeof row>[] = [];
  for (let i = 0; i < n; i++) {
    const [p, s] = places[i % places.length];
    rows.push(row(`Y${i}`, `${p}-t`, p, s, true, i < aUsable ? 3 : 0));
    rows.push(row(`N${i}`, `${p}-t`, p, s, false, i < bUsable ? 3 : 0));
  }
  return rows;
}
test("too few requests: refused, however big the gap", () => {
  const rows = [...armRows("Y", true, [["a-t", "a", "ZA", 3], ["b-t", "b", "ZB", 4], ["c-t", "c", "ZC", 5]]), ...armRows("N", false, [["a-t", "a", "ZA", 0], ["b-t", "b", "ZB", 0], ["c-t", "c", "ZC", 0]])];
  const v = featureVerdict("small_sample", rows, FICTIONAL_POLICY);
  assert.equal(v.status, "insufficient_data");
  assert.match(v.reason, /each side needs 12/);
});
test("one agency can't supply the whole arm", () => {
  const rows: ReturnType<typeof row>[] = [];
  for (let i = 0; i < 20; i++) rows.push(row(`Y${i}`, "only-t", "only", "ZA", true, 3));
  for (let i = 0; i < 20; i++) rows.push(row(`N${i}`, "only-t", "only", "ZA", false, 0));
  const v = featureVerdict("small_sample", rows, FICTIONAL_POLICY);
  assert.equal(v.status, "insufficient_data");
  assert.equal(v.counts.true_arm.n, 3);
});
test("enough data and a clear gap across states: supported", () => {
  const v = featureVerdict("small_sample", balanced(11, 2), FICTIONAL_POLICY);
  assert.equal(v.status, "supported", v.reason);
  assert.equal(v.leader, true);
});
test("enough data, small gap: no clear difference, and it says so", () => {
  const v = featureVerdict("small_sample", balanced(7, 5), FICTIONAL_POLICY);
  assert.equal(v.status, "no_clear_difference");
  assert.match(v.reason, /can't separate/);
});
test("a one-city result is refused as general: this is the regression this repo actually hit", () => {
  // All the gap comes from state ZA. Elsewhere the two arms are the same.
  const rows: ReturnType<typeof row>[] = [];
  let n = 0;
  const add = (t: string, p: string, s: string, small: boolean, usable: number) => rows.push(row(`R${n++}`, t, p, s, small, usable));
  for (const [t, p] of [["z1-t", "z1"], ["z2-t", "z2"], ["z3-t", "z3"]]) for (let i = 0; i < 3; i++) {
    add(t, p, "ZA", true, 3);
    add(t, p, "ZA", false, 0);
  }
  for (const [t, p] of [["b-t", "b"]]) for (let i = 0; i < 3; i++) {
    add(t, p, "ZB", true, i === 0 ? 3 : 0);
    add(t, p, "ZB", false, i === 0 ? 3 : 0);
  }
  for (const [t, p] of [["c-t", "c"]]) for (let i = 0; i < 3; i++) {
    add(t, p, "ZC", true, i === 0 ? 3 : 0);
    add(t, p, "ZC", false, i === 0 ? 3 : 0);
  }
  const v = featureVerdict("small_sample", rows, FICTIONAL_POLICY);
  assert.equal(v.status, "one_place_only", `${v.status}: ${v.reason}`);
});
test("response rate doesn't count as success", () => {
  const rows = [row("A", "a-t", "a", "ZA", true, 0, { responded: true }), row("B", "b-t", "b", "ZB", true, 0, { responded: true })];
  const s = summarize(rows);
  assert.equal(s.response_rate, 1);
  assert.equal(s.usable_per_closed, 0);
});
test("silence after the maturity window counts as closed with nothing", () => {
  const rows = [row("A", "a-t", "a", "ZA", true, 0, { responded: false, closed: true, closed_how: "matured" })];
  assert.equal(summarize(rows).closed, 1);
  assert.equal(summarize(rows).with_usable, 0);
});

// ---------- scrubbing ----------

const LETTER = `Fictional Building Office
Plan Review Correction Letter
Date: March 3, 2026
Applicant: Jane Q. Doe
Applicant email: jane.doe@fictional-firm.example, phone (555) 010-0199
Project address: 1234 N Fictional Ave, Suite 200, Testville, ZZ 00000
Reviewer: Robert Smith, P.E.

1. Provide door hardware schedule on sheet A101 per IBC Section 1010.1.9. Contact Mr. Johnson with questions.
2. Show the accessible route from the parking stall to the main entry; see ADA 206.2.1.
3. Revise the structural calculations to include snow drift at the parapet. Please call 555-010-0123.
4. Too short.

Sincerely,
Robert Smith, Plans Examiner
License No. PE-12345
robert.smith@fictional-city.example
`;
const { text: scrubbed, removed } = scrub(LETTER);
for (const [what, s] of [["applicant name", "Jane"], ["applicant surname", "Doe"], ["reviewer", "Robert"], ["surname", "Smith"], ["email", "@"], ["phone", "555-010"], ["phone", "(555)"], ["street address", "1234 N Fictional"], ["license", "12345"], ["titled name", "Johnson"]] as [string, string][]) {
  test(`scrub removes the ${what}`, () => assert.ok(!scrubbed.includes(s), `"${s}" remains in:\n${scrubbed}`));
}
test("scrub keeps the comments", () => assert.match(scrubbed, /door hardware schedule on sheet A101/));
test("scrub keeps the date", () => assert.match(scrubbed, /March 3, 2026/));
test("scrub drops the signature block", () => assert.ok(removed.signature_block === 1));
test("a clean result has no hits", () => assert.deepEqual(checkScrubbed(scrubbed).map((h) => h.text), []));
test("the check catches a lone name in context", () => assert.ok(checkScrubbed("Please see Alice about the stair detail.").some((h) => h.kind === "name_context")));
test("the check catches an unknown capitalized pair", () => assert.ok(checkScrubbed("The fix was noted by Marisol Vega at intake.").some((h) => h.kind === "possible_name")));
test("the check catches a signature line", () => assert.ok(checkScrubbed("Fine.\nJ. Hernandez\n").length));
test("the check ignores review vocabulary", () => assert.deepEqual(checkScrubbed("Provide Fire Sprinkler details on the Floor Plan per Building Code."), []));
test("comments split on numbers, and short fragments are dropped", () => assert.equal(splitComments(scrubbed).length, 3));

test("a labeled comment isn't mistaken for a name", () => assert.match(scrub("Applicant: please revise the stair detail on sheet A3.").text, /please revise the stair detail/));
test("a short labeled line is removed whole, including a company", () => assert.ok(!scrub("Owner: ACME Holdings LLC").text.includes("ACME")));
// Sets of fictional names. The first was used to tune the patterns and the second was written afterward, so neither is an independent measure. See README.md.
const removedOrFlagged = ([t, n]: [string, string]) => !scrub(t).text.includes(n) || checkScrubbed(scrub(t).text).some((h) => h.text.includes(n));
const TUNED: [string, string][] = [["Applicant: María José García-López", "García"], ["Reviewed by J. Smith", "Smith"], ["Thanks, Bob", "Bob"], ["bob emailed the revised sheet", "bob"], ["Sent to smith at the firm", "smith"], ["JS reviewed this on 3/3.", "JS"], ["The Hernandez residence needs a new sheet.", "Hernandez"], ["Owner: ACME Holdings LLC", "ACME"], ["Plan examiner: S. Okafor", "Okafor"], ["Revise per discussion with Dana.", "Dana"]];
const AFTER: [string, string][] = [["Applicant: Lakshmi Venkataraman", "Venkataraman"], ["Reviewed by T. Abernathy", "Abernathy"], ["Call Mrs. Yamamoto for access.", "Yamamoto"], ["Thanks, Oksana", "Oksana"], ["Spoke with Ngozi about the corridor width.", "Ngozi"], ["Please see Tamika regarding fire separation.", "Tamika"], ["The Kaminski addition needs a soils report.", "Kaminski"], ["RK reviewed sheet A2.", "RK"], ["Plans Examiner - Wen Zhao", "Zhao"], ["Mark Young signed the form.", "Young"]];
for (const c of [...TUNED, ...AFTER]) test(`a name is removed or flagged: ${c[0]}`, () => assert.ok(removedOrFlagged(c), scrub(c[0]).text));
test("known gap: a lowercase name in passing is missed, so a person must still read every copy", () => assert.equal(removedOrFlagged(["the applicant (dmitri) confirmed the sheet.", "dmitri"]), false));

const rec: IntakeRecord = { id: "L-abc", dataset: "test", request_id: "R-1", target_id: "testville-bldg", place: "testville", state: "ZA", status: "passed", usable: false, comments: 0, raw_file: "data/received/L-abc.txt", raw_sha: "abc", received_date: "2026-04-01", document_date: "2026-03-03", source_note: "From the fictional office.", review_type: "Fictional", conditions: { text: "none stated", may_test: "unknown", may_send_to_model: "unknown", may_publish: "unknown" }, publish_decision: "undecided", hits: [], out_file: null, permit: "FIC-1", updated_at: "" };
const letter = toLetter(rec, scrubbed, "Fictional project");
test("the letter has the shape the scorer reads", () => {
  for (const k of ["id", "holdout", "review_type", "source", "project", "outcome", "comments"]) assert.ok(k in letter, k);
  assert.equal(letter.comments[0].id, "C01");
  assert.ok("citations" in letter.comments[0].labels);
});
test("citations are hidden from the text and kept as labels", () => {
  assert.ok(!letter.comments[0].text.includes("1010.1.9"));
  assert.ok(letter.comments[0].labels.citations.some((c) => c.includes("1010.1.9")));
});
test("the letter keeps source, date and conditions, and marks publishing undecided", () => {
  assert.equal(letter.provenance.received_date, "2026-04-01");
  assert.equal(letter.source.document_date, "2026-03-03");
  assert.equal(letter.provenance.conditions.text, "none stated");
  assert.equal(letter.provenance.publish_decision, "undecided");
  assert.equal(letter.project.address, "[address removed]");
});

// ---------- the hard limit in code ----------

test("nothing in this folder can send: no network, no mail, no browser", () => {
  const files = readdirSync(GOV_DIR).filter((f) => f.endsWith(".ts")).map((f) => join(GOV_DIR, f));
  for (const f of files) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /\bfetch\(|nodemailer|smtp|sendmail|sendgrid|playwright|puppeteer|node:https?|node:net\b|\baxios\b|XMLHttpRequest/i, f);
  }
});
test("the agent spec has no tools", () => {
  const code = readFileSync(join(GOV_DIR, "lib.ts"), "utf8");
  for (const s of ["mcpServers: []", "webSearch: { enabled: false }", "sandbox: { enabled: false }", "dynamicSubAgents: { enabled: false }"]) assert.ok(code.includes(s), s);
});
test("there is no send or submit command", () => assert.doesNotMatch(readFileSync(join(GOV_DIR, "cli.ts"), "utf8"), /case "(send|submit|file|post)"/));

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.log(`\nFAIL ${f}`);
  process.exit(1);
}
