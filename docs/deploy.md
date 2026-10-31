# Deploying Redline

**Status on 2026-10-31: nothing is deployed, no account exists, and the images have never been built.** Docker wasn't available on the machine where this was written. The services themselves were tested without Docker; see [What was tested](#what-was-tested).

**Recommendation: Fly.io**, at about $11 to $15 a month. Fly's builders make the images, so you don't need Docker. [Exact steps](#deploy-on-flyio) are below.

## What runs where

```
Emris on Vercel ── HTTPS, x-redline-key ──► API :8792   the only public service
                                             ├──► TrueForge :8790 ──► model gateway (internet)
                                             │       └──► MCP :8791
                                             └──► MCP :8791 (health check before each run)
```

| Service | Reachable from | Persistent data | Sees |
|---|---|---|---|
| API (`npm run demo`) | The internet, with `REDLINE_API_KEY` on `/api/` | `/data`: reports, waitlist emails, sign-off notes | `REDLINE_API_KEY`, Stripe keys |
| TrueForge | Private network only | `/data`: SQLite, including sessions and the model key | Model key |
| MCP server | Private network only | None. Its data is in the image | No secrets |

TrueForge must stay private because anyone who can reach it is an admin. [TrueForge's docs](https://trueforge.dev/authentication/overview.md) say this mode should stay on localhost or behind network controls you trust. OIDC login wouldn't help, because local (standalone) mode ignores it.

## What's in `deploy/`

| File | Purpose |
|---|---|
| `Dockerfile` | The API and MCP image. Build context is the repo root |
| `Dockerfile.trueforge` | TrueForge 0.182.0, pinned by `trueforge/package-lock.json`. Build context is `deploy/` |
| `trueforge-entry.mjs` | Starts TrueForge and sets the model provider from env vars |
| `drop-root.sh` | Fixes volume ownership, then runs the service as the `node` user |
| `compose.yaml` | All three services on any machine with Docker |
| `compose.ui.yaml` | Optional: TrueForge's UI on the host's loopback address |
| `fly/*.toml` | The Fly.io config for each service |
| `.env.example` | Placeholders for compose |
| `.dockerignore` | For the TrueForge image |

There's also a `.dockerignore` at the repo root. It has to be there, because Docker only reads that file from the root of the build context, and that's the context the API and MCP image needs. It's an allowlist, and the build also fails if a `.env` gets into the image.

## How it's configured

These settings keep their local defaults when unset.

| Setting | Read by | Default | In a container |
|---|---|---|---|
| `REDLINE_MCP_URL` | `scripts/lib.ts` | `agent/agent.json`'s `http://127.0.0.1:8791/mcp` | The MCP service's private URL |
| `REDLINE_GIT_SHA` | `scripts/lib.ts` | `git rev-parse HEAD` | Set at build, because images have no `.git` and every run calls this |
| `MCP_HOST` | `mcp/server.ts` | `127.0.0.1` | `0.0.0.0`, or `::` on Fly |
| `REDLINE_HOST` | `demo/server.ts` | `127.0.0.1` | `0.0.0.0`, or `::` on Fly |
| `HOST` | TrueForge | `localhost` | `0.0.0.0`, or `::` on Fly |
| `OUTBOUND_URL_ALLOWED_HOSTS` | TrueForge | Empty | The MCP host, as a JSON array |
| `SQLITE_PATH`, `XDG_DATA_HOME` | TrueForge | The user's app data folder | Under `/data` |

**`OUTBOUND_URL_ALLOWED_HOSTS` must match the MCP URL's host exactly**, with no port and no wildcards. TrueForge's guard (`ssrfGuard` in `@truefoundry/trueforge-core`) blocks single-label names such as `mcp`, suffixes such as `.internal`, and private IP addresses unless the exact host is listed. So it's `["mcp"]` in compose and `["redline-mcp.internal"]` on Fly. A mismatch shows up as `Outbound URL blocked for host`.

### Seattle's past comments

`jurisdictions/seattle/comments.jsonl` isn't committed, so `deploy/Dockerfile` builds it with `npm run real:build` in a throwaway stage and copies only that file into the image.

- **Why a throwaway stage:** `real:build` also rewrites `letters.json`, `code.json` and other committed files that the eval depends on. The image keeps the committed versions.
- **It needs network access at build time:** it uses public data from `data.seattle.gov`, with no keys or model calls, and took about 9 seconds here. If the source is down, the build fails.
- **To build without it:** pass `--build-arg SKIP_SEATTLE_COMMENTS=1`. The service still runs, `similar_comments` returns nothing, and `check:services` warns about it.
- **If the city's data changes:** a later build can produce a different file. The deployed tool would then differ from local runs, and comments from the frozen eval's permits could appear in it. Keep running evals locally.

### Volumes

Each service gets one volume, mounted at `/data`, because Fly allows only one per Machine. In the image, `.cache` and `feedback` are symlinks to `/data/cache` and `/data/feedback`, so the code doesn't change.

**Treat both volumes as confidential.** Reports and TrueForge sessions hold customers' letters. A test confirmed that TrueForge stores the model key as plain text in `model_provider.manifest` in its SQLite file. Its API redacts the key, but anyone holding the volume or a snapshot can read it.

## Setting the model key

Pick one.

### From an env var at boot (recommended)

TrueForge has no env var for this. [Its docs](https://trueforge.dev/models.md) only describe Settings → Models. The SDK's `tf.settings.modelProviders.createOrUpdate({ manifest })` does the same job through `PUT /api/v1/settings/model-providers`, so `deploy/trueforge-entry.mjs` calls that route once TrueForge is healthy.

| Env var | Value |
|---|---|
| `MODEL_PROVIDER_API_KEY` | The key. If empty, boot leaves the settings alone |
| `MODEL_PROVIDER_BASE_URL` | The gateway's base URL |
| `MODEL_PROVIDER_TYPE` | `custom` by default |
| `MODEL_PROVIDER_NAME` | `truefoundry` by default. Only `custom` providers choose a name |
| `MODEL_PROVIDER_MODELS` | `name=upstream-id`, comma separated |

Together these must produce `truefoundry/claude-haiku-4-5`, the name in `agent/agent.json`.

**Copy the base URL and upstream model id from your local TrueForge's Settings → Models.** They weren't read while writing this, to leave the running instance alone. The README calls the provider `custom`, but check that too: if it's the built-in TrueFoundry type, set `MODEL_PROVIDER_TYPE=truefoundry`.

How the key is protected:

- It's removed from the environment before TrueForge starts, so TrueForge's process doesn't have it. The wrapper's original environment still holds it, so anyone with a shell in that container could read it.
- It's never logged, and it's scrubbed from error messages.
- Nothing else receives it: the API and MCP containers don't have it.

Each boot replaces the provider with these values, so to rotate the key, change the secret and restart. Edits made in Settings to that provider last only until the next restart. If TrueForge rejects the settings, it logs why and keeps running, and `check:services` warns that the model is missing.

### In the Settings UI

1. Leave `MODEL_PROVIDER_API_KEY` empty.
2. Open a private tunnel. Don't publish the port.
   - Fly: `fly proxy 8790:8790 --app redline-trueforge`
   - Compose: `docker compose -f compose.yaml -f compose.ui.yaml up -d trueforge`. From another machine, add `ssh -L 8790:127.0.0.1:8790 you@server`.
3. Open http://localhost:8790, then **Settings → Models**.
4. Pick your provider, paste the key, and add the model so its full name is `truefoundry/claude-haiku-4-5`. Select **Create**.
5. Close the tunnel. The setting persists on the volume.

## Checking the services

```bash
npm run check:services
```

It checks each service's health, that the MCP server lists its tools, whether Seattle's comments loaded, and whether the agent's model is configured. It makes no model calls. It exits 1 if a service is down, and only warns about the last two. Run it from the API container, the only one that can reach all three. It reads `TRUEFORGE_BASE_URL`, `REDLINE_MCP_URL` and `REDLINE_API_URL`, which defaults to `http://127.0.0.1:$DEMO_PORT`.

## Comparing hosts

Prices and docs were checked on 2026-10-31 and assume US regions and three always-on services with 512 MB each and 1 GB volumes.

| | **Fly.io** | Render | Railway |
|---|---|---|---|
| **Estimated monthly cost** | **$11.37**: 3 × $3.69, plus 2 × $0.15 | **$21.50**: 3 × $7, plus 2 × $0.25 | **About $7 to $21**, my estimate: billed on actual use, so it depends on real load |
| **Compute price** | [$3.69 for shared-cpu-1x with 512 MB, $6.70 with 1 GB](https://docs.fly.io/about/pricing) | $7 for Starter with 512 MB and 0.5 CPU ([specs](https://render.com/docs/compute-plans); the price is from [third-party listings](https://costbench.com/software/developer-tools/render/) because Render's pricing page didn't show it to our fetch) | [About $10 per GB and $20 per vCPU a month; the $5 Hobby plan includes $5 of usage](https://railway.com/pricing) |
| **Volume price** | [$0.15 per GB a month](https://docs.fly.io/about/pricing) | [$0.25 per GB a month](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses) | [About $0.15 per GB a month, 5 GB limit on Hobby](https://railway.com/pricing) |
| **Outbound data** | [$0.02 per GB in North America and Europe](https://docs.fly.io/about/pricing) | Sources disagree, so check before relying on it | [$0.05 per GB](https://railway.com/pricing) |
| **Free option** | [A trial only: 2 hours of runtime or 7 days](https://docs.fly.io/about/pricing) | [Private services and disks need a paid plan](https://render.com/docs/disks) | [A trial, with a 500 MB volume limit](https://railway.com/pricing) |
| **Keeping services private** | [An app with no services or IPs is reachable only on the private network](https://fly.io/docs/reference/privatenetwork) | [A dedicated private service type with no public URL](https://render.com/docs/private-services): the clearest of the three | Not stated on the pages checked |
| **Who shares the private network** | [Every app in your organization](https://docs.fly.io/networking/private-networking), unless you create a custom network | [Every service in the same workspace and region](https://render.com/docs/private-network) | [Each environment has its own](https://docs.railway.com/guides/private-networking): the tightest of the three |
| **Private hostname** | `<app>.internal`, predictable | [Has a suffix, like `elastic-qeqj`](https://render.com/docs/private-network), so you learn it after creating the service, then add it to the allowlist | [`<service>.railway.internal`](https://docs.railway.com/networking/private-networking/how-it-works), predictable |
| **Volumes** | [One per Machine, on that server, no replication, daily snapshots kept 5 days](https://docs.fly.io/volumes/overview) | [One per instance, no zero-downtime deploys, daily snapshots kept 7 days](https://render.com/docs/disks) | [Mounted as root, with manual and automatic backups](https://docs.railway.com/guides/volumes). `drop-root.sh` handles the ownership |

Why Fly.io:

- **Cost:** it's the cheapest fixed price, and about half Render's.
- **Private by default:** a service is private unless you add public routing, and `--no-public-ips` adds a second guard.
- **Repeatable:** the config for each service is in this repo, and hostnames are known in advance.
- **No local Docker:** [remote builds are the default](https://docs.fly.io/flyctl/deploy).

What you give up:

- **Downtime:** [Fly warns](https://docs.fly.io/volumes/overview) that one Machine with one volume goes down during deploys and host failures. Redline can't run more than one TrueForge on SQLite anyway.
- **Shared network:** other apps in the same Fly organization can reach TrueForge. Keep this organization for Redline only, or use a [custom private network](https://docs.fly.io/networking/private-networking).
- **No free tier:** unlike Railway, an idle month costs the same as a busy one.

**When to choose differently:** Render if you'd rather use a dashboard and want the clearest "not public" guarantee, for about $10 more a month. Railway if usage stays low, or if you later move TrueForge to its hosted mode, because [TrueForge publishes a Railway setup](https://trueforge.dev/quickstart.md) with Postgres and Redis.

## Deploy on Fly.io

**These steps have not been run.** App names on Fly are global, so if one is taken, choose another and change it everywhere in `deploy/fly/*.toml`, including the `.internal` hosts and `OUTBOUND_URL_ALLOWED_HOSTS`.

### What you have to do yourself

- Create the Fly.io account and add a card (`fly auth signup`).
- Provide the model key, gateway URL and upstream model id. Rotate the key if it's ever been pasted somewhere shared.
- Generate `REDLINE_API_KEY`, and add it with `REDLINE_API_URL` to Emris's Vercel project. That needs access to the Emris project, which currently requires Renee's approval.
- Add Stripe keys if you're charging. Stripe is untested, and `docs/emris-integration.md` lists what to settle first.
- Decide how long to keep customer letters. Nothing deletes them yet.
- Review legal and privacy terms before real customer letters go in.

### Steps

Run these from the repo root, after installing [flyctl](https://docs.fly.io/flyctl/install/).

**1. Create the apps and volumes.**

```bash
fly auth login
fly apps create redline-trueforge
fly apps create redline-mcp
fly apps create redline-api
fly volumes create redline_trueforge_data --app redline-trueforge --region iad --size 1 --yes
fly volumes create redline_api_data --app redline-api --region iad --size 1 --yes
```

**2. Add the secrets.** Using files keeps them out of your shell history. Git ignores these names, but delete the files afterwards anyway.

```bash
# In deploy/.env.trueforge, with your real values:
#   MODEL_PROVIDER_API_KEY=...
#   MODEL_PROVIDER_BASE_URL=...
#   MODEL_PROVIDER_MODELS=claude-haiku-4-5=your-upstream-model-id
fly secrets import --stage --app redline-trueforge < deploy/.env.trueforge

# Keep this value: Emris needs it in step 5.
openssl rand -hex 32 | sed 's/^/REDLINE_API_KEY=/' > deploy/.env.api
fly secrets import --stage --app redline-api < deploy/.env.api
```

**3. Deploy the private services, then the API.** TrueForge builds from `deploy/`, and the others build from the repo root.

```bash
SHA=$(git rev-parse HEAD)
(cd deploy && fly deploy --config fly/trueforge.toml --dockerfile Dockerfile.trueforge --ha=false --no-public-ips)
fly deploy --config deploy/fly/mcp.toml --dockerfile deploy/Dockerfile --ha=false --no-public-ips --build-arg REDLINE_GIT_SHA=$SHA
fly deploy --config deploy/fly/api.toml --dockerfile deploy/Dockerfile --ha=false --build-arg REDLINE_GIT_SHA=$SHA
```

**4. Verify.** Nothing here calls the model.

```bash
fly ssh console --app redline-api -C "sh -c 'cd /app && npm run check:services'"
curl -i https://redline-api.fly.dev/health            # 200
curl -i https://redline-api.fly.dev/api/offer         # 401 without the key
fly ips list --app redline-trueforge                  # must list nothing
fly ips list --app redline-mcp                        # must list nothing
```

If a private service can't be reached on `.internal`, set its host to `fly-local-6pn`, the name [Fly's docs](https://docs.fly.io/networking/private-networking) use, and redeploy. `::` was chosen because it also serves `fly proxy` and works in local tests, but it hasn't been tried on Fly.

**5. Connect Emris.** In its Vercel project, set `REDLINE_API_URL=https://redline-api.fly.dev` and `REDLINE_API_KEY` to the value from step 2. Then delete `deploy/.env.trueforge` and `deploy/.env.api`.

**6. Make one real run,** which uses model credit, through Emris's `/redline` page or with the key. Then restart with `fly apps restart redline-api` and confirm the report is still there.

## Running with Docker Compose

For any server with Docker. The API listens on plain HTTP, so **add a reverse proxy for TLS** before Emris calls it.

```bash
cd deploy
cp .env.example .env          # then fill it in
REDLINE_GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build
docker compose exec api npm run check:services
```

Only `api` publishes a port. MCP has no route to the internet, and TrueForge's only other network is for reaching the model gateway.

## Known risks

- **TrueForge is running in a mode it calls unsafe for production.** Its CLI help says "local use only, not production-safe" about SQLite standalone mode. This design accepts that for one instance on a private network. The supported hosted mode uses Postgres and Redis, and it's the path for more than one replica or real login.
- **A brief MCP outage can take the API down.** `syncAgent` runs before each analysis and calls `die()`, which exits the whole process if MCP's health check fails. The host restarts the API, but running jobs are lost. This should become a normal error.
- **Restarts lose in-memory state.** Job status, the free-run rate limit and the review queue's matching data are in memory. Clients polling a lost job get a 404. `docs/emris-integration.md` already plans shared storage.
- **No retention limit.** Reports, sessions and backups keep customer letters indefinitely.
- **The pages are public, but their data isn't.** `/`, `/start` and `/r/<id>` serve without the key, but their `/api/` calls return 401. They're only useful through Emris's proxy.

## What was tested

Tested on macOS on Node 24.22.2, the image's Node major version, with TrueForge 0.182.0 installed from `deploy/trueforge/package-lock.json`. The services used ports 8800 to 8805, a separate data directory and `HOME`, and a folder laid out like the image, with no `.git`. The running local instance wasn't touched.

| Tested and passed | |
|---|---|
| Startup | TrueForge through `trueforge-entry.mjs`; API and MCP through `drop-root.sh` as a non-root user. The API refuses to start without a key. `SIGTERM` stops TrueForge cleanly |
| Env overrides | `REDLINE_MCP_URL` replaces the URL TrueForge stores. `REDLINE_GIT_SHA` works with no `.git`, and without it `headSha` fails |
| Binding | `::` for all three, and `0.0.0.0` for MCP |
| Allowlist | With it, TrueForge reached MCP. Without it, TrueForge refused `localhost` and `mcp.localhost`, which stand in for `mcp` and `.internal` names |
| A full run | API to TrueForge, to a **local stub model**, to a real MCP tool result, to a saved report on the volume path. No real model was called |
| Model key | Reached the stub as a bearer token. Not in logs, API responses or TrueForge's process environment. A rejected provider doesn't stop TrueForge |
| Persistence | The provider and agent survive a TrueForge restart with no key set |
| `real:build` | Ran in a scratch copy. Its `comments.jsonl` matched the local file byte for byte, as did `letters.json` and `code.json` |
| `check:services` | Exits 0 when all are up and 1 when services are down, and warns when comments are missing |
| Linting | See the note below |

**Linting:** `deploy/Dockerfile` and `Dockerfile.trueforge` went through `dockerfile-utils` (no problems) and `dockerfilelint` (only two false alarms, on `FROM deps`, a local stage that can't have a tag), both compose files through the Compose schema, the scripts through `sh -n`, and the Fly files through a TOML parser. `@balena/dockerignore` confirmed what each ignore file lets through. hadolint and shellcheck weren't available.

**Not tested:**

- **Any Docker build or container.** This includes Linux installs, `setpriv`, volume ownership as root, Compose networking and `internal: true`, and real service-name DNS such as `mcp`.
- **Anything on Fly.io, Render or Railway,** including `flyctl` commands and the `.internal` names.
- **A real model or gateway,** or real values for the provider settings.
- **The Settings UI steps.** The page loads, but the form wasn't used.
- **Stripe, or Emris calling the API.**
- **Memory under load.** Idle use was about 106 MB for TrueForge and about 50 MB each for the others on macOS, which isn't a reliable guide. If TrueForge runs out of memory on 512 MB, use 1 GB, which adds $3.01 a month.
