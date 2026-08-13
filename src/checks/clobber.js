/**
 * Detect config fields a user patch silently dropped.
 *
 * dsh applies an id-targeted patch by *replacing* the entry's whole `config`,
 * not by merging into it. The docs say so in one clause ("restate unchanged
 * fields"), but nothing warns you at boot: patch `fallbackMaxWords` on an entry
 * that also declares `fallbackMaxBytes` and `maxTitleBytes`, and those two are
 * gone from the tree that boots — silently, with the defaults they carried.
 *
 * We reconstruct the loss by diffing the composed tree against the same tree
 * rendered without the user layer: a key path present in the default entry and
 * absent from the composed one was dropped by the user's own patch.
 */

/** Report only the shallowest missing path — a dropped subtree is one finding. */
function shallowest(paths) {
  const sorted = [...paths].sort();
  const out = [];
  for (const p of sorted) {
    if (!out.some((kept) => p === kept || p.startsWith(`${kept}.`))) out.push(p);
  }
  return out;
}

/**
 * @param {import('../parse.js').Entry[]} composed
 * @param {import('../parse.js').Entry[]} defaults
 * @returns {import('../report.js').Finding[]}
 */
export function checkClobber(composed, defaults) {
  const defaultById = new Map(defaults.map((e) => [e.id, e]));
  /** @type {import('../report.js').Finding[]} */
  const findings = [];

  for (const entry of composed) {
    const base = defaultById.get(entry.id);
    if (!base || base.config.size === 0) continue;

    const missing = [];
    for (const path of base.config.keys()) {
      if (!entry.config.has(path)) missing.push(path);
    }
    if (missing.length === 0) continue;

    // An entry the user never patched keeps its default config verbatim, so a
    // difference here always traces back to the user layer. Requiring at least
    // one surviving key avoids flagging entries the user disabled outright.
    const restore = shallowest(missing).map((p) => ({
      path: p,
      value: base.config.get(p) ?? "",
    }));

    findings.push({
      rule: "config-clobber",
      severity: "error",
      entry: entry.id,
      plugin: entry.name,
      title: `patch on "${entry.id}" dropped ${restore.length} default config field${restore.length > 1 ? "s" : ""}`,
      detail:
        "dsh replaces an entry's whole config when a patch targets it. These fields " +
        "were in the shipped defaults but are missing from the tree that boots, so " +
        "the plugin now runs without them.",
      data: { dropped: restore },
      fix:
        `Restate them in your patch for "${entry.id}":\n` +
        restore.map((r) => `    ${r.path}: ${r.value}`).join("\n"),
    });
  }

  return findings;
}
