// Shared by the tests in demo/. PGlite is the real Postgres engine compiled to WebAssembly, reached here through the
// real pg driver over a local socket. It's a stand-in: one backend process, so statements never truly run in parallel.

import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import type { Report } from "./reports.ts";
import { applyMigrations } from "./store-postgres.ts";

export const newId = () => randomBytes(16).toString("hex");

/** Free ports in the range this project may use. Other agents' servers and tests share this machine, so none is hard-coded. */
export async function freePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  const start = 8800 + Math.floor(Math.random() * 100);
  for (let i = 0; i < 100 && ports.length < count; i++) {
    const port = 8800 + ((start - 8800 + i) % 100);
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) ports.push(port);
  }
  if (ports.length < count) throw new Error("Not enough free ports in 8800-8899.");
  return ports;
}

/** Five drafted items. C1 to C3 are the free drafts, and C4 and C5 stay locked. */
export function fixtureReport(overrides: Partial<Report> = {}): Report {
  const ids = ["C1", "C2", "C3", "C4", "C5"];
  return {
    id: newId(),
    created_at: new Date().toISOString(),
    jurisdiction: "chicago",
    place: "Chicago",
    permit_number: "1234567-AB",
    project: "A coach house",
    comments: ids.map((id) => ({ id, heading: "Zoning", text: `Comment text ${id}` })),
    items: ids.map((comment) => ({ comment, discipline: "zoning", citation: `CITE-${comment}`, route: "agent_draft", sheets: ["A1"], draft: `DRAFT-${comment}` })) as Report["items"],
    session_id: "session-1",
    trace: [{ name: "search_code", args: "TRACE-SECRET" }],
    unlocked: false,
    unlocked_by: null,
    learning_opt_in: false,
    decisions: {},
    ...overrides,
  };
}

/** What a locked report must never show. */
export const LOCKED_SECRETS = ["DRAFT-C4", "DRAFT-C5", "CITE-C4", "CITE-C5", "TRACE-SECRET"];

export async function startPostgresStandIn(port: number, migrate = true) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  if (migrate) await applyMigrations(admin);
  return {
    url,
    admin,
    stop: async () => {
      await admin.end();
      await server.stop();
      await db.close();
    },
  };
}
