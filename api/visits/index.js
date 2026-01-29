const { CosmosClient } = require('@azure/cosmos');
const { verifyToken } = require('@clerk/backend');

// Cosmos DB configuration
const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE || 'shrine-map';
const containerId = process.env.COSMOS_CONTAINER || 'user-visits';

let container = null;
let cosmosClient = null;

/**
 * Get Cosmos DB container (lazy initialization)
 */
async function getContainer() {
  if (container) return container;

  if (!endpoint || !key) {
    throw new Error('Cosmos DB configuration missing');
  }

  if (!cosmosClient) {
    cosmosClient = new CosmosClient({ endpoint, key });
  }

  const database = cosmosClient.database(databaseId);
  container = database.container(containerId);
  return container;
}

/**
 * Verify Clerk JWT Token
 */
async function verifyClerkToken(req, context) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token || token === 'null') {
    return { error: 'Token is empty' };
  }

  // Development mode mock token
  if (token === 'mock-token') {
    return { userId: 'dev-user-123' };
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    context.log.error('[Auth] CLERK_SECRET_KEY not configured');
    return { error: 'Server authentication not configured' };
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });
    context.log.info(`[Auth] Token verified for user: ${verifiedToken.sub}`);
    return { userId: verifiedToken.sub };
  } catch (error) {
    context.log.error(`[Auth] Token verification failed: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * GET /api/visits - Get all visit records for a user
 */
async function getVisits(userId) {
  const db = await getContainer();

  const { resources } = await db.items
    .query({
      query: 'SELECT * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: userId }]
    })
    .fetchAll();

  return resources;
}

/**
 * POST /api/visits/{shrineId} - Add a visit record
 */
async function addVisit(userId, shrineId) {
  const db = await getContainer();

  const visit = {
    id: `visit_${userId}_${shrineId}`,
    userId,
    shrineId: parseInt(shrineId),
    visitedAt: new Date().toISOString()
  };

  await db.items.upsert(visit);
  return visit;
}

/**
 * DELETE /api/visits/{shrineId} - Remove a visit record
 */
async function removeVisit(userId, shrineId) {
  const db = await getContainer();
  const id = `visit_${userId}_${shrineId}`;

  try {
    await db.item(id, userId).delete();
    return { success: true };
  } catch (e) {
    if (e.code === 404) {
      return { success: true }; // Already deleted
    }
    throw e;
  }
}

/**
 * Azure Functions entry point
 */
module.exports = async function (context, req) {
  const { method } = req;
  const shrineId = context.bindingData.shrineId;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  // Verify user identity
  const authResult = await verifyClerkToken(req, context);
  if (authResult.error) {
    context.res = {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        error: 'Unauthorized',
        message: authResult.error
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
        context.log.info(`[API] Fetched visits for user: ${userId}`);
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
            body: { error: 'Missing shrineId' }
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
            body: { error: 'Missing shrineId' }
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
          body: { error: 'Method not allowed' }
        };
    }
  } catch (error) {
    context.log.error('API Error:', error);

    if (error.message === 'Cosmos DB configuration missing') {
      context.res = {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: {
          error: 'Database not configured',
          message: 'Please configure COSMOS_ENDPOINT and COSMOS_KEY'
        }
      };
      return;
    }

    context.res = {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: {
        error: 'Server error',
        message: error.message
      }
    };
  }
};
