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
 * Decode base64url string (JWT uses base64url encoding)
 */
function base64UrlDecode(str) {
  // Replace base64url characters with base64 characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Decode JWT header to get kid
 */
function decodeJwtHeader(token) {
  if (!token || typeof token !== 'string') {
    throw new Error(`Invalid token type: ${typeof token}`);
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid JWT format: expected 3 parts, got ${parts.length}`);
  }

  const headerPart = parts[0];
  if (!headerPart) {
    throw new Error('Empty JWT header part');
  }

  const headerJson = base64UrlDecode(headerPart);
  const header = JSON.parse(headerJson);

  if (!header || typeof header !== 'object') {
    throw new Error(`Invalid header JSON: ${headerJson}`);
  }

  return header;
}

/**
 * Verify JWT access token using JWKS
 */
async function verifyAccessToken(accessToken) {
  // First, decode the header to get the kid
  const header = decodeJwtHeader(accessToken);
  const kid = header.kid;

  if (!kid) {
    throw new Error(`No kid found in JWT header. Header keys: ${Object.keys(header).join(', ')}. Header: ${JSON.stringify(header)}`);
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
        },
        override: {
          functions: (originalImplementation) => {
            return {
              ...originalImplementation,
              signInUp: async function (input) {
                // Call the original implementation
                const response = await originalImplementation.signInUp(input);

                if (response.status === "OK") {
                  // Get user info from OAuth provider
                  // Google returns user info in multiple places, try all sources
                  const rawUserInfo = response.rawUserInfoFromProvider;

                  // Log raw user info for debugging
                  console.log('rawUserInfoFromProvider:', JSON.stringify(rawUserInfo, null, 2));

                  // Try fromIdTokenPayload first (Google ID token contains profile info)
                  const idTokenPayload = rawUserInfo?.fromIdTokenPayload;
                  // Also check fromUserInfoAPI as fallback
                  const userInfoAPI = rawUserInfo?.fromUserInfoAPI;

                  // Extract profile info from available sources
                  const name = idTokenPayload?.name || userInfoAPI?.name ||
                               idTokenPayload?.given_name || userInfoAPI?.given_name || null;
                  const email = idTokenPayload?.email || userInfoAPI?.email ||
                                response.user?.emails?.[0]?.email || null;
                  const picture = idTokenPayload?.picture || userInfoAPI?.picture || null;

                  console.log('Extracted profile:', { name, email, picture });

                  // Store user info in access token payload
                  if (response.session) {
                    await response.session.mergeIntoAccessTokenPayload({
                      name,
                      email,
                      picture
                    });
                    console.log('Profile info stored in access token payload');
                  } else {
                    console.log('No session object available to store profile info');
                  }
                }

                return response;
              }
            };
          }
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
  // Try multiple sources for the access token
  // 1. st-access-token header (preferred, not modified by Azure SWA)
  // 2. Authorization header (may be replaced by Azure SWA)
  const stAccessToken = req.headers['st-access-token'] || '';
  const authHeader = req.headers['authorization'] || '';

  // Development mode mock token
  if (authHeader === 'Bearer mock-token') {
    return { userId: 'dev-user-123' };
  }

  // Extract access token - prefer st-access-token header
  let accessToken = stAccessToken || null;

  // Fallback to Authorization header if st-access-token is not present
  if (!accessToken && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  }

  if (context && context.log) {
    context.log('Auth header present:', !!authHeader);
    context.log('Access token extracted:', accessToken ? 'present' : 'missing');
    context.log('JWKS URI:', jwksUri);
  }

  if (!accessToken) {
    return { error: 'Unauthorized', message: 'No access token found' };
  }

  try {
    // Log the first part of the token for debugging
    if (context && context.log) {
      const tokenParts = accessToken.split('.');
      context.log('Token parts count:', tokenParts.length);
      context.log('Token header (first 50 chars):', accessToken.substring(0, 50));

      // Try to decode header
      try {
        const header = decodeJwtHeader(accessToken);
        context.log('Decoded header:', JSON.stringify(header));
      } catch (decodeErr) {
        context.log.error('Header decode error:', decodeErr.message);
      }
    }

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
