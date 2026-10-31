// npm run test:guard
// Each rule has cases it must catch and cases it must leave alone. Run offline, with the real jurisdiction packs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Item } from "../evals/score.ts";
import { citationInIndex, classifyCompliance, guardItems, inventedNumbers, judgmentSignals, type GuardedItem, type GuardFlag, type GuardPack, type GuardRule } from "./guard.ts";
import { exportDoc, publicView, type Report } from "./reports.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = (id: string): GuardPack => ({ profile: JSON.parse(readFileSync(join(root, "jurisdictions", id, "profile.json"), "utf8")), code: JSON.parse(readFileSync(join(root, "jurisdictions", id, "code.json"), "utf8")).sections });
const packs = [pack("chicago"), pack("seattle")];
const seattle = packs[1];

const letterFor = (jurisdiction: string, text: string, description = "New house.") => ({ project: { jurisdiction, address: "100 Main St", description }, comments: [{ id: "C1", text }] });
const item = (over: Partial<Item> = {}): Item => ({ comment: "C1", discipline: "zoning", citation: null, route: "licensed_review", sheets: [], draft: "", ...over });
const run = (over: Partial<Item>, text = "Revise the plans.", jurisdiction = "seattle", description?: string) => guardItems([item(over)], letterFor(jurisdiction, text, description), packs)[0];
const rules = (r: { flags: { rule: GuardRule }[] }) => r.flags.map((f) => f.rule);

describe("compliance claims", () => {
  it("flags a direct claim and leaves the words alone, because no rewrite is known to be true", () => {
    const draft = "The revised plans comply with SMC 23.44.014.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].rule, "compliance_claim");
    assert.equal(r.flags[0].action, "flagged");
    assert.match(r.flags[0].message, /^States/);
  });

  for (const draft of [
    "The design now complies with the code.",
    "The wall is fully compliant with SBC 705.",
    "The stairs meet code.",
    "The stairs meet the code.",
    "The opening meets the requirements of SRC R310.",
    "The plan has been revised to comply with SMC 23.44.014.",
    "The drawings conform to SRC R311.",
    "The garage is now in full compliance with SBC 406.",
    "The rear yard satisfies SMC 23.44.014.",
    "The rail is code-conforming.",
    "Floor type F6 meets the required 1-hour fire rating.",
  ]) {
    it(`flags: ${draft}`, () => assert.ok(rules(run({ draft })).includes("compliance_claim")));
  }

  it("rewrites a promise only into a sentence that is still true and whole, and keeps the original", () => {
    const r = run({ draft: "The DADU will be revised to comply with the 18' height limit in SMC 23.44.041. Sheet A1 will be updated." });
    assert.equal(r.draft, "The DADU will be revised to address the 18' height limit in SMC 23.44.041. Sheet A1 will be updated.");
    assert.equal(r.flags[0].action, "rewritten");
    assert.equal(r.flags[0].level, "review");
    assert.match(r.flags[0].before ?? "", /to comply with/);
  });

  it("rewrites a promise of supporting documents", () => {
    assert.equal(run({ draft: "Calculations will be provided demonstrating compliance with SMC 23.44.014." }).draft, "Calculations will be provided to address SMC 23.44.014.");
  });

  it("flags instead of rewriting when another claim would survive in the sentence", () => {
    const draft = "Calculations will be provided demonstrating compliance with SMC 23.44.018, each showing compliance with the maximum.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].action, "flagged");
  });

  it("flags instead of rewriting when the sentence also promises an outcome", () => {
    const draft = "The roof will be revised to comply with SMC 23.44.012, ensuring no portion exceeds the limit.";
    assert.equal(run({ draft }).draft, draft);
  });

  it("flags a promise it has no rewrite for", () => {
    const draft = "If the bedrooms are new, the plans will show egress windows compliant with SRC R310.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].action, "flagged");
  });

  for (const draft of [
    "A blank Compliance Certificate form will be added to the drawings.",
    "The energy compliance calculation will be corrected to 0.5 credits.",
    "The note will say which of the compliance options is selected.",
    "The stair does not comply with SRC R311, so it will be redrawn.",
    "The current layout is not in compliance, so it will be revised.",
    "The design professional will verify compliance with SRC R311.",
    "The architect will confirm compliance with SRC R311.",
    "The tree must comply with SMC 25.11.090.",
    "The plan set will state that this project has been reviewed for conformance with the 2021 Seattle Residential Code.",
    "The fixture is non-compliant and will be replaced.",
    "The revised sheets will be uploaded.",
  ]) {
    it(`leaves alone: ${draft}`, () => {
      const r = run({ draft });
      assert.equal(r.draft, draft);
      assert.ok(!rules(r).includes("compliance_claim"), JSON.stringify(r.flags));
    });
  }

  it("leaves alone a claim that is only the letter's own quoted wording", () => {
    const text = 'Add this note: "All work shall comply with the approved plans and meets the requirements of the permit."';
    const r = run({ draft: 'A note will be added: "All work shall comply with the approved plans and meets the requirements of the permit."' }, text);
    assert.ok(!rules(r).includes("compliance_claim"), JSON.stringify(r.flags));
  });

  it("tells a statement from a promise", () => {
    assert.equal(classifyCompliance("The depth complies with SMC 23.44.014."), "assertion");
    assert.equal(classifyCompliance("A zone in compliance with SEC C411 will be shown."), "promise");
    assert.equal(classifyCompliance("The note will be added."), null);
  });
});

