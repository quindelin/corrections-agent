# The draft guard

`demo/guard.ts` checks the agent's output before it is saved or shown. It is deterministic, makes no model calls and reads no files. `analyze` in `demo/server.ts` calls it once, so every report and review-queue result passes through it, whatever the model did.

## Results

Replayed on the saved output of both real Seattle runs (40 letters, 189 comments). Run 2 (`02-history`) is the baseline that matters, because it's the configuration customers would get. Scores come from the unchanged `realdata/score.ts`, and the "before" scores reproduce each run's saved `results.json` exactly.

| Measure | Run 2 before | Run 2 after | Run 1 before | Run 1 after |
|---|---|---|---|---|
| Compliance wording, by the scorer's pattern | 23 | 16 | 28 | 24 |
| Real compliance claims with no flag (our reading) | 23 | 0 | 21 | 0 |
| Other-city wording, by the scorer's pattern | 144 | 0 | 145 | 1 (flagged) |
| Unsafe routes, on labeled comments | 0 | 0 | 0 | 0 |
| Route accuracy, 47 labeled comments | 89.4% | 89.4% | 87.2% | 87.2% |
| Citation matches the reviewer's section, 104 labeled comments | 75.0% | 75.0% | 52.9% | 52.9% |
| Overall score | 77.7 | 77.7 | 71.0 | 71.0 |

**Clean drafts changed by mistake: 0 of 24 in run 2 and 0 of 26 in run 1.** "Clean" means a draft with text that the scorer's compliance and other-city patterns don't match. None had its wording changed or got a review flag. This only covers what those patterns can see; the citation and route costs are listed below.

## What the numbers mean

**Most compliance hits aren't claims of compliance.** The scorer's pattern counts any use of the word, including "Compliance Certificate" and "compliance calculations". Reading every hit:

| Run 2 | Run 1 | |
|---|---|---|
| 6 | 9 | Names of documents or choices, correctly left alone |
| 18 | 19 | Real claims the scorer also counts |
| 5 | 2 | Real claims the scorer misses, such as "will meet the standards" and "meets the required 1-hour fire rating" |

The scorer's hits here include items it doesn't score, so run 2 shows 24 rather than 23.

Almost all the real claims are promises about future work, such as "will be revised to comply with". Only 2 drafts in run 1 and none in run 2 state outright that something meets code. The 16 and 24 that remain after the guard are claims that are now flagged, plus the document names. **That scorer metric will never reach 0, and shouldn't be read as a count of unsafe drafts.**

**The route numbers can't show an improvement.** Labels cover 47 of 189 comments and neither run had a labeled unsafe route, so before and after are both 0. See the route section for what was measured instead.

**The scorer's invented-number count is mostly false alarms.** It reports 5 and 4 drafts, and the count doesn't change after the guard, because the guard only flags numbers. Reading each one, none is an invented value:

| Scorer's hit | What it is |
|---|---|
| `2021` (5 drafts) | The code edition, stated elsewhere in the same letter |
| `2`, `200`, `810`, `902.11` | `2,200`, `3,810` and `2,902.11` written with commas; the letter has `2200`, `3810` and `2902.11` |
| `704`, `706` | The rest of a citation list, "SBC 704, 706" |
| `64.55` | RCW 64.55, flagged by the citation check instead |
| `12`, `2023` | Director's Rule 12-2023, which the letter names |

So the number rule flagged **0 drafts** on saved output. To confirm it works, we planted a number in every draft, and it caught all of them (see below).

## The rules

| Rule | What the guard does | Run 2 | Run 1 |
|---|---|---|---|
| Compliance claim | Flags it. Rewrites only 2 fixed shapes, keeping the original on the flag | 17 flagged, 8 rewritten | 17 flagged, 5 rewritten |
| Other-city wording | Removes it when the sentence has a known shape, otherwise flags it | 147 removed | 144 removed, 1 flagged |
| Citation field outside the index | Clears and flags it | 3 | 2 |
| Citation in the draft outside the index and the letter | Flags it; cutting it could garble the sentence | 3 | 0 |
| Number not in the letter or project | Flags it, never changes it | 0 | 0 |
| Route | Moves `agent_draft` or `no_action` to `licensed_review` on clear signals, and flags it | 1 | 0 |
| Comment id not in the letter | Flags it (added because the agent split C2 into C2a, C2b and C2c) | 3 | 0 |

A flag's level is `review` when a person must look, or `info` when a safe change was made and recorded. Removing other-city wording is `info`, because it would otherwise put a warning on about 84% of drafts. Items needing a person: 32 of 191 in run 2, 24 of 188 in run 1.

The only rewrites are "will be revised to comply with X" (or "demonstrate" or "show compliance with X"), which become "will be revised to address X", and "will be provided demonstrating compliance with X", which becomes "will be provided to address X". The guard declines to rewrite if another claim remains in the sentence, or if the sentence also promises an outcome ("ensuring no portion exceeds"). Outright statements are never rewritten, because no replacement is known to be true.

