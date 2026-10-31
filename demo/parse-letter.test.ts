// Formats here are copied from Seattle's public Plan Comments text and the Bluebeam summaries the parser was written for,
// with every name, address and number replaced. No reviewer's real details appear in this file.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_COMMENTS, MAX_LETTER_CHARS, parseLetter, parseLetterDetailed } from "./parse-letter.ts";
import { collectNames, stripPersonal, stripTrailingHeading } from "./strip-personal.ts";

const BLUEBEAM = `Seattle Department of Construction and Inspections
700 Fifth Ave Suite 2000
Responding to Review Comments
Zoning (2)
Subject: Zoning
Page Index: 3
Page Label: A1.0
Author: Pat Example
Date: 3/4/2025 10:12:00 AM
Status: Open
Color: Red
Layer: Review Comment
Review Type: Zoning
Show the required front yard on the site plan,
per SMC 23.44.014.C (3)
Subject: Zoning
Page Index: 4
Author: Pat Example
Layer: Review Comment
Review Type: Zoning
Update the floor area calculations. Questions to Pat Example at pat.example@seattle.gov or (206) 555-0142.
An equal employment opportunity employer`;

test("Bluebeam summary: blocks become comments, with metadata gone", () => {
  const c = parseLetter(BLUEBEAM);
  assert.equal(c.length, 2);
  assert.equal(c[0].heading, "Zoning");
  assert.ok(!/Page Index|Status:|Color:|Layer:/.test(c[0].text));
});

test("Bluebeam summary: a last line ending in a clause number isn't mistaken for a group heading", () => {
  assert.equal(parseLetter(BLUEBEAM)[0].text, "Show the required front yard on the site plan, per SMC 23.44.014.C (3)");
});

test("Bluebeam summary: author, email and phone never survive", () => {
  const all = JSON.stringify(parseLetter(BLUEBEAM));
  assert.ok(!all.includes("Pat Example") && !all.includes("Author"), all);
  assert.ok(!all.includes("seattle.gov") && !all.includes("555-0142"), all);
  assert.ok(all.includes("[name removed]") && all.includes("[email removed]") && all.includes("[phone removed]"));
});

test("metadata glued to the comment on one line keeps the comment and drops the name", () => {
  const c = parseLetter(`Subject: Zoning
Author: Sam Sample Layer: Review CommentShow the location of exterior lights on the plans.
Subject: MHA
Author: Sam Sample Layer: Review CommentThe calculations now appear accurate. Please confirm the unit count.`);
  assert.deepEqual(c.map((x) => x.text), ["Show the location of exterior lights on the plans.", "The calculations now appear accurate. Please confirm the unit count."]);
});

test("a sentence that starts like a metadata field stays in the comment", () => {
  const long = "Space: the parking stall dimensions on sheet A2 don't match the dimensions in the parking table on sheet A3.";
  const c = parseLetter(`Subject: Parking\nReview Type: Zoning\n${long}`);
  assert.equal(c[0].text, long);
});

test("numbered letter: splits in order and ignores a stray number", () => {
  const c = parseLetter(`1. Revise the site plan so the setback is dimensioned.
This building has
2 stories above grade.
2. Provide the drainage report.
3. Correct the address.`);
  assert.equal(c.length, 3);
  assert.equal(c[0].heading, "Pasted");
  assert.deepEqual(c.map((x) => x.id), ["C1", "C2", "C3"]);
});

test("numbered letter: 'Author:' lines are stripped there too", () => {
  const all = JSON.stringify(parseLetter(`Author: hirschx
1. Revise the site plan. Reviewed by hirschx.
Author: hirschx
2. Provide the drainage report.`));
  assert.ok(!all.includes("hirschx"), all);
});

test("paragraph fallback splits on blank lines and drops scraps", () => {
  const c = parseLetter("Show the tree protection fencing on the plan.\n\nPage 2\n\nProvide an arborist report for the exceptional tree.");
  assert.equal(c.length, 2);
});