describe("another city's process wording", () => {
  const whole = ["This revision will be bubbled, dated and initialed.", "All revisions will be bubbled, dated, and initialed per Certified Plan Corrections protocol.", "The plans will be bubbled, dated and initialed to indicate these revisions."];
  for (const sentence of whole) {
    it(`removes a sentence that says nothing else: ${sentence}`, () => {
      const r = run({ draft: `Sheet A1.0 will be revised to show the setback. ${sentence}` }, "Show the setback on A1.0.");
      assert.equal(r.draft, "Sheet A1.0 will be revised to show the setback.");
      assert.equal(r.flags[0].action, "removed");
      assert.equal(r.flags[0].level, "info");
    });
  }

  it("keeps the rest of a sentence when only its last clause is the wording", () => {
    assert.equal(run({ draft: "The diagram on sheet A-1.0 will be updated and will be bubbled, dated and initialed per Certified Plan Corrections protocol." }, "Update the diagram on A-1.0.").draft, "The diagram on sheet A-1.0 will be updated.");
    assert.equal(run({ draft: "An exemption will be shown, and the revision will be bubbled, dated and initialed." }).draft, "An exemption will be shown.");
    assert.equal(run({ draft: "The set will be included in the resubmission, all marked per Certified Plan Corrections protocol." }).draft, "The set will be included in the resubmission.");
  });

  it("leaves no stray comma inside a closing quote", () => {
    assert.equal(run({ draft: "A note will state 'No work is approved,' and will be bubbled, dated and initialed." }).draft, "A note will state 'No work is approved'.");
  });

  it("flags rather than break a list that needs its 'and'", () => {
    const draft = "The form will be uploaded to the portal, embedded within the plan set, and will be bubbled, dated and initialed.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].action, "flagged");
    assert.equal(r.flags[0].level, "review");
  });

  it("flags wording in a sentence with no known shape", () => {
    const draft = "We will follow the Certified Plan Corrections rules for this sheet.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].rule, "foreign_process");
    assert.equal(r.flags[0].action, "flagged");
  });

  it("says a draft came up empty instead of hiding it", () => {
    const r = run({ draft: "This revision will be bubbled, dated and initialed.", route: "agent_draft" });
    assert.equal(r.draft, "");
    assert.ok(rules(r).includes("empty_draft"));
  });

  it("leaves a city's own wording alone", () => {
    const draft = "This revision will be bubbled, dated and initialed per Certified Plan Corrections protocol.";
    const r = run({ draft }, "Revise the plans.", "chicago");
    assert.equal(r.draft, draft);
    assert.ok(!rules(r).includes("foreign_process"));
  });

  it("works the other way round, from the data alone", () => {
    const r = run({ draft: "We will send it to SDCI for review." }, "Revise the plans.", "chicago");
    assert.ok(rules(r).includes("foreign_process"));
  });

  it("leaves wording the city used in this letter", () => {
    const draft = "The revision will be bubbled and dated.";
    const r = run({ draft }, "Bubble all changes on the revised sheets.");
    assert.equal(r.draft, draft);
    assert.ok(!rules(r).includes("foreign_process"));
  });

  it("isn't fooled by ordinary words nearby", () => {
    for (const draft of ["The geotechnical report dated June 6, 2024 will be referenced.", "The clouded hold down locations will be revised.", "The plans will be initialed by the architect."]) {
      const r = run({ draft });
      assert.equal(r.draft, draft);
      assert.ok(!rules(r).includes("foreign_process"));
    }
  });

  it("drops a term a second place also claims as its own", () => {
    const evanston: GuardPack = { profile: { id: "evanston", process_wording: { terms: ["bubbl*"] } }, code: [] };
    const draft = "The revision will be bubbled, dated and initialed.";
    const r = guardItems([item({ draft })], letterFor("evanston", "Revise."), [...packs, evanston])[0];
    assert.equal(r.draft, draft);
    assert.ok(!rules(r).includes("foreign_process"));
  });

  it("only flags in a place with no pack, since we don't know its wording", () => {
    const draft = "The revision will be bubbled, dated and initialed.";
    const r = run({ draft }, "Revise.", "other");
    assert.equal(r.draft, draft);
    assert.equal(r.flags.find((f) => f.rule === "foreign_process")?.action, "flagged");
  });
});

