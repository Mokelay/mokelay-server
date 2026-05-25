# API JSON Schema 描述文档

本文档描述 `server/assets/mokelay-apis/{API_JSON_UUID}.json` 的完整配置结构。生产环境可先从 Cloudflare R2 的 `mokelay-apis/{API_JSON_UUID}.json` 读取同一份配置，再回退到 Nitro assets 和本地目录。API JSON 由编排路由 `GET|POST /api/mokelay/{API_JSON_UUID}` 加载，并由 `server/utils/orchestration.ts` 解析和执行。

更细的 block SQL 行为和示例见 [orchestration-blocks.md](./orchestration-blocks.md)。

## 总体规则

- API JSON 文件名建议与顶层 `uuid` 一致，例如 `server/assets/mokelay-apis/login.json` 的 `uuid` 应为 `login`。
- R2 object key 默认使用 `mokelay-apis/{API_JSON_UUID}.json`。修改本地 JSON 后，用 `npm run sync:mokelay-apis:r2` 同步到 R2。
- 请求路径里的 `{API_JSON_UUID}` 只能包含字母、数字、下划线、连字符，长度 `1-128`。
- 顶层 `uuid` 必须等于请求路径里的 `{API_JSON_UUID}`，否则返回 `API_JSON_UUID_MISMATCH`。
- 顶层对象、`request`、`block`、`processor` 对象、`condition` 对象都是严格结构，不允许多余字段。
- `inputs` 和 `response` 是开放对象，允许业务自定义字段；标准 block 只读取自己认识的字段。
- 成功响应固定为 `{ "ok": true, "data": ... }`。
- 失败响应固定为 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。当前编排路由会把业务错误包装成 HTTP `200` 返回。

## 完整结构

```ts
type ApiJson = {
  uuid: string
  alias?: string
  method: string
  request?: RequestSchema
  blocks?: Block[]
  response?: Record<string, unknown> | null
}

type RequestSchema = {
  header?: ProcessableKey[]
  query?: ProcessableKey[]
  body?: ProcessableKey[]
}

type ProcessableKey =
  | string
  | {
      key: string
      processors?: ProcessorConfig[]
    }

type ProcessorConfig =
  | string
  | {
      processor: string
      param?: unknown
    }

type Block = {
  uuid: string
  alias?: string
  functionName: string
  inputs?: Record<string, unknown>
  outputs?: ProcessableKey[] | null
}

type CalculateTemplate = {
  template: string
  processors?: ProcessorConfig[]
}

type Condition =
  | {
      group: false
      fieldName: string
      fieldValue: unknown
      conditionType: 'GE' | 'GT' | 'LE' | 'LT' | 'NEQ' | 'EQ' | 'NOTIN' | 'IN'
    }
  | {
      group: true
      groupType: 'AND' | 'OR'
      groups: Condition[]
    }

type OrderBy = {
  fieldName: string
  direction?: 'ASC' | 'DESC'
}
```

## 顶层 ApiJson

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `uuid` | `string` | 是 | - | API JSON 唯一标识，必须非空，并且必须与请求路径 `{API_JSON_UUID}` 相同。 |
| `alias` | `string` | 否 | - | 给人看的接口名称或说明，不参与执行。 |
| `method` | `string` | 是 | - | HTTP 方法，解析时会转成大写；运行时必须与真实请求方法一致。当前示例主要使用 `GET`、`POST`。 |
| `request` | `RequestSchema` | 否 | 空声明 | 声明允许读取和预处理的 header、query、body 参数。 |
| `blocks` | `Block[]` | 否 | `[]` | 按顺序执行的编排 block。任一 block 抛错，后续 block 不再执行。 |
| `response` | `object \| null` | 否 | `null` | 成功响应的 `data` 内容模板。省略或为 `null` 时返回 `data: null`。 |

最小示例：

```json
{
  "uuid": "count_free_users",
  "alias": "统计免费套餐用户数量接口",
  "method": "GET",
  "blocks": [
    {
      "uuid": "count_free_users_block",
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
  ],
  "response": {
    "total": {
      "template": "{{blocks['count_free_users_block'].outputs.total}}"
    }
  }
}
```

## RequestSchema

`request` 用来声明编排执行时可以读取哪些入参。未声明的请求参数不会进入模板上下文。

