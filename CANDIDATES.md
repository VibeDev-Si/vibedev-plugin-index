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
| `dsh-univer-office@0.3.7`（dream-num/Univer） | **暂缓（负责人决定）**，审核记录见 [reviews/dsh-univer-office@0.3.7.md](reviews/dsh-univer-office@0.3.7.md) | 见下文「暂缓插件的证据与收录条件」：216 MiB、闭源/混淆部分、`@univerjs-pro/*` 无许可证字段、默认开启遥测（有开关）、免费版水印。 | — |
| `@linxin666/dsh-remote-web-ui@0.4.7` | **暂缓（负责人决定）**，审核记录见 [reviews/@linxin666/dsh-remote-web-ui@0.4.7.md](reviews/@linxin666/dsh-remote-web-ui@0.4.7.md) | 见下文：浏览器端每日心跳无开关、隧道开启时默认经 dsh-market.com 中转、cloudflared 安装脚本、家族更新器绕过 `installBundle`。 | — |

## 暂缓插件的证据与收录条件（2026-10-20）

两项都用 `npm run review` 做了静态检查和隔离安装试用（DSH 0.2.1-rc.2，临时 DSH_HOME、用户目录、APPDATA、TEMP；代理只放行 npm registry；Windows 上每隔几秒采样整个进程树的监听端口、直接外连和进程）。行号对应 npm 包里的文件。

### dsh-univer-office@0.3.7

已确认的事实：

- **体量与构建来源**：解包 216 MiB（221,534 KiB），tarball 49 MB；`artifacts/` 约 204 MB。npm 上没有 provenance；`lib/build-info.json` 写的构建 commit 8f85ce4 与 GitHub tag v0.3.7 一致，但无法证明 npm 内容就是由它构建的。
- **闭源与混淆**：
  - `lib/index.js` 第 3838–10553 行有 7 段字符串数组混淆的代码。我们解码了其中渲染和资源下载相关的两段（`:9141-10553`），看起来来自 `@univer-cli/*`。`lib/client.js` 没有混淆。
  - `artifacts/` 的三个大文件大部分经过混淆：`gateway.cjs` 第 166,902–602,865 行（共 605,629 行），`unit-content-worker.mjs` 第 15,352–335,535 行（共 336,540 行），`upgrade-worker.cjs` 第 160,096–337,681 行（共 340,700 行）。
  - 这些字符串表都是明文，所以按字符串搜索得到的结论（主机、版本号、环境变量名）仍然可靠，但逻辑无法完整审读。
- **许可证**：
  - 源码仓库 `package.json` 用到 102 个 `@univerjs-pro/*` 与 `@univer-cli/*` 包，其中 87 个在 npm 元数据里没有 license 字段，例如 `@univerjs-pro/license`、`@univer-cli/unit-screenshot`；另外 15 个 `*-history`、`embed`、`shape-editor` 包写了 Apache-2.0。发布的 `package.json` 没有把它们列为依赖，说明运行所需的部分已打包进 `lib/` 和 `artifacts/`。
  - 安装后的依赖树（49 个包）中有 13 个没有 license 字段：`@univerjs-pro/cli-assets`，以及两个原生绑定包和它们各自的 5 个平台包。Windows 平台包分别带 `univer-exchange-node.win32-x64-msvc.node`（39.6 MB）和 `univer-formula.win32-x64-msvc.node`（9.0 MB）。我们抽查的 5 个包（含这两个 Windows 包）都没有 LICENSE 文件。
