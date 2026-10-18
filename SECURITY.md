# 安全策略 / Security policy

## 报告 / Reporting

请通过本仓库的 **Security → Report a vulnerability** 私下报告，不要公开提 issue。适用于：已收录插件版本中的恶意或未声明行为、本仓库脚本或工作流的问题、索引被篡改的迹象。插件自身的漏洞也请同时报告给插件维护者。

Report privately through **Security → Report a vulnerability** in this repository, not in a public issue: malicious or undeclared behavior in a listed plugin version, problems in this repository's scripts or workflows, or signs that the published index was altered. Report a plugin's own vulnerability to its maintainer as well.

## 处理 / Handling

- 确认后会尽快从 `plugins.yml` 删除受影响的版本（必要时删除整个插件），合并后 GitHub Pages 几分钟内更新，客户端最多缓存 10 分钟。
- 已安装的副本不会被自动卸载；我们会在 issue 和 VibeDev 发布说明里告知用户如何处理。
- Confirmed problems lead to removing the affected version (or the whole plugin) from `plugins.yml`; Pages updates within minutes and clients cache for at most 10 minutes. Installed copies are not removed automatically, so users are told what to do through an issue and the VibeDev release notes.
