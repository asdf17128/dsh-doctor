# 待发布内容（需你确认）

## 1. 回帖到 linux.do 2751947

标题帖在讨论「插件化会不会越搞越乱」。这条回复的定位是**贡献一个实测发现**，工具是顺带的，不是硬广。

---

顺着佬的思路我去实测了一下 dsh 的分层 patch，发现两个**完全静默**的坑，我觉得比插件冲突更早会咬到人：

**一、patch 是整体替换 config，不是合并**

比如你只想调一个字段：

```yaml
- id: session-title
  config:
    fallbackMaxWords: 12
```

启动一切正常，退出码 0。但 `session-title` 默认还有 `fallbackMaxBytes: 40` 和 `maxTitleBytes: 80`，**这两个字段直接从启动的树里消失了**——因为 patch 替换的是整个 config。文档里只有一句 "restate unchanged fields" 带过，运行时零提示。

`dsh --profile web --dump-config` 前后对比可以复现。

**二、patch 打到不存在的 id，只警告不报错**

把 `agent-default-model` 手滑写成 `agent-defualt-model`，dsh 往 stderr 打一行就照常启动，退出码还是 0。用 Web UI 起的话那行你根本看不见，只会觉得"我明明改了怎么没生效"。

---

这两个加起来就是 #1 说的「bug 叠 bug 越搞越烂」的来源之一：你的定制在某次升级后悄悄失效，但一切看起来都正常。

所以我写了个小工具把这些查出来，零依赖只读，不写你的 Harness home：

```sh
npx github:asdf17128/dsh-doctor
```

原理是拿 dsh 自己的 `--dump-config` 和 `--dump-default-config` 做差异，所以能把问题精确归因到**你自己的 patch 层**而不是官方默认值。目前查六类：被抹掉的配置字段、失效的 patch（带拼写纠正）、装了但没挂载的插件、半年没更新的第三方插件、被移除的官方条目、以及其他所有与官方 profile 的差异。

仓库：https://github.com/asdf17128/dsh-doctor

如果佬们有别的静默失败场景，欢迎提 issue，带复现步骤我加检查规则。

---

## 2. GitHub Discussions（deepseek-ai/deepseek-harness）

分类建议：Show and tell

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

It diffs `--dump-config` against `--dump-default-config`, so every finding is attributable to the user's own patch layer rather than an upstream default. Zero dependencies, never writes to the Harness home, never evaluates `!!js` expressions.

Repo: https://github.com/asdf17128/dsh-doctor

Happy to add rules for other silent-failure cases — reproductions welcome.

---

## 3. 还需要你做的一件事

`npm login` —— 登录后我就能把包发到 npm，让 README 里的 `npx dsh-doctor` 直接可用（现在只能用 `npx github:...` 这种长写法，对传播有损耗）。`dsh-doctor` 这个名字目前是空的，没被占。
