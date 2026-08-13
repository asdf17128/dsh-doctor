import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDump } from "../src/parse.js";
import { checkClobber } from "../src/checks/clobber.js";
import { checkDeadPatches } from "../src/checks/dead-patch.js";
import { checkToggles } from "../src/checks/tree.js";

// Shapes copied from real `dsh --dump-config` output, including the `!!js`
// scalar and the nested list that make a strict YAML loader unusable here.
const DEFAULT_DUMP = `# == @deepseek-ai/dsh-base
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root:
      - .
  disabled: true
- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 5
    fallbackMaxBytes: 40
    maxTitleBytes: 80
- id: session-persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')
`;

test("parses entries, nested keys, lists and !!js scalars", () => {
  const entries = parseDump(DEFAULT_DUMP);
  assert.equal(entries.length, 4);

  const hmr = entries.find((e) => e.id === "hmr");
  assert.equal(hmr.name, "@deepseek-ai/cordis-plugin-hmr");
  assert.equal(hmr.disabled, true);
  assert.ok(hmr.config.has("root"));

  const persistence = entries.find((e) => e.id === "session-persistence");
  assert.equal(persistence.config.get("root"), "!!js dshHomePath('sessions')");

  const title = entries.find((e) => e.id === "session-title");
  assert.deepEqual([...title.config.keys()], [
    "fallbackMaxWords",
    "fallbackMaxBytes",
    "maxTitleBytes",
  ]);
  assert.equal(title.layer, "@deepseek-ai/dsh-base");
});

test("config-clobber reports fields a patch dropped, with a restore snippet", () => {
  const composed = parseDump(`# == @deepseek-ai/dsh-base, patched by cordis.patch.yml
- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 99
`);
  const findings = checkClobber(composed, parseDump(DEFAULT_DUMP));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "config-clobber");
  assert.equal(findings[0].severity, "error");
  assert.deepEqual(findings[0].data.dropped, [
    { path: "fallbackMaxBytes", value: "40" },
    { path: "maxTitleBytes", value: "80" },
  ]);
  assert.match(findings[0].fix, /fallbackMaxBytes: 40/);
});

test("a patch restating every field is not a clobber", () => {
  const composed = parseDump(`- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 99
    fallbackMaxBytes: 40
    maxTitleBytes: 80
`);
  assert.deepEqual(checkClobber(composed, parseDump(DEFAULT_DUMP)), []);
});

test("toggling disabled without a config block is not a clobber", () => {
  const composed = parseDump(`- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root:
      - .
  disabled: false
`);
  assert.deepEqual(checkClobber(composed, parseDump(DEFAULT_DUMP)), []);
  const toggles = checkToggles(composed, parseDump(DEFAULT_DUMP)).filter(
    (f) => f.rule === "entry-toggled",
  );
  assert.equal(toggles.length, 1);
  assert.match(toggles[0].title, /enabled by your patch layer/);
});

test("dead-patch flags unknown ids and suggests a near miss", () => {
  const composed = parseDump(DEFAULT_DUMP);
  const findings = checkDeadPatches(composed, [
    { path: "/tmp/cordis.patch.yml", ids: ["session-titel", "totally-unrelated-name"] },
  ]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].data.suggestion, "session-title");
  assert.equal(findings[1].data.suggestion, null);
});

test("a patch targeting a live id produces nothing", () => {
  const findings = checkDeadPatches(parseDump(DEFAULT_DUMP), [
    { path: "/tmp/cordis.patch.yml", ids: ["session-title"] },
  ]);
  assert.deepEqual(findings, []);
});
