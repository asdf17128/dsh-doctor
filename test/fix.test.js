import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreFields } from "../src/fix.js";

const PATCH = `# my overrides
- id: session-title
  config:
    fallbackMaxWords: 12
- id: hmr
  disabled: false
`;

test("appends dropped fields into the right config block", () => {
  const out = restoreFields(PATCH, "session-title", [
    { path: "fallbackMaxBytes", value: "40" },
    { path: "maxTitleBytes", value: "80" },
  ]);
  assert.deepEqual(out.applied, ["fallbackMaxBytes", "maxTitleBytes"]);
  assert.deepEqual(out.skipped, []);
  assert.equal(
    out.text,
    `# my overrides
- id: session-title
  config:
    fallbackMaxWords: 12
    fallbackMaxBytes: 40
    maxTitleBytes: 80
- id: hmr
  disabled: false
`,
  );
});

test("leaves comments, ordering and unrelated entries untouched", () => {
  const out = restoreFields(PATCH, "session-title", [
    { path: "fallbackMaxBytes", value: "40" },
  ]);
  assert.ok(out.text.startsWith("# my overrides\n"));
  assert.ok(out.text.includes("- id: hmr\n  disabled: false"));
});

test("preserves the file's own indentation width", () => {
  const wide = `- id: session-title
  config:
      fallbackMaxWords: 12
`;
  const out = restoreFields(wide, "session-title", [
    { path: "maxTitleBytes", value: "80" },
  ]);
  assert.ok(out.text.includes("      maxTitleBytes: 80"));
});

test("skips nested paths rather than inventing intermediate mappings", () => {
  const out = restoreFields(PATCH, "session-title", [
    { path: "limits.maxBytes", value: "40" },
  ]);
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.skipped, ["limits.maxBytes"]);
  assert.equal(out.text, PATCH);
});

test("an entry with no config block is skipped, not rewritten", () => {
  const out = restoreFields(PATCH, "hmr", [{ path: "root", value: "x" }]);
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.skipped, ["root"]);
  assert.equal(out.text, PATCH);
});

test("an unknown entry id changes nothing", () => {
  const out = restoreFields(PATCH, "not-here", [{ path: "a", value: "1" }]);
  assert.equal(out.text, PATCH);
  assert.deepEqual(out.skipped, ["a"]);
});
