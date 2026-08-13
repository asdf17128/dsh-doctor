/**
 * Observations about the composed tree itself.
 *
 * A fresh `web` profile already boots ~129 entries with ~25 of them disabled.
 * People in the community reported having to point another agent at the repo
 * just to work out what was switched on, so surfacing "what changed from the
 * shipped default, and what is off" is a first-class part of the report rather
 * than a nicety.
 */

/**
 * Entries the user layer turned off, and entries it switched on.
 * @param {import('../parse.js').Entry[]} composed
 * @param {import('../parse.js').Entry[]} defaults
 * @returns {import('../report.js').Finding[]}
 */
export function checkToggles(composed, defaults) {
  const defaultById = new Map(defaults.map((e) => [e.id, e]));
  const findings = [];

  for (const entry of composed) {
    const base = defaultById.get(entry.id);
    if (!base) {
      findings.push({
        rule: "entry-added",
        severity: "info",
        entry: entry.id,
        plugin: entry.name,
        title: `"${entry.id}" was inserted by your patch layer`,
        detail: "This entry is not in the shipped profile; a patch `insert` added it.",
        data: {},
        fix: null,
      });
      continue;
    }
    if (entry.disabledExpr || base.disabledExpr) {
      if (entry.disabledExpr !== base.disabledExpr) {
        findings.push({
          rule: "entry-toggled",
          severity: "info",
          entry: entry.id,
          plugin: entry.name,
          title: `"${entry.id}" enablement changed to a runtime condition`,
          detail: `Now: ${entry.disabledExpr ?? (entry.disabled ? "disabled" : "enabled")}. Default: ${base.disabledExpr ?? (base.disabled ? "disabled" : "enabled")}.`,
          data: {},
          fix: null,
        });
      }
      continue;
    }
    if (entry.disabled !== base.disabled) {
      findings.push({
        rule: "entry-toggled",
        severity: "info",
        entry: entry.id,
        plugin: entry.name,
        title: `"${entry.id}" is ${entry.disabled ? "disabled" : "enabled"} by your patch layer (default: ${base.disabled ? "disabled" : "enabled"})`,
        detail: "Intentional overrides are fine — this is here so the diff is visible.",
        data: {},
        fix: null,
      });
    }
  }

  for (const base of defaults) {
    if (!composed.some((e) => e.id === base.id)) {
      findings.push({
        rule: "entry-removed",
        severity: "warn",
        entry: base.id,
        plugin: base.name,
        title: `"${base.id}" is in the shipped profile but missing from your tree`,
        detail: "A patch removed it. Anything depending on the service it provided will fail to resolve.",
        data: {},
        fix: null,
      });
    }
  }

  return findings;
}

/**
 * A plain summary of the booting tree — entry counts, disabled set, and which
 * layers contributed.
 * @param {import('../parse.js').Entry[]} composed
 */
export function summarize(composed) {
  const layers = new Map();
  for (const e of composed) {
    const key = e.layer ?? "(unlabelled)";
    layers.set(key, (layers.get(key) ?? 0) + 1);
  }
  return {
    entries: composed.length,
    disabled: composed.filter((e) => e.disabled).length,
    layers: [...layers.entries()].map(([layer, count]) => ({ layer, count })),
  };
}
