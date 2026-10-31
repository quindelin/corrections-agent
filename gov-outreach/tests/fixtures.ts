// FICTIONAL TEST DATA. Every agency, law, person, address and outcome here is invented, uses a reserved .example domain,
// and is labeled. None of it describes a real agency, a real law or a real response.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendJsonl, GOV_DIR, gitIn, type Home, type Law, type Policy, openHome, type RecordsEvent, type RequestRecord, type Sender, type Target } from "../lib.ts";
import type { EvidenceRow } from "../stats.ts";

export const TEST_SENDER: Sender = {
  full_name: "Test Requester (fictional)",
  entity: "Fictional Test Org",
  mailing_address: "100 Example Street, Testville, ZZ 00000",
  email: "requester@records-test.example",
  phone: "",
  fee_notice_usd: 25,
  no_republish_promise: true,
};

const fictionalLaw = (id: string, name: string, unit: "business" | "calendar", first: number | null, ext: number | null, commercial: Law["commercial"]["disclosure"]): Law => ({
  id,
  name,
  request_name: name,
  citation: `${id.toUpperCase()} Code ch. 1 (fictional)`,
  verification: "primary_read",
  verification_note: "FICTIONAL. Invented for testing.",
  default_class: commercial === "not_required" ? "any" : "commercial",
  commercial: { disclosure: commercial, basis: "Fictional.", paragraph: commercial === "not_required" ? "**Who's asking and why:** {{purpose}}" : "**Commercial purpose:** This request is for a commercial purpose. {{purpose}}", lawyer: "Fictional." },
  submission_rules: [],
  rules: [{
    id: `${id}-all`,
    classes: ["any", "commercial", "noncommercial"],
    applies_from: "2020-01-01",
    applies_until: null,
    first_response: { count: first, unit: first ? unit : null, label: first ? `${first} ${unit} days (fictional)` : "Promptly (fictional)", cite: "Fictional sec. 1" },
    extension: ext ? { count: ext, unit, from: "original_due", cite: "Fictional sec. 2", note: "Fictional." } : null,
    silence: "denial",
    silence_note: "Fictional.",
    fees: "Fictional.",
    appeals: [
      { forum: "Fictional Records Board", window_days: 30, window_unit: "calendar", from: "final_denial", requires: null, cite: "Fictional sec. 3", note: "Fictional." },
      { forum: "Fictional court", window_days: null, window_unit: null, from: "denial", requires: null, cite: "Fictional sec. 4", note: "Fictional." },
    ],
    sources: [],
  }],
  denial_content: "Fictional.",
  sources: [],
});

const fictionalTarget = (id: string, place: string, state: string, law: string, sample: number, named: boolean): Target => ({
  id,
  place,
  state,
  law_id: law,
  agency: `Fictional ${place.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Building Office`,
  office: "Records desk (fictional)",
  salutation: "Hello,",
  holds: "Fictional plan review comments.",
  why: "Test data.",
  status: "draft_ready",
  contact: { channel: "email", value: `records@${place}.example`, evidence: "fictional", source_url: `https://${place}.example/records`, checked: "2026-10-31" },
  other_contacts: [],
  access: [],
  asks: [
    {
      key: `${id}-small`,
      kind: "records_request",
      subject: `Public records request: ${sample} correction letters`,
      summary: `${sample} building plan review correction letters issued in 2026, chosen by whatever is easiest for your staff.`,
      records: [`The correction letter sent to the applicant for each of the ${sample} permits.`, "For each: the permit number and the date issued."],
      format_note: "PDF is ideal.",
      exclude: "plans, drawings, calculations or sealed documents.",
      sample_size: sample,
      items_label: named ? "Permits" : null,
      items: named ? ["FIC-0001", "FIC-0002"] : [],
      narrowing: "please tell me, and I'd gladly take 1 letter first.",
      must_keep: ["correction letter"],
      follow_on: null,
    },
    {
      key: `${id}-permission`,
      kind: "permission_ask",
      subject: "Question about bulk access to plan review comments",
      site: "the fictional portal",
      summary: "public plan review comments on the fictional portal",
      access_so_far: "So far we have read one page by hand. We haven't crawled it.",
      questions: ["Is there a bulk export?", "If not, would you accept slow automated retrieval? We would not do this without a yes.", "What conditions apply?"],
      sample_size: 0,
      fallback: "If the answer is no, I'd make a small request instead.",
    },
  ],
  pre_send: ["Fictional check."],
  lawyer: ["Fictional question."],
  fictional: true,
});

export const FICTIONAL_LAWS: Law[] = [
  fictionalLaw("fx-one", "Fictional Records Act of Stateone", "business", 5, 5, "required_if_asked"),
  fictionalLaw("fx-two", "Fictional Open Files Law of Statetwo", "calendar", 10, 14, "not_required"),
  fictionalLaw("fx-three", "Fictional Disclosure Code of Statethree", "business", null, null, "required_at_request"),
];

export const FICTIONAL_TARGETS: Target[] = [
  fictionalTarget("testville-bldg", "testville", "ZA", "fx-one", 5, true),
  fictionalTarget("sampleton-bldg", "sampleton", "ZB", "fx-two", 10, false),
  fictionalTarget("mockburg-bldg", "mockburg", "ZC", "fx-three", 3, false),
  fictionalTarget("demoport-bldg", "demoport", "ZB", "fx-two", 5, false),
];

