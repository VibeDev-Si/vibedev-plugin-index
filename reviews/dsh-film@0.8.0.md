# 审核记录 · Review record：`dsh-film@0.8.0`

> 第一方插件，由 VibeDev 自己维护和发布：源码 `github.com/VibeDev-Si/dsh-film` 标签 `v0.8.0`，工作台源码为其私有仓库
> `dsh-film-studio` 的 `workbench` 分支、来源提交 `ebed97a0`（打在 `dsh-film-v0.8.0`）。本记录由维护者手工填写包事实与行为声明，
> 并与 `npm run inspect -- dsh-film@0.8.0` 的输出核对；未运行 `npm run review` 的安装试用流程（需要本地构建的 DSH 检出），
> 安装与运行证据见第三节。
> First-party package maintained and published by VibeDev: source `github.com/VibeDev-Si/dsh-film` tag `v0.8.0`; the workbench
> source is `workbench` in the private `dsh-film-studio` repository at `ebed97a0` (tag `dsh-film-v0.8.0`). This record was
> written by the maintainer and cross-checked against `npm run inspect -- dsh-film@0.8.0`; the `npm run review` install trial
> was not run (it needs a locally built DSH checkout). Install and runtime evidence is in section 3.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（含体积例外 · with a size exception）
- 审核 · Review：VibeDev，2026-10-29，testedOn 0.2.1-rc.2
- 自动跟随 · Auto-publish：未开启 · none。`autoPublish` 只允许 `@vibedev-si/` 开头的包，本包名为无 scope 的 `dsh-film`，因此每个新版本都要人工审核并提 PR。
  `autoPublish` is only allowed for `@vibedev-si/` packages; this package is the unscoped `dsh-film`, so every new version is
  reviewed and added by hand.
- 用户可见的风险提示 · User-visible notes：见 `display.description`，写明本地服务只监听 127.0.0.1、模型与媒体费用走 VibeDev 账号、需要用户自行安装 FFmpeg。

## 一、包信息 · Package facts

| 项目 · Item | 值 · Value |
|---|---|
| 版本 · Version | 0.8.0（发布 · published 2026-10-29 04:21 UTC；npm latest 0.8.0） |
| integrity | `sha512-DlmR0u0BZw2CtHHeYDDWs3yKGp5UAD9XQJvwAX4aCk5/RmN4NzA8f2xPVRZjrs9i3SzgVLAA+QNCB8eCz2fRXg==` |
| 弃用 · Deprecated | 否 · no |
| 许可证 · License | MIT（OSI ✅；包内文件 · files: LICENSE 以及 `licenses/`、`docs/THIRD-PARTY.md`） |
| 构建来源 · Provenance | 无 · none。本次 GitHub Actions 的 OIDC 发布被账号账单拦截，改在本地发布**逐字节核对过的同一归档**，因此没有 npm attestation |
| DSH 声明 · DSH requirements | engines.dsh —；dsh peers `@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-tools` 均为 `>=0.2.0-rc.2 <0.3.0`；发现页与安装检查均放行 |
| 其他 peer · Other peers | `@vibedev-si/dsh-vibedev` `>=0.2.7`（账号插件，提供模型、媒体与计费） |
| bundle | ✅ `dsh.bundle.patch` = `./cordis.patch.yml`；`dsh.client` platform web，注入 locale、右侧栏与会话三个客户端包 |
| 安装脚本 · Install scripts | 包 · package: 无 · none（`preinstall`/`install`/`postinstall` 都没有，npm 也未标记 hasInstallScript）；依赖树 · tree: 无 · none |
| 体量 · Size | 解包 · unpacked **46,981,566 B（44.8 MiB）**、1125 个文件 · files；tarball 20,940,432 B。**超出 `policy.maxUnpackedBytes`（20 MiB），见 `sizeException`** |
| 依赖 · Dependencies | 运行时只有 `zod` `^3.25.76`；可选依赖 `@oven/bun-windows-x64`、`@oven/bun-darwin-aarch64`、`@oven/bun-darwin-x64` 均为锁定的 `1.3.13`，按平台只装一个 |
| 仓库 · Repository | https://github.com/VibeDev-Si/dsh-film |
| 问题反馈 · Issues | https://github.com/VibeDev-Si/dsh-film/issues |
| npm 维护者 · Maintainers | crider |

体积例外的理由 · Why the size exception：包内随附本地处理所需的三个平台 Bun 运行时（用于启动本地 Film 服务）、FFmpeg 与文档解析
Worker，以及工作台的 Web 产物和内置节点/工具/技能。这些内容是**本地处理能力**，不是可裁剪的依赖；去掉它们就得让用户自行安装运行时，
并失去离线切镜、转码与文档提取。可选的 Bun 依赖按平台安装，用户实际只下载其中一个。

The size covers the three platforms' Bun runtimes that run the local Film server, the FFmpeg and document-parsing workers, the
workbench Web build, and the built-in nodes/tools/skills. They are the local processing capability rather than trimmable
dependencies: without them the user would have to install a runtime themselves and lose local scene detection, transcoding and
document extraction. Only one platform's Bun package is installed per user.

