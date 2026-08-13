# 待发布内容（需你一句话确认）

> 你回一句「发吧」，我就按下面原样发出去。要改哪句直接说。

---

## 1. 回帖到 linux.do 2751947

定位：**贡献一个实测发现**，工具放在最后顺带提，不做硬广。

---

顺着佬的思路我去实测了 dsh 的分层 patch，发现两个**完全静默**的坑，我觉得比插件冲突更早会咬到人。

**一、patch 是整体替换 config，不是合并**

比如你只想调一个字段：

```yaml
- id: session-title
  config:
    fallbackMaxWords: 12
```

启动一切正常，退出码 0。但 `session-title` 默认还有 `fallbackMaxBytes: 40` 和 `maxTitleBytes: 80`，**这两个字段直接从启动的树里消失了**——因为 patch 替换的是整个 config。文档里只有一句 "restate unchanged fields" 带过，运行时零提示。用 `dsh --profile web --dump-config` 前后对比就能复现。

**二、patch 打到不存在的 id，只警告不报错**

把 `agent-default-model` 手滑写成 `agent-defualt-model`，dsh 往 stderr 打一行就照常启动，退出码还是 0。用 Web UI 起的话那行根本看不见，只会觉得"我明明改了怎么没生效"。

这两个加起来就是 1 楼说的「bug 叠 bug 越搞越烂」的一个来源：你的定制在某次升级后悄悄失效，但一切看起来都正常。

**另外**：`tool-bash`、`tool-fs` 这些在 web profile 里是被 `dsh-web-app` 显式关掉的；而在 headless 里写的是 `disabled: !!js process.platform === 'win32'`——运行时表达式。所以"某个工具到底开没开"这个问题，光看一处配置是答不出来的。

---

所以我写了个小工具把这些查出来，零依赖、只读：

```sh
npx github:asdf17128/dsh-doctor
```

原理是拿 dsh 自己的 `--dump-config` 和 `--dump-default-config` 做差异，所以能把问题精确归因到**你自己的 patch 层**而不是官方默认值。

- 七类检查：被抹掉的配置字段、失效 patch（带拼写纠正）、工具重名（这个会让 dsh 直接起不来，而官方报错只说工具名不说是哪两个包）、装了没挂载的插件、半年没更新的第三方插件、被移除的官方条目、其他差异
- `--fix` 自动把被抹掉的字段按默认值补回你的 patch 文件，只动那一个 config 块，写前留 `.bak`
- `--explain` 回答"我这套 dsh 到底装了什么"——按功能域分组，单列出运行时条件启用的条目

仓库：https://github.com/asdf17128/dsh-doctor

有别的静默失败场景欢迎提 issue，带复现我加规则。

---

## 2. GitHub Discussions（deepseek-ai/deepseek-harness）· 分类 Show and tell

**标题**：dsh-doctor — surface the patch failures that boot silently

**正文**：

While exploring the layering model I hit two failure modes that boot cleanly with exit code 0:

1. **An id-targeted patch replaces an entry's whole `config`.** Patching one field silently drops every sibling field you did not restate. `docs/architecture.md` mentions "restate unchanged fields" in one clause, but nothing warns at runtime.

2. **A patch targeting an unknown entry id is inert.** One stderr line, then a normal boot — invisible in a Web UI launch.

Both are easy to hit after an upgrade renames an entry id, and neither surfaces until behaviour drifts.

I wrote a read-only checker for them:

```sh
npx github:asdf17128/dsh-doctor
```

It diffs `--dump-config` against `--dump-default-config`, so every finding is attributable to the user's own patch layer rather than an upstream default. `--fix` restates the dropped fields (textual edit inside that one config block, `.bak` first), and `--explain` groups the ~130-entry tree by area, reporting `disabled: !!js …` entries as conditional rather than collapsing them to a boolean.

It also flags tool-name collisions before boot: the registry rejects a duplicate name and the boot audit escalates it to a startup failure, but the error names the tool and not the two packages fighting over it.

Zero dependencies, never boots a plugin, never evaluates `!!js` expressions.

Repo: https://github.com/asdf17128/dsh-doctor

Happy to add rules for other silent-failure cases — reproductions welcome.

---

## 3. 需要你操作的

**`npm login`** —— 之后我立刻 `npm publish`。包已验证可发（20.4 kB / 15 文件 / 零依赖 / 解包后独立运行正常），`dsh-doctor` 名字还空着。发布后上面两段里的 `npx github:asdf17128/dsh-doctor` 会改成 `npx dsh-doctor`。