describe("citations", () => {
  it("clears and flags one outside the index", () => {
    const r = run({ citation: "SBC 3406" });
    assert.equal(r.citation, null);
    assert.equal(r.flags[0].rule, "citation_not_in_index");
    assert.equal(r.flags[0].action, "cleared");
    assert.equal(r.flags[0].before, "SBC 3406");
  });

  it("keeps one in the index, including a subsection of it and the SEC family", () => {
    for (const citation of ["SMC 23.44.014", "SMC 23.44.041.B", "SMC 23.44.041 Table A", "SRC R302.1(1)", "SRC Table R302.1", "SBC 1011.5", "SEC R401", "SEC 403", "SDCI-RESPONSE"]) {
      const r = run({ citation });
      assert.equal(r.citation, citation, citation);
      assert.ok(!rules(r).includes("citation_not_in_index"), citation);
    }
  });

  it("doesn't let an invented section pass on its chapter's entry", () => {
    assert.ok(citationInIndex("SMC 23.44", seattle));
    assert.ok(!citationInIndex("SMC 23.44.999", seattle));
    assert.ok(!citationInIndex("SBC 1011999", seattle));
    assert.ok(!citationInIndex("SMC 23.440", seattle));
  });

  it("uses Chicago's own format from its pack", () => {
    const chicago = packs[0];
    assert.ok(citationInIndex("14B-10-1011", chicago));
    assert.ok(citationInIndex("14B-10-1011.5", chicago));
    assert.ok(citationInIndex("14N", chicago));
    assert.ok(citationInIndex("DOB-CPC", chicago));
    assert.ok(!citationInIndex("14B-11-9999", chicago));
    assert.equal(run({ citation: "SMC 23.44.014" }, "Revise.", "chicago").citation, null);
  });

  it("keeps the good half of a pair", () => {
    const r = run({ citation: "SMC 23.44.014; SMC 99.99.999" });
    assert.equal(r.citation, "SMC 23.44.014");
    assert.match(r.flags[0].message, /SMC 99\.99\.999/);
  });

  it("clears everything in a place with no index", () => {
    assert.equal(run({ citation: "SMC 23.44.014" }, "Revise.", "other").citation, null);
  });

  it("says so when the letter itself names the cleared citation", () => {
    assert.match(run({ citation: "AWC SDPWS-2015 4.3.5.2" }, "Per AWC SDPWS-2015 4.3.5.2, revise the walls.").flags[0].message, /letter itself/);
  });

  it("leaves a null citation alone", () => assert.deepEqual(rules(run({ citation: null })), []));

  it("flags one in the draft without cutting it, unless the letter vouches for it", () => {
    const draft = "The wall will be revised per SMC 99.99.999.";
    const r = run({ draft });
    assert.equal(r.draft, draft);
    assert.ok(rules(r).includes("citation_in_draft"));
    assert.ok(!rules(run({ draft }, "Revise per SMC 99.99.999.")).includes("citation_in_draft"));
    assert.ok(!rules(run({ draft: "The wall will be revised per SMC 23.44.014." })).includes("citation_in_draft"));
    assert.ok(rules(run({ draft: "The note will cite Director's Rule 12-2023." })).includes("citation_in_draft"));
    assert.ok(!rules(run({ draft: "The detail follows SDPWS 4.3.6.4." }, "Level 2 - SDPWS - 4.3.6.4 - Revise.")).includes("citation_in_draft"));
  });
});

