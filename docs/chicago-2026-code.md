# Indexing Chicago's 2026 code changes

Checked 2026-10-31. This is not legal advice.

**Short answer:** the 2026 ordinance does not renumber Title 14B. It amends 14B section by section, on the same 2018 IBC base. Numbering changes where whole titles are replaced: 14M, 14G and 14N. The ordinance text is public on the City Clerk's site, but it contains only Chicago's changes. Reading the full code still takes the ICC model code text, which we can't copy.

**This corrects our earlier notes.** `profile.json` and `docs/locale-research.md` described the 2026 Ordinance as aligned with 2024 model codes, based on a trade group's summary. That holds for mechanical, fuel gas and energy, and in part for fire. It does not hold for the building code.

## What I read

The primary source is the [signed ordinance SO2026-0024930](https://occprodstoragev1.blob.core.usgovcloudapi.net/matterattachmentspublic/a47c8854-8909-416a-a00b-b8280d80053d.pdf) (332 PDF pages), linked from the [City Clerk's record](https://api.chicityclerkelms.chicago.gov/matter/A27ACB7B-F538-F111-88B3-001DD80B0E39). I extracted the text with OCR, which drops underlines and strikethroughs. I checked PDF pages 310 and 325 to 327 by eye. `code-2026.json` marks every entry either way.

## What changes, by title

| Title | What the ordinance does | Base after the change | Dates in Article VI |
|---|---|---|---|
| **14M** Mechanical | Repeals and replaces | 2024 IMC | October 1, 2026; required for applications from December 1, 2026 (14A-1-105.8) |
| **14G** Fuel Gas | Repeals and replaces | 2024 IFGC | October 1, 2026; required from December 1, 2026 (14A-1-105.7) |
| **14N** Energy Transformation | Repeals and replaces | 2024 IECC, commercial and residential | October 1, 2026; required from December 1, 2026 (14A-1-105.9) |
| **18-28, 18-36** | Repeals both chapters | Not applicable | December 1, 2026 |
| **14F** Interim Fire Prevention | Amends; replaces 10 chapters, amends 14F-13, adds 14F-80 | Partial 2024 IFC, up from 2018 | Upon passage and approval |
| **14A** Administrative | Amends and adds sections | Not model-based | Upon passage and approval |
| **14B** Building | Amends sections only | 2018 IBC is unchanged by this ordinance | Article IV: upon passage and approval, except 14B-9-913 and 14B-9-915 (October 1). Article V: October 1 |
| **14R, 14X** | Amend sections | 14R: IEBC edition not checked | Mostly upon passage and approval; 14R-10-1000 October 1 |
| **17-17, 18-29** | Amend sections | Not applicable | Upon passage and approval |

## What happens to section numbers

- **14M and 14G:** the form is `14M-[IMC chapter]-[IMC section]` and `14G-[IFGC chapter]-[IFGC section]`. Numbers now follow the 2024 model editions. A number that existed before may now cover something else, so an old citation can't be carried over without checking.
- **Mechanical citations move titles.** Prior-code applications may cite Chapter 18-28. The ordinance itself refers to 18-28 sections in places, so both can appear in a letter during the transition.
- **14N:** it splits into `14N-C[chapter]-[section]` for commercial and `14N-R[chapter]-[section]` for residential. Residential appendices count as a new Chapter 8.
- **14F:** chapters are replaced in place and the numbers follow the 2024 IFC where adopted. The title stays partial, and 14F-80 is new.
- **14B:** no chapter or section moves. New material arrives as added subsections, such as IBC 403.5.7 and 1023.9.2, and a new definition. **The same 14B number can mean different things by date,** for example 14B-10-1027 at four versus five stories. So the index has to be keyed by edition, not only by number.
- **`code.json` needs an edition split, not a rewrite.** Its 14B entries remain valid as numbers. Its 14M, 14G and 14N entries name titles only, and 14N is still labeled the 2022 code.

## Unresolved conflict on dates

- **The ordinance:** Article VI gives most Article IV changes, including most 14B items there, an effective date of passage and approval, and Article V's 14B items October 1. The transitional text I read covers 14G, 14M and 14N.
- **The memo:** search excerpts of [Code Memorandum 2026-001](https://www.chicago.gov/content/dam/city/depts/bldgs/general/CodeModernization/CodeMemo2026-001.pdf) (October 6, 2026) say the 2026 Ordinance is optional from October 1 and mandatory for applications started on or after December 1, and that it covers 14B and related titles. The page returned 403, so I couldn't read it.
- **Why it matters:** it decides which 14B text applies to an application started in, say, November 2026. Read the memo in a browser, and ask the Department of Buildings or a lawyer if it doesn't resolve this. **[lawyer]** Until then, Redline should show both versions for that window, and not pick one.
- **Approval date:** the Clerk's action list dates its signed entry June 17, 2026, while the signature page reads June 30, 2026 by eye. This affects the "upon passage and approval" items.
- **Plumbing shows the same tension:** [an engineering firm's post](https://elaraeng.com/2026-chicago-code-changes-plumbing/) (October 6, 2026) says projects can avoid the updates by submitting before December 1, while the plumbing amendments sit in Article IV, which takes effect upon passage and approval.

**Secondary sources differ from the signed text, so rely on the ordinance.** [MAP Strategies](https://map-strategies.com/ideas/2026-chicago-construction-code-updates) (October 9, 2026, read directly) says the interlocking stair provision goes to 150 feet and the ventilation exception to buildings over 20 units. The signed text reads 160 feet and 11 or more units.

## Is the text public?

| Text | Public? | Notes |
|---|---|---|
| Passed ordinance | **Yes, read directly** | City Clerk record. The Department of Buildings also posts a copy, which returned 403. |
| Compiled Municipal Code with these changes | **Unknown** | [American Legal](https://codelibrary.amlegal.com/codes/chicago/latest/overview) returned 403. Search excerpts suggest compiled codes may lag new ordinances. |
| Department supplements to the 2019 codes | **Unconfirmed** | A memo excerpt mentions them. Their address and contents are unknown. |
| 2024 IMC, IFGC, IECC, IFC and 2018 IBC | **Viewable, not ours to copy** | The ordinance adopts them by reference and doesn't reprint them. Redistribution terms were not researched. **[lawyer]** |
| ICC-hosted 2026 Chicago editions | **Unknown** | I did not find any. [ICC's Chicago list](https://codes.iccsafe.org/codes/united-states/illinois/chicago) wasn't read directly. |

## What's needed to index it

1. **Read the memo and the Department's code page in a browser** (you). This settles the dates above and shows whether supplements exist. [Construction Codes](https://www.chicago.gov/ConstructionCodes), [Modernizing Chicago's Construction Codes](https://www.chicago.gov/city/en/depts/bldgs/supp_info/CodeModernization.html).
2. **Add edition handling to the pack.** Each entry needs an edition and the application dates it covers. The lookup has to resolve an edition from the application start date, as `docs/locale-research.md` already recommends. `get_section` should say a section is unverifiable when it isn't in that edition. This is code work in `mcp/`, which I didn't do. Nothing reads `code-2026.json` yet, so the agent's behavior hasn't changed.
3. **Recheck the marks on entries with `markup_checked: false`,** against the page images, before relying on the detail. An extraction that keeps underlines and strikethroughs would help.
4. **Expand 14M, 14G and 14N beyond the entries so far.** Chicago's own modifications can be indexed from the ordinance. By OCR line match there are about 124 section headings for 14M and 85 for 14G; these are counts of lines, not verified totals, and my pattern undercounted 14N, so I'm giving no figure for it. Sections adopted without change appear in the ordinance only by reference, so an index can't list them without the model codes.
5. **Get a lawyer's view on model code data before storing it. [lawyer]** The questions: may we store section numbers and titles from ICC codes, and what do ICC's terms allow? Until then, keep to what's in the current approach: Chicago's section numbers and our own one-line summaries, with links to the official text.
6. **Test against real letters.** Reviews under the 2026 text may not exist in meaningful numbers yet. The FOIA sample covers pre-2026 reviews. Plan a second request for applications started on or after December 1, 2026, once they have been through review.

## What's in `code-2026.json`

It holds 60 entries, all checked against the signed ordinance. It lists changes the ordinance makes: titles, adoption and citation rules, transitional sections, and the amended sections of 14A, 14B, 14R and 14X. Scope lines are my own paraphrases, with no ICC text. Plumbing (18-29) is one summary entry. The replaced chapters of 14M, 14G, 14N and 14F are not itemized.
