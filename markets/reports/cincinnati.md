# Market cycle: City of Cincinnati, Ohio

**Verdict: inconclusive.** It doesn't pass the design-partner bar yet. Branch `market/cincinnati` holds the work. Nothing has been pushed or merged, and the pack stays marked `evaluating`, so customers aren't offered it.

| Holdout, 43 comments | Before | After |
|---|---|---|
| Score | 66.2 | 70.6 |
| Citations at chapter or better | 74.1% | 77.8% |
| Unsafe routes | 0 | 0 |
| Drafts stating a compliance conclusion | 10 | 8 |

## Rules the agent wrote: read these

Scorers can't tell a false rule from a true one, so a person has to read them.

```markdown
# City of Cincinnati, Ohio rules

**Code citations.** Cincinnati uses the Residential Code of Ohio (RCO) for residential work and the Ohio Existing Building Code (OEBC) for alterations to existing buildings. Search for what the city cites on similar comments before confirming a citation. When a comment shows `[code reference removed]`, use `similar_comments` to find what section the city actually cited on that topic.

**Zoning discipline.** Comments about site plans, property lines, setbacks, lot coverage, parking, dwelling unit count, building footprint, and use classification are zoning issues, not administrative. Vague requests for "more information" or "clarification" on site plans and property-related matters are typically zoning.

**Information on construction documents.** Comments asking to "clarify," "show," "provide," or "dimension" information on plans are design decisions for the licensed professional, not administrative requests. Route these to `licensed_review`.

**Compliance conclusions.** Do not draft language asserting that a design "complies," "meets," or "satisfies" a code requirement. Describe only what will be shown or revised.
```

It also changed shared files:

```
agent/skills/correction-playbook/SKILL.md | 16 ++++++++++++----
 1 file changed, 12 insertions(+), 4 deletions(-)
```

## Attempts

1. **rejected** (reverted): the cincinnati holdout didn't improve: -15.08 points (n=27). Commit `f332c64`. Other places: seattle -9.29 points (-22.86 to 0, n=20); chicago 1.82 points (-1.82 to 8.02, n=48).
2. **inconclusive**: the cincinnati holdout rose 6.87 points, but the interval -7.69 to 23.08 (n=26) includes no change. Commit `40b6282`. Other places: seattle -0.07 points (-10.07 to 9.86, n=20); chicago -0.49 points (-7.5 to 6.41, n=48).

**Correction to attempt 1:** its -15.08 scored one truncated letter as zeros, under an earlier version of the gate. Comparing only comments answered in both runs, it changed -0.32 points (-17.01 to 17.27, n=22). It would still be rejected, because it didn't improve.

**Not covered by the gate:** Chicago letters missing the required revision marks went from 4 to 8 under attempt 2, though Chicago's score barely moved. Read this before merging the shared playbook change.

**A false statement to watch:** attempt 2's commit message says Cincinnati uses "RCO and OEBC codes, not OBC". OBC appears in about half of recent building review letters. The skill's first rule leaves OBC out for the same reason, and should be corrected before this is used.

**One holdout letter went unanswered in both "after" runs:** the reply passed the 8,192-token output limit, and a retry didn't help. That's why the bar fails. The baseline answered it, so the rewrite may be making replies longer.

## Design-partner bar

- Pass: holdout score is 70.6, needs at least 70.
- Pass: citations at chapter or better is 77.8, needs at least 60%.
- Pass: unsafe routes is 0, needs at most 0.
- Fail: unreadable replies is 1, needs none.

## Where the data came from

[Cincinnati Building Permits (Combo) w/ Plan Review Comments](https://data.cincinnati-oh.gov/d/thvx-5mem), Public Domain. Letters: 192 comments in 10 holdout letters plus training letters, frozen in the commit before the first run. Evidence:

- 172549: All rows in the dataset. [Query](https://data.cincinnati-oh.gov/resource/thvx-5mem.json?$select=count(*)%20as%20n)
- 107543: Rows with text in entry_comments. [Query](https://data.cincinnati-oh.gov/resource/thvx-5mem.json?$select=count(*)%20as%20n&$where=entry_comments%20is%20not%20null)
- 40.8: Percent of up to 400 recent entry_comments rows at least 40 characters long that ask the applicant to do something (keyword match). [Query](https://data.cincinnati-oh.gov/resource/thvx-5mem.json?$select=entry_comments&$where=entry_comments%20is%20not%20null&$limit=400&$order=entry_date%20DESC)
- 80: Median characters in those rows. [Query](https://data.cincinnati-oh.gov/resource/thvx-5mem.json?$select=entry_comments&$where=entry_comments%20is%20not%20null&$limit=400&$order=entry_date%20DESC)
- 10256: Rows dated in the last 12 months by entry_date, with text in entry_comments. [Query](https://data.cincinnati-oh.gov/resource/thvx-5mem.json?$select=count(*)%20as%20n&$where=entry_date%3E%3D'2025-10-31'%20AND%20entry_date%3C%3D'2026-10-31'%20AND%20entry_comments%20is%20not%20null)

## What a person still has to check

- **Code corrected the model's mapping in these places:** CBC: kind ibc changed to dashed_municipal, from how its sections are written; LOCAL: added for sections cited with only a "§"; OMC: added, cited in 325 rows; "MSD Eng-Building Permit Review": removed from review types, 0% of rows cite a code and 73% hold a usable letter; "Water Works Building Permit": removed from review types, 0% of rows cite a code and 0% hold a usable letter.
- **The label mapping was proposed by a model and tested by code, but no person has read it.** See `markets/sources/cincinnati.json`, above all `review_types` and `review_type_discipline`.
- **A score here means agreement with what this city's reviewers cited.** It doesn't show a city would accept a response, and no licensed professional has reviewed the output.
- **The code index holds only sections reviewers have cited, across editions.** It has no edition by date yet, so a current letter could get a citation from a superseded edition.
- **Response format isn't learned from this data.** How this city wants a resubmittal returned needs reading from its own guidance before a customer uses this.
- **Competition and pre-check tools weren't researched for this place,** because this loop has no web search.
- Data terms: check them before relying on the dataset commercially.

Estimated spend this cycle: $11.27.
