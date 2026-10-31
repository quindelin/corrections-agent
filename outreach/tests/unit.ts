// npx tsx outreach/tests/unit.ts
// Offline checks of the rules that matter most. No model calls and no network. All data is fictional.

import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandClaims, isSuppressed, lintDraft, quota, renderMessage, touchProblem, validateSender } from "../compliance.ts";
import { summaryProblem, validateChange } from "../learn.ts";
import { type Claim, fromSkeleton, type Message, openHome, OUTREACH_DIR, parseVariants, type Policy, readJsonl, replaceVariants, toSkeleton, type Variant } from "../lib.ts";
import { approvalProblems, assignVariant, draftable, loadAll } from "../messages.ts";
import { assembleProspect, findEmails, findNotices, type Page, permitNameOnSite, pickLinks, robotsAllows, verifyExtracted } from "../research.ts";
import { computeVerdict, fisherExact, guardrail, wilson } from "../stats.ts";
import { initTestHome, seedOutcomes, TEST_SENDER, testProspect } from "./fixtures.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

const playbook = readFileSync(join(OUTREACH_DIR, "agent", "playbook.md"), "utf8");
const variants = parseVariants(playbook);
const policy = JSON.parse(readFileSync(join(OUTREACH_DIR, "agent", "policy.json"), "utf8")) as Policy;
const claims = (JSON.parse(readFileSync(join(OUTREACH_DIR, "agent", "claims.json"), "utf8")) as { claims: Claim[] }).claims;
const AS_OF = new Date("2026-10-31T00:00:00Z");
const scratch = () => mkdtempSync(join(tmpdir(), "outreach-unit-"));
const quiet = <T>(fn: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};
const home = (n = 6) => quiet(() => initTestHome(scratch(), n));

// ---------- statistics ----------

check("fisher matches a known value", near(fisherExact(1, 4, 3, 4), 0.4857, 1e-3), String(fisherExact(1, 4, 3, 4)));
check("fisher 0/50 vs 8/50", near(fisherExact(0, 50, 8, 50), 0.0058, 1e-3), String(fisherExact(0, 50, 8, 50)));
check("fisher identical is 1", near(fisherExact(5, 50, 5, 50), 1));
const [lo, hi] = wilson(0, 12);
check("wilson stays wide at small n", lo === 0 && hi > 0.2, String(hi));

// ---------- the verdict refuses thin data ----------

function verdictFor(plans: Parameters<typeof seedOutcomes>[1], sentAt?: string) {
  const h = home(0);
  seedOutcomes(h, plans, sentAt);
  const s = loadAll(h);
  return computeVerdict(s.messages, s.events, variants, s.policy, AS_OF);
}
const V1 = "V1-time-share";
const V2 = "V2-need-real-letters";

const noData = computeVerdict([], [], variants, policy, AS_OF);
check("no sends is no_data", noData.status === "no_data");
const small = verdictFor([{ variant: V1, sent: 12, positive: 6 }, { variant: V2, sent: 12, positive: 0 }]);
check("6/12 vs 0/12 is still refused", small.status === "insufficient_data" && small.winner === null, small.status);
check("refusal states sample sizes", /V1-time-share 12/.test(small.reason) && /50/.test(small.reason), small.reason);
const justUnder = verdictFor([{ variant: V1, sent: 49, positive: 30 }, { variant: V2, sent: 49, positive: 0 }]);
check("49 per arm is refused however large the gap", justUnder.status === "insufficient_data");
const large = verdictFor([{ variant: V1, sent: 60, positive: 15 }, { variant: V2, sent: 60, positive: 2 }]);
check("a large gap at 60 per arm wins", large.status === "winner" && large.winner === V1 && large.losers[0] === V2, large.reason);
check("the test uses the fixed look, n=50", large.comparisons[0].n_each === 50 && large.look === 1);
const close = verdictFor([{ variant: V1, sent: 60, positive: 8 }, { variant: V2, sent: 60, positive: 4 }]);
check("8 vs 4 at 60 per arm is no clear difference", close.status === "no_clear_difference" && close.winner === null, close.reason);
const fresh = verdictFor([{ variant: V1, sent: 60, positive: 30 }, { variant: V2, sent: 60, positive: 1 }], "2026-10-29T12:00:00.000Z");
check("sends inside the reply window don't count", fresh.status === "insufficient_data" && fresh.arms[0].not_yet_mature === 60, fresh.reason);
const bouncy = verdictFor([{ variant: V1, sent: 55, positive: 20, bounced: 10 }, { variant: V2, sent: 55, positive: 0 }]);
check("bounces aren't delivered", bouncy.status === "insufficient_data" && bouncy.arms.find((a) => a.variant_id === V1)!.delivered === 45, bouncy.reason);
const paused = verdictFor([{ variant: V1, sent: 20, bounced: 5 }]);
check("high bounce pauses on little data", paused.paused !== null);
const unsubs = verdictFor([{ variant: V1, sent: 20, unsubscribed: 3 }]);
check("unsubscribes pause on little data", unsubs.paused !== null);
const fine = verdictFor([{ variant: V1, sent: 20, bounced: 1, unsubscribed: 1 }]);
check("one bounce and one unsubscribe don't pause", fine.paused === null);
{
  const h = home(0);
  const { messages, events } = seedOutcomes(h, [{ variant: V1, sent: 20, bounced: 5 }]);
  const resumed = [...events, { type: "resumed" as const, dataset: "test" as const, at: "2026-10-01T00:00:00.000Z" }];
  check("resume clears the pause", guardrail(messages, resumed, policy) === null);
}

