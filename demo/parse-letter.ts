// Splits a pasted correction letter into comments. Real letters number their comments in many ways,
// so this looks for repeated numbering first, then falls back to paragraphs. The user checks the split before running.
// Personal details are stripped here, so every route that keeps a parsed comment gets clean text.

import { collectNames, stripPersonal, stripTrailingHeading } from "./strip-personal.ts";

const MARKER = /^\s*(?:(?:comment|correction|item)\s*)?(?:#|no\.?\s*)?(?:C-?)?(\d{1,3})\s*(?:[.):\-–]\s+|\s+(?=[A-Z]))/i;

export const MAX_LETTER_CHARS = 30000;
export const MAX_COMMENTS = 40;

export interface ParsedComment {
  id: string;
  heading: string;
  text: string;
}

export interface ParsedLetter {
  comments: ParsedComment[];
  /** What was cut to fit the limits, so the user can be told instead of losing comments silently. */
  truncated: { chars: boolean; comments: boolean };
}

// Bluebeam markup summaries, which real letters often are: each comment is a block of metadata lines, then its text.
// Short fields only: a long line that starts "Status:" or "Space:" is a sentence in a comment.
const SHORT_FIELD = /^(Page Index|Page Label|X|Y|Layer|Date|Status|Color|Space|Review Type|Checkmark):/i;
const SHORT_FIELD_MAX = 60;
const BOILERPLATE = /^(Seattle Department of Construction|700 (Fifth|5th) Ave|An equal employment opportunity|Responding to Review Comments|You can upload corrected plans|To respond to comments:|\d\. (Provide a response to each comment|Make sure drawings are)|See How to Respond)/i;
const HEADING_LINE = /^(.{1,80}?)\s*\(\d{1,3}\)$/;
// Extraction can put metadata and the comment on one line: "Author: <name> Layer: Review CommentThe plans..."
const GLUED_METADATA = /^(?:Author:\s*.*?\s*)?Layer:\s*Review Comment/i;

/** The comment text on a line of a markup summary, or null if the line holds only metadata. */
function markupLineText(line: string, headings: Set<string>): string | null {
  if (!line || BOILERPLATE.test(line)) return null;
  if (GLUED_METADATA.test(line)) return line.replace(GLUED_METADATA, "").trim() || null;
  if (/^Author:/i.test(line)) return null;
  const comments = line.match(/^Comments:\s*(.*)$/i);
  if (comments) return comments[1].trim() || null;
  if (SHORT_FIELD.test(line) && line.length <= SHORT_FIELD_MAX) return null;
  // "Zoning (5)" is a group heading. "...per SMC 23.45.518.B (3)" is the last line of a comment, so it must stay.
  const heading = line.match(HEADING_LINE);
  if (heading && headings.has(heading[1].toLowerCase())) return null;
  return line;
}

/** Headings this letter shows to be headings: its subjects, review types and authors. */
function letterHeadings(lines: string[]): string[] {
  const found = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    const field = line.match(/^(?:Subject|Review Type):\s*(.+)$/i) ?? line.match(/^Author:\s*(.+?)(?=\s+Layer:|$)/i);
    if (field) found.add(field[1].trim());
  }
  return [...found].sort((a, b) => b.length - a.length);
}

function parseMarkupSummary(lines: string[]): ParsedComment[] | null {
  const trimmed = lines.map((l) => l.trim());
  if (!trimmed.some((l) => /^Subject:/i.test(l)) || !trimmed.some((l) => /^Review Type:|\bLayer:/i.test(l))) return null;
  const known = new Set(letterHeadings(lines).map((h) => h.toLowerCase()));
  const blocks: { subject: string; lines: string[] }[] = [];
  for (const line of trimmed) {
    const subject = line.match(/^Subject:\s*(.*)$/i);
    if (subject) {
      blocks.push({ subject: subject[1].trim(), lines: [] });
      continue;
    }
    if (!blocks.length) continue;
    const text = markupLineText(line, known);
    if (text) blocks[blocks.length - 1].lines.push(text);
  }
  return blocks.filter((b) => b.lines.length).map((b, i) => ({ id: `C${i + 1}`, heading: b.subject || "Comment", text: clean(b.lines) }));
}

const clean = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ").trim();
const asComments = (parts: string[]): ParsedComment[] => parts.map((text, i) => ({ id: `C${i + 1}`, heading: "Pasted", text }));

function split(lines: string[], normalized: string): ParsedComment[] {
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

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 20);
  return asComments(paragraphs);
}

export function parseLetterDetailed(raw: string): ParsedLetter {
  const normalized = raw.slice(0, MAX_LETTER_CHARS).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const names = collectNames(raw.replace(/\r\n?/g, "\n"));
  const headings = letterHeadings(lines);
  const all = split(lines, normalized)
    .map((c) => ({ ...c, heading: stripPersonal(c.heading, names), text: stripPersonal(stripTrailingHeading(c.text, headings), names).trim() }))
    .filter((c) => c.text);
  return {
    comments: all.slice(0, MAX_COMMENTS).map((c, i) => ({ ...c, id: `C${i + 1}` })),
    truncated: { chars: raw.length > MAX_LETTER_CHARS, comments: all.length > MAX_COMMENTS },
  };
}

export function parseLetter(raw: string): ParsedComment[] {
  return parseLetterDetailed(raw).comments;
}
