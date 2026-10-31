// npm run store -- migrate        apply the SQL in demo/migrations (needs DATABASE_URL)
// npm run store -- purge          delete everything past its limit now
// npm run store -- delete <id>    delete one report, for example when a customer asks

import pg from "pg";
import { applyMigrations } from "./store-postgres.ts";
import { getStore } from "./store.ts";

const [command, id] = process.argv.slice(2);

if (command === "migrate") {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first. The local backend has nothing to migrate.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const applied = await applyMigrations(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date.");
  } finally {
    await pool.end();
  }
} else if (command === "purge" || (command === "delete" && id)) {
  const store = await getStore();
  try {
    if (command === "purge") console.log(await store.purgeExpired());
    else console.log((await store.deleteReport(id)) ? "Deleted." : "No report with that id.");
  } finally {
    await store.close();
  }
} else {
  console.log("usage: npm run store -- migrate | purge | delete <report id>");
  process.exitCode = 1;
}