// ---------- what the model may do to the playbook ----------

const ctx = (after: string, verdict = small) => validateChange({ before: playbook, after, verdict, knownClaims: claims.map((c) => c.id), privateStrings: ["Fictional Firm 3", "fictional-firm-3.example"] });
const withV = (vs: Variant[]) => replaceVariants(playbook, vs);
check("an unchanged playbook is allowed", ctx(playbook).length === 0, ctx(playbook).join("; "));
const retireOnThin = withV(variants.map((v) => (v.id === V2 ? { ...v, status: "retired" as const } : v)));
check("can't retire a variant on thin data", ctx(retireOnThin).some((p) => p.includes("changed status")));
const activateOnThin = withV(variants.map((v) => (v.status === "proposed" ? { ...v, status: "active" as const } : v)));
check("can't activate a variant on thin data", ctx(activateOnThin).some((p) => p.includes("changed status")));
check("can retire the loser after a decided win", ctx(retireOnThin, large).length === 0, ctx(retireOnThin, large).join("; "));
const edited = withV(variants.map((v) => (v.id === V1 ? { ...v, angle: "Something else" } : v)));
check("can't edit a frozen variant", ctx(edited).some((p) => p.includes("frozen")));
check("can't delete a variant", ctx(withV(variants.slice(1))).some((p) => p.includes("removed")));
const claimed = playbook.replace("## Voice", "## Voice\n\n- The time-share angle is the winner, so lead with it.");
check("can't declare a winner in prose on thin data", ctx(claimed).some((p) => p.includes("performance result")));
check("can't state a result in prose even after a win", ctx(claimed, large).some((p) => p.includes("performance result")));
check("a line marked as a hypothesis is allowed", ctx(playbook.replace("## Voice", "## Voice\n\n- Hypothesis: the critique angle works better for architects."), large).length === 0);
check("a summary can't state a result", summaryProblem("V1 outperformed V2.") !== null);
check("a summary can't quote rates", summaryProblem("Positive rate was 26.7%.") !== null);
check("a summary can't explain why", summaryProblem("This suggests critique requests generate engagement.") !== null);
check("a plain summary is fine", summaryProblem("Shortened the opening, as a reviewer note asked.") === null);
const skeleton = toSkeleton(playbook);
check("the model's copy has no variant text", !skeleton.includes("V1-time-share") && skeleton.includes("<!-- VARIANTS -->"));
check("the skeleton rebuilds the file", JSON.stringify(parseVariants(fromSkeleton(skeleton, variants, "x")!)) === JSON.stringify(variants));
check("a reply that drops the placeholders fails", fromSkeleton(skeleton.replace("<!-- VARIANTS -->", ""), variants, "x") === null);
const quoted = playbook.replace("## Voice", "## Voice\n\n- Variant one gets replies at 50%.");
check("can't quote rates on thin data", ctx(quoted).some((p) => p.includes("rates")));
check("can't quote rates after a win", ctx(quoted, large).some((p) => p.includes("rates")));
const leak = playbook.replace("## Voice", "## Voice\n\n- Write like the note Fictional Firm 3 liked.");
check("can't name a prospect", ctx(leak).some((p) => p.includes("prospect")));
const newOk = withV([...variants, { id: "V4-ask-for-pattern", status: "proposed", segments: ["permit_expediter"], angle: "Ask what they see most.", ask: "A short reply.", required_claims: [] }]);
check("can add a proposed variant", ctx(newOk).length === 0, ctx(newOk).join("; "));
const newActive = withV([...variants, { id: "V4-x", status: "active", segments: ["permit_expediter"], angle: "a", ask: "b", required_claims: [] }]);
check("a new variant can't start active", ctx(newActive).some((p) => p.includes("must start")));
const newClaim = withV([...variants, { id: "V4-y", status: "proposed", segments: ["permit_expediter"], angle: "a", ask: "b", required_claims: ["ninety_percent_faster"] }]);
check("a new variant can't invent a claim", ctx(newClaim).some((p) => p.includes("doesn't exist")));
check("the frontmatter stays", ctx(playbook.replace(/^---[\s\S]*?---\n/, "")).some((p) => p.includes("frontmatter")));
check("policy and claims aren't in the playbook's reach", !/max_per_day|verified_by_human/.test(playbook));

