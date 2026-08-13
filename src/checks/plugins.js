/**
 * Third-party plugin health.
 *
 * The loudest worry in the community about "everything is a plugin" is not the
 * architecture — it is that plugin authors stop maintaining, so a tree you
 * assembled six months ago quietly rots. Two cheap signals catch most of it:
 * how long ago the package was published, and whether something you installed
 * is actually mounted.
 *
 * Network access is best-effort. A registry that times out downgrades the check
 * to "unknown" instead of failing the run, because a doctor that breaks behind a
 * firewall is worse than one that reports less.
 */

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const STALE_DAYS = 180;
const REQUEST_TIMEOUT_MS = 8000;

/** Packages published by the harness itself are maintained with it. */
function isFirstParty(name) {
  return name.startsWith("@deepseek-ai/");
}

async function fetchPackageTime(name, registry, signal) {
  const url = `${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}`;
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const modified = json?.time?.modified ?? json?.modified;
  return modified ? new Date(modified) : null;
}

/**
 * @param {{path: string, json: any} | null} manifest profile package.json
 * @param {import('../parse.js').Entry[]} composed
 * @param {{offline?: boolean, registry?: string, now?: Date}} [opts]
 * @returns {Promise<import('../report.js').Finding[]>}
 */
export async function checkPlugins(manifest, composed, opts = {}) {
  if (!manifest) return [];
  const findings = [];
  const deps = Object.keys(manifest.json?.dependencies ?? {});
  const bundles = manifest.json?.dsh?.profile?.bundles ?? [];
  const mountedNames = new Set(composed.map((e) => e.name));

  for (const dep of deps) {
    if (bundles.includes(dep)) continue;
    if (mountedNames.has(dep)) continue;
    findings.push({
      rule: "plugin-not-mounted",
      severity: "warn",
      entry: null,
      plugin: dep,
      title: `"${dep}" is installed but never mounted`,
      detail:
        "It is a dependency of the profile, but it is neither listed in " +
        "`dsh.profile.bundles` nor inserted by a patch, so nothing loads it.",
      data: {},
      fix: `Add it to dsh.profile.bundles in ${manifest.path}, or uninstall it.`,
    });
  }

  const thirdParty = deps.filter((d) => !isFirstParty(d));
  if (opts.offline || thirdParty.length === 0) return findings;

  const registry = opts.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY;
  const now = opts.now ?? new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const results = await Promise.allSettled(
      thirdParty.map(async (name) => ({
        name,
        modified: await fetchPackageTime(name, registry, controller.signal),
      })),
    );
    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.modified) continue;
      const days = Math.floor((now - r.value.modified) / 86_400_000);
      if (days < STALE_DAYS) continue;
      findings.push({
        rule: "plugin-stale",
        severity: "warn",
        entry: null,
        plugin: r.value.name,
        title: `"${r.value.name}" has not been published in ${days} days`,
        detail:
          "dsh is in developer preview and ships breaking changes; a plugin that " +
          "stopped tracking it is the usual source of a tree that boots today and " +
          "fails after the next upgrade.",
        data: { lastPublish: r.value.modified.toISOString(), days },
        fix: "Check whether the project is still maintained, or pin your dsh version.",
      });
    }
  } catch {
    // Offline or blocked: staleness stays unknown, which is not an error.
  } finally {
    clearTimeout(timer);
  }

  return findings;
}
