# 审核记录 · Review record：`@deepseek-ai/dsh-tencent-meeting@0.2.3-alpha.2`

> Official DeepSeek Harness connector; reviewed by VibeDev and restored to the curated index.

## 结论 · Verdict

- 收 · include. Reviewed 2026-11-26, testedOn 0.2.3-alpha.2.
- Package integrity: sha512-YWpO080/xjPnD20BxZa+9poFq4aLQnwCe4YhhWPqd2nvzstsSMv4jJ/jsikr9SJMfcoQ6xOMnKMiKu4XP9wfZg==
- Unpacked: 435926 bytes; peers require DSH 0.2.3-alpha.2.

## 行为 · Behaviour

- Network: only the vendor service the user signs in to; no telemetry.
- Files: writes its own account/config/cache files; no DSH profile config.
- Child processes: tmeet.
- Install scripts: none in the package itself; dependencies may need pnpm approval.
- Self-update: none.