describe("invented numbers", () => {
  it("flags a number from nowhere, and doesn't change the draft", () => {
    const draft = "The opening will be 44 inches wide.";
    const r = run({ draft }, "Provide a wider opening.");
    assert.equal(r.draft, draft);
    assert.equal(r.flags[0].rule, "invented_number");
    assert.equal(r.flags[0].action, "flagged");
    assert.match(r.flags[0].message, /44/);
  });

  it("flags an invented design value even when its digits appear nearby", () => {
    assert.deepEqual(inventedNumbers("Insulation will be R-38.", "Provide R-21 walls with 38 studs."), ["R-38"]);
  });

  const leftAlone: [string, string, string][] = [
    ["the same comment", "The width will be 32 inches.", "Provide a clear width of 32 inches."],
    ["another way of writing it", "The area limit is 2200 square feet.", "The maximum is 2,200 square feet."],
    ["a comma added", "The area limit is 2,200 square feet.", "The maximum is 2200 square feet."],
    ["trailing zeros", "The value will be 5.", "Provide 5.0 credits."],
    ["a number in words", "Monitoring runs for 5 years.", "Monitoring runs for five years."],
    ["a sheet from the letter", "Sheet A3.1 will be updated.", "Revise A3.1."],
    ["a value with a suffix in the letter", "Walls will be R-21 plus R-12.", "Provide R-21+R-12c.i. for walls."],
    ["a citation", "Revised per SMC 23.44.014 and SBC 704, 706 and 707.", "Revise."],
    ["a list marker", "The plans will: (1) add a note; 2) add a label.", "Revise."],
    ["a web address", "See https://example.com/doc/4417.pdf for it.", "Revise."],
    ["the rule name", "Per Director's Rule 12-2023 the note will be added.", "Revise."],
  ];
  for (const [name, draft, letter] of leftAlone) {
    it(`leaves alone ${name}`, () => assert.deepEqual(inventedNumbers(draft, letter, seattle), []));
  }

  it("takes numbers from another comment and the project details", () => {
    const letter = { project: { jurisdiction: "seattle", address: "2530 30th Ave W", description: "Built to the 2021 code." }, comments: [{ id: "C1", text: "Revise the wall." }, { id: "C2", text: "Use 6 inch studs." }] };
    const [r] = guardItems([item({ draft: "The 6 inch wall at 2530 30th Ave W follows the 2021 code." })], letter, packs);
    assert.ok(!rules(r).includes("invented_number"), JSON.stringify(r.flags));
  });
});

