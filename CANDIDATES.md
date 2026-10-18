# 首批候选插件（待产品负责人批准）/ Proposed first candidates

> 状态：**提议，未收录**。`plugins.yml` 目前没有任何正式条目。下面每一项只是初审（2026-10-19，依据 npm 元数据、tarball 代码扫描和 GitHub 仓库活跃度）；批准后还要在 VibeDev（DSH `0.2.1-rc.2`）里实际安装试用，按 [README](README.md#审核清单) 的审核清单补全记录，再通过 PR 写进 `plugins.yml`。
>
> Status: **proposed, not listed.** `plugins.yml` has no production entries. Each row is an initial review only; after approval it still needs a hands-on test on VibeDev (DSH `0.2.1-rc.2`) and a full review record in a PR.

数据来源：awesome-dsh-plugin 目录（2026-10-18，5,895 条）按 star/下载量筛选，再用 `npm run inspect -- <name>@<version> --deps` 逐个检查（不安装、不执行包代码）。“兼容”同时指 Discover 列表视角（索引里的 `engines.dsh`）和 DSH 安装时的检查（`engines.dsh`，否则 `@deepseek-ai/dsh-*` peers）。

## 总览

| # | 包与版本 | 分类 | 许可证 | DSH 0.2.1-rc.2 | 安装脚本 | 解包大小 / 依赖 | 网络 | 子进程 | 初审结论 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `dsh-context@0.73.2` | usage | Apache-2.0 ✅ | ✅ `>=0.1.7-rc.2 \|\| >=0.2.0-rc.2` | 无 | 0.57 MiB / 1（zod） | models.dev、registry.npmjs.org、registry.npmmirror.com、api.deepseek.com | 无 | **建议收录** |
| 2 | `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3` | browser | MIT ✅ | ✅ `^0.1.5-rc.3 \|\| ^0.2.0-rc.1` | 无 | 0.45 MiB / 0 | 浏览器自动化访问用户指定的网页 | 有（`spawn`，待确认程序） | **建议收录** |
| 3 | `@agentscope-ai/reme-dsh-plugin@0.1.2` | memory | Apache-2.0 ⚠️ 包内无 LICENSE | ✅ `^0.1.7-rc.2 \|\| ^0.2.0-rc.2 \|\| ^0.2.1-alpha.2` | 无 | 2.91 MiB / 0 | 本机 ReMe 服务 `127.0.0.1:2333`（`REME_HOST`/`REME_PORT`） | 无 | **建议收录**（需用户自备 ReMe 服务） |
| 4 | `@nanmicoder/dsh-agent-teams@0.1.25` | workflow | MIT ✅ | ✅ 明确列出 `0.2.1-rc.2` | 无 | 3.26 MiB / 0 | 只访问自身 Host 路由 | 无 | **建议收录**（会消耗模型额度：子代理） |
| 5 | `@linxin666/dsh-client-ui-skill-explorer@0.4.7` | dev | BSD-3-Clause ✅ | ✅ `>=0.2.1-rc.2` | 无 | 0.28 MiB / 0 | **每天向 dsh-market.com 发一次匿名安装心跳** | 无 | 需负责人决定（第三方遥测） |
| 6 | `@zilliz/memsearch-dsh@0.1.6` | memory | MIT ⚠️ 包内无 LICENSE | ✅（无 DSH 声明范围限制） | 无 | 0.18 MiB / 0 | memsearch CLI 自身 | **`bash -c memsearch …`** | 需负责人决定（Windows 需 bash + Python CLI） |
| 7 | `@openviking/dsh-memory-plugin@0.5.26` | memory | ⚠️ 包写 Apache-2.0，仓库根是 AGPL-3.0，包内无 LICENSE | ✅ `>=0.1.0-rc.6 <1.0.0-0` | 无 | 0.31 MiB / 0 | OpenViking 服务（环境变量配置） | 无 | 暂缓：先向维护者确认许可证 |
| 8 | `dsh-better-sidebar@0.28.0` | ui | MIT ✅ | ✅ `^0.2.1-rc.1` 等 13 个 peer | 无 | 18.12 MiB / 33（树 169） | 多处 | git、归档工具、打开外部程序 | 第二批（体量大，需深审） |

完整性（integrity，`dist.integrity`），批准后直接用于 `plugins.yml`：

| 包与版本 | integrity |
|---|---|
| `dsh-context@0.73.2` | `sha512-C1UQrNogShFx/uYpg/aED0Qd7x7oX8Tay2gwfhYy89VxDOg1sPIeML3yttvFDfzPLeGpP1JU9qksTNyYoY8YAA==` |
| `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3` | `sha512-YleWGGDN7re7arDD8PVgcIuTeMXHne4JKilLaKmvO9L1EzvOKNKVXZ3eHq7CXbgF7uooxRjnYviMH2QMRqZv+A==` |
| `@agentscope-ai/reme-dsh-plugin@0.1.2` | `sha512-dZQSyknARE76fjYnNqK63Kai8MS6QSZ+bUNNG8fwl1syWb3BptyngweQkphxfYtE6sonzXK5MVwxbLgf0c7+qg==` |
| `@nanmicoder/dsh-agent-teams@0.1.25` | `sha512-p8ElanLgY2Tp+/MvpmZiVCFg8feE43stctPa/FHC6fYmxou5G7oblBLQoSc5HuK1d3vxieJptwDOJwXdz47IBg==` |
| `@linxin666/dsh-client-ui-skill-explorer@0.4.7` | `sha512-BFUfTBUywJk6N7x6P894GnxjltOhZcx3A7cU1GT95fCdVWt4dAKLc8XeQdmreSBTpreHbyPfcgm4RBqnYXs1Eg==` |
| `@zilliz/memsearch-dsh@0.1.6` | `sha512-bbGaGVFxPLu93Jxv7ZxPZJF3h0SQiqp+5ps0B/U5InZbeMiZxBeeVX244vhukSnvIrdyv9lv6wunG02BjY2iaw==` |
| `@openviking/dsh-memory-plugin@0.5.26` | `sha512-bNTNv7frjBexYdJR1RGL88uWaz+4FtJMPvuVwGAHuaSow4AN5AqnDYHw95oObjghmTq5lm5omLzKXBDWur0MYA==` |
| `dsh-better-sidebar@0.28.0` | `sha512-x7+/YmH/HrSlXWOBZkhL7qQqcDgZEnDcWrhR5GlizzUZjz+w84FbQ6jo8trJC9tyaQxMaNvXVnXwDxn4I330Ew==` |

## 逐项初审

1. **dsh-context**（上下文/用量面板，bowenliang123）。代码只用 `fetch`：从 models.dev 取模型价格；向 registry.npmjs.org / registry.npmmirror.com 查询自身最新版本（只提示，不自更新）；Host 端用 DSH `credentials` 服务里的 DeepSeek key 调 `api.deepseek.com/user/balance` 显示余额——这一点要在审核记录里写明。未发现子进程、写文件或改配置。维护活跃（0 个未关闭 issue，108 个已关闭，10-18 有提交），但发版很快（30 天 37 版），建议约每月复审一次，而不是逐版跟进。
2. **BrowserSkill**（腾讯）。浏览器自动化插件，Host 端 `lib/index.mjs` 引入 `node:child_process` 的 `spawn`，需确认启动的是哪个程序（浏览器或 BrowserSkill CLI）以及是否下载浏览器。无依赖；30 天 3 版，节奏适合审核。
3. **ReMe**（阿里 AgentScope）。记忆插件，只连接本机 ReMe 服务（默认 `http://127.0.0.1:2333`，可用环境变量改），用户要先自己装 ReMe。包内缺 LICENSE 文件（Apache-2.0 要求随附许可文本），可提 issue 请上游补上。共 2 个版本。
4. **dsh-agent-teams**（NanmiCoder）。多代理协作；只请求自身 Host 路由，会写团队状态文件（待确认路径），通过子代理消耗模型额度。`engines.dsh` 逐个列出受支持的 DSH 版本，兼容性声明清楚。
5. **skill-explorer**（linxin666 / dsh-web 系列）。功能低风险，但浏览器端每天向 `https://dsh-market.com/api/telemetry/event` 发送一次匿名心跳（随机 ID + 包名，README 已说明）。VibeDev 自己默认关闭产品分析，是否接受第三方遥测请负责人决定；同系列的 git-graph、task-board 也有同样的心跳。
6. **memsearch**（Zilliz）。通过 `execFile('bash', ['-c', …])` 调用 memsearch CLI（Python）。在 Windows 上需要 Git Bash/WSL 和 Python 环境，对 VibeDev 的 Windows 用户不友好；包内缺 LICENSE。
7. **OpenViking**（火山引擎）。npm 包写 Apache-2.0，但仓库根许可证是 AGPL-3.0，包内也没有 LICENSE 文件；在许可证说清之前不收录。另外 30 天发了 29 版，审核负担重。
8. **dsh-better-sidebar**。很受欢迎（VibeDev 的媒体预览插件也以它为 peer），但体量接近 20 MiB 上限、169 个传递依赖（其中 `khroma@2.1.0` 的 package.json 缺 license 字段），含 git/归档/打开外部程序等子进程和配置写入路径，需要单独一轮深审。

## 暂不提议（原因）

- `@vectorize-io/hindsight-coding-agents@0.8.1`：package.json 没有 license 字段（不满足 OSI 许可证要求），代码含 `new Function`/`eval`，16 MiB。
- `@smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.8`：`SEE LICENSE IN LICENSE`，自定义许可证。
- `@struktoai/mirage-dsh@0.0.6`：`engines.dsh` 为 `0.1.1-rc.2`，与 0.2.1-rc.2 不兼容；依赖树里 `tree-sitter-bash` 有安装脚本。
- `dsh-pet@0.3.7`：解包 62.5 MiB（超过 20 MiB），运行时还会下载 Electron（`@electron/get`）。
- `@tt-a1i/archify-dsh@1.0.0`、`@liustack/modlens@3.27.1`、`@wxg-prc-cpg/dsh-weknora@0.1.0`、`dsh-deja@0.22.2`：没有任何 DSH 兼容声明（无 `engines.dsh`、无 dsh peer），必须先在 0.2.1-rc.2 上实测（规则：`review.testedOn` 必须包含目标版本）。
- `dsh-ops@0.3.0`：运维类工具，子进程和写文件路径多，放到后续批次深审。
- `dshmarket`：本方案就是用来替代它的（自更新、运行 pnpm、改 `cordis.patch.yml`、49 个 HTTP 路由）。
- `@vibedev-si/*`（dsh-vibedev、dsh-film、dsh-media-viewer、dsh-ecosystem）：VibeDev 自家插件经生态中心/默认配置分发，放进社区索引会出现两条渠道，是否列入请负责人决定。

## English summary

Recommended for the first batch after a hands-on test: `dsh-context@0.73.2` (Apache-2.0; network to models.dev, npm registries for its own update notice, and `api.deepseek.com/user/balance` with the user's DeepSeek key), `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3` (MIT; spawns a process to be identified), `@agentscope-ai/reme-dsh-plugin@0.1.2` (Apache-2.0; local ReMe server only; LICENSE file missing from the package), `@nanmicoder/dsh-agent-teams@0.1.25` (MIT; own Host routes only; uses subagents). Owner decision needed: `@linxin666/dsh-client-ui-skill-explorer@0.4.7` (daily anonymous heartbeat to dsh-market.com), `@zilliz/memsearch-dsh@0.1.6` (runs `bash -c memsearch …`). Deferred: `@openviking/dsh-memory-plugin@0.5.26` (package says Apache-2.0, repository root is AGPL-3.0), `dsh-better-sidebar@0.28.0` (18 MiB, 169 packages, needs a deep review). All eight are compatible with DSH 0.2.1-rc.2, publish on npm, and have no install scripts in the package or its resolved dependency tree.
