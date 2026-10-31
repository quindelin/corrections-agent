// Saved analyses and what each viewer may see. A report is run before payment, so the server is what keeps
// locked drafts locked: publicView never sends them until the report is unlocked.
// Stored under .cache/, which isn't committed, because a report can hold a client's letter.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "../evals/score.ts";
import { ROOT } from "../scripts/lib.ts";
import type { ParsedComment } from "./parse-letter.ts";

const DIR = join(ROOT, ".cache", "reports");
export const FREE_DRAFTS = 3;

export interface Report {
  id: string;
  created_at: string;
  jurisdiction: string;
  place: string;
  permit_number: string | null;
  project: string;
  comments: ParsedComment[];
  items: Item[];
  session_id: string;
  trace: { name: string; args: string }[];
  unlocked: boolean;
  unlocked_by: "stripe" | "design_partner" | "next_round" | null;
  learning_opt_in: boolean;
  decisions: Record<string, { decision: "approve" | "reject"; note: string; at: string }>;
}

export function newReportId(): string {
  return randomBytes(16).toString("hex");
}

export function saveReport(r: Report): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${r.id}.json`), JSON.stringify(r));
}

export function loadReport(id: string): Report | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const file = join(DIR, `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Report) : null;
}

/** A later round on a permit that's already paid for costs nothing. */
export function permitAlreadyUnlocked(permit: string | null): boolean {
  if (!permit || !existsSync(DIR)) return false;
  return readdirSync(DIR).some((f) => {
    const r = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Report;
    return r.unlocked && r.permit_number === permit;
  });
}

const ROUTE_ORDER = ["licensed_review", "other_agency", "client_input", "agent_draft", "no_action"];
const rank = (route: string) => (ROUTE_ORDER.indexOf(route) + 1 || ROUTE_ORDER.length + 1);

export function publicView(r: Report) {
  const sorted = [...r.items].sort((a, b) => rank(a.route) - rank(b.route));
  // The free drafts show the most useful items: the ones the buyer would otherwise spend the most time on.
  const free = new Set(sorted.filter((i) => i.route !== "no_action" && i.draft.trim()).slice(0, FREE_DRAFTS).map((i) => i.comment));
  const items = sorted.map((i) => {
    const comment = r.comments.find((c) => c.id === i.comment);
    const visible = r.unlocked || free.has(i.comment) || i.route === "no_action";
    return {
      comment: i.comment,
      text: comment?.text ?? "",
      heading: comment?.heading ?? "",
      route: i.route,
      discipline: i.discipline,
      sheets: i.sheets,
      locked: !visible,
      citation: visible ? i.citation : null,
      draft: visible ? i.draft : "",
      decision: r.decisions[i.comment]?.decision ?? null,
    };
  });
  const counts: Record<string, number> = {};
  for (const i of r.items) counts[i.route] = (counts[i.route] ?? 0) + 1;
  return {
    id: r.id,
    place: r.place,
    jurisdiction: r.jurisdiction,
    permit_number: r.permit_number,
    project: r.project,
    unlocked: r.unlocked,
    unlocked_by: r.unlocked_by,
    learning_opt_in: r.learning_opt_in,
    counts,
    items,
    trace: r.unlocked ? r.trace : [],
    session_id: r.session_id,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Word opens this HTML as a document. Marked as a draft until every held item has a professional's approval. */
export function exportDoc(r: Report): string {
  const held = r.items.filter((i) => i.route === "licensed_review" && r.decisions[i.comment]?.decision !== "approve");
  const rows = r.items
    .filter((i) => i.route !== "no_action" && i.draft.trim())
    .map((i) => {
      const c = r.comments.find((x) => x.id === i.comment);
      const state = i.route === "licensed_review" ? (r.decisions[i.comment]?.decision === "approve" ? "" : " <b>[HELD: needs licensed review]</b>") : "";
      return `<p><b>${esc(i.comment)}${i.citation ? ` (${esc(i.citation)})` : ""}.</b> ${esc(c?.text ?? "")}<br><i>Response:</i> ${esc(i.draft)}${state}</p>`;
    })
    .join("\n");
  const banner = held.length ? `<p><b>DRAFT. ${held.length} item(s) still need review by a licensed professional. Do not file.</b></p>` : `<p><b>Draft for the professional of record to review and sign.</b></p>`;
  return `<html><head><meta charset="utf-8"><title>Response to plan review corrections</title></head><body><h1>Response to plan review corrections</h1><p>${esc(r.place)}${r.permit_number ? `, permit ${esc(r.permit_number)}` : ""}</p>${banner}${rows}</body></html>`;
}
