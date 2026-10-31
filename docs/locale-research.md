# Redline locale research: which places have the corrections problem, and what varies

1. The Chicago pattern is documented in New York City (applicant time about 3x city time [NY1]), San Francisco (median three review rounds [SF1]), Seattle (median three cycles, 8.3% finish in one [SE5]), Denver (about 37% accepted first round [DN1]) and Portland (over 80% needed corrections, 2021 data [PD1]).
2. In Illinois I found no measured corrections data outside Chicago, only turnaround targets, so the Illinois ranking reflects documented process and build cost, not proven pain or market size.
3. Illinois sets a structural minimum but has no single code: listed editions run from 2015 (Joliet [JL1]) to 2024 (Naperville [NV1]), and Chicago itself changes code basis on December 1, 2026 [CH3].
4. The jurisdiction-pack design holds, with five changes: resolve code edition by application date, layer model/state/local text, make response format structured, ingest comment sets rather than only letters, and key portals by vendor.
5. Add Evanston, Naperville and Seattle next; note that a direct competitor, Comment Letter [CO5], exists, and that city pre-checks reduce corrections without removing them [CO3][SE4].

## Comparison tables

Source codes link to the source and are defined, with evidence grades, in the Sources section.

### Illinois, ranked

The ranking weighs how clearly the correction process is documented, whether code text is online, and reuse of work already done. It does not measure demand. **No corrections evidence separates these places.**

| # | Place | Corrections evidence | Code basis found | Correction workflow | Public data | AI pre-check |
|---|---|---|---|---|---|---|
| 1 | Evanston | None measured. Targets: 4-6 weeks, revisions 10-15 business days [EV1] | 2021 I-Codes [EV1] | Accela portal; revisions by email, bubbled, with written response [EV1] | Portal in migration; old permit dataset 2009-2020 [EV4][EV5] | None found |
| 2 | Naperville | None measured. Target: 3-4 weeks for complex projects [NV1] | 2024 I-Codes from April 1, 2026 [NV1][NV2] | Tyler-hosted portal (from URL); resubmit after deficiency notice [NV1] | Monthly PDF reports; portal status unverified [NV4][NV3] | None found |
| 3 | Rockford | None measured. Targets: 14 days, revisions 5 days [RF2] | 2021 ICC; amendments as separate PDFs per code [RF1] | ProjectDox with prescreen and markups [RF2] | Not found | None found |
| 4 | Cook County (unincorporated) | None measured. 2021 audit does not address corrections [CK1] | 2021 adoption with amendments; IBC edition unconfirmed [CK4] | Strict emailed resubmittal: clouded, initialed, dated, VOID sheets [CK2] | Permit data FY2005-2011 only [CK6] | None found |
| 5 | Joliet | None measured | 2015 IBC listed; amendments in Chapter 8 [JL1] | ProjectDox: per-comment responses, versioned files, naming rules [JL2][JL5] | Not found | None found |
| 6 | Aurora | None measured. Targets: new commercial 15 business days, revision 5 [AU2] | Unclear: 2024 I-Series planned, 2015 on old forms [AU3][AU4] | e-TRAKiT; revisions by email [AU1][AU2] | Not found | None found |
| 7 | Elgin | None measured. Target: 10-15 business days [EG1] | 2021 I-Codes; amendment PDFs [EG2] | Email submittal; no resubmittal rule published [EG1] | Not found | None found |
| 8 | Oak Park | None measured. Goal: comments in 5 working days [OP1] | 2021 I-Codes [OP1] | CityView portal, Bluebeam review, outsourced reviewers [OP2] | Not found | None found |
| 9 | Schaumburg | None found | 2021 IRC listed; IBC edition unconfirmed [SC2][SC3] | OpenGov portal rollout; plan review letter [SC1] | Not found | None found |
| 10 | Champaign | None measured. Estimate: 10 days commercial [IL12] | 2021 IBC [CP1] | Three departments review in parallel [IL12] | Regional dataset, stale since 2019 [CP2] | None found |
| - | Springfield | None found | 2018 IBC effective June 2023 [SP1] | Multi-station routing form [SP2] | Not found | None found |
| - | Peoria | None found | 2018 I-Codes effective May 2021 [PE1] | Email only; incomplete submissions returned [PE1][PE2] | Not found | None found |

### Rest of US

| Place | Corrections evidence | Code basis | Correction workflow | Public data | AI pre-check |
|---|---|---|---|---|---|
| Seattle | **Strong.** Median 3 cycles, 8.3% in one [SE5]; only 29% of audited corrections "necessary" (2020 sample) [SE1] | 2021 IBC, state and local amendments [SE8] | Bluebeam or Acrobat replies in the plan set; clouded; full set [SE3] | **Best found.** Line-level correction comments [SE6], cycles and days [SE5] | CivCheck tested; production pilot recommended, unfunded [SE4] |
| San Francisco | **Strong.** Median 3 rounds; 280-day median for housing permits [SF1] | Edition not verified; local code online [SF6] | Bluebeam session; comments issued by station, no consolidated letter [SF1] | Review steps by round [SF4] | None found |
| New York City | **Strong official statement.** Applicant time typically 3x department time [NY1] | Not verified | DOB NOW objection statuses; second review path [NY3] | Filings and permits, no objection fields seen [NY5] | Vendor logo only [CO1] |
| Denver | **Strong but secondary.** About 37% accepted first round, or about 30% [DN1][DN2] | 2025 Denver codes from January 1, 2026 [DN5] | Accela [DN7]; signed, sealed response letter for every comment [DN4] | Not verified | **CivCheck live**, $4.6M over 5 years [DN1][DN2] |
| Portland | **Dated.** Over 80% of standard plans needed corrections (2018-19 data) [PD1] | State code, 2025 OSSC mandatory April 1, 2026 [PD4][PD5] | ProjectDox Applicant Resubmit [PD3][PD7] | Dashboard splits staff and applicant days; numbers not extractable [PD2] | None found |
| Austin | **Partial.** Site plans median 6 rounds (via SF report) [SF1]; no building-permit cycle data found | 2024 IBC with local amendments [ATX3] | Master Comment Report; written responses; full set; fees from second update [ATX2] | Site plan metrics [ATX5] | **Archistar live** for residential since September 2025 [ATX1] |
| Los Angeles | **No measured evidence found.** Only official targets [LA1] | 2025 CBC via Ord. 188797 [LA3] | ePlanLA; standard correction sheets [LA7][LA6] | Dates but no cycle fields [LA5] | **Archistar**, optional [LA4][LA9] |
| Philadelphia | **No evidence found.** | 2021 I-Codes mandatory July 1, 2026 [PH4] | eCLIPSE; "Additional Information Required" status (Streets example) [PH7] | L&I review times only [PH1] | None found |

### How much of the time is with the applicant

These figures use different definitions and should not be read as a league table.

| Place | Measure | Applicant share | Source |
|---|---|---|---|
| Chicago | Average, plan-based permits, October 2024 | 50 of 71 days (70%) | [CH1] |
| Chicago | Testimony, October 2026 | About two-thirds of 88 days | [CH2] |
| New York City | Average filing to approval, FY2026 | Typically 3x department time; total 25.4 days | [NY1] |
| Seattle | Issued 2024 onward, at least one cycle, n=8,476 | Mean 98 vs 66 days (60%); median 33 vs 45 days (42%) | [SE5] |
| Seattle (new buildings) | Same, n=1,827 | Mean 187 vs 134 days (58%); median 74 vs 102 days (42%) | [SE5] |
| Seattle | City statement | Total roughly twice City time | [SE2] |
| San Francisco | Not tracked | The city cannot split it without manual file review | [SF1] |

**The takeaway:** "applicants hold most of the time" is true of Chicago and New York, and only partly true of Seattle, where it depends on mean versus median. Do not reuse the Chicago pitch unchanged. Round count travels better than time share.

## Per-place notes

### How to read this report

Researched 2026-10-31. Evidence tags are attached to each source in the Sources section.

- **P**: I read the primary source directly.
- **P\***: primary source, but I saw it only through a search-index excerpt, usually because the site returned 403 to my fetcher. Confirm before quoting externally.
- **Q**: my own query of a public dataset on 2026-10-31.
- **S**: secondary reporting.
- **V**: vendor or competitor claim. Treat as marketing.
- **OLD**: older than about three years.

**Access limits.** chicago.gov, champaignil.gov, villageofschaumburg.com, businesswire.com and several news sites returned 403 to direct fetches, and I did not try to get around that. Census Building Permits Survey files could not be retrieved, so **I have no market-size data**. No practitioners were interviewed.

