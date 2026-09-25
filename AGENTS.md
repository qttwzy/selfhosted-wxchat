# 仓库指南

## 项目概述

**wxchat** — 自托管的微信风格文件传输与聊天 Web 应用。最初基于 Cloudflare Workers（Hono + D1 + R2）构建，后扩展了 Docker/Node.js 自托管路径，使用 SQLite 和本地文件存储。功能包括实时消息、文件传输（最大 100MB）、Markdown 渲染、跨设备同步、PWA 支持、多工作区管理、可选的 AI 聊天/图片生成，以及基于 JWT 的单密码认证。

许可证：CC BY-NC-SA 4.0。

## 架构与数据流

### 双目标部署

同一个 Hono 应用（`worker/app.js`）运行在两种后端上：

| | Cloudflare Workers | 自托管 (Node.js) |
|---|---|---|
| 入口 | `worker/index.js` | `server/index.js` |
| 数据库 | Cloudflare D1 | `node:sqlite`，通过 D1 兼容适配器 (`server/database.js`) |
| 文件存储 | Cloudflare R2 | 本地文件系统，通过 `LocalObjectStorage` (`server/storage.js`) |
| 静态文件 | `@cloudflare/kv-asset-handler` | 自定义中间件 (`server/static.js`) |
| HTTP | Workers 运行时 | `@hono/node-server` |
| 配置 | `wrangler.toml` | `.env` 通过 dotenv (`server/env.js`) |

### 请求生命周期

```
客户端 → HTTP → CORS 中间件
  → /api/auth/* (公开: login/verify/logout)
  → 认证中间件 (JWT Bearer token, Web Crypto HMAC-SHA256)
  → 路由处理器 (messages|files|search|workspaces|config|ai|sync|realtime)
    → 服务层 (MessageService|FileService|WorkspaceService|…)
      → DBService → SQLite/D1
  → 响应: { success, data|error }
```

### 实时通信

- **主通道**：SSE（`/api/events`）— 每 3 秒轮询数据库，每 15 秒心跳，25 秒超时
- **降级方案**：长轮询（`/api/poll`）— 每 1.5 秒轮询，最长 25 秒

### 前端

原生 JS SPA + PWA（无框架、无打包工具）。25+ 模块通过顺序 `<script>` 标签加载，使用 `?v=2.2.8` 缓存清除。全局单例对象（`CONFIG`、`API`、`Auth`、`UI`、`MessageHandler`、`RealtimeManager`、`WorkspaceManager`）。跨模块通信通过自定义 DOM 事件。状态存储在 `window.*` 全局变量中。

## 关键目录

| 路径 | 用途 |
|---|---|
| `server/` | 自托管 Node.js 入口 + 适配器（SQLite、文件系统、静态文件、环境变量） |
| `worker/` | 共享 Hono 应用、路由、服务、认证、中间件 |
| `worker/routes/` | API 路由处理器（消息、文件、搜索、工作区、配置、AI、同步、实时） |
| `worker/services/` | 业务逻辑（DBService、MessageService、FileService、WorkspaceService、DeviceService） |
| `worker/middleware/` | 错误处理器、参数校验 |
| `public/` | 前端 SPA — HTML、CSS、JS 模块、PWA 资源 |
| `public/js/` | 客户端模块（app、api、auth、config、ui、utils、realtime 等） |
| `public/js/components/` | UI 组件（functionMenu、functionButton） |
| `public/js/ai/` | AI 聊天模块（api、ui、handler） |
| `public/js/imageGen/` | 图片生成模块 |
| `public/js/search/` | 搜索模块（api、ui、handler） |
| `public/js/ui/` | UI 子模块（messageRenderer、markdownHandler、imageLoader） |
| `public/css/` | 样式表（variables、layout、messages、modals、input、mobile、auth-page、ai-chat、base） |
| `public/icons/` | PWA 图标（ios、android、windows11） |
| `database/` | SQLite 建表脚本（`schema.sql`） |
| `scripts/` | 工具脚本（时区同步） |
| `doc/` | 内部规划文档 |

## 开发命令

```bash
# 自托管本地开发（热加载，使用 .env）
npm run selfhost:dev

# 自托管生产环境
npm run selfhost:start   # NODE_ENV=production node server/index.js

# Cloudflare Workers 本地开发（wrangler 本地模拟）
npm run dev

# 部署到 Cloudflare Workers
npm run deploy

# 构建检查（仅验证文件是否存在，无打包）
npm run build

# 初始化 D1 数据库 (Cloudflare)
npm run db:init

# Docker
docker compose up -d          # 构建 + 启动
docker compose up --build -d  # 重新构建镜像

# 时区同步（将 TZ= 写入 .env）
bash scripts/sync-host-timezone.sh
```

## 代码规范与常见模式

### 格式化
- **缩进**：2 空格（JS/HTML/CSS），4 空格（SQL）— 由 `.editorconfig` 强制
- **换行符**：LF
- **模块系统**：ESM（package.json 中 `"type": "module"`），`import`/`export`
- **无打包/转译工具** — 代码原样发布

### 命名规范
- **文件名**：camelCase（`messageService.js`、`errorHandler.js`、`workspaceService.js`）
- **服务类**：PascalCase 类名（`MessageService`、`WorkspaceService`、`DBService`）
- **路由导出**：`export default` Hono router 实例
- **前端全局变量**：PascalCase 单例（`CONFIG`、`API`、`Auth`、`UI`、`MessageHandler`、`RealtimeManager`、`WorkspaceManager`）
- **数据库表名**：snake_case（`workspaces`、`messages`、`files`、`devices`）
- **API 响应格式**：`{ success: boolean, data?: any, error?: string }`

