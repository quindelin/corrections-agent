// Where one place's real letters, runs and citation rules live. Seattle keeps the paths and parser it was built with.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/lib.ts";
import { citationsFor, findCitations, maskCitations, normalize, parent, type Citations, type CitationStyle } from "./citations.ts";

export interface Place {
  id: string;
  name: string;
  lettersFile: string;
  runsDir: string;
  citations: Citations;
  codeIds: Set<string>;
  /** Words that mark a rule as belonging to this place, so they can't land in the shared playbook. */
  localTerms: RegExp | null;
}

const cache = new Map<string, Place>();

export function loadPlace(id: string): Place {
  const hit = cache.get(id);
  if (hit) return hit;
  const pack = join(ROOT, "jurisdictions", id);
  if (!existsSync(join(pack, "code.json"))) throw new Error(`No jurisdiction pack for "${id}".`);
  const profile = JSON.parse(readFileSync(join(pack, "profile.json"), "utf8")) as { name: string; hints?: string[] };
  const codeIds = new Set((JSON.parse(readFileSync(join(pack, "code.json"), "utf8")).sections as { id: string }[]).map((s) => s.id));
  const seattle = id === "seattle";
  const styleFile = join(pack, "citations.json");
  let citations: Citations = { find: findCitations, mask: maskCitations, normalize, parent };
  let localTerms: RegExp | null = null;
  if (existsSync(styleFile)) {
    const style = JSON.parse(readFileSync(styleFile, "utf8")) as CitationStyle;
    citations = citationsFor(style);
    const terms = [...(profile.hints ?? []), ...style.families.filter((f) => f.kind.endsWith("municipal") || f.kind === "model").map((f) => f.code)];
    if (terms.length) localTerms = new RegExp(`\\b(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
  }
  const place: Place = {
    id,
    name: profile.name,
    lettersFile: join(ROOT, "realdata", id, "letters.json"),
    runsDir: seattle ? join(ROOT, "runs-real") : join(ROOT, "runs-real", id),
    citations,
    codeIds,
    localTerms,
  };
  cache.set(id, place);
  return place;
}
