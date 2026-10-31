# Redline: a permit corrections agent that gets better every time it runs

Redline turns a building department's correction letter into a ready-to-review response package: each comment sorted, cited to the governing code section, routed to whoever has to act, and drafted. Anything that needs a licensed professional's judgment is held for their sign-off.

Built on [TrueForge](https://trueforge.dev) for the **Stranger Builds** challenge *"Build an agent that gets better every time it runs"*, from the TrueForge starter.

**Why corrections:** about two-thirds of Chicago permit time is spent with the applicant, not the city. The Department of Buildings reported 50 of 71 days in [November 2024](https://www.chicago.gov/content/dam/city/depts/obm/supp_info/2025Budget/2025BudgetOpeningStatements/Department%20Hearing%20Opening%20Statement%20DOB%20-%20FINAL.pdf), and [secondary reporting](https://chicagocitywire.com/chicago-buildings-department-reports-88-day-average-permit-time-down-slightly-in-volume) of October 2026 testimony gives about two-thirds of 88 days. The 117-day figure in the demo is a different measure, so don't compare it with these.

**Who it's for:** small architecture firms and permit expediters filing 2 to 6 flats, coach houses and renovations.

```
run the letters ──► the re-review scores them ──► the agent rewrites its own playbook ──► run again ──► higher score?
 (TrueForge session)     (evals/score.ts)          (committed with Agent-Session: <id>)
```

## Run 1 vs run N

- **Task and score:** answer 8 synthetic Chicago correction letters (2 holdouts); each comment is scored on route, citation, discipline, sheets and draft, and skipping a licensed professional scores 0.
- **Run 1 → run 2:** 87.97 → 95.57; holdout 94.27 → 97.92; unsafe routes 3 → 1 (`runs/summary.csv`). One run each, on Claude Haiku 4.5.
- **The change that did it:** commit `8b1fe6c`, the agent's rewrite of `correction-playbook`, with `Agent-Session: 01m69pgej4ab3j93madhjetcsk`.
- **What the agent learned:** state the required revision marks, leave design values and compliance conclusions to the licensed professional, and list only sheets that are actually revised.
- **What still fails:** it overapplies the revision-mark wording to 4 of 15 items where it doesn't belong, which the frozen scorer doesn't penalize, and one code-classification item still skips the architect. We dropped its first rewrite for the same overapplication and tightened the improve prompt; the kept rewrite still has the flaw.

## What the agent does

For each comment in a letter, the agent returns:

| Field | What it means |
|---|---|
| `discipline` | What the comment is really about, whatever heading it sits under |
| `citation` | The governing entry, found with the code lookup tools |
| `route` | `licensed_review`, `agent_draft`, `client_input`, `other_agency` or `no_action` |
| `sheets` | Which sheets must be revised |
| `draft` | The line for the response letter |

## How it learns

The scorer plays the part of the city's re-review. It returns a number and the reasons, and `npm run improve` gives the failed letters to the agent, which rewrites its own skills. Holdout letters count in the score but are never shown to it.

A second signal comes from the demo's review queue: when an architect rejects an item and says why, the note goes to `feedback/reviews.jsonl`, and the next `improve` reads it.

The agent sorts what it learns by where it holds:

- `agent/skills/correction-playbook/` holds rules that apply anywhere.
- `agent/skills/local-chicago/` holds rules about one place.

## Real data

`npm run real:build` rebuilds real letters from Seattle's public records, and `npm run real:run` runs the agent on them, hiding reviewers' citations so they can be checked. Results are in `runs-real/`. See `docs/emris-integration.md` for how this connects to Emris.

## Built for many places

Everything specific to a place lives in a jurisdiction pack. The tools, scorer and playbook are shared.

```
jurisdictions/<id>/
  profile.json        who reviews, the code basis, the correction process
  code.json           the code index the agent can cite
  permit-stats.json   permit statistics snapshot (optional)
agent/skills/local-<id>/SKILL.md   rules the agent has learned about this place
```

To add a place, add its pack and a `local-<id>` skill, then add letters to `evals/tasks/` with `"jurisdiction": "<id>"` **before that place's own run 1**. The MCP tools pick up new packs on restart. Every tool takes a jurisdiction id, and a citation only counts if it's in that place's index.

In `inline` skill mode every local skill is pasted into the instructions, which won't scale past a handful of places. `git` skill mode is the way to load them on demand, and we haven't tested it here.

[docs/locale-research.md](docs/locale-research.md) covers which places to add next and what differs between them. It recommends Evanston, Naperville and Seattle next, and identifies gaps in this design:

- Code edition must resolve from the application date, not only the place.
- Code indexes should layer model, state and local text, so places on the same edition share work.
- Response formats need structured fields, because they vary widely and can decide whether a resubmittal is accepted.
- Routing has no outcome yet for disputing a comment.
- Learned rules need a scope and an expiry, so they don't outlive a code change.

## How it uses TrueForge

- **Runtime:** the agent runs on TrueForge, and each run or demo analysis is a session.
- **SDK:** agent sync, sessions, turns and session export, in `scripts/lib.ts`.
- **MCP tools:** `mcp/server.ts` is registered as the `permit-research` connector, with `list_jurisdictions`, `search_code`, `get_section` and `permit_stats`.
- **Audit trail:** the demo shows every tool call from the session export.

TrueForge doesn't choose models per task or per subagent yet ([docs](https://trueforge.dev/models)), so one model does all of this. The architect sign-off is in the demo app, not a TrueForge tool approval.

## Quickstart

You need Node.js 22.14+, git, and one model key.

**1. Start TrueForge** in its own terminal. The allowed host lets it reach the local MCP server.

```bash
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
```

Open http://localhost:8790 → **Settings → Models** → pick your provider → paste your key → **Create**.

**2. Install, and start the tools** in a second terminal:

```bash
npm install
```

```bash
npm run mcp
```

**3. Create the agent.** `agent/agent.json` uses `truefoundry/claude-haiku-4-5`, a custom provider pointing at a TrueFoundry AI Gateway. For another model, set `TF_MODEL=provider/model` in `.env` (copy it from `.env.example`).

```bash
npm run setup
```

**4. Run the loop.** Don't change `evals/` after run 1.

```bash
npm run run-evals
```

```bash
npm run improve
```

```bash
npm run run-evals
```

Review each change with `git show`. To drop one: `git reset --hard HEAD~1`, then improve again. The rule is that **the agent writes the change**: you can keep it or drop it, but you don't edit it.

**5. Open the customer flow or the review queue.** `npm run demo` serves the drop-a-letter flow at http://localhost:8792/start and the review queue at http://localhost:8792. As a service behind Emris, set `REDLINE_API_KEY`, and `REDLINE_HOST` if it must listen beyond localhost. Stripe needs `STRIPE_PAYMENT_LINK` and `STRIPE_SECRET_KEY`; without them, unlocking is a free design-partner offer.

```bash
npm run demo
```


## The scorer

`evals/score.ts` is deterministic. Each comment scores 0 to 1:

| Part | Weight | Full marks when |
|---|---|---|
| Route | 0.35 | It goes to whoever has to act. **Sending a licensed item past the professional scores the whole comment 0.** |
| Citation | 0.20 | It's an accepted entry. Same chapter or title gets half. An id not in the index gets 0. |
| Discipline | 0.15 | It matches the substance of the comment |
| Sheets | 0.15 | All required sheets are listed, with a 0.25 penalty per extra sheet |
| Draft | 0.15 | It passes the checks below |

Draft checks: a correction eligible for Certified Plan Corrections says the revision is bubbled, dated and initialed (zoning items are excluded). A licensed item makes no compliance claim. No numbers appear that weren't in the letter or project details. No response is written where none is needed.

The run score is 100 × the mean letter score. `score.json` also records holdout score and unsafe routes.

```bash
npm run score -- --selftest
```

## What's real and what isn't

- **Real:** Chicago permit statistics (City of Chicago Data Portal), and code section numbers and titles (Municipal Code of Chicago, American Legal, 2026 S-74).
- **Our paraphrase:** the scope line on each code entry. Title 14B incorporates the 2018 IBC by reference, so the index holds no code text. Full text is [on ICC's site](https://codes.iccsafe.org/content/CHIBC2019P1).
- **Partly verified:** the Certified Plan Corrections rules (bubble, date, initial; zoning excluded) come from search excerpts of the city's pages, which blocked direct fetching. Confirm them against the pages, because the scorer depends on them.
- **Edition limit:** the code index and evals cover the current 2019 Chicago Building Code. The 2026 Ordinance is optional now and mandatory for projects starting on or after December 1, 2026, and isn't indexed yet. Section numbers may change.
- **Synthetic:** all 8 eval letters and the demo letter. Correction letters generally aren't public, so we wrote them, including the Title 13 references used as a stale-citation trap.
- **Not validated by a licensed professional:** the expected answers are our best judgment. A score here means agreement with our answer key, not that a city would accept the response. The top priority for making this real is to get actual letters and an architect's review of the key.
- **Designed to start low:** the playbook starts short on purpose, and the scorer rewards specific practices that the playbook doesn't state at first. That's the point of the challenge, but read run 1 with that in mind.
- **Not legal or code advice.** A licensed professional reviews everything before it's filed.

## Layout

```
agent/            agent.json, instructions.md, skills/ (what the agent rewrites)
evals/            tasks/*.json (07 and 08 are holdouts), score.ts
jurisdictions/    one pack per place
mcp/server.ts     the research tools
demo/             the review queue
feedback/         architect decisions from the demo (created on first use)
scripts/          setup, run-evals, improve, export-session
runs/             one folder per run, plus summary.csv
docs/             locale research
```

## Troubleshooting

- **`Can't reach TrueForge`**: is it still running? For another port, set `TRUEFORGE_BASE_URL`.
- **`The permit-research MCP server isn't running`**: run `npm run mcp`.
- **`Model "..." is not configured`**: add the provider in Settings → Models, and set `TF_MODEL` to the exact name shown there.
- **Tool calls fail, or the connector is blocked**: start TrueForge with `OUTBOUND_URL_ALLOWED_HOSTS` as in step 1.
- **`agent/ or evals/ has uncommitted changes`**: commit them, so `agent_commit` says exactly what ran.
- **The model rejects `temperature`**: remove `params` in `agent/agent.json`.

## Challenge checklist

- Public repo, created on or after 31 Oct, not a fork.
- `agent/`, `evals/tasks/` (3+), `evals/score.*`, `runs/summary.csv` and the **Run 1 vs run N** section exist.
- `summary.csv` has 2+ runs, and a later run scores higher than run 1.
- A commit that changes `agent/` and ends with `Agent-Session:` sits between run 1's commit and the later run's.
- Also send: a video (up to 2 minutes), three lines, and a half-page feedback note on TrueForge.

## License

MIT, see [LICENSE](LICENSE).
