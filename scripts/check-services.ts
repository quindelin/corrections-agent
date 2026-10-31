// npm run check:services
// Checks TrueForge, the MCP server and the API, using the same settings the services use. No model calls.
// Inside a deployment, run it from the API container, the only one that can reach all three.
//   TRUEFORGE_BASE_URL   default http://localhost:8790
//   REDLINE_MCP_URL      default: the URL in agent/agent.json
//   REDLINE_API_URL      default http://127.0.0.1:${DEMO_PORT:-8792}
// Exits 1 if a service is down. Warnings mean it's up but can't do its whole job yet.

import { client, env, readAgent } from "./lib.ts";

const { agent } = readAgent();
const mcpUrl = agent.mcp_servers?.[0]?.url ?? "http://127.0.0.1:8791/mcp";
const apiUrl = process.env.REDLINE_API_URL ?? `http://127.0.0.1:${process.env.DEMO_PORT ?? 8792}`;
const TIMEOUT_MS = 5_000;

let failed = false;
const report = (mark: string, what: string, detail: string) => console.log(`${mark.padEnd(4)} ${what.padEnd(11)} ${detail}`);
const ok = (what: string, detail: string) => report("ok", what, detail);
const warn = (what: string, detail: string) => report("warn", what, detail);
const fail = (what: string, detail: string) => {
  failed = true;
  report("FAIL", what, detail);
};

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** One stateless JSON-RPC call to the MCP server. Replies come back as a single SSE message. */
async function mcpCall(method: string, params: unknown): Promise<any> {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text.match(/^data: (.*)$/m)?.[1] ?? text).result;
}

async function checkTrueForge() {
  try {
    const health = (await (await get(new URL("/healthz", env.baseUrl).href)).json()) as { version?: string };
    ok("trueforge", `${env.baseUrl} is up, version ${health.version ?? "unknown"}`);
  } catch (e) {
    return fail("trueforge", `${env.baseUrl}: ${(e as Error).message}`);
  }
  try {
    const { data: models } = await client().models.list();
    if (models.some((m) => m.name === agent.model.name)) ok("trueforge", `model ${agent.model.name} is configured`);
    else warn("trueforge", `model ${agent.model.name} isn't configured, so agent runs will fail (see docs/deploy.md)`);
  } catch (e) {
    warn("trueforge", `couldn't list models: ${(e as Error).message}`);
  }
}

async function checkMcp() {
  try {
    await get(new URL("/health", mcpUrl).href);
    const tools = (await mcpCall("tools/list", {})).tools as unknown[];
    ok("mcp", `${mcpUrl} is up, ${tools.length} tools`);
    const reply = await mcpCall("tools/call", { name: "similar_comments", arguments: { jurisdiction: "seattle", query: "stair", limit: 1 } });
    if (String(reply.content?.[0]?.text).includes("No past comments")) warn("mcp", "no Seattle past comments loaded, so similar_comments returns nothing (npm run real:build)");
    else ok("mcp", "Seattle past comments are loaded");
  } catch (e) {
    fail("mcp", `${mcpUrl}: ${(e as Error).message}`);
  }
}

async function checkApi() {
  try {
    await get(`${apiUrl}/health`);
    ok("api", `${apiUrl} is up`);
  } catch (e) {
    fail("api", `${apiUrl}: ${(e as Error).message}`);
  }
}

await checkTrueForge();
await checkMcp();
await checkApi();
process.exit(failed ? 1 : 0);