describe("route safety", () => {
  const forced = ["Provide structural calculations for the beam.", "Sheet S2.2 Shear walls at Grid 10: revise the load path.", "S4.1: Structural - Revise the plan set to show what supports the beam.", "Exterior wall within 3 feet must be one-hour fire rated.", "Revise so the north emergency escape window is clear.", "Provide at least one egress door.", "Earth pressures do not match the report.", "Provide a letter signed and stamped by the engineer.", "The FAR calculation is wrong. Please update it."];
  for (const text of forced) {
    for (const route of ["agent_draft", "no_action"]) {
      it(`holds a ${route} item: ${text}`, () => {
        const r = run({ route, draft: "" }, text);
        assert.equal(r.route, "licensed_review");
        assert.equal(r.agent_route, route);
        assert.equal(r.flags[0].rule, "route_forced");
        assert.equal(r.flags[0].action, "rerouted");
      });
    }
  }

  const notForced = [
    "This project has been reviewed for conformance with one or more of the following codes: 2021 Seattle Residential Code (SRC).Ordinance Structural (4)",
    "This project has been reviewed for conformance with one or more of the following codes: 2018 Seattle Building Code (SBC)Structural Engineer (5)",
    "A0.0: Code Edition - Revise the plan set to state that this project has been reviewed for ordinance conformance with the 2021 SRC and structural conformance with the 2021 SBC.Ordinance Structural (4)",
    "FYI ONLY, NO RESPONSE REQUIRED. Existing shear walls were reviewed.",
    "The plans are missing information including existing vs. new construction & egress information.",
    "Delete these sections, they do not apply.Fire (10)",
    "Specify building address so it is visible from the street.",
    "Structural calculations are not required for this scope.",
    "Thank you for the structural calculations.",
    "Any construction activity (pavers, retaining walls, etc.) within the right-of-way requires separate review from SDOT.",
  ];
  for (const text of notForced) {
    it(`doesn't hold: ${text.slice(0, 70)}`, () => {
      const r = run({ route: "agent_draft" }, text);
      assert.equal(r.route, "agent_draft");
      assert.deepEqual(rules(r), []);
    });
  }

  it("doesn't let an FYI in one sentence excuse a request in the next", () => assert.ok(judgmentSignals("FYI: the code edition changed. Provide structural calculations for the beam.").length > 0));

  it("doesn't touch other routes, which are someone else's to act on", () => {
    for (const route of ["client_input", "other_agency", "licensed_review"]) assert.equal(run({ route }, "Provide structural calculations.").route, route);
  });

  it("reads the parent comment when the agent split it", () => {
    const r = guardItems([item({ comment: "C1a", route: "agent_draft", draft: "A note will be added." })], letterFor("seattle", "Provide structural calculations."), packs)[0];
    assert.equal(r.route, "licensed_review");
    assert.ok(rules(r).includes("unknown_comment"));
  });
});

describe("the guard as a whole", () => {
  it("leaves a clean draft exactly as it was, with no flags", () => {
    const clean = item({ citation: "SMC 23.44.014", draft: "Sheet A1.0 will be revised  to show the 20 foot yard.\nThe note will be added." });
    const [r] = guardItems([clean], letterFor("seattle", "Show the 20 foot yard on A1.0."), packs);
    assert.deepEqual(r, { ...clean, flags: [] });
  });

  it("doesn't change its input, and gives the same answer twice", () => {
    const input = item({ draft: "The DADU will be revised to comply with the limit. Revisions will be bubbled, dated and initialed.", citation: "SBC 3406" });
    const copy = structuredClone(input);
    const a = guardItems([input], letterFor("seattle", "Revise."), packs);
    assert.deepEqual(input, copy);
    assert.deepEqual(a, guardItems([input], letterFor("seattle", "Revise."), packs));
  });

  it("settles on a second pass", () => {
    const [once] = guardItems([item({ draft: "The DADU will be revised to comply with the limit. Revisions will be bubbled, dated and initialed." })], letterFor("seattle", "Revise."), packs);
    const [twice] = guardItems([once], letterFor("seattle", "Revise."), packs);
    assert.equal(twice.draft, once.draft);
    assert.deepEqual(twice.flags, []);
  });

  it("applies more than one rule to the same draft", () => {
    const r = run({ route: "agent_draft", citation: "SBC 3406", draft: "The wall will be revised to comply with SBC 705 at 44 inches. This revision will be bubbled, dated and initialed." }, "Provide structural calculations.");
    assert.equal(r.draft, "The wall will be revised to address SBC 705 at 44 inches.");
    assert.deepEqual(rules(r).sort(), ["citation_not_in_index", "compliance_claim", "foreign_process", "invented_number", "route_forced"]);
  });

  it("flags an item for a comment the letter doesn't have", () => assert.ok(rules(run({ comment: "C9" })).includes("unknown_comment")));
});

