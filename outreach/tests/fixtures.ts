// FICTIONAL TEST DATA. Every firm, address and outcome here is invented, uses a reserved .example domain, and carries
// dataset: "test". None of it describes a real business or a real response.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendJsonl, gitIn, type Home, type Message, openHome, OUTREACH_DIR, type OutreachEvent, type Prospect, type Segment, type Sender, sha, type Suppression } from "../lib.ts";

export const TEST_SENDER: Sender = {
  from_name: "Test Sender (fictional)",
  from_email: "test-sender@redline-outreach.example",
  organization: "Fictional Test Org",
  postal_address: "100 Example Street, Testville, IL 00000",
  opt_out_mailbox_monitored: true,
};

export function testProspect(n: number, segment: Segment = n % 2 ? "architecture_firm" : "permit_expediter"): Prospect {
  const domain = `fictional-firm-${n}.example`;
  const url = `https://${domain}/`;
  const at = "2026-09-01T12:00:00.000Z";
  return {
    id: `TEST-P${String(n).padStart(3, "0")}`,
    dataset: "test",
    segment,
    firm_name: `Fictional Firm ${n}`,
    domain,
    website: url,
    facts: [
      { id: "F1", kind: "firm_name", value: `Fictional Firm ${n}`, source_url: url, retrieved_at: at, evidence: `Fictional Firm ${n}`, verification: "verbatim_on_page" },
      { id: "F2", kind: "location", value: "Chicago, IL", source_url: url, retrieved_at: at, evidence: "Our fictional office is in Chicago, IL", verification: "verbatim_on_page" },
      { id: "F3", kind: "project_fit", value: segment === "architecture_firm" ? "two-flat renovations and coach houses" : "permit expediting for two-flat renovations", source_url: url, retrieved_at: at, evidence: "We focus on two-flat renovations and coach houses", verification: "verbatim_on_page" },
    ],
    emails: [{ email: `info@${domain}`, source_url: url, evidence: `info@${domain}`, retrieved_at: at, on_site_domain: true, role_address: true }],
    to_email: `info@${domain}`,
    contact_form_url: null,
    status: "ready",
    status_reasons: [],
    researched_at: at,
  };
}

/** A scratch home holding fictional data, in its own git repo, so learn can show a real diff without touching this repo. */
export function initTestHome(dir: string, prospects = 6): Home {
  if (existsSync(join(dir, "data", "DATASET"))) throw new Error(`${dir} is already a test home.`);
  mkdirSync(join(dir, "data"), { recursive: true });
  cpSync(join(OUTREACH_DIR, "agent"), join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "data", "DATASET"), "test\n");
  writeFileSync(join(dir, "data", "sender.json"), JSON.stringify(TEST_SENDER, null, 2));
  writeFileSync(join(dir, ".gitignore"), "data/\n");
  writeFileSync(join(dir, "README.md"), "Scratch home holding FICTIONAL TEST DATA. Nothing here describes a real firm or a real response.\n");
  const h = openHome(dir);
  for (let i = 1; i <= prospects; i++) appendJsonl(h.prospects, testProspect(i));
  gitIn(dir, "init", "-q");
  gitIn(dir, "add", ".");
  gitIn(dir, "-c", "user.name=Outreach Test", "-c", "user.email=outreach-test@redline-outreach.example", "commit", "-q", "-m", "baseline (fictional test home)");
  gitIn(dir, "config", "user.name", "Outreach Test");
  gitIn(dir, "config", "user.email", "outreach-test@redline-outreach.example");
  console.log(`✓ Test home at ${dir} with ${prospects} fictional prospects.`);
  return h;
}

export interface ArmPlan {
  variant: string;
  sent: number;
  replied?: number;
  positive?: number;
  bounced?: number;
  unsubscribed?: number;
}

/** Writes synthetic sent messages and outcomes straight to a test home's log. No model calls. */
export function seedOutcomes(h: Home, plans: ArmPlan[], sentAt = "2026-09-01T15:00:00.000Z", offset = 1000): { messages: Message[]; events: OutreachEvent[] } {
  if (h.dataset !== "test") throw new Error("seedOutcomes only writes to a test home.");
  const messages: Message[] = [];
  const events: OutreachEvent[] = [];
  let n = offset;
  plans.forEach((plan) => {
    for (let i = 0; i < plan.sent; i++) {
      n += 1;
      const segment: Segment = i % 2 ? "permit_expediter" : "architecture_firm";
      const p = testProspect(n, segment);
      const id = `TEST-M${n}`;
      const message: Message = {
        id,
        dataset: "test",
        prospect_id: p.id,
        firm_name: p.firm_name,
        domain: p.domain,
        to_email: p.to_email,
        contact_form_url: null,
        segment,
        variant_id: plan.variant,
        variant_sha: "fixture",
        playbook_sha: "fixture",
        subject: "Redline test",
        body: "fictional",
        claims_used: [],
        facts_used: [],
        gate: { status: "pending_review", issues: [], audit: "fixture" },
        session_id: null,
        created_at: sentAt,
      };
      const at = new Date(new Date(sentAt).getTime() + i * 60_000).toISOString();
      const base = { dataset: "test" as const, message_id: id };
      const list: OutreachEvent[] = [{ ...base, type: "approved", at, rendered_sha: "fixture" }, { ...base, type: "sent", at }];
      const pos = plan.positive ?? 0;
      const rep = plan.replied ?? pos;
      const bou = plan.bounced ?? 0;
      const uns = plan.unsubscribed ?? 0;
      if (i < pos) list.push({ ...base, type: "positive", at });
      else if (i < rep) list.push({ ...base, type: "replied", at });
      else if (i < rep + bou) list.push({ ...base, type: "bounced", at });
      else if (i < rep + bou + uns) list.push({ ...base, type: "unsubscribed", at });
      messages.push(message);
      events.push(...list);
      appendJsonl(h.messages, message);
      for (const e of list) appendJsonl(h.events, e);
      if (list.some((e) => e.type === "unsubscribed" || e.type === "bounced")) {
        appendJsonl(h.suppression, { email: p.to_email ?? undefined, domain: p.domain, dataset: "test", reason: "fixture", at } satisfies Suppression);
      }
    }
  });
  return { messages, events };
}

export const fixtureSha = (s: string) => sha(s).slice(0, 8);