test("cuts are reported instead of silent", () => {
  const many = Array.from({ length: MAX_COMMENTS + 5 }, (_, i) => `${i + 1}. Provide the item number ${i + 1} on the plans.`).join("\n");
  const r = parseLetterDetailed(many);
  assert.equal(r.comments.length, MAX_COMMENTS);
  assert.deepEqual(r.truncated, { chars: false, comments: true });
  assert.equal(parseLetterDetailed(`1. A comment here.\n2. Another one.\n${"x ".repeat(MAX_LETTER_CHARS)}`).truncated.chars, true);
  assert.deepEqual(parseLetterDetailed("1. Short letter.\n2. Second comment.").truncated, { chars: false, comments: false });
});

test("empty input gives no comments", () => {
  assert.deepEqual(parseLetter(""), []);
  assert.deepEqual(parseLetter("   \n\n  "), []);
});

test("group headings glued to a comment come off", () => {
  const cases: [string, string[], string][] = [
    ["Please update the plat.Zoning - SMC 23.44 - Neighborhood Residential (10)", ["Zoning – SMC 23.44 – Neighborhood Residential"], "Please update the plat."],
    ["Please update the stormwater plan.Drainage (16)", [], "Please update the stormwater plan."],
    ["Revise and resubmit.SamSample (5)", [], "Revise and resubmit."],
    ["Species are listed in the addendum. Pat Example (1)", [], "Species are listed in the addendum."],
    ["Update the plan set where applicable.  (1)", [], "Update the plan set where applicable."],
  ];
  for (const [raw, known, want] of cases) assert.equal(stripTrailingHeading(raw, known), want);
});

test("a real sentence ending in a number in parentheses keeps it", () => {
  for (const text of ["Provide the setback per SMC 23.44.014.C (3)", "Update the area shown in Table (1)", "Roof insulation must follow the values in table A105.1 (3)", "Use the detail. See Table (2)"]) {
    assert.equal(stripTrailingHeading(text), text);
  }
});

test("emails glued to the next word lose only the address", () => {
  assert.equal(stripPersonal("Reach me at pat.example@seattle.govZoning review is next."), "Reach me at [email removed]Zoning review is next.");
  assert.equal(stripPersonal("Email: pat@seattle.gov."), "Email: [email removed].");
  assert.equal(stripPersonal("Write to a.b@city.example.co.uk"), "Write to [email removed]");
  assert.equal(stripPersonal("Write to pat@seattle. gov soon"), "Write to [email removed] soon"); // a line wrap
});

test("phone formats seen in the data", () => {
  for (const phone of ["206-555-0142", "(206) 555-0142", "(206)-555-0142", "206.555.0142", "+1 206 555 0142", "206-555-0142 x12", "206-555-0 142", "206- 555-0142"]) {
    assert.equal(stripPersonal(`Call ${phone} today`), "Call [phone removed] today", phone);
  }
});

test("phone stripping leaves code and record numbers alone", () => {
  for (const text of ["See SMC 23.44.014 and record 7032737-CN", "parcel 686520-0465", "the 2021 code, 10 ft by 20 ft"]) {
    assert.equal(stripPersonal(text), text);
  }
});

test("labelled and contacted names go, ordinary words stay", () => {
  assert.equal(stripPersonal("SDCI Reviewer: Sam Sample [Structural Plans Engineer]"), "SDCI Reviewer: [name removed] [Structural Plans Engineer]");
  assert.equal(stripPersonal("Please contact Sam Sample for inspection."), "Please contact [name removed] for inspection.");
  for (const text of [
    "Please contact the reviewer above.",
    "Call out the inverts on the plan.",
    "Contact Seattle Public Utilities for the permit.",
    "[Note to SDCI Reviewer: R-49 is specified on this sheet]",
    "Email me with any questions.",
  ]) assert.equal(stripPersonal(text), text);
});

test("a name the letter labels once is removed everywhere in it", () => {
  const raw = "Author: Sam Sample Layer: Review Comment\nAs Sam Sample noted, revise. SamSample (2)";
  const names = collectNames(raw);
  assert.ok(names.includes("Sam Sample") && names.includes("SamSample"));
  assert.ok(!stripPersonal(raw, names).includes("Sam"));
});
