// The playbook: one general file plus one file per place, each holding rules in a JSON block.
// The split is the point. A shared rule that only suited one city caused a real regression in this repo, and an earlier
// self-improvement run deleted another city's rule. So the model never edits these files as text: it proposes changes,
// scope.ts decides what's allowed, and code writes the files. A draft only ever sees general rules plus its own place's.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Home, sha, writeText } from "./lib.ts";

export type RuleKind = "principle" | "hypothesis" | "observation" | "learned";
export type RuleStatus = "active" | "proposed" | "retired";

export interface Rule {
  id: string;
  scope: string; // "general" or a place id
  kind: RuleKind;
  status: RuleStatus;
  locked?: boolean;
  text: string;
  based_on: string[];
  /** Machine-checkable claim: every cited request must show this. */
  claim?: Claim | null;
  /** Written by code, never by the model. */
  tally?: string | null;
  source: string;
  added: string;
  spotcheck?: { verdict: "true" | "false" | "unclear"; at: string; note: string } | null;
  retired_reason?: string | null;
  source_url?: string | null;
}

export type Claim = "usable" | "no_usable" | "denied" | "fee_quoted" | "responded" | "no_response" | "narrowed_then_usable" | `exemption:${string}`;

const RULES_RE = /<!-- rules:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- rules:end -->/;
const STANDING_RE = /<!-- standing:start -->[\s\S]*?<!-- standing:end -->/;

export const playbookPath = (h: Home, scope: string) => join(h.playbook, `${scope}.md`);

export function listScopes(h: Home): string[] {
  if (!existsSync(h.playbook)) return [];
  return readdirSync(h.playbook).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
}

export function parseRules(text: string): Rule[] {
  const m = text.match(RULES_RE);
  if (!m) throw new Error("The playbook file has no rules block.");
  return JSON.parse(m[1]) as Rule[];
}

export function readRules(h: Home, scope: string): Rule[] {
  const path = playbookPath(h, scope);
  return existsSync(path) ? parseRules(readFileSync(path, "utf8")) : [];
}

export function allRules(h: Home): Rule[] {
  return listScopes(h).flatMap((s) => readRules(h, s));
}

export function writeRules(h: Home, scope: string, rules: Rule[], standing: string): void {
  const path = playbookPath(h, scope);
  const text = readFileSync(path, "utf8")
    .replace(RULES_RE, () => `<!-- rules:start -->\n\`\`\`json\n${JSON.stringify(rules, null, 2)}\n\`\`\`\n<!-- rules:end -->`)
    .replace(STANDING_RE, () => `<!-- standing:start -->\n${standing.trim()}\n<!-- standing:end -->`);
  writeText(path, text);
}

/** What a draft for this place may use: active rules from the general file and this place's file, and nothing from any other place. */
export function rulesForDraft(h: Home, place: string): Rule[] {
  return [...readRules(h, "general"), ...readRules(h, place)].filter((r) => r.status === "active");
}

export function playbookSha(h: Home, place: string): string {
  const read = (s: string) => (existsSync(playbookPath(h, s)) ? readFileSync(playbookPath(h, s), "utf8") : "");
  return sha(read("general") + read(place)).slice(0, 12);
}

export function nextRuleId(rules: Rule[], scope: string): string {
  const prefix = scope === "general" ? "G" : scope.toUpperCase();
  const numbers = rules.map((r) => Number(r.id.match(/-(\d+)$/)?.[1] ?? 0));
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}
