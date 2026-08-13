/**
 * `--explain`: what your harness is actually made of.
 *
 * A fresh `web` profile boots ~130 entries with ~25 of them off. People have
 * reported pointing another agent at the repository just to work out what was
 * switched on, which is a strange price to pay for reading your own setup.
 *
 * The grouping is derived from the package names dsh already uses
 * (`@deepseek-ai/dsh-<area>-<rest>`), so it tracks upstream naming instead of
 * hard-coding a taxonomy that would rot on the next release.
 */

const AREA_LABELS = {
  client: "Web UI",
  tool: "Tools",
  session: "Sessions & history",
  agent: "Agent loop",
  llm: "Model adapters",
  subagent: "Subagents",
  skill: "Skills",
  command: "Commands",
  sandbox: "Sandbox & approval",
  fs: "Filesystem",
  storage: "Storage",
  web: "Web server",
  host: "Host services",
  api: "API gateway",
  compaction: "Context compaction",
  spill: "Context spill",
  goal: "Goals",
  workflow: "Workflows",
  workspace: "Workspace",
  typert: "Type registry",
  user: "User interaction",
  cordis: "Cordis runtime",
};

/** `@deepseek-ai/dsh-session-title` -> `session`; third-party -> null. */
function areaOf(pkg) {
  if (pkg.startsWith("@deepseek-ai/cordis-plugin-")) return "cordis";
  if (!pkg.startsWith("@deepseek-ai/dsh-")) return null;
  const rest = pkg.slice("@deepseek-ai/dsh-".length);
  return rest.split("-")[0];
}

/**
 * @param {import('./parse.js').Entry[]} composed
 * @param {{thirdPartyPlugins?: string[]}} summary
 * @returns {string}
 */
export function renderExplain(composed, summary) {
  const groups = new Map();
  const thirdParty = [];

  for (const e of composed) {
    const area = areaOf(e.name);
    if (area === null) {
      thirdParty.push(e);
      continue;
    }
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(e);
  }

  const lines = [];
  const total = composed.length;
  const off = composed.filter((e) => e.disabled).length;
  const conditional = composed.filter((e) => e.disabledExpr).length;
  lines.push("");
  lines.push(
    `Your harness: ${total} entries, ${total - off - conditional} active, ${off} disabled` +
      (conditional ? `, ${conditional} conditional` : ""),
  );
  lines.push("");

  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [area, entries] of ordered) {
    const disabled = entries.filter((e) => e.disabled);
    const label = AREA_LABELS[area] ?? area;
    const suffix = disabled.length ? `  (${disabled.length} off)` : "";
    lines.push(`  ${label.padEnd(22)} ${String(entries.length).padStart(3)}${suffix}`);
  }

  if (thirdParty.length) {
    lines.push("");
    lines.push(`Third-party plugins (${thirdParty.length})`);
    for (const e of thirdParty) {
      lines.push(`  ${e.id.padEnd(24)} ${e.name}${e.disabled ? "  (off)" : ""}`);
    }
  }

  const offEntries = composed.filter((e) => e.disabled);
  if (offEntries.length) {
    lines.push("");
    lines.push(`Disabled (${offEntries.length}) — these ship with the profile but do not load`);
    for (const e of offEntries) {
      lines.push(`  ${e.id.padEnd(24)} ${e.name}`);
    }
  }

  const conditionalEntries = composed.filter((e) => e.disabledExpr);
  if (conditionalEntries.length) {
    lines.push("");
    lines.push(
      `Conditional (${conditionalEntries.length}) — enablement is decided at mount time, not here`,
    );
    for (const e of conditionalEntries) {
      lines.push(`  ${e.id.padEnd(24)} ${e.disabledExpr}`);
    }
  }

  lines.push("");
  lines.push("Run without --explain to check this tree for problems.");
  lines.push("");
  return lines.join("\n");
}