## 二、行为声明 · Declared behaviour

| 类别 · Category | 内容 · Content |
|---|---|
| 网络 · Network | `127.0.0.1`：宿主半边在同机启动本地 Film 服务（临时端口，三条 stdio 管道，`FILM_PARENT_PIPE=1` 生命线），页面与 API 都走这个本机地址，无会话访问返回 401。包内**没有**其他主机的地址 |
| 文件 · Files | 写 · write：用户选定的项目目录（VibeDev Film 项目、`assets/` 下的帧、片段、音轨、清单与诊断文件）、插件数据目录（`~/.vibedev/film-studio/data` 的 nodes/tools/skills/ffmpeg）、导出 ZIP、以及网页与多媒体处理用的临时文件。读 · read：用户选择的视频、文档与项目文件 |
| DSH 配置 · Config | 无 · none。不写 DSH 设置或 profile 配置；内置节点/工具/技能按构建修订号重新播种到自己的数据目录，用户自己安装或改名的包不在覆盖范围 |
| 子进程 · Child processes | 随包的 Bun 运行时（运行本地 Film 服务）；`ffmpeg` 与 `ffprobe`（来自 PATH、`FFMPEG_PATH`/`FFPROBE_PATH`，或用户在 Film 内安装到数据目录的版本）。不启动 shell |
| 遥测 · Telemetry | 代码中存在 ToonFlow 上游的匿名统计上报（`api.toonflow.net/web/telemetry/report`），但**在账号托管模式下不启动**：`registerAnonymousData` 见到 `filmAccountManaged === true` 立即返回，不读设置、不起定时器、不发请求，隐私面板也不允许打开 |
| 动态代码 · Dynamic code | 会执行数据目录里的节点与工具脚本：`tools.ts` 用 `import()` 加载用户安装的工具插件，内置节点以 UMD 脚本加载。这是插件架构本身，不是运行时下载未审核代码 |
| 自更新 · Self-update | 无 · none。关于页只提供 GitHub releases 链接，不在应用内安装更新 |
| 凭据 · Credentials | 包自身不读取宿主凭据；账号、模型与媒体调用由 `@vibedev-si/dsh-vibedev` 在宿主侧完成，Film 不保存 API Key |

模型与媒体的费用和任务由 VibeDev 账号插件管理：Film 把请求交给宿主，宿主再走账号通道，因此本包只连本机回环地址。
Billing and media tasks belong to the `@vibedev-si/dsh-vibedev` account plugin on the host side; Film hands requests to the host,
so the package only contacts loopback.

## 三、安装与运行证据 · Install and runtime evidence

- 安装 · Install：在 VibeDev 桌面的 `desktop` profile（DSH 0.2.1-rc.2）中用 `pluginManager.installBundle` 安装 0.8.0 的**同一份
  归档**，`application: applied`，无 unmet peer；重启后插件正常加载，profile 依赖指向 `dsh-film 0.8.0`。
- 运行 · Runtime：画布、节点、素材库、项目 ZIP 导入导出、文档只读文本提取、图片/视频/音频生成、逐帧拉片（本地切镜、关键帧、
  片段、原音轨、报告查看）与 AI 辅助描述均在该 profile 中实际使用过；拉片在处理中触发普通保存不中断，报告可从节点上方
  「查看结果」打开。
- 本地服务 · Local server：按宿主方式（三条管道 + `FILM_PARENT_PIPE=1`）启动后，FFmpeg 状态与真实 `ffprobe` 在数百毫秒内返回；
  强杀父进程后服务在数百毫秒内自行退出，无残留进程。无会话访问 401，会话链接换 Cookie 303。
- 回归 · Regression：仓库自带检查 167 项通过；`scripts/verify-package.mjs` 从全新目录安装归档并启动通过，65 个 Web 引用齐全。

## 四、已知边界 · Known limits

- 只在 Windows 实测：新增的鼠标、FFmpeg Worker 与父进程生命线只在这台机器验证；macOS/Linux 实机交互未测。
  Windows only: the mouse handling, FFmpeg worker and parent-process lifeline were verified on this machine; macOS/Linux
  interactions were not exercised.
- 1 GB / 10000 条的 ZIP、100 MB 文档等大文件边界未用真实样本压测；ZIP 使用 Store，不压缩媒体。
  The 1 GB / 10,000-entry archive and 100 MB document boundaries were not exercised with real large files; archives use Store.
- 本版没有新增「只读打开」按钮，文档还不能直接导入成节点；模型未声明的 `rules`/`other` 参数不会透传。
  This version adds no read-only open button and no document-to-node import; undeclared model `rules`/`other` parameters are not
  forwarded.
- 0.8.0 没有 npm provenance（见第一节）；后续版本恢复 CI 发布后会有 attestation。
  0.8.0 carries no npm provenance (see section 1); later versions regain an attestation once CI publication is restored.