// ---------- the draft gate ----------

const prospect = testProspect(1);
const v1 = variants.find((v) => v.id === V1)!;
const v2 = variants.find((v) => v.id === V2)!;
const goodBody = `We're trying to test Redline against real letters, and your two-flat work is why I'm writing. {{claim:redline_what}} {{claim:redline_limits}} Would you share one redacted correction letter from a finished project? If not, no problem at all, and I won't write again.`;
const good = { subject: "Redline: looking for a real correction letter", body: goodBody, facts_used: ["F3"] };
check("a clean draft passes", lintDraft(good, prospect, v2, claims).length === 0, JSON.stringify(lintDraft(good, prospect, v2, claims)));
const issueCodes = (d: Partial<typeof good>, v = v2) => lintDraft({ ...good, ...d }, prospect, v, claims).map((i) => i.code);
for (const [label, phrase] of [
  ["city acceptance", "The city accepted these responses."],
  ["approved by city", "It was approved by the city."],
  ["approval rate", "Our approval rate is high."],
  ["get approved", "It will get you approved."],
  ["time saving", "It will save you weeks."],
  ["faster", "You'd get permits faster."],
  ["cycles", "It will reduce your cycles."],
  ["score", "It scored well in our evals."],
  ["accuracy", "Its accuracy is high."],
  ["validated", "Architects validated it."],
  ["customers", "Our customers love it."],
  ["guarantee", "We guarantee results."],
  ["free", "It's free for a month."],
  ["fake thread", "Following up on our call."],
  ["footer", "To unsubscribe, reply."],
  ["link", "See https://redline.example"],
  ["placeholder", "Hi [Name],"],
] as const) {
  check(`gate blocks ${label}`, issueCodes({ body: `${goodBody} ${phrase}` }).includes("banned_phrase"), phrase);
}
check("gate blocks restating a claim", issueCodes({ body: `${goodBody} I've only tested it on letters we wrote ourselves.` }).includes("claim_restated"));
check("gate blocks describing Redline in its own words", issueCodes({ body: `${goodBody} It's an AI agent.` }).includes("banned_phrase"));
check("gate blocks a paraphrase of what it does", issueCodes({ body: `${goodBody} It reads Chicago correction letters.` }).includes("banned_phrase"));
check("gate blocks an effort promise", issueCodes({ body: `${goodBody} It takes a minute to redact.` }).includes("banned_phrase"));
check("gate blocks a listed fact that wasn't used", issueCodes({ body: goodBody.replace("your two-flat work", "your work").replace("is why I'm writing", "is why I'm writing"), facts_used: ["F2"] }).includes("fact_unused"));
check("gate blocks a name from nowhere", issueCodes({ body: `Hi Matt, ${goodBody}` }).includes("name_unsourced"));
check("gate allows the firm's name", !issueCodes({ body: `Hi Fictional Firm 1, ${goodBody}` }).includes("name_unsourced"));
check("gate blocks an unsourced number", issueCodes({ body: `${goodBody} We've read 40 letters.` }).includes("number_unsourced"));
check("gate blocks a percentage", issueCodes({ body: `${goodBody} It catches 95% of comments.` }).includes("banned_phrase"));
check("gate requires the limits claim", issueCodes({ body: goodBody.replace("{{claim:redline_limits}}", "") }).includes("claim_required_missing"));
check("gate requires the variant's claim", issueCodes({}, v1).includes("claim_variant_missing"));
check("gate blocks an unknown claim", issueCodes({ body: `${goodBody} {{claim:made_up}}` }).includes("claim_unknown"));
check("gate blocks an unknown fact", issueCodes({ facts_used: ["F99"] }).includes("fact_unknown"));
check("a number in a declared fact is fine", (() => {
  const p = { ...prospect, facts: [...prospect.facts, { ...prospect.facts[0], id: "F8", kind: "permit_count", value: "listed on 21 permits" }] };
  return lintDraft({ ...good, body: `${goodBody} The City's data lists you on 21 permits.`, facts_used: ["F8"] }, p, v2, claims).length === 0;
})());
for (const [label, subject] of [
  ["Re:", "Re: Redline correction letter"],
  ["Fwd:", "Fwd: Redline"],
  ["urgency", "Urgent: Redline correction letter"],
  ["their permit", "Your permit correction from Redline"],
  ["the city", "City of Chicago correction letter"],
  ["shouting", "REDLINE correction letters!"],
] as const) {
  check(`gate blocks subject: ${label}`, issueCodes({ subject }).includes("subject_deceptive"), subject);
}
check("the subject must say what it's about", issueCodes({ subject: "A quick question" }).includes("subject_content"));

