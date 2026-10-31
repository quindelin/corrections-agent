# Connecting Redline to Emris

Reviewed against `renee-stack/Emris` at commit `9e5da76`, on 2026-10-31. Nothing in Emris has been changed.

**Decision:** merge now. Redline's code goes into the Emris repo at `services/redline` with `git subtree`, keeping its history, and this repo stays in place for the challenge. Redline still needs its own server, so `services/redline` deploys separately and Emris reaches it through a proxy. Moving the code doesn't change that.

## What each one is today

| | Emris | Redline |
|---|---|---|
| **Job** | Scores Chicago census tracts to find development momentum | Answers building department correction letters |
| **Buyer** | Multifamily developers and investors | Architects and permit expediters |
| **Pricing** | Subscription by metro, on the pricing page | $59 per permit recommended, not launched |
| **Stack** | Next.js 16.4.3, React 19, Tailwind 4, on Vercel | Node scripts and a plain HTTP server |
| **AI** | Anthropic SDK called directly from API routes | Agent loop on TrueForge, tools over MCP |
| **Storage** | JSON files bundled at build time, no database | Local files under `.cache/`, or Postgres when `DATABASE_URL` is set |
| **Accounts and payments** | None. The request-access form only shows a success state | None. Stripe is coded but untested |
| **Coverage** | Chicago | Seattle real letters; Chicago code index, no real letters |

## Why it still deploys separately

1. **Redline can't run on Vercel as built.** TrueForge is a long-running server with local SQLite, and the MCP server holds its search index in memory. Reports are written to local disk, and Emris's own code notes that Vercel functions can only write to `/tmp`.
2. **TrueForge can't be exposed publicly as it runs now.** Its log says auth is disabled, so it has to stay on a private network behind Redline's API.
3. **The challenge submission stays here.** Judges check for `agent/`, `evals/`, and `runs/summary.csv` in this repo, and for the `Agent-Session` commit history. The copy in Emris doesn't change that, as long as this repo stays in place.
4. **Emris has a change process.** `contract.md` says it's the source of truth and that changes need sign-off from all four builders. New routes and new data fields belong there first.
5. **Write access:** the account used here has read-only access to Emris, so changes need Renee's approval, through a collaborator invite or a pull request from a fork.

## Target design

```
Browser
  └─ Emris on Vercel
       ├─ existing map, memo, and marketing pages
       ├─ /redline and /redline/r/[id]        new React pages
       └─ /api/redline/*                      new proxy, holds the service key
             │  HTTPS, shared secret
             ▼
     Redline service (container host)
       ├─ public API: extract, run, report, unlock, review, export
       ├─ job queue: agent runs take from seconds to over a minute
       ├─ TrueForge (private)  ──► TrueFoundry gateway ──► model
       ├─ MCP tools (private)      jurisdiction packs, past comments
       └─ Postgres and file storage: reports, decisions, encrypted letters
```

### Changes to Redline first

| Change | Why |
|---|---|
| Split `demo/server.ts` into a versioned API and move the pages out | Emris renders the UI |
| Run agents as jobs, and have clients poll | A proxied request shouldn't stay open for a whole agent run |
| Store reports in a database, with a retention limit | Local files don't survive redeploys, and letters can be confidential |
| Require a service key on every API call | Only Emris should reach the API |
| Move rate limits to shared storage | The in-memory limit resets on restart and doesn't span instances |
| Confirm Stripe payments with a webhook too | A customer may never return to the redirect URL |
| Set TrueForge session retention | Sessions also hold letter text |

### Changes to Emris, in PR order

1. **`contract.md`:** add a Redline section with its routes and shapes, and bump the version. Needs the four builders' sign-off.
2. **Proxy routes:** add `app/api/redline/*`, using `REDLINE_API_URL` and `REDLINE_API_KEY`. No model calls and no data files in Emris.
3. **Pages:** rebuild `demo/start.html` in React with Emris's Tailwind tokens, as `app/redline/page.tsx` and `app/redline/r/[id]/page.tsx`. Read the Next docs in `node_modules/next/dist/docs/` first, as Emris's `AGENTS.md` asks, because this Next version differs from older ones.
4. **Navigation:** add a Redline link to `components/marketing/site-tabs.tsx`, plus a section on the platform and pricing pages.
5. **Uploads:** send large PDFs directly to storage or the service, not through a Vercel function, and check Vercel's current request limits first.

## Where the two products connect

- **A permit friction layer on the map (best first link).** Emris's `scripts/score.py` already pulls the same Chicago permit dataset that Redline uses, but it keeps only new construction. The dataset has `processing_time`, so Emris could show typical days to permit by tract. That needs a contract change. Label it honestly: this field can't separate city time from applicant time.
- **From a place to Redline.** A developer who finds a tract can see the friction there and be offered "Got a correction letter? Drop it in."
- **Not from the permit list.** Emris's permits have already been issued, and corrections happen before issue. A "respond to corrections" button on those rows would make no sense. Public data doesn't show in-progress applications with their letters.
- **Developer to architect.** The developer carries the delay cost, and the architect does the work. The existing reviewer link lets a developer buy and pass held items to their architect. Nobody has tested whether developers would pay this way.

## How the code moved

`git subtree add --prefix=services/redline`, so history comes along and no one has to deal with submodules. To bring later changes across from this repo:

```bash
git subtree pull --prefix=services/redline <this repo> <branch>
```

`services` is excluded from Emris's `tsconfig.json`, ESLint config, and `.vercelignore`, so it doesn't affect Emris's build. Redline's MIT license file stays with its code. The Emris repo has no license listed, so settle that with the team.

## Risks to settle

- **Coverage mismatch:** Emris is Chicago only, but Redline's real-data evidence is from Seattle. Redline has no real Chicago letters, and its Chicago code index covers only the code that stops being the default for projects starting December 1, 2026. Getting real Chicago letters and indexing the new code should come before a Chicago launch inside Emris.
- **Two buyers, two prices:** a metro subscription and a per-permit charge may confuse people. Start by keeping them separate, with Redline as an add-on that needs no Emris account.
- **Brand and legal:** Emris's map is an investment signal, while Redline's drafts feed a licensed professional's filing. Keep their disclaimers separate. The Illinois seal question needs a lawyer before any charge, as `docs/pricing-and-onboarding.md` notes.
- **Two model bills:** Emris uses `ANTHROPIC_API_KEY`, and Redline uses a TrueFoundry key. Decide whether to combine them after the $50 credit.

## Also noticed in Emris

- **Lost leads:** the request-access form calls `setSent(true)` and sends nothing, so submissions aren't saved anywhere. This form is the one that matters most for finding customers.
- **Marketing and data disagree:** the pricing page promises a "six-signal composite score", while `contract.md` and the current tract data have three signals. This may be planned work, but it's worth checking before a customer does.

## What's next

1. Get the PR reviewed, including the four-builder sign-off that `contract.md` requires.
2. Deploy `services/redline` on a private container host, with `REDLINE_API_KEY` set. Set `REDLINE_API_URL` and `REDLINE_API_KEY` in Vercel. Until then, the `/redline` page says it isn't connected.
3. Provision Postgres, set `DATABASE_URL` on the service, and run `npm run store -- migrate`. The code is in place, but it hasn't run against a real Postgres server yet.
4. Run real Chicago letters through it with an architect reviewing, before charging anyone.
5. Add the permit friction layer, then Stripe, with a webhook.
