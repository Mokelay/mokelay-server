# 登录注册 JSON API 接口文档

本文档覆盖 `server/assets/mokelay-apis` 下的 4 个认证相关 JSON API。运行时会先读取本地/Nitro assets，再读取 Cloudflare R2 的 `mokelay-apis/*.json`，最后兜底读取数据库中已发布的同名配置：

- `register.json`
- `login.json`
- `me.json`
- `logout.json`

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

## POST /api/mokelay/register

注册新用户。

对应配置：`server/assets/mokelay-apis/register.json`

### 请求

Content-Type：`application/json`

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 先 `trim`，长度 `1-120`。 |
| `email` | `string` | 是 | 先 `trim`，必须是合法 email，最大长度 `255`。 |
| `password` | `string` | 是 | 长度 `8-128`，必须包含字母和数字；保存前会执行 `hash_make`，不会明文入库。 |

请求示例：

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "  Alice  ",
    "email": "  alice@example.com  ",
    "password": "abc12345"
  }'
```

### 成功响应

注册成功后会创建用户、写入 session，并返回公开用户信息。

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "8cfe5c21-8d0b-4f3f-9c0f-280a4b20fd7a",
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

登录成功后会写入 session，并返回公开用户信息。

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "8cfe5c21-8d0b-4f3f-9c0f-280a4b20fd7a",
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
| 用户不存在 | `PROCESSOR_VALIDATION_FAILED` | 读取用户后 `is_not_null` 校验失败。 |
| 密码错误 | `PROCESSOR_VALIDATION_FAILED` | `hash_check` 校验失败。 |

## GET /api/mokelay/me

读取当前 session 中的用户信息。

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