// ---------- rendering and sender ----------

const rendered = renderMessage({ subject: good.subject, body: good.body, to_email: "info@fictional-firm-1.example", contact_form_url: null, dataset: "test" }, TEST_SENDER, claims);
check("the footer has an ad disclosure", /This email is an advertisement/.test(rendered));
check("the footer has a postal address", rendered.includes(TEST_SENDER.postal_address));
check("the footer has an opt-out", /reply with the word "unsubscribe"/.test(rendered));
check("the footer has the sender", rendered.includes(TEST_SENDER.from_name) && rendered.includes(TEST_SENDER.from_email));
check("test messages are labeled", rendered.includes("FICTIONAL TEST DATA"));
check("claims expand to approved wording", rendered.includes(claims.find((c) => c.id === "redline_limits")!.wording) && !rendered.includes("{{claim"));
check("sources are listed", rendered.includes("Sources: https://"));
check("an optional subject prefix is applied", renderMessage({ subject: "Redline", body: goodBody, to_email: "a@b.example", contact_form_url: null, dataset: "test" }, { ...TEST_SENDER, subject_prefix: "ADV: " }, claims).includes("Subject: ADV: Redline"));
check("expandClaims marks unknown tokens", expandClaims("{{claim:nope}}", claims).includes("UNKNOWN"));
check("a missing sender is blocked", validateSender(null, "real").length > 0);
check("an empty sender is blocked", validateSender({ from_name: "", from_email: "", organization: "", postal_address: "", opt_out_mailbox_monitored: false }, "real").length >= 4);
check("an address without a ZIP is blocked", validateSender({ ...TEST_SENDER, postal_address: "Chicago, IL", from_email: "a@b.co" }, "real").some((i) => i.code === "sender_address"));
check("an unmonitored opt-out is blocked", validateSender({ ...TEST_SENDER, opt_out_mailbox_monitored: false }, "test").some((i) => i.code === "sender_optout"));
check("a fictional sender is blocked in a real home", validateSender(TEST_SENDER, "real").some((i) => i.code === "sender_fictional"));

// ---------- suppression and contact limits ----------

