// Splits a pasted correction letter into comments. Real letters number their comments in many ways,
// so this looks for repeated numbering first, then falls back to paragraphs. The user checks the split before running.

const MARKER = /^\s*(?:(?:comment|correction|item)\s*)?(?:#|no\.?\s*)?(?:C-?)?(\d{1,3})\s*(?:[.):\-–]\s+|\s+(?=[A-Z]))/i;

export const MAX_LETTER_CHARS = 30000;
export const MAX_COMMENTS = 40;

export interface ParsedComment {
  id: string;
  heading: string;
  text: string;
}

// Bluebeam markup summaries, which real letters often are: each comment is a block of metadata lines, then its text.
const MARKUP_FIELD = /^(Page Index|Page Label|Author|X|Y|Layer|Date|Status|Color|Space|Review Type|Checkmark|Comments):/i;
const GROUP_HEADING = /^.{0,80}\(\d+\)$/;
const BOILERPLATE = /^(Seattle Department of Construction|700 (Fifth|5th) Ave|An equal employment opportunity|Responding to Review Comments|You can upload corrected plans|To respond to comments:|\d\. (Provide a response to each comment|Make sure drawings are)|See How to Respond)/i;

function parseMarkupSummary(lines: string[]): ParsedComment[] | null {
  if (lines.filter((l) => /^Subject:/i.test(l.trim())).length < 1 || !lines.some((l) => /^(Review Type|Layer):/i.test(l.trim()))) return null;
  const blocks: { subject: string; lines: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const subject = line.match(/^Subject:\s*(.*)$/i);
    if (subject) blocks.push({ subject: subject[1].trim(), lines: [] });
    else if (blocks.length && line && !MARKUP_FIELD.test(line) && !GROUP_HEADING.test(line) && !BOILERPLATE.test(line)) blocks[blocks.length - 1].lines.push(line);
  }
  const found = blocks.filter((b) => b.lines.length);
  return found.slice(0, MAX_COMMENTS).map((b, i) => ({ id: `C${i + 1}`, heading: b.subject || "Comment", text: clean(b.lines) }));
}

const clean = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ").trim();
const asComments = (parts: string[]): ParsedComment[] =>
  parts.slice(0, MAX_COMMENTS).map((text, i) => ({ id: `C${i + 1}`, heading: "Pasted", text }));

export function parseLetter(raw: string): ParsedComment[] {
  const lines = raw.slice(0, MAX_LETTER_CHARS).replace(/\r\n?/g, "\n").split("\n");

  const markup = parseMarkupSummary(lines);
  if (markup) return markup;

  // Numbered comments count only if the numbers mostly run in order, so a stray "2 stories" doesn't split a comment.
  const parts: string[] = [];
  let current: string[] | null = null;
  let expected = 1;
  let matched = 0;
  for (const line of lines) {
    const m = line.match(MARKER);
    if (m && (Number(m[1]) === expected || (matched === 0 && Number(m[1]) <= 2))) {
      if (current) parts.push(clean(current));
      current = [line.slice(m[0].length)];
      expected = Number(m[1]) + 1;
      matched++;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) parts.push(clean(current));
  if (matched >= 2) return asComments(parts.filter(Boolean));

  const paragraphs = raw
    .slice(0, MAX_LETTER_CHARS)
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 20);
  return asComments(paragraphs);
}
