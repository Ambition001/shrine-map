# 一之宮巡礼 - 项目架构文档

## 项目概述

一之宮巡礼是一个用于追踪日本一之宫神社参拜进度的 Web 应用。用户可以在地图上查看所有一之宫神社的位置，标记已参拜的神社，并追踪整体进度。

## 技术栈

### 前端
- **框架**: React 18
- **地图**: Mapbox GL JS
- **样式**: Tailwind CSS
- **图标**: Lucide React

### 部署架构 (Azure)
- **托管**: Azure Static Web Apps (免费层)
- **数据库**: Cosmos DB (免费层)
- **API**: Azure Functions (每月100万次免费调用)

### 成本
- 月成本: ¥0 (在免费额度内)
- 适用场景: 用户量 < 1000人

## 目录结构

```
shrine-map/
├── public/                  # 静态资源
├── src/
│   ├── App.js              # 主应用组件
│   ├── index.js            # 入口文件
│   ├── index.css           # 全局样式 (Tailwind)
│   ├── services/           # 服务层 (计划)
│   │   ├── auth.js         # 认证服务
│   │   └── visits.js       # 参拜记录 API
│   └── data/
│       └── shrines.json    # 神社数据 (105社)
├── api/                     # Azure Functions (计划)
│   ├── visits/             # 参拜记录接口
│   │   └── index.js
│   ├── host.json
│   └── local.settings.json # 本地环境变量
├── scripts/
│   └── scrape-shrines.py   # 数据爬虫脚本
├── package.json
├── tailwind.config.js
└── postcss.config.js
```

## 核心功能

### 1. 地图视图
- 使用 Mapbox GL JS 渲染日本地图
- 红色圆点 = 未参拜神社
- 绿色圆点 = 已参拜神社
- 点击圆点显示神社详情

### 2. 列表视图
- 所有神社的列表展示
- 显示神社名、旧国名、都道府县
- 可直接标记参拜状态

### 3. 数据持久化
- **当前**: localStorage (仅单设备)
- **计划**: Cosmos DB (多设备同步)

## 数据格式

### shrines.json
```json
{
  "id": 1,
  "name": "吉備津神社",
  "region": "中国",
  "reading": "きびつじんじゃ",
  "province": "備後国",
  "prefecture": "広島県",
  "address": "広島県福山市新市町宮内 400",
  "zip": "729-3104",
  "tel": "0847-51-3395",
  "deity": "大吉備津彦命",
  "virtue": "開運招福・交通安全・厄除け",
  "lat": 34.6706821,
  "lng": 133.8506113
}
```

### 必需字段
- `id`: 唯一标识符
- `name`: 神社名
- `prefecture`: 都道府县
- `province`: 旧国名
- `lat`, `lng`: 经纬度 (地图显示必需)

## 环境变量

```env
REACT_APP_MAPBOX_TOKEN=<your-mapbox-token>
```

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start

# 构建生产版本
npm run build

# 运行爬虫更新数据
python scripts/scrape-shrines.py
```

## 数据爬虫

`scripts/scrape-shrines.py` 从 ichinomiya-junpai.jp 抓取神社数据：

1. 获取所有神社详情页链接
2. 提取神社信息 (名称、地址、祭神等)
3. 使用 Nominatim API 进行地理编码获取经纬度
4. 保存到 `src/data/shrines.json`

**注意**:
- 部分神社经纬度可能不准确，需手动校正
- 没有经纬度的神社也会保存 (lat/lng 为 null)
- 地图只显示有经纬度的神社

## 用户系统架构 (计划)

### 认证方案
- **服务**: Azure AD B2C
- **登录方式**: 社交登录 (Google / Apple)
- **隐私**: 完全私有，用户只能看到自己的数据
- **免费额度**: 50,000 MAU (月活用户)

### 数据库设计 (Cosmos DB)

```
容器: user-visits
分区键: /userId

文档结构:
{
  "id": "visit_{userId}_{shrineId}",
  "userId": "google|123456789",
  "shrineId": 42,
  "visitedAt": "2025-01-18T10:30:00Z",
  "note": "御朱印もらった"  // 可选
}
```

### API 设计 (Azure Functions)

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/visits` | GET | 获取当前用户所有参拜记录 |
| `/api/visits/{shrineId}` | POST | 标记参拜 |
| `/api/visits/{shrineId}` | DELETE | 取消标记 |

所有接口需要认证 token，API 从 token 中提取 userId。

## 本地开发调试

### 分阶段策略

**第一阶段：Mock 模式**

本地开发时使用 mock 数据，不依赖云服务：

```javascript
// src/services/auth.js
const isDev = process.env.NODE_ENV === 'development';

export const getCurrentUser = () => {
  if (isDev) {
    return { id: 'dev-user-123', name: 'Dev User' };
  }
  // 真实 Azure AD B2C 逻辑
};

// src/services/visits.js
export const getVisits = async (userId) => {
  if (isDev) {
    return JSON.parse(localStorage.getItem('visits') || '[]');
  }
  // 真实 API 调用
};
```

**第二阶段：API 本地调试**

```bash
# 安装 Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# 本地运行 API
cd api && func start  # 端口 7071
```

数据库直连云端 Cosmos DB 免费层（开发流量极小，不产生费用）。

**第三阶段：认证集成**

Azure AD B2C 需在云端配置：
1. 创建 B2C 租户
2. 配置社交登录提供商 (Google/Apple)
3. 添加 `localhost:3000` 作为回调地址
4. 本地测试完整登录流程

### 环境变量

```env
# .env.development
REACT_APP_MAPBOX_TOKEN=<your-token>
REACT_APP_API_URL=http://localhost:7071/api
REACT_APP_AUTH_ENABLED=false  # Mock 模式

# .env.production
REACT_APP_MAPBOX_TOKEN=<your-token>
REACT_APP_API_URL=/api
REACT_APP_AUTH_ENABLED=true
```

## 未来规划

### 社区功能 (可选)
- 参拜记录分享
- 照片上传
- 评论/打卡

### 数据增强
- 神社照片
- 交通信息
- 御朱印信息
