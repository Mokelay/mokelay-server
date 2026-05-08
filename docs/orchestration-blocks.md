# 编排 Blocks 配置文档

本文档说明当前编排接口支持的标准 Blocks：`list`、`page`、`read`、`delete`、`create`、`update`。

编排接口统一从 `server/assets/mokelay-apis/{API_JSON_UUID}.json` 读取 API JSON，并按 `blocks` 数组顺序执行。任一 block 执行失败，后续 block 不再执行，接口直接返回错误。

`list`、`page`、`read`、`delete`、`create`、`update` 都是数据库 block，必须在 `inputs.datasource` 中声明数据源名称。执行器会读取环境变量 `${datasource}_DATABASE_URL` 作为该 block 的数据库连接，不依赖全局 `DATABASE_URL`。

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
| `functionName` | `string` | 是 | Block 类型。当前支持 `list`、`page`、`read`、`delete`、`create`、`update`。 |
| `inputs` | `object` | 否 | Block 输入参数。省略时默认为 `{}`。 |
| `outputs` | `string[] \| null` | 否 | 声明该 block 预期输出字段。声明后，执行器会校验这些字段是否真的产生。 |

## 模板规则

`inputs` 和 API `response` 中都可以使用模板。

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
| `now` | 当前编排执行时间，ISO 字符串。 |

模板类型规则：

- 如果整个字符串只有一个模板占位符，会保留原始类型。
- 如果模板和其他字符串拼接，会转成字符串插值。
- 模板变量不存在会返回 `400`。

示例：

```json
{
  "fieldValue": {
    "template": "{{blocks['create_page_block'].outputs.uuid}}"
  }
}
```

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

`list`、`page`、`read`、`delete`、`update` 支持 `conditions`。

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

## 3. read

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

## 4. delete

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

## 5. create

`create` 用于插入一条数据。

### inputs

```json
{
  "datasource": "Mokelay",
  "table": "pages",
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
| `fields` | `object` | 是 | 插入字段和值。key 是真实数据库字段名，value 是插入值，可使用模板。 |

值处理规则：

- `fields` 里的 key 直接作为数据库字段名。
- `fields` 里的 value 如果是对象或数组，会被 `JSON.stringify(value)::jsonb` 写入。
- 其他 value 会作为普通 SQL 参数写入。
- 如果数据库返回唯一键冲突错误 `23505`，接口返回 `409`。

### SQL 行为

如果声明了 `outputs`：

```sql
INSERT INTO table (columns) VALUES (values) RETURNING outputs
```

如果没有声明 `outputs`：

```sql
INSERT INTO table (columns) VALUES (values)
```

### outputs

`create` 的 outputs 来自 JSON 中声明的 `outputs`。声明哪些字段，就 `RETURNING` 哪些字段。

常见用法是只返回主键，再用后续 `read` block 读取完整数据：

```json
{
  "outputs": ["uuid"]
}
```

如果不需要读取新记录，可以不配置 `outputs`，此时 block 输出为 `{}`。

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

## 6. update

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
UPDATE table SET assignments WHERE conditions
```

没有配置 `conditions` 时：

```sql
UPDATE table SET assignments
```

### outputs

`update` 不支持业务 outputs。

- 不要在 `update` block 上配置 `outputs`。
- 如果配置非空 `outputs`，接口返回 `400`。
- 执行成功后，该 block 在上下文中的 outputs 是 `{}`。

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
    }
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

## response 中使用 Block 输出

API JSON 的 `response` 会在所有 blocks 执行完成后解析模板。

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

如果 API JSON 不配置 `response`，接口返回 `204`。

## 常见配置建议

- `read`、`update`、`delete` 通常都应该配置 `conditions`，避免误读、误改、误删整张表。
- 每个数据库 block 都必须配置 `datasource`，并确保环境变量 `${datasource}_DATABASE_URL` 已设置。
- `create` 建议只返回主键，例如 `["id"]` 或 `["uuid"]`；如果需要完整数据，用后续 `read` block。
- `update` 不要配置 `outputs`；如果需要完整数据，用后续 `read` block。
- `fields` 一律写真实数据库字段名，不写 alias。
- 数据库字段错误、表名错误、字段类型不匹配时，按数据库报错修正 API JSON 配置。