const list = [{ email: "a@x.example", dataset: "test" as const, reason: "unsubscribed", at: "" }, { domain: "blocked.example", dataset: "test" as const, reason: "manual", at: "" }];
check("suppression matches an address", Boolean(isSuppressed({ email: "A@X.example" }, list)));
check("suppression matches a domain through an address", Boolean(isSuppressed({ email: "b@blocked.example" }, list)));
check("suppression matches a domain", Boolean(isSuppressed({ domain: "blocked.example" }, list)));
check("others pass suppression", !isSuppressed({ email: "ok@fine.example" }, list));
{
  const h = home(3);
  const s = loadAll(h);
  check("ready prospects are draftable", draftable(h, s, AS_OF).length === 3);
  const after = { ...s, suppression: [{ domain: "fictional-firm-1.example", dataset: "test" as const, reason: "unsubscribed", at: "" }] };
  check("a suppressed firm isn't draftable", draftable(h, after, AS_OF).length === 2);
  const msg: Message = { id: "TEST-M1", dataset: "test", prospect_id: "TEST-P001", firm_name: "Fictional Firm 1", domain: "fictional-firm-1.example", to_email: "info@fictional-firm-1.example", contact_form_url: null, segment: "architecture_firm", variant_id: V2, variant_sha: "x", playbook_sha: "x", subject: good.subject, body: good.body, claims_used: [], facts_used: [], gate: { status: "pending_review", issues: [], audit: "passed" }, session_id: null, created_at: "" };
  check("a clean test draft can be approved", approvalProblems(h, msg, { ...s, messages: [msg] }).length === 0, approvalProblems(h, msg, { ...s, messages: [msg] }).join("; "));
  check("a suppressed recipient can't be approved", approvalProblems(h, msg, { ...after, messages: [msg] }).some((p) => p.includes("suppression")));
  check("a blocked draft can't be approved", approvalProblems(h, { ...msg, gate: { status: "blocked", issues: [{ severity: "block", code: "x", message: "bad" }], audit: "" } }, { ...s, messages: [msg] }).length > 0);
  const realHome = { ...h, dataset: "real" as const };
  check("unverified claims block approval in a real home", approvalProblems(realHome, { ...msg, dataset: "real" }, { ...s, messages: [msg] }).some((p) => p.includes("verified_by_human")));
  check("test data can't be approved in a real home", approvalProblems(realHome, msg, { ...s, messages: [msg] }).some((p) => p.includes("test data")));
}
{
  const h = home(0);
  const { messages, events } = seedOutcomes(h, [{ variant: V1, sent: 10 }], "2026-10-30T12:00:00.000Z");
  const at = new Date("2026-10-30T23:00:00Z");
  check("the daily limit stops at 10", quota(policy, messages, events, at).remaining === 0);
  check("the next day has room, within the week", quota(policy, messages, events, new Date("2026-10-31T23:00:00Z")).remaining === 10);
  check("a contacted firm can't be contacted again", touchProblem(messages[0].domain, policy, messages, events, at) !== null);
  check("unsent drafts aren't contact", touchProblem("elsewhere.example", policy, messages, events, at) === null);
}
{
  const assigned: Message[] = [];
  const h = home(0);
  const { messages } = seedOutcomes(h, [{ variant: V1, sent: 3 }]);
  assigned.push(...messages.map((m) => ({ ...m, segment: "architecture_firm" as const })));
  const pick = assignVariant(testProspect(50, "architecture_firm"), variants, assigned);
  check("assignment keeps arms balanced", pick?.id === V2, pick?.id);
  check("proposed variants get no traffic", assignVariant(testProspect(51), variants.map((v) => (v.status === "active" ? { ...v, status: "retired" as const } : v)), []) === null);
}

// ---------- research can't invent a contact ----------

const site = "https://fictional-studio.example/contact";
const page: Page = { url: site, html: `<p>Fictional Studio, 12 Example St, Chicago, IL 60601</p><a href="mailto:hello@fictional-studio.example">Write</a><form></form><a href="/about">About</a><a href="/privacy">Privacy</a>`, text: "Fictional Studio, 12 Example St, Chicago, IL 60601. We do two-flat renovations. Reach us at office@fictional-studio.example or logo@2x.png" };
const emails = findEmails(page, "fictional-studio.example", "t");
check("finds emails on the page", emails.some((e) => e.email === "hello@fictional-studio.example") && emails.some((e) => e.email === "office@fictional-studio.example"));
check("ignores image file names", !emails.some((e) => e.email.includes("png")));
check("doesn't construct addresses", !emails.some((e) => e.email.startsWith("info@")));
check("a quote on the page verifies", verifyExtracted({ value: "two-flat renovations", evidence: "We do two-flat renovations", url: site }, "project_fit", [page], "F3", "t") !== null);
check("an invented quote is dropped", verifyExtracted({ value: "coach houses", evidence: "We do coach houses", url: site }, "project_fit", [page], "F3", "t") === null);
check("a value outside its quote is dropped", verifyExtracted({ value: "skyscrapers", evidence: "We do two-flat renovations", url: site }, "project_fit", [page], "F3", "t") === null);
check("a quote from another URL is dropped", verifyExtracted({ value: "two-flat renovations", evidence: "We do two-flat renovations", url: "https://other.example/" }, "project_fit", [page], "F3", "t") === null);
const assemble = (extracted: Parameters<typeof assembleProspect>[0]["extracted"], pages = [page], policyTexts: string[] = [], suppression: Parameters<typeof assembleProspect>[0]["suppression"] = []) =>
  assembleProspect({ seed: { segment: "architecture_firm", website: "https://fictional-studio.example/", found_via: "fixture" }, pages, policyTexts, problems: [], extracted, retrievedAt: "t", dataset: "test", suppression });
