#!/usr/bin/env node
// Starts TrueForge, then sets its model provider from env vars, so the key doesn't have to be pasted into Settings.
// TrueForge has no env var for this. Its docs only describe Settings → Models, so this calls the same API the SDK's
// settings.modelProviders.createOrUpdate uses: PUT /api/v1/settings/model-providers.
//
//   MODEL_PROVIDER_API_KEY   the key. If it's empty, nothing is set and Settings → Models still works.
//   MODEL_PROVIDER_BASE_URL  required with a key, e.g. your gateway's OpenAI-compatible URL
//   MODEL_PROVIDER_TYPE      default custom. Also openai, anthropic, truefoundry and others.
//   MODEL_PROVIDER_NAME      default truefoundry. Only custom providers choose a name.
//   MODEL_PROVIDER_MODELS    name=upstream-id, comma separated. Default claude-haiku-4-5.
//
// The key is removed from the environment before TrueForge starts, and it's never logged. Every boot replaces the
// provider with these values, so a change made in Settings to the same provider lasts only until the next restart.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const log = (message) => console.log(`[trueforge-entry] ${message}`);
const key = process.env.MODEL_PROVIDER_API_KEY ?? "";
delete process.env.MODEL_PROVIDER_API_KEY;
const scrub = (text) => (key ? String(text).replaceAll(key, "***") : String(text));

const here = dirname(fileURLToPath(import.meta.url));
const cli = process.env.TRUEFORGE_CLI ?? join(here, "node_modules", "@truefoundry", "trueforge", "dist", "cli.js");
const child = spawn(process.execPath, [cli], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

function buildManifest() {
  const type = process.env.MODEL_PROVIDER_TYPE || "custom";
  const baseUrl = process.env.MODEL_PROVIDER_BASE_URL;
  if (!baseUrl) throw new Error("MODEL_PROVIDER_BASE_URL is required when MODEL_PROVIDER_API_KEY is set");
  const models = (process.env.MODEL_PROVIDER_MODELS || "claude-haiku-4-5").split(",").map((entry) => {
    const [name, upstream] = entry.trim().split("=");
    return { name, model_id: upstream || name, properties: {} };
  });
  return {
    type,
    ...(type === "custom" ? { name: process.env.MODEL_PROVIDER_NAME || "truefoundry" } : {}),
    base_url: baseUrl,
    auth: { api_key: key },
    models,
  };
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (res?.ok) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("TrueForge didn't become healthy within 60 seconds");
}

async function setModelProvider() {
  if (!key) return log("MODEL_PROVIDER_API_KEY is empty, so the model provider is left as it is in Settings → Models");
  const manifest = buildManifest();
  const host = process.env.HOST ?? "localhost";
  const reachable = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const origin = `http://${reachable}:${process.env.PORT ?? 8790}`;
  await waitForHealth(origin);
  const res = await fetch(`${origin}/api/v1/settings/model-providers`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`TrueForge answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
  log(`Model provider "${manifest.name ?? manifest.type}" is set, with ${manifest.models.length} model(s)`);
}

// A bad setting shouldn't stop TrueForge. The check script reports the missing model, and Settings still works.
setModelProvider().catch((e) => log(`Couldn't set the model provider: ${scrub(e.message)}`));
