const { CosmosClient } = require('@azure/cosmos');
const admin = require('firebase-admin');
const path = require('path');

// 确保 globalThis.crypto 可用（Azure Functions Node.js 18+ 需要）
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = require('crypto');
  globalThis.crypto = webcrypto;
}

// Cosmos DB 配置
const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE || 'shrine-map';
const containerId = process.env.COSMOS_CONTAINER || 'user-visits';

let container = null;
let cosmosClient = null;

/**
 * 获取 Cosmos DB 容器（懒加载）
 */
async function getContainer() {
  if (container) return container;

  if (!endpoint || !key) {
    throw new Error('Cosmos DB 配置缺失');
  }

  if (!cosmosClient) {
    cosmosClient = new CosmosClient({ endpoint, key });
  }

  const database = cosmosClient.database(databaseId);
  container = database.container(containerId);
  return container;
}

// 记录 Firebase Admin 初始化状态
let firebaseInitStatus = 'not_started';
let firebaseInitError = null;

// 初始化 Firebase Admin (仅初始化一次)
if (!admin.apps.length) {
  try {
    let serviceAccount;
    const configStr = process.env.FIREBASE_ADMIN_CONFIG;

    console.log('Firebase Admin: FIREBASE_ADMIN_CONFIG exists:', !!configStr);
    console.log('Firebase Admin: FIREBASE_ADMIN_CONFIG length:', configStr ? configStr.length : 0);

    if (configStr) {
      // 尝试清理可能存在的转义字符或前后空格
      const sanitizedConfig = configStr.trim();
      try {
        serviceAccount = JSON.parse(sanitizedConfig);
        console.log('Firebase Admin: Successfully parsed config from env variable');
        console.log('Firebase Admin: project_id:', serviceAccount.project_id);
      } catch (parseError) {
        console.error('Firebase Admin: JSON parse failed, trying fallback string replacement...');
        // 应对某些环境中私钥中回车符被转义的问题
        const fixedConfig = sanitizedConfig.replace(/\\n/g, '\n');
        serviceAccount = JSON.parse(fixedConfig);
        console.log('Firebase Admin: Parsed with fallback, project_id:', serviceAccount.project_id);
      }
    } else {
      console.log('Firebase Admin: No env config, trying local file...');
      const keyPath = path.join(__dirname, '..', 'firebase-admin-key.json');
      serviceAccount = require(keyPath);
      console.log('Firebase Admin: Initialized from local path');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    firebaseInitStatus = 'success';
    console.log('Firebase Admin: Initialization SUCCESS');
  } catch (error) {
    firebaseInitStatus = 'error';
    firebaseInitError = error.message;
    console.error('Firebase Admin CRITICAL INITIALIZATION ERROR:', error.message);
  }
} else {
  firebaseInitStatus = 'already_initialized';
}

/**
 * 辅助函数：手动解码 JWT Header 以进行调试
 */
function decodeJWTHeader(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 1) return null;
    const header = Buffer.from(parts[0], 'base64').toString();
    return JSON.parse(header);
  } catch (e) {
    return { error: 'Failed to decode header', message: e.message };
  }
}

/**
 * 从 Authorization header 验证 Firebase token 并提取用户 ID
 */
async function getUserId(req, context) {
  // 优先使用 X-Firebase-Token（绕过 Azure SWA 的 Authorization header 干预）
  const firebaseToken = req.headers['x-firebase-token'];
  const authHeader = req.headers.authorization || req.headers.Authorization || '';

  let token;
  if (firebaseToken) {
    token = firebaseToken.trim();
    context.log.info('[Auth] Using X-Firebase-Token header');
  } else if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return { error: 'Invalid Authorization format. Use "Bearer <token>"' };
    }
    token = match[1].trim();
    context.log.info('[Auth] Using Authorization header (fallback)');
  } else {
    return { error: 'Missing authentication token. Provide X-Firebase-Token or Authorization header.' };
  }

  if (token === 'mock-token') return { userId: 'dev-user-123' };
  if (!token || token === 'null') return { error: 'Token is null or empty' };

  // 验证 Firebase ID token
  try {
    const dotCount = (token.match(/\./g) || []).length;
    const jwtHeader = decodeJWTHeader(token);
    const tokenPreview = token.substring(0, 80);
    const diag = `Length: ${token.length}, Segments: ${dotCount + 1}, Header: ${JSON.stringify(jwtHeader)}, Preview: ${tokenPreview}`;

    context.log.info(`[Auth] Verifying. ${diag}`);

    if (dotCount !== 2) {
      return { error: `Invalid JWT format. ${diag}. Expected 3 segments.` };
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    return { userId: decodedToken.uid };
  } catch (e) {
    // 捕获所有验证错误，并包含诊断信息
    const jwtHeader = decodeJWTHeader(token);
    const tokenPreview = token.substring(0, 80);
    const errorMsg = `${e.message} (JWT Header: ${JSON.stringify(jwtHeader)})`;
    context.log.error(`[Auth] Verification failed: ${errorMsg}`);
    return { error: errorMsg, tokenPreview };
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

  // CORS headers for cross-origin requests from Firebase Hosting
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firebase-Token',
    'Access-Control-Max-Age': '86400'
  };

  // Handle preflight OPTIONS request
  if (method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }

  // 验证用户身份
  const authResult = await getUserId(req, context);
  if (authResult.error) {
    context.res = {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        error: '未授权',
        message: authResult.error,
        debug: 'Authentication failed. Check browser network response for the message field.',
        firebaseInitStatus,
        firebaseInitError,
        hasFirebaseConfig: !!process.env.FIREBASE_ADMIN_CONFIG,
        configLength: process.env.FIREBASE_ADMIN_CONFIG ? process.env.FIREBASE_ADMIN_CONFIG.length : 0,
        receivedTokenPreview: authResult.tokenPreview || 'N/A'
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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: result
        };
        break;

      case 'POST':
        if (!shrineId) {
          context.res = {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: { error: '缺少 shrineId' }
          };
          return;
        }
        result = await addVisit(userId, shrineId);
        context.res = {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: result
        };
        break;

      case 'DELETE':
        if (!shrineId) {
          context.res = {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: { error: '缺少 shrineId' }
          };
          return;
        }
        result = await removeVisit(userId, shrineId);
        context.res = {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: result
        };
        break;

      default:
        context.res = {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: { error: '方法不允许' }
        };
    }
  } catch (error) {
    context.log.error('API 错误:', error);

    // 如果 Cosmos DB 未配置，返回友好提示
    if (error.message === 'Cosmos DB 配置缺失') {
      context.res = {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: {
          error: '数据库未配置',
          message: '请在 Azure 配置中设置 COSMOS_ENDPOINT 和 COSMOS_KEY',
          hasEndpoint: !!process.env.COSMOS_ENDPOINT,
          hasKey: !!process.env.COSMOS_KEY
        }
      };
      return;
    }

    context.res = {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        error: '服务器错误',
        message: error.message,
        code: error.code,
        hasCosmosEndpoint: !!process.env.COSMOS_ENDPOINT,
        hasCosmosKey: !!process.env.COSMOS_KEY,
        databaseId,
        containerId
      }
    };
  }
};