/** A scratch home holding fictional data, in its own git repo, so learn can show a real diff without touching this repo. */
export function initTestHome(dir: string): Home {
  if (existsSync(join(dir, "data", "DATASET"))) throw new Error(`${dir} is already a test home.`);
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "agent", "playbook"), { recursive: true });
  for (const f of ["agent.json", "instructions.md", "policy.json"]) cpSync(join(GOV_DIR, "agent", f), join(dir, "agent", f));
  cpSync(join(GOV_DIR, "agent", "playbook", "general.md"), join(dir, "agent", "playbook", "general.md"));
  for (const t of FICTIONAL_TARGETS) {
    writeFileSync(join(dir, "agent", "playbook", `${t.place}.md`), `---\nname: gov-records-${t.place}\ndescription: Rules for ${t.place} (FICTIONAL TEST DATA).\n---\n\n# Rules for ${t.place} (FICTIONAL)\n\n<!-- rules:start -->\n\`\`\`json\n[{"id":"${t.place.toUpperCase()}-001","scope":"${t.place}","kind":"principle","status":"active","text":"Use the fictional records desk.","based_on":[],"claim":null,"tally":null,"source":"seed","added":"2026-10-31","spotcheck":null}]\n\`\`\`\n<!-- rules:end -->\n\n## Standing\n\n<!-- standing:start -->\nNone yet.\n<!-- standing:end -->\n`);
  }
  writeFileSync(join(dir, "agent", "laws.json"), JSON.stringify({ _note: "FICTIONAL TEST DATA.", laws: FICTIONAL_LAWS, sources: {} }, null, 2));
  writeFileSync(join(dir, "agent", "targets.json"), JSON.stringify({ _note: "FICTIONAL TEST DATA.", purpose: "{{entity}} builds software that helps architects and permit expediters respond to plan review correction comments, and intends to charge for it. The records would be used to test and improve that software on real comments.", targets: FICTIONAL_TARGETS }, null, 2));
  writeFileSync(join(dir, "data", "DATASET"), "test\n");
  writeFileSync(join(dir, "data", "sender.json"), JSON.stringify(TEST_SENDER, null, 2));
  writeFileSync(join(dir, ".gitignore"), "data/\n");
  writeFileSync(join(dir, "README.md"), "Scratch home holding FICTIONAL TEST DATA. Nothing here describes a real agency or a real response.\n");
  gitIn(dir, "init", "-q");
  gitIn(dir, "add", ".");
  gitIn(dir, "-c", "user.name=Records Test", "-c", "user.email=records-test@records-test.example", "commit", "-q", "-m", "baseline (fictional test home)");
  gitIn(dir, "config", "user.name", "Records Test");
  gitIn(dir, "config", "user.email", "records-test@records-test.example");
  console.log(`✓ Test home at ${dir}. All data is fictional.`);
  return openHome(dir);
}

export const FICTIONAL_POLICY: Policy = {
  limits: { max_open_per_target: 1, max_requests_per_target_per_180_days: 2, max_sample_first_request: 15 },
  tracking: { due_soon_days: 5, overdue_grace_business_days: 1, checkin_no_fixed_deadline_business_days: 10, maturity_calendar_days: 120 },
  learning: { min_closed_per_arm: 12, min_agencies: 4, min_states: 3, max_counted_per_agency_per_arm: 3, alpha: 0.05, min_places_for_general_hypothesis: 2, min_states_for_general_hypothesis: 2, features: { small_sample: { label: "asks for 5 or fewer", learned_text_true: "Ask for 5 or fewer.", learned_text_false: "No need." } } },
  spotcheck: { per_run: 5, seed: 1 },
  budget: { max_usd_per_command: 0.5, max_usd_total: 3 },
};

/** A fictional evidence row for testing verdicts. */
export function row(id: string, target: string, place: string, state: string, small: boolean, usable: number, extra: Partial<EvidenceRow> = {}): EvidenceRow {
  return { id, target_id: target, place, state, kind: "records_request", sample_size: small ? 5 : 10, small_sample: small, named_items: false, formal_route: true, channel: "email", sent_at: "2026-01-05", closed: true, closed_how: "event", responded: true, first_response_days: 5, documents_received: usable, usable_records: usable, usable_comments: usable * 5, denied: false, exemptions: [], fee_quoted_usd: null, narrowed: false, notes: [], ...extra };
}

export function fictionalRequest(target: Target, n: number, ask = target.asks[0], createdAt = "2026-01-01T12:00:00.000Z"): RequestRecord {
  return {
    id: `R-${target.place.slice(0, 3)}${String(n).padStart(3, "0")}`,
    dataset: "test",
    target_id: target.id,
    place: target.place,
    state: target.state,
    law_id: target.law_id,
    ask_key: ask.key + (n > 1 ? `-${n}` : ""),
    kind: ask.kind,
    subject: ask.subject,
    sections: { summary: ask.summary, records: ask.records ?? ask.questions ?? [] },
    features: { sample_size: ask.sample_size, small_sample: ask.sample_size > 0 && ask.sample_size <= 5, named_items: (ask.items ?? []).length > 0, formal_route: ask.kind === "records_request", channel: target.contact.channel },
    rules_used: [],
    playbook_sha: "fictional",
    source: "template",
    gate: { status: "pending_review", issues: [] },
    session_id: null,
    created_at: createdAt,
  };
}

/** Writes a request and its outcome events straight into a test home, so learn has something to read without any drafting. */
export function seedOutcome(h: Home, req: RequestRecord, events: Omit<RecordsEvent, "dataset" | "request_id">[]): void {
  appendJsonl(h.requests, req);
  for (const e of events) appendJsonl(h.events, { ...e, dataset: "test", request_id: req.id });
}