describe("what reaches the customer", () => {
  const report = (over: Partial<Report> = {}): Report => ({
    id: "a".repeat(32),
    created_at: "2026-10-31T00:00:00Z",
    jurisdiction: "seattle",
    place: "City of Seattle, Washington",
    permit_number: null,
    project: "",
    comments: [{ id: "C1", heading: "Pasted", text: "Provide structural calculations." }, { id: "C2", heading: "Pasted", text: "Revise <the> note." }],
    items: guardItems(
      [item({ route: "no_action", draft: "" }), item({ comment: "C2", route: "agent_draft", citation: "SBC 3406", draft: "The note will comply with SMC 23.44.014. Revisions will be bubbled, dated and initialed." })],
      { project: { jurisdiction: "seattle", address: "x", description: "y" }, comments: [{ id: "C1", text: "Provide structural calculations." }, { id: "C2", text: "Revise <the> note." }] },
      packs,
    ),
    session_id: "s",
    trace: [],
    unlocked: true,
    unlocked_by: "design_partner",
    learning_opt_in: false,
    decisions: {},
    ...over,
  });

  it("sends flags with each item", () => {
    const view = publicView(report());
    assert.ok(view.items.find((i) => i.comment === "C2")?.flags.some((f) => f.rule === "compliance_claim"));
  });

  it("doesn't give away a locked draft or citation through its flags", () => {
    const free = [0, 1, 2, 3].map((n) => ({ ...item({ comment: `F${n}`, draft: "Free wording." }), flags: [] as GuardFlag[] }));
    const claim = guardItems([item({ comment: "C2", route: "agent_draft", citation: "SBC 3406", draft: "The secret will comply with the code." })], letterFor("seattle", "Revise."), packs);
    const forced: GuardedItem = { ...item({ comment: "C9", route: "licensed_review", draft: "Secret." }), flags: [{ rule: "route_forced", action: "rerouted", level: "review", message: "Held.", before: "agent_draft", after: "licensed_review" }] };
    const locked = report({ unlocked: false, unlocked_by: null, items: [...free, ...claim, forced] });
    const view = publicView(locked);
    const hidden = view.items.filter((i) => i.locked);
    assert.ok(hidden.length >= 1);
    for (const i of hidden) for (const f of i.flags) assert.equal(f.rule, "route_forced");
    assert.ok(!JSON.stringify(hidden).includes("SBC 3406"));
    assert.ok(!JSON.stringify(hidden).includes("secret"));
  });

  it("still opens a report saved before the guard existed", () => {
    const old = report({ items: [item({ draft: "A draft." })] });
    assert.deepEqual(publicView(old).items[0].flags, []);
    assert.match(exportDoc(old), /A draft\./);
  });

  it("shows flags in the Word export and warns before filing", () => {
    const doc = exportDoc(report());
    assert.match(doc, /Check:<\/b> Promises code compliance/);
    assert.match(doc, /have something to check/);
    assert.match(doc, /Note: Removed revision-marking wording/);
    assert.ok(!doc.includes("bubbled"));
  });

  it("keeps a held item with no draft in the export", () => {
    const doc = exportDoc(report());
    assert.match(doc, /C1\.<\/b> Provide structural calculations\.<br><i>Response:<\/i> <i>No draft yet\.<\/i> <b>\[HELD/);
  });

  it("escapes flag text in the export", () => {
    const r = report();
    r.items[0].flags = [{ rule: "citation_in_draft", action: "flagged", level: "review", message: "Bad <script>" }];
    assert.ok(exportDoc(r).includes("Bad &lt;script&gt;"));
  });

  it("drops the notes once a professional approves, and drops the warning when none are left", () => {
    const approved = report({ decisions: { C1: { decision: "approve", note: "", at: "" }, C2: { decision: "approve", note: "", at: "" } } });
    const doc = exportDoc(approved);
    assert.ok(!doc.includes("Check:"));
    assert.ok(!doc.includes("have something to check"));
  });
});
