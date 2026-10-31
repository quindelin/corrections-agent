# Feedback for TrueFoundry

We built Redline and three supporting agents on TrueForge in a day, using a local server and a TrueFoundry AI Gateway model.

## What worked well

- **Getting started:** `npx` gave us a working agent within minutes, and the starter's loop gave us a real evaluation on day one.
- **Inspecting runs:** the Sessions view and the SDK's session, turn and event calls gave us evidence for every run and an audit trail of tool calls.
- **Models and variations:** custom providers made a gateway model simple to use. Inline agent specs let us run a variation, such as removing one tool, without changing the saved agent.
- **MCP:** tools worked first time once the connector was registered and the local host was allowed.

## What slowed us down

- **Local MCP servers:** reaching one needs `OUTBOUND_URL_ALLOWED_HOSTS`, which we found through the starter README, not the MCP docs.
- **Provider status:** a custom provider shows a green "Connected" label before it has an API key. We'd prefer a real test button.
- **Gateway URLs:** it wasn't clear whether a custom provider's base URL needs `/v1`. Both forms returned the same unauthorized error until we had a key.
- **Skills on a Mac:** in our test of real skills, the local sandbox started but couldn't run `git`, so the skills never loaded. The run still finished with a score, so a setup problem can look like a weak agent. Failing loudly would help. We suspect a developer-tools path problem on our machine, but haven't confirmed it.
- **Subagents:** we told the agent to hand citation lookups to subagents, and its session shows it never used one. We'd like clearer guidance on how to make delegation happen.
- **Session export:** there's no export endpoint, so we paged through sessions, turns and events ourselves. A built-in export would help anyone keeping evidence in a repo.
- **Model routing:** we wanted a cheap model for sorting and a stronger one for drafting, but the docs say per-task and per-subagent selection isn't available yet.
- **Going to production:** standalone mode runs with auth disabled and stores the model key as plain text in SQLite. A short hardening guide would help.
- **Serverless hosts:** TrueForge needs a long-running server, so it can't sit inside a Vercel app. A documented pattern for a separate service and job queue would save time.

## What we'd ask for

A built-in way to compare two runs, including held-out tasks, would make self-improvement much safer. Our most useful finding was that a rewrite can score better on what it trained on and worse on what it didn't, and a scorer can't catch a false rule. A review view showing an agent's self-edits next to their effect on held-out tasks would be a strong feature.
