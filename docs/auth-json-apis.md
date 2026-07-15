# 登录注册 JSON API 接口文档

本文档覆盖 `server/assets/mokelay-apis` 下的 4 个认证相关 JSON API。系统认证 API 优先从本地/Nitro assets 读取；动态普通 API 的 R2 内容受数据库当前元数据保护，动态 Fragment 则只从数据库已发布记录读取：

- `register.json`
- `login.json`
- `me.json`
- `logout.json`
- `oauth_google_start.json`
- `oauth_google_callback.json`
- `oauth_github_start.json`
- `oauth_github_callback.json`

这些接口统一通过 Mokelay 编排路由暴露：

```text
/api/mokelay/{uuid}
```

成功响应统一格式：

```json
{
  "ok": true,
  "data": {}
}
```

失败响应统一格式：

```json
{
  "ok": false,
  "error": {
    "code": "PROCESSOR_VALIDATION_FAILED",
    "message": "..."
  }
}
```

登录态使用内部编排 session Cookie：`mokelay_orchestration_session`。注册、登录成功后会写入 `user`；退出登录会移除 `user` 并清理 Cookie。

第三方注册/登录也使用同一个 session Cookie。OAuth start/callback 均为 DSL API，并通过 DSL `responses.redirect` 返回 HTTP 302。

## OAuth 配置

服务端需要配置：

```env
OAUTH_CALLBACK_BASE_URL=https://api.mokelay.com
OAUTH_APP_BASE_URL=https://www.mokelay.com
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_GITHUB_CLIENT_ID=...
OAUTH_GITHUB_CLIENT_SECRET=...
```

Provider callback URL：

| Provider | Callback URL |
| --- | --- |
| Google | `https://api.mokelay.com/api/mokelay/oauth_google_callback` |
| GitHub | `https://api.mokelay.com/api/mokelay/oauth_github_callback` |

本地开发可使用：

| Provider | Callback URL |
| --- | --- |
| Google | `http://127.0.0.1:8787/api/mokelay/oauth_google_callback` |
| GitHub | `http://127.0.0.1:8787/api/mokelay/oauth_github_callback` |

## GET /api/mokelay/oauth_google_start

生成 Google OAuth 授权地址并返回 302。

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `redirect` | query | `string` | 否 | 登录成功后的站内相对路径，默认 `/dashboard`。 |

## GET /api/mokelay/oauth_github_start

生成 GitHub OAuth 授权地址并返回 302。

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `redirect` | query | `string` | 否 | 登录成功后的站内相对路径，默认 `/dashboard`。 |

## GET /api/mokelay/oauth_google_callback

处理 Google OAuth callback。已有 identity 或相同邮箱时维持原登录/绑定流程；全新账号通过内置 `provision_new_user` Fragment 创建企业、员工和免费数据源，再绑定 Google identity、写入 session，并 302 跳转到 start 阶段保存的 `redirect`。

## GET /api/mokelay/oauth_github_callback

处理 GitHub OAuth callback。已有 identity 或相同邮箱时维持原登录/绑定流程；全新账号通过内置 `provision_new_user` Fragment 创建企业、员工和免费数据源，再绑定 GitHub identity、写入 session，并 302 跳转到 start 阶段保存的 `redirect`。

OAuth callback 失败时会跳转：

```text
/login?oauth_error={code}
```

其中公共开户 Fragment 失败使用 `registration_failed`，OAuth identity 绑定失败使用 `identity_link_failed`，Session 写入失败使用 `session_failed`。这些错误终点使用静态跳转地址，不读取失败 Block 未产生的 outputs。

## POST /api/mokelay/register

注册新企业，并通过 `server/assets/mokelay-apis/fragment/provision_new_user.json` 内置 Fragment 创建首个员工、免费 schema 和 datasource。密码注册仍在入口 API 完成邮箱查重和密码 hash，Fragment 只负责公共开户流程。该内置 caller 不会解析同 UUID 的数据库 Fragment。

对应配置：`server/assets/mokelay-apis/register.json`

### 请求

Content-Type：`application/json`

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `enterprise_name` | `string` | 是 | 先 `trim`，长度 `1-120`。 |
| `name` | `string` | 是 | 先 `trim`，长度 `1-120`。 |
| `email` | `string` | 是 | 先 `trim`，必须是合法 email，最大长度 `255`。 |
| `password` | `string` | 是 | 长度 `8-128`，必须包含字母和数字；保存前会执行 `hash_make`，不会明文入库。 |

请求示例：

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/register \
  -H "Content-Type: application/json" \
  -d '{
    "enterprise_name": "Acme Inc.",
    "name": "  Alice  ",
    "email": "  alice@example.com  ",
    "password": "abc12345"
  }'
