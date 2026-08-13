/**
 * Detect patches that target an entry id no longer in the tree.
 *
 * dsh warns once on stderr ("patch: entry X not found") and boots anyway with
 * exit code 0, so the line is easy to miss in a web-UI launch and the
 * customization simply stops applying. This is the failure mode that bites
 * after an upgrade renames or removes an entry id.
 */

/**
 * @param {import('../parse.js').Entry[]} composed
 * @param {{path: string, ids: string[]}[]} patches
 * @returns {import('../report.js').Finding[]}
 */
export function checkDeadPatches(composed, patches) {
  const live = new Set(composed.map((e) => e.id));
  /** @type {import('../report.js').Finding[]} */
  const findings = [];

  for (const file of patches) {
    for (const id of file.ids) {
      if (live.has(id)) continue;
      const near = nearest(id, live);
      findings.push({
        rule: "dead-patch",
        severity: "error",
        entry: id,
        plugin: null,
        title: `patch targets "${id}", which is not in the composed tree`,
        detail:
          `${file.path} patches an entry id that does not exist, so dsh prints one ` +
          "stderr warning and boots without it. Everything in that patch is inert.",
        data: { file: file.path, suggestion: near },
        fix: near
          ? `Did you mean "${near}"? Rename the id, or delete the patch block if the plugin is gone.`
          : "Delete the patch block, or reinstall the plugin that used to provide this id.",
      });
    }
  }

  return findings;
}

/** Closest live id by edit distance, when it is close enough to be a typo. */
function nearest(id, live) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of live) {
    const d = distance(id, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(id.length / 3));
  return bestScore <= limit ? best : null;
}

function distance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[b.length];
}
