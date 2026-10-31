// Preloaded into servers started by the tests, so a test can't reach TrueForge, the MCP server or a model, whatever
// is running on this machine. The MCP health check passes, because a failed one exits the process.
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/health") return new Response("ok");
  throw new Error("Network is blocked in tests.");
}) as typeof fetch;
