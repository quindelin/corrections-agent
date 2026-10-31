// Reads robots.txt, so measurement scripts can honor what a site asks of automated clients.

/** The Disallow rules that apply to every crawler, from the "User-agent: *" group of a robots.txt. */
export function disallowedForAll(robots: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      applies = inAgents ? applies || m[2].trim() === "*" : m[2].trim() === "*";
      inAgents = true;
    } else {
      inAgents = false;
      if (key === "disallow" && applies && m[2].trim()) rules.push(m[2].trim());
    }
  }
  return rules;
}
