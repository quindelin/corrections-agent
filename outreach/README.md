# Redline outreach agent

Finds small Chicago architecture firms and permit expediters, drafts messages for you to review, and improves its playbook from what you log. **It cannot send anything.** It has no sending tool, and you send every approved message yourself.

It serves two goals, and getting real letters matters at least as much as getting customers: the eval letters are fictional, and no architect has reviewed the answer key.

```
candidates ─► seeds ─► research ─► draft ─► review ─► approve ─► export ─► YOU SEND ─► log ─► learn
 City data    a person   verified    gate +    you      you, at a   text              you     rewrites the
              or search  facts only  audit              terminal    files                     playbook, as a git diff
```

It's separate from the eval loop. It runs as its own TrueForge agent, `redline-outreach`, and doesn't touch `agent/`, `evals/` or `runs/`.

## Use it

You need TrueForge running with the model from `agent/agent.json`. Check first with `status`.

**1. Say who you are.** Copy `sender.example.json` to `data/sender.json` and fill it in. Approval is blocked until it's complete.

**2. Check the claims.** Open each `source_url` in `agent/claims.json` yourself and set `verified_by_human` to `true`. Approval is blocked until you do. `chicago_time_share_2024` matters most, because `chicago.gov` blocked our fetches and it was only ever seen in a search excerpt.

**3. Build the list.** `candidates` shows who files small residential permits. It finds names, not contacts:

```bash
npx tsx outreach/cli.ts candidates
```

Add a line to `data/seeds.jsonl` for each firm whose own website you can identify. `permit_name` is optional and must match `candidates.jsonl` exactly.

```json
{"segment":"permit_expediter","permit_name":"EXACT NAME","website":"https://...","found_via":"how you found it"}
```

```bash
npx tsx outreach/cli.ts research
```

**4. Draft, and read every one.**

```bash
npx tsx outreach/cli.ts draft
```

```bash
npx tsx outreach/cli.ts review
```

**5. Approve in your own terminal, or reject with a reason.** `learn` reads the reasons.

```bash
npx tsx outreach/cli.ts approve --id M-xxxx
```

```bash
npx tsx outreach/cli.ts reject --id M-xxxx --reason "why"
```

**6. Export, send it yourself, and log what happens.**

```bash
npx tsx outreach/cli.ts export
```

```bash
npx tsx outreach/cli.ts log --id M-xxxx --event sent
```

Events are `sent`, `replied`, `positive`, `bounced` and `unsubscribed`. **Check your inbox for unsubscribes and log them right away.** Logging one adds it to the suppression list.

**7. Learn.** The first time, commit `outreach/agent/playbook.md` so there's a baseline to diff against.

```bash
npx tsx outreach/cli.ts learn
```

Review the change with `git diff -- outreach/agent/playbook.md`. Nothing is committed unless you pass `--commit`.

`status` shows what's waiting, and `spend` shows estimated cost across the whole server.

## What each step guarantees

**Research: no guessed contact details.** Code finds email addresses, and keeps one only if it appears verbatim on a fetched page. The model only extracts descriptive facts, and each needs a verbatim quote that code then finds on that page. A fact that fails is dropped and reported. Every fact stores its source URL and retrieval time, and permit counts store a query you can rerun. Research honors `robots.txt`, waits 2 seconds between requests to a site, reads at most 4 pages plus 2 policy pages, and doesn't retry a refused request. It keeps general inboxes and the chosen address, not every staff address.

**Draft: claims come from a list.** The model can state facts about Redline or permit times only by inserting a `{{claim:id}}` token, which code expands to the exact wording in `claims.json` and cites. `redline_what` and `redline_limits` are required in every message, so every message says the Chicago testing used letters we wrote and that no architect or city has reviewed the output. A regex gate blocks claims of city acceptance, approval rates, time saved, scores, accuracy, validation, customers, free offers, fake threads, unsourced numbers and restated claims. A second model pass audits for claims the regexes can't read. A draft that fails three times is marked blocked and can't be approved.

