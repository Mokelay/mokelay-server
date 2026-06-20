# 编排 Blocks 配置文档

本文档说明当前编排接口支持的标准 Blocks，以及 `mokelay-server` 注册的 `listMokelayApiJsons` 宿主 Block。

编排接口统一按本地 `server/assets/mokelay-apis/{API_JSON_UUID}.json`、Nitro assets、R2 `mokelay-apis/{API_JSON_UUID}.json`、数据库 `apis` 表中已发布记录的顺序读取 API JSON。执行从 `starter.nextBlock` 开始，通过每个 block 或 controller node 的 `nextBlock` 连线向后走；任一 block 执行失败，后续节点不再执行，接口返回错误。

`list`、`page`、`count`、`read`、`delete`、`create`、`upsert`、`assertUnique`、`update` 都是数据库 block，必须在 `inputs.datasource` 中声明数据源名称。执行器会读取环境变量 `${datasource}_DATABASE_URL` 作为该 block 的数据库连接，不依赖全局 `DATABASE_URL`。当前支持 `postgres://`、`postgresql://` 和 `mysql://` 数据库 URL。

`addSession`、`removeSession`、`readSession` 是 session block，使用独立签名 Cookie `mokelay_orchestration_session` 保存编排 session。

`saveJsonToR2` 是 R2 JSON block，用于把请求或流程中的 JSON 数据保存到 Cloudflare R2，也用于 API Builder 发布时写入已发布 API DSL。

`openAI` 是通用 OpenAI JSON block，业务规则由 API JSON 中的 prompt 定义。

## 错误响应

编排接口的业务错误统一使用 HTTP `200`，并在 response body 中返回 `error.code` 和 `error.message`：

```json
{
  "error": {
    "code": "BLOCK_INVALID_FIELDS",
    "message": "fields 必须是非空字符串数组。"
  }
}
```

未分类的内部异常会返回 `INTERNAL_ERROR` 和通用错误消息。成功且未配置响应的 API JSON 返回 `{ "ok": true, "data": null }`。

## 通用 Block 结构