**A turnaround target is not evidence of a corrections problem.** Many Illinois entries below are targets only, and I say so.

### Illinois statewide factors

**Illinois has a baseline, not one code.**

- Public Act 103-0510 requires that, from January 1, 2025, local codes regulate structural design at least as strictly as the baseline IBC, IEBC and IRC [IL1][IL2].
- Local governments are not required to adopt a code. Those without a compliant one are treated as non-building-code jurisdictions [IL2].
- In those areas, new or substantially improved commercial buildings need a qualified inspector's certification before occupancy [IL6]. **A correction letter may never exist there**, so they are out of scope for Redline as designed. That last step is my inference.
- A law-firm summary says the provision expressly preempts home rule [IL7].
- Local code officials remain the authority on private projects, and the Capital Development Board (CDB) does not review plans or overrule them [IL2].

**A registry exists and could seed the packs.** Local governments must report model code, edition and amendments to CDB at least 30 days before the effective date [IL1]. CDB's directory is meant to show this for each jurisdiction [IL2]. My fetch of the [directory][IL3] returned no records, so its data quality and machine access are **unverified**, and CDB itself does not guarantee it.

**State-level codes sit under every Illinois pack.** Energy, plumbing and accessibility come from state rules [IL1]. Examples: Rockford applies the 2014 IDPH plumbing code [RF1], Peoria notes a statewide 2024 energy code requirement from November 25, 2025 [PE1], and Evanston applies the Stretch Energy Code after October 1, 2025 [EV1]. The State Fire Marshal runs a separate plan review that does not consider local rules [IL11], and public schools fall under the state board of education [IL2]. Both matter for "other agency" routing.

**Pending law could change the process layer.** BUILD proposals would have set statewide review deadlines and allowed third-party review when they were missed [IL9][IL10]. Reporting from June 9, 2026 says the most far-reaching parts stalled [IL8]. I found nothing later, so check bill status.

**One unresolved legal point.** The Public Act PDF appears to apply the 30-day notice to municipalities under 1,000,000, while the codified text shown has no such limit [IL4][IL5]. Direct fetches of both were blocked or failed, so **whether Chicago is treated differently is not established here**.

### Chicago: three things to check in your own baseline

- **The 71/50 figure is from October 2024.** It comes from the commissioner's budget statement of November 7, 2024: 21 days with DOB, 50 with the applicant or design professional, 71 total [CH1]. Other readings: 95 days (37 city, 58 applicant) in December 2023 and 77 days (31, 46) in July 2024, both as reported by a think tank citing the city [IL12]. The newest figure I found is 88 days, roughly two-thirds with the design professional, from testimony on October 27, 2026 [CH2]. That last one is secondary, and I could not find the DOB statement itself. The share has stayed stable, so "about two-thirds" is safer than "50 of 71".
- **Your stats snapshot measures something else.** `jurisdictions/chicago/permit-stats.json` shows 117.0 average days for Standard Plan Review, from the data portal's `processing_time` [CH11]. Its own note says that field does not split city from applicant time. It should not be set beside the 71 or 88 figures.
- **`jurisdictions/chicago/profile.json` is about to be out of date.** It names the 2018 IBC. A city memo says the 2026 Ordinance became optional October 1, 2026 and is mandatory for projects starting the application process on or after December 1, 2026 [CH3]. A trade group describes that ordinance as aligning with the 2024 model codes [CH4]. I did not edit the file.

### Illinois places

**Chicago (baseline).** Certified Plan Corrections is required when eligible. It excludes zoning, geotechnical and stormwater items, incomplete applications, and disputed comments. Non-response within 120 days means withdrawal [CH5]. Certification uses Form 420, signed and sealed by each professional of record [CH6]. Projects over three cycles reportedly require the architect of record to meet examiners [IL12]. ProjectDox remains the document system [CH7]. City pages disagree on when plan-based permits leave the old portal, and a January 2026 memo requests Hansen support through January 2029 [CH8][CH9]. From January 6, 2026 the deposit rose to $600, with a matching penalty for substantially incomplete applications [CH10].

**1. Evanston.** The clearest response rule in Illinois outside Cook County: one complete PDF with changes "bubbled", plus a separate written response, emailed to a revisions address [EV1]. Portal submission has been available since February 2025, but revisions stay on email [EV1]. Reviews: 4-6 weeks, revisions 10-15 business days [EV1]. A 2022 release noted high volume and urged early filing, which is not corrections evidence [EV3]. An ordinance requires design professionals for some residential work [EV6]. Correction letters public: not found.

**2. Naperville.** Ordinance 26-010 applies 2024 I-Codes to plans submitted on or after April 1, 2026 [NV1]. Amendments are in Municode Title 5, Chapter 1, including a 36-by-24-inch sheet limit [NV2]. Some older city pages still cite earlier editions, which is a warning about stale sources [NV5]. The process description is thin: staff notify, applicant resubmits, under electronic submittal requirements [NV1]. I did not read those requirements. One headline reports 6,287 permits in 2023 [NV6]. An open data portal exists, last described in a 2017 blog [NV3]. Confirm by phone.

**3. Rockford.** Probably the cheapest pack to build: separate amendment PDFs for each 2021 code [RF1]. The workflow runs prescreen, department markups, and resolution through ProjectDox, with published file-naming guides [RF2]. It shares ProjectDox with Chicago, Joliet and Portland, so it would test less that is new.

**4. Cook County (unincorporated).** The strictest format found. The architect of record corrects sealed documents. Every change is clouded, initialed and dated. Superseded sheets are marked VOID, with replacements directly beneath, in a single PDF emailed to one mailbox. Applicants should wait until all reviews finish, and noncompliant submittals are returned [CK2]. Itemized responses are expected [CK3]. The 2021 audit (FY2018 scope) concerned controls and procedures, not corrections [CK1]. Currency of the notice is unverified: e-permit materials also exist [CK5].

**5. Joliet.** The best-documented process in Illinois: prescreen corrections need a response per comment, more items may appear during review, and resubmission uses versioned files [JL3][JL2][JL4]. Naming rules are specific: leading number, 40 characters, no special characters, single-page plan PDFs in correct orientation [JL5]. The code page lists the 2015 IBC, enforced since September 10, 2018 [JL1]. Check whether that is current.

**6. Aurora.** Publishes both initial and revision timeframes, stated as workload-dependent estimates [AU2]. Code status is the problem. The city planned a move to 2024 I-Series in April 2025, but its page does not confirm adoption [AU3]. An aggregator describes staff requesting adoption [AU5], and an ordinance, O25-082, had garbled text I could not rely on [AU6].

**7. Elgin.** Lists 2021 codes with amendment links [EG2]. Applications go by email, with examiner review in about 10-15 business days [EG1]. Click2Gov exists [EG3]. A search excerpt said a new portal is being built, but my re-fetch of the likely page did not confirm it.

**8. Oak Park.** Its guide requires a code compliance block on the title sheet and PDF-only documents [OP1]. A 2025 RFP sought outside reviewers working in CityView and Bluebeam, with reviews and re-reviews in 1-5 business days and 10 for large structures [OP2]. Those are contract requirements, not results. Comments may come from a contractor, so style may shift.

**9. Schaumburg.** Permit types are moving to OpenGov. City pages are inconsistent on which are live [SC4][SC1]. A hazard plan said IBC 2015 as of 2018, in a 2024 document [SC3], and the codes page shows a 2021 IRC with amendments in Title 15, Chapter 153 [SC2]. I could not fetch these pages directly.

**10. Champaign.** Lists the 2021 IBC [CP1]. A 2024 think-tank report gives review estimates of 10 days commercial and 5 days for one- and two-family homes [IL12]. That report treats Champaign as comparatively permit-friendly, so **this may be a place with less of the problem**.

**Below the cut: Springfield and Peoria.** Springfield's 2023 list shows 2018 codes [SP1], and an older phased-permit guide still cites 2012 [SP3]. Peoria takes applications by email [PE1]. Both are on older editions with less process documentation. A report also singled out Decatur for listing no timeline at all [IL12]. I found no corrections evidence in any of these.

### Rest of US

**Seattle.** The City Auditor (October 18, 2023) reported a 50-day median in City review, second-round reviews at 27 days against a 14-day target, and a lack of clear guidance on what warrants an official correction. An internal 2020 letter audit found only 29% of corrections "necessary" for that project type. Recommendation 11 asked for ongoing monitoring of correction quality [SE1]. Current 75th-percentile City days are about double the goals, for example 64 against 30 for single-family alterations [SE2].

My query of [Building Permits][SE5], for building permits issued since January 1, 2024 with at least one recorded cycle, gave:

