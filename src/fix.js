/**
 * `--fix`: restate the config fields a patch dropped.
 *
 * This is the one path that writes. It edits only inside the `config:` block of
 * an entry the report already flagged, appends the missing keys with the values
 * the shipped profile declared, and leaves every other byte of the file alone —
 * comments, ordering, quoting and anchors included. A YAML round-trip would
 * reformat the user's file and destroy `!!js` expressions, so the edit is
 * textual and deliberately narrow.
 *
 * Anything it cannot place with certainty is reported as skipped rather than
 * guessed at: a half-understood patch file is exactly where a wrong write does
 * the most damage.
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const ENTRY_RE = /^-\s*id:\s*(.+?)\s*$/;

/** Indentation of the first key inside `config:`, or null when it has none. */
function configIndent(lines, configLine) {
  for (let i = configLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) return null;
    return indent;
  }
  return null;
}

/**
 * Insert missing `path: value` pairs into one entry's config block.
 *
 * @param {string} text            patch file contents
 * @param {string} entryId         entry whose config lost fields
 * @param {{path: string, value: string}[]} dropped
 * @returns {{text: string, applied: string[], skipped: string[]}}
 */
export function restoreFields(text, entryId, dropped) {
  const lines = text.split("\n");
  const applied = [];
  const skipped = [];

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY_RE.exec(lines[i]);
    if (m && m[1].replace(/^['"]|['"]$/g, "") === entryId) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return { text, applied, skipped: dropped.map((d) => d.path) };
  }

  // The entry block runs until the next top-level sequence item.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^-\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  let configLine = -1;
  for (let i = start + 1; i < end; i++) {
    if (/^\s{2}config:\s*$/.test(lines[i])) {
      configLine = i;
      break;
    }
  }
  if (configLine === -1) {
    return { text, applied, skipped: dropped.map((d) => d.path) };
  }

  const indent = configIndent(lines, configLine) ?? 4;
  const insertAt = (() => {
    let last = configLine;
    for (let i = configLine + 1; i < end; i++) {
      if (lines[i].trim()) last = i;
    }
    return last + 1;
  })();

  const additions = [];
  for (const d of dropped) {
    // Only flat keys can be appended safely; a nested path would need us to
    // reconstruct intermediate mappings and risk duplicating an existing one.
    if (d.path.includes(".")) {
      skipped.push(d.path);
      continue;
    }
    if (!d.value) {
      skipped.push(d.path);
      continue;
    }
    additions.push(`${" ".repeat(indent)}${d.path}: ${d.value}`);
    applied.push(d.path);
  }
  if (additions.length === 0) return { text, applied, skipped };

  lines.splice(insertAt, 0, ...additions);
  return { text: lines.join("\n"), applied, skipped };
}

/**
 * Apply every config-clobber finding to the patch files that caused them.
 *
 * @param {import('./report.js').Finding[]} findings
 * @param {{path: string, ids: string[]}[]} patchFiles
 * @returns {{file: string, applied: string[], skipped: string[]}[]}
 */
export function applyFixes(findings, patchFiles) {
  const results = [];
  const clobbers = findings.filter((f) => f.rule === "config-clobber");
  if (clobbers.length === 0) return results;

  for (const file of patchFiles) {
    const relevant = clobbers.filter((f) => file.ids.includes(f.entry));
    if (relevant.length === 0) continue;

    let text = readFileSync(file.path, "utf8");
    const applied = [];
    const skipped = [];
    for (const finding of relevant) {
      const out = restoreFields(text, finding.entry, finding.data.dropped);
      text = out.text;
      applied.push(...out.applied.map((p) => `${finding.entry}.${p}`));
      skipped.push(...out.skipped.map((p) => `${finding.entry}.${p}`));
    }
    if (applied.length > 0) {
      copyFileSync(file.path, `${file.path}.bak`);
      writeFileSync(file.path, text);
    }
    results.push({ file: file.path, applied, skipped });
  }
  return results;
}
