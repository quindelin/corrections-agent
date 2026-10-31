# Redline government records agent

Drafts requests for real building plan review comments from government agencies, tracks what happens, learns from the outcomes, and turns what arrives into private test letters. **It cannot send anything.** It has no sending tool and no network code, and you send every request yourself.

Redline's biggest weakness is too little real data. It has only Seattle's public comments, and no real Chicago letters are public. This agent is how we ask for more.

```
targets + law data ─► draft ─► gate ─► you review ─► approve ─► export ─► YOU SEND ─► log ─► due / follow-ups
                                                                                       │
                     private test letters ◄─ build ◄─ you resolve ◄─ scrub ◄─ intake ◄─┤
                                                                                       ▼
                                   you spot-check ◄─ audit ◄─ scope checks ◄─ learn: proposes playbook changes, as a git diff
```

It's separate from the customer outreach agent in `outreach/`. It runs as its own TrueForge agent, `redline-gov-records`, and doesn't touch `agent/`, `evals/`, `runs/`, `realdata/seattle/`, `outreach/` or `demo/`. It reuses one thing from `outreach/`: the Fisher test in `stats.ts`.

**Nothing has been sent, submitted or filed. This isn't legal advice.** Questions for a lawyer are in [Needs a lawyer](#needs-a-lawyer).

## Drafts ready for your review

Each file holds the exact text, where it goes, the source of that contact, what to check first and what to ask a lawyer. Brackets mark your details and your decisions.

| Draft | Kind | Goes to | Contact evidence | Law as checked |
|---|---|---|---|---|
| [chicago-dob-5-permits](drafts/chicago-dob-5-permits.md) | Records | Chicago Buildings FOIA Officer, by mail | Search excerpt | Illinois: official text |
| [tucson-permission](drafts/tucson-permission.md), then [tucson-10-permits](drafts/tucson-10-permits.md) | Permission, then records | `cot-prr@tucsonaz.gov` | Search excerpt | Arizona: official site, summarized |
| [santa-cruz-permission](drafts/santa-cruz-permission.md), then [santa-cruz-10-permits](drafts/santa-cruz-10-permits.md) | Permission, then records | County NextRequest portal | Read directly | California: unofficial copy, and a new law not fully read |
| [seattle-open-data-permission](drafts/seattle-open-data-permission.md) | Permission | `open.data@seattle.gov` | Read directly | Not a records request |
| [seattle-sdci-10-letters](drafts/seattle-sdci-10-letters.md) | Records, **on hold** until the open data team answers | City request center | Read directly | Washington: official text |
| [puyallup-5-letters](drafts/puyallup-5-letters.md) | Records | City Clerk, by mail | Search excerpt of a code that may date to 2006 | Washington: official text |
| [everett-5-letters](drafts/everett-5-letters.md) | Records | GovQA portal | Search excerpt | Washington: official text |
| [salem-5-comment-sets](drafts/salem-5-comment-sets.md) | Records | **Unknown.** Find the portal on the City's page | Search excerpt only | Oregon: official site, summarized |
| [louisville-3-letters](drafts/louisville-3-letters.md) | Records | City Clerk's form | Read directly | Colorado: unofficial copy |

The code won't let you approve a draft until each contact seen only in a search excerpt has been confirmed by you, or while brackets remain.

## What I found that changes our plans