### 错误处理
- 所有路由处理器用 `try/catch` 包裹
- 业务错误设置 `error.status`（HTTP 状态码）
- `validateParams(c, requiredFields)` 对缺失字段抛出 400 错误
- 集中式 `errorHandler` 返回 `{ success: false, error }` JSON
- 生产环境隐藏堆栈跟踪（`NODE_ENV=production`）

### 异步模式
- 服务层为无状态单例，使用静态方法
- 数据库操作：`await`（D1 API）或同步（`DatabaseSync`，自托管）
- `c.executionCtx.waitUntil()` 在自托管环境下被 shim 为 Promise
- AI 代理使用 `fetch()` 调用上游 OpenAI 兼容 API，支持流式响应

### 工作区作用域
- 几乎所有操作都限定在工作区范围内
- 工作区 ID 从 `X-Workspace-Id` 请求头或 `workspaceId` 查询参数解析
- 回退到 `'default'` 工作区
- 删除工作区时级联删除关联数据

### 认证
- 自定义 JWT：Web Crypto HMAC-SHA256（无外部依赖）
- 密码：明文比对 `ACCESS_PASSWORD` 环境变量
- 客户端 Token 存储在 `localStorage`（`wxchat_auth_token`）
- 速率限制：5 次失败 → 锁定 15 分钟（在 localStorage 中跟踪）

### 前端模式
- 无框架 — 命令式 DOM 操作
- 通过 `UI.messageCache`（`Map<id, DOMElement>`）实现增量渲染
- 跨模块事件：`workspace:changed`、`functionMenu:itemClick`、`beforeMessageSend`
- 图片 blob URL 缓存：`API.imageBlobUrlCache`
- 离线消息队列：`MessageHandler.sendQueue`（localStorage）

## 重要文件

| 文件 | 职责 |
|---|---|
| `server/index.js` | 自托管入口 |
| `worker/index.js` | Cloudflare Workers 入口 |
| `worker/app.js` | 共享 Hono 应用工厂（注册所有路由/中间件） |
| `worker/auth.js` | JWT 认证（签名、验证、中间件、登录/登出路由） |
| `worker/services/messageService.js` | 消息 CRUD + 轮询 |
| `worker/services/workspaceService.js` | 工作区 CRUD + schema 自动迁移 |
| `worker/services/fileService.js` | 文件上传/下载，R2 抽象层 |
| `worker/services/database.js` | DBService — 统一 SQL 封装 |
| `server/database.js` | SQLite → D1 兼容适配器 |
| `server/storage.js` | 本地文件系统 → R2 兼容适配器 |
| `server/env.js` | 环境变量加载器（.env 解析、校验） |
| `server/static.js` | 自托管静态文件中间件 |
| `public/js/app.js` | 前端编排器（`WeChatApp` 类） |
| `public/js/api.js` | REST API 客户端 |
| `public/js/messageHandler.js` | 消息发送/加载/队列核心逻辑 |
| `public/js/realtime.js` | SSE + 长轮询管理器 |
| `public/js/config.js` | 客户端配置单例（合并服务端 `/api/config`） |
| `database/schema.sql` | SQLite 建表脚本（4 张表：workspaces、messages、files、devices） |
| `build.js` | 文件存在性校验（无打包） |
| `wrangler.toml` | Cloudflare Workers 配置（D1、R2 绑定） |
| `.env.example` | 环境变量模板 |
| `Dockerfile` | Node 24 slim 生产镜像 |
| `docker-compose.yml` | 单服务编排，带卷挂载 |

## 运行时 / 工具链

- **运行时**：Node.js 24（自托管）或 Cloudflare Workers（边缘）
- **包管理器**：npm
- **框架**：Hono v4（两个目标共用）
- **无打包器、转译器或压缩器** — 原生 ESM + 原生 JS/HTML/CSS
- **无 TypeScript** — 全部为纯 JavaScript
- **无 linter 配置**（未找到 eslint/prettier/biome 配置）
- **编辑器配置**：`.editorconfig` 强制 2 空格缩进、LF、UTF-8

## 测试与质量保证

**无测试套件。** 仓库中未找到测试文件、测试框架或测试脚本。验证方式为手动测试：

- 自托管：`npm run selfhost:dev` → 打开 `http://localhost:3000`
- Docker：`docker compose up` → 健康检查 `/login.html`
- CF Workers：`npm run dev` → wrangler 本地模拟
- 构建检查：`npm run build` 仅验证文件存在性

## 数据库表结构

`database/schema.sql` 中定义了 4 张表：

- **workspaces** — `id`、`name`、`slug`（UNIQUE）、`color`、`sort_order`、`is_default`
- **messages** — `id`、`workspace_id`（FK）、`type`（text|file）、`content`、`file_id`（FK）、`device_id`、`device_info`（JSON）、`status`（sending|sent|failed|read）、`read_by`（JSON）、`timestamp`
- **files** — `id`、`workspace_id`（FK）、`original_name`、`file_name`、`file_size`、`mime_type`、`r2_key`（UNIQUE）、`upload_device_id`、`download_count`
- **devices** — `id`、`workspace_id`、`name`、`last_active`

服务层使用惰性 `ensureSchema()` 实现自动迁移（首次访问时创建表/添加列）。

## Issue 驱动开发

- 本仓对应 Plane 项目 `WX`，仓内 `#N` 即 `WX-N`。开工前必须有工作项编号；没有就先要，或用 `idd new` 建。
- 分支 `<type>/N-<slug>`；提交首行 Conventional Commits，trailer `Refs: #N`。完整规则见 personal-ops `policies/issue-driven-development.md`。
- 提交和 PR 里禁止 `closes/fixes/resolves #N`；完成状态按统一政策核验合入证据后回写。
- 完成后回报改动文件路径和提交号；未经允许不用 `--no-verify`，不直接提交到主干。
