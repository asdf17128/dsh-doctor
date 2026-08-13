# dsh-doctor

[![ci](https://github.com/asdf17128/dsh-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/asdf17128/dsh-doctor/actions/workflows/ci.yml)

**Find what your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) patches silently broke.**

English | [中文](README.zh.md)

```sh
npx dsh-doctor
# or straight from source, no npm release needed:
npx github:asdf17128/dsh-doctor
```

Read-only. No config, no signup, no dependencies.

---

## The problem

You patch one field in `cordis.patch.yml`:

```yaml
- id: session-title
  config:
    fallbackMaxWords: 12
```

dsh boots fine. Exit code 0. Nothing warns you.

But dsh applies an id-targeted patch by **replacing the entry's whole `config`**, not by merging into it. The two fields you did not restate are now gone from the tree that actually boots:

```diff
  config:
    fallbackMaxWords: 12
-   fallbackMaxBytes: 40
-   maxTitleBytes: 80
```

That plugin now runs without them. You will not find out until behaviour drifts weeks later.

The same silence covers a typo. Patch `agent-defualt-model` instead of `agent-default-model` and dsh prints one line to stderr, then boots without your change — with exit code 0. In a Web UI launch you never see it.

`dsh-doctor` finds both.

## What it looks like

```
dsh-doctor · profile web · 130 entries (25 disabled)

✗ patch on "session-title" dropped 2 default config fields  config-clobber
    @deepseek-ai/dsh-session-title
    dsh replaces an entry's whole config when a patch targets it. These fields
    were in the shipped defaults but are missing from the tree that boots, so
    the plugin now runs without them.
      - fallbackMaxBytes: 40
      - maxTitleBytes: 80

    fix Restate them in your patch for "session-title":
            fallbackMaxBytes: 40
            maxTitleBytes: 80

✗ patch targets "agent-defualt-model", which is not in the composed tree  dead-patch
    ~/.dsh/profiles/web/cordis.patch.yml patches an entry id that does not
    exist, so dsh prints one stderr warning and boots without it. Everything
    in that patch is inert.

    fix Did you mean "agent-default-model"? Rename the id, or delete the
        patch block if the plugin is gone.

2 error
```

## Checks

| Rule | Severity | What it catches |
|---|---|---|
| `config-clobber` | error | Default config fields your patch dropped by not restating them |
| `dead-patch` | error | A patch targeting an entry id that is not in the tree (with a did-you-mean) |
| `tool-collision` | error | Two mounted plugins registering the same tool name — dsh refuses to start |
| `plugin-not-mounted` | warn | A plugin installed into the profile that nothing ever loads |
| `plugin-stale` | warn | A third-party plugin with no npm release in 180+ days |
| `entry-removed` | warn | A shipped entry your patch layer removed |
| `entry-toggled` / `entry-added` | info | Every other difference from the shipped profile, so the diff is visible |

## Explain mode

A healthy install gets "no problems found", which tells you nothing about what
you are running. `--explain` answers that instead:

```
Your harness: 130 entries, 103 active, 25 disabled, 2 conditional

  Web UI                  32
  Tools                   18  (16 off)
  Sessions & history      11
  Agent loop               5  (1 off)
  ...

Conditional (2) — enablement is decided at mount time, not here
  bash-sandbox             !!js process.platform === 'win32'
  pwsh-sandbox             !!js process.platform !== 'win32'
```

Entries whose `disabled:` is a `!!js` expression are reported as *conditional*
rather than collapsed to a boolean — the answer depends on the machine that
boots, and the tool never evaluates your config to find out.

## Usage

```sh
npx dsh-doctor                      # check the web profile
npx dsh-doctor --explain            # describe the tree instead of checking it
npx dsh-doctor --profile headless   # another profile
npx dsh-doctor --verbose            # include informational notes
npx dsh-doctor --json               # machine-readable
npx dsh-doctor --fix                # restate the dropped fields for you
npx dsh-doctor --offline            # skip npm registry lookups
npx dsh-doctor --quiet              # print only when something is wrong
```

Exit codes: `0` clean or warnings only · `1` at least one error · `2` could not inspect.

Useful in CI, or as a pre-upgrade check:

```sh
npx dsh-doctor --quiet || echo "review your patches before upgrading dsh"
```

## `--fix`

`--fix` restates the fields a patch dropped, writing them back into the same
`config:` block with the values the shipped profile declared:

```diff
  - id: session-title
    config:
      fallbackMaxWords: 12
+     fallbackMaxBytes: 40
+     maxTitleBytes: 80
```

It edits inside that block only — comments, ordering and every other entry stay
byte-identical — and writes a `.bak` beside the file first. A nested key path is
reported for you to restate by hand rather than guessed at, and `dead-patch`
findings are never auto-fixed because renaming versus deleting is your call.

## How it works

It shells out to dsh's own composition:

- `dsh --profile <p> --dump-config` — the tree that actually boots (bundles → profile patch → home patch → overlays)
- `dsh --profile <p> --dump-default-config` — the same tree without your user layer

Every finding is a diff between those two, so the report can attribute a change to *your* patches rather than to an upstream default. It also reads the profile's `package.json` and `cordis.patch.yml` files.

It never boots a plugin and never evaluates the `!!js` expressions in your config.

Two caveats about writes, since "read-only" is easy to overstate:

- `--fix` writes, by design — into the flagged `config:` block only, `.bak` first.
- Composing a profile is dsh's own operation, and dsh materialises a template
  the first time a profile is used. So running this against a `$DSH_HOME` that
  has no profiles yet will leave `profiles/<name>/` behind — created by dsh, not
  by us, but worth knowing before you point it at a pristine home.

## Requirements

Node 18+ and a working `dsh` (local `node_modules/.bin/dsh` is preferred, otherwise one on `PATH`).

## Why this exists

dsh is in developer preview and ships breaking changes; its "everything is a plugin" model means your tree is a stack of patch layers, and the layering rules are unforgiving in exactly one direction — the failure modes above are silent. This tool is the thing that tells you.

Behaviour verified against `@deepseek-ai/dsh` 0.1.0-rc.5.

## Contributing

Issues and PRs welcome — especially new check rules with a reproduction. Run the tests with `npm test`.

## License

MIT
