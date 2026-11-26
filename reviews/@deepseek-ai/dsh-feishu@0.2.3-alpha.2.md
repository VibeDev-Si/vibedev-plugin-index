# 审核记录 · Review record：`@deepseek-ai/dsh-feishu@0.2.3-alpha.2`

> Official DeepSeek Harness connector; reviewed by VibeDev and restored to the curated index.

## 结论 · Verdict

- 收 · include. Reviewed 2026-11-26, testedOn 0.2.3-alpha.2.
- Package integrity: sha512-yWita+DUvLMLlDk3mTqsBo7ACYCWx3kq0ERpRWJIGodWHO1bzlWqiXWbaqEY1NbmGgP0+zwWj3DB3wOWOYYeJg==
- Unpacked: 458912 bytes; peers require DSH 0.2.3-alpha.2.

## 行为 · Behaviour

- Network: only the vendor service the user signs in to; no telemetry.
- Files: writes its own account/config/cache files; no DSH profile config.
- Child processes: lark-cli.
- Install scripts: none in the package itself; dependencies may need pnpm approval.
- Self-update: none.