const goodExtract = { firm_name: { value: "Fictional Studio", evidence: "Fictional Studio, 12 Example St", url: site }, location: { value: "Chicago, IL", evidence: "Chicago, IL 60601", url: site }, project_fit: [{ value: "two-flat renovations", evidence: "We do two-flat renovations", url: site }] };
const assembled = assemble(goodExtract);
check("a verified firm is ready", assembled.status === "ready", assembled.status_reasons.join("; "));
check("every fact has a source URL", assembled.facts.every((f) => f.source_url.startsWith("https://")));
check("every email has a source URL", assembled.emails.every((e) => e.source_url.startsWith("https://")));
check("an invented email in the extraction can't appear", !JSON.stringify(assemble({ ...goodExtract, principal: { value: "ceo@fictional-studio.example", evidence: "ceo@fictional-studio.example", url: site } }).emails).includes("ceo@"));
check("a dropped fact is reported", assemble({ ...goodExtract, team_size: { value: "12 people", evidence: "We are 12 people", url: site } }).status_reasons.some((r) => r.includes("dropped")));
const noContact: Page = { ...page, html: "<p>hi</p>", text: "Fictional Studio, 12 Example St, Chicago, IL 60601. We do two-flat renovations." };
check("no email and no form means no contact", assemble(goodExtract, [noContact]).status === "no_contact");
check("nothing readable means blocked", assemble(null, []).status === "blocked");
check("a no-solicitation notice excludes the firm", assemble(goodExtract, [page], ["Please do not send unsolicited marketing to this address."]).status === "excluded");
check("address-handling language goes to a person", assemble(goodExtract, [page], ["We will not sell or transfer email addresses to third parties."]).status === "needs_review");
check("a suppressed firm stays excluded", assemble(goodExtract, [page], [], [{ domain: "fictional-studio.example", dataset: "test", reason: "x", at: "" }]).status === "excluded");
check("finds notices", findNotices("No solicitations, please.").length === 1);
check("an ordinary page has no notices", findNotices("We design homes for families.").length === 0);
check("links prefer contact pages", pickLinks(page, 2).read[0].endsWith("/about") && pickLinks(page, 2).policy[0].endsWith("/privacy"));
const named: Page = { ...page, text: "Our principal, Jane Q. Fictional, founded the studio." };
check("a person's name links to the site", permitNameOnSite("FICTIONAL, JANE Q", [named]) !== null);
check("another person's name doesn't", permitNameOnSite("FICTIONAL, ROBERT", [named]) === null);
check("a firm's name links", permitNameOnSite("FICTIONAL STUDIO LLC", [page]) !== null);
check("robots disallow is honored", !robotsAllows("User-agent: *\nDisallow: /contact", "/contact"));
check("robots allow is honored", robotsAllows("User-agent: *\nDisallow: /private", "/contact"));
check("the longest robots rule wins", robotsAllows("User-agent: *\nDisallow: /\nAllow: /contact", "/contact"));
check("our own robots group wins", !robotsAllows("User-agent: *\nAllow: /\n\nUser-agent: RedlineOutreachResearch\nDisallow: /", "/contact"));
check("empty robots allows", robotsAllows("", "/x"));

// ---------- no sending tool, and no stray data ----------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "data" || f === "reports" || f === "tests") return [];
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|json)$/.test(f) ? [p] : [];
  });
}
const code = sourceFiles(OUTREACH_DIR).map((f) => readFileSync(f, "utf8")).join("\n");
check("no mail library or send API in the code", !/nodemailer|smtp|sendmail|sendgrid|mailgun|postmark|amazonaws|\bses\b|twilio|linkedin|gmail\.users|graph\.microsoft/i.test(code));
const lib = readFileSync(join(OUTREACH_DIR, "lib.ts"), "utf8");
check("the agent spec attaches no tools", /mcpServers: \[\]/.test(lib) && /webSearch: \{ enabled: false \}/.test(lib) && /sandbox: \{ enabled: false \}/.test(lib) && /dynamicSubAgents: \{ enabled: false \}/.test(lib));
check("data/ is gitignored", readFileSync(join(OUTREACH_DIR, ".gitignore"), "utf8").includes("data/"));
{
  const h = home(1);
  check("a test home says so", openHome(h.dir).dataset === "test");
  check("test prospects are labeled and fictional", readJsonl<{ dataset: string; domain: string }>(h.prospects).every((p) => p.dataset === "test" && p.domain.endsWith(".example")));
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
