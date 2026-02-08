# SuperTokens 迁移完成指南

## 已完成的代码修改

### 前端 (src/)
- ✅ `package.json` - 移除 Clerk，添加 SuperTokens 依赖
- ✅ `src/index.js` - SuperTokens 初始化
- ✅ `src/App.js` - 替换 ClerkBridge 为 AuthBridge
- ✅ `src/services/auth.js` - 完全重写为 SuperTokens API
- ✅ `src/services/visits.js` - 使用 cookie-based 认证

### 后端 (api/)
- ✅ `api/package.json` - 移除 @clerk/backend，添加 supertokens-node
- ✅ `api/supertokens.js` - 新建 SuperTokens 配置
- ✅ `api/auth/function.json` - 新建认证端点配置
- ✅ `api/auth/index.js` - 新建认证端点处理器
- ✅ `api/visits/index.js` - 替换 Clerk token 验证为 SuperTokens session

---

## 需要手动执行的步骤

### 1. 安装依赖

```bash
# 前端
cd /Users/ambition/shrine-map
npm install

# 后端
cd /Users/ambition/shrine-map/api
npm install
```

### 2. 配置 Google OAuth

SuperTokens 需要 Google OAuth 凭据。你可能已经有了（从 Clerk 配置），确认以下信息：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. 找到你的 OAuth 2.0 客户端 ID
3. 确保已添加以下授权重定向 URI：
   - `https://ichinomiyamap.com/auth/callback/google`
   - `http://localhost:3000/auth/callback/google` (开发环境)

### 3. 配置 Azure Functions 环境变量

在 Azure Portal 中，前往你的 Static Web App → 配置 → 应用程序设置，添加/更新以下环境变量：

**移除（可选，不影响运行）：**
- `CLERK_SECRET_KEY`

**添加：**
```
SUPERTOKENS_CONNECTION_URI=https://supertokens-core.blueplant-7381350f.japaneast.azurecontainerapps.io
SUPERTOKENS_API_KEY=lrGhKigAT0NW5Q3OlmqQo6LygZ3rxpUa
GOOGLE_CLIENT_ID=<你的 Google OAuth Client ID>
GOOGLE_CLIENT_SECRET=<你的 Google OAuth Client Secret>
API_DOMAIN=https://ichinomiyamap.com
WEBSITE_DOMAIN=https://ichinomiyamap.com
```

### 4. 本地开发环境配置

创建或更新 `.env` 文件：

```bash
# 前端 .env
REACT_APP_API_URL=http://localhost:7071/api
REACT_APP_AUTH_ENABLED=true

# 后端 api/local.settings.json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "COSMOS_ENDPOINT": "<你的 Cosmos DB endpoint>",
    "COSMOS_KEY": "<你的 Cosmos DB key>",
    "SUPERTOKENS_CONNECTION_URI": "https://supertokens-core.blueplant-7381350f.japaneast.azurecontainerapps.io",
    "SUPERTOKENS_API_KEY": "lrGhKigAT0NW5Q3OlmqQo6LygZ3rxpUa",
    "GOOGLE_CLIENT_ID": "<你的 Google OAuth Client ID>",
    "GOOGLE_CLIENT_SECRET": "<你的 Google OAuth Client Secret>",
    "API_DOMAIN": "http://localhost:7071",
    "WEBSITE_DOMAIN": "http://localhost:3000"
  }
}
```

### 5. 部署

```bash
# 确保所有代码都已提交
git add .
git commit -m "feat: migrate authentication from Clerk to SuperTokens"
git push
```

Azure Static Web Apps 会自动部署。

---

## 验证步骤

### 1. SuperTokens Core 健康检查
```bash
curl https://supertokens-core.blueplant-7381350f.japaneast.azurecontainerapps.io/hello
# 应返回 "Hello"
```

### 2. 本地测试
```bash
# 启动后端
cd api && func start

# 另一个终端启动前端
cd .. && npm start
```

### 3. 登录流程测试
1. 访问应用
2. 点击 Google 登录按钮
3. 完成 Google OAuth 授权
4. 确认返回应用后显示已登录状态

### 4. Session 持久性测试
1. 登录后关闭浏览器
2. 重新打开浏览器访问应用
3. 确认仍是登录状态（应该保持登录）

### 5. API 调用测试
1. 标记一个神社为"已参拜"
2. 刷新页面
3. 确认标记仍然存在

---

## 数据迁移说明

**重要：** 用户 ID 格式发生变化：
- Clerk: `user_2abc123...`
- SuperTokens: `uuid-format` (如 `550e8400-e29b-41d4-a716-446655440000`)

这意味着：
- 现有用户的参拜记录（存储在 Cosmos DB）将与新的 SuperTokens 用户 ID 不匹配
- 新用户登录后会获得新的 SuperTokens 用户 ID
- 老用户的历史数据仍保留在数据库中，但不会显示

**如需迁移历史数据，可以：**
1. 让老用户联系你提供他们的邮箱
2. 在 Cosmos DB 中查找对应的 Clerk 用户 ID 的记录
3. 手动更新这些记录的 userId 为新的 SuperTokens 用户 ID

---

## 回滚方案

如果需要回滚到 Clerk：
1. `git revert` 本次提交
2. 恢复 Azure 环境变量
3. 重新部署

---

## 参考资料

- [SuperTokens 文档](https://supertokens.com/docs)
- [SuperTokens ThirdParty Recipe](https://supertokens.com/docs/thirdparty/introduction)
- [Azure Functions 配置](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-use-azure-function-app-settings)
