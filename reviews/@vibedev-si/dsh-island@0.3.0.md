# 审核记录 · Review record：`@vibedev-si/dsh-island@0.3.0`

> 第一方插件，由 VibeDev 审核收录（人工，含体积例外）。0.3.0 把 Windows 岛屿从 Tauri 版换成岛仔原生版，
> 包体因此超过 20 MiB；行为声明沿用并补充 0.1.0 的人工审核基线，安装与使用证据见第四节。
> First-party package reviewed by VibeDev by hand, with a size exception. 0.3.0 replaces the Windows Tauri island with the
> native Daozai build, which pushes the package over 20 MiB. The behaviour declarations carry over from and extend the
> 0.1.0 hand review; install and runtime evidence is in section 4.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（含体积例外 · with a size exception）
- 审核 · Review：VibeDev，2026-11-26，testedOn 0.2.2-rc.2 / 0.2.3-alpha.2
- 自动跟随 · Auto-publish：保留 `autoPublish: true`。本版本作为人工审核基线，之后的版本须沿用本记录的
  `sizeException`，且解包不超过 21.5 MiB 的 125%。
  `autoPublish` stays enabled; this version is the hand-reviewed baseline for later releases, which may carry only this
  `sizeException` and must stay within 125% of 21.5 MiB.

## 一、包信息 · Package facts

| 项目 · Item | 值 · Value |
|---|---|
| 版本 · Version | 0.3.0（发布 · published 2026-11-25T08:56:14.077Z） |
| integrity | `sha512-whAA4RkgFHQdzKwOGqzVe9weypFNdzYs2yxFf8HDj84i26OjikDlaT2YT07C791DffSoVtbOxs9vKfhgL579fg==` |
| 许可证 · License | MIT（包内 · packaged LICENSE） |
| 构建来源 · Provenance | 无 npm provenance；由 crider 从本地构建的归档发布，归档逐字节核对后上传 |
| DSH 声明 · DSH requirements | `engines.dsh` `>=0.2.2-rc.2 <0.3.0-0`；发现页与安装检查放行 |
| bundle | ✅ `dsh.bundle.patch` = `./cordis.patch.yml` |
| 安装脚本 · Install scripts | 无 · none |
| 体量 · Size | 解包 · unpacked **22,026 KiB（21.5 MiB）**，39 个文件 · files；tarball 10.9 MB。超出 20 MiB 上限，见 `sizeException` |
| 依赖 · Dependencies | 无运行时依赖 · no runtime dependencies |
| 仓库 · Repository | https://github.com/VibeDev-Si/dsh-island |
| 问题反馈 · Issues | https://github.com/VibeDev-Si/dsh-island/issues |
| npm 维护者 · Maintainers | crider |

体积例外的理由 · Why the size exception：包内是 Windows x64 原生岛屿程序 `bin/win32-x64/vibedev-island.exe`（20.8 MiB，
岛仔 Rust/egui 原生实现）和按需截图/标注助手 `bin/win32-x64/VibeDevCapture.exe`。两者都是随包分发的原生程序，
不是可裁剪的依赖，也没有跨平台副本；去掉后插件无法启动岛屿或截图。0.2.0 的 Tauri 版为 18.5 MiB，0.3.0 为 21.5 MiB。

The package ships the Windows x64 native island program (20.8 MiB, Daozai Rust/egui build) and the on-demand
`VibeDevCapture.exe` helper. Both are native programs rather than trimmable dependencies and have no cross-platform copy;
without them the plugin cannot start the island or capture screenshots. 0.2.0's Tauri build was 18.5 MiB; 0.3.0 is 21.5 MiB.

## 二、行为声明 · Declared behaviour

| 类别 · Category | 内容 · Content |
|---|---|
| 网络 · Network | `imap.qq.com`（仅用户添加 QQ 邮箱后）、`api.deepseek.com`（仅在用户自备 DeepSeek 翻译密钥时作为回退）。账号余额和翻译默认走 DSH 的 connection/translator 服务，不直连 VibeDev 网关 |
| 文件 · Files | 写 · write：`%APPDATA%\VibeDev`（岛屿设置与主题记忆）、`%TEMP%` 日志、待办、剪贴板历史（密钥打码）、截图文件；读 · read：用户明确选择的文件与选区文字 |
| DSH 配置 · Config | 无 · none。不写 DSH 设置或 profile 配置；原生设置窗口的改动通过 `settings/change` 回写插件自己的设置 |
| 子进程 · Child processes | 随包的 `vibedev-island`（通过 DSH subprocess 以 `--rpc stdio` 启动，插件停用即退出）；用户主动截图时的 `VibeDevCapture`；仅 QQ 通知修复用的 Windows PowerShell；仅打开日志/诊断文件时的 `explorer` |
| 遥测 · Telemetry | 无 · none |
| 动态代码 · Dynamic code | 无 · none |
| 自更新 · Self-update | 无 · none。更新由 VibeDev 插件管理器安装新包完成 |
| 凭据 · Credentials | 不直接保存模型密钥；QQ 邮箱授权码存 Windows 凭据管理器。VibeDev 余额读取由账号插件提供 |

## 三、与 0.2.0 的差异 · Changes since 0.2.0

- Windows 岛屿从 Tauri/WebView2 换成岛仔原生 Rust/egui 实现（MIT），新增 `VibeDevCapture` 截图助手；
- VibeDev 会话/影视/审批和翻译成为岛内页面，不再弹独立的工作/翻译窗口；
- 审批可在岛上直接允许或拒绝；高风险、整机权限和无法核对的请求仍交回 VibeDev；
- 翻译支持拖选复制、输入/粘贴、长译文自动增高；余额胶囊与 AI 额度设置页重做。

## 四、安装与使用证据 · Install and runtime evidence

- 从本归档 `installBundle` 到 desktop profile，重启后 island 进程为 0.3.0，握手声明 `attention`、`approve`、
  `approval-details`、`question-answers`、`account-usage`；停用后进程退出，重新启用后再启动。
- 实测会话页、影视页、审批提醒/卡片、翻译页（选区、输入、复制、自动增高）、余额胶囊、设置同步和截图入口；
  原生测试与插件测试见插件仓库 `docs/status.md`。
- 限制 · Limits：仅 Windows x64；经典 Tauri 版保留在 macOS 开发构建，不在本包内。