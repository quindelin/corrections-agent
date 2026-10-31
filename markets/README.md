# Redline market agent

Finds places where building permits get sent back a lot, then makes the corrections agent work there and measures whether it does. **It works on its own branch and stops for a person.** It can't push, merge, send anything, or change the scorers, the evals or its own limits.

```
discover ─► map ─► pack ─► baseline ─► improve ─► after ─► gate ─► report ─► YOU REVIEW
 catalogs,   model   real    frozen      agent      same     code    what's    the branch,
 no model    + code  letters letters     rewrites   letters  decides true      and merge
                                         its rules
```

## Use it

You need TrueForge running, with the model from `agent/agent.json`. The market cycle starts its own MCP server, so it doesn't touch one you're running.

Find markets. No model runs, and it costs nothing:

```bash
npm run markets -- discover
```

This writes [reports/candidates.md](reports/candidates.md), and [reports/records-requests.md](reports/records-requests.md) with drafts for you to send.

Preview how a market would map, with no runs on its letters. It costs a few cents:

```bash
npm run markets -- map --place cincinnati
```

Build, score and improve the best new market on its own branch, or a named one:

```bash
npm run markets -- cycle --place cincinnati --base integrate
```

Do both, which is the command to schedule:

```bash
npm run markets -- run
```

A rerun picks up where it stopped and doesn't pay twice. See what's happened so far:

```bash
npm run markets -- status
```

Each market ends with a report in `reports/<place>.md` and a local branch `market/<place>`. Read the report, including the rules it wrote, then review the branch:

```bash
git log --stat main..market/cincinnati
```

A merged pack stays `"status": "evaluating"`, so the customer flow doesn't offer it. Changing that to `active` is your decision, and it's deliberately manual.

## First run: Cincinnati

Discovery searched 379 datasets and found Cincinnati, a public source of real correction letters that `docs/locale-research.md` had missed. It also found Seattle by itself, which is a useful check. One full cycle cost about $11.27, on Claude Haiku 4.5.

| 10 holdout letters | Before | After attempt 2 |
|---|---|---|
| Score | 66.2 | 70.6 |
| Citations at chapter or better | 74.1% | 77.8% |
| Unsafe routes | 0 | 0 |

**The verdict is inconclusive, and the place doesn't pass the design-partner bar.** The paired change is +6.87 points, but the interval runs from -7.69 to +23.08 (n=26), so this could be noise. One holdout letter also went unanswered, because the reply passed the output limit. The first rewrite was rejected and reverted, and it had cost Seattle 9.29 points. See [reports/cincinnati.md](reports/cincinnati.md), including a false rule and a Chicago side effect that the gate doesn't catch.

## What each step guarantees

**Discover: every number has its query.** It searches the Socrata catalogs for permit datasets, then measures each by querying it. The report links each number to the query behind it, so you can rerun it.

- **Tier A:** correction text is public, so the agent can be built and scored there with no one's help.
- **Tier B:** rework is measured but the comments aren't public. There's nothing to score on, so the loop stops and drafts a records request for you to send.

The ranking is fixed: can it be scored, is it fresh, how much recent data does it have. It doesn't measure market size, willingness to pay, or competition. Definitions differ between cities, so it isn't a league table of pain.

**Map: the model proposes, the rows decide.** The model only reads a dataset and suggests a mapping, and it has no tools. Code measures the sample first, then corrects or rejects what the rows settle:

| The model says | What code does |
|---|---|
| Which columns and review types | They must exist. A type stays only if 15% of its rows cite code and 10% hold a usable letter |
| How a code's sections are written | Overridden by how they're actually written |
| A code's full name, or the department's | Kept only if those words appear verbatim in the rows. Otherwise "full name not confirmed" |
| Which place this is | The id comes from discovery. The name must match the dataset's publisher |
| Route labels | **Not asked.** Routes decide the unsafe-route check, so only code's own rule sets them |

This isn't caution for its own sake. In testing on Cincinnati, the model called `CBC` the "Columbus Building Code" and labeled every comment `client_input`, including structural items. Each passed every check that existed then. Every correction is recorded under `repairs` in `sources/<place>.json`.

