/**
 * Parser for `dsh --dump-config` output.
 *
 * The dump is machine-rendered by dsh's own `renderConfigDump`, so its shape is
 * predictable: entries are top-level sequence items, entry fields sit at indent
 * 2, and config lives under `config:` at indent >= 4. `# ==` comments mark which
 * source file and patch layers produced the run of rows that follows.
 *
 * We parse by indentation rather than with a YAML library on purpose: the dump
 * embeds `!!js` expressions verbatim (`root: !!js dshHomePath('sessions')`),
 * which a strict loader rejects and a permissive one would evaluate. We never
 * need the *values* — only which key paths exist and their literal text — so
 * reading the structure directly is both safer and dependency-free.
 */

const ENTRY_RE = /^- id:\s*(.+)$/;
const KEY_RE = /^(\s*)([^\s#][^:]*):\s*(.*)$/;
const LAYER_RE = /^#\s*==\s*(.+)$/;

/** Strip YAML quoting from a scalar so ids/names compare cleanly. */
function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === "'" && s.at(-1) === "'") || (s[0] === '"' && s.at(-1) === '"'))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * @typedef {object} Entry
 * @property {string} id            entry id (the handle patches target)
 * @property {string} name          plugin package name
 * @property {boolean} disabled     whether the composed tree disables it
 * @property {string|null} layer    `# ==` provenance comment covering this row
 * @property {Map<string,string>} config  dotted key path -> literal value text
 * @property {number} line          1-based line number in the dump
 */

/**
 * Parse a dump into ordered entries.
 * @param {string} text raw stdout of `dsh --dump-config`
 * @returns {Entry[]}
 */
export function parseDump(text) {
  const lines = text.split("\n");
  /** @type {Entry[]} */
  const entries = [];
  let layer = null;
  let current = null;
  // Stack of [indent, keyName] describing the path into the current `config:`.
  let path = [];
  let inConfig = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const layerMatch = LAYER_RE.exec(line.trim());
    if (layerMatch) {
      layer = layerMatch[1].trim();
      continue;
    }
    if (line.trimStart().startsWith("#")) continue;

    const entryMatch = ENTRY_RE.exec(line);
    if (entryMatch) {
      current = {
        id: unquote(entryMatch[1]),
        name: "",
        disabled: false,
        layer,
        config: new Map(),
        line: i + 1,
      };
      entries.push(current);
      path = [];
      inConfig = false;
      continue;
    }
    if (!current) continue;

    const indent = line.length - line.trimStart().length;

    // Entry-level fields live at indent 2 and close any open config subtree.
    if (indent === 2) {
      inConfig = false;
      path = [];
      const m = KEY_RE.exec(line);
      if (!m) continue;
      const key = m[2].trim();
      const value = m[3];
      if (key === "name") current.name = unquote(value);
      else if (key === "disabled") current.disabled = unquote(value) === "true";
      else if (key === "config") inConfig = true;
      continue;
    }

    if (!inConfig || indent < 4) continue;

    const trimmed = line.trimStart();

    // A sequence item belongs to the key that opened it; record it as a leaf so
    // a dropped list is still reported, without inventing per-item paths.
    if (trimmed.startsWith("- ")) {
      const owner = path.length ? path.map((p) => p.key).join(".") : null;
      if (owner) {
        const prev = current.config.get(owner) ?? "";
        current.config.set(owner, prev ? `${prev}\n${trimmed}` : trimmed);
      }
      continue;
    }

    const m = KEY_RE.exec(line);
    if (!m) continue;
    const key = m[2].trim();
    const value = m[3].trim();

    while (path.length && path.at(-1).indent >= indent) path.pop();
    path.push({ indent, key });
    const dotted = path.map((p) => p.key).join(".");
    current.config.set(dotted, value);
  }

  return entries;
}

/**
 * Index entries by id. Duplicate ids cannot occur in a composed tree (the
 * include layer rejects them), so last-wins is safe and keeps lookup simple.
 * @param {Entry[]} entries
 * @returns {Map<string, Entry>}
 */
export function byId(entries) {
  return new Map(entries.map((e) => [e.id, e]));
}
