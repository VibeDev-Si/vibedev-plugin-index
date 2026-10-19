# DSH 真实组合测试 / DSH composition check

用一个已构建的 DSH 源码检出（例如 VibeDev 的 DSH 分支，需要 `packages/*/lib` 构建产物）验证 DSH 自己的插件市场能读取本仓库生成的索引。它不会安装任何插件，也不碰用户的 profile：临时 `DSH_HOME` 在结束时删除。

Checks, against a built DSH checkout, that DSH's own plugin market reads an index this repository builds. Nothing is installed and no user profile is touched; the temporary `DSH_HOME` is deleted at the end.

```sh
node scripts/build.mjs --catalog test/fixtures/e2e-plugins.yml --out .cache/e2e-dist
node test/dsh-composition/market-list.mjs --dsh /path/to/dsh-checkout --dist .cache/e2e-dist
# 读取已发布的索引 / read the published index instead:
node test/dsh-composition/market-list.mjs --dsh /path/to/dsh-checkout --url https://vibedev-si.github.io/vibedev-plugin-index/index.json
```

脚本在 `http://127.0.0.1:<随机端口>/index.json` 提供索引，用 `@deepseek-ai/dsh-app-boot` 的 `boot()` 启动 Loader，profile 里挂载真实的 `config-editor`、`settings`、`plugin-manager` 和 `plugin-market`（`indexes` 指向该 URL），然后打印 `listIndexes()`、`search()`（默认顺序、中文文本、标签筛选）和 `entry()` 的结果：标题、默认版本、安装状态、每个版本的兼容性和安装参数。

The script serves the index on `http://127.0.0.1:<random port>/index.json`, boots the Loader through `boot()` of `@deepseek-ai/dsh-app-boot` with the real `config-editor`, `settings`, `plugin-manager`, and `plugin-market` rows (`indexes` set to that URL), and prints `listIndexes()`, `search()` (index order, Chinese text, label filter), and `entry()`: titles, default versions, installation status, and each version's compatibility and install arguments.

## 安装试用 / Install trial

```sh
node test/dsh-composition/install-trial.mjs --dsh /path/to/dsh-checkout --pnpm /path/to/pnpm.mjs --out report.json name@1.2.3
# 可选 / optional: --call "GET /api/x" --invoke service.method --approve-builds pkg \
#                  --extra-start-env DO_NOT_TRACK=1 --extra-start-reset telemetry/pkg
```

通常不直接运行它，而是通过 `npm run review` 调用，选项会原样传入。

脚本在临时 DSH_HOME、用户目录、APPDATA、TEMP 和 pnpm 仓库里启动检出的 `web` profile，用 `pluginManager.installBundle` 安装精确版本（「发现」页的安装路径），再重启一次。报告包括：

- 条目状态，以及注册的技能、工具和路由；
- 子进程、`fetch` 调用和凭据读取；
- 经本地代理的每个外连：代理只放行 npm registry，其余拒绝并记录；
- 写入临时目录的文件，以及 profile 补丁中的行；
- Windows 上整个进程树的监听端口、绕过代理的直接外连和进程，每隔 1–3 秒采样一次（`Get-NetTCPConnection`、`Get-NetUDPEndpoint`、`Win32_Process`）；最后一次停止后仍在运行的进程会被记录并结束。

采样有间隔，不继承代理环境变量的子进程如果只建立了极短的连接，可能会被漏掉。

可选步骤：

| 选项 | 作用 |
|---|---|
| `--call` | 调用一次插件注册的路由。 |
| `--invoke` | 无参数调用一次插件提供的服务方法。 |
| `--approve-builds` | 在依赖的构建脚本待批准时，用 `approvedBuilds` 重试一次，与「插件」页的「允许这些脚本并重试」相同。 |
| `--extra-start-env`、`--extra-start-reset` | 先删除 DSH_HOME 下的指定文件，再带额外的环境变量启动第三次。 |

Usually run through `npm run review`, which passes these options through. The script boots the checkout's `web` profile in temporary DSH_HOME, user, APPDATA, TEMP, and pnpm store directories, installs exact versions through `pluginManager.installBundle` (the Discover path), and restarts once. It reports:

- entry states and registered skills, tools, and routes;
- child processes, fetch calls, and credential reads;
- every outbound connection through a local proxy, which admits only the npm registry and records the rest;
- files written under the temporary directories, and the rows of the profile patch;
- on Windows, the listening sockets, direct (non-proxied) connections, and processes of the whole process tree, sampled every 1–3 seconds (`Get-NetTCPConnection`, `Get-NetUDPEndpoint`, `Win32_Process`). Processes still running after the last stop are reported and killed.

Sampling has gaps: a very short connection from a child process that ignores the proxy variables can be missed.

Optional steps:

| Option | Effect |
|---|---|
| `--call` | Call a registered route once. |
| `--invoke` | Call a provided service method once, without arguments. |
| `--approve-builds` | When dependency build scripts are pending, retry once with `approvedBuilds`, like the Plugins page's "Allow these scripts and retry". |
| `--extra-start-env`, `--extra-start-reset` | Delete the listed files under DSH_HOME, then start a third time with extra environment variables. |
