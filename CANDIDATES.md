# 候选与审核结论 / Candidates and review decisions

> `plugins.yml` 是唯一的收录清单。这里记录产品负责人点名的候选、审核结论和证据；“收”的版本已写进 `plugins.yml`，其余不会出现在索引里。审核方法：解包 npm tarball 读代码（不执行），用 `npm run inspect -- <name>@<version> --deps` 检查依赖树，再用 `test/dsh-composition/install-trial.mjs` 在临时 DSH_HOME 里通过 `pluginManager.installBundle` 安装（与「发现」页的安装路径相同），记录进程、网络、凭据读取和注册项。目标 DSH：`0.2.1-rc.2`。
>
> `plugins.yml` is the only list. This file records the candidates the product owner named, the decisions, and the evidence; "include" versions are in `plugins.yml`, nothing else reaches the index.

## 第一批（2026-10-19）

| 插件与版本 | 结论 | 关键证据 | 用户可见的风险提示 |
|---|---|---|---|
| `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3`（腾讯 BrowserSkill） | **收** | MIT，含 LICENSE；peers `^0.1.5-rc.3 \|\| ^0.2.0-rc.1` 兼容；无依赖、无安装脚本、465 KiB。唯一子进程是用户自装的 `bsk` CLI（配置 `bskPath`，默认从 PATH 找；包内不附带），不经 shell 以 `bsk <cmd> --json` 启动：每次加载 `bsk --version`、调用 bsk_* 工具时、会话活跃时每 1.5 s `bsk screenshot`（`lib/index.mjs:3075-3109, 6114, 955-968`）。插件本身不联网。试用：安装 applied，重启后仍 ACTIVE，无任何外连。无 npm provenance。 | 需另装 bsk；会启动 bsk 进程；浏览器访问 Agent 选择的网站；记录写在 `~/.bsk` |
| `dsh-context@0.73.2` | **收**（附披露） | Apache-2.0；provenance 指向 tag v0.73.2；`engines.dsh` 兼容；1 个依赖（zod）。只在面板请求 `/api/dsh-context/balance` 时读取凭据：试用中恰好 1 次读取 `DEEPSEEK_API_KEY`、1 次请求 `https://api.deepseek.com/v1/tools/user/balance`。原因：它优先找设置项 `llm-deepseek`，找不到时退回第一个带 `apiKeyEnv` 的设置项；VibeDev web 组合里只有 `web-deepseek-api` 一项，所以余额可能显示为空，但 key 只发往 api.deepseek.com。浏览器端访问 models.dev（价格）和 npm 镜像（每小时查一次自身新版本，只显示提示和 GitHub 链接）。启动时无外连。 | 用你的 DeepSeek key 查询余额；从 models.dev 取价格；会提示有新版本（新版本未经审核） |
| `@michengai/dsh-skills-manager@1.2.7`（npm 最新；审核期间又发了 1.2.8） | **有条件**（不进 `plugins.yml`） | Apache-2.0；provenance 指向 tag v1.2.7；peers 明确列出 0.2.1-rc.2；依赖 fflate；试用 applied/ACTIVE，注册工具 `create_skill`，启动时无外连。**问题**：内置更新器无条件注册（`lib/index.js:280-284`，无配置开关）。打开「检查更新」对话框时 GET 端点，查询 `registry.npmjs.org/<pkg>/latest`（试用中返回 latest 1.2.8、updateAvailable:true）；点击「更新」后 POST，安装 npm 最新版（`plugin-updater.js:466-522`）。在 VibeDev 桌面（profile 名为 `desktop`，宿主通过 argv 传入 pnpm）走 `pnpm add --config.minimumReleaseAge=0 <pkg>@<latest> --registry=https://registry.npmjs.org/`，绕过 `pluginManager.installBundle` 的兼容检查，还会改写 profile 的 `pnpm-workspace.yaml`（`:263-456`）。此外它会从 ClawHub、skills.sh 和 GitHub 压缩包安装第三方技能，这些内容我们无法审核；并读写其他 Agent 的技能目录（~/.claude、~/.codex 等）。30 天发了 29 个版本。 | — |
| `dsh-univer-office@0.3.7`（dream-num/Univer） | **暂缓（负责人决定）** | 解包 227 MB、tarball 49 MB；遥测发往 `https://univer.ai/api/telemetry/cli`，内容是随机安装 ID、事件、平台和版本，可用 `DO_NOT_TRACK` 或 state.json 的 `disabled` 关闭（`lib/build-info.json`，`lib/telemetry-entry.js:61,170`）；`lib/index.js` 经过混淆（`_0x` 字符串数组），无法完整审读；从 `@puppeteer/browsers` 引入 `install`（`lib/index.js:9142`），运行时可能下载浏览器到缓存目录；`@univerjs-pro/*` 原生绑定包在 npm 元数据里没有 license 字段；渲染带 “Univer free version” 水印和页数限制；依赖 puppeteer-core。 | — |
| `@linxin666/dsh-remote-web-ui@0.4.7` | **暂缓（负责人决定）** | 遥测发往 `https://dsh-market.com/api/telemetry/event`；可选通过 `<id>.dsh-market.com` 中转访问用户主机；依赖 `cloudflared`（其安装脚本会下载二进制）建立公网隧道；用 `netsh` 修改防火墙规则；监听 0.0.0.0 对局域网开放；59 个版本。 | — |

