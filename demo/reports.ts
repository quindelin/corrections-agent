// Saved analyses and what each viewer may see. A report is run before payment, so the server is what keeps
// locked drafts locked: publicView never sends them until the report is unlocked.
// A report can hold a client's letter, so it's kept only for the retention limit. See store.ts for where it's kept.

import { randomBytes } from "node:crypto";
import type { Item } from "../evals/score.ts";
import type { GuardFlag } from "./guard.ts";
import type { ParsedComment } from "./parse-letter.ts";
import { getStore } from "./store.ts";

export const FREE_DRAFTS = 3;

export interface Report {
  id: string;
  created_at: string;
  jurisdiction: string;
  place: string;
  permit_number: string | null;
  project: string;
  comments: ParsedComment[];
  /** Reports saved before the guard existed have no flags. */
  items: (Item & { flags?: GuardFlag[]; agent_route?: string })[];
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

export async function createReport(r: Report): Promise<void> {
  await (await getStore()).createReport(r);
}

export async function loadReport(id: string): Promise<Report | null> {
  return (await getStore()).getReport(id);
}

/** Changes go through here so they apply to the latest version. Null if the report is gone. Change can run more than once. */
export async function updateReport(id: string, change: (current: Report) => Report): Promise<Report | null> {
  return (await getStore()).updateReport(id, change);
}

/** Deletes a report now, ahead of the retention limit. True if there was one. */
export async function deleteReport(id: string): Promise<boolean> {
  return (await getStore()).deleteReport(id);
}

/**
 * A later round is free only with proof: the id of an unlocked report on the same permit, which only someone with that
 * report's link has. A typed permit number alone proves nothing, because permit numbers are public records.
 */
export function earnsFreeRound(prior: Report | null, permit: string | null): boolean {
  return Boolean(permit && prior?.unlocked && prior.permit_number === permit);
}

/** Whether a permit has any unlocked report. Used to re-lock free rounds after a refund, not to grant them. */
export async function permitAlreadyUnlocked(permit: string | null): Promise<boolean> {
  return permit ? (await getStore()).permitUnlocked(permit) : false;
}

const ROUTE_ORDER = ["licensed_review", "other_agency", "client_input", "agent_draft", "no_action"];
const rank = (route: string) => (ROUTE_ORDER.indexOf(route) + 1 || ROUTE_ORDER.length + 1);

/** A locked item shows why it's held, but nothing that would give away the draft or citation. */
const flagsFor = (flags: GuardFlag[] | undefined, visible: boolean): GuardFlag[] =>
  visible ? (flags ?? []) : (flags ?? []).filter((f) => f.rule === "route_forced").map(({ rule, action, level, message }) => ({ rule, action, level, message }));

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
      flags: flagsFor(i.flags, visible),
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
  // A professional's approval settles the flags, so they don't have to be deleted from an approved response.
  const open = (i: Report["items"][number]) => (r.decisions[i.comment]?.decision === "approve" ? [] : (i.flags ?? []));
  const flagNotes = (i: Report["items"][number]) => open(i).map((f) => `<br><small>${f.level === "review" ? "<b>Check:</b>" : "Note:"} ${esc(f.message)}</small>`).join("");
  const rows = r.items
    // A held item with no draft stays in the document, or it would look answered.
    .filter((i) => i.route !== "no_action" && (i.draft.trim() || open(i).some((f) => f.level === "review")))
    .map((i) => {
      const c = r.comments.find((x) => x.id === i.comment);
      const state = i.route === "licensed_review" ? (r.decisions[i.comment]?.decision === "approve" ? "" : " <b>[HELD: needs licensed review]</b>") : "";
      return `<p><b>${esc(i.comment)}${i.citation ? ` (${esc(i.citation)})` : ""}.</b> ${esc(c?.text ?? "")}<br><i>Response:</i> ${i.draft.trim() ? esc(i.draft) : "<i>No draft yet.</i>"}${state}${flagNotes(i)}</p>`;
    })
    .join("\n");
  const toCheck = r.items.filter((i) => i.route !== "no_action" && open(i).some((f) => f.level === "review")).length;
  const checkLine = toCheck ? `<p><b>${toCheck} item(s) have something to check, marked "Check" below. Resolve them and delete the notes before filing.</b></p>` : "";
  const banner = (held.length ? `<p><b>DRAFT. ${held.length} item(s) still need review by a licensed professional. Do not file.</b></p>` : `<p><b>Draft for the professional of record to review and sign.</b></p>`) + checkLine;
  return `<html><head><meta charset="utf-8"><title>Response to plan review corrections</title></head><body><h1>Response to plan review corrections</h1><p>${esc(r.place)}${r.permit_number ? `, permit ${esc(r.permit_number)}` : ""}</p>${banner}${rows}</body></html>`;
}