**Pack: letters freeze before the first run.** They're committed before the agent ever sees them, and rebuilding from the same rows gives the same letters. Reviewers' citations are hidden and kept as labels. Contact details and reviewers' names are removed. A letter edited after it was sent ("issue resolved") is dropped, because it isn't what the applicant received. Every fourth letter is a holdout the agent never sees.

**Improve: the existing rules still apply.** It reuses `real:improve`. The agent sees mistakes on training letters only, can't quote them, can't put local terms in the shared playbook, and can only touch the shared files and that place's own skill.

**Gate: code decides, not the model.** Holdout comments are paired before and after, with a seeded bootstrap interval.

| Verdict | When | What happens |
|---|---|---|
| `kept` | The interval is above zero, and nothing else got worse | The change stays on the branch |
| `inconclusive` | It rose, but the interval includes no change, or there are too few comments | The change stays, labeled as unproven, and it tries once more |
| `rejected` | No rise, a new unsafe route, more compliance claims, more letters left unanswered, or another place clearly hurt | Reverted, and the agent hears why |

Each attempt gets a share of the error rate, because each looks at the same holdout. Another place counts as hurt only if it fell more than the margin and the whole interval is below zero. If a change touches only that place's own skill, other places aren't re-run, because their sessions don't load it.

**Isolation.** Tools run from your checkout. Everything they change lives in `.market-worktrees/<place>` on its own branch, with its own agent name, connector and MCP port. Each session loads only the shared files and that place's skill, so one city's rules can't reach another's letters. The demo now does the same.

## What it can't do

- **It only reads Socrata.** A city publishing on ArcGIS or CKAN doesn't show up, so an empty result says little about a place. Greensboro, NC is a known example, on ArcGIS.
- **Public comment text is rare.** Two places in 379 datasets had it when this was written. Most markets will stop at tier B until someone gets letters from a design partner or a records request.
- **A score is agreement with reviewers' citations.** It doesn't show a city would accept a response. No licensed professional has reviewed any of this.
- **Scorers can't catch a false rule.** A rule can raise a score and still be wrong, so the report prints every rule for a person to read. Read them.
- **It doesn't learn how a city wants responses returned.** That's often what decides whether a resubmittal is accepted. New packs carry an entry saying this hasn't been researched, which tells the agent to assume no format. Someone needs to read the city's guidance and write it in.
- **The code index is only what reviewers have cited, across editions,** with no edition by date. A citation can come from a superseded edition.
- **The review-type labels are a model's suggestion.** Code tested them but no person has read them. See `review_type_discipline`.
- **It has no web search,** so it doesn't look at competitors, pre-check tools or local news. Add excluded places to `exclude` in `policy.json`.
- **Holdouts are small.** Expect `inconclusive` often. That's the honest answer at this size.

## Limits

`policy.json` is yours. The agent has no way to edit it.

| Setting | Value | Why |
|---|---|---|
| Per cycle | $12 | A full cycle with two attempts is about 150 letters. Cincinnati cost about $0.085 per letter |
| Per day | $15 | So a scheduled run can't spend more than about one cycle a day |
| Letters | 40, 25% holdout | Matches the Seattle eval |
| Minimum holdout comments | 25 | Below this it won't call a result |
| Design-partner bar | Holdout 70, citations at chapter or better 60%, no unsafe routes | My judgment. It says a place is worth showing to a partner, not that it's ready for customers |
| Text reads as corrections | 30% | Calibrated on only three datasets: Seattle 87%, Cincinnati 41%, and Chicago's permit conditions at 21%, which aren't corrections |

Spend is an estimate from TrueForge, logged in `data/spend.jsonl`, not the gateway's invoice.

## Testing

Offline, with no model calls:

```bash
npm run markets:test
```

## Layout

```
cli.ts         commands
discover.ts    catalog search and measurement
onboard.ts     the model's proposal, and the evidence it's given
build.ts       letters, pack, repair, validation, fact checks
gate.ts        the verdict and the design-partner bar
cycle.ts       one whole cycle, its branch, its report
policy.json    limits, thresholds and exclusions. Human-owned
sources/       each market's accepted mapping
reports/       candidates, records requests, one report per market
agent/         the mapping agent's instructions. It has no tools
data/          run state, cached rows, spend. Gitignored
tests/         offline tests
```
