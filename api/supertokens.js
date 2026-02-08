/**
 * SuperTokens Configuration for Azure Functions
 */
const supertokens = require('supertokens-node');
const Session = require('supertokens-node/recipe/session');
const ThirdParty = require('supertokens-node/recipe/thirdparty');

// Initialize SuperTokens (call this once at app startup)
let isInitialized = false;

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
 * Verify session from request
 * @param {Object} req - Azure Functions request object
 * @param {Object} context - Azure Functions context for logging
 * @returns {Promise<{userId: string} | {error: string}>}
 */
const verifySession = async (req, context) => {
  initSuperTokens();

  // Development mode mock token
  const authHeader = req.headers['authorization'] || '';
  const cookieHeader = req.headers['cookie'] || '';

  if (authHeader === 'Bearer mock-token') {
    return { userId: 'dev-user-123' };
  }

  // Parse cookies once
  const parsedCookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name && rest.length > 0) {
        parsedCookies[name] = rest.join('=');
      }
    });
  }

  // Log incoming auth info for debugging
  if (context && context.log) {
    context.log('Auth header present:', !!authHeader);
    context.log('Auth header starts with Bearer:', authHeader.startsWith('Bearer '));
    context.log('Auth header value (first 50 chars):', authHeader.substring(0, 50));
    context.log('Cookie keys:', Object.keys(parsedCookies).join(', '));
    context.log('All header keys:', Object.keys(req.headers).join(', '));
    context.log('st-auth-mode:', req.headers['st-auth-mode']);
  }

  try {
    // For header-based auth, extract the access token from Authorization header
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : parsedCookies['st-access-token'] || parsedCookies['sAccessToken'];

    if (context && context.log) {
      context.log('Access token extracted:', accessToken ? `present (${accessToken.substring(0, 30)}...)` : 'missing');
    }

    if (!accessToken) {
      return { error: 'Unauthorized', message: 'No access token found' };
    }

    // Use getSessionWithoutRequestResponse for serverless environments
    // This method directly validates the access token without needing request/response wrappers
    const session = await Session.getSessionWithoutRequestResponse(
      accessToken,
      undefined, // antiCsrfToken - not needed for header-based auth
      {
        sessionRequired: true,
        checkDatabase: false // Don't check database for performance, just validate JWT
      }
    );

    if (context && context.log) {
      context.log('Session verified, userId:', session.getUserId());
    }
    return { userId: session.getUserId() };
  } catch (error) {
    if (context && context.log) {
      context.log.error('Session verification error:', error.type, error.message);
      context.log.error('Error payload:', JSON.stringify(error.payload || {}));
      if (error.stack) {
        context.log.error('Stack:', error.stack);
      }
    }
    if (error.type === 'UNAUTHORISED') {
      return { error: 'Unauthorized', message: error.message };
    }
    return { error: error.message };
  }
};

module.exports = {
  initSuperTokens,
  verifySession,
  Session,
  ThirdParty
};
