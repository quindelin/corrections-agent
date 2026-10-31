# Chicago correction letters: FOIA draft and sharing request

**Status: drafts. Nothing here has been sent.** You review and send them. This is not legal advice. Items a lawyer should check are marked **[lawyer]**.

Prepared 2026-10-31. The sources and the reasoning are in [chicago-real-data-plan.md](chicago-real-data-plan.md).

## Part 1: FOIA request to the Department of Buildings

### Before you send

1. **Confirm where it goes.** `chicago.gov` blocked my fetches (403), so I could not read the [Buildings FOIA page](https://www.chicago.gov/city/en/depts/bldgs/supp_info/bldgs_foia.html). Open it and confirm these:
   - Mail: a search excerpt of that page gives Dept. of Buildings FOIA Officer, 121 N. LaSalle, City Hall Room 900, Chicago 60602.
   - Email: `DOBfoia@cityofchicago.org` comes only from the [Chicago Headline Club list](https://headlineclub.org/foia/chicago/), which is undated and says it is still being updated.
   - Online form: the excerpt mentions one. I did not see its address.
2. **Decide the commercial purpose paragraph with a lawyer. [lawyer]** I kept it in because Emris and Redline are paid products and the statute covers use "for sale, resale, or solicitation or advertisement for sales or services" ([Opinion 23-008](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2023-Binding-PAC-Opinions/23-008.pdf)). Whether testing a paid product counts is a question I can't settle. It is a violation to knowingly obtain a record for a commercial purpose without disclosing that, if the public body asks (section 3.1(c), [county-hosted copy of the Act](https://fultoncountyil.gov/wp-content/uploads/2022/11/FOIA-LAW.pdf), which may predate later amendments). Don't delete the paragraph just to get a faster answer.
3. **Make the bracketed statements true, or remove them.** That includes the entity name and the statement about not republishing.
4. **Paste everything into the body of the email.** Since January 1, 2026, an electronic request must appear entirely in the body, and a public body need not open attachments or links ([AG newsletter, Winter 2026](https://illinoisattorneygeneral.gov/Page-Attachments/PACNLWinter26.pdf)). That is why the permit list is inline.
5. **Send it yourself and watch for a reply.** A public body that reasonably believes a request didn't come from a person can ask you to confirm you are one, and its clock stops until you do. It can deny the request if you don't reply within 30 days, and it can't demand ID for this check (same newsletter).
6. **Expect it to be public.** A search excerpt of the [City's FOIA FAQ](https://www.chicago.gov/city/en/narr/foia/foia_faq.html) says requesters' names and request details are posted on the City's website. A rival could see this request.

### The request (copy from here)

> **Subject:** FOIA request: plan review correction comments on 15 building permits
>
> Dear FOIA Officer,
>
> Under the Illinois Freedom of Information Act (5 ILCS 140), I request copies of the plan review correction comments the Department of Buildings issued to applicants on the 15 building permits listed below. All 15 are Standard Plan Review permits whose descriptions in the City's Building Permits dataset (ydr8-5enu) mention certified corrections.
>
> **What I am asking for, for each permit:**
>
> 1. Each Notification of Corrections Report, or equivalent notice of corrections, sent to the applicant, for every review cycle.
> 2. The text of the corrections and comments recorded for the application: the open and completed corrections in the Dynamic Portal (Hansen), and the review comments, checklist item comments and changemark comments in ProjectDox.
> 3. For each correction or comment, the review discipline, the date issued and the date resolved.
>
> A report or export from those systems, as PDF or CSV, is ideal. These comments are not in the Building Permits dataset, so a link to the data portal would not answer this request.
>
> **What I am not asking for:** architectural or engineering drawings, calculations, sealed documents, the applicant's resubmissions, Form 420, or certified correction sheets. If a comment exists only as a mark on a drawing, please provide its text and sheet number without the drawing. If that can't be done, please leave that comment out and tell me.
>
> **Redactions:** I do not need the name, email, phone number, signature or seal of any private person, so please redact them. A reviewer's discipline is enough in place of the reviewer's name. If you withhold or redact anything else, please release the rest and state the exemption and the factual basis for it.
>
> **Commercial purpose:** This request is for a commercial purpose. [Entity name] builds software that helps architects and permit expediters respond to correction comments, and the records would be used to test and improve that software. [The records will not be resold or republished as a collection.]
>
> **Format and fees:** Please send the records electronically to the email address below. Please tell me before incurring fees above $[amount].
>
> **If this is too much to do at once:** please contact me before denying any part of this request as burdensome. I would gladly take the permits in batches, or start with the first review cycle on the first five permits.
>
> **Permits** (permit number, address):
>
> 101081137, 950 W Willow St
> 101073001, 1930 S Desplaines St
> 101081591, 2631 S Throop St
> 101080842, 6027 N Kenmore Ave
> 101075627, 6025 S Prairie Ave
> 101073799, 1612 N Mobile Ave
> 101072006, 507 S California Ave
> 101069488, 847 W North Ave
> 101076723, 4949 N Damen Ave
> 101072377, 3814 W Chicago Ave
> 101071996, 346 W Armitage Ave
> 101075489, 3455 N Elston Ave
> 101077251, 1889 N Milwaukee Ave
> 101080479, 3734 W Wrightwood Ave
> 101076060, 5158 W Agatite Ave
>
> Thank you.
>
> [Your full name]
> [Entity name, if any]
> [Mailing address]
> [Email]
> [Phone]

*(Stop copying here.)*

### The permits

From the [Building Permits dataset](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu), retrieved 2026-10-31. "Days" is the dataset's `processing_time`, which does not split City time from applicant time. Work summaries are mine. Every permit's description includes a certified corrections marker, and every permit's status was `ACTIVE` on that date. All were reviewed under pre-2026 codes, as their dates and the "2019" tags on 13 of the descriptions indicate.

| Permit | Address | Type | Started | Issued | Days | Reported cost | Work |
|---|---|---|---|---|---|---|---|
| 101081137 | 950 W Willow St | New | 2026-04-04 | 2026-09-01 | 150 | $950,000 | 3 stories, 4 units, roof deck, rear steel stair |
| 101073001 | 1930 S Desplaines St | New | 2025-08-13 | 2026-03-31 | 230 | $600,000 | 3 stories, 4 units, R-2 |
| 101081591 | 2631 S Throop St | New | 2026-04-01 | 2026-05-18 | 47 | $1,150,000 | 9-unit townhouse building |
| 101080842 | 6027 N Kenmore Ave | New | 2026-03-13 | 2026-07-17 | 126 | $2,700,000 | 5 stories, 24 units, elevator penthouse |
| 101075627 | 6025 S Prairie Ave | New | 2025-10-26 | 2026-01-09 | 75 | $500,000 | 3-story frame three-flat, balconies, rear decks |
| 101073799 | 1612 N Mobile Ave | New | 2025-09-16 | 2026-03-26 | 191 | $2,237,941 | Restaurant with drive-through |
| 101072006 | 507 S California Ave | New | 2025-07-21 | 2026-07-30 | 374 | $700,000 | Gas station building |
| 101069488 | 847 W North Ave | New | 2025-07-15 | 2026-08-19 | 400 | $1,200,000 | 1-story retail, surface parking |
| 101076723 | 4949 N Damen Ave | Alteration | 2025-11-21 | 2026-01-09 | 49 | $250,000 | Fire damage repair, 3 retail spaces |
| 101072377 | 3814 W Chicago Ave | Alteration | 2025-07-30 | 2026-01-09 | 163 | $25,000 | Nail salon in a mixed-use building |
| 101071996 | 346 W Armitage Ave | Alteration | 2025-08-06 | 2026-03-05 | 211 | $500,000 | Restaurant renovation, lower-level access |
| 101075489 | 3455 N Elston Ave | Alteration | 2025-10-17 | 2026-07-06 | 262 | $700,000 | Warehouse to animal shelter and kennel |
| 101077251 | 1889 N Milwaukee Ave | Alteration | 2025-12-05 | 2026-06-10 | 187 | $200,000 | Retail to children's day care |
| 101080479 | 3734 W Wrightwood Ave | Alteration | 2026-03-05 | 2026-06-16 | 103 | $145,000 | New basement garden unit |
| 101076060 | 5158 W Agatite Ave | Alteration | 2025-10-31 | 2026-01-02 | 63 | $120,000 | Two-unit alterations, rear porch replacement |

**Alternates, if one is unusable (not part of the request):** 101080659, 3460 W Lawrence Ave (office to residential); 101076704, 2032 W Roscoe St (restaurant alterations); 101078831, 1222 S Millard Ave (coach house renovation).

### How the sample was chosen

The goal was permits that almost certainly have correction records and few privacy problems.

1. **Filter on the data portal:** `review_type = 'STANDARD PLAN REVIEW'`, issued 2026-01-01 through 2026-09-30, started on or after 2025-06-01, status `ACTIVE`, reported cost at least $25,000, and a description matching `CERTIFIED…CORRECTION`. That left 408 permits.
2. **Remove likely problems:** government-linked projects, owner-occupied properties, owners named as individuals, permits with no architect listed, and revisions. This is a name and keyword filter, so it isn't perfect.
3. **Draw by project type:** order each type by a seeded hash, then take the first permits in order, skipping repeated addresses.
4. **Hand adjustments, so this isn't purely random:** I replaced two single-family projects with alternates (6027 N Kenmore Ave and 847 W North Ave).

Why the marker matters: 575 of 3,061 Standard Plan Review permits issued so far in 2026 carry text like "CERTIFIED CORRECTIONS SUBJECT TO FIELD INSPECTIONS & AUDIT". The marker shows the permit used the program. It does not guarantee the City still holds every comment.

### If the City pushes back

| Likely response | Basis | What you could say |
|---|---|---|
| Plans are exempt | Section 7(1)(k) covers architects' plans, engineers' technical submissions and "other construction related technical documents" on privately funded projects, with no security showing needed ([Opinion 25-012](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2025-Binding-PAC-Opinions/Binding%20Opinion%2025-012.pdf), September 2, 2025; [Edwardsville, 2022, non-binding](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/Non-Binding-PAC-Opinions/FOIA/7_1/Exemptions-which-permit-redacting-withholding-exempt-information-records/7_1_k/69505%2069506,%20issued%20May%2019,%202022.pdf)). | The request excludes drawings and asks only for the City's own comments. **[lawyer]** I found no ruling on whether a reviewer's comments are "construction related technical documents". This is the biggest legal unknown. |
| Comments are preliminary | Section 7(1)(f) | [Opinion 21-004](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2021-Binding-PAC-Opinions/21-004.pdf) (May 24, 2021) held that a city's review comments sent to a zoning applicant were not covered, because the applicant is a third party with its own interests. It concerned a zoning case in Geneva, not building plan review. The request covers only comments issued to applicants, not internal notes. |
| Personal information | Sections 7(1)(b) and (c) | The request already asks for these to be redacted. |
| Business information | Section 7(1)(g), which requires information furnished under a claim of confidentiality and a showing of competitive harm | The comments are written by the City. Applicant-supplied content can be redacted. |
| Security | Section 7(1)(v) | The sample excludes government-linked projects as far as the filter could tell. Offer to drop any permit the City identifies. |
| Too burdensome | Section 3(g) | It must offer a chance to confer first ([Opinion 21-001](https://illinoisattorneygeneral.gov/Page-Attachments/FOIAPAC/2021-Binding-PAC-Opinions/21-001.pdf), January 26, 2021, on this duty, in a Chicago Police Department case; I read only its opening pages). Offer the first five permits. |
| "See the website" | A search excerpt says the Buildings FOIA page refers address-based requests to the City's online data sites. | Ask which site shows the corrections for these issued permits. The [status site's help page](https://webapps1.chicago.gov/buildingpermit/help) says issued permits may not appear. If the City points you there, keep that reply: it would help settle whether you may use the site (see the plan, route 1). |
| No records | Unknown retention | Ask whether the comments were purged and under which retention schedule. |

**Timing:** a commercial request gets a response within 21 working days, which may be an estimate rather than the records, and non-commercial requests get priority (section 3.1). Otherwise the deadline is 5 business days, extendable by 5 more (sections 3(d) and (e)). **Fees:** for a commercial request, up to $10 per hour for search and redaction review, with the first 8 search hours free (section 6(f), as quoted in Opinion 23-008). **If denied:** you have 60 days to ask the Public Access Counselor for review (section 9.5(a)), or you can sue (section 11). A denial must give a detailed factual basis (section 9(a)). **[lawyer]** Check the current Act: the copy I could read may predate later changes, and [ilga.gov](https://www.ilga.gov) blocked my fetch.

## Part 2: Request to an architect or expediter

Short enough to send as an email. You send it. Fill in the brackets, and only keep promises you can meet.

> **Subject:** Could you share a few Chicago correction reports?
>
> Hi [name],
>
> I'm building [product], which helps architects and expediters respond to Chicago Department of Buildings plan review comments. To test whether it works on real Chicago comments, I'm looking for 3 to 10 recent correction reports from Standard Plan Review projects you worked on.
>
> **What would help most:** the Notification of Corrections Report or the comment export from ProjectDox, plus how many review cycles the project took. If you're willing, your response is useful too. I don't need drawings, calculations or sealed documents.
>
> **Confidentiality:**
>
> - Remove anything you like before sending, including names, addresses, permit numbers and your firm's name. Comment text and code citations are the part I need.
> - I'll use them only to test and improve [product]. I won't publish them, quote them or attribute them without your written OK, and I won't give them to the City or to your competitors.
> - They would be stored [where], accessible to [who]. Comment text is processed by [the AI model provider and gateway used], under [their data terms].
> - Tell me at any time and I'll delete them and confirm that I have. Results already computed may remain in anonymous form, without any comment text.
> - I'm happy to sign your NDA, or to send you one.
>
> **Please check your side first:** your client agreement or your client's permission may matter, since the letters concern their projects.
>
> [Optional, only if you mean it: In return, I'd run your current correction letter through [product] at no charge.]
>
> If yes, reply here or send them to [address]. If you'd rather talk first, I'm at [phone].
>
> Thanks,
> [Your name]

**Check these before using it. [lawyer]** A lawyer should review the NDA and the confidentiality promises. Confirm the storage and AI processing lines against the real setup: [docs/emris-integration.md](emris-integration.md) describes a target design with encrypted letters that isn't built yet, and Redline's agent runs through a third-party gateway. Don't send this to someone until those brackets are true.
