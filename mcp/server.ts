// npm run mcp
// A small MCP server with the agent's research tools: local code lookup, process rules and permit statistics.
// TrueForge calls it over HTTP (registered by lib.ts as the "permit-research" connector).
//
// One set of tools serves every place. Each tool takes a jurisdiction id, and each jurisdiction is a folder:
//   jurisdictions/<id>/profile.json       who reviews, the code basis, the correction process
//   jurisdictions/<id>/code.json          the code index
//   jurisdictions/<id>/permit-stats.json  permit statistics snapshot (optional)
//   jurisdictions/<id>/comments.jsonl     past correction comments from this city (optional)
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
  history: PastComment[];
}
interface PastComment {
  review_type: string | null;
  subject: string | null;
  cycle: number | null;
  text: string;
  citations: string[];
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
      history: existsSync(file("comments.jsonl")) ? readFileSync(file("comments.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [],
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

const STOP = new Set("the and for that this with are not you your please from have has shall must will per all any provide show see plan plans sheet".split(" "));
const terms = (s: string) => (s.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []).filter((w) => !STOP.has(w));

/** BM25 over a city's past comments, indexed on first use. */
const indexes = new Map<string, { postings: Map<string, [number, number][]>; lengths: number[]; avg: number }>();
function similarComments(id: string, history: PastComment[], query: string, limit: number): PastComment[] {
  let index = indexes.get(id);
  if (!index) {
    const postings = new Map<string, [number, number][]>();
    const lengths = history.map((c, doc) => {
      const words = terms(`${c.subject ?? ""} ${c.text}`);
      const counts = new Map<string, number>();
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
      for (const [w, n] of counts) (postings.get(w) ?? postings.set(w, []).get(w)!).push([doc, n]);
      return words.length;
    });
    index = { postings, lengths, avg: lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length) };
    indexes.set(id, index);
  }
  const scores = new Map<number, number>();
  for (const w of new Set(terms(query))) {
    const list = index.postings.get(w);
    if (!list) continue;
    const idf = Math.log(1 + (history.length - list.length + 0.5) / (list.length + 0.5));
    for (const [doc, n] of list) {
      const tf = (n * 2.2) / (n + 1.2 * (0.25 + (0.75 * index.lengths[doc]) / index.avg));
      scores.set(doc, (scores.get(doc) ?? 0) + idf * tf);
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([doc]) => history[doc]);
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
    "similar_comments",
    {
      description: "Search real past correction comments from this city's reviewers. Shows how they word a requirement, what they cite and what they ask for. Past comments are evidence of practice, not the code itself.",
      inputSchema: { jurisdiction, query: z.string().describe("Words from the comment you're working on"), limit: z.number().int().min(1).max(8).optional() },
      annotations: readOnly,
    },
    async ({ jurisdiction: id, query, limit }) => {
      const pack = packs.get(id);
      if (!pack) return unknownPlace(id);
      if (!pack.history.length) return asText({ error: `No past comments for ${id} yet.` });
      return asText({ results: similarComments(id, pack.history, query, limit ?? 4) });
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
// Stays on loopback unless a deployment sets this. There's no auth here, so only ever bind it to a private network.
const HOST = process.env.MCP_HOST ?? "127.0.0.1";

createServer(async (req, res) => {
  if (req.url === "/health") return void res.writeHead(200).end("ok");
  if (req.url !== "/mcp") return void res.writeHead(404).end();
  // Stateless: a new server and transport per request, which is all read-only tools need.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => void server.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(PORT, HOST, () => {
  const list = [...packs.values()].map((p) => `${p.profile.id} (${p.sections.length} entries, ${p.history.length} past comments)`).join(", ");
  console.log(`permit-research MCP server on http://${HOST}:${PORT}/mcp: ${list}`);
});
