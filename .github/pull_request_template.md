<!--
新增或更新插件版本时请完整填写；只改文档或脚本的 PR 可以删掉“插件审核”部分。
Fill this in completely when adding or updating a plugin version; a docs/scripts-only PR may delete the review part.
-->

## 变更 / Change

- [ ] 新增插件 / New plugin
- [ ] 新增版本 / New version of a listed plugin
- [ ] 下架版本或插件 / Removal
- [ ] 文档、脚本或 CI / Docs, scripts, or CI

包与版本 / Package and version: `name@x.y.z`

关联 issue / Related issue: #

## 插件审核 / Plugin review

<details><summary><code>npm run inspect -- name@x.y.z --deps</code> 输出 / output</summary>

```text
(paste here)
```

</details>

- [ ] 许可证是 OSI 许可证，与仓库和包内 LICENSE 一致 / OSI license, matches repository and packaged LICENSE
- [ ] 发布在 npm，声明 `dsh.bundle`；记录了精确版本和 `dist.integrity` / On npm, declares `dsh.bundle`; exact version and integrity recorded
- [ ] 与 `target.dsh` 兼容（发现页与安装检查）/ Compatible with `target.dsh` (Discover and install checks)
- [ ] 包和依赖树没有未审核的安装脚本 / No unreviewed install scripts in the package or its dependency tree
- [ ] 体量 ≤ 20 MiB 或写明 `sizeException` / Size within limit or `sizeException` explained
- [ ] 读过代码，`capabilities` 如实记录网络主机、文件、DSH 配置、子进程；遥测已说明 / Code read; capabilities record hosts, files, config, programs; telemetry stated
- [ ] 在 VibeDev（目标 DSH）里装上、用过、停用、卸载 / Installed, used, disabled, and uninstalled in VibeDev on the target DSH
- [ ] 维护者联系方式可用，项目仍在维护 / Maintainer reachable, project maintained
- [ ] `npm run validate` 本地通过 / passes locally

试用记录 / Hands-on notes (VibeDev version, OS, what was exercised):

## 第二位维护者 / Second maintainer

合并前需要另一位维护者批准。/ Another maintainer must approve before merge.
