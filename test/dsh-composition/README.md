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
