/**
 * dsh-doctor as a DeepSeek Harness plugin.
 *
 * Registers a `config_doctor` tool so the agent can inspect the configuration
 * it is itself running under. That is the thing a CLI cannot do: when a user
 * says "why isn't my setting taking effect", the agent can now answer from the
 * composed tree instead of guessing — the common cause is a patch that replaced
 * an entry's whole config and silently dropped the neighbouring fields.
 *
 * The tool is read-only. It shells out to `dsh --dump-config`, never writes to
 * the Harness home, and never evaluates the `!!js` expressions in the config it
 * reads. `--fix` stays CLI-only on purpose: rewriting the user's patch file is
 * not something an agent should do from a chat turn.
 */

import { audit, summarizeForModel } from "../src/audit.js";

export const name = "dsh-doctor";
export const inject = ["tools"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{profile?: string, offline?: boolean}} [config]
 */
export function apply(ctx, config = {}) {
  const defaultProfile = config.profile ?? "web";
  const offline = config.offline ?? false;

  ctx.tools.register({
    name: "config_doctor",
    description:
      "Check this harness's own configuration for problems that boot silently: " +
      "config fields a patch dropped by whole-config replacement, patches targeting " +
      "entry ids that no longer exist, tool-name collisions, installed-but-unmounted " +
      "plugins, and unmaintained third-party plugins. Read-only.",
    parameters: {
      profile: {
        type: "string",
        required: false,
        description: `Profile to inspect (default: ${defaultProfile}).`,
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          profile: { type: "string" },
          entries: { type: "number" },
          problems: { type: "array" },
        },
        required: ["profile", "entries", "problems"],
      },
      render: (_args, value) => [{ type: "text", text: renderForModel(value) }],
    },
    async execute(args) {
      const profile = args?.profile || defaultProfile;
      const { findings, summary } = await audit(profile, { offline });
      return {
        profile,
        entries: summary.entries,
        problems: summarizeForModel(findings),
      };
    },
  });
}

/** Plain text beats JSON here — the model reads this straight into its answer. */
function renderForModel(value) {
  if (value.problems.length === 0) {
    return `Profile "${value.profile}" (${value.entries} entries): no problems found.`;
  }
  const lines = [
    `Profile "${value.profile}" (${value.entries} entries) — ${value.problems.length} problem(s):`,
  ];
  for (const p of value.problems) {
    lines.push(`\n[${p.severity}] ${p.problem}`);
    if (p.droppedFields) {
      for (const d of p.droppedFields) lines.push(`  dropped: ${d.path}: ${d.value}`);
    }
    if (p.fix) lines.push(`  fix: ${p.fix.split("\n")[0]}`);
  }
  return lines.join("\n");
}
