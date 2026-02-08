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
    // For header-based auth, SuperTokens looks for the token in different places
    // Build a headers object that includes both Authorization and st-access-token
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : parsedCookies['st-access-token'] || parsedCookies['sAccessToken'];

    if (context && context.log) {
      context.log('Access token extracted:', accessToken ? `present (${accessToken.substring(0, 30)}...)` : 'missing');
    }

    // Create a request/response wrapper for SuperTokens
    // SuperTokens requires: getMethod, getCookieValue, getHeaderValue, getOriginalURL
    const requestWrapper = {
      getMethod: () => {
        return req.method.toLowerCase();
      },
      getHeaderValue: (name) => {
        // SuperTokens may request headers with different cases
        const lowerName = name.toLowerCase();

        // For authorization header, return the original
        if (lowerName === 'authorization') {
          return authHeader || undefined;
        }

        // For st-access-token, return from cookie if header is missing
        if (lowerName === 'st-access-token' && !req.headers['st-access-token']) {
          // SuperTokens might look for this header in header-based auth mode
          return accessToken || undefined;
        }

        const value = req.headers[name] || req.headers[lowerName];
        if (context && context.log && (lowerName === 'authorization' || lowerName.startsWith('st-'))) {
          context.log(`getHeaderValue(${name}):`, value ? `present (${String(value).substring(0, 30)}...)` : 'missing');
        }
        return value || undefined;
      },
      getCookieValue: (key) => {
        const value = parsedCookies[key];
        if (context && context.log) {
          context.log(`getCookieValue(${key}):`, value ? 'present' : 'missing');
        }
        return value;
      },
      getOriginalURL: () => {
        return req.url || '/';
      }
    };

    const responseWrapper = {
      setHeader: () => {},
      setCookie: () => {},
      removeHeader: () => {},
      removeCookie: () => {}
    };

    const session = await Session.getSession(
      requestWrapper,
      responseWrapper,
      { sessionRequired: true }
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
