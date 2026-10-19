# VibeDev 精选插件索引 · VibeDev Curated Plugin Index

[中文](#中文) | [English](#english)

索引地址 / Index URL：**https://vibedev-si.github.io/vibedev-plugin-index/index.json**

---

## 中文

### 这是什么

这是 VibeDev 维护的社区插件索引：一个 [DSH 插件市场索引（format 1）](#索引格式) JSON 文件，由本仓库的 `plugins.yml` 生成，经 GitHub Actions 发布到 GitHub Pages。它只列出 **VibeDev 审核过的精确版本**：某个插件发布新版本时，新版本不会自动出现在索引里，必须有人按下面的清单审核，并在 `plugins.yml` 里记录版本号和 npm integrity 之后才会上架。

插件仍然是第三方代码。审核降低风险，但不是安全担保；索引本身也没有签名，所以只通过 https 发布。

### VibeDev 怎么使用它

VibeDev 使用上游 DeepSeek Harness 自带的插件市场：Host 端服务 `@deepseek-ai/dsh-plugin-market` 加上「插件」页的「发现」标签 `@deepseek-ai/dsh-client-ui-plugin-market`。

- **索引源**：市场服务读取 `plugin-market` 行的 `indexes` 配置（URL 列表，按 profile 保存；用户在「发现 → 管理索引源」里增删时写入 profile 的 `cordis.patch.yml`）。上游默认不配置任何源；VibeDev 计划把本索引设为默认源（尚未启用）。
- **读取规则**：Host 端用 `fetch` 读取，**拒绝重定向**（所以要配置最终 URL），超时 15 秒，正文上限 128 MiB，在独立 Worker 里按严格 UTF-8 + JSON + format 1 校验，成功结果缓存 10 分钟；任一字段违规则整个索引被拒绝，只影响这一个源。多个源分别浏览，不合并。
- **展示**：发现页的卡片显示图标、标题、标签、一行描述、默认版本、作者和发布日期；可按分类、标签筛选，支持中英文模糊搜索。默认版本是与当前 DSH 兼容的最高正式版。
- **安装**：卡片上的「安装」先显示来源和信任提示，再打开「插件」页自己的安装对话框，执行 `pluginManager.installBundle("<name>@<version>")`。安装前 DSH 会按包内 manifest 再检查一次兼容性（`engines.dsh`，没有时看 `@deepseek-ai/dsh-*` peer），pnpm 11 会拦下依赖的构建脚本并请用户批准。上游目前没有「升级」动作，升级要先卸载再安装。
- 在 VibeDev 正式内置之前，可以手动试用：插件 → 更多 → 实验性插件 → 打开「自定义插件市场」，再在「发现」里添加上面的索引地址。

### 收录标准

一个版本要同时满足以下条件，`npm run validate` 会自动检查其中能机器判断的部分：

1. **开源许可**：`package.json` 的 `license` 是 OSI 批准的 SPDX 许可证（见 `scripts/lib/manifest.mjs` 的列表），且与审核记录一致；包内应附带许可证文本（缺失会警告，需在记录中说明）。
2. **发布在 npm**：来自 registry.npmjs.org，并声明 `dsh.bundle`（可安装的 DSH bundle）。不收录 Git、tarball 或私有源。
3. **精确版本**：每个版本单独审核，记录版本号和 npm 的 `dist.integrity`（sha512）。不接受范围（`^1.0.0`）或标签（`latest`）。
4. **兼容当前 VibeDev 的 DSH 版本**（`plugins.yml` 的 `target.dsh`，现在是 `0.2.1-rc.2`）：发现页的兼容判断和安装时的检查都必须通过；完全没有 DSH 声明（无 `engines.dsh`、无 dsh peer）的包，必须由审核人在目标版本上实际运行过（`testedOn`）。
5. **行为已声明**：网络（访问哪些主机；`*` 表示用户或 Agent 选择的网站，例如它驱动的浏览器）、文件（none/read/write）、DSH 配置（none/read/write）、子进程（启动哪些程序）都写进审核记录；构建时据此给条目加上「联网」「运行外部程序」「写入文件」「修改 DSH 配置」「安装脚本」标签。遥测必须写明，默认开启的第三方遥测要产品负责人批准。
6. **没有未经审核的安装脚本**：包自身的 `preinstall`/`install`/`postinstall` 和 `binding.gyp` 必须逐项记录在 `installScripts`，否则校验失败；依赖树里的安装脚本用 `npm run inspect -- <name>@<version> --deps` 检查。
7. **体量限制**：解包后不超过 20 MiB（`policy.maxUnpackedBytes`），超出时必须写 `sizeException` 说明理由；依赖越少越好。
8. **维护者可联系且有响应**：记录 issue 地址或邮箱；仓库未归档，最近 90 天有提交或 issue 回复。安全问题报告 7 天内无回应的，可以先下架。
9. **其他**：不自我更新、不修改其他插件或 VibeDev 内置插件、不在运行时下载并执行未审核的代码；不与 VibeDev 内置功能重复。

### 审核清单

审核人对每个版本逐项完成，并把结果写进 PR：

- [ ] 运行 `npm run inspect -- <name>@<version> --deps`，把输出附在 PR 里（许可证、兼容性、安装脚本、体量、依赖树、代码线索）。
- [ ] 许可证是 OSI 许可证，与仓库和包内 LICENSE 一致。
- [ ] `dsh.bundle` 存在；`engines.dsh`（或 dsh peers）允许 `target.dsh`。
- [ ] 包和依赖树都没有未审核的安装脚本。
- [ ] 体量与依赖数合理。
- [ ] 阅读代码（不只看扫描结果），确认网络主机、文件读写、DSH 配置写入、子进程、环境变量和凭据读取、`eval`/动态代码、遥测。
- [ ] 在 VibeDev（目标 DSH 版本）里实际安装、启用、使用主要功能、停用、卸载：无报错，不改动无关配置，卸载后无残留进程。
- [ ] 维护者联系方式可用，项目仍在维护。
- [ ] 在 `plugins.yml` 写完整审核记录：`reviewer`、`date`、`license`、`testedOn`、`capabilities`、`installScripts`、`notes`（必要时 `sizeException`）。
- [ ] `npm run validate` 通过；由另一位维护者批准后合并。

### 如何提交或申请更新

- **申请收录**：用 [收录申请](../../issues/new?template=plugin-request.yml) 表单，或直接提 PR（使用 PR 模板，按上面的清单填写）。
- **申请新版本**：用 [版本更新](../../issues/new?template=version-update.yml) 表单，或提 PR 在该插件的 `versions` 里加一条新记录。
- **报告问题 / 申请下架**：用 [问题报告](../../issues/new?template=problem-report.yml)；安全漏洞请走仓库的 Security → Report a vulnerability 私下报告。
- PR 上的 CI 会运行单元测试、校验正式清单、用真实 npm 数据跑一遍构建，并确认两个故意写错的清单会被拒绝。

### 上游发布新版本时

- **从不自动收录。** 索引只包含 `plugins.yml` 里的版本，发现页安装的永远是记录过的 `name@version`。
- 每周一（02:17 UTC）定时任务运行 `scripts/check-updates.mjs`，把收录插件比已审核版本更新的版本列成表（发布时间、`engines.dsh`、与目标 DSH 是否兼容、安装脚本、体量、许可证），新建或更新一个带 `upstream-release` 标签的 issue；没有待审版本时关闭它。
- 审核人按清单复审新版本，在 PR 里加上新版本（旧版本可以保留或删除）；合并后 Pages 自动重新发布。已安装旧版本的用户会在发现页看到「有更新」。
- **紧急下架**：删除对应版本（或整个插件）并合并，Pages 几分钟内更新；客户端最多缓存 10 分钟。已经安装的副本不会被自动卸载，需要在 issue 和发布说明里通知用户。

### 仓库结构与命令

```text
plugins.yml                 收录清单（唯一的数据来源）
CANDIDATES.md               待批准的候选插件与初审
scripts/build.mjs           生成 dist/index.json、dist/icons/、dist/index.html
scripts/validate.mjs        校验清单、npm 事实与生成的索引
scripts/check-updates.mjs   每周的上游新版本报告
scripts/inspect.mjs         审核辅助：一个版本的事实与 plugins.yml 片段（--grep 查看代码出处）
scripts/mirror.mjs          把 dist/ 发布到 VibeDev 下载服务器（默认只演练）
scripts/lib/                共用模块（部分改编自 DSH 参考生成器，见 NOTICE.md）
test/unit.test.mjs          离线单元测试
test/fixtures/              e2e 测试清单与两个故意写错的清单
test/dsh-composition/       用 DSH 源码检出做真实组合测试：market-list.mjs（读索引）、install-trial.mjs（安装试用）
.github/                    CI、Pages 发布、每周检查、issue 与 PR 模板
```

```sh
npm ci                                   # 依赖已锁定精确版本；.npmrc 禁止执行安装脚本
npm test                                 # 离线单元测试
npm run validate                         # 校验 plugins.yml（需要访问 npm）
npm run build                            # 生成 dist/
npm run inspect -- dsh-context@0.73.2 --deps
npm run check-updates
node test/dsh-composition/market-list.mjs --dsh <已构建的 DSH 检出> --dist .cache/e2e-dist
node test/dsh-composition/install-trial.mjs --dsh <已构建的 DSH 检出> --pnpm <pnpm.mjs> --out report.json <name@version>...
```

`install-trial.mjs` 在临时 DSH_HOME、临时用户目录和临时 pnpm 仓库里启动 DSH 的 `web` profile，用 `pluginManager.installBundle` 安装精确版本（与「发现」页安装相同的路径），再重启一次。它记录每个条目的状态、注册的工具/技能/路由、启动的子进程、`fetch` 调用、凭据读取，以及经本地代理的每个外连。代理只放行 npm registry，其余一律拒绝并记录。

需要 Node.js 22.12 或更高版本。依赖只有 4 个，全部锁定精确版本：`@deepseek-ai/dsh-plugin-market-index`（与 DSH 自己使用的 format 1 校验器相同，版本与 `target.dsh` 一致）、`semver`、`yaml`、`resolve.exports`。

### 镜像到 VibeDev 下载服务器

GitHub Pages 是源站；国内访问用 `https://download.vibedev.studio/plugin-index/index.json`，由 `scripts/mirror.mjs` 把构建好的 `dist/` 发布到下载服务器（站点根目录 `/data/vibedev-download/public`）。

```sh
npm run build
# 默认只演练：列出文件、远端路径和每一条命令，不做任何改动
node scripts/mirror.mjs --ssh deploy@<server> --identity <私钥> --known-hosts <known_hosts 文件>
# 确认无误后真正发布
node scripts/mirror.mjs --ssh deploy@<server> --identity <私钥> --known-hosts <known_hosts 文件> --apply
```

- **连接**：ssh 固定使用 `BatchMode=yes`、`StrictHostKeyChecking=yes`、给定的 known_hosts 和 `IdentitiesOnly=yes`，不会自动信任新主机。
- **上传**：发布前先确认 `dist/index.json` 是合法的 format 1。`dist/` 以 tar 流经 ssh 上传到 `plugin-index.releases/<id>.staging`，然后在服务器上逐个文件核对 sha256。
- **切换**：把暂存目录改名为正式版本目录，再用一次原子重命名把符号链接 `plugin-index` 指向它。如果已有的 `plugin-index` 不是符号链接，脚本在改动任何东西之前就停止。
- **验证**：通过 HTTPS 取公开地址，不跟随重定向，要求 HTTP 200、`application/json`，且字节与 `dist/index.json` 完全一致。验证失败时自动切回上一个版本。
- **清理**：只在 `plugin-index.releases/` 里保留最近 `--keep` 个版本（默认 5），站点根目录下其他内容一概不碰。
- **服务器要求**：POSIX shell、GNU coreutils（`mv -T`、`ln -sfn`、`sha256sum`）和 tar。Web 服务器要能跟随该符号链接，并对这个 URL 直接返回 200：DSH 读取索引时拒绝重定向。

### 索引格式

输出完全遵循 DSH format 1，并在写出前用 `@deepseek-ai/dsh-plugin-market-index` 校验：根字段 `format`、`title`、`description`、`metadata.categories`、`metadata.labels`、`plugins`；每个插件有 `name`、`title`、`description`、`icon`、`author`、`homepage`、`repository`、`metadata`（`category`、`labels`、`keywords`）、`dist-tags.latest`、`versions`（`version`、`publishTimestamp`、`source: {type: npm}`、`engines.dsh`）。展示字段取自**最高的已审核版本**的 tarball，可在 `plugins.yml` 用 `display` 覆盖标题和描述。图标不超过 16 KiB 时内嵌为 `data:` URL，更大的发布在 `icons/` 并用相对路径引用，所以整个 `dist/` 可以原样放到镜像站。

### 许可

本仓库使用 [MIT](LICENSE) 许可。`scripts/lib/` 中改编自 DeepSeek Harness 参考生成器的代码保留其 MIT 版权声明，见 [NOTICE.md](NOTICE.md)。索引中转载的插件名称、描述和图标归各插件所有，按各自许可证使用。

---

## English

### What this is

The community plugin index maintained by VibeDev: one [DSH plugin market index (format 1)](#index-format) JSON file, generated from `plugins.yml` in this repository and published to GitHub Pages by GitHub Actions. It lists **only exact versions reviewed by VibeDev**. A plugin's new release never appears on its own; it is listed only after someone completes the review checklist below and records the version and its npm integrity in `plugins.yml`.

Plugins remain third-party code. Review lowers the risk but is not a security guarantee, and the index is unsigned, so it is served over https only.

### How VibeDev uses it

VibeDev uses the plugin market built into upstream DeepSeek Harness: the Host service `@deepseek-ai/dsh-plugin-market` and the Discover tab of the Plugins page, `@deepseek-ai/dsh-client-ui-plugin-market`.

- **Sources**: the service reads the `indexes` field of the `plugin-market` row, a per-profile list of URLs; editing sources in Discover writes the profile's `cordis.patch.yml`. Upstream configures no source; VibeDev plans to make this index its default source (not enabled yet).
- **Reading**: the Host fetches with redirects refused (configure the final URL), a 15 s deadline, and a 128 MiB body limit, then validates strict UTF-8, JSON, and format 1 in a Worker, and caches a good document for 10 minutes. Any violation rejects the whole index, affecting only that source. Several sources are browsed one at a time, never merged.
- **Display**: Discover cards show the icon, title, labels, a one-line description, the default version, author, and publish date, with category and label filters and fuzzy search in English and Chinese. The default version is the highest stable version compatible with the running DSH.
- **Install**: **Install** shows the source and a trust notice, then opens the Plugins install dialog, which runs `pluginManager.installBundle("<name>@<version>")`. DSH checks the installed manifest again (`engines.dsh`, else `@deepseek-ai/dsh-*` peers), and pnpm 11 blocks dependency build scripts until the user approves them. There is no upgrade action yet: uninstall, then install.
- Until VibeDev ships it as the default, try it by hand: Plugins → More → Experimental plugins → switch on **Custom plugin markets**, then add the index URL above in Discover.

### Inclusion criteria

A version must meet all of these; `npm run validate` checks the machine-checkable ones:

1. **Open-source license**: `package.json` `license` is an OSI-approved SPDX license (list in `scripts/lib/manifest.mjs`) and matches the review record; the package should ship its license text (a missing file is a warning to explain in the record).
2. **Published on npm** (registry.npmjs.org) and declares `dsh.bundle`. No Git, tarball, or private sources.
3. **Exact version**: each version is reviewed on its own and recorded with its npm `dist.integrity` (sha512). No ranges (`^1.0.0`) or tags (`latest`).
4. **Compatible with the DSH version VibeDev ships** (`target.dsh`, now `0.2.1-rc.2`) in both the Discover check and the install-time check; a package with no DSH declaration at all must have been run on the target by the reviewer (`testedOn`).
5. **Declared behavior**: network hosts (`*` for sites the user or the agent chooses, such as a browser it drives), file access (none/read/write), DSH configuration access (none/read/write), and programs started are recorded; the build turns them into the labels Uses the network, Runs programs, Writes files, Changes DSH settings, and Install scripts. Telemetry must be declared; third-party telemetry that is on by default needs the product owner's approval.
6. **No unreviewed install scripts**: `preinstall`/`install`/`postinstall` and `binding.gyp` must each be listed in `installScripts`, or validation fails; check the dependency tree with `npm run inspect -- <name>@<version> --deps`.
7. **Size**: at most 20 MiB unpacked (`policy.maxUnpackedBytes`) unless `sizeException` gives the reason; few dependencies.
8. **Responsive maintainer**: an issue tracker or e-mail is recorded; the repository is not archived and shows commits or issue replies within 90 days. A security report without an answer in 7 days can lead to removal.
9. **Other**: no self-updating, no changes to other or built-in plugins, no downloading and running unreviewed code at runtime, no duplicate of a VibeDev built-in feature.

### Review checklist

- [ ] Run `npm run inspect -- <name>@<version> --deps` and attach the output to the PR.
- [ ] License is OSI-approved and matches the repository and the packaged LICENSE.
- [ ] `dsh.bundle` exists; `engines.dsh` (or the dsh peers) admits `target.dsh`.
- [ ] No unreviewed install scripts in the package or its dependency tree.
- [ ] Size and dependency count are reasonable.
- [ ] Read the code, not only the scan: network hosts, file writes, DSH configuration writes, child processes, environment and credential reads, `eval`/dynamic code, telemetry.
- [ ] Install, enable, use, disable, and uninstall it in VibeDev on the target DSH: no errors, no unrelated configuration changes, no processes left behind.
- [ ] The maintainer contact works and the project is maintained.
- [ ] Write the complete review record in `plugins.yml`.
- [ ] `npm run validate` passes; a second maintainer approves the PR.

### Submitting and requesting updates

- **New plugin**: the [plugin request](../../issues/new?template=plugin-request.yml) form, or a PR that follows the PR template.
- **New version**: the [version update](../../issues/new?template=version-update.yml) form, or a PR adding a `versions` record.
- **Problems and removal**: the [problem report](../../issues/new?template=problem-report.yml) form; report vulnerabilities privately through Security → Report a vulnerability.
- CI on a PR runs the unit tests, validates the production list, runs a full build against real npm data, and checks that two deliberately broken lists are rejected.

### When a listed plugin releases a new version

- **Never automatic.** The index holds only the versions in `plugins.yml`; Discover installs exactly that `name@version`.
- Every Monday (02:17 UTC) a scheduled workflow runs `scripts/check-updates.mjs`, lists versions newer than the newest reviewed one with their facts, and opens or updates one issue labelled `upstream-release`; it closes the issue when nothing is pending.
- A reviewer runs the checklist for the new version and adds it in a PR (keeping or dropping older versions); merging redeploys Pages, and users with an older version see **Update available**.
- **Emergency removal**: delete the version or plugin and merge; Pages updates within minutes and clients cache for at most 10 minutes. Installed copies stay installed, so announce the removal.

### Layout and commands

See the [Chinese section](#仓库结构与命令) for the file tree and commands. Node.js 22.12 or later. The four dependencies are pinned exactly: `@deepseek-ai/dsh-plugin-market-index` (the format-1 validator DSH itself uses, at the `target.dsh` version), `semver`, `yaml`, and `resolve.exports`; `.npmrc` disables install scripts.

### Mirroring to the VibeDev download server

GitHub Pages is the origin; users in China read `https://download.vibedev.studio/plugin-index/index.json`. `scripts/mirror.mjs` publishes the built `dist/` to the download server (site root `/data/vibedev-download/public`). It is a dry run by default: it lists the files, the remote paths, and every command, and changes nothing. Run it with `--ssh user@host --identity <key> --known-hosts <file>`, then add `--apply` to publish.

- **Connection**: ssh always runs with `BatchMode=yes`, `StrictHostKeyChecking=yes`, the given known_hosts file, and `IdentitiesOnly=yes`.
- **Upload**: the script first checks that `dist/index.json` is valid format 1. It then streams `dist/` over ssh as a tar archive into `plugin-index.releases/<id>.staging` and checks every file's sha256 on the server.
- **Switch**: it renames the staging directory to the release, then points the `plugin-index` symbolic link at it with one atomic rename. If an existing `plugin-index` is not a symbolic link, the run stops before anything changes.
- **Verify**: it fetches the public URL over HTTPS without following redirects and requires HTTP 200, `application/json`, and the exact bytes of `dist/index.json`. On failure it switches the link back to the previous release.
- **Cleanup**: it keeps the newest `--keep` releases (5 by default), only inside `plugin-index.releases/`; nothing else under the site root is touched.
- **Server requirements**: a POSIX shell, GNU coreutils (`mv -T`, `ln -sfn`, `sha256sum`), and tar. The web server must follow the link and answer this URL with 200 directly, because DSH refuses redirects when it reads an index.

### Index format

The output follows DSH format 1 and is checked with `@deepseek-ai/dsh-plugin-market-index` before it is written. Display fields come from the **highest reviewed version's** tarball, and `display` in `plugins.yml` can override the title and description. Icons up to 16 KiB are inlined as `data:` URLs; larger ones are published under `icons/` and referenced relatively, so `dist/` can be copied to a mirror unchanged.

### License

[MIT](LICENSE). Code in `scripts/lib/` adapted from the DeepSeek Harness reference generator keeps its MIT notice; see [NOTICE.md](NOTICE.md). Plugin names, descriptions, and icons republished in the index belong to their plugins and are used under their licenses.
