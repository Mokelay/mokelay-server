# AI DSL 生成接口

`POST /api/mokelay/ai-generate-dsl` 用一个内置 API DSL 调用通用 `openAI` block，根据需求文档生成页面 DSL、接口 DSL 和能力升级计划。接口本身不新增定制路由代码，运行时仍走 `GET|POST /api/mokelay/{API_JSON_UUID}` 编排机制。

## 目标

- 输入产品需求文档，输出可保存的 Mokelay 页面 DSL 和服务端 API DSL。
- 能用现有 Block、Action、Processor、Control 和组件表达的需求，直接生成 DSL。
- 不能直接表达的需求，输出 `upgradePlan`，用于升级 Processor、服务端 Block、客户端 Action、Control 或新增页面组件。
- 不输出定制化前端代码、后端代码、脚本、函数源码或伪代码。

## 请求

```json
{
  "requirementDocument": "客户管理：需要客户列表、创建客户、删除客户，删除前需要确认。",
  "projectContext": {
    "app": "crm",
    "datasource": "Mokelay"
  },
  "dslContext": {
    "preferredBlocks": ["MAdvanceTable", "MForm", "MButton"],
    "preferredApiBlocks": ["page", "create", "delete"]
  },
  "generationPreferences": {
    "language": "zh-CN"
  }
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `requirementDocument` | 是 | 需求文档，服务端会 `trim`，长度必须在 10 到 50000 之间。 |
| `projectContext` | 否 | 项目、数据源、命名、权限等上下文。 |
| `dslContext` | 否 | 调用方补充的最新 DSL 规范、可用组件、可用能力或偏好。 |
| `generationPreferences` | 否 | 语言、命名风格、页面/API 数量等生成偏好。 |

## 响应

成功响应仍包在 Mokelay 标准结构中：

```json
{
  "ok": true,
  "data": {
    "version": 2,
    "status": "complete",
    "summary": "生成客户列表页、创建客户页及对应接口 DSL。",
    "pages": [],
    "apis": [],
    "upgradePlan": {
      "processors": [],
      "blocks": [],
      "actions": [],
      "controls": [],
      "components": []
    },
    "traceability": [],
    "assumptions": [],
    "warnings": []
  }
}
```

`data` 字段固定结构：

| 字段 | 说明 |
| --- | --- |
| `version` | 输出契约版本，当前为 `2`。 |
| `status` | `complete` 表示全部可由现有 DSL 表达；`partial` 表示至少有一项需要能力升级。 |
| `pages` | 页面 DSL 数组，每项至少包含 `uuid`、`subPage`、`quotes`、`dependencies`、`name`、`blocks`、`apiDependencies`、`notes`；`uuid` 是 1–128 位小写 Slug（仅 `a-z`、`0-9`、`_`、`-`），三个关系字段由服务端按实际嵌入关系重新计算。 |
| `apis` | 服务端 API DSL 数组，每项是完整 `ApiJson`，可保存到 API Builder 或 `mokelay-apis/*.json`；API `uuid` 仍使用可读字符串并与路径末尾一致。 |
| `upgradePlan` | 无法直接表达的能力升级规格，按 `processors`、`blocks`、`actions`、`controls`、`components` 分类。 |
| `traceability` | 需求点到生成结果或升级项的映射。 |
| `assumptions` | 生成时作出的假设。 |
| `warnings` | 需要人工确认的风险或缺失信息。 |

页面关系数组只记录直接引用并按 UUID 字典序排列。`MTabs.tabs[].pageUUID` 和 `open_dialog.inputs.pageUUID` 会建立依赖；`jump_url` 仅导航，不建立依赖。页面目标和 `pageSource` 必须是字面量，不能使用模板或对象形式的动态值。

页面标识在保存前统一执行 `trim → lowercase → Slug 校验`。同名用户页面以及与系统页面同名的页面都会返回 `409 / BLOCK_DUPLICATE_RECORD`，不会自动追加后缀。

## 升级计划

当需求需要现有 DSL 不支持的能力时，接口不会伪造可运行 DSL，而是输出结构化升级项。

示例：

```json
{
  "upgradePlan": {
    "processors": [],
    "blocks": [],
    "actions": [
      {
        "action": "export_file",
        "reason": "现有 Action 没有文件导出和下载语义。",
        "inputsSchema": {
          "dsConfig": "object",
          "fileName": "string"
        },
        "outputs": ["fileUrl"],
        "behavior": "执行数据源并触发文件下载。",
        "dslExample": {
          "uuid": "export_customers",
          "action": "export_file",
          "inputs": {}
        }
      }
    ],
    "controls": [],
    "components": []
  }
}
```

只要 `upgradePlan` 任一分类非空，`status` 必须是 `partial`。

## 编排实现

接口文件位于 `server/assets/mokelay-apis/ai-generate-dsl.json`，核心流程只有：

1. `starter`
2. `openai_generate_dsl_block`：调用通用 `openAI` block。
3. `responses.openai_generate_dsl_block`：直接返回模型生成的 JSON object。

因此该接口符合“全部以 DSL 形式生成”的约束；新增能力时也应该优先扩展 DSL 注册表，而不是在该接口内写业务定制代码。
