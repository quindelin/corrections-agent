# Getting real Chicago correction letters

Researched 2026-10-31. **Nothing has been sent, submitted or requested.** This is not legal advice; items for a lawyer are marked **[lawyer]**.

**Where this stands:** I found no real Chicago correction letter in any public source, so Redline still has no Chicago test data. There are three ways to get some:

1. **Check the City's permit status site.** It may show correction text today, and you can test that in minutes. Accepting its terms is your decision, so I didn't.
2. **Send the FOIA request.** The draft is ready and targets 15 permits that the City's own data marks as having gone through certified corrections.
3. **Ask architects and expediters.** A draft request is ready. This is the only route that also gets the professional's response and is free of FOIA exemptions.

Two findings change what we believed:

- **The 2026 ordinance doesn't move the building code to 2024.** Title 14B stays on the 2018 IBC with amendments, and only mechanical, fuel gas and energy are fully replaced ([details](chicago-2026-code.md)).
- **The bubble, date and initial rule is still not directly confirmed.** `chicago.gov` blocked every primary page. The evidence is strong but indirect, and you can settle it by opening one page in a browser.

## Routes, ranked

Yield is my judgment from what each source contains, not a measurement. Times are the statutory deadline where one exists; otherwise I give no number.

| # | Route | Contains real comments? | Time | What you do |
|---|---|---|---|---|
| 1 | City permit status site | **Possibly, untested** | Minutes to test | Read the terms, test a few permits |
| 2 | FOIA to Department of Buildings, 15 permits | Should, if released and retained | 21 working days for a first response if treated as commercial; 5 + 5 business days if not | Send it |
| 3 | Architects and expediters sharing letters | **Yes, they receive them** | Depends on them | Send requests; run alongside 2 |
| 4 | FOIA to public owners on their own projects | Possibly; untested inference | Same statutory clocks | Decide after #2 responds |
| 5 | Review or suit if FOIA is denied | Same records as #2 | 60 days to request review | Decide with a lawyer |
| 6 | Second FOIA for 2026-code reviews | Later, once they exist | After December 2026 applications are reviewed | Later |
| 7 | City data portal | **No comment text**, but useful labels | Available now | Nothing |
| 8 | Zoning Board of Appeals packets | **No correction letters in my sample** | Available now | Nothing |
| 9 | Published examples, court cases, audits, prior FOIA records | **None found** | Not applicable | Nothing |
| 10 | Direct ProjectDox or Hansen access | No public route found | Not applicable | Only through an applicant who shares their own |

### 1. City permit status site

