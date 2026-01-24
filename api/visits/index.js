const { CosmosClient } = require('@azure/cosmos');
const admin = require('firebase-admin');
const path = require('path');

// Cosmos DB 配置
const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE || 'shrine-map';
const containerId = process.env.COSMOS_CONTAINER || 'user-visits';

let container = null;

// 初始化 Firebase Admin (仅初始化一次)
if (!admin.apps.length) {
  try {
    let serviceAccount;
    // 优先从环境变量读取 (用于生产环境)
    if (process.env.FIREBASE_ADMIN_CONFIG) {
      serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
      console.log('Firebase Admin initialized from environment variable');
    } else {
      // 本地开发回退到文件
      serviceAccount = require(path.join(__dirname, '..', 'firebase-admin-key.json'));
      console.log('Firebase Admin initialized from local key file');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
  }
}

/**
 * 初始化 Cosmos DB 连接
 */
async function getContainer() {
  if (container) return container;

  if (!endpoint || !key) {
    throw new Error('Cosmos DB 配置缺失');
  }

  const client = new CosmosClient({ endpoint, key });
  const database = client.database(databaseId);
  container = database.container(containerId);
  return container;
}

/**
 * 从 Authorization header 验证 Firebase token 并提取用户 ID
 */
async function getUserId(req, context) {
  // 不区分大小写获取 Authorization 头
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader) {
    context.log.warn('[Auth] Missing Authorization header');
    return { error: 'Missing Authorization header' };
  }

  // 使用正则表达式提取 Bearer token 值 (排除前缀)
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    context.log.warn('[Auth] Invalid Authorization format. Header content:', authHeader.substring(0, 20));
    return { error: 'Invalid Authorization format. Expected "Bearer <token>"' };
  }

  const token = match[1].trim();

  // 开发模式：直接使用 mock token
  if (token === 'mock-token') {
    context.log.info('[Auth] Using dev mock-token');
    return { userId: 'dev-user-123' };
  }

  if (token === 'null' || token === 'undefined' || !token) {
    context.log.warn('[Auth] Token value is invalid literal:', token);
    return { error: `Token value is invalid: ${token}` };
  }

  // 验证 Firebase ID token
  try {
    // 记录详细诊断信息以便锁定 Token 类型 (Access vs ID)
    const dotCount = (token.match(/\./g) || []).length;
    const diagInfo = `Length: ${token.length}, Dots: ${dotCount}, Prefix: "${token.substring(0, 10)}..."`;
    context.log.info(`[Auth] Verifying token. ${diagInfo}`);

    // 如果不是标准的 3 段式 JWT (ID Token 必须是 3 段)
    if (dotCount !== 2) {
      context.log.error(`[Auth] Token format error. ${diagInfo}`);
      return { error: `Invalid JWT format (${diagInfo}). Expected 3 segments.` };
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    context.log.info('[Auth] Token verified for user:', decodedToken.uid);
    return { userId: decodedToken.uid };
  } catch (e) {
    const diag = `Length: ${token.length}, Dots: ${(token.match(/\./g) || []).length}, Prefix: "${token.substring(0, 10)}..."`;
    context.log.error(`[Auth] Token verification FAILED: ${e.message} (${diag})`);
    return { error: `${e.message} (${diag})` };
  }
}

/**
 * GET /api/visits - 获取用户所有参拜记录
 */
async function getVisits(userId) {
  const container = await getContainer();

  const { resources } = await container.items
    .query({
      query: 'SELECT * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: userId }]
    })
    .fetchAll();

  return resources;
}

/**
 * POST /api/visits/{shrineId} - 添加参拜记录
 */
async function addVisit(userId, shrineId) {
  const container = await getContainer();

  const visit = {
    id: `visit_${userId}_${shrineId}`,
    userId,
    shrineId: parseInt(shrineId),
    visitedAt: new Date().toISOString()
  };

  await container.items.upsert(visit);
  return visit;
}

/**
 * DELETE /api/visits/{shrineId} - 删除参拜记录
 */
async function removeVisit(userId, shrineId) {
  const container = await getContainer();
  const id = `visit_${userId}_${shrineId}`;

  try {
    await container.item(id, userId).delete();
    return { success: true };
  } catch (e) {
    if (e.code === 404) {
      return { success: true }; // 已删除
    }
    throw e;
  }
}

/**
 * Azure Functions 入口
 */
module.exports = async function (context, req) {
  const { method } = req;
  const shrineId = context.bindingData.shrineId;

  // 验证用户身份
  const authResult = await getUserId(req, context);
  if (authResult.error) {
    context.res = {
      status: 401,
      body: {
        error: '未授权',
        message: authResult.error,
        debug: 'Authentication failed. Check browser network response for the message field.'
      }
    };
    return;
  }
  const userId = authResult.userId;

  try {
    let result;

    switch (method) {
      case 'GET':
        result = await getVisits(userId);
        context.log.info(`[API] Successfully fetched labels for ${userId}`);
        context.res = {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: result
        };
        break;

      case 'POST':
        if (!shrineId) {
          context.res = {
            status: 400,
            body: { error: '缺少 shrineId' }
          };
          return;
        }
        result = await addVisit(userId, shrineId);
        context.res = {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: result
        };
        break;

      case 'DELETE':
        if (!shrineId) {
          context.res = {
            status: 400,
            body: { error: '缺少 shrineId' }
          };
          return;
        }
        result = await removeVisit(userId, shrineId);
        context.res = {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: result
        };
        break;

      default:
        context.res = {
          status: 405,
          body: { error: '方法不允许' }
        };
    }
  } catch (error) {
    context.log.error('API 错误:', error);

    // 如果 Cosmos DB 未配置，返回友好提示
    if (error.message === 'Cosmos DB 配置缺失') {
      context.res = {
        status: 503,
        body: { error: '数据库未配置，请在 local.settings.json 中设置 COSMOS_ENDPOINT 和 COSMOS_KEY' }
      };
      return;
    }

    context.res = {
      status: 500,
      body: { error: '服务器错误' }
    };
  }
};
