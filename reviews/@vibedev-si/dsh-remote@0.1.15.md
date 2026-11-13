# 审核记录 · Review record：`@vibedev-si/dsh-remote@0.1.15`

> 第一方插件，由 VibeDev 自动收录：`@vibedev-si/dsh-remote@0.1.15` 是 npm 上该包的最新正式版，行为声明沿用
> `0.1.12` 的审核记录，并重新通过了全部机器检查。
> First-party auto-published entry: the newest stable npm release of a package this organisation maintains. The behaviour
> declarations are carried over from `0.1.12` and every machine check ran again.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（自动收录 · recorded automatically）
- 审核 · Review：VibeDev（自动 · automated），2026-11-02，testedOn 0.2.1-rc.2
- 沿用 · Carried over：`0.1.12` 的 capabilities、installScripts 与风险提示。
  Capabilities, install scripts and risk notes from `0.1.12`.

## 机器检查 · Machine checks

| 项目 · Item | 值 · Value |
|---|---|
| integrity | `sha512-GEjwcVAwJV9Bc/eCqDvwVtYZrPkPwGzrV4BXjzWAy7bPObM8JKynZ+xXUcdahzwag9K5ALDXlAoHNA4zZwP8jg==` |
| 发布 · Published | 2026-11-02T03:42:10.539Z |
| 许可证 · License | MIT |
| bundle | ✅ |
| DSH 兼容 · DSH compatibility | no declaration; tested on the target DSH |
| 安装脚本 · Install scripts | 无 · none |
| 体量 · Size | 解包 · unpacked 607 KiB，38 个文件 · files |
| 依赖 · Dependencies | `@deepseek-ai/schemastery` 3.18.5、`ws` 8.22.0、`qrcode` 1.5.4 |

网络主机与子进程与上一版本一致 · Network hosts and child processes match the previous reviewed version：
127.0.0.1, lan.invalid, remote.vibedev.studio, vibedev.studio

## 复测 · Retest：DSH 0.2.2-rc.1（2026-11-09）

- 方式 · Method：`test/dsh-composition/install-trial.mjs`，DSH 为 vibedev-app `release/desktop-0.2.2-rc.1` 分支的已构建检出
  （`dshVersion` 0.2.2-rc.1），临时 DSH_HOME 与用户目录，除 npm 仓库外的外连一律拒绝并记录。
  Install trial on a built checkout of vibedev-app `release/desktop-0.2.2-rc.1` (`dshVersion` 0.2.2-rc.1), in temporary
  DSH_HOME and user directories, with every outbound connection but the npm registry refused and logged.
- 结果 · Result：`installBundle("@vibedev-si/dsh-remote@0.1.15")` applied 并启用；两次启动 `mobile-gateway` 行均为 ACTIVE；
  外连只有安装时的 registry.npmjs.org（0 次被拒）；无子进程、无凭据读取、无残留进程；注册 Web 路由
  `/vibedev/remote/callback` 与 `/mgw`。远程访问默认关闭，所以没有中继连接。
  Applied and enabled; row `mobile-gateway` active on both starts; the only outbound connections were registry.npmjs.org
  during installation (none refused); no child process, no credential read, no process left running; web routes
  `/vibedev/remote/callback` and `/mgw`. Remote access is off by default, so no relay connection was made.
- `testedOn` 增加 0.2.2-rc.1 · adds 0.2.2-rc.1.

## 复测 · Retest：DSH 0.2.2-rc.2（2026-11-13）

- 方式 · Method：`test/dsh-composition/install-trial.mjs`，DSH 为 vibedev-app `release/desktop-0.2.2-rc.2` 分支的已构建检出
  （`dshVersion` 0.2.2-rc.2），临时 DSH_HOME 与用户目录，除 npm 仓库外的外连一律拒绝并记录。
  Install trial on a built checkout of vibedev-app `release/desktop-0.2.2-rc.2` (`dshVersion` 0.2.2-rc.2), in temporary
  DSH_HOME and user directories, with every outbound connection but the npm registry refused and logged.
- 结果 · Result：`installBundle("@vibedev-si/dsh-remote@0.1.15")` applied 并启用；两次启动 `mobile-gateway` 行均为 ACTIVE；
  外连只有安装时的 registry.npmjs.org（0 次被拒）；无子进程、无凭据读取、无残留进程；注册 Web 路由
  `/vibedev/remote/callback` 与 `/mgw`。远程访问默认关闭，所以没有中继连接。第二次启动时插件记了一次会话控制流重试
  （`session control stream failed retrying`），随后照常转发会话归档状态和队列基线，到停止前没有再出错。
  Applied and enabled; row `mobile-gateway` active on both starts; the only outbound connections were registry.npmjs.org
  during installation (none refused); no child process, no credential read, no process left running; web routes
  `/vibedev/remote/callback` and `/mgw`. Remote access is off by default, so no relay connection was made. On the second
  start the plugin logged one retry of its session control stream (`session control stream failed retrying`), then
  forwarded the session archive state and queue baseline as usual, with no further failure before the stop.
- `testedOn` 增加 0.2.2-rc.2 · adds 0.2.2-rc.2.