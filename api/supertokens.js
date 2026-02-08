/**
 * SuperTokens Configuration for Azure Functions
 */
const supertokens = require('supertokens-node');
const Session = require('supertokens-node/recipe/session');
const ThirdParty = require('supertokens-node/recipe/thirdparty');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Initialize SuperTokens (call this once at app startup)
let isInitialized = false;

// JWKS client for manual JWT verification
// Uses the confirmed working endpoint
const jwksUri = process.env.SUPERTOKENS_CONNECTION_URI
  ? `${process.env.SUPERTOKENS_CONNECTION_URI}/.well-known/jwks.json`
  : 'https://supertokens-core.blueplant-7381350f.japaneast.azurecontainerapps.io/.well-known/jwks.json';

const client = jwksClient({
  jwksUri,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000 // 10 minutes
});

/**
 * Decode JWT header to get kid
 */
function decodeJwtHeader(token) {
  try {
    const headerPart = token.split('.')[0];
    const headerJson = Buffer.from(headerPart, 'base64url').toString('utf8');
    return JSON.parse(headerJson);
  } catch {
    // Fallback for environments without base64url support
    const headerPart = token.split('.')[0];
    const headerJson = Buffer.from(headerPart, 'base64').toString('utf8');
    return JSON.parse(headerJson);
  }
}

/**
 * Verify JWT access token using JWKS
 */
async function verifyAccessToken(accessToken) {
  // First, decode the header to get the kid
  const header = decodeJwtHeader(accessToken);
  const kid = header.kid;

  if (!kid) {
    throw new Error('No kid found in JWT header');
  }

  // Get the signing key for this kid
  const key = await client.getSigningKey(kid);
  const publicKey = key.getPublicKey();

  // Verify the token with the public key
  return new Promise((resolve, reject) => {
    jwt.verify(accessToken, publicKey, { algorithms: ['RS256'] }, (err, decoded) => {
      if (err) {
        return reject(err);
      }
      resolve(decoded);
    });
  });
}

const initSuperTokens = () => {
  if (isInitialized) return;

  // Check required environment variables
  const requiredEnvVars = [
    'SUPERTOKENS_CONNECTION_URI',
    'SUPERTOKENS_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  supertokens.init({
    framework: "custom",
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_CONNECTION_URI,
      apiKey: process.env.SUPERTOKENS_API_KEY
    },
    appInfo: {
      appName: "一之宮巡礼",
      apiDomain: process.env.APP_API_DOMAIN || "https://ichinomiyamap.com",
      websiteDomain: process.env.APP_WEBSITE_DOMAIN || "https://ichinomiyamap.com",
      apiBasePath: "/api/auth",
      websiteBasePath: "/auth"
    },
    recipeList: [
      ThirdParty.init({
        signInAndUpFeature: {
          providers: [
            {
              config: {
                thirdPartyId: "google",
                clients: [{
                  clientId: process.env.GOOGLE_CLIENT_ID,
                  clientSecret: process.env.GOOGLE_CLIENT_SECRET
                }]
              }
            }
          ]
        }
      }),
      Session.init({
        cookieSecure: true,
        cookieSameSite: "none",
        // Support both header and cookie auth methods
        getTokenTransferMethod: () => "any",
        exposeAccessTokenToFrontendInCookieBasedAuth: true
      })
    ]
  });

  isInitialized = true;
};

/**
 * Verify session from request using manual JWT verification
 * @param {Object} req - Azure Functions request object
 * @param {Object} context - Azure Functions context for logging
 * @returns {Promise<{userId: string} | {error: string}>}
 */
const verifySession = async (req, context) => {
  const authHeader = req.headers['authorization'] || '';

  // Development mode mock token
  if (authHeader === 'Bearer mock-token') {
    return { userId: 'dev-user-123' };
  }

  // Extract access token from Authorization header
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  if (context && context.log) {
    context.log('Auth header present:', !!authHeader);
    context.log('Access token extracted:', accessToken ? 'present' : 'missing');
    context.log('JWKS URI:', jwksUri);
  }

  if (!accessToken) {
    return { error: 'Unauthorized', message: 'No access token found' };
  }

  try {
    // Use manual JWT verification with JWKS
    const decoded = await verifyAccessToken(accessToken);

    if (context && context.log) {
      context.log('JWT verified successfully, userId:', decoded.sub);
    }

    // SuperTokens JWT uses 'sub' field for userId
    return { userId: decoded.sub };
  } catch (error) {
    if (context && context.log) {
      context.log.error('JWT verification failed:', error.message);
      if (error.stack) {
        context.log.error('Stack:', error.stack);
      }
    }
    return { error: 'Unauthorized', message: error.message };
  }
};

module.exports = {
  initSuperTokens,
  verifySession,
  Session,
  ThirdParty
};
