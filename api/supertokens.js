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
      apiDomain: process.env.API_DOMAIN || "https://ichinomiyamap.com",
      websiteDomain: process.env.WEBSITE_DOMAIN || "https://ichinomiyamap.com",
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
        // Session will be valid for a very long time
        exposeAccessTokenToFrontendInCookieBasedAuth: true
      })
    ]
  });

  isInitialized = true;
};

/**
 * Verify session from request
 * @param {Object} req - Azure Functions request object
 * @param {Object} res - Azure Functions response object
 * @returns {Promise<{userId: string} | {error: string}>}
 */
const verifySession = async (req, res) => {
  initSuperTokens();

  // Development mode mock token
  const authHeader = req.headers['authorization'] || '';
  const cookieHeader = req.headers['cookie'] || '';

  if (authHeader === 'Bearer mock-token') {
    return { userId: 'dev-user-123' };
  }

  try {
    // Create a request/response wrapper for SuperTokens
    const session = await Session.getSession(
      {
        getHeader: (name) => req.headers[name.toLowerCase()],
        getCookieValue: (key) => {
          const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
            const [name, value] = cookie.trim().split('=');
            acc[name] = value;
            return acc;
          }, {});
          return cookies[key];
        }
      },
      {
        setHeader: (name, value) => {
          // Azure Functions doesn't need this for verification
        },
        setCookie: (key, value, domain, secure, httpOnly, expires, path, sameSite) => {
          // Azure Functions doesn't need this for verification
        }
      },
      { sessionRequired: true }
    );

    return { userId: session.getUserId() };
  } catch (error) {
    if (error.type === 'UNAUTHORISED') {
      return { error: 'Unauthorized' };
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
