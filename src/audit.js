/**
 * The check pipeline, callable from anywhere.
 *
 * The CLI drives this; so does the dsh plugin. Keeping one entry point means an
 * agent asking "is my own config intact?" runs exactly the checks a human runs,
 * with the same findings and the same wording — a second implementation would
 * drift and the two answers would disagree.
 */

import { join } from "node:path";
import { captureDumps, dshHome, readProfileManifest, readUserPatches } from "./dump.js";
import { parseDump } from "./parse.js";
import { checkClobber } from "./checks/clobber.js";
import { checkDeadPatches } from "./checks/dead-patch.js";
import { checkPlugins } from "./checks/plugins.js";
import { checkToolCollisions } from "./checks/tools.js";
import { checkToggles, summarize } from "./checks/tree.js";

/**
 * Run every check against a profile.
 *
 * @param {string} profile
 * @param {{offline?: boolean, cwd?: string}} [opts]
 * @returns {Promise<{findings: import('./report.js').Finding[], summary: object}>}
 */
export async function audit(profile, opts = {}) {
  const dumps = await captureDumps(profile, { cwd: opts.cwd });
  const composed = parseDump(dumps.composed);
  const defaults = parseDump(dumps.default);
  if (composed.length === 0) {
    throw new Error(`profile "${profile}" produced an empty tree`);
  }

  const patches = readUserPatches(profile);
  const manifest = readProfileManifest(profile);
  const findings = [
    ...checkClobber(composed, defaults),
    ...checkDeadPatches(composed, patches),
    ...(await checkPlugins(manifest, composed, { offline: opts.offline })),
    ...checkToolCollisions(join(dshHome(), "profiles", profile), composed),
    ...checkToggles(composed, defaults),
  ];

  const summary = summarize(composed);
  if (manifest) {
    const deps = Object.keys(manifest.json.dependencies ?? {});
    summary.thirdPartyPlugins = deps.filter((d) => !d.startsWith("@deepseek-ai/"));
  }

  return { findings, summary, composed, defaults };
}

/**
 * Condense findings for a model.
 *
 * A model does not need the terminal formatting, and it does badly with a wall
 * of prose: it needs the rule, what broke, and the concrete repair. Info-level
 * notes are dropped — they describe intentional differences from the shipped
 * profile, which is noise when the question is "what is wrong".
 *
 * @param {import('./report.js').Finding[]} findings
 */
export function summarizeForModel(findings) {
  return findings
    .filter((f) => f.severity !== "info")
    .map((f) => ({
      rule: f.rule,
      severity: f.severity,
      entry: f.entry,
      plugin: f.plugin,
      problem: f.title,
      fix: f.fix,
      ...(f.rule === "config-clobber" ? { droppedFields: f.data.dropped } : {}),
    }));
}