**Checkpoint: nothing goes out by itself.** The agent's TrueForge spec has no MCP servers, web search, sandbox or sub-agents, and the code has no mail library. Approval hashes the exact final text and needs a person typing that hash at a terminal. Changing the sender or a claim afterward voids the approval. That terminal check prevents accidents, and isn't a security boundary: something with shell access could fake a terminal. The real boundary is that nothing here can send.

**Learn: the model can't call a winner.** `stats.ts` decides. Code writes the playbook's Standing section and retires losers. The model never gets existing variants as editable text. `validateChange` rejects a rewrite that changes a status the verdict doesn't allow, edits a frozen variant, states a result or a rate in the prose, invents a claim, or names a prospect. The model can't edit `claims.json` or `policy.json`. Fictional and real records can't mix, because `learn` refuses a home holding both.

## How much data is enough

**The minimum is 50 delivered, mature messages per variant before any test runs.** The metric, fixed in advance, is positive replies per delivered message. A positive reply agrees to share a letter, review the answer key, or talk. Until every active variant reaches 50, the verdict is `insufficient_data`, the variants stay as they are, and the report says what's missing. I tested this with 6 of 12 against 0 of 12, and it's refused.

Why 50, and what it can and can't do. These are exact calculations for two variants at the first look (alpha 0.025):

| True positive rates | Chance of finding a winner at 30 per arm | At 50 per arm | At 100 per arm |
|---|---|---|---|
| 5% vs 25% | 34% | 66% | 96% |
| 2% vs 20% | 36% | 68% | 98% |
| 10% vs 30% | 27% | 53% | 89% |
| 5% vs 15% | 7% | 16% | 48% |
| 2% vs 10% | 4% | 11% | 46% |

At 50 per arm, 0 of 50 needs at least 7 of 50 to win, 2 of 50 needs 11, and 5 of 50 needs 15.

- **Below about 30**, even a big real gap is more likely to be missed than found, so there's little point testing.
- **Detecting 5% vs 15% reliably** takes about 140 per arm by the usual approximation. That's about 280 firms for one comparison, and the market may not hold many more than that. **We haven't measured how many firms there are.**
- **So 50 is a compromise:** it finds big differences, misses modest ones, and rarely invents one. If the true rates are equal at 5%, a false winner in a given direction happens about 0.1% of the time, because the test is conservative. Expect `no_clear_difference` to be a common result, and read it as "this data can't tell them apart", not as "they're the same". **At this size, reading the replies will probably teach you more than the rates will.**

The rest of the design stops the numbers from fooling you:

- **A reply window.** A send counts only after 7 days, so recent sends don't look like silence.
- **Fixed looks.** Tests run at 50, 100, 150 per arm, on exactly that many messages in send order. Alpha halves at each look and is split across comparisons, so checking repeatedly can't produce a win.
- **One message per firm,** so the data points are independent.
- **Balanced assignment** within each segment. The code picks the variant, not the model.
- **Frozen variants,** so a variant's numbers keep meaning one thing.

A win doesn't say *why*, because variants differ in several ways at once. Stop signals act much sooner, because being wrong costs other people: outreach pauses when, over the last 20 sends, bounces exceed 5%, or there are at least 3 unsubscribes and they exceed 5%. Those limits are my judgment calls, and they're in `policy.json`.

## Compliance built in

