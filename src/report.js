/**
 * Terminal and JSON rendering.
 *
 * @typedef {object} Finding
 * @property {string} rule
 * @property {'error'|'warn'|'info'} severity
 * @property {string|null} entry
 * @property {string|null} plugin
 * @property {string} title
 * @property {string} detail
 * @property {Record<string, unknown>} data
 * @property {string|null} fix
 */

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code) => (s) => (useColor ? `[${code}m${s}[0m` : s);
const red = paint("31");
const yellow = paint("33");
const blue = paint("34");
const dim = paint("2");
const bold = paint("1");

const MARK = { error: red("✗"), warn: yellow("!"), info: blue("·") };

/**
 * @param {Finding[]} findings
 * @param {{entries: number, disabled: number, layers: {layer: string, count: number}[]}} summary
 * @param {{profile: string, verbose: boolean}} opts
 */
export function renderText(findings, summary, opts) {
  const lines = [];
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  const infos = findings.filter((f) => f.severity === "info");

  lines.push("");
  lines.push(
    `${bold("dsh-doctor")} ${dim(`· profile ${opts.profile} · ${summary.entries} entries (${summary.disabled} disabled)`)}`,
  );
  lines.push("");

  const shown = opts.verbose ? [...errors, ...warns, ...infos] : [...errors, ...warns];

  if (shown.length === 0) {
    lines.push(`  ${MARK.info} no problems found`);
    if (infos.length && !opts.verbose) {
      lines.push(dim(`  ${infos.length} informational note(s) — rerun with --verbose to see them`));
    }
    lines.push("");
    return lines.join("\n");
  }

  for (const f of shown) {
    lines.push(`${MARK[f.severity]} ${bold(f.title)}  ${dim(f.rule)}`);
    if (f.plugin) lines.push(dim(`    ${f.plugin}`));
    lines.push(`    ${f.detail}`);
    if (f.rule === "config-clobber") {
      for (const d of f.data.dropped) {
        lines.push(`      ${red("-")} ${d.path}${d.value ? `: ${d.value}` : ""}`);
      }
    }
    if (f.fix) {
      lines.push("");
      const fixLines = f.fix.split("\n");
      lines.push(`    ${dim("fix")} ${fixLines[0]}`);
      for (const l of fixLines.slice(1)) lines.push(`        ${l}`);
    }
    lines.push("");
  }

  const parts = [];
  if (errors.length) parts.push(red(`${errors.length} error`));
  if (warns.length) parts.push(yellow(`${warns.length} warning`));
  if (infos.length) parts.push(dim(`${infos.length} note`));
  lines.push(parts.join(dim(" · ")));
  if (infos.length && !opts.verbose) lines.push(dim("rerun with --verbose for notes"));
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Finding[]} findings
 * @param {object} summary
 * @param {{profile: string}} opts
 */
export function renderJson(findings, summary, opts) {
  return JSON.stringify(
    {
      profile: opts.profile,
      summary,
      counts: {
        error: findings.filter((f) => f.severity === "error").length,
        warn: findings.filter((f) => f.severity === "warn").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
      findings,
    },
    null,
    2,
  );
}