### dsh-skills-manager 要收录，作者需要提供

1. 配置开关（例如 `updater: false`），关闭后不注册 `/api/michengai/dsh-skills-manager/update`，也不显示「检查更新」。或者在 profile 由插件市场管理时自动关闭。
2. 更新统一走 `pluginManager.installBundle`，不直接调用 pnpm、不设置 `minimumReleaseAge=0`、不强制 `--registry`、不改写 `pnpm-workspace.yaml`。
3. 可选：能够禁用 ClawHub、skills.sh 和 GitHub 来源，或者在安装第三方技能前明确告知来源。

满足后我们再审核新版本并钉住精确版本；插件发新版仍然要等我们审核。

## 其余候选（初审，未试用）

| 插件与版本 | 初审 | integrity |
|---|---|---|
| `@agentscope-ai/reme-dsh-plugin@0.1.2` | Apache-2.0（包内无 LICENSE）；只连本机 ReMe 服务 `127.0.0.1:2333` | `sha512-dZQSyknARE76fjYnNqK63Kai8MS6QSZ+bUNNG8fwl1syWb3BptyngweQkphxfYtE6sonzXK5MVwxbLgf0c7+qg==` |
| `@nanmicoder/dsh-agent-teams@0.1.25` | MIT；只请求自身路由；会消耗子代理额度 | `sha512-p8ElanLgY2Tp+/MvpmZiVCFg8feE43stctPa/FHC6fYmxou5G7oblBLQoSc5HuK1d3vxieJptwDOJwXdz47IBg==` |
| `@linxin666/dsh-client-ui-skill-explorer@0.4.7` | BSD-3-Clause；每天向 dsh-market.com 发匿名心跳（需负责人决定） | `sha512-BFUfTBUywJk6N7x6P894GnxjltOhZcx3A7cU1GT95fCdVWt4dAKLc8XeQdmreSBTpreHbyPfcgm4RBqnYXs1Eg==` |
| `@zilliz/memsearch-dsh@0.1.6` | MIT；`bash -c memsearch …`，Windows 不友好 | `sha512-bbGaGVFxPLu93Jxv7ZxPZJF3h0SQiqp+5ps0B/U5InZbeMiZxBeeVX244vhukSnvIrdyv9lv6wunG02BjY2iaw==` |
| `@openviking/dsh-memory-plugin@0.5.26` | 包写 Apache-2.0、仓库根目录是 AGPL-3.0，需澄清 | `sha512-bNTNv7frjBexYdJR1RGL88uWaz+4FtJMPvuVwGAHuaSow4AN5AqnDYHw95oObjghmTq5lm5omLzKXBDWur0MYA==` |
| `dsh-better-sidebar@0.28.0` | MIT；18 MiB、依赖树 169 个包，需深审 | `sha512-x7+/YmH/HrSlXWOBZkhL7qQqcDgZEnDcWrhR5GlizzUZjz+w84FbQ6jo8trJC9tyaQxMaNvXVnXwDxn4I330Ew==` |

## 暂不提议

- `@vectorize-io/hindsight-coding-agents@0.8.1`：package.json 没有 license 字段，代码含 `new Function`/`eval`，16 MiB。
- `@smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.8`：自定义许可证（`SEE LICENSE IN LICENSE`）。
- `@struktoai/mirage-dsh@0.0.6`：`engines.dsh` 为 `0.1.1-rc.2`，不兼容。
- `dsh-pet@0.3.7`：解包 62.5 MiB，运行时会下载 Electron。
- `@tt-a1i/archify-dsh`、`@liustack/modlens`、`@wxg-prc-cpg/dsh-weknora`、`dsh-deja`：没有任何 DSH 兼容声明，需要先实测。
- `dsh-ops@0.3.0`：子进程和写文件路径多，留到后续批次。
- `dshmarket`：本方案就是用来替代它的。`@vibedev-si/*`：已经通过 VibeDev 生态中心分发。

## English summary

Batch 1: include `@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3` (launches the user-installed `bsk` CLI; the browser visits sites the agent chooses) and `dsh-context@0.73.2` (uses the DeepSeek key for a balance request to api.deepseek.com, models.dev prices, update hint without self-install). `@michengai/dsh-skills-manager@1.2.7` is conditional and not listed: its always-on updater installs the npm latest on two clicks, bypassing `installBundle` on the desktop profile, and it installs third-party skills from ClawHub, skills.sh, and GitHub. `dsh-univer-office@0.3.7` and `@linxin666/dsh-remote-web-ui@0.4.7` are deferred by the product owner (size, telemetry, obfuscated code and unlicensed binaries; telemetry, relay, public tunnel, firewall changes).
