// Removes personal details from letter text before it is kept: reviewer names, emails and phone numbers.
// Patterns come from Seattle's Plan Comments text, where these details are often glued to the words around them,
// such as "Author: <name> Layer: Review CommentThe plans..." or "...the plans.<FirstLast> (5)".
//
// This is a safeguard, not a guarantee. A name in free prose with no label or nearby cue stays in the text.
// Project addresses stay, because the agent needs them to answer the comment.

const KNOWN_TLD = String.raw`(?:gov|com|org|net|edu|us)`;
// Known endings first, so "name@seattle.govZoning" loses the address and keeps "Zoning".
// A line wrap in the letter can leave a space inside either one, so those allow it where wraps fall.
const EMAIL = new RegExp(String.raw`[\w.+-]+\s?@\s?(?:(?:[a-z0-9-]+\.\s?)+${KNOWN_TLD}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)`, "gi");
const PHONE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\b\d{3}[-.\s]\s?)\d{3}[-.\s]\s?\d(?:\s?\d){3}\b(?:\s?(?:x|ext\.?)\s?\d{1,5}\b)?/gi;

// A person's name as it appears after a label. Capitalized words only, so "Reviewer: this bldg" is left alone.
const WORD = String.raw`[A-Z][a-zA-Z'’-]+`;
const FULL_NAME = String.raw`${WORD}(?:\s+[A-Z]\.)?(?:\s+${WORD}){1,2}`;
const LABELLED = new RegExp(String.raw`\b((?:SDCI\s+)?(?:Plans?\s+)?(?:Reviewer|Examiner|Inspector|Prepared by|Reviewed by)\s*:\s*)${FULL_NAME}`, "g");
const SIGNED = new RegExp(String.raw`\b(Sincerely|Regards|Respectfully|Thank you|Thanks)(,?\s+)${FULL_NAME}`, "g");
// Case-sensitive on purpose: with the i flag, "contact the reviewer" and "call out the inverts" would count as names.
const CONTACT = new RegExp(String.raw`\b([Cc]ontact|[Cc]ontacting|[Cc]all|[Ee]-?mail|[Ss]peak (?:with|to)|[Rr]each out to)(\s+)(${FULL_NAME})`, "g");
// Organizations that follow "contact" just as names do.
const NOT_A_PERSON = /^(Seattle|King|Urban|Electrical|WDFW|SDCI|SDOT|SPU|City|Public|Department|Washington|Puget|Fire|Land|Plan|Building|Applicant|Owner|Design|Structural|Civil|Geotechnical|The|Your)\b/;

// The label is required in the field, so "Author:" in a sentence about authorship can't trigger on an ordinary word.
const AUTHOR_LINE = /\bAuthor:\s*(.+?)(?=\s+Layer:|\s+Date:|\s+Status:|\s*$)/gm;
const LABELLED_NAME = new RegExp(String.raw`\b(?:Reviewer|Examiner|Inspector)\s*:\s*(${FULL_NAME})`, "g");

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matches a heading however its spaces and dashes were extracted: "Zoning - SMC 23.44" and "Zoning – SMC 23.44".
const flexible = (s: string) => escapeRegExp(s).replace(/\s+/g, String.raw`\s+`).replace(/[-–—]/g, "[-–—]");

/** Names the letter itself labels as people, so they can also be removed where they appear without a label. */
export function collectNames(raw: string): string[] {
  const names = new Set<string>();
  for (const m of raw.matchAll(AUTHOR_LINE)) names.add(m[1].trim());
  for (const m of raw.matchAll(LABELLED_NAME)) names.add(m[1].trim());
  const out = new Set<string>();
  for (const name of names) {
    if (name.length < 4 || NOT_A_PERSON.test(name)) continue;
    out.add(name);
    if (/\s/.test(name)) out.add(name.replace(/\s+/g, "")); // headings glue them: "SamSample"
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Removes emails, phones, labelled names, and any name given in `names`. Leaves the rest of the text as it was. */
export function stripPersonal(text: string, names: string[] = []): string {
  let out = text
    .replace(/\bAuthor:\s*.+?\s+Layer:\s*/g, "Layer: ") // the metadata the parser removes; a safeguard for text that skips it
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, "[phone removed]")
    .replace(LABELLED, "$1[name removed]")
    .replace(SIGNED, "$1$2[name removed]")
    .replace(CONTACT, (whole, verb: string, gap: string, name: string) => (NOT_A_PERSON.test(name) ? whole : `${verb}${gap}[name removed]`));
  for (const name of names) {
    out = out.replace(new RegExp(String.raw`(^|[^\w])${flexible(name)}(?![\w])`, "g"), "$1[name removed]");
  }
  return out;
}

// Words that end a real sentence with a number in parentheses, such as "see Table (1)". Not headings.
const NOT_A_HEADING = /^(See|Table|Section|Sections|Note|Notes|Figure|Fig|Detail|Sheet|Item|Items|Exception|Option|Per|Code|Chapter|Part|Article|Appendix|Type|Class|Group|Zone|Level|Phase|Step)\b/;
// Must follow the end of a sentence, or be glued to the last word, so a clause reference ending a sentence survives.
// Some extraction leaves only the count: "...in the plan set.  (1)"
const BARE_COUNT = /(?<=[.!?:;)\]"'’”])\s*\(\d{1,3}\)\s*$/;
const NAME_TAIL = /(?:^|(?<=[.!?:;)\]"'’”]\s*)|(?<=[a-z0-9]))((?:[A-Z][a-zA-Z'’-]+\d?\s?){1,3})\s*\(\d{1,3}\)\s*$/;

/**
 * Letters group comments under a heading with a count, such as "Drainage (16)" or a reviewer's name, and extraction can
 * glue that heading to the end of the comment before it. `known` is headings the letter itself shows to be headings.
 */
export function stripTrailingHeading(text: string, known: string[] = []): string {
  let out = text.trimEnd();
  for (const heading of known) {
    if (!heading.trim()) continue;
    const re = new RegExp(String.raw`\s*${flexible(heading.trim())}\s*\(\d{1,3}\)\s*$`, "i");
    if (re.test(out)) return out.replace(re, "").trimEnd();
  }
  if (BARE_COUNT.test(out)) return out.replace(BARE_COUNT, "").trimEnd();
  const m = out.match(NAME_TAIL);
  if (m && !NOT_A_HEADING.test(m[1])) out = out.slice(0, m.index).trimEnd();
  return out;
}
