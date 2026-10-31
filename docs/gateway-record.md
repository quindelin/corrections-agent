# Gateway record of the proof runs

TrueForge ran locally for these runs, but every model call went through TrueFoundry's AI Gateway. This is the gateway's record of those calls on 31 Oct 2026, compared with the session exports in `runs/`. All calls used `tfy-managed/claude-haiku-4-5-20251001`.

| What | Gateway call times (UTC) | Calls | Input tokens | Output tokens | Total | Compared with |
|---|---|---|---:|---:|---:|---|
| Connection test | 19:16:38 to 19:16:39 | 2 | 1,555 | 44 | 1,599 | Not in the repo. Totals match the test run just before run 1 |
| **Run 1** (87.97) | 19:16:59 to 19:19:08 | 30 | 130,014 | 13,419 | **143,433** | `runs/summary.csv`: 143,433 |
| First rewrite attempt | 19:20:10 | 1 | 12,591 | 486 | 13,077 | Not in the repo. Timing fits the rewrite we dropped |
| **Kept rewrite** (`8b1fe6c`) | 19:20:44 | 1 | 12,656 | 534 | **13,190** | `runs/run-01/improve-session.json`: 12,656 input, 534 output |
| **Run 2** (95.57) | 19:21:10 to 19:23:22 | 26 | 117,880 | 13,448 | **131,328** | `runs/summary.csv`: 131,328 |
| Not attributed | 19:24:02 to 19:24:08 | 3 | 12,214 | 1,334 | 13,548 | No matching session in the repo. Not part of a counted run |

## How to read it

- **What it shows:** the token counts for run 1, the kept rewrite and run 2 match the gateway exactly, and the calls happened inside the times those sessions recorded.
- **What it doesn't show:** the gateway totals don't contain prompts, answers, scores or skill changes. Those are in `runs/`, and the rewrite is in commit `8b1fe6c`.
- **What's inferred:** the connection test and first rewrite attempt are matched by totals and timing, because the gateway metrics don't include call contents.

## Where it came from

The numbers are from the gateway's model metrics, filtered to this project's account and to the time windows above. They were read through the TrueFoundry MCP server. Viewing the same data needs a login to the event's TrueFoundry account.
