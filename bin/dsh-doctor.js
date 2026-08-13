#!/usr/bin/env node
/**
 * dsh-doctor — health check for a DeepSeek Harness profile.
 *
 * Read-only: it shells out to `dsh --dump-config` / `--dump-default-config`,
 * reads the profile's patch files, and reports. It never writes to the Harness
 * home and never boots a plugin.
 */

import process from "node:process";
import { join } from "node:path";
import { captureDumps, readUserPatches, readProfileManifest, dshHome } from "../src/dump.js";
import { parseDump } from "../src/parse.js";
import { checkClobber } from "../src/checks/clobber.js";
import { checkDeadPatches } from "../src/checks/dead-patch.js";
import { checkToggles, summarize } from "../src/checks/tree.js";
import { checkPlugins } from "../src/checks/plugins.js";
import { checkToolCollisions } from "../src/checks/tools.js";
import { renderText, renderJson } from "../src/report.js";
import { renderExplain } from "../src/explain.js";

const HELP = `dsh-doctor — find what your dsh patches silently broke

Usage
  npx dsh-doctor [options]

Options
  --profile <name>   profile to inspect (default: web)
  --json             machine-readable output
  --verbose          include informational notes
  --quiet            only print when something is wrong
  --explain          describe what your harness is made of, instead of checking
  --offline          skip registry lookups (no network)
  -h, --help         show this help

Exit codes
  0  clean (or warnings only)
  1  at least one error-level finding
  2  could not inspect (dsh not found, profile missing)
`;

function parseArgs(argv) {
  const opts = { profile: "web", json: false, verbose: false, quiet: false, offline: false, explain: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--quiet" || a === "-q") opts.quiet = true;
    else if (a === "--offline") opts.offline = true;
    else if (a === "--explain") opts.explain = true;
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a.startsWith("--profile=")) opts.profile = a.slice("--profile=".length);
    else {
      process.stderr.write(`dsh-doctor: unknown option ${a}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return opts;
}

/**
 * Turn a failed `dsh` invocation into one actionable line.
 *
 * dsh reports a bad profile by throwing, so its stderr leads with the source
 * frame that raised. The message we want is the `Error:` line further down —
 * quoting the frame instead would tell the user to reinstall a working dsh.
 */
function explainDshFailure(err, profile) {
  if (err?.code === "ENOENT") {
    return (
      `no \`dsh\` on PATH and none in ./node_modules/.bin.\n` +
      `  Install it:     npm i @deepseek-ai/dsh\n` +
      `  Harness home:   ${dshHome()}`
    );
  }
  const stderr = String(err?.stderr ?? "");
  const errorLine = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Error:"));
  if (errorLine) {
    const message = errorLine.replace(/^Error:\s*/, "").replace(/^dsh:\s*/, "");
    return `dsh could not compose profile "${profile}" — ${message}`;
  }
  const fallback = String(err?.message ?? err).trim().split("\n")[0];
  return `could not run dsh for profile "${profile}" (${fallback})\n  Harness home: ${dshHome()}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let dumps;
  try {
    dumps = await captureDumps(opts.profile);
  } catch (err) {
    process.stderr.write(`dsh-doctor: ${explainDshFailure(err, opts.profile)}\n`);
    return 2;
  }

  const composed = parseDump(dumps.composed);
  const defaults = parseDump(dumps.default);

  if (composed.length === 0) {
    process.stderr.write(
      `dsh-doctor: profile "${opts.profile}" produced an empty tree — is the name right?\n`,
    );
    return 2;
  }

  if (opts.explain) {
    process.stdout.write(renderExplain(composed, summarize(composed)));
    return 0;
  }

  const patches = readUserPatches(opts.profile);
  const manifest = readProfileManifest(opts.profile);
  const findings = [
    ...checkClobber(composed, defaults),
    ...checkDeadPatches(composed, patches),
    ...(await checkPlugins(manifest, composed, { offline: opts.offline })),
    ...checkToolCollisions(join(dshHome(), "profiles", opts.profile), composed),
    ...checkToggles(composed, defaults),
  ];

  const summary = summarize(composed);
  if (manifest) {
    const deps = Object.keys(manifest.json.dependencies ?? {});
    summary.thirdPartyPlugins = deps.filter((d) => !d.startsWith("@deepseek-ai/"));
  }

  const hasError = findings.some((f) => f.severity === "error");

  if (opts.json) {
    process.stdout.write(`${renderJson(findings, summary, opts)}\n`);
  } else if (!opts.quiet || hasError || findings.some((f) => f.severity === "warn")) {
    process.stdout.write(renderText(findings, summary, opts));
  }

  return hasError ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`dsh-doctor: ${err?.stack || err}\n`);
    process.exit(2);
  },
);