1. **A commercial requester in Illinois mostly can't use the Public Access Counselor.** [Section 9.5(b)](https://ilga.gov/Documents/legislation/ilcs/documents/000501400K9.5.htm) bars it, except to dispute being classified as commercial. Our Chicago docs said otherwise, and I corrected them. Declaring a commercial purpose now costs 21 working days, lower priority, search fees and most of the appeal route. It's still the honest default, so ask a lawyer rather than deleting it.
2. **California changes its deadlines.** [AB 1821](https://calmatters.digitaldemocracy.org/bills/ca_202520260ab1821) was chaptered on September 30, 2026 (Chapter 899). As read, it moves 10 and 14 calendar days to business days, adds search-time charges past 2 hours on a request, and only starts the clock if you use a method the agency designates. I inferred a January 1, 2027 start, and I couldn't read the official text. The tracker picks the rule by the date a request arrives.
3. **Arizona can charge for commercial value.** [A.R.S. 39-121.03](https://www.azleg.gov/ars/39/00121-03.htm) lets a public body add the record's value on the commercial market to its fee, and damages for misuse are three times the fee. Ask for the amount first.
4. **Washington bars lists of individuals for commercial use.** [RCW 42.56.070](https://lawfilesext.leg.wa.gov/law/RCWPDF/RCW%20%2042%20%20TITLE/RCW%20%2042%20.%2056%20%20CHAPTER/RCW%20%2042%20.%2056%20.070.pdf) is why those drafts say they don't want names. Whether comment records could count as a list is for a lawyer.
5. **Seattle's test set contained staff names.** The name check flagged an apparent personal name in `realdata/seattle/letters.json`. A follow-up scan found 7 city staff, and they've since been removed from the current file.

## Use it

You need TrueForge running with the model in `agent/agent.json`. `status` shows where things stand.

**1. Say who you are.** Copy `sender.example.json` to `data/sender.json`. Use your real entity. Approval is blocked until it's complete, and the code refuses press, academic, nonprofit or government-sounding names.

**2. Read the targets and laws.**

```bash
npx tsx gov-outreach/cli.ts targets
```

```bash
npx tsx gov-outreach/cli.ts laws
```

**3. Draft and read every one.** `draft` lets the model reword the records list, following the playbook, and checks the result. `--no-model` uses the source text as written, which is what's in `drafts/`.

```bash
npx tsx gov-outreach/cli.ts draft --target chicago-dob
```

```bash
npx tsx gov-outreach/cli.ts review
```

**4. Confirm the contact yourself, where it came from a search excerpt.**

```bash
npx tsx gov-outreach/cli.ts confirm-contact --target chicago-dob --value "address you read" --source "page you read it on"
```

**5. Approve in your own terminal, or reject with a reason.** `learn` reads the reasons.

```bash
npx tsx gov-outreach/cli.ts approve --id R-xxxxxx
```

**6. Export, send it yourself, and log the date.** The agent never assumes a sent date.

```bash
npx tsx gov-outreach/cli.ts export
```

```bash
npx tsx gov-outreach/cli.ts log --id R-xxxxxx --event sent --date 2026-11-02 --channel mail
```

**7. Log what comes back, and check what's due.**

```bash
npx tsx gov-outreach/cli.ts log --id R-xxxxxx --event fee_quote --amount 85 --on 2026-11-10
```

```bash
npx tsx gov-outreach/cli.ts due
```

```bash
npx tsx gov-outreach/cli.ts followup --id R-xxxxxx --kind overdue
```

Events are `acknowledged`, `estimate`, `extension`, `classified`, `clarification_requested`, `clarification_answered`, `fee_quote`, `fee_response`, `narrowed`, `partial_grant`, `records_received`, `denial`, `no_records`, `appeal_filed`, `appeal_decided`, `withdrawn` and `closed`. Follow-ups are `status`, `overdue`, `narrowing` and `appeal`. **Log every denial with its exemption**, because `learn` can't read what you don't log.

**8. When records arrive,** see [Intake](#intake).

**9. Learn.**

```bash
npx tsx gov-outreach/cli.ts learn
```

```bash
git diff -- gov-outreach/agent/playbook
```

```bash
npx tsx gov-outreach/cli.ts spotcheck
```

Nothing is committed unless you pass `--commit`, which adds an `Agent-Session` trailer.

## What each step guarantees

**Nothing goes out by itself.** The agent's TrueForge spec has no MCP servers, web search, sandbox or sub-agents, and that's checked after saving. No file here uses a network call, a mail library or a browser, and a unit test reads the source to confirm it. There's no send command. Approval hashes the exact text and needs a person at a terminal typing that hash. Changing the sender, target or law data afterward voids the approval. That terminal check prevents accidents, and isn't a security boundary. The real boundary is that nothing here can send.

**Nothing false about who's asking.** Code writes the identity and purpose paragraphs from `targets.json` and `laws.json`. Every draft says the work is commercial and that we intend to charge. A gate reads the finished text and blocks press, student, academic, nonprofit and government wording, "not commercial" and "for research" framing, threats, invented urgency, product claims, and "any and all" scope.

**Law lives in data.** `laws.json` holds each state's clock, extension, fees, commercial rule and appeals, with a source and how it was checked. A rule also has dates, so a new law doesn't rewrite old requests. A unit test confirms no state is named in the deadline code. Adding a state means adding data. **The learning step can't edit `laws.json`, `targets.json` or `policy.json`.**

**No guessing contacts.** Each one stores its source URL, date and whether it was read directly or seen in a search excerpt. An unknown stays null.

**Small asks.** First requests are capped at 15 records, and most ask for 3 to 10. One open request per agency, two in any 180 days, and the same ask never twice. These limits are my judgment, not law.

## Deadlines and what they don't do

| State | Clock as read | Silence | Appeal windows found |
|---|---|---|---|
| Illinois, commercial | [21 working days](https://ilga.gov/Documents/legislation/ilcs/documents/000501400K3.1.htm) | Unclear | Counselor 60 days, classification only. Suit: none stated |
| Illinois, non-commercial | [5 + 5 business days](https://ilga.gov/Documents/legislation/ilcs/documents/000501400K3.htm) | Denial | Counselor 60 days. Suit: none stated |
| Arizona | [Promptly, no number](https://www.azleg.gov/ars/39/00121-01.htm) | Denial, if not prompt | [Special action](https://www.azleg.gov/ars/39/00121-02.htm): none stated |
| Washington | [5 business days](https://lawfilesext.leg.wa.gov/law/RCWPDF/RCW%20%2042%20%20TITLE/RCW%20%2042%20.%2056%20%20CHAPTER/RCW%20%2042%20.%2056%20.520.pdf), then the agency's estimate | Unclear | [Court: 1 year](https://lawfilesext.leg.wa.gov/law/RCWPDF/RCW%20%2042%20%20TITLE/RCW%20%2042%20.%2056%20%20CHAPTER/RCW%20%2042%20.%2056%20.550.pdf) |
| Oregon | [5 business days to acknowledge, 10 more to complete or estimate](https://www.oregonlegislature.gov/bills_laws/ors/ors192.html) | Denial | District attorney, court: none found |
| Colorado | [3 working days, up to 7 more](https://colorado.public.law/statutes/crs_24-72-203) (unofficial copy) | Unclear | [Court, after 14 days' notice](https://colorado.public.law/statutes/crs_24-72-204): none stated |
| California, 2026 | [10 + 14 calendar days](https://california.public.law/codes/government_code_section_7922.535) (unofficial copy) | Unclear | Court, not read |
| California, from 2027 | [10 + 14 business days](https://calmatters.digitaldemocracy.org/bills/ca_202520260ab1821), as read, start inferred | Unclear | Court, not read |

All checked 2026-10-31. "None stated" means the sections I read give no deadline, not that there isn't one. **A general limitations period may apply, so ask a lawyer.**

- **Dates can run a day or so long.** Federal holidays are counted, but state and local ones aren't, so `overdue` waits one extra business day and follow-ups say "by my count".
- **Where the law has no number,** you get a reminder clearly marked as not a legal deadline.
- **Follow-ups never accuse anyone.** They're written by code from the data, not by the model. Appeal options are labeled as options for you and a lawyer.

## Self-improvement

`learn` reads outcomes and rewrites the playbook: `agent/playbook/general.md` plus one file per place. Each file holds rules in a JSON block.

**General and local rules are separated in code,** because a shared rule that only suited one city caused a real regression here, and a self-improvement run deleted another city's rule. The model proposes operations, never file text. `scope.ts` then refuses:

- a general rule that names a place, agency, state, law, statute section or local system. The list comes from the data, so a new target extends it
- a general rule resting on fewer than two places in two states
- a place's rule resting on another place's request, or a rule retired with another place's evidence
- a general rule retired on one place's evidence, and any starting principle or locked rule retired by the model
- anything marked `learned`, because only code can declare that
- evidence that doesn't show what the rule claims, conclusions, rates, statements of law, contact details, private text, or text quoted from a record
- anything suggesting we hide who's asking, imply an affiliation, automate access, or send more or repeated requests, **even if the outcomes favor it**

A draft only sees general rules plus its own place's, and only `active` ones.

### The measure

**Usable records per closed request.** A record counts as usable only when intake builds it into a letter, so the number can't be typed in. A request closes when you close it, or after 120 days. Silence then counts as zero, or slow agencies would drop out and flatter a route. Response rate is shown for context and drives nothing: a prompt denial is a response that gets us nothing.

### How much data is enough

**The minimum is 12 closed requests on each side of a comparison, from at least 4 agencies in at least 3 states, with at most 3 counted per agency per side.** Below that, `metrics` and `learn` say so and nothing is declared learned, however large the gap. 12 is what 4 agencies at 3 each gives, because replies from one office aren't independent.

Exact calculations for the first look (alpha 0.025), on "got any usable record":

| True rates | Chance of finding it at 8 per side | At 12 | At 15 | At 20 | At 30 |
|---|---|---|---|---|---|
| 80% vs 20% | 35% | 66% | 78% | 94% | 100% |
| 70% vs 20% | 20% | 43% | 56% | 80% | 95% |
| 70% vs 30% | 10% | 23% | 31% | 54% | 76% |
| 60% vs 30% | 4% | 11% | 15% | 29% | 45% |

At 12 per side, 2 of 12 needs at least 9 of 12 to win, and a false winner happens under 1% of the time if the rates are really equal.

- **Below about 10,** even a large real gap is more likely to be missed than found.
- **So 12 finds only big differences.** Expect `no_clear_difference` often, and read it as "this data can't tell", not "they're the same".
- **Reaching it will take a long time.** 9 agencies, at 2 requests per 180 days, can't reach 24 balanced closed requests in under about a year. **For the first year, expect no learned rules.** Per-place observations and your own reading of the replies will teach you more.
- **Then, generalization.** Tests run at fixed looks with alpha halved each time. Fisher and usable records per request must agree. The direction must survive dropping any one state, and at least two states must show it directly. A gap from one state gets `one_place_only`.
- **It isn't an experiment.** Requests aren't randomized, so a difference can still come from which agencies got which kind of ask. The leave-one-state-out check helps, and it doesn't remove this. That's one reason a person checks every rule.

### Spot-checking false rules

Scorers can't catch a false rule, so there are three layers:

1. **Code** checks that each cited request shows what the rule claims, and writes a tally over every request in the scope, so counterexamples stay in view.
2. **An audit turn** sees the rule and raw rows without the learner's reasoning. Unsupported or unclear rules are dropped and listed in the report.
3. **You.** New rules start as `proposed` and can't reach a draft until you read them against the raw evidence with `spotcheck`. False ones are retired and counted in Standing. A learned rule goes through this too.

**Measured, one run, on planted fictional rules:** see [Testing](#testing). The audit isn't reliable alone.

## Intake

Records stay in `data/`, which is gitignored. Every write checks that git ignores the path. **There's no publish step, and this repo is public.**

```bash
npx tsx gov-outreach/cli.ts intake add --id R-xxxxxx --file ~/Downloads/letter.pdf --received 2026-12-01 --doc-date 2026-03-03 --conditions "none stated" --may-test unknown
```

```bash
npx tsx gov-outreach/cli.ts intake resolve --letter L-xxxxxx --strip "exact name"
```

```bash
npx tsx gov-outreach/cli.ts intake build
```

1. **Register:** copies the file privately, with its hash, source, dates and any conditions on use, in the agency's words. Conditions are required, and unknown isn't treated as allowed. Duplicates are refused.
2. **Scrub:** removes emails, phones, links, street addresses, license numbers, signature blocks, labeled names and titled names.
3. **Check:** rereads the result with different, looser patterns. Anything name-like needs your decision, and open items block the letter.
4. **Build:** writes `data/letters/<place>.json` in the shape of `realdata/seattle/letters.json`, with citations hidden from the text and kept as labels, plus source, dates, conditions and `publish_decision: "undecided"`. A record whose conditions forbid testing isn't built. **Only this step can mark a record usable.**

Read every scrubbed copy yourself. The patterns miss things (see below). Scanned PDFs need OCR first and are refused until then. Running a letter through Redline sends it to a third-party gateway, so decide that for each set before you run it, and check `may_send_to_model`.

## Testing

Offline, with no model calls:

```bash
npx tsx gov-outreach/tests/unit.ts
```

The whole loop on fictional agencies, laws and outcomes, in throwaway homes with their own git repos. It contacts nobody, because every address uses a reserved `.example` domain. `--skip-model` runs it for free.

```bash
npx tsx gov-outreach/tests/e2e.ts --dir "$(mktemp -d)"
```

**What the last run showed, on 2026-10-31.** 174 unit checks and 84 end-to-end checks passed. All of it used fictional agencies and outcomes.

Works, and tested:

- Drafting through the gate, approval, export and sent logging, including every refusal.
- Deadlines for all six states, including the date-based California change and the Illinois appeal limit.
- Extensions, estimates, fee quotes, clarifications, partial grants, denials, appeal windows and all four follow-ups.
- Intake through to a letter in the expected shape, with source, dates and conditions kept, and no way to publish.
- Rule separation. Six planted bad proposals through the real files and git were all refused, including a one-city rule in the shared file and another city's evidence retiring a rule. A one-state result with p=0.014 got `one_place_only`.
- The model proposing rules on richer fictional outcomes. In one run it proposed five: three were written as `proposed`, code rejected one with false evidence, and the audit dropped one general rule as unsupported.

**Don't over-trust these:**

- **The audit caught 3 of 4 planted false rules and kept 2 of 2 true ones,** in one run. It passed "this office reliably releases letters" on one success and one denial. That's why you check every rule yourself. These cases are also too few to give a rate.
- **Names.** On two sets of 20 fictional hard cases, the scrubber and check together got 20 of 20 (the set I tuned on, 12 removed and 8 flagged) and 19 of 20 (a set written afterward, 9 removed and 10 flagged). I wrote both, so neither is independent, and real letters will be harder. A lowercase name in passing gets through, and a name made of ordinary words may too.
- **The check is noisy.** On the 20 real comments in Seattle's holdout letters, it flagged 11, mostly ordinary phrases like "Height Limits". Expect to read every copy anyway.
- **A hard-limit hole got through until this run:** a proposal passing along "staff prefer requests that do not mention commercial use" cleared the check. I fixed that wording, but patterns can miss a new phrasing, which is another reason nothing reaches a draft before you read it.
- **Model behavior varies.** Earlier prompt versions proposed nothing at all, and the same outcomes can give different proposals on a rerun.

**Not tested:**

- Any real agency reply, real letter or real scanned PDF. Only text and CSV paths ran end to end, and PDF text extraction didn't run here.
- Whether agencies accept these drafts, how they read commercial purpose, or whether the sample definitions match how their records are kept.
- `learn --commit` in this repo. It ran in test repos only.
- A real terminal approval. Tests use a flag that only works in a test home.
- State and local holidays, which aren't in the deadline math.

## Needs a lawyer

1. **Is testing a paid product a "commercial purpose"** in Illinois ([section 2(c-10)](https://ilga.gov/Documents/legislation/ilcs/documents/000501400K2.htm): sale, resale, or solicitation or advertisement) and in Arizona (any purpose with anticipated monetary gain)? The Illinois definition is narrower. Declaring it has real costs, and hiding it could be a violation if asked.
2. **Are a reviewer's comments exempt?** I found no ruling on whether they're "construction related technical documents" under Illinois 7(1)(k), and I didn't research this question in the other five states.
3. **What's the right wording for each commercial statement?** All of it needs review, and Arizona's most.
4. **May we store, reuse or show these records in a commercial product,** including text naming projects? Does anything differ when an agency sets conditions?
5. **Could comment records count as a "list of individuals"** under RCW 42.56.070(8)?
6. **What does AB 1821's chaptered text say?** I read only an interleaved copy.
7. **Does Tucson's "personal use" disclaimer limit a company's testing?** Does Salem's `ai-train=no` signal matter once a city hands over records itself?
8. **What are the real limitation periods** for court review where the sections I read state none?
9. **What's the risk of naming the requester publicly?** Chicago reportedly posts requesters' names and request details.

## Access log

Every factual claim about an agency or law is in `agent/laws.json` or `agent/targets.json`, with its URL, date and how it was read. All of this happened on 2026-10-31.

| Host | Result | What I did |
|---|---|---|
| `ilga.gov` | Open | Read 5 ILCS 140 sections 2, 3, 3.1, 6, 9, 9.5 and 11 directly, with curl and the 10-second crawl delay. WebFetch failed on its certificate, so I used curl with normal verification. |
| `azleg.gov`, `oregonlegislature.gov` | Open | Read through a fetch tool that summarizes. Oregon: first 200,000 of 362,787 characters of the chapter. |
| `app.leg.wa.gov` | `Disallow: /` | Not fetched. |
| `lawfilesext.leg.wa.gov` | No robots file | Read 5 RCW PDFs, certified 7/15/2026, directly. WebFetch also saved one copy of RCW 42.56.520 to its tool-results folder, as it does with PDFs. |
| `leginfo.legislature.ca.gov` | Robots 403 | Not fetched, because the rule can't be read. |
| `colorado.public.law`, `california.public.law` | Open | Unofficial copies, summarized. |
| `calmatters.digitaldemocracy.org` | Open | AB 1821 history and interleaved text, summarized. |
| `www.seattle.gov`, `seattle.gov`, `data.seattle.gov` | Open | Read the records pages, the directory, the open data page, and one dataset metadata record. |
| `www.santacruzcountyca.gov` | No robots file | Read the records page. |
| `www.louisvilleco.gov` | No Claude rule | Read the request page, and one earlier fetch got a 404. This is the main site. I didn't fetch `laserfiche.louisvilleco.gov`. |
| `www.chicago.gov` | 403 | One attempt. Used search excerpts. |
| `www.tucsonaz.gov`, `www.everettwa.gov`, `www.cityofsalem.net` | Robots 403 | Not fetched, because the rule can't be read. Search excerpts only. |
| `www.puyallupwa.gov` | Default disallow, names ClaudeBot | Read robots only. Search excerpt of the city code instead. |
| Never fetched | | `egov.cityofsalem.net`, `permits.puyallupwa.gov`, `lfportal.everettwa.gov`, `web.seattle.gov/dpd/edms/`, `pro.tucsonaz.gov`, `www2.santacruzcountyca.gov` |

## Cost

Measured with `truefoundry/claude-haiku-4-5`, using TrueForge's own estimate rather than the gateway's invoice:

| Step | Estimated cost |
|---|---|
| `draft` | About $0.002 per request |
| `learn` | About $0.004 to $0.01 per run |
| Full end-to-end test | About $0.05 |

`policy.json` stops a command at $0.50, and a home at $3 in total. `learn` makes no model call when nothing has come back.

## Layout

```
cli.ts          commands
draft.ts        drafting, approval, export. Nothing past export
compliance.ts   what a draft says and may not say
law.ts          dates and deadlines, driven by laws.json
track.ts        request state, what's due, follow-ups
stats.ts        usable records per request, the verdict
scope.ts        what learning may change, and where
learn.ts        proposals, audit, spot checks
playbook.ts     rule files
intake.ts       scrub, check, build letters
agent/          the agent spec and playbook, plus laws, targets and policy (which it can't change)
drafts/         review copies with brackets
data/           your records. Gitignored
reports/        aggregate learn reports
tests/          unit tests, end-to-end test, fictional fixtures
```
