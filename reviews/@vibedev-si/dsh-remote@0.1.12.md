# 审核记录 · Review record：`@vibedev-si/dsh-remote@0.1.12`

> 第一方插件，由 VibeDev 自己维护和发布：源码 `github.com/VibeDev-Si/dsh-remote` 标签 `v0.1.12`，npm 发布同一提交。
> 本记录由维护者手工填写包事实与行为声明，并与 `npm run inspect -- @vibedev-si/dsh-remote@0.1.12` 的输出核对；未运行
> `npm run review` 的安装试用流程（需要本地构建的 DSH 检出），安装与运行证据见第三节。
> First-party package maintained and published by VibeDev: source `github.com/VibeDev-Si/dsh-remote` tag `v0.1.12`, published
> to npm from that commit. This record was written by the maintainer and cross-checked against
> `npm run inspect -- @vibedev-si/dsh-remote@0.1.12`; the `npm run review` install trial was not run (it needs a locally
> built DSH checkout). Install and runtime evidence is in section 3.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（已收录于 plugins.yml · listed in plugins.yml）
- 审核 · Review：VibeDev，2026-10-29，testedOn 0.2.1-rc.2
- 自动跟随 · Auto-publish：`autoPublish: true`。本插件的每个新版本仍要通过 `npm run validate` 的全部机器检查（npm
  integrity、bundle、OSI 许可证、安装脚本、体量、DSH 兼容）才会进入索引；代码审阅发生在 `dsh-remote` 仓库的 PR 里。
  Every new version still has to pass every machine check in `npm run validate`; code review happens in the
  `dsh-remote` pull request.

## 一、包信息 · Package facts

| 项目 · Item | 值 · Value |
|---|---|
| 版本 · Version | 0.1.12（发布 · published 2026-10-27 12:19 UTC；npm latest 0.1.12；共 5 个版本 · versions） |
| integrity | `sha512-UHf97RcksLUb7CEVR2IUZCZo4JJxuVLwBe3zopndqKG3yPmgapyO8whUTI5chZ5lyo8DVDYdhbxkKlkMOSXe1Q==` |
| 弃用 · Deprecated | 否 · no |
| 许可证 · License | MIT（OSI ✅；包内文件 · files: LICENSE, NOTICE） |
| 构建来源 · Provenance | 无 · none（私有仓库，未用 npm provenance 发布） |
| DSH 声明 · DSH requirements | engines.dsh —；无 dsh peer；发现页与安装检查均放行 · no dsh peer, both checks pass |
| bundle | ✅ `dsh.bundle.patch` = `cordis.patch.yml` |
| 安装脚本 · Install scripts | 包 · package: 无 · none；依赖树 · tree: 无 · none |
| 体量 · Size | 解包 · unpacked 548 KiB，35 个文件 · files；tarball 158 KiB |
| 依赖 · Dependencies | `@deepseek-ai/schemastery` 3.18.5、`ws` 8.22.0、`qrcode` 1.5.4（均已锁定 · all pinned） |
| 仓库 · Repository | https://github.com/VibeDev-Si/dsh-remote |
| 问题反馈 · Issues | https://github.com/VibeDev-Si/dsh-remote/issues |
| npm 维护者 · Maintainers | crider |

## 二、行为声明 · Declared behaviour

| 类别 · Category | 内容 · Content |
|---|---|
| 网络 · Network | `vibedev.studio`（浏览器 PKCE 登录、短票据、JWKS、账号卡片）、`remote.vibedev.studio:24443`（桌面主动出站 WSS）、`github.com`（仅在选择开启 Cloudflare 隧道时下载 cloudflared）、`127.0.0.1`（本机回调与管理页） |
| 文件 · Files | 写 · write：选中工作区的上传暂存与下载副本；配置目录下的 `remote.json`、`operations.json`（0600） |
| DSH 配置 · Config | 写 · write：本 bundle 自带的 Loader 补丁行；从手机端只能启停已安装的其它 bundle，安装、卸载、改设置一律拒绝，本插件自身不能从手机端停用 |
| 子进程 · Child processes | 仅限用户显式开启的桌面附带能力：`python3` 证书助手（Linux，内部调用 `nginx`/`certbot`/`systemctl`），以及可选隧道用的 `cloudflared`。默认安装不启动任何子进程 |
| 遥测 · Telemetry | 无 · none |
| 动态代码 · Eval | 无 · none |
| 自更新 · Self-update | 无 · none（版本更新走 npm 与插件市场） |

远端能力由账号权限与所有者选择共同决定（conversation、sessions、history、tasks、approvals、files.read/write），并与工作区围栏取交集：手机只能访问电脑所有者选定的工作区。删除账号、撤销设备或关闭远程访问会立即断开两条通道。

Remote capabilities come from the account grant intersected with the owner's selection (conversation, sessions,
history, tasks, approvals, files.read/write) and a workspace fence; revoking the device or disabling remote access
closes both channels immediately.

## 三、安装与运行证据 · Install and runtime evidence

- 安装 · Install：在 VibeDev 桌面的 `desktop` profile（DSH 0.2.1-rc.2）中执行
  `pluginManager.installBundle("@vibedev-si/dsh-remote@0.1.12")`，pnpm 从 registry.npmjs.org 解析该精确版本，替换了原先
  指向本地 0.1.9 tarball 的依赖；安装后 profile 依赖变为 `"0.1.12"`，锁文件同步。
  `installBundle` of the exact version replaced a local 0.1.9 tarball in the desktop profile; the dependency and the
  lockfile now pin 0.1.12 from the registry.
- 运行 · Runtime：同一 profile 内的连接器在多次重启后持续工作：账号登录、手机可信验证、远端握手、历史加载、消息发送、
  审批应答与工作区文件读取均正常；远程访问默认关闭，由电脑端开启。
  The connector has kept working across restarts in that profile: sign-in, phone verification, admission, history,
  prompts, approvals and workspace file reads.

## 四、已知边界 · Known limits

- 必须有一台在线并已开启远程访问的电脑；没有云端执行。
  A desktop must be online with remote access enabled; there is no cloud runtime.
- 中继终止两侧 TLS，本版本不声明对中继运营者不可解密。
  The relay terminates TLS on both legs; this version makes no end-to-end claim against the relay operator.