- 8,476 permits and a median of 3 cycles.
- 704 (8.3%) with one cycle, and 4,650 (54.9%) with three or more.
- New buildings: median 4 cycles, with 4 of 1,827 finishing in one cycle.
- Another 6,425 building-type permits in the wider set show zero cycles. I do not know why, and excluded them. The SF analyst also reports a median of four rounds for Seattle housing permits [SF1].

**Seattle's [Plan Comments dataset][SE6] is the most useful thing I found.** It has one row per correction comment, with review type, cycle, subject, comment text and a link to the correction letter document: 26,299 rows, dated January 2022 to September 29, 2025, so check whether the feed is still updating. About 43% match a crude text filter for code references. The [Plan Review dataset][SE7] gives a result for each review step: 175,160 "Corrections Required" against 170,726 "Approved". It names individual reviewers, so handle it carefully. Response rules are very explicit: wait for all reviews, reply in the plan set, cloud changes, upload both response and clean sets, and cite code if you decline a change [SE3].

**San Francisco.** The Budget and Legislative Analyst (March 5, 2026) is the best single document found:

- Median three rounds of review, and a 280-day median to issuance for housing permits.
- A 1,371-permit dataset with a median of two rounds of comments, 113 days total, and 16% with five or more rounds.
- PermitSF met its first-review target 72% of the time and its second-review target 88% of the time [SF1].
- DBI does not track city versus applicant time [SF1].

**Comments arrive station by station in Bluebeam, not in one letter** [SF1]. Three rounds escalates to a supervisor [SF2b]. Plan sets need a Back Check page [SF5]. A move to OpenGov is planned [SF1]. Dashboards separate City time from total time [SF2], and the review-step data is public [SF4].

**New York City.** FY2026 report: first plan review 5.4 days on average, 25.4 days from filing to approval, and 111,842 resubmission reviews against 156,389 first reviews. The report attributes filing-to-approval time largely to the applicant holding the filing to make corrections [NY1]. The State Comptroller noted applicant time rising sharply [NY2]. Totals are much shorter than elsewhere, and 103,865 jobs were professionally certified [NY1], so the value per job may differ. The objection workflow is portal-native, with a status for each objection and a second review path at no added fee, followed by a determination [NY3][NY4]. Code basis was not verified here.

**Denver.** A city official said about 37% of applications are accepted at first submittal and the goal is 80% [DN1]. Another report says about 30% of reviews [DN2]. These may measure different things. The 2026 audit follow-up cites weak quality-control detail in review monitoring and an Accela scripting error that may underreport review times [DN3]. A 2024 audit reported long waits [DN8]; the department cited 12-15 weeks at the 2022 peak, and says it now runs well below that [DN6]. The commercial guide (revised August 3, 2026) demands written responses in letter format, signed and sealed by the design professional, addressing every comment [DN4]. **This is a city now paying a competitor to reduce corrections**, so it is a test of how much residual need remains, and a poor early target.

**Austin.** McKinsey (August 2023) found average permitting over a year and most applications processed multiple times [ATX4]. A June 22, 2026 memo reports AI-assisted residential review with Archistar since September 2025, expansion due October 2026, and reductions in review timelines of about 59% residential and 46% commercial [ATX1]. Those are planned timeline changes, not audited outcomes. Comments arrive as a Master Comment Report. Updates need written responses and the complete plan set, and fees begin with the second update [ATX2].

**Los Angeles.** I found no measured corrections evidence and no Controller audit. Official figures: 15-30 business days for regular plan check and 6-10 expedited [LA1], with applications expiring after 18 months [LA2]. Corrections are a defined workflow stage [LA8], and standard correction sheets are public templates [LA6]. These are useful for sheet-level vocabulary, but they are not actual letters. Executive Directive 10 led to Archistar eCheck, supported by philanthropy [LA4] and optional for applicants [LA9]. The "3+ reviews" framing there comes from the vendor [LA4]. The [permit dataset][LA5] has submitted and issued dates but no cycle fields.

**Portland.** The 2021 audit found over 80% of standard plans needed corrections, up to 17 review types, and no tracking of attempts per permit [PD1]. The dashboard now shows median and average business days for staff and applicants by review type, updated Mondays, but the values sit in Power BI and I could not extract them [PD2][PD3]. Axios reported a 147-day median for new commercial in August 2025 [PD6]. Portland adopts the state code by reference [PD5], which is the clearest example of a state-driven code layer. A search excerpt describes versioned files getting a "V2" suffix, so confirm in the resubmit guide [PD7].

**Philadelphia.** No evidence of a corrections problem found. L&I's dataset covers only L&I's own review time, and warns that total time is affected by outside factors [PH1]. Prerequisite reviews by other agencies come first [PH7][PH8]. The 2021 codes are mandatory from July 1, 2026, and earlier applications default to 2018 if no edition is identified [PH4][PH5]. Amendments should be clouded, and are processed in 10 business days [PH3]. Paper applications could not take corrected plans online [PH6]. Weakest case of the eight.

### Competition across places

| Product | Side | Where | What to note |
|---|---|---|---|
| **Comment Letter (Ichi)** | Applicant, **direct competitor** | Most Bay Area, many in California, a few other states (self-described) [CO5] | Same core job: upload letter and drawings, get cited draft responses per comment, export Word. Pay per report |
| CivCheck (Clariti) | City pre-check | Honolulu, Seattle, NYC, San Jose, Greeley, Chanhassen, NCTCOG, Denver on vendor logo list [CO1] | Acquired October 2025 [CO2]. The vendor page describes no post-submittal response workflow [CO1] |
| Archistar eCheck | City pre-check | Austin [ATX1], LA City and County [LA4] | Optional in LA [LA9]; compliance report goes with the application [LA4] |
| InspectMind, PlanChecker AI, Blitz | Applicant or reviewer | Private and LA-focused [CO6][CO7][CO8] | Pre-submittal checking. I did not evaluate them |
| Other pilots | City | Louisville, Yuma [CO9][CO10] | No Illinois pilot found |

**No AI pre-check found in any Illinois jurisdiction.** Absence from my search does not prove there is none.

**Do pre-checks remove the need?** The evidence points to less work, not none.

- Honolulu reports corrections falling from 23.5 to 7.7 and cycles from 3.4 to 1.4. The sample is 19 versus 17 permits, and the source is a city page citing the vendor's report [CO3]. **7.7 corrections per permit still have to be answered.**
- Seattle found 87% completeness and 92% compliance accuracy, and warned that a cycle only disappears if the tool catches every correction a reviewer would find [SE4].
- One Denver council member voted against the contract over reliability concerns [DN1].

This is a reasonable basis for positioning Redline as the step after the pre-check, but no source tests that directly.

## Architecture: what varies and what stays common

### What varies

| Layer | Item | Evidence | Pack field |
|---|---|---|---|
| **Data** | Code edition by date | Chicago [CH3], Naperville [NV1], Philadelphia [PH4], Portland [PD4], Seattle [SE8], Denver [DN7] | `code_editions[]` with applicability dates |
| **Data** | Layering | Illinois state codes [IL1], Portland by reference [PD5], Seattle model/state/local [SE8], LA on state code [LA3] | `extends: [model, state]` |
| **Data** | Amendment source | Separate PDFs [RF1][EG2], Municode [NV2][JL1], ordinances [EV6] | Per-amendment source URL and verified date |
| **Data** | Sheet and file conventions | Naperville sheet limit [NV2], Oak Park code block [OP1], Joliet naming [JL5], Seattle rejections [SE3] | `sheet_rules` |
| **Data** | Reviewer names | Seattle stations [SE6], Portland 17 types [PD1], SF stations [SF1], Springfield routing [SP2] | `discipline_map`, `agency_map` |
| **Process** | Comment source | Letter [SE6], Bluebeam markups [SF1], portal objections [NY3], Master Comment Report [ATX2] | `comment_source` |
| **Process** | Response form | Replies in plan set [SE3], sealed letter [DN4], bubbled PDF plus letter [EV1], VOID sheets [CK2], comment column [JL3], report plus responses [ATX2], Form 420 [CH6] | `response_format` |
| **Process** | Whole set or changed sheets | Whole: Seattle [SE3], Austin [ATX2], Evanston [EV1], Cook [CK2] | `resubmittal_scope` |
| **Process** | Who may sign or correct | Architect of record [CK2], each professional [CH6], design professional [DN4] | `signoff_rule` |
| **Process** | Timing and escalation | 120 days [CH5], wait for all reviews [SE3][CK2], 3 rounds to supervisor [SF2b], appointment at second round [NY3], fees [ATX2] | `deadlines`, `escalation` |
| **Process** | Dispute path | NYC second review [NY3], Chicago exclusion [CH5], Seattle cite-code rule [SE3] | `dispute_path` |
| **Integration** | Channel | ProjectDox [CH7][RF2][JL5][PD3], Accela [EV1][DN7][SE1], Bluebeam [SE3][SF1][OP2], e-TRAKiT [AU1], OpenGov [SC1], email [EG1][PE1][CK2], DOB NOW [NY3], eCLIPSE [PH7] | `portal_adapter` |
| **Learned rules** | Local reviewer habits | Corrections vary by staff [SE1], SF interpretations differ [SF1] | Scoped rule store |