```

### 成功响应

注册成功后会创建企业和员工、写入 session，并返回公开员工信息。

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "8cfe5c21-8d0b-4f3f-9c0f-280a4b20fd7a",
      "enterprise_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "enterprise_name": "Acme Inc.",
      "name": "Alice",
      "email": "alice@example.com",
      "plan": "free"
    }
  }
}
```

响应会设置：

```text
Set-Cookie: mokelay_orchestration_session=...
```

### 常见失败

| 场景 | 错误码 | 说明 |
| --- | --- | --- |
| enterprise_name 为空 | `REQUEST_PARAMETER_MISSING` 或 `PROCESSOR_VALIDATION_FAILED` | 企业名称必填。 |
| email 格式非法 | `PROCESSOR_VALIDATION_FAILED` | `email_check` 校验失败。 |
| password 少于 8 位 | `PROCESSOR_VALIDATION_FAILED` | `min` 校验失败。 |
| password 缺少字母 | `PROCESSOR_VALIDATION_FAILED` | 字母正则校验失败。 |
| password 缺少数字 | `PROCESSOR_VALIDATION_FAILED` | 数字正则校验失败。 |
| email 已存在 | `PROCESSOR_VALIDATION_FAILED` | 重复邮箱检查要求计数等于 `0`。 |

## POST /api/mokelay/login

使用 email 和 password 登录。

对应配置：`server/assets/mokelay-apis/login.json`

### 请求

Content-Type：`application/json`

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `email` | `string` | 是 | 先 `trim`，必须是合法 email，最大长度 `255`。 |
| `password` | `string` | 是 | 不能为空，最小长度 `1`。 |

请求示例：

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "abc12345"
  }'
```

### 成功响应

登录成功后会读取员工所属企业、写入 session，并返回公开员工信息。

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "8cfe5c21-8d0b-4f3f-9c0f-280a4b20fd7a",
      "enterprise_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "enterprise_name": "Acme Inc.",
      "name": "Alice",
      "email": "alice@example.com",
      "plan": "free"
    }
  }
}
```

响应会设置：

```text
Set-Cookie: mokelay_orchestration_session=...
```

### 常见失败

| 场景 | 错误码 | 说明 |
| --- | --- | --- |
| email 格式非法 | `PROCESSOR_VALIDATION_FAILED` | `email_check` 校验失败。 |
| 员工不存在 | `PROCESSOR_VALIDATION_FAILED` | 读取员工后 `is_not_null` 校验失败。 |
| 密码错误 | `PROCESSOR_VALIDATION_FAILED` | `hash_check` 校验失败。 |

## GET /api/mokelay/me

读取当前 session 中的员工信息。

对应配置：`server/assets/mokelay-apis/me.json`

### 请求

不需要 body。已登录时带上浏览器自动保存的 Cookie，或手动传入：

```bash
curl http://127.0.0.1:8787/api/mokelay/me \
  -H "Cookie: mokelay_orchestration_session=..."
```

### 成功响应：未登录

`readSession` 读取不到 `user` 时返回 `null`，`loggedIn` 由 `user !== null` 推导。

```json
{
  "ok": true,
  "data": {
    "loggedIn": false,
    "user": null
  }
}
```

### 成功响应：已登录

```json
{
  "ok": true,
  "data": {
    "loggedIn": true,
    "user": {
      "id": "8cfe5c21-8d0b-4f3f-9c0f-280a4b20fd7a",
      "enterprise_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "enterprise_name": "Acme Inc.",
      "name": "Alice",
      "email": "alice@example.com",
      "plan": "free"
    }
  }
}
```

## POST /api/mokelay/logout

退出登录，移除内部 session 中的 `user`。

对应配置：`server/assets/mokelay-apis/logout.json`

### 请求

不需要 body。调用时带上当前登录 Cookie：

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/logout \
  -H "Cookie: mokelay_orchestration_session=..."
```

### 成功响应

```json
{
  "ok": true,
  "data": {
    "ok": true
  }
}
```

响应会清理：

```text
Set-Cookie: mokelay_orchestration_session=; Max-Age=0; ...
```

## 调用顺序示例

1. 调用 `POST /api/mokelay/register` 或 `POST /api/mokelay/login`。
2. 保存响应中的 `mokelay_orchestration_session` Cookie。
3. 调用 `GET /api/mokelay/me` 获取当前用户。
4. 调用 `POST /api/mokelay/logout` 退出登录。
5. 再调用 `GET /api/mokelay/me` 会返回 `loggedIn: false` 和 `user: null`。
