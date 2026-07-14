# 页面直接引用图

页面关系由服务端根据页面 `blocks` 派生，调用方不能单独修改：

- `dependencies`：当前页面通过 `MTabs.data.tabs[].pageUUID` 或任意层级 `open_dialog.inputs.pageUUID` 直接嵌入的页面 UUID。
- `quotes`：直接引用当前页面的页面 UUID。
- `subPage`：恒等于 `quotes.length > 0`。

`jump_url` 只表示导航，不进入引用图。关系数组去重并按稳定字典序排列，不包含传递边。`pageUuid` 仅作为旧数据兼容别名；它和 `pageUUID` 同时存在时会被拒绝。新数据必须写固定字符串 `pageUUID` 以及 `user` 或 `system` 的 `pageSource`。

用户页面 UUID 是 1–128 位小写 Slug，只允许 `a-z`、`0-9`、`_`、`-`；所有入口都会先去除首尾空格并转小写。现有 RFC UUID 仍符合该规则。用户页可以引用用户页和系统页；系统资产只能引用系统资产。用户页同名或与系统页大小写等价同名时返回 `409 / BLOCK_DUPLICATE_RECORD`。服务端在持有 `page_reference_graph_state` 单例行锁的同一数据库事务内验证完整最终图、写页面和反向关系，并在提交前递增 `revision`。`version != 1` 时所有页面内容写入和删除都会失败关闭。

## 审计与回填

系统资产检查是只读操作：

```sh
npm run page-relations:check
```

仅在维护系统资产时写入规范关系字段；第二次执行应为零差异：

```sh
npm run page-relations:write
```

数据库 dry-run 会读取并验证完整用户页与系统页图，不写数据库；非零漂移或图版本未就绪时以状态码 2 退出：

```sh
npm run page-relations:db-check -- --datasource=Mokelay
```

数据库 apply 在一个串行化图事务内完成全量回填、保持页面 `updated_at` 不变，并把图状态提升到 `version=1`：

```sh
npm run page-relations:db-apply -- --datasource=Mokelay
```

`deploy:check` 本身不执行任何写入。连接生产数据库的 dry-run 应作为部署流水线中单独的、只读的阻断步骤运行。

若只执行本功能的可重复发布预检（资产审计、类型检查、关系专项测试与构建），使用：

```sh
npm run page-relations:deploy-check
```

该命令不会替代仓库原有的全量 `deploy:check` 门禁，也不会连接或写入生产数据库；上线前仍须另行执行
`page-relations:db-check`。

## 方言集成测试

页面图事务矩阵需要两个专用、可清空的测试数据库；测试会创建并删除其中名为 `pages` 和
`page_reference_graph_state` 的表。未配置时用例会安全跳过：

```sh
PAGE_REFERENCE_TEST_POSTGRES_URL=postgres://... \
PAGE_REFERENCE_TEST_MYSQL_URL=mysql://... \
npx vitest run tests/integration/page-relations-dialects.test.ts
```

矩阵在 PostgreSQL 和 MySQL 上分别验证 128 位 Slug、数据库 CHECK、并发同名创建、并发成环、
create/delete 竞态、多父引用、批量删除、AI 可读 Slug 批内前向引用和 SQL 失败全批回滚。CI 应为这两个变量配置隔离的服务容器数据库。

## 上线顺序

1. 发布 `mokelay-server-core` 0.1.28 或更高版本，并确认服务安装的 lockfile 解析到该版本。
2. 执行 PostgreSQL/MySQL expand migration，新增三个页面字段、筛选索引及 `page_reference_graph_state(version=0)`。
3. 冻结页面 create、内容 update、delete、批量 delete 和 AI 页面写入，排空所有旧 writer 实例。
4. 部署最终系统资产和审计工具，先运行系统资产检查和数据库 dry-run。非规范化存量标识、UUID 冲突、动态目标、悬空引用、自引用或环都会阻断上线；apply 不会替页面重命名。
5. 运行数据库 apply；它必须一次完成全部页面回填并设置 `version=1`，失败时不得留下部分写入。
6. 部署并启用依赖新版 core 的服务和编辑器，确认无旧 writer 后解除写冻结。
7. 再次运行系统资产检查和数据库 dry-run，要求零漂移。此后禁止回滚到不维护引用图的 writer 版本。

数据库回滚只能在重新冻结写入后进行。不能只回滚应用而保留旧 writer 写入新表，因为这会让持久化的直接边失真。