### What stays common

- **The unit of work.** Comment, sheet, code basis, response. Every process with published detail wants each comment addressed individually [SE3][DN4][ATX2][JL3][CK3][NY3].
- **Disciplines at a canonical level** and the routing categories, with a local map onto them.
- **The professional boundary.** Licensed sign-off recurs across places, even though the rule differs.
- **Agent tools and the shared playbook**, including checks like "does this comment actually cite a code section", which the Seattle audit supports [SE1].

### Where the evidence supports your design

- **Jurisdiction packs.** Process and code differences are large and real.
- **One shared tool set.** The work is structurally the same in every place with published detail.
- **Permit stats as optional.** Most Illinois places have no usable data, so a required field would fail.
- **Shared playbook plus local rules.** Common structure with local variation matches what the audits describe, though **I found no evidence on how well learned rules transfer between cities**. That is a design bet.

### Where it undermines the design

1. **A jurisdiction id is not enough.** Old editions stay live: a 2025 Seattle comment still cites the 2018 code [SE6]. Chicago will run two bases in parallel from now on [CH3]. Tools need the edition, resolved from the application date. `get_section` should treat a section as unverifiable when it does not exist in that edition, not merely in that place.
2. **A flat code index per place repeats work.** Evanston, Rockford, Elgin and Oak Park all sit on 2021 I-Codes. Chicago's new base and Naperville align on 2024. Use shared model-edition section lists, an `il-state` layer, and thin local amendments. Illinois packs then become mostly amendments.
3. **"Reads a correction letter" is too narrow.** San Francisco has no letter, and New York and ProjectDox cities hold comments in the portal. Accept a normalized comment set, with letters as one source.
4. **The current profile field cannot carry this.** `correction_process` holds a name and entry id. The format differences above decide whether a resubmittal is accepted or returned [CK2][SE3], so they need structured fields and a renderer. This is likely the most valuable local content.
5. **Portals should be keyed by vendor, not place.** ProjectDox's "Applicant Resubmit" appears in Chicago, Joliet and Portland [CH7][JL2][PD7]. Many portals are also changing now: Chicago [CH8], Schaumburg [SC1], Evanston [EV2], San Francisco [SF1]. Start with an export package, not write integrations.
6. **Routing needs a dispute outcome.** Your five routes omit it. New York has a formal path [NY3], Seattle requires code citation when declining [SE3], and Chicago's program excludes disputed items [CH5]. The 29% finding suggests this is not rare, though it is one project type from one 2020 sample [SE1].
7. **Stats need definitions attached.** Chicago alone yields 71, 88 and 117. Mean, median, calendar days, business days, and application-to-issue or to-approval all differ. Store measure, population, period and source with every number, and do not compare across places.
8. **Learned rules need scope and expiry.** Key them by jurisdiction, edition and discipline, and mark rules for review when an edition changes. Keep "reviewers tend to ask for X" separate from "the code requires X", because the Seattle audit shows those can diverge [SE1]. Avoid reviewer-level rules, as those are personal data and the need is unproven.
9. **Packs need freshness data.** City pages conflict with each other in Naperville [NV5], Schaumburg [SC1], Aurora [AU3], and Chicago [CH9]. Store a source URL and verified date per fact, allow `unknown`, and use CDB reports as a change signal if the directory proves usable.

I did not research code-text licensing. I-Codes are viewable online [OP1][SE8], but check redistribution terms before storing full text. Keeping section ids and your own short scope paraphrases, as `code.json` does, is the cautious route.

### Next three jurisdictions

1. **Evanston.** It sits on the 2021 I-Codes shared by at least three other ranked Illinois places, so the model layer is reused [EV1][RF1][EG2][OP1]. Its written response rule differs from Chicago's and is easy to test [EV1], and Accela also serves Denver and Seattle [DN7][SE1]. Risk: no measured pain, and amendments still need locating in Title 4.
2. **Naperville.** It forces the edition design, since it pairs with Chicago's 2024-aligned base and exercises date-based applicability [NV1][CH3][CH4]. Amendments are in one code article [NV2], and the reported permit count suggests real volume [NV6]. Risk: thin process documentation, so one call to the permit desk is needed before building.
3. **Seattle.** Line-level correction comments give a real evaluation corpus [SE6], so you can measure discipline sorting and citation accuracy on thousands of actual comments, which no Illinois source allows. It also has explicit response rules [SE3], and a different time split that tests your assumptions [SE5]. Risks: CivCheck may reach production [SE4], and comments stop at September 2025.

**First alternate: Rockford,** if pack-building cost matters most [RF1][RF2]. **Not yet:** Denver and Austin (funded competitors), San Francisco (portal migration, no letter), New York (separate portal-native model, unverified code basis), and Philadelphia and LA (no evidence found).

### Biggest uncertainties

- **Whether Illinois suburbs have this problem at all.** Nothing here shows it. Before building more Illinois packs, get real letters from a few firms or expediters. A few conversations would likely settle more than further desk research.
- **Market size.** Not measured.
- **Willingness to pay** given Comment Letter's per-report pricing [CO5]. I found no price.
- **Whether correction letters can be obtained** outside Seattle. "Not found" reflects limited searching, not a confirmed absence, and public records requests were not explored.
- **Statute details** (the population threshold and any BUILD follow-up).

## Sources

Tags: P primary read directly; P\* primary seen via search excerpt; Q my dataset query on 2026-10-31; S secondary; V vendor claim; OLD older than about three years.

**Illinois statewide**