```json
{
  "uuid": "block_uuid",
  "alias": "可选说明",
  "functionName": "list",
  "inputs": {},
  "outputs": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `uuid` | `string` | 是 | Block 唯一标识。后续 block 或 response 可通过它读取 outputs。 |
| `alias` | `string` | 否 | 给人看的说明，不参与执行。 |
| `functionName` | `string` | 是 | Block 类型。除 core 内置 Block 外，宿主服务可以通过 `blockDefinitions` 注册扩展 Block。 |
| `inputs` | `object` | 否 | Block 输入参数。省略时默认为 `{}`。 |
| `outputs` | `string[] \| null` | 否 | 声明该 block 预期输出字段。声明后，执行器会校验这些字段是否真的产生。 |

数据库 block 的输出 key 是固定约定，不是可任意配置的字段名：

| Block | 固定 outputs |
| --- | --- |
| `list` | `datas` |
| `page` | `datas`、`total`、`totalPages`、`page`、`pageSize`、`hasPreviousPage`、`hasNextPage` |
| `count` | `total` |
| `read` | `data` |
| `delete` | `affected` |
| `create` | `uuid` |
| `upsert` | `uuid` |
| `assertUnique` | 无 |
| `update` | `affected` |
| `addSession` | 无 |
| `removeSession` | 无 |
| `readSession` | `value` |
| `saveJsonToR2` | `key`、`directory`、`fileName`、`bucket`、`size`、`etag`、`skipped` |
| `openAI` | `result` |
| `listMokelayApiJsons` | `apis`、`count` |

## 模板规则

`inputs`、API `response` 和 `responses` 中都可以使用模板。

```json
{
  "template": "{{request.body.name}}"
}
```

支持的上下文：

| 路径 | 说明 |
| --- | --- |
| `request.header.xxx` | 读取 API JSON `request.header` 声明的 header 参数。 |
| `request.query.xxx` | 读取 API JSON `request.query` 声明的 query 参数。 |
| `request.body.xxx` | 读取 API JSON `request.body` 声明的 body 参数。GET 请求不读取 body。 |
| `header.xxx` | `request.header.xxx` 的快捷路径。 |
| `query.xxx` | `request.query.xxx` 的快捷路径。 |
| `body.xxx` | `request.body.xxx` 的快捷路径。 |
| `blocks['block_uuid'].outputs.xxx` | 读取前面某个 block 的输出。 |
| `blocks['block_uuid'].outputs.data.xxx` | 读取 `read` block 返回的数据字段。 |
| `now` | 当前编排执行时间，SQL 时间字符串，例如 `2026-05-27 03:02:30.093+00:00`。 |

模板类型规则：

- 如果整个字符串只有一个模板占位符，会保留原始类型。
- 如果模板和其他字符串拼接，会转成字符串插值。
- 模板变量不存在会返回 `TEMPLATE_VARIABLE_NOT_FOUND` 错误。

示例：

```json
{
  "fieldValue": {
    "template": "{{blocks['create_page_block'].outputs.uuid}}"
  }
}
```

## Response 配置

旧版单响应继续支持顶层 `response`：

```json
{
  "response": {
    "data": {
      "template": "{{blocks['read_record'].outputs.data}}"
    }
  }
}
```

配置了 controller 后，同一个 API 可能有多个 `nextBlock: null` 终点。可使用顶层 `responses` 按终点 UUID 独立配置响应：

```json
{
  "responses": {
    "success_block": {
      "user": {
        "template": "{{blocks['read_user'].outputs.data}}"
      }
    },
    "password_false_node": {
      "user": null
    }
  }
}
```

终点 UUID 规则：

- `starter.nextBlock` 为 `null` 时，终点是 `starter`。
- 普通 block 的 `nextBlock` 为 `null` 时，终点是该 block 的 `uuid`。
- controller node 的 `nextBlock` 为 `null` 时，终点是该 node 的 `uuid`。

响应选择规则：

- 命中终点后优先使用 `responses[终点 UUID]`。
- 如果该终点未配置且存在顶层 `response`，回退使用 `response`。
- 如果配置了 `responses` 且没有顶层 `response`，必须覆盖所有终点，否则返回 `API_JSON_INVALID_RESPONSE`。

## Datasource 配置

数据库 block 的 `inputs.datasource` 必须是非空字符串，只能包含字母、数字、下划线，且不能以数字开头。

示例：

```json
{
  "datasource": "Mokelay"
}
```

上面的配置会读取环境变量：

```env
Mokelay_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
BingX_DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME
```

同一个 API JSON 的不同 block 可以配置不同 datasource。`datasource` 也可以使用模板，但通常建议写固定值，避免请求参数决定数据库连接。

## SQL 标识符规则

`table`、`fields`、`fieldName`、`orderBy.fieldName` 都来自 API JSON 配置。

执行器不会维护物理表字段定义，也不会检查字段是否存在于服务端 registry。配置里的表名和字段名会直接作为 SQL 标识符执行；如果数据库报错，就修正 JSON 配置。

约束：

- `table` 必须是非空字符串。
- `fields` 查询字段必须是非空字符串数组。
- `create` / `update` 的 `fields` 必须是非空对象。
- 字段不支持 alias，直接写真实数据库字段名。
- 标识符会通过 Drizzle `sql.identifier` 转义，避免把配置值直接拼成裸 SQL。

表名可以使用点号表达 schema，例如：

```json
{
  "table": "public.pages"
}
```

## Conditions 配置

`list`、`page`、`count`、`read`、`delete`、`update` 支持 `conditions`。

### 普通条件

```json
{
  "group": false,
  "conditionType": "EQ",
  "fieldName": "uuid",
  "fieldValue": {
    "template": "{{request.query.uuid}}"
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | `false` | 是 | 普通条件固定为 `false`。 |
| `conditionType` | `string` | 是 | 条件类型。 |
| `fieldName` | `string` | 是 | 数据库字段名。 |
| `fieldValue` | `unknown` | 是 | 比较值，可使用模板。 |

支持的 `conditionType`：

| 类型 | SQL 行为 |
| --- | --- |
| `EQ` | `field = value` |
| `NEQ` | `field <> value` |
| `GT` | `field > value` |
| `GE` | `field >= value` |
| `LT` | `field < value` |
| `LE` | `field <= value` |
| `IN` | `field IN (...)`，`fieldValue` 必须是非空数组 |
| `NOTIN` | `field NOT IN (...)`，`fieldValue` 必须是非空数组 |

### 条件组

```json
{
  "group": true,
  "groupType": "AND",
  "groups": [
    {
      "group": false,
      "conditionType": "EQ",
      "fieldName": "name",
      "fieldValue": {
        "template": "{{request.body.name}}"
      }
    },
    {
      "group": false,
      "conditionType": "GE",
      "fieldName": "created_at",
      "fieldValue": {
        "template": "{{request.body.created_at_begin}}"
      }
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | `true` | 是 | 条件组固定为 `true`。 |
| `groupType` | `AND \| OR` | 是 | 组内条件连接方式。 |
| `groups` | `Condition[]` | 是 | 至少一个子条件，可继续嵌套条件组。 |

顶层 `conditions` 数组之间固定使用 `AND` 连接。

## orderBy 配置

`list` 和 `page` 支持 `orderBy`。

```json
{
  "orderBy": [
    {
      "fieldName": "updated_at",
      "direction": "DESC"
    },
    {
      "fieldName": "created_at",
      "direction": "DESC"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fieldName` | `string` | 是 | 排序字段，真实数据库字段名。 |
| `direction` | `ASC \| DESC` | 否 | 排序方向，省略时默认为 `ASC`。 |

## 1. list

`list` 用于查询多行数据，不分页。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "users",
  "fields": ["id", "name", "email", "created_at", "updated_at"],
  "conditions": [],
  "orderBy": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `fields` | `string[]` | 是 | 查询字段。必须是真实字段名，不支持 alias。 |
| `conditions` | `Condition[]` | 否 | 查询条件。省略时不加 `WHERE`。 |
| `orderBy` | `OrderBy[]` | 否 | 排序规则。省略时不加 `ORDER BY`。 |

### SQL 行为

无条件：

```sql
SELECT fields FROM table
```

有条件：

```sql
SELECT fields FROM table WHERE conditions
```

有排序：

```sql
SELECT fields FROM table WHERE conditions ORDER BY orderBy
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `datas` | `object[]` | 查询到的多行数据。 |

推荐声明：

```json
{
  "outputs": ["datas"]
}
```

### 示例

```json
{
  "uuid": "list_users_block",
  "alias": "查询用户列表",
  "functionName": "list",
  "inputs": {
    "datasource": "Mokelay",
    "table": "users",
    "fields": ["id", "name", "email", "created_at", "updated_at"],
    "conditions": [
      {
        "group": false,
        "conditionType": "EQ",
        "fieldName": "name",
        "fieldValue": {
          "template": "{{request.body.name}}"
        }
      }
    ],
    "orderBy": [
      {
        "fieldName": "created_at",
        "direction": "DESC"
      }
    ]
  },
  "outputs": ["datas"]
}
```

## 2. page

`page` 用于分页查询多行数据，并返回分页信息。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "pages",
  "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
  "conditions": [],
  "orderBy": [],
  "page": 1,
  "pageSize": 20
}
```

字段说明：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | - | 数据库表名。 |
| `fields` | `string[]` | 是 | - | 查询字段。必须是真实字段名，不支持 alias。 |
| `conditions` | `Condition[]` | 否 | 无 | 查询条件。 |
| `orderBy` | `OrderBy[]` | 否 | 无 | 排序规则。 |
| `page` | `number \| string` | 否 | `1` | 页码，必须是正整数。可用模板从 query/body 读取。 |
| `pageSize` | `number \| string` | 否 | `20` | 每页数量，必须是正整数。可用模板从 query/body 读取。 |

### SQL 行为

数据查询：

```sql
SELECT fields FROM table WHERE conditions ORDER BY orderBy LIMIT pageSize OFFSET (page - 1) * pageSize
```

总数查询：

```sql
SELECT count(*)::int AS total FROM table WHERE conditions
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `datas` | `object[]` | 当前页数据。 |
| `total` | `number` | 总记录数。 |
| `totalPages` | `number` | 总页数。 |
| `page` | `number` | 当前页码。 |
| `pageSize` | `number` | 每页数量。 |
| `hasPreviousPage` | `boolean` | 是否有上一页。 |
| `hasNextPage` | `boolean` | 是否有下一页。 |

推荐声明：

```json
{
  "outputs": ["datas", "total", "totalPages", "page", "pageSize", "hasPreviousPage", "hasNextPage"]
}
```

### 示例

```json
{
  "uuid": "list_pages_block",
  "alias": "页面分页Block",
  "functionName": "page",
  "inputs": {
    "datasource": "Mokelay",
    "table": "pages",
    "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
    "page": {
      "template": "{{request.query.page}}"
    },
    "pageSize": {
      "template": "{{request.query.pageSize}}"
    },
    "orderBy": [
      {
        "fieldName": "updated_at",
        "direction": "DESC"
      },
      {
        "fieldName": "created_at",
        "direction": "DESC"
      }
    ]
  },
  "outputs": ["datas", "total", "totalPages", "page", "pageSize", "hasPreviousPage", "hasNextPage"]
}
```

## 3. count

`count` 用于统计满足条件的数据总数。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "users",
  "conditions": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `conditions` | `Condition[]` | 否 | 查询条件。省略时统计整张表。 |

### SQL 行为

无条件：

```sql
SELECT count(*)::int AS total FROM table
```

有条件：

```sql
SELECT count(*)::int AS total FROM table WHERE conditions
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `total` | `number` | 满足条件的记录总数。 |

推荐声明：

```json
{
  "outputs": ["total"]
}
```

### 示例

```json
{
  "uuid": "count_free_users_block",
  "alias": "统计免费套餐用户数量",
  "functionName": "count",
  "inputs": {
    "datasource": "Mokelay",
    "table": "users",
    "conditions": [
      {
        "group": false,
        "conditionType": "EQ",
        "fieldName": "plan",
        "fieldValue": "free"
      }
    ]
  },
  "outputs": ["total"]
}
```

## 4. read

`read` 用于读取单条数据。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "pages",
  "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
  "conditions": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `fields` | `string[]` | 是 | 查询字段。必须是真实字段名，不支持 alias。 |
| `conditions` | `Condition[]` | 否 | 查询条件。省略时读取表里的第一条记录。 |

### SQL 行为

```sql
SELECT fields FROM table WHERE conditions LIMIT 1
```

没有配置 `conditions` 时：

```sql
SELECT fields FROM table LIMIT 1
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `object \| null` | 查询到的第一行数据；不存在时为 `null`。 |

推荐声明：

```json
{
  "outputs": ["data"]
}
```

### 示例

```json
{
  "uuid": "read_page_block",
  "alias": "读取页面Block",
  "functionName": "read",
  "inputs": {
    "datasource": "Mokelay",
    "table": "pages",
    "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
    "conditions": [
      {
        "group": false,
        "conditionType": "EQ",
        "fieldName": "uuid",
        "fieldValue": {
          "template": "{{request.query.uuid}}"
        }
      }
    ]
  },
  "outputs": ["data"]
}
```

## 5. delete

`delete` 用于删除数据。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "users",
  "conditions": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `conditions` | `Condition[]` | 否 | 删除条件。省略时会删除整张表数据，请谨慎配置。 |

### SQL 行为

```sql
DELETE FROM table WHERE conditions RETURNING 1 AS affected_marker
```

没有配置 `conditions` 时：

```sql
DELETE FROM table RETURNING 1 AS affected_marker
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `affected` | `number` | 被删除的记录数。 |

推荐声明：

```json
{
  "outputs": ["affected"]
}
```

### 示例

```json
{
  "uuid": "delete_user_block",
  "alias": "删除用户Block",
  "functionName": "delete",
  "inputs": {
    "datasource": "Mokelay",
    "table": "users",
    "conditions": [
      {
        "group": false,
        "conditionType": "EQ",
        "fieldName": "id",
        "fieldValue": {
          "template": "{{request.body.id}}"
        }
      }
    ]
  },
  "outputs": ["affected"]
}
```

## 6. create

`create` 用于插入一条数据。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "pages",
  "idField": "uuid",
  "fields": {
    "name": "首页",
    "blocks": []
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `idField` | `string` | 是 | 插入后要返回的物理唯一 ID 字段。该字段值会被映射到 `outputs.uuid`。 |
| `fields` | `object` | 是 | 插入字段和值。key 是真实数据库字段名，value 是插入值，可使用模板。 |

值处理规则：

- `fields` 里的 key 直接作为数据库字段名。
- `fields` 里的 value 如果是对象或数组，会被 `JSON.stringify(value)::jsonb` 写入。
- 其他 value 会作为普通 SQL 参数写入。
- 如果数据库返回唯一键冲突错误 `23505`，接口返回 `BLOCK_DUPLICATE_RECORD` 错误。

### SQL 行为

PostgreSQL：

```sql
INSERT INTO table (columns) VALUES (values) RETURNING idField
```

MySQL：

- 对自增整型主键，使用 MySQL 返回的 `insertId`。
- 对 `CHAR/VARCHAR DEFAULT UUID()` 的 `idField`，执行器会在插入前生成 UUID 并写入该字段，再把这个 UUID 作为 `outputs.uuid` 返回。
- 如果 `fields` 已经显式包含 `idField`，直接返回传入的字段值。

### outputs

`create` 的输出 key 固定为 `uuid`，表示插入数据库后返回的这条记录的唯一 ID。`uuid` 是 block 约定输出名，不是物理数据库字段名。

物理字段由 `inputs.idField` 指定。例如 `users` 表的物理字段可以是 `id`，但 block 输出仍然是 `outputs.uuid`。

推荐声明：

```json
{
  "outputs": ["uuid"]
}
```

不要在 `create.outputs` 中配置 `id` 或其他物理字段名。如果配置了非 `uuid` 输出，接口返回 `BLOCK_UNSUPPORTED_OUTPUT` 错误。

### 示例：创建后读取完整数据

```json
[
  {
    "uuid": "create_page_block",
    "alias": "创建页面Block",
    "functionName": "create",
    "inputs": {
      "datasource": "Mokelay",
      "table": "pages",
      "idField": "uuid",
      "fields": {
        "name": {
          "template": "{{request.body.name}}"
        },
        "blocks": {
          "template": "{{request.body.blocks}}"
        }
      }
    },
    "outputs": ["uuid"]
  },
  {
    "uuid": "read_page_block",
    "alias": "读取页面Block",
    "functionName": "read",
    "inputs": {
      "datasource": "Mokelay",
      "table": "pages",
      "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
      "conditions": [
        {
          "group": false,
          "conditionType": "EQ",
          "fieldName": "uuid",
          "fieldValue": {
            "template": "{{blocks['create_page_block'].outputs.uuid}}"
          }
        }
      ]
    },
    "outputs": ["data"]
  }
]
```

## 7. upsert

`upsert` 用于按唯一 ID 创建或覆盖数据。它和 `create` 使用相同的 `datasource`、`table`、`idField`、`fields` 输入；`fields` 必须包含 `idField` 对应字段。

冲突时会更新除 `idField` 外的其他字段，并更新 `updated_at`；适合 API Builder 这类“保存即覆盖”的场景。

### SQL 行为

PostgreSQL：

```sql
INSERT INTO table (columns) VALUES (values)
ON CONFLICT (idField) DO UPDATE SET assignments
RETURNING idField
```

MySQL：

```sql
INSERT INTO table (columns) VALUES (values)
ON DUPLICATE KEY UPDATE assignments
```

### outputs

`upsert` 的输出 key 固定为 `uuid`，表示保存记录的唯一 ID。物理字段仍由 `inputs.idField` 指定。

推荐声明：

```json
{
  "outputs": ["uuid"]
}
```

## 8. assertUnique

`assertUnique` 用于在写入前校验某个字段值是否唯一。存在冲突记录时，block 会抛出 `BLOCK_UNIQUE_CONFLICT`，后续 block 不再执行。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "apis",
  "fieldName": "uuid",
  "value": {
    "template": "{{request.body.uuid}}"
  },
  "ignoreField": "uuid",
  "ignoreValue": {
    "template": "{{request.body.originalUuid}}"
  },
  "message": "API 标识已存在。"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `fieldName` | `string` | 是 | 需要校验唯一性的字段名。 |
| `value` | `unknown` | 是 | 需要校验的字段值，可使用模板。 |
| `ignoreField` | `string` | 否 | 编辑已有记录时，用于排除当前记录的字段名。 |
| `ignoreValue` | `unknown` | 否 | 编辑已有记录时，用于排除当前记录的字段值。 |
| `message` | `string` | 否 | 冲突时返回给调用方的错误消息，默认 `记录已存在。`。 |

### SQL 行为

```sql
SELECT count(*) AS total FROM table WHERE fieldName = value
```

配置 `ignoreField` 和 `ignoreValue` 时：

```sql
SELECT count(*) AS total FROM table WHERE fieldName = value AND ignoreField <> ignoreValue
```

### outputs

`assertUnique` 不产生业务输出，通常不需要声明 `outputs`。

## 9. update

`update` 用于更新数据。

`update` 不返回业务字段。如果需要返回更新后的数据，请在 `update` 后追加一个 `read` block。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "pages",
  "fields": {
    "blocks": [],
    "updated_at": {
      "template": "{{now}}"
    }
  },
  "conditions": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。 |
| `fields` | `object` | 是 | 更新字段和值。key 是真实数据库字段名，value 是更新值，可使用模板。 |
| `conditions` | `Condition[]` | 否 | 更新条件。省略时会更新整张表数据，请谨慎配置。 |

值处理规则：

- `fields` 里的 key 直接作为数据库字段名。
- `fields` 里的 value 如果是对象或数组，会被 `JSON.stringify(value)::jsonb` 写入。
- 其他 value 会作为普通 SQL 参数写入。

### SQL 行为

```sql
UPDATE table SET assignments WHERE conditions RETURNING 1 AS affected_marker
```

没有配置 `conditions` 时：

```sql
UPDATE table SET assignments RETURNING 1 AS affected_marker
```

### outputs

执行器固定产生：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `affected` | `number` | 被更新的记录数。 |

推荐声明：

```json
{
  "outputs": ["affected"]
}
```

### 示例：更新后读取完整数据

```json
[
  {
    "uuid": "update_page_block",
    "alias": "更新页面Block",
    "functionName": "update",
    "inputs": {
      "datasource": "Mokelay",
      "table": "pages",
      "fields": {
        "blocks": {
          "template": "{{request.body.blocks}}"
        },
        "updated_at": {
          "template": "{{now}}"
        }
      },
      "conditions": [
        {
          "group": false,
          "conditionType": "EQ",
          "fieldName": "uuid",
          "fieldValue": {
            "template": "{{request.query.uuid}}"
          }
        }
      ]
    },
    "outputs": ["affected"]
  },
  {
    "uuid": "read_page_block",
    "alias": "读取页面Block",
    "functionName": "read",
    "inputs": {
      "datasource": "Mokelay",
      "table": "pages",
      "fields": ["uuid", "name", "blocks", "created_at", "updated_at"],
      "conditions": [
        {
          "group": false,
          "conditionType": "EQ",
          "fieldName": "uuid",
          "fieldValue": {
            "template": "{{request.query.uuid}}"
          }
        }
      ]
    },
    "outputs": ["data"]
  }
]

```

## Session Blocks

Session blocks 不需要 `inputs.datasource`，使用独立签名 Cookie `mokelay_orchestration_session` 保存 `values` 对象。

### addSession

写入一个 session key。`value` 可以是普通 JSON 值，也可以是模板。

```json
{
  "uuid": "add_session_block",
  "functionName": "addSession",
  "inputs": {
    "key": "profile",
    "value": {
      "template": "{{request.body.profile}}"
    }
  }
}
```

inputs：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 要写入的 session key。 |
| `value` | `any \| CalculateTemplate` | 是 | 要写入的 session 值。 |

outputs：无。

### removeSession

删除一个 session key。key 不存在时仍视为成功。

```json
{
  "uuid": "remove_session_block",
  "functionName": "removeSession",
  "inputs": {
    "key": "profile"
  }
}
```

inputs：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 要删除的 session key。 |

outputs：无。

### readSession

读取一个 session key。读取不到时不会报错，会返回 `value: null`。

```json
{
  "uuid": "read_session_block",
  "functionName": "readSession",
  "inputs": {
    "key": "profile"
  },
  "outputs": ["value"]
}
```

inputs：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 要读取的 session key。 |

固定 outputs：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `any` | session 中保存的值。 |

response 示例：

```json
{
  "response": {
    "profile": {
      "template": "{{blocks['read_session_block'].outputs.value}}"
    },
    "loggedIn": {
      "template": "{{blocks['read_session_block'].outputs.value}}",
      "processors": ["not_null"]
    }
  }
}
```

## R2 JSON Block

`saveJsonToR2` 将 JSON 字符串或 JSON 值保存到 Cloudflare R2。它复用 `CLOUDFLARE_R2_*` 和 `MOKELAY_APIS_R2_BUCKET` 配置。

```json
{
  "uuid": "save_json_block",
  "functionName": "saveJsonToR2",
  "inputs": {
    "directory": {
      "template": "{{request.body.directory}}"
    },
    "fileName": {
      "template": "{{request.body.fileName}}"
    },
    "data": {
      "template": "{{request.body.data}}"
    }
  },
  "outputs": ["key", "directory", "fileName", "bucket", "size", "etag"]
}
```

inputs：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `directory` | `string` | 是 | R2 子目录，会去掉首尾 `/`；不能包含空路径段、`.`、`..` 或反斜杠。 |
| `fileName` | `string` | 是 | R2 文件名，不能包含 `/`、反斜杠、`.` 或 `..`。 |
| `data` | `any \| string` | 是 | 要保存的 JSON 数据；字符串会先按 JSON 解析。 |
| `enabled` | `boolean` | 否 | 为 `false` 时跳过目录、文件名、data、R2 配置校验和上传。 |

固定 outputs：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string \| null` | R2 object key，格式为 `{directory}/{fileName}`；跳过时为 `null`。 |
| `directory` | `string \| null` | 规范化后的目录；跳过时为 `null`。 |
| `fileName` | `string \| null` | 最终文件名；跳过时为 `null`。 |
| `bucket` | `string \| null` | 写入的 R2 bucket；跳过时为 `null`。 |
| `size` | `number` | 写入内容的 UTF-8 字节数；跳过时为 `0`。 |
| `etag` | `string \| null` | R2 返回的 ETag。 |
| `skipped` | `boolean` | 是否因 `enabled=false` 跳过上传。 |

## 通用 OpenAI JSON Block

`openAI` 调用 OpenAI Responses API，强制模型返回 JSON object，解析后写入 `outputs.result`。它复用 `OPENAI_API_KEY` 和可选 `OPENAI_MODEL` 配置。

```json
{
  "uuid": "openai_block",
  "functionName": "openAI",
  "inputs": {
    "prompt": {
      "template": "分析输入并返回 {\"result\": ...} JSON 对象。"
    },
    "userInput": {
      "template": "{{request.body.userInput}}"
    },
    "image": {
      "template": "{{request.body.image}}"
    }
  },
  "outputs": ["result"]
}
```

inputs：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | `string` | 是 | Developer prompt，不能超过 100KB。Block 会自动追加只返回 JSON object 的约束。 |
| `userInput` | `unknown` | 否 | 用户输入；非字符串值会通过 `JSON.stringify` 转换。 |
| `image` | `object` | 否 | 通过 `multipart/form-data` 上传的图片文件。只支持 JPEG、PNG、WebP，大小不能超过 10MB。 |

必须至少提供 `userInput` 或 `image` 之一。JSON body 不支持传 `image` data URL；图片只能通过 multipart 文件字段上传。调用参数固定包含 `max_output_tokens: 8192`、`store: false` 和 `text.format.type: "json_object"`。

固定 outputs：

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `result` | `object` | 模型返回的 JSON object。Block 不校验业务 schema。 |

错误码：

| 错误码 | 说明 |
| --- | --- |
| `BLOCK_AI_INPUT_INVALID` | 输入为空、类型不对或超出大小/格式限制。 |
| `BLOCK_AI_CONFIG_MISSING` | 缺少或无效的 AI 服务配置，例如 `OPENAI_API_KEY` 或 `OPENAI_MODEL`。 |
| `BLOCK_AI_PROVIDER_FAILED` | AI 服务调用失败。 |
| `BLOCK_AI_OUTPUT_INVALID` | AI 返回结构无效或无法解析。 |

## 内置 API DSL 列表 Block

`listMokelayApiJsons` 由 `mokelay-server` 注册，不属于 core 通用 Block。它枚举 Nitro `assets:server` 中 `mokelay-apis` 目录的一级 `.json` 文件，按文件名排序并返回完整原始 DSL。

每个文件都会先解析 JSON，再按文件名对应的 UUID 调用 `parseApiJson` 校验。任一文件 JSON 损坏、DSL schema 无效或 UUID 不匹配时，整个 Block 失败，不会静默跳过。

```json
{
  "uuid": "list_mokelay_api_jsons_block",
  "functionName": "listMokelayApiJsons",
  "inputs": {},
  "outputs": ["apis", "count"],
  "nextBlock": null
}
```

对应公开 DSL 为 `GET /api/mokelay/list_mokelay_api_jsons`，响应 `data` 包含 `apis` 和 `count`。

## API DSL 发布示例

API Builder 发布流程复用 `saveJsonToR2`。它通过 processors 让 `status='published'` 时写入 `MOKELAY_APIS_R2_PREFIX/{uuid}.json`，其它状态跳过上传。

```json
{
  "uuid": "publish_api_json_to_r2_block",
  "functionName": "saveJsonToR2",
  "inputs": {
    "enabled": {
      "template": "{{request.body.status}}",
      "processors": [
        {
          "processor": "equals",
          "param": "published"
        }
      ]
    },
    "directory": {
      "template": "{{request.body.status}}",
      "processors": [
        {
          "processor": "env_value",
          "param": "MOKELAY_APIS_R2_PREFIX"
        }
      ]
    },
    "fileName": {
      "template": "{{request.body.uuid}}.json"
    },
    "data": {
      "template": "{{request.body.apiJson}}",
      "processors": [
        {
          "processor": "api_json_when_published",
          "param": {
            "uuid": {
              "template": "{{request.body.uuid}}"
            },
            "status": {
              "template": "{{request.body.status}}"
            }
          }
        }
      ]
    }
  }
}
```

## response 中使用 Block 输出

API JSON 的 `response` 会在所有 blocks 执行完成后解析模板，并统一放到接口响应的 `data` 字段下。成功响应固定为 `{ "ok": true, "data": ... }`，异常响应固定为 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。

示例：

```json
{
  "response": {
    "page": {
      "uuid": {
        "template": "{{blocks['read_page_block'].outputs.data.uuid}}"
      },
      "name": {
        "template": "{{blocks['read_page_block'].outputs.data.name}}"
      },
      "blocks": {
        "template": "{{blocks['read_page_block'].outputs.data.blocks}}"
      }
    }
  }
}
```

如果 API JSON 不配置 `response` 或配置为 `null`，接口返回 `{ "ok": true, "data": null }`。

## 常见配置建议

- `read`、`update`、`delete` 通常都应该配置 `conditions`，避免误读、误改、误删整张表。
- 每个数据库 block 都必须配置 `datasource`，并确保环境变量 `${datasource}_DATABASE_URL` 已设置。
- `create` 的 `outputs` 固定为 `["uuid"]`；不要写物理字段名。物理唯一 ID 字段用 `inputs.idField` 配置。
- `assertUnique` 应放在 `create` 或 `upsert` 前面，用于提前返回更清晰的唯一性冲突错误。
- `update` 的 `outputs` 固定为 `["affected"]`；如果需要完整数据，用后续 `read` block。
- `saveJsonToR2` 需要 R2 token 具备目标 bucket 的 Object Write 权限。
- API Builder 中用于发布 API DSL 的 `saveJsonToR2` 应放在 `apis` 表写入前，确保 R2 发布失败时不会把 API 标记为已发布。
- `fields` 一律写真实数据库字段名，不写 alias。
- 数据库字段错误、表名错误、字段类型不匹配时，按数据库报错修正 API JSON 配置。