[The help page](https://webapps1.chicago.gov/buildingpermit/help), read directly, describes pages that look like exactly what we need:

- **Open and Completed Corrections:** "details" for each correction with dates, available when you search by application number.
- **ProjectDox Status Report:** a PDF with reviewer comments, checklist comments and changemark comments, for 9-digit application numbers, only while the application is under review.
- **Coverage:** applications started in the last 36 months. Issued permits "may not appear".

**Why I didn't test it:** [the site's first page](https://webapps1.chicago.gov/buildingpermit/) has an accept-terms step and a form. I didn't accept the terms, submit anything or call deeper pages directly. So I don't know how much text "details" means, or whether the 15 issued permits appear at all.

**The catch [lawyer]:** the help page says the site is designed for applicants and their authorized representatives, while the public gets more limited information by address. An application-number search appears to need no login, but looking up strangers' applications, and especially collecting them in bulk, may go beyond what the City intends. The [Data Terms of Use](https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html) returned 403, so I haven't read them. Ask a lawyer before any repeated or automated use. If the City's FOIA reply itself points you to this site, that helps.

### 2. FOIA to the Department of Buildings

The draft is in [chicago-foia-request.md](chicago-foia-request.md), with the 15 permits, pre-send checks and replies to likely objections.

**The legal position, briefly:**

- **Favorable:** [Opinion 21-004](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2021-Binding-PAC-Opinions/21-004.pdf) (May 24, 2021, read directly) held that a city's review comments to a zoning applicant could not be withheld as deliberative, because the applicant is a third party. It's the closest ruling I found, but it concerned zoning in Geneva, not building plan review.
- **Risky:** [Opinion 25-012](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2025-Binding-PAC-Opinions/Binding%20Opinion%2025-012.pdf) (September 2, 2025, read directly) says plans and "other construction related technical documents" on privately funded projects are exempt without any security showing. Private incentives may not count as public funding ([Edwardsville, 2022, non-binding](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/Non-Binding-PAC-Opinions/FOIA/7_1/Exemptions-which-permit-redacting-withholding-exempt-information-records/7_1_k/69505%2069506,%20issued%20May%2019,%202022.pdf), read directly). In that case, the public body released letters and other records and withheld only the technical documents. The draft therefore excludes drawings entirely.
- **Open:** I found no ruling on whether a building reviewer's comments are themselves exempt technical documents. **[lawyer]**
- **Commercial purpose:** the draft discloses it. That means a 21-working-day response, lower priority, and possible search fees. See the draft's checklist. **[lawyer]**
- **No precedent:** the [Buildings FOIA log](https://data.cityofchicago.org/Buildings/FOIA-Request-Log-Buildings/ucsz-xe6d) has 74,772 rows, ending in December 2017. 4,720 mention "plans". None mention "plan review" or "comment", and the only mention of "correction" concerns violations. It shows no outcomes and nothing after 2017, so I can't tell how such a request would be treated.

**The sample's advantage:** `work_description` in the permit data carries City wording such as "CERTIFIED CORRECTIONS SUBJECT TO FIELD INSPECTIONS & AUDIT" on 575 of 3,061 Standard Plan Review permits issued in 2026 so far. So we can target permits known to have used the program.

### 3. Architects and expediters

The draft is in [chicago-foia-request.md, Part 2](chicago-foia-request.md#part-2-request-to-an-architect-or-expediter). They hold the letters, and these letters can come with the project's outcome and the response, which FOIA won't give us. A [consultant's post](https://www.burnhamnationwide.com/final-review-blog/the-three-different-types-of-chicago-plan-reviews) (read directly, undated) says a Notification of Corrections Report with markups is emailed to the architect of record.

**Who to ask:** the permit data lists an expediter among the first three contacts on 1,778 of 6,697 Standard Plan Review permits issued since January 2025, and architects on most. Filter `contact_N_type` for `EXPEDITOR` or `ARCHITECT`, and limit to the certified corrections marker. I didn't compile a contact list, and I didn't touch `outreach/`.

**Weakness:** you'd likely get letters from whoever says yes, not a representative sample. Consider client permission and how the letters are stored. **[lawyer]**

### 4. FOIA to public owners

**This is my inference, not something I found documented.** A public body that applies for its own permits, such as the Public Building Commission, may hold its copies of correction notices. For publicly funded projects, section 7(1)(k) applies only to the extent disclosure would compromise security, which is a narrower exemption. I searched for such notices in bid documents and found none, and I don't know which bodies keep them. It's worth trying only if route 2 fails on 7(1)(k).

### 5. If the request is denied

Ask the Public Access Counselor for review within 60 days of the final denial, or sue under section 11. A denial must state a detailed factual basis. Consider narrowing the request first. **[lawyer]**

### 6. Second FOIA, for 2026-code reviews

The 15 permits were all reviewed under the earlier code. To test Redline on the 2026 text, repeat the request for applications started on or after December 1, 2026, once they have been through review. A marker in the permit data will only appear after issuance.

### 7. City data portal (tested)

- [Building Permits](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu): no comment text, and I found no plan review dataset. `permit_condition`, added in October 2025, holds conditions such as zoning adjustment references. It's useful for choosing permits and for outcome labels such as `processing_time`.
- [Building Violations](https://data.cityofchicago.org/Buildings/Building-Violations/22u3-xenr): inspector comments rather than plan review, and only 1 of 88,297 violations since January 2025 cited a 14B ordinance. Not a useful substitute.
- [Plan review performance metrics](https://data.cityofchicago.org/d/4ygs-9x34) were last updated in 2014.

### 8. Zoning Board of Appeals packets (tested)

The City posts packets at [an open index](https://resources.chicago.gov/zba/). I read 11 of the 26 current hearing packets, which is a small sample from a single month. **None contained a Department of Buildings correction letter, and the word "correction" did not appear in their extracted text.** One other packet was too large for my download limit and went unread. One applicant's narrative described a zoning review outcome second-hand. The application form includes a statement copied from the "Official Denial of Zoning Certification", so these packets could help with zoning vocabulary only. Zoning is outside Certified Plan Corrections anyway. The index appears to hold current hearings only, and I didn't find an archive. Applications were skimmed by keyword, not read in full, and they include personal details, so I kept none of them in this repo.

### 9. Published examples and other records (searched, none found)

- **Published examples:** none. [Groundbook](https://groundbook.ai/locations/chicago/) (read directly) says Chicago doesn't publish a numbered correction sheet. It offers paraphrased topics only.
- **Court cases:** [Penrod Premium Consignment Cigars v. City of Chicago](https://hallapproved.com/il/cases/appeals/2023/9416325/) (2023, read directly) has no plan review comments. Other mandamus cases I found are mostly decades old and were seen only in excerpts.
- **Inspector General:** the audits I found in search excerpts concern inspections, not plan review corrections.
- **MuckRock:** [a Department of Buildings page](https://www.muckrock.com/agency/chicago-169/city-of-chicago-department-of-buildings-752/) returned 403. An excerpt says it lists 16 requests, and I saw none about corrections. Worth a look in your browser, including a [retention policies request](https://www.muckrock.com/foi/chicago-169/retention-policies-city-of-chicago-department-of-buildings-60475/) that might show how long the comments are kept.

### 10. ProjectDox and Hansen

I found no public data export from either. E-Plan is for applicants, and Form 420's excerpt refers to corrections in both the Dynamic Portal and ProjectDox. The help page says some changemark details are for authorized users. Don't use anyone's login to reach other people's records.

## What you need to do

**Today, about an hour:**

1. **Open four primary pages in a browser and compare them with `profile.json`:**
   - [Certified Plan Corrections](https://www.chicago.gov/city/en/depts/bldgs/supp_info/certified_plan_correctionsinformation.html): the bubble, date and initial wording; exclusions; 120 days.
   - [Form 420](https://www.chicago.gov/content/dam/city/depts/bldgs/general/forms/Form420-070620.pdf): current revision, attestations, folder name.
   - [Code Memorandum 2026-001](https://www.chicago.gov/content/dam/city/depts/bldgs/general/CodeModernization/CodeMemo2026-001.pdf): dates, and how it treats 14B.
   - [Changes for 2026](https://www.chicago.gov/city/en/depts/bldgs/provdrs/bldg_code/alerts/2025/december/2026changes.html): deposit and penalties.
2. **Check the status site by hand.** Read its terms and decide whether to accept. If you do, look up one or two of the 15 permits and one current application, and note whether real comment text appears. Don't automate it before asking a lawyer.
3. **Open the [Buildings FOIA page](https://www.chicago.gov/city/en/depts/bldgs/supp_info/bldgs_foia.html)** and confirm where to send the request.

**This week:**

4. **Ask a lawyer** the questions listed below.
5. **Send the FOIA request** yourself, and put the response deadlines on your calendar.
6. **Send the sharing request** to architects and expediters you trust, once its brackets are true.

**When letters arrive:** store them outside the repo until redaction and permission are settled, then build a Chicago set in the same shape as `realdata/seattle/letters.json`. FOIA material won't include responses or complete cycle data, so label its source.

## Questions for a lawyer

1. Does using these records to test a paid product make this a commercial purpose request?
2. May we look up applications on the status site that aren't ours, and may we automate that? What do the terms allow?
3. Are a reviewer's comments "other construction related technical documents" under section 7(1)(k)?
4. May we store, reuse or show FOIA-obtained comments in a commercial product, including comment text that names projects?
5. What should the confidentiality promise and NDA say, and do letter-sharers need client permission?
6. May we store model code section numbers and titles, and what do ICC's terms allow?
7. Which 14B text applies to an application started between October 1 and November 30, 2026?
8. Form 420's excerpt has the professional certify they personally made each correction. Does that limit how Redline's drafting can be presented or used?

## What I verified

**Read directly from a primary source:**

- The signed ordinance and the City Clerk's record: identity, vote, effective dates, what's replaced, and how numbering works.
- Attorney General opinions 21-001 (opening pages only), 21-004, 23-008 and 25-012, the 2022 Edwardsville letter, and the AG's Winter 2026 newsletter on the January 2026 FOIA changes.
- City data portal datasets, including the permit sample and the marker counts.
- The status site's help page, by raw HTML for the key wording.

**Seen only in search excerpts or secondary sources, and marked unconfirmed in `profile.json`:**

- **All Certified Plan Corrections rules,** including the bubble, date and initial rule that `evals/score.ts` checks. Excerpts of the City's page match [Groundbook](https://groundbook.ai/locations/chicago/), read directly, which says it reviewed its sources on September 12, 2026.
- **Form 420's contents and revision.** The upload folder name differs between sources.
- **Code Memorandum 2026-001 and the 2026 changes page.** The memo's dates match the ordinance's December 1 date for 14M, 14G and 14N, but not obviously its dates for 14B.
- **The 120-day rule,** and a code section (14A-4-410.4.1) that adds deposit forfeiture and a possible 90-day extension.

**FOIA statute text:** I read a [county-hosted copy of the Act](https://fultoncountyil.gov/wp-content/uploads/2022/11/FOIA-LAW.pdf) from about 2022, plus AG opinions quoting it, and a [law firm summary](https://ottosenlaw.com/changes-to-foia-and-oma-effective-january-1-2026/) of the 2026 changes. It's not the current official text. Check it before relying on section numbers.

**What this means for `evals/`, which I didn't edit:**

- **Revision marks:** all 8 eval tasks are fictional, and 29 of the 48 expected items require revision marks. The rule matches everything I could see, but it's only as good as the unconfirmed sources above.
- **Wording:** the regex also accepts "cloud". I saw only "bubbled" in the City's wording.
- **Comment in `score.ts`:** it mentions only the zoning exclusion. The excerpts also exclude geotechnical and stormwater items, incomplete plans and disputed comments.
- **Not tested at all:** whether real Chicago comments look like these fictional ones.

## What remains unknown

- Whether the status site shows full correction text, and whether issued permits appear there.
- Whether the City will release these comments, how it will read section 7(1)(k), and whether it will treat the request as commercial.
- The form the comments take: report, export or only markups. "Notification of Corrections Report" comes from one consultant's post, so the draft also describes the records by system.
- How long the City keeps correction comments, and whether they survive after permit issuance.
- The current FOIA email address and online form, confirmed from the City.
- How many review cycles and comments the marked permits had. The data shows use of the program, not counts.
- Whether the memo reconciles the 14B dates, and the true approval date of the ordinance.
- Whether compiled 2026 code text or Department supplements are available, and where.
- Current status of Hansen and the portal. `docs/locale-research.md` already notes that city pages disagree.

## Access log

| Source | Result | What I did |
|---|---|---|
| `www.chicago.gov` (memo, program page, Form 420, 2026 changes, FOIA page, ordinance copy) | 403 | Noted it and used excerpts. No alternate hostnames, archives or browser tools. |
| `codelibrary.amlegal.com` | 403 | Excerpts only |
| `www.ilga.gov` | 403 or certificate error | Used AG materials and a county copy of the Act |
| `law.justia.com`, `muckrock.com` | 403 | Excerpts or moved on |
| `caapts.org` | 525 | Moved on |
| `cornerstonepermit.com` | Page came back with no body | Moved on |
| `webapps1.chicago.gov/buildingpermit/` | Terms gate | Read the help and first page only. Did not accept or search. |
| City Clerk record and files, data portal, ZBA index | Open | Read directly. A small sample of ZBA packets was downloaded to temporary storage. |

Some directly read pages passed through a fetch tool that summarizes. For the ordinance and AG opinions, I extracted and read the text myself. Summarized pages include Groundbook, MAP Strategies, the Burnham post and the Penrod order, so check their exact wording before quoting them.
