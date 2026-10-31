# Gateway record of the proof runs

TrueForge ran locally for these runs, but every model call went through TrueFoundry's AI Gateway. This is the gateway's record of those calls on 31 Oct 2026, compared with the session exports in `runs/`. All calls used `tfy-managed/claude-haiku-4-5-20251001`.

| What | Gateway call times (UTC) | Calls | Input tokens | Output tokens | Total | Compared with |
|---|---|---|---:|---:|---:|---|
| Connection test | 19:16:38 to 19:16:39 | 2 | 1,555 | 44 | 1,599 | Not in the repo. Totals match the test run just before run 1 |
| **Run 1** (87.97) | 19:16:59 to 19:19:08 | 30 | 130,014 | 13,419 | **143,433** | `runs/summary.csv`: 143,433 |
| Dropped first rewrite | 19:20:10 | 1 | 12,591 | 486 | 13,077 | Session `01m69pfcnqarczspxb444bttsn`: 12,591 input, 486 output. Its export isn't on GitHub |
| **Kept rewrite** (`8b1fe6c`) | 19:20:44 | 1 | 12,656 | 534 | **13,190** | `runs/run-01/improve-session.json`: 12,656 input, 534 output |
| **Run 2** (95.57) | 19:21:10 to 19:23:22 | 26 | 117,880 | 13,448 | **131,328** | `runs/summary.csv`: 131,328 |
| Demo test on a fictional letter | 19:24:02 to 19:24:08 | 3 | 12,214 | 1,334 | 13,548 | Session `01m69ppg27ye6bk6r7t3sw7nev`: 12,214 input, 1,334 output. Not a counted run, and its export isn't in the repo |

## How to read it

- **What it shows:** the token counts for run 1, the kept rewrite and run 2 match the gateway exactly, and the calls happened inside the times those sessions recorded.
- **What it doesn't show:** the gateway totals don't contain prompts, answers, scores or skill changes. Those are in `runs/`, and the rewrite is in commit `8b1fe6c`.
- **What can't be checked from this repo:** the connection test, dropped rewrite and demo test aren't exported here. They're matched by token totals and timing, because the gateway metrics don't include call contents.

## Where it came from

The numbers are from the gateway's model metrics, filtered to this project's account and to the time windows above. They were read through the TrueFoundry MCP server. Viewing the same data needs a login to the event's TrueFoundry account.
