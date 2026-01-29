const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { verifyToken } = require('@clerk/backend');
const { CosmosClient } = require('@azure/cosmos');

// Define secrets
const cosmosEndpoint = defineSecret('COSMOS_ENDPOINT');
const cosmosKey = defineSecret('COSMOS_KEY');
const clerkSecretKey = defineSecret('CLERK_SECRET_KEY');

// Cosmos DB configuration
let container = null;
let cosmosClient = null;

/**
 * Get Cosmos DB container (lazy initialization)
 */
async function getContainer(endpoint, key) {
  if (container) return container;

  const databaseId = process.env.COSMOS_DATABASE || 'shrine-map';
  const containerId = process.env.COSMOS_CONTAINER || 'user-visits';

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
async function verifyClerkToken(req, secretKey) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token) {
    return { error: 'Token is empty' };
  }

  // Development mode mock token
  if (token === 'mock-token') {
    return { userId: 'dev-user-123' };
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });
    return { userId: verifiedToken.sub };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * GET /visits - Get all visit records for a user
 */
async function getVisits(userId, endpoint, key) {
  const db = await getContainer(endpoint, key);

  const { resources } = await db.items
    .query({
      query: 'SELECT * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: userId }]
    })
    .fetchAll();

  return resources;
}

/**
 * POST /visits/{shrineId} - Add a visit record
 */
async function addVisit(userId, shrineId, endpoint, key) {
  const db = await getContainer(endpoint, key);

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
 * DELETE /visits/{shrineId} - Remove a visit record
 */
async function removeVisit(userId, shrineId, endpoint, key) {
  const db = await getContainer(endpoint, key);
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
 * Main API entry - Handle /api/visits and /api/visits/{shrineId}
 */
exports.visits = onRequest(
  {
    secrets: [cosmosEndpoint, cosmosKey, clerkSecretKey],
    maxInstances: 10  // Limit concurrent instances to cap costs
  },
  async (req, res) => {
    // Get secrets
    const endpoint = cosmosEndpoint.value();
    const key = cosmosKey.value();
    const clerkSecret = clerkSecretKey.value();

    // Verify user identity
    const authResult = await verifyClerkToken(req, clerkSecret);
    if (authResult.error) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: authResult.error
      });
    }
    const userId = authResult.userId;

    // Extract shrineId from URL path
    const pathParts = req.path.split('/').filter(Boolean);
    let shrineId = null;
    for (let i = pathParts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(pathParts[i])) {
        shrineId = pathParts[i];
        break;
      }
    }

    try {
      switch (req.method) {
        case 'GET':
          const visits = await getVisits(userId, endpoint, key);
          return res.status(200).json(visits);

        case 'POST':
          if (!shrineId) {
            return res.status(400).json({ error: 'Missing shrineId' });
          }
          const newVisit = await addVisit(userId, shrineId, endpoint, key);
          return res.status(201).json(newVisit);

        case 'DELETE':
          if (!shrineId) {
            return res.status(400).json({ error: 'Missing shrineId' });
          }
          const result = await removeVisit(userId, shrineId, endpoint, key);
          return res.status(200).json(result);

        default:
          return res.status(405).json({ error: 'Method not allowed' });
      }
    } catch (error) {
      if (error.message === 'Cosmos DB configuration missing') {
        return res.status(503).json({
          error: 'Database not configured',
          message: 'Please configure COSMOS_ENDPOINT and COSMOS_KEY environment variables'
        });
      }

      return res.status(500).json({
        error: 'Server error',
        message: error.message
      });
    }
  }
);