- **IL1** (P): [Capital Development Board, Building Codes and Regulations](https://cdb.illinois.gov/business/codes/buildingcodesregulations)
- **IL2** (P): [CDB, Illinois Codes FAQ](https://cdb.illinois.gov/business/codes/illinois-codes-faq.html)
- **IL3** (P): [CDB Illinois Municipal Code Directory (no records returned to my fetcher)](https://illinois-code-directory.powerappsportals.us/)
- **IL4** (P\*): [Public Act 103-0510 text](https://www.ilga.gov/documents/legislation/publicacts/103/PDF/103-0510.pdf)
- **IL5** (P\*): [20 ILCS 3105/10.18](https://www.ilga.gov/Documents/legislation/ilcs/documents/002031050K10.18.htm)
- **IL6** (S): [Ancel Glink, May 9, 2024](https://municipalminute.ancelglink.com/2024/05/in-zone-changes-to-building-code.html)
- **IL7** (S): [Ancel Glink, December 2024](https://municipalminute.ancelglink.com/2024/12/day-two-new-year-countdown-statewide.html)
- **IL8** (S): [Capitol News Illinois, June 9, 2026](https://capitolnewsillinois.com/news/pritzkers-spring-wins-come-with-caveats-as-build-megaprojects-bills-stall/)
- **IL9** (P\*): [Illinois SB 4063 (introduced February 19, 2026)](https://ilga.gov/documents/legislation/104/SB/PDF/10400SB4063lv.pdf)
- **IL10** (P\*): [Illinois SB 643, Senate amendment 2](https://ilga.gov/documents/legislation/104/SB/PDF/10400SB0643sam002.pdf)
- **IL11** (P\*): [Illinois State Fire Marshal plan review services](https://sfm.illinois.gov/content/dam/soi/en/web/sfm/sfmdocuments/documents/doc-3fp-a-plan-review-services.pdf)
- **IL12** (S): [Illinois Policy Institute, September 26, 2024 (advocacy group, cites city data)](https://illinoispolicy.org/reports/building-not-permitted-building-permits-in-illinois-are-a-barrier-to-housing-affordability)

**Chicago**

- **CH1** (P\*): [DOB 2025 budget opening statement, November 7, 2024](https://www.chicago.gov/content/dam/city/depts/obm/supp_info/2025Budget/2025BudgetOpeningStatements/Department%20Hearing%20Opening%20Statement%20DOB%20-%20FINAL.pdf)
- **CH2** (S): [Chicago City Wire, October 28, 2026 (primary statement not found)](https://chicagocitywire.com/chicago-buildings-department-reports-88-day-average-permit-time-down-slightly-in-volume)
- **CH3** (P\*): [DOB Code Memorandum 2026-001](https://www.chicago.gov/content/dam/city/depts/bldgs/general/CodeModernization/CodeMemo2026-001.pdf)
- **CH4** (S): [BOMA/Chicago, July 30, 2026](https://www.bomachicago.org/2026/07/30/city-advances-2024-construction-code-updates/)
- **CH5** (P\*): [DOB Certified Plan Corrections](https://www.chicago.gov/city/en/depts/bldgs/supp_info/certified_plan_correctionsinformation.html)
- **CH6** (P\*): [DOB Form 420, revised July 6, 2020](https://www.chicago.gov/content/dam/city/depts/bldgs/general/forms/Form420-070620.pdf)
- **CH7** (P\*): [E-Plan, Upload and Respond (ProjectDox)](https://www.chicago.gov/city/en/sites/eplan/home/pdox.html)
- **CH8** (P\*): [Hansen support procurement memo, January 2026](https://www.chicago.gov/content/dam/city/depts/dps/SoleSource/NCRB2026/Infor%20Public%20Sector%20Inc.%20(DTI)%20-%20Hansen%20and%20IPS%20Software%20License,%20Helpdesk,%20Maintenance%20and%20Support.pdf)
- **CH9** (P\*): [E-Plan Get Help page](https://www.chicago.gov/city/en/sites/eplan/home/help.html)
- **CH10** (P\*): [DOB Changes for 2026](https://www.chicago.gov/city/en/depts/bldgs/provdrs/bldg_code/alerts/2025/december/2026changes.html)
- **CH11** (Q): [Chicago Building Permits dataset, as used in your permit-stats.json](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu)

**Cook County**

- **CK1** (P OLD): [Cook County Auditor, January 15, 2021, FY2018 scope](https://opendocs.cookcountyil.gov/auditor/reports/Building_and_Zone_Inspection_and_Permit_Process.pdf)
- **CK2** (P): [Notice on resolving permit deficiencies (undated)](https://bzpermits.cookcountyil.gov/resources/Resolving_Permit_Deficiencies-Web_Instructions.htm)
- **CK3** (P\*): [Permit tips and submission requirements](https://www.cookcountyil.gov/sites/g/files/ywwepo161/files/service/permittipsandsubmissionrequirements.pdf)
- **CK4** (P\*): [Code posting on the July 29, 2021 adopting ordinance](https://cookcountyil.gov/sites/g/files/ywwepo161/files/code_posting_2021.pdf)
- **CK5** (P): [Building permits service page](https://www.cookcountyil.gov/service/building-permits)
- **CK6** (Q OLD): [Building and Zoning permits FY2005-2011, last updated 2014](https://datacatalog.cookcountyil.gov/d/6myv-3m4t)

**Naperville**

- **NV1** (P): [City building permits page](https://www.naperville.il.us/buildingpermits)
- **NV2** (P\*): [Municipal Code Title 5, Chapter 1](https://library.municode.com/il/naperville/codes/code_of_ordinances?nodeId=TIT5BURE_CH1BUCO_ARTEPLCO_5-1E-1AD)
- **NV3** (S OLD): [Chicago Cityscape, 2017](https://www.chicagocityscape.com/blog/say-hello-to-building-permits-from-naperville-illinoiss-fifth-largest-city-c3ee0cb0d8f2)
- **NV4** (P\*): [Building Permits Issued Reports](https://naperville.il.us/projects-in-naperville/building-permits-issued-reports)
- **NV5** (P\*): [Code Enforcement page, still citing older editions](https://www.naperville.il.us/residents/code-enforcement/)
- **NV6** (S): [News headline on 2023 permits (headline only; article not read)](https://www.yahoo.com/news/naperville-issued-6-287-building-204400010.html)

**Rockford**

- **RF1** (P): [Building Codes and Ordinances](https://rockfordil.gov/383/Building-Codes-Ordinances)
- **RF2** (P): [Plan Review and ProjectDox](https://rockfordil.gov/205/Plan-Review-ProjectDox)

**Evanston**

- **EV1** (P): [Building Permits page](https://www.cityofevanston.org/departments/community_development/building_development_services/building_permits/index.php)
- **EV2** (P\*): [City Launches Phased Updates to Citizen Portal](https://www.cityofevanston.org/Home/Components/News/News/6526/249)
- **EV3** (P\* OLD): [City release, February 7, 2022](https://content.govdelivery.com/accounts/ILEVANSTON/bulletins/3092494)
- **EV4** (P\*): [City Open Data page](https://cityofevanston.org/government/transparency/open-data)
- **EV5** (S): [Third-party catalog, Evanston Building Permits 2009-2020](https://geo.btaa.org/catalog/57df5cf74a5f41a28639477ce9916290_0)
- **EV6** (P\*): [Ordinance 29-O-22 amending Title 4](https://doccenter.cityofevanston.org/WebLink/DocView.aspx?id=86772&dbid=0&repo=Other-City-Departments)

**Aurora**

- **AU1** (P): [Division of Building and Permits](https://www.aurora.il.us/Property-Business/Development/Building-and-Construction)
- **AU2** (P): [Timeframes handout (file created January 9, 2026)](https://www.aurora.il.us/files/sharedassets/mainsite/v/2/development-services/documents/permits/handouts/timeframes.pdf)
- **AU3** (P): [Code Development page](https://www.aurora.il.us/Property-Business/Development/Building-and-Construction/Code-Development)
- **AU4** (P\*): [Older commercial application form](https://www.aurora.il.us/files/sharedassets/mainsite/v/1/development-services/documents/permits/commercial/comn-permit-app_2018_202204121256544305.pdf)
- **AU5** (S): [Aggregator summary, undated](https://cp.soar.com/articles/7035571/Aurora/DuPage-County/Illinois/Aurora-moves-to-adopt-2024-I-series-building-codes-citing-state-requirement-and-ISO-impact)
- **AU6** (P\*): [Ordinance O25-082 (garbled text)](https://s3-us-west-2.amazonaws.com/municipalcodeonline.com-new/aurora-il/ordinances/documents/1767891263_O25-082.pdf)

**Joliet**

- **JL1** (P): [Building code information](https://joliet.gov/government/departments/community-development/building-inspectional-services-division/building-code-information)
- **JL2** (P\*): [Resubmitting Plans and Documents](https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/resubmitting-plans-documents)
- **JL3** (P\*): [Prescreen Review](https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/prescreen-review)
- **JL4** (P\*): [Corrections](https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/eplan-corrections)
- **JL5** (P\*): [File Naming Standards and Requirements](https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/file-naming-standards-requirements)

**Elgin**

- **EG1** (P): [Permits page](https://elginil.gov/2614/Permits)
- **EG2** (P): [Current Codes](https://elginil.gov/315/Current-Codes)
- **EG3** (P\*): [Click2Gov Building Permit](https://elginc2g3.cityofelgin.org/Click2GovBP/index.html)

**Oak Park**

- **OP1** (P): [Permit submittal guide (file created September 29, 2025)](https://www.oak-park.us/files/assets/oakpark/v/1/businessdevelopmentplanning/permit-submittal-guide.pdf)
- **OP2** (P): [Inspections and plan review RFP, August 20, 2025](https://www.oak-park.us/files/assets/oakpark/v/1/rfps/2025/2025-08-20-inspections-and-plan-review-services-rfp.pdf)

**Schaumburg**

- **SC1** (P\*): [Commercial Permits](https://www.villageofschaumburg.com/government/community-development/permit-services/commercial-permits)
- **SC2** (P\*): [Adopted Codes](https://www.villageofschaumburg.com/government/community-development/permit-services/adopted-codes)
- **SC3** (P\*): [Cook County hazard mitigation annex for Schaumburg, 2024](https://www.cookcountyemergencymanagement.org/sites/g/files/ywwepo281/files/document/file/2024-12/Schaumburg%20Volume%202%20%20Cook%20County%20MJ-HMP%20Annex.pdf)
- **SC4** (P\*): [Permit Services](https://villageofschaumburg.com/government/community-development/permit-services)

**Champaign**

- **CP1** (P\*): [Building Safety Division](https://champaignil.gov/?p=2742)
- **CP2** (S): [Champaign County Regional Planning Commission dataset, updated March 2019](https://data.ccrpc.org/dataset/building-permits)

**Springfield, Peoria**

- **SP1** (P\*): [Codes used by the city, revised June 1, 2023](https://www.springfield.il.us/Departments/PublicWorks/Forms/2023CurrentListCodes.pdf)
- **SP2** (P\*): [Building permit application, 2025](https://www.springfield.il.us/Departments/PublicWorks/ApplicationPermits/OnlinePermits/2025/BldgPermitApp2025.pdf)
- **SP3** (P\*): [Phased permit guidance](https://www.springfield.il.us/Departments/PublicWorks/Forms/PhasedPermitApplications.pdf)
- **PE1** (P): [Building Safety](https://www.peoriagov.org/168/Building-Safety)
- **PE2** (P\*): [Permit application, revised June 2023](https://www.peoriagov.org/DocumentCenter/View/4406/Non-Residential--Multi-Family-Building-Permit-Application)

**Seattle**

- **SE1** (P OLD): [City Auditor, October 18, 2023 (just over three years old)](https://seattle.gov/documents/departments/cityauditor/auditreports/constructionpermittingaudit_final.pdf)
- **SE2** (P): [SDCI Construction Permit Performance](https://seattle.gov/sdci/about-us/construction-permit-performance)
- **SE3** (P): [SDCI, How to Respond to Review Comments](https://seattle.gov/construction-and-inspections/permits/how-to-respond-to-review-comments)
- **SE4** (P): [City Innovation and Performance, CivCheck study, June 17, 2026](https://innovation-hub.seattle.gov/2026/06/17/ai-construction-permitting-seattle-civcheck-study/)
- **SE5** (Q): [Building Permits dataset, queried 2026-10-31](https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr/about_data)
- **SE6** (Q): [Plan Comments dataset, queried 2026-10-31](https://data.seattle.gov/Built-Environment/Plan-Comments/e285-aq8h/about_data)
- **SE7** (Q): [Plan Review dataset, queried 2026-10-31](https://data.seattle.gov/Built-Environment/Plan-Review/tqk8-y2z5/about_data)
- **SE8** (P\*): [SDCI Building Code page](https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/building-code)

**San Francisco**

- **SF1** (P): [Budget and Legislative Analyst, March 5, 2026](https://sfbos.archive.sf.gov/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf)
- **SF2** (P): [City permit performance data story](https://www.sf.gov/permit-performance-metrics)
- **SF2b** (P): [Building permit review processes](https://www.sf.gov/learn-about-our-building-permit-review-processes)
- **SF4** (Q): [First and resubmission plan review dataset](https://data.sf.gov/resource/5bat-azvb.json)
- **SF5** (P\*): [Electronic plan review resources](https://www.sf.gov/fil/resource--2021--electronic-plan-review-epr-resources)
- **SF6** (P\*): [SF Building Code on American Legal](https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_building/0-0-0-93884)

**New York**

- **NY1** (P): [Mayor's Management Report FY2026, Department of Buildings](https://www.nyc.gov/assets/operations/downloads/pdf/mmr2026/dob.pdf)
- **NY2** (P): [NY State Comptroller, July 2, 2026](https://www.osc.ny.gov/press/releases/2026/07/dinapoli-nyc-department-buildings-meets-critical-goals-lags-lower-priority-issues)
- **NY3** (P\*): [DOB NOW: Build FAQs (some content dated)](https://www.nyc.gov/site/buildings/industry/dob-now-build-faqs.page)
- **NY4** (P\*): [Determinations FAQ](https://www.nyc.gov/site/buildings/industry/determinations-frequently-asked-questions.page)
- **NY5** (Q): [DOB NOW: Build Job Application Filings (first 60 fields reviewed)](https://data.cityofnewyork.us/d/w9ak-ipjd)

**Denver**

- **DN1** (S): [Denver Gazette/Colorado Politics, March 9, 2026](https://www.coloradopolitics.com/2026/03/09/denver-approves-4-6m-ai-powered-permit-review-contract/)
- **DN2** (S): [Route Fifty, May 22, 2026](https://www.route-fifty.com/artificial-intelligence/2026/05/denver-launches-ai-platform-boost-permitting-efficiency-and-housing-development/413733/)
- **DN3** (P): [Denver Auditor follow-up, letter dated April 2, 2026 (its page reports inconsistent status counts)](https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Auditors-Office/Audit-Services/Audit-Reports/Residential-Permitting-Follow-Up)
- **DN4** (P): [Commercial Building Permit Guide, revised August 3, 2026](https://www.denvergov.org/files/assets/public/v/16/community-planning-and-development/documents/ds/other-forms-and-guides/commercial-permitting-guide.pdf)
- **DN5** (P\*): [2025 Denver Fire Code](https://denvergov.org/files/assets/public/v/3/community-planning-and-development/documents/ds/building-codes/2025_denver_fire_code.pdf)
- **DN6** (P\*): [CPD statement on audit follow-up, 2026](https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Community-Planning-and-Development/CPD-News-and-Events/CPD-News/2026/Residential-permitting-audit-follow-up)
- **DN7** (P\*): [2025 Denver Building Code draft, transition language](https://denvergov.org/files/assets/public/v/1/community-planning-and-development/documents/ds/building-codes/code-adoption/dbc_denver_building_code_except_energy.pdf)

**Austin**

- **ATX1** (P): [Development Process Updates memo, June 22, 2026](https://services.austintexas.gov/edims/document.cfm?id=475645)
- **ATX2** (P): [Commercial Plan Review](https://www.austintexas.gov/development-services/commercial-plan-review)
- **ATX3** (P\*): [Building Technical Codes](https://www.austintexas.gov/page/building-technical-codes)
- **ATX4** (S OLD): [Community Impact, August 30, 2023](https://communityimpact.com/central-austin/government/consultant-report-details-extensive-issues-in-austin-permitting-system-fixes-proposed/)
- **ATX5** (P\*): [Site Plan Performance Metrics](https://www.austintexas.gov/development-services/site-plan-performance-metrics)

**Los Angeles**

- **LA1** (P\*): [LADBS page with plan check time estimates](https://dbs.lacity.gov/services/special-assistance/custodian-of-records?page=19)
- **LA2** (P\* OLD): [Plan check extension policy, revised November 21, 2019](https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/ib-p-bc-2020-120-policy-for-plan-check-extension--rev-11-21-19.pdf)
- **LA3** (P\*): [Ordinance 188797, January 2026](https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/26-ord-188797-260108.pdf)
- **LA4** (P): [LA County-hosted workshop deck, January 31, 2026 (includes vendor slides)](https://file.lacounty.gov/SDSInter/dpw/recovery/1201690_RebuildingTogether_ArchistarDRAFTPPT12226.pdf)
- **LA5** (Q): [Building Permits Issued from 2020 to Present (fields reviewed)](https://data.lacity.org/d/pi9x-tg5x)
- **LA6** (P\*): [Example standard correction sheet, 2023](https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/PC.STR.Corr.Lst.18-%28Rev.-01-01-2023%29--.pdf)
- **LA7** (P\*): [ePlanLA](https://eplanla.lacity.org/Home/About)
- **LA8** (P\*): [LADBS plan review and permitting](https://dbs.lacity.gov/services/plan-review-permitting)

**Philadelphia**

- **PH1** (P): [L&I Ease of Business dataset listing](https://catalog.data.gov/dataset/licenses-and-inspections-ease-of-business)
- **PH3** (P\*): [Amended Building Permit Process, March 25, 2026](https://www.phila.gov/media/20260325090849/P_039_INF_Amended-Building-Permit-Process-rev-3.25.2026.pdf)
- **PH4** (P\*): [2021 I-Code transition materials](https://www.phila.gov/documents/2021-i-code-transition-materials/)
- **PH5** (P\*): [Bulletin B-2501](https://www.phila.gov/media/20251021080549/B-2501-Implementation-of-2021-International-Codes.pdf)
- **PH6** (P\* OLD): [Paper filing FAQ, March 21, 2020](https://phila.gov/media/20200321121629/FAQ-for-applications-filed-on-paper-3.21.20.pdf)
- **PH7** (P\* OLD): [Streets prerequisite approval in eCLIPSE, 2020](https://phila.gov/media/20201124080720/PG-005-INF-Streets-Prerequisite-Approval-final.pdf)
- **PH8** (P\*): [Water Department development review timelines](https://water.phila.gov/development/wp-json/wp/v2/pages/4902)

**Portland**

- **PD1** (P OLD): [City Auditor, March 23, 2021, data from 2018-2019](https://www.portland.gov/auditor/audit-services/news/2021/3/23/building-permit-review-audit)
- **PD2** (P): [New dashboards, July 21, 2025](https://www.portland.gov/ppd/news/2025/7/21/new-dashboards-provide-enhanced-insights-city-portlands-building-permit)
- **PD3** (P): [Check permit timelines](https://www.portland.gov/ppd/how-get-building-permit/check-permit-timelines)
- **PD4** (P\*): [2025 OSSC notice](https://www.portland.gov/ppd/commercial-permitting/news/2025/9/1/new-2025-oregon-structural-specialty-code-and-oregon)
- **PD5** (P\*): [Portland City Code 24.10.040](https://www.portland.gov/code/24/10/040)
- **PD6** (S): [Axios, August 20, 2025 (seen in search excerpt only)](https://www.axios.com/local/portland/2025/08/20/portland-s-construction-permitting-timeline-lags-behind-vancouver)
- **PD7** (P): [ProjectDox ePlans page and linked resubmit guide; V2 detail from a search excerpt](https://www.portland.gov/ppd/get-permit/eplans)

**Competition**

- **CO1** (V): [Clariti CivCheck product page](https://www.claritisoftware.com/products/civcheck-ai-plan-review-software)
- **CO2** (V): [Clariti acquisition announcement, October 2025](https://www.claritisoftware.com/blog/clariti-acquires-civcheck-to-accelerate-permit-approvals-with-ai)
- **CO3** (P): [Honolulu DPP, citing Clariti's performance report for Q1 2026](https://www.honolulu.gov/dpp/city-earns-national-ai-50-award-for-innovative-permit-review-technology/)
- **CO5** (V): [Comment Letter by Ichi, Product Hunt listing, 2026](https://www.producthunt.com/products/comment-letter?embed=true)
- **CO6** (V): [InspectMind comparison page](https://www.inspectmind.ai/compare/permitflow)
- **CO7** (V): [PlanChecker AI announcement](https://journalofcyberpolicy.com/?p=325436)
- **CO8** (S): [Blitz AI directory listing](https://directory.civictech.guide/listing/blitz-ai)
- **CO9** (S): [BD+C on Louisville pilot](https://www.bdcnetwork.com/home/news/55344431/louisville-ky-launches-pilot-project-to-streamline-permitting-and-development-with-ai)
- **CO10** (P\*): [City of Yuma news release](https://www.yumaaz.gov/Home/Components/News/News/2393/308)

**Additions**

- **DN8** (S): [Denverite on the January 2024 audit (search excerpt; direct fetch blocked)](https://denverite.com/2024/01/22/denver-slow-permitting-times-city-audit/)
- **LA9** (P\*): [LA County-hosted workshop deck, second version, March 2026 (seen in search excerpt)](https://file.lacounty.gov/SDSInter/dpw/recovery/1204847_RebuildingTogether_Archistarv2DRAFTPPT31126.pdf)

<!-- link definitions -->
[ATX1]: https://services.austintexas.gov/edims/document.cfm?id=475645
[ATX2]: https://www.austintexas.gov/development-services/commercial-plan-review
[ATX3]: https://www.austintexas.gov/page/building-technical-codes
[ATX4]: https://communityimpact.com/central-austin/government/consultant-report-details-extensive-issues-in-austin-permitting-system-fixes-proposed/
[ATX5]: https://www.austintexas.gov/development-services/site-plan-performance-metrics
[AU1]: https://www.aurora.il.us/Property-Business/Development/Building-and-Construction
[AU2]: https://www.aurora.il.us/files/sharedassets/mainsite/v/2/development-services/documents/permits/handouts/timeframes.pdf
[AU3]: https://www.aurora.il.us/Property-Business/Development/Building-and-Construction/Code-Development
[AU4]: https://www.aurora.il.us/files/sharedassets/mainsite/v/1/development-services/documents/permits/commercial/comn-permit-app_2018_202204121256544305.pdf
[AU5]: https://cp.soar.com/articles/7035571/Aurora/DuPage-County/Illinois/Aurora-moves-to-adopt-2024-I-series-building-codes-citing-state-requirement-and-ISO-impact
[AU6]: https://s3-us-west-2.amazonaws.com/municipalcodeonline.com-new/aurora-il/ordinances/documents/1767891263_O25-082.pdf
[CH1]: https://www.chicago.gov/content/dam/city/depts/obm/supp_info/2025Budget/2025BudgetOpeningStatements/Department%20Hearing%20Opening%20Statement%20DOB%20-%20FINAL.pdf
[CH10]: https://www.chicago.gov/city/en/depts/bldgs/provdrs/bldg_code/alerts/2025/december/2026changes.html
[CH11]: https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu
[CH2]: https://chicagocitywire.com/chicago-buildings-department-reports-88-day-average-permit-time-down-slightly-in-volume
[CH3]: https://www.chicago.gov/content/dam/city/depts/bldgs/general/CodeModernization/CodeMemo2026-001.pdf
[CH4]: https://www.bomachicago.org/2026/07/30/city-advances-2024-construction-code-updates/
[CH5]: https://www.chicago.gov/city/en/depts/bldgs/supp_info/certified_plan_correctionsinformation.html
[CH6]: https://www.chicago.gov/content/dam/city/depts/bldgs/general/forms/Form420-070620.pdf
[CH7]: https://www.chicago.gov/city/en/sites/eplan/home/pdox.html
[CH8]: https://www.chicago.gov/content/dam/city/depts/dps/SoleSource/NCRB2026/Infor%20Public%20Sector%20Inc.%20(DTI)%20-%20Hansen%20and%20IPS%20Software%20License,%20Helpdesk,%20Maintenance%20and%20Support.pdf
[CH9]: https://www.chicago.gov/city/en/sites/eplan/home/help.html
[CK1]: https://opendocs.cookcountyil.gov/auditor/reports/Building_and_Zone_Inspection_and_Permit_Process.pdf
[CK2]: https://bzpermits.cookcountyil.gov/resources/Resolving_Permit_Deficiencies-Web_Instructions.htm
[CK3]: https://www.cookcountyil.gov/sites/g/files/ywwepo161/files/service/permittipsandsubmissionrequirements.pdf
[CK4]: https://cookcountyil.gov/sites/g/files/ywwepo161/files/code_posting_2021.pdf
[CK5]: https://www.cookcountyil.gov/service/building-permits
[CK6]: https://datacatalog.cookcountyil.gov/d/6myv-3m4t
[CO1]: https://www.claritisoftware.com/products/civcheck-ai-plan-review-software
[CO10]: https://www.yumaaz.gov/Home/Components/News/News/2393/308
[CO2]: https://www.claritisoftware.com/blog/clariti-acquires-civcheck-to-accelerate-permit-approvals-with-ai
[CO3]: https://www.honolulu.gov/dpp/city-earns-national-ai-50-award-for-innovative-permit-review-technology/
[CO5]: https://www.producthunt.com/products/comment-letter?embed=true
[CO6]: https://www.inspectmind.ai/compare/permitflow
[CO7]: https://journalofcyberpolicy.com/?p=325436
[CO8]: https://directory.civictech.guide/listing/blitz-ai
[CO9]: https://www.bdcnetwork.com/home/news/55344431/louisville-ky-launches-pilot-project-to-streamline-permitting-and-development-with-ai
[CP1]: https://champaignil.gov/?p=2742
[CP2]: https://data.ccrpc.org/dataset/building-permits
[DN1]: https://www.coloradopolitics.com/2026/03/09/denver-approves-4-6m-ai-powered-permit-review-contract/
[DN2]: https://www.route-fifty.com/artificial-intelligence/2026/05/denver-launches-ai-platform-boost-permitting-efficiency-and-housing-development/413733/
[DN3]: https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Auditors-Office/Audit-Services/Audit-Reports/Residential-Permitting-Follow-Up
[DN4]: https://www.denvergov.org/files/assets/public/v/16/community-planning-and-development/documents/ds/other-forms-and-guides/commercial-permitting-guide.pdf
[DN5]: https://denvergov.org/files/assets/public/v/3/community-planning-and-development/documents/ds/building-codes/2025_denver_fire_code.pdf
[DN6]: https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Community-Planning-and-Development/CPD-News-and-Events/CPD-News/2026/Residential-permitting-audit-follow-up
[DN7]: https://denvergov.org/files/assets/public/v/1/community-planning-and-development/documents/ds/building-codes/code-adoption/dbc_denver_building_code_except_energy.pdf
[DN8]: https://denverite.com/2024/01/22/denver-slow-permitting-times-city-audit/
[EG1]: https://elginil.gov/2614/Permits
[EG2]: https://elginil.gov/315/Current-Codes
[EG3]: https://elginc2g3.cityofelgin.org/Click2GovBP/index.html
[EV1]: https://www.cityofevanston.org/departments/community_development/building_development_services/building_permits/index.php
[EV2]: https://www.cityofevanston.org/Home/Components/News/News/6526/249
[EV3]: https://content.govdelivery.com/accounts/ILEVANSTON/bulletins/3092494
[EV4]: https://cityofevanston.org/government/transparency/open-data
[EV5]: https://geo.btaa.org/catalog/57df5cf74a5f41a28639477ce9916290_0
[EV6]: https://doccenter.cityofevanston.org/WebLink/DocView.aspx?id=86772&dbid=0&repo=Other-City-Departments
[IL1]: https://cdb.illinois.gov/business/codes/buildingcodesregulations
[IL10]: https://ilga.gov/documents/legislation/104/SB/PDF/10400SB0643sam002.pdf
[IL11]: https://sfm.illinois.gov/content/dam/soi/en/web/sfm/sfmdocuments/documents/doc-3fp-a-plan-review-services.pdf
[IL12]: https://illinoispolicy.org/reports/building-not-permitted-building-permits-in-illinois-are-a-barrier-to-housing-affordability
[IL2]: https://cdb.illinois.gov/business/codes/illinois-codes-faq.html
[IL3]: https://illinois-code-directory.powerappsportals.us/
[IL4]: https://www.ilga.gov/documents/legislation/publicacts/103/PDF/103-0510.pdf
[IL5]: https://www.ilga.gov/Documents/legislation/ilcs/documents/002031050K10.18.htm
[IL6]: https://municipalminute.ancelglink.com/2024/05/in-zone-changes-to-building-code.html
[IL7]: https://municipalminute.ancelglink.com/2024/12/day-two-new-year-countdown-statewide.html
[IL8]: https://capitolnewsillinois.com/news/pritzkers-spring-wins-come-with-caveats-as-build-megaprojects-bills-stall/
[IL9]: https://ilga.gov/documents/legislation/104/SB/PDF/10400SB4063lv.pdf
[JL1]: https://joliet.gov/government/departments/community-development/building-inspectional-services-division/building-code-information
[JL2]: https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/resubmitting-plans-documents
[JL3]: https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/prescreen-review
[JL4]: https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/eplan-corrections
[JL5]: https://www.joliet.gov/government/departments/community-development/building-inspectional-services-division/commercial-building-permit-information/commercial-eplan-submittal-instructions/file-naming-standards-requirements
[LA1]: https://dbs.lacity.gov/services/special-assistance/custodian-of-records?page=19
[LA2]: https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/ib-p-bc-2020-120-policy-for-plan-check-extension--rev-11-21-19.pdf
[LA3]: https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/26-ord-188797-260108.pdf
[LA4]: https://file.lacounty.gov/SDSInter/dpw/recovery/1201690_RebuildingTogether_ArchistarDRAFTPPT12226.pdf
[LA5]: https://data.lacity.org/d/pi9x-tg5x
[LA6]: https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/PC.STR.Corr.Lst.18-%28Rev.-01-01-2023%29--.pdf
[LA7]: https://eplanla.lacity.org/Home/About
[LA8]: https://dbs.lacity.gov/services/plan-review-permitting
[LA9]: https://file.lacounty.gov/SDSInter/dpw/recovery/1204847_RebuildingTogether_Archistarv2DRAFTPPT31126.pdf
[NV1]: https://www.naperville.il.us/buildingpermits
[NV2]: https://library.municode.com/il/naperville/codes/code_of_ordinances?nodeId=TIT5BURE_CH1BUCO_ARTEPLCO_5-1E-1AD
[NV3]: https://www.chicagocityscape.com/blog/say-hello-to-building-permits-from-naperville-illinoiss-fifth-largest-city-c3ee0cb0d8f2
[NV4]: https://naperville.il.us/projects-in-naperville/building-permits-issued-reports
[NV5]: https://www.naperville.il.us/residents/code-enforcement/
[NV6]: https://www.yahoo.com/news/naperville-issued-6-287-building-204400010.html
[NY1]: https://www.nyc.gov/assets/operations/downloads/pdf/mmr2026/dob.pdf
[NY2]: https://www.osc.ny.gov/press/releases/2026/07/dinapoli-nyc-department-buildings-meets-critical-goals-lags-lower-priority-issues
[NY3]: https://www.nyc.gov/site/buildings/industry/dob-now-build-faqs.page
[NY4]: https://www.nyc.gov/site/buildings/industry/determinations-frequently-asked-questions.page
[NY5]: https://data.cityofnewyork.us/d/w9ak-ipjd
[OP1]: https://www.oak-park.us/files/assets/oakpark/v/1/businessdevelopmentplanning/permit-submittal-guide.pdf
[OP2]: https://www.oak-park.us/files/assets/oakpark/v/1/rfps/2025/2025-08-20-inspections-and-plan-review-services-rfp.pdf
[PD1]: https://www.portland.gov/auditor/audit-services/news/2021/3/23/building-permit-review-audit
[PD2]: https://www.portland.gov/ppd/news/2025/7/21/new-dashboards-provide-enhanced-insights-city-portlands-building-permit
[PD3]: https://www.portland.gov/ppd/how-get-building-permit/check-permit-timelines
[PD4]: https://www.portland.gov/ppd/commercial-permitting/news/2025/9/1/new-2025-oregon-structural-specialty-code-and-oregon
[PD5]: https://www.portland.gov/code/24/10/040
[PD6]: https://www.axios.com/local/portland/2025/08/20/portland-s-construction-permitting-timeline-lags-behind-vancouver
[PD7]: https://www.portland.gov/ppd/get-permit/eplans
[PE1]: https://www.peoriagov.org/168/Building-Safety
[PE2]: https://www.peoriagov.org/DocumentCenter/View/4406/Non-Residential--Multi-Family-Building-Permit-Application
[PH1]: https://catalog.data.gov/dataset/licenses-and-inspections-ease-of-business
[PH3]: https://www.phila.gov/media/20260325090849/P_039_INF_Amended-Building-Permit-Process-rev-3.25.2026.pdf
[PH4]: https://www.phila.gov/documents/2021-i-code-transition-materials/
[PH5]: https://www.phila.gov/media/20251021080549/B-2501-Implementation-of-2021-International-Codes.pdf
[PH6]: https://phila.gov/media/20200321121629/FAQ-for-applications-filed-on-paper-3.21.20.pdf
[PH7]: https://phila.gov/media/20201124080720/PG-005-INF-Streets-Prerequisite-Approval-final.pdf
[PH8]: https://water.phila.gov/development/wp-json/wp/v2/pages/4902
[RF1]: https://rockfordil.gov/383/Building-Codes-Ordinances
[RF2]: https://rockfordil.gov/205/Plan-Review-ProjectDox
[SC1]: https://www.villageofschaumburg.com/government/community-development/permit-services/commercial-permits
[SC2]: https://www.villageofschaumburg.com/government/community-development/permit-services/adopted-codes
[SC3]: https://www.cookcountyemergencymanagement.org/sites/g/files/ywwepo281/files/document/file/2024-12/Schaumburg%20Volume%202%20%20Cook%20County%20MJ-HMP%20Annex.pdf
[SC4]: https://villageofschaumburg.com/government/community-development/permit-services
[SE1]: https://seattle.gov/documents/departments/cityauditor/auditreports/constructionpermittingaudit_final.pdf
[SE2]: https://seattle.gov/sdci/about-us/construction-permit-performance
[SE3]: https://seattle.gov/construction-and-inspections/permits/how-to-respond-to-review-comments
[SE4]: https://innovation-hub.seattle.gov/2026/06/17/ai-construction-permitting-seattle-civcheck-study/
[SE5]: https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr/about_data
[SE6]: https://data.seattle.gov/Built-Environment/Plan-Comments/e285-aq8h/about_data
[SE7]: https://data.seattle.gov/Built-Environment/Plan-Review/tqk8-y2z5/about_data
[SE8]: https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/building-code
[SF1]: https://sfbos.archive.sf.gov/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf
[SF2]: https://www.sf.gov/permit-performance-metrics
[SF2b]: https://www.sf.gov/learn-about-our-building-permit-review-processes
[SF4]: https://data.sf.gov/resource/5bat-azvb.json
[SF5]: https://www.sf.gov/fil/resource--2021--electronic-plan-review-epr-resources
[SF6]: https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_building/0-0-0-93884
[SP1]: https://www.springfield.il.us/Departments/PublicWorks/Forms/2023CurrentListCodes.pdf
[SP2]: https://www.springfield.il.us/Departments/PublicWorks/ApplicationPermits/OnlinePermits/2025/BldgPermitApp2025.pdf
[SP3]: https://www.springfield.il.us/Departments/PublicWorks/Forms/PhasedPermitApplications.pdf