- **免费版限制**：渲染和预览资源里有 `limit: { page: …, waterMark: "Univer free version, powered by univer.ai.", link: "https://pro.univer.ai" }`（`artifacts/render-machine/assets/index-BGTJBGct.js:924`、`artifacts/viewer/assets/en-US-DMf5Tplg.js:41`）。Univer 文档说需要许可证的功能在未配置许可证时会显示水印或受限（[docs.univer.ai/server/license](https://docs.univer.ai/server/license)）。没有找到针对这些 npm 包的使用条款；[univer.ai 的 Terms and Conditions](https://univer.ai/legal/terms-and-conditions) 只覆盖 Univer 服务本身。
- **遥测**（更正：除 `DO_NOT_TRACK` 外还有插件配置开关）：
  - 插件启用时用 `fetch` POST 到 `https://univer.ai/api/telemetry/cli`，发送 `dsh_plugin_activated`（每个安装一次）和 `dsh_plugin_daily_active`（每个本地日一次）（`lib/index.js:11289-11317`、`11388-11395`）。
  - 内容：随机安装 ID、事件名、arch、build_commit、event_source、Node 主版本、包名与版本、platform、状态版本号（`:11363-11380`）。状态保存在 `$DSH_HOME/telemetry/dsh-univer-office/state.json`，发送前先写状态，失败当天不重试（`:11397-11414`）。
  - 关闭方式：配置 `telemetry: false`（`:3763`、`:3787`、`:13208`，README 第 214、218-220 行有说明），或任意非空的 `DO_NOT_TRACK`（连 `0` 也算，`:11462-11465`），或 `UNIVER_TELEMETRY_ENDPOINT=""`。它不检查 DSH 自己的开关 `DSH_TELEMETRY_DISABLED`（插件可从 `profileContext.telemetryDisabledEnv` 读取）。VibeDev 关闭 DeepSeek 遥测的方式是在默认补丁里停用相关行，对这个插件不起作用。
  - `package.json` 还有 `uninstall` 脚本，会在卸载时用分离的子进程发送 `dsh_plugin_uninstall_hook`（`scripts/telemetry-entry.mjs`、`lib/telemetry-entry.js:189-202`）；它同样遵守上述开关。pnpm 卸载时是否执行这个脚本，没有实测。
  - **试用**：首次启用时 2 次请求被代理拒绝；重启后没有请求（当天已记录）；删除状态文件后带 `DO_NOT_TRACK=1` 第三次启动，没有请求，也没有重新生成状态文件。
- **监听与进程**（试用确认）：启动时不开端口、不起进程。Gateway 按需启动：界面或工具第一次需要时调用 `ensureGateway`，以 `node <包>/artifacts/gateway.cjs` 启动子进程（`lib/index.js:4475-4520`），监听 `127.0.0.1:9080`（`gatewayPort`，默认 9080；gateway 里 `LOOPBACK_HOST = "127.0.0.1"`）。试用中只看到这一个新监听，全部是本机地址；采样期间 Gateway 没有直接外连；DSH 停止后没有遗留进程。注意 Gateway 子进程只继承 `HOME`、`LANG`、`LC_ALL`、`PATH`、`TMPDIR`（`:4476-4489`），不继承代理变量，所以它的外连只能靠进程树采样发现，极短的连接可能漏掉。
- **浏览器**（更正：0.3.7 不会下载 Chromium）：
  - `@puppeteer/browsers` 的 `install` 只被 import（`lib/index.js:9142`），从未调用；`150.0.7871.24` 和 `UNIVER_RENDER_BROWSER_DOWNLOAD_BASE_URL` 只出现在混淆的字符串表里（`:9160`，变量 `x5` 在 `:9178` 定义后未被使用）。其他文件（包括混淆的 artifacts）里也没有这个版本号、`@puppeteer/browsers` 或 Chrome 下载地址。
  - 查找顺序（解码后的 `:9176-9212`、`:9251-9255`、`:9594-9613`）：配置 `browserExecutablePath` → 环境变量 `UNIVER_RENDER_BROWSER` → 缓存目录中已有的浏览器（`UNIVER_RENDER_BROWSER_CACHE` 或 `~/.cache/univer-cli-sdk/browsers`，只读取不下载）→ 系统 Chrome → Windows 上再找 Edge。都找不到时报 `BROWSER_UNAVAILABLE`。
  - 截图和打印 PDF 时用 puppeteer-core 以无头模式启动该浏览器，带 `--no-sandbox`（`:9255`）；渲染页由进程内 HTTP 服务提供，只监听 `127.0.0.1` 随机端口（`:9237`）。
- **其他网络**：`univer_resources` 工具按资源清单下载 SVG（清单中的地址几乎都在 `cdn.jsdelivr.net` 和 `cdn.undraw.co`），只允许 HTTPS，缓存在 `$DSH_HOME/cache/dsh-univer-office/resources`。
- **注册项**：14 个工具（`univer_*`）、web 路由 `/univer-api`、`/univer-viewer`、`/uf`（另有 WebSocket `/univer-viewer/ws`）。

收录条件（请作者提供或说明）：

1. 公开 Univer Pro 运行时和 `@univerjs-pro/*`、`@univer-cli/*` 包的使用条款：免费使用的范围（含商用）、水印和页数限制的具体规则、允许经 npm 再分发；在这些包里补上 `license` 字段和许可文本。
2. npm provenance（或可复现构建），并说明哪些部分是闭源或混淆的。
3. 遥测：`telemetry: false` 开关已有，满足最低要求；希望同时尊重 DSH 的 `DSH_TELEMETRY_DISABLED`（`profileContext.telemetryDisabledEnv`）。VibeDev 收录时必须在显示文字里写明默认开启及关闭方法。
4. 说明截图和打印时为什么使用 `--no-sandbox`，最好去掉。
5. VibeDev 侧：给 216 MiB 写 `sizeException`；风险提示写明遥测、`127.0.0.1:9080` 本地服务、使用本机 Chrome/Edge、免费版水印和页数限制。

### @linxin666/dsh-remote-web-ui@0.4.7

已确认的事实：

- **安装**（试用确认，DSH 自带 pnpm 11.28.5）：pnpm 拦截了依赖 `cloudflared@0.7.3` 的安装脚本，第一次 `installBundle` 返回 `failed`（`build-blocked`，pendingBuilds `cloudflared@0.7.3`）。
  - 用户在「插件」页会看到对话框「需要允许安装脚本」：列出 `cloudflared@0.7.3`，说明「允许后，脚本会以你的权限在本机运行，授权保存在当前 profile，之后不再询问」「只在信任这些包时允许」，按钮是「允许这些脚本并重试」（DSH `packages/client/ui-plugin-manager/src/client/locales.ts:199-203`）。
  - 批准后安装成功，安装后和重启后都是 ACTIVE。批准记录在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 里（DSH `packages/boot/plugin-manager/src/build-approval.ts:49-55、75-80`）。
  - 该脚本是 `node scripts/postinstall.mjs && node lib/cloudflared.js bin install`，会从 `github.com/cloudflare/cloudflared/releases/latest/download/` 下载 cloudflared 二进制：默认 latest，不固定版本，也不校验哈希（cloudflared `lib/install.js:54-61、107`）。
  - 试用中这次下载请求（`github.com:443`）被代理拒绝，安装仍然成功：cloudflared 的命令行只在平台不受支持时返回非零，其他错误被忽略（`lib/cloudflared.js`）。
  - 插件运行时开启隧道时，如果二进制不存在或无法运行，也会自己下载（`src/tunnel.ts:161、216-243`）。
- **注册项**：13 个 web 路由（`/api/pair/{accept,events,heartbeat,issue,lan-bind,revoke,status,stop}`、`/pair-accept`、`/pair-app`、`/pair-app.sw.js`、`/pair-ping`、`/remote`），没有工具或技能。未认证的进程内请求 `GET /api/pair/status` 返回 403。
- **监听与外连**（试用确认）：插件没有新开端口（复用 DSH 的 web 服务，试用中 DSH 绑定 127.0.0.1）；Host 端启动时没有任何外连，安装和重启后没有遗留进程。
- **profile 补丁**（试用确认）：安装、重启后都没有写入任何行。只有用户在设置卡片里切换「局域网访问」时，才会写入一个受管的 `- id: webserver` 块，把绑定地址改为 `0.0.0.0`（或改回 `127.0.0.1`）（`src/lan-bind.ts:1-16、223-237`），并用 `netsh advfirewall firewall add rule … dir=in action=allow protocol=TCP localport=<端口> profile=private,domain` 添加防火墙规则（`src/firewall.ts:56-77`）。另外，设置卡片读取状态时，Windows 上会用 `netsh advfirewall firewall show rule name=… verbose` 查询这条规则（只读，结果缓存 30 秒，`src/firewall.ts:56-64、197-230`）；试用中未认证的状态请求返回 403，没有触发。
- **默认配置**：`autoTunnel: false`、`relay: true`（只在隧道开启时生效）、`requirePairingForLan: true`、`lanBind` 未设置、令牌有效期 10 分钟、最多 4 台设备（`src/index.ts:242-255、366-378`）。
- **中转**：开启快速隧道（quick tunnel）后，插件会向 `https://dsh-market.com/api/relay/register` 注册当前的 trycloudflare 地址，手机通过固定的 `https://<id>.dsh-market.com` 访问（`src/relay-registry.ts:1-26`）。作者在注释里写明 “Traffic transits the dsh-market edge”，即远程会话的流量经过 dsh-market 的边缘服务（`src/index.ts:175-181`）；命名隧道不经过中转。身份文件保存在 `$DSH_HOME/remote-web-ui-registry/<profile>.json`。
- **遥测**（浏览器端，试用不会运行，依据代码）：客户端启动时无条件调用（`src/client/index.ts:195-197`），每个 UTC 日向 `https://dsh-market.com/api/telemetry/event` 发送一次 `{kind:'heartbeat', visitor: <localStorage 中的随机 UUID>, items:[{name, version}]}`；只有 `navigator.webdriver` 时跳过，没有开关（`src/client/telemetry.ts:75-105`）。
- **家族更新器**（另一个包，remote-web-ui 本身不依赖它）：`@linxin666/dsh-update@0.4.7`，随聚合包 `@linxin666/dsh-web-all` 一起安装。更正：`webUiSettings` 服务由 `@linxin666/dsh-client-ui-web-ui-settings` 提供（设置绑定，不负责更新）。
  - 客户端挂载后会检查一次更新（`src/client/UpdateEntry.tsx:109-118`）：查询 `https://registry.npmjs.org/<包名>/latest`（`src/update.ts:22、424-451`），从 `api.github.com` 读取发布说明（`:515-524`）。只有用户在面板里确认后才会更新（`UpdateEntry.tsx:79-97`）。
  - 更新命令是在 profile 目录运行 `pnpm update --latest --config.minimumReleaseAge=0 <家族包>`，失败时依次退回 `corepack pnpm …`、`npx --yes pnpm …`，在 Windows 上通过 `shell: true` 执行（`src/update.ts:734-778`）。它绕过 `pluginManager.installBundle`，并把版本升到 npm latest，不受索引钉住版本的约束。
  - registry：版本探测固定查询 `https://registry.npmjs.org`（`src/update.ts:22、433`）；更新命令不带 `--registry`，沿用 profile 的 registry 配置，只加了 `--config.minimumReleaseAge=0`。
- 共发布 59 个版本；npm 上没有 provenance。

收录条件（请作者提供）：

1. 遥测：提供配置开关，或尊重 `navigator.doNotTrack` / 宿主的遥测设置；最好默认关闭或首次询问。
2. `relay` 默认改为 `false`，并说明 dsh-market 边缘服务能看到什么（是否终止 TLS、是否记录请求、保存多久）。
3. `cloudflared` 改为可选依赖或在首次开启隧道时再下载：征得同意，固定版本并校验 SHA-256，也就不再需要安装时脚本。
4. 家族更新器改走 `pluginManager.installBundle`，并提供关闭开关（影响 `dsh-web-all` 用户）。
5. VibeDev 侧：风险提示写明可开启公网隧道和中转、局域网访问会修改防火墙和 web 绑定、浏览器端每日心跳。

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