```json
{
  "request": {
    "header": ["authorization"],
    "query": ["page", "pageSize"],
    "body": [
      {
        "key": "email",
        "processors": ["trim", "is_not_null", "email_check"]
      }
    ]
  }
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `header` | `ProcessableKey[]` | 否 | `[]` | 要读取的 header。读取时按小写 header 名从请求中取值，但上下文中保留声明的原始 key。 |
| `query` | `ProcessableKey[]` | 否 | `[]` | 要读取的 query 参数。数组值只取第一个。 |
| `body` | `ProcessableKey[]` | 否 | `[]` | 要读取的 JSON body 字段。`GET` 请求不会读取 body。 |

参数声明有两种写法：

| 写法 | 示例 | 行为 |
| --- | --- | --- |
| 字符串 | `"email"` | 参数必填。缺失、`null`、空字符串都会返回 `REQUEST_PARAMETER_MISSING`。 |
| 对象 | `{ "key": "email", "processors": [...] }` | 参数是否必填由 processors 决定。需要必填时加 `is_not_null`。 |

`ProcessableKey` 对象字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `key` | `string` | 是 | - | 参数名或输出名，必须非空。 |
| `processors` | `ProcessorConfig[]` | 否 | `[]` | 依次执行的处理器。 |

## ProcessorConfig

Processor 可以用于 `request` 入参、`outputs` 输出声明，以及模板对象 `CalculateTemplate.processors`。

```json
{
  "processor": "max",
  "param": [255]
}
```

也可以简写为字符串：

```json
"trim"
```

对象字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `processor` | `string` | 是 | 处理器名称，必须非空。 |
| `param` | `unknown` | 否 | 处理器参数。若是数组，会按数组展开；若不是数组，会作为单个参数。 |

`outputs` 和 `CalculateTemplate.processors` 中的 `param` 可以使用模板上下文；`request` 入参阶段还没有执行上下文，因此 `request` processors 的 `param` 不会解析模板。

支持的 processors：

| 名称 | 参数 | 行为 |
| --- | --- | --- |
| `trim` | 无 | 如果值是字符串，返回 `value.trim()`；非字符串原样返回。 |
| `is_not_null` | 无 | 校验值不能是 `undefined`、`null`、空字符串。 |
| `is_null` | 无 | 校验值必须是 `undefined`、`null` 或空字符串。 |
| `not_null` | 无 | 返回布尔值，表示值不是 `undefined`、`null`、空字符串。 |
| `email_check` | 无 | 校验值是合法 email 字符串。 |
| `number_check` | 无 | 校验值是有限数字，或可转成有限数字的非空字符串。 |
| `eq` | `expected` | 使用深度严格相等校验值等于 `expected`。 |
| `min` | `limit` | 校验字符串或数组长度不小于非负整数 `limit`。 |
| `max` | `limit` | 校验字符串或数组长度不大于非负整数 `limit`。 |
| `regex` | `pattern` | 校验字符串匹配正则。`pattern` 可写 `"^[a-z]+$"` 或 `"/^[a-z]+$/i"`。 |
| `hash_make` | 无 | 校验值是字符串，并返回密码 hash。 |
| `hash_check` | `plainPassword` | 校验当前值是 hash 字符串，参数是明文密码字符串，并验证二者匹配。 |

Processor 校验失败会返回 `PROCESSOR_VALIDATION_FAILED`；配置错误会返回 `PROCESSOR_INVALID_CONFIG`；未知处理器返回 `PROCESSOR_UNSUPPORTED`。

## 模板 CalculateTemplate

`inputs`、`response`、以及支持上下文的 processor `param` 中可以使用模板对象：

```json
{
  "template": "{{request.body.email}}",
  "processors": ["trim", "email_check"]
}
```

不要直接把字段值写成 `"{{request.body.email}}"`；普通字符串不会被当作模板渲染。需要使用 `{ "template": "..." }` 对象。

字段说明：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `template` | `string` | 是 | - | 模板字符串，必须非空。 |
| `processors` | `ProcessorConfig[]` | 否 | `[]` | 模板渲染后继续执行的 processors。 |

对象要被识别为模板，应该只包含 `template` 和可选 `processors`。如果同时写了 `processors` 但结构不合法，会返回 `PROCESSOR_INVALID_CONFIG`。

类型规则：

- 当 `template` 整体只有一个占位符，例如 `"{{request.body.blocks}}"`，会保留变量原始类型。
- 当 `template` 包含普通字符串拼接，例如 `"user:{{request.body.id}}"`，变量会转成字符串后插入。
- `undefined` 在字符串拼接时会渲染为空字符串。
- 模板路径不存在时返回 `TEMPLATE_VARIABLE_NOT_FOUND`。
- 模板路径语法错误时返回 `TEMPLATE_PATH_INVALID`。

可用上下文：

| 路径 | 说明 |
| --- | --- |
| `request.header.xxx` | 已声明并处理后的 header 参数。 |
| `request.query.xxx` | 已声明并处理后的 query 参数。 |
| `request.body.xxx` | 已声明并处理后的 body 参数。 |
| `header.xxx` | `request.header.xxx` 的快捷路径。 |
| `query.xxx` | `request.query.xxx` 的快捷路径。 |
| `body.xxx` | `request.body.xxx` 的快捷路径。 |
| `blocks['block_uuid'].inputs.xxx` | 某个已执行 block 的最终 inputs。 |
| `blocks['block_uuid'].outputs.xxx` | 某个已执行 block 的 outputs。 |
| `now` | 当前编排执行时间，ISO 字符串。 |

路径语法支持点号、字符串下标和数组下标：

```json
{
  "template": "{{blocks['read_user_block'].outputs.data.roles[0]}}"
}
```

## Block

通用 block 结构：

```json
{
  "uuid": "read_user_block",
  "alias": "读取用户",
  "functionName": "read",
  "inputs": {},
  "outputs": ["data"]
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `uuid` | `string` | 是 | - | Block 唯一标识，必须非空。后续模板用它读取 inputs/outputs。 |
| `alias` | `string` | 否 | - | 给人看的说明，不参与执行。 |
| `functionName` | `string` | 是 | - | Block 类型。当前支持 `list`、`page`、`count`、`read`、`delete`、`create`、`update`、`addSession`、`removeSession`、`readSession`、`saveJsonToR2`。 |
| `inputs` | `object` | 否 | `{}` | Block 输入。执行前会递归解析模板。 |
| `outputs` | `ProcessableKey[] \| null` | 否 | 不声明 | 输出声明。声明后会校验对应输出存在，并可对输出值执行 processors。 |

`outputs` 说明：

- `outputs` 可以是字符串数组，也可以使用 `{ "key": "...", "processors": [...] }`。
- `outputs` 省略或为 `null` 时，不做输出校验，但 block 产生的全部 outputs 仍会写入上下文。
- 标准 block 的输出 key 是固定的，不能随意命名。

标准 block 输出：

| Block | 固定 outputs |
| --- | --- |
| `list` | `datas` |
| `page` | `datas`、`total`、`totalPages`、`page`、`pageSize`、`hasPreviousPage`、`hasNextPage` |
| `count` | `total` |
| `read` | `data` |
| `delete` | `affected` |
| `create` | `uuid` |
| `update` | `affected` |
| `addSession` | 无 |
| `removeSession` | 无 |
| `readSession` | `value` |
| `saveJsonToR2` | `key`、`directory`、`fileName`、`bucket`、`size`、`etag` |

## 数据库 Block 公共规则

`list`、`page`、`count`、`read`、`delete`、`create`、`update` 都是数据库 block，必须配置 `inputs.datasource`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源名称，只能包含字母、数字、下划线，且不能以数字开头。执行器读取 `${datasource}_DATABASE_URL`。 |
| `table` | `string` | 是 | 数据库表名。可用点号表达 schema，例如 `public.users`。 |

数据库 URL 当前支持：

- `postgres://...`
- `postgresql://...`
- `mysql://...`

SQL 标识符规则：

- `table`、查询 `fields`、写入字段名、`conditions.fieldName`、`orderBy.fieldName` 都必须是非空字符串。
- 字段名必须是真实数据库字段名，不支持 alias。
- 标识符会通过 Drizzle `sql.identifier` 转义。
- 执行器不会检查字段是否存在；字段错误会由数据库报错暴露。

## Conditions

`list`、`page`、`count`、`read`、`delete`、`update` 支持 `conditions`。顶层 `conditions` 数组之间固定用 `AND` 连接。

普通条件：

```json
{
  "group": false,
  "conditionType": "EQ",
  "fieldName": "id",
  "fieldValue": {
    "template": "{{request.query.id}}"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | `false` | 是 | 普通条件固定为 `false`。 |
| `conditionType` | `GE \| GT \| LE \| LT \| NEQ \| EQ \| NOTIN \| IN` | 是 | 条件类型。 |
| `fieldName` | `string` | 是 | 数据库字段名。 |
| `fieldValue` | `unknown` | 是 | 比较值，允许使用模板。`IN` / `NOTIN` 必须是非空数组。 |

条件组：

```json
{
  "group": true,
  "groupType": "OR",
  "groups": [
    {
      "group": false,
      "conditionType": "EQ",
      "fieldName": "plan",
      "fieldValue": "free"
    },
    {
      "group": false,
      "conditionType": "EQ",
      "fieldName": "plan",
      "fieldValue": "pro"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | `true` | 是 | 条件组固定为 `true`。 |
| `groupType` | `AND \| OR` | 是 | 组内连接方式。 |
| `groups` | `Condition[]` | 是 | 至少一个子条件，可继续嵌套条件组。 |

条件类型：

| `conditionType` | SQL 行为 |
| --- | --- |
| `EQ` | `field = value` |
| `NEQ` | `field <> value` |
| `GT` | `field > value` |
| `GE` | `field >= value` |
| `LT` | `field < value` |
| `LE` | `field <= value` |
| `IN` | `field IN (...)` |
| `NOTIN` | `field NOT IN (...)` |

## orderBy

`list` 和 `page` 支持 `inputs.orderBy`：

```json
{
  "orderBy": [
    {
      "fieldName": "updated_at",
      "direction": "DESC"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `fieldName` | `string` | 是 | - | 排序字段。 |
| `direction` | `ASC \| DESC` | 否 | `ASC` | 排序方向，不区分大小写。 |

## 标准 Block Inputs

### list

查询多行数据，不分页。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `fields` | `string[]` | 是 | - | 查询字段，必须非空。 |
| `conditions` | `Condition[]` | 否 | 无 | 查询条件。 |
| `orderBy` | `OrderBy[]` | 否 | 无 | 排序。 |

输出：`{ "datas": object[] }`

### page

分页查询多行数据。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `fields` | `string[]` | 是 | - | 查询字段，必须非空。 |
| `conditions` | `Condition[]` | 否 | 无 | 查询条件。 |
| `orderBy` | `OrderBy[]` | 否 | 无 | 排序。 |
| `page` | `number \| string` | 否 | `1` | 页码，必须能转成正整数。 |
| `pageSize` | `number \| string` | 否 | `20` | 每页数量，必须能转成正整数。 |

输出：

```ts
{
  datas: object[]
  total: number
  totalPages: number
  page: number
  pageSize: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}
```

### count

统计记录数。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `conditions` | `Condition[]` | 否 | 无 | 统计条件。 |

输出：`{ "total": number }`

### read

读取第一条记录。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `fields` | `string[]` | 是 | - | 查询字段，必须非空。 |
| `conditions` | `Condition[]` | 否 | 无 | 查询条件。省略时读取表中第一条记录。 |

输出：`{ "data": object | null }`

### delete

删除记录。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `conditions` | `Condition[]` | 否 | 无 | 删除条件。省略时会删除整张表数据。 |

输出：`{ "affected": number }`

### create

插入一条记录。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `datasource` | `string` | 是 | 数据源。 |
| `table` | `string` | 是 | 表名。 |
| `idField` | `string` | 是 | 插入后返回的物理唯一 ID 字段。block 输出仍固定为 `uuid`。 |
| `fields` | `Record<string, unknown>` | 是 | 插入字段和值，必须是非空对象。 |

输出：`{ "uuid": string | number | bigint }`

值写入规则：

- `fields` 的 key 是真实数据库字段名。
- value 是对象或数组时，PostgreSQL 会按 `JSON.stringify(value)::jsonb` 写入，MySQL 会按 JSON 字符串写入。
- 其他 value 作为普通 SQL 参数写入。
- 唯一键冲突返回 `BLOCK_DUPLICATE_RECORD`。

### update

更新记录。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `datasource` | `string` | 是 | - | 数据源。 |
| `table` | `string` | 是 | - | 表名。 |
| `fields` | `Record<string, unknown>` | 是 | - | 更新字段和值，必须是非空对象。 |
| `conditions` | `Condition[]` | 否 | 无 | 更新条件。省略时会更新整张表数据。 |

输出：`{ "affected": number }`

### addSession

写入编排 session。Session 使用签名 Cookie `mokelay_orchestration_session` 保存。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | Session key，必须非空。 |
| `value` | `unknown` | 是 | 要写入的值，允许使用模板。 |

输出：`{}`

### removeSession

删除编排 session key。key 不存在也视为成功。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | Session key，必须非空。 |

输出：`{}`

### readSession

读取编排 session key。读取不到时返回 `value: null`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | Session key，必须非空。 |

输出：`{ "value": unknown | null }`

## Response

`response` 是成功响应 `data` 的模板对象：

```json
{
  "response": {
    "user": {
      "template": "{{blocks['read_user_block'].outputs.data}}"
    },
    "loggedIn": {
      "template": "{{blocks['read_session_block'].outputs.value}}",
      "processors": ["not_null"]
    }
  }
}
```

生成的成功响应：

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "..."
    },
    "loggedIn": true
  }
}
```

如果 `response` 省略或为 `null`：

```json
{
  "ok": true,
  "data": null
}
```

## 常见错误码

| 错误码 | 典型原因 |
| --- | --- |
| `API_JSON_UUID_INVALID` | 路径 UUID 为空或格式非法。 |
| `API_JSON_NOT_FOUND` | 找不到对应 API JSON 文件。 |
| `API_JSON_INVALID_JSON` | API JSON 文件不是合法 JSON。 |
| `API_JSON_INVALID_SCHEMA` | API JSON 不符合顶层结构或严格字段约束。 |
| `API_JSON_UUID_MISMATCH` | 顶层 `uuid` 与路径 UUID 不一致。 |
| `REQUEST_METHOD_MISMATCH` | 请求方法与 `method` 不一致。 |
| `REQUEST_PARAMETER_MISSING` | 字符串声明的 request 参数缺失。 |
| `REQUEST_INVALID_BODY` | body 不是合法 JSON。 |
| `TEMPLATE_VARIABLE_NOT_FOUND` | 模板路径不存在。 |
| `BLOCK_UNSUPPORTED_FUNCTION` | `functionName` 不受支持。 |
| `BLOCK_UNSUPPORTED_OUTPUT` | `outputs` 声明了该 block 不支持的输出 key。 |
| `BLOCK_OUTPUT_MISSING` | block 未产生声明的输出。 |
| `BLOCK_INVALID_DATASOURCE` | `datasource` 为空或格式非法。 |
| `BLOCK_DATASOURCE_URL_MISSING` | 缺少 `${datasource}_DATABASE_URL` 环境变量。 |
| `BLOCK_INVALID_TABLE` | `table` 不是非空字符串。 |
| `BLOCK_INVALID_FIELDS` | `fields` 结构无效。 |
| `BLOCK_INVALID_CONDITIONS` | `conditions` 结构无效。 |
| `BLOCK_INVALID_CONDITION_VALUE` | `IN` / `NOTIN` 的 `fieldValue` 不是非空数组。 |
| `BLOCK_INVALID_PAGE` | `page` 不是正整数。 |
| `BLOCK_INVALID_PAGE_SIZE` | `pageSize` 不是正整数。 |
| `BLOCK_R2_CONFIG_MISSING` | Cloudflare R2 写入配置缺失。 |
| `BLOCK_R2_DIRECTORY_INVALID` | `saveJsonToR2.inputs.directory` 非法。 |
| `BLOCK_R2_FILE_NAME_INVALID` | `saveJsonToR2.inputs.fileName` 非法。 |
| `BLOCK_R2_JSON_INVALID` | `saveJsonToR2.inputs.data` 不是合法 JSON。 |
| `BLOCK_R2_SAVE_FAILED` | 保存 JSON 到 Cloudflare R2 失败。 |
| `PROCESSOR_VALIDATION_FAILED` | processor 校验失败。 |
| `PROCESSOR_INVALID_CONFIG` | processor 参数配置错误。 |
| `PROCESSOR_UNSUPPORTED` | processor 名称不受支持。 |

## 配置建议

- `read`、`update`、`delete` 通常都应配置 `conditions`，避免误读、误改、误删整张表。
- request 参数用对象声明时，如需必填请加 `is_not_null`。
- `create.outputs` 固定写 `["uuid"]`，不要写物理字段名；物理唯一 ID 字段由 `inputs.idField` 指定。
- `update`、`delete` 只返回 `affected`。如果需要返回最新业务数据，请追加 `read` block。
- `response` 只拼装对前端有意义的数据，不建议直接透出数据库 block 的完整内部结构。
