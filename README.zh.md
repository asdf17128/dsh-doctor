# dsh-doctor

**查出你的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) patch 悄悄改坏了什么。**

[English](README.md) | 中文

```sh
npx dsh-doctor
# 或者直接从源码跑，不需要等 npm 发布：
npx github:asdf17128/dsh-doctor
```

只读、零配置、零依赖。

---

## 问题

你在 `cordis.patch.yml` 里改一个字段：

```yaml
- id: session-title
  config:
    fallbackMaxWords: 12
```

dsh 正常启动，退出码 0，没有任何提示。

但 dsh 处理 id 定向 patch 的方式是**整个替换该条目的 `config`**，不是合并。你没有重写的那两个字段，已经从真正启动的树里消失了：

```diff
  config:
    fallbackMaxWords: 12
-   fallbackMaxBytes: 40
-   maxTitleBytes: 80
```

这个插件现在在没有这些配置的情况下运行。等你发现行为不对，通常已经是几周以后。

拼错 id 同样是静默的。把 `agent-default-model` 写成 `agent-defualt-model`，dsh 只往 stderr 打一行，然后照常启动、退出码 0——用 Web UI 启动时你根本看不到那行。

`dsh-doctor` 把这两类问题都揪出来。

## 效果

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

## 检查项

| 规则 | 级别 | 检出什么 |
|---|---|---|
| `config-clobber` | error | patch 因为没重写而丢掉的默认配置字段 |
| `dead-patch` | error | patch 指向树里不存在的 entry id（带拼写纠正建议） |
| `plugin-not-mounted` | warn | 装进 profile 但根本没被加载的插件 |
| `plugin-stale` | warn | 超过 180 天没发新版的第三方插件 |
| `entry-removed` | warn | 被你的 patch 层移除的官方条目 |
| `entry-toggled` / `entry-added` | info | 与官方 profile 的其他差异，让改动可见 |

## 用法

```sh
npx dsh-doctor                      # 检查 web profile
npx dsh-doctor --profile headless   # 指定 profile
npx dsh-doctor --verbose            # 显示 info 级别提示
npx dsh-doctor --json               # 机器可读输出
npx dsh-doctor --offline            # 跳过 npm registry 查询
npx dsh-doctor --quiet              # 只在有问题时输出
```

退出码：`0` 正常或仅有警告 · `1` 至少一个 error · `2` 无法检查。

适合放进 CI，或者在升级 dsh 前跑一次：

```sh
npx dsh-doctor --quiet || echo "升级 dsh 前先检查一下你的 patch"
```

## 原理

直接复用 dsh 自己的合成结果：

- `dsh --profile <p> --dump-config` —— 真正启动的树（bundles → profile patch → home patch → overlay）
- `dsh --profile <p> --dump-default-config` —— 去掉你的用户层之后的同一棵树

所有结论都来自这两者的差异，所以能把问题归因到**你自己的 patch**，而不是上游默认值。此外还会读取 profile 的 `package.json` 和各层 `cordis.patch.yml`。

工具不会写入 Harness home，不会加载任何插件，也不会执行配置里的 `!!js` 表达式。

## 环境要求

Node 18+，以及一个可用的 `dsh`（优先用本地 `node_modules/.bin/dsh`，否则用 `PATH` 上的）。

## 为什么做这个

dsh 处于 developer preview，会有破坏性变更；「一切皆插件」意味着你的树是一叠 patch 层，而分层规则在一个方向上格外不留情——上面那些失败模式全是静默的。这个工具负责把它们说出来。

行为基于 `@deepseek-ai/dsh` 0.1.0-rc.5 实测验证。

## 参与

欢迎提 issue 和 PR，尤其欢迎带复现步骤的新检查规则。`npm test` 跑测试。

## 许可

MIT