This follows the [FTC's CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) and [15 U.S.C. 7704](https://www.law.cornell.edu/uscode/text/15/7704). The guide puts penalties at up to $53,088 per email. This is engineering, not legal advice.

| Requirement | Where it's enforced |
|---|---|
| Honest subject | The gate blocks `Re:`/`Fwd:`, invented urgency, anything that looks like it's about their permit or from the city, and subjects that don't say what the message is |
| Real sender | `sender.json` is validated at approval, and fictional senders are blocked in the real home |
| Physical address | Needs a street or box number and a ZIP. Added by code to every message |
| Identified as an ad | Added by code to every message |
| Working opt-out | Added by code. Reply-based, so it only works if you read that mailbox (`opt_out_mailbox_monitored`) |
| Honor opt-outs (10 business days, working for 30 days) | Suppression applies as soon as you log it. **Reading the inbox is on you** |
| Suppression always honored | Checked at research, draft, approval and export, and warned about when logging a send. An unsubscribe suppresses the whole firm, unless it's a free webmail domain |
| Contact limits | 10 per day, 30 per 7 days, 1 message per firm, 90 days minimum between messages to a firm. Export enforces these. These are my conservative defaults, not legal limits |

### Needs your legal judgment

1. **Whether this counts as commercial email at all.** We treat it as commercial and label it an ad. A purely research request might not be, but these messages also promote a product.
2. **Illinois's `ADV:` rule.** [815 ILCS 511/10](https://ilga.gov/ftp/ILCS/Ch%200815/Act%200511/081505110K10.html) appears to require unsolicited ads to start the subject with `ADV:`. One federal district court [held that preempted by CAN-SPAM](https://blog.ericgoldman.org/archives/2011/04/labeling_requir_1.htm). That's a single non-binding decision, and I didn't confirm the statute's current text. To comply anyway, set `"subject_prefix": "ADV: "` in `sender.json`.
3. **Harvesting.** Collecting addresses by automated means from a site saying it won't transfer them is an aggravating factor under [7704(b)(1)](https://www.law.cornell.edu/uscode/text/15/7704). Research looks for these notices and excludes or escalates what it finds, but it's pattern matching on the pages it reads, and it can miss a notice. Decide whether automated collection is acceptable at all, or whether you should confirm each address by hand. Don't seed from association directories without reading their terms.
4. **Letters contain other people's information.** A correction letter can name clients, addresses and professionals. **Before you accept one, decide** what you're asking for, how it's redacted, where it's stored, whether it may go through a model provider, and whether the sender's client agreement allows sharing. Nothing here handles received letters.
5. **Your postal address goes in every email.** The FTC guide allows a street address, a registered USPS box, or a registered private mailbox, so you don't have to use a home address. Also decide which legal entity is the sender. `organization` is printed in the footer.
6. **Practice-of-architecture lines.** Whether promoting a tool that drafts code-cited responses raises any licensing question in Illinois. The copy is careful, but I didn't research this.
7. **Website contact forms.** Some prospects have a form and no email. How CAN-SPAM applies is less clear, and a site's terms may forbid solicitation. Phone and text aren't supported, and no numbers are stored.
8. **Data terms.** The City's dataset points to a [Terms of Use](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) I didn't read. Research honors `robots.txt`, but doesn't read each site's terms. Permit data lists many people by personal name, in their professional role.
9. **Your mail provider's terms** on cold email.

### This repo is public

`outreach/.gitignore` keeps all of `data/` out of git: prospects, messages, outcomes, suppression and your sender details. **Don't force-add it.** Publishing a suppression list would also expose people who opted out, and the FTC guide says you can't sell or transfer those addresses. The playbook, claims, policy and aggregate reports are meant to be committed, and `learn` rejects a playbook that names a prospect.

## Testing

Offline, with no model calls:

```bash
npx tsx outreach/tests/unit.ts
```

The whole loop on fictional data, in throwaway homes with their own git repos. It costs about $0.05 and contacts nobody, because every recipient uses a reserved `.example` domain:

```bash
npx tsx outreach/tests/e2e.ts --dir "$(mktemp -d)"
```

## Cost

Measured with `truefoundry/claude-haiku-4-5`, using TrueForge's own estimate rather than the gateway's invoice:

| Step | Estimated cost |
|---|---|
| `research` | About $0.009 per firm |
| `draft` | About $0.012 per message, including retries and the audit |
| `learn` | About $0.01 per run |

`policy.json` stops a command at $0.50, and stops outreach in a home at $5 in total. Reaching 100 firms would cost about $2.

## Layout

```
cli.ts          commands
research.ts     step 1: City data, polite fetching, verification
messages.ts     step 2: drafting, approval, export, outcomes, suppression
compliance.ts   the draft gate, footer, sender checks, limits
stats.ts        the verdict: minimums, fixed looks, Fisher exact test, stop signals
learn.ts        step 3: rewrites the playbook, within what the verdict allows
agent/          instructions and playbook (the model can change the playbook), claims and policy (it can't)
data/           your records. Gitignored
reports/        aggregate learn reports
tests/          unit tests, end-to-end test, fictional fixtures
```
