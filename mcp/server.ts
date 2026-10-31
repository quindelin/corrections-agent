// npm run mcp
// A small MCP server with the agent's research tools: local code lookup, process rules and permit statistics.
// TrueForge calls it over HTTP (registered by lib.ts as the "permit-research" connector).
//
// One set of tools serves every place. Each tool takes a jurisdiction id, and each jurisdiction is a folder:
//   jurisdictions/<id>/profile.json       who reviews, the code basis, the correction process
//   jurisdictions/<id>/code.json          the code index
//   jurisdictions/<id>/permit-stats.json  permit statistics snapshot (optional)
// Add a place by adding a folder. Every tool is read-only and answers from these files,
// so an eval run gets the same tool results every time.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "jurisdictions");

interface Section {
  id: string;
  title: string;
  scope: string;
}
interface Pack {
  profile: { id: string; name: string; [k: string]: unknown };
  sections: Section[];
  stats: unknown;
}

function loadPacks(): Map<string, Pack> {
  const packs = new Map<string, Pack>();
  for (const id of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const file = (name: string) => join(ROOT, id, name);
    if (!existsSync(file("profile.json")) || !existsSync(file("code.json"))) continue;
    packs.set(id, {
      profile: JSON.parse(readFileSync(file("profile.json"), "utf8")),
      sections: JSON.parse(readFileSync(file("code.json"), "utf8")).sections,
      stats: existsSync(file("permit-stats.json")) ? JSON.parse(readFileSync(file("permit-stats.json"), "utf8")) : null,
    });
  }
  return packs;
}

const packs = loadPacks();
const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const unknownPlace = (id: string) => asText({ error: `Unknown jurisdiction "${id}". Available: ${[...packs.keys()].join(", ")}` });
const words = (s: string) => s.toLowerCase().match(/[a-z0-9-]+/g) ?? [];

/** Rank sections by how many query words appear in their id, title and scope. Titles count double. */
function searchCode(sections: Section[], query: string, limit: number): Section[] {
  const terms = [...new Set(words(query))];
  const hits = (list: string[]) => terms.filter((t) => list.some((w) => w.startsWith(t) || (t.startsWith(w) && w.length > 3))).length;
  return sections
    .map((s) => ({ s, rank: 2 * hits(words(`${s.id} ${s.title}`)) + hits(words(s.scope)) }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((r) => r.s);
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "permit-research", version: "0.2.0" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const jurisdiction = z.string().describe("Jurisdiction id from the project details, e.g. chicago");

  server.registerTool(
    "list_jurisdictions",
    { description: "List the places this agent has code and process data for.", inputSchema: {}, annotations: readOnly },
    async () => asText({ jurisdictions: [...packs.values()].map((p) => p.profile) }),
  );

  server.registerTool(
    "search_code",
    {
      description: "Search a jurisdiction's code index and process notes by topic. Returns entry ids, titles and scope summaries.",
      inputSchema: { jurisdiction, query: z.string().describe("Topic words, e.g. 'stair headroom' or 'zoning variation'"), limit: z.number().int().min(1).max(10).optional() },
      annotations: readOnly,
    },
    async ({ jurisdiction: id, query, limit }) => {
      const pack = packs.get(id);
      return pack ? asText({ results: searchCode(pack.sections, query, limit ?? 5) }) : unknownPlace(id);
    },
  );

  server.registerTool(
    "get_section",
    {
      description: "Get one entry from a jurisdiction's code index by its exact id. An unknown id means the citation can't be verified.",
      inputSchema: { jurisdiction, id: z.string() },
      annotations: readOnly,
    },
    async ({ jurisdiction: place, id }) => {
      const pack = packs.get(place);
      if (!pack) return unknownPlace(place);
      const found = pack.sections.find((s) => s.id.toLowerCase() === id.trim().toLowerCase());
      return asText(found ?? { error: `No entry "${id}" in ${place}. Use search_code to find the right section.` });
    },
  );

  server.registerTool(
    "permit_stats",
    {
      description: "Published permit processing statistics for a jurisdiction, if available.",
      inputSchema: { jurisdiction },
      annotations: readOnly,
    },
    async ({ jurisdiction: id }) => {
      const pack = packs.get(id);
      return pack ? asText(pack.stats ?? { error: `No permit statistics for ${id} yet.` }) : unknownPlace(id);
    },
  );

  return server;
}

const PORT = Number(process.env.MCP_PORT ?? 8791);

createServer(async (req, res) => {
  if (req.url === "/health") return void res.writeHead(200).end("ok");
  if (req.url !== "/mcp") return void res.writeHead(404).end();
  // Stateless: a new server and transport per request, which is all read-only tools need.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => void server.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(PORT, "127.0.0.1", () => {
  const list = [...packs.values()].map((p) => `${p.profile.id} (${p.sections.length} entries)`).join(", ");
  console.log(`permit-research MCP server on http://127.0.0.1:${PORT}/mcp: ${list}`);
});
