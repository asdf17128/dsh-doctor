import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDump } from "../src/parse.js";
import { checkToolCollisions } from "../src/checks/tools.js";

/** Build a throwaway profile dir with plugin packages that register tools. */
function fixture(packages) {
  const root = mkdtempSync(join(tmpdir(), "dsh-doctor-"));
  const profile = join(root, "profiles", "web");
  for (const [name, source] of Object.entries(packages)) {
    const dir = join(profile, "node_modules", ...name.split("/"), "lib");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.js"), source);
  }
  return { root, profile };
}

// Shaped like the real published plugin: an import, then a registration whose
// name literal sits a few lines below the `defineTool({`.
const plugin = (toolName) => `import { defineTool } from "@deepseek-ai/dsh-tools";
export const name = "some-plugin";
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "${toolName}",
    description: "does a thing",
    parameters: {},
    async execute() { return "ok" },
  }));
}
`;

test("two mounted plugins registering the same tool are reported", (t) => {
  const { root, profile } = fixture({
    "@acme/dsh-plugin-a": plugin("search"),
    "@acme/dsh-plugin-b": plugin("search"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const composed = parseDump(`- id: a
  name: '@acme/dsh-plugin-a'
- id: b
  name: '@acme/dsh-plugin-b'
`);
  const findings = checkToolCollisions(profile, composed);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "tool-collision");
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].data.tool, "search");
  assert.deepEqual(findings[0].data.packages, ["@acme/dsh-plugin-a", "@acme/dsh-plugin-b"]);
});

test("distinct tool names do not collide", (t) => {
  const { root, profile } = fixture({
    "@acme/dsh-plugin-a": plugin("search"),
    "@acme/dsh-plugin-b": plugin("sleep"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const composed = parseDump(`- id: a
  name: '@acme/dsh-plugin-a'
- id: b
  name: '@acme/dsh-plugin-b'
`);
  assert.deepEqual(checkToolCollisions(profile, composed), []);
});

test("an installed but unmounted package cannot collide", (t) => {
  const { root, profile } = fixture({
    "@acme/dsh-plugin-a": plugin("search"),
    "@acme/dsh-plugin-b": plugin("search"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Only plugin-a is in the composed tree, so plugin-b never registers.
  const composed = parseDump(`- id: a
  name: '@acme/dsh-plugin-a'
`);
  assert.deepEqual(checkToolCollisions(profile, composed), []);
});

test("a computed tool name is skipped rather than guessed", (t) => {
  const dynamic = `import { defineTool } from "@deepseek-ai/dsh-tools";
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: buildName(), description: "x" }));
}
`;
  const { root, profile } = fixture({
    "@acme/dsh-plugin-a": dynamic,
    "@acme/dsh-plugin-b": dynamic,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const composed = parseDump(`- id: a
  name: '@acme/dsh-plugin-a'
- id: b
  name: '@acme/dsh-plugin-b'
`);
  assert.deepEqual(checkToolCollisions(profile, composed), []);
});

// Regression: dsh-cloudflare-browser-run (a real published plugin) wraps the
// registration, so `defineTool({` never appears next to the name literal.
// Anchoring on the call site missed browse/screenshot/pdf entirely.
const wrapped = `import { defineTool } from "@deepseek-ai/dsh-tools";
export function apply(ctx) {
  const register = (tool) => { ctx.tools.register(defineTool(tool)) };
  register({
    name: 'browse',
    description: 'Fetch a page as markdown',
    parameters: { url: { type: 'string' } },
  });
}
`;

test("tool names survive a wrapped registration helper", (t) => {
  const { root, profile } = fixture({
    "acme-browser": wrapped,
    "acme-scraper": wrapped,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const composed = parseDump(`- id: a
  name: 'acme-browser'
- id: b
  name: 'acme-scraper'
`);
  const findings = checkToolCollisions(profile, composed);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].data.tool, "browse");
});

// A plugin may register unrelated {name, ...} records with other services;
// those must not be mistaken for tools.
test("non-tool records with a name field are not counted", (t) => {
  const shellEnv = `export function apply(ctx) {
  ctx.shellEnv.register({
    name: 'vision-toolkit',
    variables: { DSH_VISION_MODEL: { description: 'Vision model name' } },
  });
}
`;
  const { root, profile } = fixture({ "acme-a": shellEnv, "acme-b": shellEnv });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const composed = parseDump(`- id: a
  name: 'acme-a'
- id: b
  name: 'acme-b'
`);
  assert.deepEqual(checkToolCollisions(profile, composed), []);
});
