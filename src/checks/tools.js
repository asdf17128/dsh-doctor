/**
 * Tool-name collisions.
 *
 * dsh's registry rejects a duplicate name outright — `tool "x" is already
 * registered` — and the boot audit turns that into a startup failure. So two
 * plugins that each register `search` do not degrade gracefully: the harness
 * stops starting, and the error names the tool but not the two packages
 * fighting over it.
 *
 * `--dump-config` still works in that state (composition never mounts a
 * plugin), which is what lets this check answer the question the failure
 * leaves open: which packages collide.
 *
 * Extraction is deliberately conservative. We scan for `defineTool(` and take
 * the first `name:` literal in the window that follows, so a dynamic or
 * computed name is skipped rather than guessed at. Missing a collision is
 * acceptable; inventing one is not.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFINE_TOOL_RE = /defineTool\s*\(\s*\{/g;
const NAME_RE = /name\s*:\s*(['"`])([A-Za-z_][A-Za-z0-9_-]*)\1/;
/** How far past `defineTool({` the name may sit before we give up. */
const NAME_WINDOW = 400;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".bin", ".pnpm", "test", "tests", "__tests__"]);

/** Tool names a package registers, by scanning its shipped JS. */
function toolNamesIn(pkgDir) {
  const names = new Set();
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name), depth + 1);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
      const path = join(dir, e.name);
      try {
        if (statSync(path).size > MAX_FILE_BYTES) continue;
        const src = readFileSync(path, "utf8");
        DEFINE_TOOL_RE.lastIndex = 0;
        let m;
        while ((m = DEFINE_TOOL_RE.exec(src))) {
          const window = src.slice(m.index, m.index + NAME_WINDOW);
          const name = NAME_RE.exec(window);
          if (name) names.add(name[2]);
        }
      } catch {
        // Unreadable file: skip it rather than fail the run.
      }
    }
  };
  walk(pkgDir, 0);
  return names;
}

/** Every package directory under a node_modules, scope-aware. */
function packagesIn(nodeModules) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".bin" || e.name === ".pnpm") continue;
    if (e.name.startsWith("@")) {
      const scope = join(nodeModules, e.name);
      let inner = [];
      try {
        inner = readdirSync(scope, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const i of inner) {
        if (i.isDirectory()) out.push({ name: `${e.name}/${i.name}`, dir: join(scope, i.name) });
      }
      continue;
    }
    out.push({ name: e.name, dir: join(nodeModules, e.name) });
  }
  return out;
}

/**
 * @param {string} profileDir  $DSH_HOME/profiles/<name>
 * @param {import('../parse.js').Entry[]} composed
 * @returns {import('../report.js').Finding[]}
 */
export function checkToolCollisions(profileDir, composed) {
  const mounted = new Set(composed.map((e) => e.name));
  const roots = [join(profileDir, "node_modules"), join(profileDir, "..", "node_modules")];
  /** @type {Map<string, Set<string>>} tool name -> packages registering it */
  const owners = new Map();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const pkg of packagesIn(root)) {
      // Only packages the composed tree actually mounts can collide at boot.
      if (!mounted.has(pkg.name)) continue;
      for (const tool of toolNamesIn(pkg.dir)) {
        if (!owners.has(tool)) owners.set(tool, new Set());
        owners.get(tool).add(pkg.name);
      }
    }
  }

  const findings = [];
  for (const [tool, pkgs] of owners) {
    if (pkgs.size < 2) continue;
    const list = [...pkgs].sort();
    findings.push({
      rule: "tool-collision",
      severity: "error",
      entry: null,
      plugin: list.join(", "),
      title: `${list.length} mounted plugins each register a tool named "${tool}"`,
      detail:
        "dsh's registry rejects a duplicate tool name, and the boot audit turns " +
        "that into a startup failure — the harness will not start while both are " +
        "mounted. The error names the tool but not the packages; these are they.",
      data: { tool, packages: list },
      fix: `Disable one of them, or ask its author to register "${tool}" through an agent scope instead of globally.`,
    });
  }
  return findings;
}
