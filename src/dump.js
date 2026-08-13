/**
 * Locating the user's dsh installation and capturing both config dumps.
 *
 * `--dump-config` renders the tree that actually boots (bundles + profile patch
 * + home patch + overlays). `--dump-default-config` renders the same tree with
 * the user layer removed. Diffing the two is what lets us attribute a change to
 * the user's own patches rather than to an upstream default.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where dsh keeps profiles, mirroring dsh's own `resolveDshHome`. */
export function dshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
}

/**
 * Find a runnable dsh. Prefers a local install so the report describes the same
 * binary the user boots, then a global one on PATH.
 * @returns {{cmd: string, args: string[]} | null}
 */
export function findDsh(cwd = process.cwd()) {
  const local = join(cwd, "node_modules", ".bin", "dsh");
  if (existsSync(local)) return { cmd: local, args: [] };
  return { cmd: "dsh", args: [] };
}

/**
 * @param {string} profile
 * @param {{cwd?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{composed: string, default: string}>}
 */
export async function captureDumps(profile, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const bin = findDsh(cwd);
  const base = ["--profile", profile];
  const exec = async (flag) => {
    const { stdout } = await run(bin.cmd, [...bin.args, ...base, flag], {
      cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  };
  // Sequential on purpose: dsh writes into the profile directory on first use
  // (template init, module fallback healing), and two concurrent boots race.
  const composed = await exec("--dump-config");
  const dflt = await exec("--dump-default-config");
  return { composed, default: dflt };
}

/**
 * Read the id-targeted patch files that make up the user layer, in the order
 * dsh applies them (profile first, then home — the later one outranks).
 * @param {string} profile
 * @returns {{path: string, ids: string[]}[]}
 */
export function readUserPatches(profile) {
  const home = dshHome();
  const candidates = [
    join(home, "profiles", profile, "cordis.patch.yml"),
    join(home, "cordis.patch.yml"),
  ];
  const out = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const ids = [];
    for (const line of text.split("\n")) {
      const m = /^-\s*id:\s*(.+?)\s*$/.exec(line);
      if (m) ids.push(m[1].replace(/^['"]|['"]$/g, ""));
    }
    out.push({ path, ids });
  }
  return out;
}

/**
 * The profile's own package.json: `dependencies` are the out-of-tree plugins the
 * user installed, and `dsh.profile.bundles` is the layer order.
 * @param {string} profile
 */
export function readProfileManifest(profile) {
  const path = join(dshHome(), "profiles", profile, "package.json");
  if (!existsSync(path)) return null;
  try {
    return { path, json: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return null;
  }
}