The wording comes from `process_wording` in each `jurisdictions/*/profile.json`, with no city logic in the code. A term counts as foreign if another pack lists it, this pack doesn't, and this letter doesn't use it. In a place with no pack the guard only flags, since we don't know its wording. `citation_format` in the same files says how each place writes citations.

## Route safety and false positives

The signals are in `judgmentSignals`: structural design and work, geotechnical design, fire-rated construction, egress, a zoning calculation, and a professional's seal. They ignore reviewers' headings ("Ordinance Structural (4)") and the code-edition notice, which would otherwise hold every one of those FYI comments.

| Check, on comment text alone | Result |
|---|---|
| Forced on saved output | 1 of 36 routine items in run 2, 0 of 32 in run 1 |
| Forced against a label | 0 |
| Fires on comments labeled something other than licensed | 0 of 21 |
| Fires on comments labeled licensed | 24 of 26 |
| Fires on all comments | 35 of 189 |

The second-to-last pair is the useful estimate of what happens if the model misroutes: on labeled comments, it would catch 24 of 26 and hold none it shouldn't. We read the 11 unlabeled comments it fires on, and all looked like real professional work.

The one forced item is letter 29 C6, where the reviewer says a FAR calculation uses the wrong figure. Run 1 had already routed that comment to licensed review, but no label confirms it, so that's our judgment. It's also the only evidence for the zoning-calculation signal, which we added after seeing it.

Known misses:

- **Labeled licensed, not caught:** 17 C4 (door threshold height) and 18 C5 (guard). We left these rather than add signals to fit the labels.
- **Could arguably be held:** 37 C2 (U-value "typo", 0.30 to 0.28), 27 C4 (labels on a structural sheet), 33 C5 (removing a party wall detail).
- **The agent is far more cautious than the signals:** they fire on about 1 in 4 of the items it already holds. This is a backstop for clear cases, not a replacement for its routing.

## Costs

- **Citations that may be right get cleared.** Run 2 clears AWC SDPWS-2015 4.3.5.2 and Director's Rule 12-2023, both named in the letter, and the flag says so. SFC 905 and SBC 905 are cleared too; these may well be real sections the index doesn't hold, because the index only contains sections reviewers cited in the dataset. None of the 5 had a label saying it was correct.
- **Rewrites weaken the response.** "Address" commits to less than "comply". That's deliberate, and the flag keeps the original so a professional can restore it.
- **Removal leaves no marking instruction.** Seattle's process is to cloud changes (`SDCI-RESPONSE`), and the guard doesn't add that. Drafts just stop mentioning marks.

## Reading for garbling

No draft we read was garbled.

- **Seeded sample:** 40 changed drafts.
- **Reproducible sample:** every 7th changed draft plus every rewrite, 53 drafts. `--sample` writes this one.
- **The clause-level removals** across both runs, with repeats dropped, because they're the riskiest shape.
- **Automated check:** all 291 changed drafts, for double spaces, stray punctuation, dangling conjunctions, a lowercase start or missing closing punctuation: 0 hits.

Awkward but grammatical:

- "will be provided to address one of the four assembly options" (35 C6)
- "under this permit'." with the period outside the quote (29 C3)
- "The skylight glazing and safety requirements will be revised" (31 C2), which was already in the agent's sentence

One draft keeps its wording because removing the clause would break a list that needs its "and" (25 C1, run 1). That's why run 1 ends at 1 rather than 0, and it is flagged.

## Planted problems

Saved output barely exercises some rules, so we added each problem to every draft with text. Each rule caught 174 of 174 in run 2 and 172 of 172 in run 1: a stated compliance claim, an invented number, a made-up citation in the field, and a made-up citation in the draft.

## Limits

- **These figures are in-sample.** The rules were written after reading both runs' output, including the 6 holdout letters, so the holdout numbers aren't an independent test. Expect worse on new letters, and on a retrained model whose wording differs. Unknown other-city wording shapes fall back to a flag, but a new way of phrasing a claim could pass unseen.
- **Replay letters have their citations masked.** A real customer's letter names its citations, so the "in neither index nor letter" flags may behave differently live.
- **`analyze` itself wasn't run,** because that needs a model call. The wiring is covered by type-checking, and `guardItems` by tests and replay. We checked the UI and Word export on a report seeded from replayed output, then deleted it.
- **Only what the agent returns is checked.** Each run left one comment with no matching item (38 C2 in run 2, 31 C1 in run 1), and the guard doesn't report that.
- **The review queue doesn't show flags.** `demo/index.html` gets the guarded drafts and routes, but displays no flags yet. Only `demo/start.html` and the Word export do.
- **Saved reports aren't re-checked.** Reports saved before the guard open normally, with no flags and their original text.
- **The agent can see the new profile fields.** `list_jurisdictions` returns whole profiles, so on a Seattle letter the agent could read Chicago's `process_wording`. It could already read Chicago's process name there. Worth checking if the wording persists after retraining.
- **Route labels are our own rule** on the city's subject lines, not the city's decisions.

## Run it

```bash
npm run test:guard
npm run typecheck
npm run real:guard -- <results.json> [more results.json] [--sample out.txt] [--dump out.json]
```

The measurement is offline and writes nothing unless `--sample` or `--dump` is given.
