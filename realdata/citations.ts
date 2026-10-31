// Finding, hiding and normalizing code citations in real correction comments.
// Reviewers write the same section many ways ("SMC 23.44.041.B", "SRC Table R302.1(1)"),
// so everything is compared at section level, with the chapter as a partial match.

const FAMILIES = "SMC|SBC|SRC|SEC|SFC";
const FAMILY_CITE = new RegExp(`\\b(${FAMILIES})\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*([A-Z]?\\d[\\w.\\-()]*)`, "gi");

// Everything that could give the citation away, including forms with no code name in front.
const MASKS = [
  new RegExp(`\\b(?:${FAMILIES}|SEBC|IRC|IBC|WSEC|WAC|RCW)\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*[A-Z]?\\d[\\w.\\-()]*`, "gi"),
  /\b(?:Section|Sec\.|§)\s*R?\d+\.\d[\d.]*\w*/gi,
  /\b\d{2}\.\d{2}\.\d{3}(?:\.[A-Z0-9]+)*\b/g,
  /\bTable\s+R?\d+\.\d[\w.()]*/gi,
  /\bR\d{3}(?:\.\d+)*\b/g,
];

export const MASK_TOKEN = "[code reference removed]";

/** Section-level id: SMC 23.44.041.B → SMC 23.44.041; SRC R302.1(1) → SRC R302; SBC 1011.5 → SBC 1011. */
export function normalize(raw: string): string | null {
  const m = raw.trim().match(new RegExp(`^(${FAMILIES})\\b[\\s:,.\\-]*(?:Section|Sec\\.?|§|Table|Chapter)?\\s*([A-Z]?\\d[\\w.\\-()]*)`, "i"));
  if (!m) return null;
  const family = m[1].toUpperCase();
  const body = m[2].toUpperCase().replace(/[.\-]+$/, "");
  if (family === "SMC") {
    const parts = body.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{3}))?/);
    return parts ? `SMC ${parts.slice(1).filter(Boolean).join(".")}` : null;
  }
  const section = body.match(/^([A-Z]?\d{3,4})/);
  return section ? `${family} ${section[1]}` : null;
}

/** The chapter above a section: SMC 23.44.041 → SMC 23.44; SRC R302 → SRC R3; SBC 1011 → SBC 10. */
export function parent(id: string): string {
  const [family, body] = id.split(" ");
  if (family === "SMC") return `SMC ${body.split(".").slice(0, 2).join(".")}`;
  const digits = body.replace(/^[A-Z]/, "");
  const letter = body.match(/^[A-Z]/)?.[0] ?? "";
  return `${family} ${letter}${digits.length >= 4 ? digits.slice(0, 2) : digits.slice(0, 1)}`;
}

export function findCitations(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(FAMILY_CITE)) {
    const id = normalize(m[0]);
    if (id) found.add(id);
  }
  return [...found];
}

export function maskCitations(text: string): string {
  return MASKS.reduce((t, re) => t.replace(re, MASK_TOKEN), text);
}

/** Removes contact details. These are public records, but the agent has no use for them. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
}
